---
impacto: nada_mudou
secao: corrigido
titulo: As mensagens do chat fora do WhatsApp chegam à Fila na hora, mesmo várias seguidas
---

No canal de chat fora do WhatsApp, o CRM só confirmava cada mensagem do cliente ao Chat depois
de rodar todos os efeitos dela (abrir demanda, avaliar campanha, acordar o agente de IA e o
follow-up). Como o Chat manda uma mensagem por vez e espera essa confirmação, numa instalação
com o banco na nuvem cada mensagem levava cerca de 8 segundos, e oito mensagens seguidas
chegaram à Fila com até 68 segundos de atraso. Agora a mensagem é gravada e a conversa
atualizada na hora, o CRM confirma ao Chat, e os efeitos rodam logo depois, em ordem dentro
da mesma conversa. Se um efeito falhar, o erro fica registrado no log do servidor, e a
mensagem continua na Fila como sempre. Nada muda na tela nem na configuração.
