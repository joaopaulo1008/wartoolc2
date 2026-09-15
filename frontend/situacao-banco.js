// situacao-banco.js — Supabase e Realtime para `situacoes` e `pedidos_apoio`
// (2026-09-15).
//
// Sem DOM, sem Leaflet. As regras puras estão em situacao-usuario.js; as telas
// em situacao-tela.js (aluno) e no painel do instrutor.
//
// As duas tabelas vêm de backend/supabase/0014_situacao_e_apoio.sql. Ler o
// cabeçalho de lá antes de mexer aqui — em especial por que são DUAS tabelas e
// por que o pedido de apoio não tem chave de permissão.
//
// UM CANAL SÓ PARA AS DUAS TABELAS
// ---------------------------------
// As duas mudam junto com a mesma turma e são consumidas pelas mesmas telas;
// dois canais seriam duas conexões para o mesmo escopo. O Realtime aplica a
// policy de SELECT antes de entregar cada evento, então `situacoes_ler` e
// `pedidos_apoio_ler` continuam valendo — o aluno do Vermelho não recebe o
// evento do Azul mesmo com o filtro sendo só de turma.

import { supabase } from './auth.js';

const COLUNAS_SITUACAO = 'usuario_id, turma_id, estado, texto, atualizada_em';
const COLUNAS_PEDIDO = 'id, usuario_id, turma_id, latitude, longitude, posicao_em, '
  + 'motivo, acionado_em, reconhecido_em, reconhecido_por, encerrado_em, encerrado_por';

// ── Situação ─────────────────────────────────────────────────────────────
export async function buscarSituacoesDaTurma(turmaId) {
  if (!turmaId) return [];
  const { data, error } = await supabase
    .from('situacoes').select(COLUNAS_SITUACAO).eq('turma_id', turmaId);
  if (error) { console.error('buscarSituacoesDaTurma falhou:', error); return []; }
  return data || [];
}

// Upsert: uma linha por usuário, sobrescrita. `atualizada_em` vai do cliente
// porque esta tabela não tem trigger de carimbo — ver a seção 1 da 0014 para
// o porquê (a função de 0001 escreve noutro nome de coluna, e generalizá-la
// mexeria em seis tabelas testadas por causa desta).
export async function gravarMinhaSituacao({ usuarioId, turmaId, estado, texto }) {
  const { error } = await supabase.from('situacoes').upsert({
    usuario_id: usuarioId,
    turma_id: turmaId,
    estado,
    texto,
    atualizada_em: new Date().toISOString(),
  });
  return { error };
}

// ── Pedido de apoio ──────────────────────────────────────────────────────
// Os VIGENTES da turma (não encerrados). O filtro é do cliente, como em
// calcos e anotacoes — a linha encerrada continua legível, para o debriefing.
export async function buscarPedidosVigentes(turmaId) {
  if (!turmaId) return [];
  const { data, error } = await supabase
    .from('pedidos_apoio').select(COLUNAS_PEDIDO)
    .eq('turma_id', turmaId)
    .is('encerrado_em', null)
    .order('acionado_em', { ascending: false });
  if (error) { console.error('buscarPedidosVigentes falhou:', error); return []; }
  return data || [];
}

// ACIONAR. `latitude`/`longitude`/`posicaoEm` são OPCIONAIS de propósito: sem
// GPS o pedido sai mesmo assim (ver o comentário da coluna na 0014). Quem
// chama passa a melhor posição que tiver e o carimbo dela; quem recebe vê a
// idade e decide.
export async function acionarPedidoApoio({ usuarioId, turmaId, latitude, longitude, posicaoEm, motivo }) {
  const { data, error } = await supabase
    .from('pedidos_apoio')
    .insert({
      usuario_id: usuarioId,
      turma_id: turmaId,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      posicao_em: posicaoEm || null,
      motivo: motivo || null,
    })
    .select(COLUNAS_PEDIDO)
    .single();
  return { data, error };
}

// RECONHECER ≠ ENCERRAR, e são duas funções para não virarem uma por
// descuido: "estou vendo" não é "está resolvido", e um pedido que sumisse ao
// ser reconhecido deixaria de ser acompanhado por quem o acionou.
export async function reconhecerPedido(id, porQuem) {
  const { error } = await supabase.from('pedidos_apoio')
    .update({ reconhecido_em: new Date().toISOString(), reconhecido_por: porQuem })
    .eq('id', id);
  return { error };
}

export async function encerrarPedido(id, porQuem) {
  const { error } = await supabase.from('pedidos_apoio')
    .update({ encerrado_em: new Date().toISOString(), encerrado_por: porQuem })
    .eq('id', id);
  return { error };
}

// O motivo pode ser escrito DEPOIS do acionamento — acionar tem que ser
// rápido, e obrigar a digitar antes atrasaria justamente o que importa.
export async function descreverPedido(id, motivo) {
  const { error } = await supabase.from('pedidos_apoio').update({ motivo }).eq('id', id);
  return { error };
}

// ── Tempo real ───────────────────────────────────────────────────────────
let canal = null;

export function assinarSituacaoEApoio(turmaId, { aoMudarSituacao, aoMudarPedido }) {
  desassinarSituacaoEApoio();
  if (!turmaId) return;
  const chamar = (fn, payload) => {
    try { if (fn) fn(payload); } catch (e) { console.error('Observador falhou:', e); }
  };
  canal = supabase
    .channel(`situacao-apoio-turma-${turmaId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'situacoes', filter: `turma_id=eq.${turmaId}` },
      (p) => chamar(aoMudarSituacao, p))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'pedidos_apoio', filter: `turma_id=eq.${turmaId}` },
      (p) => chamar(aoMudarPedido, p))
    .subscribe();
}

export function desassinarSituacaoEApoio() {
  if (canal) { supabase.removeChannel(canal); canal = null; }
}
