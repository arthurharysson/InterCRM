/**
 * COMO ESTA PESSOA LIGA: navegador, central ou nenhum.
 *
 * A decisão que liga o telefone certo a cada pessoa — e que NÃO pode entregar
 * senha a quem só tem o número do ramal. O banco é falso; o que se prova é a
 * regra, linha por linha.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/crypto/aes_gcm", () => ({
  bufToBytea: (b: Buffer) => `\\x${b.toString("hex")}`,
  byteaToBuffer: (v: unknown) => Buffer.from(String(v), "utf8"),
  encryptKey: (t: string) => ({ ciphertext: Buffer.from(t), iv: Buffer.from("iv"), tag: Buffer.from("tag"), last4: t.slice(-4) }),
  decryptKey: ({ ciphertext }: { ciphertext: Buffer }) => ciphertext.toString("utf8"),
}));

import { credenciaisDoDono, guardarRamal, modoDoUsuario } from "@/lib/webphone/servidor";

type Linha = Record<string, unknown> | null;

/** Um banco falso: cada tabela devolve a linha que o teste mandar. */
function bancoFalso(tabelas: Record<string, Linha>, gravados: Array<{ tabela: string; valores: Record<string, unknown> }> = []) {
  return {
    from: (tabela: string) => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        is: () => cadeia,
        maybeSingle: () => Promise.resolve({ data: tabelas[tabela] ?? null, error: null }),
        upsert: (valores: Record<string, unknown>) => {
          gravados.push({ tabela, valores });
          return Promise.resolve({ error: null });
        },
      };
      return cadeia;
    },
  } as never;
}

const ORG = "11111111-1111-4111-8111-111111111111";
const EU = "22222222-2222-4222-8222-222222222222";
const cfgCompleta = { wss_url: "wss://c.example.com/ws", sip_domain: "c.example.com", painel_url: "https://c.example.com/omni", dial_prefix: "", is_active: true };
const ramalComSenha = { ramal: "0359", secret_encrypted: "x", secret_iv: "i", secret_tag: "t", is_active: true };
const ramalSemSenha = { ramal: "0359", secret_encrypted: null, secret_iv: null, secret_tag: null, is_active: true };

describe("modoDoUsuario", () => {
  it("ramal com senha e endereço de WebSocket: o CRM é o telefone", async () => {
    const r = await modoDoUsuario({ admin: bancoFalso({ org_webphone_settings: cfgCompleta, user_webphone_ramais: ramalComSenha }), orgId: ORG, userId: EU });
    expect(r).toEqual({ modo: "navegador", ramal: "0359", painel_url: "https://c.example.com/omni" });
  });

  it("ramal só com o número: liga pela central, e não recebe credencial", async () => {
    const admin = bancoFalso({ org_webphone_settings: cfgCompleta, user_webphone_ramais: ramalSemSenha });
    expect((await modoDoUsuario({ admin, orgId: ORG, userId: EU })).modo).toBe("central");
    expect(await credenciaisDoDono({ admin, orgId: ORG, userId: EU })).toBeNull();
  });

  it("organização sem WebSocket só tem a central, mesmo que o ramal tenha senha", async () => {
    const cfg = { ...cfgCompleta, wss_url: null, sip_domain: null };
    const admin = bancoFalso({ org_webphone_settings: cfg, user_webphone_ramais: ramalComSenha });
    expect((await modoDoUsuario({ admin, orgId: ORG, userId: EU })).modo).toBe("central");
    expect(await credenciaisDoDono({ admin, orgId: ORG, userId: EU })).toBeNull();
  });

  it("sem ramal, com ramal desligado ou com a organização desligada: nenhum modo", async () => {
    const vazio = { modo: null, ramal: null, painel_url: null };
    expect(await modoDoUsuario({ admin: bancoFalso({ org_webphone_settings: cfgCompleta }), orgId: ORG, userId: EU })).toEqual(vazio);
    expect(
      await modoDoUsuario({
        admin: bancoFalso({ org_webphone_settings: cfgCompleta, user_webphone_ramais: { ...ramalComSenha, is_active: false } }),
        orgId: ORG,
        userId: EU,
      }),
    ).toEqual(vazio);
    expect(
      await modoDoUsuario({
        admin: bancoFalso({ org_webphone_settings: { ...cfgCompleta, is_active: false }, user_webphone_ramais: ramalComSenha }),
        orgId: ORG,
        userId: EU,
      }),
    ).toEqual(vazio);
  });

  it("o modo nunca carrega a senha", async () => {
    const r = await modoDoUsuario({ admin: bancoFalso({ org_webphone_settings: cfgCompleta, user_webphone_ramais: ramalComSenha }), orgId: ORG, userId: EU });
    expect(JSON.stringify(r)).not.toMatch(/secret|senha|password/i);
  });
});

describe("guardarRamal sem senha", () => {
  const membro = { user_id: EU };

  it("cria o ramal só com o número, sem campos de senha", async () => {
    const gravados: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
    const r = await guardarRamal({
      admin: bancoFalso({ user_organizations: membro }, gravados),
      orgId: ORG,
      atorId: EU,
      usuarioId: EU,
      ramal: { ramal: "0359", is_active: true },
    });
    expect(r).toEqual({ ok: true });
    const valores = gravados.find((g) => g.tabela === "user_webphone_ramais")!.valores;
    expect(valores).toMatchObject({ organization_id: ORG, user_id: EU, ramal: "0359", is_active: true });
    expect("secret_encrypted" in valores).toBe(false);
  });

  it("com senha, grava cifrada e só os 4 últimos caracteres em claro", async () => {
    const gravados: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
    await guardarRamal({
      admin: bancoFalso({ user_organizations: membro }, gravados),
      orgId: ORG,
      atorId: EU,
      usuarioId: EU,
      ramal: { ramal: "0359", password: "senha-secreta-7391", is_active: true },
    });
    const valores = gravados.find((g) => g.tabela === "user_webphone_ramais")!.valores;
    expect(valores.secret_last4).toBe("7391");
    expect(JSON.stringify(valores)).not.toContain("senha-secreta");
  });

  it("não cria ramal para quem não é membro da organização", async () => {
    const r = await guardarRamal({
      admin: bancoFalso({}),
      orgId: ORG,
      atorId: EU,
      usuarioId: EU,
      ramal: { ramal: "0359", is_active: true },
    });
    expect(r).toEqual({ ok: false, motivo: "usuario_fora_da_organizacao" });
  });
});

describe("o usuário SIP — o nome com que o ramal se autentica", () => {
  it("usa o `sip_user` quando a central autentica por outro nome (ex.: 1000_1201)", async () => {
    const admin = bancoFalso({
      org_webphone_settings: cfgCompleta,
      user_webphone_ramais: { ...ramalComSenha, ramal: "1201", sip_user: "1000_1201" },
    });
    const c = await credenciaisDoDono({ admin, orgId: ORG, userId: EU });
    expect(c).toMatchObject({ ramal: "1201", usuario_sip: "1000_1201", password: "x" });
  });

  it("sem `sip_user`, autentica pelo próprio ramal — o que já funcionava não muda", async () => {
    const admin = bancoFalso({ org_webphone_settings: cfgCompleta, user_webphone_ramais: ramalComSenha });
    const c = await credenciaisDoDono({ admin, orgId: ORG, userId: EU });
    expect(c).toMatchObject({ ramal: "0359", usuario_sip: "0359" });
  });

  it("gravar o ramal com `sip_user` leva a coluna; omitir não a toca; `null` a limpa", async () => {
    const membro = { user_id: EU };
    const gravar = async (sip_user?: string | null) => {
      const gravados: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
      await guardarRamal({
        admin: bancoFalso({ user_organizations: membro }, gravados),
        orgId: ORG,
        atorId: EU,
        usuarioId: EU,
        ramal: { ramal: "1201", is_active: true, ...(sip_user === undefined ? {} : { sip_user }) },
      });
      return gravados.find((g) => g.tabela === "user_webphone_ramais")!.valores;
    };
    expect((await gravar("1000_1201")).sip_user).toBe("1000_1201");
    expect("sip_user" in (await gravar())).toBe(false);
    expect((await gravar(null)).sip_user).toBeNull();
  });
});
