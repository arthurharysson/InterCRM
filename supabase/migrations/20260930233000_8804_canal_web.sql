-- Canal `web`: o chat do InterSuite entra no inbox como qualquer outro canal.
--
-- O transporte é o próprio InterSuite (não há provider externo), então a coluna
-- de referência guarda o identificador do widget, e não um número.

-- 1. Coluna de referência do provider novo.
alter table public.channel_sessions
  add column if not exists web_widget_id text;

-- Índice único PARCIAL, pelo precedente da 0165: canal arquivado só sobrevive
-- como âncora das FKs RESTRICT, e trava total impediria recriar o mesmo widget.
create unique index if not exists channel_sessions_web_widget_id_ativo_unique
  on public.channel_sessions (organization_id, web_widget_id)
  where web_widget_id is not null and archived_at is null;

-- 2. O provider passa a ser aceito.
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check
  check (provider = any (array[
    'waha'::text, 'meta_cloud'::text, 'zernio'::text,
    'wacalls'::text, 'zernio_social'::text, 'datafy'::text,
    'web'::text
  ]));

-- 3. Cada provider exige a SUA coluna de referência (tagged union no banco).
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
  (provider = 'waha'       and waha_session_name      is not null) or
  (provider = 'meta_cloud' and meta_phone_number_id    is not null) or
  (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
  (provider = 'wacalls'    and wacalls_session_id      is not null) or
  (provider = 'datafy'     and datafy_phone_number_id  is not null) or
  (provider = 'web'        and web_widget_id           is not null)
);

-- 4. Conversas podem ser do canal web.
alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('whatsapp', 'instagram', 'facebook', 'web'));
