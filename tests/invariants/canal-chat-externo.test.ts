import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { seedGov, GOV_ORG as org } from "./gov-helpers";

/**
 * O CANAL CHAT EXTERNO (migration 9109) — o que o BANCO segura, sem depender do código:
 *
 *   - o provider novo é aceito e exige a SUA referência (tagged union), e os providers que já existiam seguem
 *     aceitos — em especial o `web` do InterSuite, que esta migration não pode quebrar;
 *   - a referência do canal é única entre canais ATIVOS da organização (índice parcial), e arquivar libera;
 *   - o código externo do setor é minúsculo, sem espaço nas pontas, de 1 a 64 caracteres e único por organização;
 *   - os INSERTs que a ingestão do chat faz (contato com CPF cifrado + identidade, conversa pela RPC de sempre,
 *     mensagem do histórico marcada) são aceitos pelo schema de verdade — é o que os testes de unidade, com banco
 *     em memória, NÃO provam.
 */
const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
  max: 3,
});
const query = (text: string, args: unknown[] = []) => pool.query(text, args);

const OUTRA_ORG = "dddddddd-0000-4000-8000-000000009109";
const IDENTIDADE = "web:0b6f3f9e-1c7a-4c1e-9a55-2d5a1e7c9f10";

async function violacao(text: string, args: unknown[] = []): Promise<string | null> {
  try {
    await query(text, args);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "erro";
  }
}

async function criarCanal(organizationId: string, ref: string | null, provider = "chat_externo"): Promise<string> {
  const r = await query(
    `insert into channel_sessions(organization_id, provider, chat_externo_ref, display_name, status,
                                  webhook_path_token, webhook_secret_encrypted)
     values($1, $2, $3, 'Chat', 'WORKING', substr(md5(random()::text || clock_timestamp()::text),1,24), decode('00','hex'))
     returning id`,
    [organizationId, provider, ref],
  );
  return r.rows[0].id as string;
}

async function limpar() {
  await query("delete from messages where organization_id = any($1)", [[org, OUTRA_ORG]]);
  await query("delete from conversations where organization_id = any($1) and provider_conversation_id is not null", [[org, OUTRA_ORG]]);
  await query("delete from contacts where organization_id = any($1) and social_identity like 'web:%'", [[org, OUTRA_ORG]]);
  await query("delete from channel_sessions where organization_id = any($1) and provider in ('chat_externo','web')", [[org, OUTRA_ORG]]);
  await query("delete from attendant_sectors where organization_id = any($1)", [[org, OUTRA_ORG]]);
}

beforeAll(async () => {
  seedGov();
  await query(
    "insert into organizations(id,slug,legal_name,display_name) values($1,'chat-externo-9109','Chat Externo','Chat Externo') on conflict(id) do nothing",
    [OUTRA_ORG],
  );
});
afterAll(async () => {
  await limpar();
  await pool.end();
});
beforeEach(limpar);

describe("provider chat_externo e a sua referência", () => {
  it("é aceito com a referência, e RECUSADO sem ela", async () => {
    await expect(criarCanal(org, "principal")).resolves.toEqual(expect.any(String));
    expect(await violacao(
      `insert into channel_sessions(organization_id, provider, webhook_secret_encrypted)
       values($1,'chat_externo',decode('00','hex'))`,
      [org],
    )).toBe("23514"); // check_violation: channel_sessions_provider_ref_check
  });

  it("os providers que já existiam seguem aceitos: waha e, principalmente, o web do InterSuite", async () => {
    // waha com o próprio nome de sessão
    await query(
      `insert into channel_sessions(organization_id, provider, waha_session_name, webhook_secret_encrypted)
       values($1,'waha','chat-externo-9109-waha',decode('00','hex'))`,
      [org],
    );
    // web com o id do widget — o canal do InterSuite não foi tocado
    await query(
      `insert into channel_sessions(organization_id, provider, web_widget_id, webhook_secret_encrypted)
       values($1,'web','widget-9109',decode('00','hex'))`,
      [org],
    );
    // e o web continua EXIGINDO o widget
    expect(await violacao(
      `insert into channel_sessions(organization_id, provider, webhook_secret_encrypted)
       values($1,'web',decode('00','hex'))`,
      [org],
    )).toBe("23514");
    await query("delete from channel_sessions where waha_session_name = 'chat-externo-9109-waha'");
  });

  it("provider desconhecido continua recusado", async () => {
    expect(await violacao(
      `insert into channel_sessions(organization_id, provider, chat_externo_ref, webhook_secret_encrypted)
       values($1,'qualquer_coisa','x',decode('00','hex'))`,
      [org],
    )).toBe("23514");
  });

  it("a referência é única entre canais ATIVOS da organização; arquivar libera; outra organização pode repetir", async () => {
    const primeiro = await criarCanal(org, "principal");
    expect(await violacao(
      `insert into channel_sessions(organization_id, provider, chat_externo_ref, webhook_path_token, webhook_secret_encrypted)
       values($1,'chat_externo','principal',substr(md5(random()::text || clock_timestamp()::text),1,24),decode('00','hex'))`,
      [org],
    )).toBe("23505");

    // outra organização pode usar a mesma referência
    await expect(criarCanal(OUTRA_ORG, "principal")).resolves.toEqual(expect.any(String));

    // arquivado não trava recriar
    await query("update channel_sessions set archived_at = now() where id = $1", [primeiro]);
    await expect(criarCanal(org, "principal")).resolves.toEqual(expect.any(String));
  });
});

describe("código externo do setor", () => {
  const setor = (organizationId: string, name: string, code: string | null) =>
    query("insert into attendant_sectors(organization_id,name,external_code) values($1,$2,$3) returning id", [
      organizationId,
      name,
      code,
    ]);

  it("aceita o código minúsculo e deixa NULL em quem não tem", async () => {
    await setor(org, "Suporte", "suporte-tecnico");
    await setor(org, "Financeiro", null);
    await setor(org, "Comercial", null); // vários sem código convivem
    const r = await query("select count(*)::int n from attendant_sectors where organization_id=$1 and external_code is null", [org]);
    expect(r.rows[0].n).toBe(2);
  });

  it.each([
    ["maiúscula", "Suporte"],
    ["espaço nas pontas", " suporte"],
    ["vazio", ""],
    ["maior que 64 caracteres", "a".repeat(65)],
  ])("RECUSA código com %s (o CHECK é a régua do banco)", async (_nome, codigo) => {
    expect(await violacao("insert into attendant_sectors(organization_id,name,external_code) values($1,'Setor X',$2)", [org, codigo])).toBe("23514");
  });

  it("é único por organização; a outra organização pode usar o mesmo", async () => {
    await setor(org, "Suporte", "suporte-tecnico");
    expect(await violacao("insert into attendant_sectors(organization_id,name,external_code) values($1,'Outro nome','suporte-tecnico')", [org])).toBe("23505");
    await expect(setor(OUTRA_ORG, "Suporte", "suporte-tecnico")).resolves.toBeTruthy();
  });
});

describe("os INSERTs que a ingestão do chat faz, contra o schema de verdade", () => {
  it("contato com CPF cifrado + identidade; conversa pela RPC de sempre; histórico marcado", async () => {
    const canal = await criarCanal(org, "principal");

    // contato: identidade do chat, origem web e o PAR de CPF que a constraint exige (hash + cifrado)
    const contato = await query(
      `insert into contacts(organization_id, social_identity, name, display_name, source, kind, cpf_hash, cpf_encrypted)
       values($1,$2,'Maria','Maria','web','person', repeat('a',64), decode('010203','hex'))
       returning id`,
      [org, IDENTIDADE],
    );
    const contactId = contato.rows[0].id as string;

    // hash sem o cifrado é recusado (contacts_cpf_consistency): é por isso que a ingestão usa camposCpfParaGravar
    expect(await violacao(
      `insert into contacts(organization_id, social_identity, kind, cpf_hash) values($1,'web:outro','person',repeat('b',64))`,
      [org],
    )).toBe("23514");
    // o MESMO CPF em outro contato da organização é recusado: o índice único é o motivo de reaproveitar o contato
    expect(await violacao(
      `insert into contacts(organization_id, social_identity, kind, cpf_hash, cpf_encrypted)
       values($1,'web:outro','person',repeat('a',64),decode('010203','hex'))`,
      [org],
    )).toBe("23505");

    // conversa: a RPC de sempre, depois a identidade do chat e o canal `web` da conversa
    const conversa = await query("select fn_upsert_wa_conversation($1,$2,$3) as id", [org, contactId, canal]);
    const conversationId = conversa.rows[0].id as string;
    await query("update conversations set provider_conversation_id=$2, channel='web' where id=$1", [conversationId, IDENTIDADE]);
    const lida = await query("select status, assigned_to_user_id, channel, provider_conversation_id from conversations where id=$1", [conversationId]);
    expect(lida.rows[0]).toMatchObject({ assigned_to_user_id: null, channel: "web", provider_conversation_id: IDENTIDADE });
    expect(["open", "pending"]).toContain(lida.rows[0].status);

    // histórico do bot: um do cliente (inbound) e um do bot (outbound, automation), com o id prefixado
    await query(
      `insert into messages(organization_id, conversation_id, contact_id, channel_session_id, external_id, direction, sent_via, status, type, body, metadata)
       values($1,$2,$3,$4,$5,'inbound','external_device','delivered','text','Preciso de suporte','{"importado_do_bot":true}'::jsonb)`,
      [org, conversationId, contactId, canal, `chat_externo:${IDENTIDADE}:bot_001`],
    );
    await query(
      `insert into messages(organization_id, conversation_id, contact_id, channel_session_id, external_id, direction, sent_via, status, type, body, metadata)
       values($1,$2,$3,$4,$5,'outbound','automation','delivered','text','Qual o seu CPF?','{"importado_do_bot":true}'::jsonb)`,
      [org, conversationId, contactId, canal, `chat_externo:${IDENTIDADE}:bot_002`],
    );
    // reenviar o mesmo histórico é recusado pela unicidade (a ingestão trata o 23505 como "já importado")
    expect(await violacao(
      `insert into messages(organization_id, conversation_id, contact_id, channel_session_id, external_id, direction, sent_via, status, type, body)
       values($1,$2,$3,$4,$5,'inbound','external_device','delivered','text','Preciso de suporte')`,
      [org, conversationId, contactId, canal, `chat_externo:${IDENTIDADE}:bot_001`],
    )).toBe("23505");

    // aviso de encerramento do cliente: outbound/system
    await query(
      `insert into messages(organization_id, conversation_id, contact_id, channel_session_id, external_id, direction, sent_via, status, type, body)
       values($1,$2,$3,$4,$5,'outbound','system','delivered','text','O cliente encerrou o atendimento pelo chat.')`,
      [org, conversationId, contactId, canal, `chat_externo:${IDENTIDADE}:encerrado`],
    );
  });
});

describe("o fechamento pelo cliente e os anexos, contra o schema de verdade", () => {
  /** Contato + conversa do chat, como a ingestão os cria. */
  async function conversaDoChat() {
    const canal = await criarCanal(org, "principal");
    const contato = await query(
      `insert into contacts(organization_id, social_identity, name, display_name, source, kind)
       values($1,$2,'Maria','Maria','web','person') returning id`,
      [org, IDENTIDADE],
    );
    const contactId = contato.rows[0].id as string;
    const conversa = await query("select fn_upsert_wa_conversation($1,$2,$3) as id", [org, contactId, canal]);
    const conversationId = conversa.rows[0].id as string;
    await query("update conversations set provider_conversation_id=$2, channel='web' where id=$1", [conversationId, IDENTIDADE]);
    return { canal, contactId, conversationId };
  }

  it("fn_service_status FECHA a conversa e é idempotente: a segunda chamada não mexe em nada", async () => {
    const { conversationId } = await conversaDoChat();
    const antes = await query("select status, service_revision, service_closed_at from conversations where id=$1", [conversationId]);
    expect(["open", "pending"]).toContain(antes.rows[0].status);

    // a MESMA chamada da ingestão (`chat.closed_by_customer`): sem `p_expected`
    const primeira = await query("select status, service_revision, service_closed_at from fn_service_status($1,$2,'closed')", [org, conversationId]);
    expect(primeira.rows[0].status).toBe("closed");
    expect(Number(primeira.rows[0].service_revision)).toBe(Number(antes.rows[0].service_revision) + 1);
    expect(primeira.rows[0].service_closed_at).not.toBeNull();

    // o reenvio do Chat: já está fechada → devolve a linha, sem nova revisão nem novo carimbo
    const segunda = await query("select status, service_revision, service_closed_at from fn_service_status($1,$2,'closed')", [org, conversationId]);
    expect(segunda.rows[0].status).toBe("closed");
    expect(Number(segunda.rows[0].service_revision)).toBe(Number(primeira.rows[0].service_revision));
    expect(segunda.rows[0].service_closed_at).toEqual(primeira.rows[0].service_closed_at);

    const lida = await query("select status from conversations where id=$1", [conversationId]);
    expect(lida.rows[0].status).toBe("closed");
  });

  it("conversa que não existe: a RPC devolve P0002 (a ingestão trata como 'nada a fechar', não como erro)", async () => {
    expect(await violacao("select fn_service_status($1,'00000000-0000-4000-8000-0000000000aa','closed')", [org])).toBe("P0002");
  });

  it("a RPC não alcança conversa de OUTRA organização", async () => {
    const { conversationId } = await conversaDoChat();
    expect(await violacao("select fn_service_status($1,$2,'closed')", [OUTRA_ORG, conversationId])).toBe("P0002");
    const lida = await query("select status from conversations where id=$1", [conversationId]);
    expect(["open", "pending"]).toContain(lida.rows[0].status);
  });

  it("as linhas de anexo (imagem e documento, texto na 1ª) entram, e o reenvio de cada uma é recusado pela unicidade", async () => {
    const { canal, contactId, conversationId } = await conversaDoChat();
    const URL_1 = "https://chat.exemplo.com.br/api/files/a1?exp=9&sig=aa";
    const URL_2 = "https://chat.exemplo.com.br/api/files/a2?exp=9&sig=bb";
    const inserir = (externalId: string, tipo: string, corpo: string, url: string, mime: string, nome: string) =>
      query(
        `insert into messages(organization_id, conversation_id, contact_id, channel_session_id, external_id, direction,
                              sent_via, status, type, body, media_url, media_mime, metadata)
         values($1,$2,$3,$4,$5,'inbound','external_device','delivered',$6,$7,$8,$9,
                jsonb_build_object('source','chat_externo','media_filename',$10::text))
         returning id`,
        [org, conversationId, contactId, canal, externalId, tipo, corpo, url, mime, nome],
      );

    const foto = await inserir("m1", "image", "Segue a foto e o contrato", URL_1, "image/jpeg", "foto.jpg");
    await inserir("m1:anexo2", "document", "", URL_2, "application/pdf", "contrato.pdf");

    const lidas = await query(
      "select external_id, type, body, media_url, media_mime, metadata->>'media_filename' as nome, media_storage_path from messages where conversation_id=$1 order by external_id",
      [conversationId],
    );
    expect(lidas.rows).toEqual([
      { external_id: "m1", type: "image", body: "Segue a foto e o contrato", media_url: URL_1, media_mime: "image/jpeg", nome: "foto.jpg", media_storage_path: null },
      { external_id: "m1:anexo2", type: "document", body: "", media_url: URL_2, media_mime: "application/pdf", nome: "contrato.pdf", media_storage_path: null },
    ]);

    // o reenvio do mesmo evento: cada linha bate na unicidade (a ingestão lê o 23505 como "já gravei")
    expect(await violacao(
      `insert into messages(organization_id, conversation_id, contact_id, channel_session_id, external_id, direction, sent_via, status, type, body)
       values($1,$2,$3,$4,'m1','inbound','external_device','delivered','image','')`,
      [org, conversationId, contactId, canal],
    )).toBe("23505");
    expect(await violacao(
      `insert into messages(organization_id, conversation_id, contact_id, channel_session_id, external_id, direction, sent_via, status, type, body)
       values($1,$2,$3,$4,'m1:anexo2','inbound','external_device','delivered','document','')`,
      [org, conversationId, contactId, canal],
    )).toBe("23505");

    // e o pedido de persistência (mesma chamada da ingestão) é aceito, ligado à mensagem de verdade
    const mensagemId = foto.rows[0].id as string;
    await query(
      `select emit_event(p_event_type => 'media.persist_requested', p_entity_kind => 'message', p_entity_id => $1::uuid,
                         p_payload => jsonb_build_object('message_id', $1::text, 'conversation_id', $2::text),
                         p_metadata => '{"source":"chat_externo_webhook"}'::jsonb, p_organization_id => $3::uuid)`,
      [mensagemId, conversationId, org],
    );
    const evento = await query(
      "select event_type, payload->>'message_id' as message_id from event_log where organization_id=$1 and entity_id=$2 and event_type='media.persist_requested'",
      [org, mensagemId],
    );
    expect(evento.rows).toEqual([{ event_type: "media.persist_requested", message_id: mensagemId }]);
  });
});
