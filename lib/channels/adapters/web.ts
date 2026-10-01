/**
 * Adapter do canal `web` — o chat dentro do InterSuite.
 *
 * ─── Por que este adapter não fala com provider nenhum ──────────────────────
 *
 * Os outros adapters traduzem o envelope para a API de uma plataforma (WAHA,
 * Meta, Zernio). Aqui não existe plataforma: o destinatário está com uma aba do
 * InterSuite aberta, e quem entrega é o SSE de lá. O "transporte" é um POST
 * assinado no endpoint de inbound do InterSuite.
 *
 * ─── Por que o endereço não vem do contato ──────────────────────────────────
 *
 * `resolveRecipient` recebe telefone e identidades de WhatsApp — nada disso
 * existe aqui. O endereço é a identidade opaca do widget (`web:<uuid>`), que o
 * ingest grava em `conversations.provider_conversation_id` e volta no envelope.
 * Mesmo padrão do `socialAdapter`.
 */
import { createHmac } from "node:crypto";

import { CHANNEL_PROVIDER_WEB } from "../capabilities";
import type { ChannelAdapter, OutboundEnvelope, RecipientInput } from "../types";

const ENDPOINT = process.env.INTERSUITE_SUPPORT_URL;
const SEGREDO_SAIDA = process.env.INTERSUITE_HMAC_SECRET_IN;

export const webAdapter: ChannelAdapter = {
  provider: CHANNEL_PROVIDER_WEB,

  resolveRecipient: (input: RecipientInput) => (input.isGroup ? null : "web-thread"),

  isConfigured: () => Boolean(ENDPOINT && SEGREDO_SAIDA),

  codes: {
    notConfigured: "web_not_configured",
    sendFailed: "web_send_failed",
    unknownError: "web_unknown_error",
  },

  async send(envelope: OutboundEnvelope) {
    if (!ENDPOINT || !SEGREDO_SAIDA) return { externalId: null };

    const identity = envelope.providerConversationId;
    if (!identity) return { externalId: null };

    await envelope.beforeSend?.();

    const corpo = JSON.stringify({
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

    const assinatura =
      "sha256=" + createHmac("sha256", SEGREDO_SAIDA).update(corpo).digest("hex");

    const resposta = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Crm-Signature": assinatura,
      },
      body: corpo,
    });

    if (!resposta.ok) throw new Error(`web_send_failed_${resposta.status}`);

    return { externalId: envelope.messageId ?? null };
  },
};
