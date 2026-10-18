"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  phoneNumber: string;
  contactId?: string;
  leadId?: string;
}

interface FluxoExtension {
  id: number | string;
  extension: string;
  callerid: string | null;
}

async function fetchExtensions(): Promise<FluxoExtension[]> {
  const res = await fetch("/api/v1/fluxo/extensions");
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

async function makeCall(params: {
  extension: string;
  toNumber: string;
  contactId?: string;
  leadId?: string;
}) {
  const res = await fetch("/api/v1/fluxo/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      extension: params.extension,
      toNumber: params.toNumber,
      contactId: params.contactId,
      leadId: params.leadId,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? "Falha ao originar chamada");
  }
  return res.json();
}

export function FluxoDialButton({ phoneNumber, contactId, leadId }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const extensions = useQuery({
    queryKey: ["fluxo-extensions"],
    queryFn: fetchExtensions,
    staleTime: 60_000,
    enabled: open,
  });

  const call = useMutation({
    mutationFn: makeCall,
    onSuccess: () => {
      toast.success(t("Chamada iniciada — seu ramal vai tocar"));
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  if (!phoneNumber) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="shrink-0"
          disabled={call.isPending}
        >
          <Phone size={16} weight="bold" aria-hidden />
          <span>{call.isPending ? t("Ligando...") : t("Ligar")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
        {extensions.isLoading && (
          <DropdownMenuItem disabled>{t("Carregando ramais...")}</DropdownMenuItem>
        )}
        {extensions.data?.length === 0 && (
          <DropdownMenuItem disabled>{t("Nenhum ramal encontrado")}</DropdownMenuItem>
        )}
        {extensions.data?.map((ext) => (
          <DropdownMenuItem
            key={ext.id}
            onClick={() => {
              setOpen(false);
              call.mutate({
                extension: ext.extension,
                toNumber: phoneNumber,
                contactId,
                leadId,
              });
            }}
          >
            <span className="font-mono text-sm">{ext.extension}</span>
            {ext.callerid && (
              <span className="ml-2 text-muted-foreground text-sm">{ext.callerid}</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
