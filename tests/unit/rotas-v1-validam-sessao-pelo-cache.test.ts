/**
 * CERCA: rota `/api/v1` não chama `supabase.auth.getUser()` cru.
 *
 * O `getUser()` cru é uma ida de rede ao `/auth/v1/user` a CADA requisição e nunca
 * passa pelo cache de sessão que `loadAuthUser` usa (#3696). As rotas do Inbox o
 * chamavam logo antes de `loadAuthUser()`: abrir uma conversa disparava seis
 * rotas e seis idas ao GoTrue, onde o cache pagaria uma — numa instalação cujo
 * Supabase está longe da VPS (170–420 ms por consulta), é a tela que fica no
 * esqueleto. A troca é de uma linha: `getUserDaRequisicao()` (`lib/auth/sessao-da-requisicao`)
 * devolve a mesma forma de resposta, pelo cache.
 *
 * A lista abaixo é das rotas que ficaram de fora da troca, e cada uma diz por quê.
 * Ela só encolhe: rota nova usa `getUserDaRequisicao` ou `requireRole`.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");

/**
 * Rotas que seguem com o `getUser()` cru. NÃO é um veredito de que precisam dele:
 * são rotas de sessão, suporte e LGPD — raras, fora do caminho quente do Inbox —
 * que ficaram de fora da troca para ela ser só das leituras que o Inbox dispara.
 * Quem as migrar (ou provar que precisam da ida real) tira a linha daqui.
 */
const FORA_DA_TROCA: Record<string, string> = {
  "app/api/v1/admin/impersonate/end/route.ts":
    "acompanhamento de suporte — fora do caminho quente, não avaliada",
  "app/api/v1/auth/realtime-token/route.ts":
    "token do Realtime — fora do caminho quente, não avaliada",
  "app/api/v1/auth/support/route.ts":
    "acompanhamento de suporte — fora do caminho quente, não avaliada",
  "app/api/v1/lgpd/anonymize/route.ts":
    "LGPD (irreversível) — deliberadamente não tocada nesta troca",
};

function rotasV1(): string[] {
  const saida = execFileSync("git", ["ls-files", "app/api/v1/**/route.ts"], {
    cwd: RAIZ,
    encoding: "utf8",
  });
  return saida.split("\n").filter(Boolean);
}

describe("rotas /api/v1 e o getUser() cru", () => {
  it("nenhuma rota fora da lista chama `supabase.auth.getUser()`", () => {
    const infratoras = rotasV1().filter(
      (rota) =>
        !(rota in FORA_DA_TROCA) &&
        /\.auth\.getUser\(\)/.test(readFileSync(path.join(RAIZ, rota), "utf8")),
    );
    expect(
      infratoras,
      "troque por `getUserDaRequisicao()` de `@/lib/auth/sessao-da-requisicao` (mesma forma de resposta, pelo cache de sessão)",
    ).toEqual([]);
  });

  it("a lista não guarda rota que já migrou nem rota que sumiu", () => {
    const existentes = new Set(rotasV1());
    const obsoletas = Object.keys(FORA_DA_TROCA).filter(
      (rota) =>
        !existentes.has(rota) ||
        !/\.auth\.getUser\(\)/.test(readFileSync(path.join(RAIZ, rota), "utf8")),
    );
    expect(obsoletas, "tire da lista: ela só encolhe").toEqual([]);
  });
});
