# Canal de chat fora do WhatsApp — o que configurar no CRM e no Chat

Guia de quem liga o CRM ao **Chat App** (aplicação separada, repositório `intercert/chat`) para atender, pela Fila,
clientes que conversam numa página de chat própria em vez do WhatsApp. O mesmo texto está no repositório do Chat,
em `INTEGRACAO-COM-O-CRM.md`.

> **Estado em 16/11/2026.** Verificado com os dois sistemas reais (CRM local + Chat em Docker com MySQL 8.4): o bot
> cria o chat, o cliente abre o link e vê o histórico, o atendente vê contato, setor, CPF e mensagens na Fila, e a
> resposta do atendente aparece na página do cliente. **Não verificado:** a volta CRM → Chat por **https público**
> (no teste local o anti-SSRF recusa destino local) e o proxy HTTPS do Chat. **Anexos** entre os dois sistemas
> foram implementados em 17/11/2026 (§9) e cobertos por teste unitário; **não foram provados com os dois sistemas
> reais** — o primeiro teste com uma foto de verdade, nos dois sentidos, é o que falta.

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

## 8. Evidências (prova pela tela)

**Jornada do administrador no CRM** — spec `tests/e2e/canal-chat-externo.spec.ts`, banco fresco e Supabase local:

| Captura | O que mostra |
|---|---|
| `evidence/canal-chat-externo/1-setor-formulario.png` | Equipe › Setores, com o campo "Código para o bot" |
| `evidence/canal-chat-externo/1-setor-criado.png` | O setor criado com o código |
| `evidence/canal-chat-externo/2-conexoes-chat-vazio.png` | Conexões › Chat fora do WhatsApp, antes de criar o canal |
| `evidence/canal-chat-externo/2-chaves-mostradas-uma-vez.png` | As três chaves, mostradas uma única vez |
| `evidence/canal-chat-externo/3-canal-pronto-sem-chaves.png` | Depois de recarregar: canal pronto e as chaves não aparecem de novo |
| `evidence/canal-chat-externo/4-conversa-na-fila-com-historico.png` | A conversa na Fila, com histórico do bot e setor |
| `evidence/canal-chat-externo/5-mensagem-do-cliente.png` | A mensagem do cliente chegando na conversa |
| `evidence/canal-chat-externo/6-chaves-giradas.png` | Girar as chaves: as novas aparecem uma vez |

**Ida e volta com o Chat App real** (Docker + MySQL 8.4), prova de 16/11/2026:

| Captura | O que mostra |
|---|---|
| `evidence/canal-chat-externo-ponta-a-ponta/1-cliente-abre-o-link.png` | O cliente abre o link que o bot gerou |
| `evidence/canal-chat-externo-ponta-a-ponta/2-cliente-no-chat.png` | A página do chat, com o aviso de privacidade |
| `evidence/canal-chat-externo-ponta-a-ponta/3-cliente-enviou.png` | O cliente envia a primeira mensagem |
| `evidence/canal-chat-externo-ponta-a-ponta/4-atendente-ve-na-fila.png` | O atendente vê, na Fila do CRM, histórico, setor e a mensagem nova |
| `evidence/canal-chat-externo-ponta-a-ponta/5-cliente-recebe-resposta.png` | A resposta do atendente aparece na página do cliente |

## 9. Anexos (fotos e documentos)

**Cliente → atendente.** O cliente anexa na página; o Chat guarda o arquivo e manda ao CRM, no evento `message`, só a
**URL assinada** (vale 1 h). O CRM grava a mensagem na hora (aparece no Inbox como imagem ou documento, com o nome do
arquivo) e pede ao **worker de mídia** — o mesmo dos outros canais — que baixe e guarde uma cópia no Storage privado
(`whatsapp-media`). Daí em diante a imagem abre pelo Inbox e entra na leitura da IA como qualquer foto. Uma mensagem
com N anexos vira N linhas: o texto na primeira e um anexo por linha.

O que o CRM confere antes de baixar: a URL tem de ser do **mesmo host** do endereço do Chat cadastrado no canal (o
payload não escolhe para onde o servidor vai), passar no anti-SSRF, não redireciona, não leva segredo nenhum e tem
teto de **10 MB**. Link vencido (410), arquivo apagado (404) ou assinatura inválida (403) viram falha da mídia com o
status no registro — a mensagem e o texto continuam na conversa.

**Atendente → cliente.** O anexo que o atendente envia vai ao Chat como `attachments` com a **URL assinada do Storage
do CRM** (vale 10 min); o Chat a baixa na hora e guarda a cópia dele. Só entra **foto, PDF, TXT, DOCX e XLSX**: o que
o Chat não aceita (áudio, vídeo) ele mostra ao cliente como "anexo indisponível", sem derrubar a mensagem.

> **Configure no Chat:** o Chat só baixa anexo do atendente dos domínios que listar. Por padrão é só o domínio do CRM,
> e a URL assinada é do **Storage** (outro domínio). Sem isto, todo anexo do atendente chega como indisponível. Em
> `ATTACHMENT_FETCH_ALLOWED_HOSTS` (`.env` do Chat), liste o host do Storage do CRM — o `host` de
> `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_URL` do CRM, com `:porta` se houver. Confira também que `ATTACHMENTS_DIR` é um
> volume persistente (`OPERACAO.md` §9.1 do Chat).

| Sintoma | Causa provável |
|---|---|
| Foto do cliente aparece como imagem sem conteúdo | O worker de mídia ainda não baixou (espere) ou o link de 1 h venceu antes — o registro da mídia diz `chat_externo_media_failed_410` |
| `chat_externo_media_host_blocked` | O host da URL do anexo não é o do endereço do Chat cadastrado no canal |
| Anexo do atendente chega "indisponível" ao cliente | `ATTACHMENT_FETCH_ALLOWED_HOSTS` do Chat sem o host do Storage, ou tipo que o Chat não aceita |

## 10. Fora do alcance desta versão

Reenvio **durável** da saída do CRM (fila + worker), selo/alertas por setor, LGPD cruzada entre os dois sistemas e
reenvio do botão pelo bot (decisão P10 do Chat, em aberto).

Já tratado: a **falha passageira do Chat** (ele reiniciando num deploy: 502/503/504 ou conexão recusada) é reenviada
na hora, até 3 tentativas em ~1,6 s, com o mesmo `message_id` — o Chat deduplica, então não duplica. Fora do ar por
mais tempo que isso, a mensagem ainda falha e o atendente a reenvia pelo botão da bolha. Timeout e erro 4xx não são
reenviados.

Também já tratado: o **cliente que encerra pela página** fecha a conversa no CRM (aviso de sistema na linha do tempo +
`fn_service_status`, a mesma RPC do botão "Encerrar"; auditado como `conversation.closed` com
`via: chat_externo`). Se o banco falhar nessa hora, o CRM responde 5xx e o Chat reenvia.
