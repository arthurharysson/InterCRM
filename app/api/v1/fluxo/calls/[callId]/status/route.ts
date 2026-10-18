/**
 * GET /api/v1/fluxo/calls/:callId/status — consulta o status atual de uma
 * chamada Fluxo pelo crm_id (armazenado em asterisk_channel_id).
 *
 * Faz dois passos:
 * 1. Busca a linha em voice_calls para validar ownership e pegar o crm_id
 * 2. Consulta a API do Fluxo (POST /call/exten com crm_id)
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { readFluxoConfig, statusDaChamada } from "@/lib/fluxo/client";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ callId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const { callId } = await params;

  const config = readFluxoConfig();
  if (!config) {
    return fail("fluxo_not_configured", "Integração Fluxo não configurada.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data: call } = await supabase
    .from("voice_calls")
    .select("id, asterisk_channel_id, status, end_reason")
    .eq("id", callId)
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "fluxo")
    .maybeSingle();

  if (!call) {
    return fail("not_found", "Chamada não encontrada.", 404, { requestId });
  }

  try {
    const fluxoStatus = await statusDaChamada(config, call.asterisk_channel_id);
    return ok({ callId: call.id, localStatus: call.status, fluxoStatus }, { requestId });
  } catch (err) {
    return ok(
      { callId: call.id, localStatus: call.status, fluxoStatus: null, error: err instanceof Error ? err.message : "unknown" },
      { requestId },
    );
  }
}
