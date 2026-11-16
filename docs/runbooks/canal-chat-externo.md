# Canal de chat fora do WhatsApp — o que configurar no CRM e no Chat

Guia de quem liga o CRM ao **Chat App** (aplicação separada, repositório `intercert/chat`) para atender, pela Fila,
clientes que conversam numa página de chat própria em vez do WhatsApp. O mesmo texto está no repositório do Chat,
em `INTEGRACAO-COM-O-CRM.md`.

> **Estado em 16/11/2026.** Verificado com os dois sistemas reais (CRM local + Chat em Docker com MySQL 8.4): o bot
> cria o chat, o cliente abre o link e vê o histórico, o atendente vê contato, setor, CPF e mensagens na Fila, e a
> resposta do atendente aparece na página do cliente. **Não verificado:** a volta CRM → Chat por **https público**
> (no teste local o anti-SSRF recusa destino local), anexos entre os dois sistemas e o proxy HTTPS do Chat.

## 1. Como as peças se encaixam

```
WhatsApp ──► bot (aplicação omni) ──POST /api/v1/chats──► CHAT APP ◄── cliente abre o link (/c/<token>)
                                                            │  ▲
                                         chat.started /     │  │  message / conversation.closed
                                         message (HMAC)     ▼  │  (HMAC)
                                                           CRM  ──►  Fila / Inbox  ◄── atendente
```

- O **bot** cria o chat no Chat App e manda o botão com o link no WhatsApp.
- O **Chat App** guarda a página do cliente e entrega ao CRM tudo o que o cliente faz.
- O **CRM** recebe como um canal comum: a conversa entra na Fila (com o setor, se o bot mandou o código) e o atendente
  responde pelo Inbox de sempre; a resposta volta ao Chat.

## 2. O que fica onde

| | CRM | Chat App |
|---|---|---|
| **Variáveis de ambiente (`.env`)** | **Nenhuma nova** | Sim — ver §4 |
| **Banco** | O Postgres/Supabase de sempre. Migration **9109** (aplicada pelo `update.sh`). | **MySQL próprio**, separado. Migrations com `npm run db:migrate` |
| **Configuração do canal** | **Pela tela** (Conexões › Chat fora do WhatsApp). Fica no banco, com as chaves **cifradas** | `.env` |
| **Código dos setores** | **Pela tela** (Equipe › Setores › "Código para o bot") | — |
| **Chave de API do bot** | — | Criada por **comando**; só o hash fica no banco |

## 3. No CRM

1. **Atualize a instalação** (o `update.sh` aplica a migration 9109). Sem isso a aba não existe.
2. **Setores (opcional).** O módulo de setores vem **desligado** de fábrica. Para o bot escolher a Fila, ligue-o e
   cadastre em **Equipe › Setores** o **Código para o bot** de cada setor (minúsculas, até 64 caracteres, único na
   empresa, ex.: `suporte-tecnico`). Sem módulo ou sem código a conversa entra **sem setor** e qualquer atendente a vê.
3. **Crie o canal** em **Conexões › Chat fora do WhatsApp** (só administrador). Informe o **Endereço do chat**:
   `https://<subdomínio-do-chat>/api/crm/events`. Precisa ser **https e público**: o CRM recusa, já na criação, quem
   não é `https` ou aponta para host privado (anti-SSRF). O DNS só é resolvido e conferido **no momento de enviar** uma
   resposta; se o subdomínio ainda não resolver para um IP público, o canal é criado, mas as respostas do atendente
   não chegam ao cliente. Aponte o DNS antes de testar.
4. A tela mostra **uma vez** três valores. **Copie na hora** (não ficam visíveis depois):

   | Rótulo na tela | Vai para a variável do Chat |
   |---|---|
   | Endereço de entrada do CRM | `CRM_ENTRY_URL` |
   | Chave que o Chat usa para falar com o CRM | `CRM_SECRET_TO_CRM` |
   | Chave que o CRM usa para falar com o Chat | `CRM_SECRET_FROM_CRM` |

5. **CPF.** O CRM grava o CPF cifrado com a `CPF_ENCRYPTION_KEY` dele. Sem essa chave o contato nasce **sem CPF** — e
   o Chat apaga o CPF depois de entregar, então ele se perde. Confira que a chave existe na instalação.

Perdeu uma chave? Não dá para vê-la de novo: use **Girar as chaves** (gera as duas novas e invalida as antigas) e
atualize o `.env` do Chat.

## 4. No Chat App

Modelo completo em `.env.example` do Chat; os campos que importam para a ligação:

| Variável | Para quê |
|---|---|
| `PUBLIC_BASE_URL` | URL pública do Chat (monta o link do cliente) |
| `DB_HOST` `DB_PORT` `DB_DATABASE` `DB_USERNAME` `DB_PASSWORD` | O MySQL do Chat |
| `CRM_ENTRY_URL` · `CRM_SECRET_TO_CRM` · `CRM_SECRET_FROM_CRM` | Os três valores da tela do CRM (§3, passo 4) |
| `API_KEY_PEPPER` | Pepper do hash das chaves de API do bot (≥ 32 caracteres) |
| `CPF_ENCRYPTION_KEY` | Cifra o CPF enquanto o chat não foi aberto (32 bytes em base64) |
| `BRAND_NAME` `BRAND_LOGO_URL` `BRAND_ACCENT` `PRIVACY_POLICY_URL` | Marca da página (opcionais) |

Gerar os segredos:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # API_KEY_PEPPER
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # CPF_ENCRYPTION_KEY
```

Infraestrutura (exemplo em `docker-compose.example.yml` do Chat): MySQL, volume persistente em `/data` (anexos),
**proxy HTTPS** na frente — que não pode segurar o stream `/api/chat/events` nem registrar `/c/*` nos logs. Detalhes
em `OPERACAO.md` do Chat.

## 5. A ordem (há um ovo e a galinha)

O CRM precisa do endereço do Chat para criar o canal, e o Chat precisa das chaves que o CRM gera. Resolve-se assim:

1. Escolha o **subdomínio** do Chat e aponte o DNS.
2. **CRM:** atualize, (opcional) ligue Setores e cadastre os códigos.
3. **CRM:** crie o canal com `https://<subdomínio>/api/crm/events` e **copie as três chaves**.
4. **Chat:** monte o `.env` (§4) com essas chaves.
5. **Chat:** rode as migrations e suba. `GET /api/ready` deve responder **200**.
6. **Chat:** crie a chave de API do bot: `npm run apikey:create -- "bot omni"` (aparece uma vez).
7. **Bot:** aponte para `POST https://<subdomínio>/api/v1/chats` com `Authorization: Bearer <chave>` e o corpo
   documentado em `mensagem-para-quem-mantem-o-bot.md` do Chat (use o código do setor em `sector`).

## 6. Como saber se está funcionando

- Chat: `GET /api/ready` → 200 com `config`, `database` e `storage` em `ok`.
- Chat: `npm run outbox -- stats` → `pendentes: 0`, `mortos: 0`.
- Cliente abre o link → vê o histórico do bot e escreve.
- CRM: a conversa aparece no Inbox, com o histórico marcado como importado e o canal "Chat…".
- Atendente responde → a resposta aparece na página do cliente.

## 7. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Chat com `outbox_crm_config_error` / 401 nas entregas | `CRM_SECRET_TO_CRM` ou `CRM_ENTRY_URL` não batem com a tela do CRM |
| Atendente responde e o cliente não vê; 401 em `/api/crm/events` | `CRM_SECRET_FROM_CRM` trocada com a outra chave (são duas, uma por sentido) |
| CRM recusa criar o canal | Endereço do chat não é `https` público |
| Conversa entra **sem setor** | Módulo Setores desligado, `sector` ausente ou código desconhecido (o CRM nunca recusa o cliente por isso) |
| Contato sem CPF | Falta a chave de CPF no CRM (§3, passo 5) |
| Bot recebe 404 | URL errada: é `/api/v1/chats`, não `/v1/chats` |

## 8. Fora do alcance desta versão

Reenvio automático de saída do CRM, cliente encerrando e fechando a conversa no CRM, selo/alertas por setor, LGPD
cruzada entre os dois sistemas e reenvio do botão pelo bot (decisão P10 do Chat, em aberto).
