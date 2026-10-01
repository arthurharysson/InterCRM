/**
 * Ingestão do canal web: webhook do InterSuite → contato, conversa, mensagem.
 *
 * Segue o mesmo padrão do canal social (social/ingest.ts + zernio/ingest.ts):
 *
 *   1. Resolve contato por `social_identity` (opaque `web:<uuid>`)
 *   2. Resolve conversa por `provider_conversation_id`
 *   3. Insere mensagem com idempotência por `external_id`
 *   4. Chama `aplicarEfeitosPosEntrada` (opt-out → lead → agente)
 *
 * Não há telefone: o identificador é o UUID do widget do InterSuite.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { marcarConversaComMensagem } from "@/lib/channels/marcar-conversa";
import { aplicarEfeitosPosEntrada } from "../pos-entrada";

export interface WebInboundPayload {
  identity: string;
  text: string;
  sent_at?: string;
  message_id?: string;
  sender_name?: string;
}

export interface WebIngestResult {
  status: "ingested" | "duplicate" | "ignored";
  conversationId?: string;
  messageId?: string;
  reason?: string;
}

export function parseWebPayload(raw: string): WebInboundPayload | null {
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (typeof o.identity !== "string" || !o.identity.startsWith("web:")) return null;
  if (typeof o.text !== "string") return null;
  return {
    identity: o.identity,
    text: o.text,
    sent_at: typeof o.sent_at === "string" ? o.sent_at : undefined,
    message_id: typeof o.message_id === "string" ? o.message_id : undefined,
    sender_name: typeof o.sender_name === "string" ? o.sender_name : undefined,
  };
}

export function verifyWebSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function ingestWebInbound(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelSessionId: string;
    payload: WebInboundPayload;
    requestId?: string;
  },
): Promise<WebIngestResult> {
  const { payload } = input;

  const existente = await conversaPelaThread(
    admin,
    input.organizationId,
    payload.identity,
    input.channelSessionId,
  );

  if (existente) {
    const inserted = await insertMessage(admin, {
      organizationId: input.organizationId,
      conversationId: existente.id,
      contactId: existente.contact_id,
      channelSessionId: input.channelSessionId,
      payload,
    });
    if (inserted === "duplicate") return { status: "duplicate", conversationId: existente.id };

    await marcarConversa(admin, input.organizationId, existente.id, payload);
    await efeitosDaEntrada(admin, input, payload, existente.contact_id, existente.id, inserted);
    return { status: "ingested", conversationId: existente.id, messageId: inserted };
  }

  const contactId = await upsertWebContact(admin, input.organizationId, payload);
  if (!contactId) return { status: "ignored", reason: "contato_nao_resolvido" };

  const conversationId = await upsertConversation(admin, {
    organizationId: input.organizationId,
    contactId,
    channelSessionId: input.channelSessionId,
    providerConversationId: payload.identity,
  });
  if (!conversationId) return { status: "ignored", reason: "conversa_nao_resolvida" };

  const inserted = await insertMessage(admin, {
    organizationId: input.organizationId,
    conversationId,
    contactId,
    channelSessionId: input.channelSessionId,
    payload,
  });
  if (inserted === "duplicate") return { status: "duplicate", conversationId };

  await marcarConversa(admin, input.organizationId, conversationId, payload);
  await efeitosDaEntrada(admin, input, payload, contactId, conversationId, inserted);

  return { status: "ingested", conversationId, messageId: inserted };
}

async function conversaPelaThread(
  admin: SupabaseClient,
  organizationId: string,
  providerConversationId: string,
  channelSessionId: string,
): Promise<{ id: string; contact_id: string } | null> {
  const { data } = await admin
    .from("conversations")
    .select("id, contact_id")
    .eq("organization_id", organizationId)
    .eq("channel_session_id", channelSessionId)
    .eq("provider_conversation_id", providerConversationId)
    .maybeSingle();
  const row = data as { id: string; contact_id: string | null } | null;
  return row?.contact_id ? { id: row.id, contact_id: row.contact_id } : null;
}

async function upsertWebContact(
  admin: SupabaseClient,
  organizationId: string,
  payload: WebInboundPayload,
): Promise<string | null> {
  const identity = payload.identity;
  const { data: existing, error: readError } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("social_identity", identity)
    .is("is_merged_into", null)
    .maybeSingle();
  if (readError) throw new Error("web_contact_lookup_failed");
  if (existing) return existing.id as string;

  const nome = payload.sender_name ?? null;
  const { data, error } = await admin
    .from("contacts")
    .insert({
      organization_id: organizationId,
      social_identity: identity,
      name: nome,
      display_name: nome,
      source: "web",
      kind: "person",
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: winner, error: retryError } = await admin
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("social_identity", identity)
      .is("is_merged_into", null)
      .single();
    if (retryError) throw new Error("web_contact_race_failed");
    return (winner as { id: string }).id;
  }
  if (error || !data) throw new Error(`web_contact_insert_failed: ${error?.message ?? "sem id"}`);
  return (data as { id: string }).id;
}

async function upsertConversation(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    contactId: string;
    channelSessionId: string;
    providerConversationId: string;
  },
): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation", {
    p_org: input.organizationId,
    p_contact: input.contactId,
    p_session: input.channelSessionId,
  });
  if (error || !data) return null;
  const conversationId = data as string;

  await admin
    .from("conversations")
    .update({
      provider_conversation_id: input.providerConversationId,
      channel: "web",
    })
    .eq("id", conversationId);

  return conversationId;
}

async function insertMessage(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    conversationId: string;
    contactId: string;
    channelSessionId: string;
    payload: WebInboundPayload;
  },
): Promise<string | "duplicate"> {
  const { payload } = input;
  const externalId = payload.message_id ?? null;

  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      contact_id: input.contactId,
      channel_session_id: input.channelSessionId,
      external_id: externalId,
      direction: "inbound",
      sent_via: "external_device",
      status: "delivered",
      type: "text",
      body: payload.text,
      metadata: { source: "intersuite_web" },
      ...(payload.sent_at ? { sent_at: payload.sent_at } : {}),
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") return "duplicate";
  if (error || !data) throw new Error(`web_ingest_insert_failed: ${error?.message ?? "sem id"}`);
  return (data as { id: string }).id;
}

async function marcarConversa(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  payload: WebInboundPayload,
): Promise<void> {
  await marcarConversaComMensagem(admin, {
    organizationId,
    conversationId,
    direction: "inbound",
    preview: (payload.text ?? "").slice(0, 200),
    at: payload.sent_at ?? new Date().toISOString(),
    canal: "web",
  });
}

async function efeitosDaEntrada(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; requestId?: string },
  payload: WebInboundPayload,
  contactId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await aplicarEfeitosPosEntrada(admin, {
    organizationId: input.organizationId,
    contactId,
    conversationId,
    messageId,
    channelSessionId: input.channelSessionId,
    texto: payload.text,
    nomeDoContato: payload.sender_name ?? null,
    requestId: input.requestId,
    origem: "web_webhook",
  });
}
