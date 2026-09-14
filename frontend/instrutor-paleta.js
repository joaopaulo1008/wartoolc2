// instrutor-paleta.js — a aba "Marcação rápida" do painel do instrutor.
//
// Onde o instrutor MONTA a paleta que os alunos da turma dele usam. Par
// tela/regra de sempre: a regra pura está em paleta.js, o acesso ao banco em
// icones-rapidos.js (compartilhado com paleta-tela.js, o lado do aluno), e os
// <option> do catálogo em catalogo-form.js (compartilhados com o formulário de
// marcação do aluno). Mesmo desenho de instrutor-calcos.js / calcos.js /
// camadas.js / kml.js na Etapa 7.
//
// A decisão que define esta tela: o SIDC de um preset é montado pelo MESMO
// caminho que o aluno usa para marcar — catálogo oficial do MD/EB, hierárquico
// (categoria fixa o symbol set, e só aparecem entidades que existem nele),
// passando por getSIDC(). Nada de digitar SIDC à mão. Um campo de texto livre
// aqui seria rápido de escrever e criaria, na turma inteira, a classe de erro
// que a Etapa 9b passou uma etapa inteira consertando: um código plausível que
// desenha outra coisa.
import { supabase } from './auth.js';
import { getSIDC, decomporSidc, categoriaPorId, CATEGORIAS, descreverSidc } from './simbolos.js';
import { svgDoSimbolo } from './icones.js';
import {
  opcoesCategoria, opcoesItem, opcoesModificador, opcoesEscalao,
} from './catalogo-form.js';
import {
  buscarPaletaDaTurma, criarPreset, atualizarPreset, removerPreset,
  assinarPaleta, desassinarPaleta,
} from './icones-rapidos.js';
import {
  validarPreset, cabeMaisUm, proximaOrdem, ordenarPaleta,
  modoDoPreset, MAX_PRESETS, MAX_ROTULO, PASSO_ORDEM,
} from './paleta.js';

let turmaAtual = null;
let meuUserId = null;
let partidosDaTurma = [];
let presets = [];
let canal = null;
let editandoId = null; // id do preset em edição, ou null (= criando)

const el = (id) => document.getElementById(id);

function aviso(texto, cor = '#7a9ab8') {
  const n = el('paleta-status');
  if (!n) return;
  n.textContent = texto || '';
  n.style.color = cor;
}

// ── Formulário ───────────────────────────────────────────────────────────
function montarModificadores(categoriaId, mod1, mod2) {
  const caixa = el('paleta-modificadores');
  const cat = categoriaPorId(categoriaId);
  if (!caixa) return;
  if (!cat) { caixa.innerHTML = ''; return; }
  const blocos = [];
  if (cat.mod1.length) {
    blocos.push(`<div class="campo"><label for="paleta-mod1">Modificador 1</label>
      <select id="paleta-mod1">${opcoesModificador(cat.mod1, mod1)}</select></div>`);
  }
  if (cat.mod2.length) {
    blocos.push(`<div class="campo"><label for="paleta-mod2">Modificador 2</label>
      <select id="paleta-mod2">${opcoesModificador(cat.mod2, mod2)}</select></div>`);
  }
  caixa.innerHTML = blocos.join('');
}

function opcoesPartido(selecionado) {
  // "Perguntar ao aluno" é o rótulo de `partido_padrao_id` nulo, e está
  // escrito assim de propósito: no banco a coluna é nula, mas para quem monta
  // a paleta o que importa é o EFEITO — este botão vai pedir a força. Chamar
  // de "sem força" faria parecer que a marcação nasce sem partido nenhum.
  const nulo = `<option value=""${!selecionado ? ' selected' : ''}>Perguntar ao aluno</option>`;
  return nulo + partidosDaTurma
    .map((p) => `<option value="${p.id}"${p.id === selecionado ? ' selected' : ''}>${p.nome}</option>`)
    .join('');
}

// Lê o formulário e devolve o SIDC montado, ou '' se a categoria/item ainda
// não dão um símbolo válido.
function sidcDoFormulario() {
  const categoriaId = el('paleta-categoria')?.value || '';
  const codigo = el('paleta-item')?.value || '';
  if (!categoriaId || !codigo) return '';
  return getSIDC({
    dimensao: categoriaId,
    natureza_code: codigo,
    escalao: el('paleta-escalao')?.value || '',
    mod1: el('paleta-mod1')?.value || '',
    mod2: el('paleta-mod2')?.value || '',
  });
}

// A prévia é o mesmo desenho que vai aparecer no botão do aluno e no mapa —
// milsymbol, via icones.js. Mostrar o SÍMBOLO e o nome oficial que o código
// significa (descreverSidc) é o que deixa um engano de escolha visível AQUI,
// antes de a paleta inteira da turma passar a marcar a coisa errada.
function atualizarPrevia() {
  const sidc = sidcDoFormulario();
  const alvo = el('paleta-previa');
  const desc = el('paleta-previa-nome');
  if (!alvo) return;
  if (!sidc) { alvo.innerHTML = ''; if (desc) desc.textContent = ''; return; }
  alvo.innerHTML = svgDoSimbolo(sidc, { tamanho: 44 }) || '';
  if (desc) desc.textContent = descreverSidc(sidc) || '';
}

function limparFormulario() {
  editandoId = null;
  const rot = el('paleta-rotulo');
  if (rot) rot.value = '';
  const cat = el('paleta-categoria');
  if (cat) cat.value = CATEGORIAS[0].id;
  const item = el('paleta-item');
  if (item) item.innerHTML = opcoesItem(CATEGORIAS[0].id, '');
  montarModificadores(CATEGORIAS[0].id, '', '');
  const esc = el('paleta-escalao');
  if (esc) esc.value = '';
  const part = el('paleta-partido');
  if (part) part.innerHTML = opcoesPartido(null);
  const botao = el('paleta-salvar');
  if (botao) botao.textContent = 'Acrescentar à paleta';
  const cancelar = el('paleta-cancelar-edicao');
  if (cancelar) cancelar.hidden = true;
  atualizarPrevia();
}

// ── Lista ────────────────────────────────────────────────────────────────
function desenharLista() {
  const caixa = el('paleta-lista');
  if (!caixa) return;
  caixa.textContent = '';

  if (presets.length === 0) {
    const p = document.createElement('p');
    p.className = 'grade-sub';
    p.textContent = 'A paleta desta turma está vazia. Os alunos continuam podendo marcar tocando direto no mapa e preenchendo o formulário completo.';
    caixa.appendChild(p);
    return;
  }

  presets.forEach((preset, i) => {
    const linha = document.createElement('div');
    linha.className = 'paleta-linha';

    const simbolo = document.createElement('span');
    simbolo.className = 'paleta-simbolo';
    simbolo.innerHTML = svgDoSimbolo(preset.sidc, { tamanho: 30 }) || '';
    linha.appendChild(simbolo);

    const texto = document.createElement('div');
    texto.className = 'paleta-texto';
    const nome = document.createElement('b');
    nome.textContent = preset.rotulo;
    texto.appendChild(nome);
    const sub = document.createElement('small');
    const partido = partidosDaTurma.find((p) => p.id === preset.partido_padrao_id);
    sub.textContent = `${descreverSidc(preset.sidc) || 'símbolo não reconhecido'} · ` +
      (modoDoPreset(preset) === 'gravar'
        ? `grava como ${partido ? partido.nome : 'força removida'}`
        : 'pergunta a força ao aluno') +
      (preset.criado_por ? '' : ' · da paleta padrão');
    texto.appendChild(sub);
    linha.appendChild(texto);

    const acoes = document.createElement('div');
    acoes.className = 'paleta-acoes';

    // Subir/descer em vez de arrastar: arrastar exigiria uma biblioteca de
    // drag-and-drop (ou muito código de ponteiro) para um painel que o
    // instrutor abre uma vez antes do exercício. Dois botões resolvem, e
    // funcionam no toque sem gesto nenhum.
    const subir = botaoAcao('↑', 'Subir', i === 0, () => mover(i, -1));
    const descer = botaoAcao('↓', 'Descer', i === presets.length - 1, () => mover(i, +1));
    const editar = botaoAcao('Editar', 'Editar', false, () => carregarParaEdicao(preset));
    const apagar = botaoAcao('Remover', 'Remover', false, () => apagar_(preset));
    acoes.append(subir, descer, editar, apagar);
    linha.appendChild(acoes);

    caixa.appendChild(linha);
  });

  const { restam } = cabeMaisUm(presets);
  const contador = el('paleta-contador');
  if (contador) {
    contador.textContent = `${presets.length} de ${MAX_PRESETS} botões — cabem mais ${restam}.`;
  }
}

function botaoAcao(rotulo, titulo, desabilitado, aoClicar) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'paleta-btn';
  b.textContent = rotulo;
  b.title = titulo;
  b.disabled = desabilitado;
  b.addEventListener('click', aoClicar);
  return b;
}

// Troca a `ordem` dos DOIS presets envolvidos — não renumera a lista inteira.
// Renumerar custaria um UPDATE por linha, e cada UPDATE vira um evento de
// Realtime para os 60 aparelhos da turma no meio do exercício.
async function mover(indice, direcao) {
  const a = presets[indice];
  const b = presets[indice + direcao];
  if (!a || !b) return;
  const ordemA = Number(a.ordem ?? 0);
  const ordemB = Number(b.ordem ?? 0);
  // Troca simples das duas `ordem`. O caso de EMPATE precisa de tratamento
  // próprio: com ordens iguais, trocá-las não move nada (a lista continua
  // desempatando por criado_em, como ordenarPaleta() manda) e o botão pareceria
  // quebrado. Aí o que sobe recebe um passo a menos que o outro, o que resolve
  // o empate e a ordem de uma vez.
  const novaA = ordemA === ordemB ? ordemB - PASSO_ORDEM * direcao : ordemB;
  const novaB = ordemA;
  aviso('Reordenando…');
  const r1 = await atualizarPreset(a.id, { ordem: novaA });
  const r2 = await atualizarPreset(b.id, { ordem: novaB });
  if (!r1.ok || !r2.ok) { aviso(`Não foi possível reordenar (${r1.erro || r2.erro}).`, '#e05252'); return; }
  aviso('');
}

function carregarParaEdicao(preset) {
  editandoId = preset.id;
  el('paleta-rotulo').value = preset.rotulo;

  // Reabre o formulário NA ESCOLHA GRAVADA, decompondo o SIDC — mesma ideia
  // (e mesma função) que faz a edição de uma marcação pelo instrutor abrir no
  // que o aluno tinha escolhido, em vez de no primeiro item da lista.
  const d = decomporSidc(preset.sidc);
  const cat = categoriaPorId(d.categoriaId) ? d.categoriaId : CATEGORIAS[0].id;
  el('paleta-categoria').value = cat;
  el('paleta-item').innerHTML = opcoesItem(cat, d.codigoEntidade);
  montarModificadores(cat, d.mod1, d.mod2);
  el('paleta-escalao').value = d.escalao || '';
  el('paleta-partido').innerHTML = opcoesPartido(preset.partido_padrao_id);

  el('paleta-salvar').textContent = 'Salvar alterações';
  el('paleta-cancelar-edicao').hidden = false;
  atualizarPrevia();
  aviso(`Editando "${preset.rotulo}".`, '#f5c842');
  el('paleta-rotulo').focus();
}

async function apagar_(preset) {
  if (!confirm(`Remover "${preset.rotulo}" da paleta? Os alunos deixam de ver esse botão na hora.`)) return;
  const r = await removerPreset({ id: preset.id, usuarioId: meuUserId });
  if (!r.ok) { aviso(`Não foi possível remover (${r.erro}).`, '#e05252'); return; }
  aviso(`"${preset.rotulo}" removido.`);
}

async function salvar() {
  const rotulo = el('paleta-rotulo').value;
  const sidc = sidcDoFormulario();
  const partidoId = el('paleta-partido').value || null;

  const v = validarPreset({ rotulo, sidc, partidoId });
  if (!v.ok) { aviso(v.erro, '#e05252'); return; }

  if (editandoId) {
    const r = await atualizarPreset(editandoId, {
      rotulo: v.valor.rotulo, sidc: v.valor.sidc, partidoId: v.valor.partidoId,
    });
    if (!r.ok) { aviso(`Não foi possível salvar (${r.erro}).`, '#e05252'); return; }
    aviso(`"${v.valor.rotulo}" atualizado. Os alunos já estão vendo a mudança.`, '#7af57a');
    limparFormulario();
    return;
  }

  // O teto também é checado no banco (trigger de 0010) — aqui é para recusar
  // ANTES de gastar a ida ao servidor e com uma frase que explica o motivo,
  // mesma disciplina de três camadas do tamanho de calco na Etapa 7.
  const { cabe, erro } = cabeMaisUm(presets);
  if (!cabe) { aviso(erro, '#e05252'); return; }

  const r = await criarPreset({
    turmaId: turmaAtual,
    rotulo: v.valor.rotulo,
    sidc: v.valor.sidc,
    partidoId: v.valor.partidoId,
    ordem: proximaOrdem(presets),
    usuarioId: meuUserId,
  });
  if (!r.ok) { aviso(`Não foi possível acrescentar (${r.erro}).`, '#e05252'); return; }
  aviso(`"${v.valor.rotulo}" acrescentado. Já apareceu no app dos alunos.`, '#7af57a');
  limparFormulario();
}

// ── Realtime / carga ─────────────────────────────────────────────────────
function aplicarMudanca(linha) {
  const i = presets.findIndex((p) => p.id === linha.id);
  if (i >= 0) presets[i] = linha; else presets.push(linha);
  presets = ordenarPaleta(presets);
  desenharLista();
}

function aplicarSaida(id) {
  presets = presets.filter((p) => p.id !== id);
  if (editandoId === id) limparFormulario(); // outro instrutor removeu o que eu estava editando
  desenharLista();
}

async function recarregar() {
  const r = await buscarPaletaDaTurma(turmaAtual);
  presets = r.presets;
  if (!r.ok) aviso(`Não foi possível carregar a paleta (${r.erro}).`, '#e05252');
  desenharLista();
}

// ── Ponto de entrada ─────────────────────────────────────────────────────
export async function iniciarPaletaInstrutor({ userId } = {}) {
  meuUserId = userId;

  el('paleta-categoria').innerHTML = opcoesCategoria(CATEGORIAS[0].id);
  el('paleta-item').innerHTML = opcoesItem(CATEGORIAS[0].id, '');
  el('paleta-escalao').innerHTML = opcoesEscalao('');
  montarModificadores(CATEGORIAS[0].id, '', '');

  el('paleta-categoria').addEventListener('change', (ev) => {
    // Trocar de categoria zera item e modificadores: os códigos de entidade e
    // as tabelas de modificador são de cada symbol set, e "manter" a escolha
    // anterior produziria justamente a combinação inválida que a hierarquia
    // existe para impedir.
    el('paleta-item').innerHTML = opcoesItem(ev.target.value, '');
    montarModificadores(ev.target.value, '', '');
    atualizarPrevia();
  });
  for (const id of ['paleta-item', 'paleta-escalao']) {
    el(id).addEventListener('change', atualizarPrevia);
  }
  el('paleta-modificadores').addEventListener('change', atualizarPrevia);
  el('paleta-salvar').addEventListener('click', salvar);
  el('paleta-cancelar-edicao').addEventListener('click', () => {
    limparFormulario();
    aviso('');
  });
  el('paleta-rotulo').maxLength = MAX_ROTULO;

  limparFormulario();
}

// Chamado pelo seletor de turma do topo (observarTurma, de
// instrutor-permissoes.js) — o mesmo mecanismo que já troca a turma das abas
// de calcos e de situação. Sem isto, o instrutor editaria a paleta de uma
// turma achando que está na outra.
export async function definirTurmaPaleta(turmaId) {
  if (turmaId === turmaAtual) return;
  desassinarPaleta(canal);
  canal = null;
  turmaAtual = turmaId;
  presets = [];
  limparFormulario();
  if (!turmaId) { desenharLista(); return; }

  const { data } = await supabase
    .from('partidos').select('id, nome, ordem').eq('turma_id', turmaId).order('ordem');
  partidosDaTurma = data || [];
  el('paleta-partido').innerHTML = opcoesPartido(null);

  // Select inicial primeiro, assinatura depois — o Realtime não faz backfill.
  await recarregar();
  canal = assinarPaleta(turmaId, { aoMudar: aplicarMudanca, aoSair: aplicarSaida });
}
