import { beforeEach, describe, expect, it, vi } from "vitest";

const audit = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));

const achar = vi.fn(async (..._args: unknown[]): Promise<{ id: string; phone_number: string | null; name: string | null } | null> => null);
vi.mock("@/lib/channels/contato-por-telefone", () => ({
  encontrarContatoPorTelefoneComNome: (...a: unknown[]) => achar(...a),
}));

import { marcarResultado, registrarChamada } from "@/lib/webphone/chamadas";

const ORG = "11111111-1111-4111-8111-111111111111";
const EU = "22222222-2222-4222-8222-222222222222";
const OUTRO = "33333333-3333-4333-8333-333333333333";
const ID = "5b0f9d1e-0c6a-4f6e-9a5e-3f1f2f0b9a11";

/** Um admin falso que registra o que foi gravado e devolve o que o teste mandar. */
function adminFalso(opcoes: { erroDoInsert?: { code?: string; message: string }; linha?: Record<string, unknown> | null } = {}) {
  const inseridos: Record<string, unknown>[] = [];
  const atualizados: Record<string, unknown>[] = [];
  const filtros: Array<[string, unknown]> = [];
  const admin = {
    from: () => {
      const cadeia = {
        insert: (v: Record<string, unknown>) => {
          inseridos.push(v);
          return Promise.resolve({ error: opcoes.erroDoInsert ?? null });
        },
        select: () => cadeia,
        update: (v: Record<string, unknown>) => {
          atualizados.push(v);
          return cadeia;
        },
        eq: (c: string, v: unknown) => {
          filtros.push([c, v]);
          return cadeia;
        },
        maybeSingle: () => Promise.resolve({ data: opcoes.linha ?? null, error: null }),
        then: (ok: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(ok),
      };
      return cadeia;
    },
  };
  return { admin: admin as never, inseridos, atualizados, filtros };
}

const corpo = {
  id: ID,
  direction: "inbound" as const,
  numero: "21999998888",
  started_at: "2026-11-04T13:00:00.000Z",
  answered_at: "2026-11-04T13:00:08.000Z",
  ended_at: "2026-11-04T13:02:22.000Z",
  end_reason: "user_ended" as const,
  via: "navegador" as const,
};

beforeEach(() => {
  audit.mockClear();
  achar.mockReset();
  achar.mockResolvedValue(null);
});

describe("registrarChamada", () => {
  it("grava em voice_calls como SIP humano, com a organização e a pessoa da SESSÃO", async () => {
    const f = adminFalso();
    const r = await registrarChamada({ admin: f.admin, orgId: ORG, userId: EU, corpo });
    expect(r).toEqual({ ok: true, id: ID, repetida: false });
    const linha = f.inseridos[0]!;
    expect(linha).toMatchObject({
      organization_id: ORG,
      provider: "sip",
      handled_by: "human",
      status: "ended",
      created_by: EU,
      owner_user_id: EU,
      peer_phone: "21999998888",
      duration_ms: 134_000,
    });
    expect(linha.metadata).toEqual({ origem: "webphone", via: "navegador" });
  });

  it("liga ao contato quando o número já é de alguém, sem criar ficha", async () => {
    achar.mockResolvedValue({ id: "c-1", phone_number: "21999998888", name: "Maria" });
    const f = adminFalso();
    await registrarChamada({ admin: f.admin, orgId: ORG, userId: EU, corpo });
    expect(f.inseridos[0]!.contact_id).toBe("c-1");
  });

  it("ligação perdida não tem dono nem duração", async () => {
    const f = adminFalso();
    await registrarChamada({
      admin: f.admin,
      orgId: ORG,
      userId: EU,
      corpo: { ...corpo, answered_at: null, end_reason: "cancelled" },
    });
    expect(f.inseridos[0]).toMatchObject({ owner_user_id: null, duration_ms: null, answered_at: null });
  });

  it("número anônimo vira 'anonimo' e não procura contato", async () => {
    const f = adminFalso();
    await registrarChamada({ admin: f.admin, orgId: ORG, userId: EU, corpo: { ...corpo, numero: "anonymous" } });
    expect(f.inseridos[0]!.peer_phone).toBe("anonimo");
    expect(achar).not.toHaveBeenCalled();
  });

  it("o mesmo id reenviado é idempotente: 23505 não é erro", async () => {
    const f = adminFalso({ erroDoInsert: { code: "23505", message: "duplicate key" } });
    const r = await registrarChamada({ admin: f.admin, orgId: ORG, userId: EU, corpo });
    expect(r).toEqual({ ok: true, id: ID, repetida: true });
    expect(audit).not.toHaveBeenCalled();
  });

  it("outro erro do banco é falha", async () => {
    const f = adminFalso({ erroDoInsert: { message: "boom" } });
    const r = await registrarChamada({ admin: f.admin, orgId: ORG, userId: EU, corpo });
    expect(r.ok).toBe(false);
  });

  it("a auditoria leva a direção e o motivo, nunca o telefone", async () => {
    const f = adminFalso();
    await registrarChamada({ admin: f.admin, orgId: ORG, userId: EU, corpo });
    expect(audit).toHaveBeenCalledTimes(1);
    const arg = JSON.stringify(audit.mock.calls[0]);
    expect(arg).toContain("webphone.call_logged");
    expect(arg).not.toContain("21999998888");
  });
});

describe("marcarResultado", () => {
  const minha = { id: ID, created_by: EU, owner_user_id: EU, metadata: { origem: "webphone" } };

  it("quem fez a ligação marca o resultado, e o resto do metadata fica", async () => {
    const f = adminFalso({ linha: minha });
    const r = await marcarResultado({
      admin: f.admin,
      orgId: ORG,
      userId: EU,
      podeEditarAlheias: false,
      id: ID,
      resultado: "pediu_retorno",
    });
    expect(r).toEqual({ ok: true });
    expect(f.atualizados[0]).toEqual({ metadata: { origem: "webphone", resultado: "pediu_retorno" } });
    expect(f.filtros).toContainEqual(["organization_id", ORG]);
  });

  it("outra pessoa não muda a ligação alheia, mas um gerente muda", async () => {
    const alheia = { ...minha, created_by: OUTRO, owner_user_id: OUTRO };
    const sem = await marcarResultado({
      admin: adminFalso({ linha: alheia }).admin,
      orgId: ORG,
      userId: EU,
      podeEditarAlheias: false,
      id: ID,
      resultado: "fechou_negocio",
    });
    expect(sem).toEqual({ ok: false, motivo: "sem_permissao" });
    const gerente = await marcarResultado({
      admin: adminFalso({ linha: alheia }).admin,
      orgId: ORG,
      userId: EU,
      podeEditarAlheias: true,
      id: ID,
      resultado: "fechou_negocio",
    });
    expect(gerente).toEqual({ ok: true });
  });

  it("linha que não existe, ou que não nasceu no webphone, é 'nao_encontrada'", async () => {
    const nenhuma = await marcarResultado({
      admin: adminFalso({ linha: null }).admin,
      orgId: ORG,
      userId: EU,
      podeEditarAlheias: true,
      id: ID,
      resultado: "pediu_retorno",
    });
    expect(nenhuma).toEqual({ ok: false, motivo: "nao_encontrada" });
    const deOutroModulo = await marcarResultado({
      admin: adminFalso({ linha: { ...minha, metadata: {} } }).admin,
      orgId: ORG,
      userId: EU,
      podeEditarAlheias: true,
      id: ID,
      resultado: "pediu_retorno",
    });
    expect(deOutroModulo).toEqual({ ok: false, motivo: "nao_encontrada" });
  });
});
