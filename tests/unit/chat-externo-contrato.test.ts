/**
 * O CONTRATO DO CHAT EXTERNO — leitura dos eventos e assinatura.
 *
 * O vetor de teste da assinatura é o MESMO do plano (`rascunhos/chat-web/PLANO-CHAT-WEB.md`, seção 3.2) e o
 * mesmo que o Chat App valida do lado dele: os dois lados provam o mesmo número, então um não pode mudar de
 * algoritmo sem o outro reprovar.
 */
import { describe, expect, it } from "vitest";

import { assinarCorpo, assinaturaConfere, lerEventoDoChat } from "@/lib/channels/chat-externo/contrato";

const SEGREDO = "segredo-de-teste-0123456789abcdef";
const CORPO_DO_VETOR =
  '{"identity":"web:0b6f3f9e-1c7a-4c1e-9a55-2d5a1e7c9f10","text":"Olá, preciso de ajuda com a minha internet","sent_at":"2026-11-13T14:00:00.000Z","message_id":"msg_01HXYZ","sender_name":"Maria"}';
const ASSINATURA_DO_VETOR = "sha256=9c033217cb7174bb42f4f94cb87cb28c4805ee69bda0a82aef27e9f614426565";
const ID = "web:0b6f3f9e-1c7a-4c1e-9a55-2d5a1e7c9f10";

describe("assinatura (HMAC-SHA256 sobre o corpo cru)", () => {
  it("bate com o vetor de teste do plano", () => {
    expect(assinarCorpo(CORPO_DO_VETOR, SEGREDO)).toBe(ASSINATURA_DO_VETOR);
    expect(assinaturaConfere(CORPO_DO_VETOR, ASSINATURA_DO_VETOR, SEGREDO)).toBe(true);
  });

  it("recusa corpo alterado, segredo errado, cabeçalho ausente e de outro tamanho", () => {
    expect(assinaturaConfere(CORPO_DO_VETOR + " ", ASSINATURA_DO_VETOR, SEGREDO)).toBe(false);
    expect(assinaturaConfere(CORPO_DO_VETOR, ASSINATURA_DO_VETOR, SEGREDO + "x")).toBe(false);
    expect(assinaturaConfere(CORPO_DO_VETOR, null, SEGREDO)).toBe(false);
    expect(assinaturaConfere(CORPO_DO_VETOR, "sha256=curto", SEGREDO)).toBe(false);
  });
});

describe("message", () => {
  it("o vetor do plano é uma `message` válida (a v1 não tem o campo `event`)", () => {
    const r = lerEventoDoChat(CORPO_DO_VETOR);
    expect(r).toEqual({
      ok: true,
      evento: {
        event: "message",
        identity: ID,
        message_id: "msg_01HXYZ",
        text: "Olá, preciso de ajuda com a minha internet",
        sent_at: "2026-11-13T14:00:00.000Z",
        sender_name: "Maria",
        attachments: [],
      },
    });
  });

  describe("anexos (o Chat manda a URL assinada; o CRM baixa depois)", () => {
    const corpo = (attachments: unknown, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ event: "message", identity: ID, message_id: "m1", text: "", attachments, ...extra });
    const URL_DO_ARQUIVO = "https://chat.exemplo.com.br/api/files/abc?exp=1&sig=ff";

    it("lê o anexo com tipo, tamanho e nome; o `kind` sai do mime quando o Chat não manda", () => {
      const r = lerEventoDoChat(
        corpo([
          { kind: "image", url: URL_DO_ARQUIVO, mime: "image/jpeg", size: 183422, name: "foto.jpg" },
          { url: URL_DO_ARQUIVO + "2", mime: "application/pdf", size: 900, name: "contrato.pdf" },
        ]),
      );
      expect(r).toMatchObject({
        ok: true,
        evento: {
          text: "",
          attachments: [
            { kind: "image", url: URL_DO_ARQUIVO, mime: "image/jpeg", size: 183422, name: "foto.jpg" },
            { kind: "document", url: URL_DO_ARQUIVO + "2", mime: "application/pdf", size: 900, name: "contrato.pdf" },
          ],
        },
      });
    });

    it("sem o campo, ou com algo que não é lista, não há anexo (e a mensagem segue)", () => {
      for (const attachments of [undefined, null, "foto.jpg", { url: URL_DO_ARQUIVO }]) {
        expect(lerEventoDoChat(corpo(attachments, { text: "oi" }))).toMatchObject({
          ok: true,
          evento: { text: "oi", attachments: [] },
        });
      }
    });

    it("item sem URL, com esquema que não é web ou enorme é DESCARTADO; o resto passa", () => {
      const r = lerEventoDoChat(
        corpo([
          { kind: "image", mime: "image/png" },
          { url: "javascript:alert(1)", mime: "image/png" },
          { url: "file:///etc/passwd" },
          { url: "https://x.test/" + "a".repeat(2100) },
          "texto solto",
          null,
          { url: URL_DO_ARQUIVO, mime: "image/png" },
        ]),
      );
      expect(r).toMatchObject({ ok: true, evento: { attachments: [{ url: URL_DO_ARQUIVO, mime: "image/png" }] } });
    });

    it("campo opcional ruim (tamanho negativo, nome com controle) vira nulo, sem perder o anexo", () => {
      const r = lerEventoDoChat(
        corpo([{ url: URL_DO_ARQUIVO, mime: "image/png", size: -5, name: "fo\u0000to‮.png" }]),
      );
      expect(r).toMatchObject({
        ok: true,
        evento: { attachments: [{ url: URL_DO_ARQUIVO, size: null, name: "foto.png" }] },
      });
    });

    it("no máximo 10 anexos por mensagem (o resto é ignorado)", () => {
      const muitos = Array.from({ length: 14 }, (_, i) => ({ url: `${URL_DO_ARQUIVO}${i}`, mime: "image/png" }));
      const r = lerEventoDoChat(corpo(muitos));
      expect(r.ok && r.evento.event === "message" && r.evento.attachments).toHaveLength(10);
    });
  });

  it("recusa sem `identity` com o prefixo web: e sem `text`, nomeando só os CAMPOS", () => {
    expect(lerEventoDoChat(JSON.stringify({ text: "oi" }))).toEqual({
      ok: false,
      motivo: "contrato_violado",
      campos: ["identity"],
    });
    expect(lerEventoDoChat(JSON.stringify({ identity: "phone:+5511", text: "oi" }))).toMatchObject({ ok: false });
    expect(lerEventoDoChat(JSON.stringify({ identity: ID }))).toEqual({
      ok: false,
      motivo: "contrato_violado",
      campos: ["text"],
    });
  });

  it("JSON quebrado e corpo que não é objeto", () => {
    expect(lerEventoDoChat("{nao é json")).toEqual({ ok: false, motivo: "json_invalido" });
    expect(lerEventoDoChat("[1,2]")).toMatchObject({ ok: false, motivo: "contrato_violado" });
  });
});

describe("chat.started", () => {
  const base = { event: "chat.started", identity: ID };

  it("lê contato, setor, histórico e metadados; o setor vira minúsculo", () => {
    const r = lerEventoDoChat(
      JSON.stringify({
        ...base,
        started_at: "2026-11-13T14:00:00Z",
        sector: "  Suporte-Tecnico ",
        contact: { name: "Maria", cpf: "123.456.789-09", phone: "+55 (88) 99999-9999" },
        history: [
          { message_id: "bot_001", from: "customer", text: "Preciso de suporte", sent_at: "2026-11-13T13:58:01Z" },
          { message_id: "bot_002", from: "bot", text: "Qual o seu CPF?" },
        ],
        metadata: { origin: "whatsapp" },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.evento.event !== "chat.started") throw new Error("esperava chat.started");
    expect(r.evento.sector).toBe("suporte-tecnico");
    expect(r.evento.contact).toEqual({ name: "Maria", cpf: "12345678909", phone: "5588999999999" });
    expect(r.evento.history).toHaveLength(2);
    expect(r.evento.history[1]).toEqual({ message_id: "bot_002", from: "bot", text: "Qual o seu CPF?", sent_at: null });
    expect(r.evento.metadata).toEqual({ origin: "whatsapp" });
    expect(r.evento.started_at).toBe("2026-11-13T14:00:00.000Z");
  });

  it("tudo o que é opcional pode faltar: o evento nasce vazio e válido", () => {
    const r = lerEventoDoChat(JSON.stringify(base));
    expect(r).toEqual({
      ok: true,
      evento: {
        event: "chat.started",
        identity: ID,
        started_at: null,
        sector: null,
        contact: { name: null, cpf: null, phone: null },
        history: [],
        metadata: null,
      },
    });
  });

  it("CPF sem 11 dígitos ou repetido é DESCARTADO, e o evento segue (perder o cliente por um campo de enfeite é pior)", () => {
    for (const cpf of ["123", "11111111111", "abc", 12345678909]) {
      const r = lerEventoDoChat(JSON.stringify({ ...base, contact: { name: "Maria", cpf } }));
      expect(r.ok).toBe(true);
      if (r.ok && r.evento.event === "chat.started") expect(r.evento.contact.cpf).toBeNull();
    }
  });

  it("item malformado do histórico fica de fora sem derrubar o resto; histórico que não é lista recusa", () => {
    const r = lerEventoDoChat(
      JSON.stringify({
        ...base,
        history: [
          { message_id: "ok", from: "customer", text: "oi" },
          { message_id: "sem-texto", from: "bot" },
          { message_id: "autor-invalido", from: "alguem", text: "x" },
          "lixo",
        ],
      }),
    );
    expect(r.ok && r.evento.event === "chat.started" ? r.evento.history.map((m) => m.message_id) : null).toEqual(["ok"]);
    expect(lerEventoDoChat(JSON.stringify({ ...base, history: "nao-e-lista" }))).toEqual({
      ok: false,
      motivo: "contrato_violado",
      campos: ["history"],
    });
  });

  it("limita o histórico a 200 mensagens", () => {
    const history = Array.from({ length: 250 }, (_, i) => ({ message_id: `m${i}`, from: "bot", text: "x" }));
    const r = lerEventoDoChat(JSON.stringify({ ...base, history }));
    expect(r.ok && r.evento.event === "chat.started" ? r.evento.history.length : -1).toBe(200);
  });
});

describe("chat.closed_by_customer e eventos desconhecidos", () => {
  it("lê o encerramento do cliente", () => {
    expect(lerEventoDoChat(JSON.stringify({ event: "chat.closed_by_customer", identity: ID }))).toEqual({
      ok: true,
      evento: { event: "chat.closed_by_customer", identity: ID, closed_at: null },
    });
  });

  it("evento que o CRM não conhece é recusado nomeando só o campo `event`", () => {
    expect(lerEventoDoChat(JSON.stringify({ event: "chat.typing", identity: ID }))).toEqual({
      ok: false,
      motivo: "contrato_violado",
      campos: ["event"],
    });
  });
});
