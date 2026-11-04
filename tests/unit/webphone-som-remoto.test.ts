/**
 * O SOM DA OUTRA PESSOA NA LIGAÇÃO DE SAÍDA.
 *
 * O defeito medido: o CRM ligava, a central mandava voz de verdade (160 bytes por
 * pacote de PCMU), mas o elemento de áudio ficava pausado em `readyState 0` — o
 * navegador só decodifica o que está sendo reproduzido, então nada era decodificado
 * e a pessoa não ouvia ninguém. Na ligação de ENTRADA funcionava. O conserto não
 * depende mais do evento `track`: `garantirSomRemoto` liga e toca o que a conexão
 * recebe, no atendimento e a cada medida. Aqui se prova essa função, com elemento e
 * conexão falsos; NÃO prova áudio de verdade (isso é de uma ligação).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Webphone } from "@/lib/webphone/motor";

class FluxoFalso {
  constructor(private readonly faixas: unknown[]) {}
  getAudioTracks() {
    return this.faixas;
  }
}

type ElementoFalso = { srcObject: unknown; paused: boolean; muted: boolean; volume: number; play: ReturnType<typeof vi.fn> };

function elemento(play: () => Promise<void> = async () => undefined): ElementoFalso {
  const el: ElementoFalso = { srcObject: null, paused: true, muted: true, volume: 0, play: vi.fn() };
  el.play = vi.fn(async () => {
    await play();
    el.paused = false;
  });
  return el;
}

const faixaDeAudio = { kind: "audio" };
const conexao = (faixas: unknown[]) => ({ getReceivers: () => faixas.map((track) => ({ track })) }) as never;

function ligar(el: ElementoFalso, c: unknown) {
  const w = new Webphone({} as never, el as unknown as HTMLAudioElement) as unknown as {
    garantirSomRemoto(c: unknown): void;
  };
  w.garantirSomRemoto(c);
  return el;
}

beforeEach(() => {
  vi.stubGlobal("MediaStream", FluxoFalso);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("garantirSomRemoto", () => {
  it("elemento sem fluxo: liga a faixa que a conexão recebe, tira o mudo e manda tocar", () => {
    const el = ligar(elemento(), conexao([faixaDeAudio]));
    expect(el.srcObject).toBeInstanceOf(FluxoFalso);
    expect((el.srcObject as FluxoFalso).getAudioTracks()).toEqual([faixaDeAudio]);
    expect(el.muted).toBe(false);
    expect(el.volume).toBe(1);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it("já ligado e tocando: não mexe em nada (não reinicia o som a cada medida)", () => {
    const el = elemento();
    el.srcObject = new FluxoFalso([faixaDeAudio]);
    el.paused = false;
    const antes = el.srcObject;
    ligar(el, conexao([faixaDeAudio]));
    expect(el.srcObject).toBe(antes);
    expect(el.play).not.toHaveBeenCalled();
  });

  it("ligado mas pausado: só manda tocar de novo, sem trocar o fluxo", () => {
    const el = elemento();
    el.srcObject = new FluxoFalso([faixaDeAudio]);
    const antes = el.srcObject;
    ligar(el, conexao([faixaDeAudio]));
    expect(el.srcObject).toBe(antes);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it("sem faixa de áudio na conexão, ou sem conexão: não faz nada", () => {
    const el = ligar(elemento(), conexao([{ kind: "video" }]));
    expect(el.srcObject).toBeNull();
    expect(el.play).not.toHaveBeenCalled();
    const outro = ligar(elemento(), undefined);
    expect(outro.srcObject).toBeNull();
  });

  it("o navegador recusar tocar não derruba a chamada", async () => {
    const recusa = elemento(async () => {
      throw Object.assign(new Error("bloqueado"), { name: "NotAllowedError" });
    });
    expect(() => ligar(recusa, conexao([faixaDeAudio]))).not.toThrow();
    await Promise.resolve();
  });
});
