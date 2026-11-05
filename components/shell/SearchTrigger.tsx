"use client";
import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { MagnifyingGlass } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { CommandPalette } from "@/components/shell/CommandPalette";

export function SearchTrigger() {
  const t = useT();
  const [open, setOpen] = useState(false);

  // `enableOnFormTags`: o atalho precisa funcionar com o cursor dentro do
  // composer do inbox, que é onde o operador passa o dia.
  useHotkeys("mod+k", () => setOpen(true), { preventDefault: true, enableOnFormTags: true });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        // Uma pílula larga, como no desenho de referência: ocupa o espaço que a
        // coluna da busca oferece (até `max-w-md`) e empurra o atalho para a direita.
        className="gap-2 text-muted-foreground md:h-10 md:w-full md:justify-start md:rounded-full md:px-4"
        onClick={() => setOpen(true)}
      >
        <MagnifyingGlass size={16} aria-hidden />
        <span className="max-md:sr-only">{t("Buscar...")}</span>
        <kbd className="ml-auto hidden md:inline rounded-md border bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </Button>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  );
}
