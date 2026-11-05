# Como manter o fork em dia com o produto do Rafael

> Rascunho local (não commitado). Escrito em 2026-11-04, durante a primeira sincronização
> real (versão 1.100.0). O lugar natural quando for para o repositório é `docs/internal/`.

## 1. A ideia, em uma frase

O produto original (**upstream**, `melgarafael/DeskcommCRM`) evolui todo dia. Para não ficar
para trás nem quebrar o que é nosso, **nunca misturamos direto na `main`**: trazemos o upstream
para uma **branch de sincronização**, resolvemos os conflitos lá, testamos tudo, e só então
levamos para a `main`. A `main` só recebe código que já passou por esse filtro.

```
upstream/main ──┐
                ├──► sincroniza/upstream-<versão>  ── resolve + testa ──► main ──► CI publica imagens ──► VPS
main (nossa) ───┘
```

## 2. Por que existe a branch separada

- A `main` é o que roda em produção na VPS. Misturar 3.000 commits direto nela deixa a
  produção refém de um conflito mal resolvido.
- Se algo der errado, **apagar a branch é de graça**: a `main` nunca foi tocada.
- Dá para revisar o resultado inteiro (`git diff main..sincroniza/…`) antes de aceitar.

## 3. O ritmo

Medido na primeira sincronização: o upstream fez **3.376 commits em 17 dias** (≈200 por dia),
15 versões, 113 migrations novas e 1.952 arquivos de código alterados.

- **Recomendação: a cada versão do upstream que interessar, e no máximo a cada duas
  semanas.** Mensal ainda funciona, mas cada mês dobra o tamanho do conflito: o custo cresce
  mais do que o tempo.
- Conflito cresce com **arquivos que nós e eles alteramos**. Por isso a regra de ouro é
  manter a **nossa diferença pequena e concentrada** (ver seção 8).
- Hoje o que é nosso e diverge do upstream: a telefonia (`lib/webphone`, `lib/fluxo`,
  `components/webphone`, rotas, 3 migrations), o canal Web do InterSuite, e pequenos ajustes.

## 4. Passo a passo (copie e cole)

### 4.0. Antes de começar

```bash
git status                    # tem que estar limpo
git switch main && git pull origin main
git fetch upstream
echo "commits novos do upstream: $(git rev-list --count main..upstream/main)"
```

Se `git status` não estiver limpo: **pare**. Não sincronize em cima de trabalho solto.

### 4.1. Ensaio (não altera nada)

```bash
git merge-tree --write-tree --name-only --no-messages main upstream/main
```

Lista, no fim, os arquivos que vão conflitar. Se a lista for grande (dezenas), não comece
na pressa: converse primeiro.

### 4.2. Criar a branch e juntar

```bash
git switch -c sincroniza/upstream-1.101.0     # use o número da versão do upstream
git merge --no-commit --no-ff upstream/main
git diff --name-only --diff-filter=U           # os arquivos em conflito
```

`--no-commit` é de propósito: o merge fica **aberto** para corrigirmos e testarmos antes de
gravar. Se precisar desistir: `git merge --abort`.

### 4.3. Resolver cada conflito

Regras que valeram na primeira rodada (seção 5 tem os casos). Em todos:
**leia os dois lados antes de escolher**, e nunca use `-X ours/theirs` no merge inteiro.

Depois de cada arquivo: `git add <arquivo>`.

### 4.4. Atualizar dependências e conferir

```bash
npx pnpm@9.15.9 install
NODE_OPTIONS=--max-old-space-size=10240 npx pnpm@9.15.9 typecheck
npx pnpm@9.15.9 lint
npx pnpm@9.15.9 test:unit        # a suíte INTEIRA, sem caminho (ver seção 6)
```

### 4.5. Gravar o merge e levar para a main

```bash
git commit                        # o merge, com a mensagem padrão
# revisar: git diff main..HEAD --stat
git switch main
git merge --no-ff sincroniza/upstream-1.101.0
git -c core.hooksPath=/dev/null push origin main   # hook desarmado só neste comando (fork nosso)
```

> O hook de pré-push do kit de contribuição recusa push na `main`. Aqui o `origin` é o nosso
> fork, então a regra não se aplica — mas desarmamos **só no comando**, nunca na configuração.

### 4.6. Aplicar o banco ⚠️ (o passo que mais se esquece)

**`scripts/atualizar-vps.sh` NÃO mexe no banco.** Ele faz `git pull`, baixa as imagens e
recria os containers. As migrations novas do upstream (113 só na primeira rodada) precisam
ser aplicadas no Supabase **antes** de subir a imagem nova, senão o app novo conversa com um
banco velho e quebra.

O arquivo que carrega tudo isso é `supabase/baseline.sql` (idempotente: pode reaplicar em
banco existente). Quem faz isso no kit padrão é o `update.sh` (`reaplicar_baseline` em
`_common.sh`); aqui precisamos fazer à mão:

1. **Backup** do projeto no painel do Supabase antes.
2. Aplicar o `baseline.sql` no banco **sem** `ON_ERROR_STOP` (modo «update»):
   ```bash
   psql "$SUPABASE_DB_URL" -f supabase/baseline.sql
   ```
   A conexão direta (`db.<ref>.supabase.co`) é só IPv6; se a máquina não tiver IPv6, use a
   string do **pooler**, copiada do painel do Supabase (nunca cole senha em chat).
3. Conferir que o app sobe e que `/api/v1/health` responde.

### 4.7. Publicar e subir

1. O push na `main` dispara o GitHub Actions («Publicar imagem Docker»). Esperar ficar verde
   (3 a 5 min). O `ci` do fork está vermelho desde 18/10 e **não** bloqueia a publicação.
2. No Forge: site `crm.intercert.com.br` › **Commands** › rodar
   `bash /home/forge/crm.intercert.com.br/releases/000000/scripts/atualizar-vps.sh`.
3. Conferir: `/` responde 200 e `/app` responde 307.
4. **Com a VPN desligada**, ligar para o próprio celular e conferir o áudio dos dois lados.

### 4.8. Limpeza

```bash
git branch -d sincroniza/upstream-1.101.0
```

## 5. Casos de conflito já vistos (e como foram resolvidos)

| Arquivo | O que acontece | Regra |
|---|---|---|
| `supabase/baseline.sql` | Nós e eles acrescentamos blocos no **fim** do arquivo | Manter os dois. Os nossos têm números 88xx, que não colidem. Conferir a emenda |
| `lib/i18n/dicionario.ts` | Dois blocos de traduções acrescentados no fim | Manter os dois; o `typecheck` aponta chave repetida (TS1117) — apagar **a nossa cópia** quando a tradução for igual |
| `lib/env.ts`, `.env.example` | Variáveis novas dos dois lados | Manter as duas |
| `package.json` | Versões de dependência | Versões do **upstream**; acrescentar só o que é nosso (`jssip`) e rodar `pnpm install` |
| `app/app/contacts/[id]/_client.tsx` | Imports de cada lado | Manter os dois |
| `lib/channels/capabilities.ts` (sem conflito, mas quebra o typecheck) | Upstream passou a exigir `phonebook` em todo canal; o canal Web do InterSuite é só nosso | Acrescentar `phonebook: false` ao nosso canal |

Efeitos colaterais para procurar **mesmo sem conflito**:

- **Migration com o mesmo carimbo de hora** de outra do upstream → renomear só o arquivo nosso
  (não muda o número `NNNN` nem o conteúdo), mantendo a ordem entre as nossas.
- **Linha repetida no `supabase/migrations/MANIFEST.md`** (o `.gitattributes` usa `merge=union`
  e concatena) → manter a versão completa, igual à do upstream.
- **Número de migration repetido** (NNNN): hoje `0501` é usado por duas (a nossa `canal_web` e
  a do upstream). **Defeito antigo do fork, não da sincronização.** Pendente.

## 6. Como testar sem se enganar

- `pnpm test:unit` é a suíte **inteira** (≈566 arquivos). `vitest run tests/unit` é um recorte
  menor e dá falso verde.
- Redirecione a saída para arquivo e **não corte com `tail`**: o que importa são os nomes dos
  arquivos que falharam.
- O rodapé `Tests N failed` é a autoridade; confira também o `exit code` e a linha `Errors`.
- **Falhas do Windows/fork que já existiam** (não são da sincronização): `bash ENOENT`, caminhos
  com `\`, timeouts, o `ci` do fork vermelho desde 18/10, e duas do canal Web do InterSuite
  (`0501` repetido; marca `x-deskcomm-signature` em `lib/channels/inbound.ts`).
- **A comparação certa** é «falhava antes?»: rode o mesmo arquivo na `main` antes de culpar a
  sincronização.
- `pnpm test:db` (isolamento entre organizações, RLS) exige **Docker**. Antes de vender o CRM
  como SaaS, ele precisa estar verde com o código sincronizado.

## 7. Quando parar e pedir ajuda

- Mais de ~15 arquivos em conflito no ensaio.
- Conflito em `baseline.sql` **dentro** de uma função ou tabela (não só no fim do arquivo).
- Migration do upstream que renomeia/apaga coluna que usamos (`org_webphone_settings`,
  `user_webphone_ramais`, `voice_calls`).
- `typecheck` com erro em arquivo nosso depois do merge.

Nesses casos: `git merge --abort` e a `main` continua como estava.

## 8. Como a troca completa do visual (o redesenho do front) entra nisso

O redesenho **aumenta** o conflito se for feito tela por tela. Para manter a diferença pequena:

1. **Sincronizar primeiro**, depois redesenhar. O momento mais barato é agora.
2. Começar pela **«pele»**: tokens em `app/globals.css` (o upstream mexeu nele uma vez em
   17 dias), os 23 componentes de `components/ui` (o upstream mexeu em 8) e o menu lateral.
   Isso muda a cara do sistema inteiro e quase não conflita.
3. Telas (146 `page.tsx`/`_client.tsx`) só onde a **posição** de um bloco precisar mudar,
   em PRs pequenos.
4. Nada de cor fixa no código: o visual lê a marca do banco (white-label), como hoje.
   O teste `tests/unit/branding.test.ts` vigia isso.

## 9. Resumo do que fizemos na primeira rodada (referência)

- Upstream: 3.376 commits, versão 1.100.0. Ensaio: **6 arquivos em conflito**.
- Branch: `sincroniza/upstream-1.100.0`.
- Resolvidos: `.env.example`, `lib/env.ts`, `package.json`, `app/app/contacts/[id]/_client.tsx`,
  `lib/i18n/dicionario.ts`, `supabase/baseline.sql`.
- Ajustes extras: 4 chaves repetidas do dicionário; `phonebook: false` no canal Web; migration
  `8802` renomeada para `20261104120100`; linha duplicada do MANIFEST removida.
- `typecheck` e `lint` limpos.
- Pendências antigas do fork, fora do escopo: `0501` repetido; `x-deskcomm-signature`.
