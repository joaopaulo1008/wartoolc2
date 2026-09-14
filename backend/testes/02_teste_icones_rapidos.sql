-- =============================================================================
-- Teste da 0010 — paleta de ícones rápidos (icones_rapidos)
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001..0010 aplicados
-- nesta ordem. NÃO rodar no Supabase de produção: cria massa de teste e mexe
-- em auth.users.
--
-- Uso:
--   psql -f 00_stub_supabase.sql -f 0001..0010 -f 02_teste_icones_rapidos.sql
--
-- O que este arquivo trava, e por que cada coisa merece um teste:
--
--   A. A PALETA PADRÃO NASCE COM A TURMA, com o partido Vermelho já
--      resolvido. Isto é o teste que justifica o `z_` no nome do trigger: o
--      Postgres dispara triggers de mesmo timing em ordem ALFABÉTICA, e se
--      alguém "arrumar" o nome para trg_turmas_icones_rapidos_padrao ele passa
--      a rodar ANTES de trg_turmas_partidos_padrao (0003) e a paleta nasce com
--      partido nulo — sem erro nenhum, só com todos os presets pedindo partido
--      para sempre. É a classe de falha silenciosa que este projeto persegue.
--
--   B. O TETO DE 12 recusa o 13º preset em vez de aceitar e degradar.
--
--   C. OS CHECKS de formato (SIDC de 20 dígitos, rótulo de 1 a 14 caracteres)
--      barram no BANCO, não só no navegador. O cliente também valida, mas o
--      cliente é conveniência; a barreira é aqui.
--
--   D. A RLS: a turma inteira LÊ a paleta (os dois partidos — ela não é dado
--      de exercício, é ferramenta de trabalho), só o instrutor da turma
--      ESCREVE, e nada atravessa de uma turma para outra.
-- =============================================================================

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

drop table if exists public.t_ir_resultados;
create table public.t_ir_resultados (
  n serial primary key, grupo text, descricao text, esperado text,
  obtido text, ok boolean
);

-- SECURITY DEFINER para conseguir gravar o resultado mesmo enquanto o teste
-- roda com `set role authenticated` (mesmo padrão de 01_teste_partidos.sql).
create or replace function public.t_ir(p_grupo text, p_desc text, p_esperado text, p_obtido text)
returns void language plpgsql security definer as $$
begin
  insert into public.t_ir_resultados (grupo, descricao, esperado, obtido, ok)
  values (p_grupo, p_desc, p_esperado, p_obtido, p_esperado is not distinct from p_obtido);
end $$;
grant execute on function public.t_ir(text,text,text,text) to authenticated;

-- Tenta um comando e registra se foi bloqueado. DELIBERADAMENTE SEM security
-- definer: precisa rodar com os privilégios de QUEM CHAMA, senão a RLS seria
-- ignorada e o teste de escrita bloqueada passaria por engano (mesma armadilha
-- já documentada em 01_teste_partidos.sql).
--
-- ARMADILHA QUE ESTE TESTE JÁ CAIU UMA VEZ: a RLS bloqueia INSERT e UPDATE de
-- formas DIFERENTES. Um insert que viola o `with check` levanta exceção; um
-- update cuja linha não passa no `using` não levanta nada — ele simplesmente
-- não encontra linha nenhuma para atualizar e informa 0 linhas afetadas. Quem
-- só olhar a exceção conclui que o update passou. Por isso a contagem de
-- linhas afetadas entra no veredito: "bloqueado" é exceção OU zero linhas.
create or replace function public.t_ir_tentar(p_grupo text, p_desc text, p_sql text)
returns void language plpgsql as $$
declare v text; n integer;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
    v := case when n = 0 then 'bloqueado' else 'NAO FALHOU' end;
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir(p_grupo, p_desc, 'bloqueado', v);
end $$;
grant execute on function public.t_ir_tentar(text,text,text) to authenticated;

-- ── MASSA DE TESTE ─────────────────────────────────────────────────────────
-- Turma A com instrutor, um aluno do Azul e um do Vermelho. Turma B existe só
-- para provar que nada atravessa turma.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ea10', 'irinst@wartool.local'),
  ('00000000-0000-0000-0000-00000000ea11', 'irazul@wartool.local'),
  ('00000000-0000-0000-0000-00000000ea12', 'irverm@wartool.local'),
  ('00000000-0000-0000-0000-00000000eb10', 'irinst2@wartool.local');

insert into public.turmas (id, nome, codigo_acesso, instrutor_id) values
  ('00000000-0000-0000-0000-00000000efa0', 'Turma IR A', 'IRA-2026',
   '00000000-0000-0000-0000-00000000ea10'),
  ('00000000-0000-0000-0000-00000000efb0', 'Turma IR B', 'IRB-2026',
   '00000000-0000-0000-0000-00000000eb10');

update public.perfis set papel='instrutor', turma_id='00000000-0000-0000-0000-00000000efa0'
  where id='00000000-0000-0000-0000-00000000ea10';
update public.perfis set papel='instrutor', turma_id='00000000-0000-0000-0000-00000000efb0'
  where id='00000000-0000-0000-0000-00000000eb10';
update public.perfis p set turma_id='00000000-0000-0000-0000-00000000efa0',
  partido_id=(select id from public.partidos
              where turma_id='00000000-0000-0000-0000-00000000efa0' and nome='Azul')
  where p.id='00000000-0000-0000-0000-00000000ea11';
update public.perfis p set turma_id='00000000-0000-0000-0000-00000000efa0',
  partido_id=(select id from public.partidos
              where turma_id='00000000-0000-0000-0000-00000000efa0' and nome='Vermelho')
  where p.id='00000000-0000-0000-0000-00000000ea12';

-- =============================================================================
-- GRUPO A — paleta padrão, e a ordem dos triggers em turmas
-- =============================================================================
select public.t_ir('A', 'turma nova nasce com 8 presets',
  '8', (select count(*)::text from public.icones_rapidos
        where turma_id='00000000-0000-0000-0000-00000000efa0'));

-- O teste que protege o `z_` do nome do trigger: se ele rodasse antes de
-- trg_turmas_partidos_padrao, TODOS os presets teriam partido nulo.
select public.t_ir('A', 'os 7 presets de combate ja vem com o Vermelho resolvido',
  '7', (select count(*)::text from public.icones_rapidos i
        join public.partidos p on p.id = i.partido_padrao_id
        where i.turma_id='00000000-0000-0000-0000-00000000efa0' and p.nome='Vermelho'));

select public.t_ir('A', 'o preset "Vtr" nasce SEM partido (modo perguntar)',
  '1', (select count(*)::text from public.icones_rapidos
        where turma_id='00000000-0000-0000-0000-00000000efa0'
          and rotulo='Vtr' and partido_padrao_id is null));

select public.t_ir('A', 'todo SIDC padrao tem 20 digitos',
  '0', (select count(*)::text from public.icones_rapidos
        where sidc !~ '^[0-9]{20}$'));

-- O partido apontado tem que ser o da PRÓPRIA turma — um preset da turma A
-- apontando para o Vermelho da turma B criaria marcação com partido de outra
-- turma, e a hostilidade relativa passaria a derivar de um par impossível.
select public.t_ir('A', 'nenhum preset aponta para partido de outra turma',
  '0', (select count(*)::text from public.icones_rapidos i
        join public.partidos p on p.id = i.partido_padrao_id
        where p.turma_id <> i.turma_id));

-- =============================================================================
-- GRUPO B — teto de 12
-- =============================================================================
-- A turma A já tem 8. Mais 4 cabem; o 13º tem que ser recusado.
insert into public.icones_rapidos (turma_id, rotulo, sidc, ordem)
select '00000000-0000-0000-0000-00000000efa0', 'X'||g, '10011000001211000000', 200+g
from generate_series(1,4) g;

select public.t_ir('B', 'chegou a 12 sem reclamar',
  '12', (select count(*)::text from public.icones_rapidos
         where turma_id='00000000-0000-0000-0000-00000000efa0' and removido_em is null));

do $$
declare v text;
begin
  begin
    insert into public.icones_rapidos (turma_id, rotulo, sidc)
    values ('00000000-0000-0000-0000-00000000efa0', 'X13', '10011000001211000000');
    v := 'NAO FALHOU';
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir('B', 'o 13o preset e recusado', 'bloqueado', v);
end $$;

-- Remover um (exclusão lógica) abre vaga — o teto conta só o que está vigente.
update public.icones_rapidos set removido_em = now()
  where turma_id='00000000-0000-0000-0000-00000000efa0' and rotulo='X4';

do $$
declare v text;
begin
  begin
    insert into public.icones_rapidos (turma_id, rotulo, sidc)
    values ('00000000-0000-0000-0000-00000000efa0', 'X13', '10011000001211000000');
    v := 'entrou';
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir('B', 'remover um abre vaga para outro', 'entrou', v);
end $$;

-- E editar um preset existente numa paleta cheia não pode ser barrado pelo
-- teto: o trigger é BEFORE UPDATE também, e conta excluindo a própria linha.
do $$
declare v text;
begin
  begin
    update public.icones_rapidos set rotulo = 'CC II'
      where turma_id='00000000-0000-0000-0000-00000000efa0' and rotulo='CC';
    v := 'editou';
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir('B', 'editar preset com a paleta cheia continua possivel', 'editou', v);
end $$;

-- =============================================================================
-- GRUPO C — checks de formato
-- =============================================================================
do $$
declare v text;
begin
  begin
    insert into public.icones_rapidos (turma_id, rotulo, sidc)
    values ('00000000-0000-0000-0000-00000000efb0', 'Curto', '1001100000121100');
    v := 'NAO FALHOU';
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir('C', 'SIDC de 16 digitos e recusado', 'bloqueado', v);
end $$;

do $$
declare v text;
begin
  begin
    insert into public.icones_rapidos (turma_id, rotulo, sidc)
    values ('00000000-0000-0000-0000-00000000efb0', 'Letra', '1001100000121100000X');
    v := 'NAO FALHOU';
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir('C', 'SIDC com letra e recusado', 'bloqueado', v);
end $$;

do $$
declare v text;
begin
  begin
    insert into public.icones_rapidos (turma_id, rotulo, sidc)
    values ('00000000-0000-0000-0000-00000000efb0',
            'rotulo absurdamente longo', '10011000001211000000');
    v := 'NAO FALHOU';
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir('C', 'rotulo com mais de 14 caracteres e recusado', 'bloqueado', v);
end $$;

do $$
declare v text;
begin
  begin
    insert into public.icones_rapidos (turma_id, rotulo, sidc)
    values ('00000000-0000-0000-0000-00000000efb0', '   ', '10011000001211000000');
    v := 'NAO FALHOU';
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir('C', 'rotulo so de espacos e recusado', 'bloqueado', v);
end $$;

-- =============================================================================
-- GRUPO D — RLS
-- =============================================================================
set role authenticated;

-- O ALUNO DO AZUL lê a paleta inteira da própria turma. Ao contrário de
-- calcos_ler, não há recorte por partido aqui — e é exatamente isso que este
-- teste trava, porque "copiar a policy de calcos" é o erro provável.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ea11';
select public.t_ir('D', 'aluno do Azul le a paleta da propria turma',
  '12', (select count(*)::text from public.icones_rapidos where removido_em is null));

select public.t_ir('D', 'aluno NAO enxerga paleta de outra turma',
  '0', (select count(*)::text from public.icones_rapidos
        where turma_id='00000000-0000-0000-0000-00000000efb0'));

select public.t_ir_tentar('D', 'aluno NAO cria preset',
  $q$insert into public.icones_rapidos (turma_id, rotulo, sidc, criado_por)
     values ('00000000-0000-0000-0000-00000000efa0','Pirata','10011000001211000000',
             '00000000-0000-0000-0000-00000000ea11')$q$);

select public.t_ir_tentar('D', 'aluno NAO edita preset existente',
  $q$update public.icones_rapidos set rotulo='Hackeado'
     where turma_id='00000000-0000-0000-0000-00000000efa0'$q$);

-- O ALUNO DO VERMELHO vê a MESMA paleta que o do Azul.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ea12';
select public.t_ir('D', 'aluno do Vermelho ve a MESMA paleta que o do Azul',
  '12', (select count(*)::text from public.icones_rapidos where removido_em is null));

-- O INSTRUTOR DA TURMA escreve.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000ea10';
select public.t_ir_tentar('D', 'instrutor da turma B NAO escreve na paleta da A',
  $q$insert into public.icones_rapidos (turma_id, rotulo, sidc, criado_por)
     values ('00000000-0000-0000-0000-00000000efb0','Invasor','10011000001211000000',
             '00000000-0000-0000-0000-00000000ea10')$q$);

do $$
declare v text;
begin
  begin
    update public.icones_rapidos set rotulo='Ordenado'
      where turma_id='00000000-0000-0000-0000-00000000efa0' and rotulo='Mrt';
    v := 'editou';
  exception when others then v := 'bloqueado';
  end;
  perform public.t_ir('D', 'instrutor da turma edita a propria paleta', 'editou', v);
end $$;

-- `criado_por` obrigado a ser quem escreve — sem isto um instrutor publicaria
-- em nome de outro e o painel mentiria sobre quem montou a paleta (mesmo
-- raciocínio de calcos_escrever, 0006).
select public.t_ir_tentar('D', 'instrutor NAO cria preset em nome de outro',
  $q$insert into public.icones_rapidos (turma_id, rotulo, sidc, criado_por)
     values ('00000000-0000-0000-0000-00000000efa0','Falso','10011000001211000000',
             '00000000-0000-0000-0000-00000000eb10')$q$);

reset role;

-- =============================================================================
-- GRUPO E — invariantes estruturais
-- =============================================================================
select public.t_ir('E', 'RLS ligada em icones_rapidos',
  'sim', (select case when relrowsecurity then 'sim' else 'nao' end
          from pg_class where oid='public.icones_rapidos'::regclass));

select public.t_ir('E', 'quatro policies (ler, criar, editar, remover)',
  '4', (select count(*)::text from pg_policies
        where tablename='icones_rapidos'));

-- Trava o bug apanhado na primeira execucao deste arquivo: com um `for all`
-- exigindo criado_por = auth.uid() no with check, o instrutor NAO conseguia
-- editar os presets da paleta PADRAO (criado_por nulo, porque o trigger os
-- criou). Ver o comentario da secao 3 da 0010.
select public.t_ir('E', 'a paleta padrao nasce com criado_por nulo',
  '8', (select count(*)::text from public.icones_rapidos
        where turma_id='00000000-0000-0000-0000-00000000efb0' and criado_por is null));

select public.t_ir('E', 'publicada no Realtime',
  '1', (select count(*)::text from pg_publication_tables
        where pubname='supabase_realtime' and tablename='icones_rapidos'));

select public.t_ir('E', 'replica identity full (o DELETE precisa dizer QUEM saiu)',
  'f', (select relreplident::text from pg_class
        where oid='public.icones_rapidos'::regclass));

-- =============================================================================
-- RESULTADO
-- =============================================================================
\set QUIET off
\echo ''
\echo '============ RESULTADO DOS TESTES DA 0010 (icones_rapidos) ============'
select grupo, descricao, esperado, obtido,
       case when ok then 'PASSOU' else '** FALHOU **' end as resultado
from public.t_ir_resultados order by n;

select count(*) filter (where ok)     as passou,
       count(*) filter (where not ok) as falhou,
       count(*)                       as total
from public.t_ir_resultados;
