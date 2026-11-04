/**
 * GET /api/v1/webphone/settings — servidor SIP-sobre-WebSocket da organização ativa (admin).
 * PUT /api/v1/webphone/settings — cria ou atualiza (admin). Uma linha por organização.
 *
 * O endereço do servidor não é segredo; a senha de cada ramal mora em
 * `/api/v1/webphone/ramais` e nunca passa por aqui.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { configuracaoDoWebphoneSchema } from "@/lib/webphone/config";
import { guardarConfiguracao } from "@/lib/webphone/servidor";

export const dynamic = "force-dynamic";

const COLUNAS =
  "organization_id, wss_url, sip_domain, painel_url, dial_prefix, is_active, updated_by, created_at, updated_at";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "org_webphone_settings" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_webphone_settings")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao consultar a configuração do webphone.", 500, { requestId });
  return ok(data ?? null, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  // Guarda de EFEITO do acompanhamento administrativo, antes do RBAC e do
  // client de service role (ver lib/impersonate/support.ts).
  const acompanhamentoNegado = await requireSupportWrite();
  if (acompanhamentoNegado) return acompanhamentoNegado;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "org_webphone_settings" });
  if (!authz.ok) return authz.response;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = configuracaoDoWebphoneSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }

  const admin = createAdminClient();
  const guardado = await guardarConfiguracao({
    admin,
    orgId: authz.org.orgId,
    userId: authz.user.id,
    config: parsed.data,
  });
  if (!guardado.ok) {
    return fail("internal_error", "Erro ao salvar a configuração do webphone.", 500, {
      requestId,
      details: guardado.detalhe,
    });
  }

  const { data: salvo } = await admin
    .from("org_webphone_settings")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .single();
  return ok(salvo, { requestId });
}
