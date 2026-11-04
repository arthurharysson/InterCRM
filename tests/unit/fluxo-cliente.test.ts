/**
 * O CLIENTE DA CENTRAL: o que ele manda, o que ele entende e o que NUNCA vaza.
 *
 * `fetch` é simulado com o formato que a documentação pública da central mostra
 * (`/pages/api`). NÃO prova que a central de verdade responde assim — a conferência
 * com a central real é de quem liga com o ramal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ErroDaCentral,
  consultarLigacao,
  desligarPeloCrmId,
  lerConfigDaCentral,
  ligarPeloRamal,
  listarRamaisDaCentral,
  situacaoDaLigacao,
} from "@/lib/fluxo/cliente";
import { telefoneParaCentral } from "@/lib/webphone/config";

const config = { baseUrl: "https://central.example.com/app/api/integra", token: "SEGREDO-DO-TOKEN" };
const fetchFalso = vi.fn();

function responder(corpo: unknown, status = 200) {
  fetchFalso.mockResolvedValueOnce(new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  fetchFalso.mockReset();
  vi.stubGlobal("fetch", fetchFalso);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lerConfigDaCentral", () => {
  it("sem endereço ou sem token, não há central", () => {
    expect(lerConfigDaCentral({})).toBeNull();
    expect(lerConfigDaCentral({ FLUXO_API_URL: "https://x" })).toBeNull();
    expect(lerConfigDaCentral({ FLUXO_API_TOKEN: "t" })).toBeNull();
  });
  it("tira a barra do fim do endereço", () => {
    expect(lerConfigDaCentral({ FLUXO_API_URL: "https://x/api/", FLUXO_API_TOKEN: "t" })).toEqual({ baseUrl: "https://x/api", token: "t" });
  });
});

describe("telefoneParaCentral", () => {
  it("põe o 55 em telefone brasileiro sem código de país", () => {
    expect(telefoneParaCentral("(21) 99999-8888")).toBe("5521999998888");
    expect(telefoneParaCentral("2133334444")).toBe("552133334444");
  });
  it("mantém o que já vem com código de país e recusa o que é curto demais", () => {
    expect(telefoneParaCentral("+55 21 99999-8888")).toBe("5521999998888");
    expect(telefoneParaCentral("123")).toBeNull();
  });
});

describe("pedidos à central", () => {
  it("ligar manda o token no cabeçalho api-token e o corpo que a documentação pede", async () => {
    responder({ status: "OK", message: "Command Originate Sent to PBX" });
    await ligarPeloRamal(config, { ramal: "0359", telefone: "5521999998888", crmId: "abc" });
    const [url, init] = fetchFalso.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://central.example.com/app/api/integra/call/exten/originate");
    expect((init.headers as Record<string, string>)["api-token"]).toBe("SEGREDO-DO-TOKEN");
    expect(JSON.parse(String(init.body))).toEqual({ extension: "0359", phone: "5521999998888", crm_id: "abc" });
  });

  it("recusa da central vira erro legível, e o token nunca entra na mensagem", async () => {
    responder({ status: "ERROR", message: "Extension not registered" });
    const erro = await ligarPeloRamal(config, { ramal: "0359", telefone: "5521999998888", crmId: "abc" }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDaCentral);
    expect(erro.message).toBe("Extension not registered");
    expect(JSON.stringify([erro.message, erro.stack])).not.toContain("SEGREDO-DO-TOKEN");
  });

  it("central fora do ar é 'indisponivel', sem expor o endereço nem o token", async () => {
    fetchFalso.mockRejectedValueOnce(new Error("ECONNREFUSED https://central.example.com SEGREDO-DO-TOKEN"));
    const erro = await desligarPeloCrmId(config, "abc").catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDaCentral);
    expect(erro.motivo).toBe("indisponivel");
    expect(erro.message).not.toContain("SEGREDO-DO-TOKEN");
    expect(erro.message).not.toContain("central.example.com");
  });

  it("HTTP de erro usa a mensagem da central, ou uma genérica", async () => {
    responder({ message: "token inválido" }, 401);
    expect((await desligarPeloCrmId(config, "a").catch((e) => e)).message).toBe("token inválido");
    responder({}, 500);
    expect((await desligarPeloCrmId(config, "a").catch((e) => e)).message).toMatch(/500/);
  });
});

describe("a situação da ligação", () => {
  const base = { datetime_start: "2026-11-04T13:00:00.000Z" };

  it("DIALING é tocando", () => {
    expect(situacaoDaLigacao({ ...base, status: "DIALING", active: true })).toMatchObject({ estado: "chamando", atendida: false });
  });
  it("ONCALL e ANSWERED ativos são conversa, com o horário do atendimento", () => {
    const s = situacaoDaLigacao({ ...base, status: "ONCALL", active: true, datetime_answer: "2026-11-04T13:00:09.000Z" });
    expect(s).toMatchObject({ estado: "em_andamento", atendida: true, atendida_em: "2026-11-04T13:00:09.000Z" });
  });
  it("active false é o fim, com a duração de conversa que a central informou", () => {
    const s = situacaoDaLigacao({
      ...base,
      status: "ANSWERED",
      active: false,
      datetime_answer: "2026-11-04T13:00:09.000Z",
      datetime_end: "2026-11-04T13:02:00.000Z",
      talk_time: 111,
    });
    expect(s).toMatchObject({ estado: "encerrada", atendida: true, falou_s: 111, encerrada_em: "2026-11-04T13:02:00.000Z" });
  });
  it("encerrada sem atendimento não é atendida", () => {
    expect(situacaoDaLigacao({ ...base, status: "DIALING", active: false })).toMatchObject({ estado: "encerrada", atendida: false });
  });
  it("lixo ou ausência é 'desconhecida', nunca um erro", () => {
    expect(situacaoDaLigacao(null).estado).toBe("desconhecida");
    expect(situacaoDaLigacao("texto").estado).toBe("desconhecida");
    expect(situacaoDaLigacao({ status: "OUTRA_COISA" }).estado).toBe("desconhecida");
  });

  it("consultar uma ligação que a central ainda não registrou é 'desconhecida', não falha", async () => {
    responder({ status: "ERROR", message: "Not found" }, 404);
    expect((await consultarLigacao(config, "abc")).estado).toBe("desconhecida");
  });

  it("consultar lê a linha em `data`", async () => {
    responder({ status: "OK", data: { status: "DIALING", active: true } });
    expect((await consultarLigacao(config, "abc")).estado).toBe("chamando");
  });
});

describe("a lista de ramais", () => {
  it("ordena em ordem numérica, aceita número ou texto e ignora linha estragada", async () => {
    responder([
      { id: 3, extension: "1000", login: "1000_1000", callerid: "1000" },
      { id: 1, extension: 359, login: null, callerid: null },
      { id: 2, extension: "20", login: "1000_20", callerid: "Maria" },
      { quebrada: true },
    ]);
    const ramais = await listarRamaisDaCentral(config);
    expect(ramais.map((r) => r.extension)).toEqual(["20", "359", "1000"]);
    expect(ramais[0]).toEqual({ id: 2, extension: "20", login: "1000_20", callerid: "Maria" });
  });
});
