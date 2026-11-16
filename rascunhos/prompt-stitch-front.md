# Prompt para o Stitch — novo front do CRM

> Rascunho local. Use o bloco 1 uma vez (cria a linguagem visual) e depois os blocos 2 a 6, um por vez.
> O prompt está em inglês de propósito (o Stitch acerta mais), mas **todo o texto das telas fica em português do Brasil**.

---

## BLOCO 1 — Linguagem visual + a moldura do app (cole primeiro)

```
Design a premium, expensive-looking B2B SaaS web app: a sales + customer-support CRM
(WhatsApp inbox, sales pipeline, AI agents, phone calls). Desktop-first, 1440px wide.
All UI copy in Brazilian Portuguese (pt-BR). Sentence case, short labels, no exclamation marks.

VISUAL REFERENCE (inspiration only — do NOT copy it, make it clearly more refined):
A "floating cards" shell: the left sidebar and the top header are separate white rounded
cards floating over a very pale cool-tinted page background, with generous gutters (16px)
around them. Content areas are also white rounded cards. Selected nav item has a soft tinted
fill. User card pinned at the bottom of the sidebar. Rounded pill search field in the header.

MAKE IT FEEL EXPENSIVE, NOT LIKE A TEMPLATE:
- Typography: a modern geometric sans for headings (Plus Jakarta Sans or similar) and Inter
  for body. Tight, confident hierarchy: few sizes, medium weight for emphasis, never bold-heavy.
  Tabular numerals for money, counters and metrics.
- Palette: near-white page (#F4F6FA), pure-white cards, ink text (#0F1729), muted text
  (#667085), hairline borders (#E6E9F0). ONE brand accent used with restraint — default a
  deep electric indigo (#3B5BFF). The accent must be a single swappable brand color
  (white-label): active nav, primary button, links, focus ring, selected tint. Nothing else
  saturated. Status colors are soft and tonal (green, amber, red, blue chips with tinted
  background and dark text), never neon.
- Shape: card radius 20px, control radius 12px, pills for chips and search. Soft, diffuse,
  low-contrast shadows (no hard drop shadows), 1px hairline borders on cards. Lots of air,
  but information-dense where the job needs it (lists, tables, inbox).
- Details that signal quality: avatars with a thin status ring/dot, SLA and unread counters as
  small tinted pills, subtle dividers, skeleton-friendly empty states, icon set = one
  consistent outline family (Lucide style, 1.5px stroke), sparkline inside KPI cards,
  keyboard-hint chips (Ctrl K) in the search.
- Dark mode: design it as its own palette (deep ink #0B0F1A page, #131A28 cards), not an
  inversion. Show light and dark.
- Avoid: stock illustrations, gradients on big surfaces, glassmorphism, emoji, country flags,
  "dashboard template" filler (no Blog / Ecommerce / Frontend Pages items), cartoon avatars.

APP SHELL (appears on every screen):
- Floating left sidebar card, 264px, brand logo + name "Sua Marca" (placeholder, white-label)
  at top, then a small segmented switch "Atendimento | Vendas" under it.
- Nav groups with small uppercase muted group labels:
  ATENDIMENTO: Inbox (counter pill), Radar, Agenda, Respostas rápidas
  CRM: Funis, Contatos, Empresas, Tarefas, Chamadas, Propostas, Campanhas, Prospecção
  IA: Agentes, Follow-ups, Conhecimento, Execuções
  ANÁLISE: Desempenho, Faturamento
  Bottom: Conexões, Configurações, then the user card (avatar, name, role, logout icon).
- Floating top header card: collapse-sidebar button, pill search "Buscar conversas, contatos…"
  with Ctrl K hint, a softphone status chip ("Ramal 1103 · conectado"), theme toggle,
  notifications bell with dot, user avatar.
Generate the Inbox screen first inside this shell (see next block).
```

---

## BLOCO 2 — Atendimento

```
Same design system and shell. Screens:

1) Inbox, three panes inside one floating card:
   - Left (320px): conversation list. Tabs "Minhas · Equipe · Não atribuídas". Search + filter
     chips (Aberta, Aguardando, SLA). Rows: avatar with channel badge (WhatsApp), name,
     last-message preview, time, unread pill, small SLA chip. One row selected (soft tint).
   - Center: WhatsApp-style conversation. Header with name, status chip "Em atendimento",
     phone-call button, assign-to dropdown, "Resolver" button. Message bubbles (incoming
     white with hairline, outgoing in brand tint), audio message with waveform, a file
     attachment card, a day divider, an internal note in a yellow-tinted style. Composer with
     quick-reply button "/", attach, emoji, "Enviar" primary.
   - Right (300px): contact context. Avatar, name, phone, tags, lead card (funil, etapa,
     valor R$ 4.200), next task, recent calls, activity timeline, AI summary box
     "Resumo da conversa".
2) Radar: live board of conversations by wait time with SLA countdown chips.
3) Agenda: week calendar with colored event pills and a right-side "Hoje" list.
```

## BLOCO 3 — CRM

```
Same design system and shell. Screens:
1) Funis: Kanban with 5 columns (Novo lead, Contato feito, Proposta, Negociação, Ganho),
   column header with count and total in R$, rich cards (company, value, owner avatar, tag,
   next-task date, small WhatsApp icon), one card being dragged with a soft elevated shadow.
   Top bar: funil selector, "Nova oportunidade" primary button, view toggle Kanban/Lista.
2) Contatos: data table with avatar+name, empresa, tags, responsável, último contato, funil
   stage chip; toolbar with search, filters, saved views, bulk-action bar, pagination.
3) Contato (visão 360): header card + tabs (Linha do tempo, Conversas, Negócios, Chamadas,
   Arquivos); timeline with message/call/note/task events and icons.
4) Chamadas: call history table with direction icons, duration, outcome chip, plus the
   floating softphone dock (bottom-right): in-call state with timer, mute, keypad,
   transfer, hang-up red button, small audio-quality indicator.
5) Propostas: list with status chips (Rascunho, Enviada, Aceita) and a proposal preview pane.
```

## BLOCO 4 — IA

```
Same design system and shell. Screens:
1) Agentes: grid of agent cards (name, role, channel icons, status switch, last run, success
   rate) + "Novo agente" button.
2) Editor de agente: left sections list (Identidade, Instruções, Ferramentas, Conhecimento,
   Regras de transferência), center form with a large prompt editor, right live "Testar"
   chat panel.
3) Execuções: table of runs with status, duration, cost, expandable step trace.
4) Uso e orçamento: KPI cards with sparklines (custo do mês, mensagens, tokens), a line
   chart, and a budget progress bar.
```

## BLOCO 5 — Análise, canais e configurações

```
Same design system and shell. Screens:
1) Desempenho: KPI row (conversas, tempo de resposta, conversão, receita) with sparklines,
   funnel chart, bar chart by attendant, heatmap of busiest hours, top reasons for loss.
2) Faturamento: revenue line chart, table of invoices with status chips.
3) Conexões: channel cards (WhatsApp with QR code state, Instagram, Web chat), connection
   health dots, "Conectar canal" button.
4) Configurações > Organização: tabs (Equipe, Marca, Segurança, Integrações); the "Marca"
   tab shows white-label settings: logo upload, color swatch picker for the brand accent
   with a live preview card.
```

## BLOCO 6 — Primeira impressão

```
Same design system, no shell for the first two.
1) Login: split layout, left a calm brand panel with a short value line, right a clean form
   (e-mail, senha, "Entrar", "Esqueci minha senha"). Light and dark.
2) Onboarding wizard in 4 steps (Sua empresa, Conectar WhatsApp, Convidar equipe, Primeiro
   funil) with a stepper and a friendly empty-state preview on the right.
3) Command palette (Ctrl K) overlay on top of the Inbox: search field, grouped results
   (Conversas, Contatos, Ações), keyboard hints.
4) Empty states: Inbox vazio, Funil sem oportunidades, Contatos sem importação — each with a
   simple line icon, one sentence, one primary action.
```

---

## Como usar

1. Cole o **Bloco 1** e gere. Só avance quando a moldura (barra lateral, cabeçalho, Inbox) estiver como você quer.
2. Peça ao Stitch para **salvar como sistema de design** a partir dessa primeira tela. Todos os blocos seguintes herdam as cores, fontes e raios.
3. Gere os blocos 2 a 6, um de cada vez, e me mande os que gostar.
4. Eu converto cada tela escolhida em tokens (`app/globals.css`), componentes (`components/ui`) e menu, mantendo a posição das coisas.
