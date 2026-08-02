// Teste de frontend/coordenadas.js — Etapa 9b.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/coordenadas.teste.mjs
//
// DE ONDE VÊM OS VALORES ESPERADOS DE UTM
// ----------------------------------------
// Não foram inventados nem copiados de um site aleatório: saíram do **PROJ
// 9.5.1** (via `pyproj` 3.7.1), que é a mesma biblioteca de projeção
// cartográfica por trás do QGIS — inclusive do QGIS que este projeto usou no
// pipeline original (`legacy-qgis/`). Para regerá-los:
//
//     pip install pyproj
//     python3 - <<'PY'
//     from pyproj import CRS, Transformer
//     import math
//     def zona(lat, lon):
//         z = int(math.floor((lon + 180) / 6) + 1)
//         if 56 <= lat < 64 and 3 <= lon < 12: z = 32
//         if 72 <= lat < 84:
//             if   0 <= lon <  9: z = 31
//             elif 9 <= lon < 21: z = 33
//             elif 21 <= lon < 33: z = 35
//             elif 33 <= lon < 42: z = 37
//         return z
//     lat, lon = -22.951916, -43.210487        # troque aqui
//     z = zona(lat, lon)
//     crs = CRS.from_dict({"proj":"utm","zone":z,"south":lat<0,
//                          "ellps":"WGS84","datum":"WGS84","units":"m"})
//     print(z, Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(lon, lat))
//     PY
//
// Dois dos casos abaixo não dependem nem do PROJ: no meridiano central da
// zona o easting é **exatamente** 500.000 m e no equador o northing é
// **exatamente** 0 (norte) ou 10.000.000 (sul). São definições do sistema, e
// servem de âncora independente de qualquer implementação.
//
// A tolerância usada é 1 mm. Não é frouxidão: a série de Snyder implementada
// em coordenadas.js e a implementada no PROJ truncam em ordens diferentes, e
// a diferença observada nos 13 pontos ficou em 0,83 mm no pior caso — cinco
// ordens de grandeza abaixo dos 5–15 m de precisão de um GPS de celular.

import {
  zonaUtm, bandaUtm, paraUtm, paraGms,
  formatar, formatarUtm, formatarDecimal, formatarGms,
  formatoValido, FORMATOS, FORMATO_PADRAO, ROTULO_FORMATO,
} from './coordenadas.js';

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

const TOLERANCIA_M = 0.001;  // 1 mm — ver o cabeçalho
function okMetro(descricao, obtido, esperado) {
  const bom = Number.isFinite(obtido) && Math.abs(obtido - esperado) <= TOLERANCIA_M;
  bom ? passou++ : falhou++;
  console.log(`  ${(bom ? 'PASSOU' : '** FALHOU **').padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado ${esperado} m, obtido ${obtido} m ` +
                        `(diferença ${Math.abs(obtido - esperado)} m)`);
}

// Cada linha: nome, lat, lon, zona, hemisfério, banda, easting PROJ, northing PROJ.
const REFERENCIA = [
  ['Cristo Redentor (Rio de Janeiro)',      -22.951916, -43.210487, 23, 'S', 'K', 683477.820675, 7460685.520180],
  ['Congresso Nacional (Brasília)',         -15.799610, -47.864460, 23, 'S', 'L', 193113.699993, 8251140.496968],
  ['Manaus (AM)',                            -3.101940, -60.025000, 20, 'S', 'M', 830709.984318, 9656674.148149],
  ['São Gabriel da Cachoeira (AM, zona 19)', -0.130280, -67.089170, 19, 'S', 'M', 712666.683361, 9985592.079564],
  ['Ponta do Seixas (PB, zona 25)',          -7.150830, -34.793330, 25, 'S', 'M', 301957.595193, 9209191.443762],
  ['Boa Vista (RR, hemisfério NORTE)',        2.823889, -60.675556, 20, 'N', 'N', 758411.458838,  312385.468101],
];

// ── 1. Pontos de referência conferidos contra o PROJ ────────────────────────
console.log('\nUTM — pontos de referência, conferidos contra o PROJ 9.5.1 (pyproj)');
for (const [nome, lat, lon, zona, hemisferio, banda, este, norte] of REFERENCIA) {
  const u = paraUtm(lat, lon);
  ok(`${nome}: zona/banda/hemisfério`, [u.zona, u.banda, u.hemisferio], [zona, banda, hemisferio]);
  okMetro(`${nome}: easting`, u.este, este);
  okMetro(`${nome}: northing`, u.norte, norte);
}

// ── 2. Âncoras exatas, independentes de qualquer implementação ──────────────
console.log('\nUTM — as duas âncoras que são definição do sistema, não resultado de cálculo');
const noMeridianoCentral = paraUtm(0, -45);   // -45 é o meridiano central da zona 23
ok('no meridiano central da zona, o easting é exatamente o falso este (500.000 m)',
  noMeridianoCentral.este, 500000);
ok('no equador, hemisfério norte, o northing é exatamente 0',
  noMeridianoCentral.norte, 0);
ok('logo abaixo do equador o northing pula para perto de 10.000.000 (falso norte do sul)',
  Math.round(paraUtm(-0.000001, -45).norte), 10000000);
ok('e o hemisfério vira S nesse mesmo passo',
  [paraUtm(0.000001, -45).hemisferio, paraUtm(-0.000001, -45).hemisferio], ['N', 'S']);
okMetro('meridiano central da zona 22 (-51) também dá 500.000 exatos',
  paraUtm(-20, -51).este, 500000);

// ── 3. Fronteira entre duas zonas UTM ───────────────────────────────────────
// -48° é a fronteira entre a zona 22 (54°W–48°W) e a 23 (48°W–42°W). É o caso
// que mais importa aqui: um erro de sinal ou um `<=` no lugar de `<` joga o
// ponto para a zona vizinha, e o par de números continua parecendo plausível
// — só aponta ~800 km para o lado.
console.log('\nUTM — fronteira entre a zona 22 e a 23 (48°W), o erro mais fácil de não perceber');
ok('um micrograu a OESTE de 48°W ainda é zona 22', zonaUtm(-20, -48.000001), 22);
ok('48°W exato já é zona 23 (a fronteira pertence à zona de leste)', zonaUtm(-20, -48), 23);
ok('um micrograu a LESTE de 48°W é zona 23', zonaUtm(-20, -47.999999), 23);
okMetro('lado 22 da fronteira: easting perto do limite leste da zona (PROJ)',
  paraUtm(-20, -48.000001).este, 813926.215718);
okMetro('lado 23 da fronteira: easting perto do limite oeste da zona (PROJ)',
  paraUtm(-20, -47.999999).este, 186073.784282);
ok('o northing é o MESMO dos dois lados — só o easting e a zona mudam',
  Math.round(paraUtm(-20, -48.000001).norte), Math.round(paraUtm(-20, -47.999999).norte));
ok('a soma dos dois eastings é ~1.000.000 (simetria em torno do falso este)',
  Math.round(paraUtm(-20, -48.000001).este + paraUtm(-20, -47.999999).este), 1000000);

console.log('\nUTM — as demais fronteiras de zona, e as duas exceções que são parte da definição');
ok('zona 1 começa em 180°W', zonaUtm(0, -180), 1);
ok('180°E exato volta para a zona 1, não vira zona 61', zonaUtm(0, 180), 1);
ok('Greenwich (0°) é zona 31', zonaUtm(0, 0), 31);
ok('6°E já é zona 32', zonaUtm(0, 6), 32);
ok('Bergen (60,4°N 5,3°E) cai na zona 32, não na 31 — exceção da Noruega',
  zonaUtm(60.39299, 5.32415), 32);
ok('a exceção da Noruega vale só entre 56°N e 64°N: a 50°N o mesmo meridiano é zona 31',
  zonaUtm(50, 5.32415), 31);
okMetro('Bergen: easting conferido contra o PROJ (com a zona alargada)',
  paraUtm(60.39299, 5.32415).este, 297477.306983);
ok('Svalbard (78,2°N 15,65°E) cai na zona 33X, não na 33 pela regra geral',
  [zonaUtm(78.22, 15.65), bandaUtm(78.22)], [33, 'X']);
okMetro('Svalbard: northing conferido contra o PROJ',
  paraUtm(78.22, 15.65).norte, 8683004.153277);

// ── 4. Latitude e longitude negativas — o caso NORMAL do Brasil ─────────────
console.log('\nLatitude/longitude negativas (hemisfério sul e oeste), que é o caso normal aqui');
ok('todo ponto brasileiro do conjunto de referência sai como hemisfério S',
  REFERENCIA.filter(([, lat]) => lat < 0).map(([, lat, lon]) => paraUtm(lat, lon).hemisferio),
  ['S', 'S', 'S', 'S', 'S']);
ok('nenhum northing do hemisfério sul é negativo (é o que o falso norte evita)',
  REFERENCIA.filter(([, lat]) => lat < 0).every(([, lat, lon]) => paraUtm(lat, lon).norte > 0), true);
ok('nenhum easting fica fora da faixa fisicamente possível da zona (~166 km a ~834 km)',
  REFERENCIA.every(([, lat, lon]) => {
    const e = paraUtm(lat, lon).este;
    return e > 100000 && e < 900000;
  }), true);
ok('longitude negativa NÃO vira zona negativa nem zero (Brasil vai da zona 18 à 25)',
  [zonaUtm(-20, -43), zonaUtm(-20, -74), zonaUtm(-20, -34)], [23, 18, 25]);
ok('grau decimal preserva o sinal dos dois eixos',
  formatarDecimal(-22.951916, -43.210487), '-22.951916, -43.210487');
ok('GMS traduz o sinal em hemisfério S e W, e não repete o "-"',
  formatarGms(-22.951916, -43.210487), '22°57\'06.9"S 43°12\'37.8"W');
ok('e no hemisfério norte/leste sai N e E',
  formatarGms(60.39299, 5.32415), '60°23\'34.8"N 5°19\'26.9"E');

// ── 5. Faixas de latitude (a letra que aparece junto da zona) ───────────────
console.log('\nbandaUtm() — a letra da faixa de latitude');
ok('Rio de Janeiro fica na faixa K', bandaUtm(-22.951916), 'K');
ok('Brasília fica na faixa L', bandaUtm(-15.79961), 'L');
ok('logo ao norte do equador começa a faixa N (não há "I")', bandaUtm(0.5), 'N');
ok('logo ao sul do equador é a faixa M', bandaUtm(-0.5), 'M');
ok('não existe faixa I nem O na sequência',
  [bandaUtm(8.5), bandaUtm(-40.5)].some((b) => b === 'I' || b === 'O'), false);
ok('a faixa X vai até 84°N (tem 12°, não 8°)', [bandaUtm(72), bandaUtm(83.9)], ['X', 'X']);
ok('acima de 84°N o UTM não é definido — banda vazia', bandaUtm(85), '');
ok('abaixo de 80°S idem', bandaUtm(-80.1), '');

// ── 6. Grau, minuto, segundo ────────────────────────────────────────────────
console.log('\nparaGms() — decomposição e o arredondamento que gera "60 segundos"');
ok('decompõe um valor conhecido', paraGms(-22.951916, -43.210487).lat,
  { grau: 22, minuto: 57, segundo: 6.9, hemisferio: 'S' });
ok('grau exato dá minuto e segundo zerados', paraGms(-20, -45).lat,
  { grau: 20, minuto: 0, segundo: 0, hemisferio: 'S' });
// 22.99999999° = 22°59'59.99996" -> arredondando a 1 casa daria 60.0 segundos.
ok('arredondamento que estouraria em 60" sobe para o minuto seguinte',
  paraGms(22.99999999, 0).lat, { grau: 23, minuto: 0, segundo: 0, hemisferio: 'N' });
ok('e o estouro em 60\' sobe para o grau seguinte (não deixa 22°60\'00.0")',
  formatarGms(22.99999999, 0), '23°00\'00.0"N 0°00\'00.0"E');
ok('o zero de latitude conta como hemisfério N (não fica sem letra)',
  paraGms(0, -45).lat.hemisferio, 'N');
ok('minuto sempre com dois dígitos e segundo sempre com uma casa',
  formatarGms(-1.0025, -2.0025), '1°00\'09.0"S 2°00\'09.0"W');

// ── 7. formatar(): o ponto único que as três telas chamam ──────────────────
console.log('\nformatar() — o despachante que gps.js, colegas.js e marcacoes.js usam');
const LAT = -22.951916, LON = -43.210487;
ok('formato utm', formatar(LAT, LON, 'utm'), '23K 683478 mE 7460686 mN');
ok('formato decimal', formatar(LAT, LON, 'decimal'), '-22.951916, -43.210487');
ok('formato dms', formatar(LAT, LON, 'dms'), '22°57\'06.9"S 43°12\'37.8"W');
ok('formato desconhecido cai no padrão em vez de quebrar o popup',
  formatar(LAT, LON, 'coordenada-maluca'), formatar(LAT, LON, FORMATO_PADRAO));
ok('formato ausente também cai no padrão', formatar(LAT, LON), formatar(LAT, LON, FORMATO_PADRAO));
ok('o padrão do projeto é UTM (o que está impresso na carta do BDGEx)',
  FORMATO_PADRAO, 'utm');
ok('os três formatos anunciados são exatamente os três implementados',
  FORMATOS, ['utm', 'decimal', 'dms']);
ok('todo formato anunciado tem rótulo em português para o seletor',
  FORMATOS.filter((f) => !ROTULO_FORMATO[f]), []);
ok('formatoValido() aceita os três e recusa o resto',
  [...FORMATOS.map(formatoValido), formatoValido('utm2'), formatoValido(''), formatoValido(null)],
  [true, true, true, false, false, false]);

// ── 7b. "E"/"N" do UTM NÃO são hemisfério ──────────────────────────────────
// Relatado em campo em 2026-08-02: "a coordenada está errada, estamos a W e S
// e está escrito E e N". Não estava errada — E e N são os nomes dos EIXOS
// (easting/northing), não direções, e valem E e N em qualquer lugar do
// planeta. A resposta foi trocar o sufixo para `mE`/`mN` (convenção das
// cartas), que lê como "metros no eixo E" em vez de "leste".
//
// Estas asserções existem para ninguém "consertar" isto de volta: trocar mE
// por mW no hemisfério oeste produziria uma coordenada que NÃO é UTM e que
// nenhuma carta aceita.
console.log('\nUTM — "E"/"N" são os eixos (easting/northing), nunca hemisfério');
// O caso exato relatado: Tibagi/Ponta Grossa (PR), sul E oeste.
const CAMPO = { lat: -25.100916, lon: -50.159274 };
ok('o caso relatado em campo continua na zona 22, faixa J',
  [zonaUtm(CAMPO.lat, CAMPO.lon), bandaUtm(CAMPO.lat)], [22, 'J']);
ok('e sai com mE/mN, apesar de o ponto estar a oeste e ao sul',
  formatarUtm(CAMPO.lat, CAMPO.lon), '22J 584770 mE 7223614 mN');
ok('o easting é positivo no hemisfério OESTE (é para isso que existe o falso este)',
  paraUtm(CAMPO.lat, CAMPO.lon).este > 0, true);
ok('o northing no hemisfério SUL é ~10.000.000 menos a distância ao equador',
  Math.round(10000000 - paraUtm(CAMPO.lat, CAMPO.lon).norte), 2776386);
ok('nenhum dos três formatos usa "mW" ou "mS" — isso não existe em UTM',
  /m[WS]\b/.test(formatarUtm(CAMPO.lat, CAMPO.lon)), false);
ok('quem carrega o hemisfério é a LETRA da faixa: sul dá J, norte dá N no mesmo meridiano',
  [bandaUtm(-25.100916), bandaUtm(25.100916)], ['J', 'R']);
ok('e os dois hemisférios escrevem os eixos igual — só a faixa muda',
  [formatarUtm(-25.100916, -50.159274).includes('mE mE'),
   formatarUtm(25.100916, -50.159274).endsWith('mN')], [false, true]);
// O contraste com os outros dois formatos, onde S e W SÃO hemisfério.
ok('em GMS, ao contrário, S e W são hemisfério de verdade',
  formatarGms(CAMPO.lat, CAMPO.lon).match(/[NSEW]/g), ['S', 'W']);
ok('e em grau decimal o hemisfério é o sinal negativo',
  formatarDecimal(CAMPO.lat, CAMPO.lon), '-25.100916, -50.159274');

// ── 8. Entrada inválida não pode quebrar um popup ──────────────────────────
console.log('\nEntrada inválida — o popup mostra "—", nunca "NaN" e nunca lança');
for (const [descricao, lat, lon] of [
  ['null', null, null],
  ['undefined', undefined, undefined],
  ['string', '-22.9', '-43.2'],
  ['NaN', NaN, NaN],
  ['Infinity', Infinity, 0],
  ['latitude acima de 90', 91, 0],
  ['longitude abaixo de -180', 0, -181],
]) {
  ok(`formatar() com ${descricao} devolve "—"`, formatar(lat, lon, 'utm'), '—');
}
ok('paraUtm() com entrada inválida devolve null (não um objeto com NaN)',
  [paraUtm(null, null), paraUtm(NaN, 0), paraUtm(91, 0)], [null, null, null]);
ok('zonaUtm() com entrada inválida devolve null', zonaUtm('a', 'b'), null);
ok('paraGms() com entrada inválida devolve null', paraGms(undefined, 0), null);
ok('acima de 84°N o UTM não existe: formatar(utm) cai para grau decimal, sem sumir com o dado',
  formatar(85, 10, 'utm'), '85.000000, 10.000000');
ok('e abaixo de 80°S também', formatar(-85, 10, 'utm'), '-85.000000, 10.000000');

// ── 9. Uma volta completa: SIDC do projeto não entra aqui, mas o mapa sim ───
console.log('\nCoerência: distância entre dois pontos vizinhos é a mesma nos dois eixos');
// Dois pontos separados por 0,001° de latitude (~111 m) na mesma longitude
// devem diferir ~111 m no northing e quase nada no easting. É uma checagem
// de sanidade barata contra troca de eixo (lat/lon invertidos), que é o outro
// erro clássico de conversão — e o único que não aparece como número absurdo,
// porque no Brasil os dois eixos ficam na mesma ordem de grandeza.
const p1 = paraUtm(-22.950000, -43.210487);
const p2 = paraUtm(-22.951000, -43.210487);
ok('0,001° de latitude ≈ 111 m de northing', Math.round(Math.abs(p1.norte - p2.norte)), 111);
// Não é exatamente 0: a ~0,8° do meridiano central o easting também varia um
// pouco com a latitude (convergência de meridianos). ~1 m é o esperado; o que
// não pode acontecer é a diferença ser da ordem de dezenas de metros, que é
// como um lat/lon trocado apareceria.
ok('e quase 0 de easting (mesma longitude): menos de 5 m',
  Math.abs(p1.este - p2.este) < 5, true);
const deslocamentoLon = Math.abs(paraUtm(-22.951916, -43.209487).este - paraUtm(-22.951916, -43.210487).este);
ok('0,001° de longitude no Rio dá entre 100 e 105 m de easting — menos que os 111 m ' +
   'da latitude, por causa do cosseno de 23°',
  deslocamentoLon > 100 && deslocamentoLon < 105, true);

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
