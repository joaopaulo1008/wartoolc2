-- =============================================================================
-- Teste de 2026-10-02 — o papel de uma conta nova não vem do cliente (0017)
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001..0017 aplicados
-- nesta ordem. NÃO rodar no Supabase de produção. Espera um banco LIMPO.
--
-- O QUE ESTE ARQUIVO PROVA
-- ------------------------
--   1. Quem se cadastra pedindo papel 'instrutor' (ou qualquer outro valor)
--      nos metadados NASCE 'usuario'. Antes da 0017 nascia instrutor: é o
--      defeito que a migration corrige.
--   2. Metadado de papel inválido não derruba o cadastro (antes o cast
--      levantava erro e a conta nem era criada).
--   3. O nome continua vindo dos metadados (a correção não quebrou o resto).
--   4. Os dois caminhos LEGÍTIMOS de promoção continuam funcionando: UPDATE
--      pela service_role / sem JWT (script de seed, Edge Function) e UPDATE
--      por instrutor. E o aluno continua NÃO conseguindo se promover.
--
-- Sobre a service_role: o stub cria o papel SEM BYPASSRLS, então "sem JWT" aqui
-- é o superusuário com auth.uid() nulo — o mesmo caminho que
-- fn_proteger_campos_do_perfil libera. Não prova nada sobre a service_role do
-- Supabase em si.
--
-- Uso:  psql -v ON_ERROR_STOP=1 -d <banco limpo> -f backend/testes/08_teste_papel_no_cadastro.sql
-- =============================================================================

begin;

create temp table _resultado (n serial, bloco text, caso text, passou boolean, detalhe text);

grant all on _resultado to public;
grant usage on sequence _resultado_n_seq to public;

create or replace function pg_temp.registrar(p_bloco text, p_caso text, p_passou boolean, p_detalhe text default null)
returns void language sql as $$
  insert into _resultado (bloco, caso, passou, detalhe) values (p_bloco, p_caso, coalesce(p_passou, false), p_detalhe);
$$;

-- ── A: o cadastro público ───────────────────────────────────────────────────
-- Cada cadastro roda isolado: antes da 0017 um papel inválido nos metadados
-- levantava erro (cast para o enum) e derrubaria o arquivo inteiro.
create or replace function pg_temp.cadastrar(p_id uuid, p_email text, p_meta jsonb, p_caso text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, raw_user_meta_data) values (p_id, p_email, p_meta);
exception when others then
  perform pg_temp.registrar('A', p_caso || ' — o cadastro foi recusado', false, sqlerrm);
end $$;

select pg_temp.cadastrar('00000000-0000-0000-0000-0000000000a1', 'a1@x', '{"nome_completo":"Quer Ser Instrutor","papel":"instrutor"}', 'A1');
select pg_temp.cadastrar('00000000-0000-0000-0000-0000000000a2', 'a2@x', '{"nome_completo":"Sem Papel"}', 'A2');
select pg_temp.cadastrar('00000000-0000-0000-0000-0000000000a3', 'a3@x', '{"nome_completo":"Papel Inventado","papel":"admin"}', 'A3');
select pg_temp.cadastrar('00000000-0000-0000-0000-0000000000a4', 'a4@x', '{"papel":"INSTRUTOR"}', 'A4');
select pg_temp.cadastrar('00000000-0000-0000-0000-0000000000a5', 'a5@x', '{}', 'A5');

select pg_temp.registrar('A', 'A1 metadados pedindo instrutor → nasce usuario',
  (select papel::text = 'usuario' from public.perfis where id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.registrar('A', 'A2 sem papel nos metadados → usuario',
  (select papel::text = 'usuario' from public.perfis where id = '00000000-0000-0000-0000-0000000000a2'));
select pg_temp.registrar('A', 'A3 papel inválido nos metadados: cadastro NÃO é derrubado e a conta nasce usuario',
  (select papel::text = 'usuario' from public.perfis where id = '00000000-0000-0000-0000-0000000000a3'));
select pg_temp.registrar('A', 'A4 papel em maiúsculas também é ignorado',
  (select papel::text = 'usuario' from public.perfis where id = '00000000-0000-0000-0000-0000000000a4'));
select pg_temp.registrar('A', 'A5 metadados vazios → perfil criado com o e-mail como nome',
  (select nome_completo = 'a5@x' from public.perfis where id = '00000000-0000-0000-0000-0000000000a5'));
select pg_temp.registrar('A', 'A6 o nome continua vindo dos metadados',
  (select nome_completo = 'Quer Ser Instrutor' from public.perfis where id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.registrar('A', 'A7 nenhum instrutor foi criado pelo cadastro',
  (select count(*) = 0 from public.perfis where papel = 'instrutor'));

-- ── B: as promoções legítimas continuam possíveis ───────────────────────────
-- B1: sem JWT (service_role / seed / Edge Function).
update public.perfis set papel = 'instrutor' where id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.registrar('B', 'B1 UPDATE sem JWT (service_role, seed, Edge Function) promove',
  (select papel::text = 'instrutor' from public.perfis where id = '00000000-0000-0000-0000-0000000000a2'));

-- B2: instrutor promove outra conta DA MESMA TURMA (só ali a policy de perfis deixa).
insert into public.turmas (id, nome, codigo_acesso, instrutor_id)
values ('00000000-0000-0000-0000-00000000f001', 'T', 'T-0017', '00000000-0000-0000-0000-0000000000a2');
update public.perfis set turma_id = '00000000-0000-0000-0000-00000000f001'
 where id in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a5');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
do $$
declare v_linhas int; v_erro text;
begin
  begin
    update public.perfis set papel = 'instrutor' where id = '00000000-0000-0000-0000-0000000000a5';
    get diagnostics v_linhas = row_count;
  exception when others then v_erro := sqlerrm;
  end;
  perform pg_temp.registrar('B', 'B2 instrutor promove conta da própria turma (1 linha, sem erro)', v_linhas = 1 and v_erro is null, coalesce(v_erro, v_linhas || ' linha(s)'));
end $$;
reset role;
select pg_temp.registrar('B', 'B2b e a conta de fato virou instrutor',
  (select papel::text = 'instrutor' from public.perfis where id = '00000000-0000-0000-0000-0000000000a5'));

-- B3: o próprio aluno NÃO se promove (a regra do 0002 continua valendo).
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare v_resultado text;
begin
  begin
    update public.perfis set papel = 'instrutor' where id = '00000000-0000-0000-0000-0000000000a1';
    v_resultado := 'zero linhas ou passou';
  exception when others then
    v_resultado := 'erro:' || sqlstate;
  end;
  perform pg_temp.registrar('B', 'B3 aluno tentando se promover é RECUSADO com erro (42501)', v_resultado = 'erro:42501', v_resultado);
end $$;
reset role;
select pg_temp.registrar('B', 'B4 e continua usuario depois da tentativa',
  (select papel::text = 'usuario' from public.perfis where id = '00000000-0000-0000-0000-0000000000a1'));

-- ── Relatório ───────────────────────────────────────────────────────────────
select format('%s  [%s] %s%s', case when passou then 'PASSOU' else '** FALHOU **' end, bloco, caso,
              case when detalhe is not null and not passou then ' — ' || detalhe else '' end) as resultado
from _resultado order by n;

select format(E'\n%s passaram, %s falharam, %s total',
              count(*) filter (where passou), count(*) filter (where not passou), count(*)) as resumo
from _resultado;

rollback;
