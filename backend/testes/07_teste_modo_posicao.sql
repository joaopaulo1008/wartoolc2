-- =============================================================================
-- Teste de 2026-10-02 — modo de posição da turma e origem da posição (0016)
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001..0016 aplicados
-- nesta ordem. NÃO rodar no Supabase de produção. Espera um banco LIMPO.
--
-- O QUE ESTE ARQUIVO PROVA
-- ------------------------
--   1. **A origem da posição é amarrada ao modo da turma pelo BANCO.** Numa
--      turma 'manual' o aluno não consegue gravar posição de GPS; numa turma
--      'gps' não consegue se teletransportar; e 'externa' (a origem do
--      simulador) ele não grava em modo nenhum. Se estas asserções caírem, a
--      simulação deixa de ser separável da posição real.
--   2. **Só o instrutor da turma troca o modo** — nem o aluno, nem o
--      instrutor de outra turma.
--   3. **O modo de uma turma não vaza para a outra.**
--   4. **O histórico carrega a origem**, para o debriefing separar simulado de
--      real.
--
-- Sobre a gravação 'externa': na produção ela é feita pela `service_role`, que
-- tem BYPASSRLS. O stub de testes cria `service_role` SEM esse atributo, então
-- aqui a gravação "do serviço" é feita como superusuário (que também ignora
-- RLS). Prova o caminho — a policy do aluno recusa, quem ignora RLS grava —
-- mas NÃO prova nada sobre a service_role do Supabase em si.
--
-- Mesma distinção de três valores das suítes 04, 05 e 06: o USING de uma
-- policy FILTRA em silêncio ('zero linhas'), só o WITH CHECK levanta erro.
-- Ler os dois como sucesso seria aprovação falsa num teste de segurança.
--
-- Uso:
--   psql -f 00_stub_supabase.sql -f 0001 ... -f 0016 -f 07_teste_modo_posicao.sql
-- =============================================================================

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

drop table if exists public.t7_resultados;
create table public.t7_resultados (
  n serial primary key, grupo text, descricao text, esperado text, obtido text, ok boolean
);

create or replace function public.t7_ok(p_grupo text, p_desc text, p_esperado text, p_obtido text)
returns void language plpgsql security definer as $$
begin
  insert into public.t7_resultados (grupo, descricao, esperado, obtido, ok)
  values (p_grupo, p_desc, p_esperado, p_obtido, p_esperado is not distinct from p_obtido);
end $$;
grant execute on function public.t7_ok(text,text,text,text) to authenticated;

create or replace function public.t7_tentar(
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
  perform public.t7_ok(p_grupo, p_desc, p_esperado, v);
end $$;
grant execute on function public.t7_tentar(text,text,text,text) to authenticated;

-- ── MASSA ───────────────────────────────────────────────────────────────────
-- Turma A (a que muda de modo) e Turma B (que fica em 'gps' o tempo todo, para
-- provar que o modo não vaza). Um usuário sem turma, para o caminho do coalesce.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000070a0', 'instmodo@wartool.local'),
  ('00000000-0000-0000-0000-0000000070a1', 'aluno1modo@wartool.local'),
  ('00000000-0000-0000-0000-0000000070a2', 'aluno2modo@wartool.local'),
  ('00000000-0000-0000-0000-0000000070c1', 'alunobmodo@wartool.local'),
  ('00000000-0000-0000-0000-0000000070d1', 'semturmamodo@wartool.local');

insert into public.turmas (id, nome, codigo_acesso, instrutor_id) values
  ('00000000-0000-0000-0000-000000007fa0', 'Turma Modo A', 'MODO-A-2026',
   '00000000-0000-0000-0000-0000000070a0'),
  ('00000000-0000-0000-0000-000000007fb0', 'Turma Modo B', 'MODO-B-2026', null);

update public.perfis set papel = 'instrutor', turma_id = '00000000-0000-0000-0000-000000007fa0'
  where id = '00000000-0000-0000-0000-0000000070a0';
update public.perfis set turma_id = '00000000-0000-0000-0000-000000007fa0'
  where id in ('00000000-0000-0000-0000-0000000070a1',
               '00000000-0000-0000-0000-0000000070a2');
update public.perfis set turma_id = '00000000-0000-0000-0000-000000007fb0'
  where id = '00000000-0000-0000-0000-0000000070c1';

-- =============================================================================
-- GRUPO A — modo 'gps' (o padrão): nada muda para quem já usa o app
-- =============================================================================
select public.t7_ok('A', 'turma nova nasce em modo gps', 'gps',
  (select modo_posicao from public.turmas where id = '00000000-0000-0000-0000-000000007fa0'));

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';  -- aluno1

select public.t7_ok('A', 'fn_modo_posicao_minha_turma devolve gps ao aluno', 'gps',
  public.fn_modo_posicao_minha_turma());

select public.t7_tentar('A', 'aluno grava posicao com origem gps', 'passou',
  $$insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude, origem)
    values ('00000000-0000-0000-0000-0000000070a1',
            '00000000-0000-0000-0000-000000007fa0', -25.09, -50.16, 'gps')$$);

-- Gravação SEM informar origem (o que o cliente de hoje faz): vale o default.
select public.t7_tentar('A', 'cliente antigo, sem origem, continua gravando', 'passou',
  $$update public.posicoes_atuais set latitude = -25.10
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

select public.t7_tentar('A', 'em modo gps o aluno NAO grava origem manual', 'erro',
  $$update public.posicoes_atuais set origem = 'manual', latitude = -25.20
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

select public.t7_tentar('A', 'em modo gps o aluno NAO grava origem externa', 'erro',
  $$update public.posicoes_atuais set origem = 'externa', latitude = -25.20
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

select public.t7_tentar('A', 'origem fora da lista e recusada pelo check', 'erro',
  $$update public.posicoes_atuais set origem = 'teleporte'
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

-- =============================================================================
-- GRUPO B — quem troca o modo
-- =============================================================================
select public.t7_tentar('B', 'o ALUNO nao troca o modo da propria turma', 'zero linhas',
  $$update public.turmas set modo_posicao = 'manual'
     where id = '00000000-0000-0000-0000-000000007fa0'$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a0';  -- instrutor da A

select public.t7_tentar('B', 'modo fora da lista e recusado pelo check', 'erro',
  $$update public.turmas set modo_posicao = 'teleporte'
     where id = '00000000-0000-0000-0000-000000007fa0'$$);

select public.t7_tentar('B', 'o instrutor de OUTRA turma nao troca o modo da B', 'zero linhas',
  $$update public.turmas set modo_posicao = 'manual'
     where id = '00000000-0000-0000-0000-000000007fb0'$$);

select public.t7_tentar('B', 'o instrutor da A poe a A em modo manual', 'passou',
  $$update public.turmas set modo_posicao = 'manual'
     where id = '00000000-0000-0000-0000-000000007fa0'$$);

-- =============================================================================
-- GRUPO C — modo 'manual' (simulação sem GPS)
-- =============================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';  -- aluno1

select public.t7_ok('C', 'fn_modo_posicao_minha_turma devolve manual', 'manual',
  public.fn_modo_posicao_minha_turma());

select public.t7_tentar('C', 'aluno posiciona o proprio posto (origem manual)', 'passou',
  $$update public.posicoes_atuais set origem = 'manual', latitude = -25.30, longitude = -50.30
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

-- A asserção que dá sentido à migration: o celular com GPS ligado não consegue
-- injetar posição "real" numa turma de simulação.
select public.t7_tentar('C', 'em modo manual o aluno NAO grava origem gps', 'erro',
  $$update public.posicoes_atuais set origem = 'gps', latitude = -25.40
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

select public.t7_tentar('C', 'em modo manual o aluno NAO grava origem externa', 'erro',
  $$update public.posicoes_atuais set origem = 'externa', latitude = -25.40
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

-- Segundo aluno, sem linha ainda: o INSERT (primeiro posicionamento) passa
-- pela outra policy, e ela também tem que valer.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a2';  -- aluno2

select public.t7_tentar('C', 'primeira posicao em modo manual com origem gps e recusada', 'erro',
  $$insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude, origem)
    values ('00000000-0000-0000-0000-0000000070a2',
            '00000000-0000-0000-0000-000000007fa0', -25.50, -50.50, 'gps')$$);

select public.t7_tentar('C', 'primeira posicao em modo manual com origem manual passa', 'passou',
  $$insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude, origem)
    values ('00000000-0000-0000-0000-0000000070a2',
            '00000000-0000-0000-0000-000000007fa0', -25.50, -50.50, 'manual')$$);

select public.t7_tentar('C', 'aluno NAO posiciona o posto de outro aluno', 'erro',
  $$insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude, origem)
    values ('00000000-0000-0000-0000-0000000070a1',
            '00000000-0000-0000-0000-000000007fa0', -25.60, -50.60, 'manual')
    on conflict (usuario_id) do update set latitude = excluded.latitude$$);

-- =============================================================================
-- GRUPO D — modo 'externa' (simulador): o aluno não grava posição
-- =============================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a0';  -- instrutor
select public.t7_tentar('D', 'o instrutor poe a A em modo externa', 'passou',
  $$update public.turmas set modo_posicao = 'externa'
     where id = '00000000-0000-0000-0000-000000007fa0'$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';  -- aluno1

select public.t7_ok('D', 'fn_modo_posicao_minha_turma devolve externa', 'externa',
  public.fn_modo_posicao_minha_turma());

select public.t7_tentar('D', 'em modo externa o aluno NAO grava origem externa', 'erro',
  $$update public.posicoes_atuais set origem = 'externa', latitude = -25.70
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

select public.t7_tentar('D', 'em modo externa o aluno NAO grava origem manual', 'erro',
  $$update public.posicoes_atuais set origem = 'manual', latitude = -25.70
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

select public.t7_tentar('D', 'em modo externa o aluno NAO grava origem gps', 'erro',
  $$update public.posicoes_atuais set origem = 'gps', latitude = -25.70
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

-- O caminho do serviço de integração: quem ignora RLS grava. Ver o aviso do
-- cabeçalho sobre superusuário x service_role.
reset role;
reset request.jwt.claim.sub;
select public.t7_tentar('D', 'o servico (sem RLS) grava origem externa', 'passou',
  $$update public.posicoes_atuais set origem = 'externa', latitude = -25.80, longitude = -50.80
     where usuario_id = '00000000-0000-0000-0000-0000000070a1'$$);

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';
select public.t7_ok('D', 'o aluno LE a propria posicao externa', 'externa',
  (select origem from public.posicoes_atuais
    where usuario_id = '00000000-0000-0000-0000-0000000070a1'));

-- =============================================================================
-- GRUPO E — o histórico carrega a origem
-- =============================================================================
-- Tabela de histórico: o aluno só lê (0002). Escrever direto tem que falhar.
select public.t7_tentar('E', 'aluno NAO escreve direto no historico', 'erro',
  $$insert into public.posicoes_historico (usuario_id, turma_id, latitude, longitude, origem)
    values ('00000000-0000-0000-0000-0000000070a1',
            '00000000-0000-0000-0000-000000007fa0', 0, 0, 'externa')$$);

reset role;
reset request.jwt.claim.sub;
select public.t7_ok('E', 'historico tem posicao de origem gps', 'true',
  (select (count(*) >= 1)::text from public.posicoes_historico
    where usuario_id = '00000000-0000-0000-0000-0000000070a1' and origem = 'gps'));
select public.t7_ok('E', 'historico tem posicao de origem manual', 'true',
  (select (count(*) >= 1)::text from public.posicoes_historico
    where usuario_id = '00000000-0000-0000-0000-0000000070a1' and origem = 'manual'));
select public.t7_ok('E', 'historico tem EXATAMENTE uma de origem externa (a do servico)', '1',
  (select count(*)::text from public.posicoes_historico
    where usuario_id = '00000000-0000-0000-0000-0000000070a1' and origem = 'externa'));
select public.t7_ok('E', 'nenhuma linha do historico ficou sem origem', '0',
  (select count(*)::text from public.posicoes_historico where origem is null));

-- =============================================================================
-- GRUPO F — o modo de uma turma não vaza para a outra
-- =============================================================================
-- A turma A está em 'externa' neste ponto. A B nunca saiu de 'gps'.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070c1';  -- aluno da B

select public.t7_ok('F', 'a turma B continua em gps', 'gps',
  public.fn_modo_posicao_minha_turma());

select public.t7_tentar('F', 'aluno da B grava gps (A esta em externa)', 'passou',
  $$insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude, origem)
    values ('00000000-0000-0000-0000-0000000070c1',
            '00000000-0000-0000-0000-000000007fb0', -25.90, -50.90, 'gps')$$);

select public.t7_tentar('F', 'aluno da B NAO grava manual (a B nao e manual)', 'erro',
  $$update public.posicoes_atuais set origem = 'manual'
     where usuario_id = '00000000-0000-0000-0000-0000000070c1'$$);

-- =============================================================================
-- GRUPO G — quem não tem turma
-- =============================================================================
-- fn_modo_posicao_minha_turma() cai em 'gps' (coalesce): o comportamento de
-- antes da migration.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070d1';  -- sem turma

select public.t7_ok('G', 'sem turma o modo e gps', 'gps',
  public.fn_modo_posicao_minha_turma());

select public.t7_tentar('G', 'sem turma, gps com turma_id nulo passa', 'passou',
  $$insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude, origem)
    values ('00000000-0000-0000-0000-0000000070d1', null, -26.00, -51.00, 'gps')$$);

select public.t7_tentar('G', 'sem turma, manual e recusado', 'erro',
  $$update public.posicoes_atuais set origem = 'manual'
     where usuario_id = '00000000-0000-0000-0000-0000000070d1'$$);

-- O relatório abaixo lê t7_resultados, que não tem grant para `authenticated`.
set role postgres;
reset request.jwt.claim.sub;

-- =============================================================================
-- RELATÓRIO
-- =============================================================================
\pset format aligned
\echo ''
\echo '=== 07_teste_modo_posicao: modo da turma e origem da posicao ==='
select grupo, descricao, esperado, obtido, case when ok then 'OK' else '** FALHOU **' end as r
from public.t7_resultados order by n;

select count(*) filter (where ok) as passaram,
       count(*) filter (where not ok) as falharam,
       count(*) as total
from public.t7_resultados;
