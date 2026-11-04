/**
 * POST /api/v1/webphone/central/ligar — pede à central que toque o ramal da pessoa
 * e ligue ao número (Click to Call). agent+.
 *
 * O ramal vem do CADASTRO de quem está logado, nunca do corpo: ninguém liga
 * pelo ramal de outra pessoa. `crm_id` é gerado no navegador e é o nome da
 * ligação dos dois lados — com ele o CRM consulta o andamento, desliga e, no
 * fim, grava a ligação com o mesmo id.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ErroDaCentral, ligarPeloRamal, lerConfigDaCentral } from "@/lib/fluxo/cliente";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { ligarPelaCentralSchema, telefoneParaCentral } from "@/lib/webphone/config";
import { modoDoUsuario } from "@/lib/webphone/servidor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const acompanhamentoNegado = await requireSupportWrite();
  if (acompanhamentoNegado) return acompanhamentoNegado;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = ligarPelaCentralSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }
  const telefone = telefoneParaCentral(parsed.data.telefone);
  if (!telefone) return fail("validation_failed", "Esse número não dá para discar.", 422, { requestId });

  const config = lerConfigDaCentral();
  if (!config) {
    return fail("upstream_unavailable", "A central de telefonia não está configurada neste servidor.", 503, { requestId });
  }

  const modo = await modoDoUsuario({ admin: createAdminClient(), orgId: authz.org.orgId, userId: authz.user.id });
  if (!modo.modo || !modo.ramal) {
    return fail("forbidden", "Você não tem um ramal ativo. Peça a um administrador.", 403, { requestId });
  }

  try {
    await ligarPeloRamal(config, { ramal: modo.ramal, telefone, crmId: parsed.data.crm_id });
  } catch (e) {
    const mensagem = e instanceof ErroDaCentral ? e.message : "Não foi possível pedir a ligação.";
    return fail("upstream_unavailable", mensagem, 502, { requestId });
  }

  await audit({
    action: "webphone.click_to_call",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "voice_calls",
    resourceId: parsed.data.crm_id,
    // Sem o número do cliente: o log de auditoria não é lugar de telefone.
    metadata: { ramal: modo.ramal },
  });
  return ok({ crm_id: parsed.data.crm_id, ramal: modo.ramal }, { status: 201, requestId });
}
