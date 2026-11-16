"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { copyToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";

/**
 * O chat de atendimento fora do WhatsApp — a página para onde o bot manda o cliente (botão com link).
 *
 * É uma APLICAÇÃO SEPARADA: o cliente conversa nela e o atendente responde aqui, pelo Inbox. Este cartão faz as duas
 * coisas que ligam as pontas: criar o canal (que gera as chaves) e dizer onde colar cada uma no Chat.
 *
 * ─── Os segredos aparecem UMA vez ──────────────────────────────────────────────────────────────
 *
 * Nascem no servidor, voltam só na criação ou ao girar, e ficam na memória DESTA tela até ela fechar: o botão
 * "Entendi, já guardei" os apaga. Nenhum GET os devolve — por isso a tela avisa em voz alta, antes de o operador
 * descobrir pela mensagem que nunca chegou.
 *
 * O caminho e os nomes não citam o provider (`lint:channels`): a tela fala em "o chat".
 */

const ROTA = "/api/v1/channels/chat-publico";
const CHAVE = ["canais-do-chat"];

interface Canal {
  channel_session_id: string;
  ref: string;
  display_name: string | null;
  outbound_url: string | null;
  status: string | null;
  inbound_url: string | null;
  has_secret_to_crm: boolean;
  has_secret_from_crm: boolean;
}

interface Segredos {
  inbound_url?: string | null;
  secret_to_crm: string;
  secret_from_crm: string;
}

/** Campo somente-leitura com botão de copiar — o que o operador cola no Chat. */
function ParaColar({ rotulo, nomeNoChat, valor }: { rotulo: string; nomeNoChat: string; valor: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo} <span className="normal-case">→ {nomeNoChat}</span>
      </span>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md bg-muted px-2 py-1.5 text-xs">{valor}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await copyToClipboard(valor);
            toast.success(t("Copiado."));
          }}
        >
          {t("Copiar")}
        </Button>
      </div>
    </div>
  );
}

function ChavesNovas({ segredos, aoFechar }: { segredos: Segredos; aoFechar: () => void }) {
  const t = useT();
  return (
    <Card className="flex flex-col gap-3 border-amber-500/60 p-4" data-testid="chat-chaves-novas">
      <div>
        <h3 className="text-sm font-semibold">{t("Guarde estas chaves agora")}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            "Elas aparecem só desta vez e não ficam salvas em lugar nenhum além do cofre do CRM. Cole cada uma no Chat, na variável indicada.",
          )}
        </p>
      </div>
      {segredos.inbound_url && (
        <ParaColar rotulo={t("Endereço de entrada do CRM")} nomeNoChat="CRM_ENTRY_URL" valor={segredos.inbound_url} />
      )}
      <ParaColar rotulo={t("Chave que o Chat usa para falar com o CRM")} nomeNoChat="CRM_SECRET_TO_CRM" valor={segredos.secret_to_crm} />
      <ParaColar rotulo={t("Chave que o CRM usa para falar com o Chat")} nomeNoChat="CRM_SECRET_FROM_CRM" valor={segredos.secret_from_crm} />
      <div>
        <Button onClick={aoFechar}>{t("Entendi, já guardei")}</Button>
      </div>
    </Card>
  );
}

function CartaoDoCanal({ canal, aoGirar }: { canal: Canal; aoGirar: (s: Segredos) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [endereco, setEndereco] = useState(canal.outbound_url ?? "");
  const [ocupado, setOcupado] = useState<"endereco" | "girar" | null>(null);

  const salvarEndereco = async () => {
    setOcupado("endereco");
    try {
      await apiClient.patch(ROTA, { channel_session_id: canal.channel_session_id, outbound_url: endereco });
      toast.success(t("Endereço do chat gravado."));
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível gravar o endereço."));
    } finally {
      setOcupado(null);
    }
  };

  const girar = async () => {
    if (
      !window.confirm(
        t(
          "Girar as chaves invalida as atuais: o Chat para de falar com o CRM até receber as novas. Continuar?",
        ),
      )
    ) {
      return;
    }
    setOcupado("girar");
    try {
      const r = await apiClient.patch<{ data: Segredos }>(ROTA, {
        channel_session_id: canal.channel_session_id,
        rotate_secrets: true,
      });
      aoGirar({ ...r.data, inbound_url: canal.inbound_url });
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível girar as chaves."));
    } finally {
      setOcupado(null);
    }
  };

  const incompleto = !canal.has_secret_to_crm || !canal.has_secret_from_crm || !canal.outbound_url;

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="chat-canal">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{canal.display_name ?? canal.ref}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Identificador")}: {canal.ref}
          </p>
        </div>
        {incompleto ? (
          <Badge variant="destructive">{t("Incompleto")}</Badge>
        ) : (
          <Badge variant="secondary">{t("Pronto")}</Badge>
        )}
      </div>

      {canal.inbound_url && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("Endereço de entrada do CRM")}
          </span>
          <code className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 text-xs">{canal.inbound_url}</code>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`chat-endereco-${canal.channel_session_id}`}>{t("Endereço do chat (para onde o CRM envia as respostas)")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id={`chat-endereco-${canal.channel_session_id}`}
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            placeholder="https://<endereço-do-seu-chat>/api/crm/events"
            autoComplete="off"
          />
          <Button
            variant="outline"
            onClick={salvarEndereco}
            disabled={ocupado !== null || endereco.trim() === (canal.outbound_url ?? "") || endereco.trim().length === 0}
          >
            {ocupado === "endereco" ? t("Gravando…") : t("Gravar")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={girar} disabled={ocupado !== null}>
          {ocupado === "girar" ? t("Girando…") : t("Girar as chaves")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("As chaves não são mostradas de novo. Se perdeu uma, gire e cole as novas no Chat.")}
        </p>
      </div>
    </Card>
  );
}

export function CanalChatPublicoClient() {
  const t = useT();
  const qc = useQueryClient();
  const { data: canais = [] } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<{ data: Canal[] }>(ROTA)).data,
  });
  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState("");
  const [criando, setCriando] = useState(false);
  const [segredos, setSegredos] = useState<Segredos | null>(null);

  const criar = async () => {
    setCriando(true);
    try {
      const r = await apiClient.post<{ data: Segredos }>(ROTA, { display_name: nome, outbound_url: endereco });
      setSegredos(r.data);
      setNome("");
      setEndereco("");
      toast.success(t("Canal criado."));
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? t(e.message) : t("Não foi possível criar o canal."));
    } finally {
      setCriando(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="canal-chat-publico">
      <Card className="flex flex-col gap-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">{t("Chat de atendimento fora do WhatsApp")}</h3>
          <p className="text-xs text-muted-foreground">
            {t(
              "O bot do WhatsApp manda o cliente para uma página de chat. A conversa chega aqui, na Fila, e o atendente responde pelo Inbox. Para o bot indicar o setor, defina o código do setor em Equipe › Setores.",
            )}
          </p>
        </div>

        {canais.length === 0 && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-nome">{t("Nome do canal")}</Label>
              <Input
                id="chat-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={t("Chat de atendimento")}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-endereco">{t("Endereço do chat (para onde o CRM envia as respostas)")}</Label>
              <Input
                id="chat-endereco"
                value={endereco}
                onChange={(e) => setEndereco(e.target.value)}
                placeholder="https://<endereço-do-seu-chat>/api/crm/events"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t("Precisa ser https e um endereço público. O Chat informa qual é.")}
              </p>
            </div>
            <div>
              <Button onClick={criar} disabled={criando || nome.trim().length === 0 || endereco.trim().length === 0}>
                {criando ? t("Criando…") : t("Criar o canal")}
              </Button>
            </div>
          </>
        )}
      </Card>

      {segredos && <ChavesNovas segredos={segredos} aoFechar={() => setSegredos(null)} />}

      {canais.map((canal) => (
        <CartaoDoCanal key={canal.channel_session_id} canal={canal} aoGirar={setSegredos} />
      ))}
    </div>
  );
}
