"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

export interface ConfiguracaoSalva {
  organization_id: string;
  wss_url: string | null;
  sip_domain: string | null;
  painel_url: string | null;
  dial_prefix: string;
  is_active: boolean;
  updated_at: string;
}

interface RamalSalvo {
  user_id: string;
  ramal: string;
  secret_last4: string | null;
  sip_user: string | null;
  is_active: boolean;
}

interface RamalDaCentral {
  id: number | string;
  extension: string;
  login: string | null;
  callerid: string | null;
}

interface Membro {
  user_id: string;
  role: string;
  email: string | null;
  full_name: string | null;
  revoked_at: string | null;
}

const chaveDaConfiguracao = ["webphone", "settings"] as const;
const chaveDosRamais = ["webphone", "ramais"] as const;
const chaveDaEquipe = ["webphone", "equipe"] as const;
const chaveDosRamaisDaCentral = ["webphone", "central", "ramais"] as const;

function ServidorDoTelefone({ inicial }: { inicial: ConfiguracaoSalva | null }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: salva } = useQuery({
    queryKey: chaveDaConfiguracao,
    queryFn: async () => (await apiClient.get<{ data: ConfiguracaoSalva | null }>("/api/v1/webphone/settings")).data,
    initialData: inicial,
  });

  const [wss, setWss] = useState(salva?.wss_url ?? "");
  const [dominio, setDominio] = useState(salva?.sip_domain ?? "");
  const [painel, setPainel] = useState(salva?.painel_url ?? "");
  const [prefixo, setPrefixo] = useState(salva?.dial_prefix ?? "");
  const [ativo, setAtivo] = useState(salva?.is_active ?? true);

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await apiClient.put<{ data: ConfiguracaoSalva }>("/api/v1/webphone/settings", {
          wss_url: wss,
          sip_domain: dominio,
          painel_url: painel,
          dial_prefix: prefixo,
          is_active: ativo,
        })
      ).data,
    onSuccess: (linha) => {
      queryClient.setQueryData(chaveDaConfiguracao, linha);
      // Quem já está com o telefone aberto pega o endereço novo na próxima vez que entrar.
      void queryClient.invalidateQueries({ queryKey: ["webphone", "credenciais"] });
    },
    onError: (err) => showApiError(err),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Servidor do telefone")}</CardTitle>
      </CardHeader>
      <CardContent className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wss_url">{t("Endereço WebSocket seguro (telefone dentro do CRM)")}</Label>
          <Input
            id="wss_url"
            placeholder={t("wss://central.example.com:8089/ws")}
            value={wss}
            onChange={(e) => setWss(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("Começa com wss://. Peça à empresa que fornece a central telefônica.")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sip_domain">{t("Domínio da central")}</Label>
          <Input
            id="sip_domain"
            placeholder="central.example.com"
            value={dominio}
            onChange={(e) => setDominio(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("Só o nome, sem https:// e sem porta. Costuma ser o mesmo endereço do painel da central.")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="painel_url">{t("Janela da central (opcional)")}</Label>
          <Input
            id="painel_url"
            placeholder={t("https://central.example.com/omnichannel")}
            value={painel}
            onChange={(e) => setPainel(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("Endereço da tela da central onde o atendente atende. O botão Abrir a janela da central usa este endereço.")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dial_prefix">{t("Prefixo de discagem (opcional)")}</Label>
          <Input
            id="dial_prefix"
            className="max-w-40"
            inputMode="numeric"
            placeholder="0"
            value={prefixo}
            onChange={(e) => setPrefixo(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("Dígito que a central exige antes do número, quando exigir. Deixe em branco se não souber.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="webphone_ativo" checked={ativo} onCheckedChange={setAtivo} />
          <Label htmlFor="webphone_ativo">{t("Telefone ligado para esta empresa")}</Label>
        </div>
        <div>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || !((wss && dominio) || painel)}>
            {salvar.isPending ? t("Salvando…") : t("Salvar servidor")}
          </Button>
          {salvar.isSuccess ? (
            <span className="ml-3 text-sm text-muted-foreground" role="status">
              {t("Salvo.")}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function LinhaDoRamal({
  membro,
  salvo,
  ramaisDaCentral,
}: {
  membro: Membro;
  salvo: RamalSalvo | undefined;
  /** Os ramais que a central tem; `null` quando o servidor não tem acesso a ela. */
  ramaisDaCentral: RamalDaCentral[] | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [ramal, setRamal] = useState(salvo?.ramal ?? "");
  // O nome com que o ramal se autentica na central. Ao escolher na lista da
  // central ele vem do `login` dela (ex.: 1000_1201); no campo livre a pessoa informa.
  const [usuarioSip, setUsuarioSip] = useState(salvo?.sip_user ?? "");
  const [senha, setSenha] = useState("");
  const [ativo, setAtivo] = useState(salvo?.is_active ?? true);

  const atualizarListas = () => queryClient.invalidateQueries({ queryKey: chaveDosRamais });

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo: Record<string, unknown> = { ramal, sip_user: usuarioSip, is_active: ativo };
      if (senha) corpo.password = senha;
      await apiClient.put(`/api/v1/webphone/ramais/${membro.user_id}`, corpo);
    },
    onSuccess: async () => {
      setSenha("");
      await atualizarListas();
    },
    onError: (err) => showApiError(err),
  });

  const remover = useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/api/v1/webphone/ramais/${membro.user_id}`);
    },
    onSuccess: async () => {
      setRamal("");
      setSenha("");
      await atualizarListas();
    },
    onError: (err) => showApiError(err),
  });

  const nome = membro.full_name?.trim() || membro.email || membro.user_id;
  const modo = !salvo ? null : salvo.secret_last4 ? "navegador" : "central";

  return (
    <li className="grid gap-3 border-b py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_9rem_14rem_auto] md:items-end">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{nome}</p>
        {membro.full_name && membro.email ? (
          <p className="truncate text-xs text-muted-foreground">{membro.email}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`ramal-${membro.user_id}`} className="text-xs">
          {t("Ramal")}
        </Label>
        {ramaisDaCentral && ramaisDaCentral.length > 0 ? (
          <select
            id={`ramal-${membro.user_id}`}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={ramal}
            onChange={(e) => {
              const escolhido = ramaisDaCentral.find((r) => r.extension === e.target.value);
              setRamal(e.target.value);
              // O `login` só vale quando difere do número; igual ao número, não há o que guardar.
              setUsuarioSip(escolhido?.login && escolhido.login !== escolhido.extension ? escolhido.login : "");
            }}
          >
            <option value="">{t("Escolha o ramal")}</option>
            {ramal && !ramaisDaCentral.some((r) => r.extension === ramal) ? <option value={ramal}>{ramal}</option> : null}
            {ramaisDaCentral.map((r) => (
              <option key={String(r.id)} value={r.extension}>
                {r.callerid && r.callerid !== r.extension ? `${r.extension} · ${r.callerid}` : r.extension}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id={`ramal-${membro.user_id}`}
            value={ramal}
            placeholder="0359"
            onChange={(e) => setRamal(e.target.value)}
          />
        )}
        {usuarioSip || !ramaisDaCentral || ramaisDaCentral.length === 0 ? (
          <div className="mt-1 flex flex-col gap-1">
            <Label htmlFor={`sipuser-${membro.user_id}`} className="text-xs text-muted-foreground">
              {t("Usuário SIP (se for diferente do ramal)")}
            </Label>
            <Input
              id={`sipuser-${membro.user_id}`}
              value={usuarioSip}
              placeholder="1000_1201"
              onChange={(e) => setUsuarioSip(e.target.value)}
            />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`senha-${membro.user_id}`} className="text-xs">
          {t("Senha SIP (opcional)")}{" "}
          {salvo?.secret_last4 ? (
            <span className="text-muted-foreground">
              ({t("termina em")} {salvo.secret_last4})
            </span>
          ) : null}
        </Label>
        <Input
          id={`senha-${membro.user_id}`}
          type="password"
          autoComplete="new-password"
          value={senha}
          placeholder={salvo ? t("Em branco mantém a atual") : ""}
          onChange={(e) => setSenha(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          aria-label={t("Ramal ativo")}
          checked={ativo}
          onCheckedChange={setAtivo}
        />
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || !ramal}>
          {t("Salvar")}
        </Button>
        {modo ? (
          <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
            {modo === "navegador" ? t("Telefone no navegador") : t("Liga pela central")}
          </span>
        ) : null}
        {salvo ? (
          <Button size="sm" variant="outline" onClick={() => remover.mutate()} disabled={remover.isPending}>
            {t("Remover")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function RamaisDosAtendentes() {
  const t = useT();
  const equipe = useQuery({
    queryKey: chaveDaEquipe,
    queryFn: async () => (await apiClient.get<{ data: Membro[] }>("/api/v1/team")).data,
  });
  const ramais = useQuery({
    queryKey: chaveDosRamais,
    queryFn: async () => (await apiClient.get<{ data: RamalSalvo[] }>("/api/v1/webphone/ramais")).data,
  });

  const central = useQuery({
    queryKey: chaveDosRamaisDaCentral,
    queryFn: async () =>
      (await apiClient.get<{ data: { configurada: boolean; ramais: RamalDaCentral[] } }>("/api/v1/webphone/central/ramais")).data,
    retry: false,
    staleTime: 60_000,
  });
  const ramaisDaCentral = central.data?.configurada ? central.data.ramais : null;

  const membros = (equipe.data ?? []).filter((m) => !m.revoked_at && m.role !== "viewer");
  const porUsuario = new Map((ramais.data ?? []).map((r) => [r.user_id, r]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Ramal de cada atendente")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(
            "Cada pessoa usa o próprio ramal. Só com o número, o CRM liga pela central e o áudio fica na janela dela. Com a senha SIP de um ramal de navegador (WebRTC), o telefone passa a ser o do CRM. A senha fica cifrada e só chega ao navegador do dono do ramal.",
          )}
        </p>
        {equipe.isLoading || ramais.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("Carregando…")}</p>
        ) : membros.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhum atendente encontrado.")}</p>
        ) : (
          <ul>
            {membros.map((m) => (
              // A chave inclui o ramal salvo: depois de salvar, a linha remonta
              // com os valores que o servidor confirmou.
              <LinhaDoRamal
                key={`${m.user_id}:${porUsuario.get(m.user_id)?.ramal ?? ""}:${ramaisDaCentral ? "lista" : "livre"}`}
                membro={m}
                salvo={porUsuario.get(m.user_id)}
                ramaisDaCentral={ramaisDaCentral}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function WebphoneSettingsClient({ initialData }: { initialData: ConfiguracaoSalva | null }) {
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <ServidorDoTelefone inicial={initialData} />
      <RamaisDosAtendentes />
    </div>
  );
}
