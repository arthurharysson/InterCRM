/**
 * Persistência do canal Chat externo — do lado de dentro do seam.
 *
 * A rota e a tela não podem nomear o provider nem as colunas dele (invariante 1 de
 * `docs/doctrine/restricao-de-canal.md`, vigiado por `lint:channels`): elas falam em "o canal", "o endereço do
 * chat" e "os segredos". A leitura e a escrita moram aqui. Toda consulta leva `organization_id` À MÃO: o client
 * é de service role e ignora a RLS.
 *
 * ─── Os dois segredos ───────────────────────────────────────────────────────────────────────────
 *
 *   entrada (Chat → CRM): `webhook_secret_encrypted`, que a rota de webhook por token já decifra e entrega à entrada;
 *   saída   (CRM → Chat): `chat_externo_secret_out_encrypted`, lido pelo adapter.
 *
 * Os dois NASCEM AQUI (aleatórios, 256 bits) e são mostrados UMA vez, na criação: depois só existe o cifrado, e
 * nenhum GET os devolve. Quem perdeu um, gira (`rotacionar`).
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";

import { CHANNEL_PROVIDER_CHAT_EXTERNO } from "../capabilities";

export interface CanalDoChat {
  id: string;
  /** Identificador do canal dentro da organização (a "referência" da sessão). */
  ref: string;
  displayName: string | null;
  /** Para onde o CRM envia as respostas do atendente. */
  enderecoDeSaida: string | null;
  status: string | null;
  /** O que compõe o endereço de entrada que o Chat chama: `/api/v1/webhooks/channel/<token>`. */
  webhookPathToken: string | null;
  temSegredoDeEntrada: boolean;
  temSegredoDeSaida: boolean;
  createdAt: string | null;
}

const COLUNAS =
  "id, chat_externo_ref, chat_externo_url, display_name, status, webhook_path_token, webhook_secret_encrypted, chat_externo_secret_out_encrypted, created_at";

function paraCanal(linha: Record<string, unknown>): CanalDoChat {
  return {
    id: linha.id as string,
    ref: (linha.chat_externo_ref as string) ?? "",
    displayName: (linha.display_name as string) ?? null,
    enderecoDeSaida: (linha.chat_externo_url as string) ?? null,
    status: (linha.status as string) ?? null,
    webhookPathToken: (linha.webhook_path_token as string) ?? null,
    temSegredoDeEntrada: Boolean(linha.webhook_secret_encrypted),
    temSegredoDeSaida: Boolean(linha.chat_externo_secret_out_encrypted),
    createdAt: (linha.created_at as string) ?? null,
  };
}

/** Os canais ATIVOS da organização, do mais antigo ao mais novo. LANÇA se a consulta falhar. */
export async function listarCanaisDoChat(admin: SupabaseClient, organizationId: string): Promise<CanalDoChat[]> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("provider", CHANNEL_PROVIDER_CHAT_EXTERNO)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error("chat_externo_list_failed");
  return ((data ?? []) as Array<Record<string, unknown>>).map(paraCanal);
}

export interface CredenciaisNovas {
  webhookPathToken: string;
  /** Chat → CRM. No Chat App: `CRM_SECRET_TO_CRM`. */
  segredoDeEntrada: string;
  /** CRM → Chat. No Chat App: `CRM_SECRET_FROM_CRM`. */
  segredoDeSaida: string;
}

/** 192 bits para o caminho e 256 para cada segredo, de fonte criptográfica. Hex: sem caractere que a URL estrague. */
export function gerarCredenciaisDoChat(): CredenciaisNovas {
  return {
    webhookPathToken: randomBytes(24).toString("hex"),
    segredoDeEntrada: randomBytes(32).toString("hex"),
    segredoDeSaida: randomBytes(32).toString("hex"),
  };
}

export function gerarSegredoDoChat(): string {
  return randomBytes(32).toString("hex");
}

/**
 * O endereço de saída precisa passar na MESMA validação anti-SSRF das demais saídas do produto (esquema, https em
 * produção, sem host privado nem literal IPv6). A resolução de DNS acontece no envio, no adapter.
 */
export function validarEnderecoDeSaida(
  valor: string,
): { ok: true; url: string } | { ok: false; motivo: "invalido" | "esquema" | "https" | "privado" | "ipv6" } {
  const url = valor.trim();
  try {
    assertSafeOutboundUrl(url);
  } catch (err) {
    const codigo = err instanceof Error ? err.message : "";
    if (codigo.endsWith("scheme")) return { ok: false, motivo: "esquema" };
    if (codigo.endsWith("https_required")) return { ok: false, motivo: "https" };
    if (codigo.endsWith("private_host")) return { ok: false, motivo: "privado" };
    if (codigo.endsWith("ipv6_literal")) return { ok: false, motivo: "ipv6" };
    return { ok: false, motivo: "invalido" };
  }
  return { ok: true, url };
}

export async function criarCanalDoChat(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    ref: string;
    displayName: string;
    enderecoDeSaida: string;
    webhookPathToken: string;
    segredoDeEntradaCifrado: string;
    segredoDeSaidaCifrado: string;
  },
): Promise<{ error: string | null; code: string | null; id: string | null }> {
  const { data, error } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: input.organizationId,
      provider: CHANNEL_PROVIDER_CHAT_EXTERNO,
      chat_externo_ref: input.ref,
      chat_externo_url: input.enderecoDeSaida,
      chat_externo_secret_out_encrypted: input.segredoDeSaidaCifrado,
      webhook_path_token: input.webhookPathToken,
      webhook_secret_encrypted: input.segredoDeEntradaCifrado,
      display_name: input.displayName,
      status: "WORKING",
      archived_at: null,
      metadata: metadataInicialDoCanal(),
    })
    .select("id")
    .single();
  return {
    error: error?.message ?? null,
    code: error?.code ?? null,
    id: (data as { id: string } | null)?.id ?? null,
  };
}

export async function atualizarCanalDoChat(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    id: string;
    displayName?: string;
    enderecoDeSaida?: string;
    segredoDeEntradaCifrado?: string;
    segredoDeSaidaCifrado?: string;
  },
): Promise<{ error: string | null; achou: boolean }> {
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.enderecoDeSaida !== undefined) patch.chat_externo_url = input.enderecoDeSaida;
  if (input.segredoDeEntradaCifrado !== undefined) patch.webhook_secret_encrypted = input.segredoDeEntradaCifrado;
  if (input.segredoDeSaidaCifrado !== undefined) patch.chat_externo_secret_out_encrypted = input.segredoDeSaidaCifrado;

  const { data, error } = await admin
    .from("channel_sessions")
    .update(patch)
    .eq("organization_id", input.organizationId)
    .eq("id", input.id)
    .eq("provider", CHANNEL_PROVIDER_CHAT_EXTERNO)
    .is("archived_at", null)
    .select("id");
  return { error: error?.message ?? null, achou: Array.isArray(data) && data.length > 0 };
}
