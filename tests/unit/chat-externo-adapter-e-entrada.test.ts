/**
 * O CHAT EXTERNO nas duas pontas do seam de canais: o adapter de SAÍDA (CRM → Chat) e a ENTRADA do webhook
 * (Chat → CRM), com o segredo POR CANAL — e a prova de que o canal `web` do InterSuite segue como estava.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const linhaDoCanal = vi.fn();
const decrypt = vi.fn();

vi.mock("@/lib/supabase/admin", () => {
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    is: () => consulta,
    maybeSingle: async () => ({ data: linhaDoCanal(), error: null }),
  };
  return { createAdminClient: () => ({ from: () => consulta }) };
});
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: (...a: unknown[]) => decrypt(...a) }));

const ingerir = vi.fn();
vi.mock("@/lib/channels/chat-externo/ingest", () => ({ ingerirEventoDoChat: (...a: unknown[]) => ingerir(...a) }));

import { CABECALHO_DO_CONTRATO, VERSAO_DO_CONTRATO, chatExternoAdapter } from "@/lib/channels/adapters/chat-externo";
import { assinarCorpo } from "@/lib/channels/chat-externo/contrato";
import {
  acceptsInboundWebhook,
  handleInboundWebhook,
  verifyInboundWebhookSignature,
} from "@/lib/channels/inbound";
import { HEADER_ASSINATURA_DE_ENTRADA } from "@/lib/webhooks/assinatura";
import type { OutboundEnvelope } from "@/lib/channels/types";

const SEGREDO_DE_SAIDA = "segredo-de-saida-0123456789abcdef-xyz";
const SEGREDO_DE_ENTRADA = "segredo-de-entrada-0123456789abcdef-xyz";
const URL_DO_CHAT = "https://chat.exemplo.com.br/api/crm/events";

function envelope(extra: Partial<OutboundEnvelope> = {}): OutboundEnvelope {
  return {
    organizationId: "org-1",
    sessionRef: "principal",
    to: "chat-externo-thread",
    kind: "text",
    body: "Olá Maria, já vou verificar.",
    providerConversationId: "web:0b6f3f9e-1c7a-4c1e-9a55-2d5a1e7c9f10",
    conversationId: "conv-1",
    messageId: "msg-9",
    authorKind: "agent",
    authorName: "João",
    ...extra,
  } as OutboundEnvelope;
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  linhaDoCanal.mockReset().mockReturnValue({
    chat_externo_url: URL_DO_CHAT,
    chat_externo_secret_out_encrypted: "cifrado",
  });
  decrypt.mockReset().mockResolvedValue(SEGREDO_DE_SAIDA);
  fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe("adapter de saída", () => {
  it("envia um POST assinado com o segredo DO CANAL, a versão do contrato e o corpo v2", async () => {
    const r = await chatExternoAdapter.send(envelope());

    expect(r).toEqual({ externalId: "msg-9" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_DO_CHAT);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers[CABECALHO_DO_CONTRATO]).toBe(VERSAO_DO_CONTRATO);
    // a assinatura é sobre o CORPO CRU enviado
    expect(headers[HEADER_ASSINATURA_DE_ENTRADA]).toBe(assinarCorpo(init.body as string, SEGREDO_DE_SAIDA));
    expect(JSON.parse(init.body as string)).toMatchObject({
      event: "message",
      identity: "web:0b6f3f9e-1c7a-4c1e-9a55-2d5a1e7c9f10",
      conversation_id: "conv-1",
      message_id: "msg-9",
      text: "Olá Maria, já vou verificar.",
      author: { kind: "agent", name: "João" },
    });
  });

  it("sem identidade do chat não envia nada", async () => {
    expect(await chatExternoAdapter.send(envelope({ providerConversationId: null }))).toEqual({ externalId: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["sem linha de canal", () => linhaDoCanal.mockReturnValue(null)],
    ["sem endereço", () => linhaDoCanal.mockReturnValue({ chat_externo_url: null, chat_externo_secret_out_encrypted: "x" })],
    ["sem segredo", () => linhaDoCanal.mockReturnValue({ chat_externo_url: URL_DO_CHAT, chat_externo_secret_out_encrypted: null })],
    ["segredo que não decifra", () => decrypt.mockResolvedValue(null)],
    ["endereço que não é web", () => linhaDoCanal.mockReturnValue({ chat_externo_url: "ftp://x", chat_externo_secret_out_encrypted: "x" })],
  ])("canal incompleto (%s): FALHA com o código do canal e não envia (nada some em silêncio)", async (_n, preparar) => {
    preparar();
    await expect(chatExternoAdapter.send(envelope())).rejects.toThrow("chat_externo_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resposta que não é 2xx vira erro com o status", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 503 }));
    await expect(chatExternoAdapter.send(envelope())).rejects.toThrow("chat_externo_send_failed_503");
  });

  it("a saúde reflete a configuração do canal", async () => {
    expect(await chatExternoAdapter.checkHealth!({ organizationId: "org-1", sessionRef: "principal" })).toEqual({
      reachable: true,
      status: "WORKING",
      detail: null,
    });
    linhaDoCanal.mockReturnValue(null);
    expect(await chatExternoAdapter.checkHealth!({ organizationId: "org-1", sessionRef: "principal" })).toEqual({
      reachable: true,
      status: "FAILED",
      detail: "chat_externo_not_configured",
    });
  });
});

describe("entrada do webhook", () => {
  const corpo = JSON.stringify({ identity: "web:abc", text: "oi" });
  const cabecalhos = (assinatura: string | null) => {
    const h = new Headers();
    if (assinatura) h.set(HEADER_ASSINATURA_DE_ENTRADA, assinatura);
    return h;
  };

  it("o provider recebe webhook, e a assinatura é conferida com o segredo DA SESSÃO", () => {
    expect(acceptsInboundWebhook("chat_externo")).toBe(true);
    const boa = assinarCorpo(corpo, SEGREDO_DE_ENTRADA);
    expect(verifyInboundWebhookSignature("chat_externo", corpo, cabecalhos(boa), SEGREDO_DE_ENTRADA)).toBe(true);
    // segredo de OUTRO canal, cabeçalho ausente, segredo ausente e segredo curto: todos recusam
    expect(verifyInboundWebhookSignature("chat_externo", corpo, cabecalhos(boa), SEGREDO_DE_SAIDA)).toBe(false);
    expect(verifyInboundWebhookSignature("chat_externo", corpo, cabecalhos(null), SEGREDO_DE_ENTRADA)).toBe(false);
    expect(verifyInboundWebhookSignature("chat_externo", corpo, cabecalhos(boa), null)).toBe(false);
    expect(verifyInboundWebhookSignature("chat_externo", corpo, cabecalhos(boa), "curto")).toBe(false);
  });

  it("o canal `web` do InterSuite segue lendo o segredo do AMBIENTE (e ignora o da sessão)", () => {
    const antes = process.env.INTERSUITE_HMAC_SECRET_OUT;
    try {
      delete process.env.INTERSUITE_HMAC_SECRET_OUT;
      // sem a variável, o `web` não recebe nada — mesmo que a sessão traga um segredo
      expect(acceptsInboundWebhook("web")).toBe(false);
      const boa = assinarCorpo(corpo, SEGREDO_DE_ENTRADA);
      expect(verifyInboundWebhookSignature("web", corpo, cabecalhos(boa), SEGREDO_DE_ENTRADA)).toBe(false);

      process.env.INTERSUITE_HMAC_SECRET_OUT = SEGREDO_DE_ENTRADA;
      expect(acceptsInboundWebhook("web")).toBe(true);
      expect(verifyInboundWebhookSignature("web", corpo, cabecalhos(boa), null)).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.INTERSUITE_HMAC_SECRET_OUT;
      else process.env.INTERSUITE_HMAC_SECRET_OUT = antes;
    }
  });

  const sessao = { id: "sessao-1", organization_id: "org-1", provider: "chat_externo" };
  const admin = {} as never;

  it("evento válido assinado: ingere com a ORGANIZAÇÃO E O CANAL DA SESSÃO (nunca do corpo)", async () => {
    ingerir.mockReset().mockResolvedValue({ status: "ingested", conversationId: "conv-1" });
    const body = JSON.stringify({ identity: "web:abc", text: "oi", organization_id: "org-INTRUSA", channel_session_id: "x" });

    const r = await handleInboundWebhook(admin, {
      session: sessao,
      rawBody: body,
      headers: cabecalhos(assinarCorpo(body, SEGREDO_DE_ENTRADA)),
      secret: SEGREDO_DE_ENTRADA,
    });

    expect(r).toEqual({ ok: true, body: { status: "ingested", conversationId: "conv-1" } });
    expect(ingerir).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ organizationId: "org-1", channelSessionId: "sessao-1" }),
    );
  });

  it.each([
    ["assinatura inválida", () => cabecalhos("sha256=" + "0".repeat(64)), corpo, "unauthorized", "bad_signature"],
    ["JSON quebrado", null, "{quebrado", "invalid_json", "invalid_json"],
    ["contrato violado (sem texto)", null, JSON.stringify({ identity: "web:abc" }), "contrato_violado", /text/],
  ])("%s: recusa sem ingerir nada", async (_n, cab, body, code, message) => {
    ingerir.mockReset();
    const headers = cab ? (cab as () => Headers)() : cabecalhos(assinarCorpo(body as string, SEGREDO_DE_ENTRADA));
    const r = await handleInboundWebhook(admin, { session: sessao, rawBody: body as string, headers, secret: SEGREDO_DE_ENTRADA });
    expect(r).toMatchObject({ ok: false, code });
    if (typeof message === "string") expect((r as { message: string }).message).toBe(message);
    else expect((r as { message: string }).message).toMatch(message);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("sem segredo na sessão: fail-closed", async () => {
    ingerir.mockReset();
    const r = await handleInboundWebhook(admin, { session: sessao, rawBody: corpo, headers: cabecalhos(null), secret: null });
    expect(r).toMatchObject({ ok: false, code: "unauthorized", message: "webhook_secret_unavailable" });
    expect(ingerir).not.toHaveBeenCalled();
  });
});
