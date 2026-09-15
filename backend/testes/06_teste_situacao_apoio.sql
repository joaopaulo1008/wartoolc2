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
-- GRUPO E — a resposta do instrutor (migration 0015)
-- =============================================================================
-- "Reconhecido" não diz se alguém saiu, por onde nem em quanto tempo. O que
-- este grupo trava é a COERÊNCIA do trio (texto+quem+quando) e a
-- impossibilidade de existir leitura de uma mensagem que não foi mandada.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';  -- azul1, o autor

-- Um pedido novo e aberto para este grupo trabalhar.
select public.t6_tentar('E', 'autor aciona de novo', 'passou',
  $$insert into public.pedidos_apoio (usuario_id, turma_id, latitude, longitude, posicao_em)
    values ('00000000-0000-0000-0000-0000000060a1',
            '00000000-0000-0000-0000-000000006fa0', -25.10, -50.17, now())$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a0';  -- instrutor
select public.t6_tentar('E', 'instrutor responde', 'passou',
  $$update public.pedidos_apoio
       set resposta = 'Ciente, apoio a caminho',
           respondido_em = now(),
           respondido_por = '00000000-0000-0000-0000-0000000060a0',
           reconhecido_em = now(),
           reconhecido_por = '00000000-0000-0000-0000-0000000060a0'
     where encerrado_em is null$$);

-- O trio anda junto: texto sem autoria não diz a quem obedecer. O alvo é uma
-- linha AINDA SEM resposta — numa que já tem, `respondido_por` continua
-- preenchido e o check passaria sem exercitar nada (foi o que a primeira
-- versão deste teste fez, e a correção virou o trigger de carimbo da 0015).
select public.t6_tentar('E', 'resposta SEM quem respondeu e recusada', 'erro',
  $$insert into public.pedidos_apoio (usuario_id, turma_id, resposta)
    values ('00000000-0000-0000-0000-0000000060a0',
            '00000000-0000-0000-0000-000000006fa0', 'solto')$$);

-- O TRIGGER da 0015: trocar só o texto reescreve a hora sozinho. Sem ele a
-- linha ficaria coerente para o check e mentirosa para quem lê.
select public.t6_tentar('E', 'trocar so o texto e aceito (o trigger carimba)', 'passou',
  $$update public.pedidos_apoio set resposta = 'Ciente, aguarde no local'
     where resposta is not null and encerrado_em is null$$);

select public.t6_tentar('E', 'resposta em branco e recusada', 'erro',
  $$update public.pedidos_apoio
       set resposta = '   ', respondido_em = now(),
           respondido_por = '00000000-0000-0000-0000-0000000060a0'
     where encerrado_em is null$$);

select public.t6_tentar('E', 'resposta acima de 200 caracteres e recusada', 'erro',
  $$update public.pedidos_apoio
       set resposta = repeat('x', 201), respondido_em = now(),
           respondido_por = '00000000-0000-0000-0000-0000000060a0'
     where encerrado_em is null$$);

-- **Não existe leitura de mensagem que não chegou.** Sem este check, um
-- cliente com defeito carimbaria "lido" numa linha sem resposta e a faixa do
-- instrutor mostraria leitura de algo que ele nunca mandou.
-- Um pedido novo, SEM resposta, só para este caso — sem ele o update não
-- casaria com linha nenhuma e o teste passaria por engano ("zero linhas").
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a2';  -- azul2
select public.t6_tentar('E', 'azul2 aciona (pedido sem resposta)', 'passou',
  $$insert into public.pedidos_apoio (usuario_id, turma_id)
    values ('00000000-0000-0000-0000-0000000060a2',
            '00000000-0000-0000-0000-000000006fa0')$$);

select public.t6_tentar('E', 'carimbo de leitura SEM resposta e recusado', 'erro',
  $$update public.pedidos_apoio set resposta_vista_em = now()
     where usuario_id = '00000000-0000-0000-0000-0000000060a2' and resposta is null$$);

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a0';  -- instrutor

-- O AUTOR confirma a leitura — é o que separa "mandei" de "ele leu".
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';  -- azul1
select public.t6_tentar('E', 'o AUTOR carimba que leu', 'passou',
  $$update public.pedidos_apoio set resposta_vista_em = now()
     where usuario_id = '00000000-0000-0000-0000-0000000060a1'
       and resposta is not null and encerrado_em is null$$);

-- Um colega da força VÊ a resposta (vai socorrer e precisa saber o que foi
-- combinado) mas não responde em nome de quem conduz.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a2';  -- azul2
select public.t6_ok('E', 'o colega LE a resposta (a ultima gravada)', 'Ciente, aguarde no local',
  (select resposta from public.pedidos_apoio
    where usuario_id = '00000000-0000-0000-0000-0000000060a1' and resposta is not null limit 1));

-- O colega tem pedido PRÓPRIO desde alguns casos atrás, então o alvo precisa
-- ser explicitamente a linha de OUTRA pessoa — sem isso o update acertaria a
-- linha dele, que a policy permite, e o teste aprovaria por engano.
select public.t6_tentar('E', 'mas o colega NAO responde pelo instrutor', 'zero linhas',
  $$update public.pedidos_apoio
       set resposta = 'eu que mandei', respondido_em = now(),
           respondido_por = '00000000-0000-0000-0000-0000000060a2'
     where usuario_id = '00000000-0000-0000-0000-0000000060a1'$$);

-- ── O TRIGGER, exercitado na ordem certa ─────────────────────────────────
-- Neste ponto a resposta do azul1 JÁ está confirmada como lida (caso acima).
-- Uma resposta NOVA tem que zerar essa confirmação: o "lido" era da mensagem
-- anterior, e mantê-lo faria o instrutor achar que a correção que acabou de
-- mandar já foi vista.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a0';  -- instrutor
select public.t6_ok('E', 'antes: a resposta do azul1 estava confirmada', '1',
  (select count(*)::text from public.pedidos_apoio
    where usuario_id = '00000000-0000-0000-0000-0000000060a1' and resposta_vista_em is not null));

select public.t6_tentar('E', 'instrutor CORRIGE a resposta', 'passou',
  $$update public.pedidos_apoio set resposta = 'Ciente, desloque para o PC'
     where usuario_id = '00000000-0000-0000-0000-0000000060a1' and resposta is not null$$);

select public.t6_ok('E', 'e o trigger zerou a confirmacao de leitura', '0',
  (select count(*)::text from public.pedidos_apoio
    where usuario_id = '00000000-0000-0000-0000-0000000060a1' and resposta_vista_em is not null));
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060b1';  -- VERMELHO
select public.t6_ok('E', 'e o Vermelho nao ve resposta nenhuma', '0',
  (select count(*)::text from public.pedidos_apoio where resposta is not null));

-- O relatório abaixo lê t6_resultados, que não tem grant para `authenticated`
-- — sem voltar para postgres aqui, o arquivo termina com "permission denied"
-- e nenhum resultado é mostrado.
set role postgres;
reset request.jwt.claim.sub;

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
