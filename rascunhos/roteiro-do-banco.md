# Roteiro: atualizar o banco antes de publicar a sincronização

> Rascunho local (não commitado). Complementa `sincronizar-fork-com-upstream.md` (seção 4.6).
> Script: `rascunhos/aplicar-baseline.sh`.

## O que isto faz e por que

A sincronização trouxe 113 migrations novas do upstream. Elas chegam ao banco pelo
`supabase/baseline.sql`, que é **idempotente**: pode ser aplicado de novo num banco que já
existe, e o que já está lá só dá "já existe" (erro benigno). O `scripts/atualizar-vps.sh`
**não** faz isso — ele só troca as imagens. Sem este passo, o app novo fala com um banco velho.

## Antes de começar (5 minutos)

1. **Confirme qual banco a VPS usa.** O projeto que usamos aqui é `qolnuavdwkygsfmeewct`.
   Na VPS (Forge › Commands), rode — mostra só a URL pública, não segredos:
   ```bash
   grep -E '^NEXT_PUBLIC_SUPABASE_URL=' /home/forge/crm.intercert.com.br/releases/000000/.env
   ```
   Se o endereço **não** começar com `https://qolnuavdwkygsfmeewct.`, a VPS usa outro banco:
   o passo abaixo tem de apontar para **aquele**.
2. **Backup no painel do Supabase** (Database › Backups). Anote a data/hora. Este é o seguro
   de verdade; o `pg_dump` do script é o segundo.
3. **Hora calma.** O baseline cria e troca regras (constraints) e funções; a aplicação leva
   alguns minutos e pode, por instantes, segurar travas. Evite horário de atendimento forte.

## Duas formas de rodar

### B) Deste computador (recomendada agora — não exige enviar nada ao GitHub)

Precisa do Docker Desktop ligado.

1. No painel do Supabase: **Connect › Session pooler** → copie a string (termina em `:5432/postgres`,
   com usuário `postgres.<ref>`). A conexão direta (`db.<ref>.supabase.co`) é só IPv6 e não funciona daqui.
2. No Git Bash, **sem colar a senha no chat**:
   ```bash
   read -rs -p "Cole a connection string e tecle Enter: " SUPABASE_DB_URL && export SUPABASE_DB_URL; echo
   bash rascunhos/aplicar-baseline.sh --ensaio
   bash rascunhos/aplicar-baseline.sh
   ```

### A) Pela VPS (depois, se quiser repetir a cada sincronização)

O script hoje mora em `rascunhos/`, que **não vai para o git**, então a VPS não o tem. Para usá-lo
lá, ele teria de ser movido para `scripts/aplicar-baseline.sh` e commitado — o que é uma decisão
de enviar código, com a sua autorização. Vantagem: lê o `.env` da VPS (`ENV_FILE=.env`), sem
você copiar senha, e a VPS já tem Docker.

## O que você deve ver

```
── 1/4 conferindo o servidor      servidor: 15.x | usuário: postgres | banco: postgres
── 2/4 backup do schema public    ✓ backups/pre-sincronizacao-AAAAMMDD-HHMMSS.dump (… KB)
── 3/4 aplicando o baseline       ✓ passada 1: sem erro fora dos benignos
── 4/4 verificando                ✓ tabela org_webphone_settings … ✓ regra de canal aceita 'web'
✓ banco atualizado.
```

- **`usuário` diferente de `postgres`**: pare e me avise. Objetos novos ficariam com outro dono.
- **Passada 2 ou 3**: normal se houver disputa de trava com o app atendendo; o script repete sozinho.
- **Erro que não é de disputa** (permissão, dado): ele **para** e não repete, porque repetir não cura.
  O log completo fica em `backups/baseline-*.log`. Me mande as linhas de erro (sem senha).
- **Qualquer ✗ na verificação**: **não publique a imagem nova**.

## Se algo der errado

- O baseline só **acrescenta e corrige**; não apaga dados do cliente. O risco principal é uma
  regra (constraint) nova rejeitar uma linha antiga: o próprio baseline corrige/deduplica antes
  de criar a regra, e é isso que o log mostraria.
- Voltar atrás: restaurar o backup do painel do Supabase (restaura o **projeto inteiro** para
  aquela hora — perde o que entrou depois). Por isso a hora calma e o backup de agora.
- O `.dump` local serve para consulta ou restauração pontual com `pg_restore`; não use para
  "desfazer tudo" sem falar comigo.

## Depois que o banco estiver ✓

1. Enviar a branch/`main` ao GitHub e esperar o job «Publicar imagem Docker» ficar verde (3 a 5 min).
2. Forge › Commands › `bash /home/forge/crm.intercert.com.br/releases/000000/scripts/atualizar-vps.sh`.
3. `/` responde 200 e `/app` responde 307.
4. **VPN desligada**, ligar para o próprio celular e conferir o áudio dos dois lados.
5. Abrir o canal Web do InterSuite e mandar uma mensagem de teste (a regra de canal mudou de bloco).
