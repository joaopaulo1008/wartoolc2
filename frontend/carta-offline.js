// carta-offline.js — Etapa 8a do roadmap: a PARTE PURA de "salvar uma área da
// carta para funcionar quando a rede oscilar".
//
// Mesma separação de sempre entre regra e tela (rastro.js/debriefing.js,
// kml.js/camadas.js, dispersar-avatares.js/colegas.js+situacao.js): aqui mora
// só matemática — nenhum DOM, nenhum Leaflet, nenhum Service Worker, nenhum
// `fetch`, nenhum `navigator`, nenhum `window`. É isso que torna esta parte
// testável em Node (frontend/carta-offline.teste.mjs). Quem fala com o
// Service Worker, com o Cache API e com o Leaflet é `frontend/offline-tela.js`
// — este arquivo só decide SE cabe, quantos tiles são e o que fazer quando não
// cabe.
//
// POR QUE ISTO PRECISA DE TESTE, NO MESMO ESPÍRITO DA 6b/7
// ----------------------------------------------------------
// Um teto errado aqui não aparece como bug visível — aparece como 60 celulares
// pedindo dezenas de milhares de tiles ao mesmo tempo para o servidor da
// Diretoria de Serviço Geográfico, sem ninguém perceber até o serviço cair
// para todo mundo. A contagem de tiles cresce 4× a cada nível de zoom (cada
// tile vira 4 no zoom seguinte), o que significa que um retângulo inocente em
// zoom alto é uma ordem de grandeza maior do que parece olhando o mapa — é
// exatamente o tipo de conta que precisa de código testado, não da esperança
// de que a área pedida venha pequena.

import { formatarBytes } from './kml.js';

// ── Só o BDGEx é elegível para download em massa ─────────────────────────
//
// Decisão registrada em CLAUDE.md desde a Etapa 0 e reafirmada na 7.1: os
// termos padrão do Google Maps proíbem uso militar/de defesa E proíbem
// EXPLICITAMENTE cache e pré-carga de tiles — baixar um retângulo inteiro de
// `google_sat`/`google_hybrid` violaria os dois ao mesmo tempo. O OpenTopoMap
// (comunidade, sem contrato) desencoraja download em bloco na própria página
// de uso aceitável. O Esri World_Imagery (usado no basemap `hybrid`) e o
// CartoDB (`light`) são serviços gratuitos de terceiro sem uma licença clara
// que autorize armazenamento offline em massa para este uso.
//
// O BDGEx é servido pelo próprio Exército Brasileiro para uso do Exército
// Brasileiro — é o único dos seis mapas onde "baixar a carta para usar em
// instrução militar offline" não é uma zona cinzenta de termos de uso de
// terceiro. É também, coerentemente, a carta que a Etapa 7.1 já colocou em
// primeiro lugar e como padrão do app, por ser "a carta que a tropa lê no
// papel". A tela mostra este motivo, não só o código — ver offline-tela.js.
export const BASEMAP_OFFLINE = 'bdgex';

// ── Faixa de zoom permitida para salvar ───────────────────────────────────
//
// NÃO é a mesma faixa em que o BDGEx é exibido ao vivo (maxZoom 18 em
// basemaps.js). Duas razões para um teto mais baixo aqui:
//
//   1. VOLUME. A contagem de tiles cresce 4× por nível — ver o comentário de
//      LIMITE_TILES_POR_AREA abaixo para os números reais. Liberar até 18
//      multiplicaria por 64 o pior caso em relação a 16.
//   2. O `mapcache` do BDGEx não é um WMS completo: ele serve só as grades de
//      tiles que TEM em cache (ver basemaps.js, comentário do CRS). Não há
//      como confirmar daqui, sem acesso ao serviço, até que zoom essa grade
//      é densa de verdade — arriscar zoom 17/18 é arriscar gastar cota e
//      tempo de download em tiles que voltam em branco mesmo online. 16 é o
//      corte por precaução; se o teste ao vivo (pendência desta etapa)
//      mostrar que o cache do serviço é denso até mais longe, este número
//      sobe numa mudança de configuração, não de dado.
//
// O piso (12) existe para não deixar alguém pedir "o Brasil inteiro em zoom
// baixo" pensando que está economizando: abaixo de 12 a carta perde o detalhe
// que justifica ter offline (é escala de visão de país, não de exercício), e
// mesmo assim os tiles de zoom baixo já entram de graça dentro da faixa
// escolhida (ver a tabela de exemplo abaixo).
export const ZOOM_MIN_OFFLINE = 12;
export const ZOOM_MAX_OFFLINE = 16;

// ── Teto de tiles por área salva ──────────────────────────────────────────
//
// Números reais (bbox quadrado em torno de -22° de latitude — o centro padrão
// do mapa —, faixa de zoom 12–16 inteira, a mesma que a tela oferece):
//   2×2 km   ->      ~13 tiles
//   5×5 km   ->      ~50 tiles
//   10×10 km ->     ~491 tiles
//   20×20 km ->    ~1772 tiles
//   30×30 km ->   ~3900+ tiles (RECUSADO pelo teto abaixo)
//
// 2000 cobre confortavelmente uma área de operações de companhia/batalhão
// (10–20 km de lado) na faixa de zoom inteira, e barra uma área de tamanho de
// região/estado antes de gerar a requisição — o retângulo é rejeitado ANTES
// de listar um tile sequer, com a conta explicada na tela (mesma postura de
// `LIMITE_FEICOES` em kml.js: dizer o que fazer, não travar depois).
//
// Em bytes, no pior caso (2000 tiles × TAMANHO_TILE_ESTIMADO_BYTES): ~30 MB.
// Isso é uma ação deliberada de UM usuário sobre os PRÓPRIOS dados móveis —
// diferente do teto de 2 MB de `LIMITE_BYTES_COMPARTILHADO` em kml.js, que
// existe para não estourar o egress do Supabase quando 60 alunos baixam o
// MESMO arquivo. Aqui não há egress nosso: o tráfego é direto para o
// bdgex.eb.mil.br.
export const LIMITE_TILES_POR_AREA = 2000;

// ── Tamanho estimado por tile ──────────────────────────────────────────────
//
// NÃO É MEDIDO — é um palpite documentado. O BDGEx serve PNG (`format:
// 'image/png'`) de carta topográfica: fundo majoritariamente de poucas cores
// (curvas de nível, hidrografia, poucas classes de uso do solo), que PNG
// comprime bem — não é imagem de satélite. 15 kB por tile de 256×256 é a
// mesma ordem de grandeza de outros serviços de carta topográfica (o
// OpenTopoMap, mesma família de conteúdo, fica tipicamente entre 8–25 kB por
// tile). NÃO SE SABE o valor real até medir no serviço de verdade — pendência
// de teste ao vivo desta etapa, junto com a de HTTPS herdada da 7.1/11. A
// tela usa este número só para a ESTIMATIVA mostrada antes de baixar; o que
// decide quanto foi de fato usado depois é `navigator.storage.estimate()`, e
// mesmo esse número vem inflado para resposta opaca (ver offline-tela.js).
export const TAMANHO_TILE_ESTIMADO_BYTES = 15 * 1024;

// ── Quantas áreas cabem na lista ──────────────────────────────────────────
//
// Mesmo raciocínio de LIMITE_GUARDADOS em kml.js (8 arquivos locais): o teto
// não é sobre cota (que é generosa), é sobre a lista continuar navegável e o
// pior caso de espaço total continuar sensato. 6 áreas × teto de ~30 MB cada
// = ~180 MB no pior caso absoluto — razoável para um celular de exercício —
// sem precisar de um segundo número de "bytes totais" para justificar por
// cima do teto por área.
export const LIMITE_AREAS_SALVAS = 6;

// ── Ser educado com o servidor: concorrência e pausa ──────────────────────
//
// 60 celulares desenhando a mesma região e confirmando ao mesmo tempo (ex.:
// instrutor manda "baixem a carta da área de operações antes de sair") é uma
// negação de serviço involuntária contra a Diretoria de Serviço Geográfico se
// cada um deles abrir dezenas de conexões simultâneas. CONCORRENCIA_MAXIMA
// limita quantas requisições cada celular mantém abertas ao mesmo tempo;
// PAUSA_ENTRE_LOTES_MS dá um respiro ao servidor (e à própria rede do
// celular, que no 4G de campo não aguenta muitas conexões paralelas de
// qualquer forma) a cada lote de TAMANHO_LOTE tiles concluídos.
export const CONCORRENCIA_MAXIMA = 4;
export const TAMANHO_LOTE = 20;
export const PAUSA_ENTRE_LOTES_MS = 300;

// ── Matemática de tile (slippy map / Web Mercator, EPSG:3857) ────────────
//
// O BDGEx multiescala é servido em Web Mercator (ver o comentário do CRS em
// basemaps.js) e o Leaflet grade a camada WMS exatamente como grade uma
// camada XYZ comum — por isso a fórmula padrão de tile do OSM/Google vale
// aqui, mesmo o BDGEx sendo WMS e não XYZ puro. Quem gera a URL de cada tile
// de verdade é `offline-tela.js`, chamando `getTileUrl()` da PRÓPRIA camada
// Leaflet ao vivo (não uma cópia da lógica de montagem de URL aqui) — é assim
// que a etapa garante que o tile baixado e o tile pedido ao vivo depois são
// EXATAMENTE a mesma requisição (mesma ordem de parâmetros WMS, mesmo bbox),
// que é o que faz o Service Worker achar o tile no cache.
export function lonParaTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latParaTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z,
  );
}

// Normaliza dois cantos quaisquer (o usuário pode arrastar em qualquer
// direção) num bbox com os quatro lados no lugar certo. Devolve null se algum
// dos dois pontos não é uma coordenada geográfica válida.
export function normalizarBBox(a, b) {
  if (!a || !b) return null;
  const lats = [Number(a.lat), Number(b.lat)];
  const lons = [Number(a.lon), Number(b.lon)];
  if (lats.some((v) => !Number.isFinite(v) || v < -85 || v > 85)) return null;
  if (lons.some((v) => !Number.isFinite(v) || v < -180 || v > 180)) return null;
  return {
    sul: Math.min(...lats),
    norte: Math.max(...lats),
    oeste: Math.min(...lons),
    leste: Math.max(...lons),
  };
}

function bboxValido(bbox) {
  return !!bbox
    && Number.isFinite(bbox.sul) && Number.isFinite(bbox.norte)
    && Number.isFinite(bbox.oeste) && Number.isFinite(bbox.leste)
    && bbox.sul < bbox.norte && bbox.oeste < bbox.leste;
}

// Quantos tiles um bbox ocupa NUM zoom só.
export function contarTilesPorZoom(bbox, z) {
  if (!bboxValido(bbox)) return 0;
  const x1 = lonParaTileX(bbox.oeste, z);
  const x2 = lonParaTileX(bbox.leste, z);
  // Y cresce para o SUL no esquema de tile — norte tem Y menor.
  const y1 = latParaTileY(bbox.norte, z);
  const y2 = latParaTileY(bbox.sul, z);
  return (Math.abs(x2 - x1) + 1) * (Math.abs(y2 - y1) + 1);
}

// Soma nos níveis de zoom [zoomMin, zoomMax]. Separado de `listarTiles` de
// propósito: contar é O(níveis de zoom), listar é O(quantidade de tiles) —
// para um bbox grande demais, contar é barato e listar seria o próprio
// estrago que a etapa quer evitar. `planejarDownload` sempre conta primeiro.
export function contarTiles(bbox, zoomMin, zoomMax) {
  if (!bboxValido(bbox) || !Number.isFinite(zoomMin) || !Number.isFinite(zoomMax)) return 0;
  let total = 0;
  for (let z = zoomMin; z <= zoomMax; z++) total += contarTilesPorZoom(bbox, z);
  return total;
}

// Lista {z,x,y} de cada tile. SÓ é chamada depois que `planejarDownload`
// confirma que a contagem cabe no teto — nunca antes, para não materializar
// um array de dezenas de milhares de entradas à toa.
export function listarTiles(bbox, zoomMin, zoomMax) {
  if (!bboxValido(bbox)) return [];
  const tiles = [];
  for (let z = zoomMin; z <= zoomMax; z++) {
    const x1 = lonParaTileX(bbox.oeste, z);
    const x2 = lonParaTileX(bbox.leste, z);
    const y1 = latParaTileY(bbox.norte, z);
    const y2 = latParaTileY(bbox.sul, z);
    const xMin = Math.min(x1, x2); const xMax = Math.max(x1, x2);
    const yMin = Math.min(y1, y2); const yMax = Math.max(y1, y2);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) tiles.push({ z, x, y });
    }
  }
  return tiles;
}

export function estimarBytes(quantidadeTiles) {
  return (Number(quantidadeTiles) || 0) * TAMANHO_TILE_ESTIMADO_BYTES;
}

// ── A decisão: cabe, ou não cabe e por quê ────────────────────────────────
//
// Ponto único de "dá para baixar esta área?", no mesmo formato de
// `planejarCarga`/`planejarGuardar` em kml.js — devolve sempre o mesmo
// formato, e offline-tela.js só obedece:
//
//   { ok: true, tiles, bytesEstimados }
//   { ok: false, motivo }
//
// NÃO decide sobre cota do navegador — isso é `avaliarCota`, chamada depois,
// já que cota é uma pergunta assíncrona (`navigator.storage.estimate()`) e
// esta função é síncrona/pura de propósito.
export function planejarDownload({ bbox, zoomMin, zoomMax, areasJaSalvas = 0 } = {}) {
  if (!bboxValido(bbox)) {
    return { ok: false, motivo: 'Desenhe um retângulo válido no mapa antes de continuar.' };
  }
  const zMin = Number(zoomMin);
  const zMax = Number(zoomMax);
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax) || zMin > zMax) {
    return { ok: false, motivo: 'Faixa de zoom inválida.' };
  }
  if (zMin < ZOOM_MIN_OFFLINE || zMax > ZOOM_MAX_OFFLINE) {
    return {
      ok: false,
      motivo: `O zoom para salvar offline vai de ${ZOOM_MIN_OFFLINE} a ${ZOOM_MAX_OFFLINE}. `
            + `Ajuste a faixa escolhida (${zMin}–${zMax}).`,
    };
  }
  if (areasJaSalvas >= LIMITE_AREAS_SALVAS) {
    return {
      ok: false,
      motivo: `Já há ${LIMITE_AREAS_SALVAS} áreas salvas, que é o máximo. `
            + `Apague uma da lista para salvar esta.`,
    };
  }

  const tiles = contarTiles(bbox, zMin, zMax);
  if (tiles === 0) {
    return { ok: false, motivo: 'A área desenhada é vazia demais — aumente um pouco o retângulo.' };
  }
  if (tiles > LIMITE_TILES_POR_AREA) {
    return {
      ok: false,
      motivo: `Esta área pediria ${tiles.toLocaleString('pt-BR')} tiles, e o limite por área é `
            + `${LIMITE_TILES_POR_AREA.toLocaleString('pt-BR')} — acima disso vira uma carga alta demais `
            + `para o servidor da carta. Desenhe uma área menor ou reduza o zoom máximo.`,
    };
  }

  return { ok: true, tiles, bytesEstimados: estimarBytes(tiles) };
}

// ── Cota do navegador ──────────────────────────────────────────────────────
//
// Pura por design: recebe os números já lidos de `navigator.storage.estimate()`
// (que é assíncrono) em vez de chamar a API — quem chama é offline-tela.js.
// MARGEM_COTA = fração da cota TOTAL que fica de reserva, não só para este
// download: o navegador usa a mesma cota para o IndexedDB de
// armazem-camadas.js (calcos do aluno) e para o resto do que o domínio
// guarda. 10% é uma folga pequena mas deliberada — sem ela, uma conta exata
// no limite falharia no meio por qualquer coisa que crescer um byte a mais
// durante o download.
const MARGEM_COTA = 0.1;

export function avaliarCota({ bytesEstimados, uso = 0, cota = 0 }) {
  if (!Number.isFinite(cota) || cota <= 0) {
    // navigator.storage.estimate() indisponível ou devolveu lixo — não dá
    // para saber, então não BLOQUEIA (postura permissiva de sempre no
    // projeto: falha ao checar não é a mesma coisa que "não cabe"), mas avisa.
    return { ok: true, incerto: true };
  }
  const disponivel = cota - uso;
  const comMargem = disponivel * (1 - MARGEM_COTA);
  if (bytesEstimados > comMargem) {
    return {
      ok: false,
      motivo: `A estimativa (${formatarBytes(bytesEstimados)}) não cabe com folga no espaço livre `
            + `do navegador (${formatarBytes(Math.max(disponivel, 0))}). Apague uma área salva ou `
            + `libere espaço no aparelho antes de tentar de novo.`,
    };
  }
  return { ok: true, incerto: false };
}

// ── Suporte do navegador/contexto ───────────────────────────────────────
//
// Mesma postura da Etapa 3 para geolocalização (que também exige contexto
// seguro): não some da tela, aparece desabilitado DIZENDO o motivo — sumir
// pareceria app quebrado, e sumir sem explicação é pior porque ninguém sabe
// que a função existe para pedir (mesmo raciocínio de `carregar_kml` nascer
// `false` na Etapa 7). `localhost` é a exceção explícita da spec de contexto
// seguro — testável sem deploy; qualquer outro `http://`, inclusive por IP de
// rede local (`http://192.168.x.x`), NÃO conta, mesma pegadinha já registrada
// para o GPS na Etapa 3.
export function avaliarSuporte({ isSecureContext, temServiceWorker, temCaches } = {}) {
  if (!isSecureContext) {
    return {
      ok: false,
      motivo: 'Mapa offline precisa de uma página HTTPS (localhost também funciona, para teste). '
            + 'Abra o site publicado para usar esta função.',
    };
  }
  if (!temServiceWorker || !temCaches) {
    return {
      ok: false,
      motivo: 'Este navegador não tem suporte a Service Worker/Cache API — mapa offline não funciona aqui.',
    };
  }
  return { ok: true };
}

// ── Indicador honesto: a área que estou vendo está salva? ────────────────
//
// Conservador de propósito: só afirma "salva" se o retângulo salvo cobre o
// que está na tela POR INTEIRO (bbox contido) E o zoom atual está dentro da
// faixa que foi de fato baixada — e só para áreas com status 'pronta'. Uma
// área 'incompleta' pode ter buracos dentro do próprio bbox/zoom que ela
// reivindica, então nunca conta como cobertura garantida.
function bboxContem(externo, interno) {
  return externo.sul <= interno.sul && externo.oeste <= interno.oeste
      && externo.norte >= interno.norte && externo.leste >= interno.leste;
}

export function areaCobreViewport(area, viewportBBox, viewportZoom) {
  if (!area || area.status !== 'pronta') return false;
  if (!bboxValido(area.bbox) || !bboxValido(viewportBBox)) return false;
  if (!bboxContem(area.bbox, viewportBBox)) return false;
  return viewportZoom >= area.zoomMin && viewportZoom <= area.zoomMax;
}

// Devolve a primeira área da lista que cobre o viewport, ou null. A tela usa
// isto para o indicador "esta área está salva" perto do mapa.
export function areaQueCobre(areas, viewportBBox, viewportZoom) {
  if (!Array.isArray(areas)) return null;
  return areas.find((a) => areaCobreViewport(a, viewportBBox, viewportZoom)) || null;
}

// Rótulo curto para a lista de áreas salvas (ex.: "20×15 km, zoom 12–16").
// Aproximação por distância angular — não precisa de geodésia de precisão
// para um rótulo na tela, mesmo espírito de METROS_POR_GRAU em kml.js.
const METROS_POR_GRAU = 111_320;
export function dimensoesAproximadasKm(bbox) {
  if (!bboxValido(bbox)) return null;
  const latMedia = (bbox.sul + bbox.norte) / 2;
  const altura = ((bbox.norte - bbox.sul) * METROS_POR_GRAU) / 1000;
  const largura = ((bbox.leste - bbox.oeste) * METROS_POR_GRAU * Math.cos((latMedia * Math.PI) / 180)) / 1000;
  return { larguraKm: largura, alturaKm: altura };
}
