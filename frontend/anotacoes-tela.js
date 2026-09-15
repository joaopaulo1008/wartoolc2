// anotacoes-tela.js — as caixas de texto desenhadas no mapa (2026-09-14).
//
// Terceira parte do trio: anotacoes.js (regras puras), anotacoes-banco.js
// (Supabase + Realtime) e este arquivo (Leaflet + interface).
//
// Serve as DUAS telas com o mesmo código, como camadas.js já faz:
//   - app do aluno (index.html): só desenha. `podeEditar: false`.
//   - aba "Situação atual" do instrutor: desenha, cria, edita, arrasta e
//     remove. `podeEditar: true`.
// A diferença entra por parâmetro, não por um `if (papel === 'instrutor')`
// espalhado — quem decide de verdade é a RLS de 0013; isto aqui é só não
// oferecer um botão que o banco recusaria.
//
// POR QUE divIcon E NÃO tooltip PERMANENTE
// -----------------------------------------
// O rótulo dos calcos (camadas.js, mesma data) usa `bindTooltip permanent`, e
// ali é certo: o texto é acessório de uma feição que já existe. Aqui a caixa
// É o objeto — precisa ser arrastável, clicável e ter posição própria. Um
// tooltip do Leaflet não é nada disso: ele é filho de outra camada e não
// recebe eventos. Então cada anotação é um `L.marker` de verdade, com um
// `divIcon` por desenho.
//
// O PANE: as anotações ficam ACIMA dos calcos e ABAIXO dos símbolos militares.
// Um recado de texto não pode tapar um símbolo — é a mesma regra que FAIXAS_PANE
// (kml.js) aplica aos calcos, e pelo mesmo motivo: o símbolo é o dado, o resto
// é apoio.

import * as L from 'leaflet';
import {
  buscarAnotacoesDaTurma, criarAnotacao, atualizarAnotacao, removerAnotacao,
  assinarAnotacoes, desassinarAnotacoes,
} from './anotacoes-banco.js';
import { validarAnotacao, resumirTexto, descreverAlcance, LIMITE_TEXTO, COR_PADRAO } from './anotacoes.js';
import { buscarPartidosDaTurma } from './auth.js';
import { tornarRecolhivel } from './painel-lateral.js';

// ── Estado do módulo ─────────────────────────────────────────────────────
const marcadores = new Map();   // id -> { row, marker }
let mapaRef = null;
let meuUserId = null;
let turmaIdRef = null;
let podeEditarRef = false;
let seletorContainer = '#side-panel';
let partidos = [];
let editandoId = null;
let estilosInjetados = false;

const PANE = 'wt-anotacoes';

// ── Estilos (o módulo é autocontido, como camadas.js e marcacoes.js) ─────
function injetarEstilos() {
  if (estilosInjetados) return;
  estilosInjetados = true;
  const style = document.createElement('style');
  style.textContent = `
    .anot-caixa {
      display:inline-block; max-width:220px; padding:3px 7px;
      background:rgba(13,27,42,.86); border-left:3px solid currentColor;
      border-radius:3px; font:600 12px/1.35 'Segoe UI',Arial,sans-serif;
      white-space:pre-wrap; word-break:break-word;
      text-shadow:0 1px 2px rgba(0,0,0,.9);
    }
    /* O marcador do Leaflet é quadrado por padrão e roubaria o toque em volta
       do texto; o wrapper não recebe eventos, só a caixa. */
    .anot-wrap { background:none; border:none; }
    .anot-wrap.anot-somente-leitura .anot-caixa { cursor:default; }
    .anot-wrap.anot-editavel .anot-caixa { cursor:pointer; }
    #card-anotacoes {
      background:rgba(13,27,42,.92); border:1px solid #2a4a6b;
      border-radius:6px; padding:10px 14px; font-size:12px; min-width:170px;
    }
    #card-anotacoes h3 {
      font-size:11px; letter-spacing:.06em; text-transform:uppercase;
      color:#7a9ab8; margin-bottom:8px;
    }
    #card-anotacoes .anot-btn {
      width:100%; padding:6px 10px; border-radius:4px; font-size:12px;
      font-family:inherit; cursor:pointer; border:1px solid #2a4a6b;
      background:#0d1b2a; color:#a8c8e8; margin-bottom:8px;
    }
    #card-anotacoes .anot-btn:hover { border-color:#4a7ab0; color:#e8eaf0; }
    #card-anotacoes .anot-item {
      display:flex; align-items:center; gap:6px; padding:4px 0;
      border-top:1px solid #23405e;
    }
    #card-anotacoes .anot-texto { flex:1; color:#c8d8e8; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    #card-anotacoes .anot-alcance { font-size:10px; color:#5a7a98; }
    #card-anotacoes .anot-mini {
      background:transparent; border:1px solid #2a4a6b; color:#7a9ab8;
      border-radius:3px; min-width:18px; height:18px; line-height:1;
      font-size:10px; cursor:pointer; padding:0 4px; flex-shrink:0;
    }
    #card-anotacoes .anot-mini:hover { color:#c8d8e8; border-color:#4a6a8a; }
    #card-anotacoes .anot-vazio { color:#5a7a98; font-style:italic; }
    .anot-form { margin-top:8px; }
    .anot-form textarea {
      width:100%; min-height:54px; resize:vertical; padding:5px 7px;
      background:#0d1b2a; color:#e8eaf0; border:1px solid #2a4a6b;
      border-radius:4px; font:12px/1.4 'Segoe UI',Arial,sans-serif;
    }
    .anot-form select {
      width:100%; padding:4px 7px; margin-top:6px; background:#0d1b2a;
      color:#e8eaf0; border:1px solid #2a4a6b; border-radius:4px;
      font-size:12px; font-family:inherit;
    }
    .anot-form .anot-contador { font-size:10px; color:#5a7a98; margin-top:3px; }
    .anot-form .anot-contador.estourou { color:#e05252; }
    .anot-form .anot-acoes { display:flex; gap:6px; margin-top:8px; }
    .anot-erro { color:#e05252; font-size:11px; margin-top:5px; }
    .anot-dica { color:#f5e07a; font-size:11px; margin-top:5px; }
  `;
  document.head.appendChild(style);
}

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── Desenho ──────────────────────────────────────────────────────────────
function garantirPane() {
  if (!mapaRef.getPane(PANE)) {
    const pane = mapaRef.createPane(PANE);
    // 620: acima da faixa mais alta de calco (TETO_PANE em kml.js fica abaixo
    // disso) e abaixo do markerPane do Leaflet (600 é o padrão do markerPane;
    // os marcadores de símbolo usam zIndexOffset e ficam acima de qualquer
    // jeito). Ver o comentário do topo: texto nunca tapa símbolo.
    pane.style.zIndex = 620;
  }
  return mapaRef.getPane(PANE);
}

function iconeDaAnotacao(row) {
  const cor = row.cor || COR_PADRAO;
  return L.divIcon({
    className: `anot-wrap ${podeEditarRef ? 'anot-editavel' : 'anot-somente-leitura'}`,
    // `style="color:"` alimenta o `border-left:3px solid currentColor` do CSS:
    // uma propriedade só pinta a borda e serve de gancho para o texto herdar.
    html: `<div class="anot-caixa" style="color:${esc(cor)}">${esc(row.texto)}</div>`,
    iconSize: null,   // o Leaflet mede o conteúdo em vez de cortar
  });
}

function desenhar(row) {
  garantirPane();
  let estado = marcadores.get(row.id);
  if (!estado) {
    const marker = L.marker([row.latitude, row.longitude], {
      icon: iconeDaAnotacao(row),
      pane: PANE,
      draggable: podeEditarRef,
      // `keyboard:false` para a caixa não entrar na navegação por Tab do mapa:
      // são muitas, e elas não são controles.
      keyboard: false,
    }).addTo(mapaRef);

    if (podeEditarRef) {
      marker.on('dragend', async () => {
        const p = marker.getLatLng();
        const { error } = await atualizarAnotacao(row.id, { latitude: p.lat, longitude: p.lng });
        if (error) {
          // Volta para onde estava: deixar a caixa no lugar novo com o banco
          // dizendo outra coisa é a pior saída — o instrutor acharia que moveu.
          marker.setLatLng([row.latitude, row.longitude]);
          console.error('Não foi possível mover a anotação:', error);
        }
      });
      marker.on('click', () => abrirFormulario(row.id));
    }

    estado = { row, marker };
    marcadores.set(row.id, estado);
    return;
  }

  estado.row = row;
  estado.marker.setLatLng([row.latitude, row.longitude]);
  estado.marker.setIcon(iconeDaAnotacao(row));
}

function apagarDoMapa(id) {
  const estado = marcadores.get(id);
  if (!estado) return;
  mapaRef.removeLayer(estado.marker);
  marcadores.delete(id);
}

// ── Cartão do painel (só para quem edita) ────────────────────────────────
function montarCartao() {
  if (!podeEditarRef) return;
  const container = document.querySelector(seletorContainer);
  if (!container || document.getElementById('card-anotacoes')) return;

  const card = document.createElement('div');
  card.className = 'panel-card';
  card.id = 'card-anotacoes';
  card.innerHTML = `
    <h3>Anotações no mapa</h3>
    <button type="button" class="anot-btn" id="anot-novo">Nova anotação</button>
    <div id="anot-dica"></div>
    <div id="anot-lista"></div>
    <div id="anot-form"></div>
  `;
  container.appendChild(card);
  // Recolhido como os outros cartões do painel. Aqui não há a ressalva do
  // cartão de apoio (nada urgente chega por dentro dele): a lista de anotações
  // é consulta, não aviso.
  tornarRecolhivel(card);

  document.getElementById('anot-novo').addEventListener('click', () => {
    abrirFormulario(null, centroDaVista());
  });
  redesenharLista();
}

// NÃO EXISTE ESTADO "ARMADO", E ISSO É DELIBERADO
// ------------------------------------------------
// O desenho óbvio seria "clique em Nova anotação, depois toque no mapa". Duas
// razões o derrubaram, e a segunda é técnica e teria virado bug em campo:
//
//   1. Estado armado invisível já foi recusado neste projeto uma vez. A paleta
//      de ícones rápidos (0010) nasceu assim e foi redesenhada depois do
//      primeiro uso — quem toca no mapa dois minutos depois não lembra que
//      armou nada, e o toque faz outra coisa do que ele esperava.
//   2. **O clique no mapa desta aba JÁ TEM DONO.** `marcacoes.js` escuta o
//      mesmo evento para abrir o formulário de marcação, e o Leaflet entrega o
//      clique a TODOS os ouvintes do mapa de forma síncrona — `DomEvent.stop()`
//      num deles não impede os outros de rodar. O instrutor levaria dois
//      formulários abertos com um toque só.
//
// Então a anotação nasce no CENTRO DA VISTA ATUAL e é arrastada para o lugar
// exato. O instrutor já está olhando para a região onde quer escrever (foi por
// isso que centralizou ali), o arrastar já existe para reposicionar depois, e
// nenhum evento novo disputa o clique do mapa.
function centroDaVista() {
  const c = mapaRef.getCenter();
  return { lat: c.lat, lng: c.lng };
}

function redesenharLista() {
  const lista = document.getElementById('anot-lista');
  if (!lista) return;
  lista.innerHTML = '';
  const itens = [...marcadores.values()].map((e) => e.row);
  if (itens.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'anot-vazio';
    vazio.textContent = 'Nenhuma anotação nesta turma.';
    lista.appendChild(vazio);
    return;
  }
  for (const row of itens) {
    const item = document.createElement('div');
    item.className = 'anot-item';

    const texto = document.createElement('span');
    texto.className = 'anot-texto';
    texto.textContent = resumirTexto(row.texto);      // dado de fora: textContent
    texto.title = row.texto;

    const alcance = document.createElement('span');
    alcance.className = 'anot-alcance';
    alcance.textContent = descreverAlcance(row.partido_id, partidos);

    const irPara = document.createElement('button');
    irPara.type = 'button';
    irPara.className = 'anot-mini';
    irPara.textContent = '⌖';
    irPara.title = 'Centralizar no mapa';
    irPara.addEventListener('click', () => mapaRef.setView([row.latitude, row.longitude]));

    const editar = document.createElement('button');
    editar.type = 'button';
    editar.className = 'anot-mini';
    editar.textContent = '✎';
    editar.title = 'Editar';
    editar.addEventListener('click', () => abrirFormulario(row.id));

    const apagar = document.createElement('button');
    apagar.type = 'button';
    apagar.className = 'anot-mini';
    apagar.textContent = '×';
    apagar.title = 'Remover do mapa';
    apagar.addEventListener('click', async () => {
      if (!confirm(`Remover esta anotação do mapa de todos?\n\n"${resumirTexto(row.texto, { maximo: 80 })}"`)) return;
      const { error } = await removerAnotacao(row.id, meuUserId);
      if (error) { console.error('Remover anotação falhou:', error); return; }
      apagarDoMapa(row.id);
      redesenharLista();
    });

    item.append(texto, alcance, irPara, editar, apagar);
    lista.appendChild(item);
  }
}

// ── Formulário (criar e editar usam o MESMO) ─────────────────────────────
// Um formulário só para os dois casos porque os campos são idênticos; dois
// seriam duas chances de um ganhar uma validação que o outro não tem — que é
// exatamente como o limite de texto divergiria.
function opcoesPartido(selecionado) {
  const nulo = `<option value=""${!selecionado ? ' selected' : ''}>— todos da turma —</option>`;
  return nulo + partidos
    .map((p) => `<option value="${esc(p.id)}"${p.id === selecionado ? ' selected' : ''}>só ${esc(p.nome)}</option>`)
    .join('');
}

function abrirFormulario(id, ponto) {
  const caixa = document.getElementById('anot-form');
  if (!caixa) return;
  editandoId = id || null;
  const row = id ? marcadores.get(id)?.row : null;
  const textoAtual = row ? row.texto : '';

  caixa.innerHTML = `
    <div class="anot-form">
      <textarea id="anot-texto" maxlength="${LIMITE_TEXTO}"
                placeholder="ex.: Reabastecimento até as 14h">${esc(textoAtual)}</textarea>
      <div class="anot-contador" id="anot-contador"></div>
      <select id="anot-partido">${opcoesPartido(row ? row.partido_id : null)}</select>
      <div class="anot-acoes">
        <button type="button" class="anot-btn" id="anot-salvar" style="margin:0">Salvar</button>
        <button type="button" class="anot-btn" id="anot-cancelar" style="margin:0">Cancelar</button>
      </div>
      <div class="anot-erro" id="anot-erro"></div>
    </div>
  `;

  const campo = document.getElementById('anot-texto');
  const contador = document.getElementById('anot-contador');
  const atualizarContador = () => {
    const n = campo.value.trim().length;
    contador.textContent = `${n} de ${LIMITE_TEXTO}`;
    contador.classList.toggle('estourou', n > LIMITE_TEXTO);
  };
  campo.addEventListener('input', atualizarContador);
  atualizarContador();
  campo.focus();

  document.getElementById('anot-cancelar').addEventListener('click', () => {
    caixa.innerHTML = '';
    editandoId = null;
  });

  document.getElementById('anot-salvar').addEventListener('click', async () => {
    const erroEl = document.getElementById('anot-erro');
    erroEl.textContent = '';
    const partidoId = document.getElementById('anot-partido').value || null;
    const lat = row ? row.latitude : ponto?.lat;
    const lon = row ? row.longitude : ponto?.lng;

    const v = validarAnotacao({
      texto: campo.value, latitude: lat, longitude: lon, partidoId, cor: row?.cor,
    });
    if (!v.ok) { erroEl.textContent = v.erro; return; }

    if (editandoId) {
      const { error } = await atualizarAnotacao(editandoId, {
        texto: v.valor.texto, partidoId: v.valor.partidoId,
      });
      if (error) { erroEl.textContent = `Não foi possível salvar: ${error.message}`; return; }
      const estado = marcadores.get(editandoId);
      if (estado) {
        estado.row = { ...estado.row, texto: v.valor.texto, partido_id: v.valor.partidoId };
        desenhar(estado.row);
      }
    } else {
      const { data, error } = await criarAnotacao({
        turmaId: turmaIdRef, autorId: meuUserId,
        texto: v.valor.texto, latitude: v.valor.latitude, longitude: v.valor.longitude,
        partidoId: v.valor.partidoId, cor: v.valor.cor,
      });
      if (error) { erroEl.textContent = `Não foi possível salvar: ${error.message}`; return; }
      if (data) { desenhar(data); dicaDeArrastar(); }
    }

    caixa.innerHTML = '';
    editandoId = null;
    redesenharLista();
  });
}

// A dica que aparece embaixo do botão depois de criar: sem ela, uma caixa que
// nasce no meio da tela parece ter ido para o lugar errado.
function dicaDeArrastar() {
  const dica = document.getElementById('anot-dica');
  if (!dica) return;
  dica.className = 'anot-dica';
  dica.textContent = 'A caixa nasce no centro da vista — arraste-a para o ponto exato.';
  setTimeout(() => { if (dica) { dica.className = ''; dica.textContent = ''; } }, 6000);
}

// ── Ciclo de vida ────────────────────────────────────────────────────────
// `podeEditar` vem de fora (o instrutor passa true) e NÃO é uma barreira: a
// barreira é `anotacoes_escrever` (0013). Aqui ele só decide se os controles
// aparecem — oferecer um botão que o banco recusaria seria pior do que não ter.
export async function iniciarAnotacoes({ map, userId, turmaId, podeEditar = false, container }) {
  injetarEstilos();
  mapaRef = map;
  meuUserId = userId;
  podeEditarRef = !!podeEditar;
  if (container) seletorContainer = container;

  if (podeEditarRef) montarCartao();

  await definirTurmaAnotacoes(turmaId ? { id: turmaId } : null);
}

// Mesmo formato de definirTurmaCamadas/definirTurmaCalcos: recebe a LINHA da
// turma (ou null), não o uuid — a confusão entre os dois já custou dois bugs
// idênticos neste projeto (ver observarTurma em instrutor-permissoes.js).
export async function definirTurmaAnotacoes(turma) {
  const novaTurma = turma?.id || null;
  if (novaTurma === turmaIdRef && marcadores.size > 0) return;

  for (const id of [...marcadores.keys()]) apagarDoMapa(id);
  desassinarAnotacoes();
  turmaIdRef = novaTurma;
  if (!turmaIdRef) { redesenharLista(); return; }

  partidos = await buscarPartidosDaTurma(turmaIdRef);
  const linhas = await buscarAnotacoesDaTurma(turmaIdRef);
  for (const row of linhas) desenhar(row);
  redesenharLista();

  assinarAnotacoes(turmaIdRef, {
    aoMudar: (payload) => {
      const row = payload.new;
      // A remoção é LÓGICA: chega como UPDATE com `removida_em` preenchido.
      // Tratar só DELETE deixaria a anotação removida na tela de todo mundo
      // até o próximo F5 — ver o comentário de assinarAnotacoes().
      if (payload.eventType === 'DELETE') {
        if (payload.old?.id) apagarDoMapa(payload.old.id);
      } else if (row && row.removida_em) {
        apagarDoMapa(row.id);
      } else if (row) {
        desenhar(row);
      }
      redesenharLista();
    },
  });
}

export function pararAnotacoes() {
  desassinarAnotacoes();
  for (const id of [...marcadores.keys()]) apagarDoMapa(id);
  turmaIdRef = null;
  const card = document.getElementById('card-anotacoes');
  if (card) card.remove();
}
