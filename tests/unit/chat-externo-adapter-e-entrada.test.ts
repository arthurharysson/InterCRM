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

const destinoResolvido = vi.fn();
vi.mock("@/lib/automation/outbound-ip", () => ({
  assertDestinoResolvidoSeguro: (...a: unknown[]) => destinoResolvido(...a),
}));

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
  destinoResolvido.mockReset().mockResolvedValue(undefined);
  fetchSpy = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** As esperas entre tentativas são de verdade (setTimeout): com relógio falso, avança por cima de todas. */
async function depoisDasEsperas<T>(operacao: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(10_000);
  return operacao;
}

/** Como acima, mas para a operação que termina em erro (a rejeição precisa ser observada ANTES de avançar). */
async function rejeitaDepoisDasEsperas(operacao: Promise<unknown>, mensagem: string): Promise<void> {
  const observada = expect(operacao).rejects.toThrow(mensagem);
  await vi.advanceTimersByTimeAsync(10_000);
  await observada;
}

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

  it("endereço que resolve para a rede interna é BLOQUEADO antes do fetch (SSRF por DNS)", async () => {
    destinoResolvido.mockRejectedValue(new Error("unsafe_url:resolved_private_ip"));
    await expect(chatExternoAdapter.send(envelope())).rejects.toThrow("chat_externo_destination_blocked");
    expect(destinoResolvido).toHaveBeenCalledWith("chat.exemplo.com.br");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resposta que não é 2xx vira erro com o status (depois de esgotar as tentativas)", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValue(new Response("{}", { status: 503 }));
    await rejeitaDepoisDasEsperas(chatExternoAdapter.send(envelope()), "chat_externo_send_failed_503");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  describe("falha passageira do Chat (ele reiniciando num deploy, por exemplo)", () => {
    it.each([502, 503, 504])("%i: reenvia com o MESMO corpo e a MESMA assinatura, e entrega", async (status) => {
      vi.useFakeTimers();
      fetchSpy
        .mockResolvedValueOnce(new Response("{}", { status }))
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      const r = await depoisDasEsperas(chatExternoAdapter.send(envelope()));

      expect(r).toEqual({ externalId: "msg-9" });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [a, b] = fetchSpy.mock.calls.map((c) => c[1] as RequestInit);
      // O Chat deduplica por `message_id`; o reenvio só é seguro se for IDÊNTICO ao que pode ter chegado.
      expect(b!.body).toBe(a!.body);
      expect((b!.headers as Record<string, string>)[HEADER_ASSINATURA_DE_ENTRADA]).toBe(
        (a!.headers as Record<string, string>)[HEADER_ASSINATURA_DE_ENTRADA],
      );
    });

    it("queda de rede rápida (conexão recusada) também é reenviada", async () => {
      vi.useFakeTimers();
      fetchSpy
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      expect(await depoisDasEsperas(chatExternoAdapter.send(envelope()))).toEqual({ externalId: "msg-9" });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("TIMEOUT não é reenviado: pode ter sido processado, e esperar de novo estouraria o tempo da requisição", async () => {
      fetchSpy.mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
      await expect(chatExternoAdapter.send(envelope())).rejects.toThrow("timeout");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it.each([400, 401, 404, 410, 413])("%i é definitivo: NÃO reenvia", async (status) => {
      fetchSpy.mockResolvedValue(new Response("{}", { status }));
      await expect(chatExternoAdapter.send(envelope())).rejects.toThrow(`chat_externo_send_failed_${status}`);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
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

describe("anexo do atendente (CRM → Chat)", () => {
  const MIDIA = {
    url: "https://projeto.supabase.co/storage/v1/object/sign/whatsapp-media/o/c/out-1.jpg?token=t",
    mime: "image/jpeg",
    filename: "out-1.jpg",
    caption: "Segue a foto",
  };
  const corpoEnviado = () => JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);

  it("manda o anexo com a URL assinada do Storage, o tipo e o nome, e a legenda vira o texto", async () => {
    await chatExternoAdapter.send(envelope({ kind: "image", body: undefined, media: MIDIA }));

    expect(corpoEnviado()).toMatchObject({
      event: "message",
      message_id: "msg-9",
      text: "Segue a foto",
      attachments: [{ kind: "image", url: MIDIA.url, mime: "image/jpeg", name: "out-1.jpg" }],
    });
  });

  it("anexo sem legenda: texto vazio (o Chat aceita mensagem só de anexo)", async () => {
    await chatExternoAdapter.send(
      envelope({ kind: "document", body: undefined, media: { ...MIDIA, mime: "application/pdf", caption: null } }),
    );
    expect(corpoEnviado()).toMatchObject({
      text: "",
      attachments: [{ kind: "document", mime: "application/pdf" }],
    });
  });

  it("anexo sem nome ou sem tipo OMITE o campo, nunca manda null (o Chat recusa null e mostraria 'indisponível')", async () => {
    await chatExternoAdapter.send(
      envelope({
        kind: "image",
        body: undefined,
        media: { url: MIDIA.url, mime: null, filename: null, caption: null } as never,
      }),
    );
    const [anexo] = corpoEnviado().attachments;
    expect(anexo).toEqual({ kind: "image", url: MIDIA.url });
    expect(anexo).not.toHaveProperty("name");
    expect(anexo).not.toHaveProperty("mime");
  });

  it("mensagem de texto não leva o campo `attachments`", async () => {
    await chatExternoAdapter.send(envelope());
    expect(corpoEnviado()).not.toHaveProperty("attachments");
  });
});

describe("anexo do cliente (Chat → CRM): fetchInboundMedia", () => {
  const URL_DO_ARQUIVO = "https://chat.exemplo.com.br/api/files/abc?exp=9999999999&sig=ff";
  const baixar = (url = URL_DO_ARQUIVO, hintMime?: string | null) =>
    chatExternoAdapter.fetchInboundMedia!({ organizationId: "org-1", sessionRef: "principal", url, hintMime });
  const arquivo = (bytes: number[], tipo: string | null = "image/png") =>
    new Response(new Uint8Array(bytes), { status: 200, headers: tipo ? { "content-type": tipo } : {} });

  it("baixa do MESMO host do Chat e devolve os bytes com o tipo que o Chat declarou ao servir", async () => {
    fetchSpy.mockResolvedValue(arquivo([1, 2, 3], "image/png; charset=binary"));

    const media = await baixar();

    expect([...media.buffer]).toEqual([1, 2, 3]);
    expect(media.mime).toBe("image/png");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_DO_ARQUIVO);
    // A URL assinada É a credencial: o segredo do canal e a assinatura dos eventos NÃO vão junto, e redirecionar
    // para outro lugar (que receberia a requisição) é recusado.
    expect(JSON.stringify(init.headers ?? {})).not.toContain(SEGREDO_DE_SAIDA);
    expect((init.headers as Record<string, string> | undefined)?.[HEADER_ASSINATURA_DE_ENTRADA]).toBeUndefined();
    expect(init.redirect).toBe("error");
  });

  it("sem content-type na resposta usa a dica do webhook; sem nenhum dos dois, octet-stream", async () => {
    fetchSpy.mockResolvedValueOnce(arquivo([1], null));
    expect((await baixar(URL_DO_ARQUIVO, "application/pdf")).mime).toBe("application/pdf");
    fetchSpy.mockResolvedValueOnce(arquivo([1], null));
    expect((await baixar()).mime).toBe("application/octet-stream");
  });

  it("URL de OUTRO host é recusada antes de qualquer requisição (o payload não escolhe para onde o servidor vai)", async () => {
    await expect(baixar("https://evil.example.org/api/files/abc?exp=1&sig=ff")).rejects.toThrow(
      "chat_externo_media_host_blocked",
    );
    await expect(baixar("https://chat.exemplo.com.br.evil.org/x")).rejects.toThrow("chat_externo_media_host_blocked");
    await expect(baixar("not a url")).rejects.toThrow("chat_externo_media_url_invalid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("host do Chat que resolve para a rede interna é BLOQUEADO (SSRF por DNS)", async () => {
    destinoResolvido.mockRejectedValue(new Error("unsafe_url:resolved_private_ip"));
    await expect(baixar()).rejects.toThrow("chat_externo_destination_blocked");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("canal incompleto falha com o código do canal (nada some em silêncio)", async () => {
    linhaDoCanal.mockReturnValue(null);
    await expect(baixar()).rejects.toThrow("chat_externo_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([403, 404, 410])("%i (link inválido, arquivo apagado, link vencido) falha com o status, para o worker registrar", async (status) => {
    fetchSpy.mockResolvedValue(new Response("{}", { status }));
    await expect(baixar()).rejects.toThrow(`chat_externo_media_failed_${status}`);
  });

  it("arquivo maior que o teto do Chat (10 MB) é recusado, pelo cabeçalho e pelo que de fato chegou", async () => {
    const GRANDE = 10 * 1024 * 1024 + 1;
    fetchSpy.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), { status: 200, headers: { "content-length": String(GRANDE) } }),
    );
    await expect(baixar()).rejects.toThrow("chat_externo_media_too_large");

    // cabeçalho que mente (ou ausente): o limite vale também para os bytes lidos
    fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array(GRANDE), { status: 200 }));
    await expect(baixar()).rejects.toThrow("chat_externo_media_too_large");
  });
});

describe("aviso de encerramento (CRM → Chat)", () => {
  const entrada = {
    organizationId: "org-1",
    sessionRef: "principal",
    providerConversationId: "web:0b6f3f9e-1c7a-4c1e-9a55-2d5a1e7c9f10",
    conversationId: "conv-1",
    closedAt: "2026-11-13T15:00:00.000Z",
  };

  it("envia conversation.closed assinado com o segredo DO CANAL e a versão do contrato", async () => {
    await chatExternoAdapter.notificarEncerramento!(entrada);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_DO_CHAT);
    const headers = init.headers as Record<string, string>;
    expect(headers[CABECALHO_DO_CONTRATO]).toBe(VERSAO_DO_CONTRATO);
    expect(headers[HEADER_ASSINATURA_DE_ENTRADA]).toBe(assinarCorpo(init.body as string, SEGREDO_DE_SAIDA));
    expect(JSON.parse(init.body as string)).toEqual({
      event: "conversation.closed",
      identity: entrada.providerConversationId,
      conversation_id: "conv-1",
      closed_at: "2026-11-13T15:00:00.000Z",
      reason: "resolved",
    });
  });

  it("canal incompleto, destino bloqueado e resposta não-2xx LANÇAM (quem chama registra)", async () => {
    linhaDoCanal.mockReturnValue(null);
    await expect(chatExternoAdapter.notificarEncerramento!(entrada)).rejects.toThrow("chat_externo_not_configured");

    linhaDoCanal.mockReturnValue({ chat_externo_url: URL_DO_CHAT, chat_externo_secret_out_encrypted: "x" });
    destinoResolvido.mockRejectedValue(new Error("privado"));
    await expect(chatExternoAdapter.notificarEncerramento!(entrada)).rejects.toThrow("chat_externo_destination_blocked");

    destinoResolvido.mockResolvedValue(undefined);
    vi.useFakeTimers();
    fetchSpy.mockResolvedValue(new Response("{}", { status: 502 }));
    await rejeitaDepoisDasEsperas(
      chatExternoAdapter.notificarEncerramento!(entrada),
      "chat_externo_close_notice_failed_502",
    );
  });

  it("o aviso também reenvia a falha passageira (o Chat trata `conversation.closed` repetido como duplicata)", async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await depoisDasEsperas(chatExternoAdapter.notificarEncerramento!(entrada));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
