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
 *    registra um aviso de sistema na conversa. NÃO fecha a conversa sozinho: o encerramento tem regras próprias
 *    (motivo, caso, avaliação) que ainda não foram ligadas a este canal — ver o plano, CRM-7.
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

import { camposCpfParaGravar, hashCpf } from "@/lib/contacts/cpf";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { marcarConversaComMensagem } from "@/lib/channels/marcar-conversa";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import { logger } from "@/lib/logger";

import type { EventoDoChat, MensagemDoHistorico } from "./contrato";

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

  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: entrada.organizationId,
      conversation_id: conversa.id,
      contact_id: conversa.contact_id,
      channel_session_id: entrada.channelSessionId,
      external_id: ev.message_id,
      direction: "inbound",
      sent_via: "external_device",
      status: "delivered",
      type: "text",
      body: ev.text,
      metadata: { source: FONTE },
      ...(ev.sent_at ? { sent_at: ev.sent_at } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return { status: "duplicate", conversationId: conversa.id };
  if (error || !data) throw new Error(`chat_externo_ingest_insert_failed: ${error?.message ?? "sem id"}`);
  const messageId = (data as { id: string }).id;

  await marcarConversaComMensagem(admin, {
    organizationId: entrada.organizationId,
    conversationId: conversa.id,
    direction: "inbound",
    preview: ev.text.slice(0, 200),
    at: ev.sent_at ?? new Date().toISOString(),
    canal: CANAL_DA_CONVERSA,
  });

  await aplicarEfeitosPosEntrada(admin, {
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
  });

  return { status: "ingested", conversationId: conversa.id, messageId };
}

// ─── chat.closed_by_customer ─────────────────────────────────────────────────────────────────────

async function avisarEncerramento(
  admin: SupabaseClient,
  entrada: Entrada,
  ev: Extract<EventoDoChat, { event: "chat.closed_by_customer" }>,
): Promise<ResultadoDoChat> {
  const conversa = await conversaDaIdentidade(admin, entrada, ev.identity);
  if (!conversa) return { status: "ignored", reason: "conversa_desconhecida" };

  const { error } = await admin.from("messages").insert({
    organization_id: entrada.organizationId,
    conversation_id: conversa.id,
    contact_id: conversa.contact_id,
    channel_session_id: entrada.channelSessionId,
    // Determinístico: o Chat reenviando o mesmo aviso não vira duas linhas.
    external_id: `${FONTE}:${ev.identity}:encerrado`,
    direction: "outbound",
    sent_via: "system",
    status: "delivered",
    type: "text",
    body: "O cliente encerrou o atendimento pelo chat.",
    metadata: { source: FONTE, aviso_de_sistema: "encerrado_pelo_cliente" },
    ...(ev.closed_at ? { sent_at: ev.closed_at } : {}),
  });
  if (error?.code === "23505") return { status: "duplicate", conversationId: conversa.id };
  if (error) throw new Error(`chat_externo_closed_notice_failed: ${error.message}`);
  return { status: "ingested", conversationId: conversa.id };
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
