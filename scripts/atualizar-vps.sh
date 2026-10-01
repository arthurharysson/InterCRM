#!/bin/bash
set -e

DIR="/home/forge/crm.intercert.com.br/releases/000000"
cd "$DIR"

echo "==> Puxando código..."
git checkout -- docker-compose.forge.yml 2>/dev/null || rm -f docker-compose.forge.yml 2>/dev/null || true
git pull origin main

echo "==> Puxando imagens Docker..."
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml --env-file .env pull

echo "==> Subindo containers..."
docker compose -f docker-compose.prod.yml -f docker-compose.forge.yml --env-file .env up -d

echo "==> Verificando health..."
sleep 5
curl -sf http://localhost:3000/api/v1/health | python3 -m json.tool 2>/dev/null || echo "(health check falhou — aguarde e tente: curl -s https://crm.intercert.com.br/api/v1/health)"

echo "==> Deploy completo!"
