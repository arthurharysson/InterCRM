"use client";
/**
 * O contexto do webphone, separado do provider para a tela (`WebphoneDock`) e o
 * provider não se importarem em círculo.
 */
import { createContext, useContext } from "react";

import type { InstantaneoDoWebphone } from "@/lib/webphone/motor";

export const SEM_MOTOR: InstantaneoDoWebphone = { registro: "offline", chamada: null, microfoneNegado: false };

export interface ContextoDoWebphone extends InstantaneoDoWebphone {
  /** A pessoa tem webphone (organização ligou + ramal ativo). Falso = nenhuma peça é desenhada. */
  disponivel: boolean;
  /** Liga para o número. `false` quando não dá (sem registro, já em chamada). */
  discar: (numero: string) => boolean;
  atender: () => void;
  encerrar: () => void;
  alternarMudo: () => void;
  alternarEspera: () => void;
  enviarTom: (tom: string) => void;
}

export const SEM_WEBPHONE: ContextoDoWebphone = {
  ...SEM_MOTOR,
  disponivel: false,
  discar: () => false,
  atender: () => undefined,
  encerrar: () => undefined,
  alternarMudo: () => undefined,
  alternarEspera: () => undefined,
  enviarTom: () => undefined,
};

export const CtxDoWebphone = createContext<ContextoDoWebphone>(SEM_WEBPHONE);

/** Seguro fora do provider: devolve "sem webphone", e o botão de ligar simplesmente não aparece. */
export function useWebphone(): ContextoDoWebphone {
  return useContext(CtxDoWebphone);
}
