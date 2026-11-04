/**
 * CLICK TO CALL — o CRM pede a ligação e acompanha; o áudio é da janela da central.
 *
 * O atendente clica em ligar, o CRM pede à central que toque o ramal dele e
 * ligue ao número, e a central é perguntada de poucos em poucos segundos como
 * a ligação anda (ela não avisa). No fim, a ligação é gravada no histórico e o
 * cartão de fechamento pede o resultado — o mesmo roteiro do telefone embutido.
 *
 * Sem React e com as chamadas de rede injetadas, para provar o roteiro com
 * relógio falso e sem central de verdade.
 *
 * ═══ O QUE ELE NÃO FAZ ═══
 *
 * Não tem áudio: mudo, espera e teclado da URA ficam na janela da central. Não
 * recebe ligação: a chamada que chega toca na janela dela, e o CRM só passa a
 * conhecê-la no relatório. O estado do ramal ("registrado") é sempre `registrado`
 * porque o CRM não tem como saber — se o ramal estiver fora do ar, é a central
 * que recusa o pedido, e a mensagem dela vai para a tela.
 */
import type { ResultadoDaLigacao, SituacaoDaLigacao } from "./config";
import { numeroParaDiscar } from "./config";
import type { FechamentoDaChamada, InstantaneoDoWebphone, RegistroDaChamada } from "./motor";
import type { CapacidadesDoTelefone, Telefone } from "./telefone";
import { randomId } from "@/lib/random-id";

export interface DependenciasDoClickToCall {
  ligar: (crmId: string, numero: string) => Promise<void>;
  consultar: (crmId: string) => Promise<SituacaoDaLigacao>;
  desligar: (crmId: string) => Promise<void>;
  aoEncerrar?: (registro: RegistroDaChamada) => Promise<unknown> | void;
  aoEscolherResultado?: (id: string, resultado: ResultadoDaLigacao) => Promise<unknown> | void;
}

export interface OpcoesDoClickToCall {
  /** De quanto em quanto tempo perguntar à central. */
  intervaloMs?: number;
  /** Quanto esperar sem a central saber da ligação antes de dá-la por perdida. */
  semNoticiaMs?: number;
  /** Quantas consultas seguidas podem falhar antes de dar a ligação por perdida. */
  falhasSeguidas?: number;
}

type Ouvinte = () => void;

export class ClickToCall implements Telefone {
  readonly capacidades: CapacidadesDoTelefone = { controlesDeAudio: false, atendePeloCrm: false };

  private ouvintes = new Set<Ouvinte>();
  private relogio: ReturnType<typeof setInterval> | null = null;
  private emConsulta = false;
  private crmId: string | null = null;
  private iniciadaEm = 0;
  private desligueiEu = false;
  private falhas = 0;
  private registroDaLigacao: Promise<unknown> | null = null;
  private readonly intervaloMs: number;
  private readonly semNoticiaMs: number;
  private readonly maximoDeFalhas: number;
  private estado: InstantaneoDoWebphone = { registro: "registrado", chamada: null, fechamento: null, microfoneNegado: false };

  constructor(
    private readonly deps: DependenciasDoClickToCall,
    opcoes: OpcoesDoClickToCall = {},
  ) {
    this.intervaloMs = opcoes.intervaloMs ?? 3000;
    this.semNoticiaMs = opcoes.semNoticiaMs ?? 90_000;
    this.maximoDeFalhas = opcoes.falhasSeguidas ?? 5;
  }

  subscribe = (ouvinte: Ouvinte): (() => void) => {
    this.ouvintes.add(ouvinte);
    return () => {
      this.ouvintes.delete(ouvinte);
    };
  };

  instantaneo = (): InstantaneoDoWebphone => this.estado;

  private atualizar(parcial: Partial<InstantaneoDoWebphone>): void {
    this.estado = { ...this.estado, ...parcial };
    for (const o of this.ouvintes) o();
  }

  async iniciar(): Promise<void> {
    /* nada a registrar: o ramal já está na janela da central */
  }

  parar(): void {
    this.pararRelogio();
    this.ouvintes.clear();
  }

  discar(numero: string): boolean {
    if (this.estado.chamada) return false;
    const digitos = numeroParaDiscar(numero);
    if (digitos.length < 8) return false;

    const crmId = randomId();
    this.crmId = crmId;
    this.iniciadaEm = Date.now();
    this.desligueiEu = false;
    this.falhas = 0;
    this.atualizar({
      fechamento: null,
      chamada: {
        direcao: "saida",
        numero: digitos,
        estado: "chamando",
        mudo: false,
        emEspera: false,
        atendidaEm: null,
        qualidade: null,
        midia: { ice: null, recebendo: null, enviando: null, somBloqueado: false, somRemoto: false },
      },
    });

    this.deps.ligar(crmId, digitos).then(
      () => {
        if (this.crmId === crmId) this.iniciarRelogio();
      },
      (e: unknown) => {
        if (this.crmId !== crmId) return;
        this.finalizar({ atendida: false, atendida_em: null, encerrada_em: null, falou_s: 0, estado: "encerrada" }, {
          motivo: "failed",
          erro: e instanceof Error ? e.message : "Não foi possível pedir a ligação.",
          registrar: false,
        });
      },
    );
    return true;
  }

  encerrar(): void {
    const crmId = this.crmId;
    if (!crmId || !this.estado.chamada) return;
    this.desligueiEu = true;
    // O pedido de desligar é o melhor esforço; quem confirma o fim é a próxima consulta.
    void this.deps.desligar(crmId).catch(() => undefined);
  }

  atender(): void {
    /* quem atende é a janela da central */
  }
  alternarMudo(): void {
    /* o áudio é da janela da central */
  }
  alternarEspera(): void {
    /* o áudio é da janela da central */
  }
  enviarTom(): void {
    /* o áudio é da janela da central */
  }
  ativarSom(): void {
    /* o áudio é da janela da central */
  }

  escolherResultado(resultado: ResultadoDaLigacao): void {
    const f = this.estado.fechamento;
    if (!f) return;
    this.atualizar({ fechamento: { ...f, resultado } });
    const id = f.id;
    const registro = this.registroDaLigacao ?? Promise.resolve();
    void registro
      .catch(() => undefined)
      .then(() => this.deps.aoEscolherResultado?.(id, resultado))
      .catch(() => undefined);
  }

  fecharFechamento(): void {
    if (this.estado.fechamento) this.atualizar({ fechamento: null });
  }

  // ── o acompanhamento ─────────────────────────────────────────────────────

  private iniciarRelogio(): void {
    this.pararRelogio();
    this.relogio = setInterval(() => void this.perguntar(), this.intervaloMs);
  }

  private pararRelogio(): void {
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
  }

  private async perguntar(): Promise<void> {
    const crmId = this.crmId;
    if (!crmId || !this.estado.chamada || this.emConsulta) return;
    this.emConsulta = true;
    try {
      const s = await this.deps.consultar(crmId);
      if (this.crmId !== crmId) return;
      this.falhas = 0;
      if (s.estado === "encerrada") {
        this.finalizar(s, { motivo: s.atendida ? "user_ended" : this.desligueiEu ? "cancelled" : "timeout", registrar: true });
      } else if (s.estado === "em_andamento") {
        const quando = s.atendida_em ? Date.parse(s.atendida_em) : NaN;
        const atual = this.estado.chamada;
        if (atual && atual.estado !== "em_andamento") {
          this.atualizar({
            chamada: { ...atual, estado: "em_andamento", atendidaEm: Number.isFinite(quando) ? quando : Date.now() },
          });
        }
      } else if (s.estado === "desconhecida" && Date.now() - this.iniciadaEm > this.semNoticiaMs) {
        this.finalizar(s, { motivo: "failed", erro: "A central não confirmou a ligação.", registrar: true });
      }
    } catch {
      if (this.crmId !== crmId) return;
      this.falhas += 1;
      if (this.falhas >= this.maximoDeFalhas) {
        this.finalizar(
          { estado: "encerrada", atendida: false, atendida_em: null, encerrada_em: null, falou_s: 0 },
          { motivo: "failed", erro: "O CRM perdeu o contato com a central durante a ligação.", registrar: true },
        );
      }
    } finally {
      this.emConsulta = false;
    }
  }

  private finalizar(
    s: SituacaoDaLigacao,
    o: { motivo: RegistroDaChamada["motivo"]; erro?: string; registrar: boolean },
  ): void {
    const crmId = this.crmId;
    const chamada = this.estado.chamada;
    if (!crmId || !chamada) return;
    this.pararRelogio();
    this.crmId = null;

    const encerradaEm = s.encerrada_em && Number.isFinite(Date.parse(s.encerrada_em)) ? Date.parse(s.encerrada_em) : Date.now();
    const atendidaEm = s.atendida && s.atendida_em && Number.isFinite(Date.parse(s.atendida_em)) ? Date.parse(s.atendida_em) : null;
    const duracaoS = s.atendida ? (s.falou_s > 0 ? s.falou_s : atendidaEm ? Math.max(0, (encerradaEm - atendidaEm) / 1000) : 0) : 0;

    const fechamento: FechamentoDaChamada = {
      id: crmId,
      direcao: "saida",
      numero: chamada.numero,
      atendida: s.atendida,
      perdida: false,
      duracaoS,
      resultado: null,
      erro: o.erro ?? null,
    };
    this.atualizar({ chamada: null, fechamento });

    if (!o.registrar) return;
    const registro: RegistroDaChamada = {
      id: crmId,
      direcao: "saida",
      numero: chamada.numero,
      iniciadaEm: this.iniciadaEm,
      atendidaEm,
      encerradaEm,
      motivo: o.motivo,
    };
    try {
      this.registroDaLigacao = Promise.resolve(this.deps.aoEncerrar?.(registro)).catch(() => undefined);
    } catch {
      this.registroDaLigacao = null;
    }
  }
}
