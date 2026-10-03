-- =============================================================================
-- Teste de 2026-10-03 — administrador de todas as turmas (0019)
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001..0019 aplicados nesta
-- ordem. NÃO rodar no Supabase de produção. Espera um banco LIMPO.
--
-- O QUE ESTE ARQUIVO PROVA
--   A. A coluna nasce false; fn_sou_admin() só é verdadeira para instrutor
--      marcado (aluno marcado NÃO vale).
--   B. NINGUÉM concede o papel pelo app (aluno, instrutor, o próprio admin:
--      erro 42501); sem JWT (SQL Editor) concede.
--   C. O administrador alcança as 3 turmas: lê turmas e perfis, edita turma,
--      define designação em aluno de turma que não é dele, vê posições; NÃO
--      apaga turma (zero linhas).
--   D. NADA mudou para quem não é administrador: o instrutor comum continua
--      alcançando só a turma dele; o aluno só a dele.
--
-- USING filtra em silêncio ('ok:0'); só WITH CHECK / trigger levanta erro.
-- =============================================================================
begin;

create temp table _resultado (n serial, bloco text, caso text, passou boolean, detalhe text);
grant all on _resultado to public;
grant usage on sequence _resultado_n_seq to public;

create or replace function pg_temp.registrar(p_bloco text, p_caso text, p_passou boolean, p_detalhe text default null)
returns void language sql as $$
  insert into _resultado (bloco, caso, passou, detalhe) values (p_bloco, p_caso, coalesce(p_passou, false), p_detalhe);
$$;
create or replace function pg_temp.tentar(p_sql text) returns text language plpgsql as $$
declare v int;
begin
  execute p_sql; get diagnostics v = row_count; return 'ok:' || v;
exception when others then return 'erro:' || sqlstate;
end $$;
grant execute on function pg_temp.tentar(text) to public;
-- conta linhas visíveis para quem está logado (a consulta roda sob RLS)
create or replace function pg_temp.contar(p_sql text) returns int language plpgsql as $$
declare v int;
begin execute p_sql into v; return v; end $$;
grant execute on function pg_temp.contar(text) to public;

-- Cenário
--   ad  = administrador (instrutor, sem turma)           a1 = instrutor comum, responsável da turma A
--   i2  = instrutor comum, responsável da turma C        alA = aluno da A    alB = aluno da B    alC = aluno da C
--   fa  = aluno marcado administrador (não vale)
--   Turma B não tem responsável.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000019a0', 'ad@x'), ('00000000-0000-0000-0000-0000000019a1', 'a1@x'),
  ('00000000-0000-0000-0000-0000000019a2', 'i2@x'), ('00000000-0000-0000-0000-0000000019b1', 'alA@x'),
  ('00000000-0000-0000-0000-0000000019b2', 'alB@x'), ('00000000-0000-0000-0000-0000000019b3', 'alC@x'),
  ('00000000-0000-0000-0000-0000000019c1', 'fa@x');
update public.perfis set papel = 'instrutor' where id in
  ('00000000-0000-0000-0000-0000000019a0','00000000-0000-0000-0000-0000000019a1','00000000-0000-0000-0000-0000000019a2');
insert into public.turmas (id, nome, codigo_acesso, instrutor_id) values
  ('00000000-0000-0000-0000-00000019f00a', 'A', 'TA-0019', '00000000-0000-0000-0000-0000000019a1'),
  ('00000000-0000-0000-0000-00000019f00b', 'B', 'TB-0019', null),
  ('00000000-0000-0000-0000-00000019f00c', 'C', 'TC-0019', '00000000-0000-0000-0000-0000000019a2');
update public.perfis set turma_id = '00000000-0000-0000-0000-00000019f00a' where id in
  ('00000000-0000-0000-0000-0000000019a1','00000000-0000-0000-0000-0000000019b1');
update public.perfis set turma_id = '00000000-0000-0000-0000-00000019f00b' where id = '00000000-0000-0000-0000-0000000019b2';
update public.perfis set turma_id = '00000000-0000-0000-0000-00000019f00c' where id in
  ('00000000-0000-0000-0000-0000000019a2','00000000-0000-0000-0000-0000000019b3');
-- posições atuais (sem JWT)
insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude) values
  ('00000000-0000-0000-0000-0000000019b1', '00000000-0000-0000-0000-00000019f00a', -25.1, -50.1),
  ('00000000-0000-0000-0000-0000000019b2', '00000000-0000-0000-0000-00000019f00b', -25.2, -50.2),
  ('00000000-0000-0000-0000-0000000019b3', '00000000-0000-0000-0000-00000019f00c', -25.3, -50.3);

-- ── A: a marca ──────────────────────────────────────────────────────────────
select pg_temp.registrar('A', 'A1 todo mundo nasce com administrador = false',
  (select count(*) = 0 from public.perfis where administrador));
-- concedido SEM JWT (como o SQL Editor faria)
update public.perfis set administrador = true where id in
  ('00000000-0000-0000-0000-0000000019a0','00000000-0000-0000-0000-0000000019c1');
select pg_temp.registrar('A', 'A2 sem JWT (SQL Editor) concede a marca',
  (select count(*) = 2 from public.perfis where administrador));
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019a0';
select pg_temp.registrar('A', 'A3 fn_sou_admin() é verdadeira para o instrutor marcado', public.fn_sou_admin());
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019c1';
select pg_temp.registrar('A', 'A4 fn_sou_admin() é FALSA para aluno marcado (exige papel instrutor)', not public.fn_sou_admin());
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019a1';
select pg_temp.registrar('A', 'A5 fn_sou_admin() é falsa para instrutor comum', not public.fn_sou_admin());
reset role;

-- ── B: ninguém concede pelo app ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019b1';
select pg_temp.registrar('B', 'B1 aluno NÃO se promove (erro 42501)',
  pg_temp.tentar($$update public.perfis set administrador = true where id = '00000000-0000-0000-0000-0000000019b1'$$) = 'erro:42501');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019a1';
select pg_temp.registrar('B', 'B2 instrutor comum NÃO se promove (erro 42501)',
  pg_temp.tentar($$update public.perfis set administrador = true where id = '00000000-0000-0000-0000-0000000019a1'$$) = 'erro:42501');
select pg_temp.registrar('B', 'B3 instrutor comum NÃO promove aluno da própria turma (erro 42501)',
  pg_temp.tentar($$update public.perfis set administrador = true where id = '00000000-0000-0000-0000-0000000019b1'$$) = 'erro:42501');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019a0';
select pg_temp.registrar('B', 'B4 nem o administrador concede a outro pelo app (erro 42501)',
  pg_temp.tentar($$update public.perfis set administrador = true where id = '00000000-0000-0000-0000-0000000019a2'$$) = 'erro:42501');
select pg_temp.registrar('B', 'B5 nem o administrador tira a própria marca pelo app (erro 42501)',
  pg_temp.tentar($$update public.perfis set administrador = false where id = '00000000-0000-0000-0000-0000000019a0'$$) = 'erro:42501');
reset role;
select pg_temp.registrar('B', 'B6 a marca de ninguém mudou com as tentativas',
  (select count(*) = 2 from public.perfis where administrador));

-- ── C: o que o administrador alcança ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019a0';
select pg_temp.registrar('C', 'C1 lê as 3 turmas', pg_temp.contar('select count(*) from public.turmas') = 3);
select pg_temp.registrar('C', 'C2 lê os perfis das 3 turmas (alunos e instrutores)',
  pg_temp.contar($$select count(*) from public.perfis where turma_id is not null$$) = 5);
select pg_temp.registrar('C', 'C3 vê as 3 posições atuais', pg_temp.contar('select count(*) from public.posicoes_atuais') = 3);
select pg_temp.registrar('C', 'C4 fn_usuarios_visiveis inclui os alunos das 3 turmas',
  pg_temp.contar($$select count(*) from public.fn_usuarios_visiveis() u where u in
    ('00000000-0000-0000-0000-0000000019b1','00000000-0000-0000-0000-0000000019b2','00000000-0000-0000-0000-0000000019b3')$$) = 3);
select pg_temp.registrar('C', 'C5 edita turma que não é dele (sem responsável)',
  pg_temp.tentar($$update public.turmas set descricao = 'ajustada pelo admin' where id = '00000000-0000-0000-0000-00000019f00b'$$) = 'ok:1');
select pg_temp.registrar('C', 'C6 define a designação de aluno de outra turma (1 linha)',
  pg_temp.tentar($$update public.perfis set numero_esq = '1', numero_dir = '2' where id = '00000000-0000-0000-0000-0000000019b3'$$) = 'ok:1');
select pg_temp.registrar('C', 'C7 tira aluno de turma que não é dele (fn_remover_da_turma)',
  pg_temp.tentar($$select public.fn_remover_da_turma('00000000-0000-0000-0000-0000000019b2')$$) = 'ok:1');
select pg_temp.registrar('C', 'C8 NÃO apaga turma (zero linhas, a turma continua)',
  pg_temp.tentar($$delete from public.turmas where id = '00000000-0000-0000-0000-00000019f00c'$$) = 'ok:0');
reset role;
select pg_temp.registrar('C', 'C10 o aluno removido de fato ficou sem turma',
  (select turma_id is null from public.perfis where id = '00000000-0000-0000-0000-0000000019b2'));
select pg_temp.registrar('C', 'C9 a turma C continua existindo e a edição de C5 ficou gravada',
  (select count(*) = 1 from public.turmas where id = '00000000-0000-0000-0000-00000019f00c')
  and (select descricao = 'ajustada pelo admin' from public.turmas where id = '00000000-0000-0000-0000-00000019f00b'));

-- ── D: ninguém mais ganhou nada ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019a2';
select pg_temp.registrar('D', 'D1 instrutor comum lê só a turma que comanda (C)', pg_temp.contar('select count(*) from public.turmas') = 1);
select pg_temp.registrar('D', 'D2 instrutor comum NÃO edita turma dos outros (zero linhas)',
  pg_temp.tentar($$update public.turmas set descricao = 'invasão' where id = '00000000-0000-0000-0000-00000019f00a'$$) = 'ok:0');
select pg_temp.registrar('D', 'D3 instrutor comum NÃO alcança aluno de outra turma (zero linhas)',
  pg_temp.tentar($$update public.perfis set numero_esq = '9' where id = '00000000-0000-0000-0000-0000000019b1'$$) = 'ok:0');
select pg_temp.registrar('D', 'D4 instrutor comum vê só a posição da turma dele',
  pg_temp.contar('select count(*) from public.posicoes_atuais') = 1);
select pg_temp.registrar('D', 'D5 instrutor comum continua definindo designação na própria turma',
  pg_temp.tentar($$update public.perfis set numero_esq = '5' where id = '00000000-0000-0000-0000-0000000019b3'$$) = 'ok:1');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019b1';
select pg_temp.registrar('D', 'D6 aluno lê só a turma dele', pg_temp.contar('select count(*) from public.turmas') = 1);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000019c1';
select pg_temp.registrar('D', 'D7 aluno marcado como administrador não lê turma de ninguém (só a própria: nenhuma)',
  pg_temp.contar('select count(*) from public.turmas') = 0);
select pg_temp.registrar('D', 'D8 aluno marcado como administrador não vê posições',
  pg_temp.contar('select count(*) from public.posicoes_atuais') = 0);
reset role;

select format('%s  [%s] %s%s', case when passou then 'PASSOU' else '** FALHOU **' end, bloco, caso,
              case when detalhe is not null and not passou then ' — ' || detalhe else '' end) as resultado
from _resultado order by n;
select format(E'\n%s passaram, %s falharam, %s total',
              count(*) filter (where passou), count(*) filter (where not passou), count(*)) as resumo
from _resultado;

rollback;
