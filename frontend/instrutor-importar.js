// instrutor-importar.js — a aba "Nova turma (CSV)" do painel do instrutor.
//
// O que faz: o instrutor escolhe o nome, o código de acesso e o modo de posição
// da turma NOVA, sobe a planilha com as pessoas (CSV), vê o que está errado em
// cada linha antes de enviar e, estando tudo certo, manda criar. Quem cria as
// contas é a Edge Function `importar-turma` (service_role, só no servidor) —
// ver backend/supabase/functions/importar-turma/. A regra pura de leitura e
// validação do arquivo está em importar-turma.js e é testada à parte.
//
// Cuidados de segurança que moram AQUI:
//   - As senhas só existem na memória desta página, entre o arquivo ser lido e o
//     envio. Depois do envio (com sucesso ou não) a lista é descartada e o campo
//     de arquivo é limpo; a tela nunca mostra senha, nem na prévia.
//   - Tudo que veio do arquivo é escrito na tela com textContent (nunca como HTML):
//     um nome de guerra com "<script>" aparece como texto.

import { supabase } from './auth.js';
import {
  COLUNAS, MAX_PESSOAS, PARTIDOS_PADRAO,
  validarPessoas, validarTurma, montarPedido, resumirResultado, pareceCodificacaoErrada,
} from './importar-turma.js';
import { resumoDosNumeros } from './designacao.js';

const $ = (id) => document.getElementById(id);

let pessoasValidas = [];    // só preenchida quando o arquivo está sem erro
let leituraEmCurso = 0;     // descarta resposta de arquivo trocado no meio da leitura

function el(tag, texto, atributos = {}) {
  const e = document.createElement(tag);
  if (texto != null) e.textContent = texto;
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v);
  return e;
}

// O CSV de exemplo é gerado aqui (e não servido como arquivo) para nascer
// sempre com as colunas que o validador de fato aceita.
function baixarExemplo() {
  const linhas = [
    COLUNAS.join(';'),
    'prof01;TrocarDepois01;Joao Paulo;Paulo;Maj;instrutor;;UNIDADES;BN;;;;',
    'aluno01;Exerc2026-01;Fulano de Tal;Fulano;1 Ten;aluno;Azul;UNIDADES;PEL;;1;2;1º Pel / 2º Esqd',
    'aluno02;Exerc2026-02;Beltrano da Silva;Beltrano;2 Sgt;aluno;Vermelho;UNIDADES;PEL;;2;2;2º Pel / 2º Esqd',
  ];
  const blob = new Blob(['﻿' + linhas.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const a = el('a', null, { href: URL.createObjectURL(blob), download: 'turma-exemplo.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function lerArquivo(arquivo) {
  const buffer = await arquivo.arrayBuffer();
  let texto = new TextDecoder('utf-8').decode(buffer);
  // CSV "antigo" do Excel é Windows-1252: o acento vira U+FFFD quando lido como UTF-8.
  if (pareceCodificacaoErrada(texto)) texto = new TextDecoder('windows-1252').decode(buffer);
  return texto;
}

function mostrarProblemas(caixa, erros, avisos) {
  caixa.replaceChildren();
  if (erros.length) {
    caixa.append(el('div', `${erros.length} problema(s) — corrija a planilha e escolha o arquivo de novo:`, { class: 'importar-erro-titulo' }));
    const ul = el('ul');
    for (const e of erros.slice(0, 40)) ul.append(el('li', `Linha ${e.linha}: ${e.mensagem}`));
    if (erros.length > 40) ul.append(el('li', `… e mais ${erros.length - 40}.`));
    caixa.append(ul);
  }
  if (avisos.length) {
    const ul = el('ul', null, { class: 'importar-avisos' });
    for (const a of avisos) ul.append(el('li', a));
    caixa.append(ul);
  }
}

function mostrarPrevia(caixa, pessoas) {
  caixa.replaceChildren();
  if (!pessoas.length) return;
  const instrutores = pessoas.filter((p) => p.papel === 'instrutor').length;
  const porPartido = {};
  for (const p of pessoas.filter((x) => x.papel === 'usuario')) porPartido[p.partido] = (porPartido[p.partido] || 0) + 1;
  const partes = Object.entries(porPartido).map(([k, v]) => `${v} ${k}`).join(', ');
  caixa.append(el('div', `${pessoas.length} pessoa(s): ${instrutores} instrutor(es)${partes ? `, alunos: ${partes}` : ''}.`, { class: 'importar-resumo' }));

  const tabela = el('table', null, { class: 'tabela-resumo' });
  const cab = el('tr');
  for (const t of ['Linha', 'Usuário', 'Nome de guerra', 'Posto', 'Papel', 'Partido', 'Esq. | Dir.', 'Fração']) cab.append(el('th', t));
  tabela.append(cab);
  for (const p of pessoas.slice(0, 12)) {
    const tr = el('tr');
    for (const v of [p.linha, p.usuario, p.nome_guerra, p.posto_graduacao || '—', p.papel === 'usuario' ? 'aluno' : 'instrutor', p.partido || '—', resumoDosNumeros(p) || '—', p.nome_fracao || '—']) {
      tr.append(el('td', String(v)));
    }
    tabela.append(tr);
  }
  caixa.append(tabela);
  if (pessoas.length > 12) caixa.append(el('div', `… e mais ${pessoas.length - 12}. As senhas não são mostradas.`, { class: 'campo-dica' }));
}

function turmaDaTela() {
  return validarTurma({
    nome: $('importar-nome').value,
    codigo: $('importar-codigo').value,
    modo: $('importar-modo').value,
    descricao: $('importar-descricao').value,
  });
}

function atualizarBotao() {
  const { erros } = turmaDaTela();
  const pronto = pessoasValidas.length > 0 && erros.length === 0;
  $('importar-criar').disabled = !pronto;
  const dica = $('importar-turma-dica');
  dica.textContent = erros.length && ($('importar-nome').value || $('importar-codigo').value)
    ? erros.map((e) => e.mensagem).join(' ')
    : '';
}

async function aoEscolherArquivo() {
  const arquivo = $('importar-arquivo').files[0];
  const minha = ++leituraEmCurso;
  pessoasValidas = [];
  $('importar-resultado').replaceChildren();
  if (!arquivo) { mostrarProblemas($('importar-problemas'), [], []); mostrarPrevia($('importar-previa'), []); atualizarBotao(); return; }

  const texto = await lerArquivo(arquivo);
  if (minha !== leituraEmCurso) return;
  const r = validarPessoas(texto, { partidosValidos: PARTIDOS_PADRAO });
  pessoasValidas = r.pessoas;
  mostrarProblemas($('importar-problemas'), r.erros, r.avisos);
  mostrarPrevia($('importar-previa'), r.pessoas);
  atualizarBotao();
}

// A mensagem de erro de verdade está no corpo da resposta da função; o
// supabase-js só entrega um "non-2xx" genérico e o Response em `context`.
async function mensagemDoErro(error) {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const corpo = await error.context.json();
      if (corpo?.erro) return corpo.erro;
    }
  } catch { /* corpo ilegível: cai na mensagem genérica abaixo */ }
  if (/404|not found/i.test(error?.message || '') || error?.context?.status === 404) {
    return 'A função "importar-turma" não está publicada neste projeto Supabase. Veja backend/supabase/functions/importar-turma/README.md.';
  }
  if (/failed to fetch|network/i.test(error?.message || '')) return 'Sem conexão com o servidor.';
  return error?.message || 'Falha desconhecida.';
}

async function criar() {
  const { erros, turma } = turmaDaTela();
  if (erros.length || !pessoasValidas.length) return;

  const quantas = pessoasValidas.length;
  const modoTxt = turma.modo_posicao === 'manual' ? 'SIMULAÇÃO (posição manual, sem GPS)' : 'GPS';
  if (!window.confirm(`Criar a turma "${turma.nome}" (código ${turma.codigo_acesso}), modo ${modoTxt}, com ${quantas} conta(s)?\n\nA turma atual e o histórico dela não são tocados.`)) return;

  const pedido = montarPedido(turma, pessoasValidas);
  // Descarta as senhas da memória da página já aqui: daqui em diante só o pedido em voo as tem.
  pessoasValidas = [];
  $('importar-criar').disabled = true;
  $('importar-arquivo').value = '';
  const saida = $('importar-resultado');
  saida.replaceChildren(el('div', 'Criando…', { class: 'campo-dica' }));

  const { data, error } = await supabase.functions.invoke('importar-turma', { body: pedido });
  pedido.pessoas.length = 0;

  saida.replaceChildren();
  mostrarPrevia($('importar-previa'), []);
  mostrarProblemas($('importar-problemas'), [], []);

  if (error) {
    saida.append(el('div', `Não foi possível criar: ${await mensagemDoErro(error)}`, { class: 'importar-erro-titulo' }));
    return;
  }
  if (data?.desfeita) {
    saida.append(el('div', 'Nenhuma conta pôde ser criada, então a turma não foi mantida.', { class: 'importar-erro-titulo' }));
  } else {
    saida.append(el('div', resumirResultado(data), { class: 'importar-resumo' }));
    saida.append(el('div', 'Para trabalhar com a turma nova, recarregue o painel e escolha-a no seletor de turma. Os alunos entram com o usuário e a senha da planilha; o código de acesso só serve para quem se cadastrar sozinho.', { class: 'campo-dica' }));
    const b = el('button', 'Recarregar o painel', { type: 'button', class: 'botao-secundario' });
    b.addEventListener('click', () => window.location.reload());
    saida.append(b);
  }
  if (data?.erros?.length) {
    const ul = el('ul');
    for (const e of data.erros) ul.append(el('li', `${e.usuario}: ${e.motivo}`));
    saida.append(el('div', 'Contas com problema:', { class: 'importar-erro-titulo' }), ul);
  }
}

export function iniciarImportarTurma() {
  if (!$('painel-importar')) return;
  $('importar-limite').textContent = String(MAX_PESSOAS);
  $('importar-exemplo').addEventListener('click', baixarExemplo);
  $('importar-arquivo').addEventListener('change', aoEscolherArquivo);
  for (const id of ['importar-nome', 'importar-codigo', 'importar-modo', 'importar-descricao']) {
    $(id).addEventListener('input', atualizarBotao);
  }
  $('importar-criar').addEventListener('click', criar);
  atualizarBotao();
}
