/**
 * GET /api/v1/webphone/central/status?crm_id=<uuid> — em que pé está a ligação pedida (agent+).
 *
 * A central não avisa o CRM: quem pergunta é o cartão da tela, de poucos em
 * poucos segundos, enquanto a ligação existe. `desconhecida` nos primeiros
 * instantes (a central ainda não registrou) e quando a central está fora do ar.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ErroDaCentral, consultarLigacao, lerConfigDaCentral } from "@/lib/fluxo/cliente";
import { consultarLigacaoSchema } from "@/lib/webphone/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;

  const parsed = consultarLigacaoSchema.safeParse({ crm_id: req.nextUrl.searchParams.get("crm_id") });
  if (!parsed.success) return fail("validation_failed", "Informe o crm_id.", 422, { requestId });

  const config = lerConfigDaCentral();
  if (!config) {
    return fail("upstream_unavailable", "A central de telefonia não está configurada neste servidor.", 503, { requestId });
  }

  try {
    return ok(await consultarLigacao(config, parsed.data.crm_id), { requestId });
  } catch (e) {
    const mensagem = e instanceof ErroDaCentral ? e.message : "Não foi possível consultar a ligação.";
    return fail("upstream_unavailable", mensagem, 502, { requestId });
  }
}
