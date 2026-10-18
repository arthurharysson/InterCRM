-- Estende o CHECK de provider em voice_calls para incluir 'fluxo'
-- (plataforma omnichannel de telefonia — integração via API HTTP).
-- Idempotente: drop if exists + re-cria com o vocabulário completo.

alter table public.voice_calls drop constraint if exists voice_calls_provider_check;
alter table public.voice_calls
  add constraint voice_calls_provider_check
  check (provider = any (array['wacalls', 'sip', 'fluxo']));
