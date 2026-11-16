-- manifest: provider `chat_externo` (página de chat própria, aplicação separada): colunas por canal (url de saída, segredo de saída cifrado, ref) e `attendant_sectors.external_code` para o bot indicar o setor; o canal `web` do InterSuite não é tocado
--
-- O Chat externo é a página de chat para onde o bot do WhatsApp manda o cliente (botão com link). Atendimento
-- humano continua no CRM, na Fila. É OUTRO provider, de propósito: o `web` (InterSuite) segue exatamente como está.
--
-- Credencial POR CANAL, e não por variável de ambiente como o `web`:
--   - entrada (Chat → CRM): `webhook_path_token` + `webhook_secret_encrypted`, colunas que já existem;
--   - saída   (CRM → Chat): `chat_externo_url` + `chat_externo_secret_out_encrypted`, novas.
-- O segredo de saída é cifrado pelo mesmo helper dos demais segredos de webhook (`lib/webhooks/secrets.ts`).
--
-- Tudo idempotente: pode ser reaplicado sem duplicar efeito.

-- 1. Colunas do provider novo (todas nullable e ANTES das constraints que as referenciam).
alter table public.channel_sessions
  add column if not exists chat_externo_ref text,
  add column if not exists chat_externo_url text,
  add column if not exists chat_externo_secret_out_encrypted text;

-- Índice único PARCIAL (mesmo precedente da 8804): canal arquivado só sobrevive como âncora das FKs RESTRICT.
create unique index if not exists channel_sessions_chat_externo_ref_ativo_unique
  on public.channel_sessions (organization_id, chat_externo_ref)
  where chat_externo_ref is not null and archived_at is null;

-- 2. O provider passa a ser aceito. "Uma constraint, um bloco": a lista inclui TODOS os providers vigentes.
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check
  check (provider = any (array[
    'waha'::text, 'meta_cloud'::text, 'zernio'::text,
    'wacalls'::text, 'zernio_social'::text, 'datafy'::text,
    'web'::text, 'chat_externo'::text
  ]));

-- 3. Cada provider exige a SUA coluna de referência (tagged union no banco).
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
  (provider = 'waha'       and waha_session_name      is not null) or
  (provider = 'meta_cloud' and meta_phone_number_id    is not null) or
  (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
  (provider = 'wacalls'    and wacalls_session_id      is not null) or
  (provider = 'datafy'     and datafy_phone_number_id  is not null) or
  (provider = 'web'        and web_widget_id           is not null) or
  (provider = 'chat_externo' and chat_externo_ref      is not null)
);

-- 4. Setor por CÓDIGO externo: o bot diz `suporte-tecnico`, o CRM acha o setor. Nullable e sem constraint
--    nova sobre linha existente, então nenhum dado a corrigir antes. Minúsculo e sem espaço nas pontas por
--    CHECK, para a comparação ser exata e o índice único funcionar.
alter table public.attendant_sectors
  add column if not exists external_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attendant_sectors_external_code_forma'
      and conrelid = 'public.attendant_sectors'::regclass
  ) then
    alter table public.attendant_sectors
      add constraint attendant_sectors_external_code_forma
      check (external_code is null or (external_code = lower(btrim(external_code)) and char_length(external_code) between 1 and 64));
  end if;
end $$;

create unique index if not exists attendant_sectors_org_external_code_unique
  on public.attendant_sectors (organization_id, external_code)
  where external_code is not null;

comment on column public.channel_sessions.chat_externo_ref is
  'Identificador do canal Chat externo DENTRO da organização (provider chat_externo). Espelhado em lib/channels/session-ref.ts.';
comment on column public.channel_sessions.chat_externo_url is
  'Endereço de entrada do Chat para onde o CRM envia as respostas do atendente (POST assinado). Só o canal chat_externo.';
comment on column public.channel_sessions.chat_externo_secret_out_encrypted is
  'Segredo (cifrado) com que o CRM assina o que envia ao Chat. Só o canal chat_externo. O de entrada é webhook_secret_encrypted.';
comment on column public.attendant_sectors.external_code is
  'Código curto e estável com que um sistema externo (o bot do WhatsApp) indica o setor, ex.: suporte-tecnico. Minúsculo, único por organização.';

notify pgrst, 'reload schema';
