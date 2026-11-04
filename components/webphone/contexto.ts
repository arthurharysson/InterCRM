"use client";
/**
 * O contexto do webphone, separado do provider para a tela (`WebphoneDock`) e o
 * provider não se importarem em círculo.
 */
import { createContext, useContext } from "react";

import type { ResultadoDaLigacao } from "@/lib/webphone/config";
import type { InstantaneoDoWebphone } from "@/lib/webphone/motor";
import type { CapacidadesDoTelefone } from "@/lib/webphone/telefone";

export const SEM_MOTOR: InstantaneoDoWebphone = { registro: "offline", chamada: null, fechamento: null, microfoneNegado: false };

export interface ContextoDoWebphone extends InstantaneoDoWebphone {
  /** A pessoa tem telefone (organização ligou + ramal ativo). Falso = nenhuma peça é desenhada. */
  disponivel: boolean;
  /** O que este telefone sabe fazer: o embutido tem áudio, o Click to Call não. */
  capacidades: CapacidadesDoTelefone;
  /** Endereço da janela da central, quando a organização informou. */
  painelUrl: string | null;
  /** Abre a janela pequena da central (onde o áudio acontece no Click to Call). */
  abrirJanela: () => void;
  /** Liga para o número. `false` quando não dá (sem registro, já em chamada). */
  discar: (numero: string) => boolean;
  atender: () => void;
  encerrar: () => void;
  alternarMudo: () => void;
  alternarEspera: () => void;
  enviarTom: (tom: string) => void;
  /** Tenta tocar de novo o som que o navegador bloqueou. */
  ativarSom: () => void;
  /** A pessoa marcou como foi a ligação que acabou de terminar. */
  escolherResultado: (resultado: ResultadoDaLigacao) => void;
  /** Fecha o cartão que fica na tela depois da ligação. */
  fecharFechamento: () => void;
}

export const SEM_WEBPHONE: ContextoDoWebphone = {
  ...SEM_MOTOR,
  disponivel: false,
  capacidades: { controlesDeAudio: false, atendePeloCrm: false },
  painelUrl: null,
  abrirJanela: () => undefined,
  discar: () => false,
  atender: () => undefined,
  encerrar: () => undefined,
  alternarMudo: () => undefined,
  alternarEspera: () => undefined,
  enviarTom: () => undefined,
  ativarSom: () => undefined,
  escolherResultado: () => undefined,
  fecharFechamento: () => undefined,
};

export const CtxDoWebphone = createContext<ContextoDoWebphone>(SEM_WEBPHONE);

/** Seguro fora do provider: devolve "sem webphone", e o botão de ligar simplesmente não aparece. */
export function useWebphone(): ContextoDoWebphone {
  return useContext(CtxDoWebphone);
}
