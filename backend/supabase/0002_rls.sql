-- =============================================================================
-- WartoolC2 — Migration 0002: Row Level Security
--
-- Regra geral:
--   - Aluno (papel 'usuario'): lê o que é da SUA turma; escreve apenas a
--     PRÓPRIA posição e as PRÓPRIAS marcações; não altera permissões.
--   - Instrutor: lê e edita tudo da SUA turma (a turma em que ele está lotado
--     como perfis.turma_id ou da qual é turmas.instrutor_id).
--   - Ninguém enxerga dados de outra turma.
--
-- Aplicar DEPOIS de 0001_schema_inicial.sql.
-- =============================================================================

-- =============================================================================
-- 1. FUNÇÕES AUXILIARES
-- =============================================================================
-- SECURITY DEFINER de propósito: as policies de `perfis` precisam consultar
-- `perfis` para descobrir papel e turma do usuário atual. Se essa consulta
-- passasse pela própria RLS, haveria recursão infinita. Estas funções rodam
-- com privilégio do dono e ignoram RLS, quebrando o ciclo.
-- Elas expõem apenas papel/turma do PRÓPRIO chamador — não vazam dados.

create or replace function public.fn_meu_papel()
returns papel_usuario
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.perfis where id = auth.uid();
$$;

create or replace function public.fn_minha_turma()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select turma_id from public.perfis where id = auth.uid();
$$;

create or replace function public.fn_sou_instrutor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select papel = 'instrutor' from public.perfis where id = auth.uid()),
    false
  );
$$;

-- Instrutor "manda" numa turma se está lotado nela OU é o responsável dela.
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
    ),
    false
  );
$$;

-- Turma de um usuário qualquer (usada nas policies de permissoes_usuario).
create or replace function public.fn_turma_do_usuario(p_usuario_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select turma_id from public.perfis where id = p_usuario_id;
$$;

revoke all on function public.fn_meu_papel()                  from public;
revoke all on function public.fn_minha_turma()                from public;
revoke all on function public.fn_sou_instrutor()              from public;
revoke all on function public.fn_sou_instrutor_da_turma(uuid) from public;
revoke all on function public.fn_turma_do_usuario(uuid)       from public;

grant execute on function public.fn_meu_papel()                  to authenticated;
grant execute on function public.fn_minha_turma()                to authenticated;
grant execute on function public.fn_sou_instrutor()              to authenticated;
grant execute on function public.fn_sou_instrutor_da_turma(uuid) to authenticated;
grant execute on function public.fn_turma_do_usuario(uuid)       to authenticated;

-- =============================================================================
-- 2. HABILITAR RLS EM TUDO
-- =============================================================================

alter table public.turmas               enable row level security;
alter table public.perfis               enable row level security;
alter table public.posicoes_atuais      enable row level security;
alter table public.posicoes_historico   enable row level security;
alter table public.marcacoes_inimigas   enable row level security;
alter table public.catalogo_permissoes  enable row level security;
alter table public.permissoes_turma     enable row level security;
alter table public.permissoes_usuario   enable row level security;

-- =============================================================================
-- 3. TURMAS
-- =============================================================================

drop policy if exists turmas_ler on public.turmas;
create policy turmas_ler on public.turmas
  for select to authenticated
  using (
    id = public.fn_minha_turma()
    or instrutor_id = auth.uid()
  );

-- Só instrutor cria turma, e só se colocar a si mesmo como responsável.
drop policy if exists turmas_criar on public.turmas;
create policy turmas_criar on public.turmas
  for insert to authenticated
  with check (
    public.fn_sou_instrutor()
    and instrutor_id = auth.uid()
  );

drop policy if exists turmas_editar on public.turmas;
create policy turmas_editar on public.turmas
  for update to authenticated
  using (instrutor_id = auth.uid())
  with check (instrutor_id = auth.uid());

drop policy if exists turmas_remover on public.turmas;
create policy turmas_remover on public.turmas
  for delete to authenticated
  using (instrutor_id = auth.uid());

-- =============================================================================
-- 4. PERFIS
-- =============================================================================

-- Cada um lê o próprio perfil; todos leem os colegas da mesma turma;
-- instrutor lê os perfis das turmas que comanda.
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis
  for select to authenticated
  using (
    id = auth.uid()
    or (turma_id is not null and turma_id = public.fn_minha_turma())
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- O usuário edita o próprio perfil, MAS não pode se autopromover a instrutor:
-- o papel precisa permanecer igual ao que já está gravado.
drop policy if exists perfis_editar_proprio on public.perfis;
create policy perfis_editar_proprio on public.perfis
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and papel = public.fn_meu_papel()
  );

-- Instrutor edita os perfis dos alunos da sua turma (inclusive mover de turma).
drop policy if exists perfis_editar_instrutor on public.perfis;
create policy perfis_editar_instrutor on public.perfis
  for update to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id))
  with check (
    public.fn_sou_instrutor_da_turma(turma_id)
    or public.fn_sou_instrutor_da_turma(public.fn_minha_turma())
  );

-- O perfil é criado pelo trigger em auth.users (SECURITY DEFINER), então não
-- há policy de INSERT para o cliente. Idem para DELETE: sai junto com a conta.

-- WITH CHECK não enxerga o valor ANTIGO da linha, então sozinho ele não
-- consegue impedir que o aluno troque o próprio `turma_id` (bastaria adivinhar
-- o UUID de outra turma para se infiltrar nela). Um trigger BEFORE UPDATE tem
-- acesso a OLD e NEW e fecha essa brecha.
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
    -- A troca de turma é permitida apenas quando vem de dentro da RPC
    -- entrar_na_turma(), que sinaliza isso com um flag transacional
    -- (local = true, some no fim da transação e não é setável pelo cliente
    -- via PostgREST).
    if new.turma_id is distinct from old.turma_id
       and coalesce(current_setting('wartool.entrada_autorizada', true), 'off') <> 'on' then
      raise exception 'Entre numa turma pela função entrar_na_turma(codigo).'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_campos_do_perfil on public.perfis;
create trigger trg_proteger_campos_do_perfil
  before update on public.perfis
  for each row execute function public.fn_proteger_campos_do_perfil();

-- Entrada em turma pelo código de acesso — único caminho para o aluno se
-- vincular a uma turma. Roda como SECURITY DEFINER para poder validar o código
-- sem que o aluno precise enxergar turmas das quais ainda não faz parte.
create or replace function public.entrar_na_turma(p_codigo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turma_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;

  select id into v_turma_id
  from public.turmas
  where codigo_acesso = p_codigo and ativa;

  if v_turma_id is null then
    raise exception 'Código de turma inválido ou turma inativa.' using errcode = '22023';
  end if;

  perform set_config('wartool.entrada_autorizada', 'on', true);
  update public.perfis set turma_id = v_turma_id where id = auth.uid();
  perform set_config('wartool.entrada_autorizada', 'off', true);

  return v_turma_id;
end;
$$;

revoke all on function public.entrar_na_turma(text) from public;
grant execute on function public.entrar_na_turma(text) to authenticated;

-- =============================================================================
-- 5. POSIÇÕES ATUAIS
-- =============================================================================

-- Leitura: a própria posição sempre; as dos colegas de turma; instrutor vê
-- todas as da turma que comanda.
drop policy if exists posicoes_ler on public.posicoes_atuais;
create policy posicoes_ler on public.posicoes_atuais
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or (turma_id is not null and turma_id = public.fn_minha_turma())
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- Escrita: SOMENTE a própria posição, e obrigatoriamente carimbada com a
-- turma do próprio usuário (impede injetar posição em outra turma).
drop policy if exists posicoes_inserir_propria on public.posicoes_atuais;
create policy posicoes_inserir_propria on public.posicoes_atuais
  for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and turma_id is not distinct from public.fn_minha_turma()
  );

drop policy if exists posicoes_atualizar_propria on public.posicoes_atuais;
create policy posicoes_atualizar_propria on public.posicoes_atuais
  for update to authenticated
  using (usuario_id = auth.uid())
  with check (
    usuario_id = auth.uid()
    and turma_id is not distinct from public.fn_minha_turma()
  );

-- Instrutor pode limpar a posição de um aluno da sua turma (ex.: aluno saiu
-- do exercício), mas NÃO pode forjar a posição de ninguém — só apagar.
drop policy if exists posicoes_remover_instrutor on public.posicoes_atuais;
create policy posicoes_remover_instrutor on public.posicoes_atuais
  for delete to authenticated
  using (
    usuario_id = auth.uid()
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- =============================================================================
-- 6. POSIÇÕES HISTÓRICO
-- =============================================================================
-- Append-only e escrito exclusivamente pelo trigger fn_arquivar_posicao
-- (SECURITY DEFINER). Nenhuma policy de INSERT/UPDATE/DELETE para o cliente:
-- a ausência de policy já bloqueia a operação com RLS ligado.

drop policy if exists historico_ler on public.posicoes_historico;
create policy historico_ler on public.posicoes_historico
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- =============================================================================
-- 7. MARCAÇÕES INIMIGAS
-- =============================================================================

-- Todo mundo da turma vê as marcações da turma.
drop policy if exists marcacoes_ler on public.marcacoes_inimigas;
create policy marcacoes_ler on public.marcacoes_inimigas
  for select to authenticated
  using (
    turma_id = public.fn_minha_turma()
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- Criar: só em nome próprio e só na própria turma.
drop policy if exists marcacoes_criar on public.marcacoes_inimigas;
create policy marcacoes_criar on public.marcacoes_inimigas
  for insert to authenticated
  with check (
    autor_id = auth.uid()
    and turma_id = public.fn_minha_turma()
  );

-- Editar: autor mexe nas próprias (sem trocar de autor nem de turma).
drop policy if exists marcacoes_editar_propria on public.marcacoes_inimigas;
create policy marcacoes_editar_propria on public.marcacoes_inimigas
  for update to authenticated
  using (autor_id = auth.uid())
  with check (
    autor_id = auth.uid()
    and turma_id = public.fn_minha_turma()
  );

-- Instrutor edita/remove qualquer marcação da turma que comanda.
drop policy if exists marcacoes_editar_instrutor on public.marcacoes_inimigas;
create policy marcacoes_editar_instrutor on public.marcacoes_inimigas
  for update to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id))
  with check (public.fn_sou_instrutor_da_turma(turma_id));

-- Exclusão física: autor ou instrutor da turma. (O caminho normal na
-- interface é a exclusão lógica via `removida_em`, que é um UPDATE.)
drop policy if exists marcacoes_remover on public.marcacoes_inimigas;
create policy marcacoes_remover on public.marcacoes_inimigas
  for delete to authenticated
  using (
    autor_id = auth.uid()
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- =============================================================================
-- 8. CATÁLOGO DE PERMISSÕES
-- =============================================================================
-- Leitura livre para autenticados (o app precisa montar a lista de opções).
-- Escrita só via dashboard/service_role — nenhuma policy de escrita.

drop policy if exists catalogo_ler on public.catalogo_permissoes;
create policy catalogo_ler on public.catalogo_permissoes
  for select to authenticated
  using (true);

-- =============================================================================
-- 9. PERMISSÕES DA TURMA
-- =============================================================================

drop policy if exists perm_turma_ler on public.permissoes_turma;
create policy perm_turma_ler on public.permissoes_turma
  for select to authenticated
  using (
    turma_id = public.fn_minha_turma()
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- Só o instrutor da turma escreve.
drop policy if exists perm_turma_escrever on public.permissoes_turma;
create policy perm_turma_escrever on public.permissoes_turma
  for all to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id))
  with check (public.fn_sou_instrutor_da_turma(turma_id));

-- =============================================================================
-- 10. PERMISSÕES DO USUÁRIO (override individual)
-- =============================================================================

-- O aluno LÊ as próprias permissões (é assim que o app sabe o que habilitar),
-- mas não escreve nada — quem manda é o instrutor.
drop policy if exists perm_usuario_ler on public.permissoes_usuario;
create policy perm_usuario_ler on public.permissoes_usuario
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or public.fn_sou_instrutor_da_turma(public.fn_turma_do_usuario(usuario_id))
  );

drop policy if exists perm_usuario_escrever on public.permissoes_usuario;
create policy perm_usuario_escrever on public.permissoes_usuario
  for all to authenticated
  using (
    public.fn_sou_instrutor_da_turma(public.fn_turma_do_usuario(usuario_id))
  )
  with check (
    public.fn_sou_instrutor_da_turma(public.fn_turma_do_usuario(usuario_id))
    and definida_por = auth.uid()
  );

-- =============================================================================
-- 11. VIEW DE PERMISSÕES EFETIVAS
-- =============================================================================
-- security_invoker = a view respeita a RLS das tabelas de base, ou seja,
-- cada um só resolve as permissões que já teria direito de ler.

alter view public.vw_permissoes_efetivas set (security_invoker = true);
grant select on public.vw_permissoes_efetivas to authenticated;

-- =============================================================================
-- 12. GRANTS DE TABELA
-- =============================================================================
-- RLS filtra LINHAS, mas o privilégio da TABELA ainda precisa existir.
-- Concedemos amplo aqui e deixamos as policies acima serem a única barreira.

grant select                          on public.turmas              to authenticated;
grant insert, update, delete          on public.turmas              to authenticated;
grant select, update                  on public.perfis              to authenticated;
grant select, insert, update, delete  on public.posicoes_atuais     to authenticated;
grant select                          on public.posicoes_historico  to authenticated;
grant select, insert, update, delete  on public.marcacoes_inimigas  to authenticated;
grant select                          on public.catalogo_permissoes to authenticated;
grant select, insert, update, delete  on public.permissoes_turma    to authenticated;
grant select, insert, update, delete  on public.permissoes_usuario  to authenticated;
grant usage, select                   on sequence public.posicoes_historico_id_seq to authenticated;
