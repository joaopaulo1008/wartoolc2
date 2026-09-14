-- Confere se a 0010 foi aplicada. Seguro de rodar ANTES ou DEPOIS.
do $$
declare t int; p int; r int; g int; tu int; sp int; pv int;
begin
  select count(*) into t from pg_tables where schemaname='public' and tablename='icones_rapidos';
  if t = 0 then
    raise notice 'A 0010 NAO foi aplicada: a tabela icones_rapidos nao existe.';
    return;
  end if;
  select count(*) into p from pg_policies where tablename='icones_rapidos';
  select count(*) into r from pg_publication_tables
    where pubname='supabase_realtime' and tablename='icones_rapidos';
  select count(*) into g from pg_trigger where tgname='trg_turmas_z_icones_rapidos_padrao';
  select count(*) into tu from public.turmas;
  select count(*) into sp from public.turmas x
    where not exists (select 1 from public.icones_rapidos i where i.turma_id=x.id);
  select count(*) into pv from public.icones_rapidos where removido_em is null;
  raise notice 'policies=% (esperado 4) | realtime=% (1) | trigger=% (1)', p, r, g;
  raise notice 'turmas=% | turmas SEM paleta=% (esperado 0) | presets vigentes=%', tu, sp, pv;
  if p=4 and r=1 and g=1 and sp=0 then
    raise notice 'OK — a 0010 esta aplicada e a paleta foi semeada.';
  else
    raise notice 'ATENCAO — algo nao bate. Reaplique a 0010 (ela e idempotente).';
  end if;
end $$;
