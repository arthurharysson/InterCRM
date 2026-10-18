/**
 * O toque da chamada recebida, sintetizado no navegador.
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

      for (const frequencia of [440, 480]) {
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
        ganho.gain.linearRampToValueAtTime(0.12, t + 0.05);
        ganho.gain.setValueAtTime(0.12, t + 0.95);
        ganho.gain.linearRampToValueAtTime(0.0001, t + 1.0);
      };
      pulso();
      this.intervalo = setInterval(pulso, 3000);
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
