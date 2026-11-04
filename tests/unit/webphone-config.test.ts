import { describe, expect, it } from "vitest";

import {
  configuracaoDoUa,
  configuracaoDoWebphoneSchema,
  destinoDaChamada,
  duracaoLegivel,
  ehLigacaoPerdida,
  motivoDoFim,
  numeroDeQuemLigou,
  numeroParaDiscar,
  ramalDoUsuarioSchema,
  registroDaChamadaSchema,
  resultadoDaChamadaSchema,
  tipoDaLigacao,
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

describe("webphone — configuração com e sem telefone no navegador", () => {
  it("aceita só a janela da central, sem WebSocket nem domínio", () => {
    const r = configuracaoDoWebphoneSchema.safeParse({ painel_url: "https://central.exemplo.com.br/omnichannel" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ wss_url: null, sip_domain: null });
  });

  it("texto vazio do formulário vira nulo, nunca string vazia no banco", () => {
    const r = configuracaoDoWebphoneSchema.parse({ wss_url: "", sip_domain: "  ", painel_url: "https://c.exemplo.com.br" });
    expect(r.wss_url).toBeNull();
    expect(r.sip_domain).toBeNull();
  });

  it("WebSocket e domínio andam juntos: um sem o outro não serve", () => {
    expect(configuracaoDoWebphoneSchema.safeParse({ wss_url: "wss://c.exemplo.com.br/ws", painel_url: "https://c.exemplo.com.br" }).success).toBe(false);
    expect(configuracaoDoWebphoneSchema.safeParse({ sip_domain: "c.exemplo.com.br", painel_url: "https://c.exemplo.com.br" }).success).toBe(false);
  });

  it("sem nenhum caminho (nem navegador, nem janela) não há o que salvar", () => {
    expect(configuracaoDoWebphoneSchema.safeParse({}).success).toBe(false);
  });

  it("a janela da central só aceita https", () => {
    expect(configuracaoDoWebphoneSchema.safeParse({ painel_url: "http://central.exemplo.com.br" }).success).toBe(false);
    expect(configuracaoDoWebphoneSchema.safeParse({ painel_url: "javascript:alert(1)" }).success).toBe(false);
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

  it("o usuário SIP aceita o nome da central, vazio vira nulo e espaço é recusado", () => {
    expect(ramalDoUsuarioSchema.parse({ ramal: "1201", sip_user: "1000_1201" }).sip_user).toBe("1000_1201");
    expect(ramalDoUsuarioSchema.parse({ ramal: "1201", sip_user: "" }).sip_user).toBeNull();
    expect(ramalDoUsuarioSchema.parse({ ramal: "1201" }).sip_user).toBeUndefined();
    expect(ramalDoUsuarioSchema.safeParse({ ramal: "1201", sip_user: "1000 1201" }).success).toBe(false);
    expect(ramalDoUsuarioSchema.safeParse({ ramal: "1201", sip_user: "a@b" }).success).toBe(false);
  });

  it("recusa ramal com espaço, @ ou barra — iria direto para a URI SIP", () => {
    for (const ruim of ["03 59", "0359@x", "03/59", ""]) {
      expect(ramalDoUsuarioSchema.safeParse({ ramal: ruim }).success).toBe(false);
    }
  });
});

describe("webphone — a configuração do agente SIP", () => {
  const cred = {
    wss_url: "wss://central.exemplo.com.br:8089/ws",
    sip_domain: "central.exemplo.com.br",
    dial_prefix: "",
    ramal: "1001",
    usuario_sip: "1000_1001",
    password: "x",
  };

  it("registra e autentica pelo usuário SIP, e mostra o número do ramal como nome", () => {
    const c = configuracaoDoUa(cred);
    expect(c).toMatchObject({
      uri: "sip:1000_1001@central.exemplo.com.br",
      authorization_user: "1000_1001",
      display_name: "1001",
      registrar_server: "sip:central.exemplo.com.br",
      realm: "central.exemplo.com.br",
    });
  });

  it("o contato é um endereço de verdade, não o inventado (.invalid): é por ele que a central manda o BYE", () => {
    const c = configuracaoDoUa(cred);
    expect(c.contact_uri).toBe("sip:1000_1001@central.exemplo.com.br");
    expect(c.contact_uri).not.toMatch(/invalid/);
  });

  it("sem usuário SIP próprio, o contato e a autenticação usam o próprio ramal", () => {
    const c = configuracaoDoUa({ ...cred, usuario_sip: "1001" });
    expect(c.authorization_user).toBe("1001");
    expect(c.contact_uri).toBe("sip:1001@central.exemplo.com.br");
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

describe("webphone — por que a ligação acabou", () => {
  it("ligação atendida sempre acaba por 'user_ended', qualquer que seja a causa", () => {
    expect(motivoDoFim({ atendida: true, causa: "Terminated" })).toBe("user_ended");
    expect(motivoDoFim({ atendida: true, causa: "Bye" })).toBe("user_ended");
  });

  it("traduz as causas do JsSIP para o vocabulário do banco", () => {
    expect(motivoDoFim({ atendida: false, causa: "Canceled" })).toBe("cancelled");
    expect(motivoDoFim({ atendida: false, causa: "Rejected" })).toBe("declined");
    expect(motivoDoFim({ atendida: false, causa: "Busy" })).toBe("busy");
    expect(motivoDoFim({ atendida: false, causa: "No Answer" })).toBe("timeout");
    expect(motivoDoFim({ atendida: false, causa: "Request Timeout" })).toBe("timeout");
  });

  it("o que não sabe nomear é 'failed' (a chamada não completou)", () => {
    expect(motivoDoFim({ atendida: false, causa: "User Denied Media Access" })).toBe("failed");
    expect(motivoDoFim({ atendida: false, causa: "Connection Error" })).toBe("failed");
  });
});

describe("webphone — ligação perdida", () => {
  it("é perdida a recebida que ninguém atendeu porque quem ligou desistiu ou ninguém pegou", () => {
    expect(ehLigacaoPerdida({ direcao: "entrada", atendida: false, motivo: "cancelled" })).toBe(true);
    expect(ehLigacaoPerdida({ direcao: "entrada", atendida: false, motivo: "timeout" })).toBe(true);
  });

  it("recusar não é perder, e ligação atendida ou de saída nunca é perdida", () => {
    expect(ehLigacaoPerdida({ direcao: "entrada", atendida: false, motivo: "declined" })).toBe(false);
    expect(ehLigacaoPerdida({ direcao: "entrada", atendida: true, motivo: "user_ended" })).toBe(false);
    expect(ehLigacaoPerdida({ direcao: "saida", atendida: false, motivo: "timeout" })).toBe(false);
  });

  it("a linha do histórico é classificada com a mesma regra", () => {
    expect(tipoDaLigacao({ direction: "inbound", answered_at: null, end_reason: "cancelled" })).toBe("perdida");
    expect(tipoDaLigacao({ direction: "inbound", answered_at: "2026-11-04T10:00:00Z", end_reason: "user_ended" })).toBe("recebida");
    expect(tipoDaLigacao({ direction: "outbound", answered_at: null, end_reason: "timeout" })).toBe("feita");
  });
});

describe("webphone — corpo do registro da ligação", () => {
  const corpo = {
    id: "5b0f9d1e-0c6a-4f6e-9a5e-3f1f2f0b9a11",
    direction: "outbound",
    numero: "21999998888",
    started_at: "2026-11-04T13:00:00.000Z",
    answered_at: "2026-11-04T13:00:08.000Z",
    ended_at: "2026-11-04T13:02:22.000Z",
    end_reason: "user_ended",
  };

  it("aceita uma ligação completa e uma perdida (sem atendimento)", () => {
    expect(registroDaChamadaSchema.safeParse(corpo).success).toBe(true);
    expect(
      registroDaChamadaSchema.safeParse({ ...corpo, direction: "inbound", answered_at: null, end_reason: "cancelled" }).success,
    ).toBe(true);
  });

  it("recusa id que não é UUID, direção estranha e motivo fora do vocabulário", () => {
    expect(registroDaChamadaSchema.safeParse({ ...corpo, id: "1" }).success).toBe(false);
    expect(registroDaChamadaSchema.safeParse({ ...corpo, direction: "sideways" }).success).toBe(false);
    expect(registroDaChamadaSchema.safeParse({ ...corpo, end_reason: "porque_sim" }).success).toBe(false);
  });

  it("o resultado é de vocabulário fechado — texto livre não entra", () => {
    expect(resultadoDaChamadaSchema.safeParse({ resultado: "pediu_retorno" }).success).toBe(true);
    expect(resultadoDaChamadaSchema.safeParse({ resultado: "falei com a Maria, o filho dela está doente" }).success).toBe(false);
  });
});
