// Teste de frontend/grade.js.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/grade.teste.mjs
//
// O QUE ESTE TESTE PROTEGE
// ------------------------
// A grade erra em silêncio. Uma quadrícula desenhada com o passo errado, ou
// com uma linha do fuso vizinho no meio, continua PARECENDO uma quadrícula —
// e quem estiver lendo coordenada na tela vai ditar um número errado no rádio
// sem nada na tela sugerindo problema. É a mesma família do vazamento entre
// forças: não parece defeito, parece informação.
//
// Então os casos aqui não são sobre "desenhou?". São sobre:
//   1. o PISO de 1 km, que foi pedido explicitamente;
//   2. o TETO de linhas, que é o que impede o celular de travar;
//   3. a EXTENSÃO DE ZONA, que é o caso Rosário do Sul / Santa Maria;
//   4. o RÓTULO em dígitos principais, que é a convenção da carta.
//
// As coordenadas usadas são as duas áreas de exercício de verdade: Ponta
// Grossa/PR (zona 22J) e Rosário do Sul/RS (zona 21J).

import {
  grade, passoUtm, passoGeo, rotuloUtm, rotuloGeo, linhasAlvo, modoValido,
  PASSOS_UTM_M, PASSOS_GEO_MIN, TETO_LINHAS, VERTICES_UTM, MODOS,
} from './grade.js';

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

// Ponta Grossa, caixa de ~11 km x 15 km
const PG = { sul: -25.15, oeste: -50.25, norte: -25.05, leste: -50.10 };
// Rosário do Sul, caixa pequena, bem dentro da zona 21
const RS = { sul: -30.30, oeste: -54.96, norte: -30.20, leste: -54.86 };
// Caixa que ATRAVESSA a fronteira 21/22 (54° W): Rosário do Sul até além dela
const CRUZA = { sul: -30.40, oeste: -55.10, norte: -29.60, leste: -53.60 };

// ── 1. Modo ─────────────────────────────────────────────────────────────────
console.log('\nModo: off e entrada inválida devolvem o mesmo formato vazio');
ok('os três modos são off, utm e geo', MODOS, ['off', 'utm', 'geo']);
ok('modo off devolve nenhuma linha', grade({ modo: 'off', limites: PG, larguraPx: 390 }).linhas, []);
ok('modo desconhecido não quebra', grade({ modo: 'xpto', limites: PG, larguraPx: 390 }).modo, 'off');
ok('sem limites não quebra', grade({ modo: 'utm', larguraPx: 390 }).linhas, []);
ok('limites invertidos (norte abaixo do sul) não quebra',
  grade({ modo: 'utm', limites: { sul: -25, oeste: -50, norte: -26, leste: -49 }, larguraPx: 390 }).linhas, []);
ok('limites com NaN não quebra',
  grade({ modo: 'utm', limites: { sul: NaN, oeste: -50, norte: -25, leste: -49 }, larguraPx: 390 }).linhas, []);
ok('sem argumento nenhum', grade().linhas, []);
ok('modoValido aceita os três e recusa o resto',
  [modoValido('utm'), modoValido('geo'), modoValido('off'), modoValido('UTM'), modoValido(null)],
  [true, true, true, false, false]);

// ── 2. O PISO DE 1 KM ───────────────────────────────────────────────────────
console.log('\nO piso de 1 km, que foi pedido: nenhum zoom produz passo menor');
ok('a lista de passos começa em 1000 m — o piso é estrutural', PASSOS_UTM_M[0], 1000);
{
  // Caixas cada vez menores, até ~20 m de largura. Em nenhuma o passo cede.
  const larguras = [0.2, 0.05, 0.01, 0.002, 0.0005, 0.0002];
  const passos = larguras.map((d) => grade({
    modo: 'utm',
    limites: { sul: -25.1, oeste: -50.2, norte: -25.1 + d, leste: -50.2 + d },
    larguraPx: 390,
  }).passoM);
  ok(`caixas de ${larguras.join('°, ')}° nunca descem de 1 km`, passos.every((p) => p >= 1000), true);
  ok('e nas menores o passo é exatamente o piso', passos.slice(-3), [1000, 1000, 1000]);
}
ok('passoUtm de uma largura absurda de pequena devolve o piso', passoUtm(5, 6), 1000);
ok('passoUtm de largura inválida devolve o piso', passoUtm(NaN, 6), 1000);
ok('passoUtm de 60 km com alvo 6 dá 10 km', passoUtm(60000, 6), 10000);
ok('passoUtm de 12 km com alvo 6 dá 2 km', passoUtm(12000, 6), 2000);
ok('passoUtm gigantesco satura no último passo da lista',
  passoUtm(100000000, 6), PASSOS_UTM_M[PASSOS_UTM_M.length - 1]);

// ── 3. O alvo de linhas sai da largura da tela ──────────────────────────────
console.log('\nQuantas linhas caber é função da largura em pixels');
ok('celular estreito pede 4', linhasAlvo(390), 4);
ok('tablet pede mais', linhasAlvo(820) > linhasAlvo(390), true);
ok('monitor satura em 12', linhasAlvo(4000), 12);
ok('largura inválida não quebra', linhasAlvo(NaN) > 0, true);
{
  const estreito = grade({ modo: 'utm', limites: PG, larguraPx: 390 }).passoM;
  const largo = grade({ modo: 'utm', limites: PG, larguraPx: 1800 }).passoM;
  ok('a MESMA área num monitor usa passo menor que num celular', largo <= estreito, true);
}

// ── 4. O TETO de linhas ─────────────────────────────────────────────────────
console.log('\nO teto: o passo SOBE até caber, em vez de a grade ser cortada');
{
  // Meio continente: com 1 km seriam milhares de linhas.
  const g = grade({
    modo: 'utm',
    limites: { sul: -33, oeste: -53.9, norte: -20, leste: -48.1 },
    larguraPx: 1800,
  });
  const nE = g.linhas.filter((l) => l.eixo === 'E').length;
  const nN = g.linhas.filter((l) => l.eixo === 'N').length;
  ok('nenhum eixo passa do teto', nE <= TETO_LINHAS && nN <= TETO_LINHAS, true);
  ok('e ainda sobrou grade para desenhar', nE > 0 && nN > 0, true);
  ok('o passo subiu bem acima do piso', g.passoM > 1000, true);
  ok('o rótulo do passo diz qual passo é mesmo', g.rotuloPasso, `${g.passoM / 1000} km`);
}

// ── 5. EXTENSÃO DE ZONA — o caso Rosário do Sul / Santa Maria ───────────────
console.log('\nTela cruzando a fronteira 21/22: a grade continua de UMA zona só');
{
  const dentro = grade({ modo: 'utm', limites: RS, larguraPx: 390 });
  ok('caixa inteira dentro da zona 21: não acusa cruzamento', dentro.cruzaZona, false);
  ok('e a zona é a 21', dentro.zona, 21);
  ok('com a banda J', dentro.banda, 'J');

  const g = grade({ modo: 'utm', limites: CRUZA, larguraPx: 1200 });
  ok('caixa atravessando 54° W ACUSA o cruzamento', g.cruzaZona, true);
  ok('e desenha na zona do centro, uma só', typeof g.zona === 'number', true);

  // A guarda que importa: sem forçar a zona, um canto do outro lado voltaria
  // com este ~500 km diferente e apareceria um salto no meio da tela.
  const estes = g.linhas.filter((l) => l.eixo === 'E').map((l) => l.valor);
  const saltos = [];
  for (let i = 1; i < estes.length; i++) saltos.push(estes[i] - estes[i - 1]);
  ok('os valores de este são igualmente espaçados — nenhum salto de fuso',
    saltos.every((s) => Math.abs(s - g.passoM) < 1e-6), true);
  ok('e são crescentes', estes.every((v, i) => i === 0 || v > estes[i - 1]), true);
}

// ── 6. Geometria das linhas ────────────────────────────────────────────────
console.log('\nLinha UTM é inclinada; linha geográfica é reta');
{
  const g = grade({ modo: 'utm', limites: PG, larguraPx: 390 });
  const linhaE = g.linhas.find((l) => l.eixo === 'E');
  ok(`linha de este tem ${VERTICES_UTM} vértices`, linhaE.pontos.length, VERTICES_UTM);
  const lons = linhaE.pontos.map((p) => p[1]);
  // Se a longitude fosse constante, a linha seria um meridiano — e aí não
  // seria uma linha de este constante. A variação É a convergência meridiana.
  ok('e a longitude VARIA ao longo dela (convergência meridiana)',
    Math.max(...lons) - Math.min(...lons) > 1e-5, true);
  ok('todos os vértices têm latitude e longitude finitas',
    g.linhas.every((l) => l.pontos.every(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo))), true);
}
{
  const g = grade({ modo: 'geo', limites: PG, larguraPx: 390 });
  const linhaLon = g.linhas.find((l) => l.eixo === 'lon');
  ok('linha de longitude tem 2 vértices (é reta no 3857)', linhaLon.pontos.length, 2);
  ok('e a longitude é a MESMA nos dois', linhaLon.pontos[0][1], linhaLon.pontos[1][1]);
  const linhaLat = g.linhas.find((l) => l.eixo === 'lat');
  ok('linha de latitude também', linhaLat.pontos[0][0], linhaLat.pontos[1][0]);
  ok('modo geo não tem zona', g.zona, null);
  ok('e o passo vem em minuto', PASSOS_GEO_MIN.includes(g.passoMin), true);
}
ok('passoGeo de 1 grau com alvo 6 dá 10 minutos', passoGeo(1, 6), 10);
ok('passoGeo nunca desce do primeiro da lista', passoGeo(0.0001, 6), PASSOS_GEO_MIN[0]);

// ── 7. Rótulos ─────────────────────────────────────────────────────────────
console.log('\nRótulo UTM: os dígitos principais, como na margem da carta');
ok('584 000 m com passo de 1 km vira "84"', rotuloUtm(584000, 1000), '84');
ok('580 000 m vira "80"', rotuloUtm(580000, 1000), '80');
ok('600 000 m vira "00", com o zero à esquerda', rotuloUtm(600000, 1000), '00');
ok('7 224 000 m (norte) vira "24"', rotuloUtm(7224000, 1000), '24');
ok('acima de 100 km de passo o rótulo passa a ser o quilômetro cheio',
  rotuloUtm(584000, 100000), '584');
ok('valor inválido devolve vazio, nunca "NaN"', rotuloUtm(NaN, 1000), '');
{
  const g = grade({ modo: 'utm', limites: PG, larguraPx: 390 });
  ok('todo rótulo da grade tem 2 caracteres com passo abaixo de 100 km',
    g.linhas.every((l) => l.rotulo.length === 2), true);
}

console.log('\nRótulo geográfico: grau e minuto, com hemisfério');
ok('-25 vira 25°S', rotuloGeo(-25, 'lat'), '25°S');
ok('-25,5 vira 25°30\'S', rotuloGeo(-25.5, 'lat'), "25°30'S");
ok('-50,25 vira 50°15\'W', rotuloGeo(-50.25, 'lon'), "50°15'W");
ok('positivo no norte', rotuloGeo(2.5, 'lat'), "2°30'N");
ok('positivo no leste', rotuloGeo(10, 'lon'), '10°E');
ok('o arredondamento do minuto não produz 60', rotuloGeo(-24.99999, 'lat'), '25°S');
ok('valor inválido devolve vazio', rotuloGeo(undefined, 'lat'), '');

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
