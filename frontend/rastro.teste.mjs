// Teste de frontend/rastro.js — Etapa 6b.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/rastro.teste.mjs
//
// O que ele prova: que o replay do debriefing só afirma o que o dado
// sustenta. Um erro aqui não aparece como tela quebrada — aparece como um
// rastro plausível e errado, que alguém vai apontar numa sala de debriefing
// como se fosse fato. Os três casos que este arquivo existe para travar:
//
//   1. a interpolação suaviza o movimento ENTRE duas leituras próximas, mas
//      NUNCA atravessa uma perda de sinal (o símbolo para, esmaece e some);
//   2. a trilha desenhada não liga em linha reta dois trechos separados por
//      silêncio — nem no cálculo da distância percorrida;
//   3. a busca binária devolve o ponto vigente, e não o seguinte, inclusive
//      nas bordas (antes do primeiro ponto, exatamente em cima de um ponto,
//      depois do último).

import {
  GAP_ESMAECER_MS,
  GAP_SEM_SINAL_MS,
  INTERVALO_MINIMO_S,
  ALVO_PONTOS_TOTAL,
  calcularIntervaloAmostragem,
  rotuloIntervalo,
  montarTrilhas,
  janelaDasTrilhas,
  indiceAntesDe,
  segmentar,
  posicaoNoInstante,
  trechoAte,
  distanciaMetros,
  distanciaTrilhaM,
} from './rastro.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = Object.is(obtido, esperado);
  bom ? passou++ : falhou++;
  const marca = bom ? 'PASSOU' : '** FALHOU **';
  console.log(`  ${marca.padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado: ${esperado}\n                 obtido:   ${obtido}`);
}

function perto(descricao, obtido, esperado, tolerancia) {
  const bom = Number.isFinite(obtido) && Math.abs(obtido - esperado) <= tolerancia;
  bom ? passou++ : falhou++;
  const marca = bom ? 'PASSOU' : '** FALHOU **';
  console.log(`  ${marca.padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado: ${esperado} (±${tolerancia})\n                 obtido:   ${obtido}`);
}

// Base de tempo redonda, para as contas do teste ficarem legíveis.
const T0 = Date.parse('2026-07-31T13:00:00.000Z');
const s = (n) => T0 + n * 1000;

// ── Amostragem: o cálculo que decide quantas linhas o banco devolve ────────
console.log('\ncalcularIntervaloAmostragem(duracaoS, alunos) — a defesa contra o volume');
ok('janela curta com 1 aluno cai no piso de 5s (o INTERVALO_MIN de gps.js)',
  calcularIntervaloAmostragem(600, 1), INTERVALO_MINIMO_S);
ok('nunca devolve menos que o piso, nem para janela de 1 segundo',
  calcularIntervaloAmostragem(1, 1), INTERVALO_MINIMO_S);
ok('4h com 1 aluno: 15s (limitado pelo alvo POR ALUNO)',
  calcularIntervaloAmostragem(4 * 3600, 1), 15);
ok('1h com a turma inteira (60): 30s',
  calcularIntervaloAmostragem(3600, 60), 30);
ok('4h com a turma inteira (60): 120s',
  calcularIntervaloAmostragem(4 * 3600, 60), 120);
ok('sempre devolve um valor da lista de passos sugeridos',
  [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].includes(
    calcularIntervaloAmostragem(7 * 3600, 37)), true);

// A invariante de que depende a estratégia de busca em lotes de debriefing.js:
// com a resolução AUTOMÁTICA, nenhum aluno sozinho passa de uma página do
// PostgREST (1000 linhas). Se isto quebrar, a busca por lotes volta a precisar
// de paginação por deslocamento — que reexecuta a função a cada página.
console.log('\nnenhum aluno passa de uma página (1000) com resolução automática');
let piorPorAluno = 0;
for (const horas of [0.25, 0.5, 1, 2, 4, 8, 12, 24]) {
  for (const qtd of [1, 2, 5, 20, 60, 120]) {
    const duracao = horas * 3600;
    piorPorAluno = Math.max(
      piorPorAluno,
      Math.ceil(duracao / calcularIntervaloAmostragem(duracao, qtd))
    );
  }
}
ok(`pior caso por aluno cabe numa página (${piorPorAluno} <= 1000)`, piorPorAluno <= 1000, true);

// A afirmação que justifica a etapa inteira: o número de pontos fica limitado
// por mais que se aumente a janela ou o número de alunos.
console.log('\no teto de pontos vale para qualquer combinação razoável');
let piorCaso = 0;
for (const horas of [0.5, 1, 2, 4, 8, 12]) {
  for (const alunos of [1, 5, 20, 60, 120]) {
    const duracao = horas * 3600;
    const passo = calcularIntervaloAmostragem(duracao, alunos);
    piorCaso = Math.max(piorCaso, Math.ceil(duracao / passo) * alunos);
  }
}
ok(`pior caso varrido fica dentro de ALVO_PONTOS_TOTAL (${piorCaso} <= ${ALVO_PONTOS_TOTAL})`,
  piorCaso <= ALVO_PONTOS_TOTAL, true);

console.log('\nrotuloIntervalo()');
ok('30 -> "30 s"',    rotuloIntervalo(30), '30 s');
ok('60 -> "1 min"',   rotuloIntervalo(60), '1 min');
ok('120 -> "2 min"',  rotuloIntervalo(120), '2 min');
ok('3600 -> "1 h"',   rotuloIntervalo(3600), '1 h');
ok('90 -> "1 min 30 s"', rotuloIntervalo(90), '1 min 30 s');

// ── Montagem das trilhas ───────────────────────────────────────────────────
console.log('\nmontarTrilhas() — agrupa por aluno e garante a ordem no tempo');
const LINHAS = [
  // De propósito FORA de ordem e com um aluno intercalado: o resto do módulo
  // pressupõe ordem crescente, e é montarTrilhas quem tem de garantir isso.
  { usuario_id: 'a', medido_em: '2026-07-31T13:00:30.000Z', latitude: -22.0001, longitude: -47.0000, leituras_no_balde: 2 },
  { usuario_id: 'b', medido_em: '2026-07-31T13:00:00.000Z', latitude: -23.0000, longitude: -46.0000, leituras_no_balde: 1 },
  { usuario_id: 'a', medido_em: '2026-07-31T13:00:00.000Z', latitude: -22.0000, longitude: -47.0000, leituras_no_balde: 3 },
  { usuario_id: 'a', medido_em: '2026-07-31T13:01:00.000Z', latitude: -22.0002, longitude: -47.0000, leituras_no_balde: 1 },
];
const trilhas = montarTrilhas(LINHAS);
ok('separa por usuario_id', trilhas.size, 2);
ok('ordena no tempo mesmo recebendo fora de ordem',
  trilhas.get('a').pontos.map((p) => p.t - T0).join(','), '0,30000,60000');
ok('soma as leituras brutas que os pontos representam',
  trilhas.get('a').leiturasBrutas, 6);
ok('registra o início da trilha', trilhas.get('a').inicio, s(0));
ok('registra o fim da trilha', trilhas.get('a').fim, s(60));
ok('leituras_no_balde ausente conta como 1',
  montarTrilhas([{ usuario_id: 'x', medido_em: '2026-07-31T13:00:00.000Z', latitude: 1, longitude: 2 }])
    .get('x').leiturasBrutas, 1);
ok('linha com coordenada nula é descartada (NaN quebraria a interpolação)',
  montarTrilhas([{ usuario_id: 'x', medido_em: '2026-07-31T13:00:00.000Z', latitude: null, longitude: 2 }]).size, 0);
ok('linha com carimbo ilegível é descartada',
  montarTrilhas([{ usuario_id: 'x', medido_em: 'ontem', latitude: 1, longitude: 2 }]).size, 0);
ok('carimbo repetido é colapsado (divisão por zero na interpolação)',
  montarTrilhas([
    { usuario_id: 'x', medido_em: '2026-07-31T13:00:00.000Z', latitude: 1, longitude: 2 },
    { usuario_id: 'x', medido_em: '2026-07-31T13:00:00.000Z', latitude: 1.5, longitude: 2 },
  ]).get('x').pontos.length, 1);

const janela = janelaDasTrilhas(trilhas);
ok('janelaDasTrilhas pega o menor início entre os alunos', janela.inicio, s(0));
ok('janelaDasTrilhas pega o maior fim entre os alunos', janela.fim, s(60));
ok('janelaDasTrilhas devolve null sem nenhum ponto', janelaDasTrilhas(new Map()), null);

// ── Busca binária ──────────────────────────────────────────────────────────
console.log('\nindiceAntesDe() — o ponto VIGENTE, não o seguinte');
const P = [
  { t: s(0),  lat: 0, lon: 0 },
  { t: s(30), lat: 0, lon: 0 },
  { t: s(60), lat: 0, lon: 0 },
  { t: s(90), lat: 0, lon: 0 },
];
ok('antes do primeiro ponto -> -1',        indiceAntesDe(P, s(-1)), -1);
ok('exatamente no primeiro ponto -> 0',    indiceAntesDe(P, s(0)), 0);
ok('entre dois pontos -> o anterior',      indiceAntesDe(P, s(45)), 1);
ok('exatamente em cima de um ponto -> ele mesmo (não o seguinte)',
  indiceAntesDe(P, s(60)), 2);
ok('depois do último ponto -> o último',   indiceAntesDe(P, s(999)), 3);
ok('lista vazia -> -1',                    indiceAntesDe([], s(0)), -1);

// ── Segmentação por perda de sinal ─────────────────────────────────────────
console.log('\nsegmentar() — silêncio não é trecho percorrido');
const COM_BURACO = [
  { t: s(0),   lat: -22.000, lon: -47.000 },
  { t: s(30),  lat: -22.001, lon: -47.000 },
  // 10 minutos sem nada: o app do aluno fechou, ou a rede caiu.
  { t: s(630), lat: -22.050, lon: -47.000 },
  { t: s(660), lat: -22.051, lon: -47.000 },
];
const segs = segmentar(COM_BURACO);
ok('quebra em dois trechos', segs.length, 2);
ok('primeiro trecho com 2 pontos', segs[0].length, 2);
ok('segundo trecho com 2 pontos', segs[1].length, 2);
ok('trilha contínua fica num trecho só', segmentar(P).length, 1);
ok('intervalo exatamente no limiar ainda é contínuo (o corte é > , não >=)',
  segmentar([{ t: s(0), lat: 0, lon: 0 }, { t: s(0) + GAP_SEM_SINAL_MS, lat: 0, lon: 0 }]).length, 1);

// ── Reconstituição no instante ─────────────────────────────────────────────
console.log('\nposicaoNoInstante() — interpola entre leituras próximas');
const RETA = [
  { t: s(0),  lat: -22.0000, lon: -47.0000 },
  { t: s(30), lat: -22.0100, lon: -47.0000 },
];
ok('antes do primeiro ponto -> null (ainda não entrou em cena)',
  posicaoNoInstante(RETA, s(-1)), null);
ok('lista vazia -> null', posicaoNoInstante([], s(0)), null);
perto('no meio do caminho, latitude interpolada',
  posicaoNoInstante(RETA, s(15)).lat, -22.005, 1e-9);
ok('no meio do caminho, marcado como interpolado',
  posicaoNoInstante(RETA, s(15)).interpolado, true);
ok('em cima do primeiro ponto NÃO conta como interpolado (fração 0)',
  posicaoNoInstante(RETA, s(0)).interpolado, false);
perto('em cima do primeiro ponto, a posição é a gravada',
  posicaoNoInstante(RETA, s(0)).lat, -22.0000, 1e-12);
ok('interpolar:false segura no último ponto conhecido',
  posicaoNoInstante(RETA, s(15), { interpolar: false }).lat, -22.0000);
ok('interpolar:false marca a idade do ponto segurado',
  posicaoNoInstante(RETA, s(15), { interpolar: false }).idade, 15000);

console.log('\nposicaoNoInstante() — e NUNCA atravessa uma perda de sinal');
// Este é o teste central do arquivo. Sem ele, o símbolo desliza suavemente
// por 10 minutos de silêncio como se o aluno tivesse andado em linha reta.
ok('dentro de um buraco, a posição fica PARADA no último ponto conhecido',
  posicaoNoInstante(COM_BURACO, s(300)).lat, -22.001);
ok('e é explicitamente marcada como NÃO interpolada',
  posicaoNoInstante(COM_BURACO, s(300)).interpolado, false);
ok('logo depois do último ponto, ainda "ok"',
  posicaoNoInstante(COM_BURACO, s(30) + 1000).estado, 'ok');
ok(`passando de GAP_ESMAECER_MS (${GAP_ESMAECER_MS / 1000}s), esmaece`,
  posicaoNoInstante(COM_BURACO, s(30) + GAP_ESMAECER_MS).estado, 'esmaecido');
ok(`passando de GAP_SEM_SINAL_MS (${GAP_SEM_SINAL_MS / 1000}s), some do mapa`,
  posicaoNoInstante(COM_BURACO, s(30) + GAP_SEM_SINAL_MS).estado, 'sem_sinal');
ok('do outro lado do buraco, volta a ser posição confiável',
  posicaoNoInstante(COM_BURACO, s(645)).estado, 'ok');
ok('e volta a interpolar do outro lado do buraco',
  posicaoNoInstante(COM_BURACO, s(645)).interpolado, true);
ok('depois do ÚLTIMO ponto da trilha, envelhece igual (não fica "ok" para sempre)',
  posicaoNoInstante(COM_BURACO, s(660) + GAP_SEM_SINAL_MS).estado, 'sem_sinal');
ok('mesmo "sem_sinal", devolve o último ponto conhecido (não devolve null)',
  posicaoNoInstante(COM_BURACO, s(660) + GAP_SEM_SINAL_MS).lat, -22.051);

// ── Trecho já percorrido ───────────────────────────────────────────────────
console.log('\ntrechoAte() — a linha que cresce junto com o símbolo');
ok('antes do começo, nenhum trecho', trechoAte(COM_BURACO, s(-1)).length, 0);
ok('no meio do primeiro trecho, um segmento só', trechoAte(COM_BURACO, s(15)).length, 1);
ok('e ele tem o ponto inicial + a ponta interpolada',
  trechoAte(COM_BURACO, s(15))[0].length, 2);
ok('depois do buraco, dois segmentos separados (não liga em linha reta)',
  trechoAte(COM_BURACO, s(660)).length, 2);
ok('dentro do buraco, só o primeiro segmento existe',
  trechoAte(COM_BURACO, s(300)).length, 1);
ok('e ele não ganha ponta interpolada dentro do buraco',
  trechoAte(COM_BURACO, s(300))[0].length, 2);

// ── Distância ──────────────────────────────────────────────────────────────
console.log('\ndistancia — o buraco não conta como caminho andado');
perto('1 grau de latitude ≈ 111,2 km',
  distanciaMetros({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111_195, 200);
perto('dois pontos iguais -> 0 m',
  distanciaMetros({ lat: -22, lon: -47 }, { lat: -22, lon: -47 }), 0, 1e-6);
// Os dois trechos de COM_BURACO somam 0,001 + 0,001 grau de latitude ≈ 222 m.
// A reta que atravessa o buraco teria mais de 5 km — é essa a diferença que o
// teste trava.
perto('soma só os trechos contínuos (≈222 m, não os >5 km da reta do buraco)',
  distanciaTrilhaM(COM_BURACO), 222, 10);
ok('trilha vazia -> 0', distanciaTrilhaM([]), 0);
ok('trilha de um ponto só -> 0', distanciaTrilhaM([{ t: s(0), lat: 1, lon: 1 }]), 0);

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
