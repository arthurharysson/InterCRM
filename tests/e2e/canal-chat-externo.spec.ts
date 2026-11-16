/**
 * O CHAT EXTERNO, PELA TELA — como um administrador leigo o usaria, num banco fresco estilo VPS.
 *
 * ═══ A JORNADA ═══════════════════════════════════════════════════════════════════════════════════
 *
 *   1. Equipe › Setores: o administrador cria o setor "Suporte técnico" com o código `suporte-tecnico` (é o nome
 *      com que o bot do WhatsApp indica a fila);
 *   2. Conexões › "Chat fora do WhatsApp": cria o canal com o endereço do chat e VÊ as três coisas que cola no Chat
 *      (endereço de entrada e as duas chaves) — mostradas UMA vez;
 *   3. o Chat (aqui, a própria spec, assinando com a chave que a tela mostrou) avisa que o cliente abriu o link:
 *      a conversa nasce na FILA, com o histórico do bot e o setor certo;
 *   4. o cliente escreve: a mensagem aparece na conversa;
 *   5. recarregar a tela de Conexões NÃO mostra as chaves de novo, e girá-las invalida as antigas.
 *
 * ═══ O QUE ESTA SPEC NÃO PROVA ═══════════════════════════════════════════════════════════════════
 *
 * A RESPOSTA do atendente até o Chat (CRM → Chat). Ela vai por POST ao endereço que o administrador gravou, e o
 * endereço passa na proteção anti-SSRF do produto (https público, nunca `localhost`): um receptor local é recusado de
 * propósito. Essa ponta é provada por teste de unidade (adapter) e só se vê de ponta a ponta com o Chat de verdade
 * num endereço https. A spec grava essa limitação em vez de contorná-la.
 *
 * Pré-requisito: `.e2e-creds.json` (scripts/seed-e2e-credentials.ts).
 */
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { test, expect } from "./helpers/test";
import { lerCreds, loginComoAdmin, type CredsE2E } from "./helpers/login-admin";

const credenciais = credenciaisSupabaseDeTeste();
const db = createClient(credenciais.url, credenciais.serviceRole, { auth: { persistSession: false } });

const EVIDENCIA = path.join(process.cwd(), "evidence", "canal-chat-externo");
mkdirSync(EVIDENCIA, { recursive: true });

const CHAVE_MODULO = "MODULO_SETORES";
const sufixo = Date.now().toString(36).slice(-5);
const CODIGO_DO_SETOR = `suporte-${sufixo}`;
const NOME_DO_SETOR = `Suporte técnico ${sufixo}`;
const IDENTIDADE = `web:${crypto.randomUUID()}`;
const ENDERECO_DO_CHAT = "https://chat.exemplo.com.br/api/crm/events";

let creds: CredsE2E;
let moduloAntes: string | null = null;
let canalId: string | null = null;
let orgId: string;

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const assinar = (corpo: string, segredo: string) => "sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex");

test.beforeAll(async () => {
  creds = lerCreds();
  const org = await db.from("organizations").select("id").eq("slug", "e2e-test-org").single();
  if (org.error ?? !org.data) throw org.error ?? new Error('organização "e2e-test-org" não encontrada');
  orgId = (org.data as { id: string }).id;
  // O módulo Setores nasce DESLIGADO em toda instalação; a jornada começa com ele ligado pelo dono.
  const atual = await db.from("platform_config").select("valor").eq("chave", CHAVE_MODULO).maybeSingle();
  if (atual.error) throw atual.error;
  moduloAntes = (atual.data?.valor as string | null) ?? null;
  const ligar = await db
    .from("platform_config")
    .upsert({ chave: CHAVE_MODULO, valor: "ligado", eh_segredo: false, semeado_do_env: false }, { onConflict: "chave" });
  if (ligar.error) throw ligar.error;
});

test.afterAll(async () => {
  if (canalId) {
    // `channel_sessions` é âncora de FK: o que o teste criou sai arquivado, como o produto faz.
    await db.from("channel_sessions").update({ archived_at: new Date().toISOString() }).eq("id", canalId);
  }
  await db.from("attendant_sectors").delete().eq("organization_id", orgId).eq("external_code", CODIGO_DO_SETOR);
  if (moduloAntes === null) await db.from("platform_config").delete().eq("chave", CHAVE_MODULO);
  else await db.from("platform_config").upsert({ chave: CHAVE_MODULO, valor: moduloAntes, eh_segredo: false, semeado_do_env: false }, { onConflict: "chave" });
});

let entrada: string;
let segredoDoChat: string; // o que o Chat usa para assinar (a tela chama de "Chave que o Chat usa para falar com o CRM")
let segredoDoCrm: string;

test("(1) o administrador cria o setor com o código que o bot usa", async ({ page }) => {
  creds = await loginComoAdmin(page, creds);
  await page.goto("/app/team?aba=setores");

  await page.getByLabel("Nome do setor").first().fill(NOME_DO_SETOR);
  await page.getByLabel("Código para o bot (opcional)").first().fill(CODIGO_DO_SETOR);
  // o campo normaliza: maiúscula e espaço viram minúscula e hífen enquanto se digita
  await page.getByLabel("Código para o bot (opcional)").first().fill("  Suporte Teste ");
  await expect(page.getByLabel("Código para o bot (opcional)").first()).toHaveValue(/^-?suporte-teste-?$/);
  await page.getByLabel("Código para o bot (opcional)").first().fill(CODIGO_DO_SETOR);
  await page.screenshot({ path: path.join(EVIDENCIA, "1-setor-formulario.png") });

  await page.getByRole("button", { name: "Criar setor" }).click();
  await expect(page.getByText(NOME_DO_SETOR).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(CODIGO_DO_SETOR).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCIA, "1-setor-criado.png") });

  const salvo = await db.from("attendant_sectors").select("external_code").eq("organization_id", orgId).eq("name", NOME_DO_SETOR).single();
  expect(salvo.data?.external_code).toBe(CODIGO_DO_SETOR);
});

test("(2) cria o canal em Conexões e vê as chaves UMA vez", async ({ page }) => {
  creds = await loginComoAdmin(page, creds);
  await page.goto("/app/connections?aba=chat");

  await expect(page.getByTestId("canal-chat-publico")).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCIA, "2-conexoes-chat-vazio.png") });

  await page.getByLabel("Nome do canal").fill("Chat de atendimento");
  await page.getByLabel("Endereço do chat (para onde o CRM envia as respostas)").first().fill(ENDERECO_DO_CHAT);
  await page.getByRole("button", { name: "Criar o canal" }).click();

  const chaves = page.getByTestId("chat-chaves-novas");
  await expect(chaves).toBeVisible({ timeout: 20_000 });
  await expect(chaves.getByText("CRM_ENTRY_URL")).toBeVisible();
  await expect(chaves.getByText("CRM_SECRET_TO_CRM")).toBeVisible();
  await expect(chaves.getByText("CRM_SECRET_FROM_CRM")).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCIA, "2-chaves-mostradas-uma-vez.png") });

  const codigos = await chaves.locator("code").allTextContents();
  entrada = codigos.find((c) => c.includes("/api/v1/webhooks/channel/")) ?? "";
  const hex = codigos.filter((c) => /^[0-9a-f]{64}$/.test(c));
  expect(entrada, "a tela precisa mostrar o endereço de entrada").toMatch(/\/api\/v1\/webhooks\/channel\/[0-9a-f]{48}$/);
  expect(hex, "a tela precisa mostrar as DUAS chaves").toHaveLength(2);
  [segredoDoChat, segredoDoCrm] = hex as [string, string];
  expect(segredoDoChat).not.toBe(segredoDoCrm);

  // O que está no banco é CIFRADO: nenhuma das duas chaves aparece em claro na linha do canal.
  const linha = await db
    .from("channel_sessions")
    .select("id, provider, chat_externo_url, webhook_secret_encrypted, chat_externo_secret_out_encrypted")
    .eq("organization_id", orgId)
    .eq("provider", "chat_externo")
    .is("archived_at", null)
    .single();
  canalId = linha.data?.id ?? null;
  expect(linha.data?.chat_externo_url).toBe(ENDERECO_DO_CHAT);
  expect(JSON.stringify(linha.data)).not.toContain(segredoDoChat);
  expect(JSON.stringify(linha.data)).not.toContain(segredoDoCrm);

  await chaves.getByRole("button", { name: "Entendi, já guardei" }).click();
  await expect(chaves).toHaveCount(0);
});

test("(3) recarregar NÃO mostra as chaves de novo; o canal aparece pronto", async ({ page }) => {
  creds = await loginComoAdmin(page, creds);
  await page.goto("/app/connections?aba=chat");

  const cartao = page.getByTestId("chat-canal");
  await expect(cartao).toBeVisible();
  await expect(cartao.getByText("Pronto")).toBeVisible();
  await expect(page.getByTestId("chat-chaves-novas")).toHaveCount(0);
  const todoTexto = await page.locator("body").innerText();
  expect(todoTexto).not.toContain(segredoDoChat);
  expect(todoTexto).not.toContain(segredoDoCrm);
  await page.screenshot({ path: path.join(EVIDENCIA, "3-canal-pronto-sem-chaves.png") });
});

test("(4) o Chat avisa que o cliente abriu o link: a conversa nasce na Fila, com histórico e setor", async ({ page, request }) => {
  const corpo = JSON.stringify({
    event: "chat.started",
    identity: IDENTIDADE,
    started_at: new Date().toISOString(),
    sector: CODIGO_DO_SETOR,
    contact: { name: `Maria ${sufixo}` },
    history: [
      { message_id: "bot_001", from: "customer", text: "Preciso de suporte, minha internet caiu", sent_at: new Date(Date.now() - 120_000).toISOString() },
      { message_id: "bot_002", from: "bot", text: "Olá! Qual é o seu CPF?", sent_at: new Date(Date.now() - 110_000).toISOString() },
    ],
  });

  // assinatura errada: recusada (a rota é pública, quem autentica é a assinatura)
  const recusada = await request.post(entrada, { data: corpo, headers: { "content-type": "application/json", "x-deskcomm-signature": assinar(corpo, "outra-chave-qualquer-0123456789abcdef") } });
  expect(recusada.status()).toBe(401);

  const ok = await request.post(entrada, { data: corpo, headers: { "content-type": "application/json", "x-deskcomm-signature": assinar(corpo, segredoDoChat), "x-chat-contract": "2" } });
  expect(ok.status()).toBe(200);
  const resposta = (await ok.json()) as { data: { status: string; setorAplicado: boolean; historicoImportado: number } };
  expect(resposta.data).toMatchObject({ status: "ingested", setorAplicado: true, historicoImportado: 2 });

  // reenviar o MESMO evento não duplica nada
  const repetido = await request.post(entrada, { data: corpo, headers: { "content-type": "application/json", "x-deskcomm-signature": assinar(corpo, segredoDoChat) } });
  expect(((await repetido.json()) as { data: { status: string } }).data.status).toBe("duplicate");

  // a tela: a conversa está na lista (Inbox), aberta e sem dono, e o histórico do bot aparece
  creds = await loginComoAdmin(page, creds);
  await page.goto("/app/inbox");
  await page.getByRole("tab", { name: /^Todas/ }).click();
  // a linha da lista traz a última do histórico — antes de abrir a conversa, nunca "Sem mensagens"
  await expect(page.getByText("Olá! Qual é o seu CPF?").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Sem mensagens")).toHaveCount(0);
  await page.getByText(`Maria ${sufixo}`).first().click();
  await expect(page.getByText("Preciso de suporte, minha internet caiu")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("chat-thread").getByText("Olá! Qual é o seu CPF?")).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCIA, "4-conversa-na-fila-com-historico.png") });

  const conversa = await db
    .from("conversations")
    .select("assigned_to_user_id, sector_id, channel, provider_conversation_id")
    .eq("organization_id", orgId)
    .eq("provider_conversation_id", IDENTIDADE)
    .single();
  expect(conversa.data).toMatchObject({ assigned_to_user_id: null, channel: "web", provider_conversation_id: IDENTIDADE });
  expect(conversa.data?.sector_id, "a conversa precisa estar no setor do código").toBeTruthy();
});

test("(5) o cliente escreve e a mensagem aparece na conversa", async ({ page, request }) => {
  const corpo = JSON.stringify({ identity: IDENTIDADE, text: `Alguém pode me ajudar? ${sufixo}`, message_id: `msg-${sufixo}-1` });
  const r = await request.post(entrada, { data: corpo, headers: { "content-type": "application/json", "x-deskcomm-signature": assinar(corpo, segredoDoChat) } });
  expect(r.status()).toBe(200);

  creds = await loginComoAdmin(page, creds);
  await page.goto("/app/inbox");
  await page.getByRole("tab", { name: /^Todas/ }).click();
  await page.getByText(`Maria ${sufixo}`).first().click();
  await expect(page.getByText(`Alguém pode me ajudar? ${sufixo}`)).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: path.join(EVIDENCIA, "5-mensagem-do-cliente.png") });
});

test("(6) girar as chaves mostra as novas UMA vez e as antigas deixam de valer", async ({ page, request }) => {
  creds = await loginComoAdmin(page, creds);
  await page.goto("/app/connections?aba=chat");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Girar as chaves" }).click();

  const chaves = page.getByTestId("chat-chaves-novas");
  await expect(chaves).toBeVisible({ timeout: 20_000 });
  const novas = (await chaves.locator("code").allTextContents()).filter((c) => /^[0-9a-f]{64}$/.test(c));
  expect(novas).toHaveLength(2);
  expect(novas).not.toContain(segredoDoChat);
  await page.screenshot({ path: path.join(EVIDENCIA, "6-chaves-giradas.png") });

  const corpo = JSON.stringify({ identity: IDENTIDADE, text: "depois de girar", message_id: `msg-${sufixo}-2` });
  const antiga = await request.post(entrada, { data: corpo, headers: { "content-type": "application/json", "x-deskcomm-signature": assinar(corpo, segredoDoChat) } });
  expect(antiga.status(), "a chave ANTIGA não pode mais valer").toBe(401);
  const nova = await request.post(entrada, { data: corpo, headers: { "content-type": "application/json", "x-deskcomm-signature": assinar(corpo, novas.find((n) => n !== segredoDoCrm) ?? novas[0]!) } });
  // a chave nova de ENTRADA é a primeira que a tela mostra (a mesma ordem do cartão da criação)
  const primeiraDaTela = assinar(corpo, novas[0]!);
  const viaPrimeira = await request.post(entrada, { data: corpo, headers: { "content-type": "application/json", "x-deskcomm-signature": primeiraDaTela } });
  expect([nova.status(), viaPrimeira.status()]).toContain(200);
});
