---
impacto: nada_mudou
secao: corrigido
titulo: A resposta do atendente ao chat não se perde mais quando o Chat reinicia por alguns segundos
---

No canal de chat fora do WhatsApp, quando o aplicativo de Chat estava reiniciando
(num deploy, por exemplo), a resposta que o atendente enviava no mesmo instante
falhava na hora e o cliente ficava sem ela. Agora o CRM tenta de novo sozinho, até
três vezes em poucos segundos, antes de marcar a mensagem como falha. O mesmo vale
para o aviso de que a equipe encerrou o atendimento. O Chat reconhece a mensagem
repetida, então o cliente não recebe nada em dobro. Se o Chat ficar fora do ar por
mais tempo, a mensagem continua aparecendo como falha, com o botão para reenviar.
