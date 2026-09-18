# Manual do Dono — DeskcommCRM / InterCRM

> Documento único de handoff, escrito para quem está assumindo este sistema **agora** e precisa entender, sem depender de sessões futuras: o que o produto é, como ele funciona por dentro, o que está de pé, o que está quebrado, e o que fazer a seguir.
>
> **Gerado em 2026-09-15** por uma varredura completa do repositório (código + 171 docs em `docs/` + specs + PRDs + HANDOFFs), com 6 pesquisas paralelas em profundidade + leitura direta dos documentos de topo. Todo número aqui foi **medido**, não copiado de outro doc — inclusive onde isso significa contradizer `docs/current-state.md` e `docs/harness-audit.md`, que **se autodeclaram** retratos de 2026-07-29, hoje **3039 commits** atrasados.
>
> **Como usar isto:** é um mapa, não a lei. A lei viva do projeto é `CLAUDE.md` (leitura obrigatória antes de mexer em código) e `docs/index.md` (índice dos 171 docs, com regra de precedência quando dois divergem: `CLAUDE.md` > `docs/specs/` > `docs/prd/` > `HANDOFF-*.md` > README). Este manual aponta para onde cavar mais fundo em cada assunto — ele resume, não substitui.

---

## Sumário

1. [O que é o DeskcommCRM](#1-o-que-é-o-deskcommcrm)
2. [Este clone específico (InterCRM)](#2-este-clone-específico-intercrm)
3. [Modelo de negócio](#3-modelo-de-negócio)
4. [Stack técnica](#4-stack-técnica)
5. [Arquitetura — como o sistema é construído por dentro](#5-arquitetura--como-o-sistema-é-construído-por-dentro)
6. [Modelo de dados do CRM](#6-modelo-de-dados-do-crm)
7. [O sistema de Agentes de IA](#7-o-sistema-de-agentes-de-ia)
8. [WhatsApp — WAHA e canais](#8-whatsapp--waha-e-canais)
9. [Integrações externas](#9-integrações-externas)
10. [Todas as variáveis de ambiente](#10-todas-as-variáveis-de-ambiente)
11. [LGPD](#11-lgpd)
12. [White-label / revenda](#12-white-label--revenda)
13. [Deploy, packaging e operação](#13-deploy-packaging-e-operação)
14. [Testes e verificação](#14-testes-e-verificação)
15. [Segurança — superfície de ataque](#15-segurança--superfície-de-ataque)
16. [Estado real medido agora (2026-09-15)](#16-estado-real-medido-agora-2026-09-15)
17. [Divergências entre documentação e código — cuidado com isso](#17-divergências-entre-documentação-e-código--cuidado-com-isso)
18. [Como tomar conta a partir de agora](#18-como-tomar-conta-a-partir-de-agora)
19. [Mapa de arquivos e docs importantes](#19-mapa-de-arquivos-e-docs-importantes)
20. [Departamentos / filas por área — decisão de configuração](#20-departamentos--filas-por-área--decisão-de-configuração)

---

## 1. O que é o DeskcommCRM

**Elevator pitch:** um sistema operacional de vendas **open source**, **self-hosted**, com **agentes de IA nativos** que atendem, qualificam e vendem pelo WhatsApp — dentro de um CRM que roda no seu próprio servidor. A categoria de entrada (âncora de marketing) é "alternativa open source e self-hosted a Kommo, Octadesk, Intercom, Zendesk"; a categoria que o projeto reivindica para si é **"AI Sales OS"**.

**Origem e pivô.** Nasceu em 2026 como CRM de e-commerce brasileiro (WhatsApp via WAHA + Nuvemshop + LGPD nativa). Depois de abrir o código, a comunidade levou o produto para clínicas, imobiliárias, infoprodutos, agências e prestadores de serviço — e o produto pivotou de "CRM de e-commerce com IA" para "sistema operacional de vendas com agentes de IA, para qualquer negócio que vende pelo WhatsApp" (`VISION.md`, revisão 2026-07-19). E-commerce continua sendo o vertical de origem (e a integração mais madura, Nuvemshop), mas não é mais a definição do produto.

**⚠️ Ressalva prática importante:** apesar do pivô de posicionamento, o **pipeline padrão que toda organização nova recebe** ainda é o de e-commerce (funil "Pedidos", 7 estágios: Carrinho abandonado → Aguardando pagamento → Pago → Em separação → Enviado → Entregue → Pós-venda, mais "Cancelado"). Quem for operar outro nicho (clínica, imobiliária) precisa **reconfigurar manualmente** o vocabulário e as etapas — não existe hoje um "template de nicho" pronto para escolher na instalação (isso está no roadmap "Próximo", não entregue).

**Os quatro pilares diferenciais** (frente a CRMs genéricos tipo Pipedrive/RD CRM):
1. **Agentes de IA que operam o CRM de verdade** — não é chatbot decorativo: RAG por tenant, o agente move lead no funil, agenda, e existe uma trilha de auto-aprimoramento (flywheel).
2. **Multi-nicho por design** — vocabulário (lead/deal/won/lost) configurável por pipeline.
3. **MCP-ready** — o CRM inteiro é exposto como tools MCP; hoje uso interno (o próprio agente do CRM consome), infraestrutura pronta para MCP público (ainda sem onboarding dedicado a terceiros).
4. **LGPD nativa** como contrato de primeira classe.

**Nichos citados nominalmente nos documentos:** e-commerce (com integração Nuvemshop nativa), clínicas, imobiliárias, infoprodutos, agências, prestadores de serviço. Perfil de tenant-alvo: PME brasileira, ~300 atendimentos/dia, 2-5 atendentes humanos, 1-2 números de WhatsApp.

**Telas que o sistema oferece hoje** (do README, confirmado como estrutura real):

| Grupo | Telas |
|---|---|
| Atendimento | Inbox (conversas WhatsApp, humano e IA lado a lado) · Radar (quem esfriou) · Respostas rápidas |
| CRM | Kanban · Contatos · Funis (etapas, vocabulário, motivos de perda) |
| Agente de IA | Agentes · Follow-ups · Roteadores · Provedores e Credenciais · Conhecimento (RAG) · Memória · Skills · Casos · Alertas · Propostas · Execuções · Uso e orçamento |
| Canais | Conexões (QR ou canal oficial Meta) · Nuvemshop · Webhooks |
| Análise | Desempenho · Evolução da IA · Audit Log |
| Organização | Equipe · Distribuição de atendimento · Organização · LGPD · API Tokens · Segurança · Perfil, Notificações, Billing |

Toda tela nova é obrigada a ter "porta" na navegação (`lib/navigation/catalogo.ts`) — um teste de CI reprova tela alcançável só digitando a URL.

---

## 2. Este clone específico (InterCRM)

Confirmado diretamente: este diretório (`C:\Users\arthu\OneDrive\Documentos\Projetos\InterCRM`) é um **fork pessoal**, `origin` = `https://github.com/arthurharysson/InterCRM.git`. O projeto upstream/original é `https://github.com/melgarafael/DeskcommCRM` (mantenedor: Rafael Melgar, `rafael@maudibrasil.com.br`, Instagram/YouTube `@melgarafael`).

**Pontos que isso implica para você:**

- **Não há remoto `upstream` configurado** neste clone, e **zero tags git** foram trazidas (`git tag` → vazio). A versão real vem só do `CHANGELOG.md` (hoje: **1.23.0**, 2026-09-14) — não confie em `git describe`.
- A licença é **MIT**: você pode usar, modificar, hospedar para terceiros, revender e cobrar o que quiser, sem royalty e sem cláusula anticomercial. Isso é o que te permite "implementar na empresa" livremente, com ou sem contribuir de volta.
- Se você **quiser contribuir de volta** ao upstream (corrigir bug, propor feature) em algum momento, existe todo um protocolo documentado (`CONTRIBUTING.md`, skill `.agents/skills/deskcomm-contribuir/`) — branches nunca a partir do `main` do seu fork (ele carrega suas personalizações), sempre a partir da `main` do repositório do mantenedor; ver §18.
- Se você **não pretende contribuir de volta** e só quer rodar/adaptar para o seu negócio, pode ignorar boa parte da doutrina de "PR/triagem" do `CLAUDE.md` — mas **não** as partes de arquitetura, migrations, RLS e segurança, que valem para qualquer instalação, sua ou não.

---

## 3. Modelo de negócio

**Não é SaaS por assinatura.** O software é 100% open source, completo, sem versão paga nem feature travada (`VISION.md`).

**A monetização do projeto original é por infraestrutura**, via parceria com a HostGator (VPS em São Paulo, kit de instalação em 1 comando) — mas o caminho genérico (`docker compose` puro em qualquer VPS) nunca é sabotado; a parceria é recomendada, nunca obrigatória.

**Para o seu caso (empresa própria), os caminhos possíveis são:**

1. **Uso interno** — instalar numa VPS (HostGator ou qualquer outra com Docker) e operar como seu CRM/atendimento. Sem custo de licença; custo é só infra (VPS + Supabase, que tem tier grátis até um certo volume + as chaves de IA que você escolher).
2. **Revenda / white-label** — o sistema já tem infraestrutura pronta para isso (ver §12): trocar marca pela tela sem editar código, uma imagem Docker serve qualquer marca, e há dois modelos (uma VPS por cliente vs. uma VPS multi-cliente com isolamento por RLS).
3. **Billing-ready, mas não ativo.** O produto já coleta métricas de uso por tenant desde o MVP (mensagens, chamadas LLM, storage) para eventual cobrança futura, mas isso não é um mecanismo de cobrança ativo hoje — é preparo.

**Argumento jurídico relevante para venda no Brasil:** hospedar em VPS nacional evita a exigência de cláusulas-padrão contratuais para transferência internacional de dados (Resolução CD/ANPD nº 19/2024). **Cuidado:** o próprio `docs/white-label.md` avisa para nunca vender isso como "servidor no Brasil = conformidade com LGPD" — é um argumento específico (ausência de transferência internacional), não uma promessa geral de conformidade.

---

## 4. Stack técnica

| Camada | Escolha | Detalhe |
|---|---|---|
| Frontend | Next.js 16 App Router (Turbopack) + React 19 + TypeScript 6 estrito | Server Components + Route Handlers no mesmo repo. `middleware.ts` renomeado para `proxy.ts` no Next 16 |
| Estilo | Tailwind 4 (CSS-first) + shadcn/ui (`new-york`, neutral) | **Não existe `tailwind.config.ts`** — tokens em `app/globals.css` |
| Banco | Supabase (Postgres 15+) | RLS em toda tabela tenant-aware; extensions `vector`, `pgcrypto`, `uuid-ossp`, `citext`, `pg_trgm` |
| Auth | Supabase Auth via `@supabase/ssr` | Cookie `sb-deskcomm-auth`, `SameSite=Strict`, `HttpOnly`, `Secure`. Sempre `getUser()`, nunca `getSession()` |
| Realtime | Supabase Realtime | `postgres_changes` (inbox/kanban) + `broadcast` (sinais leves) |
| Storage | Supabase Storage | Bucket `whatsapp-media` privado, URLs assinadas; bucket `brand-logos` é o único público |
| WhatsApp | WAHA Plus (NOWEB) + Meta Cloud API oficial | QR code para começar rápido; canal oficial para escala com templates aprovados |
| Filas/eventos | `event_log` table + `job_queue` + workers via cron | Trigger Postgres **nunca** faz HTTP. Deliberadamente não usa Inngest/Trigger.dev (custo operacional que um self-hoster teria que provisionar) |
| Rate limit | Upstash Redis | **Hoje é janela fixa** (`INCR`+`EXPIRE`), não sliding window como documentação antiga dizia. Fallback em memória se Redis falha |
| IA | Vercel AI SDK v7 — Anthropic, OpenAI, Google, **e OpenRouter** | Instalador pergunta qual; trocável depois pela tela, por "ponto" de uso (o que conversa não precisa ser o que indexa) |
| Validação | Zod | Todo input externo (body, webhook, env) |
| Observability | Sentry | `beforeSend` central (`lib/sentry/scrub.ts`) sanitiza CPF/telefone/e-mail e headers sensíveis em erro, transação, span **e** breadcrumb |
| Hospedagem | VPS com Docker | App + WhatsApp + workers rodam na sua máquina; nada compila na VPS (imagens pré-buildadas) |

---

## 5. Arquitetura — como o sistema é construído por dentro

### 5.1 Multi-tenancy

Toda tabela "tenant-aware" carrega `organization_id uuid not null references organizations(id) on delete cascade`. RLS é aplicada via 4 helpers canônicos definidos no schema (`fn_user_org_ids()`, `fn_is_platform_admin()`, `fn_user_role_in_org()`, `fn_role_at_least()`), usados por 4 templates de policy (isolamento simples, read-write split, owner-scoped, append-only).

**A regra mais importante do sistema, repetida em toda a doutrina:** o **service role bypassa RLS**. Qualquer handler que use o admin client (`lib/supabase/admin.ts`) **deve filtrar `organization_id` manualmente**, resolvido de fonte confiável — cookie, JWT, secret de webhook, token de path — **nunca do corpo da requisição**. Isso está escrito no próprio cabeçalho de `lib/supabase/admin.ts`. Medido: **89 dos 169+ handlers usam o admin client** — a defesa contra vazamento cross-tenant nesse ponto é revisão humana + os testes de invariante (não há lint automático que bloqueie um handler novo nascendo errado).

**Teste de isolamento** é obrigatório no CI: cria 2 organizações, simula os claims JWT pelo mesmo caminho de produção, prova que a org A não enxerga nenhuma linha da org B em `conversations`, `messages`, `contacts`, `crm_leads` (com um caso de controle provando primeiro que as linhas de B existem de verdade, senão o teste passaria vazio por acidente).

### 5.2 Autenticação e RBAC

**4 papéis hierárquicos** dentro do tenant: `viewer (1) < agent (2) < manager (3) < admin (4)`. Matriz completa de permissão por recurso está em `docs/specs/13-spec-governanca-atendimento.md` §4 (bastante detalhada — quem escreve o quê, `own` vs `org` scope, por papel).

**Platform admin** é uma role transversal separada (tabela `platform_admins`, não coluna em `auth.users`), com escopo `full` ou `support_readonly`.

**MFA é opcional**, e isso é uma mudança de doutrina importante e **recente** — vários documentos mais antigos (PRDs, `docs/white-label.md`) ainda dizem "MFA obrigatório para admin". **A regra vigente (confirme em `lib/auth/politica-mfa.ts`):** duas políticas independentes que **somam** — `platform_admins.mfa_required` (super-admin) e `organizations.settings.security.mfa_required` (admin do tenant) — **ambas com default "não exigir"**. Motivo documentado: o `install.sh` cria o dono como platform admin, então a regra antiga bloqueava **toda** instalação self-host com uma tela cheia logo após o onboarding, sem aviso prévio. Importante: cadastrar e provar são coisas diferentes — quem já **tem** um fator MFA ativo prova na sessão sempre, independente da política (isso não é afetado por essa mudança).

**Superfícies de autenticação não-cookie:**
- `/api/v1/cron/*` — Bearer `INTERNAL_CRON_SECRET`, fail-closed
- `/api/internal/*` — header `x-internal-secret`
- `/api/mcp` — Bearer `tok_...` contra `api_tokens` (mesma tabela do REST)
- `/api/v1/webhooks/*` — HMAC + token de path

### 5.3 Convenções de API REST `/api/v1/`

- JSON `snake_case`, UUID v4, ISO-8601 UTC, dinheiro em `_cents` + `currency` ISO-4217
- Wrappers `ok(data, meta?)` / `fail(code, message, status, opts?)` de `lib/api/wrappers.ts` — toda resposta injeta `X-Request-Id`, correlacionável com o audit log
- Paginação por cursor opaco (base64 + HMAC, `CURSOR_SIGNING_KEY`), rejeita cursor de outro tenant ou adulterado
- `Idempotency-Key` (TTL 24h) — **cobertura parcial hoje**: só 2 rotas gravam recibo de fato (`lgpd/requests/[id]/approve`, `admin/tenants`) + `message-templates` via helper reutilizável; a maioria das rotas de criação ainda não cobre, e não fecha a corrida entre requisições simultâneas com a mesma chave (issue #778 aberta upstream)
- Rate limit headers (`X-RateLimit-*`, `Retry-After` em 429) — implementado, mas **aplicado hoje só em 2 pontos**: webhook de captação e dispatcher de IA. O restante da superfície pública (login, signup, convite) tem rate limit **separado** (`lib/auth/rate-limit.ts`, 5 tentativas/identificador por 300s) adicionado depois de uma auditoria de segurança — ver §15
- Auth dual: cookie de sessão (frontend) ou `Authorization: Bearer tok_...` (server-to-server), nunca em query string

**36 áreas de API** hoje sob `app/api/v1/`: `admin`, `ads`, `agenda`, `ai`, `attendants`, `audit`, `auth`, `automation-rules`, `channel-sessions`, `channels`, `contacts`, `conversation-tags`, `conversations`, `cron`, `demandas`, `health`, `integrations`, `lead-captures`, `leads`, `lgpd`, `marca`, `mcp`, `message-templates`, `messages`, `metrics`, `notifications`, `onboarding`, `pipelines`, `products`, `reports`, `settings`, `system`, `tasks`, `team`, `voice`, `webhook-sources`, `webhooks`.

**Fluxo canônico de uma request:**
```
request → proxy.ts (injeta X-Request-Id; valida sessão via cookie, ou bypass se rota pública)
        → route handler:
             1. Zod valida o input externo
             2. guard: requireRole() | requirePlatformAdmin() | secret/HMAC
             3. resolveActiveOrg() → organization_id de fonte confiável (NUNCA do body)
             4. query (RLS via client de sessão, ou filtro manual de org com service role)
             5. audit() fire-and-forget se houve mutação
             6. ok(data, meta) | fail(code, message, status)
```

### 5.4 Sistema de eventos leve (`event_log` + `job_queue` + workers)

**Princípio não-negociável nº 1 de todo o repositório: trigger Postgres nunca faz HTTP.** Um trigger só pode inserir em `event_log`, atualizar outra tabela, ou `RAISE NOTICE`. Side-effects de rede (chamar WAHA, IA, webhook externo) vivem sempre num worker que consome a fila — nunca dentro de uma transação de banco.

**Por que não uma fila gerenciada (Inngest, Trigger.dev, BullMQ)?** Decisão de produto: o sistema é self-host numa VPS de cliente comum, e qualquer dependência de infra externa gerenciada é custo operacional que o self-hoster teria que provisionar e manter sozinho. `event_log` + pull-loop (`FOR UPDATE SKIP LOCKED`) drenado por cron é zero-infra-extra.

**Claim atômico:** RPC `claim_events`/claim da `job_queue` usa `FOR UPDATE SKIP LOCKED`, garantindo que N workers em paralelo nunca peguem o mesmo evento duas vezes.

**Backoff + DLQ:** tentativas com backoff exponencial (30s → 2h, com jitter); depois de um teto de tentativas (8 por padrão, menor em fluxos sensíveis como LGPD), o evento vira `status='dead'` para investigação manual.

**Idempotência:** `unique(organization_id, external_id)` + captura do código de erro `23505` (violação de unicidade do Postgres) é o padrão para mensagens WhatsApp e eventos externos.

**Workers reais hoje:** `ai-response`, `ai-sentiment`, `rag-indexer`, `media-persist`, `media-derive`, `lgpd-export`, `lgpd-redact`, `storage-cleanup`, `agent-worker` — drenados por 10 endpoints em `app/api/v1/cron/`, mais o worker dedicado de longa duração do agente de IA (`workers/agent-worker/main.ts`), que é um **processo separado**, não um endpoint HTTP batido por cron.

**Regra de audit em cron** (medida real que virou doutrina): "cron que não fez nada não audita; cron que fez, audita" — sem essa regra, ~51.840 linhas/mês de audit log eram batidas de cron vazio numa instalação sem tráfego (95% do audit log numa VPS real medida era isso). Vigiado por `tests/unit/cron-audita-so-quando-ha-efeito.test.ts`, que varre o AST de toda rota de cron.

---

## 6. Modelo de dados do CRM

**5 tabelas core:** `crm_pipelines`, `crm_stages`, `crm_leads`, `crm_lead_activities` (timeline polimórfica, append-only, particionada por mês), `crm_lead_links` (vínculos polimórficos lead↔pedido/conversa/agendamento/etc).

**Vocabulário configurável por pipeline** (`pipelines.vocabulary jsonb`) é o mecanismo central que permite multi-nicho sem refactor: `{ lead, deal, won, lost, stage }`. Ex.: e-commerce = Cliente/Pedido/Pago/Cancelado; uma clínica poderia usar Paciente/Consulta/Agendado/Cancelado. Rege **só rótulos de UI**, nunca dados.

**Fractional indexing** — `position_in_stage numeric` (nunca `int`), reordenar no drag-and-drop calcula `midpoint(prev, next)` em vez de reescrever todas as posições.

**Won/lost derivado de flag na etapa** — mover um lead para uma stage `is_won=true` fecha o lead automaticamente via trigger; mover para `is_lost=true` exige `lost_reason` obrigatório (vocabulário fechado: `requested_by_customer`, `price`, `no_response`, `product_unavailable`, `cancelled_by_store`, `cancelled_by_customer`, `payment_failed`, `other`).

**"A conversa vira lead"** (`docs/specs/17-spec-conversa-vira-lead.md`) — mecanismo relativamente recente que fecha um buraco real medido em produção: antes, WhatsApp e CRM não se ligavam automaticamente (numa instalação real: 84% dos contatos sem telefone gravado, 87% dos leads sem contato vinculado). Regra atual: **todo lead nasce automaticamente** na primeira mensagem inbound de um contato sem lead aberto, no pipeline `is_default` da organização, na etapa de menor posição — mesmo que o contato seja só um curioso (filosofia: "nada fica fora do radar; quem não avança morre visivelmente na primeira etapa"). Não nasce lead para mensagem de grupo, contato bloqueado, ou se já existe lead aberto. O agente de IA só pode mover leads em pipelines explicitamente marcados na sua configuração (`ai_agent_versions.pipeline_ids`) — escopo fail-closed: sem marcação, nenhum funil.

**Índice de Atrito** (`docs/specs/17-spec-indice-de-atrito.md`) — ⚠️ **desenhado, não implementado** ("mapeamento concluído, implementação não iniciada"). A ideia: hoje o produto mede só atividade/conversão, o que cria incentivo perverso (um agente que insiste 6 vezes converte mais e aparece como "o melhor" nos painéis, mesmo queimando relacionamento). Proposta: toda métrica de eficiência vem pareada com uma contra-métrica de custo/atrito (turnos até o desfecho, taxa de opt-out, insistência média, e uma "taxa de contorno" — quantas vezes um atendente respondeu pelo próprio celular em vez de usar o sistema, sinal já capturado hoje em `sent_via='external_device'`).

**RBAC de dados (resumo da matriz completa em `docs/specs/13`):** `viewer` lê tudo, escreve nada. `agent` (o "atendente") por padrão vê as próprias conversas/leads + a fila não-atribuída (`visibility_mode = 'own_and_unassigned'`, configurável por org). `manager`+ tem escrita org-wide, inclusive config de pipeline/stages. Permissão granular por pipeline (`user_pipeline_access`) está deliberadamente fora de escopo até hoje.

**Roteamento**: dois modos — `manual` (default, só claim/atribuição humana) e `round_robin` (rodízio entre atendentes elegíveis: disponíveis, dentro do horário, abaixo da capacidade). Sem elegível, a conversa fica em fila visível com posição.

---

## 7. O sistema de Agentes de IA

Esta é provavelmente a parte mais sofisticada do produto e a que mais evoluiu recentemente. **Ponto crítico de leitura:** existem **duas gerações de arquitetura documentadas**, e confundi-las leva a conclusões erradas.

### 7.1 A virada arquitetural: fusão do "Vendaval"

As specs 05/10/11/12/14 (abril-maio/2026) descreviam um runtime baseado em `Vercel AI SDK ToolLoopAgent` com um serviço **externo** separado, batizado "Vendaval", que consumiria o CRM via MCP. **Em 2026-07-17 essa decisão foi invertida**: o "cérebro" do Vendaval foi **fundido para dentro deste repositório** como `lib/agent-engine/` (`docs/vendaval-fusion-plan.md`). A doutrina em `docs/doctrine/operacao-de-agentes.md` proíbe explicitamente reverter isso.

Consequência: `lib/ai/dispatcher/index.ts` e `lib/ai/runtime/agent.ts` (o runtime "legado") estão marcados `@deprecated` no próprio código. **O runtime canônico hoje é `lib/agent-engine/`**, consumido por um worker dedicado de longa duração (`workers/agent-worker/main.ts`), processo separado do app Next.js — não mais um cron batendo endpoint HTTP.

**Bug ainda vivo relacionado a isso:** o botão "Testar" na tela de configuração de agente chama o runtime legado (`lib/ai/runtime/agent.ts`), que **não** roda a cadeia real de guardrails — ou seja, testar um agente pela UI hoje não prova o comportamento real de produção. Confirme com `grep -n "runAgent" app/api/v1/ai/agents -r`.

### 7.2 Os três papéis: Conversador, Operador, Segurança

Esta separação existe por um problema **medido**, não hipotético (`docs/specs/16-spec-tres-papeis-do-agente.md`): um agente que fala com o lead E opera o CRM no mesmo contexto vaza vocabulário técnico interno ao cliente. Medição real: prompt único "operador" vazou em **30%** dos turnos (18 testados); prompt puramente conversacional, **0%**.

- **Conversador** — fala com o lead, e só. Vê contexto **projetado** (traduzido para linguagem de negócio; nunca UUID, nome de tabela, erro técnico cru). Tools: `send_message`, `get_lead_context`, `search_knowledge` — leitura e fala, zero escrita.
- **Operador** — opera o CRM (move lead, agenda, abre caso humano), **nunca fala com o cliente** (literalmente não tem a tool `send_message` no seu toolset — separação por ausência de ferramenta, não por regra de prompt, "a única forma que não depende de o modelo obedecer"). Disparado por **evento**, sempre roda depois do turno do Conversador fechar — mesmo quando não há nada a fazer, isso é registrado explicitamente como "nada a declarar" (nunca um silêncio mudo).
- **Segurança** — não é um terceiro LLM revisando tudo; é a cadeia de **11 gates determinísticos** (`before_send`, versão 7) + 2 classificadores LLM auxiliares opcionais (promessa semântica, jailbreak).

**Contrato entre papéis:** um JSON validado por Zod (`DeclaracaoDoTurno`) com `intencoes[]`, `promessas[]` (com prazo ISO-8601 quando houver) e um campo explícito `nada_a_declarar: boolean` — distingue "avaliei e não havia nada" de "esqueci de avaliar".

**Terceira porta de vazamento, fechada por "projeção":** além do nome/descrição da ferramenta, o **dado que a ferramenta devolve** vazava (ex.: erro técnico cru repetido ao cliente, UUID aparecendo na conversa). `lib/agent-engine/agent/projecao.ts` implementa uma **allowlist** (nunca denylist — campo não declarado como projetável não passa por desenho) que filtra o que o Conversador vê.

**Estado real de implementação (mais avançado do que a spec-fonte sugere):** confirmado em código que os passos "contrato de declaração", "projeção" e "Operador por evento" **já estão implementados** — a tabela de status na própria spec 16 está desatualizada nesse ponto. O que falta: UI reorganizada pelos três papéis, e o conserto do botão "Testar" citado acima.

### 7.3 RAG por tenant

Schema: `ai_knowledge_sources` (4 tipos: `faq`, `policy`, `catalog`, `conversations`) → `ai_chunks` (`embedding vector(1536)`, índice `ivfflat`) → `ai_knowledge_versions` (versionamento com swap atômico e rollback). Ingestão de conversas resolvidas é opt-in e passa por anonimização de PII **antes** de indexar.

A busca foi portada para dentro do `agent-engine` (`lib/agent-engine/agent/search-knowledge.ts`) e hoje é escopada aos materiais que a **versão do agente** pode ler (não mais um índice único por agente) — permite adicionar documento novo sem reindexar tudo.

**Embeddings**: sempre OpenAI (Anthropic/Google não têm modelo de embedding usado aqui), `text-embedding-3-small`, 1536 dimensões. Cadeia de resolução da chave: credencial da própria organização → gateway da instalação → chave de instalação (`OPENAI_API_KEY`).

### 7.4 MCP — o CRM exposto como ferramentas

O servidor MCP **já é real e roda em produção** — não é "planejado" apesar de o roadmap do README ainda listar "MCP público" como "Próximo". O que falta é onboarding/UI para terceiros gerarem token MCP como feature auto-atendida; o mecanismo interno já existe e é usado pelo próprio agente do CRM hoje.

**Catálogo: 60 tools em 9 domínios** (medido em código, bem além das 13 originais da spec 11): `agendamento` (8), `atendimento` (7), `comercio` (3), `escalacao` (6), `evolucao` (5), `funil` (6), `governanca` (4), `operacao` (15), `retencao` (6).

Cada tool tem `risco` (`seguro`/`atencao`/`crítico`) e é agrupada em **6 pacotes de jornada** para a UI de configuração não virar 60 checkboxes: `atender`, `vender`, `reter`, `escalar`, `organizar`, `evoluir`. Capacidades `crítico` nunca entram ligadas automaticamente por um pacote. **Teto de 25 tools por agente** (já subiu de 20).

**Auth**: mesma tabela `api_tokens` do REST (Bearer `tok_...`/`dsk_...`, hash SHA256). Para uso interno, um token efêmero TTL 5min escopado por execução.

### 7.5 Handoff IA → humano

**Gatilhos determinísticos** (rodam sem custo de LLM, antes do modelo responder):
1. Pedido explícito do lead (regex PT-BR conservadora)
2. Tool `request_human_handoff` chamada pelo próprio modelo
3. Estouro de orçamento de IA (ver §7.6)
4. Sinal de urgência/segurança (léxico de risco — só prioriza alerta, não veta resposta)

**⚠️ Não encontrado implementado no runtime atual:** o gatilho "sentimento baixo" (classificador de frustração via Haiku em paralelo), descrito na spec 05 como um dos 4 gatilhos originais. Trate como possivelmente descontinuado na arquitetura atual — confirme antes de comunicar que roda em produção.

**Ação de handoff**: `contacts.force_human=true` (irrevogável por design — só uma ação humana explícita desfaz), `conversations.status` muda para `pending`, `bot_silenced_until='infinity'`, cancela follow-ups pendentes, cria item na Central de avisos. **O bot nunca reassume sozinho.**

**"Casos humanos"** — mecanismo mais leve e **separado** do handoff duro: quando o agente esbarra num bloqueio que só um humano resolve (aprovar desconto, confirmar política), ele abre um caso (`open_human_case`) **sem silenciar o bot** — a IA continua dona da conversa, mas delega uma tarefa pontual. Existe um guardrail dedicado que impede o modelo de prometer/afirmar algo sobre um caso que ele não abriu de verdade — a garantia de negócio é "o lead nunca recebe promessa de humano sem caso aberto correspondente" (fail-safe em 3 camadas: descrição da tool, bloco de sistema residente, gate determinístico que auto-abre um caso mínimo se detectar a promessa sem caso).

### 7.6 Orçamento de IA — o teto de gasto

Uma das áreas mais bem documentada no próprio código (`lib/agent-engine/edge/llm/orcamento.ts`). **Três modos por organização**: `off` (default de 100% das instalações — só acompanha, nunca bloqueia), `avisar` (abre aviso na Central ao cruzar o limiar, mas segue respondendo), `bloquear` (recusa novas chamadas ao atingir o teto).

Regras de segurança do próprio mecanismo: nunca pula de `off` direto para `bloquear`; armar `bloquear` tem carência de 72h; piso de US$ 1,00 para sair de `off`; **ninguém é bloqueado no mesmo mês sem ter sido avisado primeiro**. Quando bloqueado, a conversa em andamento **vai para a fila humana** — nunca fica sem dono. Existe também um kill switch de instalação inteira (`AI_BUDGET_ENFORCEMENT` no `.env`), que só sabe **afrouxar**, nunca apertar — proteção contra um typo derrubando o produto.

**Furo conhecido e documentado no próprio código:** o cálculo de custo casa `model` por prefixo contra 3 famílias Anthropic; um id de gateway (`anthropic/claude-sonnet-4-6`) ou da OpenRouter (`z-ai/glm-4.7`) não casa nenhuma, e custo desconhecido é tratado como **zero** — instalações usando esses formatos de id podem gastar dinheiro real sem o teto nunca disparar. A API expõe um campo `gasto_incompleto: boolean` para a tela não fingir uma proteção que não está acontecendo. **Vale a pena verificar isso pessoalmente se você configurar orçamento e usar OpenRouter.**

### 7.7 Flywheel de auto-aprimoramento

Existe uma contradição de sinal entre documentos: o roadmap do README lista "flywheel" em "Próximo (não iniciado)", mas `docs/current-state.md` também lista "propostas do flywheel com gate humano" como entregue. **A realidade, confirmada em código (`lib/agent-engine/flywheel/live.ts`):** existe uma versão **funcional e ligada** — um "juiz" (LLM) avalia turnos recentes numa dimensão (hoje: `memory_hygiene` — o agente preservou os fatos duráveis da conversa?), e quando reprova, um "destilador" propõe **um bullet de melhoria de prompt**. **Gate humano inegociável**: as propostas nunca viram comportamento sozinhas — precisam de aprovação manual pela tela. O que ainda não existe é a versão "pública"/mais ampla do roadmap.

### 7.8 Providers de IA e fallback

**Não há fallback automático entre providers diferentes** (diferente do que specs antigas descreviam). 4 providers suportados: Anthropic, OpenAI, Google, e OpenRouter (adicionado depois, fala API compatível com OpenAI). Cadeia de resolução de credencial: chave BYOK da própria organização → chave de plataforma do mesmo provider no `.env` da instalação → erro tipado se nenhuma existir. Se a organização escolheu um modelo Anthropic e só tem chave OpenAI, a chamada **falha**, não migra silenciosamente.

**Seleção de modelo por "ponto de IA"** com precedência de 5 origens (do mais forte ao mais fraco): agente publicado → binding explícito na tela de Provedores → variável de ambiente → herança de quem chamou → padrão da organização. A API sempre devolve a origem junto com o valor, para a tela responder "por que este modelo está sendo usado aqui".

---

## 8. WhatsApp — WAHA e canais

### 8.1 WAHA — o canal principal

WAHA Plus é uma API **não-oficial** (engenharia reversa do WhatsApp Web), sem SLA com a Meta. Isso é tratado como o maior risco operacional do produto: **"não há fix técnico pós-banimento — só prevenção"**. Toda a engenharia de anti-banimento existe por causa disso.

- **Engine**: NOWEB é o default (mais leve, sem Chromium); WEBJS só quando a feature exige (stickers animados, botões interativos).
- **Auth**: `WAHA_API_KEY` é o plaintext usado pelo app; o container WAHA recebe o **hash SHA512 hex** dessa chave.
- **Multi-sessão**: 1 sessão = 1 número = 1 registro em `channel_sessions`; um tenant pode operar 2+ números simultâneos.
- **Webhooks**: HMAC-SHA512, comparação timing-safe, corpo lido cru antes de qualquer parse. Todo webhook é logado primeiro (`webhook_events_log`, append-only) antes de qualquer processamento de domínio — isso é a fonte de verdade para debug/replay.
- **Multi-device**: assina `message.any` (não só `message`) para capturar mensagens enviadas pelo celular do atendente, fora do CRM — sem isso, o histórico ficaria incompleto.
- **Grupos**: mensagens de `@g.us` são persistidas mas **não** criam/atualizam lead (remetente real é `msg.author`, não `msg.from`) — evita "deal infinito" em grupo.

### 8.2 Anti-banimento — as regras exatas hoje (medidas em código, não na spec antiga)

| Regra | Valor atual |
|---|---|
| Throttle 1:1 | 1 msg/1.2s + jitter até 800ms |
| Janela de horário | 7h–22h, `America/Sao_Paulo` |
| Domingo | **Liberado por padrão** desde 2026-08-20 (documentação antiga ainda diz "evitado por default" — está desatualizada) |
| Warm-up (por idade do número) | 0 dias→20/dia, 4 dias→50/dia, 8 dias→100/dia, 15 dias→200/dia, 31+ dias→sem cap |
| Campanha em lote | 1 msg/5s + jitter |

**Spinning de copy evoluiu**: a spec antiga descrevia um DSL estático de campanha (`{opção1|opção2}`). O código atual é um **gate de similaridade em tempo real** sobre o que o próprio agente de IA gera: janela das últimas 20 mensagens outbound do número, similaridade Jaccard ≥0.8 conta como quase-idêntica, 2 repetições na janela → a 3ª é vetada. Mensagens utilitárias curtas e links de pagamento são isentos.

### 8.3 Detecção de STOP / opt-out — regra atual

Fonte única: `lib/opt-out/deteccao.ts` (substituiu duas regras divergentes que existiam em lugares diferentes). **Dois níveis**:

1. **Inequívoco** — autoriza bloqueio automático (`contacts.is_blocked=true`). Só dispara quando a mensagem inteira é **uma palavra isolada** (`stop`, `parar`, `sair`, `cancelar`, `descadastrar`...) ou um **verbo de cessação + objeto de comunicação** explícito ("parar de me mandar", "sair da lista").
2. **Ambíguo** — não bloqueia sozinho, só faz o agente parar e escalar a um humano decidir.

**Por que mudou:** a regra antiga (palavra em qualquer posição) bloqueava, medido numa clínica real, um paciente perguntando "tem como parar a dor?" — 12 falsos positivos num corpus de 32 frases de nicho. Cobre PT-BR e ES (incluindo pronome preso ao infinitivo em espanhol: "escribirme").

### 8.4 Canais além do WAHA — achado importante não documentado nos PRDs

O código já define `ChannelProvider = "waha" | "meta_cloud" | "zernio" | "wacalls"`:
- **Meta Cloud API oficial** — canal WhatsApp Business oficial da Meta, com templates aprovados/sincronizados. Envs: `META_APP_ID`, `META_APP_SECRET`, `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_SYSTEM_USER_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN`.
- **Zernio** — canal via BSP intermediário. Envs: `ZERNIO_ACCOUNT_ID`, `ZERNIO_API_KEY`.
- **WaCalls** — chamada de voz WhatsApp, **desligada por padrão**. O próprio `.env.example` documenta o risco explicitamente: liga um segundo aparelho ao mesmo número por um caminho não-oficial, com risco de a **conta** (não só o aparelho) ser bloqueada. Cada organização precisa aceitar o risco explicitamente na tela.

---

## 9. Integrações externas

| Serviço | Para que serve | Obrigatório? |
|---|---|---|
| **Supabase** | Banco + Auth + Realtime + Storage | Sim, sempre |
| **WAHA** | Canal WhatsApp via QR | Sim, em produção (a menos que use só Meta Cloud) |
| **Upstash Redis** (ou `serverless-redis-http` local) | Rate limit + idempotência | Sim, em produção |
| **Um provider de IA** (Anthropic, OpenAI, Google, ou OpenRouter) | Resposta do agente, embeddings de RAG | Sim, pelo menos um |
| **Nuvemshop** | E-commerce: pedidos, produtos, webhooks LGPD | Opcional (`NUVEMSHOP_ENABLED`) |
| **Resend** | E-mail transacional (convite, export LGPD, alarme SLA) | Opcional — sem ela, o convite mostra o link na tela em vez de e-mail |
| **Sentry** | Observability, com scrub de PII embutido | Opcional |
| **Google Calendar** | Agenda (BYO OAuth) | Opcional — sem ela, o botão "Conectar Google" simplesmente não aparece |
| **Meta Cloud API** | Canal WhatsApp oficial | Opcional |
| **Zernio** | Canal via BSP | Opcional |
| **Web Push (VAPID)** | Notificação no SO com a aba fechada | Opcional |

**Nuvemshop em detalhe:** fluxo majoritariamente Nuvemshop → CRM (OAuth pull + 8 webhooks: `order/created|paid|cancelled|fulfilled`, `cart/abandoned`, `customer/redact`, `customer/data_request`, `store/redact`). Sync reverso (CRM → Nuvemshop) está fora de escopo deliberadamente. Tokens OAuth cifrados com chave própria (`NUVEMSHOP_OAUTH_ENCRYPTION_KEY`, separada da chave de CPF). Retry com backoff exponencial até ~4h, depois DLQ reprocessável manualmente.

**Resend em detalhe:** desligamento é gracioso e deliberado — sem chave, o sistema **não tenta enviar e não falha calado**: convite mostra link na própria tela, export LGPD fica `pending_review`. O nome de exibição do remetente segue a marca (branding); o endereço precisa ser de domínio verificado **na sua própria conta Resend**.

**MCP como integração de saída** — ver §7.4. É tecnicamente uma integração "de fora para dentro" pronta (agentes de terceiros podem em tese plugar), mas hoje sem onboarding de produto para isso.

---

## 10. Todas as variáveis de ambiente

Fonte: `lib/env.ts` (validação Zod, ~430 linhas) + `.env.example` (406 linhas). Notação: **sempre** = exigida mesmo em dev; **prod** = exigida só quando `NODE_ENV=production`; **opcional** = tem default seguro.

### Supabase e banco

| Variável | Obrigatoriedade | Para que serve |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | sempre | URL do projeto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sempre | Chave anônima (browser; RLS é o gatekeeper real) |
| `SUPABASE_SERVICE_ROLE_KEY` | sempre | Chave admin — bypassa RLS, só server |
| `SUPABASE_DB_URL` | prod | Conexão Postgres direta (worker do agent-engine — fila `FOR UPDATE SKIP LOCKED`) |
| `SUPABASE_DB_ADMIN_URL` | opcional | Só o **kit** (install/update/backup) usa — nenhum código do app lê isto |

### Segurança / criptografia

| Variável | Obrigatoriedade | Para que serve |
|---|---|---|
| `INTERNAL_SECRET` | prod | Bearer genérico interno (distinto da service role) |
| `INTERNAL_CRON_SECRET` | opcional | Segredo dedicado das rotas `/api/v1/cron/*`; cai para `INTERNAL_SECRET` se vazio |
| `CPF_ENCRYPTION_KEY` | prod | Cifra CPF em `contacts` (pgcrypto), rotação trimestral recomendada |
| `NUVEMSHOP_OAUTH_ENCRYPTION_KEY` | condicional | Cifra tokens OAuth Nuvemshop |
| `WAHA_BYO_ENCRYPTION_KEY` | prod | Cifra credenciais de cliente que roda WAHA próprio |
| `AI_CRED_AES_KEY` | prod | AES-256 (gerar com `openssl rand -base64 32`) — cifra API keys de LLM cadastradas pela tela |
| `LGPD_SIGNING_KEY` | opcional | Assina exports LGPD |
| `IMPERSONATE_COOKIE_SECRET` | opcional (mín. 32 chars) | HMAC do cookie de impersonate/suporte |

### WAHA / WhatsApp

| Variável | Obrigatoriedade | Para que serve |
|---|---|---|
| `WAHA_API_BASE_URL` | prod | URL da instância WAHA |
| `WAHA_API_KEY` | prod | Plaintext (o container recebe o hash SHA512) |
| `WAHA_HMAC_SECRET` | opcional | Verifica assinatura dos webhooks WAHA |
| `WAHA_WEBHOOK_REQUIRE_SIGNATURE` | opcional (default `false`) | Exige assinatura válida — desligado por padrão porque WAHA Core não assina |
| `WAHA_WEBHOOK_BASE_URL` | prod | URL pública que o WAHA chama de volta |
| `WHATSAPP_RESTART_ALL_SESSIONS` | opcional (default `True`) | Retoma sessões pareadas após restart do container |
| `WACALLS_API_BASE_URL` / `_API_TOKEN` / `_PUBLIC_IP` / `_WEBRTC_UDP_PORT` | opcional | Chamada de voz WhatsApp — desligada por padrão, risco de ban de conta |
| `META_APP_ID` / `_APP_SECRET` / `_WABA_ID` / `_PHONE_NUMBER_ID` / `_SYSTEM_USER_TOKEN` / `_WEBHOOK_VERIFY_TOKEN` / `_GRAPH_VERSION` | opcional | Canal oficial Meta Cloud API |
| `ZERNIO_ACCOUNT_ID` / `_API_KEY` / `_API_BASE_URL` | opcional | Canal via BSP intermediário |

### IA

| Variável | Obrigatoriedade | Para que serve |
|---|---|---|
| `AI_GATEWAY_API_KEY` / `_BASE_URL` | opcional | Vercel AI Gateway |
| `ANTHROPIC_API_KEY` | opcional | Chave direta Anthropic (fallback de plataforma) |
| `OPENAI_API_KEY` | opcional | Fallback de plataforma + embeddings RAG + transcrição de áudio |
| `OPENROUTER_API_KEY` / `_BASE_URL` / `OPENROUTER_APP_URL` / `_APP_TITLE` | opcional | Alternativa ao Gateway; atribuição opcional de app |
| `AI_BUDGET_ENFORCEMENT` | opcional (default `on`) | Kill switch de instalação do teto de gasto — só afrouxa (`on`/`avisar`/`off`) |
| `AGENT_DISPATCH_CONSUMER` | opcional (default `engine`) | Dono único do consumo de despacho do agente — nunca os dois ativos |
| `AI_ALLOWLIST_TTL_DAYS` | opcional (default 21) | Validade da elegibilidade de IA por origem do lead em canais restritos |
| `INTERNAL_AGENT_RUN_STUB` | opcional (default `false`) | Deixe `false` — `true` só serve para testar UI sem gastar token |
| `FLYWHEEL_INTERVAL_MS` / `_BATCH_LIMIT` | opcional | Ritmo do flywheel agendado (0 = desligado) |
| `WATCHDOG_INTERVAL_MS` / `_REDRIVE_BATCH_SIZE` | opcional | Reconciliação de sessão travada em `queued` |

### Redis / filas

| Variável | Obrigatoriedade | Para que serve |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | prod | Rate limit + idempotência + debounce de RAG |
| `EVENT_LOG_DRAIN_INTERVAL_MS` / `_IDLE_INTERVAL_MS` / `_BATCH_SIZE` | opcional | Ritmo do worker drenando `event_log` |
| `QUEUE_POLL_INTERVAL_MS` (não passe de 10000) / `QUEUE_CLAIM_RETRY_INTERVAL_MS` | opcional | Ritmo da fila do agent-engine — custo de banco |

### LGPD e retenção

| Variável | Obrigatoriedade | Para que serve |
|---|---|---|
| `LGPD_DPO_EMAIL` | opcional | E-mail do Encarregado, impresso no relatório LGPD |
| `LGPD_EXPORT_EXPIRES_HOURS` | opcional (default 72) | TTL da URL assinada de export |
| `AUDIT_LOG_RETENTION_DAYS` | opcional (default 1825 = 5 anos, piso 90) | Retenção do `api_audit_log` |
| `JOB_QUEUE_RETENTION_DAYS` | opcional (default 90, piso 7) | Retenção de jobs terminais |
| `WEBHOOK_LOG_BODY_RETENTION_DAYS` | opcional (default 7) | Corpo cru de webhook — chegou a ser 86% do banco numa instalação real |
| `WEBHOOK_LOG_ROW_RETENTION_DAYS` | opcional (default 90) | A linha do log em si |
| `LEAD_CAPTURE_RETENTION_DAYS` | opcional (default 365, piso 30) | Histórico de leads captados por webhook |

### E-mail, branding, app

| Variável | Obrigatoriedade | Para que serve |
|---|---|---|
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | opcional | E-mail transacional — vazio = degrada graciosamente (não falha) |
| `SUPPORT_EMAIL` | opcional | E-mail mostrado ao cliente final em tela de conta suspensa |
| `SENTRY_DSN` | opcional | Observability — `off` desliga explicitamente |
| `APP_NAME` / `APP_LOGO_URL` / `APP_ACCENT_HEX` | opcional | Semente de marca — banco manda depois da 1ª leitura |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_ADMIN_URL` | opcional (default localhost) | URLs canônicas |
| `APP_LOCALE` | opcional (default `pt-BR`) | Idioma de nascimento da instalação — não muda runtime |
| `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` | opcional | Web Push |
| `GOOGLE_CALENDAR_CLIENT_ID` / `_CLIENT_SECRET` | opcional | Agenda BYO — sem elas, botão "Conectar Google" some |
| `NUVEMSHOP_ENABLED` / `_APP_ID` / `_CLIENT_ID` / `_CLIENT_SECRET` | opcional | Integração Nuvemshop |
| `AUTH_RATE_LIMIT_LOGIN_IP` | **NÃO use em produção** | Só para CI de e2e — folga o teto de tentativa por IP |

**Nota de doutrina do próprio `lib/env.ts`:** vários knobs (retenção, `AI_BUDGET_ENFORCEMENT`) usam validação frouxa de propósito — valor inválido nunca derruba o boot do app com 500, cai no default e avisa. É proteção deliberada contra um operador leigo digitando errado às 2h da manhã.

---

## 11. LGPD

**Princípio central: anonimização preferida sobre delete físico.** Nome/telefone/e-mail viram "Cliente Anonimizado #N", preservando histórico de vendas/faturamento. Delete físico só no caso raro de contato sem nenhuma dependência.

**Irreversibilidade**: uma vez anonimizado, qualquer tentativa de reverter retorna `403 lgpd_anonymization_irreversible` — decisão deliberada, a LGPD trata o direito ao esquecimento como definitivo.

**SLAs**: exportação de dados (`data_request`) em **D+7**; redação/anonimização (`redact`) em **D+15**, ambos com alarme antes do vencimento.

**Cascade de anonimização**: contact (PII → token) → conversations (timestamps preservados) → messages (mídia **sempre** removida do storage) → activities (tipos/timestamps preservados, payload sensível redacted).

**Consentimento granular** por 3 finalidades independentes (`marketing`, `transactional`, `profiling`), cada uma com `{granted_at, source, version}`.

**⚠️ Retenção "cold storage S3" — não existe.** Vários PRDs antigos (00, 01, 05) descrevem uma arquitetura de "hot 90 dias + cold storage S3" para o audit log. **Isso nunca foi construído** — auditoria de 2026-08-14 confirmou zero ocorrência de arquivamento em código. Um self-host não tem para onde arquivar (o Storage do cliente é a mesma cota de 1GB dividida com mídia de WhatsApp). O modelo real: retenção de 5 anos configurável, piso rígido de 90 dias embutido na função de expurgo `fn_expurgar_auditoria_vencida` — nem com a chave de serviço se apaga rastro mais recente que isso por esse caminho.

**Append-only é do schema, não da prosa**: nenhum papel tem GRANT de UPDATE/DELETE em `api_audit_log`, nem `service_role`. Ressalva técnica registrada na doutrina: `TRUNCATE` **está** concedido a `anon`/`authenticated`/`service_role` (resíduo do dump do schema) — não alcançável via REST (PostgREST não emite TRUNCATE), mas é uma ressalva que vale conhecer.

**Webhooks LGPD da Nuvemshop** (3 obrigatórios): `customer/redact`, `customer/data_request`, `store/redact` — todos validados por HMAC com secret próprio por tenant.

**O relatório de LGPD (PDF) nunca leva marca** — nem a do produto, nem a de um revendedor. Nomeia o **controlador** (razão social da organização) e o DPO — decisão de produto, não item esquecido: num documento que responde a direito legal, quem é nomeado responde pelos dados.

---

## 12. White-label / revenda

Se você (ou sua empresa) pretende instalar isto para clientes, esta seção é o ponto de partida — mas leia `docs/white-label.md` na íntegra antes de vender.

**Trocar marca pela tela** (`/admin/marca`), sem redeploy: nome, cor (derivada automaticamente em 11 tons com piso de contraste calculado — a tela avisa antes de salvar se a cor ficaria ilegível) e logo (upload direto, validado pelos **bytes reais**, não pela extensão — SVG é recusado porque pode carregar script executável num bucket público).

**Uma imagem Docker serve qualquer marca** — a marca é lida em runtime do banco (`platform_branding` + `organizations.settings.branding`), nunca embutida na build.

**Marca por organização** (dentro de uma instalação multi-tenant): cada org pode ter nome/cor/logo próprios em `Configurações → Marca`. Fronteira deliberada:

| Onde | Qual marca aparece |
|---|---|
| Login, cadastro, recuperação de senha | Da **instalação** |
| Dentro do sistema, após login | Da **organização** (ou da instalação, se a org não tiver) |
| E-mails de acesso (Supabase/GoTrue) | Da **instalação** — script dedicado `marca-emails.sh` empurra isso |
| Convite de time, e-mails LGPD | Da **organização** que originou |
| Relatório de LGPD (PDF) | **Nenhuma marca** — nomeia o controlador |

**O que ainda não é configurável por organização**: domínio (uma instalação = um domínio; cliente que exige domínio próprio precisa de instalação dedicada), fonte tipográfica, tema claro/escuro (a marca move só o accent), o alarme de orçamento de IA (ainda sai com a marca do produto — vazamento conhecido e aceito porque esse alarme não tem cron ligado hoje).

**Dois modelos de deploy para revenda:**

| | Uma VPS por cliente | Uma VPS para todos |
|---|---|---|
| Marca | Completa, inclusive login | Sua no login; da org dentro |
| Isolamento | Físico | RLS, testado em CI |
| Falha | Isolada | Atinge todos |
| Melhor para | Revender com marca do cliente | Sua própria operação com várias contas |

**⚠️ Nunca troque a marca editando código** (`DEFAULT_APP_NAME` em `lib/branding.ts`, títulos hardcoded) — some no próximo `update.sh`, e há um teste de CI (`tests/unit/branding.test.ts`) que varre vazamento de marca hardcoded no código.

---

## 13. Deploy, packaging e operação

### 13.1 A doutrina central: nada compila na VPS do cliente

Princípio-raiz: "o artefato que a pessoa instala é o produto; o repositório é a receita". **3 imagens Docker publicadas pelo CI**, versionadas juntas: `deskcommcrm` (app), `deskcomm-worker` (runtime do agente de IA — 24/7, fora do request HTTP), `deskcomm-scheduler` (cron). Dependências upstream (WAHA, Redis, Caddy, `serverless-redis-http`) são sempre **referenciadas com tag/digest pinado**, nunca republicadas (WAHA é licenciado — republicar seria passivo jurídico).

**Anti-exemplo real que originou essa doutrina** (bug de produção de 2 meses, atingiu toda instalação existente): o serviço `worker` não tinha `image:`, só `build:` — era compilado na VPS no dia da instalação e **nenhum `update.sh` jamais o reconstruía**. O runtime do agente de IA congelava no código do dia 0. Corrigido em 2026-08-13.

### 13.2 `docker-compose.prod.yml` — os serviços

| Serviço | Função | mem_limit |
|---|---|---|
| `app` | CRM (Next.js standalone) | 768m |
| `worker` | Runtime 24/7 do agente de IA | 512m |
| `waha` | Motor WhatsApp | 1280m |
| `redis` | Rate limit/debounce (efêmero) | — |
| `srh` | `serverless-redis-http` (fala protocolo REST do Upstash sobre o Redis local) | — |
| `scheduler` | Cron sem `docker.sock` (busybox `crond` batendo `curl` em `/api/v1/cron/*`) | — |
| `wacalls` | Voz WhatsApp — **desligado por padrão** (`profiles: ["voz"]`) | 256m |
| `caddy` | Reverse proxy, HTTPS automático (único que publica portas 80/443 na topologia padrão) | — |

Todo serviço leva `mem_limit` explícito — sem teto, um contêiner sozinho pode consumir toda a RAM e o OOM killer mata por "quem cresceu mais rápido", não por importância.

### 13.3 Instalar do zero

```bash
git clone https://github.com/<seu-fork>.git
cd <pasta>
bash hostgator-setup-kit/install.sh
```

Idempotente (pode rodar de novo sem quebrar). Pergunta domínio, chaves, senha do admin; gera segredos técnicos sozinho; cria extensões do Postgres e aplica `supabase/baseline.sql` (**nunca** a cadeia de `supabase/migrations/` — ela não sobe em banco novo, quebra na migration 0010); cria o primeiro admin; sobe a stack com HTTPS automático. Detecta proxy reverso já existente na VPS (Traefik, CloudPanel/Nginx) e se adapta.

**O que você precisa ter em mãos**: VPS com Docker (4GB RAM recomendados), domínio com registro A, conta Supabase (gratuita serve para começar — 3 chaves + connection string do **Session pooler**, não "Direct connection"), uma chave de IA (OpenRouter, Anthropic ou OpenAI), e seu número de WhatsApp para escanear o QR.

### 13.4 Atualizar

**Pela tela** (recomendado, sem SSH): rodapé do menu lateral acende "Nova versão" para o dono do servidor; clique cai em Configurações → Atualização, que faz backup sozinho e acompanha cada fase. Se a versão nova subir quebrada, reverte sozinho para a imagem anterior. Por baixo, um agente que o `install.sh` deixou na VPS confere a cada 5 minutos.

**Pelo terminal**:
```bash
bash hostgator-setup-kit/update.sh
```
Ordem: confere versão nova → **backup do banco antes de tocar em qualquer coisa** → baixa código novo → reaplica `baseline.sql` (idempotente, auto-curativo) → puxa imagem nova → confere saúde.

**Regra inegociável**: bump de versão **nunca** pode exigir que você edite `.env`/compose à mão. Se exigir, vira issue com plano de migração, não entra como PR normal.

### 13.5 A pegadinha nº 1 de produção — o segundo `-f`

Numa VPS com proxy reverso próprio (Hostinger, Coolify, Dokploy, CloudPanel), **todo** `up -d` precisa dos dois arquivos:
```bash
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```
Omitir o segundo `-f` recria o contêiner sem as labels de roteamento — **o domínio inteiro responde 404**, com o contêiner marcado `healthy` (o healthcheck é um probe TCP interno cego a roteamento). Verificação pós-deploy: domínio deve responder **307** (redireciona ao login), não 404.

### 13.6 Versionamento

| Tag | Quem consome | Move? |
|---|---|---|
| `1.2.1` (número) | Toda instalação de cliente | Não — imutável |
| `stable` | Quem valida antes de propagar a clientes | Sim — última release publicada |
| `latest` | Vitrine/avaliação | Sim — **topo da `main`, não a última release** (pegadinha do nome) |
| `main` | Mantenedor e CI | Sim |

**Regra de ouro:** "instalação que alguém pagou aponta para número de versão. Ponto."

### 13.7 CI/CD — o que cada check verifica

| Workflow/job | O que faz |
|---|---|
| `verify` (`ci.yml`) | typecheck + lint + `lint:channels` + `lint:role-rank` + `test:unit` + `test:shell` |
| `invariants` (`ci.yml`) | `pnpm test:db` — Postgres efêmero, aplica `baseline.sql` install+update, roda isolamento RLS |
| `build-and-size` (`perf.yml`) | `pnpm build` em Node 22 |
| `e2e` (`e2e.yml`) | Sobe Supabase local, roda specs Playwright pelo frontend, dividido em 3 partes por matrix |
| `imagens-ok` (`publish-image.yml`) | Reprova se qualquer uma das 3 imagens Docker não constrói **ou não sobe de verdade** (já houve caso de imagem que construiu, publicou, e entrou em crashloop na VPS) |

**Specs E2E fora do CI hoje** (medido diretamente no workflow, não confie em número — reconfira com o comando abaixo): `vps-fresh-onboarding` (a jornada de instalação fresca — a **P0** da doutrina de QA visual; `e2e` verde **não prova** essa jornada), `inbox-tempo-real`, `cadastro-sem-confirmacao-de-email`.

```bash
git show origin/main:.github/workflows/e2e.yml | python3 -c "import sys,re; y=sys.stdin.read(); print(sorted({s for _,c in re.findall(r'(FORA_DO_CI):\s*>-\n((?:[ ]{8,}.*\n)+)',y) for s in re.findall(r'[a-z0-9-]+\.spec\.ts',c)}))"
```

**Checks obrigatórios na branch protection — não pude confirmar neste ambiente** (o `gh` CLI não está instalado; a API REST exige autenticação mesmo para repositório público). Quando tiver `gh auth login` disponível:
```bash
gh api repos/<owner>/<repo>/branches/main/protection --jq '.required_status_checks.contexts'
```

### 13.8 Custo/cota do Supabase (plano free)

Plano free: 500MB de banco, 5GB de egress/mês. As duas tabelas que crescem sozinhas são `job_queue` e `api_audit_log` — um cron `data-retention` diário poda em lotes (nunca um `DELETE` único, que travaria a tabela). `DELETE` não encolhe o banco visivelmente (o espaço vai para reuso do Postgres, não do sistema de arquivos) — o painel do Supabase mostra o tamanho antigo até as linhas novas ocuparem os buracos; isso é normal.

`QUEUE_POLL_INTERVAL_MS` nunca deve passar de 10000 — acima disso a conexão ociosa expira e cada rodada volta a pagar TCP+TLS, gastando **mais**, não menos.

---

## 14. Testes e verificação

```bash
pnpm typecheck   # tsc --noEmit (estrito)
pnpm lint        # eslint
pnpm test:unit   # Vitest — CUIDADO: sem caminho, alcança o repo inteiro (não só tests/unit/)
pnpm test:db     # Postgres efêmero + baseline install/update + invariantes
pnpm test:e2e    # Playwright (requer dev server)
```

**Armadilha nº 1**: `test:unit` **não é** `tests/unit/`. O script é `vitest run` sem caminho, e alcança o repositório inteiro (código co-localizado em `lib/`, `app/`, `components/`, `hooks/` também tem `.test.ts`). Rodar `vitest run tests/unit` dá um verde menor e mais fácil, sem você perceber que restringiu o escopo.

**Armadilha nº 2**: `pnpm gov:verify` (`typecheck && lint && lint:channels && lint:role-rank && test:unit`) **não** é o comando único que aparenta ser — **omite `test:db` e `test:e2e`**. Verde no `gov:verify` local não prova nada sobre RLS ou sobre a UI.

**Armadilha nº 3**: ao rodar a suíte, não corte a saída (`| tail -8`) — isso descarta os nomes dos arquivos que falharam. Redirecione para arquivo e confira o rodapé (`Test Files N failed`, `Tests N failed`), não um `grep FAIL` isolado (em execução sem TTY, o reporter às vezes não imprime nomes de arquivo mesmo com falhas reais).

**Quando rodar `test:db` de verdade**: ao mexer em schema, RLS, RBAC, atribuição, escopo, roteamento, follow-up, webhooks ou automações. É o único caminho que exercita o `baseline.sql` que um self-hoster de fato aplica.

---

## 15. Segurança — superfície de ataque

Fonte: `docs/threat-model.md` (auditado contra commit de 2026-07-27, então parte do texto já foi corrigida depois — sinalizado abaixo).

**Premissa central**: o atacante tem o código-fonte completo (produto open source) — segurança por obscuridade vale zero. O operador típico é PME sem equipe de segurança.

**Prioridade de risco (na data da auditoria, com correções já aplicadas onde indicado):**

| # | Risco | Severidade | Status |
|---|---|---|---|
| T1 | Sem rate limit em login/signup/convite | 🔴 | **Corrigido depois da auditoria** — `lib/auth/rate-limit.ts` existe hoje (5 tentativas/identificador/300s) |
| T2 | Rate limit degrada silenciosamente para memória sem Upstash | 🟠 | Aberto — comportamento esperado, mas silencioso além de um log |
| T3 | 89+ handlers com service role, sem gate automático de escrita indevida | 🟠 | Mitigado por 200+ arquivos de invariante em CI, mas sem lint que bloqueie handler novo nascendo errado |
| T7 | Sem gitleaks/trufflehog no CI | 🟡 | Aberto |
| T6 | Guard de SSRF em webhook de saída | 🟢 | Existe e é bem feito, com E2E dedicado |

**Conclusão do próprio documento** (vale reter): "os mecanismos de segurança são acima da média para um CRM open-source... não há falha de desenho aqui; há uma camada ausente, e ela é a mais barata de todas as que já foram construídas."

**Ponto notável de storage**: o bucket `brand-logos` é o **único** bucket público do Storage (os outros 4 nascem privados) — decisão deliberada (o logo precisa aparecer na tela de login sem sessão), mitigada por caminho não-enumerável, teto de 512KB, checagem de bytes reais (não extensão), e proibição explícita de SVG.

---

## 16. Estado real medido agora (2026-09-15)

**HEAD atual**: `60079eb5` (2026-09-14 19:06 -03), versão `1.23.0` (do CHANGELOG — não há tags git neste clone).

**Distância do último retrato oficial** (`docs/current-state.md`, base `789dfa6`, 2026-07-29): **3039 commits** e ~150 migrations à frente. Trate qualquer número desse documento (e de `docs/harness-audit.md`) como histórico, não atual.

**Números medidos agora, com o comando usado:**

| Métrica | Comando | Valor |
|---|---|---|
| Arquivos TS/TSX de produção | `git ls-files 'app/**/*.ts(x)' 'lib/**/*.ts(x)' 'components/**/*.ts(x)' 'workers/**/*.ts' \| wc -l` | **1779** |
| Route handlers | `git ls-files 'app/api/**/route.ts' \| wc -l` | **274** |
| Migrations `.sql` | `ls supabase/migrations/*.sql \| wc -l` | **231** |
| Testes de invariante | `git ls-files 'tests/invariants/*.ts' \| wc -l` | **201** (196 são `.test.ts`) |
| Specs E2E | `git ls-files 'tests/e2e/*.spec.ts' \| wc -l` | **107** |
| Docs `.md` em `docs/` | `git ls-files 'docs/**/*.md' \| wc -l` | **171** |
| Arquivos `*.test.ts(x)` no repo inteiro | `git ls-files '*.test.ts' '*.test.tsx' \| wc -l` | **1046** (bruto — não confunda com o que `test:unit` de fato executa) |

**Modo de trabalho atual do projeto**: **não é mais o gov-loop autônomo** nem épicos solo via HANDOFF. `plan/features.json` (31/31 features `passes: true`) está **parado desde 2026-07-18** — é um artefato congelado de um épico já fechado (Governança de Atendimento G1-G6), não trabalho em andamento. Os últimos 30 commits são dominados por **triagem de PRs de contribuidores externos** (lotes de 5, 11, 28 PRs de várias pessoas) e releases automatizadas por fragmento (`.changes/`).

**Fragmentos `.changes/` pendentes** (ainda não incorporados a um release — indicam que o próximo será `1.24.0`, minor, por ter 1 fragmento `capacidade_nova`):
- Dono passa a ver, por cliente, qual agente está publicado (`capacidade_nova`)
- Vários `nada_mudou`: correção de anúncio de mensagem vazia quando havia transcrição; hub de IA respeitando idioma; validação de grafo de follow-up corrompido; encoding cp1252 na base de conhecimento; canal não volta sozinho ao modo de teste

**Épicos "em voo" (HANDOFF-*.md na raiz) — status da cauda de cada um:**

| Arquivo | Status |
|---|---|
| `HANDOFF-operacao-visivel.md` | Fechado — 4/4 features provadas em paridade local↔VPS |
| `HANDOFF.md` (follow-up) | Onda 8 com todas as tasks marcadas concluídas |
| `HANDOFF-harness-evolution.md` | Fechado, com aviso operacional residual (não é bug de produto) |
| `HANDOFF-tres-papeis.md` | Entregue; 2 bugs conhecidos e não investigados (deletar organização/agente dono de lead falha por FK) |
| `HANDOFF-ia-360.md` | Fechado, com autocorreções registradas no próprio documento |
| `HANDOFF-conversa-vira-lead.md` | Entregue; achou e corrigiu 3 defeitos críticos (vazamento cross-tenant, 500 ao salvar e-mail, anonimização LGPD que não acontecia) |
| `HANDOFF-fv-w1-fila.md` | Um conserto de teste flaky ficou pendente de confirmação de commit |
| `HANDOFF-sistema-vivo-consertos.md` | Vários itens ainda pendentes (P3, P4, P5 inteiros; um plano reprovado pelo revisor cético) |
| `HANDOFF-followup-vivo.md` | Gatilho de "caso aberto" entregue; possível fechamento parcial na migration 0242 (não confirmado) |
| `HANDOFF-marca-propria.md` | Investigação de E2E flaky com causa raiz não medida (erro de auth engolido em silêncio) |
| `HANDOFF-handoff-avisa-o-lead.md` | Publicado v1.6.0; entrega real num WhatsApp físico não foi confirmada (só prova sintética) |
| **`HANDOFF-silencio-retomada-humana-nao-gruda.md`** | **⚠️ ABERTO — bug de produção não resolvido**, entrada mais recente (2026-09-03) de todos os HANDOFFs |

**O bug mais importante em aberto hoje:** `bot_silenced_until` (o campo que mantém o bot calado depois de handoff humano) não "gruda" numa conversa real sob alta concorrência (9 mensagens em 20 min), mas reproduz perfeitamente quando isolado. 8 hipóteses já eliminadas com evidência; a hipótese restante não foi verificada por falta de acesso aos logs internos do painel Supabase na sessão que investigou. **Vale investigar isso cedo** se seu volume de mensagens for alto — é exatamente o tipo de bug que aparece sob carga real e não em teste.

**O que não pude medir**: se `pnpm test:unit`/`test:db`/`test:e2e` estão passando agora de fato (exigiria rodar, não só ler), e os checks obrigatórios reais da branch protection (exige `gh` autenticado).

---

## 17. Divergências entre documentação e código — cuidado com isso

Este projeto tem uma cultura documental excepcionalmente honesta (docs que se autocriticam, avisam sobre sua própria data de validade), mas isso não impede que documentos envelheçam. Lista consolidada do que os agentes de pesquisa encontraram divergente **entre um doc e outro**, para você não ser pego de surpresa:

| # | Ponto | Doc desatualizado | Fonte correta |
|---|---|---|---|
| 1 | MFA obrigatório vs. opcional | PRDs 00/01, `docs/white-label.md` | `CLAUDE.md` — MFA é opcional hoje, duas políticas somando, default "não exigir" |
| 2 | Cold storage S3 para audit log | PRDs 00/01/05 | `CLAUDE.md` — nunca foi construído; retenção 5 anos, sem cold storage |
| 3 | Domingo bloqueado por padrão no WhatsApp | `docs/prd/03` | Liberado por padrão desde 2026-08-20 |
| 4 | Orçamento de IA — "pausar em 100% por padrão" | catálogo de regras de negócio antigo | Modelo real é escada `off`/`avisar`/`bloquear`, com `off` como padrão de 100% das instalações |
| 5 | "Casos Humanos" como "pré-implementação" | `docs/specs/15` (cabeçalho) | Já está em produção — outra spec trata `agent_cases` como existente |
| 6 | Três papéis do agente como arquitetura totalmente pronta | `docs/specs/16` (tabela de status) | Está mais avançado do que a própria tabela da spec diz — confira em código |
| 7 | Rate limit "sliding window" | `CLAUDE.md`, `ARCHITECTURE.md` (texto antigo) | É janela fixa (`INCR`+`EXPIRE`), não sliding window |
| 8 | "MCP público" listado como "não iniciado" | README roadmap, `docs/current-state.md` | O servidor MCP já roda em produção internamente — falta só onboarding para terceiros |
| 9 | Flywheel listado como "não iniciado" | README roadmap | Versão funcional já ligada (júri + destilador), com gate humano — falta a versão "pública" mais ampla |
| 10 | Runtime "Vendaval" como serviço externo | specs 05/10/11/12/14 (texto original) | Fundido para dentro do repo como `lib/agent-engine/` desde 2026-07-17 — **nunca reverta isso** |
| 11 | Gatilho de handoff por "sentimento baixo" (G2) | `docs/prd/05` | Não encontrado implementado no runtime atual — trate como possivelmente descontinuado |
| 12 | Fallback automático entre providers de IA | `docs/prd/05` (texto original) | Não existe hoje — falha se a org não tem chave do provider escolhido |
| 13 | "Idempotency-Key cobre POSTs de criação" | `ARCHITECTURE.md` (texto antigo) | Cobertura real é parcial (poucas rotas) |
| 14 | Números de checks obrigatórios de CI ("quatro", "três") | Várias versões antigas de `CLAUDE.md`/`CONTRIBUTING.md` | Sempre meça com `gh api .../branches/main/protection` — o próprio repo já errou esse número repetidas vezes |

**Lição prática**: este repositório tem uma convenção forte de "meça, não confie na prosa" — vários documentos terminam com o comando exato para reconferir a si mesmos. Adote o mesmo hábito.

---

## 18. Como tomar conta a partir de agora

Ordem sugerida, pensada para quem está assumindo o sistema sem ter escrito uma linha dele:

### Passo 1 — Rodar local e ver funcionando (meio dia)

```bash
nvm use                          # Node 22
pnpm install
cp .env.example .env.local       # preencha aos poucos — docs/SETUP.md é o guia completo
docker compose --env-file .env.local up -d   # WAHA local, opcional sem WhatsApp
pnpm dev
```
Health check: `http://localhost:3000/api/v1/health`. Detalhes de cada integração (Supabase, WAHA, IA, Upstash, Sentry, Resend, Nuvemshop): `docs/SETUP.md` (~60-90 min do zero ao app rodando).

**Duas armadilhas reais, resolvidas na prática em 2026-09-15 (não estão nos docs oficiais):**

1. **`docker compose up -d` sozinho falha** com `env file .env not found`. O `docker-compose.yml` tem um serviço (`worker`) que declara `env_file: .env, .env.local` — o primeiro precisa **existir** (pode ser vazio; os valores reais ficam no `.env.local`, que não é commitado). Crie um `.env` vazio na raiz se não tiver, e sempre use `docker compose --env-file .env.local up -d` (nunca só `up -d`, senão o compose ignora o `.env.local` pra interpolar `${WAHA_API_KEY_SHA512}` etc. no `docker-compose.yml`).
2. **WAHA local devolve 401 em toda chamada mesmo com a chave certa.** A doutrina do projeto (`CLAUDE.md`) descreve WAHA **Plus**: cliente manda a chave em texto puro no header `X-Api-Key`, o servidor guarda o **hash SHA-512** e compara. A imagem gratuita que o `docker-compose.yml` de dev usa (`devlikeapro/waha:noweb`) **não faz esse hash** — ela compara o header literalmente com o valor de `WAHA_API_KEY` do container. Solução prática pra dev local: deixe `WAHA_API_KEY` (o que o app manda) e `WAHA_API_KEY_SHA512` (o que o container do WAHA compara) com **o mesmo valor literal** no `.env.local`, sem se preocupar com hash nenhum. Depois de mudar, recrie o container (`docker compose --env-file .env.local up -d --force-recreate waha`) e reinicie o `pnpm dev` — os dois só leem env na inicialização.

### Passo 2 — Ler a doutrina não-negociável (2-3h, mas é o que evita erro caro depois)

- `CLAUDE.md` — convenções, anti-patterns, Definition of Done. É a lei do projeto.
- Este manual (você já está aqui) — para o panorama.
- `docs/threat-model.md` — o que pode dar errado de segurança.
- `docs/doctrine/packaging.md` — se você for tocar Docker/deploy.

### Passo 3 — Decidir seu caminho de instalação

- **Só quero usar internamente**: siga `docs/deploy-hostgator/README.md` ou `docs/deploy-selfhost/README.md` — VPS com Docker + Supabase + domínio + chave de IA, `bash hostgator-setup-kit/install.sh`.
- **Quero revender/white-label**: leia `docs/white-label.md` inteiro antes de vender qualquer coisa — principalmente a seção sobre o relatório de LGPD (nunca leva sua marca) e a diferença entre "uma VPS por cliente" e "uma VPS para todos".

### Passo 4 — Investigar o bug em aberto antes de depender de volume alto

O `HANDOFF-silencio-retomada-humana-nao-gruda.md` descreve um bug de produção real (bot reassume sozinho sob concorrência) que não foi fechado. Se seu volume de mensagens vai ser alto desde o início, vale a pena revisar isso — ou pelo menos monitorar `bot_silenced_until` de perto nas primeiras semanas.

### Passo 5 — Configurar o agente de IA com cuidado no orçamento

Antes de ligar o agente para um volume real, configure o teto de gasto (`Uso de IA → Orçamento`) e **confirme o formato do `model` que você está usando** se optar por OpenRouter ou por um id de gateway — há um furo conhecido onde custo não-reconhecido é tratado como zero (§7.6). Comece em modo `avisar`, não `bloquear`, até confiar no número.

### Passo 6 — Se for operar um nicho fora de e-commerce

Configure manualmente o vocabulário e as etapas do funil (`Funis` na tela) — o pipeline padrão que nasce com a organização é de e-commerce, e não há hoje um template pronto para outros nichos (está no roadmap "Próximo", não entregue). As skills `.agents/skills/deskcomm-cliente-novo/` ajudam a montar isso guiado.

### Passo 7 — Se algum dia quiser contribuir de volta ao upstream

Não é obrigatório (a licença MIT não exige), mas se decidir fazer, siga à risca `CONTRIBUTING.md` e a skill `deskcomm-contribuir` — o protocolo de branch (nunca a partir do `main` do seu fork, que carrega suas personalizações), o formato de migration em "tripla" (arquivo + apêndice no `baseline.sql` + linha no `MANIFEST.md`), e o fragmento de release em `.changes/`.

### Passo 8 — Estabelecer sua própria cadência de manutenção

- `bash hostgator-setup-kit/backup.sh` agendado diariamente (o Supabase free **não** faz backup sozinho).
- Acompanhar `CHANGELOG.md` antes de cada `update.sh` — mudanças que exigem atenção manual aparecem sob "⚠️ Requer atenção".
- Se crescer, revisitar `docs/runbooks/custo-e-cota-do-supabase.md` antes de estourar o plano gratuito.

---

## 19. Mapa de arquivos e docs importantes

| Preciso saber sobre... | Onde ir |
|---|---|
| Convenções e regras não-negociáveis | `CLAUDE.md` |
| Índice de todos os 171 docs, com regra de precedência | `docs/index.md` |
| O que está pronto/incompleto/quebrado (⚠️ desatualizado — use §16 deste manual em vez disso) | `docs/current-state.md` |
| Posicionamento e visão de produto | `VISION.md` |
| Arquitetura em 1 página | `ARCHITECTURE.md` |
| Setup completo de desenvolvimento | `docs/SETUP.md` |
| Instalar numa VPS | `hostgator-setup-kit/README.md`, `docs/deploy-hostgator/README.md` |
| Atualizar uma instalação | `docs/ATUALIZANDO.md` |
| Instalar para clientes / white-label | `docs/white-label.md` |
| Regras de negócio fora do código | `docs/business-rules/00-business-rules-catalog.md` |
| Schema SQL e payloads exatos por domínio | `docs/specs/01` a `docs/specs/19` |
| Três papéis do agente (arquitetura de IA atual) | `docs/specs/16-spec-tres-papeis-do-agente.md` |
| Contrato de governança para agentes externos | `docs/specs/14-contrato-governanca-agentes-externos.md` |
| Doutrina da fusão do runtime de IA (não reverter) | `docs/doctrine/operacao-de-agentes.md`, `docs/vendaval-fusion-plan.md` |
| Packaging e distribuição Docker | `docs/doctrine/packaging.md`, `docs/adr/0001-packaging-e-distribuicao.md` |
| Superfície de ataque | `docs/threat-model.md` |
| Runbooks operacionais (WAHA, custo Supabase, CloudPanel, deploy) | `docs/runbooks/` |
| Env vars (validação) | `lib/env.ts` |
| Wrappers de API | `lib/api/wrappers.ts`, `lib/api/errors.ts` |
| Clients Supabase | `lib/supabase/{browser,server,admin}.ts` |
| Turno do agente (Conversador) | `lib/agent-engine/agent/inbound-turn.ts` |
| Turno do Operador | `lib/agent-engine/agent/operator-turn.ts` |
| Cadeia de guardrails de saída | `lib/agent-engine/guardrails/before-send.ts` |
| Detecção de STOP/opt-out | `lib/opt-out/deteccao.ts` |
| Teto de orçamento de IA | `lib/agent-engine/edge/llm/orcamento.ts` |
| Catálogo de tools MCP | `lib/mcp/tools/catalogo/` |
| Guia do assistente para instalar | `.agents/skills/deskcomm-instalar/SKILL.md` |
| Guia do assistente para montar cliente novo | `.agents/skills/deskcomm-cliente-novo/SKILL.md` |
| Guia do assistente para contribuir | `.agents/skills/deskcomm-contribuir/SKILL.md` |
| Health check | `app/api/v1/health/route.ts`, `http://localhost:3000/api/v1/health` |

---

## 20. Departamentos / filas por área — decisão de configuração

> Registrado em 2026-09-15, a partir de uma conversa sobre como replicar, neste sistema, o omnichannel atual da empresa: um único número de WhatsApp em que um bot pergunta "com quem você quer falar?" (Suporte Certificação, Suporte Automação, Canais, Financeiro, Segunda via de fatura, Comercial), o cliente escolhe, descreve o problema, e o bot transfere para a fila humana daquele departamento.

### O que o sistema NÃO tem nativamente

Não existe um conceito de "departamento" no schema. RBAC é plano (4 papéis por organização, sem agrupamento de usuários), e a configuração de roteamento/visibilidade de fila (`Configurações → Distribuição de atendimento`) é **uma regra única para a organização inteira** — não por time. `user_pipeline_access` (permissão por funil, que resolveria isso com uma barreira de segurança de verdade) está documentado como deliberadamente fora do MVP e tem zero implementação em código.

### As duas opções avaliadas

| | Caminho robusto (RLS/schema novo) | Caminho leve (só configuração) — **escolhido por enquanto** |
|---|---|---|
| O que muda | Tabela `pipeline_members`, RLS estendida em `fn_can_view_conversation`/`fn_can_view_lead`, elegibilidade de roteamento filtrada por departamento | Nada no código — só telas |
| Segurança | Barreira de verdade: financeiro não consegue nem tecnicamente abrir conversa de suporte | Filtro de tela; qualquer `agent`/`manager` consegue limpar o filtro e ver tudo |
| Esforço | ~11-19 dias de trabalho focado (schema+RLS 3-5d, roteamento 2-4d, UI 3-5d, testes de invariante 2-3d, migration tripla 0,5-1d) | Horas, na própria tela |
| Round-robin por time | Precisaria terminar o worker geral de round-robin, que hoje só existe parcialmente (caminho de handoff da IA) | Não tem — é "pega o próximo da fila filtrada" manual (claim atômico já existe e evita dois atendentes pegarem a mesma conversa) |

**Decisão:** seguir com o **caminho leve** por enquanto. Reconsiderar o caminho robusto só se surgir uma exigência real de que um departamento *não possa* ver dados de outro (ex.: exigência de compliance, ou parceiros externos operando dentro da mesma instalação — não só times internos da mesma empresa).

### Receita do caminho leve — passo a passo

1. **Um funil por departamento** (Kanban → Funis): criar "Suporte Certificação", "Suporte Automação", "Canais", "Financeiro", "Segunda via de fatura", "Comercial" — cada um com as etapas que fizerem sentido para aquele tipo de atendimento (ex.: Novo → Em atendimento → Resolvido).

2. **Um Roteador de IA no número** (IA → Roteadores): uma "intenção" por departamento, com descrição e frases de exemplo do jeito que o cliente realmente escreve (ex.: "preciso da segunda via do meu boleto", "meu certificado não está funcionando"). O roteador (classificador LLM, `claude-haiku-4-5` por padrão) entende o texto livre do cliente e já direciona para o agente certo — **não precisa reconstruir o menu de botões**, o cliente digita naturalmente. Cada intenção aponta para um agente de IA (pode ser um agente dedicado por área, com base de conhecimento própria).

3. **Tags com o mesmo nome dos departamentos** (Etiquetas/Tags de conversa) + **1 automação por departamento** (Webhooks → Automações): `QUANDO lead.stage_changed SE caiu no funil <Departamento> ENTÃO adicionar tag <Departamento>`. É determinístico — não depende do agente de IA "lembrar" de marcar, roda sempre que o Roteador direcionar um lead pro funil daquele departamento. (Confirmado no código: gatilhos disponíveis são `lead.created`, `lead.stage_changed`, `message.received`, `lead.tag_added`, `contact.tag_added` e os 4 de agenda; ações incluem `add-tag`, `assign-owner`, `create-or-move-lead`, `send-whatsapp`, `send-ai-message`, `start-message-flow`, `call-webhook` — `lib/automation/actions/` e `lib/schemas/webhooks.ts`.)

4. **Time humano filtra a Inbox pela tag do departamento** — o filtro "Todas as tags" já existe na tela hoje. Cada atendente vê só a fila do time dele e usa "Assumir" na próxima conversa (claim atômico nativo, evita dois atendentes pegando a mesma conversa ao mesmo tempo).

5. **Handoff automático**: quando o agente de IA daquele departamento não resolver sozinho, ele já sabe pedir humano (handoff nativo do produto) — a conversa vira pendente, já com a tag do departamento marcada, e o time certo a encontra pelo filtro.

### Limitações aceitas conscientemente

- **Sem parede de segurança real entre departamentos** — é convenção de tela, não RLS. Qualquer pessoa com papel `agent` ou `manager` na organização consegue, tecnicamente, ver conversas de outro departamento limpando o filtro de tag.
- **Sem rodízio automático justo por time** — a distribuição dentro da fila filtrada é "primeiro que vir, assume", não um round-robin garantido só entre os membros daquele departamento.
- Nenhuma das duas é um bloqueio técnico impossível de resolver depois — são os dois pontos exatos que o "caminho robusto" (seção acima) endereçaria, se um dia virar necessário.

---

*Este documento foi gerado por uma varredura de código e documentação em 2026-09-15, contra a HEAD `60079eb5` deste fork. Como todo documento neste projeto, ele também vai envelhecer — trate os números como datados e prefira remedir na fonte quando a decisão importar de verdade.*
