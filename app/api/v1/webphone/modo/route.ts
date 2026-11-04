/**
 * GET /api/v1/webphone/modo — como esta pessoa usa o telefone (agent+).
 *
 * `navegador` (o CRM é o telefone), `central` (o CRM pede a ligação pela API e o
 * áudio fica na janela da central) ou `null` (sem ramal, ou desligado). Nunca
 * devolve a senha; quem a entrega, e só ao dono, é `/credenciais`.
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { modoDoUsuario } from "@/lib/webphone/servidor";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "user_webphone_ramais" });
  if (!authz.ok) return authz.response;

  // Em acompanhamento administrativo quem olha não é dono de ramal nenhum.
  if (authz.user.support) return ok({ modo: null, ramal: null, painel_url: null }, { requestId });

  const modo = await modoDoUsuario({ admin: createAdminClient(), orgId: authz.org.orgId, userId: authz.user.id });
  return ok(modo, { requestId });
}
