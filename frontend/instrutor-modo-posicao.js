// instrutor-modo-posicao.js — o controle do instrutor para o modo de posição
// da turma (GPS ou simulação).
//
// O QUE É
// -------
// Um seletor na barra de contexto do painel, ao lado do seletor de turma. Ele
// grava `turmas.modo_posicao` (migration 0016) da turma que está selecionada
// naquela barra — a MESMA que as outras abas usam, vinda de
// instrutor-permissoes.js, pelo mesmo motivo de lá: configurar uma turma e
// analisar outra sem perceber seria fácil demais com dois seletores.
//
// O que cada modo faz no aparelho do aluno está em fonte-posicao.js e
// gps.js. Aqui só se escolhe.
//
// POR QUE O 'externa' APARECE DESABILITADO
// ----------------------------------------
// O banco já aceita o modo 'externa' (é a porta para Steel Beasts e SABRA), mas
// ainda não existe serviço nenhum que grave posição nessa origem. Oferecê-lo
// agora deixaria o instrutor tirar o GPS de uma turma inteira para esperar uma
// posição que nunca chega. Aparece na lista, desabilitado e dizendo por quê —
// lacuna declarada em vez de opção que some —, e passa a ser selecionável no
// dia em que a integração existir (basta tirar a flag `indisponivel`).
//
// Se o banco ainda não tem a coluna (migration 0016 não aplicada), o seletor
// aparece desabilitado e diz isso, em vez de fingir que funciona.
//
// Quem pode trocar: a policy `turmas_editar` (só o instrutor da turma). Para
// qualquer outro ela FILTRA em silêncio, e `definirModoDaTurma()` confere se
// alguma linha mudou — ver o comentário lá.

import { observarTurma } from './instrutor-permissoes.js';
import { buscarModoDaTurma, definirModoDaTurma } from './modo-posicao.js';
import { MODO_PADRAO, ehSimulacao } from './fonte-posicao.js';

const OPCOES = [
  { valor: 'gps', rotulo: 'GPS do aparelho' },
  { valor: 'manual', rotulo: 'Simulação — o aluno posiciona o posto no mapa' },
  { valor: 'externa', rotulo: 'Simulador externo (ainda não disponível)', indisponivel: true },
];

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const rotuloDe = (valor) => (OPCOES.find((o) => o.valor === valor) || {}).rotulo || valor;

let turmaMostrada = null;   // id da turma cujo modo está na tela
let modoMostrado = null;    // o que o banco disse por último

export function iniciarModoPosicaoInstrutor() {
  const raiz = document.getElementById('modo-posicao-instrutor');
  if (!raiz) return;
  observarTurma((turma) => mostrar(raiz, turma?.id || null));
}

async function mostrar(raiz, turmaId) {
  turmaMostrada = turmaId;
  if (!turmaId) { raiz.innerHTML = ''; return; }

  const modo = await buscarModoDaTurma(turmaId);
  // A turma pode ter sido trocada enquanto a resposta vinha.
  if (turmaMostrada !== turmaId) return;

  if (modo === null) {
    raiz.innerHTML = `<span style="color:#9aa7b4" title="A coluna turmas.modo_posicao não foi lida. Aplique a migration 0016 no Supabase.">
      Posição dos alunos: indisponível (migration 0016 pendente?)</span>`;
    return;
  }
  modoMostrado = modo;
  desenhar(raiz, turmaId, modo);
}

function desenhar(raiz, turmaId, modo, mensagem = '') {
  const simulando = ehSimulacao(modo);
  raiz.innerHTML = `
    <label class="turma-label">Posição dos alunos
      <select id="modo-posicao-select"
              style="${simulando ? 'border-color:#c08a2a;color:#ffe2a0' : ''}">
        ${OPCOES.map((o) => `<option value="${esc(o.valor)}"${o.valor === modo ? ' selected' : ''}${o.indisponivel ? ' disabled' : ''}>${esc(o.rotulo)}</option>`).join('')}
      </select>
    </label>
    <span id="modo-posicao-msg" style="margin-left:8px;color:#9fc0e0">${esc(mensagem)}</span>`;
  document.getElementById('modo-posicao-select').addEventListener('change', (ev) => {
    aoEscolher(raiz, turmaId, ev.target.value);
  });
}

async function aoEscolher(raiz, turmaId, novo) {
  if (novo === modoMostrado) return;
  // Afeta TODOS os alunos da turma, ao vivo — pede confirmação. Em simulação os
  // celulares deixam de usar o GPS; ao voltar para GPS, voltam a usá-lo.
  const frase = novo === MODO_PADRAO
    ? 'Voltar a turma para o GPS do aparelho? Os alunos deixam de poder posicionar o próprio posto e a posição simulada some do mapa deles.'
    : `Mudar a turma para "${rotuloDe(novo)}"? Os celulares dos alunos deixam de usar o GPS e a posição que estiver no mapa de cada um some até que ela seja informada.`;
  if (!window.confirm(frase)) {
    desenhar(raiz, turmaId, modoMostrado);   // devolve o seletor ao valor real
    return;
  }

  desenhar(raiz, turmaId, modoMostrado, 'salvando…');
  const r = await definirModoDaTurma(turmaId, novo);
  if (turmaMostrada !== turmaId) return;
  if (r.ok) {
    modoMostrado = r.modo;
    desenhar(raiz, turmaId, r.modo, 'salvo — chega ao app do aluno na hora');
  } else {
    // O valor mostrado volta ao que o banco tem: um seletor que continuasse
    // dizendo "Simulação" depois de uma gravação recusada seria mentira.
    desenhar(raiz, turmaId, modoMostrado, `não foi possível trocar: ${r.motivo}`);
  }
}
