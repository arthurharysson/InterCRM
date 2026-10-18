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
 * Não grava nada no banco, não decide quem pode ligar e não conhece provedor
 * nenhum: quem entrega as credenciais é `/api/v1/webphone/credenciais` (só ao
 * dono do ramal) e quem decide URA, fila e transferência é o PABX. Aqui só há o
 * telefone.
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

import {
  destinoDaChamada,
  numeroDeQuemLigou,
  numeroParaDiscar,
  uriSipDoRamal,
  type CredenciaisDoWebphone,
} from "./config";

export type EstadoDoRegistro = "conectando" | "registrado" | "offline" | "falhou";

export interface ChamadaAtual {
  direcao: "entrada" | "saida";
  /** O número do outro lado, só dígitos quando conhecido; `null` se o PABX mandou anônimo. */
  numero: string | null;
  estado: "tocando" | "chamando" | "em_andamento" | "encerrada";
  mudo: boolean;
  emEspera: boolean;
  /** `Date.now()` do atendimento; `null` até a chamada ser atendida. */
  atendidaEm: number | null;
  /** Por que acabou, quando `estado === "encerrada"` (texto cru do JsSIP, para diagnóstico). */
  motivoDoFim: string | null;
}

export interface InstantaneoDoWebphone {
  registro: EstadoDoRegistro;
  chamada: ChamadaAtual | null;
  /** O navegador negou o microfone: a ligação não tem como acontecer. */
  microfoneNegado: boolean;
}

type Ouvinte = () => void;

const PERMISSOES_DE_AUDIO = { audio: true, video: false } as const;
/** Quanto a chamada encerrada fica na tela antes de sumir. */
const MS_DA_CHAMADA_ENCERRADA = 2500;

export class Webphone {
  private ua: UserAgent | null = null;
  private sessao: RTCSession | null = null;
  private ouvintes = new Set<Ouvinte>();
  private limpezaDoFim: ReturnType<typeof setTimeout> | null = null;
  private parado = false;
  private estado: InstantaneoDoWebphone = { registro: "conectando", chamada: null, microfoneNegado: false };

  constructor(
    private readonly credenciais: CredenciaisDoWebphone,
    private readonly audio: HTMLAudioElement,
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
      uri: uriSipDoRamal(c.ramal, c.sip_domain),
      authorization_user: c.ramal,
      display_name: c.ramal,
      password: c.password,
      realm: c.sip_domain,
      registrar_server: `sip:${c.sip_domain}`,
      register: true,
      register_expires: 300,
      no_answer_timeout: 120,
      user_agent: "InterCRM-Webphone",
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
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
    if (this.limpezaDoFim) clearTimeout(this.limpezaDoFim);
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
    this.atualizar({ microfoneNegado: false });
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

  // ── a sessão ─────────────────────────────────────────────────────────────

  private aoNovaSessao(sessao: RTCSession, originador: "local" | "remote" | "system"): void {
    // Uma chamada por vez: a segunda que chega é recusada como ocupado.
    if (this.sessao) {
      if (originador === "remote") sessao.terminate({ status_code: 486, reason_phrase: "Busy Here" });
      return;
    }

    if (this.limpezaDoFim) {
      clearTimeout(this.limpezaDoFim);
      this.limpezaDoFim = null;
    }

    const entrada = originador === "remote";
    const numero = entrada
      ? numeroDeQuemLigou(sessao.remote_identity.uri.toString())
      : numeroParaDiscar(sessao.remote_identity.uri.user ?? "") || null;

    this.sessao = sessao;
    this.atualizar({
      chamada: {
        direcao: entrada ? "entrada" : "saida",
        numero,
        estado: entrada ? "tocando" : "chamando",
        mudo: false,
        emEspera: false,
        atendidaEm: null,
        motivoDoFim: null,
      },
    });

    sessao.on("peerconnection", ({ peerconnection }) => {
      peerconnection.addEventListener("track", (e: RTCTrackEvent) => {
        const fluxo = e.streams[0] ?? new MediaStream([e.track]);
        this.audio.srcObject = fluxo;
        void this.audio.play().catch(() => {
          /* o navegador pode pedir um gesto antes de tocar; o clique de atender já é um */
        });
      });
    });

    const atendida = () => {
      if (this.estado.chamada?.estado === "em_andamento") return;
      this.atualizarChamada({ estado: "em_andamento", atendidaEm: Date.now() });
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
    this.sessao = null;
    this.audio.srcObject = null;

    const negouMicrofone = /media/i.test(causa) && /den/i.test(causa);
    this.atualizar({ microfoneNegado: negouMicrofone || this.estado.microfoneNegado });
    this.atualizarChamada({ estado: "encerrada", motivoDoFim: causa, mudo: false, emEspera: false });

    this.limpezaDoFim = setTimeout(() => {
      this.limpezaDoFim = null;
      if (!this.sessao) this.atualizar({ chamada: null });
    }, MS_DA_CHAMADA_ENCERRADA);
  }
}
