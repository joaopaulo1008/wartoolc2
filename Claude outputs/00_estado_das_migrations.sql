-- =============================================================================
-- WartoolC2 — o que já está aplicado neste banco?
-- Cole no SQL Editor do Supabase e rode. Não altera nada, só lê.
-- Este projeto nunca teve tabela de controle de migrations (sempre aplicou pelo
-- SQL Editor), então a conferência é por OBJETO: cada linha procura algo que só
-- existe se aquela migration rodou.
-- =============================================================================
select '0001 schema inicial'      as migration,
       to_regclass('public.perfis')            is not null as aplicada
union all select '0002 RLS',
       exists(select 1 from pg_proc where proname='fn_sou_instrutor_da_turma')
union all select '0003 partidos',
       to_regclass('public.partidos')          is not null
union all select '0004 perfis no realtime',
       exists(select 1 from pg_publication_tables
              where pubname='supabase_realtime' and tablename='perfis')
union all select '0005 rastro historico',
       exists(select 1 from pg_proc where proname='fn_rastro_historico')
union all select '0006 calcos',
       to_regclass('public.calcos')            is not null
union all select '0007 codigo de turma valido',
       exists(select 1 from pg_proc where proname='fn_codigo_turma_valido')
union all select '0008 imagem georreferenciada',
       exists(select 1 from information_schema.columns
              where table_name='calcos' and column_name='bounds_norte')
union all select '0009 auditoria de edicao',
       exists(select 1 from information_schema.columns
              where table_name='elementos_marcados' and column_name='editada_por')
union all select '0010 icones rapidos  <-- a nova',
       to_regclass('public.icones_rapidos')    is not null;
