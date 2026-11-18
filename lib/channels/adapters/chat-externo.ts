/**
 * Adapter do canal `chat_externo` — a página de chat própria (aplicação separada).
 *
 * ─── Por que este adapter não fala com provider nenhum ──────────────────────────────────────────
 *
 * Não existe plataforma: o destinatário está com uma aba do Chat aberta, e quem entrega é o tempo real do
 * Chat. O transporte é um POST assinado no endereço de entrada que o Chat expõe. É o MESMO desenho do canal
 * `web` do InterSuite — e por isso este arquivo é uma cópia deliberada, e não uma extensão dele: o canal do
 * InterSuite não é tocado.
 *
 * ─── Por que a credencial é POR CANAL ───────────────────────────────────────────────────────────
 *
 * O `web` lê URL e segredo do ambiente (um canal por instalação). Aqui cada canal guarda o endereço de saída
 * (`chat_externo_url`) e o segredo de assinatura CIFRADO (`chat_externo_secret_out_encrypted`) na própria
 * linha de `channel_sessions`. `send` lê a linha pelo par (organização da operação, `sessionRef`): a
 * organização vem de fonte confiável e é obrigatória no envelope justamente para isto (issue #236).
 *
 * ─── O endereço do destinatário ─────────────────────────────────────────────────────────────────
 *
 * Não vem do contato: é a identidade opaca do chat (`web:<uuid>`), gravada em
 * `conversations.provider_conversation_id` e devolvida no envelope.
 */
import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { HEADER_ASSINATURA_DE_ENTRADA } from "@/lib/webhooks/assinatura";

import { assinarCorpo } from "../chat-externo/contrato";
import { CHANNEL_PROVIDER_CHAT_EXTERNO } from "../capabilities";
import type { FetchedMedia } from "@/lib/messaging/media/types";

import type { ChannelAdapter, ChannelHealth, OutboundEnvelope, RecipientInput } from "../types";

/** A versão do contrato que o CRM fala. O Chat confere. */
export const CABECALHO_DO_CONTRATO = "x-chat-contract";
export const VERSAO_DO_CONTRATO = "2";
const PRAZO_DO_ENVIO_MS = 10_000;

/**
 * ─── Falha PASSAJEIRA do Chat: reenvia na hora, até 3 tentativas ────────────────────────────────────
 *
 * O Chat é uma aplicação separada, que o operador redeploya (e reinicia) no meio do expediente: durante esses
 * segundos o CRM recebia 502/503 ou conexão recusada, a resposta do atendente virava mensagem FALHA, e o cliente
 * ficava esperando uma resposta que a equipe achava que tinha mandado.
 *
 * Reenviar é seguro porque o Chat DEDUPLICA por `message_id` (`receiveAgentMessage`, idempotente): o corpo e a
 * assinatura vão IDÊNTICOS, então uma tentativa que o Chat chegou a processar vira "duplicata", não mensagem em
 * dobro. Por isso o corpo é montado UMA vez, fora do laço.
 *
 * O que se reenvia e o que não:
 *   - 502 / 503 / 504 e queda de rede RÁPIDA (conexão recusada, DNS): sim — é o sintoma de um deploy;
 *   - TIMEOUT: não. A requisição pode ter sido processada, e uma segunda espera de 10 s estouraria o tempo da
 *     requisição de quem enviou (a espera total do pior caso continua sendo 10 s + 1,6 s, e não 3 × 10 s);
 *   - qualquer 4xx (401 segredo trocado, 404 chat desconhecido, 410 encerrado, 413, 400): não. É definitivo, e
 *     repetir só atrasa o erro que a equipe precisa ver.
 *
 * O que isto NÃO é: uma fila. Se o Chat ficar fora do ar por mais que ~2 s, a mensagem ainda falha, e quem a vê
 * falhada tem o botão "Reenviar". Reenvio durável (`event_log` + worker, como manda a doutrina para efeito
 * externo) fica para quando houver evidência de que a falha longa acontece.
 */
const ESPERAS_ENTRE_TENTATIVAS_MS = [400, 1_200] as const;
const STATUS_PASSAGEIROS = new Set([502, 503, 504]);

/** Queda de rede que volta rápido. O timeout de `AbortSignal.timeout` NÃO entra: ele pode ter sido processado. */
function ehQuedaDeRedeRapida(err: unknown): boolean {
  const nome = err instanceof Error ? err.name : "";
  return nome !== "TimeoutError" && nome !== "AbortError";
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function postarComReenvio(url: string, init: Omit<RequestInit, "signal">): Promise<Response> {
  for (let tentativa = 0; ; tentativa++) {
    const ultima = tentativa >= ESPERAS_ENTRE_TENTATIVAS_MS.length;
    try {
      const resposta = await fetch(url, { ...init, signal: AbortSignal.timeout(PRAZO_DO_ENVIO_MS) });
      if (ultima || !STATUS_PASSAGEIROS.has(resposta.status)) return resposta;
    } catch (err) {
      if (ultima || !ehQuedaDeRedeRapida(err)) throw err;
    }
    await esperar(ESPERAS_ENTRE_TENTATIVAS_MS[tentativa]!);
  }
}

/**
 * ─── Anexo que o CLIENTE mandou: baixar da URL assinada do Chat ──────────────────────────────────────
 *
 * O Chat guarda o arquivo e manda ao CRM só uma URL assinada que vence em 1 h; quem a baixa e guarda no Storage é o
 * worker de mídia (com tentativas), chamando `fetchInboundMedia`. O que se confere antes de buscar:
 *   - o host da URL é o MESMO do endereço do Chat que o operador cadastrou no canal: a URL vem de um payload e vira
 *     requisição do servidor, então o payload não escolhe para onde o servidor vai (nem mesmo um canal comprometido
 *     do mesmo tenant aponta para um host de fora);
 *   - o mesmo anti-SSRF das demais saídas (esquema, https em produção, faixa privada) e, depois, a resolução do DNS;
 *   - NENHUM segredo vai junto: a assinatura da própria URL é a credencial, e redirecionamento é recusado;
 *   - teto de 10 MB, o mesmo do Chat, conferido pelo cabeçalho E pelos bytes lidos (cabeçalho mente ou falta).
 */
const TETO_DO_ANEXO_BYTES = 10 * 1024 * 1024;
const PRAZO_DO_DOWNLOAD_MS = 20_000;

/** Lê o corpo até `teto` bytes; passou disso, cancela a leitura e lança. */
async function lerComTeto(resposta: Response, teto: number): Promise<Buffer> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return Buffer.alloc(0);
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => {});
      throw new Error("chat_externo_media_too_large");
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

type Credenciais = { url: string; segredo: string };

/**
 * A URL de saída passa na MESMA validação anti-SSRF das demais saídas do produto, de novo no envio: o endereço
 * foi validado quando o operador o gravou, mas o banco pode ter sido editado por fora e o DNS pode ter mudado.
 * Este passo é o textual; a resolução do nome (que pega o host público apontando para a rede interna) é feita em
 * `send`, logo antes do fetch.
 */
function urlDeEnvioValida(url: string): boolean {
  try {
    assertSafeOutboundUrl(url);
    return true;
  } catch {
    return false;
  }
}

async function credenciaisDoCanal(organizationId: string, sessionRef: string): Promise<Credenciais | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_sessions")
    .select("chat_externo_url, chat_externo_secret_out_encrypted")
    .eq("organization_id", organizationId)
    .eq("provider", CHANNEL_PROVIDER_CHAT_EXTERNO)
    .eq("chat_externo_ref", sessionRef)
    .is("archived_at", null)
    .maybeSingle();
  const linha = data as { chat_externo_url: string | null; chat_externo_secret_out_encrypted: string | null } | null;
  if (error || !linha?.chat_externo_url || !linha.chat_externo_secret_out_encrypted) return null;
  if (!urlDeEnvioValida(linha.chat_externo_url)) return null;
  const segredo = await decryptWebhookSecret(admin, linha.chat_externo_secret_out_encrypted);
  if (!segredo) return null;
  return { url: linha.chat_externo_url, segredo };
}

export const chatExternoAdapter: ChannelAdapter = {
  provider: CHANNEL_PROVIDER_CHAT_EXTERNO,

  resolveRecipient: (input: RecipientInput) => (input.isGroup ? null : "chat-externo-thread"),

  // A configuração é POR CANAL e mora no banco: não há um "sim" global. `send` é quem confere a linha e falha com
  // `chat_externo_not_configured` — mensagem presa em silêncio seria pior que mensagem marcada como falha.
  isConfigured: () => true,

  async checkHealth(input): Promise<ChannelHealth> {
    const credenciais = await credenciaisDoCanal(input.organizationId, input.sessionRef);
    if (credenciais) return { reachable: true, status: "WORKING", detail: null };
    return { reachable: true, status: "FAILED", detail: "chat_externo_not_configured" };
  },

  /**
   * Avisa o Chat que o atendimento foi encerrado (`conversation.closed`), para ele bloquear o campo de texto e
   * mostrar "Atendimento encerrado". Mesmo endereço, mesma assinatura e mesmo cabeçalho de contrato que a resposta
   * do atendente. LANÇA quando não saiu: quem chama registra e segue (fechar a conversa não pode depender do Chat).
   */
  async notificarEncerramento(input) {
    const credenciais = await credenciaisDoCanal(input.organizationId, input.sessionRef);
    if (!credenciais) throw new Error("chat_externo_not_configured");
    try {
      await assertDestinoResolvidoSeguro(new URL(credenciais.url).hostname);
    } catch {
      throw new Error("chat_externo_destination_blocked");
    }

    const corpo = JSON.stringify({
      event: "conversation.closed",
      identity: input.providerConversationId,
      conversation_id: input.conversationId,
      closed_at: input.closedAt,
      reason: "resolved",
    });
    const resposta = await postarComReenvio(credenciais.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [HEADER_ASSINATURA_DE_ENTRADA]: assinarCorpo(corpo, credenciais.segredo),
        [CABECALHO_DO_CONTRATO]: VERSAO_DO_CONTRATO,
      },
      body: corpo,
    });
    if (!resposta.ok) throw new Error(`chat_externo_close_notice_failed_${resposta.status}`);
  },

  /** Baixa o anexo que o cliente mandou, pela URL assinada do Chat. Ver o bloco "Anexo que o CLIENTE mandou". */
  async fetchInboundMedia(input): Promise<FetchedMedia> {
    const credenciais = await credenciaisDoCanal(input.organizationId, input.sessionRef);
    if (!credenciais) throw new Error("chat_externo_not_configured");

    let alvo: URL;
    try {
      alvo = new URL(input.url);
    } catch {
      throw new Error("chat_externo_media_url_invalid");
    }
    if (alvo.host !== new URL(credenciais.url).host || !urlDeEnvioValida(input.url)) {
      throw new Error("chat_externo_media_host_blocked");
    }
    try {
      await assertDestinoResolvidoSeguro(alvo.hostname);
    } catch {
      throw new Error("chat_externo_destination_blocked");
    }

    const resposta = await fetch(input.url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(PRAZO_DO_DOWNLOAD_MS),
    });
    // 403 = assinatura que não confere, 404 = arquivo apagado (retenção/LGPD), 410 = link vencido: o status no erro
    // é o que o worker registra e o que separa as três para quem for investigar.
    if (!resposta.ok) throw new Error(`chat_externo_media_failed_${resposta.status}`);
    if (Number(resposta.headers.get("content-length") ?? 0) > TETO_DO_ANEXO_BYTES) {
      throw new Error("chat_externo_media_too_large");
    }

    const buffer = await lerComTeto(resposta, TETO_DO_ANEXO_BYTES);
    // O tipo que o Chat declarou ao SERVIR (ele o confere pelos bytes) manda sobre a dica do webhook.
    const mime =
      resposta.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
      input.hintMime ||
      "application/octet-stream";
    return { buffer, mime };
  },

  codes: {
    notConfigured: "chat_externo_not_configured",
    sendFailed: "chat_externo_send_failed",
    unknownError: "chat_externo_unknown_error",
  },

  async send(envelope: OutboundEnvelope) {
    const identity = envelope.providerConversationId;
    if (!identity) return { externalId: null };

    const credenciais = await credenciaisDoCanal(envelope.organizationId, envelope.sessionRef);
    if (!credenciais) throw new Error("chat_externo_not_configured");

    // Guard textual não resolve nome: um host público que aponte para a rede interna (ou para o metadata da
    // nuvem) passaria por ele. Este segundo resolve o nome e julga o IP.
    try {
      await assertDestinoResolvidoSeguro(new URL(credenciais.url).hostname);
    } catch {
      throw new Error("chat_externo_destination_blocked");
    }

    await envelope.beforeSend?.();

    const corpo = JSON.stringify({
      event: "message",
      identity,
      conversation_id: envelope.conversationId ?? null,
      message_id: envelope.messageId ?? null,
      // Anexo sem `body`: a legenda do envelope é o texto. O Chat aceita mensagem só de anexo (texto vazio).
      text: envelope.body || envelope.media?.caption || "",
      sent_at: new Date().toISOString(),
      author: {
        kind: envelope.authorKind ?? "agent",
        name: envelope.authorName ?? null,
      },
      // A URL é a assinada do Storage (vale 10 min): o Chat a baixa na hora e guarda a cópia dele. Só entra o campo
      // quando há anexo — mensagem de texto segue idêntica ao que sempre foi. O que o Chat não aceita (áudio, vídeo)
      // ele mostra como anexo indisponível, sem derrubar a mensagem.
      ...(envelope.media
        ? {
            attachments: [
              {
                kind: envelope.kind,
                url: envelope.media.url,
                // Campo sem valor SAI do corpo: o Chat aceita ausente, mas recusa `null` e mostraria
                // o anexo como "indisponível" para o cliente.
                ...(envelope.media.mime ? { mime: envelope.media.mime } : {}),
                ...(envelope.media.filename ? { name: envelope.media.filename } : {}),
              },
            ],
          }
        : {}),
    });

    const resposta = await postarComReenvio(credenciais.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [HEADER_ASSINATURA_DE_ENTRADA]: assinarCorpo(corpo, credenciais.segredo),
        [CABECALHO_DO_CONTRATO]: VERSAO_DO_CONTRATO,
      },
      body: corpo,
    });

    if (!resposta.ok) throw new Error(`chat_externo_send_failed_${resposta.status}`);
    return { externalId: envelope.messageId ?? null };
  },
};
