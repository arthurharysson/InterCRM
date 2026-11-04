/**
 * O que a tela precisa de "um telefone", seja qual for a forma de ligar.
 *
 * Duas implementações: `Webphone` (o CRM é o telefone: SIP no navegador, com
 * áudio) e `ClickToCall` (o CRM pede a ligação pela API da central e o áudio fica
 * na janela dela). O provider monta uma das duas conforme o ramal da pessoa, e
 * o painel desenha o mesmo roteiro — repouso, tocando, em conversa, fechamento —
 * sem saber qual está por baixo.
 */
import type { ResultadoDaLigacao } from "./config";
import type { InstantaneoDoWebphone } from "./motor";

export interface CapacidadesDoTelefone {
  /** Mudo, espera e teclado da URA agem sobre o áudio — só quem tem o áudio os tem. */
  controlesDeAudio: boolean;
  /** Atender a chamada que toca. No Click to Call quem atende é a janela da central. */
  atendePeloCrm: boolean;
}

export interface Telefone {
  readonly capacidades: CapacidadesDoTelefone;
  subscribe: (ouvinte: () => void) => () => void;
  instantaneo: () => InstantaneoDoWebphone;
  iniciar(): Promise<void>;
  parar(): void;
  discar(numero: string): boolean;
  atender(): void;
  encerrar(): void;
  alternarMudo(): void;
  alternarEspera(): void;
  enviarTom(tom: string): void;
  /** Toca de novo o som que o navegador bloqueou. No Click to Call não há som aqui. */
  ativarSom(): void;
  escolherResultado(resultado: ResultadoDaLigacao): void;
  fecharFechamento(): void;
}
