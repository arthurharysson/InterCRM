/**
 * O CÓDIGO EXTERNO do setor (migration 9109) no contrato da API de setores.
 *
 * É o nome com que o bot do WhatsApp indica a fila. Duas réguas têm de concordar: a do Zod (aqui) e a do CHECK da
 * coluna (`external_code = lower(btrim(...))`, 1 a 64 caracteres) — o Zod é mais estreito de propósito, e nunca
 * mais largo: o que ele aceita, o banco aceita.
 */
import { describe, expect, it } from "vitest";

import { CODIGO_DO_SETOR, sectorCreateSchema, sectorPatchSchema } from "@/lib/schemas/routing";

describe("external_code na criação", () => {
  it("é opcional: omitir não muda o que já existia", () => {
    expect(sectorCreateSchema.parse({ name: "Suporte" })).toMatchObject({ name: "Suporte", description: null });
    expect(sectorCreateSchema.parse({ name: "Suporte" })).not.toHaveProperty("external_code", "x");
  });

  it("normaliza: tira espaço das pontas e vai para minúsculo", () => {
    expect(sectorCreateSchema.parse({ name: "Suporte", external_code: "  Suporte-Tecnico " }).external_code).toBe(
      "suporte-tecnico",
    );
  });

  it("vazio ou null viram null (sem código)", () => {
    expect(sectorCreateSchema.parse({ name: "S", external_code: "" }).external_code).toBeNull();
    expect(sectorCreateSchema.parse({ name: "S", external_code: null }).external_code).toBeNull();
  });

  it.each(["suporte tecnico", "suporte_tecnico", "-suporte", "suporte!", "ação", "x".repeat(64)])(
    "recusa %j (só letras minúsculas, números e hífen; começa com letra ou número; até 63 caracteres)",
    (codigo) => {
      expect(sectorCreateSchema.safeParse({ name: "S", external_code: codigo }).success).toBe(false);
    },
  );

  it("aceita os códigos do dia a dia, até o tamanho máximo da régua", () => {
    for (const ok of ["suporte-tecnico", "financeiro", "n1", "a".repeat(63)]) {
      expect(sectorCreateSchema.safeParse({ name: "S", external_code: ok }).success).toBe(true);
    }
  });
});

describe("external_code na edição", () => {
  it("sozinho já é uma edição válida; null APAGA o código", () => {
    expect(sectorPatchSchema.parse({ external_code: "financeiro" })).toEqual({ external_code: "financeiro" });
    expect(sectorPatchSchema.parse({ external_code: null })).toEqual({ external_code: null });
    expect(sectorPatchSchema.parse({ external_code: "" })).toEqual({ external_code: null });
  });

  it("corpo vazio continua recusado", () => {
    expect(sectorPatchSchema.safeParse({}).success).toBe(false);
  });

  it("a régua do Zod nunca é MAIS LARGA que a do CHECK do banco", () => {
    // o CHECK: minúsculo, sem espaço nas pontas, 1 a 64 caracteres
    const checkDoBanco = (v: string) => v === v.toLowerCase().trim() && v.length >= 1 && v.length <= 64;
    for (const amostra of ["a", "suporte-tecnico", "0-9", "a".repeat(63)]) {
      expect(CODIGO_DO_SETOR.test(amostra)).toBe(true);
      expect(checkDoBanco(amostra)).toBe(true);
    }
  });
});
