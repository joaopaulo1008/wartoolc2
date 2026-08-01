// Teste de frontend/carta-offline.js — Etapa 8a.
//
//     node frontend/carta-offline.teste.mjs
//
// Roda sem navegador e sem dependência nenhuma. O que ele trava, no mesmo
// espírito de rastro.teste.mjs/kml.teste.mjs: um erro aqui não aparece como
// tela quebrada — aparece como um número de tiles/bytes plausível e errado
// mostrado ao usuário ANTES de baixar, ou como um teto que deixa passar uma
// área grande demais para o servidor da carta aguentar. Os casos que mais
// importam:
//
//   1. a contagem de tiles cresce ~4× a cada nível de zoom (é a conta que
//      impede alguém de pedir uma área grande demais sem perceber);
//   2. `planejarDownload` recusa ANTES de listar um tile sequer, com motivo;
//   3. o indicador "esta área está salva" só afirma isso com o zoom E o bbox
//      cobertos, e nunca para uma área 'incompleta'.

import {
  BASEMAP_OFFLINE,
  ZOOM_MIN_OFFLINE,
  ZOOM_MAX_OFFLINE,
  LIMITE_TILES_POR_AREA,
  LIMITE_AREAS_SALVAS,
  TAMANHO_TILE_ESTIMADO_BYTES,
  lonParaTileX,
  latParaTileY,
  normalizarBBox,
  contarTilesPorZoom,
  contarTiles,
  listarTiles,
  estimarBytes,
  planejarDownload,
  avaliarCota,
  avaliarSuporte,
  areaCobreViewport,
  areaQueCobre,
  dimensoesAproximadasKm,
} from './carta-offline.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = Object.is(obtido, esperado);
  bom ? passou++ : falhou++;
  console.log(`${bom ? 'PASSOU' : '** FALHOU **'}  ${descricao}`);
  if (!bom) console.log(`          esperado: ${JSON.stringify(esperado)}\n          obtido:   ${JSON.stringify(obtido)}`);
}
function okVerdade(descricao, condicao) { ok(descricao, !!condicao, true); }
function perto(descricao, obtido, esperado, tolerancia) {
  const bom = Number.isFinite(obtido) && Math.abs(obtido - esperado) <= tolerancia;
  bom ? passou++ : falhou++;
  console.log(`${bom ? 'PASSOU' : '** FALHOU **'}  ${descricao}`);
  if (!bom) console.log(`          esperado: ${esperado} (±${tolerancia})\n          obtido:   ${obtido}`);
}

// Bbox utilitário: quadrado de `ladoKm` em torno do centro padrão do mapa
// (-22, -47, o mesmo de `L.map('map', {center:[-22,-47]})` em index.html).
function bboxDeKm(ladoKm, lat = -22, lon = -47) {
  const dLat = ladoKm / 111.32;
  const dLon = ladoKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return normalizarBBox({ lat: lat - dLat / 2, lon: lon - dLon / 2 }, { lat: lat + dLat / 2, lon: lon + dLon / 2 });
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Constantes: as decisões que a etapa toma ──────────────');

okVerdade('só o BDGEx é elegível para download offline', BASEMAP_OFFLINE === 'bdgex');
okVerdade('a faixa de zoom offline não passa do maxZoom ao vivo do BDGEx (18, basemaps.js)',
  ZOOM_MAX_OFFLINE <= 18);
okVerdade('o piso de zoom é menor que o teto', ZOOM_MIN_OFFLINE < ZOOM_MAX_OFFLINE);
okVerdade('o teto de tiles por área é um número finito e positivo',
  Number.isFinite(LIMITE_TILES_POR_AREA) && LIMITE_TILES_POR_AREA > 0);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── normalizarBBox — o usuário pode arrastar em qualquer direção ─');

const bboxOk = normalizarBBox({ lat: -22.1, lon: -47.2 }, { lat: -21.9, lon: -47.0 });
ok('sul é o menor dos dois', bboxOk.sul, -22.1);
ok('norte é o maior dos dois', bboxOk.norte, -21.9);
ok('oeste é o menor dos dois', bboxOk.oeste, -47.2);
ok('leste é o maior dos dois', bboxOk.leste, -47.0);

const bboxInvertido = normalizarBBox({ lat: -21.9, lon: -47.0 }, { lat: -22.1, lon: -47.2 });
ok('inverter os dois cantos dá o MESMO bbox (comutativo)', JSON.stringify(bboxInvertido), JSON.stringify(bboxOk));

ok('lat fora do intervalo (> 85) devolve null', normalizarBBox({ lat: 90, lon: 0 }, { lat: 0, lon: 0 }), null);
ok('lon fora do intervalo (> 180) devolve null', normalizarBBox({ lat: 0, lon: 200 }, { lat: 0, lon: 0 }), null);
ok('coordenada não numérica devolve null', normalizarBBox({ lat: 'x', lon: 0 }, { lat: 0, lon: 0 }), null);
ok('argumento ausente devolve null', normalizarBBox(null, { lat: 0, lon: 0 }), null);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Matemática de tile — referências conhecidas ───────────');

// No zoom 0 o mundo inteiro é UM tile só: (0,0).
ok('zoom 0: qualquer longitude cai no tile 0', lonParaTileX(0, 0), 0);
ok('zoom 0: o equador cai no tile 0', latParaTileY(0, 0), 0);
// No zoom 1 o mundo vira 2×2. Longitude 0 é o meio -> tile x=1 (limite exato
// arredonda para o tile seguinte, mesmo comportamento do floor() do OSM).
ok('zoom 1: longitude 90 (um quarto do caminho no hemisfério leste) cai no tile 1',
  lonParaTileX(90, 1), 1);
ok('zoom 1: longitude -90 cai no tile 0', lonParaTileX(-90, 1), 0);

okVerdade('tile X cresce (ou empata) com a longitude, zoom fixo',
  lonParaTileX(-47.0, 14) >= lonParaTileX(-47.5, 14));
okVerdade('tile Y cresce (ou empata) indo para o SUL (latitude menor), zoom fixo',
  latParaTileY(-22.5, 14) >= latParaTileY(-22.0, 14));

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── contarTiles — a defesa contra o volume ─────────────────');

const bbox2 = bboxDeKm(2);
const bbox10 = bboxDeKm(10);
const bbox20 = bboxDeKm(20);

okVerdade('uma área de 2×2 km cabe folgada no teto (faixa inteira 12–16)',
  contarTiles(bbox2, ZOOM_MIN_OFFLINE, ZOOM_MAX_OFFLINE) < LIMITE_TILES_POR_AREA);
okVerdade('uma área de operações de 20×20 km (companhia/batalhão) ainda cabe no teto',
  contarTiles(bbox20, ZOOM_MIN_OFFLINE, ZOOM_MAX_OFFLINE) < LIMITE_TILES_POR_AREA);

// A invariante central: cada nível de zoom a mais aproximadamente QUADRUPLICA
// a contagem de um bbox fixo (longe da borda de um tile único, onde o efeito
// de arredondamento do floor() ainda domina). Uma tolerância generosa (2.5×
// a 6×) absorve esse efeito de borda sem deixar de travar uma regressão real
// (ex.: alguém trocando o `2 ** z` por `z * 2` seria pego na hora).
console.log('\ncrescimento por nível de zoom (deve rondar 4×) — bbox de 20×20 km');
for (let z = ZOOM_MIN_OFFLINE; z < ZOOM_MAX_OFFLINE; z++) {
  const atual = contarTilesPorZoom(bbox20, z);
  const proximo = contarTilesPorZoom(bbox20, z + 1);
  const razao = proximo / atual;
  okVerdade(`z${z} -> z${z + 1}: ${atual} -> ${proximo} tiles (razão ${razao.toFixed(2)}×, entre 2.5× e 6×)`,
    razao >= 2.5 && razao <= 6);
}

// contarTiles é só a soma de contarTilesPorZoom em cada nível — travando isso
// aqui, um erro de "somar duas vezes o mesmo zoom" ou "pular um zoom" no loop
// de contarTiles apareceria na hora.
let somaManual = 0;
for (let z = 12; z <= 16; z++) somaManual += contarTilesPorZoom(bbox10, z);
ok('contarTiles é a soma de contarTilesPorZoom em cada nível da faixa',
  contarTiles(bbox10, 12, 16), somaManual);

// listarTiles tem que concordar com contarTiles em QUANTIDADE — são dois
// caminhos de código diferentes (um soma, o outro enumera) e é fácil os dois
// divergirem se alguém mexer só num dos dois.
ok('listarTiles devolve exatamente a quantidade que contarTiles calcula',
  listarTiles(bbox2, 12, 14).length, contarTiles(bbox2, 12, 14));

okVerdade('nenhum tile listado se repete (cada {z,x,y} é único)', (() => {
  const tiles = listarTiles(bbox10, 12, 15);
  const chaves = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
  return chaves.size === tiles.length;
})());

ok('bbox inválido (null) conta zero tiles, não lança', contarTiles(null, 12, 16), 0);
ok('bbox inválido (null) lista zero tiles, não lança', listarTiles(null, 12, 16).length, 0);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── estimarBytes ────────────────────────────────────────────');

ok('100 tiles vira 100 × TAMANHO_TILE_ESTIMADO_BYTES', estimarBytes(100), 100 * TAMANHO_TILE_ESTIMADO_BYTES);
ok('zero tiles é zero bytes', estimarBytes(0), 0);
ok('entrada não numérica não gera NaN', estimarBytes('x'), 0);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── planejarDownload — cabe, ou não cabe e por quê ─────────');

const planoOk = planejarDownload({ bbox: bbox10, zoomMin: 12, zoomMax: 16 });
okVerdade('área de 10×10 km na faixa inteira: ok', planoOk.ok);
ok('devolve a MESMA contagem de contarTiles', planoOk.tiles, contarTiles(bbox10, 12, 16));
ok('devolve a MESMA estimativa de estimarBytes', planoOk.bytesEstimados, estimarBytes(planoOk.tiles));

const semBbox = planejarDownload({ bbox: null, zoomMin: 12, zoomMax: 16 });
okVerdade('sem bbox: recusado', !semBbox.ok);
okVerdade('sem bbox: motivo explica o que fazer', typeof semBbox.motivo === 'string' && semBbox.motivo.length > 0);

const zoomInvertido = planejarDownload({ bbox: bbox10, zoomMin: 16, zoomMax: 12 });
okVerdade('zoomMin > zoomMax: recusado', !zoomInvertido.ok);

const zoomForaFaixa = planejarDownload({ bbox: bbox10, zoomMin: 10, zoomMax: ZOOM_MAX_OFFLINE });
okVerdade(`zoom abaixo de ZOOM_MIN_OFFLINE (${ZOOM_MIN_OFFLINE}): recusado`, !zoomForaFaixa.ok);

const zoomAltoDemais = planejarDownload({ bbox: bbox10, zoomMin: ZOOM_MIN_OFFLINE, zoomMax: 18 });
okVerdade(`zoom acima de ZOOM_MAX_OFFLINE (${ZOOM_MAX_OFFLINE}): recusado`, !zoomAltoDemais.ok);

// A área que a documentação de LIMITE_TILES_POR_AREA usa como exemplo do que
// NÃO cabe (região/estado, não exercício) — trava o número redondo do
// comentário, não só a lógica.
const bboxRegiao = bboxDeKm(300);
const planoRegiao = planejarDownload({ bbox: bboxRegiao, zoomMin: ZOOM_MIN_OFFLINE, zoomMax: ZOOM_MAX_OFFLINE });
okVerdade('uma área do tamanho de uma região (300×300 km): recusada', !planoRegiao.ok);
okVerdade('e o motivo cita quantos tiles pediria', /tiles/.test(planoRegiao.motivo));

const planoLotado = planejarDownload({
  bbox: bbox2, zoomMin: 12, zoomMax: 14, areasJaSalvas: LIMITE_AREAS_SALVAS,
});
okVerdade(`no limite de ${LIMITE_AREAS_SALVAS} áreas já salvas: recusado mesmo a área sendo pequena`,
  !planoLotado.ok);

const planoQuaseCheio = planejarDownload({
  bbox: bbox2, zoomMin: 12, zoomMax: 14, areasJaSalvas: LIMITE_AREAS_SALVAS - 1,
});
okVerdade('um a menos que o limite de áreas: ainda ok', planoQuaseCheio.ok);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── avaliarCota ──────────────────────────────────────────────');

okVerdade('cabe com folga: ok', avaliarCota({ bytesEstimados: 1_000_000, uso: 0, cota: 100_000_000 }).ok);

const cotaEstourada = avaliarCota({ bytesEstimados: 95_000_000, uso: 0, cota: 100_000_000 });
okVerdade('acima da margem de segurança (10%): recusado', !cotaEstourada.ok);

const cotaJustaSemMargem = avaliarCota({ bytesEstimados: 91_000_000, uso: 0, cota: 100_000_000 });
okVerdade('91 MB pedidos de 100 MB livres (menos que a margem de 10%): recusado', !cotaJustaSemMargem.ok);

const cotaDesconhecida = avaliarCota({ bytesEstimados: 1_000_000, uso: 0, cota: 0 });
okVerdade('sem informação de cota (API indisponível): não bloqueia', cotaDesconhecida.ok);
okVerdade('...mas marca como incerto, para a tela avisar', cotaDesconhecida.incerto);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── avaliarSuporte — contexto seguro e APIs do navegador ───');

const semHttps = avaliarSuporte({ isSecureContext: false, temServiceWorker: true, temCaches: true });
okVerdade('sem contexto seguro: recusado', !semHttps.ok);
okVerdade('...e o motivo menciona HTTPS', /HTTPS/.test(semHttps.motivo));
okVerdade('...e diz que localhost funciona para teste', /localhost/.test(semHttps.motivo));

const semSW = avaliarSuporte({ isSecureContext: true, temServiceWorker: false, temCaches: true });
okVerdade('https mas sem Service Worker: recusado', !semSW.ok);

const semCaches = avaliarSuporte({ isSecureContext: true, temServiceWorker: true, temCaches: false });
okVerdade('https mas sem Cache API: recusado', !semCaches.ok);

const tudoOk = avaliarSuporte({ isSecureContext: true, temServiceWorker: true, temCaches: true });
okVerdade('https + Service Worker + Cache API: ok', tudoOk.ok);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── areaCobreViewport / areaQueCobre — o indicador honesto ──');

const areaPronta = { bbox: bboxDeKm(20), zoomMin: 12, zoomMax: 16, status: 'pronta' };
const dentroDaArea = bboxDeKm(2); // bem menor, mesmo centro -> cabe dentro

okVerdade('viewport pequeno dentro de área pronta, zoom coberto: cobre',
  areaCobreViewport(areaPronta, dentroDaArea, 14));
okVerdade('mesmo bbox, zoom ACIMA do que foi salvo (17): não cobre',
  !areaCobreViewport(areaPronta, dentroDaArea, 17));
okVerdade('mesmo bbox, zoom ABAIXO do que foi salvo (10): não cobre',
  !areaCobreViewport(areaPronta, dentroDaArea, 10));

const foraDaArea = bboxDeKm(2, -25, -50); // outro lugar do mapa
okVerdade('viewport fora do bbox salvo: não cobre', !areaCobreViewport(areaPronta, foraDaArea, 14));

const areaIncompleta = { ...areaPronta, status: 'incompleta' };
okVerdade('área INCOMPLETA nunca cobre, mesmo com bbox/zoom batendo — pode ter buraco',
  !areaCobreViewport(areaIncompleta, dentroDaArea, 14));

const maiorQueSalvo = bboxDeKm(200); // viewport MAIOR que a área salva
okVerdade('viewport maior que a área salva (não cabe dentro): não cobre',
  !areaCobreViewport(areaPronta, maiorQueSalvo, 14));

ok('areaQueCobre devolve null se a lista estiver vazia', areaQueCobre([], dentroDaArea, 14), null);
ok('areaQueCobre acha a área certa numa lista com várias', areaQueCobre(
  [areaIncompleta, areaPronta], dentroDaArea, 14,
), areaPronta);
ok('areaQueCobre devolve null se nenhuma cobre', areaQueCobre([areaIncompleta], dentroDaArea, 14), null);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── dimensoesAproximadasKm — rótulo da lista de áreas ──────');

const bbox10x10 = bboxDeKm(10);
const dim = dimensoesAproximadasKm(bbox10x10);
perto('altura de um bbox de "10 km de lado" fica perto de 10 km', dim.alturaKm, 10, 0.2);
perto('largura de um bbox de "10 km de lado" fica perto de 10 km (mesmo perto do equador não)', dim.larguraKm, 10, 0.2);
ok('bbox inválido devolve null', dimensoesAproximadasKm(null), null);

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(58)}`);
console.log(`${passou} passaram, ${falhou} falharam de ${passou + falhou}`);
if (falhou > 0) process.exit(1);
