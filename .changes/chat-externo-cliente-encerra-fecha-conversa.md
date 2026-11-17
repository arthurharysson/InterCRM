---
impacto: nada_mudou
secao: corrigido
titulo: Quando o cliente encerra o chat pela página, a conversa sai da Fila do CRM
---

No canal de chat fora do WhatsApp, o cliente que clicava em **Encerrar atendimento**
na página só deixava um aviso na conversa, e ela continuava **aberta** na Fila,
esperando uma resposta que ninguém ia ver. Agora o encerramento do cliente fecha a
conversa no CRM, pelo mesmo caminho do botão "Encerrar" do atendente, e registra na
auditoria que quem encerrou foi o cliente, pelo chat. Se a equipe já tinha fechado ou
resolvido a conversa, nada muda. Se o CRM falhar na hora de fechar, o Chat tenta de
novo sozinho.
