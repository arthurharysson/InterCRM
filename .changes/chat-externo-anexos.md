---
impacto: capacidade_nova
secao: adicionado
titulo: No chat fora do WhatsApp, cliente e atendente passam a trocar fotos e documentos
---

No canal de chat fora do WhatsApp, o cliente que anexava uma foto ou um documento na
página só tinha o texto chegando ao CRM, e o arquivo se perdia. Agora o anexo aparece no
Inbox como imagem ou documento, com o nome do arquivo, é guardado no armazenamento do
CRM e a IA o lê como qualquer foto. No sentido contrário, o arquivo que o atendente
envia chega à página do cliente. Fotos, PDF, TXT, DOCX e XLSX de até 10 MB; áudio e
vídeo aparecem ao cliente como indisponíveis. Para os anexos do atendente chegarem, o
Chat precisa listar o domínio do armazenamento do CRM em `ATTACHMENT_FETCH_ALLOWED_HOSTS`
(passo a passo no guia do canal).
