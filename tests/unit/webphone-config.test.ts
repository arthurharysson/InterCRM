import { describe, expect, it } from "vitest";

import {
  configuracaoDoWebphoneSchema,
  destinoDaChamada,
  duracaoLegivel,
  numeroDeQuemLigou,
  numeroParaDiscar,
  ramalDoUsuarioSchema,
  uriSipDoRamal,
} from "@/lib/webphone/config";

describe("webphone — configuração do servidor", () => {
  const valida = { wss_url: "wss://central.exemplo.com.br:8089/ws", sip_domain: "central.exemplo.com.br" };

  it("aceita um endereço WebSocket seguro e preenche os padrões", () => {
    const r = configuracaoDoWebphoneSchema.parse(valida);
    expect(r.dial_prefix).toBe("");
    expect(r.is_active).toBe(true);
  });

  it("recusa ws:// — o navegador bloqueia WebSocket sem criptografia numa página https", () => {
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, wss_url: "ws://central.exemplo.com.br/ws" }).success).toBe(false);
  });

  it("recusa endereço com espaço ou sem host", () => {
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, wss_url: "wss://" }).success).toBe(false);
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, wss_url: "wss://a b/ws" }).success).toBe(false);
  });

  it("recusa domínio com esquema ou porta — é só o nome", () => {
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, sip_domain: "https://central.exemplo.com.br" }).success).toBe(false);
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, sip_domain: "central.exemplo.com.br:5060" }).success).toBe(false);
  });

  it("limita o prefixo de discagem a dígitos, * e #", () => {
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, dial_prefix: "0" }).success).toBe(true);
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, dial_prefix: "0115" }).success).toBe(true);
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, dial_prefix: "abc" }).success).toBe(false);
    expect(configuracaoDoWebphoneSchema.safeParse({ ...valida, dial_prefix: "1234567" }).success).toBe(false);
  });
});

describe("webphone — ramal do atendente", () => {
  it("aceita ramal numérico e senha", () => {
    expect(ramalDoUsuarioSchema.safeParse({ ramal: "0359", password: "segredo" }).success).toBe(true);
  });

  it("a senha é opcional (mantém a que já existe) mas, se vier, tem ao menos 4 caracteres", () => {
    expect(ramalDoUsuarioSchema.safeParse({ ramal: "0359" }).success).toBe(true);
    expect(ramalDoUsuarioSchema.safeParse({ ramal: "0359", password: "abc" }).success).toBe(false);
  });

  it("recusa ramal com espaço, @ ou barra — iria direto para a URI SIP", () => {
    for (const ruim of ["03 59", "0359@x", "03/59", ""]) {
      expect(ramalDoUsuarioSchema.safeParse({ ramal: ruim }).success).toBe(false);
    }
  });
});

describe("webphone — discagem", () => {
  it("reduz o que foi digitado a dígitos, * e #", () => {
    expect(numeroParaDiscar("+55 (21) 99999-8888")).toBe("5521999998888");
    expect(numeroParaDiscar("*8#")).toBe("*8#");
  });

  it("monta o destino SIP com o prefixo da organização", () => {
    expect(destinoDaChamada("(21) 99999-8888", "central.exemplo.com.br", "0")).toBe(
      "sip:021999998888@central.exemplo.com.br",
    );
    expect(destinoDaChamada("21999998888", "central.exemplo.com.br")).toBe("sip:21999998888@central.exemplo.com.br");
  });

  it("não disca quando não sobra nenhum dígito", () => {
    expect(destinoDaChamada("abc", "central.exemplo.com.br")).toBeNull();
    expect(destinoDaChamada("", "central.exemplo.com.br", "0")).toBeNull();
  });

  it("monta a URI SIP do ramal", () => {
    expect(uriSipDoRamal("0359", "central.exemplo.com.br")).toBe("sip:0359@central.exemplo.com.br");
  });
});

describe("webphone — quem ligou", () => {
  it("tira o número do cabeçalho de origem", () => {
    expect(numeroDeQuemLigou("sip:21999998888@central.exemplo.com.br")).toBe("21999998888");
    expect(numeroDeQuemLigou("sips:5521999998888@10.0.0.1;transport=wss")).toBe("5521999998888");
  });

  it("chamada anônima ou sem origem não tem número", () => {
    expect(numeroDeQuemLigou("sip:anonymous@anonymous.invalid")).toBeNull();
    expect(numeroDeQuemLigou(null)).toBeNull();
    expect(numeroDeQuemLigou(undefined)).toBeNull();
    expect(numeroDeQuemLigou("lixo")).toBeNull();
  });
});

describe("webphone — duração", () => {
  it("formata mm:ss e h:mm:ss", () => {
    expect(duracaoLegivel(0)).toBe("00:00");
    expect(duracaoLegivel(65)).toBe("01:05");
    expect(duracaoLegivel(3725)).toBe("1:02:05");
  });

  it("nunca devolve duração negativa", () => {
    expect(duracaoLegivel(-5)).toBe("00:00");
  });
});
