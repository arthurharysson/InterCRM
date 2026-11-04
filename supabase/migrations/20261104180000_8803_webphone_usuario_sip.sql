-- manifest: **O ramal pode ter um "usuário SIP" próprio, porque a central autentica por um nome que nem sempre é o número do ramal.** Em `user_webphone_ramais` entra a coluna opcional `sip_user` — na central observada o ramal 1201 se registra como `1000_1201` (código da empresa + número), e o telefone do próprio omnichannel faz o mesmo —, enquanto `ramal` segue sendo o número que o Click to Call pede à central. Sem `sip_user`, o telefone usa o próprio `ramal`, então nada que já funciona muda. O CHECK de formato é o do ramal. Aditivo e idempotente.
--
-- Por que uma coluna e não deduzir `<empresa>_<ramal>` no código: o prefixo é o
-- código da empresa NA CENTRAL, e cada empresa-cliente tem o seu; adivinhar daqui
-- erraria em silêncio para quem não segue esse padrão. O nome certo vem da lista
-- de ramais da própria central (campo `login`), e a tela o guarda quando a pessoa
-- escolhe o ramal.

alter table public.user_webphone_ramais
  add column if not exists sip_user text;

do $$
begin
  alter table public.user_webphone_ramais
    drop constraint if exists user_webphone_ramais_sip_user_valido;
  alter table public.user_webphone_ramais
    add constraint user_webphone_ramais_sip_user_valido
    check (sip_user is null or sip_user ~ '^[A-Za-z0-9_.-]{1,60}$');
end $$;

comment on column public.user_webphone_ramais.sip_user is
  'Nome com que o ramal se autentica na central (ex.: 1000_1201). Nulo = usa o próprio ramal.';

-- A visão segura (sem a senha cifrada) ganha a coluna nova NO FIM: `create or
-- replace view` só aceita acrescentar colunas depois das que já existem.
create or replace view public.user_webphone_ramais_safe
  with (security_invoker = true) as
select
  organization_id, user_id, ramal, secret_last4, is_active,
  updated_by, created_at, updated_at, sip_user
from public.user_webphone_ramais;

revoke all on public.user_webphone_ramais_safe from anon;
grant select on public.user_webphone_ramais_safe to authenticated;


notify pgrst, 'reload schema';
