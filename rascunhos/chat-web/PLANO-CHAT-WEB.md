# Chat Web de Atendimento — plano completo, contrato e tarefas

> Documento único para a conversa que vai **construir o Chat App** (aplicação nova e separada) e para a conversa que
> vai **adaptar o CRM** (este repositório, DeskcommCRM / InterCRM).
> Escrito em 13/11/2026. Tudo o que está marcado **[VERIFICADO NO CRM]** foi lido no código deste repositório nesta data.
> Tudo o que está marcado **[INFERIDO DO KLOE]** vem da observação de um chat de terceiros (Kloe, da Proa Tecnologia
> Criativa) e **não** é documentação oficial. Tudo o que está marcado **[DECISÃO PENDENTE]** precisa de resposta do dono.

---

## 0. Como usar este documento

1. Quem constrói o **Chat App** lê as seções 1 a 8 e executa as tarefas `CHAT-*` da seção 10, na ordem das fases.
2. Quem adapta o **CRM** executa as tarefas `CRM-*` da seção 11 (nesta árvore, em branch própria, com PR).
3. As duas pontas se encontram **só pelo contrato da seção 6**. Se uma ponta precisar mudar o contrato, muda esta seção
   primeiro e avisa a outra.
4. A seção 12 é um **prompt pronto** para abrir a outra conversa já com o contexto certo.

---

## 1. Objetivo e motivação

**Problema.** O atendimento por WhatsApp pela API oficial custa em média **US$ 50 a cada 3 dias** para a empresa.

**Ideia (a mesma que a Brisanet e outras empresas usam).**

1. O cliente pede suporte pelo WhatsApp.
2. Um **bot** (aplicação omni que a empresa já usa) responde, faz o onboarding inicial e pede o **CPF**.
3. O bot diz: "para continuar, clique no botão abaixo" e manda um **botão com link** no WhatsApp.
4. O cliente clica e abre um **chat na web, fora do WhatsApp** — sem custo de mensagem do WhatsApp.
5. Esse chat traz junto a **conversa inicial com o bot** (histórico).
6. Os **atendentes humanos recebem no CRM**, de preferência **na Fila por setor**, e puxam a conversa.

**O que este projeto entrega:** os itens 4 a 6 — a **página de chat** (Chat App) e a **entrada dela no CRM**.

**Fora de escopo agora (decidido pelo dono):**

- O botão/link dentro do WhatsApp — **já existe** na aplicação omni.
- Unir esta conversa ao contato do WhatsApp (mesclar pessoas) — "não vamos nos preocupar com isso ainda".
- Mostrar nome do cliente — hoje não aparece nome de ninguém; aceitável por ora.
- Centralizar o bot dentro do CRM — **depois**, como evolução (fase 5).

---

## 2. Visão geral da arquitetura

```
 Cliente                Aplicação OMNI + BOT              CHAT APP (novo)                 CRM (este repo)           Atendente
    │  WhatsApp             │                                  │                                │                       │
    │──── pede suporte ────►│                                  │                                │                       │
    │◄─── onboarding/CPF ───│                                  │                                │                       │
    │                       │── POST /api/v1/chats (API key) ─────►│                                │                       │
    │                       │◄──── { url, chat_id, expira } ───│                                │                       │
    │◄── botão com a URL ───│                                  │                                │                       │
    │                                                          │                                │                       │
    │── abre a URL ───────────────────────────────────────────►│ valida token, prende ao        │                       │
    │                                                          │ aparelho, mostra histórico     │                       │
    │                                                          │── chat.started (HMAC) ────────►│ cria contato (CPF),   │
    │                                                          │                                │ conversa na FILA do   │
    │                                                          │                                │ setor + importa       │── vê na Fila
    │── digita ───────────────────────────────────────────────►│── message (HMAC) ─────────────►│ histórico             │── puxa
    │◄── resposta via WebSocket ◄──────────────────────────────│◄── POST de saída (HMAC) ───────│◄── responde ──────────│
    │                                                          │◄── conversation.closed (HMAC) ─│◄── encerra ───────────│
```

**Duas aplicações, uma fronteira.** O Chat App cuida do que o **cliente** vê (página, tempo real, link, aparelho). O CRM
cuida do que o **atendente** vê (Fila, setor, histórico, auditoria, LGPD). A ponte é o **canal `web`**, que o CRM
**já tem** (seção 5) e que o Chat App implementa do outro lado.

**Por que o Chat App é separado.** Decisão do dono. Consequências boas: o CRM não vira servidor de tempo real público,
o Chat App escala e cai sozinho sem derrubar o atendimento, e a superfície pública fica fora do núcleo.
Consequência a pagar: **dois sistemas para manter** e um contrato entre eles (seção 6) que precisa de versão, teste e
idempotência.

---

## 3. O que já existe no CRM e o que falta

### 3.1 Já existe **[VERIFICADO NO CRM]**

| Peça | Onde | Observações |
|---|---|---|
| Canal `web` (provider) | `lib/channels/adapters/web.ts`, `lib/channels/web/ingest.ts`, `lib/channels/inbound.ts` | Entrada e saída por HMAC. Hoje **só texto**. |
| Migration do canal | `supabase/migrations/20260930233000_8804_canal_web.sql` | Coluna `channel_sessions.web_widget_id`; `conversations.channel` aceita `'web'`. |
| Webhook de entrada por token | `app/api/v1/webhooks/channel/[token]/route.ts` | `[token]` = `channel_sessions.webhook_path_token`. Público no proxy; quem autentica é a assinatura. |
| Fila | `lib/routing/queue.ts` | Fila = conversas **abertas e sem dono**. Atendente puxa ("Assumir"). Contador e alerta existentes. |
| Distribuição | `lib/routing/{decide,eligibles,worker}.ts` | Modos manual, rodízio, por carga. |
| Setores | `lib/atendimento/setores-modulo.ts`, tabelas `attendant_sectors`, `attendant_sector_members`, `conversations.sector_id` | **Módulo opcional, desligado por padrão.** Rota `PUT /api/v1/conversations/[id]/sector` é a **única porta de escrita** do setor. |
| CPF | `lib/contacts/cpf.ts` | Guardado **cifrado** (`cpf_encrypted` + `cpf_hash`, par obrigatório). O banco tem índices únicos parciais por CPF, telefone e e-mail, e o funil tem a configuração `identity_resolution` (ordem `cpf`, `phone_e164`, `email`). **Não verifiquei** se a entrada de mensagens já usa essa regra para achar contato: é o que CRM-2 precisa confirmar e implementar. |
| Handoff bot → humano | `lib/agent-engine/agent/human-handoff.ts`, `lib/mcp/tools/handoff.ts` | Já lê `sector_id`. |
| Alertas de mensagem nova | `hooks/notifications/useInboundMessageAlerts.ts` | Precisa ser conferido para o canal `web` (CRM-9). |

### 3.2 Contrato atual do canal `web` **[VERIFICADO NO CRM]**

**Chat → CRM** (mensagem do cliente):

```
POST {CRM}/api/v1/webhooks/channel/{webhook_path_token}
Content-Type: application/json
x-deskcomm-signature: sha256=<hex( HMAC_SHA256( corpo_cru_exato, INTERSUITE_HMAC_SECRET_OUT ) )>

{ "identity": "web:<uuid>",          // obrigatório; PRECISA começar com "web:"
  "text": "…",                       // obrigatório (string)
  "sent_at": "2026-11-13T14:00:00Z", // opcional (ISO-8601 UTC)
  "message_id": "msg_…",             // opcional, MAS é a chave de idempotência (unique org+external_id)
  "sender_name": "Maria" }           // opcional (também aceita "display_name")
```

Respostas: `200 { status: "ingested" | "duplicate" | "ignored", conversationId?, messageId?, reason? }`,
`401` assinatura inválida, `404` token desconhecido, `400 invalid_json`.

**CRM → Chat** (resposta do atendente):

```
POST {INTERSUITE_SUPPORT_URL}
Content-Type: application/json
x-deskcomm-signature: sha256=<hex( HMAC_SHA256( corpo_cru_exato, INTERSUITE_HMAC_SECRET_IN ) )>

{ "identity": "web:<uuid>",
  "conversation_id": "<uuid da conversa no CRM>",
  "message_id": "<uuid da mensagem no CRM>",
  "text": "…",
  "sent_at": "…",
  "author": { "kind": "agent" | …, "name": "Nome do atendente" | null } }
```

Resposta não-2xx ⇒ o CRM registra falha `web_send_failed_<status>`.

**Segredos (3 variáveis opcionais no `.env` do CRM):** `INTERSUITE_SUPPORT_URL`, `INTERSUITE_HMAC_SECRET_IN`,
`INTERSUITE_HMAC_SECRET_OUT`. Convenção de nome: *IN* = o que o chat **recebe**; *OUT* = o que o chat **envia**.
O segredo precisa de **≥ 16 caracteres** para o CRM aceitar a entrada.

**Vetor de teste da assinatura** (para o Chat App validar a própria implementação):

```
segredo = segredo-de-teste-0123456789abcdef
corpo   = {"identity":"web:0b6f3f9e-1c7a-4c1e-9a55-2d5a1e7c9f10","text":"Olá, preciso de ajuda com a minha internet","sent_at":"2026-11-13T14:00:00.000Z","message_id":"msg_01HXYZ","sender_name":"Maria"}
header  = x-deskcomm-signature: sha256=9c033217cb7174bb42f4f94cb87cb28c4805ee69bda0a82aef27e9f614426565
```

> A assinatura é sobre o **corpo cru em bytes**. Qualquer reserialização do JSON invalida. UTF-8, sem espaços extras.

### 3.3 Limites do contrato atual (o que falta) **[VERIFICADO NO CRM]**

1. **Só texto.** Sem anexo, imagem, localização.
2. **Sem setor.** A conversa nasce sem `sector_id`.
3. **Sem dados do contato.** Não recebe CPF; o contato nasce só com `social_identity = web:<uuid>`, sem CPF e sem nome real.
4. **Sem histórico.** Não importa a conversa que o cliente teve com o bot.
5. **Sem evento de abertura** nem de **encerramento** (o chat não sabe que o atendente fechou).
6. **Segredos globais por variável de ambiente:** só **um** canal web por instalação, e o segredo não é por canal.
7. **Canal criado "na mão":** não há tela nem API para criar a linha de `channel_sessions` com `web_widget_id`.
8. **Resolução de contato por CPF não é usada** na entrada web (hoje só por `social_identity`).
9. **Um atendente pertence a um setor só** (PK `(organization_id, user_id)` em `attendant_sector_members`). Se um
   atendente precisar de dois setores, é uma mudança de schema separada.

A seção 11 (`CRM-*`) cobre cada um desses pontos.

---

## 4. O que o Kloe nos ensinou **[INFERIDO DO KLOE]**

Observado em um link de chat de teste do Brisanet, **sem** consumir conversa nem tocar na API deles:

- **URL:** `https://<host>/<chave-do-widget-40-chars>/<id-da-conversa-32-hex>?sessionNumber=<mesmo id>&continue=<JWT>`.
- **`continue` = JWT HS256** com `purpose: "widget_continue"`, `clientId`, `conversationId`, `iat`, `exp` e **validade de 15 h**.
- **Preso ao primeiro aparelho.** Quem abre primeiro vira "dono" do link (identificador no `localStorage`:
  `kloe_wc_browser_id` e uma chave por conversa). Em outro navegador aparece: *"Este link de continuidade já foi aberto em
  outro navegador ou aparelho. Para seguir o atendimento, use o mesmo dispositivo em que você clicou no botão do WhatsApp."*
- **Arquitetura:** página (SPA) em um host + **API REST** `/v1` em outro host + **WebSocket** para tempo real.
- **Recursos:** "digitando", envio de documento/imagem, compartilhamento de localização, aviso de fechamento da página
  (`sendBeacon`).

**O que adotamos e o que mudamos:**

| Kloe | Nós |
|---|---|
| JWT stateless de 15 h | **Token opaco** (256 bits), guardado só como **hash** no Chat App ⇒ revogável, com validade configurável. |
| Preso ao aparelho via `localStorage` | Preso ao aparelho por **cookie `HttpOnly`** + **rota de saída** quando o cliente cai num navegador diferente (seção 7.4). |
| Chave de widget na URL | Não precisamos: o Chat App atende **uma organização**; a configuração do "canal" vive no CRM. |

---

## 5. Decisões de arquitetura (já tomadas)

1. **Chat App é uma aplicação separada**, com repositório, deploy e banco próprios.
2. **A integração com o CRM usa o canal `web` que já existe**, estendido (contrato v2, seção 6). **Não** se cria provider
   novo no CRM: o sistema de canais tem muitas travas (matriz de capacidades, `lint:channels`, constraints de provider),
   e o canal `web` já passou por elas.
3. **A conversa só nasce no CRM quando o cliente abre o link** (evento `chat.started`), e não quando o bot cria o chat.
   Evita fila cheia de fantasmas (clientes que nunca clicaram). O bot vê o estado `created` na API do Chat App.
4. **Token opaco + hash**, não JWT.
5. **O Chat App não guarda CPF, nem em claro nem derivado.** Recebe do bot, repassa ao CRM no `chat.started` (que cifra) e
   descarta. A troca de aparelho **não** usa CPF (decisão P4): só novo link pelo WhatsApp.
6. **Tempo real inicial = WebSocket com fallback de long-poll.** (O Kloe usa WebSocket.)
7. **Cada chat é único:** 1 link ⇔ 1 `chat_id` ⇔ 1 `identity` (`web:<uuid>`) ⇔ 1 conversa no CRM. Reabrir o mesmo link no
   **mesmo aparelho** continua a mesma conversa.

---

## 6. Contrato v2 entre Chat App e CRM

> **Versionamento:** `x-chat-contract: 2` em toda chamada. O CRM aceita v1 (hoje) e v2. O Chat App envia v2.
> **Idempotência:** toda mensagem e todo evento têm um id estável; o receptor **nunca** duplica. O emissor
> **reenvia com backoff** até receber 2xx (outbox).
> **Assinatura:** igual à atual — `x-deskcomm-signature: sha256=<hex HMAC-SHA256(corpo_cru, segredo)>`, segredo **por
> canal** (CRM-3), mínimo 32 caracteres.

### 6.1 Chat → CRM (todos no mesmo endpoint de entrada por token)

Campo novo `event` (default `"message"` ⇒ compatível com v1).

**`chat.started`** — o cliente abriu o link pela primeira vez.

```json
{
  "event": "chat.started",
  "identity": "web:0b6f3f9e-1c7a-4c1e-9a55-2d5a1e7c9f10",
  "started_at": "2026-11-13T14:00:00.000Z",
  "sector": "suporte-tecnico",
  "contact": { "name": "Maria", "cpf": "12345678909", "phone": "5588999999999" },
  "history": [
    { "message_id": "bot_001", "from": "customer", "text": "Preciso de suporte", "sent_at": "2026-11-13T13:58:01.000Z" },
    { "message_id": "bot_002", "from": "bot",      "text": "Olá! Qual o seu CPF?", "sent_at": "2026-11-13T13:58:03.000Z" }
  ],
  "metadata": { "origin": "whatsapp", "bot_session_id": "…" }
}
```

- `contact.cpf`, `contact.phone`, `contact.name` e `metadata` são **opcionais**; `sector` e `history` também. O que faltar
  o CRM trata como hoje.
- `history[].from`: `customer` | `bot`. O CRM grava como mensagens **marcadas como importadas** (não geram alerta, não
  acionam agente e não contam como "espera" do cliente).
- `history[].message_id` ⇒ idempotência (reenviar `chat.started` **não** duplica o histórico).
- **Resposta:** `200 { status: "ingested", conversationId, queue: { sector_id, position? } }`.

**`message`** — mensagem do cliente (igual à v1, mais anexos).

```json
{
  "event": "message",
  "identity": "web:0b6f3f9e-…",
  "message_id": "msg_01HXYZ",
  "text": "Minha internet caiu",
  "sent_at": "2026-11-13T14:01:10.000Z",
  "attachments": [
    { "kind": "image", "url": "https://chat…/files/abc?sig=…", "mime": "image/jpeg", "size": 183422, "name": "foto.jpg" }
  ]
}
```

- `attachments` entra na **fase 2** (CRM-8). Até lá o CRM ignora o campo e mostra só o texto.
- `url` de anexo é **assinada e com validade**; o CRM **baixa e guarda no Storage dele** (não depende do link do chat).

**`chat.closed_by_customer`** — o cliente encerrou (botão "encerrar" na página). CRM fecha/atualiza o status da conversa
conforme regra do canal.

**`chat.typing`** (fase 2) — opcional, **sem** idempotência nem persistência; descartável.

### 6.2 CRM → Chat

Mesmo endpoint configurado por canal (`INTERSUITE_SUPPORT_URL` hoje; **por canal** em CRM-3). Campo `event`:

**`message`** (igual ao atual):

```json
{
  "event": "message",
  "identity": "web:0b6f3f9e-…",
  "conversation_id": "<uuid CRM>",
  "message_id": "<uuid CRM>",
  "text": "Olá Maria, já vou verificar.",
  "sent_at": "2026-11-13T14:02:00.000Z",
  "author": { "kind": "agent", "name": "João" },
  "attachments": []
}
```

**`conversation.assigned`** (fase 2) — um atendente assumiu ⇒ o Chat mostra "João entrou na conversa".

**`conversation.closed`** — o atendente encerrou ⇒ o Chat mostra "Atendimento encerrado", bloqueia o campo de texto e
(opcional) oferece avaliação.

```json
{ "event": "conversation.closed", "identity": "web:…", "conversation_id": "…", "closed_at": "…", "reason": "resolved" }
```

**`typing`** (fase 2).

**Respostas do Chat ao CRM:** `2xx` = recebido; qualquer outra coisa ⇒ o CRM trata como falha e **reenvia** (política em
CRM-4). O Chat precisa deduplicar por `message_id`.

### 6.3 Aplicação OMNI/bot → Chat App (server-to-server)

Autenticação: `Authorization: Bearer <api_key>` (a chave é mostrada **uma vez** e o Chat App guarda só o hash). Todas as
criações aceitam `Idempotency-Key`.

**`POST /api/v1/chats`** — o bot cria o chat e recebe o link.

```json
{
  "sector": "suporte-tecnico",
  "contact": { "name": "Maria", "cpf": "12345678909", "phone": "5588999999999" },
  "history": [ { "message_id": "bot_001", "from": "customer", "text": "Preciso de suporte", "sent_at": "…" } ],
  "metadata": { "origin": "whatsapp", "bot_session_id": "…" },
  "ttl_minutes": 900
}
```

```json
{ "chat_id": "…", "url": "https://chat.exemplo.com.br/c/Vt3…(43 chars)", "status": "created", "expires_at": "…" }
```

**`GET /api/v1/chats/{id}`** — estado: `created | open | closed | expired`, `opened_at`, `closed_at`.

**`POST /api/v1/chats/{id}/reissue`** — gera **novo link** (invalida o anterior). Usado quando o cliente perdeu o acesso (outro
aparelho, cookie apagado).

**Webhooks do Chat para o bot** (opcional, fase 2): `chat.opened`, `chat.closed`, para o bot saber o que aconteceu.

---

## 7. Especificação do Chat App

### 7.1 Responsabilidades

- Receber pedidos de criação de chat da aplicação omni (6.3) e devolver o link.
- Servir a **página de chat** pública, validar o token, **prender ao aparelho**, mostrar o histórico, enviar e receber
  mensagens em tempo real.
- **Sincronizar com o CRM** (6.1 e 6.2) com garantia de entrega (outbox + reenvio + idempotência).
- Aplicar **expiração**, **limites** (taxa, tamanho) e **proteções** da superfície pública.

### 7.2 Modelo de dados (proposta — o implementador pode ajustar com justificativa)

```
chats            id uuid pk · identity text unique ("web:<uuid>") · token_hash bytea unique · status (created|open|closed|expired)
                 sector_code text · contact_name text null · phone text null
                 history jsonb · metadata jsonb · created_at · expires_at · opened_at · last_activity_at · closed_at · closed_by
chat_devices     chat_id fk · device_id_hash bytea · first_seen_at · user_agent_hash · ip_prefix  (no máximo 1 ativo por chat)
chat_messages    id uuid pk · chat_id fk · direction (in|out) · author_kind (customer|bot|agent|system) · author_name
                 text · attachments jsonb · external_id text (idempotência) · created_at · delivered_to_crm_at null
outbox           id pk · chat_id · event text · payload jsonb · attempts int · next_attempt_at · done_at null
api_keys         id · name · key_hash · created_at · revoked_at
```

- **Sem CPF.** O CPF chega em `POST /api/v1/chats`, vai no `chat.started` e **não é persistido** (ver decisão 5).
- **Retenção (decisão P6): apagar ao encerrar.** Quando o chat é encerrado (pelo CRM ou pelo cliente), o Chat App apaga
  `chat_messages` e o `history` **somente depois que a `outbox` desse chat estiver vazia** (tudo entregue ao CRM e
  confirmado) — **nunca antes**, senão perde-se atendimento que o CRM ainda não recebeu. Fica só a linha mínima do `chats`
  (id, status, datas, setor) para o bot consultar `GET /api/v1/chats/{id}` e para auditoria. Um job a cada poucos minutos faz a
  limpeza e a retenta se a entrega ainda estiver pendente. O CRM é a fonte de verdade do atendimento.
- **Consequência visível ao cliente:** reabrir o link depois do encerramento mostra só "Atendimento encerrado", **sem**
  histórico.

### 7.3 Link e token

- Formato: `https://<dominio>/c/<token>`; `<token>` = 32 bytes aleatórios (CSPRNG) em base64url (43 caracteres).
- Guardar **apenas SHA-256 do token**. Comparação em tempo constante.
- **Validade:** `ttl_minutes` (padrão **900** = 15 h, como o Kloe) **enquanto não aberto**; depois de aberto, expira por
  **12 h sem nenhuma mensagem** (decisão P7) e fecha quando o CRM manda `conversation.closed`.
- `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, e **redigir o token** em todo log de acesso.

### 7.4 Preso ao aparelho (e como não deixar o cliente trancado do lado de fora)

1. Primeira abertura válida ⇒ gerar `device_id` aleatório ⇒ cookie `chat_dev` (`HttpOnly; Secure; SameSite=Lax;
   Path=/c; Max-Age` = validade da conversa) ⇒ gravar hash em `chat_devices`.
2. Aberturas seguintes: cookie confere ⇒ entra. Cookie ausente ou diferente ⇒ tela de **"Este link já foi aberto em outro
   aparelho"** (texto parecido com o do Kloe) com **um único caminho** (decisão P4):
   - **Receber um novo link pelo WhatsApp**: o Chat pede à aplicação omni, que reenvia o botão (via `POST /api/v1/chats/{id}/reissue`
     e a chamada de volta ao bot). **Não há confirmação por CPF** e o Chat App não guarda CPF.
   - O pedido de novo link tem **limite** (ex.: 3 por chat por hora) para ninguém usar a tela para disparar mensagens no WhatsApp
     de outra pessoa.
3. **Risco conhecido:** em alguns celulares o WhatsApp abre o link num **navegador interno** e o cliente depois "abre no
   navegador". Os cookies **não são compartilhados** entre os dois ⇒ bloqueio. Como a única saída é o novo link pelo
   WhatsApp, **este caminho depende de a aplicação omni conseguir reenviar o botão (decisão P10)**. Medir a taxa de
   "aberto em outro aparelho" na fase 1.

### 7.5 Tempo real

- **WebSocket** em `/ws` autenticado pelo cookie `chat_dev`. Mensagem de abertura traz `last_message_id` para retomar sem
  perda. Heartbeat a cada 25 s; reconexão com backoff.
- **Fallback:** long-poll `GET /c/<token>/messages?after=<id>` se o WebSocket falhar (redes corporativas).
- Eventos: `message`, `typing`, `assigned`, `closed`, `error`.

### 7.5.1 Entrega ao CRM (outbox)

Toda mensagem do cliente e todo evento ⇒ linha na `outbox` **na mesma transação** que grava a mensagem. Um worker envia
ao CRM com **backoff exponencial** (ex.: 1 s, 5 s, 30 s, 2 min, 10 min, 1 h; teto 24 h) e marca `done_at` no 2xx. `409/200
duplicate` conta como entregue. Falha permanente (`401/404`) ⇒ alerta operacional (segredo trocado ou canal removido).

### 7.6 Interface da página (mobile primeiro)

- Cabeçalho com **logo e nome da empresa** (configuráveis por variável/arquivo, uma organização).
- **Histórico do bot** no topo, em bloco separado e rotulado ("Conversa com o assistente virtual"), somente leitura.
- Lista de mensagens: cliente à direita, atendente/bot à esquerda, hora, estado (enviando/enviada/falhou — com "tentar de
  novo"). Indicador de **"atendente digitando"** e de **"João entrou na conversa"**.
- Campo de texto com limite (ex.: 4.000 caracteres), `Enter` envia, `Shift+Enter` quebra linha.
- Estados: **aguardando atendente** (enquanto ninguém assumiu — mostrar posição só se o CRM informar), **em atendimento**,
  **encerrado** (campo bloqueado + avaliação opcional), **expirado**, **aberto em outro aparelho**, **sem conexão**.
- **Acessibilidade:** rótulos, foco visível, contraste AA, `aria-live` para novas mensagens.
- **LGPD:** aviso curto no primeiro acesso ("este atendimento será registrado…") com link para a política.
- Fase 2: envio de **imagem/documento**; Fase 3: **localização** (como o Kloe).

### 7.7 Segurança e abuso

- HTTPS obrigatório; CSP restritiva; sem `eval`; texto sempre **escapado** (nunca `innerHTML` com conteúdo do usuário).
- **Limites de taxa:** por IP e por chat (ex.: 20 mensagens/min); tamanho de mensagem; tamanho e tipo de anexo (lista
  permitida de MIME, limite por arquivo e por chat); verificação de assinatura **antes** de ler o corpo grande.
- **CORS fechado** na API do chat; a API do bot (`/v1/*`) só aceita a chave de API.
- Token **nunca** em query string de chamadas de API (já está no caminho do link; nas chamadas internas usar cookie).
- Logs sem CPF, sem token, sem texto de mensagem em nível `info`.
- Segredos HMAC e chaves de API fora do repositório; rotação documentada.

### 7.8 Observabilidade e operação

- Logs estruturados com `chat_id` e `request_id`; métricas: chats criados/abertos/encerrados, latência de entrega ao CRM,
  **tamanho da outbox**, falhas por tipo, conexões WebSocket ativas, **taxa de "aberto em outro aparelho"**.
- `GET /health` e `GET /ready` (checa banco). Alerta se a outbox ficar > N eventos por > M minutos.
- Backup do banco do Chat; plano de restauração testado.

### 7.9 Stack proposta (ajustável)

- **TypeScript / Node 22.** Servidor HTTP + WebSocket (Fastify + `ws`, ou equivalente). Banco **Postgres**. Redis **opcional**
  (limite de taxa e fan-out entre instâncias quando houver mais de uma).
- Front **leve** (React + Vite, ou HTML/JS puro) — o chat precisa abrir rápido em rede ruim.
- **Docker** (uma imagem), publicada por CI; deploy atrás do proxy já usado pela empresa (Forge/Traefik/Caddy).
  Domínio simples (**P3**), ex.: `chat.suaempresa.com.br`.

---

## 8. Mudanças necessárias no CRM (visão geral — detalhe em `CRM-*`)

1. Aceitar `event` e os novos campos no webhook de entrada do canal `web` (retrocompatível com v1).
2. Resolver/criar o **contato por CPF** (com a cifra e o par `cpf_hash`/`cpf_encrypted`), caindo para `social_identity`.
3. Criar a conversa **aberta, sem dono**, com **`sector_id`** resolvido por **código externo** do setor, passando pela
   **mesma função** que a rota `PUT /conversations/[id]/sector` usa (ela é a "única porta de escrita").
4. Importar o **histórico** como mensagens marcadas (sem alerta, sem agente, sem contar espera).
5. **Segredo e URL de saída por canal**, cifrados em `channel_sessions`, no lugar das variáveis globais.
6. Enviar `conversation.closed` ao Chat quando a conversa for encerrada no CRM; política de reenvio.
7. **Tela e API para criar/pausar o canal web** (hoje é SQL manual).
8. Selo/ícone do canal web no Inbox; garantir que **alertas** e o **filtro por setor** da Fila funcionem para ele.
9. Anexos (fase 2) e LGPD: apagar/anonimizar também no Chat (webhook de exclusão).

---

## 9. Roadmap

> Tamanhos: **P** ≈ meio dia · **M** ≈ 1–2 dias · **G** ≈ 3–5 dias. São estimativas de ordem de grandeza.

### Fase 0 — Decisões e contrato (pré-requisito)

Fechar as decisões que ainda estão ⏳ na seção 13 — **P10** (o bot consegue reenviar o botão?), **P2** (formato do histórico)
e **P1** (setor; pode ficar para depois do MVP técnico) — e congelar o contrato 6. Gerar o par de segredos e a chave de API.
**Saída:** P10 e P2 respondidas; contrato v2 aprovado.

### Fase 1 — MVP (o cliente conversa, o atendente responde na Fila do setor)

- **Chat App:** CHAT-1 a CHAT-9.
- **CRM:** CRM-1 a CRM-7.
- **Teste ponta a ponta** com o bot de verdade e um setor real.
- **Critério de saída:** 1 atendente real atende 1 cliente real por esse caminho, da abertura ao encerramento, com o
  histórico do bot visível, **sem WhatsApp** na parte humana.

### Fase 2 — Tempo real completo e anexos

- WebSocket completo (se a fase 1 usou long-poll), digitando, "atendente entrou", **anexos** (CHAT-12, CRM-8), avaliação ao
  fim, `chat.opened/closed` para o bot.

### Fase 3 — Endurecimento

- Teste de carga, observabilidade, alertas, backup/restore, LGPD cruzada (CRM-10), revisão de segurança, rotação de segredos.
- **Localização** do cliente (opcional).

### Fase 4 — Piloto

- Subir para uma parcela do tráfego (ex.: 10%), medir **custo evitado**, taxa de conclusão, taxa de "aberto em outro
  aparelho", tempo até o primeiro atendimento. Comparar com a conta da API oficial.

### Fase 5 — Centralização (futuro)

- Avaliar trazer o **bot** e a geração do link para dentro do CRM, e/ou levar o chat para dentro do mesmo deploy.
  **Não** iniciar sem os números da fase 4.

---

## 10. Tarefas do **Chat App** (para a outra conversa)

> Cada tarefa traz **Objetivo**, **Entregáveis** e **Aceite**. Convenção: testes automatizados em todas; nenhum segredo no
> repositório; commits pequenos; PR por tarefa ou por grupo coeso.

### CHAT-1 · Esqueleto do projeto e CI (P)
- **Objetivo:** repositório novo `intercert-chat` com TS estrito, lint, formatação, testes, Dockerfile e CI.
- **Entregáveis:** estrutura de pastas; `Dockerfile` (multi-stage); CI (typecheck, lint, testes, build da imagem); `.env.example`
  completo (`DATABASE_URL`, `CRM_ENTRY_URL`, `CRM_HMAC_SECRET_TO_CRM`, `CRM_HMAC_SECRET_FROM_CRM`, `PUBLIC_BASE_URL`,
  `API_KEY_PEPPER`, `BRAND_NAME`, `BRAND_LOGO_URL`, …); `README` com como rodar.
- **Aceite:** `docker build` ok; CI verde; app sobe e responde `GET /health`.

### CHAT-2 · Banco e migrations (M)
- **Objetivo:** modelo da 7.2 com migrations versionadas.
- **Aceite:** migrations aplicam do zero e em banco existente; índices únicos em `token_hash`, `identity`,
  `(chat_id, external_id)`; testes de integração.

### CHAT-3 · API do bot: `POST /api/v1/chats`, `GET /api/v1/chats/{id}`, `POST /api/v1/chats/{id}/reissue` (M)
- **Objetivo:** 6.3 completo com chave de API, `Idempotency-Key` e validação (Zod ou equivalente).
- **Entregáveis:** geração/rotação de chave (script `npm run apikey:create`, mostra a chave **uma vez**, guarda hash);
  token de 32 bytes (CSPRNG) com hash SHA-256; resposta com `url`.
- **Aceite:** mesma `Idempotency-Key` ⇒ mesmo link; `reissue` invalida o link anterior; chave inválida ⇒ 401; testes cobrem
  validação do CPF (formato) e do `sector`.

### CHAT-4 · Página de chat: validação do token e preso ao aparelho (M)
- **Objetivo:** `GET /c/<token>` valida, prende ao aparelho (7.4), mostra estados (válido, expirado, encerrado, outro aparelho).
- **Aceite:** primeiro aparelho entra; segundo vê a tela de "outro aparelho" com o botão **"Receber novo link pelo WhatsApp"**
  (único caminho, decisão P4; limitado a 3 pedidos por chat por hora); token inválido e
  expirado têm telas próprias; cookie `HttpOnly; Secure; SameSite=Lax`; **nenhum** log contém o token.

### CHAT-5 · Mensagens: gravar, listar, enviar (M)
- **Objetivo:** envio de texto pelo cliente, listagem com histórico do bot rotulado, estados da mensagem.
- **Aceite:** mensagem duplicada (mesmo `external_id`) não duplica; limite de tamanho; texto sempre escapado; teste de XSS.

### CHAT-6 · Outbox e entrega ao CRM (G)
- **Objetivo:** 6.1 e 7.5.1 — `chat.started` na primeira abertura e `message` a cada mensagem; assinatura HMAC exata; reenvio
  com backoff.
- **Aceite:** com o CRM fora do ar, o cliente continua conversando e tudo é entregue **na ordem** quando volta; vetor de
  teste da seção 3.2 passa; duplicata recebida pelo CRM (`status: "duplicate"`) conta como entregue; alerta se a outbox
  passar do limite.

### CHAT-7 · Recepção de eventos do CRM (M)
- **Objetivo:** endpoint que o CRM chama (6.2): `message`, `conversation.closed` (e `assigned`/`typing` na fase 2),
  verificação HMAC com tolerância a relógio (se houver `timestamp`) e deduplicação por `message_id`.
- **Aceite:** assinatura inválida ⇒ 401 sem processar; `message` aparece na página do cliente; `closed` bloqueia o campo;
  reenvio do mesmo `message_id` não duplica.

### CHAT-8 · Tempo real: WebSocket + fallback (G)
- **Objetivo:** 7.5. `ws` autenticado por cookie, retomada por `last_message_id`, heartbeat, fallback long-poll.
- **Aceite:** derrubar a conexão e voltar não perde nem duplica mensagem; funciona com WebSocket bloqueado (long-poll);
  teste com 200 conexões simultâneas.

### CHAT-9 · Interface da página (G)
- **Objetivo:** 7.6, mobile primeiro, acessível, marca configurável.
- **Aceite:** Lighthouse/axe sem falhas graves; usável em tela de 320 px; todos os estados da 7.6 têm tela; teste e2e
  (Playwright) cobrindo criar chat → abrir → conversar → encerrar.

### CHAT-10 · Limites, segurança e CSP (M)
- **Objetivo:** 7.7.
- **Aceite:** teste de taxa (21ª mensagem em 1 min é recusada); CSP sem `unsafe-eval`; cabeçalhos `no-referrer`/`noindex`;
  varredura de dependências no CI.

### CHAT-11 · Observabilidade e operação (M)
- **Objetivo:** 7.8.
- **Aceite:** métricas expostas; `health`/`ready`; runbook `OPERACAO.md` com troca de segredo, reprocessar outbox, backup.

### CHAT-12 · Anexos — fase 2 (G)
- **Objetivo:** envio de imagem/documento do cliente e do atendente; URL assinada com validade; antivírus opcional.
- **Aceite:** só MIME permitido; limite de tamanho; o CRM consegue **baixar** pela URL assinada dentro da validade.

### CHAT-13 · Avaliação e eventos para o bot — fase 2 (M)
- **Objetivo:** nota ao encerrar; webhooks `chat.opened`/`chat.closed` para o bot.

### CHAT-14 · Endurecimento — fase 3 (M)
- **Objetivo:** teste de carga, rotação de segredos sem downtime, exclusão por pedido LGPD e **limpeza "apagar ao encerrar"
  (P6)** — a limpeza **só roda** quando a `outbox` do chat está vazia; teste: encerrar com a outbox pendente **não** apaga.

### CHAT-15 · Contrato e testes de integração com o CRM (M, transversal)
- **Objetivo:** suíte que sobe o Chat App contra um **CRM falso** que implementa 6.1/6.2 e verifica assinaturas.
- **Aceite:** roda no CI; falha se o contrato mudar sem atualização da seção 6.

---

## 11. Tarefas do **CRM** (esta árvore) — `CRM-*`

> Seguir a doutrina do repositório (`CLAUDE.md`): `organization_id` de fonte confiável (aqui, o **canal**, nunca o corpo),
> RLS, idempotência (`unique (organization_id, external_id)` + captura `23505`), audit log, migration versionada **+ apêndice
> idempotente no `baseline.sql`**, `-- manifest:` no cabeçalho, função nova em `public` com `revoke` das **duas** origens
> de `EXECUTE`, testes (unit + `pnpm test:db` para schema), prova pela tela em ambiente fresco, destino declarado
> (**canal / núcleo**).

### CRM-1 · Entrada v2 no canal `web` (M)
- **Objetivo:** aceitar `event`, `contact`, `sector`, `history`, `metadata` (6.1) sem quebrar a v1.
- **Mexe em:** `lib/channels/web/ingest.ts` (`parseWebPayload` → união discriminada por `event`), `lib/channels/inbound.ts`.
- **Aceite:** v1 continua passando nos testes atuais; `chat.started` idempotente; payload inválido ⇒ `invalid_json`/`contrato_violado`
  como hoje; vetor de teste da 3.2 verificado por teste.

### CRM-2 · Contato por CPF (M)
- **Objetivo:** no `chat.started`, resolver o contato por **CPF** (regra `identity_resolution`), depois telefone, depois
  `social_identity`; se criar, gravar CPF com `camposCpfParaGravar` (par `cpf_hash`/`cpf_encrypted`).
- **Atenção:** `CPF_ENCRYPTION_KEY` precisa estar semeada na instalação; sem ela o CRM salva o contato **sem** o CPF
  (comportamento atual de `encryptCpfSql`) e **deve registrar aviso**, não falhar a entrada.
- **Aceite:** mesmo CPF em dois chats ⇒ **um** contato (sem mesclar com WhatsApp — fora de escopo); teste de isolamento
  entre organizações; nunca devolver CPF em claro em resposta de API.

### CRM-3 · Canal web como cadastro: segredos e URL **por canal** + tela (G)
- **Objetivo:** criar/pausar canal web em **Conexões** (ou Configurações); guardar `url de saída` e os dois segredos
  **cifrados** em `channel_sessions`; gerar o `webhook_path_token`; mostrar o endereço de entrada para copiar; segredo
  exibido **uma vez**.
- **Mexe em:** migration + apêndice no baseline; `lib/channels/adapters/web.ts` (ler da sessão e não do `process.env`);
  `lib/channels/inbound.ts` (`acceptsInboundWebhook` e `verifyInboundWebhookSignature` para `web`); tela e API v1 com audit.
- **Compat:** manter as 3 variáveis de ambiente como **fallback** até remover (nota de migração).
- **Aceite:** dois canais web convivem; segredo errado ⇒ 401; `isConfigured` e `checkHealth` refletem o canal; QA visual
  da tela em ambiente fresco.

### CRM-4 · Saída para o Chat com reenvio (M)
- **Objetivo:** o `send` do adapter com política de tentativa (o que o worker de saída já faz para outros canais;
  conferir `recover-stuck-messages` e a cadeia de envio) e `event: "message"` com `x-chat-contract: 2`.
- **Aceite:** Chat fora do ar ⇒ mensagem fica `failed` com motivo claro na Central, **não** é reenviada em dobro
  (doutrina: "envio em dobro é pior que não-envio"); Chat de volta ⇒ nova tentativa manual funciona.

### CRM-5 · Setor por código externo + criação da conversa na Fila certa (G)
- **Objetivo:** `attendant_sectors.external_code` (único por organização, opcional); na criação, gravar `conversations.sector_id`
  **pela mesma função** da rota `PUT /conversations/[id]/sector` (extrair para `lib/atendimento/` e reusar — **não** duplicar a
  regra da "única porta de escrita").
- **Atenção:** módulo `setores` precisa estar **ligado** na instalação; desligado ⇒ conversa entra **sem** setor e há aviso
  (não rejeitar a entrada).
- **Aceite:** código desconhecido ⇒ conversa na Fila **sem setor** + aviso na Central (não perde o cliente); atendente fora
  do setor **não** vê/puxa pela regra de fila do setor; teste de invariante de isolamento.

### CRM-6 · Histórico importado (M)
- **Objetivo:** gravar `history[]` como mensagens **marcadas** (`metadata.importado_do_bot = true`), em ordem, com
  `external_id = history[].message_id`, **sem** alerta, **sem** acionar agente/automação, **sem** contar como espera.
- **Mexe em:** `lib/channels/web/ingest.ts`; checar `aplicarEfeitosPosEntrada` para **não** chamar efeitos nas importadas;
  checar `awaiting_since` (régua da fila, issue #990).
- **Aceite:** reenviar `chat.started` não duplica; o atendente vê o histórico num bloco distinto; a espera da fila conta
  a partir da **primeira mensagem do cliente no chat**, não da do bot.

### CRM-7 · Encerramento: `conversation.closed` para o Chat (M)
- **Objetivo:** quando a conversa do canal web é encerrada no CRM, enviar o evento (com reenvio) e tratar
  `chat.closed_by_customer` vindo do Chat.
- **Aceite:** fechar no CRM ⇒ o Chat bloqueia o campo; fechar no Chat ⇒ o CRM reflete; teste das duas direções.

### CRM-8 · Anexos — fase 2 (G)
- **Objetivo:** baixar o anexo pela URL assinada, guardar no Storage (bucket privado `whatsapp-media` ou o de anexos do
  canal, conferir), exibir no Inbox; enviar anexo do atendente ao Chat com URL assinada.
- **Aceite:** limites de tamanho/MIME; URL vencida ⇒ aviso, sem travar a conversa.

### CRM-9 · Inbox: selo do canal, alertas e Fila por setor (M)
- **Objetivo:** ícone/selo do canal **Web** na lista e no cabeçalho da conversa; confirmar que `useInboundMessageAlerts`
  dispara para o canal web e respeita o setor do atendente; contador da Fila correto.
- **Aceite:** prova pela tela (como um leigo): cliente abre o chat ⇒ aparece na Fila do setor ⇒ atendente é avisado ⇒
  puxa ⇒ responde ⇒ cliente vê.

### CRM-10 · LGPD cruzada (M)
- **Objetivo:** o cascade de redact do CRM (`lgpd.redact_executed`) também avisa o Chat para apagar a transcrição
  (webhook `chat.erase` assinado); registrar em audit.
- **Aceite:** anonimizar o contato ⇒ Chat apaga transcrição e confirma; falha de entrega fica visível e reprocessável.

### CRM-11 · Documentação e QA (P)
- **Objetivo:** `docs/` com o contrato v2, runbook do canal web, e linha em `docs/testing/user-journey-map.md`
  (jornada **P0**: cliente abre o chat ⇒ atendente responde). Fragmento em `.changes/` se for o caso.

---

## 12. Prompt de abertura para a outra conversa (copiar e colar)

```
Você vai construir o "Chat App": uma aplicação web NOVA e SEPARADA de chat de atendimento, que se integra a um CRM
(DeskcommCRM) por webhooks assinados. Leia o arquivo PLANO-CHAT-WEB.md inteiro antes de escrever qualquer código.

Contexto em uma frase: o cliente pede suporte no WhatsApp, um bot (outra aplicação) faz o onboarding e manda um botão com
um link; o link abre ESTE chat na web (fora do WhatsApp, sem custo), com o histórico do bot; os atendentes humanos
recebem a conversa no CRM, na Fila do setor, e respondem.

Seu escopo: seções 6 (contrato), 7 (especificação) e 10 (tarefas CHAT-*). NÃO mexa no CRM; ele é de outra conversa
(tarefas CRM-*). Se precisar mudar o contrato, pare, proponha a mudança na seção 6 e peça confirmação.

Regras de trabalho:
1. Comece pela Fase 0: liste as DECISÕES PENDENTES (seção 13) que ainda estão sem resposta e peça-as. Use o padrão
   recomendado se o dono disser "siga o recomendado".
2. Execute as tarefas na ordem CHAT-1 → CHAT-9 (Fase 1). Uma tarefa por vez, com testes, e mostre a prova do aceite
   antes de passar para a próxima.
3. A assinatura HMAC é sobre o CORPO CRU em bytes. Valide a sua implementação com o vetor de teste da seção 3.2.
4. Segurança por padrão: token opaco com hash, sem CPF em claro, sem token em log, texto sempre escapado, limites de taxa.
5. Nunca invente o comportamento do CRM: o que não está no contrato da seção 6 você pergunta.
6. Ao final de cada tarefa, atualize um CHANGELOG curto e liste o que ficou sem testar.
```

---

## 13. Decisões pendentes (responder antes da Fase 1)

> **Estado em 13/11/2026.** ✅ = decidido pelo dono · ⏳ = em aberto (bloqueia o quê está na coluna "Bloqueia").

| # | Pergunta | Estado | Decisão / recomendação | Bloqueia |
|---|---|---|---|---|
| **P1** | Como o bot identifica o **setor**? | ⏳ **dono: "ainda não sei"** | Recomendado: **código curto** (`suporte-tecnico`, `financeiro`) cadastrado em cada setor do CRM (CRM-5). **Enquanto não decidir:** o campo `sector` é opcional no contrato; a conversa entra na Fila **sem setor** e qualquer atendente do módulo vê. | CRM-5 e a Fila por setor (não o MVP técnico). |
| **P2** | Formato do **histórico** que a aplicação omni guarda? | ⏳ **não perguntado ainda** | Proposta: lista `{ message_id, from: customer\|bot, text, sent_at }`. Se o bot guarda outro formato, ele converte antes de chamar `POST /api/v1/chats`. **Preciso de um exemplo real** (um JSON de uma conversa do bot, sem dado pessoal). | CRM-6 e CHAT-3. |
| **P3** | **Domínio** do chat. | ✅ **subdomínio novo** | `chat.<empresa>.com.br`, apontando para o servidor do Chat App, atrás de HTTPS. **Falta o nome exato** do subdomínio e quem cria o DNS. | Teste real (não o desenvolvimento). |
| **P4** | Troca de aparelho. | ✅ **só novo link pelo WhatsApp** | Sem confirmação por CPF; o Chat App **não guarda CPF nem derivado**. Limite de pedidos de novo link por chat. | — (mas **depende de P10**). |
| **P5** | Quando o chat nasce no CRM. | ✅ **ao abrir o link** (recomendado aceito) | Sem fila de fantasmas. | — |
| **P6** | Retenção da transcrição no Chat App. | ✅ **apagar ao encerrar** | Só depois de a `outbox` do chat esvaziar. O cliente não vê histórico depois do fim. | — |
| **P7** | Expiração por inatividade. | ✅ **12 horas** | Contadas desde a última mensagem. | — |
| **P8** | Marca/cores. | ✅ (recomendado aceito) | Logo e cor por configuração; tema claro na fase 1. | — |
| **P9** | Módulo **Setores** ligado no CRM. | ✅ (recomendado aceito) | Ligar na instalação antes do piloto. | — |
| **P10** | A aplicação omni consegue **chamar** `POST /api/v1/chats` e **reenviar** o botão (`reissue`)? | ⏳ **dono: sem resposta** | **Crítica**: com P4 = só novo link pelo WhatsApp, o cliente que cair no navegador errado **só se recupera se o bot reenviar o botão**. Confirmar com quem mantém a aplicação omni. | CHAT-3, 7.4, e todo o MVP ponta a ponta. |

---

## 14. Riscos e pontos de atenção

1. **Navegador interno do WhatsApp** quebra o "preso ao aparelho". Como a única saída é o **novo link pelo WhatsApp**
   (P4), se o bot **não** puder reenviar o botão (P10) o cliente fica **trancado fora**. Validar P10 **antes** de construir 7.4.
2. **Dois sistemas** para manter ⇒ contrato versionado, testes de contrato e outbox com reenvio.
3. **Custo da API oficial pode não vir da janela de 24 h.** A resposta do bot dentro da janela costuma ser a parte barata; o
   que pesa costuma ser **modelos de mensagem** fora da janela. **Verificar no painel da Meta** (cobrança por tipo de
   conversa) **antes** de projetar a economia. Isto é uma **hipótese**, não um fato verificado aqui.
4. **LGPD:** CPF e histórico trafegam entre três sistemas (omni, Chat, CRM). Minimizar (seção 5.5), logs sem dado pessoal,
   exclusão cruzada (CRM-10), base legal e aviso ao cliente.
5. **Atendente em um setor só** (PK de `attendant_sector_members`): se o negócio precisa de atendente em vários setores, é
   outra mudança de schema.
6. **Hoje não aparece nome** do cliente (aceito pelo dono). Se o bot enviar `contact.name`, já vem preenchido.
7. **Módulo Setores desligado** ⇒ conversa cai sem setor. Tratado em CRM-5 (entra mesmo assim, com aviso).
8. **Abuso da superfície pública** (spam, anexos maliciosos) ⇒ 7.7 e CHAT-10.

---

## 15. Variáveis de ambiente

**Chat App** (`.env`): `DATABASE_URL`, `PUBLIC_BASE_URL`, `CRM_ENTRY_URL` (o endereço `…/api/v1/webhooks/channel/<token>`),
`CRM_SECRET_TO_CRM` (assina o que o Chat envia), `CRM_SECRET_FROM_CRM` (verifica o que o CRM envia), `API_KEY_PEPPER`,
`BRAND_NAME`, `BRAND_LOGO_URL`, `BRAND_ACCENT`, `LOG_LEVEL`, `RATE_LIMIT_*`, `RETENTION_DAYS`.

**CRM** (hoje, globais; passam a **por canal** em CRM-3): `INTERSUITE_SUPPORT_URL`, `INTERSUITE_HMAC_SECRET_IN`,
`INTERSUITE_HMAC_SECRET_OUT`, mais `CPF_ENCRYPTION_KEY` (seed da cifra do CPF).

> Correspondência de nomes: `INTERSUITE_HMAC_SECRET_OUT` (CRM) = `CRM_SECRET_TO_CRM` (Chat); `INTERSUITE_HMAC_SECRET_IN` (CRM) =
> `CRM_SECRET_FROM_CRM` (Chat).

---

## 16. Glossário

- **Fila:** conversas abertas **sem dono**; o atendente "puxa" (assume).
- **Setor:** agrupamento de atendentes e conversas (módulo opcional do CRM).
- **Identity (`web:<uuid>`):** identificador opaco do chat; liga Chat App ⇄ CRM.
- **Outbox:** tabela de eventos a entregar, gravada na mesma transação da mensagem, para garantir entrega.
- **Canal `web`:** provider do CRM que representa este chat.
- **Omni / bot:** a aplicação que conversa no WhatsApp e gera o link; **fora** deste projeto.

---

## 17. Estado das tarefas do CRM (atualizado em 13/11/2026)

> Branch `feat/canal-chat-externo` (3 commits). **Decisão do dono: o canal `web` do InterSuite NÃO é tocado.** Por isso o Chat
> ganhou um provider NOVO no CRM, `chat_externo`, em vez de estender o `web` como o plano previa nas seções 5 e 8. O contrato
> da seção 6 vale igual; só o provider mudou. O segredo é **por canal** (cifrado na sessão), não variável de ambiente.

| Tarefa | Estado | Onde |
|---|---|---|
| CRM-1 entrada v2 (`chat.started`, `message`, `chat.closed_by_customer`) | ✅ feita | `lib/channels/chat-externo/{contrato,ingest}.ts`, `lib/channels/inbound.ts` |
| CRM-2 contato por CPF | ✅ feita (reaproveita pelo CPF cifrado/hash; **telefone não é gravado** no contato por ora) | `ingest.ts` |
| CRM-3 canal com segredo por canal + tela | ✅ feita (API + tela em Conexões › "Chat fora do WhatsApp") | `app/api/v1/channels/chat-publico/`, `CanalChatPublicoClient.tsx`, `lib/channels/chat-externo/session.ts` |
| CRM-4 saída com reenvio | 🟡 saída feita; **sem reenvio automático** (mensagem falha com código claro; reenvio é manual) | `lib/channels/adapters/chat-externo.ts` |
| CRM-5 setor por código externo | ✅ feita (coluna, API, tela em Equipe › Setores). Atendente pode estar em **vários** setores (N:N desde a 9062) — o risco 5 da seção 14 não vale | migration 9109, `lib/schemas/routing.ts` |
| CRM-6 histórico importado | ✅ feita (marcado, sem alerta/agente/espera) | `ingest.ts` |
| CRM-7 encerramento | 🟡 **CRM → Chat feito** (`conversation.closed`, uma tentativa, sem reenvio). **Chat → CRM só registra um aviso**: não fecha a conversa (regras de motivo/caso/avaliação não ligadas) | `lib/channels/encerramento.ts`, rota de fechar |
| CRM-8 anexos | ⏳ não feita | — |
| CRM-9 selo do canal no Inbox, alertas por setor | ⏳ não conferida | — |
| CRM-10 LGPD cruzada | ⏳ não feita | — |
| CRM-11 docs/QA | ⏳ parcial (este arquivo) | — |

**Não verificado:** `pnpm test:db` (Docker desligado: o SQL da migration 9109 e as constraints não foram executados), prova pela tela
em ambiente fresco, e o e2e do CRM. Os testes de unidade usam banco em memória.
