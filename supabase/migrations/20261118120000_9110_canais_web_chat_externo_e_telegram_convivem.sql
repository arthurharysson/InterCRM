-- manifest: reconstrói as três CHECKs de canal com a lista inteira (web, chat_externo e telegram), porque a 9342 (telegram) perdeu `web` em conversations_channel_check e a 9109 (chat externo) perdeu `telegram` nas de channel_sessions — cada uma foi escrita sem ver a outra
--
-- Duas cadeias de migrations chegaram à mesma constraint por caminhos diferentes:
--
--   · 9342 (upstream, telegram) reconstruiu `conversations_channel_check` com
--     ('whatsapp','instagram','facebook','telegram') — sem 'web', que a 8804 tinha posto.
--   · 9109 (este fork, chat externo) reconstruiu `channel_sessions_provider_check` e
--     `channel_sessions_provider_ref_check` sem 'telegram'.
--
-- Quem aplica as migrations em ordem (`supabase db push`) acabaria com a ÚLTIMA delas, que
-- recusa o que a outra aceita (23514 em silêncio, porque quem grava captura e segue). O
-- baseline.sql já tem a união nos blocos canônicos; esta migration traz a cadeia para o mesmo
-- lugar. É um forward-fix: nenhuma migration aplicada é editada, e a lista é um SUPERCONJUNTO
-- de qualquer uma que já esteve em vigor, então nenhuma linha existente passa a violar.

alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check
  check (channel in ('whatsapp', 'instagram', 'facebook', 'web', 'telegram'));

alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'wacalls'::text, 'zernio_social'::text, 'datafy'::text, 'web'::text, 'chat_externo'::text, 'telegram'::text]));

alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
  (provider = 'waha'       and waha_session_name    is not null) or
  (provider = 'meta_cloud' and meta_phone_number_id is not null) or
  (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
  (provider = 'wacalls'    and wacalls_session_id    is not null) or
  (provider = 'datafy'     and datafy_phone_number_id is not null) or
  (provider = 'web'        and web_widget_id          is not null) or
  (provider = 'chat_externo' and chat_externo_ref     is not null) or
  (provider = 'telegram'   and telegram_bot_id      is not null)
);
