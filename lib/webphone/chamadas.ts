/**
 * Registro das ligações do webphone — o miolo do servidor, sem HTTP.
 *
 * Cada ligação vira uma linha de `voice_calls` com `provider = 'sip'` e
 * `handled_by = 'human'`: a tabela que a ficha do contato, a métrica do
 * atendente (`owner_user_id`) e a cascata da LGPD (`peer_phone`) já conhecem.
 * Nenhuma tabela nova — e nenhum texto livre: o único dado que a pessoa
 * acrescenta é o RESULTADO, de vocabulário fechado, em `metadata.resultado`.
 * Texto livre ficaria no `metadata` depois de o contato ser anonimizado.
 *
 * O client é o de service role, que ignora a RLS: toda consulta filtra
 * `organization_id` na mão, e o `orgId`/`userId` vêm da sessão validada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { encontrarContatoPorTelefoneComNome } from "@/lib/channels/contato-por-telefone";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  RESULTADOS_DA_LIGACAO,
  numeroParaDiscar,
  type LigacaoDoHistorico,
  type RegistroDaChamadaCorpo,
  type ResultadoDaLigacao,
} from "./config";

type Admin = ReturnType<typeof createAdminClient>;

/** Marca, em `metadata`, as linhas que nasceram neste telefone (e não no Asterisk de IA). */
export const ORIGEM_DO_WEBPHONE = "webphone";

export type ResultadoDeRegistrar = { ok: true; id: string; repetida: boolean } | { ok: false; detalhe: string };

export async function registrarChamada(p: {
  admin: Admin;
  orgId: string;
  userId: string;
  corpo: RegistroDaChamadaCorpo;
}): Promise<ResultadoDeRegistrar> {
  const { corpo } = p;
  const digitos = numeroParaDiscar(corpo.numero);
  const numero = digitos.length > 0 ? digitos : "anonimo";

  // Só LIGA ao contato que já existe; criar ficha a partir de um telefone que
  // tocou é decisão da pessoa (botão "Criar contato"), não efeito colateral.
  let contactId: string | null = null;
  if (digitos.length >= 4) {
    try {
      const contato = await encontrarContatoPorTelefoneComNome(p.admin as unknown as SupabaseClient, p.orgId, digitos);
      contactId = contato?.id ?? null;
    } catch {
      contactId = null;
    }
  }

  const iniciou = new Date(corpo.started_at).getTime();
  const atendeu = corpo.answered_at ? new Date(corpo.answered_at).getTime() : null;
  const terminou = new Date(corpo.ended_at).getTime();
  const duracaoMs = atendeu !== null ? Math.max(0, terminou - atendeu) : null;

  const { error } = await p.admin.from("voice_calls").insert({
    id: corpo.id,
    organization_id: p.orgId,
    contact_id: contactId,
    provider: "sip",
    handled_by: "human",
    direction: corpo.direction,
    peer_phone: numero,
    status: "ended",
    end_reason: corpo.end_reason,
    started_at: new Date(iniciou).toISOString(),
    answered_at: atendeu !== null ? new Date(atendeu).toISOString() : null,
    ended_at: new Date(terminou).toISOString(),
    duration_ms: duracaoMs,
    created_by: p.userId,
    owner_user_id: atendeu !== null ? p.userId : null,
    metadata: { origem: ORIGEM_DO_WEBPHONE, via: corpo.via },
  });

  if (error) {
    // 23505: o mesmo id já foi gravado (o navegador reenviou) — não é erro.
    if (error.code === "23505") return { ok: true, id: corpo.id, repetida: true };
    return { ok: false, detalhe: error.message };
  }

  await audit({
    action: "webphone.call_logged",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "voice_calls",
    resourceId: corpo.id,
    // Sem o número: o log de auditoria não é lugar de telefone de cliente.
    metadata: { direction: corpo.direction, end_reason: corpo.end_reason, atendida: atendeu !== null },
  });
  return { ok: true, id: corpo.id, repetida: false };
}

export type ResultadoDeMarcar = { ok: true } | { ok: false; motivo: "nao_encontrada" | "sem_permissao" | "banco"; detalhe?: string };

/**
 * Grava o resultado que a pessoa marcou ao desligar. Só quem fez a ligação
 * muda o resultado dela — a menos que `podeEditarAlheias` (manager ou mais).
 */
export async function marcarResultado(p: {
  admin: Admin;
  orgId: string;
  userId: string;
  podeEditarAlheias: boolean;
  id: string;
  resultado: ResultadoDaLigacao;
}): Promise<ResultadoDeMarcar> {
  const { data: linha, error: lerErr } = await p.admin
    .from("voice_calls")
    .select("id, created_by, owner_user_id, metadata")
    .eq("organization_id", p.orgId)
    .eq("id", p.id)
    .eq("provider", "sip")
    .maybeSingle();
  if (lerErr) return { ok: false, motivo: "banco", detalhe: lerErr.message };
  if (!linha) return { ok: false, motivo: "nao_encontrada" };

  const metadata = (linha.metadata ?? {}) as Record<string, unknown>;
  if (metadata.origem !== ORIGEM_DO_WEBPHONE) return { ok: false, motivo: "nao_encontrada" };
  const dono = linha.created_by ?? linha.owner_user_id;
  if (dono !== p.userId && !p.podeEditarAlheias) return { ok: false, motivo: "sem_permissao" };

  const { error } = await p.admin
    .from("voice_calls")
    .update({ metadata: { ...metadata, resultado: p.resultado } })
    .eq("organization_id", p.orgId)
    .eq("id", p.id);
  if (error) return { ok: false, motivo: "banco", detalhe: error.message };

  await audit({
    action: "webphone.call_outcome_set",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "voice_calls",
    resourceId: p.id,
    metadata: { resultado: p.resultado },
  });
  return { ok: true };
}

interface LinhaDoBanco {
  id: string;
  direction: "inbound" | "outbound";
  peer_phone: string;
  end_reason: string | null;
  started_at: string;
  answered_at: string | null;
  duration_ms: number | null;
  metadata: Record<string, unknown> | null;
}

/** O que o CRM mostra na ficha: só as ligações deste telefone, da mais nova para a mais antiga. */
export async function listarChamadasDoContato(p: {
  /** Client da SESSÃO: a RLS vale por cima do filtro de organização. */
  supabase: SupabaseClient;
  orgId: string;
  contactId: string;
  limite: number;
}): Promise<{ ok: true; linhas: LigacaoDoHistorico[] } | { ok: false; detalhe: string }> {
  const { data, error } = await p.supabase
    .from("voice_calls")
    .select("id, direction, peer_phone, end_reason, started_at, answered_at, duration_ms, metadata")
    .eq("organization_id", p.orgId)
    .eq("contact_id", p.contactId)
    .eq("provider", "sip")
    .contains("metadata", { origem: ORIGEM_DO_WEBPHONE })
    .order("started_at", { ascending: false })
    .limit(p.limite);
  if (error) return { ok: false, detalhe: error.message };

  const linhas = ((data ?? []) as LinhaDoBanco[]).map((l): LigacaoDoHistorico => {
    const bruto = l.metadata?.resultado;
    const resultado = (RESULTADOS_DA_LIGACAO as readonly string[]).includes(String(bruto))
      ? (bruto as ResultadoDaLigacao)
      : null;
    return {
      id: l.id,
      direction: l.direction,
      peer_phone: l.peer_phone,
      end_reason: l.end_reason,
      started_at: l.started_at,
      answered_at: l.answered_at,
      duration_ms: l.duration_ms,
      resultado,
    };
  });
  return { ok: true, linhas };
}
