// Teste de frontend/dispersar-avatares.js
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/dispersar-avatares.teste.mjs
//
// O que ele prova: pontos isolados não mexem; pontos empilhados se separam
// por pelo menos raioDispersaoM; o resultado é DETERMINÍSTICO (mesma entrada,
// qualquer ordem de chegada, mesma saída) — é essa invariante que evita
// avatares "tremendo" na tela a cada posição nova.

import { dispersarPosicoes } from './dispersar-avatares.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = obtido === esperado;
  bom ? passou++ : falhou++;
  const marca = bom ? 'PASSOU' : '** FALHOU **';
  console.log(`  ${marca.padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado: ${esperado}\n                 obtido:   ${obtido}`);
}
function aproxOk(descricao, obtido, esperado, tolerancia = 1e-9) {
  ok(descricao, Math.abs(obtido - esperado) < tolerancia, true);
}

// Distância em metros, mesma fórmula do módulo (reimplementada aqui de
// propósito — se as duas divergirem, o teste é que deve apanhar).
function distM(a, b) {
  const R = 6371000;
  const latMedRad = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dLatM = (b.lat - a.lat) * Math.PI / 180 * R;
  const dLngM = (b.lng - a.lng) * Math.PI / 180 * R * Math.cos(latMedRad);
  return Math.sqrt(dLatM * dLatM + dLngM * dLngM);
}

console.log('\nSem colisão — nada muda');
const isolados = [
  { id: 'a', lat: -22.0, lng: -47.0 },
  { id: 'b', lat: -22.001, lng: -47.001 }, // ~150m de 'a', bem acima do raio de colisão padrão
];
const r1 = dispersarPosicoes(isolados);
ok('ponto A mantém a própria posição', r1.get('a').lat === isolados[0].lat && r1.get('a').lng === isolados[0].lng, true);
ok('ponto B mantém a própria posição', r1.get('b').lat === isolados[1].lat && r1.get('b').lng === isolados[1].lng, true);

console.log('\nLista vazia / entrada inválida');
ok('lista vazia -> Map vazio', dispersarPosicoes([]).size, 0);
ok('undefined -> Map vazio, não lança', dispersarPosicoes(undefined).size, 0);

console.log('\nDois pontos EXATAMENTE na mesma posição (o caso relatado em campo)');
const empilhados = [
  { id: 'joao',   lat: -22.9068, lng: -43.1729 },
  { id: 'maria',  lat: -22.9068, lng: -43.1729 },
];
const r2 = dispersarPosicoes(empilhados, { raioColisaoM: 3, raioDispersaoM: 3 });
const pJoao = r2.get('joao');
const pMaria = r2.get('maria');
ok('os dois pontos existem no resultado', !!pJoao && !!pMaria, true);
ok('depois de dispersar, ficam a pelo menos ~raioDispersaoM*1.5 um do outro (dois pontos num círculo de raio 3 ficam a 6m)',
  distM(pJoao, pMaria) > 4, true);
ok('nenhum dos dois fica exatamente na posição original (ambos precisavam se mexer)',
  !(pJoao.lat === empilhados[0].lat && pJoao.lng === empilhados[0].lng), true);

console.log('\nDeterminismo — mesma entrada, ORDEM DIFERENTE de chegada, mesma saída');
const grupoA = [
  { id: 'alfa', lat: 10, lng: 20 },
  { id: 'bravo', lat: 10, lng: 20 },
  { id: 'charlie', lat: 10.00001, lng: 20 }, // ~1.1m — ainda dentro do raio de colisão padrão
];
const grupoB = [...grupoA].reverse(); // mesmíssimos pontos, ordem invertida
const resA = dispersarPosicoes(grupoA);
const resB = dispersarPosicoes(grupoB);
ok('posição de "alfa" é igual nas duas ordens', resA.get('alfa').lat === resB.get('alfa').lat && resA.get('alfa').lng === resB.get('alfa').lng, true);
ok('posição de "bravo" é igual nas duas ordens', resA.get('bravo').lat === resB.get('bravo').lat && resA.get('bravo').lng === resB.get('bravo').lng, true);
ok('posição de "charlie" é igual nas duas ordens', resA.get('charlie').lat === resB.get('charlie').lat && resA.get('charlie').lng === resB.get('charlie').lng, true);

console.log('\nChamar duas vezes seguidas com a MESMA entrada crua não desloca de novo (sem acúmulo)');
const rep1 = dispersarPosicoes(empilhados);
const rep2 = dispersarPosicoes(empilhados); // a entrada CRUA nunca muda — é essa a regra que os chamadores precisam seguir
ok('resultado idêntico na segunda chamada (mesma entrada crua)',
  rep1.get('joao').lat === rep2.get('joao').lat && rep1.get('joao').lng === rep2.get('joao').lng, true);

console.log('\nGrupo transitivo: A-B perto, B-C perto, A-C longe — ainda vira UM grupo só');
const fileira = [
  { id: 'p1', lat: 0,        lng: 0 },
  { id: 'p2', lat: 0.000018, lng: 0 }, // ~2m de p1
  { id: 'p3', lat: 0.000036, lng: 0 }, // ~2m de p2, ~4m de p1 (fora do raio de colisão de 3m com p1 direto)
];
const r3 = dispersarPosicoes(fileira, { raioColisaoM: 3, raioDispersaoM: 3 });
const centroX = fileira.reduce((s, p) => s + p.lat, 0) / 3;
ok('os três pontos formam um grupo só (nenhum fica na posição crua original)',
  [...r3.values()].every((p, i) => !(p.lat === fileira[i].lat && p.lng === fileira[i].lng)), true);

console.log('\nGrupo de 4 — todos equidistantes do centro (círculo, não linha)');
const quarteto = [
  { id: 'q1', lat: 0, lng: 0 },
  { id: 'q2', lat: 0, lng: 0 },
  { id: 'q3', lat: 0, lng: 0 },
  { id: 'q4', lat: 0, lng: 0 },
];
const r4 = dispersarPosicoes(quarteto, { raioColisaoM: 3, raioDispersaoM: 5 });
const centro4 = { lat: 0, lng: 0 };
const distancias = [...r4.values()].map((p) => distM(centro4, p));
const todasIguais = distancias.every((d) => Math.abs(d - distancias[0]) < 0.01);
ok('as 4 posições ficam todas à mesma distância do centro (arranjo circular)', todasIguais, true);
aproxOk('a distância do centro bate com raioDispersaoM (5m)', distancias[0], 5, 0.01);

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
