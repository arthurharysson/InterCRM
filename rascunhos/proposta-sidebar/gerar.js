const fs = require("fs");
const path = require("path");
const origem = "C:/Users/Arthur/AppData/Local/Temp/code (5).html";
const saida = __dirname;
const base = fs.readFileSync(origem, "utf8");

const SOMBRA = "shadow-[0_4px_20px_-2px_rgba(15,23,42,0.05),0_2px_6px_-1px_rgba(15,23,42,0.03)]";
const ic = (n, c = "") => `<span class="material-symbols-outlined ${c}">${n}</span>`;

const GRUPOS = [
  { t: "Atendimento", aberto: true, itens: [["all_inbox", "Inbox", "14"], ["radar", "Radar"], ["calendar_today", "Agenda", null, true], ["quickreply", "Respostas rápidas"]] },
  { t: "CRM", aberto: true, itens: [["view_kanban", "Funis"], ["group", "Contatos"], ["domain", "Empresas"], ["check_circle", "Tarefas", "3"], ["call", "Chamadas"], ["description", "Propostas"], ["campaign", "Campanhas"], ["travel_explore", "Prospecção"]] },
  { t: "Inteligência artificial", aberto: false, itens: [] },
  { t: "Análise", aberto: false, itens: [] },
];

function itemA([icone, nome, cont, ativo]) {
  const cls = "relative flex items-center gap-3 h-9 px-3 rounded-xl text-[14px] transition-colors";
  if (ativo)
    return `<a href="#" class="${cls} bg-primary/10 text-primary font-medium before:content-[''] before:absolute before:-left-3 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-primary">${ic(icone, "!text-[20px]")}<span class="flex-1">${nome}</span></a>`;
  const pill = cont
    ? `<span class="text-[11px] font-semibold px-1.5 min-w-[20px] text-center rounded-full ${nome === "Inbox" ? "bg-primary text-on-primary" : "bg-slate-100 text-slate-500"}">${cont}</span>`
    : "";
  return `<a href="#" class="${cls} text-[#475467] hover:bg-slate-50 hover:text-[#0F1729]">${ic(icone, "!text-[20px] text-[#98A2B3]")}<span class="flex-1">${nome}</span>${pill}</a>`;
}
function grupoA(g) {
  const cab = `<button type="button" class="w-full flex items-center justify-between px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-[0.06em] uppercase text-[#98A2B3] hover:text-[#667085]"><span>${g.t}</span>${ic(g.aberto ? "expand_more" : "chevron_right", "!text-[16px]")}</button>`;
  return `<div>${cab}${g.aberto ? `<div class="flex flex-col gap-0.5">${g.itens.map(itemA).join("")}</div>` : ""}</div>`;
}

const asideA = `<aside class="fixed top-4 bottom-4 left-4 w-[256px] bg-white rounded-[20px] border border-[#E6E9F0] ${SOMBRA} z-50 flex flex-col">
  <div class="flex items-center gap-3 px-4 pt-4 pb-3">
    <div class="w-10 h-10 rounded-xl bg-primary-container text-on-primary flex items-center justify-center font-headline-sm text-[17px]">S</div>
    <div class="leading-tight min-w-0 flex-1"><div class="font-headline-sm text-[15px] text-[#0F1729] truncate">Sua Marca</div><div class="text-[12px] text-[#667085] truncate">Matriz São Paulo</div></div>
    <button type="button" title="Trocar de organização" class="w-8 h-8 rounded-lg text-[#98A2B3] hover:bg-slate-50 flex items-center justify-center">${ic("unfold_more", "!text-[18px]")}</button>
  </div>
  <div class="mx-4 h-px bg-[#F1F3F7]"></div>
  <nav class="flex-1 overflow-y-auto px-3 pb-2" aria-label="Navegação principal">${GRUPOS.map(grupoA).join("")}</nav>
  <div class="px-3 pb-3 pt-2 border-t border-[#F1F3F7] flex flex-col gap-0.5">
    <a href="#" class="flex items-center gap-3 h-9 px-3 rounded-xl text-[14px] text-[#475467] hover:bg-slate-50">${ic("cable", "!text-[20px] text-[#98A2B3]")}<span class="flex-1">Conexões</span><span class="flex items-center gap-1.5 text-[11px] text-[#667085]"><span class="w-2 h-2 rounded-full bg-emerald-500"></span>WhatsApp</span></a>
    <a href="#" class="flex items-center gap-3 h-9 px-3 rounded-xl text-[14px] text-[#475467] hover:bg-slate-50">${ic("settings", "!text-[20px] text-[#98A2B3]")}<span class="flex-1">Configurações</span></a>
    <button type="button" class="mt-2 flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 text-left">
      <span class="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[13px] font-semibold">RS</span>
      <span class="leading-tight min-w-0 flex-1"><span class="block text-[13px] font-medium text-[#0F1729] truncate">Rodrigo Silveira</span><span class="block text-[11px] text-[#667085] truncate">Head de Operações</span></span>
      ${ic("more_horiz", "!text-[18px] text-[#98A2B3]")}
    </button>
  </div>
</aside>`;

function iconeB([icone, nome, cont, ativo, dica]) {
  const caixa = ativo
    ? "bg-primary-container text-on-primary shadow-[0_6px_14px_-4px_rgba(59,91,255,0.55)]"
    : "text-[#667085] hover:bg-slate-50 hover:text-[#0F1729]";
  const bolinha = cont ? `<span class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-container text-on-primary text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">${cont}</span>` : "";
  const tip = dica ? `<span class="absolute left-[56px] top-1/2 -translate-y-1/2 whitespace-nowrap px-2.5 py-1.5 rounded-lg bg-[#0F1729] text-white text-[12px] font-medium shadow-lg">${nome}<span class="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-[#0F1729]"></span></span>` : "";
  return `<a href="#" aria-label="${nome}" class="relative w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${caixa}">${ic(icone, "!text-[22px]")}${bolinha}${tip}</a>`;
}
const SEP = `<div class="w-6 h-px bg-[#E6E9F0] my-1.5"></div>`;
const grupoB = (lista) => `<div class="flex flex-col items-center gap-1">${lista.map(iconeB).join("")}</div>`;
const asideB = `<aside class="fixed top-4 bottom-4 left-4 w-[72px] bg-white rounded-[24px] border border-[#E6E9F0] ${SOMBRA} z-50 flex flex-col items-center py-4 gap-1">
  <div class="w-11 h-11 rounded-2xl bg-primary-container text-on-primary flex items-center justify-center font-headline-sm text-[18px]">S</div>
  <button type="button" aria-label="Expandir menu" class="w-7 h-7 rounded-full text-[#98A2B3] hover:bg-slate-50 flex items-center justify-center mt-0.5">${ic("keyboard_double_arrow_right", "!text-[16px]")}</button>
  ${SEP}
  <div class="flex-1 w-full flex flex-col items-center gap-0.5 py-1">
    ${grupoB([["all_inbox", "Inbox", "14"], ["radar", "Radar"], ["calendar_today", "Agenda", null, true, true], ["quickreply", "Respostas rápidas"]])}
    ${SEP}
    ${grupoB([["view_kanban", "Funis"], ["group", "Contatos"], ["domain", "Empresas"], ["check_circle", "Tarefas", "3"], ["call", "Chamadas"], ["description", "Propostas"], ["campaign", "Campanhas"]])}
    ${SEP}
    ${grupoB([["smart_toy", "Agentes"], ["autorenew", "Follow-ups"], ["menu_book", "Conhecimento"]])}
    ${SEP}
    ${grupoB([["query_stats", "Desempenho"], ["payments", "Faturamento"]])}
  </div>
  ${SEP}
  <a href="#" aria-label="Conexões" class="relative w-11 h-11 rounded-2xl flex items-center justify-center text-[#667085] hover:bg-slate-50">${ic("cable", "!text-[22px]")}<span class="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white"></span></a>
  <a href="#" aria-label="Configurações" class="w-11 h-11 rounded-2xl flex items-center justify-center text-[#667085] hover:bg-slate-50">${ic("settings", "!text-[22px]")}</a>
  <span class="mt-1 w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[13px] font-semibold">RS</span>
</aside>`;

const ROSA = [
  ['"primary":"#143de7"', '"primary":"#be185d"'],
  ['"primary-container":"#3b5bff"', '"primary-container":"#ec4899"'],
  ['"primary-fixed":"#dee0ff"', '"primary-fixed":"#fce7f3"'],
  ['"primary-fixed-dim":"#bac3ff"', '"primary-fixed-dim":"#f9a8d4"'],
  ['"on-primary-fixed":"#00105b"', '"on-primary-fixed":"#500724"'],
  ['"on-primary-fixed-variant":"#002eca"', '"on-primary-fixed-variant":"#9d174d"'],
  ['"surface-tint":"#2448ef"', '"surface-tint":"#be185d"'],
  ['"inverse-primary":"#bac3ff"', '"inverse-primary":"#f9a8d4"'],
  ['"surface-container-low":"#f2f3ff"', '"surface-container-low":"#fdf4f8"'],
  ['"surface-container":"#e9edff"', '"surface-container":"#fbe9f1"'],
  ['"surface-container-high":"#e1e8ff"', '"surface-container-high":"#f7dce8"'],
  ['"surface-container-highest":"#dbe2fb"', '"surface-container-highest":"#f1d0df"'],
  ["rgba(59,91,255", "rgba(236,72,153"],
];

function montar(aside, largura, rosa, nome) {
  let h = base.replace(/<aside[\s\S]*?<\/aside>/, () => aside);
  h = h.replace("left-[296px]", `left-[${largura + 32}px]`).replace("pl-[296px]", `pl-[${largura + 32}px]`);
  if (rosa) for (const [a, b] of ROSA) h = h.split(a).join(b);
  fs.writeFileSync(path.join(saida, nome), h, "utf8");
  console.log("ok", nome, h.length, "asides:", (h.match(/<aside/g) || []).length);
}
montar(asideA, 256, false, "sidebar-A-limpa-azul.html");
montar(asideA, 256, true, "sidebar-A-limpa-rosa.html");
montar(asideB, 72, false, "sidebar-B-trilho-azul.html");
montar(asideB, 72, true, "sidebar-B-trilho-rosa.html");
