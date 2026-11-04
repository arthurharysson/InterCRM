-- manifest: **O atendente pode ter só o número do ramal, sem senha SIP: o CRM liga pela API da central e o áudio fica na janela dela.** Em `user_webphone_ramais` as quatro colunas da senha cifrada passam a aceitar nulo, com um CHECK que as quer TODAS preenchidas ou TODAS vazias (nunca metade de uma senha); linha sem senha não entrega credencial ao navegador, então o telefone embutido não nasce para ela. Em `org_webphone_settings`, `wss_url` e `sip_domain` passam a aceitar nulo (uma empresa que só usa a janela da central não tem endereço de WebSocket) e a tabela ganha `painel_url`, o endereço `https://` da tela da central que o botão "Abrir telefone" abre numa janela pequena. Os CHECKs de formato continuam valendo quando o valor existe. Aditivo: nenhuma linha existente muda.
--
-- Por que relaxar a senha em vez de criar outra tabela: o ramal É da pessoa, e a
-- senha é só uma das formas de usá-lo. Duas tabelas repetiriam "quem tem qual
-- ramal" e obrigariam o CRM a decidir de qual das duas ler.
--
-- Idempotente: `alter ... drop not null` pode repetir, `add column if not exists`,
-- e os CHECKs novos saem e entram (`drop constraint if exists` + `add`), no mesmo
-- bloco `do` para a falha de um não deixar a tabela sem o outro.

alter table public.user_webphone_ramais
  alter column secret_encrypted drop not null,
  alter column secret_iv drop not null,
  alter column secret_tag drop not null,
  alter column secret_last4 drop not null;

alter table public.org_webphone_settings
  alter column wss_url drop not null,
  alter column sip_domain drop not null,
  add column if not exists painel_url text;

do $$
begin
  alter table public.user_webphone_ramais
    drop constraint if exists user_webphone_ramais_segredo_inteiro;
  alter table public.user_webphone_ramais
    add constraint user_webphone_ramais_segredo_inteiro
    check (
      (secret_encrypted is null and secret_iv is null and secret_tag is null and secret_last4 is null)
      or
      (secret_encrypted is not null and secret_iv is not null and secret_tag is not null and secret_last4 is not null)
    );

  alter table public.org_webphone_settings
    drop constraint if exists org_webphone_settings_painel_valido;
  alter table public.org_webphone_settings
    add constraint org_webphone_settings_painel_valido
    check (painel_url is null or painel_url ~ '^https://[^[:space:]/]+(/[^[:space:]]*)?$');

  -- A empresa precisa de ALGUM caminho: o telefone no navegador (wss + domínio
  -- juntos) ou a janela da central (painel_url). Sem nenhum, a linha não serve.
  alter table public.org_webphone_settings
    drop constraint if exists org_webphone_settings_algum_caminho;
  alter table public.org_webphone_settings
    add constraint org_webphone_settings_algum_caminho
    check (
      (wss_url is not null and sip_domain is not null) or painel_url is not null
    );
end $$;

comment on column public.user_webphone_ramais.secret_encrypted is
  'Senha SIP cifrada (AES-256-GCM). Nula quando o ramal só serve ao Click to Call pela API da central.';
comment on column public.org_webphone_settings.painel_url is
  'Endereço https da tela da central que abre na janela pequena do "Abrir telefone".';

notify pgrst, 'reload schema';
