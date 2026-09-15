-- =============================================================================
-- Teste de 2026-09-14 — anotações de texto no mapa (migration 0013)
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001..0013 aplicados
-- nesta ordem. NÃO rodar no Supabase de produção. Espera um banco LIMPO —
-- rodar duas vezes no mesmo banco contamina a massa e produz falhas falsas.
--
-- O QUE ESTE ARQUIVO PROVA
-- ------------------------
-- O valor inteiro da 0013 está em duas frases, e as duas são de segurança:
--
--   1. **A anotação do Azul não aparece para o Vermelho.** É a razão de a
--      tabela ter `partido_id` e de a policy de leitura ser cópia de
--      `calcos_ler`. Se isso falhar, uma ordem parcial escrita para um lado
--      aparece no mapa do outro — o pior modo de falha possível num exercício.
--   2. **Só o instrutor escreve.** O aluno lê os recados e não cria, não edita
--      e não apaga nenhum. Sem isso, qualquer conta poderia escrever no mapa
--      de 60 pessoas.
--
-- E uma terceira, que é sobre não mentir: a remoção é LÓGICA, então a linha
-- continua no banco depois de sair do mapa.
--
-- Uso:
--   psql -f 00_stub_supabase.sql -f 0001 ... -f 0013 -f 05_teste_anotacoes.sql
-- =============================================================================

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

-- ── Infra ───────────────────────────────────────────────────────────────────
drop table if exists public.t5_resultados;
create table public.t5_resultados (
  n serial primary key, grupo text, descricao text, esperado text,
  obtido text, ok boolean
);

create or replace function public.t5_ok(p_grupo text, p_desc text, p_esperado text, p_obtido text)
returns void language plpgsql security definer as $$
begin
  insert into public.t5_resultados (grupo, descricao, esperado, obtido, ok)
  values (p_grupo, p_desc, p_esperado, p_obtido,
          p_esperado is not distinct from p_obtido);
end $$;
grant execute on function public.t5_ok(text,text,text,text) to authenticated;

-- Mesma distinção de três valores da suíte 04, e pelo mesmo motivo: a cláusula
-- USING de uma policy FILTRA a linha em vez de levantar exceção, então um
-- teste que só olhasse erro leria "não escreveu nada" como sucesso — que num
-- teste de segurança é aprovação falsa.
create or replace function public.t5_tentar(
  p_grupo text, p_desc text, p_esperado text, p_sql text)
returns void language plpgsql as $$
declare v text; n integer;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
    v := case when n > 0 then 'passou' else 'zero linhas' end;
  exception when others then v := 'erro';
  end;
  perform public.t5_ok(p_grupo, p_desc, p_esperado, v);
end $$;
grant execute on function public.t5_tentar(text,text,text,text) to authenticated;

-- ── MASSA ───────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f0a0', 'instanot@wartool.local'),
  ('00000000-0000-0000-0000-00000000f0a1', 'azulanot@wartool.local'),
  ('00000000-0000-0000-0000-00000000f0b1', 'vermanot@wartool.local'),
  ('00000000-0000-0000-0000-00000000f0c1', 'semforca@wartool.local');

insert into public.turmas (id, nome, codigo_acesso, instrutor_id) values
  ('00000000-0000-0000-0000-00000000ffa0', 'Turma Anot', 'ANOT-2026',
   '00000000-0000-0000-0000-00000000f0a0');

update public.perfis set papel = 'instrutor', turma_id = '00000000-0000-0000-0000-00000000ffa0'
  where id = '00000000-0000-0000-0000-00000000f0a0';

update public.perfis p set
  turma_id = '00000000-0000-0000-0000-00000000ffa0',
  partido_id = (select id from public.partidos
                where turma_id = '00000000-0000-0000-0000-00000000ffa0' and nome = 'Azul')
where p.id = '00000000-0000-0000-0000-00000000f0a1';

update public.perfis p set
  turma_id = '00000000-0000-0000-0000-00000000ffa0',
  partido_id = (select id from public.partidos
                where turma_id = '00000000-0000-0000-0000-00000000ffa0' and nome = 'Vermelho')
where p.id = '00000000-0000-0000-0000-00000000f0b1';

-- Aluno da turma sem força nenhuma. Ele é o caso de fronteira da policy:
-- `partido_id is null or partido_id = fn_meu_partido()` — o primeiro termo o
-- deixa ver as anotações gerais, o segundo não casa com nada.
update public.perfis set turma_id = '00000000-0000-0000-0000-00000000ffa0'
  where id = '00000000-0000-0000-0000-00000000f0c1';

select
  (select id from public.partidos
    where turma_id='00000000-0000-0000-0000-00000000ffa0' and nome='Azul')     as p_azul,
  (select id from public.partidos
    where turma_id='00000000-0000-0000-0000-00000000ffa0' and nome='Vermelho') as p_verm
\gset

-- =============================================================================
-- GRUPO A — o instrutor escreve; os checks da coluna valem
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000f0a0';  -- instrutor

select public.t5_tentar('A', 'instrutor cria anotacao para TODOS', 'passou',
  $$insert into public.anotacoes (turma_id, autor_id, texto, latitude, longitude)
    values ('00000000-0000-0000-0000-00000000ffa0',
            '00000000-0000-0000-0000-00000000f0a0',
            'Reabastecimento ate as 14h', -25.09, -50.16)$$);

select public.t5_tentar('A', 'instrutor cria anotacao so para o Azul', 'passou',
  format($$insert into public.anotacoes (turma_id, autor_id, texto, latitude, longitude, partido_id)
    values ('00000000-0000-0000-0000-00000000ffa0',
            '00000000-0000-0000-0000-00000000f0a0',
            'Eixo VERDE fechado', -25.10, -50.17, %L)$$, :'p_azul'));

-- Texto em branco desenharia uma caixa vazia no mapa de todo mundo.
select public.t5_tentar('A', 'texto so com espaco e recusado pelo check', 'erro',
  $$insert into public.anotacoes (turma_id, autor_id, texto, latitude, longitude)
    values ('00000000-0000-0000-0000-00000000ffa0',
            '00000000-0000-0000-0000-00000000f0a0', '   ', -25.0, -50.0)$$);

select public.t5_tentar('A', 'texto acima de 200 caracteres e recusado', 'erro',
  $$insert into public.anotacoes (turma_id, autor_id, texto, latitude, longitude)
    values ('00000000-0000-0000-0000-00000000ffa0',
            '00000000-0000-0000-0000-00000000f0a0', repeat('x', 201), -25.0, -50.0)$$);

select public.t5_tentar('A', 'cor fora de #rrggbb e recusada', 'erro',
  $$insert into public.anotacoes (turma_id, autor_id, texto, latitude, longitude, cor)
    values ('00000000-0000-0000-0000-00000000ffa0',
            '00000000-0000-0000-0000-00000000f0a0', 'PC', -25.0, -50.0, 'vermelho')$$);

select public.t5_tentar('A', 'latitude fora da faixa e recusada', 'erro',
  $$insert into public.anotacoes (turma_id, autor_id, texto, latitude, longitude)
    values ('00000000-0000-0000-0000-00000000ffa0',
            '00000000-0000-0000-0000-00000000f0a0', 'PC', 91, -50.0)$$);

-- `autor_id` mentido: o with check exige autor_id = auth.uid(). Sem isso um
-- instrutor escreveria em nome de outro e o painel mentiria sobre quem pôs
-- aquele texto no mapa.
select public.t5_tentar('A', 'instrutor NAO grava em nome de outra pessoa', 'erro',
  $$insert into public.anotacoes (turma_id, autor_id, texto, latitude, longitude)
    values ('00000000-0000-0000-0000-00000000ffa0',
            '00000000-0000-0000-0000-00000000f0a1', 'nao sou eu', -25.0, -50.0)$$);

-- O trigger de geom (0001, reusado) manteve a coluna espacial em dia.
set role postgres;
reset request.jwt.claim.sub;
select public.t5_ok('A', 'o trigger preencheu geom', '0',
  (select count(*)::text from public.anotacoes where geom is null));

-- =============================================================================
-- GRUPO B — QUEM VÊ O QUÊ. É o grupo que justifica a migration.
-- =============================================================================
set role authenticated;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000f0a1';  -- aluno AZUL
select public.t5_ok('B', 'aluno do Azul ve a geral E a do Azul', '2',
  (select count(*)::text from public.anotacoes));

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000f0b1';  -- aluno VERMELHO
-- **A asserção mais importante do arquivo.**
select public.t5_ok('B', 'aluno do Vermelho ve SO a geral (a do Azul nao vaza)', '1',
  (select count(*)::text from public.anotacoes));
select public.t5_ok('B', 'e o que ele ve e a geral mesmo', 'Reabastecimento ate as 14h',
  (select texto from public.anotacoes));

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000f0c1';  -- aluno SEM força
-- Aqui a semântica é oposta à de fn_usuarios_visiveis(): lá partido nulo é
-- restritivo (não vê ninguém); aqui o partido NULO É DA ANOTAÇÃO e significa
-- "todos", então um aluno sem força ainda lê os recados gerais. As duas regras
-- convivem porque falam de coisas diferentes — e é por isso que este caso está
-- escrito, para ninguém "corrigir" uma achando que é a outra.
select public.t5_ok('B', 'aluno SEM forca ve a geral', '1',
  (select count(*)::text from public.anotacoes));

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000f0a0';  -- instrutor
select public.t5_ok('B', 'instrutor ve as duas', '2',
  (select count(*)::text from public.anotacoes));

-- =============================================================================
-- GRUPO C — o aluno LÊ e não ESCREVE
-- =============================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000f0a1';  -- aluno AZUL

select public.t5_tentar('C', 'aluno NAO cria anotacao', 'erro',
  $$insert into public.anotacoes (turma_id, autor_id, texto, latitude, longitude)
    values ('00000000-0000-0000-0000-00000000ffa0',
            '00000000-0000-0000-0000-00000000f0a1', 'escrevi eu', -25.0, -50.0)$$);

-- 'zero linhas', não 'erro': a cláusula USING de anotacoes_escrever filtra a
-- linha para quem não é instrutor, e filtro não levanta exceção.
select public.t5_tentar('C', 'aluno nao alcanca a anotacao para editar', 'zero linhas',
  $$update public.anotacoes set texto = 'adulterado'$$);

select public.t5_tentar('C', 'aluno nao alcanca a anotacao para apagar', 'zero linhas',
  $$delete from public.anotacoes$$);

set role postgres;
reset request.jwt.claim.sub;
select public.t5_ok('C', 'e nada foi adulterado', '0',
  (select count(*)::text from public.anotacoes where texto = 'adulterado'));
select public.t5_ok('C', 'nem apagado', '2',
  (select count(*)::text from public.anotacoes));

-- =============================================================================
-- GRUPO D — remoção LÓGICA: sai do mapa, fica no banco
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000f0a0';  -- instrutor

select public.t5_tentar('D', 'instrutor remove (logicamente) a anotacao do Azul', 'passou',
  $$update public.anotacoes
       set removida_em = now(), removida_por = '00000000-0000-0000-0000-00000000f0a0'
     where texto = 'Eixo VERDE fechado'$$);

set role postgres;
reset request.jwt.claim.sub;
select public.t5_ok('D', 'a linha CONTINUA no banco', '2',
  (select count(*)::text from public.anotacoes));
select public.t5_ok('D', 'marcada como removida', '1',
  (select count(*)::text from public.anotacoes where removida_em is not null));
select public.t5_ok('D', 'e guardando quem removeu', '1',
  (select count(*)::text from public.anotacoes
    where removida_por = '00000000-0000-0000-0000-00000000f0a0'));
-- O cliente é quem filtra `removida_em is null` (mesma escolha de
-- elementos_marcados e calcos), então a policy continua entregando a linha —
-- o que sai é do MAPA, não da consulta. Se um dia alguém puser o filtro na
-- policy, esta linha avisa que o comportamento mudou.
select public.t5_ok('D', 'a policy NAO filtra removida (quem filtra e o cliente)', '2',
  (select count(*)::text from public.anotacoes));

-- =============================================================================
-- RELATÓRIO
-- =============================================================================
\pset format aligned
\echo ''
\echo '=== 05_teste_anotacoes: caixas de texto no mapa ==='
select grupo, descricao, esperado, obtido, case when ok then 'OK' else '** FALHOU **' end as r
from public.t5_resultados order by n;

select count(*) filter (where ok) as passaram,
       count(*) filter (where not ok) as falharam,
       count(*) as total
from public.t5_resultados;
