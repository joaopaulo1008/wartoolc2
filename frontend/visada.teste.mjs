// Teste de frontend/visada.js.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/visada.teste.mjs
//
// DE ONDE VÊM OS VALORES ESPERADOS
// ---------------------------------
// Do **PROJ** (via `pyproj.Geod`, elipsoide WGS84) — a mesma referência usada
// em `coordenadas.teste.mjs`, e a mesma biblioteca por trás do QGIS. Não são
// estimativas nem contas de cabeça. Para regerá-los:
//
//     pip install pyproj
//     python3 - <<'PY'
//     from pyproj import Geod
//     g = Geod(ellps='WGS84')
//     obs  = (-25.100916, -50.159274)      # (lat, lon) de quem observa
//     alvo = (-25.068916, -50.124274)      # (lat, lon) do elemento marcado
//     az, _, d = g.inv(obs[1], obs[0], alvo[1], alvo[0])
//     print(f'{d:.4f} m, azimute {az % 360:.6f}')
//     PY
//
// `pyproj.Geod` usa o método de Karney, que é mais preciso que a inversa de
// Vincenty implementada em visada.js. Para as distâncias de um exercício
// (0 a 20 km) os dois concordam MUITO abaixo de qualquer coisa que importe —
// as tolerâncias abaixo (1 mm e 1e-6 grau) medem isso.
//
// O ponto de observação é o mesmo que apareceu no relato de campo de
// 2026-08-02 (Tibagi/PR), de propósito: mantém os testes ancorados num lugar
// onde o app de fato rodou.

import {
  visada, convergenciaMeridiana, grausParaMilesimos,
  formatarDistancia, formatarAzimute, formatarVisada,
  MILESIMOS_POR_VOLTA,
} from './visada.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = JSON.stringify(obtido) === JSON.stringify(esperado);
  bom ? passou++ : falhou++;
  console.log(`  ${(bom ? 'PASSOU' : '** FALHOU **').padEnd(14)} ${descricao}`);
  if (!bom) {
    console.log(`                 esperado: ${JSON.stringify(esperado)}`);
    console.log(`                 obtido:   ${JSON.stringify(obtido)}`);
  }
}
function okPerto(descricao, obtido, esperado, tolerancia, unidade) {
  const bom = Number.isFinite(obtido) && Math.abs(obtido - esperado) <= tolerancia;
  bom ? passou++ : falhou++;
  console.log(`  ${(bom ? 'PASSOU' : '** FALHOU **').padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado ${esperado}${unidade}, obtido ${obtido}${unidade} ` +
                        `(diferença ${Math.abs(obtido - esperado)}${unidade})`);
}

const TOL_M = 0.001;      // 1 mm
const TOL_GRAU = 1e-6;

const OBS = { lat: -25.100916, lon: -50.159274 };  // Tibagi/PR

// A convergência meridiana no ponto de observação, segundo o PROJ
// (`Proj.get_factors(...).meridian_convergence`). Tibagi fica ~0,84° a leste
// do meridiano central da zona 22 (−51°), no hemisfério sul.
const CONVERGENCIA_PROJ = -0.356669;

// [rótulo, lat, lon, distância PROJ (m), az. VERDADEIRO PROJ (°), az. QUADRÍCULA (°)]
// O de quadrícula é `verdadeiro − convergência`, que é a relação verificada
// numericamente (ver a seção 2 abaixo).
const REFERENCIA = [
  ['1 km ao norte',   -25.091916, -50.159274,   996.9689,   0.000000,   0.356669],
  ['norte, 2 km',     -25.082916, -50.159274,  1993.9366,   0.000000,   0.356669],
  ['nordeste, ~5 km', -25.068916, -50.124274,  5003.2100,  44.894442,  45.251111],
  ['leste, ~10 km',   -25.100916, -50.060274,  9985.8802,  90.020999,  90.377668],
  ['sudeste, ~15 km', -25.195916, -50.054274, 14927.5322, 134.850346, 135.207015],
  ['sul, ~20 km',     -25.280916, -50.159274, 19939.6327, 180.000000, 180.356669],
  ['oeste, ~8 km',    -25.100916, -50.238274,  7968.5307, 269.983244, 270.339913],
];

// ── 1. Distância e azimute contra o PROJ ────────────────────────────────────
console.log('\nvisada() — conferida contra o PROJ (pyproj.Geod, elipsoide WGS84)');
for (const [nome, lat, lon, distancia, azVerdadeiro, azQuadricula] of REFERENCIA) {
  const v = visada(OBS, { lat, lon });
  okPerto(`${nome}: distância`, v.distanciaM, distancia, TOL_M, ' m');
  okPerto(`${nome}: azimute VERDADEIRO`, v.azimuteVerdadeiroGraus, azVerdadeiro, TOL_GRAU, '°');
  okPerto(`${nome}: azimute de QUADRÍCULA (o lançamento)`, v.azimuteGraus, azQuadricula, TOL_GRAU, '°');
}

// ── 1b. O norte que vale é o de QUADRÍCULA ──────────────────────────────────
// Definido pelo usuário em 2026-08-02: "lançamento é sempre em relação ao
// norte de quadrícula". A primeira versão deste módulo entregava o
// verdadeiro; estas asserções existem para a troca não ser desfeita sem
// alguém perceber.
console.log('\nO azimute que sai como "o" azimute é o de QUADRÍCULA, não o verdadeiro');
const vNorte = visada(OBS, { lat: -25.082916, lon: -50.159274 });
ok('um alvo exatamente ao norte VERDADEIRO não dá 0 de lançamento',
  vNorte.azimuteVerdadeiroGraus === 0 && vNorte.azimuteGraus !== 0, true);
okPerto('ele dá justamente a convergência (0,357° ≈ 6 milésimos aqui)',
  vNorte.azimuteGraus, Math.abs(CONVERGENCIA_PROJ), TOL_GRAU, '°');
ok('e `azimuteMil` acompanha o de quadrícula, não o verdadeiro',
  Math.round(vNorte.azimuteMil), Math.round(grausParaMilesimos(vNorte.azimuteGraus)));
ok('a linha da tela é marcada com "qd" (se virar "vd", alguém desfez isto)',
  formatarVisada(vNorte).endsWith(' qd'), true);

// ── 1c. Convergência meridiana, contra o PROJ ───────────────────────────────
console.log('\nconvergenciaMeridiana() — contra o meridian_convergence do PROJ');
okPerto('no ponto de observação (Tibagi/PR, zona 22)',
  convergenciaMeridiana(OBS), CONVERGENCIA_PROJ, 1e-5, '°');
okPerto('em Brasília (zona 23, a oeste do MC → convergência positiva)',
  convergenciaMeridiana({ lat: -15.79961, lon: -47.86446 }), 0.78053, 1e-4, '°');
okPerto('em Manaus (zona 20)',
  convergenciaMeridiana({ lat: -3.10194, lon: -60.025 }), -0.16113, 1e-4, '°');
okPerto('em Boa Vista/RR (hemisfério NORTE — o sinal inverte)',
  convergenciaMeridiana({ lat: 2.823889, lon: -60.675556 }), 0.11458, 1e-4, '°');
ok('exatamente sobre o meridiano central a convergência é zero (quadrícula = verdadeiro)',
  Math.abs(convergenciaMeridiana({ lat: -30, lon: -51 })) < 1e-9, true);
okPerto('na borda da zona ela chega a ~1,45° — cerca de 26 milésimos',
  Math.abs(convergenciaMeridiana({ lat: -30, lon: -48.1 })), 1.45094, 1e-4, '°');
ok('26 milésimos é diferença que importa: mais que 25 m de desvio a 1 km',
  Math.round(grausParaMilesimos(1.45094)), 26);
ok('convergenciaMeridiana() com ponto inválido devolve null',
  [convergenciaMeridiana(null), convergenciaMeridiana({ lat: 91, lon: 0 })], [null, null]);

// ── 2. Por que não dava para reusar o haversine de rastro.js ────────────────
// Esta seção não testa visada.js: ela DOCUMENTA, de forma executável, a razão
// de existir um segundo cálculo de distância no projeto. Se um dia alguém
// "simplificar" trocando Vincenty por haversine, é aqui que fica registrado o
// tamanho do erro que isso reintroduz.
console.log('\nO erro que o haversine esférico introduziria (motivo de não reusar rastro.js)');
function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const piorErro = Math.max(...REFERENCIA.map(([, lat, lon, d]) =>
  Math.abs(haversine(OBS, { lat, lon }) - d)));
ok('o haversine erraria mais de 50 m em alguma das distâncias testadas',
  piorErro > 50, true);
ok('e o Vincenty deste módulo erra menos de 1 mm em TODAS elas',
  REFERENCIA.every(([, lat, lon, d]) => Math.abs(visada(OBS, { lat, lon }).distanciaM - d) < TOL_M),
  true);

// ── 3. Outras latitudes — não vale só perto de Tibagi ───────────────────────
console.log('\nOutras latitudes (equador e hemisfério norte)');
const eq = visada({ lat: 0, lon: 0 }, { lat: 0, lon: 0.0898315 });
okPerto('no equador, 0,0898315° de longitude ≈ 10 km', eq.distanciaM, 9999.9968, TOL_M, ' m');
okPerto('e o azimute verdadeiro é exatamente leste (90°)', eq.azimuteVerdadeiroGraus, 90, TOL_GRAU, '°');
ok('no equador a convergência é zero em qualquer longitude (sen 0 = 0), ' +
   'então lá quadrícula e verdadeiro coincidem',
  Math.abs(eq.convergenciaGraus) < 1e-12, true);
const bv = visada({ lat: 2.823889, lon: -60.675556 }, { lat: 2.868889, lon: -60.630556 });
okPerto('Boa Vista/RR (hemisfério norte): distância', bv.distanciaM, 7056.3889, TOL_M, ' m');
okPerto('Boa Vista/RR: azimute verdadeiro', bv.azimuteVerdadeiroGraus, 45.155470, TOL_GRAU, '°');
okPerto('Boa Vista/RR: lançamento (verdadeiro − convergência de +0,11458°)',
  bv.azimuteGraus, 45.155470 - 0.11458, 1e-4, '°');

// ── 4. Milésimos — a unidade que o apoio de fogo usa ────────────────────────
console.log('\nMilésimos (padrão OTAN: 6400 por volta, não 6000 nem 2π×1000)');
ok('a volta inteira tem 6400 milésimos', MILESIMOS_POR_VOLTA, 6400);
ok('0° = 0 mil', grausParaMilesimos(0), 0);
ok('90° = 1600 mil', grausParaMilesimos(90), 1600);
ok('180° = 3200 mil', grausParaMilesimos(180), 3200);
ok('270° = 4800 mil', grausParaMilesimos(270), 4800);
ok('360° = 6400 mil', grausParaMilesimos(360), 6400);
ok('o azimute em mil sai junto com o em graus, sem o chamador converter',
  Math.round(visada(OBS, { lat: -25.100916, lon: -50.060274 }).azimuteMil), 1607);
ok('grausParaMilesimos() com entrada inválida devolve null',
  [grausParaMilesimos(null), grausParaMilesimos(NaN), grausParaMilesimos('90')],
  [null, null, null]);

// ── 5. Casos de borda que não podem quebrar a tela ──────────────────────────
console.log('\nBorda: o popup nunca pode mostrar NaN nem travar');
const mesmoPonto = visada(OBS, { ...OBS });
ok('os dois pontos iguais dão distância 0 e azimute 0 (não NaN)',
  [mesmoPonto.distanciaM, mesmoPonto.azimuteGraus, mesmoPonto.azimuteMil], [0, 0, 0]);
for (const [descricao, de, para] of [
  ['observador nulo', null, OBS],
  ['alvo nulo', OBS, null],
  ['observador sem lat', { lon: -50 }, OBS],
  ['alvo com lat NaN', OBS, { lat: NaN, lon: -50 }],
  ['lat fora de faixa', OBS, { lat: 91, lon: -50 }],
  ['lon fora de faixa', OBS, { lat: -25, lon: 181 }],
  ['lat como string', OBS, { lat: '-25', lon: -50 }],
]) {
  ok(`visada() com ${descricao} devolve null`, visada(de, para), null);
}
ok('formatarVisada(null) devolve string vazia (a linha some do popup)',
  formatarVisada(null), '');
ok('e visada() de entrada inválida encadeia até string vazia, sem lançar',
  formatarVisada(visada(null, null)), '');
ok('pontos quase antípodas não travam a interface: devolvem null em vez de iterar sem fim',
  visada({ lat: 0, lon: 0 }, { lat: 0.5, lon: 179.7 }), null);

// ── 6. Formatação ───────────────────────────────────────────────────────────
console.log('\nFormatação: metro até 10 km, quilômetro acima disso');
ok('abaixo de 10 km sai em metro inteiro', formatarDistancia(2340.7), '2341 m');
ok('exatamente no corte já vira quilômetro', formatarDistancia(10000), '10,0 km');
ok('acima do corte, uma casa decimal e vírgula (pt-BR)', formatarDistancia(14927.5), '14,9 km');
ok('zero é uma distância válida, não "sem valor"', formatarDistancia(0), '0 m');
ok('distância inválida vira travessão, nunca NaN',
  [formatarDistancia(null), formatarDistancia(NaN), formatarDistancia(-5)], ['—', '—', '—']);
ok('azimute mostra milésimo inteiro e grau com uma casa', formatarAzimute(45.251111), '804 mil (45,3°)');
ok('360° dá a volta e vira 0 mil, não 6400', formatarAzimute(360), '0 mil (360,0°)');
ok('azimute inválido vira travessão', formatarAzimute(undefined), '—');
ok('a linha completa marca o norte usado ("qd" = quadrícula)',
  formatarVisada(visada(OBS, { lat: -25.068916, lon: -50.124274 })),
  '5003 m · 804 mil (45,3°) qd');
ok('e em distância longa a linha usa quilômetro',
  formatarVisada(visada(OBS, { lat: -25.280916, lon: -50.159274 })),
  '19,9 km · 3206 mil (180,4°) qd');

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
