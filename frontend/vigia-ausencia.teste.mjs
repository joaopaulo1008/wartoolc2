// Teste de frontend/vigia-ausencia.js.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/vigia-ausencia.teste.mjs
//
// Este módulo foi extraído de colegas.js na Etapa 6c e NUNCA teve teste. A
// primeira metade deste arquivo pinça o comportamento que ele já tinha (os
// limiares e o rótulo de idade), para qualquer mudança futura ser medida
// contra algo. A segunda cobre o que a simulação (2026-10-02) acrescentou:
// posição de origem 'manual' não envelhece.
//
// O tempo é FINGIDO: `Date.now` e `setInterval` são trocados por versões que
// o teste controla, para "daqui a 90 segundos" não custar 90 segundos.

import {
  AVISO_PARADO_MS, SEM_SINAL_MS, INTERVALO_VIGIA_MS,
  idadeMs, idadeDaPosicao, rotuloIdade, iniciarVigia,
} from './vigia-ausencia.js';

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

// Relógio e temporizador falsos.
const AGORA = 1_760_000_000_000;
let agora = AGORA;
const dateNowReal = Date.now;
const setIntervalReal = globalThis.setInterval;
const clearIntervalReal = globalThis.clearInterval;
let tique = null;       // a função que a vigia registrou
let limpou = false;
function fingir() {
  Date.now = () => agora;
  globalThis.setInterval = (fn, ms) => { tique = { fn, ms }; return 1; };
  globalThis.clearInterval = () => { limpou = true; };
}
function restaurar() {
  Date.now = dateNowReal;
  globalThis.setInterval = setIntervalReal;
  globalThis.clearInterval = clearIntervalReal;
}
const iso = (msAtras) => new Date(AGORA - msAtras).toISOString();

fingir();
try {

  // ── 1. O que já existia ───────────────────────────────────────────────────
  console.log('\nOs limiares e a idade');
  {
    ok('aviso aos 60 s', AVISO_PARADO_MS, 60_000);
    ok('sem sinal aos 120 s', SEM_SINAL_MS, 120_000);
    ok('a vigia confere de 15 em 15 s', INTERVALO_VIGIA_MS, 15_000);
    agora = AGORA;
    ok('idade de uma posição de 90 s', idadeMs(iso(90_000)), 90_000);
    ok('idade de nulo é zero (como "agora")', idadeMs(null), 0);
    ok('idade aceita Date', idadeMs(new Date(AGORA - 5_000)), 5_000);
  }

  console.log('\nO rótulo ao lado do símbolo');
  {
    ok('abaixo de 60 s não há etiqueta', rotuloIdade(59_999), '');
    ok('60 s é "1m"', rotuloIdade(60_000), '1m');
    ok('59 minutos', rotuloIdade(59 * 60_000), '59m');
    ok('60 minutos é "1h"', rotuloIdade(60 * 60_000), '1h');
    ok('95 minutos é "1h35"', rotuloIdade(95 * 60_000), '1h35');
    ok('65 minutos completa o zero: "1h05"', rotuloIdade(65 * 60_000), '1h05');
    ok('um dia ou mais é "+24h"', rotuloIdade(24 * 3_600_000), '+24h');
    ok('NaN não quebra', rotuloIdade(NaN), '');
    ok('Infinity não quebra', rotuloIdade(Infinity), '');
  }

  // ── 2. A vigia ────────────────────────────────────────────────────────────
  console.log('\nA vigia confere todo mundo a cada ciclo');
  {
    agora = AGORA;
    const vistos = [];
    let fins = 0;
    const estados = [
      { usuarioId: 'recente',  ultimaAtualizacaoEm: AGORA - 5_000 },
      { usuarioId: 'parado',   ultimaAtualizacaoEm: AGORA - 70_000 },
      { usuarioId: 'semsinal', ultimaAtualizacaoEm: AGORA - 130_000 },
    ];
    const v = iniciarVigia({
      listarEstados: () => estados,
      aoConferir: (e, info) => vistos.push([e.usuarioId, info]),
      aoFim: () => { fins++; },
    });
    ok('o temporizador é o intervalo da vigia', tique.ms, INTERVALO_VIGIA_MS);
    tique.fn();
    ok('conferiu os três', vistos.map(([id]) => id), ['recente', 'parado', 'semsinal']);
    ok('recente: nem atrasado nem sem sinal, sem etiqueta',
      [vistos[0][1].atrasado, vistos[0][1].semSinal, vistos[0][1].rotulo], [false, false, '']);
    ok('parado há 70 s: atrasado, ainda com sinal, "1m"',
      [vistos[1][1].atrasado, vistos[1][1].semSinal, vistos[1][1].rotulo], [true, false, '1m']);
    ok('130 s: atrasado e sem sinal, "2m"',
      [vistos[2][1].atrasado, vistos[2][1].semSinal, vistos[2][1].rotulo], [true, true, '2m']);
    ok('aoFim roda UMA vez por ciclo, não uma por usuário', fins, 1);
    tique.fn();
    ok('e uma vez por ciclo no ciclo seguinte', fins, 2);
    v.parar();
    ok('parar() desliga o temporizador', limpou, true);
  }

  // ── 3. A simulação (2026-10-02) ───────────────────────────────────────────
  console.log('\nPosição manual não envelhece');
  {
    agora = AGORA;
    ok('manual: idade zero, mesmo de uma hora atrás', idadeDaPosicao(iso(3_600_000), 'manual'), 0);
    ok('gps: envelhece como sempre', idadeDaPosicao(iso(90_000), 'gps'), 90_000);
    ok('linha SEM origem (antes da migration 0016) envelhece como sempre',
      idadeDaPosicao(iso(90_000), undefined), 90_000);
    ok('origem null (idem) envelhece como sempre', idadeDaPosicao(iso(90_000), null), 90_000);
    ok('origem externa (simulador) AINDA envelhece: o simulador manda fluxo, e silêncio dele é ausência',
      idadeDaPosicao(iso(90_000), 'externa'), 90_000);
    ok('manual sem carimbo também é zero', idadeDaPosicao(null, 'manual'), 0);

    const vistos = [];
    const v = iniciarVigia({
      listarEstados: () => [
        { usuarioId: 'sim',   ultimaAtualizacaoEm: AGORA - 3_600_000, semEnvelhecer: true },
        { usuarioId: 'gps',   ultimaAtualizacaoEm: AGORA - 3_600_000 },
      ],
      aoConferir: (e, info) => vistos.push([e.usuarioId, info]),
    });
    tique.fn();
    ok('na vigia, o manual de uma hora atrás NÃO fica sem sinal',
      [vistos[0][1].atrasado, vistos[0][1].semSinal, vistos[0][1].rotulo, vistos[0][1].idade], [false, false, '', 0]);
    ok('e o de GPS de uma hora atrás continua sem sinal, "1h"',
      [vistos[1][1].atrasado, vistos[1][1].semSinal, vistos[1][1].rotulo], [true, true, '1h']);
    v.parar();
  }

} finally {
  restaurar();
}

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
