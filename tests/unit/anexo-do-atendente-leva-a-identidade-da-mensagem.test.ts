/**
 * O anexo do atendente para o cliente do chat externo (Chat App ↔ CRM).
 *
 * O Chat exige `message_id` em todo evento `message` e recusa com 400 quem não
 * o manda. Só o ramo de TEXTO do envio passava `conversationId`/`messageId`/autor
 * ao canal; os dois ramos de MÍDIA (arquivo do storage e `media_url`) seguiam sem
 * eles, e todo anexo do atendente voltava `chat_externo_send_failed_400` — o
 * texto passava e a imagem ficava "Falhou" na Inbox (visto em produção, na prova
 * pela tela da sincronização com o upstream 1.117.0).
 *
 * Dublê compartilhado (`tests/helpers/duble-do-handler`): o gate
 * `send-message-handler-nao-ganha-novo-duble` proíbe um dublê local.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { identidadeDaMensagemParaCanal, sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { OutboundEnvelope } from "@/lib/channels/types";
import type { SendMessageInput } from "@/lib/schemas";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

const send = vi.fn();

function envelopeEnviado(): OutboundEnvelope {
  const chamada = send.mock.calls[0];
  if (!chamada) throw new Error("o canal não foi chamado");
  return chamada[0] as OutboundEnvelope;
}

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/a.png" }, error: null }),
      }),
    },
  }),
}));
// A guarda anti-SSRF resolve o nome por DNS: o teste não sai para a rede.
vi.mock("@/lib/messaging/media/url-de-midia-externa", () => ({ assertUrlDeMidiaSegura: async () => {} }));
vi.mock("@/lib/channels", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    getAdapter: () => ({
      provider: "chat_externo",
      isConfigured: () => true,
      resolveRecipient: () => "identidade-do-chat",
      send,
    }),
  };
});

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

const ctxTela: HandlerCtx = {
  organization_id: ORG,
  actor: { type: "user", id: USER },
  onBehalfOf: { userId: USER, userName: "Atendente Teste" },
  requestId: "req-anexo",
} as HandlerCtx;

function conversa() {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: false,
    group_chat_id: null,
    bot_silenced_until: null,
    provider_conversation_id: "identidade-do-chat",
    last_inbound_at: new Date().toISOString(),
    contacts: { phone_number: null, wa_identity: null, wa_lid: null, is_blocked: false },
    channel_sessions: {
      id: SESSION,
      organization_id: ORG,
      provider: "chat_externo",
      waha_session_name: null,
      status: "WORKING",
      archived_at: null,
    },
  };
}

beforeEach(() => {
  send.mockReset().mockResolvedValue({ externalId: null });
});

describe("anexo do atendente chega ao canal com a identidade da mensagem", () => {
  it("arquivo do storage: o envelope leva messageId, conversationId e autor", async () => {
    const { supabase, capturas } = criarDubleDoHandler({ conversation: conversa() });

    await sendMessageHandler(supabase, ctxTela, {
      conversation_id: CONV,
      type: "image",
      media_storage_path: `${ORG}/${CONV}/out-abc.png`,
      media_mime: "image/png",
    } as SendMessageInput);

    expect(send, "o canal não foi chamado").toHaveBeenCalledTimes(1);
    const envelope = envelopeEnviado();
    const gravada = capturas.inserts.messages?.[0] as { id?: string } | undefined;
    expect(envelope.messageId, "sem messageId o Chat recusa com 400").toEqual(expect.any(String));
    if (gravada?.id) expect(envelope.messageId).toBe(gravada.id);
    expect(envelope.conversationId).toBe(CONV);
    expect(envelope.authorKind).toBe("agent");
    expect(envelope.authorName).toBe("Atendente Teste");
    expect(envelope.media?.url).toBe("https://signed.example/a.png");
  });

  it("arquivo por `media_url`: o envelope também leva a identidade", async () => {
    const { supabase } = criarDubleDoHandler({ conversation: conversa() });

    await sendMessageHandler(supabase, ctxTela, {
      conversation_id: CONV,
      type: "image",
      media_url: "https://cdn.example.com/foto.png",
      media_mime: "image/png",
    } as SendMessageInput);

    expect(send).toHaveBeenCalledTimes(1);
    const envelope = envelopeEnviado();
    expect(envelope.messageId, "sem messageId o Chat recusa com 400").toEqual(expect.any(String));
    expect(envelope.conversationId).toBe(CONV);
    expect(envelope.authorKind).toBe("agent");
  });

  it("o ramo de texto segue idêntico (a identidade vem do mesmo ponto)", async () => {
    const { supabase } = criarDubleDoHandler({ conversation: conversa() });

    await sendMessageHandler(supabase, ctxTela, {
      conversation_id: CONV,
      type: "text",
      body: "oi",
    } as SendMessageInput);

    const envelope = envelopeEnviado();
    expect(envelope.messageId).toEqual(expect.any(String));
    expect(envelope.conversationId).toBe(CONV);
    expect(envelope.authorKind).toBe("agent");
  });
});

describe("identidadeDaMensagemParaCanal", () => {
  it("IA vira `ai`; pessoa vira `agent`; sem nome, o autor é null", () => {
    const ia = identidadeDaMensagemParaCanal("c", "m", {
      actor: { type: "agent_ai" } as never,
      onBehalfOf: undefined,
    });
    expect(ia).toEqual({ conversationId: "c", messageId: "m", authorKind: "ai", authorName: null });

    const pessoa = identidadeDaMensagemParaCanal("c", "m", {
      actor: { type: "user", id: USER },
      onBehalfOf: undefined,
    });
    expect(pessoa.authorKind).toBe("agent");
  });
});
