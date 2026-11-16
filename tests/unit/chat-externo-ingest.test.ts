/**
 * A INGESTÃO DO CHAT EXTERNO contra um banco em memória.
 *
 * O que se prova aqui: o cliente que abre o link vira UMA conversa na Fila (com o setor do bot, quando o módulo
 * está ligado e o código existe), o histórico do bot entra marcado e SEM efeito nenhum, o reenvio de qualquer
 * evento não duplica nada, e o CPF reaproveita o contato em vez de criar outro.
 *
 * O que NÃO se prova aqui (e está dito ao fim do arquivo): o SQL de verdade. As RPCs (`fn_upsert_wa_conversation`,
 * `fn_request_channel_routing`) e as constraints únicas são SIMULADAS; quem as exercita é `pnpm test:db`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const moduloLigado = vi.fn();
const aplicarEfeitosPosEntrada = vi.fn();
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: (...a: unknown[]) => moduloLigado(...a) }));
vi.mock("@/lib/channels/pos-entrada", () => ({
  aplicarEfeitosPosEntrada: (...a: unknown[]) => aplicarEfeitosPosEntrada(...a),
}));

import { lerEventoDoChat, type EventoDoChat } from "@/lib/channels/chat-externo/contrato";
import { ingerirEventoDoChat } from "@/lib/channels/chat-externo/ingest";

type Linha = Record<string, unknown>;

const ORG = "org-1";
const SESSAO = "sessao-1";
const ID_1 = "web:11111111-1111-4111-8111-111111111111";
const ID_2 = "web:22222222-2222-4222-8222-222222222222";
const CPF = "12345678909";

/** Banco em memória com só o que a ingestão usa. As chaves únicas são as do banco de verdade. */
function bancoEmMemoria(semente: { attendant_sectors?: Linha[] } = {}) {
  const t = {
    contacts: [] as Linha[],
    conversations: [] as Linha[],
    messages: [] as Linha[],
    attendant_sectors: semente.attendant_sectors ?? ([] as Linha[]),
  };
  const tabela_ = (nome: string): Linha[] => (t as unknown as Record<string, Linha[]>)[nome] ?? [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  let n = 0;
  const novoId = () => `id-${++n}`;

  function violaUnico(tabela: string, linha: Linha): boolean {
    const outras = tabela_(tabela);
    if (tabela === "contacts") {
      return outras.some(
        (o) =>
          o.organization_id === linha.organization_id &&
          ((linha.social_identity != null && o.social_identity === linha.social_identity) ||
            (linha.cpf_hash != null && o.cpf_hash === linha.cpf_hash)),
      );
    }
    if (tabela === "messages") {
      return outras.some(
        (o) => o.organization_id === linha.organization_id && linha.external_id != null && o.external_id === linha.external_id,
      );
    }
    return false;
  }

  function from(tabela: string) {
    const filtros: Array<[string, unknown]> = [];
    const nulos: string[] = [];
    let acao: "select" | "insert" | "update" = "select";
    let carga: Linha = {};

    const casam = () =>
      tabela_(tabela).filter((l) => filtros.every(([c, v]) => l[c] === v) && nulos.every((c) => l[c] == null));

    async function executar(unica: boolean) {
      if (acao === "insert") {
        if (violaUnico(tabela, carga)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        const linha = { id: novoId(), ...carga };
        tabela_(tabela).push(linha);
        return { data: { id: linha.id }, error: null };
      }
      if (acao === "update") {
        for (const l of casam()) Object.assign(l, carga);
        return { data: null, error: null };
      }
      const achadas = casam();
      if (unica && achadas.length === 0) return { data: null, error: { code: "PGRST116", message: "0 rows" } };
      return { data: achadas[0] ?? null, error: null };
    }

    const api: Record<string, unknown> = {
      select: () => api,
      insert: (l: Linha) => {
        acao = "insert";
        carga = l;
        return api;
      },
      update: (l: Linha) => {
        acao = "update";
        carga = l;
        return api;
      },
      eq: (c: string, v: unknown) => {
        filtros.push([c, v]);
        return api;
      },
      is: (c: string, v: unknown) => {
        if (v === null) nulos.push(c);
        return api;
      },
      maybeSingle: () => executar(false),
      single: () => executar(true),
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => executar(false).then(ok, ko),
    };
    return api;
  }

  async function rpc(nome: string, args: Record<string, unknown>) {
    rpcs.push({ nome, args });
    if (nome === "encrypt_cpf") return { data: new Uint8Array([1, 2, 3]), error: null };
    if (nome === "fn_upsert_wa_conversation") {
      let conversa = t.conversations.find(
        (c) =>
          c.organization_id === args.p_org && c.contact_id === args.p_contact && c.channel_session_id === args.p_session,
      );
      if (!conversa) {
        conversa = {
          id: novoId(),
          organization_id: args.p_org,
          contact_id: args.p_contact,
          channel_session_id: args.p_session,
          status: "open",
          assigned_to_user_id: null,
        };
        t.conversations.push(conversa);
      }
      return { data: conversa.id, error: null };
    }
    return { data: null, error: null };
  }

  return { admin: { from, rpc } as never, t, rpcs };
}

function evento(corpo: Record<string, unknown>): EventoDoChat {
  const r = lerEventoDoChat(JSON.stringify(corpo));
  if (!r.ok) throw new Error(`evento de teste inválido: ${JSON.stringify(r)}`);
  return r.evento;
}

const entrada = { organizationId: ORG, channelSessionId: SESSAO };

const INICIO = {
  event: "chat.started",
  identity: ID_1,
  started_at: "2026-11-13T14:00:00Z",
  sector: "suporte-tecnico",
  contact: { name: "Maria", cpf: CPF },
  history: [
    { message_id: "bot_001", from: "customer", text: "Preciso de suporte", sent_at: "2026-11-13T13:58:01Z" },
    { message_id: "bot_002", from: "bot", text: "Qual o seu CPF?", sent_at: "2026-11-13T13:58:03Z" },
  ],
};

beforeEach(() => {
  moduloLigado.mockReset().mockResolvedValue(true);
  aplicarEfeitosPosEntrada.mockReset().mockResolvedValue(undefined);
});

describe("chat.started", () => {
  it("abre a conversa na Fila com o setor do bot, importa o histórico marcado e NÃO dispara efeito nenhum", async () => {
    const { admin, t, rpcs } = bancoEmMemoria({
      attendant_sectors: [{ id: "setor-1", organization_id: ORG, external_code: "suporte-tecnico" }],
    });

    const r = await ingerirEventoDoChat(admin, { ...entrada, evento: evento(INICIO) });

    expect(r).toMatchObject({ status: "ingested", setorAplicado: true, historicoImportado: 2 });

    // contato com o CPF cifrado + hash (o par que a constraint exige), identificado pelo chat
    expect(t.contacts).toHaveLength(1);
    expect(t.contacts[0]!).toMatchObject({ organization_id: ORG, social_identity: ID_1, name: "Maria", source: "web" });
    expect(t.contacts[0]!.cpf_hash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(t.contacts[0]!.cpf_encrypted).toBeInstanceOf(Uint8Array);

    // conversa: canal web, apontando para a identidade do chat e para o setor
    expect(t.conversations).toHaveLength(1);
    expect(t.conversations[0]!).toMatchObject({ provider_conversation_id: ID_1, channel: "web", sector_id: "setor-1" });
    // e pede a distribuição de novo, pela MESMA rpc que a rota do setor usa
    expect(rpcs.some((x) => x.nome === "fn_request_channel_routing")).toBe(true);

    // histórico: ids prefixados pela identidade, marcado, direção certa
    expect(t.messages).toHaveLength(2);
    expect(t.messages[0]!).toMatchObject({
      external_id: `chat_externo:${ID_1}:bot_001`,
      direction: "inbound",
      sent_via: "external_device",
      metadata: { source: "chat_externo", importado_do_bot: true, origem: "customer" },
    });
    expect(t.messages[1]!).toMatchObject({ direction: "outbound", sent_via: "automation" });

    // o histórico é contexto, não atividade: nenhum alerta, agente ou automação
    expect(aplicarEfeitosPosEntrada).not.toHaveBeenCalled();
    expect(rpcs.some((x) => x.nome === "fn_mark_conversation_message")).toBe(false);

    // mas a lista da Fila não pode mostrar "Sem mensagens": a prévia e a data vêm da última do histórico
    expect(t.conversations[0]!).toMatchObject({
      last_message_preview: "Qual o seu CPF?",
      last_message_at: "2026-11-13T13:58:03.000Z",
    });
    // e NADA que seja relógio de espera ou não-lida é tocado (só a RPC de atividade faz isso)
    expect(t.conversations[0]!).not.toHaveProperty("unread_count_for_assignee");
    expect(t.conversations[0]!).not.toHaveProperty("awaiting_since");
  });

  it("chat.started sem histórico não inventa prévia", async () => {
    const { admin, t } = bancoEmMemoria({});
    await ingerirEventoDoChat(admin, { ...entrada, evento: evento({ ...INICIO, sector: undefined, history: [] }) });
    expect(t.conversations[0]!).not.toHaveProperty("last_message_preview");
  });

  it("reenviar o MESMO chat.started não duplica contato, conversa nem histórico", async () => {
    const { admin, t } = bancoEmMemoria({
      attendant_sectors: [{ id: "setor-1", organization_id: ORG, external_code: "suporte-tecnico" }],
    });
    const primeiro = await ingerirEventoDoChat(admin, { ...entrada, evento: evento(INICIO) });
    const segundo = await ingerirEventoDoChat(admin, { ...entrada, evento: evento(INICIO) });

    expect(primeiro.status).toBe("ingested");
    expect(segundo).toMatchObject({ status: "duplicate", conversationId: primeiro.conversationId });
    expect([t.contacts.length, t.conversations.length, t.messages.length]).toEqual([1, 1, 2]);
  });

  it.each([
    ["módulo de setores desligado", { ligado: false, codigo: "suporte-tecnico", setores: true }, "setores_desligado"],
    ["código que o CRM não conhece", { ligado: true, codigo: "financeiro", setores: true }, "codigo_desconhecido"],
    ["o bot não mandou setor", { ligado: true, codigo: null, setores: true }, "sem_codigo"],
  ] as const)("%s: o cliente ENTRA na Fila sem setor e o desfecho diz por quê", async (_nome, cfg, motivo) => {
    moduloLigado.mockResolvedValue(cfg.ligado);
    const { admin, t } = bancoEmMemoria({
      attendant_sectors: [{ id: "setor-1", organization_id: ORG, external_code: "suporte-tecnico" }],
    });
    const corpo = { ...INICIO, sector: cfg.codigo ?? undefined };

    const r = await ingerirEventoDoChat(admin, { ...entrada, evento: evento(corpo) });

    expect(r).toMatchObject({ status: "ingested", setorAplicado: false, setorMotivo: motivo });
    expect(t.conversations).toHaveLength(1);
    expect(t.conversations[0]!.sector_id).toBeUndefined();
  });

  it("o setor é procurado SÓ na organização do canal (nunca em outra)", async () => {
    const { admin, t } = bancoEmMemoria({
      attendant_sectors: [{ id: "setor-de-outra-org", organization_id: "org-2", external_code: "suporte-tecnico" }],
    });
    const r = await ingerirEventoDoChat(admin, { ...entrada, evento: evento(INICIO) });
    expect(r).toMatchObject({ setorAplicado: false, setorMotivo: "codigo_desconhecido" });
    expect(t.conversations[0]!.sector_id).toBeUndefined();
  });

  it("segundo chat do MESMO CPF reaproveita o contato (não cria outro) e a conversa passa a apontar para o link novo", async () => {
    const { admin, t } = bancoEmMemoria();
    await ingerirEventoDoChat(admin, { ...entrada, evento: evento({ ...INICIO, sector: undefined, history: [] }) });
    const r = await ingerirEventoDoChat(admin, {
      ...entrada,
      evento: evento({ ...INICIO, identity: ID_2, sector: undefined, history: [] }),
    });

    expect(r.status).toBe("ingested");
    expect(t.contacts).toHaveLength(1);
    expect(t.conversations).toHaveLength(1);
    expect(t.conversations[0]!.provider_conversation_id).toBe(ID_2);
  });
});

describe("message", () => {
  it("grava a mensagem do cliente, carimba a conversa e dispara os efeitos de sempre", async () => {
    const { admin, t, rpcs } = bancoEmMemoria();
    await ingerirEventoDoChat(admin, { ...entrada, evento: evento({ ...INICIO, sector: undefined, history: [] }) });

    const r = await ingerirEventoDoChat(admin, {
      ...entrada,
      requestId: "req-1",
      evento: evento({ identity: ID_1, text: "Minha internet caiu", message_id: "msg-1", sender_name: "Maria" }),
    });

    expect(r).toMatchObject({ status: "ingested" });
    const msg = t.messages.find((m) => m.external_id === "msg-1");
    expect(msg).toMatchObject({ direction: "inbound", sent_via: "external_device", body: "Minha internet caiu" });
    expect(rpcs.some((x) => x.nome === "fn_mark_conversation_message")).toBe(true);
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledTimes(1);
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ organizationId: ORG, texto: "Minha internet caiu", origem: "chat_externo_webhook", canal: "web", optOutPorPalavra: false }),
    );
  });

  it("mesmo message_id duas vezes: a segunda é duplicata e NÃO repete os efeitos", async () => {
    const { admin, t } = bancoEmMemoria();
    const msg = evento({ identity: ID_1, text: "oi", message_id: "msg-1" });
    const a = await ingerirEventoDoChat(admin, { ...entrada, evento: msg });
    const b = await ingerirEventoDoChat(admin, { ...entrada, evento: msg });

    expect(a.status).toBe("ingested");
    expect(b.status).toBe("duplicate");
    expect(t.messages.filter((m) => m.external_id === "msg-1")).toHaveLength(1);
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledTimes(1);
  });

  it("message ANTES do chat.started abre a conversa na hora (perder a mensagem pela ordem seria pior)", async () => {
    const { admin, t } = bancoEmMemoria();
    const r = await ingerirEventoDoChat(admin, {
      ...entrada,
      evento: evento({ identity: ID_1, text: "oi", message_id: "msg-1", sender_name: "Maria" }),
    });
    expect(r.status).toBe("ingested");
    expect(t.conversations).toHaveLength(1);
    expect(t.contacts[0]!).toMatchObject({ social_identity: ID_1, name: "Maria" });
  });
});

describe("chat.closed_by_customer", () => {
  it("conversa que o CRM não conhece: ignorado, sem criar nada", async () => {
    const { admin, t } = bancoEmMemoria();
    const r = await ingerirEventoDoChat(admin, {
      ...entrada,
      evento: evento({ event: "chat.closed_by_customer", identity: ID_1 }),
    });
    expect(r).toMatchObject({ status: "ignored", reason: "conversa_desconhecida" });
    expect(t.conversations).toHaveLength(0);
  });

  it("registra UM aviso de sistema e NÃO fecha a conversa; o reenvio vira duplicata", async () => {
    const { admin, t } = bancoEmMemoria();
    await ingerirEventoDoChat(admin, { ...entrada, evento: evento({ ...INICIO, sector: undefined, history: [] }) });
    const fim = evento({ event: "chat.closed_by_customer", identity: ID_1 });

    const a = await ingerirEventoDoChat(admin, { ...entrada, evento: fim });
    const b = await ingerirEventoDoChat(admin, { ...entrada, evento: fim });

    expect(a.status).toBe("ingested");
    expect(b.status).toBe("duplicate");
    const avisos = t.messages.filter((m) => (m.metadata as Linha)?.aviso_de_sistema === "encerrado_pelo_cliente");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!).toMatchObject({ sent_via: "system", direction: "outbound" });
    // o encerramento tem regras próprias (motivo, caso, avaliação) que ainda não foram ligadas a este canal
    expect(t.conversations[0]!.status).toBe("open");
  });
});

/*
 * O QUE ESTE ARQUIVO NÃO PROVA: o SQL real. `fn_upsert_wa_conversation`, `fn_request_channel_routing`, o índice único
 * por CPF, a constraint `contacts_cpf_consistency` e a unicidade de `messages.external_id` são simulados acima.
 * A prova delas é `pnpm test:db` (Postgres efêmero), que precisa do Docker ligado.
 */
