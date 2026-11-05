"use client";
import { ID_DO_ENCAIXE_DA_CONEXAO_CAIDA } from "@/components/app/ConexaoCaidaBanner";
import { AlertsBell } from "./AlertsBell";
import { AvisoDePropostaEmDestaque } from "./AvisoDePropostaEmDestaque";
import { MobileSidebar } from "./MobileSidebar";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";

export function TopBar() {
  return (
    // ⚠️ A PEGADA É DE 56px (`h-14`), COMO SEMPRE FOI — e é o que paga o desenho flutuante.
    //
    // Inbox, Funis e Casos calculam a própria altura como `100dvh - 3.5rem - …` (ver
    // `InboxLayout.tsx`, "TopBar (h-14)"). Um cabeçalho de 64px, ou com margem de fora,
    // estouraria todas elas em silêncio. Por isso o `header` continua com 56px e o que
    // parece solto é um cartão de 48px DENTRO dele: 8px de vão em cima + 48 = 56.
    //
    // O `header` tem fundo próprio (`bg-background/90` + blur) e não é transparente:
    // com o vão vazado, o conteúdo que rola por baixo apareceria nos cantos do cartão.
    <header className="sticky top-[var(--faixas-de-cima,0px)] z-20 h-14 bg-background/90 px-2 pt-2 backdrop-blur md:pr-4">
      <div className="flex h-12 items-center justify-between gap-2 rounded-2xl border bg-card px-3 shadow-sm md:gap-4 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <MobileSidebar />
          <TenantSwitcher />
        </div>
        <div className="flex min-w-0 flex-1 justify-center md:max-w-md">
          <SearchTrigger />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* O ENCAIXE do aviso de WhatsApp desconectado (`ConexaoCaidaBanner`):
              o chip aparece aqui, no lugar de uma faixa que tomava a altura da tela.
              Vazio, não ocupa nada (`empty:hidden`). */}
          <div id={ID_DO_ENCAIXE_DA_CONEXAO_CAIDA} className="flex min-w-0 items-center empty:hidden" />
          <AlertsBell />
          <AvisoDePropostaEmDestaque />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
