"use client";
/**
 * O TELEFONE GLOBAL — monta UMA vez no shell autenticado (`app/app/layout.tsx`).
 *
 * Uma ligação sobrevive à navegação entre telas do CRM, e isso só funciona se o
 * telefone não remontar a cada rota. Este provider é o dono dele. Pergunta ao
 * servidor COMO esta pessoa liga (`/api/v1/webphone/modo`) e monta uma de duas
 * coisas, que a tela trata do mesmo jeito:
 *
 *   `navegador`  o CRM é o telefone — SIP no navegador, com áudio (`Webphone`);
 *   `central`    o CRM pede a ligação pela API e o áudio é da janela da central
 *                (`ClickToCall`).
 *
 * Quem não tem ramal (a organização não ligou, ou a pessoa ainda não recebeu um)
 * não paga nada: o modo vem `null`, nada é montado e nenhuma peça é desenhada.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { CtxDoWebphone, SEM_MOTOR, SEM_WEBPHONE, type ContextoDoWebphone } from "@/components/webphone/contexto";
import { WebphoneDock } from "@/components/webphone/WebphoneDock";
import { apiClient } from "@/lib/api/client";
import type { CredenciaisDoWebphone, ModoDoUsuario, ResultadoDaLigacao, SituacaoDaLigacao } from "@/lib/webphone/config";
import { ClickToCall } from "@/lib/webphone/click-to-call";
import { Webphone, type RegistroDaChamada } from "@/lib/webphone/motor";
import type { Telefone } from "@/lib/webphone/telefone";

const semOuvir = () => () => undefined;
const instantaneoVazio = () => SEM_MOTOR;

/** Janela pequena da central: o suficiente para o telefone dela, sem tomar a tela. */
const MEDIDAS_DA_JANELA = "popup=yes,width=440,height=680";
const NOME_DA_JANELA = "telefone-da-central";

/**
 * Onde o telefone vigente mora. Um armazém externo, e não `useState`, porque o
 * telefone nasce e morre dentro de um efeito (o embutido abre socket e pede o
 * microfone), e gravar estado do React de dentro de um efeito acorda a árvore
 * inteira uma segunda vez a cada troca. Aqui o efeito só publica; quem lê assina.
 */
class ArmazemDoTelefone {
  private atual: Telefone | null = null;
  private ouvintes = new Set<() => void>();

  subscribe = (ouvinte: () => void): (() => void) => {
    this.ouvintes.add(ouvinte);
    return () => {
      this.ouvintes.delete(ouvinte);
    };
  };

  pegar = (): Telefone | null => this.atual;

  publicar(telefone: Telefone | null): void {
    this.atual = telefone;
    for (const ouvinte of this.ouvintes) ouvinte();
  }
}

function corpoDoRegistro(r: RegistroDaChamada, via: "navegador" | "central") {
  return {
    id: r.id,
    direction: r.direcao === "entrada" ? "inbound" : "outbound",
    numero: r.numero ?? "anonimo",
    started_at: new Date(r.iniciadaEm).toISOString(),
    answered_at: r.atendidaEm ? new Date(r.atendidaEm).toISOString() : null,
    ended_at: new Date(r.encerradaEm).toISOString(),
    end_reason: r.motivo,
    via,
  };
}

async function lerModo(): Promise<ModoDoUsuario> {
  try {
    return (await apiClient.get<{ data: ModoDoUsuario }>("/api/v1/webphone/modo")).data;
  } catch {
    // Papel sem acesso (viewer), org suspensa ou rede: sem telefone, sem alarde.
    return { modo: null, ramal: null, painel_url: null };
  }
}

async function lerCredenciais(): Promise<CredenciaisDoWebphone | null> {
  try {
    return (await apiClient.get<{ data: CredenciaisDoWebphone | null }>("/api/v1/webphone/credenciais")).data;
  } catch {
    return null;
  }
}

export function WebphoneProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [elementoDeAudio, setElementoDeAudio] = useState<HTMLAudioElement | null>(null);
  const [armazem] = useState(() => new ArmazemDoTelefone());
  const telefone = useSyncExternalStore(armazem.subscribe, armazem.pegar, () => null);

  const { data: modo } = useQuery({
    queryKey: ["webphone", "modo"],
    queryFn: lerModo,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { data: credenciais } = useQuery({
    queryKey: ["webphone", "credenciais"],
    queryFn: lerCredenciais,
    enabled: modo?.modo === "navegador",
    // A senha viaja uma vez por sessão de aba: reler a cada foco seria expô-la à toa.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  useEffect(() => {
    const historico = () => void queryClient.invalidateQueries({ queryKey: ["webphone", "chamadas"] });
    const marcar = async (id: string, resultado: ResultadoDaLigacao) => {
      await apiClient.patch(`/api/v1/webphone/chamadas/${id}`, { resultado });
      historico();
    };

    let novo: Telefone | null = null;
    if (modo?.modo === "navegador" && credenciais && elementoDeAudio) {
      novo = new Webphone(credenciais, elementoDeAudio, {
        // O histórico é conveniência: a ligação já aconteceu, e falha de rede ao
        // registrá-la não pode virar erro na cara de quem acabou de desligar.
        aoEncerrar: async (registro) => {
          await apiClient.post("/api/v1/webphone/chamadas", corpoDoRegistro(registro, "navegador"));
          historico();
        },
        aoEscolherResultado: marcar,
      });
    } else if (modo?.modo === "central") {
      novo = new ClickToCall({
        ligar: async (crmId, numero) => {
          await apiClient.post("/api/v1/webphone/central/ligar", { crm_id: crmId, telefone: numero });
        },
        consultar: async (crmId) =>
          (await apiClient.get<{ data: SituacaoDaLigacao }>(`/api/v1/webphone/central/status?crm_id=${crmId}`)).data,
        desligar: async (crmId) => {
          await apiClient.post("/api/v1/webphone/central/encerrar", { crm_id: crmId });
        },
        aoEncerrar: async (registro) => {
          await apiClient.post("/api/v1/webphone/chamadas", corpoDoRegistro(registro, "central"));
          historico();
        },
        aoEscolherResultado: marcar,
      });
    }
    if (!novo) return;

    const ativo = novo;
    armazem.publicar(ativo);
    void ativo.iniciar();
    return () => {
      ativo.parar();
      armazem.publicar(null);
    };
  }, [armazem, modo?.modo, credenciais, elementoDeAudio, queryClient]);

  const instantaneo = useSyncExternalStore(
    telefone ? telefone.subscribe : semOuvir,
    telefone ? telefone.instantaneo : instantaneoVazio,
    instantaneoVazio,
  );

  const painelUrl = modo?.painel_url ?? null;

  const valor = useMemo<ContextoDoWebphone>(
    () =>
      telefone
        ? {
            ...instantaneo,
            disponivel: true,
            capacidades: telefone.capacidades,
            painelUrl,
            abrirJanela: () => {
              if (painelUrl) window.open(painelUrl, NOME_DA_JANELA, MEDIDAS_DA_JANELA);
            },
            discar: (n) => telefone.discar(n),
            atender: () => telefone.atender(),
            encerrar: () => telefone.encerrar(),
            alternarMudo: () => telefone.alternarMudo(),
            alternarEspera: () => telefone.alternarEspera(),
            enviarTom: (t) => telefone.enviarTom(t),
            ativarSom: () => telefone.ativarSom(),
            escolherResultado: (r) => telefone.escolherResultado(r),
            fecharFechamento: () => telefone.fecharFechamento(),
          }
        : SEM_WEBPHONE,
    [telefone, instantaneo, painelUrl],
  );

  return (
    <CtxDoWebphone.Provider value={valor}>
      {children}
      <audio ref={setElementoDeAudio} autoPlay />
      {valor.disponivel ? <WebphoneDock /> : null}
    </CtxDoWebphone.Provider>
  );
}
