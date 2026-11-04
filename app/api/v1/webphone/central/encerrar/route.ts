/**
 * POST /api/v1/webphone/central/encerrar — desliga a ligação pedida pelo CRM (agent+).
 *
 * O `crm_id` é um UUID gerado no navegador de quem ligou, então não dá para
 * adivinhar o de outra pessoa; a organização inteira usa a mesma central, e
 * quem tem o id é quem pediu a ligação.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ErroDaCentral, desligarPeloCrmId, lerConfigDaCentral } from "@/lib/fluxo/cliente";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { consultarLigacaoSchema } from "@/lib/webphone/config";

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
  const parsed = consultarLigacaoSchema.safeParse(corpo);
  if (!parsed.success) return fail("validation_failed", "Informe o crm_id.", 422, { requestId });

  const config = lerConfigDaCentral();
  if (!config) {
    return fail("upstream_unavailable", "A central de telefonia não está configurada neste servidor.", 503, { requestId });
  }

  try {
    await desligarPeloCrmId(config, parsed.data.crm_id);
  } catch (e) {
    const mensagem = e instanceof ErroDaCentral ? e.message : "Não foi possível desligar.";
    return fail("upstream_unavailable", mensagem, 502, { requestId });
  }

  await audit({
    action: "webphone.click_to_call_hangup",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "voice_calls",
    resourceId: parsed.data.crm_id,
  });
  return ok({ crm_id: parsed.data.crm_id, desligada: true }, { requestId });
}
