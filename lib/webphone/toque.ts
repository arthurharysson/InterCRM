/** `recebida`: o que toca para quem atende. `chamando`: o que quem liga ouve esperando o outro lado atender. */
export type TipoDeToque = "recebida" | "chamando";

/**
 * O toque do telefone, sintetizado no navegador — o de quem recebe e o de quem
 * espera ser atendido (o "tu… tu…" do telefone brasileiro: 425 Hz, 1 s ligado e 4
 * s de silêncio).
 *
 * O navegador NÃO faz o toque de espera sozinho: ele só toca o que a central
 * mandar dentro da ligação (mídia antecipada). Quando a central não manda, quem
 * liga ouve silêncio e acha que a ligação não saiu — por isso o CRM o gera.
 *
 * Sem arquivo de áudio: nada para hospedar, nada para licenciar e nada que a
 * marca de uma revenda precise trocar. Dois tons alternados, 1 s ligado e 2 s
 * de silêncio, que é o ritmo que quem atende telefone reconhece como "está
 * tocando".
 *
 * O navegador só deixa tocar áudio depois de um gesto na página; se ainda não
 * houve nenhum, o toque fica mudo e o banner visual continua avisando. Nunca
 * lança — um toque que quebra não pode derrubar a chamada.
 */
export class Toque {
  constructor(private readonly tipo: TipoDeToque = "recebida") {}

  private contexto: AudioContext | null = null;
  private osciladores: OscillatorNode[] = [];
  private intervalo: ReturnType<typeof setInterval> | null = null;

  iniciar(): void {
    if (this.contexto || typeof window === "undefined") return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.contexto = ctx;
      void ctx.resume().catch(() => undefined);

      const ganho = ctx.createGain();
      ganho.gain.value = 0;
      ganho.connect(ctx.destination);

      const frequencias = this.tipo === "chamando" ? [425] : [440, 480];
      const volume = this.tipo === "chamando" ? 0.08 : 0.12;
      const periodoMs = this.tipo === "chamando" ? 5000 : 3000;
      for (const frequencia of frequencias) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = frequencia;
        osc.connect(ganho);
        osc.start();
        this.osciladores.push(osc);
      }

      const pulso = () => {
        const t = ctx.currentTime;
        ganho.gain.cancelScheduledValues(t);
        ganho.gain.setValueAtTime(0.0001, t);
        ganho.gain.linearRampToValueAtTime(volume, t + 0.05);
        ganho.gain.setValueAtTime(volume, t + 0.95);
        ganho.gain.linearRampToValueAtTime(0.0001, t + 1.0);
      };
      pulso();
      this.intervalo = setInterval(pulso, periodoMs);
    } catch {
      this.parar();
    }
  }

  parar(): void {
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = null;
    for (const osc of this.osciladores) {
      try {
        osc.stop();
      } catch {
        /* já parado */
      }
    }
    this.osciladores = [];
    void this.contexto?.close().catch(() => undefined);
    this.contexto = null;
  }
}
