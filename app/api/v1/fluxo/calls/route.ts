/**
 * POST /api/v1/fluxo/calls — click-to-call via Fluxo (omnichannel).
 * GET  /api/v1/fluxo/calls — lista chamadas Fluxo (provider='fluxo') da org.
 *
 * Coexiste com /api/v1/calls (SIP/Asterisk): provider='fluxo' na voice_calls.
 * O Fluxo não tem webhook push — sincronização de histórico é feita via cron
 * (app/api/v1/cron/fluxo-sync-calls).
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  readFluxoConfig,
  originarChamada,
  statusDaChamada,
  encerrarChamada,
} from "@/lib/fluxo/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createFluxoCallSchema = z.object({
  extension: z.string().min(1),
  toNumber: z.string().min(8),
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
});

const listFluxoCallsSchema = z.object({
  direction: z.enum(["outbound", "inbound"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function mapFluxoStatus(status: string, endReason: string | null): string {
  if (status === "connected") return "in_progress";
  if (status !== "ended") return "ringing";
  switch (endReason) {
    case "timeout":
      return "no_answer";
    case "busy":
      return "busy";
    case "failed":
      return "failed";
    case "cancelled":
      return "canceled";
    default:
      return "completed";
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = listFluxoCallsSchema.safeParse(params);
  if (!parsed.success) {
    return fail("validation_failed", "Query inválida.", 422, { requestId, details: parsed.error.flatten() });
  }
  const q = parsed.data;

  const supabase = await createClient();
  let query = supabase
    .from("voice_calls")
    .select("id, direction, status, end_reason, peer_phone, handled_by, started_at, answered_at, ended_at, duration_ms, transcript")
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "fluxo")
    .order("started_at", { ascending: false })
    .limit(q.limit);

  if (q.direction) query = query.eq("direction", q.direction);

  const { data, error } = await query;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    direction: row.direction,
    status: mapFluxoStatus(row.status, row.end_reason),
    phone: row.peer_phone,
    handled_by: row.handled_by,
    started_at: row.started_at,
    answered_at: row.answered_at,
    ended_at: row.ended_at,
    duration_seconds: row.duration_ms != null ? Math.round(row.duration_ms / 1000) : null,
    transcript: row.transcript,
  }));

  return ok(rows, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const acompanhamentoNegado = await requireSupportWrite();
  if (acompanhamentoNegado) return acompanhamentoNegado;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const config = readFluxoConfig();
  if (!config) {
    return fail(
      "fluxo_not_configured",
      "Integração Fluxo não configurada. Defina FLUXO_API_URL e FLUXO_API_TOKEN.",
      422,
      { requestId },
    );
  }

  let input;
  try {
    const body = await req.json();
    input = createFluxoCallSchema.parse(body);
  } catch {
    return fail("validation_failed", "Body inválido.", 422, { requestId });
  }

  const supabase = await createClient();
  const crmId = randomUUID();

  const { data: callRow, error: insertError } = await supabase
    .from("voice_calls")
    .insert({
      organization_id: activeOrg.orgId,
      provider: "fluxo",
      direction: "outbound",
      status: "ringing",
      peer_phone: input.toNumber,
      lead_id: input.leadId ?? null,
      contact_id: input.contactId ?? null,
      owner_user_id: authUser.id,
      handled_by: "human",
      started_at: new Date().toISOString(),
      asterisk_channel_id: crmId,
    })
    .select("id")
    .single();

  if (insertError || !callRow) {
    return fail("internal_error", insertError?.message ?? "failed_to_create_call", 500, { requestId });
  }

  try {
    const result = await originarChamada(config, {
      extension: input.extension,
      phone: input.toNumber,
      crmId,
    });

    await audit({
      action: "call.created",
      actorUserId: authUser.id,
      organizationId: activeOrg.orgId,
      resourceType: "voice_calls",
      resourceId: callRow.id,
      requestId,
      metadata: {
        direction: "outbound",
        extension: input.extension,
        to_number: input.toNumber,
        crm_id: crmId,
      },
    });

    return ok({ callId: callRow.id, crmId, fluxoResult: result }, { status: 201, requestId });
  } catch (err) {
    await supabase.from("voice_calls").update({ status: "ended", end_reason: "failed" }).eq("id", callRow.id);
    return fail("originate_failed", err instanceof Error ? err.message : "originate_failed", 502, { requestId });
  }
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const acompanhamentoNegado = await requireSupportWrite();
  if (acompanhamentoNegado) return acompanhamentoNegado;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "voice_calls" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const config = readFluxoConfig();
  if (!config) {
    return fail("fluxo_not_configured", "Integração Fluxo não configurada.", 422, { requestId });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return fail("validation_failed", "Body inválido.", 422, { requestId });
  }

  const callId = z.string().uuid().safeParse(body?.callId);
  if (!callId.success) {
    return fail("validation_failed", "callId inválido.", 422, { requestId });
  }

  const supabase = await createClient();
  const { data: call } = await supabase
    .from("voice_calls")
    .select("id, asterisk_channel_id")
    .eq("id", callId.data)
    .eq("organization_id", activeOrg.orgId)
    .eq("provider", "fluxo")
    .maybeSingle();

  if (!call) {
    return fail("not_found", "Chamada não encontrada.", 404, { requestId });
  }

  try {
    await encerrarChamada(config, call.asterisk_channel_id);
    await supabase
      .from("voice_calls")
      .update({ status: "ended", end_reason: "hangup", ended_at: new Date().toISOString() })
      .eq("id", call.id);

    await audit({
      action: "call.hangup",
      actorUserId: authUser.id,
      organizationId: activeOrg.orgId,
      resourceType: "voice_calls",
      resourceId: call.id,
      requestId,
    });

    return ok({ hungUp: true }, { requestId });
  } catch (err) {
    return fail("hangup_failed", err instanceof Error ? err.message : "hangup_failed", 502, { requestId });
  }
}
