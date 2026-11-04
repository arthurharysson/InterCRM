/**
 * Cliente da API de integração da central Fluxo — só o que o Click to Call usa.
 *
 * Documentação (a página pública `/pages/api` da própria central):
 *   POST /call/exten/originate  { extension, phone, crm_id }  → toca o ramal e liga ao número
 *   POST /call/exten            { crm_id }                    → situação da ligação
 *   POST /call/exten/hangup     { crm_id }                    → desliga
 *   POST /extensions            { id, extension, login, callerid, search } → lista de ramais
 *
 * Autenticação: cabeçalho `api-token` (não é Bearer). O token NUNCA aparece em
 * mensagem de erro, em log nem em resposta: tudo o que sai daqui é texto que o
 * cliente já poderia ler.
 *
 * Por ora o endereço e o token vêm do ambiente do servidor (`FLUXO_API_URL` e
 * `FLUXO_API_TOKEN`) — serve a UMA empresa por instalação. Para revender, o par
 * passa a ser cadastrado por organização, cifrado; quem consome este módulo só
 * recebe um `ConfigDaCentral`, então a troca não o toca.
 */
import { z } from "zod";

import type { SituacaoDaLigacao } from "@/lib/webphone/config";

export interface ConfigDaCentral {
  baseUrl: string;
  token: string;
}

export function lerConfigDaCentral(env: Record<string, string | undefined> = process.env): ConfigDaCentral | null {
  const baseUrl = env.FLUXO_API_URL?.trim();
  const token = env.FLUXO_API_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

/** Falha que o atendente pode ler: nunca carrega o token nem o corpo cru da central. */
export class ErroDaCentral extends Error {
  constructor(
    readonly motivo: "recusou" | "indisponivel" | "resposta_ilegivel",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDaCentral";
  }
}

const TEMPO_LIMITE_MS = 15_000;

async function chamar(config: ConfigDaCentral, caminho: string, corpo: Record<string, unknown>): Promise<unknown> {
  let resposta: Response;
  try {
    resposta = await fetch(`${config.baseUrl}${caminho}`, {
      method: "POST",
      headers: { "api-token": config.token, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      cache: "no-store",
    });
  } catch {
    throw new ErroDaCentral("indisponivel", "A central de telefonia não respondeu. Tente de novo em instantes.");
  }

  let json: unknown = null;
  try {
    json = await resposta.json();
  } catch {
    /* corpo vazio ou não-JSON: tratado abaixo */
  }

  const mensagemDaCentral =
    json && typeof json === "object" && "message" in json && typeof (json as { message: unknown }).message === "string"
      ? (json as { message: string }).message
      : null;

  if (!resposta.ok) {
    throw new ErroDaCentral("recusou", mensagemDaCentral ?? `A central recusou o pedido (${resposta.status}).`);
  }
  if (json === null) throw new ErroDaCentral("resposta_ilegivel", "A central respondeu algo que o CRM não entendeu.");
  return json;
}

/** `{ status: "OK" }` — a central responde 200 com `status` de erro em alguns casos. */
function conferirStatus(json: unknown): void {
  if (json && typeof json === "object" && "status" in json) {
    const status = String((json as { status: unknown }).status).toUpperCase();
    if (status !== "OK") {
      const msg = "message" in json && typeof (json as { message: unknown }).message === "string" ? (json as { message: string }).message : null;
      throw new ErroDaCentral("recusou", msg ?? "A central não aceitou o pedido.");
    }
  }
}

export async function ligarPeloRamal(
  config: ConfigDaCentral,
  p: { ramal: string; telefone: string; crmId: string },
): Promise<void> {
  const json = await chamar(config, "/call/exten/originate", { extension: p.ramal, phone: p.telefone, crm_id: p.crmId });
  conferirStatus(json);
}

export async function desligarPeloCrmId(config: ConfigDaCentral, crmId: string): Promise<void> {
  const json = await chamar(config, "/call/exten/hangup", { crm_id: crmId });
  conferirStatus(json);
}

const linhaDaLigacaoSchema = z
  .object({
    status: z.string().optional(),
    active: z.boolean().optional(),
    datetime_start: z.string().nullable().optional(),
    datetime_answer: z.string().nullable().optional(),
    datetime_end: z.string().nullable().optional(),
    talk_time: z.number().nullable().optional(),
  })
  .passthrough();

/**
 * Traduz a linha que a central devolve. `DIALING` é a ligação tocando;
 * `ONCALL`/`ANSWERED` com `active` é a conversa; `active: false` é o fim. Sem
 * linha ainda (a central demora um instante para registrar), é `desconhecida` —
 * e quem consulta tenta de novo.
 */
export function situacaoDaLigacao(linha: unknown): SituacaoDaLigacao {
  const sem: SituacaoDaLigacao = { estado: "desconhecida", atendida: false, atendida_em: null, encerrada_em: null, falou_s: 0 };
  const lida = linhaDaLigacaoSchema.safeParse(linha);
  if (!lida.success) return sem;
  const l = lida.data;
  const status = (l.status ?? "").toUpperCase();
  const atendida = Boolean(l.datetime_answer) || status === "ANSWERED" || status === "ONCALL";
  const base = {
    atendida: Boolean(l.datetime_answer),
    atendida_em: l.datetime_answer ?? null,
    encerrada_em: l.datetime_end ?? null,
    falou_s: Math.max(0, l.talk_time ?? 0),
  };
  if (l.active === false) return { ...base, estado: "encerrada" };
  if (atendida) return { ...base, estado: "em_andamento" };
  if (status === "DIALING") return { ...base, estado: "chamando" };
  return sem;
}

export async function consultarLigacao(config: ConfigDaCentral, crmId: string): Promise<SituacaoDaLigacao> {
  let json: unknown;
  try {
    json = await chamar(config, "/call/exten", { crm_id: crmId });
  } catch (e) {
    // "Ainda não existe" é o normal nos primeiros segundos: não é falha.
    if (e instanceof ErroDaCentral && e.motivo === "recusou") {
      return { estado: "desconhecida", atendida: false, atendida_em: null, encerrada_em: null, falou_s: 0 };
    }
    throw e;
  }
  const dados = json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : null;
  return situacaoDaLigacao(dados);
}

export interface RamalDaCentral {
  id: number | string;
  extension: string;
  login: string | null;
  callerid: string | null;
}

const ramalSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    extension: z.union([z.string(), z.number()]).transform(String),
    login: z.string().nullable().optional(),
    callerid: z.string().nullable().optional(),
  })
  .transform((r): RamalDaCentral => ({ id: r.id, extension: r.extension, login: r.login ?? null, callerid: r.callerid ?? null }));

export async function listarRamaisDaCentral(config: ConfigDaCentral): Promise<RamalDaCentral[]> {
  const json = await chamar(config, "/extensions", { id: "", extension: "", login: "", callerid: "", search: "" });
  const lista = Array.isArray(json) ? json : json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : [];
  if (!Array.isArray(lista)) return [];
  const ramais: RamalDaCentral[] = [];
  for (const item of lista) {
    const lido = ramalSchema.safeParse(item);
    if (lido.success) ramais.push(lido.data);
  }
  return ramais.sort((a, b) => a.extension.localeCompare(b.extension, "pt-BR", { numeric: true }));
}
