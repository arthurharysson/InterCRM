/**
 * A conexão caiu — e você vê isso na tela em que já está.
 *
 * ─── Por que uma faixa, se o aviso já vai para a Central ───────────────────
 *
 * Porque a Central é uma tela que se ABRE, e ninguém a abre por acaso. A falha
 * que originou este componente não foi a falta do aviso — foi a falta de alguém
 * para lê-lo: a sessão caiu, o estado foi gravado, e a descoberta aconteceu
 * horas depois, quando o dono estranhou o silêncio e foi olhar por conta própria.
 * Um aviso guardado onde ninguém passa repete exatamente esse defeito.
 *
 * Esta faixa aparece em TODA tela de /app — inclusive no inbox, onde a pessoa
 * está justamente quando as mensagens deveriam estar chegando. É o lugar onde a
 * ausência delas é sentida.
 *
 * ─── Por que não é e-mail ──────────────────────────────────────────────────
 *
 * Seria melhor: chega mesmo com o navegador fechado. Mas `RESEND_API_KEY` é
 * opcional e está VAZIA numa instalação real — e um aviso que depende de env
 * opcional é um aviso que não existe justamente em quem instalou sozinho e não
 * configurou nada. A faixa funciona em toda instalação, sem configurar nada.
 * O e-mail é um acréscimo possível depois; a faixa é o que não pode faltar.
 */
"use client";
// Client de propósito, e a razão não é interatividade: a faixa é renderizada
// pelo layout de /app, que é servidor, mas fica DENTRO do `IdiomaProvider`. Um
// componente de servidor não enxerga contexto de client, então ou ele recebia o
// idioma por prop — mudando a assinatura e todo chamador — ou passa a ser
// client e o lê de onde já está. Ele não faz nada de servidor: é Link e prosa.
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { ROLE_RANK } from "@/lib/auth/types";
import type { ConexaoCaida } from "@/lib/channels/health";

/**
 * ONDE O AVISO MORA: NO CABEÇALHO, não numa faixa que come a altura da tela.
 *
 * O `TopBar` deixa um encaixe com este id. Havendo encaixe, o aviso vira um chip
 * compacto DENTRO do cabeçalho flutuante — a altura que a faixa vermelha tomava
 * volta inteira para a conversa, e `FaixasDeCima` mede zero. Sem encaixe (uma
 * tela sem o cabeçalho), cai na faixa de sempre: o aviso nunca some por falta de
 * lugar. `useSyncExternalStore` e não `useEffect + setState`: o servidor e a
 * hidratação enxergam "sem encaixe" (nada é desenhado), e o cliente passa a ver
 * o elemento sem um segundo render em cascata.
 */
export const ID_DO_ENCAIXE_DA_CONEXAO_CAIDA = "encaixe-conexao-caida";

const semAssinatura = () => () => {};
const acharEncaixe = () => document.getElementById(ID_DO_ENCAIXE_DA_CONEXAO_CAIDA);
const encaixeNoServidor = () => undefined;

/**
 * `precisaEscanear` muda o texto do botão, não só a cor: reconectar por QR é uma
 * ação concreta ("Escanear"), enquanto um canal em FAILED exige olhar o que
 * aconteceu antes de agir. Mandar "Escanear" para quem precisa investigar faria
 * a pessoa perder tempo numa tela que não resolve o problema dela.
 */
export function ConexaoCaidaBanner({ caidas }: { caidas: ConexaoCaida[] }) {
  const t = useT();
  const { user, activeOrg } = useAuth();
  const encaixe = useSyncExternalStore<HTMLElement | null | undefined>(
    semAssinatura,
    acharEncaixe,
    encaixeNoServidor,
  );
  if (caidas.length === 0) return null;

  const podeAbrirConexoes = (user.is_platform_admin && !user.support)
    || (activeOrg !== null && ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin);
  const uma = caidas.length === 1 ? caidas[0] : null;
  const precisaEscanear = caidas.some((c) => c.status === "SCAN_QR_CODE");

  const mensagem = (
    <>
      {uma ? (
        <>
          WhatsApp <strong className="font-semibold">{uma.apelido}</strong>{" "}
          {t("está desconectado")}
        </>
      ) : (
        <>
          <strong className="font-semibold">
            {caidas.length} {t("conexões")}
          </strong>{" "}
          {t("de WhatsApp estão desconectadas")}
        </>
      )}
    </>
  );
  const consequencia = ` — ${t("nenhuma mensagem entra nem sai.")}`;
  const rotuloDoBotao = precisaEscanear ? t("Escanear o QR") : t("Ver conexões");
  const orientacao = t("Peça a quem administra para revisar a conexão do WhatsApp.");

  // Servidor e hidratação: ainda não se sabe se há encaixe — nada é desenhado
  // para não piscar uma faixa que logo viraria chip.
  if (encaixe === undefined) return null;

  if (encaixe) {
    // O CHIP: uma linha, dentro do cabeçalho. A frase inteira fica no `title`;
    // abaixo de `lg` sobra o ícone e o botão, e a frase vira texto de leitor de tela.
    return createPortal(
      <div
        role="alert"
        aria-live="assertive"
        title={`${uma ? `WhatsApp ${uma.apelido} ${t("está desconectado")}` : `${caidas.length} ${t("conexões")} ${t("de WhatsApp estão desconectadas")}`} — ${t("nenhuma mensagem entra nem sai.")}`}
        className="flex min-w-0 items-center gap-2 rounded-xl border border-red-300 bg-red-100 py-1 pr-1 pl-2.5 text-xs text-red-950 dark:border-red-800/60 dark:bg-red-950/70 dark:text-red-50"
      >
        <span aria-hidden>🔌</span>
        <span className="sr-only whitespace-nowrap xl:not-sr-only">
          {mensagem}
          {/* A consequência cabe só em tela larga; o `title` e o leitor de tela a têm sempre. */}
          <span className="sr-only 2xl:not-sr-only">{consequencia}</span>
        </span>
        {podeAbrirConexoes ? (
          <Link
            href="/app/connections"
            className="shrink-0 rounded-lg border border-red-400 bg-white/70 px-2.5 py-1 font-medium text-red-950 hover:bg-white dark:border-red-700 dark:bg-red-900/40 dark:text-red-50 dark:hover:bg-red-900/70"
          >
            {rotuloDoBotao}
          </Link>
        ) : (
          <span className="sr-only">{orientacao}</span>
        )}
      </div>,
      encaixe,
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-red-300 bg-red-100/95 px-4 py-2 text-sm text-red-950 backdrop-blur dark:border-red-800/60 dark:bg-red-950/70 dark:text-red-50"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden>🔌</span>
        <span>{mensagem}{consequencia}</span>
      </div>
      {podeAbrirConexoes ? <Link
        href="/app/connections"
        className="rounded-md border border-red-400 bg-white/70 px-3 py-1 font-medium max-md:inline-flex max-md:min-h-11 max-md:items-center text-red-950 hover:bg-white dark:border-red-700 dark:bg-red-900/40 dark:text-red-50 dark:hover:bg-red-900/70"
      >
        {rotuloDoBotao}
      </Link> : <span>{orientacao}</span>}
    </div>
  );
}
