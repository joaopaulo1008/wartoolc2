-- =============================================================================
-- 0016 — Modo de posição da turma (GPS, manual, externa) e origem da posição
-- =============================================================================
-- Para que serve
-- --------------
-- Até aqui toda posição própria vinha do GPS do celular. Para simulação (sem
-- GPS) e, no futuro, para a integração com simuladores (Steel Beasts, SABRA),
-- a posição passa a ter uma ORIGEM e a turma passa a ter um MODO que diz qual
-- origem vale nela.
--
--   turmas.modo_posicao
--     'gps'      — padrão. Comportamento de sempre: o celular grava a posição.
--     'manual'   — simulação: o aluno posiciona o próprio posto no mapa (toque
--                  longo → "Posicionar-me aqui", ou arrastando o símbolo).
--     'externa'  — simulador: quem grava é um serviço de integração, fora do
--                  celular. O aluno NÃO grava posição própria. Nada de
--                  simulador existe ainda; o valor está aqui para que a porta
--                  não exija nova migration quando ele chegar.
--
--   posicoes_atuais.origem / posicoes_historico.origem
--     'gps' | 'manual' | 'externa' — de onde veio AQUELA posição. Serve para
--     que uma posição simulada nunca passe por real no debriefing.
--
-- A decisão que importa (e o motivo desta ser migration, não JavaScript)
-- ---------------------------------------------------------------------
-- O modo da turma é validado na POLICY, não na tela. Regra dura 3 do
-- CLAUDE.md: um aluno com o console aberto contorna qualquer toggle, não
-- contorna a RLS. Aqui a policy de escrita de posição passa a exigir que a
-- `origem` gravada seja a do modo da turma — logo, numa turma 'manual' o
-- aluno não consegue mandar posição de GPS, e numa turma 'gps' não consegue
-- se teletransportar. E 'externa' é recusada para o aluno em qualquer modo:
-- quem grava essa origem é a `service_role` (que ignora RLS), a partir de um
-- serviço no servidor — nunca do frontend (regra dura 1).
--
-- Forma copiada: `posicoes_inserir_propria` / `posicoes_atualizar_propria`
-- (0002), com UMA condição a mais. A leitura (`posicoes_ler`) não muda.
--
-- Ponto de atenção para o cliente
-- -------------------------------
-- Se o instrutor trocar o modo no meio do exercício, um celular que ainda
-- acredita no modo antigo passa a receber ERRO (WITH CHECK) ao gravar. É o
-- comportamento certo (a barreira é o banco), mas o cliente precisa reler o
-- modo e se ajustar em vez de insistir. Por isso `turmas` entra no Realtime
-- abaixo.
--
-- Idempotente: pode ser reaplicada sem quebrar nem perder dado.
-- =============================================================================


-- =============================================================================
-- 1. turmas.modo_posicao
-- =============================================================================

alter table public.turmas
  add column if not exists modo_posicao text not null default 'gps';

alter table public.turmas
  drop constraint if exists turmas_modo_posicao_check;
alter table public.turmas
  add constraint turmas_modo_posicao_check
  check (modo_posicao in ('gps', 'manual', 'externa'));

comment on column public.turmas.modo_posicao is
  'De onde vem a posição própria dos alunos desta turma: gps (celular), manual (aluno posiciona no mapa, simulação) ou externa (serviço de integração com simulador; o aluno não grava). Só o instrutor da turma altera (turmas_editar).';


-- =============================================================================
-- 2. origem da posição (atual e histórico)
-- =============================================================================
-- DEFAULT 'gps': toda linha que já existe foi, de fato, gravada pelo GPS.

alter table public.posicoes_atuais
  add column if not exists origem text not null default 'gps';
alter table public.posicoes_atuais
  drop constraint if exists posicoes_atuais_origem_check;
alter table public.posicoes_atuais
  add constraint posicoes_atuais_origem_check
  check (origem in ('gps', 'manual', 'externa'));

alter table public.posicoes_historico
  add column if not exists origem text not null default 'gps';
alter table public.posicoes_historico
  drop constraint if exists posicoes_historico_origem_check;
alter table public.posicoes_historico
  add constraint posicoes_historico_origem_check
  check (origem in ('gps', 'manual', 'externa'));

comment on column public.posicoes_atuais.origem is
  'De onde veio esta posição: gps, manual (simulação) ou externa (simulador). Amarrada ao modo da turma pela policy de escrita.';
comment on column public.posicoes_historico.origem is
  'Copiada de posicoes_atuais pelo trigger fn_arquivar_posicao. Permite separar posição simulada de real no debriefing.';


-- =============================================================================
-- 3. fn_modo_posicao_minha_turma()
-- =============================================================================
-- Mesma forma de fn_minha_turma(): SECURITY DEFINER para a policy poder
-- consultar `turmas` sem esbarrar na própria RLS. Sem turma (instrutor sem
-- turma, por exemplo) o modo é 'gps' — o comportamento de antes desta migration.

create or replace function public.fn_modo_posicao_minha_turma()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select t.modo_posicao
       from public.turmas t
       join public.perfis p on p.turma_id = t.id
      where p.id = auth.uid()),
    'gps'
  );
$$;

revoke all on function public.fn_modo_posicao_minha_turma() from public;
grant execute on function public.fn_modo_posicao_minha_turma() to authenticated;


-- =============================================================================
-- 4. POLICIES DE ESCRITA DE POSIÇÃO
-- =============================================================================
-- Acrescentam duas condições às de 0002:
--   origem = modo da turma      → a origem tem que ser a que a turma pratica
--   origem <> 'externa'         → o aluno nunca escreve a origem do simulador
-- (A segunda não é redundante: numa turma 'externa' a primeira, sozinha,
-- deixaria o aluno gravar origem 'externa'.)

drop policy if exists posicoes_inserir_propria on public.posicoes_atuais;
create policy posicoes_inserir_propria on public.posicoes_atuais
  for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and turma_id is not distinct from public.fn_minha_turma()
    and origem = public.fn_modo_posicao_minha_turma()
    and origem <> 'externa'
  );

drop policy if exists posicoes_atualizar_propria on public.posicoes_atuais;
create policy posicoes_atualizar_propria on public.posicoes_atuais
  for update to authenticated
  using (usuario_id = auth.uid())
  with check (
    usuario_id = auth.uid()
    and turma_id is not distinct from public.fn_minha_turma()
    and origem = public.fn_modo_posicao_minha_turma()
    and origem <> 'externa'
  );


-- =============================================================================
-- 5. TRIGGER DO HISTÓRICO passa a copiar a origem
-- =============================================================================
-- Redefine fn_arquivar_posicao (0001) com UMA coluna a mais. Continua
-- SECURITY DEFINER e continua sendo o único caminho de escrita no histórico.

create or replace function public.fn_arquivar_posicao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.posicoes_historico (
    usuario_id, turma_id, latitude, longitude, altitude_m,
    precisao_m, rumo_graus, velocidade_ms, geom, medido_em, origem
  )
  values (
    new.usuario_id, new.turma_id, new.latitude, new.longitude, new.altitude_m,
    new.precisao_m, new.rumo_graus, new.velocidade_ms, new.geom, new.medido_em,
    new.origem
  );
  return new;
end;
$$;


-- =============================================================================
-- 6. turmas NO REALTIME
-- =============================================================================
-- Para o celular do aluno saber, sem recarregar, que o instrutor trocou o
-- modo. O que chega a cada cliente continua filtrado por `turmas_ler` (só a
-- própria turma / a que o instrutor comanda). Mesmo bloco de 0004/0006/0013.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'turmas'
    ) then
      alter publication supabase_realtime add table public.turmas;
      raise notice 'turmas adicionada à publicação supabase_realtime.';
    end if;
  else
    raise notice 'Publicação supabase_realtime não existe neste banco; pulando.';
  end if;
end $$;
