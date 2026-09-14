// icones-rapidos.js — acesso ao banco da paleta de ícones rápidos.
//
// Mesmo papel (e mesmo formato) de calcos.js na Etapa 7: é o ÚNICO arquivo que
// fala com a tabela `icones_rapidos`, compartilhado pelas duas telas —
// paleta-tela.js (app do aluno) e instrutor-paleta.js (painel do instrutor).
// Nenhum outro módulo faz select/insert/update aqui, pelo mesmo motivo que
// nenhum outro fala com permissoes_turma direto desde a Etapa 6a: a segunda
// cópia de uma consulta é a que diverge em silêncio quando alguém acrescenta
// uma coluna só de um lado.
//
// A tabela, a RLS e o trigger de paleta padrão estão em
// backend/supabase/0010_icones_rapidos.sql, e o comportamento delas tem teste
// contra um Postgres de verdade em backend/testes/02_teste_icones_rapidos.sql.
import { supabase, traduzirErro } from './auth.js';
import { ordenarPaleta, vigentes } from './paleta.js';

// Colunas pedidas por nome, nunca `select('*')` — o mesmo critério do resto do
// projeto: uma coluna nova no banco não deve começar a trafegar para 60
// celulares sozinha.
const COLUNAS = 'id, turma_id, rotulo, sidc, partido_padrao_id, ordem, criado_por, criado_em, removido_em';

// A paleta vigente da turma, já ordenada. A RLS (`icones_rapidos_ler`) garante
// que só vem a turma de quem pergunta; o filtro de `removido_em` é do cliente,
// pelo mesmo motivo de `calcos_ler` não filtrar exclusão lógica: a linha
// removida existe para auditar, e quem decide o que está vigente é a consulta.
export async function buscarPaletaDaTurma(turmaId) {
  if (!turmaId) return { ok: true, presets: [] };
  const { data, error } = await supabase
    .from('icones_rapidos')
    .select(COLUNAS)
    .eq('turma_id', turmaId);
  if (error) {
    console.error('Falha ao carregar a paleta de ícones rápidos:', error);
    return { ok: false, presets: [], erro: traduzirErro(error) };
  }
  return { ok: true, presets: ordenarPaleta(vigentes(data || [])) };
}

// Para o painel do instrutor, que precisa ver TAMBÉM o que foi removido? Não:
// ele edita a paleta vigente. A linha removida fica no banco para auditoria
// (quem tirou e quando), consultável por SQL — mostrar o histórico na tela
// seria funcionalidade própria, não um acréscimo de graça, e a Etapa 15 (log
// do exercício) é o lugar certo para isso.

export async function criarPreset({ turmaId, rotulo, sidc, partidoId, ordem, usuarioId }) {
  const { data, error } = await supabase
    .from('icones_rapidos')
    .insert({
      turma_id: turmaId,
      rotulo,
      sidc,
      partido_padrao_id: partidoId || null,
      ordem,
      // Obrigatório bater com auth.uid() pela policy `icones_rapidos_criar` —
      // sem isso um instrutor cadastraria preset em nome de outro e o painel
      // mentiria sobre quem montou a paleta.
      criado_por: usuarioId,
    })
    .select(COLUNAS)
    .single();
  if (error) return { ok: false, erro: traduzirErro(error) };
  return { ok: true, preset: data };
}

// `criado_por`/`criado_em` não entram aqui nem por engano: são imutáveis, e
// quem garante isso é o trigger `trg_preservar_autor_do_icone` (0010) — mandar
// os campos só faria o banco descartá-los em silêncio.
export async function atualizarPreset(id, { rotulo, sidc, partidoId, ordem }) {
  const campos = {};
  if (rotulo !== undefined) campos.rotulo = rotulo;
  if (sidc !== undefined) campos.sidc = sidc;
  if (partidoId !== undefined) campos.partido_padrao_id = partidoId || null;
  if (ordem !== undefined) campos.ordem = ordem;

  const { data, error } = await supabase
    .from('icones_rapidos')
    .update(campos)
    .eq('id', id)
    .select(COLUNAS)
    .single();
  if (error) return { ok: false, erro: traduzirErro(error) };
  return { ok: true, preset: data };
}

// Exclusão LÓGICA, nunca DELETE — decisão da Etapa 1, reafirmada em
// elementos_marcados (0003) e em calcos (0006). Aqui ela é ainda mais barata
// que nos calcos: não há objeto no Storage para apagar junto, a linha custa
// bytes desprezíveis, e ela responde "por que o botão que estava aqui sumiu no
// meio do exercício?" — pergunta que um aluno faz e que só o registro
// responde.
export async function removerPreset({ id, usuarioId }) {
  const { error } = await supabase
    .from('icones_rapidos')
    .update({ removido_em: new Date().toISOString(), removido_por: usuarioId })
    .eq('id', id);
  if (error) return { ok: false, erro: traduzirErro(error) };
  return { ok: true };
}

// ── Realtime ─────────────────────────────────────────────────────────────
// Mesmo formato de assinarCalcos() (Etapa 7): o instrutor acrescenta um botão
// no meio do exercício e ele aparece nos 60 aparelhos sem ninguém recarregar.
//
// Como em todo canal deste projeto, quem chama faz SELECT INICIAL PRIMEIRO e
// assina DEPOIS — o Realtime não faz backfill, então a ordem invertida traria
// só o que mudou depois da assinatura e a paleta apareceria vazia para quem
// acabou de abrir o app (a armadilha registrada desde a Etapa 4).
export function assinarPaleta(turmaId, { aoMudar, aoSair }) {
  return supabase
    .channel(`icones-rapidos-turma-${turmaId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'icones_rapidos', filter: `turma_id=eq.${turmaId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          if (payload.old?.id) aoSair(payload.old.id);
          return;
        }
        const linha = payload.new;
        if (!linha) return;
        // Exclusão lógica chega como UPDATE, não como DELETE — para a tela é a
        // mesma coisa que sair da paleta.
        if (linha.removido_em) aoSair(linha.id);
        else aoMudar(linha);
      }
    )
    .subscribe();
}

export function desassinarPaleta(canal) {
  if (canal) supabase.removeChannel(canal);
}
