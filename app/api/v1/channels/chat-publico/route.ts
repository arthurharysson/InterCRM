import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET   /api/v1/channels/chat-publico — os canais de chat da organização + o que o Chat precisa para falar com o CRM.
 * POST  /api/v1/channels/chat-publico — cria um canal e devolve os dois segredos UMA vez.
 * PATCH /api/v1/channels/chat-publico — troca o nome, o endereço de saída ou GIRA os segredos.
 *
 * O canal do chat que o bot do WhatsApp abre para o cliente (aplicação separada). O caminho e o corpo não citam o
 * provider nem as colunas dele (`lint:channels`): quem é, como se chamam as colunas e como se cifra moram em
 * `lib/channels/chat-externo/`.
 *
 * ─── Os segredos ──────────────────────────────────────────────────────────────────────────────────
 *
 * Nascem AQUI (256 bits cada) e voltam só na criação ou na rotação, uma vez. Nenhum GET os devolve: a tela sabe
 * que existem, não quais são. Sem a cifra da instalação a rota RECUSA — guardar segredo em claro seria pior.
 *
 *   `secret_to_crm`   o Chat assina com ele o que ENVIA ao CRM   → no Chat App: CRM_SECRET_TO_CRM
 *   `secret_from_crm` o CRM assina com ele o que ENVIA ao Chat   → no Chat App: CRM_SECRET_FROM_CRM
 *
 * ─── Quem pode ────────────────────────────────────────────────────────────────────────────────────
 *
 * `admin`: o canal decide para onde as respostas dos atendentes são enviadas e entrega as chaves de assinatura.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  atualizarCanalDoChat,
  criarCanalDoChat,
  gerarCredenciaisDoChat,
  gerarSegredoDoChat,
  listarCanaisDoChat,
  validarEnderecoDeSaida,
} from "@/lib/channels/chat-externo/session";
import { traduzirLimiteDoPlano } from "@/lib/cobranca/limites";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { basePublicaDaInstalacao } from "@/lib/webhooks/url-publica";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RECURSO = "channels_chat";
const REF_PADRAO = "principal";

const criarSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  outbound_url: z.string().trim().min(1).max(2000),
  /** Opcional: o identificador do canal na organização. Minúsculo, sem espaço. */
  ref: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
    .optional(),
});

const alterarSchema = z
  .object({
    channel_session_id: z.string().uuid(),
    display_name: z.string().trim().min(1).max(80).optional(),
    outbound_url: z.string().trim().min(1).max(2000).optional(),
    /** Gira os DOIS segredos e os devolve uma vez. */
    rotate_secrets: z.boolean().optional(),
  })
  .refine((v) => v.display_name !== undefined || v.outbound_url !== undefined || v.rotate_secrets === true, {
    message: "nada a alterar",
  });

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: RECURSO });
  if (!authz.ok) return authz.response;

  const base = basePublicaDaInstalacao(req);
  let canais;
  try {
    canais = await listarCanaisDoChat(createAdminClient(), authz.org.orgId);
  } catch {
    return fail("internal_error", "list_failed", 500, { requestId });
  }

  return ok(
    canais.map((c) => ({
      channel_session_id: c.id,
      ref: c.ref,
      display_name: c.displayName,
      outbound_url: c.enderecoDeSaida,
      status: c.status,
      // O que o Chat chama para entregar mensagens ao CRM. O segredo NÃO vem aqui.
      inbound_url: c.webhookPathToken ? `${base}/api/v1/webhooks/channel/${c.webhookPathToken}` : null,
      has_secret_to_crm: c.temSegredoDeEntrada,
      has_secret_from_crm: c.temSegredoDeSaida,
    })),
    { requestId },
  );
}

function motivoDoEndereco(motivo: "invalido" | "esquema" | "https" | "privado" | "ipv6", t: (s: string) => string): string {
  switch (motivo) {
    case "https":
      return t("O endereço do chat precisa começar com https://.");
    case "privado":
      return t("O endereço do chat não pode ser de uma rede interna.");
    case "ipv6":
      return t("O endereço do chat não pode ser um IPv6 literal; use o nome do domínio.");
    default:
      return t("O endereço do chat precisa ser uma URL válida (https://…).");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: RECURSO });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const parsed = criarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", t("Informe o nome do canal e o endereço do chat."), 422, { requestId });
  }
  const endereco = validarEnderecoDeSaida(parsed.data.outbound_url);
  if (!endereco.ok) {
    return fail("invalid_request", motivoDoEndereco(endereco.motivo, t), 422, { requestId });
  }

  const admin = createAdminClient();
  const credenciais = gerarCredenciaisDoChat();
  const entradaCifrada = await encryptWebhookSecret(admin, credenciais.segredoDeEntrada);
  const saidaCifrada = await encryptWebhookSecret(admin, credenciais.segredoDeSaida);
  if (!entradaCifrada || !saidaCifrada) {
    // Sem a cifra, gravar o segredo em claro seria pior que recusar.
    return fail(
      "invalid_request",
      t("cifra indisponível nesta instalação — a chave não foi gravada"),
      422,
      { requestId },
    );
  }

  const { error, code, id } = await criarCanalDoChat(admin, {
    organizationId: orgId,
    ref: parsed.data.ref ?? REF_PADRAO,
    displayName: parsed.data.display_name,
    enderecoDeSaida: endereco.url,
    webhookPathToken: credenciais.webhookPathToken,
    segredoDeEntradaCifrado: entradaCifrada,
    segredoDeSaidaCifrado: saidaCifrada,
  });
  if (error || !id) {
    // Índice único parcial (organização + referência): já existe um canal ativo com este identificador.
    if (code === "23505") {
      return fail("state_conflict", t("Já existe um canal com esse identificador."), 409, { requestId });
    }
    // O limite de canais do plano chega como mensagem do banco, e é ela que carrega o limite.
    const limite = error ? traduzirLimiteDoPlano(error, authz.user.idioma) : null;
    if (limite) return fail(limite.code, limite.message, 409, { requestId, details: limite.details });
    return fail("internal_error", error ?? "insert_failed", 500, { requestId });
  }

  void audit({
    action: "channel.connected",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { canal: "chat_publico", etapa: "criado" },
  });

  return ok(
    {
      channel_session_id: id,
      ref: parsed.data.ref ?? REF_PADRAO,
      display_name: parsed.data.display_name,
      outbound_url: endereco.url,
      inbound_url: `${basePublicaDaInstalacao(req)}/api/v1/webhooks/channel/${credenciais.webhookPathToken}`,
      // MOSTRADOS UMA VEZ: depois só existe o cifrado.
      secret_to_crm: credenciais.segredoDeEntrada,
      secret_from_crm: credenciais.segredoDeSaida,
    },
    { requestId, status: 201 },
  );
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: RECURSO });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const parsed = alterarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", t("Informe o que alterar neste canal."), 422, { requestId });
  }
  const { channel_session_id: id, display_name, outbound_url, rotate_secrets } = parsed.data;

  let enderecoNovo: string | undefined;
  if (outbound_url !== undefined) {
    const endereco = validarEnderecoDeSaida(outbound_url);
    if (!endereco.ok) return fail("invalid_request", motivoDoEndereco(endereco.motivo, t), 422, { requestId });
    enderecoNovo = endereco.url;
  }

  const admin = createAdminClient();
  let segredoDeEntrada: string | undefined;
  let segredoDeSaida: string | undefined;
  let entradaCifrada: string | undefined;
  let saidaCifrada: string | undefined;
  if (rotate_secrets) {
    segredoDeEntrada = gerarSegredoDoChat();
    segredoDeSaida = gerarSegredoDoChat();
    const [e, s] = [await encryptWebhookSecret(admin, segredoDeEntrada), await encryptWebhookSecret(admin, segredoDeSaida)];
    if (!e || !s) {
      return fail(
        "invalid_request",
        t("cifra indisponível nesta instalação — a chave não foi gravada"),
        422,
        { requestId },
      );
    }
    entradaCifrada = e;
    saidaCifrada = s;
  }

  const { error, achou } = await atualizarCanalDoChat(admin, {
    organizationId: orgId,
    id,
    displayName: display_name,
    enderecoDeSaida: enderecoNovo,
    segredoDeEntradaCifrado: entradaCifrada,
    segredoDeSaidaCifrado: saidaCifrada,
  });
  if (error) return fail("internal_error", error, 500, { requestId });
  if (!achou) return fail("not_found", t("Canal não encontrado."), 404, { requestId });

  void audit({
    action: "channel.connected",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: {
      canal: "chat_publico",
      etapa: rotate_secrets ? "segredos_girados" : "alterado",
      campos: [
        display_name !== undefined ? "nome" : null,
        outbound_url !== undefined ? "endereco" : null,
        rotate_secrets ? "segredos" : null,
      ].filter(Boolean),
    },
  });

  return ok(
    {
      channel_session_id: id,
      ...(enderecoNovo ? { outbound_url: enderecoNovo } : {}),
      // Só na rotação, e UMA vez.
      ...(segredoDeEntrada && segredoDeSaida
        ? { secret_to_crm: segredoDeEntrada, secret_from_crm: segredoDeSaida }
        : {}),
    },
    { requestId },
  );
}
