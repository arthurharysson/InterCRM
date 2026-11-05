"use client";
/**
 * O TELEFONE NA TELA — status do ramal, teclado, chamada recebida, controles e
 * o fechamento da ligação.
 *
 * No canto inferior direito. Em repouso é um FAB (botão redondo) que flutua sobre
 * o conteúdo e NÃO reserva rodapé; chamada recebida, em andamento e fechamento
 * são painéis fixos que declaram o que ocupam para a casca descontar (contrato
 * do rodapé, `lib/ui/rodape-ocupado.tsx`). Um telefone só, que muda de estado:
 * repouso → tocando → em conversa → fechamento. Quem desenha é só a tela: toda decisão de
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
import { CircleNotch, Keyboard, Microphone, MicrophoneSlash, Pause, Phone, PhoneX, Play, Warning, X } from "@/lib/ui/icons";
import {
  RESULTADOS_DA_LIGACAO,
  ROTULO_DO_RESULTADO,
  duracaoLegivel,
  numeroParaDiscar,
} from "@/lib/webphone/config";
import type { ChamadaAtual } from "@/lib/webphone/motor";
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

/**
 * O painel FIXO do telefone (chamada recebida, em andamento, fechamento): é ele —
 * e só ele — que declara o que ocupa no rodapé. O botão de repouso é um FAB e
 * flutua por cima do conteúdo, sem reservar faixa nenhuma. Como o registro nasce
 * e morre com este componente, a reserva existe enquanto o painel está na tela.
 */
function CaixaFixa({ className, children, ...resto }: React.ComponentProps<"div">) {
  const ancora = usePecaDoRodape(PECA_DO_WEBPHONE);
  return (
    <div ref={ancora} className={className} {...resto}>
      {children}
    </div>
  );
}

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

/**
 * Os problemas de áudio de uma conversa. Só nasce de medida (`false`), nunca de
 * "ainda não sei" (`null`): dizer que o som não passa quando ele ainda está
 * começando seria pior do que calar. Booleanos, e não texto: cada frase é um
 * literal em `t()` no ponto onde é desenhada, como o dicionário exige.
 */
function problemasDeAudio(m: ChamadaAtual["midia"]) {
  return {
    conexao: m.ice === "failed" || m.ice === "disconnected",
    semRecebimento: m.recebendo === false,
    // Chegou bastante pacote e nenhum som: a central está repassando silêncio.
    // Só com amostra grande — poucos segundos de conversa quieta não provam nada.
    silencioRecebido:
      (m.pacotesRecebidos ?? 0) > 300 && m.energiaRecebida !== undefined && m.energiaRecebida !== null && m.energiaRecebida < 0.0005,
    // Chegou som e o navegador não está tocando.
    navegadorNaoToca: (m.energiaRecebida ?? 0) >= 0.001 && m.elementoTocando === false,
    semEnvio: m.enviando === false,
  };
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

  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState("");
  const [tecladoNaChamada, setTecladoNaChamada] = useState(false);
  const toque = useRef<Toque | null>(null);

  const { chamada, fechamento, registro } = wp;
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

  const numeroDaTela = chamada?.numero ?? fechamento?.numero ?? null;
  // Quem liga e ainda não foi atendido precisa OUVIR que está chamando. A central
  // às vezes manda o toque dela (e então `somRemoto` fica verdadeiro e este não
  // toca); quando não manda, o CRM gera o seu, senão o silêncio parece defeito.
  const esperandoSerAtendido =
    wp.capacidades.controlesDeAudio &&
    chamada?.direcao === "saida" &&
    chamada.estado === "chamando" &&
    !chamada.midia.somRemoto;
  useEffect(() => {
    if (!esperandoSerAtendido) return;
    const espera = new Toque("chamando");
    espera.iniciar();
    return () => espera.parar();
  }, [esperandoSerAtendido]);

  const quemE = useQuemE(numeroDaTela);
  const nome = quemE.data?.nome?.trim() || null;
  const numeroExibido = numeroDaTela ? phoneForDisplay(numeroDaTela) : t("Número oculto");

  const corDoRegistro =
    registro === "registrado" ? "bg-emerald-500" : registro === "conectando" ? "bg-amber-400" : "bg-red-500";
  const soPedeALigacao = !wp.capacidades.controlesDeAudio;
  const rotuloDoRegistro = soPedeALigacao
    ? t("Ligar pela central")
    : registro === "registrado"
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
      <CaixaFixa
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
            {nome ? (
              <p className="truncate text-xs text-muted-foreground">{numeroExibido}</p>
            ) : (
              <p className="truncate text-xs text-muted-foreground">{t("Contato desconhecido")}</p>
            )}
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
      </CaixaFixa>
    );
  }

  // ── chamada em andamento ──────────────────────────────────────────────────
  if (chamada) {
    return (
      <CaixaFixa
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
              {chamada.estado === "chamando" ? (
                t("Chamando…")
              ) : chamada.atendidaEm ? (
                <Cronometro desde={chamada.atendidaEm} />
              ) : (
                t("Conectando…")
              )}
              {chamada.emEspera ? ` · ${t("Em espera")}` : ""}
            </p>
          </div>
        </div>

        {wp.microfoneNegado ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
            {t("O navegador bloqueou o microfone. Libere o acesso no cadeado da barra de endereço e ligue de novo.")}
          </p>
        ) : null}

        {soPedeALigacao ? (
          <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>{t("O áudio da ligação está na janela da central. Atenda por lá.")}</p>
            {wp.painelUrl ? (
              <Button type="button" size="sm" variant="outline" onClick={wp.abrirJanela}>
                {t("Abrir a janela da central")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {!soPedeALigacao && tecladoNaChamada ? <Teclado aoApertar={wp.enviarTom} /> : null}

        <div className="flex items-center gap-2">
          {soPedeALigacao ? null : (
          <>
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
          </>
          )}
          <Button variant="destructive" className="ml-auto" onClick={wp.encerrar}>
            <PhoneX size={16} weight="bold" aria-hidden />
            {t("Desligar chamada")}
          </Button>
        </div>

        {!soPedeALigacao && chamada.midia.somBloqueado ? (
          <div className="flex flex-col gap-2 rounded-md bg-amber-500/10 p-3 text-xs">
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
              {t("O navegador bloqueou o som desta ligação. Você não está ouvindo a outra pessoa.")}
            </p>
            <Button type="button" size="sm" onClick={wp.ativarSom}>
              {t("Ativar o som")}
            </Button>
          </div>
        ) : null}

        {!soPedeALigacao && chamada.estado === "em_andamento" ? (
          <>
            {problemasDeAudio(chamada.midia).conexao ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
                {t("A conexão do áudio com a central não fechou. Costuma ser firewall, VPN ou rede que bloqueia áudio (UDP).")}
              </p>
            ) : null}
            {problemasDeAudio(chamada.midia).silencioRecebido ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
                {t("Está chegando áudio da central, mas sem som nenhum. Se a outra pessoa está falando, a voz dela não está passando pela central (linha ou tronco).")}
              </p>
            ) : null}
            {problemasDeAudio(chamada.midia).navegadorNaoToca ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
                {t("O som está chegando, mas o navegador não está tocando. Veja a saída de áudio do computador e se a aba está silenciada.")}
              </p>
            ) : null}
            {problemasDeAudio(chamada.midia).semRecebimento ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
                {t("Nenhum áudio da central está chegando.")}
              </p>
            ) : null}
            {problemasDeAudio(chamada.midia).semEnvio ? (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
                {t("O seu microfone não está enviando áudio. Confira o microfone escolhido no navegador e o volume do sistema.")}
              </p>
            ) : null}
          </>
        ) : null}

        {!soPedeALigacao && chamada.estado === "em_andamento" && chamada.midia.pacotesRecebidos !== undefined ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">{t("Detalhes do áudio")}</summary>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
              <dt>{t("Pacotes recebidos")}</dt>
              <dd>{chamada.midia.pacotesRecebidos ?? 0}</dd>
              <dt>{t("Pacotes enviados")}</dt>
              <dd>{chamada.midia.pacotesEnviados ?? 0}</dd>
              <dt>{t("Conexão")}</dt>
              <dd>{chamada.midia.ice ?? "—"}</dd>
              <dt>{t("Caminho")}</dt>
              <dd>{chamada.midia.caminho ?? "—"}</dd>
              <dt>{t("Som recebido")}</dt>
              <dd>{chamada.midia.energiaRecebida != null ? chamada.midia.energiaRecebida.toFixed(4) : "—"}</dd>
              <dt>{t("Reprodução")}</dt>
              <dd>
                {chamada.midia.elementoTocando == null ? "—" : chamada.midia.elementoTocando ? t("tocando") : t("parada")}
              </dd>
              <dt>{t("Microfone em uso")}</dt>
              <dd className="break-words">{chamada.midia.microfone ?? "—"}</dd>
              <dt>{t("Som captado pelo microfone")}</dt>
              <dd>{chamada.midia.energiaEnviada != null ? chamada.midia.energiaEnviada.toFixed(4) : "—"}</dd>
              <dt>{t("Formato do áudio")}</dt>
              <dd>{chamada.midia.codec ?? "—"}</dd>
              <dt>{t("Amostras decodificadas")}</dt>
              <dd>{chamada.midia.amostrasRecebidas ?? "—"}</dd>
              <dt>{t("Amostras inventadas")}</dt>
              <dd>{chamada.midia.amostrasOcultas ?? "—"}</dd>
              <dt>{t("Bytes recebidos")}</dt>
              <dd>{chamada.midia.bytesRecebidos ?? "—"}</dd>
              <dt>{t("Trilha sem sinal")}</dt>
              <dd>{chamada.midia.trilhaSemSinal == null ? "—" : chamada.midia.trilhaSemSinal ? t("Sim") : t("Não")}</dd>
              <dt>{t("Elemento de áudio")}</dt>
              <dd>{chamada.midia.elemento ?? "—"}</dd>
            </dl>
          </details>
        ) : null}

        {chamada.qualidade ? (
          <p className="text-xs text-muted-foreground">
            {t("Qualidade da chamada")}:{" "}
            <span
              className={
                chamada.qualidade === "boa"
                  ? "font-medium text-emerald-600"
                  : chamada.qualidade === "regular"
                    ? "font-medium text-amber-600"
                    : "font-medium text-destructive"
              }
            >
              {chamada.qualidade === "boa" ? t("Boa") : chamada.qualidade === "regular" ? t("Regular") : t("Ruim")}
            </span>
          </p>
        ) : null}
      </CaixaFixa>
    );
  }

  // ── o fechamento: perdida, não completou ou como foi a conversa ───────────
  if (fechamento) {
    const titulo = fechamento.perdida
      ? t("Ligação perdida")
      : fechamento.atendida
        ? t("Ligação encerrada")
        : t("A ligação não completou");
    return (
      <CaixaFixa
        role="dialog"
        aria-label={titulo}
        className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
              fechamento.perdida || !fechamento.atendida ? "bg-red-500/10 text-red-600" : "bg-primary/10 text-primary"
            }`}
          >
            {fechamento.perdida || !fechamento.atendida ? (
              <PhoneX size={20} weight="bold" aria-hidden />
            ) : (
              <Phone size={20} weight="bold" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {titulo}
              {fechamento.atendida ? <span className="ml-2 font-normal text-muted-foreground tabular-nums">{duracaoLegivel(fechamento.duracaoS)}</span> : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{nome ? `${nome} · ${numeroExibido}` : numeroExibido}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label={t("Fechar")} onClick={wp.fecharFechamento}>
            <X size={16} weight="bold" aria-hidden />
          </Button>
        </div>

        {fechamento.erro ? (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <Warning size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />
            {fechamento.erro}
          </p>
        ) : null}

        {fechamento.atendida ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{t("Como foi a ligação?")}</p>
            <div className="flex flex-wrap gap-1.5">
              {RESULTADOS_DA_LIGACAO.map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant={fechamento.resultado === r ? "default" : "outline"}
                  aria-pressed={fechamento.resultado === r}
                  onClick={() => wp.escolherResultado(r)}
                >
                  {t(ROTULO_DO_RESULTADO[r])}
                </Button>
              ))}
            </div>
          </div>
        ) : fechamento.numero ? (
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={registro !== "registrado"}
            onClick={() => {
              const numero = fechamento.numero;
              if (numero) wp.discar(numero);
            }}
          >
            <Phone size={16} weight="bold" aria-hidden />
            {fechamento.perdida ? t("Ligar de volta") : t("Ligar de novo")}
          </Button>
        ) : null}
      </CaixaFixa>
    );
  }

  // ── em repouso: o FAB e, aberto, o teclado de discagem ────────────────────
  // Flutua por cima do conteúdo e NÃO reserva rodapé (não passa por `CaixaFixa`).
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
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
            {t("Ligar agora")}
          </Button>
          {registro !== "registrado" ? (
            <p className="text-xs text-muted-foreground">{rotuloDoRegistro}</p>
          ) : null}
          {soPedeALigacao ? (
            <div className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground">
              <p>{t("O áudio acontece na janela da central. Deixe-a aberta e conectada.")}</p>
              {wp.painelUrl ? (
                <Button type="button" size="sm" variant="outline" onClick={wp.abrirJanela}>
                  {t("Abrir a janela da central")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* O FAB: um círculo com o fone e a bolinha do estado do ramal. O rótulo
          ("Ramal conectado"…) vai no `title` e para o leitor de tela, não ocupa a tela. */}
      <Button
        variant="outline"
        size="icon"
        className="relative h-12 w-12 rounded-full bg-background shadow-lg lg:h-12 lg:w-12"
        aria-expanded={aberto}
        aria-label={t("Abrir o telefone")}
        title={rotuloDoRegistro}
        onClick={() => setAberto((v) => !v)}
      >
        <Phone size={20} weight="bold" aria-hidden />
        <span
          className={`absolute top-0.5 right-0.5 size-3 rounded-full ring-2 ring-background ${corDoRegistro}`}
          aria-hidden
        />
        <span className="sr-only">{rotuloDoRegistro}</span>
      </Button>
    </div>
  );
}
