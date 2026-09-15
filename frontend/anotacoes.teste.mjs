// Teste de frontend/anotacoes.js — caixas de texto no mapa (2026-09-14).
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/anotacoes.teste.mjs
//
// O que ele trava, e por quê:
//
//   1. O LIMITE DE TEXTO É O MESMO DO BANCO. `anotacoes.texto` tem
//      `check (length(btrim(texto)) between 1 and 200)` na migration 0013, e
//      LIMITE_TEXTO é a cópia que o cliente usa para desenhar o contador de
//      caracteres. Se os dois divergirem, o instrutor digita dentro do que a
//      tela permite e leva um erro cru do Postgres ao salvar — sintoma clássico
//      de regra duplicada neste projeto.
//   2. ESPAÇO EM BRANCO NÃO É TEXTO. Uma anotação de " " passaria por um
//      `if (texto)` ingênuo e desenharia uma caixa vazia no mapa de 60 pessoas,
//      sem ninguém conseguir explicar de onde veio.
//   3. PARTIDO NULO É "TODOS", NÃO "SEM FORÇA". Em `elementos_marcados` partido
//      nulo significa "não identificado"; aqui significa o oposto — a turma
//      inteira. Usar a mesma palavra para os dois seria a armadilha, e
//      descreverAlcance() é onde isso fica travado.

import {
  LIMITE_TEXTO, COR_PADRAO,
  normalizarTexto, corValidaOuPadrao, validarAnotacao, resumirTexto, descreverAlcance,
} from './anotacoes.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = obtido === esperado;
  bom ? passou++ : falhou++;
  console.log(`  ${(bom ? 'PASSOU' : '** FALHOU **').padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado: ${esperado}\n                 obtido:   ${obtido}`);
}

const PONTO = { latitude: -25.09, longitude: -50.16 };

console.log('\nnormalizarTexto');
ok('tira espaço das pontas', normalizarTexto('  PC 1º Esqd  '), 'PC 1º Esqd');
// Quebra de linha PRESERVADA: "Reabastecimento\naté as 14h" é uma anotação
// legítima de duas linhas, e o desenho no mapa respeita isso (white-space:
// pre-wrap). Achatar aqui mudaria o que a pessoa escreveu.
ok('preserva quebra de linha no meio', normalizarTexto('a\nb'), 'a\nb');
ok('normaliza CRLF para LF', normalizarTexto('a\r\nb'), 'a\nb');
ok('só espaço vira vazio', normalizarTexto('   '), '');
ok('só quebra de linha vira vazio', normalizarTexto('\n\n'), '');
ok('não-string vira vazio', normalizarTexto(null), '');
ok('número vira vazio (não "12")', normalizarTexto(12), '');

console.log('\ncorValidaOuPadrao');
ok('aceita #rrggbb', corValidaOuPadrao('#a1b2c3'), '#a1b2c3');
ok('aceita maiúsculas', corValidaOuPadrao('#A1B2C3'), '#A1B2C3');
ok('recusa forma curta', corValidaOuPadrao('#abc'), COR_PADRAO);
ok('recusa nome de cor', corValidaOuPadrao('red'), COR_PADRAO);
ok('recusa vazio', corValidaOuPadrao(''), COR_PADRAO);
ok('recusa null', corValidaOuPadrao(null), COR_PADRAO);
// Cor errada NÃO derruba a anotação: perder o texto recém-escrito por causa de
// uma cor inválida seria desproporcional.
ok('cor inválida não invalida a anotação',
  validarAnotacao({ texto: 'PC', ...PONTO, cor: 'roxo' }).ok, true);
ok('e cai no padrão',
  validarAnotacao({ texto: 'PC', ...PONTO, cor: 'roxo' }).valor.cor, COR_PADRAO);

console.log('\nvalidarAnotacao');
ok('texto normal passa', validarAnotacao({ texto: 'PC 1º Esqd', ...PONTO }).ok, true);
ok('e vai gravado já normalizado',
  validarAnotacao({ texto: '  PC  ', ...PONTO }).valor.texto, 'PC');
ok('vazio é recusado', validarAnotacao({ texto: '', ...PONTO }).ok, false);
ok('só espaço é recusado', validarAnotacao({ texto: '   ', ...PONTO }).ok, false);
ok('só quebra de linha é recusada', validarAnotacao({ texto: '\n', ...PONTO }).ok, false);
ok('undefined é recusado', validarAnotacao({ ...PONTO }).ok, false);

// O limite conta o texto JÁ NORMALIZADO, como o `btrim` do banco: 200
// caracteres mais espaço nas pontas é uma anotação de 200, não de 204.
ok('exatamente no limite passa',
  validarAnotacao({ texto: 'x'.repeat(LIMITE_TEXTO), ...PONTO }).ok, true);
ok('um caractere a mais é recusado',
  validarAnotacao({ texto: 'x'.repeat(LIMITE_TEXTO + 1), ...PONTO }).ok, false);
ok('limite conta o texto já aparado, como o btrim do banco',
  validarAnotacao({ texto: `  ${'x'.repeat(LIMITE_TEXTO)}  `, ...PONTO }).ok, true);
ok('a recusa por tamanho diz o número',
  /\b201\b/.test(validarAnotacao({ texto: 'x'.repeat(201), ...PONTO }).erro), true);

ok('sem coordenada é recusada', validarAnotacao({ texto: 'PC' }).ok, false);
ok('latitude fora da faixa é recusada',
  validarAnotacao({ texto: 'PC', latitude: 91, longitude: 0 }).ok, false);
ok('longitude fora da faixa é recusada',
  validarAnotacao({ texto: 'PC', latitude: 0, longitude: 181 }).ok, false);
ok('NaN é recusado',
  validarAnotacao({ texto: 'PC', latitude: NaN, longitude: 0 }).ok, false);
// Zero é coordenada legítima (golfo da Guiné) e não pode cair num `if (!lat)`.
ok('lat/lon zero é coordenada válida',
  validarAnotacao({ texto: 'PC', latitude: 0, longitude: 0 }).ok, true);

// Partido vazio vira null e NÃO é erro: "todos veem" é o caso comum, e exigir
// uma força para escrever um recado geral seria o oposto do que se quer.
ok('partido vazio vira null',
  validarAnotacao({ texto: 'PC', ...PONTO, partidoId: '' }).valor.partidoId, null);
ok('partido ausente vira null',
  validarAnotacao({ texto: 'PC', ...PONTO }).valor.partidoId, null);
ok('partido informado é preservado',
  validarAnotacao({ texto: 'PC', ...PONTO, partidoId: 'p-azul' }).valor.partidoId, 'p-azul');

console.log('\nresumirTexto');
ok('texto curto sai inteiro', resumirTexto('PC 1º Esqd'), 'PC 1º Esqd');
ok('quebra de linha vira espaço na lista', resumirTexto('a\nb'), 'a b');
ok('corta no máximo pedido',
  resumirTexto('x'.repeat(80), { maximo: 10 }).length, 10);
ok('e marca que cortou',
  resumirTexto('x'.repeat(80), { maximo: 10 }).endsWith('…'), true);
ok('exatamente no máximo não corta',
  resumirTexto('x'.repeat(10), { maximo: 10 }), 'x'.repeat(10));

console.log('\ndescreverAlcance');
const PARTIDOS = [{ id: 'p1', nome: 'Azul' }, { id: 'p2', nome: 'Vermelho' }];
// O caso que importa: nulo é TODOS, não "sem força". A palavra oposta à de
// elementos_marcados, de propósito.
ok('nulo é "todos da turma"', descreverAlcance(null, PARTIDOS), 'todos da turma');
ok('undefined também', descreverAlcance(undefined, PARTIDOS), 'todos da turma');
ok('partido conhecido sai pelo nome', descreverAlcance('p2', PARTIDOS), 'só Vermelho');
// Partido apagado: `on delete set null` na 0013 zera a coluna, mas uma lista
// desatualizada na tela pode ter o id sem o partido. Dizer "removida" é melhor
// do que dizer "todos" — o erro seguro é o que restringe.
ok('partido desconhecido não vira "todos"',
  descreverAlcance('p-sumiu', PARTIDOS), 'só uma força (removida)');
ok('lista vazia não quebra', descreverAlcance('p1', []), 'só uma força (removida)');
ok('lista ausente não quebra', descreverAlcance('p1'), 'só uma força (removida)');

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
