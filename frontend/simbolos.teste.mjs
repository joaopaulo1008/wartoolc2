// Teste de frontend/simbolos.js — Etapa 4.5.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/simbolos.teste.mjs
//
// O que ele prova é a afirmação central da etapa: A MESMA linha do banco (um
// elemento com um partido) vira um símbolo DIFERENTE dependendo de quem está
// olhando. Se um dia alguém "simplificar" simbolos.js voltando a gravar
// hostilidade absoluta, é aqui que quebra.
//
// Também aceita partidos de verdade, vindos do banco de teste, para provar
// que a regra funciona com os UUIDs reais e não só com fixtures:
//     node frontend/simbolos.teste.mjs <uuid-azul> <uuid-vermelho>

import {
  HOSTILIDADE, getSIDC, hostilidadeRelativa, aplicarHostilidade, sidcParaObservador,
} from './simbolos.js';

const [argAzul, argVermelho] = process.argv.slice(2);

const AZUL     = { id: argAzul     || 'p-azul',     tipo: 'beligerante' };
const VERMELHO = { id: argVermelho || 'p-vermelho', tipo: 'beligerante' };
const VERDE    = { id: 'p-verde',    tipo: 'neutro' };

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = obtido === esperado;
  bom ? passou++ : falhou++;
  const marca = bom ? 'PASSOU' : '** FALHOU **';
  console.log(`  ${marca.padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado: ${esperado}\n                 obtido:   ${obtido}`);
}

// ── O caso que motivou a etapa inteira ──────────────────────────────────────
console.log('\nO MESMO elemento, visto pelos dois lados');
// Uma linha só em elementos_marcados: um pelotão do Vermelho, SIDC gravado com
// o placeholder 01 (desconhecido) nos dígitos de hostilidade.
const PEL_VERMELHO = { partido: VERMELHO, sidc: '10011000001313000000' };

ok('para o Azul, o pelotão do Vermelho é HOSTIL (06)',
  sidcParaObservador(PEL_VERMELHO.sidc, AZUL, PEL_VERMELHO.partido).slice(2, 4), '06');
ok('para o Vermelho, o MESMO pelotão é AMIGO (03)',
  sidcParaObservador(PEL_VERMELHO.sidc, VERMELHO, PEL_VERMELHO.partido).slice(2, 4), '03');
ok('o resto do SIDC não é tocado (dimensão, escalão, natureza)',
  sidcParaObservador(PEL_VERMELHO.sidc, AZUL, PEL_VERMELHO.partido).slice(4),
  PEL_VERMELHO.sidc.slice(4));
ok('a linha do banco continua sendo UMA só (o SIDC gravado não muda)',
  PEL_VERMELHO.sidc, '10011000001313000000');

// ── Regra de hostilidade, caso a caso ───────────────────────────────────────
console.log('\nhostilidadeRelativa(observador, elemento)');
ok('mesmo partido -> AMIGO',            hostilidadeRelativa(AZUL, AZUL), 'AMIGO');
ok('partidos beligerantes diferentes -> HOSTIL', hostilidadeRelativa(AZUL, VERMELHO), 'HOSTIL');
ok('e o inverso também -> HOSTIL',      hostilidadeRelativa(VERMELHO, AZUL), 'HOSTIL');
ok('elemento de partido neutro -> NEUTRO', hostilidadeRelativa(AZUL, VERDE), 'NEUTRO');
ok('observador neutro não tem inimigos -> NEUTRO', hostilidadeRelativa(VERDE, AZUL), 'NEUTRO');
ok('elemento sem partido, observador com partido -> DESCONHECIDO',
  hostilidadeRelativa(AZUL, null), 'DESCONHECIDO');
ok('observador sem partido -> null (não afirma nada)', hostilidadeRelativa(null, VERMELHO), null);
ok('ninguém com partido -> null, e NÃO desconhecido',
  hostilidadeRelativa(null, null), null);

// ── Compatibilidade com o que já funcionava ─────────────────────────────────
console.log('\nCompatibilidade (Etapas 3 e 4 não podem quebrar)');
const SIDC_AMIGO = '10031000000000000000'; // default de perfis.sidc em 0001
ok('sem partido dos dois lados, o SIDC gravado passa intacto',
  sidcParaObservador(SIDC_AMIGO, null, null), SIDC_AMIGO);
ok('colega do mesmo partido continua amigo',
  sidcParaObservador(SIDC_AMIGO, AZUL, AZUL), SIDC_AMIGO);
ok('SIDC malformado não é corrompido',
  sidcParaObservador('nao-e-sidc', AZUL, VERMELHO), 'nao-e-sidc');
ok('aplicarHostilidade com chave desconhecida devolve o original',
  aplicarHostilidade(SIDC_AMIGO, 'BANANA'), SIDC_AMIGO);

// ── getSIDC continua sendo o mesmo de index.html ────────────────────────────
console.log('\ngetSIDC() — tabelas que saíram de index.html');
ok('sidc de 20 dígitos já pronto passa direto',
  getSIDC({ sidc: '10061510113400000000' }), '10061510113400000000');
ok('monta a partir de rótulos humanos',
  getSIDC({ hostilidade: 'HOSTIL', dimensao: 'UNIDADE', situacao: 'CONFIRMADA',
            escalao: 'PEL', natureza_code: '121100' }),
  '10061000131211000000');
ok('campos ausentes caem no default (desconhecido/unidade)',
  getSIDC({}), '10011000000000000000');
ok('a tabela HOSTILIDADE é a mesma de antes', HOSTILIDADE.HOSTIL, '06');

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
