-- manifest: grants explícitos das duas tabelas do webphone (org_webphone_settings, user_webphone_ramais) — a partir de 30/10/2026 a Supabase da nuvem não dá mais acesso automático a tabela nova pela Data API, e sem o grant a tela de Telefone no navegador volta 42501
--
-- A 8801 criou as duas tabelas confiando no GRANT ALL do default ACL do Supabase, que deixou de valer
-- para tabela criada depois de 30/10/2026 (a 8801 é de 31/10). O tamanho do grant é o que a RLS
-- pressupõe: `authenticated` lê (membro) e escreve (admin, pela policy de escrita), sem TRUNCATE nem
-- REFERENCES; `service_role` faz tudo, porque o worker e as rotas de servidor usam a service key.
-- Idempotente: grant repetido não falha. Anon continua sem nada (revogado pela 8801).

grant select, insert, update, delete on public.org_webphone_settings to authenticated;
grant all on public.org_webphone_settings to service_role;
grant select, insert, update, delete on public.user_webphone_ramais to authenticated;
grant all on public.user_webphone_ramais to service_role;
