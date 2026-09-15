-- =============================================================================
-- Teste de 2026-09-15 — situação do usuário e pedido de apoio (migration 0014)
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001..0014 aplicados
-- nesta ordem. NÃO rodar no Supabase de produção. Espera um banco LIMPO.
--
-- O QUE ESTE ARQUIVO PROVA
-- ------------------------
--   1. **O recado do Azul não chega ao Vermelho.** É a razão de as duas
--      tabelas copiarem `posicoes_ler` em vez de morarem em `perfis` — cuja
--      policy de leitura entrega a turma inteira, os dois partidos. Se esta
--      asserção cair, um "sem munição" vira informação de inteligência para o
--      outro lado.
--   2. **O pedido de apoio SAI SEM POSIÇÃO.** Quem está sem sinal é
--      justamente quem mais pode precisar pedir; um `not null` em latitude
--      deixaria essa pessoa sem caminho.
--   3. **Reconhecer não encerra.** São colunas diferentes porque são fatos
--      diferentes ("estou vendo" ≠ "está resolvido").
--   4. **Ninguém fala pela boca de ninguém**: só o dono escreve a própria
--      situação — nem o instrutor.
--
-- Uso:
--   psql -f 00_stub_supabase.sql -f 0001 ... -f 0014 -f 06_teste_situacao_apoio.sql
-- =============================================================================

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

drop table if exists public.t6_resultados;
create table public.t6_resultados (
  n serial primary key, grupo text, descricao text, esperado text, obtido text, ok boolean
);

create or replace function public.t6_ok(p_grupo text, p_desc text, p_esperado text, p_obtido text)
returns void language plpgsql security definer as $$
begin
  insert into public.t6_resultados (grupo, descricao, esperado, obtido, ok)
  values (p_grupo, p_desc, p_esperado, p_obtido, p_esperado is not distinct from p_obtido);
end $$;
grant execute on function public.t6_ok(text,text,text,text) to authenticated;

-- Mesma distinção de três valores das suítes 04 e 05: a cláusula USING de uma
-- policy FILTRA em vez de levantar exceção, e ler isso como sucesso seria
-- aprovação falsa num teste de segurança.
create or replace function public.t6_tentar(
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
  perform public.t6_ok(p_grupo, p_desc, p_esperado, v);
end $$;
grant execute on function public.t6_tentar(text,text,text,text) to authenticated;

-- ── MASSA ───────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000060a0', 'instsit@wartool.local'),
  ('00000000-0000-0000-0000-0000000060a1', 'azul1sit@wartool.local'),
  ('00000000-0000-0000-0000-0000000060a2', 'azul2sit@wartool.local'),
  ('00000000-0000-0000-0000-0000000060b1', 'verm1sit@wartool.local');

insert into public.turmas (id, nome, codigo_acesso, instrutor_id) values
  ('00000000-0000-0000-0000-000000006fa0', 'Turma Sit', 'SIT-2026',
   '00000000-0000-0000-0000-0000000060a0');

update public.perfis set papel = 'instrutor', turma_id = '00000000-0000-0000-0000-000000006fa0'
  where id = '00000000-0000-0000-0000-0000000060a0';

update public.perfis p set
  turma_id = '00000000-0000-0000-0000-000000006fa0',
  partido_id = (select id from public.partidos
                where turma_id = '00000000-0000-0000-0000-000000006fa0' and nome = 'Azul')
where p.id in ('00000000-0000-0000-0000-0000000060a1',
               '00000000-0000-0000-0000-0000000060a2');

update public.perfis p set
  turma_id = '00000000-0000-0000-0000-000000006fa0',
  partido_id = (select id from public.partidos
                where turma_id = '00000000-0000-0000-0000-000000006fa0' and nome = 'Vermelho')
where p.id = '00000000-0000-0000-0000-0000000060b1';

-- =============================================================================
-- GRUPO A — situação: o dono escreve, os checks valem
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';  -- azul1

select public.t6_tentar('A', 'o dono grava a propria situacao', 'passou',
  $$insert into public.situacoes (usuario_id, turma_id, estado, texto)
    values ('00000000-0000-0000-0000-0000000060a1',
            '00000000-0000-0000-0000-000000006fa0', 'sem_municao', '2 pentes')$$);

select public.t6_tentar('A', 'estado fora da lista e recusado pelo check', 'erro',
  $$update public.situacoes set estado = 'emergencia'
     where usuario_id = '00000000-0000-0000-0000-0000000060a1'$$);

select public.t6_tentar('A', 'texto so com espaco e recusado', 'erro',
  $$update public.situacoes set texto = '   '
     where usuario_id = '00000000-0000-0000-0000-0000000060a1'$$);

select public.t6_tentar('A', 'texto acima de 80 caracteres e recusado', 'erro',
  $$update public.situacoes set texto = repeat('x', 81)
     where usuario_id = '00000000-0000-0000-0000-0000000060a1'$$);

-- Ninguém fala pela boca de ninguém: nem o colega, nem o instrutor.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a2';  -- azul2
select public.t6_tentar('A', 'colega NAO grava situacao em nome de outro', 'erro',
  $$insert into public.situacoes (usuario_id, turma_id, estado)
    values ('00000000-0000-0000-0000-0000000060a1',
            '00000000-0000-0000-0000-000000006fa0', 'em_contato')$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a0';  -- instrutor
select public.t6_tentar('A', 'o INSTRUTOR tambem nao escreve pelo aluno', 'zero linhas',
  $$update public.situacoes set estado = 'pane_viatura'
     where usuario_id = '00000000-0000-0000-0000-0000000060a1'$$);

-- =============================================================================
-- GRUPO B — QUEM LÊ A SITUAÇÃO. O grupo que justifica a migration.
-- =============================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a2';  -- azul2 (mesma força)
select public.t6_ok('B', 'colega da MESMA forca le a situacao', '1',
  (select count(*)::text from public.situacoes));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060b1';  -- VERMELHO
-- **A asserção mais importante do arquivo.**
select public.t6_ok('B', 'o Vermelho NAO le a situacao do Azul', '0',
  (select count(*)::text from public.situacoes));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a0';  -- instrutor
select public.t6_ok('B', 'o instrutor le', '1',
  (select count(*)::text from public.situacoes));

-- =============================================================================
-- GRUPO C — pedido de apoio: aciona, inclusive SEM posição
-- =============================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';  -- azul1

select public.t6_tentar('C', 'aciona com posicao', 'passou',
  $$insert into public.pedidos_apoio (usuario_id, turma_id, latitude, longitude, posicao_em)
    values ('00000000-0000-0000-0000-0000000060a1',
            '00000000-0000-0000-0000-000000006fa0', -25.09, -50.16, now())$$);

-- O caso que a coluna nulável existe para permitir.
select public.t6_tentar('C', 'aciona SEM posicao (quem esta sem sinal tambem pede)', 'passou',
  $$insert into public.pedidos_apoio (usuario_id, turma_id)
    values ('00000000-0000-0000-0000-0000000060a1',
            '00000000-0000-0000-0000-000000006fa0')$$);

select public.t6_tentar('C', 'NAO aciona em nome de outra pessoa', 'erro',
  $$insert into public.pedidos_apoio (usuario_id, turma_id)
    values ('00000000-0000-0000-0000-0000000060a2',
            '00000000-0000-0000-0000-000000006fa0')$$);

select public.t6_tentar('C', 'reconhecido sem quem reconheceu e recusado', 'erro',
  $$update public.pedidos_apoio set reconhecido_em = now()
     where usuario_id = '00000000-0000-0000-0000-0000000060a1'$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060b1';  -- VERMELHO
select public.t6_ok('C', 'o Vermelho NAO ve o pedido do Azul', '0',
  (select count(*)::text from public.pedidos_apoio));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a2';  -- azul2
select public.t6_ok('C', 'o colega da forca VE os dois pedidos', '2',
  (select count(*)::text from public.pedidos_apoio));
-- Ver não é gerir: quem socorre não dá por encerrado um pedido que não é dele
-- e que ele não sabe se foi atendido.
select public.t6_tentar('C', 'mas o colega NAO encerra o pedido de outro', 'zero linhas',
  $$update public.pedidos_apoio
       set encerrado_em = now(), encerrado_por = '00000000-0000-0000-0000-0000000060a2'$$);

-- =============================================================================
-- GRUPO D — ciclo de vida: reconhecer ≠ encerrar
-- =============================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a0';  -- instrutor

select public.t6_tentar('D', 'instrutor reconhece', 'passou',
  $$update public.pedidos_apoio
       set reconhecido_em = now(), reconhecido_por = '00000000-0000-0000-0000-0000000060a0'
     where encerrado_em is null$$);

set role postgres;
reset request.jwt.claim.sub;
-- Reconhecer NÃO encerra: o pedido continua vigente e continua na tela.
select public.t6_ok('D', 'reconhecer NAO encerrou nenhum', '0',
  (select count(*)::text from public.pedidos_apoio where encerrado_em is not null));
select public.t6_ok('D', 'e os dois continuam reconhecidos', '2',
  (select count(*)::text from public.pedidos_apoio where reconhecido_em is not null));

-- O próprio autor encerra o que ele abriu: um acionamento sem querer que só o
-- instrutor pudesse fechar viraria alarme tocando até alguém no notebook ver.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';  -- azul1, o autor
select public.t6_tentar('D', 'o AUTOR encerra o proprio pedido', 'passou',
  $$update public.pedidos_apoio
       set encerrado_em = now(), encerrado_por = '00000000-0000-0000-0000-0000000060a1'
     where usuario_id = '00000000-0000-0000-0000-0000000060a1'$$);

set role postgres;
reset request.jwt.claim.sub;
select public.t6_ok('D', 'as linhas CONTINUAM no banco depois de encerradas', '2',
  (select count(*)::text from public.pedidos_apoio));
select public.t6_ok('D', 'com o carimbo de quem encerrou', '2',
  (select count(*)::text from public.pedidos_apoio where encerrado_por is not null));

-- =============================================================================
-- RELATÓRIO
-- =============================================================================
\pset format aligned
\echo ''
\echo '=== 06_teste_situacao_apoio: situacao e pedido de apoio ==='
select grupo, descricao, esperado, obtido, case when ok then 'OK' else '** FALHOU **' end as r
from public.t6_resultados order by n;

select count(*) filter (where ok) as passaram,
       count(*) filter (where not ok) as falharam,
       count(*) as total
from public.t6_resultados;
