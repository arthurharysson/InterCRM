import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { WebphoneSettingsClient, type ConfiguracaoSalva } from "./_client";

export const dynamic = "force-dynamic";

const COLUNAS = "organization_id, wss_url, sip_domain, painel_url, dial_prefix, is_active, updated_at";

export default async function WebphoneSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");
  const idioma = user.idioma;

  const supabase = await createClient();
  const { data } = await supabase
    .from("org_webphone_settings")
    .select(COLUNAS)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{traduzir("Telefone no navegador", idioma)}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {traduzir(
            "Seus atendentes ligam e recebem chamadas pelo CRM, usando o ramal que a central telefônica da empresa já tem. URA, filas e transferência continuam na central.",
            idioma,
          )}
        </p>
      </header>
      <WebphoneSettingsClient initialData={(data as ConfiguracaoSalva | null) ?? null} />
    </div>
  );
}
