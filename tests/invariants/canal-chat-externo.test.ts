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
