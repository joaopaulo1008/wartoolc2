-- =============================================================================
-- 0018 — Designação do calunga: número à esquerda, número à direita, nome da fração
-- =============================================================================
-- Para que serve
-- --------------
-- O símbolo de cada pessoa no mapa (o "calunga") passa a mostrar a designação
-- e a subordinação da fração dela, à moda da simbologia militar:
--
--        ● ● ●                 numero_esq  = designação        ("1"  → 1º Pelotão)
--      1 [ ▭ ] 2               numero_dir  = subordinação      ("2"  → do 2º Esquadrão)
--                              nome_fracao = nome por extenso, só no popup ("Pel Fuz")
--
-- Os pontos de escalão continuam vindo de `perfis.sidc` (coluna escalão da
-- planilha de importação). Aqui só entram os três textos curtos.
--
-- As três colunas são opcionais. Quem não tem nenhuma preenchida continua sendo
-- desenhado como antes (nome de guerra ao lado do símbolo) — nada muda para as
-- contas que já existem.
--
-- Quem define: o INSTRUTOR (ou a service_role: seed e Edge Function
-- `importar-turma`). É atribuição de comando, como o partido (0003): se o aluno
-- pudesse editar, um UPDATE no console bastaria para ele aparecer como outra
-- fração. Por isso `fn_proteger_campos_do_perfil` passa a recusar a troca vinda
-- de aluno. (Observação, fora do escopo desta migration e NÃO alterada aqui: a
-- 0012 já registrou que o aluno consegue trocar o próprio `sidc` pelo console.)
--
-- Limites (check no banco, repetidos em frontend/designacao.js e na Edge Function
-- e comparados por teste): número de 1 a 4 caracteres, nome da fração de 1 a 20,
-- sem espaço nas pontas. Vazio é NULL, nunca ''.
--
-- Idempotente. Aplicar DEPOIS de 0017. Pode ser aplicada antes ou depois do push
-- do front-end: o app lê as colunas com tolerância a banco sem a migration.
-- =============================================================================

alter table public.perfis add column if not exists numero_esq  text;
alter table public.perfis add column if not exists numero_dir  text;
alter table public.perfis add column if not exists nome_fracao text;

do $$ begin
  alter table public.perfis add constraint perfis_numero_esq_check
    check (numero_esq is null or (char_length(numero_esq) between 1 and 4 and numero_esq = btrim(numero_esq)));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.perfis add constraint perfis_numero_dir_check
    check (numero_dir is null or (char_length(numero_dir) between 1 and 4 and numero_dir = btrim(numero_dir)));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.perfis add constraint perfis_nome_fracao_check
    check (nome_fracao is null or (char_length(nome_fracao) between 1 and 20 and nome_fracao = btrim(nome_fracao)));
exception when duplicate_object then null; end $$;

comment on column public.perfis.numero_esq is
  'Designação da fração (número à ESQUERDA do símbolo no mapa). Até 4 caracteres. Definida pelo instrutor.';
comment on column public.perfis.numero_dir is
  'Subordinação da fração (número à DIREITA do símbolo no mapa). Até 4 caracteres. Definida pelo instrutor.';
comment on column public.perfis.nome_fracao is
  'Nome da fração por extenso, mostrado no popup do símbolo (ex.: "Pel Fuz"). Até 20 caracteres. Definido pelo instrutor.';

-- Reescreve a função de 0003 (corpo idêntico) acrescentando a regra da designação.
create or replace function public.fn_proteger_campos_do_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sou_instrutor boolean := public.fn_sou_instrutor();
begin
  -- service_role / jobs internos (sem JWT) passam direto.
  if auth.uid() is null then
    return new;
  end if;

  if not v_sou_instrutor then
    if new.papel is distinct from old.papel then
      raise exception 'Alteração de papel não permitida.' using errcode = '42501';
    end if;
    if new.turma_id is distinct from old.turma_id
       and coalesce(current_setting('wartool.entrada_autorizada', true), 'off') <> 'on' then
      raise exception 'Entre numa turma pela função entrar_na_turma(codigo).'
        using errcode = '42501';
    end if;
    if new.partido_id is distinct from old.partido_id
       and not (new.partido_id is null
                and new.turma_id is distinct from old.turma_id) then
      raise exception 'Somente o instrutor da turma define o partido.'
        using errcode = '42501';
    end if;
    -- NOVO na 0018: a designação da fração é atribuição de comando.
    if new.numero_esq  is distinct from old.numero_esq
       or new.numero_dir  is distinct from old.numero_dir
       or new.nome_fracao is distinct from old.nome_fracao then
      raise exception 'Somente o instrutor da turma define a designação da fração.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
