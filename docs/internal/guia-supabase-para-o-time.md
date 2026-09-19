# Guia Supabase para o Time InterCRM

> Documento interno. Para quem vem de MySQL/PostgreSQL tradicional com API
> REST propria e precisa entender como o Supabase funciona neste projeto.
>
> **Premissa:** voce sabe SQL e ja trabalhou com banco relacional. Este guia
> explica o que o Supabase adiciona e como este projeto usa cada parte.

---

## Indice

1. [O que e o Supabase (em 2 minutos)](#1-o-que-e-o-supabase)
2. [Diferenca para o setup tradicional](#2-diferenca-para-o-setup-tradicional)
3. [Como acessar o banco](#3-como-acessar-o-banco)
4. [Os 3 clients do projeto](#4-os-3-clients-do-projeto)
5. [RLS — Row Level Security (conceito central)](#5-rls--row-level-security)
6. [Autenticacao (Auth)](#6-autenticacao-auth)
7. [As 3 chaves e quando usar cada uma](#7-as-3-chaves-e-quando-usar-cada-uma)
8. [Fazendo queries (exemplos praticos)](#8-fazendo-queries-exemplos-praticos)
9. [Realtime (atualizacoes ao vivo)](#9-realtime-atualizacoes-ao-vivo)
10. [Storage (arquivos)](#10-storage-arquivos)
11. [Migrations e schema](#11-migrations-e-schema)
12. [Edge Functions vs Route Handlers](#12-edge-functions-vs-route-handlers)
13. [Dashboard do Supabase](#13-dashboard-do-supabase)
14. [Erros comuns e como resolver](#14-erros-comuns-e-como-resolver)
15. [Glossario rapido](#15-glossario-rapido)

---

## 1. O que e o Supabase

Supabase e uma plataforma que empacota Postgres com servicos prontos:

```
┌──────────────────────────────────────────────┐
│                  Supabase                     │
│                                               │
│  ┌─────────┐  ┌────────┐  ┌─────────────┐   │
│  │ Postgres │  │  Auth   │  │  Storage    │   │
│  │  (banco) │  │ (login) │  │  (arquivos) │   │
│  └─────────┘  └────────┘  └─────────────┘   │
│                                               │
│  ┌─────────┐  ┌───────────────────────┐      │
│  │Realtime │  │  PostgREST (API REST) │      │
│  │ (ws)    │  │                       │      │
│  └─────────┘  └───────────────────────┘      │
│                                               │
│  Tudo acessivel via SDK JavaScript            │
└──────────────────────────────────────────────┘
```

**Em uma frase:** e um Postgres na nuvem com login, API REST automatica, websockets e storage de arquivos — tudo acessivel por um SDK JavaScript.

---

## 2. Diferenca para o setup tradicional

| Aspecto | Setup tradicional (MySQL + API propria) | Supabase neste projeto |
|---------|----------------------------------------|----------------------|
| **Banco** | MySQL ou Postgres na VPS, voce gerencia | Postgres na nuvem do Supabase (eles gerenciam) |
| **API** | Voce cria rotas REST (Express, Laravel, etc.) | Duas camadas: PostgREST automatico + Route Handlers Next.js |
| **Login** | Voce implementa (bcrypt, JWT, sessions) | Supabase Auth (pronto, com OAuth, MFA, magic link) |
| **Permissoes** | Middleware na API (`if (user.role !== 'admin')`) | RLS no banco (policies SQL que filtram linhas automaticamente) |
| **Uploads** | S3 ou disco, voce gerencia | Supabase Storage (S3 por baixo, SDK pronto) |
| **Tempo real** | Socket.io ou Pusher, voce monta | Supabase Realtime (escuta mudancas no Postgres via websocket) |
| **Migrations** | Knex, Prisma, Laravel Migrations | Arquivos SQL em `supabase/migrations/` |
| **ORM** | Eloquent, Prisma, Sequelize | **Nao usa ORM.** Query builder do SDK + SQL puro |

### O que NAO muda

- **SQL e SQL.** O Postgres e um Postgres normal. Voce pode conectar com `psql`, DBeaver, pgAdmin.
- **Tabelas, colunas, indices, FKs** — tudo igual ao que voce conhece.
- **Voce ainda escreve logica de negocio** no backend (Route Handlers do Next.js). O Supabase nao substitui isso.

### O que MUDA de verdade

1. **Seguranca vive no BANCO, nao so na API.** Mesmo que alguem consiga chamar o Postgres direto, a RLS protege.
2. **O SDK faz query direto do browser** (com a anon key). Sem precisar de uma API intermediaria para leituras simples.
3. **Login e out-of-the-box.** Voce nao implementa hash de senha, token JWT, refresh token. Ja vem.

---

## 3. Como acessar o banco

### Pelo Dashboard (interface web)

1. Acesse [app.supabase.com](https://app.supabase.com)
2. Selecione o projeto
3. Menu lateral: **Table Editor** (ver/editar dados) ou **SQL Editor** (rodar queries)

### Por ferramenta SQL (DBeaver, pgAdmin, DataGrip)

Use a connection string do `.env`:
```
SUPABASE_DB_URL=postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres
```

**Host:** `db.xxxx.supabase.co`
**Porta:** `5432`
**Banco:** `postgres`
**Usuario:** `postgres`
**Senha:** a senha do projeto (esta na connection string)

### Pela linha de comando

```bash
psql "postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres"
```

---

## 4. Os 3 clients do projeto

O projeto tem 3 formas de falar com o Supabase, cada uma para um contexto:

### 4.1. Browser Client (`lib/supabase/browser.ts`)

**Quando usar:** componentes React no browser (arquivos com `"use client"`)

```typescript
import { createClient } from "@/lib/supabase/browser";

// No componente:
const supabase = createClient();
const { data } = await supabase
  .from("contacts")
  .select("*")
  .eq("organization_id", orgId);
```

- Usa a **anon key** (segura para o browser)
- **RLS filtra automaticamente** — o usuario so ve dados da organizacao dele
- Sessao vem do cookie (httpOnly, SameSite=Strict)

### 4.2. Server Client (`lib/supabase/server.ts`)

**Quando usar:** Server Components, Route Handlers (`app/api/`), Server Actions

```typescript
import { createClient } from "@/lib/supabase/server";

// No Route Handler:
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser(); // <-- SEMPRE getUser(), NUNCA getSession()
  // ...
}
```

- Usa a **anon key** mas com o cookie do usuario (server-side)
- **RLS ativa** — filtra pelo usuario logado
- Le o cookie via `next/headers`

### 4.3. Admin Client (`lib/supabase/admin.ts`)

**Quando usar:** webhooks, crons, workers, operacoes de plataforma

```typescript
import { createAdminClient } from "@/lib/supabase/admin";

// No webhook handler:
const admin = createAdminClient();
const { data } = await admin
  .from("contacts")
  .select("*")
  .eq("organization_id", orgIdDoWebhook); // <-- FILTRA MANUALMENTE!
```

- Usa a **service role key** (BYPASSA toda RLS)
- **PERIGOSO:** se voce esquecer de filtrar `organization_id`, retorna dados de TODAS as organizacoes
- **REGRA:** organization_id vem de fonte CONFIAVEL (cookie, JWT, webhook secret) — NUNCA do body da request

### Resumo visual

```
Browser (React)     →  browser.ts  →  anon key + cookie    →  RLS protege
Server Component    →  server.ts   →  anon key + cookie    →  RLS protege
Route Handler       →  server.ts   →  anon key + cookie    →  RLS protege
Webhook / Cron      →  admin.ts    →  service role key     →  SEM RLS (filtre manualmente!)
Worker              →  admin.ts    →  service role key     →  SEM RLS (filtre manualmente!)
```

---

## 5. RLS — Row Level Security

### O que e

RLS e uma funcionalidade do Postgres que define **quem pode ver/editar quais linhas**. Em vez de verificar permissoes no codigo da API, o proprio banco recusa a linha.

### Analogia com o mundo tradicional

**Sem RLS (como voce faz hoje):**
```javascript
// Na sua API Express/Laravel:
app.get("/contacts", (req, res) => {
  const user = req.user;
  const contacts = db.query("SELECT * FROM contacts WHERE org_id = ?", [user.org_id]);
  //                                                    ^^^^^^^^^^^^^^^^^
  //                                         Voce filtra no codigo. Se esquecer, vaza.
  res.json(contacts);
});
```

**Com RLS (como o Supabase faz):**
```sql
-- No banco (uma vez):
CREATE POLICY "tenant_isolation_contacts_all" ON contacts
  USING (organization_id IN (SELECT fn_user_org_ids()));
  --                         ^^^^^^^^^^^^^^^^^^^^^^^
  -- O banco filtra sozinho. Nao tem como esquecer.
```

Agora, mesmo que voce faca `SELECT * FROM contacts` sem WHERE, o Postgres so retorna as linhas da organizacao do usuario logado.

### Como funciona neste projeto

1. **Toda tabela tenant-aware tem `organization_id`** (FK para `organizations`)
2. **Toda tabela tem uma RLS policy** chamada `tenant_isolation_<tabela>_all`
3. A policy usa `fn_user_org_ids()` que retorna as orgs do usuario logado
4. **Quando o SDK JavaScript faz uma query, o Postgres aplica a policy automaticamente**

### Por que isso importa

Se voce vem de MySQL: no Supabase, **o banco e a ultima linha de defesa**. Mesmo que alguem descubra a anon key (que e publica no browser), a RLS impede acesso a dados de outra organizacao.

---

## 6. Autenticacao (Auth)

### O que o Supabase Auth faz por voce

- Criacao de usuario (signup)
- Login (email/senha, OAuth, magic link)
- Hash de senha (bcrypt, automatico)
- JWT (emitido e validado pelo Supabase)
- Refresh token (automatico via SDK)
- MFA/TOTP (pronto, so ligar)
- Reset de senha (email automatico)

### Onde moram os usuarios

- **`auth.users`** — tabela interna do Supabase Auth. Contem email, senha hash, metadata.
- **`user_organizations`** — tabela NOSSA no schema `public`. Liga usuario a organizacao com role.
- **`platform_admins`** — tabela NOSSA. Super-admins da plataforma inteira.

### Fluxo de login

```
1. Usuario digita email/senha no browser
2. POST /login (Server Action do Next.js)
3. Server Action chama supabase.auth.signInWithPassword()
4. Supabase valida credencial e retorna JWT
5. SDK grava JWT no cookie (httpOnly, SameSite=Strict, Secure)
6. Proximas requests levam o cookie automaticamente
7. No server, getUser() valida o JWT e retorna o usuario
```

### REGRA DE OURO

```typescript
// CERTO — valida o JWT no backend:
const { data: { user } } = await supabase.auth.getUser();

// ERRADO — confia no cookie sem validar:
const { data: { session } } = await supabase.auth.getSession(); // NUNCA USE NO BACKEND
```

`getSession()` le o cookie e retorna os dados sem verificar se o JWT ainda e valido. No backend, **sempre `getUser()`**.

---

## 7. As 3 chaves e quando usar cada uma

### anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)

- **Segura para o browser** (prefixo `sb_publishable_`)
- Identifica o projeto, mas **nao da acesso a nada** que a RLS bloqueie
- E como uma API key publica: identifica quem esta chamando
- **RLS esta ATIVA** com esta chave
- Usada pelo browser client e pelo server client

### service role key (`SUPABASE_SERVICE_ROLE_KEY`)

- **NUNCA no browser** (prefixo `sb_secret_`)
- **BYPASSA toda RLS** — acesso total ao banco
- Equivalente a um usuario `root` do MySQL
- Usada so no backend: webhooks, crons, workers, bootstrap
- **Se vazar, qualquer pessoa acessa todos os dados de todas as organizacoes**

### connection string (`SUPABASE_DB_URL`)

- Acesso direto ao Postgres (sem passar pelo PostgREST)
- Usada pelo worker (agent-engine) que precisa de features avancadas do Postgres (locks, FTS)
- Tambem para ferramentas SQL (DBeaver, psql)

### Tabela comparativa

| Chave | Vai no browser? | RLS ativa? | Para que serve |
|-------|----------------|------------|----------------|
| anon key | SIM | SIM | Queries normais (browser e server com usuario logado) |
| service role | NUNCA | NAO | Operacoes de plataforma, webhooks, crons |
| connection string | NUNCA | Depende do role | Worker, ferramentas SQL, migrations |

---

## 8. Fazendo queries (exemplos praticos)

### SELECT (buscar dados)

```typescript
// Buscar contatos da organizacao (RLS filtra automaticamente no browser/server)
const { data, error } = await supabase
  .from("contacts")
  .select("id, name, phone, email, tags")
  .order("created_at", { ascending: false })
  .limit(50);

// Com filtro
const { data } = await supabase
  .from("contacts")
  .select("*")
  .eq("phone", "+5511999999999")      // WHERE phone = ...
  .single();                            // Espera exatamente 1 resultado

// JOIN (o Supabase faz via FK automatica)
const { data } = await supabase
  .from("crm_leads")
  .select(`
    id, title, value_cents,
    contact:contacts(name, phone),
    stage:crm_stages(name, color)
  `)
  .eq("pipeline_id", pipelineId);
```

**Equivalente SQL:**
```sql
SELECT l.id, l.title, l.value_cents,
       c.name AS contact_name, c.phone AS contact_phone,
       s.name AS stage_name, s.color AS stage_color
FROM crm_leads l
  JOIN contacts c ON c.id = l.contact_id
  JOIN crm_stages s ON s.id = l.stage_id
WHERE l.pipeline_id = $1;
```

### INSERT (criar registro)

```typescript
const { data, error } = await supabase
  .from("contacts")
  .insert({
    organization_id: orgId,  // OBRIGATORIO em toda tabela tenant-aware
    name: "Joao Silva",
    phone: "+5511999999999",
    email: "joao@example.com",
  })
  .select()     // Retorna o registro criado (com id, created_at, etc.)
  .single();
```

### UPDATE

```typescript
const { data, error } = await supabase
  .from("contacts")
  .update({ name: "Joao da Silva" })
  .eq("id", contactId)
  .select()
  .single();
```

### DELETE

```typescript
const { error } = await supabase
  .from("contacts")
  .delete()
  .eq("id", contactId);
```

### Comparacao com SQL puro

| Operacao | SDK Supabase | SQL equivalente |
|----------|-------------|-----------------|
| `.from("contacts")` | `FROM contacts` |
| `.select("id, name")` | `SELECT id, name` |
| `.eq("id", x)` | `WHERE id = x` |
| `.gt("value", 100)` | `WHERE value > 100` |
| `.in("status", ["a","b"])` | `WHERE status IN ('a','b')` |
| `.is("deleted_at", null)` | `WHERE deleted_at IS NULL` |
| `.order("name")` | `ORDER BY name` |
| `.limit(10)` | `LIMIT 10` |
| `.range(0, 9)` | `OFFSET 0 LIMIT 10` |
| `.single()` | Espera 1 linha (erro se 0 ou >1) |
| `.maybeSingle()` | Espera 0 ou 1 (null se 0) |

---

## 9. Realtime (atualizacoes ao vivo)

### O que e

O Supabase Realtime permite **escutar mudancas no banco em tempo real** via websocket. Quando alguem insere, atualiza ou deleta uma linha, todos os clientes inscritos recebem a notificacao.

### Quando usamos

- **Inbox de mensagens** — mensagem nova do WhatsApp aparece instantaneamente
- **Pipeline/Kanban** — lead movido por outro atendente atualiza o board
- **Notificacoes** — alertas aparecem sem refresh

### Exemplo

```typescript
// Escutar novas mensagens de uma conversa
const channel = supabase
  .channel("messages-conv-123")
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `conversation_id=eq.${conversationId}`,
    },
    (payload) => {
      console.log("Nova mensagem:", payload.new);
      // Atualizar a UI
    }
  )
  .subscribe();

// Parar de escutar quando o componente desmonta
return () => { supabase.removeChannel(channel); };
```

### Como funciona por baixo

```
1. O SDK abre um websocket para o Supabase
2. O Supabase configura um "listener" no Postgres (pg_notify)
3. Quando um INSERT/UPDATE/DELETE acontece, o Postgres notifica
4. O Supabase envia a mudanca pelo websocket
5. O SDK chama seu callback
```

**RLS tambem funciona aqui** — o usuario so recebe notificacoes de linhas que a RLS permite.

---

## 10. Storage (arquivos)

### O que e

Supabase Storage e um servico de arquivos (como S3) integrado ao projeto. Neste CRM, e usado para midias do WhatsApp (imagens, audios, documentos).

### Bucket principal

- **`whatsapp-media`** — bucket PRIVADO. Arquivos acessiveis apenas por URL assinada (temporaria).

### Como funciona

```typescript
// Upload de arquivo
const { data, error } = await supabase.storage
  .from("whatsapp-media")
  .upload(`${orgId}/${fileName}`, fileBuffer, {
    contentType: "image/jpeg",
  });

// Gerar URL assinada (expira em 1h)
const { data: { signedUrl } } = await supabase.storage
  .from("whatsapp-media")
  .createSignedUrl(`${orgId}/${fileName}`, 3600);
```

### Por que URL assinada

- O bucket e privado (ninguem acessa sem autorizacao)
- A URL assinada expira (nao da pra compartilhar permanentemente)
- Cada URL e unica para o usuario que pediu

---

## 11. Migrations e schema

### Onde fica o schema

```
supabase/
  baseline.sql          <-- Schema completo (o que o install.sh aplica)
  migrations/
    MANIFEST.md         <-- Indice de todas as migrations
    20260706..._0001_initial.sql
    20260707..._0002_rls_policies.sql
    ...
    20260915..._0231_latest.sql
```

### Dois caminhos, um banco

| Caminho | Quem usa | Arquivo |
|---------|---------|---------|
| **Instalacao nova** | `install.sh` / `bootstrap` | `baseline.sql` (schema completo, idempotente) |
| **Atualizacao** | `supabase db push` / CLI | Arquivos em `migrations/` (incrementais) |

### Como criar uma migration

```bash
# 1. Descubra o proximo numero
ls supabase/migrations/ | grep -oE '_[0-9]{4}_' | tr -d _ | sort -n | tail -1
# Ex: 0231 → proximo e 0232

# 2. Crie o arquivo
# Formato: <timestamp>_<NNNN>_<slug>.sql
touch supabase/migrations/20260919120000_0232_minha_mudanca.sql

# 3. Escreva SQL idempotente
# Sempre use IF NOT EXISTS, CREATE OR REPLACE, etc.
```

### Regra de ouro das migrations

**Toda mudanca de schema DEVE:**
1. Ter arquivo em `supabase/migrations/` (fonte da verdade)
2. Ter apendice idempotente em `supabase/baseline.sql` (para instalacoes novas)
3. Ter linha no `supabase/migrations/MANIFEST.md`

Sem os 3, clones nao recebem a mudanca ou quebram ao atualizar.

---

## 12. Edge Functions vs Route Handlers

**Este projeto NAO usa Supabase Edge Functions.** Toda logica de backend roda em:

- **Route Handlers do Next.js** (`app/api/v1/...`) — para APIs REST
- **Server Actions** (`"use server"`) — para mutacoes do frontend
- **Worker** (processo separado) — para o motor do agente de IA

Isso simplifica: um so runtime (Node.js), um so deploy (Docker), sem vendor lock-in adicional.

---

## 13. Dashboard do Supabase

### Enderecos uteis

| Secao | O que faz | URL |
|-------|----------|-----|
| **Table Editor** | Ver/editar dados (como phpMyAdmin) | Dashboard > Table Editor |
| **SQL Editor** | Rodar queries SQL | Dashboard > SQL Editor |
| **Authentication** | Ver usuarios, configurar login | Dashboard > Authentication |
| **Storage** | Ver/gerenciar arquivos | Dashboard > Storage |
| **Logs** | Ver logs do Postgres e da API | Dashboard > Logs |
| **Database** | Connection strings, extensions | Dashboard > Settings > Database |
| **API** | Ver chaves, URL | Dashboard > Settings > API |

### Authentication > URL Configuration

**IMPORTANTE para producao:**
- **Site URL:** `https://crm.intercert.com.br` (sem isso, reset de senha aponta pra localhost)
- **Redirect URLs:** `https://crm.intercert.com.br/**`

### Authentication > Providers

- **Email:** habilitado (login padrao)
- Os demais (Google, GitHub, etc.) desabilitados por padrao

---

## 14. Erros comuns e como resolver

### "new row violates row-level security policy"

**Causa:** voce esta tentando inserir/atualizar uma linha que a RLS nao permite.

**Solucao:**
- Verifique se esta passando `organization_id` correto
- Verifique se o usuario logado tem acesso a essa organizacao
- Se for operacao de plataforma, use o admin client (service role)

### "JWT expired"

**Causa:** o token de sessao expirou (padrao: 1 hora).

**Solucao:** o SDK renova automaticamente. Se persistir:
- Verifique se o middleware do Next.js esta rodando (ele renova o cookie)
- Force um novo login

### "Could not find the public.xxx table"

**Causa:** a tabela nao existe no schema ou a migration nao foi aplicada.

**Solucao:**
- Verifique se o `baseline.sql` foi aplicado
- Rode `supabase db push` para aplicar migrations pendentes

### "permission denied for table xxx"

**Causa:** o role que esta usando nao tem GRANT na tabela.

**Solucao:** verifique se a tabela tem os grants corretos:
```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'xxx';
```

### Query retorna vazio mas dados existem

**Causa provavel:** RLS esta filtrando. O usuario nao tem acesso a organizacao dos dados.

**Como confirmar:**
```sql
-- No SQL Editor do Supabase, como service_role:
SELECT count(*) FROM contacts; -- Retorna total real
-- vs
-- No browser, como usuario logado:
-- supabase.from("contacts").select("count") -- Retorna so os da org do usuario
```

---

## 15. Glossario rapido

| Termo | Significado |
|-------|-------------|
| **anon key** | Chave publica do Supabase. Identifica o projeto. Segura para browser |
| **service role key** | Chave admin. Bypassa RLS. NUNCA no browser |
| **RLS** | Row Level Security. Politica do Postgres que filtra linhas por usuario |
| **policy** | Regra SQL que define quem ve/edita quais linhas |
| **JWT** | JSON Web Token. Token de sessao emitido pelo Supabase Auth |
| **PostgREST** | Camada que transforma tabelas Postgres em API REST automaticamente |
| **Realtime** | Servico de websocket que notifica mudancas no banco |
| **baseline.sql** | Schema completo do banco (para instalacao do zero) |
| **migration** | Mudanca incremental no schema (ALTER, CREATE, etc.) |
| **organization_id** | FK que liga toda linha a uma organizacao (multi-tenant) |
| **tenant** | Uma organizacao. Cada cliente do CRM e um tenant |
| **fn_user_org_ids()** | Funcao Postgres que retorna as orgs do usuario logado |
| **bucket** | Container de arquivos no Supabase Storage (como um bucket S3) |
| **signed URL** | URL temporaria para acessar arquivo privado |

---

## Mapa mental: de onde vem cada coisa

```
Voce quer...                    Use...
─────────────────────────────── ──────────────────────────
Ver dados no browser            → Table Editor (dashboard)
Rodar SQL                       → SQL Editor (dashboard) ou psql
Fazer query no codigo           → SDK supabase (.from().select())
Criar usuario                   → supabase.auth.admin.createUser()
Logar usuario                   → supabase.auth.signInWithPassword()
Proteger dados por org          → RLS policy (ja existe em toda tabela)
Subir arquivo                   → supabase.storage.from().upload()
Escutar mudanca em tempo real   → supabase.channel().on("postgres_changes")
Mudar o schema                  → Migration SQL + baseline.sql
Acessar banco sem SDK           → Connection string (psql, DBeaver)
```

---

## Referencia rapida: SDK vs SQL

```typescript
// SDK (no codigo):
const { data } = await supabase
  .from("contacts")
  .select("name, phone")
  .eq("organization_id", orgId)
  .ilike("name", "%silva%")
  .order("created_at", { ascending: false })
  .limit(20);

// SQL equivalente:
// SELECT name, phone
// FROM contacts
// WHERE organization_id = $1
//   AND name ILIKE '%silva%'
// ORDER BY created_at DESC
// LIMIT 20;
```

A unica diferenca real: **no SDK, a RLS adiciona um WHERE invisivel** que filtra pela organizacao do usuario. No SQL puro (psql), voce ve tudo.
