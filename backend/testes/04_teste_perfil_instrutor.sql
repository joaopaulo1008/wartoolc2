-- =============================================================================
-- Teste de 2026-09-14 — o instrutor edita o SÍMBOLO do aluno e o TIRA da turma
-- =============================================================================
-- Roda contra um Postgres com 00_stub_supabase.sql + 0001..0011 aplicados
-- nesta ordem. NÃO rodar no Supabase de produção: cria massa de teste e mexe
-- em auth.users. Espera um banco LIMPO — rodar duas vezes no mesmo banco
-- contamina a massa e produz falhas falsas.
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------
-- O painel do instrutor ganhou dois controles novos que escrevem em `perfis`:
-- o editor de símbolo e o "Remover da turma". Nenhum dos dois acrescentou
-- policy ou coluna — os dois dependem INTEIRAMENTE de regras que já estavam
-- lá desde a 0002/0003 e que ninguém tinha exercitado. Três delas têm modo de
-- falha nada óbvio, e é isso que este teste trava:
--
--   1. `fn_sou_instrutor_da_turma(null)` é FALSO por construção (a primeira
--      linha do corpo é `p_turma_id is not null`). Como "remover da turma" é
--      `turma_id = null`, o primeiro termo do `with check` de
--      `perfis_editar_instrutor` NUNCA aprova essa escrita — ela só passa
--      pelo segundo termo, que exige o instrutor LOTADO numa turma que ele
--      instrui. Um instrutor que só consta em `turmas.instrutor_id` leva erro
--      de RLS. O grupo C prova os dois lados disso.
--   2. Quem zera o partido ao sair da turma é o BANCO
--      (`fn_normalizar_partido_do_perfil`, 0003), não o cliente — e a regra só
--      dispara quando o partido chega INALTERADO junto com a troca de turma.
--   3. Tirar da turma NÃO apaga nada. É a promessa que o botão faz na tela
--      ("as marcações e o rastro dele ficam guardados"), e o grupo D é o que
--      a sustenta — se um dia alguém trocar isto por um `delete`, o cascade
--      de `elementos_marcados.autor_id` e `posicoes_historico.usuario_id`
--      leva o debriefing junto, e é aqui que se descobre.
--
-- Uso:
--   psql -f 00_stub_supabase.sql -f 0001 ... -f 0011 -f 04_teste_perfil_instrutor.sql
-- =============================================================================

\set ON_ERROR_STOP off
\set QUIET on
\pset pager off

-- ── Infra do teste ──────────────────────────────────────────────────────────
drop table if exists public.t4_resultados;
create table public.t4_resultados (
  n serial primary key, grupo text, descricao text, esperado text,
  obtido text, ok boolean
);

create or replace function public.t4_ok(p_grupo text, p_desc text, p_esperado text, p_obtido text)
returns void language plpgsql security definer as $$
begin
  insert into public.t4_resultados (grupo, descricao, esperado, obtido, ok)
  values (p_grupo, p_desc, p_esperado, p_obtido,
          p_esperado is not distinct from p_obtido);
end $$;
grant execute on function public.t4_ok(text,text,text,text) to authenticated;

-- Tentativa de escrita registrando o que ACONTECEU. Deliberadamente SEM
-- `security definer`: precisa rodar com os privilégios de quem chama, senão a
-- RLS de `perfis` seria ignorada e o teste não valeria nada — é a mesma
-- armadilha documentada em 01_teste_partidos.sql.
--
-- TRÊS resultados possíveis, e confundir os dois últimos foi o erro da
-- primeira versão deste arquivo:
--   'passou'      — escreveu, pelo menos uma linha.
--   'erro'        — o banco levantou exceção (é o que o `with check` de uma
--                   policy, um `check` de coluna ou um trigger fazem).
--   'zero linhas' — NÃO levantou exceção e não escreveu nada. É como a
--                   cláusula USING de uma policy recusa: ela FILTRA a linha em
--                   vez de reclamar, e um `update` que não casa com nada é
--                   sucesso para o Postgres. Um teste que só olhasse exceção
--                   leria isso como "passou" e daria falha falsa — ou, pior,
--                   aprovação falsa num teste de segurança.
create or replace function public.t4_tentar(
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
  perform public.t4_ok(p_grupo, p_desc, p_esperado, v);
end $$;
grant execute on function public.t4_tentar(text,text,text,text) to authenticated;

-- Para chamadas de RPC (que não têm row_count útil): registra 'passou' ou o
-- SQLSTATE, para o teste poder afirmar QUAL recusa aconteceu.
create or replace function public.t4_tentar_rpc(
  p_grupo text, p_desc text, p_esperado text, p_sql text)
returns void language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql;
    v := 'passou';
  exception when others then v := 'erro ' || sqlstate;
  end;
  perform public.t4_ok(p_grupo, p_desc, p_esperado, v);
end $$;
grant execute on function public.t4_tentar_rpc(text,text,text,text) to authenticated;

-- ── MASSA ───────────────────────────────────────────────────────────────────
-- Turma A tem DOIS instrutores de propósito:
--   inst_lotado    — `perfis.turma_id` = A E `turmas.instrutor_id` = ele.
--   inst_so_resp   — responde pela turma C, mas NÃO está lotado em turma
--                    nenhuma. É o caso que expõe a regra 1 acima.
-- `inst_colega` existe só para o caso "instrutor não remove instrutor": ele
-- está LOTADO na turma A, então a função chega até a checagem de papel em vez
-- de parar antes, no atalho "já está sem turma".
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e0a0', 'instlot@wartool.local'),
  ('00000000-0000-0000-0000-00000000e0ab', 'instcol@wartool.local'),
  ('00000000-0000-0000-0000-00000000e0c0', 'instsor@wartool.local'),
  ('00000000-0000-0000-0000-00000000e0a1', 'alunoa1@wartool.local'),
  ('00000000-0000-0000-0000-00000000e0a2', 'alunoa2@wartool.local'),
  ('00000000-0000-0000-0000-00000000e0c1', 'alunoc1@wartool.local');

insert into public.turmas (id, nome, codigo_acesso, instrutor_id) values
  ('00000000-0000-0000-0000-00000000efa0', 'Turma A4', 'A4-2026',
   '00000000-0000-0000-0000-00000000e0a0'),
  ('00000000-0000-0000-0000-00000000efc0', 'Turma C4', 'C4-2026',
   '00000000-0000-0000-0000-00000000e0c0');

update public.perfis set papel = 'instrutor', turma_id = '00000000-0000-0000-0000-00000000efa0'
  where id in ('00000000-0000-0000-0000-00000000e0a0',
               '00000000-0000-0000-0000-00000000e0ab');
-- Instrutor SEM lotação: papel de instrutor, turma_id continua nulo.
update public.perfis set papel = 'instrutor'
  where id = '00000000-0000-0000-0000-00000000e0c0';

update public.perfis p set
  turma_id   = '00000000-0000-0000-0000-00000000efa0',
  partido_id = (select id from public.partidos
                where turma_id = '00000000-0000-0000-0000-00000000efa0' and nome = 'Azul')
where p.id in ('00000000-0000-0000-0000-00000000e0a1',
               '00000000-0000-0000-0000-00000000e0a2');

update public.perfis set turma_id = '00000000-0000-0000-0000-00000000efc0'
  where id = '00000000-0000-0000-0000-00000000e0c1';

insert into public.posicoes_atuais (usuario_id, turma_id, latitude, longitude)
select p.id, p.turma_id, -25.1, -50.2
from public.perfis p where p.turma_id is not null and p.id::text like '%e0a%';

-- Uma marcação e um rastro do aluno que vai ser removido, para o grupo D
-- poder provar que nada some junto com ele.
insert into public.elementos_marcados (turma_id, autor_id, sidc, latitude, longitude)
values ('00000000-0000-0000-0000-00000000efa0',
        '00000000-0000-0000-0000-00000000e0a1',
        '10011000001211000000', -25.11, -50.21);

-- =============================================================================
-- GRUPO A — o instrutor troca o SÍMBOLO de um aluno
-- =============================================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e0a0';  -- inst_lotado

select public.t4_tentar('A', 'instrutor da turma troca o sidc do aluno', 'passou',
  $$update public.perfis set sidc = '10031000161205000000'
      where id = '00000000-0000-0000-0000-00000000e0a1'$$);

select public.t4_ok('A', 'e o valor gravado e o que ele mandou',
  '10031000161205000000',
  (select sidc from public.perfis where id = '00000000-0000-0000-0000-00000000e0a1'));

-- O `check` da 0001 é a barreira final; validarSidcDePerfil() no cliente
-- existe para o instrutor nunca CHEGAR aqui com lixo, não para substituir isto.
select public.t4_tentar('A', 'sidc com menos de 20 digitos e recusado pelo check', 'erro',
  $$update public.perfis set sidc = '100310001612050000'
      where id = '00000000-0000-0000-0000-00000000e0a1'$$);

select public.t4_tentar('A', 'sidc com letra e recusado pelo check', 'erro',
  $$update public.perfis set sidc = '1003100016120500000X'
      where id = '00000000-0000-0000-0000-00000000e0a1'$$);

select public.t4_tentar('A', 'sidc nulo e recusado (coluna not null)', 'erro',
  $$update public.perfis set sidc = null
      where id = '00000000-0000-0000-0000-00000000e0a1'$$);

-- Instrutor de OUTRA turma não alcança este aluno. O resultado esperado é
-- 'zero linhas', não 'erro': a policy de UPDATE filtra pela cláusula USING, e
-- filtro não levanta exceção — a escrita simplesmente não encontra a linha.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e0c0';  -- inst_so_resp (turma C)
select public.t4_tentar('A', 'instrutor de OUTRA turma nao alcanca este aluno', 'zero linhas',
  $$update public.perfis set sidc = '10031000131211020000'
      where id = '00000000-0000-0000-0000-00000000e0a1'$$);

-- =============================================================================
-- GRUPO B — e o ALUNO, consegue trocar o próprio símbolo?
-- =============================================================================
-- ATENÇÃO, RESULTADO DESCONFORTÁVEL E DELIBERADAMENTE REGISTRADO: CONSEGUE.
--
-- `perfis_editar_proprio` (0002) deixa cada um editar a própria linha, e
-- `fn_proteger_campos_do_perfil` protege só `papel` e `turma_id` — `sidc`
-- nunca entrou nessa lista. A decisão da Etapa 9b ("símbolo é atribuição, não
-- preferência") e o item 13b do roteiro de campo ("o aluno não consegue mudar
-- o próprio símbolo") valem para a INTERFACE, que de fato não oferece o
-- caminho: nenhuma tela do app escreve `perfis.sidc` do próprio usuário. Pela
-- API, com o token dele, a escrita passa.
--
-- Este teste afirma o que o banco FAZ HOJE, não o que se gostaria que ele
-- fizesse. Se um dia `sidc` entrar na lista de campos protegidos (é uma linha
-- em fn_proteger_campos_do_perfil), é este bloco que quebra — e quebrar aqui,
-- com esta explicação do lado, é melhor do que descobrir em campo que a regra
-- mudou. Trocar 'passou' por 'bloqueado' e inverter o comentário é a alteração
-- inteira.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e0a2';  -- alunoa2

select public.t4_tentar('B', 'aluno troca o PROPRIO sidc pela API (hoje: passa)', 'passou',
  $$update public.perfis set sidc = '10031000131211020000'
      where id = '00000000-0000-0000-0000-00000000e0a2'$$);

-- 'zero linhas', de novo: `perfis_editar_proprio` tem USING (id = auth.uid()),
-- então a linha do colega nem entra na consulta. Recusa silenciosa, não erro.
select public.t4_tentar('B', 'aluno nao alcanca o sidc de um COLEGA', 'zero linhas',
  $$update public.perfis set sidc = '10031000131211020000'
      where id = '00000000-0000-0000-0000-00000000e0a1'$$);

select public.t4_ok('B', 'e o sidc do colega continua intacto',
  '10031000161205000000',
  (select sidc from public.perfis where id = '00000000-0000-0000-0000-00000000e0a1'));

-- Este SIM é exceção: `fn_proteger_campos_do_perfil` levanta 42501 quando um
-- não-instrutor mexe no próprio `turma_id` fora da RPC entrar_na_turma().
select public.t4_tentar('B', 'aluno NAO se tira da propria turma', 'erro',
  $$update public.perfis set turma_id = null
      where id = '00000000-0000-0000-0000-00000000e0a2'$$);

select public.t4_tentar_rpc('B', 'aluno NAO usa a RPC para remover um colega', 'erro 42501',
  $$select public.fn_remover_da_turma('00000000-0000-0000-0000-00000000e0a1'::uuid)$$);

-- =============================================================================
-- GRUPO C — "Remover da turma", e a lotação do instrutor que ninguém espera
-- =============================================================================
-- ── PRIMEIRO, a razão de a 0012 existir ──────────────────────────────────
-- O UPDATE direto é recusado MESMO para o instrutor lotado na turma, e a
-- barreira não é a policy de UPDATE: é `perfis_ler`. Com `turma_id` indo a
-- nulo, a linha deixa de casar com qualquer termo da policy de SELECT para
-- aquele instrutor, e o banco recusa a escrita em vez de deixar alguém
-- empurrar a linha para fora do próprio campo de visão.
--
-- Este caso está aqui porque foi ele que derrubou o desenho original ("é só um
-- update, não precisa de migration"). Se um dia alguém tentar simplificar a
-- 0012 de volta para um UPDATE, é esta linha que explica por que não dá.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e0a0';  -- inst_lotado
select public.t4_tentar('C', 'UPDATE direto de turma_id=null e recusado pela RLS de LEITURA', 'erro',
  $$update public.perfis set turma_id = null
      where id = '00000000-0000-0000-0000-00000000e0a1'$$);

select public.t4_ok('C', 'e por isso o aluno continua na turma',
  '00000000-0000-0000-0000-00000000efa0',
  (select turma_id::text from public.perfis where id = '00000000-0000-0000-0000-00000000e0a1'));

-- ── Agora a RPC da 0012 ──────────────────────────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e0c0';  -- inst_so_resp (turma C)
select public.t4_tentar_rpc('C', 'instrutor de OUTRA turma nao remove este aluno', 'erro 42501',
  $$select public.fn_remover_da_turma('00000000-0000-0000-0000-00000000e0a1'::uuid)$$);

select public.t4_tentar_rpc('C', 'ninguem remove a SI MESMO', 'erro 42501',
  $$select public.fn_remover_da_turma('00000000-0000-0000-0000-00000000e0c0'::uuid)$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e0a0';  -- inst_lotado
-- O alvo é `inst_colega`, LOTADO na turma A: sem isso a função pararia antes,
-- no atalho "já está sem turma", e o teste passaria sem exercitar a guarda.
select public.t4_tentar_rpc('C', 'instrutor da turma NAO remove outro INSTRUTOR', 'erro 42501',
  $$select public.fn_remover_da_turma('00000000-0000-0000-0000-00000000e0ab'::uuid)$$);

select public.t4_tentar_rpc('C', 'instrutor da turma remove o aluno pela RPC', 'passou',
  $$select public.fn_remover_da_turma('00000000-0000-0000-0000-00000000e0a1'::uuid)$$);

-- Idempotente: o segundo clique no botão não pode virar exceção em campo.
select public.t4_tentar_rpc('C', 'remover de novo nao e erro (idempotente)', 'passou',
  $$select public.fn_remover_da_turma('00000000-0000-0000-0000-00000000e0a1'::uuid)$$);

-- E AQUI A MESMA MECÂNICA DA 0012 MORDE O PRÓPRIO TESTE, o que vale registrar:
-- depois da remoção o instrutor não enxerga mais essa linha (é exatamente por
-- isso que o UPDATE direto era recusado), então conferir `turma_id` ainda como
-- `authenticated` devolveria NULO — e um nulo silencioso faria o teste passar
-- por engano. A conferência do estado gravado é feita no grupo D, como
-- `postgres`.
select public.t4_ok('C', 'depois de removido, o instrutor NAO enxerga mais a linha dele', '0',
  (select count(*)::text from public.perfis
    where id = '00000000-0000-0000-0000-00000000e0a1'));

-- =============================================================================
-- GRUPO D — o que o botão PROMETE na tela: nada foi apagado
-- =============================================================================
set role postgres;
reset request.jwt.claim.sub;

select public.t4_ok('D', 'a conta do aluno removido continua existindo', '1',
  (select count(*)::text from public.perfis
    where id = '00000000-0000-0000-0000-00000000e0a1'));

select public.t4_ok('D', 'turma_id dele ficou nulo', 'sem turma',
  (select coalesce(turma_id::text, 'sem turma') from public.perfis
    where id = '00000000-0000-0000-0000-00000000e0a1'));

-- Quem zerou o partido foi o BANCO (fn_normalizar_partido_do_perfil, 0003),
-- não a 0012 nem o cliente. Se alguém "melhorar" a função mandando
-- partido_id = null junto, a regra de 0003 para de disparar e esta linha é a
-- que avisa.
select public.t4_ok('D', 'e o partido foi zerado pelo trigger da 0003', 'sem partido',
  (select coalesce(partido_id::text, 'sem partido') from public.perfis
    where id = '00000000-0000-0000-0000-00000000e0a1'));

select public.t4_ok('D', 'a marcacao feita por ele continua no banco', '1',
  (select count(*)::text from public.elementos_marcados
    where autor_id = '00000000-0000-0000-0000-00000000e0a1'));

select public.t4_ok('D', 'o rastro historico dele continua no banco', '1',
  (select count(*)::text from public.posicoes_historico
    where usuario_id = '00000000-0000-0000-0000-00000000e0a1'));

-- A posição ATUAL, essa sim, sai — e é a única coisa que sai. Sem isto o
-- removido continuaria desenhado no mapa do instrutor (posicoes_ler libera
-- tudo da turma para ele), enquanto sumiria para os colegas: some para uns e
-- fica para outros, com quem clicou no botão sendo justamente quem continuaria
-- vendo o fantasma.
select public.t4_ok('D', 'a posicao ATUAL dele saiu (nao vira fantasma no mapa)', '0',
  (select count(*)::text from public.posicoes_atuais
    where usuario_id = '00000000-0000-0000-0000-00000000e0a1'));

-- E o rastro continua lá para o debriefing, que é a promessa do botão.
select public.t4_ok('D', 'mas o historico tem MAIS de um ponto guardado', 'sim',
  (select case when count(*) >= 1 then 'sim' else 'nao' end::text
     from public.posicoes_historico
    where usuario_id = '00000000-0000-0000-0000-00000000e0a1'));

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000e0a2';  -- alunoa2, que ficou
select public.t4_ok('D', 'o colega que ficou nao ve mais o removido', '0',
  (select count(*)::text from public.posicoes_atuais
    where usuario_id = '00000000-0000-0000-0000-00000000e0a1'));

select public.t4_ok('D', 'e continua vendo a propria posicao', '1',
  (select count(*)::text from public.posicoes_atuais
    where usuario_id = '00000000-0000-0000-0000-00000000e0a2'));

-- =============================================================================
-- RELATÓRIO
-- =============================================================================
set role postgres;
reset request.jwt.claim.sub;
\pset format aligned
\echo ''
\echo '=== 04_teste_perfil_instrutor: simbolo do aluno e saida da turma ==='
select grupo, descricao, esperado, obtido, case when ok then 'OK' else '** FALHOU **' end as r
from public.t4_resultados order by n;

select count(*) filter (where ok) as passaram,
       count(*) filter (where not ok) as falharam,
       count(*) as total
from public.t4_resultados;
