# Deploy InterCRM na VPS 3xData (Laravel Forge)

> Documento interno da InterCert. Referencia o deploy real feito em 19/09/2026
> na VPS `45.228.85.2`, dominio `crm.intercert.com.br`.
>
> **Objetivo:** qualquer sessao Claude ou membro do time consegue replicar,
> atualizar ou depurar a instalacao lendo apenas este arquivo.

---

## Indice

1. [Arquitetura de rede](#1-arquitetura-de-rede)
2. [Pre-requisitos da VPS](#2-pre-requisitos-da-vps)
3. [Servicos Docker (o que roda)](#3-servicos-docker-o-que-roda)
4. [Passo a passo do deploy inicial](#4-passo-a-passo-do-deploy-inicial)
5. [Como publicar uma atualizacao sua](#5-como-publicar-uma-atualizacao-sua)
6. [Variaveis de ambiente (completo)](#6-variaveis-de-ambiente-completo)
7. [Configuracao do Nginx (Forge)](#7-configuracao-do-nginx-forge)
8. [Troubleshooting](#8-troubleshooting)
9. [Comandos uteis do dia a dia](#9-comandos-uteis-do-dia-a-dia)

---

## 1. Arquitetura de rede

```
Internet
   |
pfSense (SSL termination - certificado emitido aqui)
   |
Nginx do Forge (:80) --- proxy_pass ---> app container (127.0.0.1:3100)
                                            |
                                     rede Docker interna
                                     /    |     |      \
                                  waha  redis   srh  scheduler
                                         |
                                       worker
```

**Pontos-chave:**

- **pfSense** faz a terminacao SSL. O Nginx do Forge so escuta na porta 80.
- **Forge** gerencia o Nginx que serve varios sites na VPS. O CRM e mais um `server` block.
- **Docker Compose** sobe 7 containers numa rede interna (`internal`). So o `app` expoe porta (3100, apenas em localhost).
- **Caddy desligado.** O compose padrao traz Caddy para HTTPS, mas aqui quem faz isso e o pfSense + Nginx do Forge. O `docker-compose.forge.yml` desativa o Caddy.

---

## 2. Pre-requisitos da VPS

| Item | Detalhe |
|------|---------|
| **Docker** | `docker` e `docker compose` (v2, plugin) instalados. Verificar: `docker compose version` |
| **Git** | Para clonar e atualizar o repositorio |
| **Forge** | Site criado para o dominio. Deploy script vazio (`echo "deploy via docker"`). PM2 desligado |
| **pfSense** | Regra de NAT/port-forward da porta 80 para a VPS. Certificado SSL emitido |
| **Supabase** | Projeto criado em supabase.co (ou self-hosted). Schema ja aplicado (`baseline.sql`) |

---

## 3. Servicos Docker (o que roda)

O Docker Compose levanta estes servicos:

| Servico | Imagem | O que faz | Porta |
|---------|--------|-----------|-------|
| **app** | `ghcr.io/arthurharysson/deskcommcrm` | Next.js (frontend + API) | 127.0.0.1:3100 -> 3000 |
| **worker** | `ghcr.io/arthurharysson/deskcomm-worker` | Motor do agente de IA (fila 24/7) | Nenhuma (rede interna) |
| **scheduler** | `ghcr.io/arthurharysson/deskcomm-scheduler` | Cron jobs (dreno de fila, retencao, heartbeat) | Nenhuma (rede interna) |
| **waha** | `devlikeapro/waha:latest-2026.7.2` | Ponte WhatsApp (NOWEB engine) | Nenhuma (rede interna) |
| **redis** | `redis:7-alpine` | Cache efemero (rate limit, debounce) | Nenhuma (rede interna) |
| **srh** | `hiett/serverless-redis-http` | Adapter REST sobre Redis (fala protocolo Upstash) | Nenhuma (rede interna) |
| **caddy** | DESLIGADO nesta instalacao | - | - |

**Memoria alocada (tetos medidos):**
- app: 768 MiB | worker: 512 MiB | waha: 1280 MiB | scheduler: sem teto definido

---

## 4. Passo a passo do deploy inicial

### 4.1. Criar site no Forge

1. No painel do Forge, crie um novo site para `crm.intercert.com.br`
2. **Limpe o deploy script** — substitua tudo por:
   ```bash
   echo "deploy via docker — nao use Forge para build"
   ```
3. Se o Forge criou processo PM2, mate: `pm2 delete site-XXXXXX`

### 4.2. Clonar o repositorio na VPS

```bash
# O Forge ja clona ao criar o site, mas se precisar:
cd /home/forge/crm.intercert.com.br/releases/000000/
# ou qualquer diretorio que preferir
git clone https://github.com/arthurharysson/InterCRM.git .
```

### 4.3. Criar o arquivo .env

```bash
cd /home/forge/crm.intercert.com.br/releases/000000/
nano .env
```

Preencha com as variaveis (ver secao 6). O minimo obrigatorio:

```env
# --- Supabase (OBRIGATORIO) ---
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
SUPABASE_DB_URL=postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres

# --- App (OBRIGATORIO) ---
NEXT_PUBLIC_APP_URL=https://crm.intercert.com.br
NEXT_PUBLIC_ADMIN_URL=https://crm.intercert.com.br
DOMAIN=crm.intercert.com.br

# --- Imagens Docker (OBRIGATORIO - seu fork) ---
APP_IMAGE=ghcr.io/arthurharysson/deskcommcrm:latest
WORKER_IMAGE=ghcr.io/arthurharysson/deskcomm-worker:latest
SCHEDULER_IMAGE=ghcr.io/arthurharysson/deskcomm-scheduler:latest

# --- WAHA (OBRIGATORIO) ---
WAHA_API_KEY=<gerar com openssl rand -hex 32>
WAHA_API_KEY_SHA512=<sha512 hex do WAHA_API_KEY>
WAHA_HMAC_SECRET=<gerar com openssl rand -hex 32>
WAHA_WEBHOOK_BASE_URL=http://app:3000
WAHA_API_BASE_URL=http://waha:3000

# --- Redis interno (OBRIGATORIO) ---
SRH_TOKEN=<gerar com openssl rand -hex 32>
UPSTASH_REDIS_REST_URL=http://srh:8079
UPSTASH_REDIS_REST_TOKEN=<mesmo valor do SRH_TOKEN>

# --- Seguranca interna (OBRIGATORIO) ---
INTERNAL_SECRET=<gerar com openssl rand -hex 32>

# --- Sentry (pode desligar) ---
SENTRY_DSN=off
```

### 4.4. Subir os containers

```bash
cd /home/forge/crm.intercert.com.br/releases/000000/

docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.forge.yml \
  --env-file .env \
  up -d
```

**IMPORTANTE:** Sempre use os DOIS arquivos compose. O `docker-compose.forge.yml`:
- Expoe a porta 3100 em localhost (para o Nginx do Forge alcancar)
- Desativa o Caddy (quem faz proxy e o Nginx do Forge)

### 4.5. Configurar Nginx no Forge

No painel do Forge > Sites > crm.intercert.com.br > Nginx Configuration, cole a config da secao 7.

### 4.6. Criar o usuario dono

Como o `bootstrap-owner.ts` nao esta na imagem Docker, crie via API:

```bash
# Criar usuario no Supabase Auth
curl -X POST "https://xxxx.supabase.co/auth/v1/admin/users" \
  -H "Authorization: Bearer SUA_SERVICE_ROLE_KEY" \
  -H "apikey: SUA_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "seu@email.com",
    "password": "senha-forte-aqui",
    "email_confirm": true,
    "user_metadata": {"full_name": "Seu Nome"}
  }'
```

**Alternativa melhor** — rodar o bootstrap localmente, apontando para o Supabase de producao:

```bash
# Na sua maquina local, com o projeto clonado:
OWNER_EMAIL=seu@email.com \
OWNER_PASSWORD=senha-forte \
OWNER_ORG_NAME="InterCert" \
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=sb_secret_... \
npx tsx scripts/bootstrap-owner.ts
```

Isso cria: usuario + organizacao + membership admin + platform_admin.

### 4.7. Verificar

```bash
# O container responde?
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100
# Esperado: 307 (redireciona pro login)

# O dominio responde?
curl -s -o /dev/null -w "%{http_code}" https://crm.intercert.com.br
# Esperado: 307
```

### 4.8. Configurar Supabase (URL de retorno)

No painel do Supabase > Authentication > URL Configuration:
- **Site URL:** `https://crm.intercert.com.br`
- **Redirect URLs:** adicione `https://crm.intercert.com.br/**`

Sem isso, emails de reset de senha apontam para `localhost:3000`.

---

## 5. Como publicar uma atualizacao sua

### Fluxo padrao (recomendado): CI publica imagem

1. **Desenvolva localmente** (`pnpm dev`)
2. **Commit e push** para o seu fork (`arthurharysson/InterCRM`)
3. **O GitHub Actions constroi** as 3 imagens e publica no GHCR
4. **Na VPS, puxe e suba:**

```bash
cd /home/forge/crm.intercert.com.br/releases/000000/

# Puxar imagens novas
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.forge.yml \
  --env-file .env \
  pull

# Recriar containers com as novas imagens
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.forge.yml \
  --env-file .env \
  up -d
```

**O que acontece:**
- `pull` baixa as imagens novas do GHCR
- `up -d` recria so os containers cuja imagem mudou
- Downtime de ~5-10 segundos por container

### Para o CI funcionar no seu fork

O workflow `publish-image.yml` ja existe no repositorio. Para funcionar no seu fork:

1. No GitHub: Settings > Actions > General > **Allow all actions**
2. O `GITHUB_TOKEN` ja tem permissao de `packages: write` (automatico)
3. Publique fazendo push na `main`:
   ```bash
   git push origin main
   ```
4. A imagem fica em `ghcr.io/arthurharysson/deskcommcrm:latest`

**Tags de versao:** push de tag `v*` gera imagem com numero de versao e move `stable`:
```bash
git tag v1.0.0
git push origin v1.0.0
```

### Fluxo de emergencia: build na VPS

Quando o CI nao esta funcionando ou precisa de algo urgente:

```bash
cd /home/forge/crm.intercert.com.br/releases/000000/

# Atualizar codigo
git pull origin main

# Construir localmente (demora ~3-5 min)
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.forge.yml \
  --env-file .env \
  build

# Subir com a imagem local
APP_PULL_POLICY=never \
WORKER_PULL_POLICY=never \
SCHEDULER_PULL_POLICY=never \
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.forge.yml \
  --env-file .env \
  up -d
```

**ATENCAO:** imagem construida na VPS e divida tecnica. No proximo `up -d` sem `PULL_POLICY=never`, ela sera substituida pela do GHCR.

---

## 6. Variaveis de ambiente (completo)

### Obrigatorias (o app nao sobe sem)

| Variavel | Descricao | Exemplo |
|----------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anonima (segura para browser, RLS protege) | `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave admin (bypassa RLS, NUNCA no browser) | `sb_secret_...` |
| `SUPABASE_DB_URL` | Connection string do Postgres | `postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres` |
| `NEXT_PUBLIC_APP_URL` | URL publica do CRM | `https://crm.intercert.com.br` |
| `WAHA_API_KEY` | Chave de acesso ao WAHA (plaintext) | `openssl rand -hex 32` |
| `WAHA_API_KEY_SHA512` | Hash SHA512 da chave WAHA (o WAHA compara com este) | Ver nota abaixo |
| `WAHA_HMAC_SECRET` | Segredo para validar webhooks do WAHA | `openssl rand -hex 32` |
| `WAHA_WEBHOOK_BASE_URL` | URL interna que o WAHA usa para chamar o app | `http://app:3000` |
| `WAHA_API_BASE_URL` | URL interna do WAHA (para o app chamar o WAHA) | `http://waha:3000` |
| `SRH_TOKEN` | Token do adapter Redis-HTTP | `openssl rand -hex 32` |
| `UPSTASH_REDIS_REST_URL` | URL interna do Redis HTTP | `http://srh:8079` |
| `UPSTASH_REDIS_REST_TOKEN` | Token para o Redis HTTP (= SRH_TOKEN) | Mesmo valor do `SRH_TOKEN` |
| `INTERNAL_SECRET` | Bearer para endpoints internos (cron) | `openssl rand -hex 32` |
| `DOMAIN` | Dominio (usado pelo Caddy, mas defina mesmo com Forge) | `crm.intercert.com.br` |

**Nota sobre WAHA_API_KEY_SHA512:** No WAHA Plus, voce precisa do hash SHA512 hex:
```bash
echo -n "SUA_WAHA_API_KEY" | sha512sum | awk '{print $1}'
```
No WAHA Core (gratis), o WAHA compara literalmente, entao coloque o mesmo valor da `WAHA_API_KEY`.

### Imagens Docker (obrigatorio para seu fork)

| Variavel | Descricao | Seu valor |
|----------|-----------|-----------|
| `APP_IMAGE` | Imagem do app Next.js | `ghcr.io/arthurharysson/deskcommcrm:latest` |
| `WORKER_IMAGE` | Imagem do worker (agente IA) | `ghcr.io/arthurharysson/deskcomm-worker:latest` |
| `SCHEDULER_IMAGE` | Imagem do scheduler (cron) | `ghcr.io/arthurharysson/deskcomm-scheduler:latest` |

Sem essas, o compose usa as imagens do `melgarafael` (o upstream).

### Opcionais (funciona sem, mas vale configurar)

| Variavel | Descricao | Quando configurar |
|----------|-----------|-------------------|
| `ANTHROPIC_API_KEY` | Chave da Anthropic para agente IA | Quando quiser IA respondendo no WhatsApp |
| `OPENAI_API_KEY` | Chave OpenAI (embeddings/audio) | Para RAG (base de conhecimento) e transcricao |
| `OPENROUTER_API_KEY` | Chave OpenRouter (alternativa de IA) | Se preferir OpenRouter ao inves de Anthropic |
| `RESEND_API_KEY` | Chave Resend (email transacional) | Para convites de time e exports LGPD por email |
| `RESEND_FROM_EMAIL` | Remetente (dominio verificado na Resend) | Junto com RESEND_API_KEY |
| `SENTRY_DSN` | DSN do Sentry (monitoramento) | Para capturar erros. `off` = desliga |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Chaves VAPID (push notifications) | Gerar: `npx web-push generate-vapid-keys` |
| `APP_NAME` | Nome da marca (white-label) | Para mostrar sua marca em vez de "DeskcommCRM" |
| `APP_LOGO_URL` | URL da logo | URL publica de uma imagem |
| `APP_ACCENT_HEX` | Cor primaria (hex) | Ex: `#506d48` |

### Nao mexer (defaults corretos)

| Variavel | Default | Motivo |
|----------|---------|--------|
| `WHATSAPP_RESTART_ALL_SESSIONS` | `True` | Sem isso, sessoes WAHA nao retomam apos reinicio |
| `AGENT_DISPATCH_CONSUMER` | `engine` | O worker processa a fila. Nunca `native` junto com worker |
| `AI_BUDGET_ENFORCEMENT` | `on` | Respeita teto de gasto por organizacao |
| `JOB_QUEUE_RETENTION_DAYS` | `90` | Limpeza da fila de jobs antigos |
| `AUDIT_LOG_RETENTION_DAYS` | `1825` | 5 anos de log de auditoria |

---

## 7. Configuracao do Nginx (Forge)

No Forge > Sites > crm.intercert.com.br > Nginx Configuration:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name crm.intercert.com.br;

    charset utf-8;
    client_max_body_size 50m;

    # Buffers para Next.js Server Actions (evita 502 em POST)
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;

    # Bloquear webhook global do WAHA (so trafega pela rede interna)
    location = /api/v1/webhooks/waha {
        return 403;
    }

    # Agente de IA: timeout estendido (ate 5min por execucao)
    location /api/internal/agents/run {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 320s;
        proxy_send_timeout 320s;
    }

    # Todo o resto
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

**Por que cada diretiva:**

| Diretiva | Motivo |
|----------|--------|
| `X-Forwarded-Proto https` | pfSense termina o SSL. O app precisa saber que esta atras de HTTPS para cookies Secure e redirects |
| `proxy_buffer_size 128k` | Next.js Server Actions (POST /login) retornam headers grandes. O Nginx padrao (4k/8k) causa 502 |
| `proxy_read_timeout 320s` | O agente de IA pode levar minutos. Timeout curto corta a resposta |
| `location = /api/v1/webhooks/waha` | O WAHA fala com o app pela rede Docker interna. Expor essa rota na internet permitiria injecao de mensagens |
| `client_max_body_size 50m` | Upload de midias via WhatsApp |

---

## 8. Troubleshooting

### 502 Bad Gateway no POST /login

**Causa:** buffers do Nginx muito pequenos para os headers do Next.js Server Actions.

**Solucao:** adicione as diretivas `proxy_buffer_size`, `proxy_buffers` e `proxy_busy_buffers_size` na config do Nginx (secao 7).

### 503 Service Unavailable

**Causa:** pfSense nao esta redirecionando a porta 80 para a VPS, ou o Nginx nao esta rodando.

**Verificar:**
```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100
# Se retorna 307: o app funciona, o problema esta entre a internet e o Nginx
```

### Container nao sobe (unhealthy)

```bash
# Ver status
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml ps

# Ver logs do container com problema
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml logs app --tail 50
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml logs worker --tail 50
```

### Login cai em settings/profile sem funcionar

**Causa:** o usuario existe no Supabase Auth mas nao tem organizacao nem membership nas tabelas do CRM.

**Solucao:** rode o `bootstrap-owner.ts` localmente (secao 4.6) ou crie manualmente:

```sql
-- No Supabase SQL Editor:
-- 1. Verificar usuario
SELECT id, email FROM auth.users WHERE email = 'seu@email.com';

-- 2. Verificar se tem org e membership
SELECT * FROM user_organizations WHERE user_id = 'UUID-DO-USUARIO';
SELECT * FROM organizations;
```

### Reset de senha aponta para localhost:3000

**Causa:** URL Configuration do Supabase nao foi atualizada.

**Solucao:** Supabase Dashboard > Authentication > URL Configuration > Site URL = `https://crm.intercert.com.br`

### WAHA nao conecta

```bash
# Testar conectividade interna
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml exec app \
  wget -qO- http://waha:3000/api/sessions

# Verificar se o WAHA_API_KEY bate
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml logs waha --tail 20
```

---

## 9. Comandos uteis do dia a dia

```bash
# Diretorio base (ajuste se diferente)
DIR="/home/forge/crm.intercert.com.br/releases/000000"

# --- Status ---
docker compose -f $DIR/docker-compose.prod.yml -f $DIR/docker-compose.forge.yml ps

# --- Logs em tempo real ---
docker compose -f $DIR/docker-compose.prod.yml -f $DIR/docker-compose.forge.yml logs -f app
docker compose -f $DIR/docker-compose.prod.yml -f $DIR/docker-compose.forge.yml logs -f worker
docker compose -f $DIR/docker-compose.prod.yml -f $DIR/docker-compose.forge.yml logs -f waha

# --- Reiniciar tudo ---
docker compose -f $DIR/docker-compose.prod.yml -f $DIR/docker-compose.forge.yml --env-file $DIR/.env restart

# --- Reiniciar so o app ---
docker compose -f $DIR/docker-compose.prod.yml -f $DIR/docker-compose.forge.yml --env-file $DIR/.env restart app

# --- Atualizar imagens e recriar ---
cd $DIR
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml --env-file .env pull
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml --env-file .env up -d

# --- Ver uso de memoria ---
docker stats --no-stream

# --- Entrar no container do app (debug) ---
docker compose -f $DIR/docker-compose.prod.yml -f $DIR/docker-compose.forge.yml exec app sh

# --- Health check ---
curl -s http://127.0.0.1:3100/api/v1/health | python3 -m json.tool
```

---

## Diagrama de arquivos no servidor

```
/home/forge/crm.intercert.com.br/
  releases/
    000000/                          <-- Codigo fonte
      .env                           <-- Variaveis de ambiente (NUNCA commitar)
      docker-compose.prod.yml        <-- Compose principal (7 servicos)
      docker-compose.forge.yml       <-- Override para Forge (porta 3100, sem Caddy)
      Caddyfile                      <-- Existe mas NAO e usado (Caddy desligado)
      ...resto do repositorio...
```

---

## Resumo executivo para sessoes Claude futuras

> **O InterCRM roda na VPS 3xData (45.228.85.2) como Docker Compose com
> override para Laravel Forge (`docker-compose.forge.yml`). O Forge cuida do
> Nginx, pfSense cuida do SSL. O app expoe a porta 3100 em localhost. As imagens
> sao publicadas pelo GitHub Actions no GHCR sob `arthurharysson/`. Supabase e
> na nuvem (supabase.co). Para atualizar: push na main, esperar o CI, `docker
> compose pull && up -d` na VPS. O `docker-compose.forge.yml` SEMPRE deve ser
> incluido nos comandos.**
