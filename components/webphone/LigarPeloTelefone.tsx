"use client";
/**
 * O botão "Ligar" da ficha — liga pelo telefone do CRM (o ramal da pessoa
 * logada), não pelo WhatsApp. Só existe para quem tem webphone: sem ramal ativo
 * o botão nem é desenhado, e o `DialButton` da chamada de WhatsApp segue sozinho.
 */
import { useWebphone } from "@/components/webphone/contexto";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { Phone } from "@/lib/ui/icons";

interface Props {
  /** O telefone do contato, como está na ficha. */
  numero: string | null;
}

export function LigarPeloTelefone({ numero }: Props) {
  const t = useT();
  const wp = useWebphone();
  if (!wp.disponivel || !numero) return null;

  const emLigacao = wp.chamada !== null;
  const pronto = wp.registro === "registrado" && !emLigacao;

  return (
    <Button
      className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700"
      disabled={!pronto}
      title={wp.registro !== "registrado" ? t("Ramal desconectado") : undefined}
      onClick={() => {
        wp.discar(numero);
      }}
    >
      <Phone size={16} weight="bold" aria-hidden />
      <span>{emLigacao ? t("Em ligação") : t("Ligar agora")}</span>
    </Button>
  );
}
