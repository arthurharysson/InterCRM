/**
 * GET /api/v1/webphone/quem-e?numero=<digitos> — quem é o contato de um número (agent+).
 *
 * Alimenta o "Fulano está ligando" do webphone. Reaproveita a busca
 * anti-duplicação do WhatsApp (`encontrarContatoPorTelefoneComNome`): variantes
 * com e sem o nono dígito, contato fundido nunca é alvo. Lê com o client DA
 * SESSÃO, então a RLS vale também; o `organization_id` vem da sessão, nunca da
 * query. Número desconhecido não é erro: devolve `null`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { encontrarContatoPorTelefoneComNome } from "@/lib/channels/contato-por-telefone";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({ numero: z.string().regex(/^[0-9]{4,20}$/) });

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;

  const parsed = querySchema.safeParse({ numero: req.nextUrl.searchParams.get("numero") });
  if (!parsed.success) {
    return fail("validation_failed", "Informe o número só com dígitos (4 a 20).", 422, { requestId });
  }

  const supabase = await createClient();
  const contato = await encontrarContatoPorTelefoneComNome(supabase, authz.org.orgId, parsed.data.numero);
  return ok(contato ? { contact_id: contato.id, nome: contato.name } : null, { requestId });
}
