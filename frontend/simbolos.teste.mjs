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
  ENTIDADES_SEM_DESENHO, exigeDesignacao, validarSidcDePerfil,
} from './simbolos.js';
import { CATEGORIAS } from './simbolos-catalogo.js';

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

// ── Quais símbolos saem SEM desenho central (varredura contra a milsymbol) ──
// Etapa 11: relatado em campo — *"um objeto marcado está saindo como
// genérico"*, um losango vermelho liso no mapa. A causa não é um defeito de
// desenho: "Comando Nomeado" (`10:000000`) É assim, porque o conteúdo dele é
// a SIGLA da unidade, não um ícone. ENTIDADES_SEM_DESENHO existe para o
// formulário poder avisar antes de gravar, e este teste é quem garante que a
// lista continua batendo com a realidade.
//
// A varredura roda contra a milsymbol de verdade, item por item do catálogo.
// É o único jeito honesto de manter uma lista escrita à mão: se uma versão
// nova da biblioteca passar a desenhar algo no Comando Nomeado, ou se um item
// novo do catálogo entrar sem desenho, o teste avisa em vez de a pessoa
// descobrir no mapa, em campo.
//
// Critério: um símbolo sem desenho central tem UM elemento gráfico no SVG (a
// moldura). Qualquer coisa dentro dela acrescenta pelo menos mais um — é o
// que separa os 433 restantes do único caso.
console.log('\nENTIDADES_SEM_DESENHO — varredura dos 434 itens do catálogo');
let ms = null;
try {
  const mod = await import('milsymbol');
  ms = mod.default || mod;
} catch {
  // `npm install` não foi rodado. Não é falha do código: é o teste dizendo o
  // que não conseguiu provar, em vez de passar em silêncio.
  console.log('  PULADO         milsymbol não instalada — rode `npm install` para esta parte valer');
}
if (ms) {
  const elementosDesenhados = (sidc, opcoes = {}) =>
    (new ms.Symbol(sidc, { size: 32, ...opcoes }).asSVG()
      .match(/<(path|circle|rect|line|polyline|polygon|text|ellipse)/g) || []).length;
  // Situação/HQ/escalão zerados: só a entidade importa para esta pergunta.
  const sidcDe = (symbolSet, entidade) => `1003${symbolSet}0000${entidade}0000`;

  const semDesenho = [];
  let itens = 0;
  for (const cat of CATEGORIAS) {
    for (const grupo of cat.grupos) {
      for (const [codigo] of grupo.itens) {
        itens += 1;
        if (elementosDesenhados(sidcDe(cat.symbolSet, codigo)) <= 1) {
          semDesenho.push(`${cat.symbolSet}:${codigo}`);
        }
      }
    }
  }

  ok('o catálogo não encolheu (434 itens varridos)', itens, 434);
  ok('exatamente UM item do catálogo sai só com a moldura', semDesenho.length, 1);
  ok('e ele é o Comando Nomeado', semDesenho[0], '10:000000');
  ok('que ENTIDADES_SEM_DESENHO conhece', ENTIDADES_SEM_DESENHO.has('10:000000'), true);
  ok('o código legado 120000 (Posto de Comando, pré-9b) também sai vazio',
    elementosDesenhados(sidcDe('10', '120000')), 1);
  ok('e ele também está na lista', ENTIDADES_SEM_DESENHO.has('10:120000'), true);
  ok('a lista não tem nada ALÉM desses dois (senão o formulário avisa à toa)',
    ENTIDADES_SEM_DESENHO.size, 2);
  ok('com a sigla preenchida, o Comando Nomeado passa a desenhar alguma coisa',
    elementosDesenhados(sidcDe('10', '000000'), { uniqueDesignation: '1ª Cia' }) > 1, true);
  ok('um item qualquer do catálogo NÃO exige designação (Infantaria)',
    exigeDesignacao('10', '121100'), false);
  ok('exigeDesignacao casa o par symbolSet+entidade, não só a entidade',
    exigeDesignacao('01', '000000'), false);
}

// ── O símbolo que pode virar AVATAR de uma pessoa (2026-09-14) ─────────────
// O painel do instrutor ganhou um editor do símbolo do aluno, e esta é a
// validação que fica entre ele e o `check (sidc ~ '^[0-9]{20}$')` da 0001.
//
// O caso que mais importa aqui é o TERCEIRO: o "Comando Nomeado" é ACEITO
// como avatar, ao contrário do que validarPreset() faz com um preset da
// paleta. Não é incoerência — é a mesma regra ("onde há campo de sigla,
// avisa; onde não há, recusa") aplicada a um lugar onde a sigla SEMPRE
// existe: colegas.js e gps.js desenham o nome de guerra como
// uniqueDesignation. Se alguém "uniformizar" as duas validações copiando a
// recusa para cá, é este teste que quebra.
console.log('\nSIDC de perfil (avatar do aluno)');
{
  const bom = getSIDC({ dimensao: 'unidades', natureza_code: '121100', escalao: 'PEL' });
  ok('um SIDC montado pelo catálogo é aceito', validarSidcDePerfil(bom).ok, true);
  ok('e volta com o valor intacto', validarSidcDePerfil(bom).valor, bom);

  const comandoNomeado = getSIDC({ dimensao: 'unidades', natureza_code: '000000' });
  ok('"Comando Nomeado" É aceito como avatar (o nome de guerra é a sigla)',
    validarSidcDePerfil(comandoNomeado).ok, true);
  ok('e ele é mesmo o símbolo que a paleta recusa',
    exigeDesignacao('10', '000000'), true);

  ok('vazio é recusado (a coluna é not null — "sem símbolo" não existe)',
    validarSidcDePerfil('').ok, false);
  ok('e a recusa do vazio fala de escolher, não de formato',
    /categoria/i.test(validarSidcDePerfil('').erro), true);
  ok('19 dígitos é recusado', validarSidcDePerfil('1003100000000000000').ok, false);
  ok('21 dígitos é recusado', validarSidcDePerfil('100310000000000000000').ok, false);
  ok('com letra no meio é recusado', validarSidcDePerfil('1003100000000000000X').ok, false);
  ok('null é recusado sem lançar', validarSidcDePerfil(null).ok, false);
  ok('undefined é recusado sem lançar', validarSidcDePerfil(undefined).ok, false);
  ok('número não é string e é recusado',
    validarSidcDePerfil(10031000000000000000).ok, false);
  ok('o próprio default do schema (perfis.sidc) é aceito',
    validarSidcDePerfil('10031000000000000000').ok, true);
}

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
