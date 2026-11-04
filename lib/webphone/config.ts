/**
 * Webphone — as regras PURAS, sem rede e sem banco.
 *
 * Mora aqui tudo o que é decisão e não efeito: o formato aceito do endereço do
 * servidor, o ramal, a senha, o prefixo de discagem e a montagem da URI SIP.
 * O servidor valida com estes esquemas e o navegador monta a chamada com as
 * mesmas funções — uma regra, dois lados, sem divergir.
 *
 * Provedor-neutro: qualquer PABX que aceite SIP sobre WebSocket serve. Nada
 * aqui sabe que existe a Fluxo, o Asterisk ou o FreeSWITCH.
 */
import { z } from "zod";

/** Mesma regra do CHECK `org_webphone_settings_wss_valida` — só WebSocket SEGURO. */
const WSS_URL = /^wss:\/\/[^\s/]+(\/\S*)?$/;
/** Mesma regra do CHECK `org_webphone_settings_dominio_valido`. */
const DOMINIO_SIP = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
/** Mesma regra do CHECK `org_webphone_settings_prefixo_valido`. */
const PREFIXO_DE_DISCAGEM = /^[0-9*#]{0,6}$/;
/** Mesma regra do CHECK `user_webphone_ramais_ramal_valido`. */
const RAMAL = /^[A-Za-z0-9_.-]{1,40}$/;

/** Mesma regra do CHECK `org_webphone_settings_painel_valido` — a tela da central, só em https. */
const PAINEL_URL = /^https:\/\/[^\s/]+(\/\S*)?$/;

/** Texto vazio no formulário quer dizer "não tenho isso": vira `null`, nunca string vazia no banco. */
const opcional = <T extends z.ZodTypeAny>(esquema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), esquema.nullable().default(null));

export const configuracaoDoWebphoneSchema = z
  .object({
    wss_url: opcional(
      z.string().trim().max(300).regex(WSS_URL, "O endereço precisa começar com wss:// (WebSocket seguro)."),
    ),
    sip_domain: opcional(
      z.string().trim().max(253).regex(DOMINIO_SIP, "Domínio SIP inválido. Use só o nome, sem http:// nem porta."),
    ),
    painel_url: opcional(
      z.string().trim().max(300).regex(PAINEL_URL, "O endereço da janela da central precisa começar com https://."),
    ),
    dial_prefix: z
      .string()
      .trim()
      .regex(PREFIXO_DE_DISCAGEM, "O prefixo aceita até 6 dígitos, * ou #.")
      .default(""),
    is_active: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    const temNavegador = c.wss_url !== null && c.sip_domain !== null;
    if ((c.wss_url === null) !== (c.sip_domain === null)) {
      ctx.addIssue({
        code: "custom",
        path: [c.wss_url === null ? "wss_url" : "sip_domain"],
        message: "O telefone no navegador precisa do endereço WebSocket e do domínio juntos.",
      });
    }
    if (!temNavegador && c.painel_url === null) {
      ctx.addIssue({
        code: "custom",
        path: ["painel_url"],
        message: "Informe o endereço do telefone no navegador (WebSocket e domínio) ou o da janela da central.",
      });
    }
  });

export type ConfiguracaoDoWebphone = z.infer<typeof configuracaoDoWebphoneSchema>;

/** Mesma regra do CHECK `user_webphone_ramais_sip_user_valido`. */
const USUARIO_SIP = /^[A-Za-z0-9_.-]{1,60}$/;

export const ramalDoUsuarioSchema = z.object({
  ramal: z.string().trim().regex(RAMAL, "Ramal inválido. Use letras, números, ponto, hífen ou sublinhado."),
  /**
   * O nome com que o ramal se autentica na central, quando ele não é o próprio
   * número (ex.: `1000_1201`). Vazio ou ausente: o telefone usa o `ramal`.
   */
  sip_user: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().regex(USUARIO_SIP, "Usuário SIP inválido. Use letras, números, ponto, hífen ou sublinhado.").nullable().optional(),
  ),
  /**
   * Opcional sempre: sem senha o ramal serve ao Click to Call pela central; com
   * senha serve também ao telefone no navegador. Numa atualização, omitir mantém
   * a senha cifrada que já existe.
   */
  password: z.string().min(4, "A senha SIP precisa ter ao menos 4 caracteres.").max(200).optional(),
  is_active: z.boolean().default(true),
});

export type RamalDoUsuario = z.infer<typeof ramalDoUsuarioSchema>;

/** O que o navegador do dono do ramal recebe para registrar. Nunca vai a outro usuário. */
export interface CredenciaisDoWebphone {
  wss_url: string;
  sip_domain: string;
  dial_prefix: string;
  ramal: string;
  /** O nome com que o ramal se autentica na central. Igual ao `ramal` quando a central não usa outro. */
  usuario_sip: string;
  password: string;
}

export function uriSipDoRamal(ramal: string, dominio: string): string {
  return `sip:${ramal}@${dominio}`;
}

/**
 * A configuração do agente SIP, sem o soquete — pura, para poder ser provada.
 *
 * ⚠️ `contact_uri` NÃO é enfeite. Sem ele o JsSIP se apresenta com um endereço
 * inventado (`xxxxxxxx.invalid`), e a central consegue TOCAR o ramal pelo
 * registro mas não consegue falar com ele DENTRO da ligação: o BYE de quem
 * desligou é mandado para o endereço de contato, que não existe. O sintoma é a
 * pessoa do outro lado desligar e o CRM continuar "em ligação". O telefone do
 * próprio omnichannel registra com `sip:<usuário>@<domínio>`, e é isso que se
 * repete aqui. O mesmo valor vira o host do cabeçalho Via.
 */
export function configuracaoDoUa(c: CredenciaisDoWebphone) {
  const enderecoDoRamal = uriSipDoRamal(c.usuario_sip, c.sip_domain);
  return {
    uri: enderecoDoRamal,
    authorization_user: c.usuario_sip,
    display_name: c.ramal,
    password: c.password,
    realm: c.sip_domain,
    registrar_server: `sip:${c.sip_domain}`,
    contact_uri: enderecoDoRamal,
    register: true,
    register_expires: 300,
    no_answer_timeout: 120,
    user_agent: "InterCRM-Webphone",
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
  };
}

/**
 * Reduz o que a pessoa digitou ao que o PABX entende: dígitos, `*` e `#`.
 * Espaço, parêntese, hífen e `+` somem. `+55…` vira `55…` — se a operação
 * exige outro formato, o prefixo de discagem da organização cobre.
 */
export function numeroParaDiscar(entrada: string): string {
  return entrada.replace(/[^0-9*#]/g, "");
}

/** O destino SIP completo de uma ligação de saída, ou `null` quando não sobra nada discável. */
export function destinoDaChamada(entrada: string, dominio: string, prefixo = ""): string | null {
  const digitos = numeroParaDiscar(entrada);
  if (digitos.length === 0) return null;
  return `sip:${prefixo}${digitos}@${dominio}`;
}

/**
 * O número de quem ligou, tirado do cabeçalho `From` de uma chamada recebida.
 * Devolve o usuário da URI (`sip:21999998888@x` → `21999998888`), ou `null` se
 * o PABX mandou anônimo.
 */
export function numeroDeQuemLigou(uriDeOrigem: string | null | undefined): string | null {
  if (!uriDeOrigem) return null;
  const m = /sips?:([^@;>\s]+)@/i.exec(uriDeOrigem);
  const usuario = m?.[1] ?? null;
  if (!usuario) return null;
  if (/^anonymous$/i.test(usuario)) return null;
  return usuario;
}

/** Segundos de uma chamada, em `mm:ss` (ou `h:mm:ss` a partir de uma hora). */
export function duracaoLegivel(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const dois = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(r)}` : `${dois(m)}:${dois(r)}`;
}

// ─── Registro da ligação ─────────────────────────────────────────────────────
//
// Cada ligação do webphone vira uma linha de `voice_calls` (`provider = 'sip'`,
// `handled_by = 'human'`): é a tabela que a ficha do contato e a LGPD já
// conhecem. O vocabulário de `end_reason` é o mesmo dela — conhecidos hoje:
// user_ended, declined, timeout, busy, cancelled, failed, unknown.

export const MOTIVOS_DE_FIM = ["user_ended", "declined", "timeout", "busy", "cancelled", "failed", "unknown"] as const;
export type MotivoDeFim = (typeof MOTIVOS_DE_FIM)[number];

/**
 * O que a pessoa marca ao desligar. Vocabulário fechado de propósito: é o que
 * dá para contar depois sem ler texto livre, e não carrega dado pessoal — um
 * campo livre ("falei com a Maria, o filho dela...") sobreviveria à
 * anonimização do contato.
 */
export const RESULTADOS_DA_LIGACAO = ["falou_com_o_cliente", "pediu_retorno", "fechou_negocio", "numero_errado"] as const;
export type ResultadoDaLigacao = (typeof RESULTADOS_DA_LIGACAO)[number];

export const ROTULO_DO_RESULTADO: Record<ResultadoDaLigacao, string> = {
  falou_com_o_cliente: "Falou com o cliente",
  pediu_retorno: "Pediu retorno",
  fechou_negocio: "Fechou negócio",
  numero_errado: "Número errado",
};

/**
 * Por que a ligação acabou, na língua do banco. `causa` é o texto cru que o
 * JsSIP entrega (`Canceled`, `Rejected`, `Busy`, `No Answer`…); desconhecido
 * vira `failed` e não `unknown`, porque uma chamada que não completou por um
 * motivo que não sabemos nomear é, para quem atende, uma chamada que falhou.
 */
export function motivoDoFim(p: { atendida: boolean; causa: string }): MotivoDeFim {
  if (p.atendida) return "user_ended";
  const causa = p.causa.trim().toLowerCase();
  if (causa === "canceled" || causa === "cancelled") return "cancelled";
  if (causa === "rejected") return "declined";
  if (causa === "busy") return "busy";
  if (causa === "no answer" || causa === "request timeout" || causa === "expires") return "timeout";
  return "failed";
}

/** Chamada recebida que ninguém atendeu: quem ligou desistiu ou a fila esgotou. Recusar não é perder. */
export function ehLigacaoPerdida(p: { direcao: "entrada" | "saida"; atendida: boolean; motivo: MotivoDeFim }): boolean {
  return p.direcao === "entrada" && !p.atendida && (p.motivo === "cancelled" || p.motivo === "timeout");
}

const INSTANTE = z.string().datetime({ offset: true });

export const registroDaChamadaSchema = z.object({
  /** Gerado no navegador: é a chave de idempotência — reenviar a mesma ligação não duplica a linha. */
  id: z.string().uuid(),
  direction: z.enum(["inbound", "outbound"]),
  /** O número do outro lado, só dígitos, `*` e `#`; `anonimo` quando a central não informou. */
  numero: z.string().trim().min(1).max(40),
  started_at: INSTANTE,
  answered_at: INSTANTE.nullable(),
  ended_at: INSTANTE,
  end_reason: z.enum(MOTIVOS_DE_FIM),
  /** Por onde a ligação aconteceu: o telefone embutido no navegador ou a central (Click to Call). */
  via: z.enum(["navegador", "central"]).default("navegador"),
});

export type RegistroDaChamadaCorpo = z.infer<typeof registroDaChamadaSchema>;

export const resultadoDaChamadaSchema = z.object({ resultado: z.enum(RESULTADOS_DA_LIGACAO) });

/** Como a linha da ligação chega à tela (lista da ficha). */
export interface LigacaoDoHistorico {
  id: string;
  direction: "inbound" | "outbound";
  peer_phone: string;
  end_reason: string | null;
  started_at: string;
  answered_at: string | null;
  duration_ms: number | null;
  resultado: ResultadoDaLigacao | null;
}

/** Classifica uma linha do histórico para a tela: recebida, feita ou perdida. */
export function tipoDaLigacao(l: Pick<LigacaoDoHistorico, "direction" | "answered_at" | "end_reason">): "perdida" | "recebida" | "feita" {
  if (l.direction === "inbound") {
    const perdida = !l.answered_at && (l.end_reason === "cancelled" || l.end_reason === "timeout");
    return perdida ? "perdida" : "recebida";
  }
  return "feita";
}

// ─── Duas formas de usar o ramal ─────────────────────────────────────────────

/**
 * `navegador`: o CRM é o telefone (precisa da senha SIP do ramal).
 * `central`: o CRM só PEDE a ligação pela API da central, e o áudio fica na
 * janela dela (precisa só do número do ramal).
 */
export type ModoDoTelefone = "navegador" | "central";

export interface ModoDoUsuario {
  modo: ModoDoTelefone | null;
  ramal: string | null;
  /** Endereço da janela da central, quando a organização informou. */
  painel_url: string | null;
}

/**
 * O número como a central de telefonia quer: só dígitos, com o código do país.
 * Telefone brasileiro sem o 55 (10 ou 11 dígitos) ganha o 55; o que já vem com
 * código de país fica como está. `null` quando não sobra nada discável.
 */
export function telefoneParaCentral(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, "");
  if (digitos.length < 8) return null;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

export const ligarPelaCentralSchema = z.object({
  /** Gerado no navegador; vira o `id` da ligação no histórico e o `crm_id` na central. */
  crm_id: z.string().uuid(),
  telefone: z.string().trim().min(8).max(32),
});

export const consultarLigacaoSchema = z.object({ crm_id: z.string().uuid() });

/** O que a central diz de uma ligação, já na língua do CRM. */
export interface SituacaoDaLigacao {
  estado: "chamando" | "em_andamento" | "encerrada" | "desconhecida";
  atendida: boolean;
  /** ISO-8601, quando a central informou. */
  atendida_em: string | null;
  encerrada_em: string | null;
  falou_s: number;
}
