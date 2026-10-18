"use client";
/**
 * O TELEFONE NA TELA — status do ramal, teclado, chamada recebida e controles.
 *
 * Fixo no canto inferior direito, como o painel de chamada de voz do WhatsApp, e
 * declarando o que ocupa para a casca descontar (contrato do rodapé,
 * `lib/ui/rodape-ocupado.tsx`). Quem desenha é só a tela: toda decisão de
 * telefone mora no motor (`lib/webphone/motor.ts`).
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useWebphone } from "@/components/webphone/contexto";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { usePecaDoRodape, type PecaDoRodape } from "@/lib/ui/rodape-ocupado";
import { CircleNotch, Keyboard, Microphone, MicrophoneSlash, Pause, Phone, PhoneX, Play, Warning } from "@/lib/ui/icons";
import { duracaoLegivel, numeroParaDiscar } from "@/lib/webphone/config";
import { Toque } from "@/lib/webphone/toque";

/**
 * O que esta peça OCUPA no canto: `distancia: 16` é o `bottom-4`, `altura: 48` é
 * a pílula fechada (`h-12`). Aberta, a medição real do navegador só AUMENTA a
 * reserva — o piso é o que vale quando ninguém está com o teclado aberto.
 */
export const PECA_DO_WEBPHONE: PecaDoRodape = {
  dono: "components/webphone/WebphoneDock.tsx",
  distancia: 16,
  altura: 48,
};

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;

function useQuemE(numero: string | null) {
  const digitos = numero ? numeroParaDiscar(numero) : "";
  return useQuery({
    queryKey: ["webphone", "quem-e", digitos],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { contact_id: string; nome: string | null } | null }>(
        `/api/v1/webphone/quem-e?numero=${encodeURIComponent(digitos)}`,
      );
      return res.data;
    },
    enabled: digitos.length >= 4 && digitos.length <= 20,
    staleTime: 60_000,
    retry: false,
  });
}

function Teclado({ aoApertar }: { aoApertar: (tecla: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="group">
      {TECLAS.map((tecla) => (
        <Button
          key={tecla}
          type="button"
          variant="outline"
          className="h-10 text-base font-medium"
          onClick={() => aoApertar(tecla)}
        >
          {tecla}
        </Button>
      ))}
    </div>
  );
}

function Cronometro({ desde }: { desde: number }) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums">{duracaoLegivel((agora - desde) / 1000)}</span>;
}

export function WebphoneDock() {
  const t = useT();
  const wp = useWebphone();
  const ancora = usePecaDoRodape(PECA_DO_WEBPHONE);

  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [tecladoNaChamada, setTecladoNaChamada] = useState(false);
  const toque = useRef<Toque | null>(null);

  const { chamada, registro } = wp;
  const tocando = chamada?.direcao === "entrada" && chamada.estado === "tocando";

  // O toque vive exatamente enquanto há chamada recebida sem atender.
  useEffect(() => {
    if (!tocando) return;
    const t1 = new Toque();
    toque.current = t1;
    t1.iniciar();
    return () => {
      t1.parar();
      toque.current = null;
    };
  }, [tocando]);

  const quemE = useQuemE(chamada?.numero ?? null);
  const nome = quemE.data?.nome?.trim() || null;
  const numeroExibido = chamada?.numero ? phoneForDisplay(chamada.numero) : t("Número oculto");

  const corDoRegistro =
    registro === "registrado" ? "bg-emerald-500" : registro === "conectando" ? "bg-amber-400" : "bg-red-500";
  const rotuloDoRegistro =
    registro === "registrado"
      ? t("Ramal conectado")
      : registro === "conectando"
        ? t("Conectando o ramal…")
        : registro === "falhou"
          ? t("O servidor recusou o ramal")
          : t("Ramal desconectado");

  function ligar() {
    if (wp.discar(digitado)) setAberto(false);
  }

  // ── chamada recebida ──────────────────────────────────────────────────────
  if (chamada && tocando) {
    return (
      <div
        ref={ancora}
        role="alertdialog"
        aria-label={t("Chamada recebida")}
        className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
            <Phone size={20} weight="bold" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t("Chamada recebida")}</p>
            <p className="truncate text-sm font-semibold">{nome ?? numeroExibido}</p>
            {nome ? <p className="truncate text-xs text-muted-foreground">{numeroExibido}</p> : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={wp.atender}>
            <Phone size={16} weight="bold" aria-hidden />
            {t("Atender")}
          </Button>
          <Button variant="destructive" className="flex-1" onClick={wp.encerrar}>
            <PhoneX size={16} weight="bold" aria-hidden />
            {t("Recusar")}
          </Button>
        </div>
      </div>
    );
  }

  // ── chamada em andamento (ou encerrando) ──────────────────────────────────
  if (chamada) {
    const encerrada = chamada.estado === "encerrada";
    return (
      <div
        ref={ancora}
        className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            {chamada.estado === "chamando" ? (
              <CircleNotch size={20} className="animate-spin" aria-hidden />
            ) : (
              <Phone size={20} weight="bold" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{nome ?? numeroExibido}</p>
            <p className="text-xs text-muted-foreground">
              {encerrada ? (
                t("Chamada encerrada")
              ) : chamada.estado === "chamando" ? (
                t("Chamando…")
              ) : chamada.atendidaEm ? (
                <Cronometro desde={chamada.atendidaEm} />
              ) : (
                t("Conectando…")
              )}
              {chamada.emEspera && !encerrada ? ` · ${t("Em espera")}` : ""}
            </p>
          </div>
        </div>

        {wp.microfoneNegado ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
            {t("O navegador bloqueou o microfone. Libere o acesso no cadeado da barra de endereço e ligue de novo.")}
          </p>
        ) : null}

        {tecladoNaChamada && !encerrada ? <Teclado aoApertar={wp.enviarTom} /> : null}

        {!encerrada ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={chamada.mudo ? t("Ativar o microfone") : t("Silenciar o microfone")}
              aria-pressed={chamada.mudo}
              onClick={wp.alternarMudo}
              disabled={chamada.estado !== "em_andamento"}
            >
              {chamada.mudo ? (
                <MicrophoneSlash size={16} weight="bold" aria-hidden />
              ) : (
                <Microphone size={16} weight="bold" aria-hidden />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={chamada.emEspera ? t("Retomar a chamada") : t("Colocar em espera")}
              aria-pressed={chamada.emEspera}
              onClick={wp.alternarEspera}
              disabled={chamada.estado !== "em_andamento"}
            >
              {chamada.emEspera ? (
                <Play size={16} weight="bold" aria-hidden />
              ) : (
                <Pause size={16} weight="bold" aria-hidden />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("Teclado")}
              aria-pressed={tecladoNaChamada}
              onClick={() => setTecladoNaChamada((v) => !v)}
              disabled={chamada.estado !== "em_andamento"}
            >
              <Keyboard size={16} weight="bold" aria-hidden />
            </Button>
            <Button variant="destructive" className="ml-auto" onClick={wp.encerrar}>
              <PhoneX size={16} weight="bold" aria-hidden />
              {t("Desligar")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  // ── em repouso: a pílula e, aberto, o teclado de discagem ─────────────────
  return (
    <div ref={ancora} className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {aberto ? (
        <div className="flex w-72 flex-col gap-3 rounded-lg border bg-background p-3 shadow-lg">
          <Input
            inputMode="tel"
            autoComplete="off"
            placeholder={t("Número para ligar")}
            aria-label={t("Número para ligar")}
            value={digitado}
            onChange={(e) => setDigitado(numeroParaDiscar(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") ligar();
            }}
          />
          <Teclado aoApertar={(tecla) => setDigitado((d) => d + tecla)} />
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={registro !== "registrado" || digitado.length === 0}
            onClick={ligar}
          >
            <Phone size={16} weight="bold" aria-hidden />
            {t("Ligar")}
          </Button>
          {registro !== "registrado" ? (
            <p className="text-xs text-muted-foreground">{rotuloDoRegistro}</p>
          ) : null}
        </div>
      ) : null}
      <Button
        variant="outline"
        className="h-12 gap-2 rounded-full bg-background px-4 shadow-md"
        aria-expanded={aberto}
        aria-label={t("Abrir o telefone")}
        onClick={() => setAberto((v) => !v)}
      >
        <span className={`size-2.5 rounded-full ${corDoRegistro}`} aria-hidden />
        <Phone size={16} weight="bold" aria-hidden />
        <span className="text-sm">{rotuloDoRegistro}</span>
      </Button>
    </div>
  );
}
