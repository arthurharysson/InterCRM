/**
 * O AVISO DE ENCERRAMENTO AO CANAL: quando a equipe fecha o atendimento, o canal que tem uma tela do outro lado
 * (o chat web) é avisado — e o aviso NUNCA derruba o fechamento. A rota que fecha não sabe qual canal é.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdapter = vi.fn();
vi.mock("@/lib/channels/index", () => ({ getAdapter: (...a: unknown[]) => getAdapter(...a) }));

import { avisarEncerramentoAoCanal } from "@/lib/channels/encerramento";

type Linha = Record<string, unknown> | null;

function banco(tabelas: { conversations: Linha; channel_sessions: Linha }) {
  const consultas: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
  const admin = {
    from: (tabela: "conversations" | "channel_sessions") => {
      const filtros: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filtros.push([c, v]);
          return q;
        },
        maybeSingle: async () => {
          consultas.push({ tabela, filtros });
          return { data: tabelas[tabela], error: null };
        },
      };
      return q;
    },
  };
  return { admin: admin as never, consultas };
}

const CONVERSA = { channel_session_id: "sessao-1", provider_conversation_id: "web:abc" };
const SESSAO = { provider: "chat_externo", chat_externo_ref: "principal" };

beforeEach(() => getAdapter.mockReset());

describe("avisarEncerramentoAoCanal", () => {
  it("avisa o canal com a identidade do transporte e a referência da sessão", async () => {
    const aviso = vi.fn().mockResolvedValue(undefined);
    getAdapter.mockReturnValue({ notificarEncerramento: aviso });
    const { admin } = banco({ conversations: CONVERSA, channel_sessions: SESSAO });

    await avisarEncerramentoAoCanal(admin, { organizationId: "org-1", conversationId: "conv-1", closedAt: "2026-11-13T15:00:00Z" });

    expect(getAdapter).toHaveBeenCalledWith("chat_externo");
    expect(aviso).toHaveBeenCalledWith({
      organizationId: "org-1",
      sessionRef: "principal",
      providerConversationId: "web:abc",
      conversationId: "conv-1",
      closedAt: "2026-11-13T15:00:00Z",
    });
  });

  it("filtra a conversa e a sessão pela ORGANIZAÇÃO (o client é de service role)", async () => {
    getAdapter.mockReturnValue({ notificarEncerramento: vi.fn() });
    const { admin, consultas } = banco({ conversations: CONVERSA, channel_sessions: SESSAO });
    await avisarEncerramentoAoCanal(admin, { organizationId: "org-1", conversationId: "conv-1" });
    expect(consultas).toHaveLength(2);
    for (const c of consultas) expect(c.filtros).toContainEqual(["organization_id", "org-1"]);
  });

  it.each([
    ["conversa sem sessão de canal", { channel_session_id: null, provider_conversation_id: "web:abc" }],
    ["conversa sem identidade no transporte (WhatsApp)", { channel_session_id: "s", provider_conversation_id: null }],
    ["conversa que não existe", null],
  ])("%s: não há para quem avisar, e nem procura adapter", async (_n, conversa) => {
    const { admin } = banco({ conversations: conversa, channel_sessions: SESSAO });
    await avisarEncerramentoAoCanal(admin, { organizationId: "org-1", conversationId: "conv-1" });
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("canal que não quer ser avisado (sem o método): não faz nada e não lança", async () => {
    getAdapter.mockReturnValue({});
    const { admin } = banco({ conversations: CONVERSA, channel_sessions: SESSAO });
    await expect(
      avisarEncerramentoAoCanal(admin, { organizationId: "org-1", conversationId: "conv-1" }),
    ).resolves.toBeUndefined();
  });

  it("o aviso que FALHA não derruba o fechamento: a função resolve normalmente", async () => {
    getAdapter.mockReturnValue({ notificarEncerramento: vi.fn().mockRejectedValue(new Error("chat_externo_close_notice_failed_503")) });
    const { admin } = banco({ conversations: CONVERSA, channel_sessions: SESSAO });
    await expect(
      avisarEncerramentoAoCanal(admin, { organizationId: "org-1", conversationId: "conv-1" }),
    ).resolves.toBeUndefined();
  });
});
