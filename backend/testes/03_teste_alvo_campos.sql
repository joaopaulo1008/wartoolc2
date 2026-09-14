-- =============================================================================
-- Teste da migration 0011 — altitude e dimensões do alvo
--
-- Roda num Postgres CRU, nunca no Supabase. Espera um banco LIMPO com as
-- migrations aplicadas em ordem:
--
--   createdb wt; psql -d wt -f backend/testes/00_stub_supabase.sql
--   for f in backend/supabase/00*.sql; do psql -v ON_ERROR_STOP=1 -d wt -f $f; done
--   psql -d wt -f backend/testes/03_teste_alvo_campos.sql
--
-- O que ele prova: os `check` da 0011 barram exatamente o que devem barrar e
-- nada além. O caso que mais importa é o **segundo** — altitude gravada sem
-- fonte. Uma cota anônima na tabela é o modo de falha perigoso desta
-- migration: quem lê não tem como saber se aquilo foi lido na carta ou
-- derivado de um modelo de elevação, e para tiro essa diferença não é
-- detalhe. O `check` é o que garante que esse estado não existe.
--
-- Cada caso diz se ESPERAVA passar ou ser recusado, então uma linha "FALHOU"
-- significa tanto "aceitou o que não devia" quanto "recusou o que devia
-- aceitar" — as duas direções são erro.
-- =============================================================================

\set ON_ERROR_STOP 0
-- massa mínima
insert into public.turmas (id, nome, codigo_acesso) values ('11111111-1111-4111-8111-111111111111','T','C11') on conflict do nothing;
do $$ begin
  insert into auth.users (id, email) values ('22222222-2222-4222-8222-222222222222','a@b.c') on conflict do nothing;
exception when others then null; end $$;
update public.perfis set turma_id='11111111-1111-4111-8111-111111111111' where id='22222222-2222-4222-8222-222222222222';

create or replace function pg_temp.tenta(rotulo text, sql text, deve_falhar boolean) returns void language plpgsql as $$
begin
  execute sql;
  if deve_falhar then raise notice '** FALHOU **  %  (o banco ACEITOU e não devia)', rotulo;
  else raise notice 'PASSOU        %', rotulo; end if;
exception when others then
  if deve_falhar then raise notice 'PASSOU        %  (recusado: %)', rotulo, left(sqlerrm, 45);
  else raise notice '** FALHOU **  %  (recusado sem motivo: %)', rotulo, left(sqlerrm, 60); end if;
end $$;

\set base 'insert into public.elementos_marcados (turma_id, autor_id, latitude, longitude, sidc'
select pg_temp.tenta('altitude com fonte manual passa',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,altitude_m,altitude_fonte) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',820.5,'manual')$q$, false);
select pg_temp.tenta('altitude SEM fonte é recusada (cota anônima)',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,altitude_m) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',820.5)$q$, true);
select pg_temp.tenta('fonte SEM altitude é recusada',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,altitude_fonte) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000','manual')$q$, true);
select pg_temp.tenta('fonte inventada é recusada',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,altitude_m,altitude_fonte) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',820,'chute')$q$, true);
select pg_temp.tenta('fonte mde é aceita (produtor ainda não existe, coluna sim)',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,altitude_m,altitude_fonte) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',820,'mde')$q$, false);
select pg_temp.tenta('altitude absurda (90000 m) é recusada',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,altitude_m,altitude_fonte) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',90000,'manual')$q$, true);
select pg_temp.tenta('só frente (alvo linear) é aceito',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,frente_m) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',300)$q$, false);
select pg_temp.tenta('frente zero é recusada (em branco é o estado honesto)',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,frente_m) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',0)$q$, true);
select pg_temp.tenta('frente negativa é recusada',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,frente_m) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',-40)$q$, true);
select pg_temp.tenta('frente de 50 km é recusada (é zona, não alvo)',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc,frente_m) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000',50000)$q$, true);
select pg_temp.tenta('marcação SEM nenhum dos quatro campos continua válida',
  $q$insert into public.elementos_marcados (turma_id,autor_id,latitude,longitude,sidc) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',-25,-50,'10011000001211000000')$q$, false);
