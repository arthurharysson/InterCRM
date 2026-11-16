Oi! Estamos montando um chat web para tirar do WhatsApp a parte do atendimento humano (hoje a API oficial custa
muito). O fluxo é o mesmo que a Brisanet usa:

  cliente pede suporte no WhatsApp → o bot faz o onboarding e pede o CPF → o bot manda um BOTÃO com um link →
  o cliente abre o link e continua num chat web (com a conversa do bot já carregada) → o atendente humano
  responde pelo nosso CRM.

O chat web é uma aplicação nova que vamos construir. A parte do bot é pequena e fica do lado de vocês. Antes de
construir, preciso confirmar três coisas com você.

═══ O QUE O BOT PASSARIA A FAZER (proposta, ainda não existe) ═══

1) Quando decidir passar para um humano, o bot faz UMA chamada HTTP para o nosso chat:

   POST https://chat.<dominio>/api/v1/chats
   Authorization: Bearer <chave que a gente te entrega>
   Idempotency-Key: <um id único por tentativa, para não criar chat duplicado se repetir a chamada>
   Content-Type: application/json

   {
     "sector": "suporte-tecnico",              // opcional por enquanto
     "contact": { "name": "Maria", "cpf": "12345678909", "phone": "5588999999999" },
     "history": [
       { "message_id": "bot_001", "from": "customer", "text": "Preciso de suporte", "sent_at": "2026-11-13T13:58:01Z" },
       { "message_id": "bot_002", "from": "bot",      "text": "Olá! Qual é o seu CPF?", "sent_at": "2026-11-13T13:58:03Z" }
     ],
     "metadata": { "origin": "whatsapp", "bot_session_id": "..." }
   }

   Resposta:  { "chat_id": "...", "url": "https://chat.<dominio>/c/<codigo-longo>", "status": "created", "expires_at": "..." }

2) O bot manda no WhatsApp o botão apontando para o "url" que voltou. Cada chat tem um link único.

3) Se o cliente abrir o link em outro aparelho/navegador, o link fica bloqueado (vale só no primeiro aparelho).
   Nesse caso o cliente clica em "receber novo link pelo WhatsApp" e o nosso chat avisa o bot, que gera um
   link novo e REENVIA O BOTÃO:

   POST https://chat.<dominio>/api/v1/chats/<chat_id>/reissue     →   { "url": "...novo link..." }

   (o link antigo deixa de valer)

Também dá para consultar o estado:  GET /api/v1/chats/<chat_id>  →  created | open | closed | expired

═══ O QUE PRECISO QUE VOCÊ RESPONDA ═══

PERGUNTA 1 — o bot consegue fazer isso?
  a) Consegue chamar uma API HTTP externa (POST com chave no cabeçalho e corpo JSON) e usar o "url" da resposta no botão?
  b) Consegue REENVIAR o botão com um link novo depois, quando o nosso chat pedir (o chat vai chamar um endereço
     do bot para avisar "gere outro link para este cliente")? Se não houver endereço para isso, qual é o jeito
     de vocês de reenviar uma mensagem para um cliente a partir de fora?
  c) Esse reenvio acontece dentro da janela de 24 h do WhatsApp (grátis) ou pode precisar de um modelo de mensagem
     (template, que é pago)? Isso muda o custo da economia que queremos.

PERGUNTA 2 — como o bot guarda a conversa dele?
  Me mande UM exemplo real de uma conversa (JSON ou print de como fica no banco), com o texto e os dados trocados
  por falsos (sem nome, CPF ou telefone reais). Quero ver: quem falou (cliente/bot), o texto, a hora, e se cada
  mensagem tem um id. Se for diferente do formato acima, não tem problema, o bot converte antes de chamar.

PERGUNTA 3 — setor
  O bot já separa o atendimento por assunto/área (suporte técnico, financeiro, comercial…)? Como ele identifica
  isso hoje (um nome, um código, um número)? Pode me mandar a lista? Se ainda não separa, sem problema:
  a gente começa sem setor.

═══ DETALHES QUE AJUDAM ═══
- Formato do CPF e do telefone que o bot guarda (só números? com pontos? com +55?).
- Se o bot já tem um endereço público (webhook) para receber avisos nossos, ou se precisa criar um.
- Quanto tempo o bot espera uma resposta HTTP antes de desistir (para eu manter a nossa API dentro desse prazo).
- Quem cuida disso do lado de vocês, para eu falar direto se precisar.

Obrigado! Nada disso é urgente para hoje; o que mais importa é a PERGUNTA 1.
