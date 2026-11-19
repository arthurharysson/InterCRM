/**
 * A INGESTÃO DO CHAT EXTERNO: webhook assinado do Chat → contato, conversa, mensagem, na Fila.
 *
 * Contrato em `./contrato.ts`. Este canal NÃO é o InterSuite (`web`): é outro provider, com segredo por
 * canal. O arquivo `lib/channels/web/ingest.ts` não é tocado nem importado.
 *
 * ═══ O QUE ACONTECE EM CADA EVENTO ══════════════════════════════════════════════════════════════
 *
 *  `chat.started`
 *    1. acha o contato pelo CPF (que o CRM guarda cifrado) ou cria um novo, identificado por `web:<uuid>`;
 *    2. abre a conversa na Fila (sem dono, aberta) com o setor que o bot indicou, se o módulo de setores estiver
 *       ligado e o código existir — senão ela entra SEM setor, e isso volta no desfecho (não se perde o cliente);
 *    3. importa o histórico que o cliente teve com o bot, MARCADO como importado: não acende alerta, não acorda
 *       agente nem automação e não conta como espera.
 *
 *  `message`
 *    grava a mensagem do cliente com idempotência por `message_id` e dispara os efeitos de sempre (alerta,
 *    agente, opt-out). Sem `chat.started` antes, a conversa nasce aqui mesmo: perder a mensagem por causa da ordem
 *    dos eventos seria pior que abrir a conversa sem o histórico.
 *
 *  `chat.closed_by_customer`
 *    registra um aviso de sistema na conversa E a fecha (`fn_service_status`, a mesma RPC do botão "Encerrar"):
 *    o cliente foi embora, e a conversa não pode ficar aberta numa Fila que ninguém vai responder. Cada passo é
 *    idempotente, e falha do banco no fechamento lança para o Chat reenviar. A demanda NÃO é fechada junto: a RPC
 *    deixa o "próximo passo" de revisar o atendimento, como em qualquer fechamento.
 *
 *  `chat.expired`
 *    o Chat venceu o atendimento por inatividade (o cliente abriu o link e sumiu, sem encerrar). Sem este aviso a
 *    conversa ficava "Aguardando" na Fila para sempre, esperando um cliente que não está mais lá. Faz o mesmo que
 *    `chat.closed_by_customer` — aviso de sistema + fechamento —, com texto e motivo próprios.
 *
 * ═══ POR QUE UM CONTATO POR CHAT, E O QUE O CPF FAZ ═════════════════════════════════════════════
 *
 * Há uma conversa por (organização, contato, canal). Para 1 link = 1 conversa, o contato nasce POR CHAT, com
 * `social_identity = identity`. O CPF só entra para REUTILIZAR o contato que já tem aquele CPF (o índice único
 * parcial por CPF impediria um segundo contato de qualquer jeito): quem volta com outro link continua o MESMO
 * contato — e a conversa dele neste canal passa a apontar para o link novo. Unir com o contato do WhatsApp é
 * fora de escopo por decisão do dono; se o CPF casar com ele, a união acontece por si só.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import { audit } from "@/lib/audit";
import { camposCpfParaGravar, hashCpf } from "@/lib/contacts/cpf";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { marcarConversaComMensagem } from "@/lib/channels/marcar-conversa";
import { previaDaMensagem } from "@/lib/messaging/previa-da-mensagem";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import { logger } from "@/lib/logger";

import type { AnexoDoChat, EventoDoChat, MensagemDoHistorico } from "./contrato";

export interface ResultadoDoChat {
  status: "ingested" | "duplicate" | "ignored";
  conversationId?: string;
  messageId?: string;
  reason?: string;
  /** `true` quando a conversa entrou na Fila COM o setor pedido. */
  setorAplicado?: boolean;
  /** Por que o setor não foi aplicado (módulo desligado, código desconhecido). */
  setorMotivo?: "sem_codigo" | "setores_desligado" | "codigo_desconhecido";
  historicoImportado?: number;
}

const CANAL_DA_CONVERSA = "web";
const FONTE = "chat_externo";

type Entrada = {
  organizationId: string;
  channelSessionId: string;
  requestId?: string;
};

export async function ingerirEventoDoChat(
  admin: SupabaseClient,
  entrada: Entrada & { evento: EventoDoChat },
): Promise<ResultadoDoChat> {
  const { evento } = entrada;
  switch (evento.event) {
    case "chat.started":
      return iniciarChat(admin, entrada, evento);
    case "message":
      return receberMensagem(admin, entrada, evento);
    case "chat.closed_by_customer":
      return avisarEncerramento(admin, entrada, evento);
    case "chat.expired":
      return avisarExpiracao(admin, entrada, evento);
  }
}

// ─── chat.started ────────────────────────────────────────────────────────────────────────────────

async function iniciarChat(
  admin: SupabaseClient,
  entrada: Entrada,
  ev: Extract<EventoDoChat, { event: "chat.started" }>,
): Promise<ResultadoDoChat> {
  const existente = await conversaDaIdentidade(admin, entrada, ev.identity);
  // Reenvio do mesmo `chat.started` (o Chat reenvia até receber 2xx): não duplica nada.
  if (existente) return { status: "duplicate", conversationId: existente.id };

  const contactId = await resolverContato(admin, entrada.organizationId, ev.identity, ev.contact);
  if (!contactId) return { status: "ignored", reason: "contato_nao_resolvido" };

  const conversationId = await abrirConversa(admin, entrada, contactId, ev.identity);
  if (!conversationId) return { status: "ignored", reason: "conversa_nao_resolvida" };

  const setor = await aplicarSetor(admin, entrada, conversationId, ev.sector);
  const historicoImportado = await importarHistorico(admin, entrada, conversationId, contactId, ev);

  return {
    status: "ingested",
    conversationId,
    ...setor,
    historicoImportado,
  };
}

async function resolverContato(
  admin: SupabaseClient,
  organizationId: string,
  identity: string,
  contato: { name: string | null; cpf: string | null },
): Promise<string | null> {
  const porIdentidade = await contatoPor(admin, organizationId, "social_identity", identity);
  if (porIdentidade) return porIdentidade;

  if (contato.cpf) {
    const porCpf = await contatoPor(admin, organizationId, "cpf_hash", hashCpf(contato.cpf));
    if (porCpf) return porCpf;
  }

  const cpf = contato.cpf ? await camposCpfParaGravar(admin, contato.cpf) : {};
  const { data, error } = await admin
    .from("contacts")
    .insert({
      organization_id: organizationId,
      social_identity: identity,
      name: contato.name,
      display_name: contato.name,
      source: "web",
      kind: "person",
      ...cpf,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    // Corrida (o mesmo evento chegou duas vezes ao mesmo tempo) ou CPF que outro escritor acabou de gravar.
    const vencedor =
      (await contatoPor(admin, organizationId, "social_identity", identity)) ??
      (contato.cpf ? await contatoPor(admin, organizationId, "cpf_hash", hashCpf(contato.cpf)) : null);
    if (vencedor) return vencedor;
  }
  if (error || !data) {
    logger.error("[chat-externo] contato não criado", { organization_id: organizationId, code: error?.code });
    throw new Error("chat_externo_contact_insert_failed");
  }
  return (data as { id: string }).id;
}

async function contatoPor(
  admin: SupabaseClient,
  organizationId: string,
  coluna: "social_identity" | "cpf_hash",
  valor: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq(coluna, valor)
    .is("is_merged_into", null)
    .maybeSingle();
  if (error) throw new Error("chat_externo_contact_lookup_failed");
  return (data as { id: string } | null)?.id ?? null;
}

async function abrirConversa(
  admin: SupabaseClient,
  entrada: Entrada,
  contactId: string,
  identity: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation", {
    p_org: entrada.organizationId,
    p_contact: contactId,
    p_session: entrada.channelSessionId,
  });
  if (error || !data) return null;
  const conversationId = data as string;

  const { error: erroUpdate } = await admin
    .from("conversations")
    .update({ provider_conversation_id: identity, channel: CANAL_DA_CONVERSA })
    .eq("id", conversationId)
    .eq("organization_id", entrada.organizationId);
  if (erroUpdate) return null;
  return conversationId;
}

/**
 * O setor pelo CÓDIGO que o bot mandou. Nunca recusa o cliente por causa do setor: sem módulo, sem código ou com
 * código desconhecido a conversa entra na Fila SEM setor e o desfecho diz por quê.
 */
async function aplicarSetor(
  admin: SupabaseClient,
  entrada: Entrada,
  conversationId: string,
  codigo: string | null,
): Promise<Pick<ResultadoDoChat, "setorAplicado" | "setorMotivo">> {
  if (!codigo) return { setorAplicado: false, setorMotivo: "sem_codigo" };
  if (!(await moduloLigado(admin, "setores"))) {
    return { setorAplicado: false, setorMotivo: "setores_desligado" };
  }

  const { data: setor, error } = await admin
    .from("attendant_sectors")
    .select("id")
    .eq("organization_id", entrada.organizationId)
    .eq("external_code", codigo)
    .maybeSingle();
  if (error) throw new Error("chat_externo_sector_lookup_failed");
  if (!setor) {
    logger.warn("[chat-externo] código de setor desconhecido", { organization_id: entrada.organizationId });
    return { setorAplicado: false, setorMotivo: "codigo_desconhecido" };
  }

  const { error: erroUpdate } = await admin
    .from("conversations")
    .update({ sector_id: (setor as { id: string }).id })
    .eq("id", conversationId)
    .eq("organization_id", entrada.organizationId);
  if (erroUpdate) throw new Error("chat_externo_sector_update_failed");

  // A conversa já nasceu na Fila SEM setor. Pede a distribuição de novo: a mesma RPC que a rota do setor usa
  // (`fn_request_channel_routing`) — não se inventa um segundo caminho para a Fila nascer.
  const { error: erroFila } = await admin.rpc("fn_request_channel_routing", {
    p_org: entrada.organizationId,
    p_conversation: conversationId,
  });
  if (erroFila) {
    logger.error("[chat-externo] fn_request_channel_routing falhou", { message: erroFila.message });
  }
  return { setorAplicado: true };
}

/**
 * O histórico do bot, em ordem, MARCADO como importado e SEM efeito nenhum (nem alerta, nem agente, nem
 * `fn_mark_conversation_message`): ele é contexto para o atendente, não atividade do cliente.
 *
 * O `external_id` leva a identidade na frente porque o id do bot só é único DENTRO do bot, e a coluna é única
 * por organização inteira. Reenviar o `chat.started` não duplica: o `23505` é o sinal e a linha é pulada.
 */
async function importarHistorico(
  admin: SupabaseClient,
  entrada: Entrada,
  conversationId: string,
  contactId: string,
  ev: Extract<EventoDoChat, { event: "chat.started" }>,
): Promise<number> {
  let gravadas = 0;
  for (const m of ev.history) {
    if (await gravarDoHistorico(admin, entrada, conversationId, contactId, ev.identity, m)) gravadas++;
  }
  if (gravadas > 0) await preencherPrevia(admin, entrada, conversationId, ev);
  return gravadas;
}

/**
 * A lista da Fila lê `last_message_preview`; sem ela a conversa recém-aberta aparece como "Sem mensagens" mesmo
 * com o histórico do bot já dentro (visto na prova pela tela). Só a PRÉVIA e a data entram — e só se a conversa
 * ainda não tem nenhuma —, porque `fn_mark_conversation_message` também zeraria o relógio de espera e somaria
 * não-lidas, e o histórico não é atividade do cliente. Falhar aqui não derruba a entrada: é cosmético.
 */
async function preencherPrevia(
  admin: SupabaseClient,
  entrada: Entrada,
  conversationId: string,
  ev: Extract<EventoDoChat, { event: "chat.started" }>,
): Promise<void> {
  const ultima = ev.history[ev.history.length - 1];
  if (!ultima) return;
  const { error } = await admin
    .from("conversations")
    .update({
      last_message_preview: ultima.text.slice(0, 200),
      last_message_at: ultima.sent_at ?? ev.started_at ?? new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("organization_id", entrada.organizationId)
    .is("last_message_at", null);
  if (error) logger.warn("[chat-externo] prévia do histórico não gravada", { message: error.message });
}

async function gravarDoHistorico(
  admin: SupabaseClient,
  entrada: Entrada,
  conversationId: string,
  contactId: string,
  identity: string,
  m: MensagemDoHistorico,
): Promise<boolean> {
  const doCliente = m.from === "customer";
  const { error } = await admin.from("messages").insert({
    organization_id: entrada.organizationId,
    conversation_id: conversationId,
    contact_id: contactId,
    channel_session_id: entrada.channelSessionId,
    external_id: `${FONTE}:${identity}:${m.message_id}`,
    direction: doCliente ? "inbound" : "outbound",
    sent_via: doCliente ? "external_device" : "automation",
    status: "delivered",
    type: "text",
    body: m.text,
    metadata: { source: FONTE, importado_do_bot: true, origem: m.from },
    ...(m.sent_at ? { sent_at: m.sent_at } : {}),
  });
  if (error?.code === "23505") return false;
  if (error) throw new Error(`chat_externo_history_insert_failed: ${error.message}`);
  return true;
}

// ─── message ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A mensagem do cliente, com ou sem anexos.
 *
 * O CRM guarda UMA mídia por linha de `messages`, então uma mensagem com N anexos vira N linhas: o texto (legenda)
 * vai na PRIMEIRA, com o `message_id` do Chat como `external_id` (compatível com o que já existe), e cada anexo
 * seguinte ganha `<message_id>:anexo<N>`. Cada linha é idempotente pelo `23505`, então o reenvio do Chat completa
 * o que faltou sem duplicar o que já entrou — e, como o Chat repete até receber 2xx, falha do banco numa linha LANÇA.
 *
 * Os efeitos de sempre (carimbo da conversa, alerta, agente, opt-out) disparam UMA vez por mensagem do cliente, logo
 * depois da PRIMEIRA linha e só quando ela é nova: reenvio e anexos extras não repetem nada.
 *
 * Os BYTES não são baixados aqui: a URL do Chat é assinada e vence em 1 h, e a linha já nasce visível. Quem baixa
 * e guarda no Storage é o worker de mídia (`media.persist_requested`), com tentativas, pelo `fetchInboundMedia` do
 * adapter — o mesmo caminho dos outros canais, que também deriva a descrição para a IA.
 */
async function receberMensagem(
  admin: SupabaseClient,
  entrada: Entrada,
  ev: Extract<EventoDoChat, { event: "message" }>,
): Promise<ResultadoDoChat> {
  let conversa = await conversaDaIdentidade(admin, entrada, ev.identity);

  if (!conversa) {
    // `message` antes do `chat.started`: abre a conversa agora, sem histórico e sem CPF.
    const contactId = await resolverContato(admin, entrada.organizationId, ev.identity, {
      name: ev.sender_name,
      cpf: null,
    });
    if (!contactId) return { status: "ignored", reason: "contato_nao_resolvido" };
    const id = await abrirConversa(admin, entrada, contactId, ev.identity);
    if (!id) return { status: "ignored", reason: "conversa_nao_resolvida" };
    conversa = { id, contact_id: contactId };
  }

  const linhas = linhasDaMensagem(ev);
  let primeiraId: string | undefined;
  let algumaNova = false;
  for (const [indice, linha] of linhas.entries()) {
    const id = await gravarLinhaDaMensagem(admin, entrada, conversa, ev, linha);
    if (id === "duplicate") continue;
    algumaNova = true;
    if (linha.anexo) await pedirPersistenciaDaMidia(admin, entrada.organizationId, conversa.id, id);
    if (indice === 0) {
      primeiraId = id;
      // Os efeitos disparam AQUI, logo depois da primeira linha — e não no fim do laço: se a falha vier no
      // segundo anexo, a primeira já está gravada e, no reenvio, vira duplicata. Deixar os efeitos para o fim
      // faria uma mensagem que já está na Fila nunca acordar o alerta nem o agente.
      await acordarOSistema(admin, entrada, conversa, ev, linhas[0]!, id);
    }
  }
  if (!algumaNova) return { status: "duplicate", conversationId: conversa.id };
  return { status: "ingested", conversationId: conversa.id, ...(primeiraId ? { messageId: primeiraId } : {}) };
}

/**
 * ─── Por que os efeitos NÃO seguram a resposta ao Chat ──────────────────────────────────────────────────────
 *
 * O Chat entrega as mensagens de um mesmo chat em ORDEM e uma por vez: só manda a seguinte depois que o CRM
 * responde à anterior. Os efeitos pós-entrada (demanda, campanha, follow-up, pedido de turno ao agente, dreno de
 * eventos) são dezenas de idas ao banco em série — medido em 17/11/2026 numa instalação com o Supabase na nuvem:
 * ~8 s por mensagem, e 8 mensagens seguidas chegaram a 68 s de atraso na Fila.
 *
 * Por isso o que aparece para a equipe fica DENTRO da resposta (a linha da mensagem e o carimbo da conversa: é o
 * que acende a Fila), e o resto roda DEPOIS dela. Três cuidados, porque agora ninguém espera o resultado:
 *   - falha de um efeito vira log de erro (e só dele): o Chat já recebeu 200 e não reenviaria, e reenviar não
 *     repetiria o efeito mesmo assim (a duplicata sai antes dele);
 *   - a ORDEM por conversa é mantida (uma cauda por conversa, neste processo): antes ela vinha de graça da
 *     entrega serial do Chat, e rodar efeitos de mensagens seguidas em paralelo abriria corrida entre eles;
 *   - sem requisição (teste, script de recuperação) não há `after`: roda na hora, como sempre rodou.
 */
const caudaDeEfeitos = new Map<string, Promise<void>>();

async function emSegundoPlano(conversationId: string, rotulo: string, efeito: () => Promise<void>): Promise<void> {
  // A cauda é montada quando a tarefa COMEÇA (depois da resposta), não quando é agendada: a ordem é a de início.
  const rodar = (): Promise<void> => {
    const anterior = caudaDeEfeitos.get(conversationId) ?? Promise.resolve();
    const minha: Promise<void> = anterior
      .then(efeito)
      .catch((err: unknown) => {
        logger.error("[chat-externo] efeito pós-entrada falhou", {
          conversation_id: conversationId,
          efeito: rotulo,
          detail: err instanceof Error ? err.message.slice(0, 160) : "desconhecido",
        });
      })
      .finally(() => {
        if (caudaDeEfeitos.get(conversationId) === minha) caudaDeEfeitos.delete(conversationId);
      });
    caudaDeEfeitos.set(conversationId, minha);
    return minha;
  };
  try {
    after(rodar);
  } catch {
    // Fora de uma requisição o `after` não existe: roda e espera aqui mesmo.
    await rodar();
  }
}

/** Carimbo da conversa (na resposta) + alerta, agente e opt-out (depois dela): os efeitos de uma mensagem NOVA. */
async function acordarOSistema(
  admin: SupabaseClient,
  entrada: Entrada,
  conversa: { id: string; contact_id: string },
  ev: Extract<EventoDoChat, { event: "message" }>,
  primeira: LinhaDaMensagem,
  messageId: string,
): Promise<void> {
  await marcarConversaComMensagem(admin, {
    organizationId: entrada.organizationId,
    conversationId: conversa.id,
    direction: "inbound",
    preview: previaDaMensagem(primeira.corpo, primeira.tipo).slice(0, 200),
    at: ev.sent_at ?? new Date().toISOString(),
    canal: CANAL_DA_CONVERSA,
  });

  await emSegundoPlano(conversa.id, "pos-entrada", () =>
    aplicarEfeitosPosEntrada(admin, {
      organizationId: entrada.organizationId,
      contactId: conversa.contact_id,
      conversationId: conversa.id,
      messageId,
      channelSessionId: entrada.channelSessionId,
      texto: ev.text,
      nomeDoContato: ev.sender_name,
      requestId: entrada.requestId,
      origem: "chat_externo_webhook",
      canal: CANAL_DA_CONVERSA,
      // Atendimento ao vivo com botão próprio de "Encerrar atendimento": ali "sair" é sair do chat, não pedir
      // para nunca mais receber mensagem. Achado na prova pela tela em 16/11/2026 (o contato de teste foi
      // bloqueado ao digitar "#sair"). O agente continua escalando ao humano diante de um pedido provável.
      optOutPorPalavra: false,
    }),
  );
}

type LinhaDaMensagem = {
  externalId: string | null;
  tipo: "text" | "image" | "document";
  corpo: string;
  anexo: AnexoDoChat | null;
};

/** As linhas de `messages` desta mensagem do cliente: o texto + o 1º anexo, e uma linha por anexo seguinte. */
function linhasDaMensagem(ev: Extract<EventoDoChat, { event: "message" }>): LinhaDaMensagem[] {
  if (ev.attachments.length === 0) return [{ externalId: ev.message_id, tipo: "text", corpo: ev.text, anexo: null }];
  return ev.attachments.map((anexo, i) => ({
    externalId: i === 0 ? ev.message_id : ev.message_id ? `${ev.message_id}:anexo${i + 1}` : null,
    tipo: anexo.kind,
    corpo: i === 0 ? ev.text : "",
    anexo,
  }));
}

/** O id da linha nova, ou `"duplicate"` quando o `23505` diz que o reenvio já a trouxe. Outro erro LANÇA. */
async function gravarLinhaDaMensagem(
  admin: SupabaseClient,
  entrada: Entrada,
  conversa: { id: string; contact_id: string },
  ev: Extract<EventoDoChat, { event: "message" }>,
  linha: LinhaDaMensagem,
): Promise<string | "duplicate"> {
  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: entrada.organizationId,
      conversation_id: conversa.id,
      contact_id: conversa.contact_id,
      channel_session_id: entrada.channelSessionId,
      external_id: linha.externalId,
      direction: "inbound",
      sent_via: "external_device",
      status: "delivered",
      type: linha.tipo,
      body: linha.corpo,
      // A URL é PONTEIRO para algo que vence (1 h) e só o Chat serve: o worker baixa os bytes e guarda uma cópia
      // no Storage. O mime é dica — o que vale é o do arquivo baixado.
      ...(linha.anexo ? { media_url: linha.anexo.url, media_mime: linha.anexo.mime } : {}),
      metadata: {
        source: FONTE,
        // O nome original: é a chave que o cartão de documento do Inbox lê.
        ...(linha.anexo?.name ? { media_filename: linha.anexo.name } : {}),
      },
      ...(ev.sent_at ? { sent_at: ev.sent_at } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return "duplicate";
  if (error || !data) throw new Error(`chat_externo_ingest_insert_failed: ${error?.message ?? "sem id"}`);
  return (data as { id: string }).id;
}

/**
 * Pede ao worker de mídia que baixe e guarde o anexo (mesmo evento e mesmo payload dos outros canais).
 * Best-effort: a mensagem já está gravada e visível; derrubar a ingestão aqui faria o Chat reenviar tudo.
 */
async function pedirPersistenciaDaMidia(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const { error } = await admin.rpc(
    "emit_event" as never,
    {
      p_event_type: "media.persist_requested",
      p_entity_kind: "message",
      p_entity_id: messageId,
      p_payload: { message_id: messageId, conversation_id: conversationId },
      p_metadata: { source: "chat_externo_webhook" },
      p_organization_id: organizationId,
    } as never,
  );
  if (error) {
    logger.warn("[chat-externo] emit media.persist_requested falhou", { messageId, detail: error.message });
  }
}

// ─── chat.closed_by_customer ─────────────────────────────────────────────────────────────────────

/**
 * O cliente encerrou pelo botão da página: o aviso de sistema entra na linha do tempo E a conversa SAI DA FILA.
 *
 * Os dois passos são independentes e cada um é idempotente, para o reenvio do Chat (que repete até receber 2xx)
 * completar o que faltou:
 *   - o aviso: `external_id` determinístico, o `23505` do reenvio é o sinal de "já gravei";
 *   - o fechamento: pela `fn_service_status` — a MESMA do botão "Encerrar" do atendente —, que devolve a linha sem
 *     mexer quando a conversa já está no estado pedido. Conversa que a equipe já fechou (ou resolveu/arquivou) nem
 *     chega a chamá-la, e não audita duas vezes.
 *
 * Falha do banco no fechamento LANÇA, de propósito: a rota responde 5xx e o Chat reenvia (a outbox dele repete por
 * até 24 h). Engolir o erro deixaria a conversa aberta para sempre numa Fila cujo cliente já foi embora.
 *
 * NÃO avisa o Chat de volta (`avisarEncerramentoAoCanal`): foi ele quem encerrou, a página já está fechada, e um
 * `conversation.closed` de volta só voltaria como 410/duplicata.
 */
async function avisarEncerramento(
  admin: SupabaseClient,
  entrada: Entrada,
  ev: Extract<EventoDoChat, { event: "chat.closed_by_customer" }>,
): Promise<ResultadoDoChat> {
  const conversa = await conversaDaIdentidade(admin, entrada, ev.identity);
  if (!conversa) return { status: "ignored", reason: "conversa_desconhecida" };

  const avisou = await gravarAvisoDeEncerramento(admin, entrada, conversa, ev.identity, ENCERRADO_PELO_CLIENTE, ev.closed_at);
  const fechou = await fecharConversaDoCliente(admin, entrada, conversa.id, ENCERRADO_PELO_CLIENTE.encerrado_por);
  return { status: avisou || fechou ? "ingested" : "duplicate", conversationId: conversa.id };
}

// ─── chat.expired ────────────────────────────────────────────────────────────────────────────────

/**
 * O Chat venceu o atendimento por inatividade: o cliente abriu o link e sumiu sem encerrar. O desfecho no CRM é o
 * mesmo do encerramento pelo cliente — aviso de sistema na linha do tempo e a conversa SAI DA FILA —, porque o
 * problema é o mesmo: uma conversa aberta esperando alguém que não vai responder. Mesma idempotência, mesma
 * `fn_service_status`, e também NÃO avisa o Chat de volta (foi ele quem encerrou).
 *
 * Conversa desconhecida (`ignored`): o Chat só avisa chats que ele abriu, mas um `chat.started` que ainda não
 * chegou, ou uma conversa apagada, não é motivo para o Chat reenviar por 24 h.
 */
async function avisarExpiracao(
  admin: SupabaseClient,
  entrada: Entrada,
  ev: Extract<EventoDoChat, { event: "chat.expired" }>,
): Promise<ResultadoDoChat> {
  const conversa = await conversaDaIdentidade(admin, entrada, ev.identity);
  if (!conversa) return { status: "ignored", reason: "conversa_desconhecida" };

  const avisou = await gravarAvisoDeEncerramento(admin, entrada, conversa, ev.identity, EXPIRADO_POR_INATIVIDADE, ev.expired_at);
  const fechou = await fecharConversaDoCliente(admin, entrada, conversa.id, EXPIRADO_POR_INATIVIDADE.encerrado_por);
  return { status: avisou || fechou ? "ingested" : "duplicate", conversationId: conversa.id };
}

/** O que muda entre os dois fins de atendimento que partem do Chat: o texto, o rótulo e o motivo da auditoria. */
interface FimDoAtendimento {
  /** Sufixo do `external_id` do aviso (determinístico: o reenvio do Chat não vira duas linhas). */
  sufixo: string;
  corpo: string;
  /** `metadata.aviso_de_sistema` — o que a tela e os relatórios leem. */
  aviso: string;
  /** `metadata.encerrado_por` da auditoria `conversation.closed`. */
  encerrado_por: string;
}

const ENCERRADO_PELO_CLIENTE: FimDoAtendimento = {
  sufixo: "encerrado",
  corpo: "O cliente encerrou o atendimento pelo chat.",
  aviso: "encerrado_pelo_cliente",
  encerrado_por: "cliente",
};

const EXPIRADO_POR_INATIVIDADE: FimDoAtendimento = {
  sufixo: "expirado",
  corpo: "O chat foi encerrado por inatividade do cliente.",
  aviso: "expirado_por_inatividade",
  encerrado_por: "inatividade",
};

/** `true` quando gravou o aviso agora; `false` quando ele já existia (reenvio do Chat). */
async function gravarAvisoDeEncerramento(
  admin: SupabaseClient,
  entrada: Entrada,
  conversa: { id: string; contact_id: string },
  identidade: string,
  fim: FimDoAtendimento,
  quando: string | null,
): Promise<boolean> {
  const { error } = await admin.from("messages").insert({
    organization_id: entrada.organizationId,
    conversation_id: conversa.id,
    contact_id: conversa.contact_id,
    channel_session_id: entrada.channelSessionId,
    // Determinístico: o Chat reenviando o mesmo aviso não vira duas linhas.
    external_id: `${FONTE}:${identidade}:${fim.sufixo}`,
    direction: "outbound",
    sent_via: "system",
    status: "delivered",
    type: "text",
    body: fim.corpo,
    metadata: { source: FONTE, aviso_de_sistema: fim.aviso },
    ...(quando ? { sent_at: quando } : {}),
  });
  if (error?.code === "23505") return false;
  if (error) throw new Error(`chat_externo_closed_notice_failed: ${error.message}`);
  return true;
}

/** Estados de fim de atendimento: a equipe já decidiu, e o cliente ter saído depois não muda nada. */
const ESTADOS_TERMINAIS = new Set(["closed", "resolved", "archived"]);

/** `true` quando ESTA chamada fechou a conversa; `false` quando ela já não estava mais aberta. */
async function fecharConversaDoCliente(
  admin: SupabaseClient,
  entrada: Entrada,
  conversationId: string,
  encerradoPor: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("conversations")
    .select("status")
    .eq("organization_id", entrada.organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error("chat_externo_close_lookup_failed");
  const status = (data as { status: string } | null)?.status;
  if (!status || ESTADOS_TERMINAIS.has(status)) return false;

  const { error: erroFechar } = await admin.rpc("fn_service_status", {
    p_org: entrada.organizationId,
    p_conversation: conversationId,
    p_status: "closed",
  });
  // `P0002` = a conversa sumiu entre a leitura e a escrita: nada a fechar, não é erro do Chat.
  if (erroFechar?.code === "P0002") return false;
  if (erroFechar) {
    logger.error("[chat-externo] fn_service_status falhou ao fechar", {
      organization_id: entrada.organizationId,
      code: erroFechar.code,
    });
    throw new Error(`chat_externo_close_failed: ${erroFechar.code}`);
  }

  // Sem ator humano: quem encerrou foi o cliente (ou o tempo dele), pelo chat. Fire-and-forget, como todo `audit`.
  void audit({
    action: "conversation.closed",
    organizationId: entrada.organizationId,
    resourceType: "conversation",
    resourceId: conversationId,
    requestId: entrada.requestId,
    metadata: { via: "chat_externo", encerrado_por: encerradoPor },
  });
  return true;
}

// ─── compartilhado ───────────────────────────────────────────────────────────────────────────────

async function conversaDaIdentidade(
  admin: SupabaseClient,
  entrada: Entrada,
  identity: string,
): Promise<{ id: string; contact_id: string } | null> {
  const { data, error } = await admin
    .from("conversations")
    .select("id, contact_id")
    .eq("organization_id", entrada.organizationId)
    .eq("channel_session_id", entrada.channelSessionId)
    .eq("provider_conversation_id", identity)
    .maybeSingle();
  if (error) throw new Error("chat_externo_thread_lookup_failed");
  const linha = data as { id: string; contact_id: string | null } | null;
  return linha?.contact_id ? { id: linha.id, contact_id: linha.contact_id } : null;
}
