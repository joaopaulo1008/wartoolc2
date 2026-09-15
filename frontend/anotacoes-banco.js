// anotacoes-banco.js — a conversa com o Supabase sobre as caixas de texto
// do mapa (2026-09-14).
//
// Está para `anotacoes` como calcos.js está para `calcos`: a FONTE ÚNICA do
// que fala com o banco. Sem DOM, sem Leaflet — quem desenha é
// anotacoes-tela.js, e o que é uma anotação válida mora em anotacoes.js.
//
// Dois consumidores, os mesmos dois de sempre:
//   - app do ALUNO: lista as vigentes e assina o canal, para o recado escrito
//     no meio do exercício aparecer sem F5.
//   - painel do INSTRUTOR (mesma tela "Situação atual"): cria, edita, move e
//     remove.
//
// A tabela e a RLS vêm de backend/supabase/0013_anotacoes.sql. Ler o cabeçalho
// de lá antes de mexer aqui — em especial o motivo de a tabela existir em vez
// de isto ser uma coluna em `elementos_marcados`.

import { supabase } from './auth.js';

// Colunas lidas em todo lugar. Uma lista só, para as duas telas nunca
// divergirem no que trazem (foi assim que `partido:partidos(...)` ficou sem
// `ordem` em auth.js e gerou o bug de cor da Etapa 11).
const COLUNAS = 'id, turma_id, autor_id, texto, latitude, longitude, partido_id, cor, criada_em, atualizado_em';

// ── Leitura ──────────────────────────────────────────────────────────────
// O filtro de `removida_em` é do CLIENTE, não da policy — mesmo critério de
// `elementos_marcados` e de `calcos`: a exclusão é lógica para poder auditar
// depois, então a linha continua legível e é a consulta que decide o que está
// valendo.
//
// Quem enxerga o quê já está resolvido em `anotacoes_ler` (0013) e NÃO é
// repetido aqui: uma segunda cópia da regra de partido no cliente seria uma
// regra a mais para divergir, e a do banco é a que vale.
export async function buscarAnotacoesDaTurma(turmaId) {
  if (!turmaId) return [];
  const { data, error } = await supabase
    .from('anotacoes')
    .select(COLUNAS)
    .eq('turma_id', turmaId)
    .is('removida_em', null)
    .order('criada_em', { ascending: true });
  if (error) {
    console.error('buscarAnotacoesDaTurma falhou:', error);
    return [];
  }
  return data || [];
}

// ── Escrita (só o instrutor passa pela RLS) ──────────────────────────────
// `autor_id` vai explícito porque o `with check` de `anotacoes_escrever` exige
// `autor_id = auth.uid()`: mandar outro valor é rejeitado pelo banco, e mandar
// nenhum viola o `not null`. Não há default de servidor para isso de propósito
// — é o que impede um instrutor escrever em nome de outro.
export async function criarAnotacao({ turmaId, autorId, texto, latitude, longitude, partidoId, cor }) {
  const { data, error } = await supabase
    .from('anotacoes')
    .insert({
      turma_id: turmaId,
      autor_id: autorId,
      texto,
      latitude,
      longitude,
      partido_id: partidoId || null,
      cor,
    })
    .select(COLUNAS)
    .single();
  return { data, error };
}

// Edição parcial: só os campos passados vão no UPDATE. Serve tanto para
// "mudei o texto" quanto para "arrastei a caixa de lugar", que é uma
// atualização de duas colunas e não deve reescrever o resto.
export async function atualizarAnotacao(id, campos) {
  const patch = {};
  if (campos.texto !== undefined) patch.texto = campos.texto;
  if (campos.latitude !== undefined) patch.latitude = campos.latitude;
  if (campos.longitude !== undefined) patch.longitude = campos.longitude;
  if (campos.partidoId !== undefined) patch.partido_id = campos.partidoId || null;
  if (campos.cor !== undefined) patch.cor = campos.cor;
  const { error } = await supabase.from('anotacoes').update(patch).eq('id', id);
  return { error };
}

// Remoção LÓGICA. `removida_por` guarda quem apagou, como em
// `elementos_marcados` e `calcos` — em exercício, "quem tirou aquilo do mapa"
// é pergunta de debriefing.
export async function removerAnotacao(id, removidaPor) {
  const { error } = await supabase
    .from('anotacoes')
    .update({ removida_em: new Date().toISOString(), removida_por: removidaPor || null })
    .eq('id', id);
  return { error };
}

// ── Tempo real ───────────────────────────────────────────────────────────
// Um canal por turma, filtrado no SERVIDOR por `turma_id` — mesma forma de
// assinarCalcos() e do canal de posições.
//
// O Realtime aplica a policy de SELECT antes de entregar cada evento, então
// `anotacoes_ler` continua valendo aqui: o aluno do Vermelho não recebe o
// evento da anotação do Azul, mesmo com o filtro sendo só de turma.
//
// `aoMudar` recebe o payload cru. Quem decide o que fazer com INSERT/UPDATE/
// DELETE é a tela — este módulo não sabe o que está desenhado.
//
// ATENÇÃO À REMOÇÃO: ela é LÓGICA, então chega como UPDATE (com
// `removida_em` preenchido), não como DELETE. Uma tela que só tratasse DELETE
// deixaria a anotação removida na tela de todo mundo até o próximo F5 — é o
// tipo de engano que o `replica identity full` da 0013 existe para deixar
// detectável, porque o payload traz a linha inteira.
let canal = null;

export function assinarAnotacoes(turmaId, { aoMudar }) {
  desassinarAnotacoes();
  if (!turmaId) return;
  canal = supabase
    .channel(`anotacoes-turma-${turmaId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'anotacoes', filter: `turma_id=eq.${turmaId}` },
      (payload) => {
        try {
          aoMudar(payload);
        } catch (e) {
          console.error('Observador de anotações falhou:', e);
        }
      }
    )
    .subscribe();
}

export function desassinarAnotacoes() {
  if (canal) {
    supabase.removeChannel(canal);
    canal = null;
  }
}
