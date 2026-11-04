/**
 * GET /api/v1/webphone/central/ramais — os ramais que a central de telefonia tem (admin).
 *
 * Alimenta a lista de escolha na tela de configuração, para o administrador
 * apontar o ramal de cada atendente sem digitar. `configurada: false` quando o
 * servidor não tem o acesso à central — a tela cai no campo de texto.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ErroDaCentral, lerConfigDaCentral, listarRamaisDaCentral } from "@/lib/fluxo/cliente";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "user_webphone_ramais" });
  if (!authz.ok) return authz.response;

  const config = lerConfigDaCentral();
  if (!config) return ok({ configurada: false, ramais: [] }, { requestId });

  try {
    const ramais = await listarRamaisDaCentral(config);
    return ok({ configurada: true, ramais }, { requestId });
  } catch (e) {
    const mensagem = e instanceof ErroDaCentral ? e.message : "Não foi possível consultar a central.";
    return fail("upstream_unavailable", mensagem, 502, { requestId });
  }
}
