// importar-turma.js — da planilha (CSV) ao pedido de criação de uma turma.
//
// Módulo PURO: sem DOM, sem Supabase, sem relógio. Recebe o TEXTO do arquivo e
// devolve (a) as pessoas já validadas, com o SIDC calculado, ou (b) a lista de
// erros por linha. Quem fala com o servidor é instrutor-importar.js.
//
// POR QUE A VALIDAÇÃO MORA AQUI E TAMBÉM NO SERVIDOR
// --------------------------------------------------
// Aqui ela serve para o instrutor ver, ANTES de enviar, o que está errado em
// cada linha ("linha 14: partido 'Azull' não existe"). Não é barreira de
// segurança: quem cria conta é a Edge Function `importar-turma`, que revalida
// tudo (backend/supabase/functions/importar-turma/logica.js) porque o cliente
// sempre pode ser contornado. As regras que precisam ser IGUAIS nos dois lados
// (formato do usuário, tamanho da senha, formato do SIDC) são conferidas por
// um teste que lê os dois arquivos.
//
// O QUE O ARQUIVO TEM
// -------------------
// Uma linha por pessoa. Colunas (ver COLUNAS): usuario, senha, nome_completo,
// nome_guerra, posto_graduacao, papel, partido, dimensao, escalao,
// natureza_code. Os dados da TURMA (nome, código de acesso, modo de posição)
// não vêm no arquivo: são campos da tela, porque um CSV é uma tabela só e
// misturar "uma turma" com "cinquenta pessoas" na mesma grade é pedir erro.
//
// EXCEL EM PORTUGUÊS
// ------------------
// "Salvar como CSV" no Excel brasileiro separa por PONTO E VÍRGULA, não por
// vírgula, e a versão antiga ("CSV (separado por vírgulas)") grava em
// Windows-1252, não em UTF-8. Por isso o delimitador é detectado, e o chamador
// pode checar `pareceCodificacaoErrada()` para tentar de novo em 1252.

import { getSIDC, DIMENSAO, ESCALAO } from './simbolos.js';
import { NUMERO_MAXIMO, FRACAO_MAXIMA, validarNumero, validarFracao } from './designacao.js';

export const COLUNAS = Object.freeze([
  'usuario', 'senha', 'nome_completo', 'nome_guerra', 'posto_graduacao',
  'papel', 'partido', 'dimensao', 'escalao', 'natureza_code',
  'numero_esq', 'numero_dir', 'nome_fracao',
]);
export const COLUNAS_OBRIGATORIAS = Object.freeze(['usuario', 'senha', 'nome_guerra', 'papel']);

export const PAPEIS = Object.freeze(['instrutor', 'usuario']);
export const MODOS_NA_CRIACAO = Object.freeze(['gps', 'manual']);   // 'externa' ainda não existe
export const MAX_PESSOAS = 300;

// Mesmas regras de frontend/auth.js (validarUsuario) e da Edge Function.
export const REGEX_USUARIO = /^[a-zA-Z0-9._-]{3,20}$/;
export const SENHA_MINIMA = 6;
export const SENHA_MAXIMA = 72;   // bcrypt corta em 72 bytes: acima disso a senha "vale" menos do que parece
export const REGEX_CODIGO_TURMA = /^[A-Za-z0-9._-]{4,30}$/;

export const PARTIDOS_PADRAO = Object.freeze(['Azul', 'Vermelho']);   // criados pela trigger da migration 0003

// ── Texto ───────────────────────────────────────────────────────────────────

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = (s) => semAcento(s).trim().toLowerCase();

// Cabeçalhos que as pessoas realmente escrevem → nome canônico.
const ALIAS_COLUNA = {
  usuario: 'usuario', login: 'usuario', user: 'usuario',
  senha: 'senha', password: 'senha',
  nome_completo: 'nome_completo', nome: 'nome_completo', 'nome completo': 'nome_completo',
  nome_guerra: 'nome_guerra', 'nome de guerra': 'nome_guerra', guerra: 'nome_guerra',
  posto_graduacao: 'posto_graduacao', posto: 'posto_graduacao', graduacao: 'posto_graduacao',
  'posto/graduacao': 'posto_graduacao', 'posto graduacao': 'posto_graduacao',
  papel: 'papel', funcao: 'papel',
  partido: 'partido', forca: 'partido',
  dimensao: 'dimensao',
  escalao: 'escalao',
  natureza_code: 'natureza_code', natureza: 'natureza_code', 'codigo natureza': 'natureza_code',
  numero_esq: 'numero_esq', 'numero esq': 'numero_esq', 'numero esquerda': 'numero_esq', esquerda: 'numero_esq',
  numero_dir: 'numero_dir', 'numero dir': 'numero_dir', 'numero direita': 'numero_dir', direita: 'numero_dir',
  nome_fracao: 'nome_fracao', 'nome da fracao': 'nome_fracao', fracao: 'nome_fracao',
};
export function nomeCanonicoDaColuna(texto) {
  return ALIAS_COLUNA[chave(texto)] ?? ALIAS_COLUNA[chave(texto).replace(/\s+/g, '_')] ?? null;
}

// Um arquivo gravado em Windows-1252 e lido como UTF-8 deixa U+FFFD no lugar de
// cada acento. Se aparecer, o chamador relê o arquivo como 1252.
export const pareceCodificacaoErrada = (texto) => String(texto).includes('�');

// ── CSV ─────────────────────────────────────────────────────────────────────

function detectarDelimitador(texto) {
  // Conta fora de aspas, só na primeira linha (o cabeçalho): vence o que mais aparece.
  let dentro = false;
  const n = { ';': 0, ',': 0, '\t': 0 };
  for (const c of texto) {
    if (c === '"') dentro = !dentro;
    else if (!dentro && (c === '\n' || c === '\r')) break;
    else if (!dentro && c in n) n[c] += 1;
  }
  const [melhor, qtd] = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return qtd > 0 ? melhor : ';';
}

// Parser de CSV (RFC 4180): campos entre aspas, "" como aspas literal, quebras
// de linha dentro de campo, CRLF ou LF, BOM no começo. Devolve matriz de strings.
export function lerCsv(texto, delimitador) {
  let t = String(texto ?? '');
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const delim = delimitador || detectarDelimitador(t);
  const linhas = [];
  let campo = '';
  let linha = [];
  let dentro = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (dentro) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i += 1; } else dentro = false;
      } else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === delim) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i += 1;
      linha.push(campo); campo = '';
      linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  // Linhas totalmente vazias (típicas do fim de planilha do Excel: ";;;;;;") somem.
  return { delimitador: delim, linhas: linhas.filter((l) => l.some((v) => v.trim() !== '')) };
}

// ── Validação das pessoas ───────────────────────────────────────────────────

const PAPEL_ALIAS = {
  instrutor: 'instrutor',
  usuario: 'usuario', aluno: 'usuario',
};

// natureza_code vazio → símbolo genérico (como no seed antigo). Com valor, tem
// que ter 6 dígitos (só a entidade) ou 10 (entidade + modificadores): é o que
// getSIDC() aceita. Excel come zero à esquerda de célula numérica, daí a dica.
const REGEX_NATUREZA = /^(\d{6}|\d{10})$/;

/**
 * @param {string} texto  conteúdo do CSV
 * @param {{partidosValidos?: string[]}} [opcoes]
 * @returns {{ pessoas: object[], erros: {linha:number, campo:string|null, mensagem:string}[],
 *             avisos: string[], delimitador: string }}
 *   `linha` é o número da linha NA PLANILHA (cabeçalho = 1), para o instrutor achar.
 */
export function validarPessoas(texto, { partidosValidos = PARTIDOS_PADRAO } = {}) {
  const erros = [];
  const avisos = [];
  const { delimitador, linhas } = lerCsv(texto);
  const vazio = { pessoas: [], erros, avisos, delimitador };
  const erro = (linha, campo, mensagem) => erros.push({ linha, campo, mensagem });

  if (linhas.length === 0) { erro(1, null, 'O arquivo está vazio.'); return vazio; }

  const cabecalho = linhas[0].map(nomeCanonicoDaColuna);
  const cabecalhoOriginal = linhas[0];
  const posicao = {};
  cabecalho.forEach((nome, i) => {
    if (nome == null) {
      if (cabecalhoOriginal[i].trim()) avisos.push(`Coluna "${cabecalhoOriginal[i].trim()}" não é reconhecida e foi ignorada.`);
    } else if (nome in posicao) {
      erro(1, nome, `A coluna "${nome}" aparece duas vezes no cabeçalho.`);
    } else posicao[nome] = i;
  });
  for (const obrig of COLUNAS_OBRIGATORIAS) {
    if (!(obrig in posicao)) erro(1, obrig, `Falta a coluna obrigatória "${obrig}" no cabeçalho.`);
  }
  if (erros.length) return vazio;

  const corpo = linhas.slice(1);
  if (corpo.length === 0) { erro(2, null, 'Não há nenhuma pessoa abaixo do cabeçalho.'); return vazio; }
  if (corpo.length > MAX_PESSOAS) {
    erro(1, null, `São ${corpo.length} linhas; o limite por importação é ${MAX_PESSOAS}. Divida em duas turmas ou em dois arquivos.`);
    return vazio;
  }

  const partidoPorChave = new Map(partidosValidos.map((p) => [chave(p), p]));
  const valor = (l, nome) => (nome in posicao ? String(l[posicao[nome]] ?? '').trim() : '');
  const vistos = new Map();
  const pessoas = [];

  corpo.forEach((l, i) => {
    const n = i + 2;   // +1 do índice, +1 do cabeçalho
    const antes = erros.length;

    const usuario = valor(l, 'usuario').toLowerCase();
    if (!REGEX_USUARIO.test(usuario)) {
      erro(n, 'usuario', `Usuário "${valor(l, 'usuario')}" inválido: 3 a 20 caracteres entre letras, números, ponto, hífen e sublinhado (sem espaços nem @).`);
    } else if (vistos.has(usuario)) {
      erro(n, 'usuario', `Usuário "${usuario}" repetido (já está na linha ${vistos.get(usuario)}).`);
    } else vistos.set(usuario, n);

    const senha = valor(l, 'senha');
    if (senha.length < SENHA_MINIMA) erro(n, 'senha', `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
    else if (senha.length > SENHA_MAXIMA) erro(n, 'senha', `A senha passa de ${SENHA_MAXIMA} caracteres.`);

    const nomeGuerra = valor(l, 'nome_guerra');
    if (!nomeGuerra) erro(n, 'nome_guerra', 'Falta o nome de guerra (é o que aparece no mapa).');
    else if (nomeGuerra.length > 30) erro(n, 'nome_guerra', 'Nome de guerra com mais de 30 caracteres — mantenha curto.');

    const papel = PAPEL_ALIAS[chave(valor(l, 'papel'))];
    if (!papel) erro(n, 'papel', `Papel "${valor(l, 'papel')}" inválido: use "instrutor" ou "aluno".`);

    let partido = null;
    const partidoTexto = valor(l, 'partido');
    if (partidoTexto) {
      partido = partidoPorChave.get(chave(partidoTexto)) ?? null;
      if (!partido) erro(n, 'partido', `Partido "${partidoTexto}" não existe nesta turma (use ${partidosValidos.join(' ou ')}).`);
    } else if (papel === 'usuario') {
      // Sem partido o aluno não enxerga ninguém (fn_usuarios_visiveis, 0003).
      erro(n, 'partido', 'Aluno sem partido não vê ninguém no mapa. Preencha Azul ou Vermelho.');
    }

    const dimensaoTexto = valor(l, 'dimensao').toUpperCase() || 'UNIDADES';
    if (!(dimensaoTexto in DIMENSAO)) erro(n, 'dimensao', `Dimensão "${valor(l, 'dimensao')}" desconhecida (veja a aba Listas do modelo).`);

    const escalaoTexto = valor(l, 'escalao').toUpperCase() || 'NONE';
    if (!(escalaoTexto in ESCALAO)) erro(n, 'escalao', `Escalão "${valor(l, 'escalao')}" desconhecido (veja a aba Listas do modelo).`);

    const natureza = valor(l, 'natureza_code');
    if (natureza && !REGEX_NATUREZA.test(natureza)) {
      erro(n, 'natureza_code', `Natureza "${natureza}" inválida: use 6 ou 10 dígitos, ou deixe vazio. (O Excel apaga zeros à esquerda — formate a coluna como Texto.)`);
    }

    // Designação do símbolo (0018): números à esquerda/direita e nome da fração.
    // Vazio = sem número (o mapa continua escrevendo o nome de guerra).
    const numEsq = validarNumero(valor(l, 'numero_esq'), 'Número à esquerda');
    if (!numEsq.ok) erro(n, 'numero_esq', `${numEsq.erro} (Excel: formate a coluna como Texto.)`);
    const numDir = validarNumero(valor(l, 'numero_dir'), 'Número à direita');
    if (!numDir.ok) erro(n, 'numero_dir', numDir.erro);
    const fracao = validarFracao(valor(l, 'nome_fracao'));
    if (!fracao.ok) erro(n, 'nome_fracao', fracao.erro);

    if (erros.length === antes) {
      pessoas.push({
        linha: n,
        usuario,
        senha,
        nome_completo: valor(l, 'nome_completo') || nomeGuerra,
        nome_guerra: nomeGuerra,
        posto_graduacao: valor(l, 'posto_graduacao') || null,
        papel,
        partido,
        // Hostilidade AMIGO: o desenho do símbolo de cada um é reescrito na tela
        // pela hostilidade RELATIVA ao observador (aplicarHostilidade), então
        // este valor só importa como "o padrão do cadastro".
        sidc: getSIDC({ hostilidade: 'AMIGO', dimensao: dimensaoTexto, escalao: escalaoTexto, natureza_code: natureza }),
        numero_esq: numEsq.valor,
        numero_dir: numDir.valor,
        nome_fracao: fracao.valor,
      });
    }
  });

  if (!erros.length) {
    if (!pessoas.some((p) => p.papel === 'instrutor')) {
      avisos.push('Nenhum instrutor no arquivo. Você continua sendo o responsável pela turma; só não haverá outro instrutor lotado nela.');
    }
    if (pessoas.length > 1 && new Set(pessoas.map((p) => p.senha)).size === 1) {
      avisos.push('Todas as pessoas têm a MESMA senha. Funciona, mas qualquer um entra na conta de qualquer outro.');
    }
  }
  return { pessoas: erros.length ? [] : pessoas, erros, avisos, delimitador };
}

// ── Turma ───────────────────────────────────────────────────────────────────

export function validarTurma({ nome, codigo, modo, descricao } = {}) {
  const erros = [];
  const n = String(nome ?? '').trim();
  const c = String(codigo ?? '').trim();
  const m = modo ?? 'gps';
  if (n.length < 3 || n.length > 80) erros.push({ campo: 'nome', mensagem: 'O nome da turma precisa ter de 3 a 80 caracteres.' });
  if (!REGEX_CODIGO_TURMA.test(c)) {
    erros.push({ campo: 'codigo', mensagem: 'O código de acesso precisa ter de 4 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.' });
  }
  if (!MODOS_NA_CRIACAO.includes(m)) erros.push({ campo: 'modo', mensagem: 'Modo de posição inválido.' });
  return {
    erros,
    turma: { nome: n, codigo_acesso: c, modo_posicao: m, descricao: String(descricao ?? '').trim() || null },
  };
}

// O corpo do pedido à Edge Function. `linha` fica de fora das pessoas: o
// servidor devolve os erros pelo número de ORDEM no pedido (índice + 2).
export function montarPedido(turma, pessoas) {
  return { turma, pessoas: pessoas.map(({ linha, ...resto }) => resto) };   // eslint-disable-line no-unused-vars
}

// Traduz o relatório do servidor numa frase para a tela.
export function resumirResultado(r) {
  if (!r || typeof r !== 'object') return 'Resposta inesperada do servidor.';
  const partes = [`Turma "${r.turma?.nome}" criada (código ${r.turma?.codigo_acesso}).`];
  partes.push(`${r.criados?.length ?? 0} conta(s) criada(s).`);
  if (r.jaExistiam?.length) partes.push(`${r.jaExistiam.length} já existiam e NÃO foram movidas para esta turma: ${r.jaExistiam.join(', ')}.`);
  if (r.erros?.length) partes.push(`${r.erros.length} com erro.`);
  return partes.join(' ');
}
