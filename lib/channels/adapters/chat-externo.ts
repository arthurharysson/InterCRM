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
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";
import { HEADER_ASSINATURA_DE_ENTRADA } from "@/lib/webhooks/assinatura";

import { assinarCorpo } from "../chat-externo/contrato";
import { CHANNEL_PROVIDER_CHAT_EXTERNO } from "../capabilities";
import type { ChannelAdapter, ChannelHealth, OutboundEnvelope, RecipientInput } from "../types";

/** A versão do contrato que o CRM fala. O Chat confere. */
export const CABECALHO_DO_CONTRATO = "x-chat-contract";
export const VERSAO_DO_CONTRATO = "2";
const PRAZO_DO_ENVIO_MS = 10_000;

type Credenciais = { url: string; segredo: string };

/**
 * A URL de saída precisa ser http(s) de verdade. A validação que impede endereço interno (SSRF) é da TELA que
 * grava o canal, onde o operador digita o endereço; aqui só se recusa o que nem é URL de web.
 */
function urlDeEnvioValida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
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

    await envelope.beforeSend?.();

    const corpo = JSON.stringify({
      event: "message",
      identity,
      conversation_id: envelope.conversationId ?? null,
      message_id: envelope.messageId ?? null,
      text: envelope.body ?? "",
      sent_at: new Date().toISOString(),
      author: {
        kind: envelope.authorKind ?? "agent",
        name: envelope.authorName ?? null,
      },
    });

    const resposta = await fetch(credenciais.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [HEADER_ASSINATURA_DE_ENTRADA]: assinarCorpo(corpo, credenciais.segredo),
        [CABECALHO_DO_CONTRATO]: VERSAO_DO_CONTRATO,
      },
      body: corpo,
      signal: AbortSignal.timeout(PRAZO_DO_ENVIO_MS),
    });

    if (!resposta.ok) throw new Error(`chat_externo_send_failed_${resposta.status}`);
    return { externalId: envelope.messageId ?? null };
  },
};
