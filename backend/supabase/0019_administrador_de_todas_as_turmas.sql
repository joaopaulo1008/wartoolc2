-- =============================================================================
-- 0019 — Administrador: uma conta que comanda TODAS as turmas
-- =============================================================================
-- Para que serve
-- --------------
-- Hoje um instrutor só manda numa turma se está LOTADO nela ou é o RESPONSÁVEL
-- por ela (turmas.instrutor_id) — ver fn_sou_instrutor_da_turma (0002). Quem
-- coordena vários exercícios precisa de uma conta que alcance todas, inclusive
-- as criadas por outros instrutores, sem ter de virar "responsável" turma a
-- turma. Esta migration cria essa conta: perfis.administrador.
--
-- O que o administrador ganha
-- ---------------------------
-- Em TODA turma, o mesmo que o instrutor da turma tem hoje: ver os perfis, as
-- posições (atuais e histórico), as marcações, as anotações, os calcos, a
-- situação e os pedidos de apoio; editar a paleta, a designação, as forças, o
-- modo de posição e as permissões; tirar aluno da turma. Isto vem de UMA
-- mudança — fn_sou_instrutor_da_turma passa a responder "sim" para ele —, mais
-- três pontos que não passam por essa função: a leitura e a edição da própria
-- tabela `turmas`, e fn_usuarios_visiveis (a visibilidade entre usuários).
--
-- O que ele NÃO ganha (de propósito)
-- ----------------------------------
--   * Apagar turma. turmas_remover continua só para o responsável: apagar uma
--     turma leva junto, por cascade, o histórico dela, e isso não deve ser
--     consequência de um papel amplo. É operação de SQL Editor.
--   * Conceder o papel a ninguém. A coluna `administrador` só muda SEM JWT
--     (SQL Editor, service_role). Nem o próprio administrador, nem instrutor,
--     nem aluno conseguem gravá-la pelo app — a trigger recusa com 42501.
--     Sem isso, bastaria a um instrutor se promover pelo console.
--   * Valer para quem não é instrutor: fn_sou_admin() exige papel = 'instrutor'.
--     Rebaixar a conta tira o poder, mesmo com a coluna ainda marcada.
--
-- Como dar o papel (rodar no SQL Editor do Supabase, uma vez):
--     update public.perfis set administrador = true
--      where id = (select id from auth.users where email = 'joao@wartool.local');
-- Como tirar: o mesmo comando com `false`.
--
-- Idempotente. Aplicar DEPOIS de 0018 (reescreve a trigger que a 0018 já mexeu).
-- =============================================================================

alter table public.perfis
  add column if not exists administrador boolean not null default false;

comment on column public.perfis.administrador is
  'Conta que comanda todas as turmas (ver 0019). Só o SQL Editor / service_role grava; a trigger recusa qualquer outro. Só vale se papel = instrutor.';

-- ── 1. A pergunta "eu sou administrador?" ───────────────────────────────────
create or replace function public.fn_sou_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select papel = 'instrutor' and administrador
       from public.perfis where id = auth.uid()),
    false
  );
$$;

revoke all on function public.fn_sou_admin() from public;
grant execute on function public.fn_sou_admin() to authenticated;

-- ── 2. fn_sou_instrutor_da_turma: o administrador manda em qualquer turma ───
-- Corpo idêntico ao da 0002, com um ramo a mais. Quase toda policy do projeto
-- consulta ESTA função, então um ponto só cobre a maioria.
create or replace function public.fn_sou_instrutor_da_turma(p_turma_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_turma_id is not null
    and (select papel = 'instrutor' from public.perfis where id = auth.uid())
    and (
      p_turma_id = (select turma_id from public.perfis where id = auth.uid())
      or exists (
        select 1 from public.turmas t
        where t.id = p_turma_id and t.instrutor_id = auth.uid()
      )
      or public.fn_sou_admin()
    ),
    false
  );
$$;

-- ── 3. fn_usuarios_visiveis: o administrador enxerga quem está em turma ─────
-- Corpo idêntico ao da 0003, com um ramo a mais no fim. É dela que dependem as
-- policies de posições, histórico e marcações.
create or replace function public.fn_usuarios_visiveis()
returns setof uuid
language sql
stable
security definer
parallel safe
set search_path = public
as $$
  with eu as (
    select id, turma_id, partido_id, papel
    from public.perfis
    where id = auth.uid()
  )
  select id from eu
  union
  select p.id
  from public.perfis p, eu
  where p.turma_id is not null
    and p.turma_id = eu.turma_id
    and (
      eu.papel = 'instrutor'
      or (eu.partido_id is not null and p.partido_id = eu.partido_id)
    )
  union
  select p.id
  from public.perfis p
  join public.turmas t on t.id = p.turma_id
  where (select papel from eu) = 'instrutor'
    and t.instrutor_id = auth.uid()
  union
  -- NOVO na 0019: o administrador vê todo mundo que está em alguma turma.
  select p.id
  from public.perfis p
  where p.turma_id is not null
    and public.fn_sou_admin();
$$;

-- ── 4. A tabela `turmas`: ler e editar ──────────────────────────────────────
drop policy if exists turmas_ler on public.turmas;
create policy turmas_ler on public.turmas
  for select to authenticated
  using (
    id = public.fn_minha_turma()
    or instrutor_id = auth.uid()
    or public.fn_sou_admin()
  );

drop policy if exists turmas_editar on public.turmas;
create policy turmas_editar on public.turmas
  for update to authenticated
  using (instrutor_id = auth.uid() or public.fn_sou_admin())
  with check (instrutor_id = auth.uid() or public.fn_sou_admin());

-- turmas_criar e turmas_remover ficam como estavam (0002).

-- ── 5. A trigger: `administrador` não muda pelo app ─────────────────────────
-- Corpo da 0018 + um bloco ANTES do ramo do instrutor: o instrutor passa por
-- cima das outras regras desta função, mas não por esta.
create or replace function public.fn_proteger_campos_do_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sou_instrutor boolean := public.fn_sou_instrutor();
begin
  -- service_role / SQL Editor / jobs internos (sem JWT) passam direto.
  if auth.uid() is null then
    return new;
  end if;

  -- NOVO na 0019: ninguém, nem instrutor, nem administrador, concede ou tira
  -- o papel de administrador pelo app.
  if new.administrador is distinct from old.administrador then
    raise exception 'O papel de administrador só é concedido pelo banco (SQL Editor).'
      using errcode = '42501';
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
