-- manifest: **Webphone no navegador: o atendente liga e recebe pelo ramal do PABX da empresa, sem instalar nada.** Duas tabelas tenant-aware novas. `org_webphone_settings` guarda, por organização, o endereço WebSocket seguro (`wss://`) do servidor SIP, o domínio SIP e um prefixo de discagem opcional (uma linha por organização, escrita só por `admin`). `user_webphone_ramais` guarda o ramal de cada atendente e a senha SIP dele, cifrada com o mesmo AES-256-GCM das credenciais de IA (nunca em claro no banco; só os 4 últimos caracteres aparecem na view segura `user_webphone_ramais_safe`). A senha só sai do servidor para o navegador do DONO do ramal. Sem função nova, sem trigger de rede, sem evento.
--
-- Por que duas tabelas e não uma: o servidor SIP é decisão da organização (um
-- por empresa-cliente, no white label) e o ramal é decisão por pessoa. Misturar
-- repetiria o endereço em cada linha de atendente.
--
-- Por que o nome não cita provedor: qualquer PABX que aceite SIP sobre WebSocket
-- serve (Asterisk, FreeSWITCH, Kamailio). Quem escolhe é a organização, na tela.
--
-- RLS: o endereço do servidor não é segredo — leitura por qualquer membro da
-- organização (o webphone precisa dele), escrita só por `admin`. A linha de ramal
-- só é visível ao próprio dono e a `admin`; o texto cifrado não tem valor sem a
-- chave `AI_CRED_AES_KEY`, que nunca está no banco.
--
-- Idempotente: `create ... if not exists`, `drop policy if exists` + `create`,
-- `create or replace view`. Sem id de tenant.

create table if not exists public.org_webphone_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  wss_url text not null,
  sip_domain text not null,
  dial_prefix text not null default '',
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_webphone_settings_wss_valida
    check (wss_url ~ '^wss://[^[:space:]/]+(/[^[:space:]]*)?$'),
  constraint org_webphone_settings_dominio_valido
    check (sip_domain ~ '^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$'),
  constraint org_webphone_settings_prefixo_valido
    check (dial_prefix ~ '^[0-9*#]{0,6}$')
);

create table if not exists public.user_webphone_ramais (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ramal text not null,
  secret_encrypted bytea not null,
  secret_iv bytea not null,
  secret_tag bytea not null,
  secret_last4 text not null,
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint user_webphone_ramais_ramal_valido
    check (ramal ~ '^[A-Za-z0-9_.-]{1,40}$'),
  constraint user_webphone_ramais_ramal_unico
    unique (organization_id, ramal)
);

alter table public.org_webphone_settings enable row level security;
alter table public.user_webphone_ramais enable row level security;

drop policy if exists org_webphone_settings_select on public.org_webphone_settings;
create policy org_webphone_settings_select on public.org_webphone_settings
  for select using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists org_webphone_settings_admin_write on public.org_webphone_settings;
create policy org_webphone_settings_admin_write on public.org_webphone_settings
  for all
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

drop policy if exists user_webphone_ramais_select on public.user_webphone_ramais;
create policy user_webphone_ramais_select on public.user_webphone_ramais
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'admin'))
  );

drop policy if exists user_webphone_ramais_admin_write on public.user_webphone_ramais;
create policy user_webphone_ramais_admin_write on public.user_webphone_ramais
  for all
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'admin')
  );

-- A anon key vai para o navegador: sem isto, o GRANT ALL ON TABLES TO anon do
-- baseline deixaria a tabela alcançável sem sessão, com RLS ou não.
revoke all on public.org_webphone_settings from anon;
revoke all on public.user_webphone_ramais from anon;

drop trigger if exists trg_org_webphone_settings_set_updated_at on public.org_webphone_settings;
create trigger trg_org_webphone_settings_set_updated_at
  before update on public.org_webphone_settings
  for each row execute function public.fn_set_updated_at();

drop trigger if exists trg_user_webphone_ramais_set_updated_at on public.user_webphone_ramais;
create trigger trg_user_webphone_ramais_set_updated_at
  before update on public.user_webphone_ramais
  for each row execute function public.fn_set_updated_at();

-- View segura: NUNCA expõe secret_encrypted/iv/tag. `security_invoker = true`
-- faz a RLS da tabela base valer através dela.
create or replace view public.user_webphone_ramais_safe
  with (security_invoker = true) as
select
  organization_id, user_id, ramal, secret_last4, is_active,
  updated_by, created_at, updated_at
from public.user_webphone_ramais;

revoke all on public.user_webphone_ramais_safe from anon;
grant select on public.user_webphone_ramais_safe to authenticated;

comment on table public.org_webphone_settings is
  'Servidor SIP-sobre-WebSocket do webphone, uma linha por organização. Provedor-neutro.';
comment on table public.user_webphone_ramais is
  'Ramal e senha SIP (cifrada AES-256-GCM) de cada atendente. A senha só chega ao navegador do dono.';

notify pgrst, 'reload schema';
