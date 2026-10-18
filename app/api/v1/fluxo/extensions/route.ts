/**
 * GET /api/v1/fluxo/extensions — lista os ramais disponíveis no Fluxo.
 *
 * Proxy thin: o CRM não armazena ramais — busca direto na API do Fluxo.
 * Autenticação: sessão do CRM (cookie) com papel mínimo agent.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { readFluxoConfig, listarRamais } from "@/lib/fluxo/client";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "fluxo_extensions" });
  if (!authz.ok) return authz.response;

  const config = readFluxoConfig();
  if (!config) {
    return fail(
      "fluxo_not_configured",
      "Integração Fluxo não configurada. Defina FLUXO_API_URL e FLUXO_API_TOKEN.",
      422,
      { requestId },
    );
  }

  try {
    const ramais = await listarRamais(config);
    return ok(ramais, { requestId });
  } catch (err) {
    return fail("fluxo_api_error", err instanceof Error ? err.message : "falha ao listar ramais", 502, { requestId });
  }
}
