/**
 * GET /api/v1/webphone/ramais — o ramal de cada atendente da organização ativa (admin).
 *
 * Lê pela view segura: a senha SIP (cifrada ou não) nunca sai daqui, só os 4
 * últimos caracteres. A RLS da tabela base vale através da view.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "user_webphone_ramais" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_webphone_ramais_safe")
    .select("organization_id, user_id, ramal, sip_user, secret_last4, is_active, updated_at")
    .eq("organization_id", authz.org.orgId);
  if (error) return fail("internal_error", "Erro ao consultar os ramais.", 500, { requestId });
  return ok(data ?? [], { requestId });
}
