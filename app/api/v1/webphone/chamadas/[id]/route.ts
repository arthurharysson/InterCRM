/**
 * PATCH /api/v1/webphone/chamadas/:id — grava o resultado que a pessoa marcou ao desligar (agent+).
 *
 * Só o resultado, de vocabulário fechado (`RESULTADOS_DA_LIGACAO`). Quem fez a
 * ligação muda a dela; `manager` ou mais muda a de qualquer um da organização.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK } from "@/lib/auth/types";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { resultadoDaChamadaSchema } from "@/lib/webphone/config";
import { marcarResultado } from "@/lib/webphone/chamadas";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const acompanhamentoNegado = await requireSupportWrite();
  if (acompanhamentoNegado) return acompanhamentoNegado;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return fail("validation_failed", "Identificador de ligação inválido.", 422, { requestId });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = resultadoDaChamadaSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }

  const resultado = await marcarResultado({
    admin: createAdminClient(),
    orgId: authz.org.orgId,
    userId: authz.user.id,
    podeEditarAlheias: ROLE_RANK[authz.org.role] >= ROLE_RANK.manager,
    id,
    resultado: parsed.data.resultado,
  });
  if (!resultado.ok) {
    if (resultado.motivo === "nao_encontrada") return fail("not_found", "Ligação não encontrada.", 404, { requestId });
    if (resultado.motivo === "sem_permissao") {
      return fail("forbidden", "Só quem fez a ligação, ou um gerente, muda o resultado dela.", 403, { requestId });
    }
    return fail("internal_error", "Erro ao salvar o resultado.", 500, { requestId, details: resultado.detalhe });
  }
  return ok({ id, resultado: parsed.data.resultado }, { requestId });
}
