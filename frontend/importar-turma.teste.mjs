// importar-turma.teste.mjs — a leitura e a validação do CSV de importação de turma.
//
// Rodar:  node frontend/importar-turma.teste.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as M from './importar-turma.js';
import * as S from '../backend/supabase/functions/importar-turma/logica.js';
import * as D from './designacao.js';

const aqui = dirname(fileURLToPath(import.meta.url));
let passou = 0;
const falhas = [];
function ok(nome, obtido, esperado) {
  const bom = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bom) passou += 1;
  else { falhas.push(nome); console.log(`  ** FALHOU **  ${nome}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`); }
}

const CAB = 'usuario;senha;nome_completo;nome_guerra;posto_graduacao;papel;partido;dimensao;escalao;natureza_code';

// ── lerCsv ──────────────────────────────────────────────────────────────────
console.log('lerCsv');
ok('delimitador ; detectado (Excel pt-BR)', M.lerCsv('a;b;c\n1;2;3').delimitador, ';');
ok('delimitador , detectado', M.lerCsv('a,b,c\n1,2,3').delimitador, ',');
ok('delimitador tab detectado', M.lerCsv('a\tb\tc\n1\t2\t3').delimitador, '\t');
ok('vírgula dentro de aspas não conta como delimitador', M.lerCsv('"a,b";c\n1;2').delimitador, ';');
ok('BOM no começo some', M.lerCsv('﻿a;b\n1;2').linhas[0], ['a', 'b']);
ok('CRLF', M.lerCsv('a;b\r\n1;2\r\n').linhas, [['a', 'b'], ['1', '2']]);
ok('aspas duplicadas viram aspas', M.lerCsv('a;b\n"diz ""oi""";2').linhas[1], ['diz "oi"', '2']);
ok('quebra de linha dentro de aspas', M.lerCsv('a;b\n"x\ny";2').linhas[1], ['x\ny', '2']);
ok('linhas só de separadores somem (sobra do Excel)', M.lerCsv('a;b\n1;2\n;\n;;\n').linhas, [['a', 'b'], ['1', '2']]);
ok('campo vazio no meio é preservado', M.lerCsv('a;b;c\n1;;3').linhas[1], ['1', '', '3']);
ok('sem quebra final', M.lerCsv('a;b\n1;2').linhas[1], ['1', '2']);
ok('texto vazio', M.lerCsv('').linhas, []);
ok('pareceCodificacaoErrada', [M.pareceCodificacaoErrada('Guerra �'), M.pareceCodificacaoErrada('Guerra é')], [true, false]);

// ── cabeçalho ───────────────────────────────────────────────────────────────
console.log('cabeçalho');
ok('aliases acentuados e com espaço', ['Usuário', 'Nome de Guerra', 'Posto/Graduação', 'Função', 'Força', 'Escalão'].map(M.nomeCanonicoDaColuna),
  ['usuario', 'nome_guerra', 'posto_graduacao', 'papel', 'partido', 'escalao']);
ok('coluna desconhecida → null', M.nomeCanonicoDaColuna('cor do olho'), null);
{
  const r = M.validarPessoas('usuario;senha\nx;y');
  ok('faltam colunas obrigatórias → erro por coluna', r.erros.map((e) => e.campo).sort(), ['nome_guerra', 'papel']);
  ok('e nenhuma pessoa sai', r.pessoas, []);
}
ok('coluna duplicada é erro', M.validarPessoas(`${CAB};usuario\nx`).erros.some((e) => /duas vezes/.test(e.mensagem)), true);
ok('coluna desconhecida só avisa', M.validarPessoas(`${CAB};obs\naluno01;senha123;Fulano;Fulano;Cap;aluno;Azul;;;;x`).avisos.some((a) => /obs/.test(a)), true);
ok('arquivo vazio', M.validarPessoas('').erros[0].mensagem, 'O arquivo está vazio.');
ok('só cabeçalho', M.validarPessoas(CAB).erros[0].linha, 2);

// ── pessoas válidas ─────────────────────────────────────────────────────────
console.log('pessoas');
const LINHAS_OK = [
  CAB,
  'prof01;Senha#2026;Joao Paulo;Paulo;Maj;instrutor;;UNIDADES;BN;',
  'aluno01;Exerc2026-01;Fulano de Tal;Fulano;1 Ten;aluno;Azul;UNIDADES;PEL;',
  'ALUNO02;Exerc2026-02;;Beltrano;2 Sgt;Aluno;vermelho;INDIVIDUOS_DESEMBARCADOS;NONE;',
].join('\r\n');
{
  const r = M.validarPessoas(LINHAS_OK);
  ok('sem erros', r.erros, []);
  ok('três pessoas', r.pessoas.length, 3);
  const [prof, a1, a2] = r.pessoas;
  ok('instrutor sem partido é válido', [prof.papel, prof.partido], ['instrutor', null]);
  ok('"aluno" vira papel usuario', a1.papel, 'usuario');
  ok('partido normalizado (caixa)', a2.partido, 'Vermelho');
  ok('usuário em minúsculas', a2.usuario, 'aluno02');
  ok('nome completo cai no nome de guerra quando vazio', a2.nome_completo, 'Beltrano');
  ok('SIDC tem 20 dígitos', r.pessoas.every((p) => /^[0-9]{20}$/.test(p.sidc)), true);
  ok('SIDC amigo (03)', a1.sidc.slice(2, 4), '03');
  ok('escalão PEL = 13', a1.sidc.slice(8, 10), '13');
  ok('escalão BN = 15', prof.sidc.slice(8, 10), '15');
  ok('linha da planilha preservada', r.pessoas.map((p) => p.linha), [2, 3, 4]);
  ok('senha inalterada', prof.senha, 'Senha#2026');
  ok('aviso: não há senha repetida', r.avisos.some((a) => /MESMA senha/.test(a)), false);
}
{
  const r = M.validarPessoas(['usuario,senha,nome_guerra,papel,partido', 'aaa1,123456,A,aluno,Azul', 'aaa2,123456,B,aluno,Azul'].join('\n'));
  ok('só as colunas obrigatórias + partido bastam', r.erros, []);
  ok('aviso de senha repetida', r.avisos.some((a) => /MESMA senha/.test(a)), true);
  ok('aviso de que não há instrutor', r.avisos.some((a) => /Nenhum instrutor/.test(a)), true);
}
ok('dimensão vazia → padrão UNIDADES e escalão NONE', (() => {
  const p = M.validarPessoas('usuario;senha;nome_guerra;papel;partido\nabc;123456;A;aluno;Azul').pessoas[0];
  return [p.sidc.slice(4, 6), p.sidc.slice(8, 10)];
})(), ['10', '00']);
ok('natureza de 10 dígitos entra no SIDC', M.validarPessoas(`${CAB}\nabc;123456;A;A;Cap;aluno;Azul;UNIDADES;PEL;1211020000`).pessoas[0].sidc.slice(10), '1211020000');

// ── erros por linha ─────────────────────────────────────────────────────────
console.log('erros');
const erroDe = (linha, campo) => M.validarPessoas(`${CAB}\n${linha}`).erros.find((e) => e.campo === campo);
ok('usuário curto', erroDe('ab;123456;A;A;Cap;aluno;Azul;;;', 'usuario')?.linha, 2);
ok('usuário com espaço', !!erroDe('joao silva;123456;A;A;Cap;aluno;Azul;;;', 'usuario'), true);
ok('usuário com @', !!erroDe('a@b.com;123456;A;A;Cap;aluno;Azul;;;', 'usuario'), true);
ok('senha curta', !!erroDe('abc;123;A;A;Cap;aluno;Azul;;;', 'senha'), true);
ok('senha longa', !!erroDe(`abc;${'x'.repeat(73)};A;A;Cap;aluno;Azul;;;`, 'senha'), true);
ok('sem nome de guerra', !!erroDe('abc;123456;A;;Cap;aluno;Azul;;;', 'nome_guerra'), true);
ok('papel inválido', !!erroDe('abc;123456;A;A;Cap;comandante;Azul;;;', 'papel'), true);
ok('partido inexistente', /Azull/.test(erroDe('abc;123456;A;A;Cap;aluno;Azull;;;', 'partido')?.mensagem ?? ''), true);
ok('aluno sem partido é erro (ele não veria ninguém)', !!erroDe('abc;123456;A;A;Cap;aluno;;;;', 'partido'), true);
ok('instrutor sem partido NÃO é erro', erroDe('abc;123456;A;A;Cap;instrutor;;;;', 'partido'), undefined);
ok('dimensão desconhecida', !!erroDe('abc;123456;A;A;Cap;aluno;Azul;NAVIO;;', 'dimensao'), true);
ok('escalão desconhecido', !!erroDe('abc;123456;A;A;Cap;aluno;Azul;;GIGANTE;', 'escalao'), true);
ok('natureza com 5 dígitos (zero comido pelo Excel)', /Texto/.test(erroDe('abc;123456;A;A;Cap;aluno;Azul;;;12110', 'natureza_code')?.mensagem ?? ''), true);
{
  const r = M.validarPessoas(`${CAB}\nabc;123456;A;A;Cap;aluno;Azul;;;\nabc;123456;B;B;Cap;aluno;Azul;;;`);
  ok('usuário repetido aponta a linha anterior', r.erros.find((e) => /repetido/.test(e.mensagem))?.mensagem.includes('linha 2'), true);
}
{
  const r = M.validarPessoas(`${CAB}\nabc;123456;A;A;Cap;aluno;Azul;;;\nxx;1;B;B;Cap;aluno;Azul;;;`);
  ok('qualquer erro → NENHUMA pessoa sai (não se envia pela metade)', r.pessoas, []);
  ok('erro tem o número certo da linha', r.erros[0].linha, 3);
}
ok('erros acumulam na mesma linha', M.validarPessoas(`${CAB}\nab;1;;;Cap;chefe;Roxo;;;`).erros.length >= 5, true);
ok('partidos válidos podem ser trocados', M.validarPessoas(`${CAB}\nabc;123456;A;A;Cap;aluno;Verde;;;`, { partidosValidos: ['Azul', 'Verde'] }).erros, []);
ok('limite de pessoas', M.validarPessoas(`${CAB}\n${Array.from({ length: 301 }, (_, i) => `u${String(i).padStart(4, '0')};123456;A;A;Cap;aluno;Azul;;;`).join('\n')}`).erros[0].mensagem.includes('300'), true);

// ── turma ───────────────────────────────────────────────────────────────────
console.log('turma');
ok('turma válida', M.validarTurma({ nome: 'Arandu 26', codigo: 'ARANDU-26', modo: 'manual' }).erros, []);
ok('modo padrão é gps', M.validarTurma({ nome: 'Arandu 26', codigo: 'ARANDU-26' }).turma.modo_posicao, 'gps');
ok('externa não é aceita ainda', M.validarTurma({ nome: 'Arandu 26', codigo: 'ARANDU-26', modo: 'externa' }).erros.map((e) => e.campo), ['modo']);
ok('código com espaço', M.validarTurma({ nome: 'Arandu 26', codigo: 'ARANDU 26' }).erros.map((e) => e.campo), ['codigo']);
ok('nome curto', M.validarTurma({ nome: 'ab', codigo: 'ARANDU-26' }).erros.map((e) => e.campo), ['nome']);
ok('espaços nas pontas saem', M.validarTurma({ nome: '  Arandu 26 ', codigo: ' ARANDU-26 ' }).turma, { nome: 'Arandu 26', codigo_acesso: 'ARANDU-26', modo_posicao: 'gps', descricao: null });

// ── pedido ──────────────────────────────────────────────────────────────────
console.log('pedido');
{
  const { pessoas } = M.validarPessoas(LINHAS_OK);
  const { turma } = M.validarTurma({ nome: 'Arandu 26', codigo: 'ARANDU-26', modo: 'manual' });
  const pedido = M.montarPedido(turma, pessoas);
  ok('o pedido sai sem o número de linha', 'linha' in pedido.pessoas[0], false);
  ok('o pedido montado PASSA na validação do servidor', (() => { try { S.validarPedido(pedido); return true; } catch (e) { return e.message; } })(), true);
  ok('resumo do resultado', M.resumirResultado({ turma: { nome: 'X', codigo_acesso: 'C' }, criados: ['a', 'b'], jaExistiam: ['c'], erros: [] }),
    'Turma "X" criada (código C). 2 conta(s) criada(s). 1 já existiam e NÃO foram movidas para esta turma: c.');
}

// ── pontes: o que tem que ser IGUAL no cliente e no servidor ────────────────
console.log('pontes');
ok('REGEX_USUARIO igual no cliente e no servidor', String(M.REGEX_USUARIO), String(S.REGEX_USUARIO));
ok('REGEX_CODIGO_TURMA igual', String(M.REGEX_CODIGO_TURMA), String(S.REGEX_CODIGO_TURMA));
ok('limites de senha iguais', [M.SENHA_MINIMA, M.SENHA_MAXIMA], [S.SENHA_MINIMA, S.SENHA_MAXIMA]);
ok('MAX_PESSOAS igual', M.MAX_PESSOAS, S.MAX_PESSOAS);
ok('modos aceitos na criação iguais', [...M.MODOS_NA_CRIACAO], S.MODOS_NA_CRIACAO);
const auth = readFileSync(join(aqui, 'auth.js'), 'utf8');
ok('REGEX_USUARIO igual à do login (auth.js)', auth.match(/REGEX_USUARIO = (\/.*\/);/)?.[1], String(M.REGEX_USUARIO));
ok('domínio de e-mail igual ao do login (auth.js)', auth.match(/DOMINIO_EMAIL = '([^']+)'/)?.[1], S.DOMINIO_EMAIL);
const mig = readFileSync(join(aqui, '..', 'backend', 'supabase', '0016_modo_posicao_simulacao.sql'), 'utf8');
ok('modos da criação existem no check do banco (0016)', M.MODOS_NA_CRIACAO.every((m) => mig.includes(`'${m}'`)), true);
const trig = readFileSync(join(aqui, '..', 'backend', 'supabase', '0003_partidos.sql'), 'utf8');
ok('partidos padrão iguais aos que a trigger cria (0003)', M.PARTIDOS_PADRAO.every((p) => trig.includes(`'${p}'`)), true);

// ── designação do símbolo (0018) ────────────────────────────────────────────
console.log('designação');
const CAB2 = `${CAB};numero_esq;numero_dir;nome_fracao`;
{
  const r = M.validarPessoas(`${CAB2}\naluno01;123456;A;A;Cap;aluno;Azul;UNIDADES;PEL;;1;2;1º Pel / 2º Esqd\naluno02;123456;B;B;Cap;aluno;Azul;;;;;;`);
  ok('colunas novas lidas', r.erros, []);
  ok('números e fração chegam à pessoa', [r.pessoas[0].numero_esq, r.pessoas[0].numero_dir, r.pessoas[0].nome_fracao], ['1', '2', '1º Pel / 2º Esqd']);
  ok('vazio vira null (nunca string vazia)', [r.pessoas[1].numero_esq, r.pessoas[1].numero_dir, r.pessoas[1].nome_fracao], [null, null, null]);
}
{
  const r = M.validarPessoas('usuario;senha;nome_guerra;papel;partido\nabc;123456;A;aluno;Azul');
  ok('planilha antiga (sem as colunas novas) continua valendo', [r.erros.length, r.pessoas[0].numero_esq, r.pessoas[0].nome_fracao], [0, null, null]);
}
ok('aliases das colunas novas', ['Número esquerda', 'numero dir', 'Nome da fração', 'Fração'].map(M.nomeCanonicoDaColuna), ['numero_esq', 'numero_dir', 'nome_fracao', 'nome_fracao']);
{
  const err = (campo, v) => M.validarPessoas(`${CAB2}\nabc;123456;A;A;Cap;aluno;Azul;;;;${campo === 'numero_esq' ? v : ''};${campo === 'numero_dir' ? v : ''};${campo === 'nome_fracao' ? v : ''}`).erros.find((e) => e.campo === campo);
  ok('número esquerdo com 5 caracteres é erro (linha 2)', err('numero_esq', '12345')?.linha, 2);
  ok('número direito com 5 caracteres é erro', !!err('numero_dir', '12345'), true);
  ok('número com 4 caracteres passa', !!err('numero_esq', '1234'), false);
  ok('fração com 21 caracteres é erro', !!err('nome_fracao', 'x'.repeat(21)), true);
  ok('fração com 20 caracteres passa', !!err('nome_fracao', 'x'.repeat(20)), false);
}
ok('montarPedido leva a designação ao servidor', M.montarPedido({}, [{ linha: 2, usuario: 'abc', numero_esq: '1', numero_dir: '2', nome_fracao: 'X' }]).pessoas[0], { usuario: 'abc', numero_esq: '1', numero_dir: '2', nome_fracao: 'X' });
// Os limites têm que ser os do banco (0018) e os do servidor.
const mig18 = readFileSync(join(aqui, '..', 'backend', 'supabase', '0018_designacao_do_calunga.sql'), 'utf8');
ok('limite do número = CHECK da 0018', mig18.includes(`between 1 and ${D.NUMERO_MAXIMO}`) || /char_length\(numero_esq\) between 1 and 4/.test(mig18), true);
ok('limite da fração = CHECK da 0018', /char_length\(nome_fracao\) between 1 and 20/.test(mig18), true);
ok('limites iguais aos do servidor', [D.NUMERO_MAXIMO, D.FRACAO_MAXIMA], [S.NUMERO_MAXIMO, S.FRACAO_MAXIMA]);
ok('colunas da planilha existem em perfis (0018)', ['numero_esq', 'numero_dir', 'nome_fracao'].every((c) => mig18.includes(c) && M.COLUNAS.includes(c)), true);

const total = passou + falhas.length;
console.log(`\n${passou} passaram, ${falhas.length} falharam, ${total} total`);
process.exit(falhas.length ? 1 : 0);
