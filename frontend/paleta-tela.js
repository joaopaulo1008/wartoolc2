// paleta-tela.js — o cartão "Marcação rápida" no app do aluno (2026-09-14).
//
// A tela da paleta de ícones rápidos. A regra pura mora em paleta.js, o acesso
// ao banco em icones-rapidos.js, e a gravação da marcação continua sendo a de
// marcacoes.js — este arquivo só desenha os botões e arma o preset escolhido.
// Mesmo quarteto de kml.js / calcos.js / camadas.js / instrutor-calcos.js.
//
// Como em camadas.js e offline-tela.js, recebe `map` e o CONTÊINER do painel
// por parâmetro, em vez de procurar um id fixo no documento — é o que
// permitiria a mesma paleta servir a aba "Situação atual" do instrutor um dia
// sem uma segunda cópia (hoje ela só é ligada em index.html; ver o comentário
// no fim do arquivo).
import { svgDoSimbolo } from './icones.js';
import { buscarPaletaDaTurma, assinarPaleta, desassinarPaleta } from './icones-rapidos.js';
import { ordenarPaleta, modoDoPreset } from './paleta.js';
import { armarPreset, desarmarPreset } from './marcacoes.js';
import { tornarRecolhivel } from './painel-lateral.js';
// A MESMA chave que governa o formulário completo. Nenhuma chave nova entrou
// no catálogo para a paleta, e isso é decisão registrada na 0010: a paleta é
// um atalho para criar marcação, e criar marcação já tem dono
// (`criar_marcacao_inimiga`, Etapa 6a). Dois interruptores para a mesma
// capacidade é a forma mais fácil de deixar um aluno num estado que ninguém
// sabe explicar em campo.
import { observarPermissao } from './permissoes.js';

const TAMANHO_SIMBOLO = 30;

// Toque longo abre o formulário completo pré-preenchido. 500ms é o intervalo
// que o próprio navegador usa para o menu de contexto em toque — usar o mesmo
// número faz o gesto parecer nativo em vez de inventado.
const TOQUE_LONGO_MS = 500;

let presets = [];
let canal = null;
let armado = null;      // id do preset armado, ou null
let modoArmado = null;  // 'gravar' | 'perguntar' | 'completo' — só para a frase de status
let contêiner = null;   // o cartão inteiro
let grade = null;       // a div dos botões
let aviso = null;       // a linha de status abaixo dos botões
let desligar = [];
let permitido = true;

// ── Estilos ──────────────────────────────────────────────────────────────
// O cartão traz fundo/borda PRÓPRIOS, sem depender de `.panel-card` — a
// armadilha que camadas.js documenta e que offline-tela.js só descobriu ao
// ganhar um segundo consumidor (a classe existe em index.html e não existe no
// painel do instrutor, então herdar dela funciona "por acidente" numa tela e
// deixa a outra sem estilo nenhum).
let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados) return;
  estilosInjetados = true;
  const s = document.createElement('style');
  s.textContent = `
    #card-paleta {
      background:rgba(13,27,42,.92); border:1px solid #23405e; border-radius:6px;
      padding:10px 12px; margin-bottom:8px; color:#e8eaf0;
      font-family:'Segoe UI',Arial,sans-serif;
    }
    #card-paleta h3 {
      font-size:12px; letter-spacing:.05em; text-transform:uppercase;
      color:#a8c8e8; margin:0 0 8px;
    }
    #card-paleta .pal-grade {
      display:grid; grid-template-columns:repeat(4,1fr); gap:6px;
    }
    /* Botão alto o bastante para um dedo com luva (44px é o mínimo que as
       diretrizes de toque recomendam; aqui passa disso por causa do símbolo). */
    #card-paleta .pal-btn {
      display:flex; flex-direction:column; align-items:center; justify-content:flex-end;
      gap:2px; min-height:62px; padding:4px 2px;
      background:#16263a; border:1px solid #2a4a6b; border-radius:5px;
      color:#e8eaf0; font-size:10px; line-height:1.15; cursor:pointer;
      text-align:center; word-break:break-word; -webkit-tap-highlight-color:transparent;
    }
    #card-paleta .pal-btn svg { display:block; max-width:100%; height:auto; }
    #card-paleta .pal-btn.armado {
      border-color:#f5c842; background:#2a2412; box-shadow:0 0 0 1px #f5c842 inset;
    }
    #card-paleta .pal-btn:disabled { opacity:.45; cursor:default; }
    #card-paleta .pal-aviso {
      font-size:11px; color:#7a9ab8; margin-top:8px; line-height:1.35;
    }
    #card-paleta .pal-aviso.ativo { color:#f5c842; }
  `;
  document.head.appendChild(s);
}

// ── Desenho ──────────────────────────────────────────────────────────────
function dizer(texto, ativo = false) {
  if (!aviso) return;
  aviso.textContent = texto;
  aviso.classList.toggle('ativo', ativo);
}

function desenharGrade() {
  if (!grade) return;
  grade.textContent = '';

  if (presets.length === 0) {
    // Estado normal, não erro: uma turma cujo instrutor apagou a paleta
    // inteira. Dizer o que aconteceu é melhor que um cartão vazio, que parece
    // app quebrado — mesma postura de `carregar_kml` nascer desabilitado COM
    // explicação em vez de o botão sumir (Etapa 7).
    dizer('O instrutor desta turma ainda não montou a paleta. Você continua podendo marcar tocando direto no mapa.');
    return;
  }

  for (const preset of presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pal-btn';
    btn.disabled = !permitido;
    btn.classList.toggle('armado', preset.id === armado);

    // O símbolo é desenhado com o MESMO renderizador do mapa (milsymbol, via
    // icones.js): o botão mostra exatamente o desenho que vai aparecer no
    // mapa. Um ícone "parecido" desenhado à parte seria a porta de entrada
    // para o botão e o mapa discordarem.
    const svg = svgDoSimbolo(preset.sidc, { tamanho: TAMANHO_SIMBOLO });
    const caixa = document.createElement('span');
    if (svg) caixa.innerHTML = svg;
    else caixa.textContent = '—'; // SIDC que a milsymbol recusou: o rótulo ainda identifica o botão
    btn.appendChild(caixa);

    const rot = document.createElement('span');
    rot.textContent = preset.rotulo;
    btn.appendChild(rot);

    const modo = modoDoPreset(preset);
    btn.title = modo === 'gravar'
      ? `${preset.rotulo} — toque aqui e depois no mapa. Toque longo abre o formulário completo.`
      : `${preset.rotulo} — vai perguntar de quem é. Toque longo abre o formulário completo.`;

    ligarGestos(btn, preset);
    grade.appendChild(btn);
  }

  if (!permitido) {
    dizer('Criar marcação está desabilitado pelo instrutor.');
  } else if (armado) {
    const p = presets.find((x) => x.id === armado);
    // A frase diz o que VAI ACONTECER no próximo toque, não só que algo está
    // armado — é a diferença entre gravar direto e abrir um formulário, e
    // descobrir isso só depois de tocar no mapa seria a pior hora.
    const oque = modoArmado === 'completo'
      ? 'abre o formulário completo'
      : modoArmado === 'perguntar' ? 'vai perguntar de quem é' : 'grava na hora';
    dizer(p ? `${p.rotulo}: toque no mapa — ${oque}. Toque no botão de novo para cancelar.` : '', true);
  } else {
    dizer('Toque num botão e depois no mapa. Toque longo no botão abre o formulário completo.');
  }
}

// Clique curto arma/desarma; toque longo abre o formulário completo já com
// aquele SIDC. Implementado à mão com pointer events, sem plugin nem
// biblioteca de gestos — mesmo espírito de marcacoes.js resolver "tocar no
// mapa" e de offline-tela.js desenhar um retângulo sem leaflet-draw.
function ligarGestos(btn, preset) {
  let timer = null;
  let longo = false;

  const comecar = () => {
    longo = false;
    timer = setTimeout(() => {
      longo = true;
      // Toque longo NÃO abre o formulário agora: não existe ponto no mapa
      // ainda, e um formulário sem coordenada teria que perguntar "onde?"
      // depois de perguntar todo o resto. Ele arma o preset em modo
      // "completo", e o próximo toque no mapa abre o formulário já
      // pré-preenchido com este símbolo — mesmo gesto do modo rápido (botão,
      // depois mapa), com outro destino.
      armar(preset, { completo: true });
    }, TOQUE_LONGO_MS);
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
    if (preset.id === armado) cancelarArmado();
    else armar(preset);
  });
}

function armar(preset, { completo = false } = {}) {
  armado = preset.id;
  modoArmado = completo ? 'completo' : modoDoPreset(preset);
  // marcacoes.js é quem grava — ver o comentário de armarPreset() lá para o
  // porquê de a paleta NÃO registrar um segundo listener de clique no mapa.
  armarPreset(preset, {
    completo,
    aoConsumir: () => { armado = null; modoArmado = null; desenharGrade(); },
  });
  desenharGrade();
}

function cancelarArmado() {
  if (!armado) return;
  armado = null;
  modoArmado = null;
  desarmarPreset();
  desenharGrade();
}

// ── Dados ────────────────────────────────────────────────────────────────
function aplicarMudanca(linha) {
  const i = presets.findIndex((p) => p.id === linha.id);
  if (i >= 0) presets[i] = linha; else presets.push(linha);
  presets = ordenarPaleta(presets);
  desenharGrade();
}

function aplicarSaida(id) {
  const antes = presets.length;
  presets = presets.filter((p) => p.id !== id);
  if (presets.length === antes) return;
  // O botão armado saiu da paleta no meio do exercício (o instrutor removeu):
  // desarma, senão o próximo toque no mapa gravaria um preset que já não
  // existe — e o aluno não teria como saber por que aquilo apareceu.
  if (armado === id) { armado = null; desarmarPreset(); }
  desenharGrade();
}

// ── Ponto de entrada ─────────────────────────────────────────────────────
// containerPainel: onde o cartão é inserido (#side-panel no app do aluno).
export async function iniciarPaleta({ turmaId, containerPainel } = {}) {
  if (!containerPainel || !turmaId) return;
  injetarEstilos();

  contêiner = document.createElement('div');
  contêiner.id = 'card-paleta';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Marcação rápida';
  contêiner.appendChild(titulo);
  grade = document.createElement('div');
  grade.className = 'pal-grade';
  contêiner.appendChild(grade);
  aviso = document.createElement('div');
  aviso.className = 'pal-aviso';
  contêiner.appendChild(aviso);
  containerPainel.appendChild(contêiner);

  // Conteúdo PRIMEIRO, tornarRecolhivel() por último — a ordem que
  // offline-tela.js errou e que custou um bug de campo em 2026-08-01 (o cartão
  // "recolhia" uma div vazia enquanto o conteúdo real, anexado depois, ficava
  // sempre visível).
  tornarRecolhivel(contêiner);

  desligar.push(observarPermissao('criar_marcacao_inimiga', (habilitada) => {
    permitido = habilitada;
    if (!habilitada) cancelarArmado();
    desenharGrade();
  }));

  // Select inicial PRIMEIRO, assinatura DEPOIS — o Realtime não faz backfill
  // (armadilha registrada desde a Etapa 4). Invertido, a paleta apareceria
  // vazia para quem acabou de abrir o app e só ganharia botões se o instrutor
  // mexesse nela durante a sessão.
  const r = await buscarPaletaDaTurma(turmaId);
  presets = r.presets;
  desenharGrade();
  if (!r.ok) dizer('Não foi possível carregar a paleta. Você continua podendo marcar tocando direto no mapa.');

  canal = assinarPaleta(turmaId, { aoMudar: aplicarMudanca, aoSair: aplicarSaida });

  window.addEventListener('beforeunload', () => desassinarPaleta(canal));
}

// Teardown, no molde de pararMarcacoes() (Etapa 6c). Hoje ninguém chama: o app
// do aluno inicia uma vez por carga de página, e trocar de turma lá recarrega
// a página inteira (decisão da Etapa 6a). Existe para quando a aba "Situação
// atual" do instrutor ganhar a paleta — é ela que troca de turma sem recarregar
// e precisaria descartar a paleta da turma anterior.
export function pararPaleta() {
  desassinarPaleta(canal);
  canal = null;
  desligar.forEach((f) => { if (typeof f === 'function') f(); });
  desligar = [];
  cancelarArmado();
  presets = [];
  if (contêiner) { contêiner.remove(); contêiner = null; }
  grade = null; aviso = null;
}
