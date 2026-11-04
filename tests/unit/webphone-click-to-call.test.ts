/**
 * O CLICK TO CALL, ponta a ponta, sem central de verdade.
 *
 * As chamadas de rede entram como funções falsas e o relógio é falso: o que se
 * prova é o ROTEIRO — pedir, acompanhar, fechar e gravar — e as decisões de cada
 * fim (atendida, cancelada, sem resposta, falha). NÃO prova que a central toca o
 * ramal nem áudio: isso é de uma ligação de verdade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClickToCall, type DependenciasDoClickToCall } from "@/lib/webphone/click-to-call";
import type { ResultadoDaLigacao, SituacaoDaLigacao } from "@/lib/webphone/config";
import type { RegistroDaChamada } from "@/lib/webphone/motor";

const sem: SituacaoDaLigacao = { estado: "desconhecida", atendida: false, atendida_em: null, encerrada_em: null, falou_s: 0 };
const chamando: SituacaoDaLigacao = { ...sem, estado: "chamando" };

function montar(opcoes: { consultar?: DependenciasDoClickToCall["consultar"]; ligar?: DependenciasDoClickToCall["ligar"] } = {}) {
  const deps = {
    ligar: vi.fn(opcoes.ligar ?? (async (_crmId: string, _numero: string) => undefined)),
    consultar: vi.fn(opcoes.consultar ?? (async (_crmId: string) => chamando)),
    desligar: vi.fn(async (_crmId: string) => undefined),
    aoEncerrar: vi.fn(async (_registro: RegistroDaChamada) => undefined),
    aoEscolherResultado: vi.fn(async (_id: string, _resultado: ResultadoDaLigacao) => undefined),
  };
  const c = new ClickToCall(deps, { intervaloMs: 1000, semNoticiaMs: 10_000, falhasSeguidas: 3 });
  return { c, deps };
}

/** Deixa as promessas pendentes resolverem e avança o relógio. */
async function passar(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T13:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ClickToCall — pedir a ligação", () => {
  it("pede à central com o número só em dígitos e mostra 'chamando'", async () => {
    const { c, deps } = montar();
    expect(c.discar("(21) 99999-8888")).toBe(true);
    expect(c.instantaneo().chamada).toMatchObject({ direcao: "saida", numero: "21999998888", estado: "chamando" });
    await passar(0);
    expect(deps.ligar).toHaveBeenCalledTimes(1);
    expect(deps.ligar.mock.calls[0]?.[1]).toBe("21999998888");
    c.parar();
  });

  it("não deixa pedir duas ligações ao mesmo tempo, nem número que não dá para discar", async () => {
    const { c } = montar();
    expect(c.discar("123")).toBe(false);
    expect(c.discar("21999998888")).toBe(true);
    expect(c.discar("21988887777")).toBe(false);
    c.parar();
  });

  it("não tem áudio: avisa pelas capacidades, e atender/mudo/teclado não fazem nada", () => {
    const { c } = montar();
    expect(c.capacidades).toEqual({ controlesDeAudio: false, atendePeloCrm: false });
    c.discar("21999998888");
    c.alternarMudo();
    c.alternarEspera();
    c.enviarTom();
    c.atender();
    expect(c.instantaneo().chamada).toMatchObject({ mudo: false, emEspera: false });
    c.parar();
  });

  it("se a central recusa o pedido, a tela mostra o motivo e nada é gravado", async () => {
    const { c, deps } = montar({
      ligar: async () => {
        throw new Error("O ramal 0359 não está registrado.");
      },
    });
    c.discar("21999998888");
    await passar(0);
    const f = c.instantaneo().fechamento;
    expect(c.instantaneo().chamada).toBeNull();
    expect(f).toMatchObject({ atendida: false, erro: "O ramal 0359 não está registrado." });
    expect(deps.aoEncerrar).not.toHaveBeenCalled();
    c.parar();
  });
});

describe("ClickToCall — acompanhar e fechar", () => {
  it("ao atender, passa a 'em andamento' com o horário que a central informou", async () => {
    const atendida = "2026-11-04T13:00:05.000Z";
    const { c } = montar({ consultar: async () => ({ ...sem, estado: "em_andamento", atendida: true, atendida_em: atendida }) });
    c.discar("21999998888");
    await passar(1000);
    expect(c.instantaneo().chamada).toMatchObject({ estado: "em_andamento", atendidaEm: Date.parse(atendida) });
    c.parar();
  });

  it("ligação atendida que acabou vira fechamento com a duração da CENTRAL e é gravada com o mesmo id", async () => {
    let n = 0;
    const { c, deps } = montar({
      consultar: async () => {
        n += 1;
        return n === 1
          ? { ...sem, estado: "em_andamento", atendida: true, atendida_em: "2026-11-04T13:00:05.000Z" }
          : { ...sem, estado: "encerrada", atendida: true, atendida_em: "2026-11-04T13:00:05.000Z", encerrada_em: "2026-11-04T13:02:19.000Z", falou_s: 134 };
      },
    });
    c.discar("21999998888");
    await passar(2000);
    expect(c.instantaneo().chamada).toBeNull();
    expect(c.instantaneo().fechamento).toMatchObject({ atendida: true, perdida: false, duracaoS: 134, erro: null });
    expect(deps.aoEncerrar).toHaveBeenCalledTimes(1);
    const registro = deps.aoEncerrar.mock.calls[0]?.[0] as { id: string; motivo: string; direcao: string };
    expect(registro).toMatchObject({ direcao: "saida", motivo: "user_ended" });
    expect(registro.id).toBe(deps.ligar.mock.calls[0]?.[0]);
    c.parar();
  });

  it("sem atendimento: 'timeout' se ninguém pegou, 'cancelled' se a pessoa desligou antes", async () => {
    const encerrada: SituacaoDaLigacao = { ...sem, estado: "encerrada", encerrada_em: "2026-11-04T13:00:20.000Z" };

    const a = montar({ consultar: async () => encerrada });
    a.c.discar("21999998888");
    await passar(1000);
    expect((a.deps.aoEncerrar.mock.calls[0]?.[0] as { motivo: string }).motivo).toBe("timeout");
    a.c.parar();

    const b = montar({ consultar: async () => encerrada });
    b.c.discar("21999998888");
    b.c.encerrar();
    await passar(1000);
    expect(b.deps.desligar).toHaveBeenCalledTimes(1);
    expect((b.deps.aoEncerrar.mock.calls[0]?.[0] as { motivo: string }).motivo).toBe("cancelled");
    b.c.parar();
  });

  it("a central que não sabe da ligação por tempo demais é falha, gravada", async () => {
    const { c, deps } = montar({ consultar: async () => sem });
    c.discar("21999998888");
    await passar(12_000);
    expect(c.instantaneo().chamada).toBeNull();
    expect(c.instantaneo().fechamento?.erro).toMatch(/não confirmou/);
    expect((deps.aoEncerrar.mock.calls[0]?.[0] as { motivo: string }).motivo).toBe("failed");
    c.parar();
  });

  it("consultas que falham em sequência encerram a ligação com falha; uma falha só, não", async () => {
    let n = 0;
    const uma = montar({
      consultar: async () => {
        n += 1;
        if (n === 1) throw new Error("rede");
        return chamando;
      },
    });
    uma.c.discar("21999998888");
    await passar(3000);
    expect(uma.c.instantaneo().chamada).not.toBeNull();
    uma.c.parar();

    const todas = montar({
      consultar: async () => {
        throw new Error("rede");
      },
    });
    todas.c.discar("21999998888");
    await passar(4000);
    expect(todas.c.instantaneo().chamada).toBeNull();
    expect(todas.c.instantaneo().fechamento?.erro).toMatch(/perdeu o contato/);
    todas.c.parar();
  });
});

describe("ClickToCall — o resultado da ligação", () => {
  it("só grava o resultado depois que o registro da ligação terminou", async () => {
    const ordem: string[] = [];
    let soltar: () => void = () => undefined;
    const registroLento = new Promise<void>((r) => {
      soltar = r;
    });
    const { c, deps } = montar({ consultar: async () => ({ ...sem, estado: "encerrada", atendida: true, atendida_em: "2026-11-04T13:00:02.000Z", falou_s: 30 }) });
    deps.aoEncerrar.mockImplementation(async () => {
      await registroLento;
      ordem.push("registro");
    });
    deps.aoEscolherResultado.mockImplementation(async () => {
      ordem.push("resultado");
    });
    c.discar("21999998888");
    await passar(1000);
    c.escolherResultado("pediu_retorno");
    expect(c.instantaneo().fechamento?.resultado).toBe("pediu_retorno");
    await passar(0);
    expect(ordem).toEqual([]);
    soltar();
    await passar(0);
    expect(ordem).toEqual(["registro", "resultado"]);
    c.parar();
  });

  it("fechar o cartão limpa o fechamento", async () => {
    const { c } = montar({ consultar: async () => ({ ...sem, estado: "encerrada", atendida: true, falou_s: 5 }) });
    c.discar("21999998888");
    await passar(1000);
    expect(c.instantaneo().fechamento).not.toBeNull();
    c.fecharFechamento();
    expect(c.instantaneo().fechamento).toBeNull();
    c.parar();
  });
});
