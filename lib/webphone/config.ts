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

export const configuracaoDoWebphoneSchema = z.object({
  wss_url: z
    .string()
    .trim()
    .max(300)
    .regex(WSS_URL, "O endereço precisa começar com wss:// (WebSocket seguro)."),
  sip_domain: z
    .string()
    .trim()
    .max(253)
    .regex(DOMINIO_SIP, "Domínio SIP inválido. Use só o nome, sem http:// nem porta."),
  dial_prefix: z
    .string()
    .trim()
    .regex(PREFIXO_DE_DISCAGEM, "O prefixo aceita até 6 dígitos, * ou #.")
    .default(""),
  is_active: z.boolean().default(true),
});

export type ConfiguracaoDoWebphone = z.infer<typeof configuracaoDoWebphoneSchema>;

export const ramalDoUsuarioSchema = z.object({
  ramal: z.string().trim().regex(RAMAL, "Ramal inválido. Use letras, números, ponto, hífen ou sublinhado."),
  /** Opcional numa atualização (mantém a senha cifrada que já existe); obrigatória na primeira vez. */
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
  password: string;
}

export function uriSipDoRamal(ramal: string, dominio: string): string {
  return `sip:${ramal}@${dominio}`;
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
