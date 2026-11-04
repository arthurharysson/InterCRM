/**
 * O MOTOR DO WEBPHONE — SIP sobre WebSocket, no navegador de quem atende.
 *
 * Uma classe sem React: registra o ramal no servidor SIP da organização, recebe
 * e origina chamadas, e conta o que acontece por um instantâneo imutável que a
 * tela lê (`subscribe` + `instantaneo`, o contrato do `useSyncExternalStore`).
 * Ficar fora do React é o que deixa a ligação viva enquanto a pessoa navega — o
 * `WebphoneProvider` monta UMA instância no shell autenticado.
 *
 * ═══ O QUE ELE NÃO FAZ ═══
 *
 * Não grava nada no banco por conta própria e não conhece provedor nenhum: ao
 * fim de cada ligação ele CHAMA o `aoEncerrar` que o provider entregou, e é o
 * provider que fala com a API. Quem decide URA, fila e transferência é o PABX.
 *
 * ═══ UMA CHAMADA POR VEZ ═══
 *
 * Uma segunda chamada que chega durante a primeira é recusada com 486 (ocupado)
 * e o PABX segue a regra dele (fila, caixa postal, próximo ramal). Chamada em
 * espera e consulta de transferência são decisões de produto que ainda não
 * foram tomadas — não entram por acaso.
 *
 * ═══ ICE ═══
 *
 * Sem STUN/TURN por padrão (`iceServers: []`): é o que o webphone do PABX faz
 * hoje e funciona quando o servidor tem IP público. Se a organização precisar de
 * um relay, é um campo novo na configuração — não um valor escondido aqui.
 */
import type { RTCSession } from "jssip/lib/RTCSession";
import type { RTCSessionEvent, UA as UserAgent } from "jssip/lib/UA";

import { randomId } from "@/lib/random-id";

import type { CapacidadesDoTelefone, Telefone } from "./telefone";

import {
  destinoDaChamada,
  configuracaoDoUa,
  ehLigacaoPerdida,
  motivoDoFim,
  numeroDeQuemLigou,
  numeroParaDiscar,
  type CredenciaisDoWebphone,
  type MotivoDeFim,
  type ResultadoDaLigacao,
} from "./config";

export type EstadoDoRegistro = "conectando" | "registrado" | "offline" | "falhou";
export type QualidadeDoAudio = "boa" | "regular" | "ruim";

/**
 * O que o navegador SABE do caminho do áudio, medido — não suposto. `null` é
 * "ainda não medi": só `false` autoriza dizer à pessoa que o som não passa.
 */
export interface MidiaDaChamada {
  /** Estado da conexão de mídia (ICE) com a central: checking, connected, failed, disconnected… */
  ice: string | null;
  /** Chegou áudio da central (pacotes recebidos > 0). */
  recebendo: boolean | null;
  /** O microfone está enviando áudio à central (pacotes enviados > 0). */
  enviando: boolean | null;
  /** O navegador recusou tocar o som que chega (política de reprodução automática). */
  somBloqueado: boolean;
  /** A central mandou som dentro da ligação (toque dela ou conversa): o CRM não precisa gerar o toque de espera. */
  somRemoto: boolean;
  /** Pacotes de áudio recebidos da central até agora. Só para diagnóstico: quem lê é o "Detalhes do áudio". */
  pacotesRecebidos?: number | null;
  /** Pacotes de áudio enviados do microfone até agora. */
  pacotesEnviados?: number | null;
  /** Por onde a conexão de mídia passa, como o navegador escolheu (ex.: `host → host`, `prflx → host`, `relay`). */
  caminho?: string | null;
  /**
   * Energia sonora acumulada do que CHEGOU. Pacote chegando não é som chegando: a
   * central pode mandar pacotes de silêncio. Zero com muitos pacotes quer dizer
   * que a voz da outra pessoa não está passando pela central.
   */
  energiaRecebida?: number | null;
  /** O elemento de áudio do navegador está de fato tocando o que chega. */
  elementoTocando?: boolean | null;
}

export interface ChamadaAtual {
  direcao: "entrada" | "saida";
  /** O número do outro lado, só dígitos quando conhecido; `null` se o PABX mandou anônimo. */
  numero: string | null;
  estado: "tocando" | "chamando" | "em_andamento";
  mudo: boolean;
  emEspera: boolean;
  /** `Date.now()` do atendimento; `null` até a chamada ser atendida. */
  atendidaEm: number | null;
  /** Como está o áudio que chega; `null` enquanto não há o que medir. */
  qualidade: QualidadeDoAudio | null;
  midia: MidiaDaChamada;
}

/** O que o servidor precisa saber de uma ligação que acabou. */
export interface RegistroDaChamada {
  /** UUID gerado aqui: é a chave de idempotência do registro. */
  id: string;
  direcao: "entrada" | "saida";
  numero: string | null;
  iniciadaEm: number;
  atendidaEm: number | null;
  encerradaEm: number;
  motivo: MotivoDeFim;
}

/** O cartão que fica na tela depois que a ligação acaba, até a pessoa fechar. */
export interface FechamentoDaChamada {
  id: string;
  direcao: "entrada" | "saida";
  numero: string | null;
  atendida: boolean;
  perdida: boolean;
  duracaoS: number;
  resultado: ResultadoDaLigacao | null;
  /** Por que a ligação não aconteceu, na voz da central ou do CRM; `null` quando correu normal. */
  erro: string | null;
}

export interface InstantaneoDoWebphone {
  registro: EstadoDoRegistro;
  chamada: ChamadaAtual | null;
  fechamento: FechamentoDaChamada | null;
  /** O navegador negou o microfone: a ligação não tem como acontecer. */
  microfoneNegado: boolean;
}

export interface OpcoesDoWebphone {
  /** Chamado uma vez por ligação, quando ela acaba. Quem chama cuida de erro de rede. */
  aoEncerrar?: (registro: RegistroDaChamada) => Promise<unknown> | void;
  /** Chamado quando a pessoa marca o resultado; só depois de `aoEncerrar` terminar. */
  aoEscolherResultado?: (id: string, resultado: ResultadoDaLigacao) => Promise<unknown> | void;
}

type Ouvinte = () => void;

const PERMISSOES_DE_AUDIO = { audio: true, video: false } as const;
const INTERVALO_DA_QUALIDADE_MS = 4000;

export class Webphone implements Telefone {
  readonly capacidades: CapacidadesDoTelefone = { controlesDeAudio: true, atendePeloCrm: true };

  private ua: UserAgent | null = null;
  private sessao: RTCSession | null = null;
  private ouvintes = new Set<Ouvinte>();
  private parado = false;
  private relogioDaQualidade: ReturnType<typeof setInterval> | null = null;
  private registroDaLigacao: Promise<unknown> | null = null;
  private idDaLigacao: string | null = null;
  private iniciadaEm = 0;
  private numeroPedido: string | null = null;
  private estado: InstantaneoDoWebphone = { registro: "conectando", chamada: null, fechamento: null, microfoneNegado: false };

  constructor(
    private readonly credenciais: CredenciaisDoWebphone,
    private readonly audio: HTMLAudioElement,
    private readonly opcoes: OpcoesDoWebphone = {},
  ) {}

  // ── contrato do useSyncExternalStore ─────────────────────────────────────

  subscribe = (ouvinte: Ouvinte): (() => void) => {
    this.ouvintes.add(ouvinte);
    return () => {
      this.ouvintes.delete(ouvinte);
    };
  };

  instantaneo = (): InstantaneoDoWebphone => this.estado;

  private atualizar(parcial: Partial<InstantaneoDoWebphone>): void {
    this.estado = { ...this.estado, ...parcial };
    for (const ouvinte of this.ouvintes) ouvinte();
  }

  private atualizarChamada(parcial: Partial<ChamadaAtual>): void {
    if (!this.estado.chamada) return;
    this.atualizar({ chamada: { ...this.estado.chamada, ...parcial } });
  }

  // ── ciclo de vida ────────────────────────────────────────────────────────

  async iniciar(): Promise<void> {
    const { UA, WebSocketInterface } = await import("jssip");
    // O componente pode ter desmontado enquanto a biblioteca carregava.
    if (this.parado) return;

    const c = this.credenciais;
    const ua = new UA({
      sockets: [new WebSocketInterface(c.wss_url)],
      ...configuracaoDoUa(c),
    });

    ua.on("connecting", () => this.atualizar({ registro: "conectando" }));
    ua.on("connected", () => {
      // O socket abriu mas o ramal ainda não foi aceito: não é "registrado".
      if (this.estado.registro !== "registrado") this.atualizar({ registro: "conectando" });
    });
    ua.on("registered", () => this.atualizar({ registro: "registrado" }));
    ua.on("unregistered", () => this.atualizar({ registro: "offline" }));
    ua.on("registrationFailed", () => this.atualizar({ registro: "falhou" }));
    ua.on("disconnected", () => this.atualizar({ registro: "offline" }));
    ua.on("newRTCSession", (e: RTCSessionEvent) => this.aoNovaSessao(e.session, e.originator));

    this.ua = ua;
    ua.start();
  }

  parar(): void {
    this.parado = true;
    this.pararMedicao();
    try {
      this.sessao?.terminate();
    } catch {
      /* a sessão já tinha acabado */
    }
    try {
      this.ua?.stop();
    } catch {
      /* o socket já tinha caído */
    }
    this.audio.srcObject = null;
    this.ua = null;
    this.sessao = null;
    this.ouvintes.clear();
  }

  // ── o que a pessoa faz ───────────────────────────────────────────────────

  /** Liga para `numero`. Devolve `false` quando não dá (sem registro, já em chamada, número vazio). */
  discar(numero: string): boolean {
    if (!this.ua || this.estado.registro !== "registrado" || this.sessao) return false;
    const destino = destinoDaChamada(numero, this.credenciais.sip_domain, this.credenciais.dial_prefix);
    if (!destino) return false;
    this.numeroPedido = numeroParaDiscar(numero);
    this.atualizar({ microfoneNegado: false, fechamento: null });
    this.ua.call(destino, {
      mediaConstraints: PERMISSOES_DE_AUDIO,
      pcConfig: { iceServers: [] },
    });
    return true;
  }

  atender(): void {
    const s = this.sessao;
    if (!s || s.direction !== "incoming" || this.estado.chamada?.estado !== "tocando") return;
    this.atualizar({ microfoneNegado: false });
    s.answer({ mediaConstraints: PERMISSOES_DE_AUDIO, pcConfig: { iceServers: [] } });
  }

  /** Recusa a que toca ou desliga a que está em andamento. */
  encerrar(): void {
    const s = this.sessao;
    if (!s) return;
    try {
      if (s.direction === "incoming" && this.estado.chamada?.estado === "tocando") {
        s.terminate({ status_code: 486, reason_phrase: "Busy Here" });
      } else {
        s.terminate();
      }
    } catch {
      /* já estava terminando */
    }
  }

  alternarMudo(): void {
    const s = this.sessao;
    if (!s || !this.estado.chamada) return;
    if (this.estado.chamada.mudo) s.unmute({ audio: true });
    else s.mute({ audio: true });
  }

  alternarEspera(): void {
    const s = this.sessao;
    if (!s || !this.estado.chamada || this.estado.chamada.estado !== "em_andamento") return;
    if (this.estado.chamada.emEspera) s.unhold();
    else s.hold();
  }

  /** Um dígito do teclado durante a chamada (URA de outro lado, ramal de destino). */
  enviarTom(tom: string): void {
    const s = this.sessao;
    if (!s || this.estado.chamada?.estado !== "em_andamento") return;
    const limpo = numeroParaDiscar(tom).slice(0, 1);
    if (limpo) s.sendDTMF(limpo);
  }

  // ── o fechamento ─────────────────────────────────────────────────────────

  /** Tenta tocar de novo o som que chega. O clique que chama isto é o gesto que o navegador exigia. */
  ativarSom(): void {
    this.audio.muted = false;
    this.audio.volume = 1;
    void this.audio
      .play()
      .then(() => {
        const atual = this.estado.chamada;
        if (atual && atual.midia.somBloqueado) this.atualizarChamada({ midia: { ...atual.midia, somBloqueado: false } });
      })
      .catch(() => undefined);
  }

  /** A pessoa marcou como foi a ligação. Guardado na tela na hora e no servidor assim que o registro existir. */
  escolherResultado(resultado: ResultadoDaLigacao): void {
    const f = this.estado.fechamento;
    if (!f) return;
    this.atualizar({ fechamento: { ...f, resultado } });
    const id = f.id;
    const registro = this.registroDaLigacao ?? Promise.resolve();
    void registro
      .catch(() => undefined)
      .then(() => this.opcoes.aoEscolherResultado?.(id, resultado))
      .catch(() => undefined);
  }

  fecharFechamento(): void {
    if (this.estado.fechamento) this.atualizar({ fechamento: null });
  }

  // ── a sessão ─────────────────────────────────────────────────────────────

  private aoNovaSessao(sessao: RTCSession, originador: "local" | "remote" | "system"): void {
    // Uma chamada por vez: a segunda que chega é recusada como ocupado.
    if (this.sessao) {
      if (originador === "remote") sessao.terminate({ status_code: 486, reason_phrase: "Busy Here" });
      return;
    }

    const entrada = originador === "remote";
    const numero = entrada
      ? numeroDeQuemLigou(sessao.remote_identity.uri.toString())
      : (this.numeroPedido ?? (numeroParaDiscar(sessao.remote_identity.uri.user ?? "") || null));
    this.numeroPedido = null;

    this.sessao = sessao;
    // `randomId()` e não o gerador cru do navegador: este some em página sem HTTPS (uma VPS por IP), e a ligação nem começaria.
    this.idDaLigacao = randomId();
    this.iniciadaEm = Date.now();
    this.atualizar({
      fechamento: null,
      chamada: {
        direcao: entrada ? "entrada" : "saida",
        numero,
        estado: entrada ? "tocando" : "chamando",
        mudo: false,
        emEspera: false,
        atendidaEm: null,
        qualidade: null,
        midia: { ice: null, recebendo: null, enviando: null, somBloqueado: false, somRemoto: false },
      },
    });

    sessao.on("peerconnection", ({ peerconnection }) => {
      peerconnection.addEventListener("iceconnectionstatechange", () => {
        const atual = this.estado.chamada;
        if (atual) this.atualizarChamada({ midia: { ...atual.midia, ice: peerconnection.iceConnectionState } });
      });
      peerconnection.addEventListener("track", (e: RTCTrackEvent) => {
        const fluxo = e.streams[0] ?? new MediaStream([e.track]);
        this.audio.srcObject = fluxo;
        const sonoro = this.estado.chamada;
        if (sonoro && !sonoro.midia.somRemoto) this.atualizarChamada({ midia: { ...sonoro.midia, somRemoto: true } });
        this.audio.muted = false;
        this.audio.volume = 1;
        void this.audio.play().catch(() => {
          // O navegador recusou tocar (política de reprodução automática): o som
          // chega e fica mudo. Sem aviso, a pessoa fala sozinha — o painel mostra
          // o botão "Ativar o som", cujo clique é o gesto que faltava.
          const atual = this.estado.chamada;
          if (atual) this.atualizarChamada({ midia: { ...atual.midia, somBloqueado: true } });
        });
      });
    });

    const atendida = () => {
      if (this.estado.chamada?.estado === "em_andamento") return;
      this.atualizarChamada({ estado: "em_andamento", atendidaEm: Date.now() });
      this.iniciarMedicao(sessao);
    };
    sessao.on("accepted", atendida);
    sessao.on("confirmed", atendida);
    sessao.on("muted", () => this.atualizarChamada({ mudo: true }));
    sessao.on("unmuted", () => this.atualizarChamada({ mudo: false }));
    sessao.on("hold", () => this.atualizarChamada({ emEspera: true }));
    sessao.on("unhold", () => this.atualizarChamada({ emEspera: false }));
    sessao.on("ended", (e) => this.aoTerminar(sessao, e.cause));
    sessao.on("failed", (e) => this.aoTerminar(sessao, e.cause));
  }

  private aoTerminar(sessao: RTCSession, causa: string): void {
    // Sessão antiga terminando depois de a pessoa já ter começado outra.
    if (this.sessao !== sessao) return;
    const chamada = this.estado.chamada;
    const id = this.idDaLigacao;
    const encerradaEm = Date.now();
    this.sessao = null;
    this.idDaLigacao = null;
    this.audio.srcObject = null;
    this.pararMedicao();
    if (!chamada || !id) {
      this.atualizar({ chamada: null });
      return;
    }

    const atendida = chamada.atendidaEm !== null;
    const motivo = motivoDoFim({ atendida, causa });
    const negouMicrofone = /media/i.test(causa) && /den/i.test(causa);
    const perdida = ehLigacaoPerdida({ direcao: chamada.direcao, atendida, motivo });

    // Recusar uma chamada que tocava não pede fechamento: foi uma decisão, não um fato a anotar.
    const pedeFechamento = atendida || perdida || chamada.direcao === "saida";
    this.atualizar({
      chamada: null,
      microfoneNegado: negouMicrofone || this.estado.microfoneNegado,
      fechamento: !pedeFechamento ? null : {
        id,
        direcao: chamada.direcao,
        numero: chamada.numero,
        atendida,
        perdida,
        duracaoS: atendida && chamada.atendidaEm !== null ? Math.max(0, (encerradaEm - chamada.atendidaEm) / 1000) : 0,
        resultado: null,
        erro: null,
      },
    });

    // Uma chamada que a pessoa recusou ou que nem chegou a tocar não é histórico
    // de conversa, mas é histórico de contato — registra todas.
    const registro: RegistroDaChamada = {
      id,
      direcao: chamada.direcao,
      numero: chamada.numero,
      iniciadaEm: this.iniciadaEm,
      atendidaEm: chamada.atendidaEm,
      encerradaEm,
      motivo,
    };
    try {
      this.registroDaLigacao = Promise.resolve(this.opcoes.aoEncerrar?.(registro)).catch(() => undefined);
    } catch {
      this.registroDaLigacao = null;
    }
  }

  // ── a qualidade do áudio ─────────────────────────────────────────────────

  private iniciarMedicao(sessao: RTCSession): void {
    this.pararMedicao();
    this.relogioDaQualidade = setInterval(() => {
      const conexao = sessao.connection as unknown as RTCPeerConnection | undefined;
      if (!conexao || typeof conexao.getStats !== "function") return;
      conexao
        .getStats()
        .then((relatorio) => {
          let perdidos = 0;
          let recebidos = 0;
          let enviados = 0;
          let energia = 0;
          let jitter = 0;
          const candidatos = new Map<string, string>();
          const pares: Array<{ local?: string; remoto?: string; escolhido: boolean }> = [];
          relatorio.forEach((r) => {
            const s = r as unknown as {
              id?: string;
              type: string;
              kind?: string;
              packetsLost?: number;
              packetsReceived?: number;
              packetsSent?: number;
              totalAudioEnergy?: number;
              jitter?: number;
              candidateType?: string;
              localCandidateId?: string;
              remoteCandidateId?: string;
              state?: string;
              nominated?: boolean;
              selected?: boolean;
            };
            if (s.type === "local-candidate" || s.type === "remote-candidate") {
              if (s.id && s.candidateType) candidatos.set(s.id, s.candidateType);
              return;
            }
            if (s.type === "candidate-pair") {
              pares.push({
                local: s.localCandidateId,
                remoto: s.remoteCandidateId,
                escolhido: s.state === "succeeded" && Boolean(s.nominated || s.selected),
              });
              return;
            }
            if (s.kind !== "audio") return;
            if (s.type === "inbound-rtp") {
              perdidos += s.packetsLost ?? 0;
              recebidos += s.packetsReceived ?? 0;
              energia += s.totalAudioEnergy ?? 0;
              jitter = Math.max(jitter, s.jitter ?? 0);
            } else if (s.type === "outbound-rtp") {
              enviados += s.packetsSent ?? 0;
            }
          });

          // O que o navegador mediu sobre o caminho do som, dito sem rodeio:
          // se NADA chegou ou NADA saiu depois de uns segundos de conversa, o
          // painel avisa. A medição só liga depois de atendida, então "zero" aqui
          // é zero de verdade, não "ainda não começou".
          const par = pares.find((p) => p.escolhido);
          const caminho = par
            ? `${candidatos.get(par.local ?? "") ?? "?"} → ${candidatos.get(par.remoto ?? "") ?? "?"}`
            : null;
          const atual = this.estado.chamada;
          if (atual) {
            const midia = {
              ...atual.midia,
              recebendo: recebidos > 0,
              enviando: enviados > 0,
              pacotesRecebidos: recebidos,
              pacotesEnviados: enviados,
              caminho,
              energiaRecebida: energia,
              elementoTocando: !this.audio.paused && this.audio.readyState >= 2 && this.audio.srcObject !== null,
            };
            const mudou =
              midia.recebendo !== atual.midia.recebendo ||
              midia.enviando !== atual.midia.enviando ||
              midia.pacotesRecebidos !== atual.midia.pacotesRecebidos ||
              midia.pacotesEnviados !== atual.midia.pacotesEnviados ||
              midia.caminho !== atual.midia.caminho ||
              midia.elementoTocando !== atual.midia.elementoTocando ||
              Math.abs((midia.energiaRecebida ?? 0) - (atual.midia.energiaRecebida ?? 0)) > 0.0001;
            if (mudou) this.atualizarChamada({ midia });
          }

          const total = perdidos + recebidos;
          if (total < 50) return; // pouca amostra: não afirma nada sobre a qualidade
          const perda = perdidos / total;
          const qualidade: QualidadeDoAudio = perda < 0.02 && jitter < 0.03 ? "boa" : perda < 0.06 && jitter < 0.08 ? "regular" : "ruim";
          if (this.estado.chamada?.qualidade !== qualidade) this.atualizarChamada({ qualidade });
        })
        .catch(() => undefined);
    }, INTERVALO_DA_QUALIDADE_MS);
  }

  private pararMedicao(): void {
    if (this.relogioDaQualidade) clearInterval(this.relogioDaQualidade);
    this.relogioDaQualidade = null;
  }
}
