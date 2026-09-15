// situacao-tela.js — o cartão "Minha situação", o botão de pedir apoio e o
// alerta no mapa (2026-09-15).
//
// Serve as duas telas com o mesmo código, no padrão de camadas.js e
// anotacoes-tela.js:
//   - app do aluno: cartão com o recado de situação e o botão de apoio.
//   - aba "Situação atual" do instrutor: a faixa de alerta e os botões de
//     reconhecer/encerrar.
// Em AMBAS, um pedido vigente desenha um halo no mapa.
//
// A REGRA QUE ORGANIZA ESTE ARQUIVO
// ----------------------------------
// Recado de situação e pedido de apoio NUNCA compartilham cor, palavra,
// caminho ou controle. O recado é âmbar/discreto e mora num <select>; o
// pedido é vermelho, exige segurar o botão e aparece sem ninguém clicar.
// Ver o cabeçalho de backend/supabase/0014_situacao_e_apoio.sql.
//
// O QUE ESTE MÓDULO NÃO PODE FAZER, E DIZ NA TELA
// ------------------------------------------------
// O navegador congela a página com a tela do celular apagada (estabelecido em
// 2026-09-14, ver "App em segundo plano" no CLAUDE.md). Então o botão só
// funciona com o app aberto e a tela ligada. O cartão escreve isso embaixo do
// botão, sem rodeio: uma ferramenta que cria confiança que não sustenta é pior
// do que não existir.

import * as L from 'leaflet';
import {
  buscarSituacoesDaTurma, gravarMinhaSituacao, buscarPedidosVigentes,
  acionarPedidoApoio, reconhecerPedido, encerrarPedido,
  responderPedido, marcarRespostaVista,
  assinarSituacaoEApoio, desassinarSituacaoEApoio,
} from './situacao-banco.js';
import {
  ESTADOS, ESTADO_PADRAO, LIMITE_TEXTO_SITUACAO,
  validarSituacao, linhaDeSituacao, corDoEstado,
  descreverPosicaoDoPedido, pedidoEstaVigente, faseDoPedido, duracaoCurta,
  RESPOSTAS_PRONTAS, LIMITE_RESPOSTA, validarResposta, faseDaResposta, rotuloDaResposta,
} from './situacao-usuario.js';
import { buscarPerfilBasico } from './auth.js';

// Segurar por 2s para acionar. Dois motivos, nesta ordem: o celular fica no
// bolso e num toque acidental o pedido sairia sem ninguém saber; e um gesto
// deliberado é o que diferencia "pedi apoio" de "encostei na tela". Dois
// segundos é curto o bastante para não atrapalhar quem precisa de verdade.
const SEGURAR_MS = 2000;
const PANE_ALERTA = 'wt-alerta-apoio';

const situacoes = new Map();     // usuario_id -> row
const pedidos = new Map();       // id -> { row, marker }
const observadores = new Set();

let mapaRef = null;
let meuUserId = null;
let turmaIdRef = null;
let podeGerirRef = false;        // instrutor: reconhece e encerra
let mostrarCartaoRef = false;    // aluno: cartão com situação e botão
let seletorContainer = '#side-panel';
let obterPosicaoRef = null;      // () => { lat, lon, medidoEm } | null
let nomePorId = () => '';

// Quem respondeu, pelo nome de guerra. O app do ALUNO não recebe a lista da
// turma (não precisa dela para nada mais), então o nome é buscado sob demanda
// — e só quando existe resposta, que é o caso raro. Cache para não repetir a
// consulta a cada redesenho.
//
// Sem isto o cartão diria só "Instrutor", que é verdadeiro mas insuficiente:
// numa turma com mais de um, saber QUEM respondeu é parte de saber a quem
// obedecer.
const nomesResolvidos = new Map();
async function resolverNome(usuarioId) {
  if (!usuarioId || nomesResolvidos.has(usuarioId)) return;
  nomesResolvidos.set(usuarioId, null);              // marca em andamento
  const perfil = await buscarPerfilBasico(usuarioId);
  if (perfil?.nome_guerra) {
    nomesResolvidos.set(usuarioId, perfil.nome_guerra);
    redesenharMeuPedido();
  }
}
let estilosInjetados = false;
let seguranoDesde = 0;
let temporizador = null;

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function notificar() {
  for (const cb of observadores) {
    try { cb(); } catch (e) { console.error('Observador de situação falhou:', e); }
  }
}

// Quem desenha popup (colegas.js, gps.js, situacao.js) pergunta aqui. Devolve
// '' quando não há o que dizer — ver linhaDeSituacao() em situacao-usuario.js:
// "sem novidade" sem texto é silêncio, de propósito.
export function linhaSituacaoDe(usuarioId) {
  return linhaDeSituacao(situacoes.get(usuarioId));
}

export function corSituacaoDe(usuarioId) {
  const row = situacoes.get(usuarioId);
  return row ? corDoEstado(row.estado) : null;
}

export function pedidoVigenteDe(usuarioId) {
  for (const { row } of pedidos.values()) {
    if (row.usuario_id === usuarioId && pedidoEstaVigente(row)) return row;
  }
  return null;
}

export function observarSituacoes(cb) {
  observadores.add(cb);
  return () => observadores.delete(cb);
}

// ── Estilos ──────────────────────────────────────────────────────────────
function injetarEstilos() {
  if (estilosInjetados) return;
  estilosInjetados = true;
  const s = document.createElement('style');
  s.textContent = `
    #card-situacao {
      background:rgba(13,27,42,.92); border:1px solid #2a4a6b;
      border-radius:6px; padding:10px 14px; font-size:12px; min-width:170px;
    }
    #card-situacao h3 {
      font-size:11px; letter-spacing:.06em; text-transform:uppercase;
      color:#7a9ab8; margin-bottom:8px;
    }
    #card-situacao select, #card-situacao input[type=text] {
      width:100%; padding:5px 7px; margin-bottom:6px; background:#0d1b2a;
      color:#e8eaf0; border:1px solid #2a4a6b; border-radius:4px;
      font-size:12px; font-family:inherit;
    }
    .sit-salvo { font-size:10px; color:#7af57a; min-height:12px; }
    /* O botão de apoio é VERMELHO e não parece nenhum outro controle do app.
       A diferença visual é parte da separação: nada que se pareça com ele faz
       outra coisa, e ele não se parece com nada. */
    .sit-apoio {
      position:relative; overflow:hidden; width:100%; margin-top:10px;
      padding:11px 10px; border-radius:5px; cursor:pointer;
      border:1px solid #8c2a2a; background:#2a1414; color:#f0a0a0;
      font:600 12px/1.2 inherit; letter-spacing:.04em; text-transform:uppercase;
      touch-action:none; user-select:none;
    }
    .sit-apoio .sit-preencher {
      position:absolute; inset:0 auto 0 0; width:0; background:#8c2a2a;
      transition:width .05s linear; pointer-events:none;
    }
    .sit-apoio .sit-rotulo { position:relative; }
    .sit-apoio.armando { color:#ffd0d0; }
    .sit-aviso {
      margin-top:6px; font-size:10px; line-height:1.45; color:#8a9aa8;
    }
    .sit-aviso b { color:#c8a24a; }
    .sit-meu-pedido {
      margin-top:8px; padding:7px 9px; border-radius:4px;
      background:#2a1414; border-left:3px solid #c05050; color:#f0c0c0;
      font-size:11px; line-height:1.45;
    }
    .sit-meu-pedido button {
      margin-top:6px; padding:4px 9px; border-radius:3px; cursor:pointer;
      border:1px solid #8c2a2a; background:transparent; color:#f0a0a0;
      font-size:11px; font-family:inherit;
    }
    /* Faixa do instrutor: aparece SEM ninguém clicar. Um pedido de apoio que
       só aparecesse ao abrir um popup seria um pedido que ninguém vê. */
    #faixa-apoio {
      position:absolute; top:8px; left:50%; transform:translateX(-50%);
      z-index:1200; max-width:min(560px, 92%);
      background:#8c2a2a; color:#fff0f0; border-radius:5px;
      box-shadow:0 3px 14px rgba(0,0,0,.5); font-size:12px; line-height:1.45;
      padding:9px 13px;
    }
    #faixa-apoio .sit-linha { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    #faixa-apoio b { font-size:13px; }
    #faixa-apoio .sit-velha { color:#ffd9a0; font-weight:600; }
    #faixa-apoio button {
      padding:4px 10px; border-radius:3px; cursor:pointer; font-family:inherit;
      border:1px solid #ffc0c0; background:transparent; color:#fff0f0; font-size:11px;
    }
    #faixa-apoio button:hover { background:rgba(255,255,255,.14); }
    #faixa-apoio .sit-reconhecido { opacity:.85; }
    /* Respostas prontas: um toque cada. Digitar leva tempo justamente quando
       há menos — ver RESPOSTAS_PRONTAS em situacao-usuario.js. */
    #faixa-apoio .sit-prontas { display:flex; gap:5px; flex-wrap:wrap; width:100%; margin-top:5px; }
    #faixa-apoio .sit-pronta {
      padding:3px 8px; font-size:11px; border-radius:3px; cursor:pointer;
      border:1px solid #ffc0c0; background:rgba(255,255,255,.1); color:#fff0f0;
      font-family:inherit;
    }
    #faixa-apoio .sit-pronta:hover { background:rgba(255,255,255,.24); }
    #faixa-apoio .sit-livre { display:flex; gap:5px; width:100%; margin-top:5px; }
    #faixa-apoio .sit-livre input {
      flex:1; padding:3px 7px; font-size:11px; border-radius:3px;
      border:1px solid #ffc0c0; background:rgba(0,0,0,.25); color:#fff0f0;
      font-family:inherit;
    }
    #faixa-apoio .sit-livre input::placeholder { color:#e0b0b0; }
    /* "respondido" e "SEM confirmação" nunca se parecem: a diferença entre
       mandar e ser lido é o que decide se o instrutor insiste pelo rádio. */
    #faixa-apoio .sit-sem-leitura { color:#ffd9a0; font-weight:600; }
    #faixa-apoio .sit-lido { color:#c8f5d4; }
    .sit-resposta {
      margin-top:8px; padding:8px 10px; border-radius:4px;
      background:#14261a; border-left:3px solid #4a9a5f; color:#d8f0e0;
      font-size:12px; line-height:1.5;
    }
    .sit-resposta .sit-quem { font-size:10px; color:#8ac89a; display:block; margin-bottom:3px; }
    .sit-resposta button {
      margin-top:7px; padding:5px 14px; border-radius:3px; cursor:pointer;
      border:1px solid #4a9a5f; background:transparent; color:#8ce8a0;
      font-size:12px; font-family:inherit;
    }
    .sit-resposta .sit-confirmado { font-size:10px; color:#8ac89a; margin-top:6px; }
    /* Halo no mapa. pointer-events:none para nunca roubar o toque do símbolo
       que está embaixo — quem precisa clicar no avatar continua conseguindo. */
    .sit-halo { background:none; border:none; pointer-events:none; }
    .sit-halo i {
      display:block; width:46px; height:46px; margin:-23px 0 0 -23px;
      border-radius:50%; border:3px solid #e05252;
      animation:sit-pulsa 1.4s ease-out infinite;
    }
    @keyframes sit-pulsa {
      0%   { transform:scale(.55); opacity:1; }
      100% { transform:scale(1.25); opacity:0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .sit-halo i { animation:none; opacity:.9; }
    }
  `;
  document.head.appendChild(s);
}

// ── Halo no mapa ─────────────────────────────────────────────────────────
function garantirPane() {
  if (!mapaRef.getPane(PANE_ALERTA)) {
    const p = mapaRef.createPane(PANE_ALERTA);
    p.style.zIndex = 640;          // acima das anotações (620), abaixo dos símbolos
    p.style.pointerEvents = 'none';
  }
}

function desenharPedido(row) {
  if (!mapaRef) return;
  const vigente = pedidoEstaVigente(row);
  const estado = pedidos.get(row.id);

  // Sem posição não há halo — e isso é informação, não falha: a faixa diz
  // "sem posição conhecida" e quem recebe usa rádio ou o último rastro. Um
  // halo inventado num ponto qualquer seria a pior saída possível.
  const temPonto = Number.isFinite(row.latitude) && Number.isFinite(row.longitude);

  if (!vigente || !temPonto) {
    if (estado?.marker) { mapaRef.removeLayer(estado.marker); estado.marker = null; }
    if (estado) estado.row = row; else if (vigente) pedidos.set(row.id, { row, marker: null });
    return;
  }

  garantirPane();
  if (estado?.marker) {
    estado.row = row;
    estado.marker.setLatLng([row.latitude, row.longitude]);
    return;
  }
  const marker = L.marker([row.latitude, row.longitude], {
    icon: L.divIcon({ className: 'sit-halo', html: '<i></i>', iconSize: null }),
    pane: PANE_ALERTA,
    interactive: false,
    keyboard: false,
    zIndexOffset: -100,   // o halo fica ATRÁS do símbolo da pessoa
  }).addTo(mapaRef);
  pedidos.set(row.id, { row, marker });
}

function removerPedido(id) {
  const estado = pedidos.get(id);
  if (estado?.marker) mapaRef.removeLayer(estado.marker);
  pedidos.delete(id);
}

// ── Faixa de alerta (quem gere: o instrutor) ─────────────────────────────
function redesenharFaixa() {
  const antiga = document.getElementById('faixa-apoio');
  if (antiga) antiga.remove();
  if (!podeGerirRef || !mapaRef) return;

  const vigentes = [...pedidos.values()].map((e) => e.row).filter(pedidoEstaVigente);
  if (vigentes.length === 0) return;

  const faixa = document.createElement('div');
  faixa.id = 'faixa-apoio';
  const agora = Date.now();

  for (const row of vigentes) {
    const pos = descreverPosicaoDoPedido(row, { agora });
    const idade = duracaoCurta(agora - new Date(row.acionado_em).getTime());
    const fase = faseDoPedido(row);

    const linha = document.createElement('div');
    linha.className = `sit-linha${fase === 'reconhecido' ? ' sit-reconhecido' : ''}`;

    const texto = document.createElement('span');
    texto.style.flex = '1';
    // A idade da POSIÇÃO vai destacada quando ela é velha ou não existe: é a
    // diferença entre mandar alguém ao ponto certo e ao lugar onde a pessoa
    // estava oito minutos atrás.
    texto.innerHTML =
      `<b>${esc(nomePorId(row.usuario_id) || 'Alguém')}</b> pediu apoio · há ${esc(idade)}<br>` +
      `<span class="${pos.velha ? 'sit-velha' : ''}">${esc(pos.rotulo)}</span>` +
      (row.motivo ? ` · ${esc(row.motivo)}` : '') +
      (fase === 'reconhecido' && faseDaResposta(row) === 'nenhuma' ? ' · <i>reconhecido</i>' : '') +
      // "respondido" e "SEM confirmação de leitura" são frases diferentes de
      // propósito: com a tela do celular apagada, mandar não é ser lido — e é
      // essa diferença que decide se o instrutor insiste pelo rádio.
      (faseDaResposta(row) !== 'nenhuma'
        ? `<br><span class="${faseDaResposta(row) === 'lida' ? 'sit-lido' : 'sit-sem-leitura'}">`
          + `${esc(rotuloDaResposta(row, { agora }))}</span>`
          + `<br>“${esc(row.resposta)}”`
        : '');
    linha.appendChild(texto);

    if (pos.temPosicao) {
      const ir = document.createElement('button');
      ir.type = 'button';
      ir.textContent = 'Ir até';
      ir.addEventListener('click', () => mapaRef.setView([row.latitude, row.longitude], 16));
      linha.appendChild(ir);
    }
    if (fase === 'aberto') {
      const rec = document.createElement('button');
      rec.type = 'button';
      rec.textContent = 'Reconhecer';
      rec.addEventListener('click', async () => {
        const { error } = await reconhecerPedido(row.id, meuUserId);
        if (error) console.error('Reconhecer falhou:', error);
      });
      linha.appendChild(rec);
    }
    // RESPONDER. Fica DEPOIS de "Ir até" e antes de "Encerrar" porque é a
    // ordem do que se faz: vejo onde é, digo o que vai acontecer, e só encerro
    // quando acabou.
    const prontas = document.createElement('div');
    prontas.className = 'sit-prontas';
    for (const frase of RESPOSTAS_PRONTAS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sit-pronta';
      b.textContent = frase;
      b.addEventListener('click', () => responder(row.id, frase));
      prontas.appendChild(b);
    }
    linha.appendChild(prontas);

    const livre = document.createElement('div');
    livre.className = 'sit-livre';
    const campo = document.createElement('input');
    campo.type = 'text';
    campo.maxLength = LIMITE_RESPOSTA;
    campo.placeholder = `Responder a ${nomePorId(row.usuario_id) || 'quem pediu'}…`;
    const enviar = document.createElement('button');
    enviar.type = 'button';
    enviar.textContent = 'Enviar';
    const mandar = () => { responder(row.id, campo.value); campo.value = ''; };
    enviar.addEventListener('click', mandar);
    campo.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') mandar(); });
    livre.append(campo, enviar);
    linha.appendChild(livre);

    const enc = document.createElement('button');
    enc.type = 'button';
    enc.textContent = 'Encerrar';
    enc.addEventListener('click', async () => {
      if (!confirm(`Encerrar o pedido de apoio de ${nomePorId(row.usuario_id) || 'este usuário'}?\n\n`
        + 'Ele sai do mapa e da faixa. O registro fica para o debriefing.')) return;
      const { error } = await encerrarPedido(row.id, meuUserId);
      if (error) console.error('Encerrar falhou:', error);
    });
    linha.appendChild(enc);

    faixa.appendChild(linha);
  }

  mapaRef.getContainer().appendChild(faixa);
}

async function responder(id, texto) {
  const v = validarResposta(texto);
  if (!v.ok) { alert(v.erro); return; }
  const { error } = await responderPedido(id, v.valor, meuUserId);
  if (error) {
    // Falhar em silêncio aqui seria o pior caso: o instrutor acharia que
    // avisou e a pessoa em campo continuaria sem saber de nada.
    alert(`A resposta NÃO foi enviada: ${error.message}`);
  }
}

// ── Cartão do aluno ──────────────────────────────────────────────────────
function montarCartao() {
  if (!mostrarCartaoRef) return;
  const container = document.querySelector(seletorContainer);
  if (!container || document.getElementById('card-situacao')) return;

  const card = document.createElement('div');
  card.className = 'panel-card';
  card.id = 'card-situacao';
  card.innerHTML = `
    <h3>Minha situação</h3>
    <select id="sit-estado">
      ${ESTADOS.map((e) => `<option value="${e.valor}">${esc(e.rotulo)}</option>`).join('')}
    </select>
    <input id="sit-texto" type="text" maxlength="${LIMITE_TEXTO_SITUACAO}"
           placeholder="recado curto (opcional)" autocomplete="off">
    <div class="sit-salvo" id="sit-salvo"></div>
    <button type="button" class="sit-apoio" id="sit-apoio">
      <span class="sit-preencher" id="sit-preencher"></span>
      <span class="sit-rotulo" id="sit-rotulo">Segure para pedir apoio</span>
    </button>
    <div class="sit-aviso">
      Chega ao instrutor e à sua força. <b>Só funciona com o app aberto e a tela
      ligada</b> — não substitui o rádio.
    </div>
    <div id="sit-meu-pedido"></div>
  `;
  container.appendChild(card);

  const selEstado = document.getElementById('sit-estado');
  const campoTexto = document.getElementById('sit-texto');
  const salvo = document.getElementById('sit-salvo');

  const gravar = async () => {
    const v = validarSituacao({ estado: selEstado.value, texto: campoTexto.value });
    if (!v.ok) { salvo.style.color = '#e05252'; salvo.textContent = v.erro; return; }
    const { error } = await gravarMinhaSituacao({
      usuarioId: meuUserId, turmaId: turmaIdRef, ...v.valor,
    });
    salvo.style.color = error ? '#e05252' : '#7af57a';
    salvo.textContent = error ? `Não salvou: ${error.message}` : 'Enviado à sua força.';
    setTimeout(() => { if (salvo) salvo.textContent = ''; }, 4000);
  };

  selEstado.addEventListener('change', gravar);
  // `change` no texto (e não `input`) para não gravar a cada tecla: são 60
  // celulares numa turma, e o recado não precisa de tempo real por caractere.
  campoTexto.addEventListener('change', gravar);

  ligarBotaoApoio();
  redesenharMeuPedido();
}

// Segurar 2s, com a barra enchendo. Um `click` simples sairia no bolso.
function ligarBotaoApoio() {
  const botao = document.getElementById('sit-apoio');
  const preencher = document.getElementById('sit-preencher');
  const rotulo = document.getElementById('sit-rotulo');
  if (!botao) return;

  const parar = () => {
    clearInterval(temporizador);
    temporizador = null;
    seguranoDesde = 0;
    botao.classList.remove('armando');
    if (preencher) preencher.style.width = '0';
    if (rotulo) rotulo.textContent = 'Segure para pedir apoio';
  };

  const comecar = (ev) => {
    ev.preventDefault();
    if (temporizador) return;
    seguranoDesde = Date.now();
    botao.classList.add('armando');
    temporizador = setInterval(() => {
      const decorrido = Date.now() - seguranoDesde;
      const pct = Math.min(100, (decorrido / SEGURAR_MS) * 100);
      if (preencher) preencher.style.width = `${pct}%`;
      if (rotulo) rotulo.textContent = `Segurando… ${Math.ceil((SEGURAR_MS - decorrido) / 1000)}`;
      if (decorrido >= SEGURAR_MS) { parar(); acionar(); }
    }, 50);
  };

  botao.addEventListener('pointerdown', comecar);
  botao.addEventListener('pointerup', parar);
  botao.addEventListener('pointerleave', parar);
  botao.addEventListener('pointercancel', parar);
}

async function acionar() {
  // A melhor posição que houver AGORA, com o carimbo de quando foi medida.
  // Se não houver nenhuma, o pedido sai assim mesmo — ver o comentário da
  // coluna `latitude` na 0014: exigir coordenada deixaria justamente quem
  // está sem sinal sem conseguir pedir ajuda.
  const p = obterPosicaoRef ? obterPosicaoRef() : null;
  const { data, error } = await acionarPedidoApoio({
    usuarioId: meuUserId,
    turmaId: turmaIdRef,
    latitude: p?.lat,
    longitude: p?.lon,
    posicaoEm: p?.medidoEm || null,
  });
  const salvo = document.getElementById('sit-salvo');
  if (error) {
    if (salvo) { salvo.style.color = '#e05252'; salvo.textContent = `NÃO foi enviado: ${error.message}`; }
    return;
  }
  if (data) { pedidos.set(data.id, { row: data, marker: null }); desenharPedido(data); }
  redesenharMeuPedido();
  redesenharFaixa();
}

// O que o próprio autor vê depois de acionar. Existe por duas razões: ele
// precisa saber que o pedido saiu (e se alguém já reconheceu), e precisa
// poder encerrar sozinho — um acionamento sem querer que só o instrutor
// pudesse fechar viraria um alarme tocando até alguém no notebook perceber.
function redesenharMeuPedido() {
  const caixa = document.getElementById('sit-meu-pedido');
  if (!caixa) return;
  const meu = pedidoVigenteDe(meuUserId);
  caixa.innerHTML = '';
  if (!meu) return;

  const div = document.createElement('div');
  div.className = 'sit-meu-pedido';
  const fase = faseDoPedido(meu);
  div.textContent = fase === 'reconhecido'
    ? 'Seu pedido de apoio foi RECONHECIDO. Mantenha o app aberto.'
    : 'Pedido de apoio enviado. Aguardando alguém reconhecer.';

  // A RESPOSTA, quando existe, é o que a pessoa em campo precisa ler — então
  // vem em bloco próprio, verde (não vermelho: é a notícia boa), com o nome de
  // quem respondeu e a hora. "Reconhecido" sozinho não diz se alguém saiu, por
  // onde, nem em quanto tempo; a resposta diz.
  if (meu.resposta) {
    const bloco = document.createElement('div');
    bloco.className = 'sit-resposta';

    const quem = document.createElement('span');
    quem.className = 'sit-quem';
    const hora = meu.respondido_em
      ? new Date(meu.respondido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '';
    const nome = nomePorId(meu.respondido_por) || nomesResolvidos.get(meu.respondido_por);
    if (!nome) resolverNome(meu.respondido_por);
    quem.textContent = `${nome || 'Instrutor'}${hora ? ` · ${hora}` : ''}`;

    const corpo = document.createElement('div');
    corpo.textContent = meu.resposta;     // dado de fora: textContent

    bloco.append(quem, corpo);

    if (meu.resposta_vista_em) {
      const feito = document.createElement('div');
      feito.className = 'sit-confirmado';
      feito.textContent = 'Você confirmou a leitura.';
      bloco.appendChild(feito);
    } else {
      // O "Vi" é o que fecha o laço do outro lado: sem ele o instrutor não
      // sabe se a mensagem chegou a alguém, e com a tela do celular apagada
      // esse é o caso provável, não o raro.
      const vi = document.createElement('button');
      vi.type = 'button';
      vi.textContent = 'Vi';
      vi.addEventListener('click', async () => {
        const { error } = await marcarRespostaVista(meu.id);
        if (error) console.error('Confirmar leitura falhou:', error);
      });
      bloco.appendChild(vi);
    }
    div.appendChild(bloco);
  }

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.textContent = 'Cancelar meu pedido';
  botao.addEventListener('click', async () => {
    if (!confirm('Cancelar o seu pedido de apoio?')) return;
    const { error } = await encerrarPedido(meu.id, meuUserId);
    if (error) console.error('Cancelar falhou:', error);
  });
  div.appendChild(document.createElement('br'));
  div.appendChild(botao);
  caixa.appendChild(div);
}

// ── Ciclo de vida ────────────────────────────────────────────────────────
export async function iniciarSituacaoUsuario({
  map, userId, turmaId, mostrarCartao = false, podeGerir = false,
  container, obterPosicao = null, nomeDe = null,
}) {
  injetarEstilos();
  mapaRef = map;
  meuUserId = userId;
  mostrarCartaoRef = !!mostrarCartao;
  podeGerirRef = !!podeGerir;
  obterPosicaoRef = obterPosicao;
  if (nomeDe) nomePorId = nomeDe;
  if (container) seletorContainer = container;

  montarCartao();
  await definirTurmaSituacaoUsuario(turmaId ? { id: turmaId } : null);
}

export async function definirTurmaSituacaoUsuario(turma) {
  const nova = turma?.id || null;
  for (const id of [...pedidos.keys()]) removerPedido(id);
  situacoes.clear();
  desassinarSituacaoEApoio();
  turmaIdRef = nova;
  if (!turmaIdRef) { redesenharFaixa(); notificar(); return; }

  const [linhasSituacao, linhasPedido] = await Promise.all([
    buscarSituacoesDaTurma(turmaIdRef),
    buscarPedidosVigentes(turmaIdRef),
  ]);
  for (const row of linhasSituacao) situacoes.set(row.usuario_id, row);
  for (const row of linhasPedido) { pedidos.set(row.id, { row, marker: null }); desenharPedido(row); }

  // A minha própria situação preenche o cartão: quem recarrega a página tem
  // que ver o que já declarou, não o formulário em branco sugerindo que não
  // declarou nada.
  const minha = situacoes.get(meuUserId);
  const sel = document.getElementById('sit-estado');
  const txt = document.getElementById('sit-texto');
  if (sel) sel.value = minha?.estado || ESTADO_PADRAO;
  if (txt) txt.value = minha?.texto || '';

  redesenharFaixa();
  redesenharMeuPedido();
  notificar();

  assinarSituacaoEApoio(turmaIdRef, {
    aoMudarSituacao: (payload) => {
      const row = payload.new;
      if (payload.eventType === 'DELETE') situacoes.delete(payload.old?.usuario_id);
      else if (row) situacoes.set(row.usuario_id, row);
      notificar();
    },
    aoMudarPedido: (payload) => {
      const row = payload.new;
      if (payload.eventType === 'DELETE') { removerPedido(payload.old?.id); }
      else if (row) {
        // Encerrado sai do mapa; reconhecido CONTINUA — "estou vendo" não é
        // "está resolvido" (ver pedidoEstaVigente em situacao-usuario.js).
        if (pedidoEstaVigente(row)) { desenharPedido(row); }
        else removerPedido(row.id);
      }
      redesenharFaixa();
      redesenharMeuPedido();
      notificar();
    },
  });
}

export function pararSituacaoUsuario() {
  desassinarSituacaoEApoio();
  for (const id of [...pedidos.keys()]) removerPedido(id);
  situacoes.clear();
  clearInterval(temporizador);
  temporizador = null;
  document.getElementById('faixa-apoio')?.remove();
  document.getElementById('card-situacao')?.remove();
  turmaIdRef = null;
}
