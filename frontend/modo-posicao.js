// modo-posicao.js — o modo de posição da turma, lido do banco e mantido ao vivo.
//
// O QUE É
// -------
// `turmas.modo_posicao` (migration 0016) diz de onde vem a posição própria dos
// alunos: 'gps', 'manual' (simulação) ou 'externa' (simulador). O que cada
// valor SIGNIFICA para o cliente mora em fonte-posicao.js (puro, testado);
// este módulo só responde "qual é o modo agora?" e avisa quando ele muda.
//
// É a FONTE ÚNICA do modo no cliente, no mesmo molde de permissoes.js e
// preferencias.js: quem precisa saber chama `modoPosicaoAtual()` na hora, ou
// `observarModoPosicao()` para REAGIR à mudança. Guardar uma cópia local é
// criar uma segunda fonte de verdade esperando para ficar velha.
//
// Interface, não segurança
// ------------------------
// Aqui o modo só faz a TELA obedecer (esconder um botão, não ligar o
// `watchPosition`). Quem impede de verdade um aluno de gravar uma origem que a
// turma não pratica é a policy do banco (0016). Um aluno com o console aberto
// contorna este módulo, não contorna a RLS — regra dura 3 do CLAUDE.md.
//
// DUAS COISAS QUE ESTE MÓDULO SABE E QUE NÃO SÃO ÓBVIAS
// -----------------------------------------------------
// 1. `origemSuportada()` — se a coluna `origem` existe no banco. O front sai
//    por push no GitHub Pages e a migration 0016 é aplicada à mão no Supabase:
//    qualquer uma das duas pode chegar primeiro. Se a leitura de
//    `modo_posicao` falha porque a coluna não existe, o app se comporta como
//    antes da 0016 (modo 'gps', sem mandar `origem`) em vez de parar de gravar
//    posição. Só um erro DESSE tipo (42703, coluna inexistente) rebaixa o
//    estado; uma falha de rede no meio do exercício mantém o que já se sabia.
// 2. O modo pode mudar por baixo de um celular que não ficou sabendo (página
//    congelada, sem rede). `reler()` existe para isso: o gps.js a chama quando
//    a policy recusa uma gravação, e este módulo a chama sozinho quando a
//    página volta a ficar visível ou a rede volta.
//
// PRÉ-REQUISITO: `turmas` publicada no Realtime — a 0016 faz isso. Sem ela,
// o módulo funciona do mesmo jeito, só que a troca de modo chega pela releitura
// (volta da página, volta da rede, ou a primeira gravação recusada) e não na
// hora.

import { supabase } from './auth.js';
import { MODO_PADRAO, MODOS, normalizarModo } from './fonte-posicao.js';

// A leitura inicial não pode segurar o rastreamento para sempre: se o Supabase
// estiver lento, o app segue com o padrão e se corrige quando a resposta vier.
const ESPERA_MAXIMA_INICIAL_MS = 4_000;

let modo = MODO_PADRAO;
let suportado = false;      // a coluna existe no banco (a 0016 foi aplicada)
let turmaIdAtual = null;
let canal = null;
let ouvindoRetomada = false;
const observadores = new Set();

function notificar() {
  const estado = { modo, origemSuportada: suportado };
  for (const cb of observadores) {
    try { cb(estado); } catch (e) { console.error('Observador de modo de posição falhou:', e); }
  }
}

function aplicar(novoModo, novoSuportado) {
  const m = normalizarModo(novoModo);
  if (m === modo && novoSuportado === suportado) return;
  modo = m;
  suportado = novoSuportado;
  notificar();
}

export const modoPosicaoAtual = () => modo;
export const origemSuportada = () => suportado;

// Registra um observador. Chamado NA HORA com o estado atual — mesmo contrato
// de observarPermissao() — e de novo a cada mudança. Devolve o cancelamento.
export function observarModoPosicao(callback) {
  observadores.add(callback);
  try {
    callback({ modo, origemSuportada: suportado });
  } catch (e) {
    console.error('Observador de modo de posição falhou na chamada inicial:', e);
  }
  return () => observadores.delete(callback);
}

// Lê o modo da turma no banco. Nunca lança: o pior resultado é continuar com o
// que já se sabia.
export async function reler() {
  if (!turmaIdAtual) return;
  try {
    const { data, error } = await supabase
      .from('turmas')
      .select('modo_posicao')
      .eq('id', turmaIdAtual)
      .maybeSingle();
    if (error) {
      // 42703 = coluna inexistente: a migration 0016 ainda não foi aplicada.
      // Qualquer outro erro é transitório e não derruba o que já se sabia.
      if (error.code === '42703' || /modo_posicao/.test(error.message || '')) {
        aplicar(MODO_PADRAO, false);
      } else {
        console.warn('Falha ao ler o modo de posição da turma:', error);
      }
      return;
    }
    // Sem linha = a RLS não deixa este usuário ver a turma. Nada a concluir.
    if (!data) return;
    aplicar(data.modo_posicao, true);
  } catch (e) {
    console.warn('Falha ao ler o modo de posição da turma:', e);
  }
}

function ouvirRetomada() {
  if (ouvindoRetomada || typeof document === 'undefined') return;
  ouvindoRetomada = true;
  // Página congelada e voltando, ou rede voltando: o evento de Realtime pode ter
  // se perdido no intervalo, então se confere no banco.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reler();
  });
  window.addEventListener('online', () => reler());
}

// Liga o módulo para uma turma. Devolve uma promessa que se resolve quando o
// modo foi lido (ou depois de `ESPERA_MAXIMA_INICIAL_MS`, o que vier primeiro)
// — o gps.js espera por ela antes de decidir se liga o `watchPosition`, para
// um aluno de turma 'manual' não pedir permissão de localização à toa nem
// tentar gravar uma posição que a policy ia recusar.
export function iniciarModoPosicao({ turmaId }) {
  turmaIdAtual = turmaId || null;
  if (!turmaIdAtual) return Promise.resolve();

  pararCanal();
  canal = supabase
    .channel(`modo-posicao-${turmaIdAtual}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'turmas', filter: `id=eq.${turmaIdAtual}` },
      (payload) => {
        // O evento traz a linha nova. Se por algum motivo não trouxer o campo
        // (publicação sem a coluna), confere no banco em vez de assumir.
        if (payload?.new && 'modo_posicao' in payload.new) aplicar(payload.new.modo_posicao, true);
        else reler();
      }
    )
    .subscribe();
  ouvirRetomada();
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', pararModoPosicao);

  const espera = new Promise((resolver) => setTimeout(resolver, ESPERA_MAXIMA_INICIAL_MS));
  return Promise.race([reler(), espera]);
}

function pararCanal() {
  if (canal) {
    supabase.removeChannel(canal);
    canal = null;
  }
}

export function pararModoPosicao() {
  pararCanal();
}

// ── Leitura de posições com `origem` ────────────────────────────────────────
// colegas.js e situacao.js leem `posicoes_atuais` e agora precisam da coluna
// `origem` para não etiquetar posição manual como "sem sinal". Mas um `select`
// com coluna que não existe FALHA INTEIRO — e aí o aluno não veria colega
// nenhum até a migration 0016 ser aplicada. Por isso a consulta tenta com
// `origem` e, se o erro for de coluna inexistente (42703), refaz sem ela. Num
// banco já migrado custa uma ida só; num ainda não migrado, duas — e o app
// continua inteiro nos dois casos, qualquer que seja a ordem de implantação.
const COLUNAS_POSICAO = 'usuario_id, latitude, longitude, precisao_m, atualizado_em';

// `montar(colunas)` devolve a promessa da consulta já com os filtros, p. ex.
//   (cols) => supabase.from('posicoes_atuais').select(cols).eq('turma_id', id)
export async function consultarPosicoesAtuais(montar) {
  let r = await montar(`${COLUNAS_POSICAO}, origem`);
  if (r.error && (r.error.code === '42703' || /origem/.test(r.error.message || ''))) {
    r = await montar(COLUNAS_POSICAO);
  }
  return r;
}

// ── Lado do instrutor ───────────────────────────────────────────────────────
// Troca o modo de uma turma. Quem pode é decidido por `turmas_editar` (só o
// instrutor da turma); para qualquer outro a policy FILTRA em silêncio — por
// isso a checagem de "alguma linha mudou" abaixo, e não só do `error`: sem ela,
// um aluno que chamasse isto leria "deu certo" e nada teria acontecido.
export async function definirModoDaTurma(turmaId, novoModo) {
  if (!turmaId) return { ok: false, motivo: 'turma não informada' };
  if (!MODOS.includes(novoModo)) return { ok: false, motivo: `modo desconhecido: ${novoModo}` };
  const { data, error } = await supabase
    .from('turmas')
    .update({ modo_posicao: novoModo })
    .eq('id', turmaId)
    .select('id, modo_posicao');
  if (error) return { ok: false, motivo: error.message || String(error), erro: error };
  if (!data || data.length === 0) {
    return { ok: false, motivo: 'nenhuma turma foi alterada (só o instrutor da turma pode trocar o modo)' };
  }
  return { ok: true, modo: data[0].modo_posicao };
}

// Lê o modo de uma turma qualquer (o painel do instrutor, que não passa por
// iniciarModoPosicao). `null` quando a leitura falha ou a migration 0016 ainda
// não foi aplicada — quem chama decide o que mostrar.
export async function buscarModoDaTurma(turmaId) {
  const { data, error } = await supabase
    .from('turmas')
    .select('modo_posicao')
    .eq('id', turmaId)
    .maybeSingle();
  if (error || !data) return null;
  return normalizarModo(data.modo_posicao);
}
