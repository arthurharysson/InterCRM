import { createHash } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: vi.fn(),
  support: vi.fn(),
  audit: vi.fn(),
  listar: vi.fn(),
  criar: vi.fn(),
  atualizar: vi.fn(),
  encrypt: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.support }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: h.encrypt }));
// A base pública vem do ambiente da instalação; o teste não pode depender do .env de quem roda.
vi.mock("@/lib/webhooks/url-publica", () => ({ basePublicaDaInstalacao: () => "https://crm.test" }));
// A persistência é mockada; o gerador de credenciais e a validação do endereço são os REAIS (é o que se quer provar).
vi.mock("@/lib/channels/chat-externo/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channels/chat-externo/session")>()),
  listarCanaisDoChat: h.listar,
  criarCanalDoChat: h.criar,
  atualizarCanalDoChat: h.atualizar,
}));

import { GET, PATCH, POST } from "./route";

/**
 * A rota do canal do chat de atendimento (aplicação separada, fora do WhatsApp).
 * O que importa: só admin; o endereço de saída passa na validação anti-SSRF; os DOIS segredos nascem no servidor,
 * são cifrados antes de gravar e voltam UMA vez (criação ou rotação) — nenhum GET os devolve.
 */
const URL_ = "https://crm.test/api/v1/channels/chat-publico";
const req = (method: string, body?: unknown) =>
  new NextRequest(URL_, { method, body: body === undefined ? undefined : JSON.stringify(body) });

const ID = "7b7f1b7e-3a52-4bd1-9a0e-0f6c1d2d9a11";

/** Uma "cifra" de teste que NÃO carrega o claro dentro (senão "o claro não foi gravado" não teria como falhar). */
const cifra = (v: string) => `cifrado:${createHash("sha256").update(v).digest("hex").slice(0, 24)}`;

beforeEach(() => {
  vi.clearAllMocks();
  h.role.mockResolvedValue({ ok: true, org: { orgId: "org-confiavel" }, user: { id: "admin", idioma: "pt-BR" } });
  h.support.mockResolvedValue(null);
  h.encrypt.mockImplementation(async (_: unknown, v: string) => cifra(v));
  h.criar.mockResolvedValue({ error: null, code: null, id: ID });
  h.atualizar.mockResolvedValue({ error: null, achou: true });
  h.listar.mockResolvedValue([]);
});

describe("quem pode", () => {
  it("só admin: as três rotas pedem o papel e param na recusa, sem tocar no banco", async () => {
    h.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    for (const r of [
      await GET(req("GET")),
      await POST(req("POST", { display_name: "Chat", outbound_url: "https://chat.exemplo.com.br/x" })),
      await PATCH(req("PATCH", { channel_session_id: ID, rotate_secrets: true })),
    ]) {
      expect(r.status).toBe(403);
    }
    expect(h.role).toHaveBeenNthCalledWith(1, "admin", expect.anything());
    expect(h.criar).not.toHaveBeenCalled();
    expect(h.atualizar).not.toHaveBeenCalled();
    expect(h.listar).not.toHaveBeenCalled();
  });
});

describe("POST — criar o canal", () => {
  const corpo = { display_name: "Chat de atendimento", outbound_url: "https://chat.exemplo.com.br/api/crm/events" };

  it("gera os dois segredos, CIFRA os dois antes de gravar e devolve em claro UMA vez", async () => {
    const r = await POST(req("POST", corpo));
    const json = (await r.json()) as { data: Record<string, string> };

    expect(r.status).toBe(201);
    expect(json.data.secret_to_crm).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.secret_from_crm).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.secret_to_crm).not.toBe(json.data.secret_from_crm);
    expect(json.data.inbound_url).toMatch(/^https:\/\/crm\.test\/api\/v1\/webhooks\/channel\/[0-9a-f]{48}$/);

    // o que vai para o banco é o CIFRADO, nunca o claro
    const gravado = h.criar.mock.calls[0]![1] as Record<string, string>;
    expect(gravado.segredoDeEntradaCifrado).toBe(cifra(json.data.secret_to_crm!));
    expect(gravado.segredoDeSaidaCifrado).toBe(cifra(json.data.secret_from_crm!));
    expect(JSON.stringify(gravado)).not.toContain(json.data.secret_to_crm);
    // a organização vem do papel validado, nunca do corpo
    expect(gravado.organizationId).toBe("org-confiavel");
    expect(gravado.ref).toBe("principal");
  });

  it("a trilha de auditoria registra a criação sem nenhum segredo", async () => {
    const r = await POST(req("POST", corpo));
    const json = (await r.json()) as { data: Record<string, string> };
    expect(h.audit).toHaveBeenCalledTimes(1);
    const auditado = JSON.stringify(h.audit.mock.calls[0]![0]);
    expect(auditado).toContain("channel.connected");
    expect(auditado).not.toContain(json.data.secret_to_crm);
    expect(auditado).not.toContain(json.data.secret_from_crm);
  });

  it.each([
    ["http em produção não vale", "http://chat.exemplo.com.br/x"],
    ["rede interna", "https://10.0.0.5/x"],
    ["localhost", "https://localhost/x"],
    ["IPv6 literal", "https://[::1]/x"],
    ["não é URL", "chat sem endereço"],
    ["esquema que não é web", "ftp://chat.exemplo.com.br/x"],
  ])("endereço de saída recusado (%s): 422 e NADA é gravado", async (_nome, url) => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const r = await POST(req("POST", { ...corpo, outbound_url: url }));
      expect(r.status).toBe(422);
      expect(h.criar).not.toHaveBeenCalled();
      expect(h.encrypt).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sem a cifra da instalação RECUSA (segredo em claro seria pior que recusar)", async () => {
    h.encrypt.mockResolvedValue(null);
    const r = await POST(req("POST", corpo));
    expect(r.status).toBe(422);
    expect(h.criar).not.toHaveBeenCalled();
  });

  it("corpo sem nome ou sem endereço: 422", async () => {
    expect((await POST(req("POST", { display_name: "", outbound_url: "https://x.com.br" }))).status).toBe(422);
    expect((await POST(req("POST", { display_name: "Chat" }))).status).toBe(422);
    expect((await POST(req("POST", { ...corpo, ref: "Tem Espaço" }))).status).toBe(422);
  });

  it("identificador repetido na organização vira 409, não 500", async () => {
    h.criar.mockResolvedValue({ error: "duplicate key", code: "23505", id: null });
    const r = await POST(req("POST", corpo));
    expect(r.status).toBe(409);
  });
});

describe("GET — nunca devolve segredo", () => {
  it("lista o estado e o endereço de entrada, só com SIM/NÃO para os segredos", async () => {
    h.listar.mockResolvedValue([
      {
        id: ID,
        ref: "principal",
        displayName: "Chat de atendimento",
        enderecoDeSaida: "https://chat.exemplo.com.br/api/crm/events",
        status: "WORKING",
        webhookPathToken: "a".repeat(48),
        temSegredoDeEntrada: true,
        temSegredoDeSaida: true,
        createdAt: null,
      },
    ]);
    const r = await GET(req("GET"));
    const json = (await r.json()) as { data: Array<Record<string, unknown>> };

    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      channel_session_id: ID,
      has_secret_to_crm: true,
      has_secret_from_crm: true,
      inbound_url: `https://crm.test/api/v1/webhooks/channel/${"a".repeat(48)}`,
    });
    expect(Object.keys(json.data[0]!).some((k) => k.startsWith("secret_"))).toBe(false);
    // a organização consultada é a do papel validado
    expect(h.listar.mock.calls[0]![1]).toBe("org-confiavel");
  });
});

describe("PATCH", () => {
  it("girar as chaves devolve as DUAS novas uma vez e grava só o cifrado", async () => {
    const r = await PATCH(req("PATCH", { channel_session_id: ID, rotate_secrets: true }));
    const json = (await r.json()) as { data: Record<string, string> };

    expect(r.status).toBe(200);
    expect(json.data.secret_to_crm).toMatch(/^[0-9a-f]{64}$/);
    expect(json.data.secret_from_crm).toMatch(/^[0-9a-f]{64}$/);
    const patch = h.atualizar.mock.calls[0]![1] as Record<string, string>;
    expect(patch.segredoDeEntradaCifrado).toBe(cifra(json.data.secret_to_crm!));
    expect(patch.segredoDeSaidaCifrado).toBe(cifra(json.data.secret_from_crm!));
    expect(patch.organizationId).toBe("org-confiavel");
  });

  it("trocar só o endereço NÃO gira segredo nem devolve segredo", async () => {
    const r = await PATCH(
      req("PATCH", { channel_session_id: ID, outbound_url: "https://novo.exemplo.com.br/api/crm/events" }),
    );
    const json = (await r.json()) as { data: Record<string, unknown> };
    expect(r.status).toBe(200);
    expect(json.data.secret_to_crm).toBeUndefined();
    expect(h.encrypt).not.toHaveBeenCalled();
    expect(h.atualizar.mock.calls[0]![1]).toMatchObject({ enderecoDeSaida: "https://novo.exemplo.com.br/api/crm/events" });
  });

  it("endereço novo inválido: 422 e nada é gravado", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const r = await PATCH(req("PATCH", { channel_session_id: ID, outbound_url: "https://192.168.0.9/x" }));
      expect(r.status).toBe(422);
      expect(h.atualizar).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("canal que não é desta organização (ou não existe): 404", async () => {
    h.atualizar.mockResolvedValue({ error: null, achou: false });
    const r = await PATCH(req("PATCH", { channel_session_id: ID, display_name: "Novo nome" }));
    expect(r.status).toBe(404);
  });

  it("corpo sem nada a alterar: 422", async () => {
    expect((await PATCH(req("PATCH", { channel_session_id: ID }))).status).toBe(422);
    expect((await PATCH(req("PATCH", { rotate_secrets: true }))).status).toBe(422);
  });
});
