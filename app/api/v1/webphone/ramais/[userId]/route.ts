/**
 * PUT    /api/v1/webphone/ramais/:userId — define o ramal e a senha SIP de um atendente (admin).
 * DELETE /api/v1/webphone/ramais/:userId — remove o ramal dele (admin).
 *
 * `password` é sempre opcional: sem ela o ramal serve ao Click to Call pela
 * central; com ela, também ao telefone no navegador. Numa atualização, omitir
 * mantém a senha cifrada que já existe. A senha nunca é devolvida.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { ramalDoUsuarioSchema } from "@/lib/webphone/config";
import { guardarRamal, removerRamal, type ResultadoDeEscrita } from "@/lib/webphone/servidor";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

type Contexto = { params: Promise<{ userId: string }> };

function recusa(r: Extract<ResultadoDeEscrita, { ok: false }>, requestId: string): Response {
  switch (r.motivo) {
    case "usuario_fora_da_organizacao":
      return fail("not_found", "Esta pessoa não é membro ativo da organização.", 404, { requestId });
    case "ramal_em_uso":
      return fail("state_conflict", "Este ramal já está em uso por outra pessoa da organização.", 409, { requestId });
    default:
      return fail("internal_error", "Erro ao salvar o ramal.", 500, { requestId, details: r.detalhe });
  }
}

export async function PUT(req: NextRequest, ctx: Contexto): Promise<Response> {
  const acompanhamentoNegado = await requireSupportWrite();
  if (acompanhamentoNegado) return acompanhamentoNegado;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "user_webphone_ramais" });
  if (!authz.ok) return authz.response;

  const { userId } = await ctx.params;
  if (!idSchema.safeParse(userId).success) {
    return fail("validation_failed", "Identificador de usuário inválido.", 422, { requestId });
  }

  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = ramalDoUsuarioSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }

  const resultado = await guardarRamal({
    admin: createAdminClient(),
    orgId: authz.org.orgId,
    atorId: authz.user.id,
    usuarioId: userId,
    ramal: parsed.data,
  });
  if (!resultado.ok) return recusa(resultado, requestId);
  return ok({ user_id: userId, ramal: parsed.data.ramal, is_active: parsed.data.is_active }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const acompanhamentoNegado = await requireSupportWrite();
  if (acompanhamentoNegado) return acompanhamentoNegado;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "user_webphone_ramais" });
  if (!authz.ok) return authz.response;

  const { userId } = await ctx.params;
  if (!idSchema.safeParse(userId).success) {
    return fail("validation_failed", "Identificador de usuário inválido.", 422, { requestId });
  }

  const resultado = await removerRamal({
    admin: createAdminClient(),
    orgId: authz.org.orgId,
    atorId: authz.user.id,
    usuarioId: userId,
  });
  if (!resultado.ok) return recusa(resultado, requestId);
  return ok({ user_id: userId, removido: true }, { requestId });
}
