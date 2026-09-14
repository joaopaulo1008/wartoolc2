// paleta-tela.js — a fileira de presets DENTRO do formulário de marcação.
//
// A regra pura mora em paleta.js, o acesso ao banco em icones-rapidos.js, e a
// gravação continua sendo a de marcacoes.js. Este arquivo só carrega a paleta
// da turma (com Realtime) e desenha os botões dentro do contêiner que quem
// chama entrega.
//
// ── Por que a paleta mora no formulário, e não num cartão do painel ────────
//
// A primeira versão (2026-09-14) era um cartão "Marcação rápida" no painel
// lateral: o aluno tocava no botão, o preset ficava ARMADO, e o toque seguinte
// no mapa gravava. Foi corrigido no mesmo dia, a pedido de quem usa: *"o banco
// de presets deve estar no menu do clique na tela"*. E está certo, por três
// motivos que só ficam óbvios com o app na mão:
//
//   1. **O toque no mapa já disse ONDE.** O que falta é o QUÊ — e ele tem que
//      estar onde a pessoa já está olhando, não do outro lado da tela.
//   2. **Sumiu o estado "armado".** Aquilo era a parte mais frágil da versão
//      anterior: um modo invisível que mudava o significado do próximo toque
//      no mapa, com botão para cancelar, linha de status para explicar, e uma
//      forma a mais de gravar sem querer. Nada disso existe agora — o ponto já
//      é conhecido quando os botões aparecem.
//   3. **Não depende do painel lateral estar aberto** (ele nasce fechado no
//      celular desde a 7.1) nem de rolar até o fim dele.
//
// De quebra, a permissão deixou de precisar de tratamento próprio aqui: o
// formulário só abre quando `criar_marcacao_inimiga` permite (marcacoes.js já
// checa no clique), então a fileira herda a mesma porta, sem um segundo
// observador que pudesse discordar dela.
import { svgDoSimbolo } from './icones.js';
// O partido de QUEM OLHA é metade do par que decide a cor de cada símbolo —
// mesma regra de colegas.js/marcacoes.js desde a Etapa 4.5. Sem ele, o botão
// "CC" (gravado como Vermelho) sairia no amarelo de "desconhecido" no botão e
// vermelho no mapa: foi o bug relatado no primeiro uso.
import { buscarPartidosDaTurma } from './auth.js';
import { buscarPaletaDaTurma, assinarPaleta, desassinarPaleta } from './icones-rapidos.js';
import { ordenarPaleta, modoDoPreset } from './paleta.js';

const TAMANHO_SIMBOLO = 30;

// Toque longo: preenche o formulário com o preset em vez de gravar. 500ms é o
// intervalo que o próprio navegador usa para o menu de contexto em toque —
// usar o mesmo número faz o gesto parecer nativo em vez de inventado. Agora
// ele é muito mais legível que na versão anterior: o resultado aparece na
// hora, nos campos logo abaixo, em vez de armar um modo invisível.
const TOQUE_LONGO_MS = 500;

let presets = [];
let partidosDaTurma = [];
let meuPartido = null;
let canal = null;
// Contêineres desenhados agora (normalmente um: o formulário aberto).
// Guardados para o Realtime poder redesenhar a fileira se o instrutor mexer na
// paleta com o formulário aberto na mão do aluno.
const montagens = new Set();

// ── Estilos ──────────────────────────────────────────────────────────────
let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados || typeof document === 'undefined') return;
  estilosInjetados = true;
  const s = document.createElement('style');
  s.textContent = `
    .pal-fileira { margin: 2px 0 12px; }
    .pal-titulo { font-size: 11px; color: #7a9ab8; margin: 0 0 6px; line-height: 1.35; }
    .pal-grade { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    /* Alto o bastante para um dedo com luva (44px é o mínimo recomendado para
       alvo de toque; aqui passa disso por causa do símbolo). */
    .pal-btn {
      display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
      gap: 2px; min-height: 62px; padding: 4px 2px;
      background: #16263a; border: 1px solid #2a4a6b; border-radius: 5px;
      color: #e8eaf0; font-size: 10px; line-height: 1.15; cursor: pointer;
      text-align: center; word-break: break-word; -webkit-tap-highlight-color: transparent;
    }
    .pal-btn:active { border-color: #f5c842; background: #22354d; }
    .pal-btn svg { display: block; max-width: 100%; height: auto; }
    .pal-btn:disabled { opacity: .5; cursor: default; }
    .pal-separador { border: 0; border-top: 1px solid #23405e; margin: 14px 0 0; }
    .pal-separador-txt {
      display: block; width: fit-content; margin: -8px auto 10px; padding: 0 8px;
      background: #0d1b2a; font-size: 11px; color: #5f7f9f;
    }
  `;
  document.head.appendChild(s);
}

// ── Carga dos dados ──────────────────────────────────────────────────────
// Chamado uma vez por tela (app do aluno, aba do instrutor). NÃO desenha nada:
// só deixa a paleta pronta para quando um formulário abrir.
export async function iniciarPaleta({ turmaId, perfil } = {}) {
  if (!turmaId) return;
  injetarEstilos();
  meuPartido = perfil?.partido || null;
  partidosDaTurma = await buscarPartidosDaTurma(turmaId);

  // Select inicial PRIMEIRO, assinatura depois — o Realtime não faz backfill
  // (armadilha registrada desde a Etapa 4). Invertido, a paleta só teria
  // botões se o instrutor mexesse nela durante a sessão.
  const r = await buscarPaletaDaTurma(turmaId);
  presets = r.presets;

  canal = assinarPaleta(turmaId, {
    aoMudar: (linha) => {
      const i = presets.findIndex((p) => p.id === linha.id);
      if (i >= 0) presets[i] = linha; else presets.push(linha);
      presets = ordenarPaleta(presets);
      redesenharMontagens();
    },
    aoSair: (id) => {
      presets = presets.filter((p) => p.id !== id);
      redesenharMontagens();
    },
  });

  window.addEventListener('beforeunload', () => desassinarPaleta(canal));
}

// Teardown, no molde de pararMarcacoes() (Etapa 6c). O app do aluno nunca
// chama (inicia uma vez por carga de página; trocar de turma lá recarrega a
// página inteira, decisão da Etapa 6a) — quem precisa é a aba do instrutor,
// que troca de turma sem recarregar.
export function pararPaleta() {
  desassinarPaleta(canal);
  canal = null;
  presets = [];
  partidosDaTurma = [];
  montagens.clear();
}

// ── Desenho ──────────────────────────────────────────────────────────────
// Monta a fileira dentro de `container` (um nó já no DOM, entregue pelo
// formulário de marcacoes.js). `aoEscolher(preset, { completo })` é chamado no
// toque; `completo` vem `true` no toque longo.
//
// Devolve `false` quando não há preset nenhum — assim quem chama decide o que
// fazer com o espaço (hoje: o formulário fica exatamente como era antes desta
// funcionalidade existir, sem separador nem espaço morto).
export function montarPaleta(container, { aoEscolher } = {}) {
  if (!container) return false;
  injetarEstilos();
  container.__aoEscolher = aoEscolher; // guardado para o redesenho do Realtime
  montagens.add(container);
  return desenhar(container);
}

export function desmontarPaleta(container) {
  montagens.delete(container);
}

function redesenharMontagens() {
  for (const c of [...montagens]) {
    if (!c.isConnected) { montagens.delete(c); continue; }
    desenhar(c);
  }
}

function desenhar(container) {
  container.textContent = '';
  if (presets.length === 0) return false;

  const titulo = document.createElement('p');
  titulo.className = 'pal-titulo';
  titulo.textContent = 'Toque para gravar aqui. Toque longo preenche o formulário sem gravar.';
  container.appendChild(titulo);

  const grade = document.createElement('div');
  grade.className = 'pal-grade';

  for (const preset of presets) {
    const partidoDoPreset = partidosDaTurma.find((x) => x.id === preset.partido_padrao_id) || null;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pal-btn';

    // O símbolo sai do MESMO renderizador do mapa, com a hostilidade derivada
    // pelo MESMO caminho (sidcParaObservador, dentro de svgDoSimbolo) — é o
    // que garante que o botão mostre a cor que a marcação vai ter. Desenhar o
    // SIDC cru aqui foi o bug do primeiro uso: tudo saía amarelo.
    const svg = svgDoSimbolo(preset.sidc, {
      tamanho: TAMANHO_SIMBOLO,
      partidoObservador: meuPartido,
      partidoElemento: partidoDoPreset,
    });
    const caixa = document.createElement('span');
    if (svg) caixa.innerHTML = svg;
    else caixa.textContent = '—'; // SIDC que a milsymbol recusou: o rótulo ainda identifica o botão
    btn.appendChild(caixa);

    const rot = document.createElement('span');
    rot.textContent = preset.rotulo;
    btn.appendChild(rot);

    btn.title = modoDoPreset(preset) === 'gravar'
      ? `${preset.rotulo} — grava aqui, na hora.`
      : `${preset.rotulo} — preenche o formulário e pede a força.`;

    ligarGestos(btn, preset, container);
    grade.appendChild(btn);
  }

  container.appendChild(grade);

  // Separador dizendo o que vem abaixo. Sem ele, a fileira e os <select>
  // parecem a mesma coisa, e não são: acima é atalho, abaixo é o catálogo
  // inteiro.
  const hr = document.createElement('hr');
  hr.className = 'pal-separador';
  container.appendChild(hr);
  const txt = document.createElement('span');
  txt.className = 'pal-separador-txt';
  txt.textContent = 'ou descreva em detalhe';
  container.appendChild(txt);

  return true;
}

// Clique curto escolhe; toque longo escolhe em modo "completo". Implementado à
// mão com pointer events, sem plugin nem biblioteca de gestos — mesmo espírito
// de marcacoes.js resolver "tocar no mapa" e de offline-tela.js desenhar um
// retângulo sem leaflet-draw.
function ligarGestos(btn, preset, container) {
  let timer = null;
  let longo = false;
  const escolher = (completo) => {
    const cb = container.__aoEscolher;
    if (cb) cb(preset, { completo });
  };

  const comecar = () => {
    longo = false;
    timer = setTimeout(() => { longo = true; escolher(true); }, TOQUE_LONGO_MS);
  };
  const soltar = () => { if (timer) { clearTimeout(timer); timer = null; } };

  btn.addEventListener('pointerdown', comecar);
  btn.addEventListener('pointerup', soltar);
  btn.addEventListener('pointerleave', soltar);
  btn.addEventListener('pointercancel', soltar);
  // `contextmenu` no celular dispara junto com o toque longo e abriria o menu
  // do navegador por cima do formulário.
  btn.addEventListener('contextmenu', (ev) => ev.preventDefault());

  btn.addEventListener('click', () => {
    if (longo) { longo = false; return; } // já tratado pelo toque longo
    escolher(false);
  });
}
