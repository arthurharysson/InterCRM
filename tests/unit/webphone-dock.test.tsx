/**
 * O TELEFONE NA TELA, EM CADA ESTADO DO ROTEIRO.
 *
 * Monta `WebphoneDock` de verdade, com o contexto do webphone no lugar do motor
 * (que abre socket e pede microfone — não é o assunto aqui). O que se prova é a
 * TELA que cada estado desenha e o que cada botão pede ao motor:
 *
 *   repouso → pílula e discador; tocando → Atender/Recusar com o nome de quem
 *   ligou; em conversa → mudo, espera, teclado, desligar e a qualidade do
 *   áudio; fechamento → resultado da ligação, "ligar de volta" na perdida.
 *
 * NÃO prova áudio, registro SIP nem geometria (o jsdom não faz layout). Isso é
 * da medida no navegador, com um ramal de verdade.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
const registroDeToques = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/webphone/toque", () => ({
  Toque: class {
    constructor(private tipo: string = "recebida") {}
    iniciar() {
      registroDeToques.push(this.tipo);
    }
    parar() {
      registroDeToques.push("parou");
    }
  },
}));

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: api.get } }));

import { CtxDoWebphone, SEM_WEBPHONE, type ContextoDoWebphone } from "@/components/webphone/contexto";
import { WebphoneDock } from "@/components/webphone/WebphoneDock";

const acoes = {
  discar: vi.fn(() => true),
  atender: vi.fn(),
  encerrar: vi.fn(),
  alternarMudo: vi.fn(),
  alternarEspera: vi.fn(),
  enviarTom: vi.fn(),
  ativarSom: vi.fn(),
  escolherResultado: vi.fn(),
  fecharFechamento: vi.fn(),
};

function montar(parcial: Partial<ContextoDoWebphone>) {
  const valor: ContextoDoWebphone = {
    ...SEM_WEBPHONE,
    disponivel: true,
    registro: "registrado",
    capacidades: { controlesDeAudio: true, atendePeloCrm: true },
    ...acoes,
    ...parcial,
  };
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Envolver = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>
      <CtxDoWebphone.Provider value={valor}>{children}</CtxDoWebphone.Provider>
    </QueryClientProvider>
  );
  return render(<WebphoneDock />, { wrapper: Envolver });
}

const chamadaBase = {
  direcao: "entrada" as const,
  numero: "21999998888",
  estado: "tocando" as const,
  mudo: false,
  emEspera: false,
  atendidaEm: null,
  qualidade: null,
  midia: { ice: null, recebendo: null, enviando: null, somBloqueado: false, somRemoto: false },
};

beforeEach(() => {
  Object.values(acoes).forEach((f) => f.mockClear());
  api.get.mockReset();
  api.get.mockResolvedValue({ data: null });
});

describe("telefone — repouso", () => {
  it("mostra o estado do ramal e abre o discador com o teclado", () => {
    montar({ registro: "registrado" });
    expect(screen.getByRole("button", { name: "Abrir o telefone" })).toHaveTextContent("Ramal conectado");
    fireEvent.click(screen.getByRole("button", { name: "Abrir o telefone" }));
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByLabelText("Número para ligar")).toHaveValue("21");
  });

  it("só deixa ligar com o ramal registrado e com número", () => {
    montar({ registro: "offline" });
    fireEvent.click(screen.getByRole("button", { name: "Abrir o telefone" }));
    expect(screen.getByRole("button", { name: "Ligar agora" })).toBeDisabled();
    expect(screen.getAllByText("Ramal desconectado").length).toBeGreaterThan(0);
  });

  it("liga pelo botão e pela tecla Enter", () => {
    montar({ registro: "registrado" });
    fireEvent.click(screen.getByRole("button", { name: "Abrir o telefone" }));
    const campo = screen.getByLabelText("Número para ligar");
    fireEvent.change(campo, { target: { value: "(21) 99999-8888" } });
    expect(campo).toHaveValue("21999998888");
    fireEvent.click(screen.getByRole("button", { name: "Ligar agora" }));
    expect(acoes.discar).toHaveBeenCalledWith("21999998888");
  });
});

describe("telefone — chamada recebida", () => {
  it("mostra o nome do contato, o número e os dois botões", async () => {
    api.get.mockResolvedValue({ data: { contact_id: "c-1", nome: "Maria Souza" } });
    montar({ chamada: chamadaBase });
    expect(screen.getByRole("alertdialog", { name: "Chamada recebida" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Maria Souza")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Atender" }));
    fireEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(acoes.atender).toHaveBeenCalledTimes(1);
    expect(acoes.encerrar).toHaveBeenCalledTimes(1);
  });

  it("número que não é de ninguém aparece como contato desconhecido", async () => {
    montar({ chamada: chamadaBase });
    await waitFor(() => expect(screen.getByText("Contato desconhecido")).toBeInTheDocument());
  });

  it("chamada sem número (anônima) mostra 'Número oculto'", () => {
    montar({ chamada: { ...chamadaBase, numero: null } });
    expect(screen.getByText("Número oculto")).toBeInTheDocument();
  });
});

describe("telefone — em conversa", () => {
  const emConversa = { ...chamadaBase, estado: "em_andamento" as const, atendidaEm: Date.now() - 134_000 };

  it("mostra os controles, desliga e abre o teclado da URA", () => {
    montar({ chamada: emConversa });
    fireEvent.click(screen.getByRole("button", { name: "Silenciar o microfone" }));
    fireEvent.click(screen.getByRole("button", { name: "Colocar em espera" }));
    fireEvent.click(screen.getByRole("button", { name: "Teclado" }));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Desligar chamada" }));
    expect(acoes.alternarMudo).toHaveBeenCalledTimes(1);
    expect(acoes.alternarEspera).toHaveBeenCalledTimes(1);
    expect(acoes.enviarTom).toHaveBeenCalledWith("5");
    expect(acoes.encerrar).toHaveBeenCalledTimes(1);
  });

  it("mostra a qualidade do áudio só quando há o que medir", () => {
    const { rerender } = montar({ chamada: emConversa });
    expect(screen.queryByText(/Qualidade da chamada/)).toBeNull();
    rerender(<span />);
    montar({ chamada: { ...emConversa, qualidade: "regular" } });
    expect(screen.getByText("Regular")).toBeInTheDocument();
  });

  it("não acusa problema de áudio enquanto nada foi medido (null não é false)", () => {
    montar({ chamada: emConversa });
    expect(screen.queryByText(/Nenhum áudio da central/)).toBeNull();
    expect(screen.queryByText(/não está enviando áudio/)).toBeNull();
  });

  it("diz a verdade quando a medida mostra que o som não passa", () => {
    montar({
      chamada: { ...emConversa, midia: { ice: "failed", recebendo: false, enviando: false, somBloqueado: false, somRemoto: false } },
    });
    expect(screen.getByText(/A conexão do áudio com a central não fechou/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum áudio da central está chegando/)).toBeInTheDocument();
    expect(screen.getByText(/O seu microfone não está enviando áudio/)).toBeInTheDocument();
  });

  it("áudio chegando mas microfone mudo avisa só do microfone", () => {
    montar({ chamada: { ...emConversa, midia: { ice: "connected", recebendo: true, enviando: false, somBloqueado: false, somRemoto: false } } });
    expect(screen.queryByText(/Nenhum áudio da central/)).toBeNull();
    expect(screen.getByText(/O seu microfone não está enviando áudio/)).toBeInTheDocument();
  });

  it("mostra os números do áudio em 'Detalhes do áudio' para quem for dar suporte", () => {
    montar({
      chamada: {
        ...emConversa,
        midia: {
          ice: "connected",
          recebendo: false,
          enviando: true,
          somBloqueado: false,
          somRemoto: true,
          pacotesRecebidos: 0,
          pacotesEnviados: 312,
          caminho: "host → host",
        },
      },
    });
    expect(screen.getByText("Detalhes do áudio")).toBeInTheDocument();
    expect(screen.getByText("312")).toBeInTheDocument();
    expect(screen.getByText("host → host")).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("chega pacote mas sem som: diz que a voz da outra pessoa não está passando pela central", () => {
    montar({
      chamada: {
        ...emConversa,
        midia: {
          ice: "connected",
          recebendo: true,
          enviando: true,
          somBloqueado: false,
          somRemoto: true,
          pacotesRecebidos: 786,
          pacotesEnviados: 1045,
          caminho: "prflx → host",
          energiaRecebida: 0,
          elementoTocando: true,
        },
      },
    });
    expect(screen.getByText(/chegando áudio da central, mas sem som nenhum/)).toBeInTheDocument();
    expect(screen.queryByText(/o navegador não está tocando/)).toBeNull();
  });

  it("chega som e o navegador não toca: manda olhar a saída de áudio", () => {
    montar({
      chamada: {
        ...emConversa,
        midia: {
          ice: "connected",
          recebendo: true,
          enviando: true,
          somBloqueado: false,
          somRemoto: true,
          pacotesRecebidos: 786,
          pacotesEnviados: 1045,
          caminho: "host → host",
          energiaRecebida: 2.4,
          elementoTocando: false,
        },
      },
    });
    expect(screen.getByText(/O som está chegando, mas o navegador não está tocando/)).toBeInTheDocument();
    expect(screen.queryByText(/sem som nenhum/)).toBeNull();
  });

  it("som chegando e tocando: sem aviso, e os números aparecem", () => {
    montar({
      chamada: {
        ...emConversa,
        midia: {
          ice: "connected",
          recebendo: true,
          enviando: true,
          somBloqueado: false,
          somRemoto: true,
          pacotesRecebidos: 786,
          pacotesEnviados: 1045,
          caminho: "host → host",
          energiaRecebida: 2.4,
          elementoTocando: true,
        },
      },
    });
    expect(screen.queryByText(/sem som nenhum/)).toBeNull();
    expect(screen.queryByText(/o navegador não está tocando/)).toBeNull();
    expect(screen.getByText("2.4000")).toBeInTheDocument();
    expect(screen.getByText("tocando")).toBeInTheDocument();
  });

  it("sem medida ainda, não desenha os detalhes", () => {
    montar({ chamada: emConversa });
    expect(screen.queryByText("Detalhes do áudio")).toBeNull();
  });

  it("quando o navegador bloqueia o som, avisa que a pessoa não está ouvindo e oferece ativar", () => {
    montar({ chamada: { ...emConversa, midia: { ice: "connected", recebendo: true, enviando: true, somBloqueado: true, somRemoto: false } } });
    expect(screen.getByText(/O navegador bloqueou o som desta ligação/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ativar o som" }));
    expect(acoes.ativarSom).toHaveBeenCalledTimes(1);
  });

  it("som liberado e áudio chegando: nenhum aviso", () => {
    montar({ chamada: { ...emConversa, midia: { ice: "connected", recebendo: true, enviando: true, somBloqueado: false, somRemoto: false } } });
    expect(screen.queryByText(/bloqueou o som/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ativar o som" })).toBeNull();
  });

  it("avisa quando o navegador bloqueou o microfone", () => {
    montar({ chamada: { ...emConversa, atendidaEm: null, estado: "chamando", direcao: "saida" }, microfoneNegado: true });
    expect(screen.getByText(/O navegador bloqueou o microfone/)).toBeInTheDocument();
  });
});

describe("telefone — Click to Call (o áudio é da janela da central)", () => {
  const sóPede = { controlesDeAudio: false, atendePeloCrm: false };
  const abrirJanela = vi.fn();

  it("o repouso não finge saber se o ramal está registrado e oferece abrir a janela", () => {
    montar({ capacidades: sóPede, painelUrl: "https://central.exemplo.com.br/omnichannel", abrirJanela });
    expect(screen.getByRole("button", { name: "Abrir o telefone" })).toHaveTextContent("Ligar pela central");
    fireEvent.click(screen.getByRole("button", { name: "Abrir o telefone" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir a janela da central" }));
    expect(abrirJanela).toHaveBeenCalledTimes(1);
  });

  it("sem endereço da janela, não oferece o botão", () => {
    montar({ capacidades: sóPede, painelUrl: null });
    fireEvent.click(screen.getByRole("button", { name: "Abrir o telefone" }));
    expect(screen.queryByRole("button", { name: "Abrir a janela da central" })).toBeNull();
  });

  it("em conversa, não mostra mudo, espera nem teclado: manda atender na janela e deixa desligar", () => {
    montar({
      capacidades: sóPede,
      painelUrl: "https://central.exemplo.com.br/omnichannel",
      abrirJanela,
      chamada: { ...chamadaBase, direcao: "saida", estado: "em_andamento", atendidaEm: Date.now() - 5000 },
    });
    expect(screen.queryByRole("button", { name: "Silenciar o microfone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Colocar em espera" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Teclado" })).toBeNull();
    expect(screen.getByText(/O áudio da ligação está na janela da central/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desligar chamada" }));
    expect(acoes.encerrar).toHaveBeenCalledTimes(1);
  });

  it("ligação que a central recusou mostra o motivo e oferece ligar de novo", () => {
    montar({
      capacidades: sóPede,
      fechamento: {
        id: "5b0f9d1e-0c6a-4f6e-9a5e-3f1f2f0b9a11",
        direcao: "saida",
        numero: "21999998888",
        atendida: false,
        perdida: false,
        duracaoS: 0,
        resultado: null,
        erro: "O ramal 0359 não está registrado.",
      },
    });
    expect(screen.getByText("O ramal 0359 não está registrado.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ligar de novo" })).toBeEnabled();
  });
});

describe("telefone — quem liga ouve que está chamando", () => {
  const toques = registroDeToques;
  const chamandoFora = { ...chamadaBase, direcao: "saida" as const, estado: "chamando" as const };

  it("gera o toque de espera enquanto a central não manda som, e o desliga quando atende", async () => {
    const { Toque } = await import("@/lib/webphone/toque");
    expect(Toque).toBeDefined();
    toques.length = 0;
    const { unmount } = montar({ chamada: chamandoFora });
    expect(toques).toEqual(["chamando"]);
    unmount();
    expect(toques).toEqual(["chamando", "parou"]);
  });

  it("não gera toque quando a central já mandou o som dela", () => {
    toques.length = 0;
    montar({ chamada: { ...chamandoFora, midia: { ...chamandoFora.midia, somRemoto: true } } });
    expect(toques).toEqual([]);
  });

  it("não gera toque para chamada recebida nem para o modo da central", () => {
    toques.length = 0;
    montar({ chamada: chamadaBase });
    expect(toques).not.toContain("chamando");
    montar({ capacidades: { controlesDeAudio: false, atendePeloCrm: false }, chamada: chamandoFora });
    expect(toques).not.toContain("chamando");
  });
});

describe("telefone — fechamento", () => {
  const fechamentoBase = {
    id: "5b0f9d1e-0c6a-4f6e-9a5e-3f1f2f0b9a11",
    direcao: "saida" as const,
    numero: "21999998888",
    atendida: true,
    perdida: false,
    duracaoS: 134,
    resultado: null,
    erro: null,
  };

  it("ligação atendida pede o resultado, com o tempo, e marca o escolhido", () => {
    montar({ fechamento: fechamentoBase });
    expect(screen.getByRole("dialog", { name: "Ligação encerrada" })).toBeInTheDocument();
    expect(screen.getByText("02:14")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pediu retorno" }));
    expect(acoes.escolherResultado).toHaveBeenCalledWith("pediu_retorno");
  });

  it("o resultado já escolhido aparece marcado", () => {
    montar({ fechamento: { ...fechamentoBase, resultado: "fechou_negocio" } });
    expect(screen.getByRole("button", { name: "Fechou negócio" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pediu retorno" })).toHaveAttribute("aria-pressed", "false");
  });

  it("ligação perdida oferece ligar de volta e não pede resultado", () => {
    montar({ fechamento: { ...fechamentoBase, direcao: "entrada", atendida: false, perdida: true, duracaoS: 0 } });
    expect(screen.getByRole("dialog", { name: "Ligação perdida" })).toBeInTheDocument();
    expect(screen.queryByText("Como foi a ligação?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ligar de volta" }));
    expect(acoes.discar).toHaveBeenCalledWith("21999998888");
  });

  it("'ligar de volta' fica desligado com o ramal fora do ar", () => {
    montar({
      registro: "offline",
      fechamento: { ...fechamentoBase, direcao: "entrada", atendida: false, perdida: true, duracaoS: 0 },
    });
    expect(screen.getByRole("button", { name: "Ligar de volta" })).toBeDisabled();
  });

  it("ligação de saída que não completou oferece ligar de novo", () => {
    montar({ fechamento: { ...fechamentoBase, atendida: false, duracaoS: 0 } });
    expect(screen.getByRole("dialog", { name: "A ligação não completou" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ligar de novo" })).toBeEnabled();
  });

  it("o X fecha o cartão", () => {
    montar({ fechamento: fechamentoBase });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(acoes.fecharFechamento).toHaveBeenCalledTimes(1);
  });
});
