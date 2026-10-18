/**
 * Webphone — o miolo do servidor, sem HTTP.
 *
 * Mesmo espírito de `lib/voip/guardar-trunk.ts`: a senha SIP é cifrada com
 * AES-256-GCM antes de tocar o banco, só os 4 últimos caracteres ficam legíveis,
 * e toda escrita é auditada SEM a senha no metadata.
 *
 * O client é o de service role, que ignora a RLS — por isso TODA consulta aqui
 * filtra `organization_id` na mão, e o `orgId` vem de quem chama (resolvido do
 * cookie validado, nunca do body).
 */
import { audit } from "@/lib/audit";
import { bufToBytea, byteaToBuffer, decryptKey, encryptKey } from "@/lib/crypto/aes_gcm";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ConfiguracaoDoWebphone, CredenciaisDoWebphone, RamalDoUsuario } from "./config";

type Admin = ReturnType<typeof createAdminClient>;

export type ResultadoDeEscrita =
  | { ok: true }
  | {
      ok: false;
      motivo: "senha_obrigatoria_na_criacao" | "usuario_fora_da_organizacao" | "ramal_em_uso" | "cifragem" | "banco";
      detalhe?: string;
    };

export async function guardarConfiguracao(p: {
  admin: Admin;
  orgId: string;
  userId: string;
  config: ConfiguracaoDoWebphone;
}): Promise<ResultadoDeEscrita> {
  const { data: existente, error: lerErr } = await p.admin
    .from("org_webphone_settings")
    .select("organization_id")
    .eq("organization_id", p.orgId)
    .maybeSingle();
  if (lerErr) return { ok: false, motivo: "banco", detalhe: lerErr.message };

  const { error } = await p.admin.from("org_webphone_settings").upsert(
    {
      organization_id: p.orgId,
      wss_url: p.config.wss_url,
      sip_domain: p.config.sip_domain,
      dial_prefix: p.config.dial_prefix,
      is_active: p.config.is_active,
      updated_by: p.userId,
    },
    { onConflict: "organization_id" },
  );
  if (error) return { ok: false, motivo: "banco", detalhe: error.message };

  await audit({
    action: "webphone.settings_updated",
    actorUserId: p.userId,
    organizationId: p.orgId,
    resourceType: "org_webphone_settings",
    resourceId: p.orgId,
    metadata: {
      criada: !existente,
      wss_url: p.config.wss_url,
      sip_domain: p.config.sip_domain,
      is_active: p.config.is_active,
    },
  });
  return { ok: true };
}

export async function guardarRamal(p: {
  admin: Admin;
  orgId: string;
  /** Quem está escrevendo (o admin). */
  atorId: string;
  /** De quem é o ramal. */
  usuarioId: string;
  ramal: RamalDoUsuario;
}): Promise<ResultadoDeEscrita> {
  // Só membro ATIVO da organização pode ter ramal nela — sem isto um admin
  // associaria ramal a um user_id de outra empresa.
  const { data: membro, error: membroErr } = await p.admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", p.orgId)
    .eq("user_id", p.usuarioId)
    .is("revoked_at", null)
    .maybeSingle();
  if (membroErr) return { ok: false, motivo: "banco", detalhe: membroErr.message };
  if (!membro) return { ok: false, motivo: "usuario_fora_da_organizacao" };

  const { data: existente, error: lerErr } = await p.admin
    .from("user_webphone_ramais")
    .select("user_id")
    .eq("organization_id", p.orgId)
    .eq("user_id", p.usuarioId)
    .maybeSingle();
  if (lerErr) return { ok: false, motivo: "banco", detalhe: lerErr.message };

  if (!existente && !p.ramal.password) return { ok: false, motivo: "senha_obrigatoria_na_criacao" };

  let camposDaSenha = {};
  if (p.ramal.password) {
    let cifrada;
    try {
      cifrada = encryptKey(p.ramal.password);
    } catch (err) {
      return { ok: false, motivo: "cifragem", detalhe: err instanceof Error ? err.message : undefined };
    }
    camposDaSenha = {
      secret_encrypted: bufToBytea(cifrada.ciphertext),
      secret_iv: bufToBytea(cifrada.iv),
      secret_tag: bufToBytea(cifrada.tag),
      secret_last4: cifrada.last4,
    };
  }

  const { error } = await p.admin.from("user_webphone_ramais").upsert(
    {
      organization_id: p.orgId,
      user_id: p.usuarioId,
      ramal: p.ramal.ramal,
      is_active: p.ramal.is_active,
      updated_by: p.atorId,
      ...camposDaSenha,
    },
    { onConflict: "organization_id,user_id" },
  );
  if (error) {
    // 23505 = o ramal já pertence a outra pessoa desta organização.
    if (error.code === "23505") return { ok: false, motivo: "ramal_em_uso" };
    return { ok: false, motivo: "banco", detalhe: error.message };
  }

  await audit({
    action: "webphone.ramal_saved",
    actorUserId: p.atorId,
    organizationId: p.orgId,
    resourceType: "user_webphone_ramais",
    resourceId: p.usuarioId,
    metadata: { ramal: p.ramal.ramal, is_active: p.ramal.is_active, senha_alterada: !!p.ramal.password },
  });
  return { ok: true };
}

export async function removerRamal(p: {
  admin: Admin;
  orgId: string;
  atorId: string;
  usuarioId: string;
}): Promise<ResultadoDeEscrita> {
  const { error } = await p.admin
    .from("user_webphone_ramais")
    .delete()
    .eq("organization_id", p.orgId)
    .eq("user_id", p.usuarioId);
  if (error) return { ok: false, motivo: "banco", detalhe: error.message };

  await audit({
    action: "webphone.ramal_removed",
    actorUserId: p.atorId,
    organizationId: p.orgId,
    resourceType: "user_webphone_ramais",
    resourceId: p.usuarioId,
  });
  return { ok: true };
}

/**
 * O que o navegador do DONO precisa para registrar o ramal. Devolve `null`
 * quando a organização não ligou o webphone, ou a pessoa não tem ramal ativo —
 * e nesses casos a tela simplesmente não desenha o telefone.
 *
 * A senha é lida SÓ da linha de `userId`; este é o único caminho que a decifra.
 */
export async function credenciaisDoDono(p: {
  admin: Admin;
  orgId: string;
  userId: string;
}): Promise<CredenciaisDoWebphone | null> {
  const [{ data: cfg }, { data: ramal }] = await Promise.all([
    p.admin
      .from("org_webphone_settings")
      .select("wss_url, sip_domain, dial_prefix, is_active")
      .eq("organization_id", p.orgId)
      .maybeSingle(),
    p.admin
      .from("user_webphone_ramais")
      .select("ramal, secret_encrypted, secret_iv, secret_tag, is_active")
      .eq("organization_id", p.orgId)
      .eq("user_id", p.userId)
      .maybeSingle(),
  ]);

  if (!cfg || !cfg.is_active || !ramal || !ramal.is_active) return null;

  let password: string;
  try {
    password = decryptKey({
      ciphertext: byteaToBuffer(ramal.secret_encrypted),
      iv: byteaToBuffer(ramal.secret_iv),
      tag: byteaToBuffer(ramal.secret_tag),
    });
  } catch {
    // Chave de cifragem trocada ou linha corrompida: sem senha utilizável, sem telefone.
    return null;
  }

  return {
    wss_url: cfg.wss_url,
    sip_domain: cfg.sip_domain,
    dial_prefix: cfg.dial_prefix,
    ramal: ramal.ramal,
    password,
  };
}
