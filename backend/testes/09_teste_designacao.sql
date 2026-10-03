-- =============================================================================
-- Teste de 2026-10-03 — designação do calunga: numero_esq, numero_dir, nome_fracao (0018)
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001..0018 aplicados
-- nesta ordem. NÃO rodar no Supabase de produção. Espera um banco LIMPO.
--
-- O QUE ESTE ARQUIVO PROVA
-- ------------------------
--   1. As três colunas existem, são NULL por padrão (conta antiga não muda).
--   2. Os limites do banco (1–4 caracteres nos números, 1–20 no nome da fração,
--      sem espaço nas pontas, vazio é NULL e não '') — iguais aos do front-end.
--   3. SÓ quem manda na turma define a designação: o aluno é RECUSADO com erro
--      (42501), nem o próprio perfil ele altera; o instrutor da turma altera;
--      o caminho sem JWT (seed, Edge Function) também.
--   4. A correção não quebrou a proteção que já existia: papel, turma e partido
--      continuam fechados para o aluno.
--
-- USING filtra em silêncio ('zero linhas'); só WITH CHECK / trigger levanta
-- erro. Aqui a recusa vem da TRIGGER (erro 42501), então o resultado esperado
-- do aluno é 'erro', nunca 'zero linhas'.
-- =============================================================================
begin;

create temp table _resultado (n serial, bloco text, caso text, passou boolean, detalhe text);
grant all on _resultado to public;
grant usage on sequence _resultado_n_seq to public;

create or replace function pg_temp.registrar(p_bloco text, p_caso text, p_passou boolean, p_detalhe text default null)
returns void language sql as $$
  insert into _resultado (bloco, caso, passou, detalhe) values (p_bloco, p_caso, coalesce(p_passou, false), p_detalhe);
$$;

-- tenta uma operação e devolve 'erro:<sqlstate>' | 'ok:<linhas>'
create or replace function pg_temp.tentar(p_sql text) returns text language plpgsql as $$
declare v int;
begin
  execute p_sql; get diagnostics v = row_count; return 'ok:' || v;
exception when others then return 'erro:' || sqlstate;
end $$;
grant execute on function pg_temp.tentar(text) to public;

-- Cenário: uma turma, um instrutor (i1), dois alunos (a1, a2) e um aluno de outra turma (b1).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'i1@x'), ('00000000-0000-0000-0000-0000000000a2', 'a1@x'),
  ('00000000-0000-0000-0000-0000000000a3', 'a2@x'), ('00000000-0000-0000-0000-0000000000b1', 'b1@x');
update public.perfis set papel = 'instrutor' where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.turmas (id, nome, codigo_acesso, instrutor_id) values
  ('00000000-0000-0000-0000-00000000f001', 'A', 'TA-0018', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-00000000f002', 'B', 'TB-0018', null);
update public.perfis set turma_id = '00000000-0000-0000-0000-00000000f001'
 where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3');
update public.perfis set turma_id = '00000000-0000-0000-0000-00000000f002' where id = '00000000-0000-0000-0000-0000000000b1';

-- ── A: colunas e valores padrão ─────────────────────────────────────────────
select pg_temp.registrar('A', 'A1 as três colunas existem',
  (select count(*) = 3 from information_schema.columns where table_schema='public' and table_name='perfis' and column_name in ('numero_esq','numero_dir','nome_fracao')));
select pg_temp.registrar('A', 'A2 contas existentes ficam com NULL (nada muda para elas)',
  (select count(*) = 4 from public.perfis where numero_esq is null and numero_dir is null and nome_fracao is null));

-- ── B: limites do banco (como superusuário, sem JWT) ───────────────────────
select pg_temp.registrar('B', 'B1 número de 1 a 4 caracteres é aceito',
  pg_temp.tentar($$update public.perfis set numero_esq='1', numero_dir='A12B' where id='00000000-0000-0000-0000-0000000000a2'$$) = 'ok:1');
select pg_temp.registrar('B', 'B2 número com 5 caracteres é RECUSADO',
  pg_temp.tentar($$update public.perfis set numero_esq='12345' where id='00000000-0000-0000-0000-0000000000a2'$$) like 'erro:23514');
select pg_temp.registrar('B', 'B3 string vazia é RECUSADA (vazio é NULL)',
  pg_temp.tentar($$update public.perfis set numero_dir='' where id='00000000-0000-0000-0000-0000000000a2'$$) like 'erro:23514');
select pg_temp.registrar('B', 'B4 espaço nas pontas é RECUSADO',
  pg_temp.tentar($$update public.perfis set numero_esq=' 1' where id='00000000-0000-0000-0000-0000000000a2'$$) like 'erro:23514');
select pg_temp.registrar('B', 'B5 nome da fração com 20 caracteres é aceito',
  pg_temp.tentar($$update public.perfis set nome_fracao=repeat('x',20) where id='00000000-0000-0000-0000-0000000000a2'$$) = 'ok:1');
select pg_temp.registrar('B', 'B6 nome da fração com 21 caracteres é RECUSADO',
  pg_temp.tentar($$update public.perfis set nome_fracao=repeat('x',21) where id='00000000-0000-0000-0000-0000000000a2'$$) like 'erro:23514');
select pg_temp.registrar('B', 'B7 voltar a NULL é permitido',
  pg_temp.tentar($$update public.perfis set numero_esq=null, numero_dir=null, nome_fracao=null where id='00000000-0000-0000-0000-0000000000a2'$$) = 'ok:1');

-- ── C: quem pode definir ────────────────────────────────────────────────────
-- C1: o ALUNO tentando o PRÓPRIO perfil
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.registrar('C', 'C1 aluno NÃO define a própria designação (erro 42501)',
  pg_temp.tentar($$update public.perfis set numero_esq='9' where id='00000000-0000-0000-0000-0000000000a2'$$) = 'erro:42501');
select pg_temp.registrar('C', 'C2 aluno NÃO define o nome da fração (erro 42501)',
  pg_temp.tentar($$update public.perfis set nome_fracao='Pel Fuz' where id='00000000-0000-0000-0000-0000000000a2'$$) = 'erro:42501');
select pg_temp.registrar('C', 'C3 aluno continua podendo editar o que sempre pôde (nome de guerra)',
  pg_temp.tentar($$update public.perfis set nome_guerra='Fulano' where id='00000000-0000-0000-0000-0000000000a2'$$) = 'ok:1');
select pg_temp.registrar('C', 'C4 aluno continua NÃO mudando papel / partido (proteção anterior intacta)',
  pg_temp.tentar($$update public.perfis set papel='instrutor' where id='00000000-0000-0000-0000-0000000000a2'$$) = 'erro:42501');
reset role;

-- C5: o instrutor da turma define para um aluno DA TURMA
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.registrar('C', 'C5 instrutor define a designação de aluno da própria turma (1 linha)',
  pg_temp.tentar($$update public.perfis set numero_esq='1', numero_dir='2', nome_fracao='Pel Fuz' where id='00000000-0000-0000-0000-0000000000a2'$$) = 'ok:1');
-- C6: o instrutor da turma A tentando um aluno da turma B → a policy FILTRA em silêncio
select pg_temp.registrar('C', 'C6 instrutor NÃO alcança aluno de outra turma (zero linhas, sem erro)',
  pg_temp.tentar($$update public.perfis set numero_esq='7' where id='00000000-0000-0000-0000-0000000000b1'$$) = 'ok:0');
reset role;

select pg_temp.registrar('C', 'C7 os valores do instrutor foram gravados',
  (select numero_esq = '1' and numero_dir = '2' and nome_fracao = 'Pel Fuz' from public.perfis where id='00000000-0000-0000-0000-0000000000a2'));
select pg_temp.registrar('C', 'C8 o aluno da outra turma continua sem designação',
  (select numero_esq is null from public.perfis where id='00000000-0000-0000-0000-0000000000b1'));

-- C9: sem JWT (service_role, seed, Edge Function)
select pg_temp.registrar('C', 'C9 sem JWT (service_role / seed / Edge Function) define',
  pg_temp.tentar($$update public.perfis set numero_esq='3' where id='00000000-0000-0000-0000-0000000000a3'$$) = 'ok:1');

select format('%s  [%s] %s%s', case when passou then 'PASSOU' else '** FALHOU **' end, bloco, caso,
              case when detalhe is not null and not passou then ' — ' || detalhe else '' end) as resultado
from _resultado order by n;
select format(E'\n%s passaram, %s falharam, %s total',
              count(*) filter (where passou), count(*) filter (where not passou), count(*)) as resumo
from _resultado;

rollback;
