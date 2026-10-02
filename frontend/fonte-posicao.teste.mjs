// Teste de frontend/fonte-posicao.js.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/fonte-posicao.teste.mjs
//
// O QUE ESTE TESTE PROVA, E O QUE NÃO PROVA
// -----------------------------------------
// Prova que a REGRA está certa: o contrato da Leitura, a tradução do modo da
// turma em "o que o cliente pode fazer", a linha que vai para o banco, e a
// decisão de gravar (throttling), que antes vivia solta dentro de `gps.js`
// sem teste nenhum e agora está pinada.
//
// Não prova nada sobre o navegador, sobre o GPS de um aparelho, nem sobre a
// RLS — esta última é da suíte `backend/testes/07_teste_modo_posicao.sql`,
// contra um Postgres de verdade. O último bloco abaixo faz a ponte entre as
// duas: confere que os três valores que este módulo conhece são os MESMOS que
// a migration aceita no `check`. Se alguém mexer num lado só, é aqui que cai.
//
// O tempo é FINGIDO: `agora` entra por parâmetro, como em toque-longo.teste.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MODOS, ORIGENS, MODO_PADRAO,
  INTERVALO_MINIMO_MS, DISTANCIA_MINIMA_M, HEARTBEAT_MS,
  normalizarModo, usaGps, aceitaPosicaoManual, posicaoVemDeFora, origemDeEscrita,
  rotuloOrigem, ehSimulacao, rotuloModo, criarLeitura, leituraDeGeolocation, leituraManual, paraLinhaPosicao,
  distanciaMetros, decidirGravacao,
} from './fonte-posicao.js';

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

const AGORA = 1_760_000_000_000;

// ── 1. Modo ─────────────────────────────────────────────────────────────────
console.log('\nO modo da turma, e o que o cliente faz em cada um');
{
  ok('os três modos', [...MODOS], ['gps', 'manual', 'externa']);
  ok('o padrão é gps', MODO_PADRAO, 'gps');
  ok('modo conhecido passa', normalizarModo('manual'), 'manual');
  ok('null (resposta com erro, turma antiga) vira gps', normalizarModo(null), 'gps');
  ok('undefined vira gps', normalizarModo(undefined), 'gps');
  ok('valor desconhecido vira gps, em vez de parar o rastreamento', normalizarModo('teleporte'), 'gps');
  ok('maiúscula não é modo (a coluna é minúscula)', normalizarModo('GPS'), 'gps');

  ok('gps: lê o GPS do aparelho', [usaGps('gps'), aceitaPosicaoManual('gps'), posicaoVemDeFora('gps')], [true, false, false]);
  ok('manual: não lê GPS, aceita posicionar', [usaGps('manual'), aceitaPosicaoManual('manual'), posicaoVemDeFora('manual')], [false, true, false]);
  ok('externa: nem GPS nem manual, vem de fora', [usaGps('externa'), aceitaPosicaoManual('externa'), posicaoVemDeFora('externa')], [false, false, true]);
  ok('modo desconhecido se comporta como gps', [usaGps('xyz'), aceitaPosicaoManual('xyz')], [true, false]);

  ok('origem de escrita em gps', origemDeEscrita('gps'), 'gps');
  ok('origem de escrita em manual', origemDeEscrita('manual'), 'manual');
  ok('em externa o cliente NÃO escreve posição própria', origemDeEscrita('externa'), null);
  ok('origem de escrita de modo desconhecido é gps', origemDeEscrita(undefined), 'gps');

  ok('só o gps NÃO é simulação', [ehSimulacao('gps'), ehSimulacao('manual'), ehSimulacao('externa')], [false, true, true]);
  ok('modo desconhecido não acende o selo de simulação', ehSimulacao('xyz'), false);
  ok('em gps não há selo', rotuloModo('gps'), '');
  ok('selo do modo manual', rotuloModo('manual'), 'SIMULAÇÃO · posição manual');
  ok('selo do modo externa', rotuloModo('externa'), 'SIMULAÇÃO · posição do simulador');
  ok('selo de modo desconhecido é vazio (como gps)', rotuloModo(null), '');

  ok('rótulo gps', rotuloOrigem('gps'), 'GPS');
  ok('rótulo manual diz que é simulação', rotuloOrigem('manual').includes('simulação'), true);
  ok('rótulo externa', rotuloOrigem('externa'), 'simulador');
  ok('rótulo de origem estranha não quebra', rotuloOrigem('x'), 'origem desconhecida');
}

// ── 2. O contrato da Leitura ────────────────────────────────────────────────
console.log('\nCriar uma Leitura: o que entra, o que é descartado');
{
  const l = criarLeitura(
    { lat: -25.09, lon: -50.16, precisao: 8, altitude: 880, rumo: 90, velocidade: 1.5, instante: 123, origem: 'gps' },
    { agora: AGORA });
  ok('leitura completa', l, { lat: -25.09, lon: -50.16, precisao: 8, altitude: 880, rumo: 90, velocidade: 1.5, instante: 123, origem: 'gps', entidade: null });
  ok('a leitura é imutável', Object.isFrozen(l), true);

  ok('sem latitude, não há leitura', criarLeitura({ lon: -50, origem: 'gps' }), null);
  ok('latitude acima de 90 é descartada', criarLeitura({ lat: 91, lon: 0, origem: 'gps' }), null);
  ok('latitude abaixo de -90 é descartada', criarLeitura({ lat: -91, lon: 0, origem: 'gps' }), null);
  ok('longitude acima de 180 é descartada', criarLeitura({ lat: 0, lon: 181, origem: 'gps' }), null);
  ok('NaN em latitude é descartado', criarLeitura({ lat: NaN, lon: 0, origem: 'gps' }), null);
  ok('string numérica NÃO é coordenada', criarLeitura({ lat: '-25', lon: '-50', origem: 'gps' }), null);
  ok('os extremos válidos passam', criarLeitura({ lat: 90, lon: -180, origem: 'gps' }, { agora: AGORA }) !== null, true);
  ok('origem que o banco não conhece é descartada', criarLeitura({ lat: 0, lon: 0, origem: 'teleporte' }), null);
  ok('sem origem não há leitura (ninguém grava posição sem dizer de onde)', criarLeitura({ lat: 0, lon: 0 }), null);
  ok('chamada sem argumento não quebra', criarLeitura(), null);

  // Os campos opcionais ruins são descartados SEM derrubar a posição — espelha
  // os `check` de posicoes_atuais, que recusariam a linha inteira.
  const ruim = criarLeitura(
    { lat: 1, lon: 2, precisao: -3, rumo: 400, velocidade: -1, altitude: NaN, origem: 'gps' },
    { agora: AGORA });
  ok('precisão negativa vira nula', ruim.precisao, null);
  ok('rumo acima de 360 vira nulo', ruim.rumo, null);
  ok('velocidade negativa vira nula', ruim.velocidade, null);
  ok('altitude NaN vira nula', ruim.altitude, null);
  ok('a posição em si sobrevive aos campos ruins', [ruim.lat, ruim.lon], [1, 2]);
  ok('rumo 0 e 360 são válidos', [
    criarLeitura({ lat: 0, lon: 0, rumo: 0, origem: 'gps' }, { agora: AGORA }).rumo,
    criarLeitura({ lat: 0, lon: 0, rumo: 360, origem: 'gps' }, { agora: AGORA }).rumo,
  ], [0, 360]);
  ok('precisão 0 é válida (não é "falsa")', criarLeitura({ lat: 0, lon: 0, precisao: 0, origem: 'gps' }, { agora: AGORA }).precisao, 0);

  ok('sem instante, vale o `agora` injetado', criarLeitura({ lat: 0, lon: 0, origem: 'gps' }, { agora: AGORA }).instante, AGORA);
  ok('entidade externa passa quando informada', criarLeitura({ lat: 0, lon: 0, origem: 'externa', entidade: 'SB-Alfa-11' }, { agora: AGORA }).entidade, 'SB-Alfa-11');
  ok('entidade vazia vira nula', criarLeitura({ lat: 0, lon: 0, origem: 'externa', entidade: '' }, { agora: AGORA }).entidade, null);
}

// ── 3. As duas fontes de hoje ───────────────────────────────────────────────
console.log('\nGPS do navegador e toque no mapa entregam a mesma Leitura');
{
  const geo = {
    coords: { latitude: -25.09, longitude: -50.16, altitude: null, accuracy: 12, heading: NaN, speed: null },
    timestamp: 555,
  };
  const l = leituraDeGeolocation(geo, { agora: AGORA });
  ok('GPS: origem gps', l.origem, 'gps');
  ok('GPS: posição e precisão', [l.lat, l.lon, l.precisao], [-25.09, -50.16, 12]);
  ok('GPS: o timestamp do aparelho é o instante', l.instante, 555);
  ok('GPS: heading NaN (parado, pela spec do W3C) vira nulo', l.rumo, null);
  ok('GPS: speed null vira nulo', l.velocidade, null);
  ok('GPS: altitude null vira nula', l.altitude, null);
  ok('GPS: posição sem coords é descartada', leituraDeGeolocation({}), null);
  ok('GPS: undefined é descartado', leituraDeGeolocation(undefined), null);

  const m = leituraManual(-25.3, -50.3, { agora: AGORA });
  ok('manual: origem manual', m.origem, 'manual');
  ok('manual: a posição que o aluno escolheu', [m.lat, m.lon], [-25.3, -50.3]);
  ok('manual: NÃO inventa precisão, rumo nem velocidade', [m.precisao, m.rumo, m.velocidade], [null, null, null]);
  ok('manual: o instante é o de quando posicionou', m.instante, AGORA);
  ok('manual: coordenada inválida não gera leitura', leituraManual(100, 0), null);
}

// ── 4. A linha que vai para o banco ─────────────────────────────────────────
console.log('\nLeitura → linha de posicoes_atuais');
{
  const geo = {
    coords: { latitude: -25.09, longitude: -50.16, altitude: 880, accuracy: 12, heading: 45, speed: 2 },
    timestamp: AGORA,
  };
  const l = leituraDeGeolocation(geo);
  const base = { userId: 'u1', turmaId: 't1' };

  const semOrigem = paraLinhaPosicao(l, base);
  ok('a linha tem as colunas de antes da 0016', semOrigem, {
    usuario_id: 'u1', turma_id: 't1', latitude: -25.09, longitude: -50.16,
    altitude_m: 880, precisao_m: 12, rumo_graus: 45, velocidade_ms: 2,
    medido_em: new Date(AGORA).toISOString(),
  });
  // A razão de ser da opção: front-end publicado antes da migration não pode
  // mandar uma coluna que ainda não existe.
  ok('por padrão NÃO manda `origem` (a coluna pode ainda não existir)', 'origem' in semOrigem, false);

  const comOrigem = paraLinhaPosicao(l, { ...base, incluirOrigem: true });
  ok('com a opção ligada manda a origem do GPS', comOrigem.origem, 'gps');

  const man = paraLinhaPosicao(leituraManual(-25.3, -50.3, { agora: AGORA }), { ...base, incluirOrigem: true });
  ok('posição manual vai com origem manual', man.origem, 'manual');
  ok('e com precisão, rumo e velocidade NULOS, não inventados', [man.precisao_m, man.rumo_graus, man.velocidade_ms], [null, null, null]);
  ok('medido_em é ISO-8601 em UTC', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(man.medido_em), true);
}

// ── 5. Geometria ────────────────────────────────────────────────────────────
console.log('\nDistância');
{
  ok('mesmo ponto: zero', distanciaMetros({ lat: -25, lon: -50 }, { lat: -25, lon: -50 }), 0);
  // 1 grau de latitude = R·π/180 = 111 194,9 m com R = 6 371 000 m.
  const umGrau = distanciaMetros({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  ok('1 grau de latitude ≈ 111 195 m', Math.round(umGrau), 111195);
  ok('é simétrica', distanciaMetros({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }), distanciaMetros({ lat: 3, lon: 4 }, { lat: 1, lon: 2 }));
  // ~10 m ao norte: 10 / 111 195 grau.
  const dezM = distanciaMetros({ lat: -25, lon: -50 }, { lat: -25 + 10 / 111195, lon: -50 });
  ok('10 m medem 10 m', Math.round(dezM * 10) / 10, 10);
}

// ── 6. A decisão de gravar (throttling) ─────────────────────────────────────
// Caracterização: estes casos foram escritos contra o `deveGravar()` que estava
// em gps.js, para a extração não mudar o comportamento.
console.log('\nDecidir se grava: as regras, na ordem em que valem');
{
  ok('os limiares são os de sempre', [INTERVALO_MINIMO_MS, DISTANCIA_MINIMA_M, HEARTBEAT_MS], [5000, 10, 30000]);

  const A = { lat: -25.0, lon: -50.0 };
  const longe = { lat: -25.0 + 50 / 111195, lon: -50.0 };    // ~50 m
  const perto = { lat: -25.0 + 3 / 111195, lon: -50.0 };     // ~3 m
  const T0 = 1_000_000;
  const base = { agora: T0 + 6_000, ultimoEnvioEm: T0, ultimaPosGravada: A, posicao: longe };

  ok('primeira leitura da sessão: sempre grava',
    decidirGravacao({ agora: T0, ultimoEnvioEm: 0, ultimaPosGravada: null, posicao: A }), true);
  ok('regra 1: antes do intervalo mínimo NÃO grava, mesmo andando muito',
    decidirGravacao({ ...base, agora: T0 + 4_999 }), false);
  ok('regra 1: no intervalo mínimo exato já pode gravar',
    decidirGravacao({ ...base, agora: T0 + 5_000 }), true);
  ok('regra 2: andou 50 m depois do intervalo → grava', decidirGravacao(base), true);
  ok('regra 2: jitter de 3 m (parado) NÃO grava', decidirGravacao({ ...base, posicao: perto }), false);
  ok('regra 2: 10 m exatos contam como movimento',
    decidirGravacao({ ...base, posicao: { lat: -25.0 + 10.001 / 111195, lon: -50.0 } }), true);
  ok('regra 3: parado há 29 s → ainda não',
    decidirGravacao({ ...base, agora: T0 + 29_000, posicao: perto }), false);
  ok('regra 3: parado há 30 s → heartbeat, grava',
    decidirGravacao({ ...base, agora: T0 + 30_000, posicao: perto }), true);
  ok('retomada (forcar) fura até o teto de frequência',
    decidirGravacao({ ...base, agora: T0 + 100, posicao: perto, forcar: true }), true);
  ok('os limiares podem ser trocados por quem chama',
    decidirGravacao({ ...base, agora: T0 + 100, intervaloMinimoMs: 50 }), true);
}

// ── 7. A ponte com o banco ──────────────────────────────────────────────────
// FONTE ÚNICA: os valores que este módulo conhece têm que ser os que a
// migration aceita. Lê o SQL de verdade, para não ser uma cópia que concorde
// consigo mesma.
console.log('\nOs valores daqui são os que a migration 0016 aceita');
{
  const sql = readFileSync(
    fileURLToPath(new URL('../backend/supabase/0016_modo_posicao_simulacao.sql', import.meta.url)), 'utf8');
  const lista = (re) => {
    const m = sql.match(re);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
  };
  ok('check de turmas.modo_posicao', lista(/check \(modo_posicao in \(([^)]*)\)\)/), [...MODOS]);
  ok('check de posicoes_atuais.origem', lista(/posicoes_atuais_origem_check\s+check \(origem in \(([^)]*)\)\)/), [...ORIGENS]);
  ok('check de posicoes_historico.origem', lista(/posicoes_historico_origem_check\s+check \(origem in \(([^)]*)\)\)/), [...ORIGENS]);
  ok('modo e origem têm o mesmo vocabulário', [...MODOS], [...ORIGENS]);
}

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
