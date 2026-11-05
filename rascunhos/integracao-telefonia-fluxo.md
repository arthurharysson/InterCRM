# Telefonia no CRM: como a Fluxo foi integrada e como repetir

> Rascunho local (não commitado). Escrito em 2026-11-04, depois de a telefonia entrar
> em produção na VPS 3xData e ser validada com ligação real nos dois sentidos.
> Quando for para o repositório, o lugar natural é `docs/internal/`.

## 1. O que existe hoje, em uma frase

O atendente **liga e atende pelo navegador**, dentro do CRM, usando o ramal que a central
telefônica da empresa já tem. A ficha do contato tem o botão «Ligar agora», a aba «Ligações»
guarda o histórico, e uma pílula fixa na tela mostra o discador, a chamada recebida, a
conversa e o fechamento («Como foi a ligação?»).

## 2. Os dois jeitos de ligar (e por que são dois)

A central da Fluxo é um Asterisk 18 (chan_sip). Ela oferece duas portas, e o CRM usa as duas:

| | **Telefone no navegador** | **Ligar pela central** |
|---|---|---|
| O que é | O próprio CRM vira o telefone (SIP sobre WebSocket + WebRTC) | O CRM pede à central que toque o ramal e ligue ao cliente |
| Áudio | Sai e entra pelo navegador do atendente | Fica na janela/omnichannel da central |
| O que precisa | Servidor WSS, domínio SIP, ramal **e senha SIP** | URL e token da API da central, e o número do ramal |
| Por onde passa | Navegador ↔ central, direto | Servidor do CRM → API REST da central |
| Código | `lib/webphone/motor.ts` | `lib/webphone/click-to-call.ts` + `lib/fluxo/cliente.ts` |

Qual vale para cada pessoa é decidido **por ramal**, olhando se há senha cadastrada:
com senha → navegador; sem senha → pela central. As duas convivem na mesma empresa.
Quem decide é `modoDoUsuario` em `lib/webphone/servidor.ts`.

Os dois implementam a mesma interface (`lib/webphone/telefone.ts`), então a tela
(`components/webphone/WebphoneDock.tsx`) não sabe qual está por baixo. **Esta é a peça que
permite repetir a integração para outro sistema**: ver a seção 7.

## 3. Mapa de arquivos

```
lib/webphone/
  telefone.ts        interface Telefone + CapacidadesDoTelefone (o contrato)
  motor.ts           Webphone: JsSIP, áudio, mudo, espera, DTMF, medição de qualidade
  click-to-call.ts   ClickToCall: pede a ligação à API, acompanha por consulta (polling 3 s)
  config.ts          schemas zod, helpers puros (número, duração, motivo do fim) e
                     configuracaoDoUa() — a configuração SIP, testável sem socket
  servidor.ts        guardar/ler configuração e ramais, cifrar senha, decidir o modo
  chamadas.ts        registrar a ligação em voice_calls, marcar o resultado, listar por contato
  toque.ts           toque de chamada recebida e de "chamando", sintetizados no navegador
lib/fluxo/cliente.ts cliente da API REST da Fluxo (header api-token), nunca vaza o token
components/webphone/ WebphoneProvider (monta o telefone certo), WebphoneDock (tela),
                     LigarPeloTelefone (botão), HistoricoDeLigacoes (aba), contexto.ts
app/api/v1/webphone/ settings, ramais, ramais/[userId], credenciais, modo, quem-e,
                     chamadas, chamadas/[id], central/{ramais,ligar,status,encerrar}
app/app/settings/webphone/   tela de configuração (administrador)
supabase/migrations/ 8801, 8802, 8803 (+ apêndice idempotente em supabase/baseline.sql)
tests/unit/          webphone-*.test.ts, fluxo-cliente.test.ts
```

## 4. Dados

- `org_webphone_settings` — **uma linha por organização**: `wss_url`, `sip_domain`,
  `dial_prefix`, `painel_url`, `is_active`. Não é segredo; qualquer membro lê, só `admin` escreve.
- `user_webphone_ramais` — **uma linha por pessoa**: `ramal`, `sip_user` (nome de
  autenticação quando difere do ramal), senha SIP cifrada (AES-GCM, chave `AI_CRED_AES_KEY`,
  nunca no banco) e `secret_last4`. A senha **só chega ao navegador do próprio dono**
  (`GET /api/v1/webphone/credenciais`, `Cache-Control: no-store`). Admin vê a lista pela
  view `user_webphone_ramais_safe`, sem senha.
- Cada ligação vira uma linha em `voice_calls` (`provider = 'sip'`, `handled_by = 'human'`),
  com o id gerado no navegador como chave de idempotência. O telefone fica em `peer_phone`
  e entra na cascata de anonimização da LGPD. **Não há texto livre** em ligação.
- Auditoria registra a ação e a direção, nunca o número.

## 5. Como a Fluxo está configurada (valores que não são segredo)

- Central: Asterisk 18, chan_sip, realm `asterisk`.
- Servidor WebSocket seguro: `wss://suporte.intercert.com.br:8089/ws`.
- **Nome de autenticação = código da empresa + «_» + ramal** (ex.: `1000_1001`). O ramal
  sozinho (`1001`) é recusado com 403. Por isso existe a coluna `sip_user`.
- Codecs: PCMU (a central transcodifica) e opus.
- API de Click to Call: header `api-token`; `POST /call/exten/originate`, `/call/exten`
  (situação), `/call/exten/hangup`, `/extensions` (lista de ramais). Não há webhook:
  o CRM consulta a situação a cada 3 s.
- Ficam no `.env` da instalação (e **não** em `lib/env.ts` nem em `.env.example`: lacuna
  conhecida, ver seção 9): `FLUXO_API_URL` e `FLUXO_API_TOKEN`. O container do app
  recebe o `.env` inteiro (`env_file`), então basta preencher na VPS.

## 6. As lições que custaram horas (leia antes de mexer)

1. **O ramal registrado precisa de `contact_uri` real.** Sem ele o JsSIP se apresenta com
   um endereço inventado (`xxxx.invalid`); a central consegue tocar o ramal, mas o
   BYE de quem desligou nunca chega. Sintoma: o outro lado desliga e o CRM continua «em ligação».
   Resolvido em `configuracaoDoUa()`.
2. **Sem WebRTC não há ICE útil aqui:** `pcConfig: { iceServers: [] }`. A central está
   alcançável direto; STUN só atrapalharia.
3. **O toque de «chamando» é gerado no navegador** (`Toque("chamando")`). A central não
   manda áudio antecipado, então sem ele quem liga ouve silêncio e acha que não saiu.
4. **Ligação de saída ficava muda; entrada funcionava.** Causa: o navegador só decodifica
   áudio que está sendo reproduzido, e o elemento ficava pausado em `readyState 0`. A
   correção (`garantirSomRemoto` em `motor.ts`) liga ao elemento o som que a conexão
   recebe, no atendimento e a cada medida, sem depender do evento `track`.
5. **VPN ligada zera o áudio** (0 pacotes nos dois sentidos, enquanto a ligação toca e
   atende normalmente). Foi a causa de um «nenhum lado escuta» em produção. Primeira
   pergunta de qualquer diagnóstico.
6. **Microfone:** o CRM usa o microfone padrão do navegador. O nome do que está em uso
   aparece em «Detalhes do áudio». Não há seletor ainda.
7. **Senha digitada na tela é o único jeito de o navegador registrar o ramal.** A senha SIP
   é credencial de telefonia, não de banco; fica cifrada e só o dono a recebe.

## 7. Como diagnosticar uma ligação (a tabela de leitura)

Durante a conversa, abra **Detalhes do áudio** na pílula:

| O que aparece | Significa |
|---|---|
| Pacotes recebidos **e** enviados em 0 | O áudio não saiu do navegador. Rede/VPN/firewall bloqueando UDP |
| Recebidos > 0, **bytes/pacote = 160** (PCMU), amostras decodificadas em 0 | O som chega, o navegador não toca. Ver «Elemento de áudio» |
| Elemento «pausado · readyState 0» | Reprodução não ligada (era o defeito da seção 6.4) |
| Amostras decodificadas subindo, «Som recebido» em 0 | A central manda silêncio: problema de tronco/linha |
| «Som captado pelo microfone» em 0 falando | Microfone errado ou sem permissão |
| «Microfone em uso» | Qual dispositivo o navegador realmente pegou |

## 8. Como repetir para outro cliente com a MESMA central (Fluxo)

É configuração, não código — tudo na tela **Configurações › Telefone no navegador**:

1. Cadastrar o servidor (WSS e domínio) e, se quiser o botão «Abrir a janela da central»,
   o endereço do painel.
2. Para cada atendente, escolher o ramal (a lista vem da própria central quando há token),
   informar o nome de autenticação se for diferente do ramal, e a senha SIP.
3. Conferir que o ramal da central está criado **como ramal de navegador (WebRTC)**.
4. Teste de aceite: ligar para o celular próprio, falar nos dois sentidos, olhar «Detalhes
   do áudio».

Limite atual: o token da API (Ligar pela central) é **um por instalação**. Para revender a
vários clientes com tokens diferentes, precisa guardar `FLUXO_API_URL`/`FLUXO_API_TOKEN`
**por organização, cifrados** (a mesma técnica da senha SIP). `lerConfigDaCentral()` já é o
único ponto que lê isso — trocar a fonte não toca o resto.

## 9. Como repetir para OUTRA central ou OUTRO sistema de telefonia

### 9.1. Qualquer central que fale SIP sobre WebSocket (Asterisk, FreeSWITCH, Kamailio…)

O modo «navegador» já serve, sem código novo. Checklist do que perguntar ao provedor:

- Endereço `wss://…` e domínio SIP.
- Como se monta o **nome de autenticação** (só o ramal? código da empresa + ramal?).
- O ramal precisa estar habilitado para **WebRTC** (DTLS-SRTP e ICE) — a central tem de
  aceitar mídia criptografada. Em Asterisk, o ramal precisa de `webrtc=yes` (ou equivalente).
- Codecs aceitos (PCMU/PCMA/opus). O navegador oferece todos; a central escolhe.
- Se o certificado do `wss` é válido (o navegador recusa autoassinado).
- Senha SIP de cada ramal.

Sinais de que **não** vai funcionar sem trabalho: central só com SIP/UDP sem WebSocket;
ramais sem WebRTC; realm que muda por chamada.

### 9.2. Central que só oferece API (sem SIP no navegador)

Escreva um novo adaptador que implemente a interface `Telefone` (`lib/webphone/telefone.ts`),
seguindo o `ClickToCall`:

1. Um cliente HTTP novo em `lib/<provedor>/cliente.ts` com `ligar`, `consultar`, `desligar`
   (e opcionalmente listar ramais). Regras: token só no servidor, nunca em erro/log/resposta.
2. Rotas finas em `app/api/v1/webphone/<provedor>/…` com `requireRole`, `requireSupportWrite`
   antes do efeito, auditoria sem número, e rate limit.
3. Um adaptador no navegador que implementa `Telefone` e declara
   `capacidades = { controlesDeAudio: false, atendePeloCrm: false }`, e termina chamando
   `aoEncerrar` com um `RegistroDaChamada` (o resto — gravar, fechamento, histórico — já existe).
4. Escolher o adaptador em `WebphoneProvider.tsx` (hoje decidido por `modoDoUsuario`).
5. Testes no estilo de `tests/unit/webphone-click-to-call.test.ts`: dependências injetáveis
   e relógio falso, cobrindo atendida, cancelada, sem resposta e falha.

### 9.3. Outro sistema que precisa disparar chamadas para o CRM

A auth dupla do projeto (`Authorization: Bearer dsk_…`) permite converter a rota que a
integração precisar. Registrar uma ligação feita fora do CRM é `POST /api/v1/webphone/chamadas`
(hoje com cookie; para bearer é preciso `lib/api/auth-dual.ts` **e** uma entrada em
`lib/auth/public-paths.ts`, ou o `proxy.ts` devolve 401 antes do handler).

## 10. O que falta (não anunciar como pronto)

- **Seletor de microfone e de caixa de som** dentro do CRM (hoje depende do navegador).
- **Transferência de chamada** (provável `session.refer()` do JsSIP + lista de ramais para
  o atendente; hoje a lista de ramais da central é só de administrador).
- **Token da central por organização**, cifrado, para revenda.
- `FLUXO_API_URL`/`FLUXO_API_TOKEN` fora de `lib/env.ts` e de `.env.example` (viola o item 9
  da Definition of Done do projeto).
- Aviso «CALLSYS-LOGIN»: quando o atendente entra no call center pelo omnichannel, a central
  pode tocar brevemente o ramal do CRM.
- Isolamento entre organizações das tabelas novas **não foi exercitado por `pnpm test:db`**
  (exige Docker). A política RLS está escrita; falta a prova.
- Nenhuma gravação de chamada: o CRM não grava áudio.
