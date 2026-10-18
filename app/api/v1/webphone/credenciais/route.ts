/**
 * GET /api/v1/webphone/credenciais — o que o navegador do DONO precisa para
 * registrar o ramal dele (agent+).
 *
 * É o único caminho que decifra a senha SIP, e só devolve a linha de quem está
 * logado — o `userId` vem da sessão validada, nunca de parâmetro. `data: null`
 * (200) quer dizer "esta pessoa não tem webphone": a tela não desenha o telefone.
 *
 * Em acompanhamento administrativo a rota devolve `null`: quem acompanha a
 * organização de outra pessoa não recebe a senha SIP de ninguém.
 */
import { randomUUID } from "node:crypto";

import { ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { credenciaisDoDono } from "@/lib/webphone/servidor";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "user_webphone_ramais" });
  if (!authz.ok) return authz.response;

  const resposta = (dados: unknown) => {
    const r = ok(dados, { requestId });
    // A resposta carrega uma senha: nada de cache em proxy nem no navegador.
    r.headers.set("Cache-Control", "no-store");
    return r;
  };

  if (authz.user.support) return resposta(null);

  const credenciais = await credenciaisDoDono({
    admin: createAdminClient(),
    orgId: authz.org.orgId,
    userId: authz.user.id,
  });
  return resposta(credenciais);
}
