// offline-tela.js — Etapa 8a: a TELA de "salvar uma área da carta para
// funcionar quando a rede oscilar". A matemática mora em carta-offline.js
// (puro, testável em Node); o registro das áreas mora em armazem-offline.js
// (IndexedDB); quem intercepta a rede é sw-bdgex.js (Service Worker). Este
// arquivo é a costura entre os três e o Leaflet — mesmo papel que camadas.js
// tem para kml.js/armazem-camadas.js/kml-navegador.js.
//
// SÓ O APP DO ALUNO, NÃO O PAINEL DO INSTRUTOR
// ---------------------------------------------
// Decisão explícita desta etapa (item 6 do prompt que a abriu). Duas telas do
// instrutor usam basemaps.js (situacao.js e debriefing.js), mas nenhuma das
// duas ganha este módulo:
//   - `situacao.js` mostra posição AO VIVO por Realtime — sem rede, não há
//     nada para mostrar de qualquer forma, então "carta offline" resolveria
//     só metade do problema do instrutor exatamente quando a rede falha.
//   - `debriefing.js` faz replay de um passado que já foi buscado do banco —
//     de novo, depende de rede para o dado em si, não só para a carta.
//   - As duas já têm razão registrada (Etapa 6c) para manter instâncias de
//     Leaflet SEPARADAS uma da outra e da do app do aluno — encaixar mais um
//     módulo com estado próprio (Service Worker, indicadores, lista de áreas)
//     nas duas ao mesmo tempo dobraria a superfície sem resolver o problema
//     que o instrutor tem de verdade.
// O Service Worker registrado aqui (`./sw-bdgex.js`) tem escopo em toda a
// pasta `frontend/`, então SE o mesmo navegador algum dia abrir index.html
// (registra o SW) e depois instrutor.html, os tiles já cacheados também
// seriam servidos lá — de graça, sem nenhuma linha de código a mais. Não é o
// caso de uso esperado (são aparelhos diferentes na prática), mas não faz mal
// deixar a porta aberta.
//
// SÓ O BDGEx — MOTIVO NA TELA, NÃO SÓ NO CÓDIGO
// ------------------------------------------------
// `carta-offline.js` já documenta por que (Google proíbe cache/pré-carga nos
// termos de uso E uso militar; OpenTopoMap desencoraja download em bloco; o
// BDGEx é do próprio Exército). Esta tela REPETE o motivo em texto simples
// perto do botão — é a mesma disciplina de `carregar_kml` (Etapa 7) e da
// simplificação do KML (Etapa 7): decisão que afeta o que a pessoa pode fazer
// tem que aparecer na tela, não só no comentário de quem programou.
//
// COMO A URL DE CADA TILE É GERADA, E POR QUE ISSO IMPORTA PARA O CACHE
// -------------------------------------------------------------------------
// O Cache API bate a URL da requisição AO VIVO (o <img> que o Leaflet cria ao
// desenhar o BDGEx) contra a URL usada para GRAVAR no cache. Se as duas
// forem construídas por dois caminhos de código diferentes (um "nosso",
// remontando a query string WMS à mão, e o de verdade do Leaflet), qualquer
// diferença de ordem de parâmetro, de casing ou de arredondamento faz o
// cache NUNCA bater — a área apareceria como "salva" e, offline, a carta
// continuaria em branco, do jeito mais silencioso possível de falhar.
//
// Por isso `urlDoTile()` abaixo chama `getTileUrl()` da PRÓPRIA instância
// `L.TileLayer.WMS` do BDGEx (a mesma que `index.html` usa para desenhar a
// carta ao vivo) — não existe um segundo cálculo de bbox/parâmetros WMS
// competindo com o do Leaflet. O único ajuste é preencher três campos que o
// Leaflet normalmente só preenche quando a camada está de fato NO mapa
// (`_map`, `_crs`, `wmsParams.srs`) — necessário porque o usuário pode ter
// trocado para outro mapa base (Etapa 7.1) enquanto o BDGEx continua
// existindo como objeto, só não anexado. Isso não desenha nada e não busca
// tile nenhum sozinho — só deixa a MESMA função de sempre calcular a MESMA
// URL de sempre. Ver `prepararCamadaParaUrl` para o detalhe, e o comentário
// lá para o que fazer se uma troca de versão do Leaflet (hoje fixa em 1.9.4
// via CDN em index.html) mudar esses nomes de campo — PENDÊNCIA DE TESTE AO
// VIVO desta etapa: isto só se prova certo batendo o app contra o BDGEx de
// verdade, o que não foi possível fazer daqui (mesma pendência de HTTPS
// herdada da 7.1/11).

import {
  ZOOM_MIN_OFFLINE, ZOOM_MAX_OFFLINE,
  CONCORRENCIA_MAXIMA, TAMANHO_LOTE, PAUSA_ENTRE_LOTES_MS,
  planejarDownload, avaliarCota, avaliarSuporte,
  normalizarBBox, listarTiles,
  areaQueCobre, dimensoesAproximadasKm,
} from './carta-offline.js';
import { formatarBytes } from './kml.js';
import { listarAreas, guardarArea, removerArea } from './armazem-offline.js';
import { pedirDurabilidade } from './armazem-camadas.js';
import { tornarRecolhivel } from './painel-lateral.js';

// Tem que ser o MESMO nome usado em sw-bdgex.js. Sem `import` possível entre
// os dois (o Service Worker roda num contexto de execução separado, não é um
// module comum) — é uma duplicação de UMA constante, documentada nos dois
// lados, no mesmo espírito de FAIXAS_PANE ter cópia no <script> clássico de
// index.html até a Etapa 9.
const CACHE_TILES_BDGEX = 'wartool-bdgex-tiles';

// ── Estado do módulo — um usuário por página, padrão de sempre ───────────
let mapaRef = null;
let camadaBdgexRef = null;
let meuUserId = null;
let areas = [];
let cancelarDownloadAtual = null;
let origemUltimoTile = null; // 'cache' | 'rede' | 'falha' | null (ainda sem dado)
let baixando = false;

// ── Geração de URL de tile a partir da camada Leaflet AO VIVO ────────────
// Ver o comentário grande no topo do arquivo para o porquê. Idempotente e
// sem efeito colateral (não mexe em DOM, não busca tile nenhum) — pode ser
// chamada de novo a qualquer momento, inclusive achando que já foi chamada.
function prepararCamadaParaUrl(layer, map) {
  layer._map = map;
  layer._crs = map.options.crs;
  const versao = parseFloat((layer.wmsParams && layer.wmsParams.version) || '1.1.1');
  layer._wmsVersion = versao;
  if (layer.wmsParams) {
    const chaveProjecao = versao >= 1.3 ? 'crs' : 'srs';
    layer.wmsParams[chaveProjecao] = layer._crs.code;
  }
}

function urlDoTile(layer, map, tile) {
  prepararCamadaParaUrl(layer, map);
  const coords = L.point(tile.x, tile.y);
  coords.z = tile.z;
  const url = layer.getTileUrl(coords);
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error('Não foi possível montar a URL do tile do BDGEx.');
  }
  return url;
}

// ── Service Worker ────────────────────────────────────────────────────────
async function registrarServiceWorker() {
  try {
    await navigator.serviceWorker.register('./sw-bdgex.js');
    return true;
  } catch (e) {
    console.warn('Falha ao registrar o Service Worker do mapa offline:', e);
    return false;
  }
}

// Indicador honesto #2: de onde veio a última tile do BDGEx pedida pelo
// navegador. Só atualiza quando o Service Worker de fato intercepta uma
// requisição para bdgex.eb.mil.br — ou seja, só é significativo enquanto o
// mapa base atual É o BDGEx (ver o aviso na própria tela).
function ouvirMensagensDoServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data && ev.data.tipo === 'tile-bdgex') {
      origemUltimoTile = ev.data.origem;
      atualizarIndicadorOrigem();
    }
  });
}

// ── Indicadores honestos ──────────────────────────────────────────────────
function bboxDoViewport() {
  const b = mapaRef.getBounds();
  return { sul: b.getSouth(), norte: b.getNorth(), oeste: b.getWest(), leste: b.getEast() };
}

function atualizarIndicadorArea() {
  const el = document.getElementById('offline-area-atual');
  if (!el || !mapaRef) return;
  const zoom = Math.round(mapaRef.getZoom());
  const cobre = areaQueCobre(areas, bboxDoViewport(), zoom);
  el.textContent = cobre ? 'salva — funciona sem rede aqui' : 'não salva';
  el.style.color = cobre ? '#7af57a' : '#7a9ab8';
}

function atualizarIndicadorOrigem() {
  const el = document.getElementById('offline-origem-atual');
  if (!el) return;
  const rotulos = {
    cache: 'cache (servindo do que foi salvo)',
    rede: 'rede',
    falha: 'sem carta aqui — nem rede, nem área salva',
  };
  el.textContent = origemUltimoTile ? (rotulos[origemUltimoTile] || '—') : 'aguardando a carta carregar…';
  el.style.color = origemUltimoTile === 'falha' ? '#e05252'
    : origemUltimoTile === 'cache' ? '#f5c842' : '#7a9ab8';
}

// ── Download: fila com concorrência limitada e pausa entre lotes ─────────
// Ver CONCORRENCIA_MAXIMA/TAMANHO_LOTE/PAUSA_ENTRE_LOTES_MS em
// carta-offline.js para o porquê dos números. Pula tile que já está no cache
// (sem rebaixar): é o que faz "completar uma área incompleta" e "baixar de
// novo uma área já pronta" serem a MESMA função, sem gastar rede à toa.
async function baixarTiles(tiles, layer, map, { sinal, aoProgredir }) {
  let indice = 0;
  let concluidos = 0;
  let falhouCota = false;
  const cache = await caches.open(CACHE_TILES_BDGEX);

  async function baixarUm(tile) {
    let url;
    try {
      url = urlDoTile(layer, map, tile);
    } catch (e) {
      console.warn('Tile pulado — URL inválida:', e);
      return;
    }
    try {
      const jaTem = await cache.match(url);
      if (!jaTem) {
        const resposta = await fetch(url, { mode: 'no-cors' });
        await cache.put(url, resposta);
      }
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)))) {
        falhouCota = true;
        sinal.cancelado = true;
      }
      // Falha de rede num tile específico não derruba a área inteira — ela
      // só não fecha como 'pronta' no final (ver chamador). Em campo, um
      // tile isolado falhar é normal; parar tudo por isso seria pior.
      return;
    }
    concluidos += 1;
    aoProgredir(concluidos, tiles.length);
  }

  async function trabalhador() {
    while (!sinal.cancelado) {
      const meuIndice = indice;
      indice += 1;
      if (meuIndice >= tiles.length) return;
      await baixarUm(tiles[meuIndice]);
      if (meuIndice % TAMANHO_LOTE === TAMANHO_LOTE - 1 && !sinal.cancelado) {
        await new Promise((resolve) => { setTimeout(resolve, PAUSA_ENTRE_LOTES_MS); });
      }
    }
  }

  await Promise.all(Array.from({ length: CONCORRENCIA_MAXIMA }, trabalhador));
  return { concluidos, cancelado: !!sinal.cancelado, falhouCota };
}

// Executa (ou retoma) o download de UM registro de área. `registro` já tem
// id/usuario_id/bbox/zoomMin/zoomMax/tiles/bytesEstimados preenchidos — quem
// chama decide se é novo (Etapa "baixar") ou retomado (Etapa "completar").
async function baixarArea(registro) {
  if (baixando) return; // um download por vez — evita duas filas competindo pela mesma banda
  baixando = true;
  registro.status = 'baixando';
  await guardarArea(registro);
  areas = await listarAreas(meuUserId);
  renderizarListaAreas();
  mostrarProgresso(registro);

  const tiles = listarTiles(registro.bbox, registro.zoomMin, registro.zoomMax);
  const sinal = { cancelado: false };
  cancelarDownloadAtual = () => { sinal.cancelado = true; };

  const resultado = await baixarTiles(tiles, camadaBdgexRef, mapaRef, {
    sinal,
    aoProgredir: (feitos, total) => atualizarProgresso(feitos, total),
  });

  cancelarDownloadAtual = null;
  baixando = false;
  registro.tilesBaixados = resultado.concluidos;
  registro.status = (resultado.concluidos >= tiles.length && !resultado.cancelado) ? 'pronta' : 'incompleta';
  await guardarArea(registro);
  areas = await listarAreas(meuUserId);
  renderizarListaAreas();
  atualizarIndicadorArea();
  esconderProgresso(registro, resultado);
}

// ── Apagar: só remove do Cache API o que NENHUMA outra área salva usa ────
// Não guardamos a lista de URLs de cada área (custaria milhares de strings
// no IndexedDB por área) — recomputamos na hora, a partir de bbox+zoom, com
// a MESMA função determinística que gerou os tiles no download. Isso é
// seguro porque `listarTiles`/`urlDoTile` são determinísticas: a mesma
// entrada sempre produz a mesma lista de URLs.
async function apagarArea(area) {
  // eslint-disable-next-line no-alert
  const confirmado = window.confirm(
    `Apagar a área salva (~${formatarBytes(area.bytesEstimados || 0)})? Não tem como desfazer — `
    + `para ter de novo, baixa de novo.`,
  );
  if (!confirmado) return;

  const outras = areas.filter((a) => a.id !== area.id);
  const urlsEmUso = new Set();
  for (const outra of outras) {
    for (const tile of listarTiles(outra.bbox, outra.zoomMin, outra.zoomMax)) {
      try { urlsEmUso.add(urlDoTile(camadaBdgexRef, mapaRef, tile)); } catch (_) { /* ignora tile ilegível */ }
    }
  }

  const cache = await caches.open(CACHE_TILES_BDGEX);
  for (const tile of listarTiles(area.bbox, area.zoomMin, area.zoomMax)) {
    let url;
    try { url = urlDoTile(camadaBdgexRef, mapaRef, tile); } catch (_) { continue; }
    if (!urlsEmUso.has(url)) await cache.delete(url);
  }

  await removerArea(area.id);
  areas = await listarAreas(meuUserId);
  renderizarListaAreas();
  atualizarIndicadorArea();
}

// ── Desenho do retângulo — sem plugin, dois cliques ───────────────────────
// O projeto não carrega leaflet-draw (mais uma dependência, mais CSS/toolbar
// para uma interação que dá para fazer com os eventos que o Leaflet já tem —
// mesmo espírito de marcacoes.js resolver "tocar no mapa" sem plugin nenhum).
// Primeiro clique marca o canto A; o mouse desenha uma prévia até o segundo
// clique marcar o canto B. Esc cancela a qualquer momento.
function iniciarDesenhoRetangulo(map, aoConcluir) {
  let cantoA = null;
  let retanguloPreview = null;
  const cursorOriginal = map.getContainer().style.cursor;
  map.getContainer().style.cursor = 'crosshair';
  map.dragging.disable();

  function desenharPreview(latlngB) {
    if (retanguloPreview) map.removeLayer(retanguloPreview);
    retanguloPreview = L.rectangle([cantoA, latlngB], {
      color: '#f5c842', weight: 2, fillOpacity: 0.08, dashArray: '4 4',
    }).addTo(map);
  }

  function aoMover(ev) { if (cantoA) desenharPreview(ev.latlng); }
  function aoClicar(ev) {
    if (!cantoA) { cantoA = ev.latlng; desenharPreview(ev.latlng); return; }
    finalizar(ev.latlng);
  }
  function aoTeclar(ev) { if (ev.key === 'Escape') cancelar(); }

  function pararDeOuvir() {
    map.off('click', aoClicar);
    map.off('mousemove', aoMover);
    document.removeEventListener('keydown', aoTeclar);
    map.getContainer().style.cursor = cursorOriginal;
    map.dragging.enable();
  }
  function cancelar() {
    pararDeOuvir();
    if (retanguloPreview) { map.removeLayer(retanguloPreview); retanguloPreview = null; }
    aoConcluir(null);
  }
  function finalizar(latlngB) {
    pararDeOuvir();
    const bbox = normalizarBBox(
      { lat: cantoA.lat, lon: cantoA.lng },
      { lat: latlngB.lat, lon: latlngB.lng },
    );
    aoConcluir({ bbox, retangulo: retanguloPreview });
  }

  map.on('click', aoClicar);
  map.on('mousemove', aoMover);
  document.addEventListener('keydown', aoTeclar);

  return { cancelar };
}

// ── Estilos (autocontido, como camadas.js/marcacoes.js) ──────────────────
let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados) return;
  estilosInjetados = true;
  const style = document.createElement('style');
  style.textContent = `
    /* O card herda .panel-card quando está no app do aluno (index.html), mas
       essa classe não existe no painel do instrutor (Etapa 8a, correção
       pós-entrega: passou a servir também a aba "Situação atual") — mesma
       situação de #card-camadas em camadas.js, resolvida do mesmo jeito: o
       visual base vem daqui, para o módulo ficar apresentável nas duas telas
       sem depender do CSS de nenhuma delas. */
    #card-offline {
      background:rgba(13,27,42,.92); border:1px solid #2a4a6b;
      border-radius:6px; padding:10px 14px; font-size:12px; min-width:170px;
    }
    .offline-linha { margin-bottom:8px; line-height:1.5; }
    .offline-aviso { color:#f5c842; font-size:11px; margin-bottom:8px; }
    .offline-explicacao { color:#7a9ab8; font-size:11px; margin-bottom:8px; }
    .offline-indicadores { display:flex; flex-direction:column; gap:2px; margin-bottom:10px; font-size:11px; }
    .offline-btn {
      background:#1a3a5c; color:#a8c8e8; border:1px solid #2a5a8c; border-radius:4px;
      padding:5px 10px; font-size:12px; cursor:pointer; font-family:inherit; width:100%;
      margin-bottom:6px;
    }
    .offline-btn:hover { background:#254a72; }
    .offline-btn:disabled { opacity:.5; cursor:not-allowed; }
    .offline-btn-secundario { background:transparent; border:1px solid #4a6a8a; color:#7a9ab8; }
    .offline-btn-perigo { background:#3a1a1a; border-color:#6c2a2a; color:#f57a7a; }
    .offline-plano { border:1px solid #2a4a6b; border-radius:4px; padding:8px; margin-bottom:8px; font-size:11px; }
    .offline-plano-erro { color:#f57a7a; }
    .offline-slider-linha { display:flex; align-items:center; gap:6px; margin:6px 0; font-size:11px; }
    .offline-slider-linha input[type=range] { flex:1; }
    .offline-progresso-barra { background:#0d1b2a; border:1px solid #2a4a6b; border-radius:4px; height:8px; overflow:hidden; margin:6px 0; }
    .offline-progresso-preenchido { background:#4caf50; height:100%; width:0%; transition:width .15s ease; }
    .offline-area-item { border-top:1px solid #2a4a6b; padding-top:6px; margin-top:6px; font-size:11px; }
    .offline-area-titulo { display:flex; justify-content:space-between; align-items:center; }
    .offline-area-status { padding:1px 6px; border-radius:3px; font-size:10px; }
    .offline-status-pronta { background:#1a3a1a; color:#7af57a; }
    .offline-status-incompleta { background:#3a3a1a; color:#f5e07a; }
    .offline-status-baixando { background:#1a3a5c; color:#7ab8f5; }
    .offline-area-botoes { display:flex; gap:6px; margin-top:4px; }
    .offline-area-botoes button { flex:1; font-size:10px; padding:3px 6px; }
  `;
  document.head.appendChild(style);
}

// ── Montagem do card ───────────────────────────────────────────────────────
function montarCartao(seletorContainer) {
  const existente = document.getElementById('card-offline');
  if (existente) return existente;
  const painel = document.querySelector(seletorContainer);
  if (!painel) return null;

  const cartao = document.createElement('div');
  cartao.className = 'panel-card';
  cartao.id = 'card-offline';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Mapa offline';
  cartao.appendChild(titulo);
  painel.appendChild(cartao);
  return cartao;
}

function corpoDoCartao() {
  let corpo = document.getElementById('offline-corpo');
  if (!corpo) {
    corpo = document.createElement('div');
    corpo.id = 'offline-corpo';
    document.getElementById('card-offline').appendChild(corpo);
  }
  return corpo;
}

function mostrarIndisponivel(motivo) {
  const corpo = corpoDoCartao();
  corpo.textContent = '';
  const p = document.createElement('p');
  p.className = 'offline-aviso';
  p.textContent = motivo;
  corpo.appendChild(p);
}

function montarInterfacePrincipal() {
  const corpo = corpoDoCartao();
  corpo.textContent = '';

  const explicacao = document.createElement('p');
  explicacao.className = 'offline-explicacao';
  explicacao.textContent = 'Só o BDGEx pode ser salvo offline: é a carta do próprio Exército. As demais '
    + '(Google, OpenTopoMap, Esri, CartoDB) têm termos de uso que proíbem ou desencorajam guardar tiles em massa.';
  corpo.appendChild(explicacao);

  const indicadores = document.createElement('div');
  indicadores.className = 'offline-indicadores';
  const linhaArea = document.createElement('div');
  linhaArea.append('Área atual: ', Object.assign(document.createElement('span'), { id: 'offline-area-atual', textContent: 'verificando…' }));
  const linhaOrigem = document.createElement('div');
  linhaOrigem.append('Carta vindo de: ', Object.assign(document.createElement('span'), { id: 'offline-origem-atual', textContent: 'aguardando a carta carregar…' }));
  const notaOrigem = document.createElement('div');
  notaOrigem.style.color = '#4a6a8a';
  notaOrigem.style.fontSize = '10px';
  notaOrigem.textContent = '(só é confiável enquanto o mapa base atual é o BDGEx)';
  indicadores.append(linhaArea, linhaOrigem, notaOrigem);
  corpo.appendChild(indicadores);

  const botaoDesenhar = document.createElement('button');
  botaoDesenhar.type = 'button';
  botaoDesenhar.className = 'offline-btn';
  botaoDesenhar.id = 'offline-btn-desenhar';
  botaoDesenhar.textContent = 'Desenhar área para salvar';
  botaoDesenhar.addEventListener('click', aoClicarDesenhar);
  corpo.appendChild(botaoDesenhar);

  const areaPlano = document.createElement('div');
  areaPlano.id = 'offline-plano-area';
  corpo.appendChild(areaPlano);

  const areaProgresso = document.createElement('div');
  areaProgresso.id = 'offline-progresso-area';
  corpo.appendChild(areaProgresso);

  const listaTitulo = document.createElement('div');
  listaTitulo.className = 'offline-linha';
  listaTitulo.style.color = '#7a9ab8';
  listaTitulo.style.fontSize = '11px';
  listaTitulo.textContent = 'Áreas salvas:';
  corpo.appendChild(listaTitulo);

  const lista = document.createElement('div');
  lista.id = 'offline-lista-areas';
  corpo.appendChild(lista);
}

// ── Fluxo: desenhar -> planejar -> confirmar -> baixar ────────────────────
function aoClicarDesenhar() {
  const botao = document.getElementById('offline-btn-desenhar');
  botao.disabled = true;
  botao.textContent = 'Clique dois cantos no mapa (Esc cancela)…';

  iniciarDesenhoRetangulo(mapaRef, (resultado) => {
    botao.disabled = false;
    botao.textContent = 'Desenhar área para salvar';
    if (!resultado) return; // cancelado (Esc)
    mostrarPainelDePlano(resultado.bbox, resultado.retangulo);
  });
}

function mostrarPainelDePlano(bbox, retanguloDesenhado) {
  const area = document.getElementById('offline-plano-area');
  area.textContent = '';
  if (!bbox) {
    const erro = document.createElement('p');
    erro.className = 'offline-plano offline-plano-erro';
    erro.textContent = 'Retângulo inválido — tente de novo.';
    area.appendChild(erro);
    if (retanguloDesenhado) mapaRef.removeLayer(retanguloDesenhado);
    return;
  }

  const caixa = document.createElement('div');
  caixa.className = 'offline-plano';

  let zoomMaxEscolhido = ZOOM_MAX_OFFLINE;

  const linhaSlider = document.createElement('div');
  linhaSlider.className = 'offline-slider-linha';
  const rotuloSlider = document.createElement('span');
  rotuloSlider.textContent = `Zoom ${ZOOM_MIN_OFFLINE}–`;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(ZOOM_MIN_OFFLINE);
  slider.max = String(ZOOM_MAX_OFFLINE);
  slider.value = String(zoomMaxEscolhido);
  const valorSlider = document.createElement('span');
  valorSlider.textContent = String(zoomMaxEscolhido);
  linhaSlider.append(rotuloSlider, slider, valorSlider);
  caixa.appendChild(linhaSlider);

  const resumo = document.createElement('div');
  caixa.appendChild(resumo);

  const botoes = document.createElement('div');
  botoes.className = 'offline-area-botoes';
  const btnConfirmar = document.createElement('button');
  btnConfirmar.type = 'button';
  btnConfirmar.className = 'offline-btn';
  btnConfirmar.textContent = 'Baixar';
  const btnCancelar = document.createElement('button');
  btnCancelar.type = 'button';
  btnCancelar.className = 'offline-btn offline-btn-secundario';
  btnCancelar.textContent = 'Cancelar';
  botoes.append(btnConfirmar, btnCancelar);
  caixa.appendChild(botoes);

  area.appendChild(caixa);

  let planoAtual = null;
  async function recalcular() {
    zoomMaxEscolhido = Number(slider.value);
    valorSlider.textContent = String(zoomMaxEscolhido);
    const dim = dimensoesAproximadasKm(bbox);
    const plano = planejarDownload({
      bbox, zoomMin: ZOOM_MIN_OFFLINE, zoomMax: zoomMaxEscolhido, areasJaSalvas: areas.length,
    });
    resumo.textContent = '';
    const linhaDim = document.createElement('div');
    linhaDim.textContent = dim ? `Área: ~${dim.larguraKm.toFixed(1)} × ${dim.alturaKm.toFixed(1)} km` : '';
    resumo.appendChild(linhaDim);

    if (!plano.ok) {
      planoAtual = null;
      btnConfirmar.disabled = true;
      const erro = document.createElement('div');
      erro.className = 'offline-plano-erro';
      erro.textContent = plano.motivo;
      resumo.appendChild(erro);
      return;
    }

    let cotaInfo = {};
    try {
      if (navigator.storage && navigator.storage.estimate) cotaInfo = await navigator.storage.estimate();
    } catch (_) { /* segue sem — avaliarCota trata como incerto */ }
    const cota = avaliarCota({
      bytesEstimados: plano.bytesEstimados, uso: cotaInfo.usage || 0, cota: cotaInfo.quota || 0,
    });

    const linhaTiles = document.createElement('div');
    linhaTiles.textContent = `${plano.tiles.toLocaleString('pt-BR')} tiles, `
      + `~${formatarBytes(plano.bytesEstimados)} estimados`;
    resumo.appendChild(linhaTiles);

    const notaOpaco = document.createElement('div');
    notaOpaco.style.color = '#4a6a8a';
    notaOpaco.style.fontSize = '10px';
    notaOpaco.textContent = 'O navegador costuma reportar mais espaço ocupado do que isso de verdade '
      + '(o BDGEx é servido sem CORS, e a resposta "opaca" resultante recebe um acréscimo artificial de '
      + 'armazenamento) — não é sinal de erro.';
    resumo.appendChild(notaOpaco);

    if (!cota.ok) {
      planoAtual = null;
      btnConfirmar.disabled = true;
      const erroCota = document.createElement('div');
      erroCota.className = 'offline-plano-erro';
      erroCota.textContent = cota.motivo;
      resumo.appendChild(erroCota);
      return;
    }
    if (cota.incerto) {
      const avisoCota = document.createElement('div');
      avisoCota.style.color = '#f5c842';
      avisoCota.style.fontSize = '10px';
      avisoCota.textContent = 'Não foi possível checar o espaço livre do navegador — a estimativa acima '
        + 'não considera isso.';
      resumo.appendChild(avisoCota);
    }

    planoAtual = { bbox, zoomMin: ZOOM_MIN_OFFLINE, zoomMax: zoomMaxEscolhido, plano };
    btnConfirmar.disabled = false;
  }

  slider.addEventListener('input', recalcular);
  recalcular();

  function limparPlano() {
    area.textContent = '';
    if (retanguloDesenhado) mapaRef.removeLayer(retanguloDesenhado);
  }

  btnCancelar.addEventListener('click', limparPlano);
  btnConfirmar.addEventListener('click', async () => {
    if (!planoAtual) return;
    limparPlano();
    await pedirDurabilidade();
    const id = `area-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const registro = {
      id,
      usuario_id: meuUserId,
      bbox: planoAtual.bbox,
      zoomMin: planoAtual.zoomMin,
      zoomMax: planoAtual.zoomMax,
      tiles: planoAtual.plano.tiles,
      bytesEstimados: planoAtual.plano.bytesEstimados,
      tilesBaixados: 0,
      status: 'baixando',
      criado_em: Date.now(),
    };
    await baixarArea(registro);
  });
}

// ── Progresso ──────────────────────────────────────────────────────────────
function mostrarProgresso(registro) {
  const area = document.getElementById('offline-progresso-area');
  if (!area) return;
  area.textContent = '';
  const caixa = document.createElement('div');
  caixa.className = 'offline-plano';
  caixa.id = 'offline-progresso-caixa';

  const texto = document.createElement('div');
  texto.id = 'offline-progresso-texto';
  texto.textContent = `Baixando: 0 de ${registro.tiles.toLocaleString('pt-BR')} tiles…`;
  caixa.appendChild(texto);

  const barra = document.createElement('div');
  barra.className = 'offline-progresso-barra';
  const preenchido = document.createElement('div');
  preenchido.className = 'offline-progresso-preenchido';
  preenchido.id = 'offline-progresso-preenchido';
  barra.appendChild(preenchido);
  caixa.appendChild(barra);

  const btnCancelar = document.createElement('button');
  btnCancelar.type = 'button';
  btnCancelar.className = 'offline-btn offline-btn-perigo';
  btnCancelar.textContent = 'Cancelar download';
  btnCancelar.addEventListener('click', () => {
    if (cancelarDownloadAtual) cancelarDownloadAtual();
    btnCancelar.disabled = true;
    btnCancelar.textContent = 'Cancelando…';
  });
  caixa.appendChild(btnCancelar);

  area.appendChild(caixa);
}

function atualizarProgresso(feitos, total) {
  const texto = document.getElementById('offline-progresso-texto');
  const preenchido = document.getElementById('offline-progresso-preenchido');
  if (texto) texto.textContent = `Baixando: ${feitos.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} tiles…`;
  if (preenchido) preenchido.style.width = `${total > 0 ? Math.round((feitos / total) * 100) : 0}%`;
}

function esconderProgresso(registro, resultado) {
  const area = document.getElementById('offline-progresso-area');
  if (!area) return;
  area.textContent = '';
  if (registro.status === 'pronta') return; // sem residual — a lista de áreas já mostra "pronta"

  const aviso = document.createElement('p');
  aviso.className = 'offline-aviso';
  if (resultado.falhouCota) {
    aviso.textContent = `Parou por falta de espaço: ${registro.tilesBaixados.toLocaleString('pt-BR')} de `
      + `${registro.tiles.toLocaleString('pt-BR')} tiles baixados. A área ficou marcada como incompleta — `
      + `apague algo para liberar espaço e toque em "Completar".`;
  } else if (resultado.cancelado) {
    aviso.textContent = `Download cancelado: ${registro.tilesBaixados.toLocaleString('pt-BR')} de `
      + `${registro.tiles.toLocaleString('pt-BR')} tiles ficaram salvos. Toque em "Completar" quando quiser `
      + `terminar.`;
  } else {
    aviso.textContent = `Alguns tiles falharam (${registro.tilesBaixados.toLocaleString('pt-BR')} de `
      + `${registro.tiles.toLocaleString('pt-BR')}). Toque em "Completar" para tentar de novo os que faltam.`;
  }
  area.appendChild(aviso);
}

// ── Lista de áreas salvas ─────────────────────────────────────────────────
const ROTULO_STATUS = { pronta: 'pronta', incompleta: 'incompleta', baixando: 'baixando…' };
const CLASSE_STATUS = { pronta: 'offline-status-pronta', incompleta: 'offline-status-incompleta', baixando: 'offline-status-baixando' };

function renderizarListaAreas() {
  const lista = document.getElementById('offline-lista-areas');
  if (!lista) return;
  lista.textContent = '';

  if (areas.length === 0) {
    const vazio = document.createElement('div');
    vazio.style.color = '#4a6a8a';
    vazio.style.fontSize = '11px';
    vazio.textContent = 'nenhuma ainda';
    lista.appendChild(vazio);
    return;
  }

  for (const area of areas) {
    const item = document.createElement('div');
    item.className = 'offline-area-item';

    const dim = dimensoesAproximadasKm(area.bbox);
    const titulo = document.createElement('div');
    titulo.className = 'offline-area-titulo';
    const rotulo = document.createElement('span');
    rotulo.textContent = dim ? `${dim.larguraKm.toFixed(1)}×${dim.alturaKm.toFixed(1)} km, z${area.zoomMin}–${area.zoomMax}` : 'área salva';
    const status = document.createElement('span');
    status.className = `offline-area-status ${CLASSE_STATUS[area.status] || ''}`;
    status.textContent = ROTULO_STATUS[area.status] || area.status;
    titulo.append(rotulo, status);
    item.appendChild(titulo);

    const detalhe = document.createElement('div');
    detalhe.style.color = '#7a9ab8';
    const tilesTexto = area.status === 'pronta'
      ? `${(area.tiles || 0).toLocaleString('pt-BR')} tiles, ~${formatarBytes(area.bytesEstimados || 0)}`
      : `${(area.tilesBaixados || 0).toLocaleString('pt-BR')} de ${(area.tiles || 0).toLocaleString('pt-BR')} tiles`;
    detalhe.textContent = tilesTexto;
    item.appendChild(detalhe);

    const botoes = document.createElement('div');
    botoes.className = 'offline-area-botoes';

    if (area.status === 'incompleta') {
      const btnCompletar = document.createElement('button');
      btnCompletar.type = 'button';
      btnCompletar.className = 'offline-btn';
      btnCompletar.textContent = 'Completar';
      btnCompletar.disabled = baixando;
      btnCompletar.addEventListener('click', () => baixarArea(area));
      botoes.appendChild(btnCompletar);
    }

    const btnApagar = document.createElement('button');
    btnApagar.type = 'button';
    btnApagar.className = 'offline-btn offline-btn-perigo';
    btnApagar.textContent = 'Apagar';
    btnApagar.disabled = area.status === 'baixando';
    btnApagar.addEventListener('click', () => apagarArea(area));
    botoes.appendChild(btnApagar);

    item.appendChild(botoes);
    lista.appendChild(item);
  }
}

// ── Ponto de entrada ───────────────────────────────────────────────────────
// map: instância do Leaflet (padrão de sempre — gps.js, colegas.js, etc).
// camadaBdgex: a MESMA instância de L.TileLayer.WMS que index.html usa para
//   desenhar o BDGEx ao vivo (BASEMAPS.bdgex) — não uma cópia.
// userId: chave de escopo do IndexedDB (armazem-offline.js), mesmo papel que
//   em armazem-camadas.js.
export async function iniciarOfflineMapa({
  map, camadaBdgex, userId, seletorContainer = '#side-panel',
} = {}) {
  if (!map || !camadaBdgex || !userId) return;
  mapaRef = map;
  camadaBdgexRef = camadaBdgex;
  meuUserId = userId;

  injetarEstilos();
  const cartao = montarCartao(seletorContainer);
  if (!cartao) return;
  tornarRecolhivel(cartao);

  const suporte = avaliarSuporte({
    isSecureContext: !!window.isSecureContext,
    temServiceWorker: 'serviceWorker' in navigator,
    temCaches: typeof caches !== 'undefined',
  });
  if (!suporte.ok) {
    mostrarIndisponivel(suporte.motivo);
    return;
  }

  montarInterfacePrincipal();

  const registrado = await registrarServiceWorker();
  if (!registrado) {
    mostrarIndisponivel('Não foi possível ativar o mapa offline neste navegador — o Service Worker falhou '
      + 'ao registrar. As áreas que já estavam salvas continuam funcionando.');
    // Segue mesmo assim: a lista de áreas e os indicadores ainda fazem
    // sentido mostrar (podem existir áreas de uma sessão anterior), só não
    // dá para BAIXAR nova área sem o Service Worker.
  }
  ouvirMensagensDoServiceWorker();

  areas = await listarAreas(userId);
  renderizarListaAreas();

  map.on('moveend zoomend', atualizarIndicadorArea);
  atualizarIndicadorArea();
  atualizarIndicadorOrigem();
}
