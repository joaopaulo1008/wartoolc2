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

const AZUL     = { id: argAzul     || 'p-azul',     tipo: 'beligerante', ordem: 1 };
const VERMELHO = { id: argVermelho || 'p-vermelho', tipo: 'beligerante', ordem: 2 };
const VERDE    = { id: 'p-verde',    tipo: 'neutro',      ordem: 3 };
// Fixture SEM `ordem` — simula um embed antigo/desatualizado, para provar o
// fallback seguro (ver Etapa 11 abaixo).
const AZUL_SEM_ORDEM = { id: 'p-azul-legado', tipo: 'beligerante' };

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
ok('ninguém com partido (self, ver icones.js) -> null, e NÃO desconhecido',
  hostilidadeRelativa(null, null), null);

// ── Observador sem partido, mas elemento COM partido (o instrutor) ─────────
// Etapa 11: bug relatado em campo — "o instrutor vê os dois partidos como
// azul". O instrutor nunca tem partido (fn_sou_instrutor_da_turma bypassa a
// visibilidade normal) e via situacao.js enxerga os dois lados ao mesmo
// tempo; antes desta correção, os dois desenhavam com o MESMO placeholder de
// hostilidade (AMIGO/azul) gravado em perfis.sidc, ficando indistinguíveis.
console.log('\nObservador sem partido, elemento COM partido (instrutor) — Etapa 11');
ok('elemento é o partido de menor ordem (Azul, ordem 1) -> AMIGO (referência)',
  hostilidadeRelativa(null, AZUL), 'AMIGO');
ok('elemento é outro beligerante (Vermelho, ordem 2) -> HOSTIL',
  hostilidadeRelativa(null, VERMELHO), 'HOSTIL');
ok('elemento neutro -> NEUTRO, independente do observador',
  hostilidadeRelativa(null, VERDE), 'NEUTRO');
ok('elemento COM partido mas sem `ordem` no embed -> null (fallback seguro, não adivinha cor)',
  hostilidadeRelativa(null, AZUL_SEM_ORDEM), null);
ok('ponta a ponta: instrutor vendo um aluno do Vermelho -> SIDC sai com dígito HOSTIL (06)',
  sidcParaObservador(PEL_VERMELHO.sidc, null, VERMELHO).slice(2, 4), '06');
ok('ponta a ponta: instrutor vendo um aluno do Azul -> SIDC sai com dígito AMIGO (03), diferente do Vermelho acima',
  sidcParaObservador(PEL_VERMELHO.sidc, null, AZUL).slice(2, 4), '03');

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
