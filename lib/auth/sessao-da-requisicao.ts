/**
 * A sessão da requisição e o `getUser()` dela, PELO cache entre requisições (#3696).
 *
 * Mora em módulo próprio — e não em `lib/auth/server.ts`, onde nasceu — por um
 * motivo de teste e não de gosto: muita rota é testada com `@/lib/auth/server`
 * dublado, e uma função nova ali obrigaria todo dublê a conhecê-la. Aqui, a rota
 * que troca `supabase.auth.getUser()` por `getUserDaRequisicao()` continua
 * passando pelo `createClient()` que o teste já dubla. `lib/auth/server.ts`
 * importa `sessaoDaRequisicao` daqui; a lógica é a mesma, sem uma linha mudada.
 */
import { cache } from "react";
import { cookies } from "next/headers";

import {
  comCacheCurto,
  etiquetaDeSessao,
  etiquetaDeUsuario,
  sessaoDosCookies,
  type SessaoDosCookies,
} from "@/lib/auth/cache-curto";
import { createClient } from "@/lib/supabase/server";

/**
 * A sessão que os cookies da requisição identificam — `null` quando não há
 * requisição (script, job) ou quando o cookie não é reconhecível. Nesses casos a
 * requisição segue o caminho direto, sem chave de cache.
 */
async function sessaoDosCookiesDaIrequisicao(): Promise<SessaoDosCookies | null> {
  try {
    return sessaoDosCookies((await cookies()).getAll());
  } catch {
    // `cookies()` lança fora de escopo de requisição. Antes do #3696 este
    // caminho nem tocava o cookie de sessão; quem chama `loadAuthUser` de um
    // script continua funcionando, só não reaproveita nada.
    return null;
  }
}

export const sessaoDaRequisicao = cache(async () => {
  const supabase = await createClient();
  const sessao = await sessaoDosCookiesDaIrequisicao();
  /**
   * CACHE ENTRE REQUISIÇÕES DO `getUser()` — é a maior linha do log do
   * Supabase na issue #3696 (18,6 mil `/auth/v1/user` em ~17 h), porque toda
   * navegação valida o mesmo token de novo.
   *
   * Duas travas, ambas de segurança:
   *  - a chave é o HASH dos cookies de sessão: token rotacionado, chave nova.
   *    Sem cookie, não há chave e a requisição segue o caminho direto;
   *  - o `exp` do JWT é o teto (`ate`), com margem. Servir um usuário em cache
   *    para um token vencido faria as consultas RLS seguintes levarem 401 — o
   *    cache devolveria "autenticado" com credencial morta. Sem `exp` legível,
   *    NÃO se cacheia (fail-open para o caminho de hoje).
   *
   * Só o SUCESSO é guardado: `error` é incidente, não estado — e `user: null`
   * com erro é justamente o caso que não pode virar resposta reaproveitada.
   */
  const resposta =
    sessao && sessao.expiraEm !== null
      ? await comCacheCurto({
          chave: `sessao:${sessao.chave}`,
          etiquetas: [etiquetaDeSessao(sessao.chave)],
          // A identidade também derruba a sessão: `invalidarUsuario` (sair de
          // todos os aparelhos, MFA novo, revogação) alcança as OUTRAS sessões
          // da pessoa, cujo cookie esta requisição não conhece.
          etiquetasDoValor: (r) => (r.data?.user ? [etiquetaDeUsuario(r.data.user.id)] : []),
          ate: sessao.expiraEm,
          guardar: (r) => !r.error && !!r.data?.user,
          carregar: () => supabase.auth.getUser(),
        })
      : await supabase.auth.getUser();
  return { supabase, resposta, sessao };
});

/**
 * O `getUser()` da requisição, PELO cache de sessão — o substituto direto de
 * `supabase.auth.getUser()` numa rota `/api/v1`.
 *
 * Existe porque a rota que chamava `supabase.auth.getUser()` e, logo depois,
 * `loadAuthUser()` pagava uma ida ao `/auth/v1/user` a TODA requisição: a chamada
 * crua nunca passa pelo cache que `loadAuthUser` usa (#3696), então a segunda
 * dependia do cache e a primeira o ignorava. Abrir uma conversa dispara a lista,
 * as contagens, a conversa, as mensagens, o resumo e a linha do tempo — seis
 * rotas, seis idas ao GoTrue, onde o cache pagaria uma.
 *
 * Devolve a MESMA forma de `supabase.auth.getUser()` (`{ data: { user }, error }`),
 * para a troca na rota ser de uma linha e o `if (authErr || !user)` seguir igual.
 * As travas de segurança são as de `sessaoDaRequisicao`: chave é o hash dos
 * cookies, o `exp` do JWT é o teto, só sucesso é guardado, e `invalidarUsuario`
 * (revogação, MFA, sair de todos os aparelhos) derruba a entrada na hora.
 */
export async function getUserDaRequisicao() {
  const { resposta } = await sessaoDaRequisicao();
  return resposta;
}
