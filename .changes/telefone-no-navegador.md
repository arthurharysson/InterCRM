---
impacto: capacidade_nova
secao: adicionado
titulo: Atendentes ligam e recebem chamadas pelo CRM, com o ramal da central telefônica
---

Em Configurações › «Telefone no navegador», o administrador informa o servidor da
central telefônica (endereço WebSocket seguro e domínio) e escolhe o ramal de cada
atendente numa lista que vem da própria central. Há dois jeitos de usar o ramal, e
convivem na mesma empresa. Só com o número do ramal, o botão «Ligar agora» da ficha
pede à central que toque o ramal e ligue ao cliente, e o áudio fica na janela da
central, que o botão «Abrir a janela da central» abre. Com a senha SIP de um ramal
de navegador, o telefone passa a ser o do próprio CRM: toca, atende, silencia, põe
em espera e usa o teclado da URA ali mesmo, com o nome do contato na chamada
recebida e um toque que o CRM gera enquanto a pessoa espera ser atendida. A senha
fica cifrada e só chega ao navegador do dono do ramal. Ao desligar, o cartão pede
como foi a ligação (falou com o cliente, pediu retorno, fechou negócio, número
errado); a ligação perdida oferece «Ligar de volta»; e a aba «Ligações» da ficha
guarda o histórico. Se o som não passar, a tela diz por quê (som bloqueado pelo
navegador, nenhum áudio chegando, microfone mudo) e mostra os números do áudio.
Nenhuma ação na instalação: o `update.sh` aplica as três migrations.
