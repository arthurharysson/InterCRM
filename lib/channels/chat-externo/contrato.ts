/**
 * O CONTRATO DO CHAT EXTERNO — o que a aplicação de chat manda para o CRM (v2).
 *
 * É o lado do CRM do contrato descrito em `rascunhos/chat-web/PLANO-CHAT-WEB.md` (seção 6). O Chat é uma
 * aplicação SEPARADA: o cliente conversa numa página web (aberta pelo botão que o bot do WhatsApp manda) e
 * o atendente responde pelo CRM. A ponte são três eventos assinados por HMAC:
 *
 *   - `chat.started`            o cliente abriu o link pela primeira vez → nasce a conversa, na Fila;
 *   - `message`                 mensagem do cliente (sem o campo `event`, vale como `message`: compatível com a v1);
 *   - `chat.closed_by_customer` o cliente encerrou.
 *
 * Este canal NÃO é o do InterSuite (`web`): é outro provider, com contrato próprio e segredo POR CANAL.
 * O `web` continua exatamente como está.
 *
 * ─── O que se aceita e o que se recusa ───────────────────────────────────────────────────────────
 *
 * O que for lixo opcional (CPF que não tem 11 dígitos, telefone estranho, metadado enorme) é DESCARTADO, e o
 * evento segue: perder o cliente por causa de um campo de enfeite é pior que perder o campo. O que for
 * estrutural (sem `identity`, sem `text` numa mensagem, `event` com tipo errado) é RECUSADO com `400`, e a
 * recusa nomeia os CAMPOS, nunca os valores (são dado de cliente).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeCpf } from "@/lib/contacts/cpf";
import { nomeDeArquivoLimpo } from "@/lib/messaging/media/nome-de-arquivo";

/** A identidade opaca do chat. O Chat gera `web:<uuid>`; o CRM só a trata como chave. */
export const PREFIXO_DA_IDENTIDADE = "web:";
export const TAMANHO_MAXIMO_DA_IDENTIDADE = 64;
export const TAMANHO_MAXIMO_DO_TEXTO = 8_000;
export const MAXIMO_DE_MENSAGENS_NO_HISTORICO = 200;
/** O Chat limita a 5 por mensagem; o CRM aceita até 10 (folga) e ignora o que passar. */
export const MAXIMO_DE_ANEXOS_POR_MENSAGEM = 10;
const TAMANHO_MAXIMO_DA_URL_DO_ANEXO = 2048;
const TAMANHO_MAXIMO_DO_ID_DE_MENSAGEM = 128;

/**
 * Um anexo do cliente, como o Chat o descreve: uma URL ASSINADA e com validade (1 h) que o CRM baixa e guarda no
 * Storage dele — o link do Chat não pode ser a fonte da verdade. `kind` é só rótulo (`image` ou `document`): o tipo
 * de verdade é o do arquivo, que o download confere.
 */
export interface AnexoDoChat {
  kind: "image" | "document";
  url: string;
  mime: string | null;
  size: number | null;
  name: string | null;
}

export interface MensagemDoHistorico {
  /** Id da mensagem no BOT. Só é único dentro do bot: o CRM o prefixa com a identidade ao gravar. */
  message_id: string;
  from: "customer" | "bot";
  text: string;
  sent_at: string | null;
}

export interface ContatoDoChat {
  name: string | null;
  /** Só dígitos, 11. `null` quando não veio ou não é um CPF plausível. */
  cpf: string | null;
  phone: string | null;
}

export type EventoDoChat =
  | {
      event: "chat.started";
      identity: string;
      started_at: string | null;
      sector: string | null;
      contact: ContatoDoChat;
      history: MensagemDoHistorico[];
      metadata: Record<string, unknown> | null;
    }
  | {
      event: "message";
      identity: string;
      message_id: string | null;
      text: string;
      sent_at: string | null;
      sender_name: string | null;
      /** Vazio quando a mensagem é só texto. A mensagem pode ter texto vazio E anexos. */
      attachments: AnexoDoChat[];
    }
  | {
      event: "chat.closed_by_customer";
      identity: string;
      closed_at: string | null;
    };

export type LeituraDoEvento =
  | { ok: true; evento: EventoDoChat }
  | { ok: false; motivo: "json_invalido" }
  | { ok: false; motivo: "contrato_violado"; campos: string[] };

function texto(valor: unknown, maximo: number): string | null {
  return typeof valor === "string" && valor.length > 0 && valor.length <= maximo ? valor : null;
}

function dataIso(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length === 0 || valor.length > 40) return null;
  const t = Date.parse(valor);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

/** CPF só vale com 11 dígitos; o resto é descartado (e o evento segue sem ele). */
function cpfPlausivel(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const digitos = normalizeCpf(valor);
  return digitos.length === 11 && !/^(\d)\1{10}$/.test(digitos) ? digitos : null;
}

function telefone(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
}

function identidade(valor: unknown): string | null {
  return typeof valor === "string" &&
    valor.startsWith(PREFIXO_DA_IDENTIDADE) &&
    valor.length > PREFIXO_DA_IDENTIDADE.length &&
    valor.length <= TAMANHO_MAXIMO_DA_IDENTIDADE
    ? valor
    : null;
}

function lerHistorico(valor: unknown): { itens: MensagemDoHistorico[]; invalido: boolean } {
  if (valor === undefined || valor === null) return { itens: [], invalido: false };
  if (!Array.isArray(valor)) return { itens: [], invalido: true };
  const itens: MensagemDoHistorico[] = [];
  for (const bruto of valor.slice(0, MAXIMO_DE_MENSAGENS_NO_HISTORICO)) {
    const m = objeto(bruto);
    const id = m ? texto(m.message_id, TAMANHO_MAXIMO_DO_ID_DE_MENSAGEM) : null;
    const de = m && (m.from === "customer" || m.from === "bot") ? m.from : null;
    const corpo = m ? texto(m.text, TAMANHO_MAXIMO_DO_TEXTO) : null;
    // Item malformado não derruba o histórico inteiro: só ele fica de fora.
    if (!m || !id || !de || !corpo) continue;
    itens.push({ message_id: id, from: de, text: corpo, sent_at: dataIso(m.sent_at) });
  }
  return { itens, invalido: false };
}

/**
 * Os anexos de uma `message`. Tudo aqui é opcional: o que não for lista vira "sem anexo", e item sem URL web
 * utilizável é DESCARTADO sem derrubar a mensagem — perder o texto do cliente por causa de um anexo ruim seria pior
 * que perder o anexo. Esquema que não é http(s) (`javascript:`, `file:`) nem entra: a URL é de fora e vai virar
 * requisição do servidor; quem a confere de verdade (mesmo host do Chat, anti-SSRF) é o download.
 */
function lerAnexos(valor: unknown): AnexoDoChat[] {
  if (!Array.isArray(valor)) return [];
  const itens: AnexoDoChat[] = [];
  for (const bruto of valor.slice(0, MAXIMO_DE_ANEXOS_POR_MENSAGEM)) {
    const a = objeto(bruto);
    const url = a ? texto(a.url, TAMANHO_MAXIMO_DA_URL_DO_ANEXO) : null;
    if (!a || !url || !/^https?:\/\//i.test(url)) continue;
    const mime = texto(a.mime, 128)?.split(";")[0]?.trim().toLowerCase() || null;
    const tamanho = typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0 ? Math.floor(a.size) : null;
    const ehImagem = a.kind === "image" || (mime?.startsWith("image/") ?? false);
    itens.push({
      kind: ehImagem ? "image" : "document",
      url,
      mime,
      size: tamanho,
      name: nomeDeArquivoLimpo(a.name),
    });
  }
  return itens;
}

/** Lê o corpo cru de um webhook do Chat. Não lança: devolve o desfecho. */
export function lerEventoDoChat(rawBody: string): LeituraDoEvento {
  let bruto: unknown;
  try {
    bruto = JSON.parse(rawBody);
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
  const o = objeto(bruto);
  if (!o) return { ok: false, motivo: "contrato_violado", campos: ["(corpo)"] };

  const nome = o.event === undefined ? "message" : o.event;
  const identity = identidade(o.identity);
  if (!identity) return { ok: false, motivo: "contrato_violado", campos: ["identity"] };

  if (nome === "message") {
    const corpo = typeof o.text === "string" && o.text.length <= TAMANHO_MAXIMO_DO_TEXTO ? o.text : null;
    if (corpo === null) return { ok: false, motivo: "contrato_violado", campos: ["text"] };
    return {
      ok: true,
      evento: {
        event: "message",
        identity,
        message_id: texto(o.message_id, TAMANHO_MAXIMO_DO_ID_DE_MENSAGEM),
        text: corpo,
        sent_at: dataIso(o.sent_at),
        sender_name: texto(o.sender_name, 120) ?? texto(o.display_name, 120),
        attachments: lerAnexos(o.attachments),
      },
    };
  }

  if (nome === "chat.started") {
    const contato = objeto(o.contact);
    const historico = lerHistorico(o.history);
    if (historico.invalido) return { ok: false, motivo: "contrato_violado", campos: ["history"] };
    return {
      ok: true,
      evento: {
        event: "chat.started",
        identity,
        started_at: dataIso(o.started_at),
        sector: texto(o.sector, 64)?.trim().toLowerCase() ?? null,
        contact: {
          name: contato ? texto(contato.name, 120) : null,
          cpf: contato ? cpfPlausivel(contato.cpf) : null,
          phone: contato ? telefone(contato.phone) : null,
        },
        history: historico.itens,
        metadata: objeto(o.metadata),
      },
    };
  }

  if (nome === "chat.closed_by_customer") {
    return { ok: true, evento: { event: "chat.closed_by_customer", identity, closed_at: dataIso(o.closed_at) } };
  }

  // Evento que o CRM não conhece (por exemplo, um `chat.typing` da fase 2): não é erro do Chat, e o CRM não
  // finge que processou. A rota responde 200 `ignored` para o Chat não reenviar para sempre.
  return { ok: false, motivo: "contrato_violado", campos: ["event"] };
}

/** Os mesmos 7 caracteres de `sha256=` que os demais webhooks do produto. */
const PREFIXO_DA_ASSINATURA = "sha256=";

export function assinarCorpo(rawBody: string, segredo: string): string {
  return PREFIXO_DA_ASSINATURA + createHmac("sha256", segredo).update(rawBody).digest("hex");
}

/**
 * Confere `x-deskcomm-signature` sobre o corpo CRU. Tempo constante; cabeçalho ausente ou de tamanho
 * diferente recusa sem comparar. O segredo vem da SESSÃO do canal (por canal, cifrado), nunca do ambiente.
 */
export function assinaturaConfere(rawBody: string, cabecalho: string | null, segredo: string): boolean {
  if (!cabecalho) return false;
  const esperada = assinarCorpo(rawBody, segredo);
  if (cabecalho.length !== esperada.length) return false;
  return timingSafeEqual(Buffer.from(cabecalho), Buffer.from(esperada));
}
