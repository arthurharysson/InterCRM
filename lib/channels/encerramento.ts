/**
 * O AVISO DE ENCERRAMENTO AO CANAL — um lugar só, sem nomear provider.
 *
 * Quando o atendimento é encerrado no CRM, alguns canais têm do outro lado uma tela que o CRM não enxerga (o chat
 * web, que o cliente abriu pelo botão do bot). Sem aviso, ela fica oferecendo o campo de texto para uma conversa
 * que a equipe já fechou. A rota que fecha a conversa chama a função daqui e NÃO sabe qual canal é: a decisão
 * ("este canal quer ser avisado?") é do adapter, que implementa `notificarEncerramento` ou não.
 *
 * ─── O aviso NUNCA derruba o fechamento ──────────────────────────────────────────────────────────
 *
 * Fechar é o gesto pedido pelo atendente, e já aconteceu quando esta função roda. Falha de rede, canal sem
 * configuração ou transporte fora do ar viram um `warn` no log e a função devolve normalmente.
 *
 * ─── O que isto NÃO faz (dívida declarada) ───────────────────────────────────────────────────────
 *
 * Não reenvia. É uma tentativa só, no momento do fechamento. Se o Chat estiver fora do ar nesse instante, a página
 * do cliente continua aberta até ele fechar ou até a inatividade a expirar. O caminho certo para garantir a entrega é
 * `event_log` + um worker (a doutrina proíbe HTTP dentro de trigger e recomenda a fila de eventos); fica para quando
 * houver evidência de que a perda acontece.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { getAdapter } from "./index";
import { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef, type ChannelSessionRef } from "./session-ref";
import type { ChannelProvider } from "./types";

export async function avisarEncerramentoAoCanal(
  admin: SupabaseClient,
  input: { organizationId: string; conversationId: string; closedAt?: string },
): Promise<void> {
  try {
    const { data: conversa, error } = await admin
      .from("conversations")
      .select("id, channel_session_id, provider_conversation_id")
      .eq("organization_id", input.organizationId)
      .eq("id", input.conversationId)
      .maybeSingle();
    const c = conversa as { channel_session_id: string | null; provider_conversation_id: string | null } | null;
    // Sem sessão ou sem identidade no transporte não há para quem avisar (conversa de WhatsApp, por exemplo).
    if (error || !c?.channel_session_id || !c.provider_conversation_id) return;

    const { data: sessao } = await admin
      .from("channel_sessions")
      .select(CHANNEL_SESSION_REF_COLUMNS)
      .eq("organization_id", input.organizationId)
      .eq("id", c.channel_session_id)
      .maybeSingle();
    if (!sessao) return;

    const adapter = getAdapter((sessao as { provider: ChannelProvider }).provider);
    // O canal não quer ser avisado (a maioria): nada a fazer.
    if (typeof adapter.notificarEncerramento !== "function") return;

    await adapter.notificarEncerramento({
      organizationId: input.organizationId,
      sessionRef: resolveSessionRef(sessao as unknown as ChannelSessionRef),
      providerConversationId: c.provider_conversation_id,
      conversationId: input.conversationId,
      closedAt: input.closedAt ?? new Date().toISOString(),
    });
  } catch (err) {
    // Só o nome do erro: a mensagem pode conter a URL do canal.
    logger.warn("[canal] aviso de encerramento não saiu", {
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      erro: err instanceof Error ? err.message.slice(0, 120) : "desconhecido",
    });
  }
}
