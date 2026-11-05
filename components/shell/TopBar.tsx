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
    // ⚠️ A PEGADA É DE 56px (`h-14`), COMO SEMPRE FOI.
    //
    // Inbox, Funis e Casos calculam a própria altura como `100dvh - 3.5rem - …` (ver
    // `InboxLayout.tsx`, "TopBar (h-14)"). Um cabeçalho mais alto estouraria todas
    // elas em silêncio. Ele é uma faixa encostada nas bordas, com a linha de baixo
    // alinhada à da barra lateral (as duas têm 56px de topo).
    <header className="sticky top-[var(--faixas-de-cima,0px)] z-20 h-14 border-b bg-card">
      <div className="flex h-full items-center justify-between gap-2 px-3 md:gap-4 md:px-4">
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
