/**
 * Cliente da API Fluxo (plataforma omnichannel).
 *
 * Auth: header `api-token` (não Bearer).
 * Base URL e token vêm de env vars FLUXO_API_URL e FLUXO_API_TOKEN.
 * Todos os endpoints de telefonia usam POST com JSON body.
 */

import { logger } from "@/lib/logger";

export interface FluxoConfig {
  baseUrl: string;
  apiToken: string;
}

export function readFluxoConfig(): FluxoConfig | null {
  const baseUrl = process.env.FLUXO_API_URL;
  const apiToken = process.env.FLUXO_API_TOKEN;
  if (!baseUrl || !apiToken) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiToken };
}

async function fluxoFetch<T = unknown>(
  config: FluxoConfig,
  path: string,
  body?: Record<string, unknown>,
  method = "POST",
): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "api-token": config.apiToken,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    logger.error("[fluxo] API error", { path, status: res.status, body: text.slice(0, 500) });
    throw new Error(`Fluxo API ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ---------- Ramais ----------

export interface FluxoExtension {
  id: number | string;
  extension: string;
  login?: string;
  callerid?: string;
  [key: string]: unknown;
}

export async function listarRamais(
  config: FluxoConfig,
  filtro?: { extension?: string; search?: string },
): Promise<FluxoExtension[]> {
  return fluxoFetch<FluxoExtension[]>(config, "/extensions", {
    id: "",
    extension: filtro?.extension ?? "",
    login: "",
    callerid: "",
    search: filtro?.search ?? "",
  });
}

// ---------- Chamadas ----------

export interface OriginateResult {
  [key: string]: unknown;
}

export async function originarChamada(
  config: FluxoConfig,
  params: { extension: string; phone: string; crmId: string },
): Promise<OriginateResult> {
  return fluxoFetch<OriginateResult>(config, "/call/exten/originate", {
    extension: params.extension,
    phone: params.phone,
    crm_id: params.crmId,
  });
}

export async function statusDaChamada(
  config: FluxoConfig,
  crmId: string,
): Promise<Record<string, unknown>> {
  return fluxoFetch(config, "/call/exten", { crm_id: crmId });
}

export async function encerrarChamada(
  config: FluxoConfig,
  crmId: string,
): Promise<Record<string, unknown>> {
  return fluxoFetch(config, "/call/exten/hangup", { crm_id: crmId });
}

// ---------- Chamada manual (por agente/user_integration_code) ----------

export async function originarChamadaManual(
  config: FluxoConfig,
  params: { userIntegrationCode: string; phone: string; crmId: string },
): Promise<OriginateResult> {
  return fluxoFetch<OriginateResult>(config, "/call/originate", {
    user_integration_code: params.userIntegrationCode,
    phone: params.phone,
    type: "MANUAL",
    crm_id: params.crmId,
  });
}

export async function encerrarChamadaAgente(
  config: FluxoConfig,
  userIntegrationCode: string,
): Promise<Record<string, unknown>> {
  return fluxoFetch(config, "/call/hangup", {
    user_integration_code: userIntegrationCode,
  });
}

// ---------- Histórico / Relatórios ----------

export interface FluxoCallRecord {
  [key: string]: unknown;
}

export async function chamadasPorRamal(
  config: FluxoConfig,
  params: { extension: string; phone?: string; datetime?: string },
): Promise<FluxoCallRecord[]> {
  return fluxoFetch<FluxoCallRecord[]>(config, "/extension/calls", {
    extension: params.extension,
    phone: params.phone ?? "",
    datetime: params.datetime ?? "",
  });
}

export async function relatorioChamadasRamal(
  config: FluxoConfig,
  params: {
    userIntegrationCode?: string;
    datetimeStart: string;
    datetimeEnd: string;
    page?: number;
    limit?: number;
  },
): Promise<FluxoCallRecord[]> {
  return fluxoFetch<FluxoCallRecord[]>(config, "/report/extensioncalls", {
    user_integration_code: params.userIntegrationCode ?? "",
    page: String(params.page ?? 1),
    limit: params.limit ?? 50,
    datetime_start: params.datetimeStart,
    datetime_end: params.datetimeEnd,
  });
}

export async function relatorioChamadasManuais(
  config: FluxoConfig,
  params: {
    userIntegrationCode?: string;
    page?: number;
    limit?: number;
  },
): Promise<FluxoCallRecord[]> {
  return fluxoFetch<FluxoCallRecord[]>(config, "/report/manualcalls", {
    user_integration_code: params.userIntegrationCode ?? "",
    page: String(params.page ?? 1),
    limit: params.limit ?? 50,
  });
}

// ---------- Agentes / CallCenter ----------

export async function loginAgenteCallCenter(
  config: FluxoConfig,
  params: { userIntegrationCode: string; userId: string; extensionId: string; extension: string },
): Promise<Record<string, unknown>> {
  return fluxoFetch(config, "/callcenter/agent/login", {
    user_integration_code: params.userIntegrationCode,
    user_id: params.userId,
    extension_id: params.extensionId,
    extension: params.extension,
  });
}

export async function logoffAgenteCallCenter(
  config: FluxoConfig,
  params: { userIntegrationCode: string; userId: string },
): Promise<Record<string, unknown>> {
  return fluxoFetch(config, "/callcenter/agent/logoff", {
    user_integration_code: params.userIntegrationCode,
    user_id: params.userId,
  });
}

// ---------- Gravação ----------

export async function iniciarGravacao(
  config: FluxoConfig,
  params: { userId: string; userIntegrationCode?: string; userLogin?: string },
): Promise<Record<string, unknown>> {
  return fluxoFetch(config, "/agent/rec/start", {
    user_id: params.userId,
    user_integration_code: params.userIntegrationCode ?? "",
    user_login: params.userLogin ?? "",
  });
}

export async function pararGravacao(
  config: FluxoConfig,
  params: { userId: string; userIntegrationCode?: string; userLogin?: string },
): Promise<Record<string, unknown>> {
  return fluxoFetch(config, "/agent/rec/stop", {
    user_id: params.userId,
    user_integration_code: params.userIntegrationCode ?? "",
    user_login: params.userLogin ?? "",
  });
}

// ---------- Contatos no Fluxo ----------

export async function buscarContatoFluxo(
  config: FluxoConfig,
  filtro: { phone?: string; cpf?: string; email?: string; name?: string },
): Promise<unknown[]> {
  return fluxoFetch<unknown[]>(config, "/contact/search", {
    id: "",
    cpf: filtro.cpf ?? "",
    cnpj: "",
    phone: filtro.phone ?? "",
    integration_code: "",
    email: filtro.email ?? "",
    name: filtro.name ?? "",
    single: false,
    archived: false,
    page: 1,
    limit: 10,
  });
}

// ---------- Listar Agentes ----------

export async function listarAgentes(
  config: FluxoConfig,
): Promise<unknown[]> {
  return fluxoFetch<unknown[]>(config, "/agents", {}, "GET");
}

// ---------- Filas ----------

export async function listarFilas(
  config: FluxoConfig,
): Promise<unknown[]> {
  return fluxoFetch<unknown[]>(config, "/queues", {}, "GET");
}
