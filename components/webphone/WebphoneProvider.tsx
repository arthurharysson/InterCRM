"use client";
/**
 * O WEBPHONE GLOBAL — monta UMA vez no shell autenticado (`app/app/layout.tsx`).
 *
 * Uma ligação sobrevive à navegação entre telas do CRM, e isso só funciona se o
 * motor SIP não remontar a cada rota. Este provider é o dono dele: pede ao
 * servidor as credenciais do ramal DE QUEM ESTÁ LOGADO, sobe o motor quando
 * elas existem e o derruba quando a pessoa sai ou perde o ramal.
 *
 * Quem não tem ramal (a organização não ligou o webphone, ou a pessoa ainda não
 * recebeu um) não paga nada: `/credenciais` devolve `null`, o motor nunca nasce
 * e nenhuma peça é desenhada.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { CtxDoWebphone, SEM_MOTOR, SEM_WEBPHONE, type ContextoDoWebphone } from "@/components/webphone/contexto";
import { WebphoneDock } from "@/components/webphone/WebphoneDock";
import { apiClient } from "@/lib/api/client";
import type { CredenciaisDoWebphone } from "@/lib/webphone/config";
import { Webphone } from "@/lib/webphone/motor";

const semOuvir = () => () => undefined;
const instantaneoVazio = () => SEM_MOTOR;

/**
 * Onde o motor vigente mora. Um armazém externo, e não `useState`, porque o
 * motor nasce e morre dentro de um efeito (ele abre socket e pede o microfone),
 * e gravar estado do React de dentro de um efeito acorda a árvore inteira uma
 * segunda vez a cada troca. Aqui o efeito só publica; quem lê assina.
 */
class ArmazemDoMotor {
  private atual: Webphone | null = null;
  private ouvintes = new Set<() => void>();

  subscribe = (ouvinte: () => void): (() => void) => {
    this.ouvintes.add(ouvinte);
    return () => {
      this.ouvintes.delete(ouvinte);
    };
  };

  pegar = (): Webphone | null => this.atual;

  publicar(motor: Webphone | null): void {
    this.atual = motor;
    for (const ouvinte of this.ouvintes) ouvinte();
  }
}

async function lerCredenciais(): Promise<CredenciaisDoWebphone | null> {
  try {
    const res = await apiClient.get<{ data: CredenciaisDoWebphone | null }>("/api/v1/webphone/credenciais");
    return res.data;
  } catch {
    // Papel sem acesso (viewer), org suspensa ou rede: sem webphone, sem alarde.
    return null;
  }
}

export function WebphoneProvider({ children }: { children: ReactNode }) {
  const [elementoDeAudio, setElementoDeAudio] = useState<HTMLAudioElement | null>(null);
  const [armazem] = useState(() => new ArmazemDoMotor());
  const motor = useSyncExternalStore(armazem.subscribe, armazem.pegar, () => null);

  const { data: credenciais } = useQuery({
    queryKey: ["webphone", "credenciais"],
    queryFn: lerCredenciais,
    // A senha viaja uma vez por sessão de aba: reler a cada foco seria expô-la à toa.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  useEffect(() => {
    if (!credenciais || !elementoDeAudio) return;
    const novo = new Webphone(credenciais, elementoDeAudio);
    armazem.publicar(novo);
    void novo.iniciar();
    return () => {
      novo.parar();
      armazem.publicar(null);
    };
  }, [armazem, credenciais, elementoDeAudio]);

  const instantaneo = useSyncExternalStore(
    motor ? motor.subscribe : semOuvir,
    motor ? motor.instantaneo : instantaneoVazio,
    instantaneoVazio,
  );

  const valor = useMemo<ContextoDoWebphone>(
    () =>
      motor
        ? {
            ...instantaneo,
            disponivel: true,
            discar: (n) => motor.discar(n),
            atender: () => motor.atender(),
            encerrar: () => motor.encerrar(),
            alternarMudo: () => motor.alternarMudo(),
            alternarEspera: () => motor.alternarEspera(),
            enviarTom: (t) => motor.enviarTom(t),
          }
        : SEM_WEBPHONE,
    [motor, instantaneo],
  );

  return (
    <CtxDoWebphone.Provider value={valor}>
      {children}
      <audio ref={setElementoDeAudio} autoPlay />
      {valor.disponivel ? <WebphoneDock /> : null}
    </CtxDoWebphone.Provider>
  );
}
