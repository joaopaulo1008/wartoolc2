-- =============================================================================
-- WartoolC2 — Migration 0004: publicar `perfis` no Realtime
--
-- Incremental sobre 0001/0002/0003, que NÃO são reescritas. Idempotente:
-- rodar duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0003_partidos.sql.
--
-- POR QUE ESTA MIGRATION EXISTE
-- -----------------------------
-- A Etapa 6a deu ao instrutor um painel para distribuir os alunos entre as
-- forças (perfis.partido_id) — operação que até então só existia como UPDATE
-- no SQL Editor. A RLS já permitia isso desde a 0003 (policy
-- `perfis_editar_instrutor` + a exceção de `fn_proteger_campos_do_perfil`, que
-- só barra quem NÃO é instrutor), então nenhuma regra de acesso muda aqui.
--
-- O que faltava era a VOLTA: `perfis` era a única tabela relevante ao mapa
-- fora da publicação `supabase_realtime`, então trocar o partido de alguém não
-- chegava ao navegador dele. E partido não é um detalhe cosmético — é o que
-- decide, ao mesmo tempo:
--
--   1. a HOSTILIDADE com que o aluno enxerga todo o resto da tela (a derivação
--      em frontend/simbolos.js compara o partido do observador com o do
--      elemento: o mesmo pelotão é amigo para um lado e hostil para o outro);
--   2. QUEM ele enxerga, via fn_usuarios_visiveis() — que é consultada pelas
--      policies de posicoes_atuais, posicoes_historico e elementos_marcados.
--
-- Sem esta publicação, um aluno movido de força continuaria vendo o mapa do
-- lado antigo até apertar F5 — e ninguém avisaria que era preciso apertar.
--
-- O QUE O CLIENTE FAZ COM ISSO
-- ----------------------------
-- `frontend/perfil-ao-vivo.js` assina APENAS a própria linha
-- (filter: id=eq.<meu id>) e, ao detectar que `partido_id` mudou, recarrega a
-- página depois de um aviso curto. Recarregar é deliberadamente grosseiro:
-- refazer a hostilidade de cada ícone já desenhado e refazer os selects
-- iniciais de colegas.js/marcacoes.js daria o mesmo resultado com muito mais
-- superfície para bug, numa operação que acontece uma ou duas vezes por
-- exercício. Ver o cabeçalho daquele arquivo.
--
-- SOBRE PRIVACIDADE: publicar a tabela NÃO alarga o que alguém enxerga. O
-- Realtime aplica a RLS de SELECT antes de entregar cada evento, e a policy
-- `perfis_ler` (0002) já deixava qualquer colega de turma ler estas mesmas
-- colunas por consulta comum. O que muda é só o CAMINHO (empurrado em vez de
-- perguntado), não o alcance.
-- =============================================================================

-- REPLICA IDENTITY FULL: sem isso o payload de UPDATE/DELETE viria só com a
-- chave primária, e o cliente não teria como comparar "o partido mudou?" nem
-- filtrar por turma. Mesmo motivo das outras tabelas publicadas (ver a seção
-- "Tempo real" em backend/README.md).
alter table public.perfis replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'perfis'
    ) then
      alter publication supabase_realtime add table public.perfis;
      raise notice 'perfis adicionada à publicação supabase_realtime.';
    else
      raise notice 'perfis já estava publicada — nada a fazer.';
    end if;
  else
    -- Postgres cru (backend/testes/), sem o stub da publicação do Supabase.
    raise notice 'Publicação supabase_realtime não existe neste banco; pulando.';
  end if;
end $$;

-- =============================================================================
-- Verificação rápida depois de aplicar
-- =============================================================================
-- Devem aparecer 6 tabelas: posicoes_atuais, elementos_marcados, partidos,
-- permissoes_turma, permissoes_usuario e perfis.
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
--
-- E `perfis` deve estar com replica identity 'f' (full):
--
--   select relname, relreplident from pg_class where relname = 'perfis';
