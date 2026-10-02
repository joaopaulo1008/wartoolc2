// Teste de frontend/toque-longo.js.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/toque-longo.teste.mjs
//
// POR QUE ESTE TESTE EXISTE, E POR QUE ELE É EM NODE
// ---------------------------------------------------
// O gesto vivia dentro de `paleta-tela.js`, amarrado ao DOM, e por isso nunca
// teve teste nenhum. O que se sabia dele vinha do campo — e o que o campo
// disse, no item 15j do roteiro, foi que ele era **a parte mais frágil da
// entrega**: *"se num celular específico não disparar (ou disparar sozinho ao
// rolar o formulário), anote qual aparelho e navegador"*.
//
// Um teste em Node não prova que o gesto funciona num celular. Prova outra
// coisa, que é o que faltava: que a REGRA está certa. Os dois casos que
// ninguém reproduz de propósito com o aparelho na mão — rolar com o dedo em
// cima, e a pinça lenta — são triviais de escrever aqui.
//
// O tempo é FINGIDO. A máquina não tem cronômetro: recebe o instante em cada
// evento e compara. É o que permite testar "meio segundo depois" sem esperar
// meio segundo, e é a razão de a parte pura ter sido separada da casca.

import { criarMaquina, TOQUE_LONGO_MS, TOLERANCIA_PX } from './toque-longo.js';

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

// Atalhos: um dedo só, na mesma posição, com o tempo andando à mão.
const baixo = (m, { id = 1, x = 100, y = 100, t = 0 } = {}) => m.evento({ tipo: 'baixo', id, x, y, t });
const move  = (m, { id = 1, x = 100, y = 100, t = 0 } = {}) => m.evento({ tipo: 'move', id, x, y, t });
const cima  = (m, { id = 1, t = 0 } = {}) => m.evento({ tipo: 'cima', id, t });
const clique = (m) => m.evento({ tipo: 'clique' });

// ── 1. O caminho feliz ──────────────────────────────────────────────────────
console.log('\nO caso normal: dedo parado, meio segundo, dispara');
{
  const m = criarMaquina();
  ok('o pointerdown arma e diz para quando', baixo(m, { t: 1000 }), { acao: 'armar', em: 1000 + TOQUE_LONGO_MS });
  ok('antes da hora não dispara', m.tempoEsgotado(1000 + TOQUE_LONGO_MS - 1), { acao: 'nada' });
  ok('na hora dispara, e devolve ONDE o dedo estava',
    m.tempoEsgotado(1000 + TOQUE_LONGO_MS), { acao: 'disparar', x: 100, y: 100 });
  ok('depois de disparar não fica armado', m.armado, false);
  ok('disparar duas vezes não acontece', m.tempoEsgotado(9999), { acao: 'nada' });
}

// ── 2. Soltar antes da hora ─────────────────────────────────────────────────
console.log('\nSoltar antes: é toque curto, não toque longo');
{
  const m = criarMaquina();
  baixo(m, { t: 0 });
  ok('o pointerup cancela o que estava armado', cima(m, { t: 200 }), { acao: 'cancelar' });
  ok('e o cronômetro estourando depois não dispara nada', m.tempoEsgotado(600), { acao: 'nada' });
  ok('o clique que vem em seguida NÃO é engolido — é o toque curto', clique(m), { acao: 'nada' });
}

// ── 3. A tolerância de movimento (o defeito do item 15j) ────────────────────
console.log('\nRolar com o dedo em cima não pode disparar');
{
  const m = criarMaquina();
  baixo(m, { x: 100, y: 100, t: 0 });
  ok('tremor dentro da tolerância não cancela',
    move(m, { x: 100 + TOLERANCIA_PX, y: 100, t: 50 }), { acao: 'nada' });
  ok('e o gesto continua vivo', m.armado, true);
  ok('passar da tolerância cancela',
    move(m, { x: 100 + TOLERANCIA_PX + 1, y: 100, t: 100 }), { acao: 'cancelar' });
  ok('depois de cancelado, o cronômetro não dispara', m.tempoEsgotado(600), { acao: 'nada' });
}
{
  const m = criarMaquina();
  baixo(m, { x: 100, y: 100, t: 0 });
  // A tolerância é um RAIO, não um retângulo: 8 px em cada eixo dá 11,3 px de
  // distância, que passa de 10. Se fosse medida por eixo, este caso passaria
  // por engano — é o tipo de alvo mal escolhido que já aprovou teste aqui.
  ok('a tolerância é radial, não por eixo', move(m, { x: 108, y: 108, t: 50 }), { acao: 'cancelar' });
}
{
  const m = criarMaquina();
  baixo(m, { id: 1, x: 100, y: 100, t: 0 });
  ok('movimento de OUTRO dedo não cancela o gesto deste',
    move(m, { id: 2, x: 400, y: 400, t: 50 }), { acao: 'nada' });
  ok('e ele dispara normalmente', m.tempoEsgotado(600).acao, 'disparar');
}

// ── 4. A pinça lenta ────────────────────────────────────────────────────────
console.log('\nPinça lenta: o segundo dedo mata o toque longo');
{
  const m = criarMaquina();
  ok('o primeiro dedo arma, como sempre', baixo(m, { id: 1, x: 100, y: 100, t: 0 }).acao, 'armar');
  ok('o segundo dedo cancela', baixo(m, { id: 2, x: 300, y: 300, t: 120 }), { acao: 'cancelar' });
  ok('e o cronômetro do primeiro não dispara mais', m.tempoEsgotado(600), { acao: 'nada' });
  ok('tirar um dedo no meio da pinça não rearma nada', cima(m, { id: 2, t: 900 }), { acao: 'nada' });
  ok('nem o segundo', cima(m, { id: 1, t: 950 }), { acao: 'nada' });
  ok('a contagem de dedos volta a zero', m.dedosNaTela, 0);
  ok('e um toque novo depois disso arma de novo', baixo(m, { id: 1, t: 1000 }).acao, 'armar');
}

// ── 5. O clique que vem depois do toque longo ──────────────────────────────
console.log('\nO clique do pointerup não pode valer como segundo gesto');
{
  const m = criarMaquina();
  baixo(m, { t: 0 });
  m.tempoEsgotado(600);
  cima(m, { t: 700 });
  ok('o clique logo depois é engolido', clique(m), { acao: 'engolir' });
  ok('mas só UMA vez — o clique seguinte é de verdade', clique(m), { acao: 'nada' });
}
{
  const m = criarMaquina();
  baixo(m, { t: 0 });
  m.tempoEsgotado(600);
  // O dedo saiu da tela sem gerar clique NEM pointerup (rolagem, o navegador
  // engoliu o gesto, o elemento sumiu). Dois efeitos, e os dois já morderam:
  //   1. A marca de engolir não pode sobreviver esperando um clique legítimo.
  //   2. O dedo não pode continuar contando como "na tela" — foi assim que a
  //      primeira versão, que contava em vez de guardar o identificador,
  //      matava o gesto para sempre depois de um pointerup perdido.
  ok('um gesto NOVO apaga a dívida do anterior', baixo(m, { id: 1, t: 5000 }).acao, 'armar');
  ok('e não sobrou dedo fantasma na tela', m.dedosNaTela, 1);
  cima(m, { id: 1, t: 5100 });
  ok('e o clique desse gesto novo passa normalmente', clique(m), { acao: 'nada' });
}
{
  // O mesmo defeito visto pelo outro lado: sem NENHUM toque longo no meio,
  // só uma soltura perdida. O gesto seguinte tem que armar.
  const m = criarMaquina();
  baixo(m, { id: 1, t: 0 });   // e o pointerup deste nunca chega
  ok('um pointerdown repetido do MESMO dedo recomeça em vez de virar pinça',
    baixo(m, { id: 1, t: 3000 }), { acao: 'armar', em: 3000 + TOQUE_LONGO_MS });
  ok('e ele dispara normalmente', m.tempoEsgotado(3000 + TOQUE_LONGO_MS).acao, 'disparar');
}

// ── 6. Cancelamento pelo sistema ────────────────────────────────────────────
console.log('\npointercancel / sair do elemento');
{
  const m = criarMaquina();
  baixo(m, { t: 0 });
  ok('pointercancel desarma', m.evento({ tipo: 'cancelado', id: 1, t: 100 }), { acao: 'cancelar' });
  ok('e nada dispara depois', m.tempoEsgotado(600), { acao: 'nada' });
}
{
  const m = criarMaquina();
  ok('cancelar sem nada armado não inventa um "cancelar"',
    m.evento({ tipo: 'cancelado', id: 1, t: 0 }), { acao: 'nada' });
  ok('evento desconhecido não quebra nada', m.evento({ tipo: 'seja-la-o-que-for' }), { acao: 'nada' });
  ok('evento sem argumento nenhum também não', m.evento(), { acao: 'nada' });
  ok('a contagem de dedos nunca fica negativa', m.dedosNaTela, 0);
}

// ── 7. Parâmetros ───────────────────────────────────────────────────────────
console.log('\nOs dois números são ajustáveis por quem liga o gesto');
{
  const m = criarMaquina({ ms: 800, toleranciaPx: 2 });
  ok('o intervalo vem de quem chamou', baixo(m, { t: 0 }), { acao: 'armar', em: 800 });
  ok('e a tolerância também', move(m, { x: 103, y: 100, t: 10 }), { acao: 'cancelar' });
}

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
