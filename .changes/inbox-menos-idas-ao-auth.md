---
impacto: nada_mudou
secao: alterado
titulo: O Inbox abre mais rápido quando o Supabase está longe do servidor
---

Ao abrir uma conversa, o Inbox pede ao servidor a lista, as contagens, a conversa,
as mensagens, o resumo do contato e a linha do tempo. Cada um desses pedidos
confirmava a sua sessão com uma ida própria ao serviço de login do Supabase, mesmo
com o sistema já guardando essa confirmação por alguns instantes. Numa instalação
em que o Supabase fica longe da VPS, essas idas se somavam e a tela passava muito
tempo no esqueleto. Agora essas rotas aproveitam a confirmação guardada, como o
resto do sistema já fazia: quem perde o acesso continua sendo barrado na hora (a
revogação, a troca de papel e o "sair de todos os aparelhos" derrubam a confirmação
guardada), e nada muda na tela além da rapidez.
