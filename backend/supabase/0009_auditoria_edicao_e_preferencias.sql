-- =============================================================================
-- WartoolC2 — Migration 0009 (Etapa 9b): auditoria da EDIÇÃO de marcação e a
-- primeira chave de verdade em `perfis.preferencias_visualizacao`
--
-- Incremental sobre 0001..0008, que NÃO são reescritas. Idempotente: rodar
-- duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0008_imagem_geo.sql.
--
-- O QUE ESTA MIGRATION FAZ, EM UMA LINHA CADA
-- --------------------------------------------
--   1. `elementos_marcados.editada_em` / `editada_por` — quem foi o último a
--      MUDAR uma marcação (a exclusão já tinha `removida_em`/`removida_por`
--      desde a 0001; a edição não tinha equivalente nenhum).
--   2. Um trigger que carimba essas duas colunas sozinho, para nenhum cliente
--      futuro poder "esquecer" de auditar.
--   3. Um `check` em `perfis.preferencias_visualizacao` para a chave
--      `formato_coordenada`, criada nesta etapa.
--
-- NADA AQUI MEXE EM RLS. As policies de `elementos_marcados`
-- (`elementos_editar_proprio` / `elementos_editar_instrutor`, 0003) e as de
-- `perfis` (`perfis_editar_proprio`, 0002) continuam exatamente como estão —
-- é justamente porque elas já dizem QUEM pode editar o quê que a auditoria
-- abaixo pode ser só um carimbo, e não uma segunda barreira.

-- =============================================================================
-- 1. AUDITORIA DA EDIÇÃO DE MARCAÇÃO
-- =============================================================================
-- POR QUE ISTO EXISTE (decisão do item 4 da Etapa 9b)
-- ----------------------------------------------------
-- Desde a 0003 (Etapa 4.5), o instrutor da turma pode editar QUALQUER
-- marcação de QUALQUER aluno — `elementos_editar_instrutor`. A Etapa 9b não
-- criou essa autoridade; ela já existia, e o único ponto onde o cliente a
-- reconhece é `podeMexer` em `frontend/marcacoes.js`. Ela é o que permite
-- corrigir simbologia errada lançada por aluno, que é o motivo pedagógico de
-- o instrutor estar ali.
--
-- O problema que esta migration resolve não é de permissão, é de CONFUSÃO. A
-- marcação é publicada por Realtime: quando o instrutor troca a natureza de
-- um elemento, o símbolo MUDA SOZINHO no aparelho do aluno, sem que nada na
-- tela diga que foi o instrutor. Sem isto, o aluno vê o próprio trabalho se
-- alterar e não tem como saber se foi correção, bug ou outro aluno. Com
-- `editada_por`, o popup passa a poder dizer "corrigido por Cap Paulo às
-- 14:32" — que é a diferença entre uma ferramenta de instrução e um
-- fantasma.
--
-- É também a simetria que faltava: apagar já era auditável
-- (`removida_em`/`removida_por`, decisão da Etapa 1 — "exclusão de marcação é
-- lógica, para o instrutor auditar o que foi apagado"); mudar não era.

alter table public.elementos_marcados
  add column if not exists editada_em  timestamptz,
  add column if not exists editada_por uuid references public.perfis (id) on delete set null;

comment on column public.elementos_marcados.editada_em is
  'Quando a marcação foi alterada pela última vez (natureza/símbolo/partido/título/posição). Nulo enquanto ninguém a editou. Carimbado por trigger, não pelo cliente.';
comment on column public.elementos_marcados.editada_por is
  'Quem fez a última alteração. Diferente de autor_id quando o instrutor corrigiu a marcação de um aluno — é o que permite o app dizer ao aluno que a mudança foi correção do instrutor, e não um símbolo mudando sozinho.';

-- Índice parcial: a consulta que isto serve é "o que o instrutor corrigiu
-- neste exercício", que é sempre sobre as marcações QUE FORAM editadas — uma
-- fração pequena do total. Índice parcial em vez de completo pelo mesmo
-- motivo dos demais índices `where removida_em is null` da 0001.
create index if not exists idx_elementos_editada_por
  on public.elementos_marcados (editada_por, editada_em desc)
  where editada_por is not null;

-- -----------------------------------------------------------------------------
-- O carimbo, por trigger e não pelo cliente
-- -----------------------------------------------------------------------------
-- `removida_por` é preenchido pelo CLIENTE (marcacoes.js manda no update).
-- Aqui foi escolhido o caminho oposto, de propósito: quem edita é
-- eventualmente o instrutor, corrigindo o trabalho de outra pessoa, e um
-- campo de auditoria que depende de o cliente lembrar de preencher é um campo
-- de auditoria que uma tela futura vai esquecer — bastaria alguém escrever um
-- `update` novo em outro módulo. O trigger não esquece.
--
-- Três cuidados no corpo:
--   a) só carimba quando muda CONTEÚDO. Um update que só toca
--      `removida_em`/`removida_por` é uma exclusão, e já tem a própria
--      auditoria — carimbar as duas coisas faria toda exclusão parecer também
--      uma edição.
--   b) `auth.uid()` pode ser nulo (service_role, SQL Editor, seed). Nesse
--      caso `editada_em` é carimbado do mesmo jeito e `editada_por` fica
--      nulo, que se lê como "alterado fora de uma sessão de usuário" — é
--      informação, não falha.
--   c) `security definer` + `search_path` fixo, no mesmo padrão das demais
--      funções do projeto.
create or replace function public.fn_carimbar_edicao_do_elemento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Exclusão lógica (ou restauração) não é edição: sai sem carimbar.
  if new.removida_em is distinct from old.removida_em then
    return new;
  end if;

  if new.sidc       is distinct from old.sidc
     or new.partido_id is distinct from old.partido_id
     or new.titulo     is distinct from old.titulo
     or new.descricao  is distinct from old.descricao
     or new.latitude   is distinct from old.latitude
     or new.longitude  is distinct from old.longitude
     or new.efetivo_estimado is distinct from old.efetivo_estimado
     or new.confianca        is distinct from old.confianca
  then
    new.editada_em  := now();
    new.editada_por := auth.uid();
  end if;

  return new;
end;
$$;

comment on function public.fn_carimbar_edicao_do_elemento() is
  'Carimba editada_em/editada_por em elementos_marcados quando o CONTEÚDO muda. Não carimba em exclusão lógica (que tem removida_em/removida_por).';

-- Ordem dos triggers importa pouco aqui (este e `trg_marcacoes_atualizado_em`
-- da 0001 escrevem colunas diferentes), mas o nome com prefixo `trg_` segue o
-- padrão do projeto e o `drop if exists` mantém a migration idempotente.
drop trigger if exists trg_elementos_carimbar_edicao on public.elementos_marcados;
create trigger trg_elementos_carimbar_edicao
  before update on public.elementos_marcados
  for each row execute function public.fn_carimbar_edicao_do_elemento();

-- =============================================================================
-- 2. `preferencias_visualizacao.formato_coordenada`
-- =============================================================================
-- POR QUE A PREFERÊNCIA É POR USUÁRIO, E NÃO POR TURMA (decisão do item 5)
-- -------------------------------------------------------------------------
-- A coluna `perfis.preferencias_visualizacao` existe desde a 0003 (Etapa 4.5)
-- e o comentário dela já dizia exatamente o que ela é: "FILTRO, não
-- PERMISSÃO: não é barreira de segurança". Em que formato eu leio a MINHA
-- tela é o exemplo mais puro possível disso — não muda o que ninguém enxerga,
-- não muda o que é gravado (o banco continua guardando `latitude`/`longitude`
-- em grau decimal, sempre), e não afeta outra pessoa.
--
-- A alternativa considerada era uma chave em `catalogo_permissoes`, com o
-- instrutor fixando o formato para a turma inteira. Foi descartada por dois
-- motivos:
--   * o catálogo de permissões é sobre o que o instrutor LIBERA ou BLOQUEIA;
--     "todo mundo lê em UTM" não é liberar nem bloquear nada, e enfiar isso
--     lá misturaria dois conceitos que o projeto vem separando desde a 4.5;
--   * na prática o padrão já resolve. `FORMATO_PADRAO` em
--     `frontend/coordenadas.js` é 'utm' — que é o que está impresso na carta
--     do BDGEx que o app serve — então a turma inteira já começa alinhada sem
--     ninguém decidir nada. Quem precisar conferir contra outro aparelho
--     troca para grau decimal na própria tela e volta.
--
-- Ficar no BANCO (e não no localStorage) é o que a 0003 já tinha decidido: a
-- escolha sobrevive a troca de aparelho no meio do exercício, que acontece.
--
-- Este `check` é deliberadamente FROUXO com o resto do objeto: valida apenas
-- a chave que esta etapa criou, e ignora qualquer outra. `preferencias_
-- visualizacao` é um saco de preferências que vai crescer (a interface de
-- filtros de camadas continua pendente desde a 4.5) — um check que exigisse
-- um formato fechado transformaria cada preferência nova numa migration.
do $$ begin
  alter table public.perfis
    add constraint perfis_formato_coordenada_valido
    check (
      not (preferencias_visualizacao ? 'formato_coordenada')
      or preferencias_visualizacao ->> 'formato_coordenada' in ('utm', 'decimal', 'dms')
    );
exception when duplicate_object then null;
end $$;

comment on column public.perfis.preferencias_visualizacao is
  'Filtros e preferências de visualização escolhidos pelo próprio usuário. FILTRO, não PERMISSÃO: não é barreira de segurança. Chaves em uso: formato_coordenada (utm|decimal|dms, Etapa 9b). Ausente = o padrão do cliente (utm).';

-- =============================================================================
-- 3. VERIFICAÇÃO (rode depois de aplicar)
-- =============================================================================
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'elementos_marcados'
--    and column_name in ('editada_em', 'editada_por');
--   -- esperado: 2 linhas, ambas YES em is_nullable
--
-- select tgname from pg_trigger
--  where tgrelid = 'public.elementos_marcados'::regclass and not tgisinternal;
--   -- esperado: inclui trg_elementos_carimbar_edicao
--
-- select conname from pg_constraint
--  where conrelid = 'public.perfis'::regclass
--    and conname = 'perfis_formato_coordenada_valido';
--   -- esperado: 1 linha
--
-- -- e o check deve recusar lixo:
-- update public.perfis set preferencias_visualizacao = '{"formato_coordenada":"mgrs"}'::jsonb
--  where id = auth.uid();
--   -- esperado: ERRO 23514 (violates check constraint)
