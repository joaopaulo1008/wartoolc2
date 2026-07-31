-- =============================================================================
-- Teste da Etapa 4.5 — partidos, hostilidade relativa e fn_usuarios_visiveis()
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001 + 0002 + 0003
-- aplicados nesta ordem. NÃO rodar no Supabase de produção: cria massa de
-- teste e mexe em auth.users.
--
-- Vale manter este arquivo vivo: quando a Etapa 6.5 trocar o corpo de
-- fn_usuarios_visiveis() pela árvore ORBAT, é este teste que diz se as
-- policies continuam valendo o que valiam — que é a promessa da etapa.
--
-- Uso:  psql -f 00_stub_supabase.sql -f 0001 -f 0002 -f 0003 -f 01_teste_partidos.sql
-- =============================================================================

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

-- ── Infra do teste ──────────────────────────────────────────────────────────
drop table if exists public.t_resultados;
create table public.t_resultados (
  n serial primary key, grupo text, descricao text, esperado text,
  obtido text, ok boolean
);

-- SECURITY DEFINER para conseguir gravar o resultado mesmo enquanto o teste
-- está rodando com `set role authenticated`.
create or replace function public.t_ok(p_grupo text, p_desc text, p_esperado text, p_obtido text)
returns void language plpgsql security definer as $$
begin
  insert into public.t_resultados (grupo, descricao, esperado, obtido, ok)
  values (p_grupo, p_desc, p_esperado, p_obtido,
          p_esperado is not distinct from p_obtido);
end $$;

-- Executa um SQL que DEVE falhar e registra a SQLSTATE obtida.
create or replace function public.t_deve_falhar(p_grupo text, p_desc text, p_sql text)
returns void language plpgsql security definer as $$
declare v_estado text;
begin
  begin
    execute p_sql;
    v_estado := 'NAO FALHOU';
  exception when others then
    v_estado := 'erro ' || sqlstate;
  end;
  insert into public.t_resultados (grupo, descricao, esperado, obtido, ok)
  values (p_grupo, p_desc, 'bloqueado', v_estado, v_estado <> 'NAO FALHOU');
end $$;

grant execute on function public.t_ok(text,text,text,text)   to authenticated;
grant execute on function public.t_deve_falhar(text,text,text) to authenticated;

-- t_deve_falhar roda o SQL com os privilégios do DONO (security definer), o
-- que ignoraria a RLS. Para os testes de escrita bloqueada usamos, em vez
-- dela, blocos DO anônimos rodando já sob `set role authenticated`.
create or replace function public.t_registrar(p_grupo text, p_desc text, p_esperado text, p_obtido text)
returns void language plpgsql security definer as $$
begin
  insert into public.t_resultados (grupo, descricao, esperado, obtido, ok)
  values (p_grupo, p_desc, p_esperado, p_obtido, p_esperado is not distinct from p_obtido);
end $$;
grant execute on function public.t_registrar(text,text,text,text) to authenticated;

-- Tentativa de gravar partido num perfil, registrando se foi bloqueada.
-- Deliberadamente SEM security definer: precisa rodar com os privilégios de
-- quem chama, senão a RLS de `perfis` seria ignorada e o teste não valeria.
create or replace function public.t_tentar_partido(
  p_grupo text, p_desc text, p_esperado text, p_perfil uuid, p_partido uuid)
returns void language plpgsql as $$
declare v text;
begin
  begin
    update public.perfis set partido_id = p_partido where id = p_perfil;
    v := 'NAO FALHOU';
  exception when others then v := 'erro ' || sqlstate;
  end;
  perform public.t_registrar(p_grupo, p_desc, p_esperado, v);
end $$;
grant execute on function public.t_tentar_partido(text,text,text,uuid,uuid) to authenticated;

-- ── MASSA DE TESTE ─────────────────────────────────────────────────────────
-- Turma A "5BDA-2026" com DOIS partidos (Azul e Vermelho, criados
-- automaticamente pelo trigger de 0003) e um aluno ainda sem partido.
-- Turma B "OUTRA-2026" existe só para provar que nada atravessa turma.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a0', 'inst@wartool.local'),   -- instrutor turma A
  ('00000000-0000-0000-0000-0000000000a1', 'azul1@wartool.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'azul2@wartool.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'verm1@wartool.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'verm2@wartool.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'semp@wartool.local'),   -- sem partido
  ('00000000-0000-0000-0000-0000000000d0', 'inst2@wartool.local'),  -- instrutor turma B
  ('00000000-0000-0000-0000-0000000000d1', 'outro@wartool.local');  -- aluno turma B

insert into public.turmas (id, nome, codigo_acesso, instrutor_id) values
  ('00000000-0000-0000-0000-0000000000fa', 'Turma A', '5BDA-2026',
   '00000000-0000-0000-0000-0000000000a0'),
  ('00000000-0000-0000-0000-0000000000fb', 'Turma B', 'OUTRA-2026',
   '00000000-0000-0000-0000-0000000000d0');

update public.perfis set papel = 'instrutor', turma_id = '00000000-0000-0000-0000-0000000000fa'
  where id = '00000000-0000-0000-0000-0000000000a0';
update public.perfis set papel = 'instrutor', turma_id = '00000000-0000-0000-0000-0000000000fb'
  where id = '00000000-0000-0000-0000-0000000000d0';

update public.perfis p set
  turma_id   = '00000000-0000-0000-0000-0000000000fa',
  partido_id = (select id from public.partidos
                where turma_id = '00000000-0000-0000-0000-0000000000fa' and nome = 'Azul')
where p.id in ('00000000-0000-0000-0000-0000000000a1',
               '00000000-0000-0000-0000-0000000000a2');

update public.perfis p set
  turma_id   = '00000000-0000-0000-0000-0000000000fa',
  partido_id = (select id from public.partidos
                where turma_id = '00000000-0000-0000-0000-0000000000fa' and nome = 'Vermelho')
where p.id in ('00000000-0000-0000-0000-0000000000b1',
               '00000000-0000-0000-0000-0000000000b2');

-- Aluno da turma A que ainda não foi distribuído numa força.
update public.perfis set turma_id = '00000000-0000-0000-0000-0000000000fa'
  where id = '00000000-0000-0000-0000-0000000000c1';
update public.perfis set turma_id = '00000000-0000-0000-0000-0000000000fb'
  where id = '00000000-0000-0000-0000-0000000000d1';

-- Posição de todo mundo (o trigger de 0001 replica para posicoes_historico).
insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude)
select p.id, p.turma_id, -22.0 + random()/100, -47.0 + random()/100
from public.perfis p where p.turma_id is not null;

-- Os ids dos partidos são gerados pelo trigger, então são capturados aqui,
-- ainda como superusuário, em variáveis do psql. Buscá-los DENTRO de um teste
-- com `set role authenticated` daria nulo em silêncio (a RLS de `partidos` não
-- deixa o instrutor da turma A enxergar os partidos da turma B) — e um nulo
-- silencioso faria o teste "usar partido de outra turma" passar por engano.
select
  (select id from public.partidos
    where turma_id='00000000-0000-0000-0000-0000000000fa' and nome='Azul')     as p_azul_a,
  (select id from public.partidos
    where turma_id='00000000-0000-0000-0000-0000000000fa' and nome='Vermelho') as p_verm_a,
  (select id from public.partidos
    where turma_id='00000000-0000-0000-0000-0000000000fb' and nome='Azul')     as p_azul_b
\gset

-- =============================================================================
-- GRUPO A — um usuário do Azul não enxerga posições do Vermelho
-- =============================================================================
set role authenticated;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';  -- azul1
select public.t_ok('A', 'azul1 (Azul) enxerga posicoes de: ',
  'azul1,azul2',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.posicoes_atuais pa join auth.users u on u.id = pa.usuario_id));

select public.t_ok('A', 'azul1 ve ALGUMA posicao do Vermelho?',
  '0',
  (select count(*)::text from public.posicoes_atuais pa
   join auth.users u on u.id = pa.usuario_id where u.email like 'verm%'));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';  -- verm1
select public.t_ok('A', 'verm1 (Vermelho) enxerga posicoes de: ',
  'verm1,verm2',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.posicoes_atuais pa join auth.users u on u.id = pa.usuario_id));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';  -- sem partido
select public.t_ok('A', 'aluno SEM partido enxerga posicoes de: ',
  'semp',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.posicoes_atuais pa join auth.users u on u.id = pa.usuario_id));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a0';  -- instrutor A
select public.t_ok('A', 'INSTRUTOR enxerga posicoes de (turma A inteira, 2 partidos):',
  'azul1,azul2,inst,semp,verm1,verm2',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.posicoes_atuais pa join auth.users u on u.id = pa.usuario_id));

select public.t_ok('A', 'instrutor A ve alguem da TURMA B?',
  '0',
  (select count(*)::text from public.posicoes_atuais pa
   join auth.users u on u.id = pa.usuario_id where u.email like 'outro%'));

-- =============================================================================
-- GRUPO B — fn_usuarios_visiveis() é a fonte da resposta acima
-- =============================================================================
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.t_ok('B', 'fn_usuarios_visiveis() para azul1',
  'azul1,azul2',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.fn_usuarios_visiveis() v join auth.users u on u.id = v));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a0';
select public.t_ok('B', 'fn_usuarios_visiveis() para o instrutor',
  'azul1,azul2,inst,semp,verm1,verm2',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.fn_usuarios_visiveis() v join auth.users u on u.id = v));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d0';
select public.t_ok('B', 'fn_usuarios_visiveis() para o instrutor da turma B',
  'inst2,outro',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.fn_usuarios_visiveis() v join auth.users u on u.id = v));

-- =============================================================================
-- GRUPO C — marcações guardam PARTIDO, não hostilidade
-- =============================================================================
-- Duas marcações do MESMO elemento (um pelotão do Vermelho):
--   * azul1 relata "elemento do Vermelho em X"  -> para ele, inimigo
--   * verm1 relata "meu pelotão em X"           -> para ele, força própria
-- O banco guarda o MESMO fato nas duas: partido_id = Vermelho. Quem transforma
-- isso em hostilidade é o cliente, em função de quem olha (simbolos.js).

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
insert into public.elementos_marcados (id, turma_id, autor_id, latitude, longitude, partido_id, titulo)
values ('00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000fa',
        '00000000-0000-0000-0000-0000000000a1', -22.1, -47.1,
        (select id from public.partidos where turma_id='00000000-0000-0000-0000-0000000000fa' and nome='Vermelho'),
        'Pel Bld avistado');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into public.elementos_marcados (id, turma_id, autor_id, latitude, longitude, partido_id, titulo)
values ('00000000-0000-0000-0000-0000000000e2',
        '00000000-0000-0000-0000-0000000000fa',
        '00000000-0000-0000-0000-0000000000b1', -22.1, -47.1,
        (select id from public.partidos where turma_id='00000000-0000-0000-0000-0000000000fa' and nome='Vermelho'),
        'Meu Pel Bld');

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.t_ok('C', 'azul1 le marcacoes (so as do proprio lado)',
  'Pel Bld avistado',
  (select string_agg(titulo, ',' order by titulo) from public.elementos_marcados));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select public.t_ok('C', 'verm1 le marcacoes (so as do proprio lado)',
  'Meu Pel Bld',
  (select string_agg(titulo, ',' order by titulo) from public.elementos_marcados));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a0';
select public.t_ok('C', 'instrutor le as duas marcacoes',
  'Meu Pel Bld,Pel Bld avistado',
  (select string_agg(titulo, ',' order by titulo) from public.elementos_marcados));

select public.t_ok('C', 'as duas marcacoes guardam o MESMO partido (Vermelho)',
  'Vermelho|1',
  (select string_agg(distinct pt.nome, ',') || '|' || count(distinct pt.id)::text
   from public.elementos_marcados em join public.partidos pt on pt.id = em.partido_id));

select public.t_ok('C', 'nenhuma coluna de hostilidade absoluta sobrou',
  '0',
  (select count(*)::text from information_schema.columns
   where table_schema='public' and table_name='elementos_marcados'
     and column_name like 'hostilidade%'));

-- =============================================================================
-- GRUPO D — o instrutor corrige o partido de quem estiver errado
-- =============================================================================
reset role; set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a0';  -- instrutor A

update public.perfis set partido_id =
  (select id from public.partidos where turma_id='00000000-0000-0000-0000-0000000000fa' and nome='Azul')
where id = '00000000-0000-0000-0000-0000000000c1';

select public.t_ok('D', 'instrutor colocou o aluno sem partido no Azul',
  'Azul',
  (select pt.nome from public.perfis p join public.partidos pt on pt.id = p.partido_id
   where p.id = '00000000-0000-0000-0000-0000000000c1'));

-- Instrutor move alguém do Vermelho para o Azul (correção de erro de cadastro).
update public.perfis set partido_id =
  (select id from public.partidos where turma_id='00000000-0000-0000-0000-0000000000fa' and nome='Azul')
where id = '00000000-0000-0000-0000-0000000000b2';

select public.t_ok('D', 'instrutor moveu verm2 do Vermelho para o Azul',
  'Azul',
  (select pt.nome from public.perfis p join public.partidos pt on pt.id = p.partido_id
   where p.id = '00000000-0000-0000-0000-0000000000b2'));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';  -- azul1
select public.t_ok('D', 'a correcao aparece na hora para o Azul',
  'azul1,azul2,semp,verm2',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.posicoes_atuais pa join auth.users u on u.id = pa.usuario_id));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';  -- verm1
select public.t_ok('D', 'e o Vermelho perde de vista quem saiu',
  'verm1',
  (select string_agg(split_part(u.email,'@',1), ',' order by u.email)
   from public.posicoes_atuais pa join auth.users u on u.id = pa.usuario_id));

-- Instrutor NÃO pode usar um partido de outra turma (id capturado lá em cima
-- como superusuário — de dentro daqui a RLS o esconderia e daria nulo).
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a0';
select public.t_tentar_partido('D', 'instrutor usando partido de OUTRA turma', 'erro 23514',
  '00000000-0000-0000-0000-0000000000a1', :'p_azul_b');

-- Instrutor da turma B não mexe em aluno da turma A.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d0';
update public.perfis set partido_id = null where id = '00000000-0000-0000-0000-0000000000a1';
-- A conferência é sobre o ESTADO DO BANCO, então roda como superusuário: se
-- fosse feita ainda como inst2, ela devolveria vazio só porque a RLS de
-- `perfis` não deixa ele enxergar aluno de outra turma — e um "vazio" seria
-- lido como "o partido foi apagado", acusando um furo que não existe.
reset role;
select public.t_ok('D', 'instrutor da turma B zerando o partido de aluno da turma A',
  'Azul',
  (select pt.nome from public.perfis p join public.partidos pt on pt.id = p.partido_id
   where p.id = '00000000-0000-0000-0000-0000000000a1'));

-- =============================================================================
-- GRUPO E — as policies antigas NÃO foram afrouxadas
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';  -- verm1 (aluno)

do $$
declare v text;
begin
  begin
    update public.perfis set partido_id =
      (select id from public.partidos where turma_id='00000000-0000-0000-0000-0000000000fa' and nome='Azul')
    where id = '00000000-0000-0000-0000-0000000000b1';
    v := 'NAO FALHOU';
  exception when others then v := 'erro ' || sqlstate;
  end;
  perform public.t_registrar('E', 'aluno trocando o PROPRIO partido (viraria espiao)', 'erro 42501', v);

  begin
    update public.perfis set papel = 'instrutor' where id = '00000000-0000-0000-0000-0000000000b1';
    v := 'NAO FALHOU';
  exception when others then v := 'erro ' || sqlstate;
  end;
  perform public.t_registrar('E', 'aluno se autopromovendo a instrutor (regressao 0002)', 'erro 42501', v);

  begin
    update public.perfis set turma_id = '00000000-0000-0000-0000-0000000000fb'
    where id = '00000000-0000-0000-0000-0000000000b1';
    v := 'NAO FALHOU';
  exception when others then v := 'erro ' || sqlstate;
  end;
  perform public.t_registrar('E', 'aluno trocando de turma sem a RPC (regressao 0002)', 'erro 42501', v);

  begin
    insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude)
    values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000fb',0,0)
    on conflict (usuario_id) do update set turma_id = excluded.turma_id;
    v := 'NAO FALHOU';
  exception when others then v := 'erro ' || sqlstate;
  end;
  perform public.t_registrar('E', 'aluno injetando posicao em outra turma (regressao 0002)', 'erro 42501', v);

  begin
    insert into public.posicoes_historico (usuario_id, turma_id, latitude, longitude)
    values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000fa',0,0);
    v := 'NAO FALHOU';
  exception when others then v := 'erro ' || sqlstate;
  end;
  perform public.t_registrar('E', 'aluno reescrevendo o proprio rastro (regressao 0002)', 'erro 42501', v);
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';  -- azul1
select public.t_ok('E', 'aluno lendo o historico de um COLEGA DO MESMO partido',
  '0',
  (select count(*)::text from public.posicoes_historico
   where usuario_id = '00000000-0000-0000-0000-0000000000a2'));

select public.t_ok('E', 'aluno lendo o proprio historico (tem de continuar podendo)',
  'sim',
  (select case when count(*) > 0 then 'sim' else 'nao' end from public.posicoes_historico
   where usuario_id = '00000000-0000-0000-0000-0000000000a1'));

delete from public.posicoes_atuais where usuario_id = '00000000-0000-0000-0000-0000000000a2';
select public.t_ok('E', 'aluno apagando a posicao de um colega (regressao 0002)',
  'sim',
  (select case when count(*) > 0 then 'sim' else 'nao' end from public.posicoes_atuais
   where usuario_id = '00000000-0000-0000-0000-0000000000a2'));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a0';  -- instrutor A
select public.t_ok('E', 'instrutor lendo o historico da turma (tem de continuar podendo)',
  'sim',
  (select case when count(distinct usuario_id) >= 4 then 'sim' else 'nao' end
   from public.posicoes_historico));

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';  -- outro (turma B)
select public.t_ok('E', 'usuario de OUTRA turma vendo posicoes da turma A',
  '0',
  (select count(*)::text from public.posicoes_atuais
   where turma_id = '00000000-0000-0000-0000-0000000000fa'));
select public.t_ok('E', 'usuario de OUTRA turma vendo marcacoes da turma A',
  '0', (select count(*)::text from public.elementos_marcados));
select public.t_ok('E', 'usuario de OUTRA turma vendo perfis da turma A',
  '0',
  (select count(*)::text from public.perfis where turma_id = '00000000-0000-0000-0000-0000000000fa'));
select public.t_ok('E', 'usuario de OUTRA turma vendo os partidos da turma A',
  '0',
  (select count(*)::text from public.partidos where turma_id = '00000000-0000-0000-0000-0000000000fa'));

-- Preferências de visualização são do próprio dono (FILTRO, não permissão).
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
update public.perfis set preferencias_visualizacao = '{"esconder_neutros": true}'::jsonb
  where id = '00000000-0000-0000-0000-0000000000a1';
select public.t_ok('E', 'usuario salvando as PROPRIAS preferencias de visualizacao',
  'true',
  (select (preferencias_visualizacao->>'esconder_neutros') from public.perfis
   where id = '00000000-0000-0000-0000-0000000000a1'));

-- =============================================================================
-- GRUPO F — estrutura: renomeação, Realtime, índices
-- =============================================================================
reset role;

select public.t_ok('F', 'tabela marcacoes_inimigas ainda existe?',
  'nao', (select case when to_regclass('public.marcacoes_inimigas') is null then 'nao' else 'sim' end));
select public.t_ok('F', 'tabela elementos_marcados existe?',
  'sim', (select case when to_regclass('public.elementos_marcados') is null then 'nao' else 'sim' end));
select public.t_ok('F', 'elementos_marcados publicada no supabase_realtime',
  'sim', (select case when exists (select 1 from pg_publication_tables
          where pubname='supabase_realtime' and tablename='elementos_marcados')
          then 'sim' else 'nao' end));
select public.t_ok('F', 'partidos publicada no supabase_realtime',
  'sim', (select case when exists (select 1 from pg_publication_tables
          where pubname='supabase_realtime' and tablename='partidos')
          then 'sim' else 'nao' end));
select public.t_ok('F', 'replica identity FULL em elementos_marcados',
  'f', (select relreplident::text from pg_class where oid = 'public.elementos_marcados'::regclass));
select public.t_ok('F', 'sobrou constraint/indice com o nome antigo?',
  '0',
  ((select count(*) from pg_constraint where conrelid='public.elementos_marcados'::regclass
      and conname like '%marcacoes_inimigas%')
   +(select count(*) from pg_indexes where tablename='elementos_marcados'
      and indexname like '%marcacoes_inimigas%'))::text);
select public.t_ok('F', 'policies antigas (marcacoes_*) removidas',
  '0', (select count(*)::text from pg_policies
        where tablename='elementos_marcados' and policyname like 'marcacoes_%'));
select public.t_ok('F', 'RLS ligada em partidos',
  'sim', (select case when relrowsecurity then 'sim' else 'nao' end
          from pg_class where oid='public.partidos'::regclass));
select public.t_ok('F', 'toda turma nasce com Azul e Vermelho',
  'Azul,Vermelho|Azul,Vermelho',
  (select string_agg(x.p, '|') from (
     select string_agg(nome, ',' order by nome) as p
     from public.partidos group by turma_id order by min(turma_id::text)) x));

-- =============================================================================
-- RESULTADO
-- =============================================================================
\set QUIET off
\echo ''
\echo '================== RESULTADO DOS TESTES DA ETAPA 4.5 =================='
select grupo, descricao, esperado, obtido,
       case when ok then 'PASSOU' else '** FALHOU **' end as resultado
from public.t_resultados order by n;

select count(*) filter (where ok)            as passou,
       count(*) filter (where not ok)        as falhou,
       count(*)                              as total
from public.t_resultados;
