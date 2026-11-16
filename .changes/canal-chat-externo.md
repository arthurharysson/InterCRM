---
impacto: capacidade_nova
secao: adicionado
titulo: Canal de chat fora do WhatsApp, com o setor escolhido pelo bot
---

Dá para atender, pela Fila do CRM, quem conversa numa página de chat própria em
vez do WhatsApp — por exemplo, quando o cliente é levado do WhatsApp para um
link de atendimento e o custo da API oficial passa a pesar.

Em **Conexões › Chat fora do WhatsApp** o administrador cria o canal informando o
endereço do chat. O CRM gera e mostra **uma única vez** as chaves dos dois
sentidos (o que o chat usa para falar com o CRM e o que o CRM usa para falar com
o chat); depois disso só dá para girá-las. A conversa chega na Fila com o
histórico que o bot já tinha com o cliente, marcado como importado, e o
atendente responde pelo Inbox de sempre. Quando a equipe encerra o atendimento,
o chat é avisado.

Em **Equipe › Setores** há um campo novo, **Código para o bot**: com ele o bot
indica o setor ao abrir o chat e a conversa já entra na Fila certa. Sem código
(ou com o módulo de setores desligado) a conversa entra sem setor, e qualquer
atendente a vê.

Não muda nada para quem não ligar o canal: o canal `web` do InterSuite não foi
tocado, e a migration só acrescenta colunas e índices.

Corrige junto a instalação do zero, que parava no índice do canal web porque a
coluna `archived_at` de `channel_sessions` era usada antes de ser criada.
