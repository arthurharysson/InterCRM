# Deploy — Servidor 3xdata (Forge)

Guia de deploy para o servidor `xdata` da InterCert, gerenciado pelo Laravel Forge.

---

## Fluxo por tipo de mudança

| O que mudou        | Push + esperar GHCR | Script VPS       | Aplicar SQL no banco |
|--------------------|:-------------------:|:----------------:|:--------------------:|
| Código (front/API) | sim                 | sim              | nao                  |
| Schema (migration) | sim                 | sim              | sim                  |
| Variável `.env`    | nao                 | sim              | nao                  |

---

## 1. Mudança de código (frontend, API, lógica)

```bash
# No seu PC — commita e envia
git add .
git commit -m "descrição da mudança"
git push origin main
```

Acesse o GitHub Actions e aguarde o workflow **"Publicar imagem Docker (GHCR)"** ficar verde (leva ~7 minutos).

Depois, SSH no servidor e rode:

```bash
sudo -u forge bash /home/forge/crm.intercert.com.br/releases/000000/scripts/atualizar-vps.sh
```

Verifique:

```bash
curl -s https://crm.intercert.com.br/api/v1/health | python3 -m json.tool
```

---

## 2. Mudança de schema (migration do Supabase)

Faça o deploy de código (passo 1 acima) e depois aplique a migration no banco:

```bash
PGPASSWORD='K0zT6S0erOJZbYzx' psql \
  -h aws-0-us-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.qolnuavdwkygsfmeewct \
  -d postgres \
  -f /home/forge/crm.intercert.com.br/releases/000000/supabase/migrations/NOME_DA_MIGRATION.sql
```

Para aplicar o baseline inteiro (atualização grande ou banco desatualizado):

```bash
PGPASSWORD='K0zT6S0erOJZbYzx' psql \
  -h aws-0-us-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.qolnuavdwkygsfmeewct \
  -d postgres \
  -f /home/forge/crm.intercert.com.br/releases/000000/supabase/baseline.sql
```

---

## 3. Mudança de variável de ambiente

Edite o `.env`:

```bash
sudo -u forge nano /home/forge/crm.intercert.com.br/releases/000000/.env
```

Salve (Ctrl+O, Enter, Ctrl+X) e reinicie os containers:

```bash
sudo -u forge bash /home/forge/crm.intercert.com.br/releases/000000/scripts/atualizar-vps.sh
```

---

## Acesso SSH

```
ssh intercert@<IP-DO-SERVIDOR>
```

Comandos sempre com `sudo -u forge` (o dono dos arquivos é o usuário `forge`).

---

## Conexão com o banco (Supabase)

A VPS não tem rota IPv6, então use sempre o **Session Pooler** (IPv4):

```
Host:     aws-0-us-east-1.pooler.supabase.com
Porta:    5432
Usuário:  postgres.qolnuavdwkygsfmeewct
Banco:    postgres
```

Testar conexão:

```bash
PGPASSWORD='K0zT6S0erOJZbYzx' psql \
  -h aws-0-us-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.qolnuavdwkygsfmeewct \
  -d postgres \
  -c "SELECT 1"
```

---

## Troubleshooting

### Ver logs do app

```bash
sudo -u forge docker logs 000000-app-1 --tail 100
```

### Ver logs do worker

```bash
sudo -u forge docker logs 000000-worker-1 --tail 100
```

### Containers rodando

```bash
sudo -u forge docker ps
```

### Site dando 500 depois de atualizar código

Provavelmente o banco está desatualizado. Aplique o baseline (passo 2).

### `permission denied` no Docker

```bash
sudo usermod -aG docker forge
```

(Roda uma vez só. Depois use `sudo -u forge`.)

---

## Branding (nome, cor, favicon)

O nome e a cor da interface são configurados no banco:

```bash
PGPASSWORD='K0zT6S0erOJZbYzx' psql \
  -h aws-0-us-east-1.pooler.supabase.com \
  -p 5432 \
  -U postgres.qolnuavdwkygsfmeewct \
  -d postgres \
  -c "UPDATE platform_branding SET app_name = 'InterCRM', accent_hex = '#1e40af', updated_at = now() WHERE id = 1;"
```

O `APP_NAME` no `.env` também precisa estar atualizado (é o fallback da tela de login).
