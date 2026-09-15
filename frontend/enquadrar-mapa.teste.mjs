// Teste de frontend/enquadrar-mapa.js (2026-09-15).
//
//     node frontend/enquadrar-mapa.teste.mjs
//
// O caso que este arquivo existe para travar é o DEGENERADO: todos os pontos
// praticamente no mesmo lugar. `fitBounds` numa caixa de área zero devolve o
// zoom máximo, e a tela vira um quadrado de 20 metros — que é exatamente o que
// aconteceria na formatura do início do exercício, com a turma inteira parada
// no mesmo pátio. Se alguém "simplificar" isto para um fitBounds direto, é
// aqui que quebra.

import {
  planejarEnquadramento, CENTRO_PADRAO, ZOOM_PADRAO, ZOOM_PONTO,
  TOLERANCIA_MESMO_PONTO,
} from './enquadrar-mapa.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = obtido === esperado;
  bom ? passou++ : falhou++;
  console.log(`  ${(bom ? 'PASSOU' : '** FALHOU **').padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado: ${JSON.stringify(esperado)}\n                 obtido:   ${JSON.stringify(obtido)}`);
}

const P = (lat, lon) => ({ lat, lon });

console.log('\nNada a enquadrar');
ok('lista vazia devolve null', planejarEnquadramento([]), null);
ok('null devolve null', planejarEnquadramento(null), null);
ok('undefined devolve null', planejarEnquadramento(undefined), null);
ok('não-array devolve null', planejarEnquadramento('abc'), null);
ok('só pontos inválidos devolve null',
  planejarEnquadramento([{ lat: null, lon: null }, { lat: NaN, lon: 0 }]), null);
ok('latitude fora da faixa é descartada',
  planejarEnquadramento([P(91, -50)]), null);
ok('longitude fora da faixa é descartada',
  planejarEnquadramento([P(-25, 181)]), null);

console.log('\nUm ponto só');
{
  const r = planejarEnquadramento([P(-25.09, -50.16)]);
  ok('vira "ponto"', r.tipo, 'ponto');
  ok('na coordenada dele', r.lat, -25.09);
  ok('e com zoom de ponto', r.zoom, ZOOM_PONTO);
}
// Zero é coordenada legítima e não pode cair num `if (!lat)`.
ok('lat/lon zero é ponto válido', planejarEnquadramento([P(0, 0)]).tipo, 'ponto');

console.log('\nO caso degenerado — a turma toda no mesmo pátio');
{
  // Cinco pessoas formadas, dentro do erro do GPS. `fitBounds` aqui daria
  // zoom máximo e a tela viraria um quadrado de 20 metros.
  const r = planejarEnquadramento([
    P(-25.0900, -50.1600), P(-25.0901, -50.1601), P(-25.0900, -50.1599),
    P(-25.0899, -50.1600), P(-25.0901, -50.1600),
  ]);
  ok('NÃO vira área', r.tipo, 'ponto');
  ok('o ponto é o meio da nuvem (lat)', Math.abs(r.lat - (-25.09)) < 0.0002, true);
  ok('o ponto é o meio da nuvem (lon)', Math.abs(r.lon - (-50.16)) < 0.0002, true);
}
{
  // Exatamente na tolerância ainda conta como o mesmo lugar...
  const r = planejarEnquadramento([P(-25, -50), P(-25 + TOLERANCIA_MESMO_PONTO / 2, -50)]);
  ok('metade da tolerância ainda é "ponto"', r.tipo, 'ponto');
}
{
  // ...e um pouco além já é área.
  const r = planejarEnquadramento([P(-25, -50), P(-25 + TOLERANCIA_MESMO_PONTO * 2, -50)]);
  ok('o dobro da tolerância já é "area"', r.tipo, 'area');
}
{
  // Pontos idênticos são o caso extremo do degenerado.
  const r = planejarEnquadramento([P(-25, -50), P(-25, -50), P(-25, -50)]);
  ok('pontos idênticos viram "ponto"', r.tipo, 'ponto');
  ok('exatamente naquela coordenada', r.lat, -25);
}

console.log('\nPontos espalhados');
{
  const r = planejarEnquadramento([P(-25.2, -50.3), P(-25.0, -50.1), P(-25.1, -50.5)]);
  ok('vira "area"', r.tipo, 'area');
  ok('sul é a menor latitude', r.sul, -25.2);
  ok('norte é a maior latitude', r.norte, -25.0);
  ok('oeste é a menor longitude', r.oeste, -50.5);
  ok('leste é a maior longitude', r.leste, -50.1);
}
{
  // Um ponto inválido no meio não pode contaminar a caixa: se entrasse, o
  // mapa abriria enquadrando o oceano.
  const r = planejarEnquadramento([P(-25.2, -50.3), { lat: NaN, lon: 0 }, P(-25.0, -50.1)]);
  ok('ponto inválido não entra na caixa (sul)', r.sul, -25.2);
  ok('ponto inválido não entra na caixa (norte)', r.norte, -25.0);
}

console.log('\nO padrão continua existindo');
// Ele é o que fica na tela nos segundos antes de chegar a primeira posição.
// Os três mapas o usam; se mudar aqui, muda nos três.
ok('o centro padrão tem dois números', CENTRO_PADRAO.length, 2);
ok('e é o mesmo que estava escrito à mão', `${CENTRO_PADRAO[0]},${CENTRO_PADRAO[1]}`, '-22,-47');
ok('o zoom padrão é 10', ZOOM_PADRAO, 10);
// O zoom de ponto tem que ser MAIS fechado que o padrão — senão enquadrar
// numa pessoa afastaria a câmera em vez de aproximar.
ok('o zoom de ponto é mais fechado que o padrão', ZOOM_PONTO > ZOOM_PADRAO, true);

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
