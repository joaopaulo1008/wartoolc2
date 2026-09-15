// Teste de frontend/situacao-usuario.js — recado de situação e pedido de
// apoio (2026-09-15).
//
//     node frontend/situacao-usuario.teste.mjs
//
// O que este arquivo trava, e por quê:
//
//   1. **NÃO EXISTE UM ESTADO 'emergencia' NA LISTA DO JOGO.** É a decisão que
//      sustenta a separação inteira: recado de situação é simulado, pedido de
//      apoio é real. Se alguém acrescentar um estado de emergência aqui, no
//      dia do acidente alguém o escolhe e quem olha pensa que é jogo.
//   2. **UMA POSIÇÃO VELHA NUNCA É APRESENTADA COMO ATUAL.** Um pedido de
//      apoio com coordenada de oito minutos atrás manda gente procurar pessoa
//      no lugar errado. `descreverPosicaoDoPedido` nunca devolve silêncio.
//   3. **'sem novidade' e sem texto não escreve nada no popup.** Um campo que
//      aparece sempre ensina a ser ignorado — e aí o dia em que disser algo
//      importante, ninguém lê.

import {
  ESTADOS, ESTADO_PADRAO, LIMITE_TEXTO_SITUACAO, LIMITE_MOTIVO_APOIO,
  POSICAO_RECENTE_MS,
  estadoValido, rotuloDoEstado, corDoEstado, validarSituacao, linhaDeSituacao,
  descreverPosicaoDoPedido, duracaoCurta, faseDoPedido, pedidoEstaVigente,
  validarMotivo,
} from './situacao-usuario.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = obtido === esperado;
  bom ? passou++ : falhou++;
  console.log(`  ${(bom ? 'PASSOU' : '** FALHOU **').padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado: ${JSON.stringify(esperado)}\n                 obtido:   ${JSON.stringify(obtido)}`);
}

console.log('\nA separação entre jogo e coisa séria');
// A asserção mais importante do arquivo.
ok('NENHUM estado do jogo é de emergência',
  ESTADOS.some((e) => /emerg|socorro|apoio|sos/i.test(e.valor) || /emerg|socorro|sos/i.test(e.rotulo)),
  false);
ok('o padrão é "normal"', ESTADO_PADRAO, 'normal');
ok('e "normal" não tem cor (não pinta nada na tela)', corDoEstado('normal'), null);
ok('todo estado tem rótulo em português',
  ESTADOS.every((e) => typeof e.rotulo === 'string' && e.rotulo.length > 2), true);
ok('os valores são únicos',
  new Set(ESTADOS.map((e) => e.valor)).size, ESTADOS.length);

console.log('\nestadoValido / rotuloDoEstado');
ok('aceita um valor da lista', estadoValido('sem_municao'), true);
ok('recusa valor fora da lista', estadoValido('inventado'), false);
ok('recusa vazio', estadoValido(''), false);
ok('recusa null', estadoValido(null), false);
ok('rótulo conhecido sai em português', rotuloDoEstado('pane_viatura'), 'Viatura em pane');
// Valor desconhecido devolve '' em vez de chutar: escrever "sem_municao" cru
// no popup seria pior do que não escrever nada.
ok('valor desconhecido NÃO devolve o código cru', rotuloDoEstado('sem_municao_nova'), '');
ok('null não quebra', rotuloDoEstado(null), '');

console.log('\nvalidarSituacao');
ok('estado válido passa', validarSituacao({ estado: 'em_contato' }).ok, true);
ok('sem estado cai no padrão', validarSituacao({}).valor.estado, ESTADO_PADRAO);
ok('estado inválido é recusado', validarSituacao({ estado: 'xyz' }).ok, false);
ok('texto é aparado', validarSituacao({ estado: 'normal', texto: '  vou ao PC  ' }).valor.texto, 'vou ao PC');
// Texto em branco vira null, não '': o check da 0014 exige conteúdo SE houver
// texto, e null é o jeito honesto de dizer "não há".
ok('texto em branco vira null', validarSituacao({ estado: 'normal', texto: '   ' }).valor.texto, null);
ok('texto ausente vira null', validarSituacao({ estado: 'normal' }).valor.texto, null);
ok('no limite passa',
  validarSituacao({ estado: 'normal', texto: 'x'.repeat(LIMITE_TEXTO_SITUACAO) }).ok, true);
ok('um a mais é recusado',
  validarSituacao({ estado: 'normal', texto: 'x'.repeat(LIMITE_TEXTO_SITUACAO + 1) }).ok, false);

console.log('\nlinhaDeSituacao — o silêncio é a regra');
ok('"sem novidade" sem texto NÃO escreve nada',
  linhaDeSituacao({ estado: 'normal', texto: null }), '');
ok('nem com texto em branco',
  linhaDeSituacao({ estado: 'normal', texto: '   ' }), '');
ok('linha nula não quebra', linhaDeSituacao(null), '');
// 'normal' COM texto fala o texto: quem escreveu "chegando ao PC" não está em
// estado anormal e mesmo assim tem o que dizer.
ok('"sem novidade" COM texto escreve só o texto',
  linhaDeSituacao({ estado: 'normal', texto: 'chegando ao PC' }), 'chegando ao PC');
ok('estado sozinho escreve o rótulo',
  linhaDeSituacao({ estado: 'sem_municao', texto: null }), 'Sem munição');
ok('estado + texto escreve os dois',
  linhaDeSituacao({ estado: 'sem_municao', texto: '2 pentes' }), 'Sem munição — 2 pentes');
ok('estado desconhecido sem texto não escreve nada',
  linhaDeSituacao({ estado: 'zzz', texto: null }), '');
ok('estado desconhecido COM texto ainda mostra o texto',
  linhaDeSituacao({ estado: 'zzz', texto: 'alguma coisa' }), 'alguma coisa');

console.log('\nduracaoCurta');
ok('segundos', duracaoCurta(45_000), '45s');
ok('arredonda para o segundo', duracaoCurta(45_400), '45s');
ok('minutos', duracaoCurta(180_000), '3m');
ok('hora com minuto de dois dígitos', duracaoCurta(4_320_000), '1h12m');
ok('zero não vira vazio', duracaoCurta(0), '0s');
ok('negativo não vira absurdo', duracaoCurta(-5_000), '0s');

console.log('\ndescreverPosicaoDoPedido — nunca apresenta velho como atual');
const AGORA = 1_800_000_000_000;
const emQue = (msAtras) => new Date(AGORA - msAtras).toISOString();

{
  const r = descreverPosicaoDoPedido({ latitude: null, longitude: null }, { agora: AGORA });
  ok('sem coordenada: diz que não há', r.rotulo, 'sem posição conhecida');
  ok('e marca temPosicao=false', r.temPosicao, false);
  // Sem posição conta como "velha" para a tela poder tratar os dois casos com
  // o mesmo destaque: nos dois, quem recebe NÃO deve confiar no ponto.
  ok('e conta como não-confiável', r.velha, true);
}
{
  const r = descreverPosicaoDoPedido(
    { latitude: -25, longitude: -50, posicao_em: emQue(5_000) }, { agora: AGORA });
  ok('posição de 5s: é do momento', r.rotulo, 'posição do momento do acionamento');
  ok('e não é velha', r.velha, false);
}
{
  const r = descreverPosicaoDoPedido(
    { latitude: -25, longitude: -50, posicao_em: emQue(POSICAO_RECENTE_MS) }, { agora: AGORA });
  ok('exatamente no limiar ainda é do momento', r.velha, false);
}
{
  const r = descreverPosicaoDoPedido(
    { latitude: -25, longitude: -50, posicao_em: emQue(POSICAO_RECENTE_MS + 1000) }, { agora: AGORA });
  ok('um segundo depois do limiar já é velha', r.velha, true);
}
{
  const r = descreverPosicaoDoPedido(
    { latitude: -25, longitude: -50, posicao_em: emQue(480_000) }, { agora: AGORA });
  ok('posição de 8 minutos DIZ a idade', r.rotulo, 'posição de 8m antes do acionamento');
  ok('e está marcada como velha', r.velha, true);
}
{
  // Coordenada sem carimbo de hora: existe, mas não dá para saber de quando.
  // O erro seguro é o que desconfia.
  const r = descreverPosicaoDoPedido({ latitude: -25, longitude: -50 }, { agora: AGORA });
  ok('coordenada sem hora é tratada como velha', r.velha, true);
  ok('e diz exatamente isso', r.rotulo, 'posição sem hora conhecida');
}
{
  // Zero é coordenada legítima e não pode cair num `if (!lat)`.
  const r = descreverPosicaoDoPedido(
    { latitude: 0, longitude: 0, posicao_em: emQue(1000) }, { agora: AGORA });
  ok('lat/lon zero é posição válida', r.temPosicao, true);
}

console.log('\nCiclo de vida do pedido');
ok('sem nada: aberto', faseDoPedido({}), 'aberto');
ok('reconhecido', faseDoPedido({ reconhecido_em: 'x' }), 'reconhecido');
ok('encerrado vence reconhecido',
  faseDoPedido({ reconhecido_em: 'x', encerrado_em: 'y' }), 'encerrado');
ok('nulo é "nenhum"', faseDoPedido(null), 'nenhum');
// Reconhecer NÃO tira da tela: "estou vendo" não é "está resolvido".
ok('aberto continua vigente', pedidoEstaVigente({}), true);
ok('RECONHECIDO continua vigente', pedidoEstaVigente({ reconhecido_em: 'x' }), true);
ok('encerrado sai', pedidoEstaVigente({ encerrado_em: 'y' }), false);

console.log('\nvalidarMotivo');
ok('vazio vira null', validarMotivo('').valor, null);
ok('só espaço vira null', validarMotivo('   ').valor, null);
ok('texto é aparado', validarMotivo('  viatura capotou  ').valor, 'viatura capotou');
ok('no limite passa', validarMotivo('x'.repeat(LIMITE_MOTIVO_APOIO)).ok, true);
ok('acima do limite é recusado', validarMotivo('x'.repeat(LIMITE_MOTIVO_APOIO + 1)).ok, false);

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
