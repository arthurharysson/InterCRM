/**
 * GET  /api/v1/webphone/chamadas?contact_id=<uuid> — as ligações do webphone com um contato (agent+).
 * POST /api/v1/webphone/chamadas                   — registra uma ligação que acabou (agent+).
 *
 * O POST é idempotente pelo `id` que o navegador gera: reenviar a mesma ligação
 * devolve 200 sem duplicar. Quem fez a ligação é a SESSÃO, nunca o corpo, e o
 * contato é achado pelo número no servidor.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { registroDaChamadaSchema } from "@/lib/webphone/config";
import { listarChamadasDoContato, registrarChamada } from "@/lib/webphone/chamadas";

export const dynamic = "force-dynamic";

const listaSchema = z.object({
  contact_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;

  const parsed = listaSchema.safeParse({
    contact_id: req.nextUrl.searchParams.get("contact_id"),
    limit: req.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Informe o contact_id.", 422, { requestId, details: parsed.error.flatten() });
  }

  const resultado = await listarChamadasDoContato({
    supabase: await createClient(),
    orgId: authz.org.orgId,
    contactId: parsed.data.contact_id,
    limite: parsed.data.limit,
  });
  if (!resultado.ok) return fail("internal_error", "Erro ao consultar as ligações.", 500, { requestId });
  return ok(resultado.linhas, { requestId });
}

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
  const parsed = registroDaChamadaSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }

  const resultado = await registrarChamada({
    admin: createAdminClient(),
    orgId: authz.org.orgId,
    userId: authz.user.id,
    corpo: parsed.data,
  });
  if (!resultado.ok) {
    return fail("internal_error", "Erro ao registrar a ligação.", 500, { requestId, details: resultado.detalhe });
  }
  return ok({ id: resultado.id, repetida: resultado.repetida }, { requestId });
}
