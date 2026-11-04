"use client";
/**
 * O histórico de ligações de um contato, na ficha — o que o telefone do CRM
 * registrou: quem ligou para quem, quanto durou, o que a pessoa marcou ao
 * desligar e as perdidas, com o "Ligar de volta" ao lado.
 */
import { useQuery } from "@tanstack/react-query";

import { useWebphone } from "@/components/webphone/contexto";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneX } from "@/lib/ui/icons";
import {
  ROTULO_DO_RESULTADO,
  duracaoLegivel,
  tipoDaLigacao,
  type LigacaoDoHistorico,
} from "@/lib/webphone/config";

export function HistoricoDeLigacoes({ contactId }: { contactId: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const wp = useWebphone();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["webphone", "chamadas", contactId],
    queryFn: async () =>
      (await apiClient.get<{ data: LigacaoDoHistorico[] }>(`/api/v1/webphone/chamadas?contact_id=${contactId}`)).data,
    staleTime: 15_000,
  });

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (isError) return <p className="text-sm text-destructive">{t("Não foi possível carregar as ligações.")}</p>;

  const ligacoes = data ?? [];
  if (ligacoes.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {t("Nenhuma ligação com este contato ainda. Use o botão Ligar agora para começar.")}
      </Card>
    );
  }

  const formatarDia = (iso: string) =>
    new Date(iso).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <Card className="divide-y p-0">
      {ligacoes.map((l) => {
        const tipo = tipoDaLigacao(l);
        const Icone = tipo === "perdida" ? PhoneX : tipo === "recebida" ? PhoneIncoming : PhoneOutgoing;
        const titulo = tipo === "perdida" ? t("Ligação perdida") : tipo === "recebida" ? t("Ligação recebida") : t("Ligação feita");
        return (
          <div key={l.id} className="flex items-center gap-3 p-3">
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                tipo === "perdida" ? "bg-red-500/10 text-red-600" : "bg-primary/10 text-primary"
              }`}
            >
              <Icone size={18} weight="bold" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {titulo}
                {l.answered_at && l.duration_ms !== null ? (
                  <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                    {duracaoLegivel(l.duration_ms / 1000)}
                  </span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatarDia(l.started_at)} · {phoneForDisplay(l.peer_phone)}
                {l.resultado ? ` · ${t(ROTULO_DO_RESULTADO[l.resultado])}` : ""}
              </p>
            </div>
            {tipo === "perdida" && wp.disponivel ? (
              <Button
                size="sm"
                variant="outline"
                disabled={wp.registro !== "registrado" || wp.chamada !== null}
                onClick={() => {
                  wp.discar(l.peer_phone);
                }}
              >
                <Phone size={14} weight="bold" aria-hidden />
                {t("Ligar de volta")}
              </Button>
            ) : null}
          </div>
        );
      })}
    </Card>
  );
}
