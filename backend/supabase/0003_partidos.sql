-- =============================================================================
-- WartoolC2 — Migration 0003: partidos e hostilidade relativa
-- Etapa 4.5 do docs/ROADMAP.md
--
-- POR QUE ESTA MIGRATION EXISTE (é correção, não conforto):
--   Em 0001, `marcacoes_inimigas.hostilidade` era gravada como fato ABSOLUTO.
--   Com Força Azul e Força Vermelha no mesmo exercício, o mesmo pelotão é
--   hostil para uma e amigo para a outra. Gravar hostilidade fixa faz a tela
--   do Vermelho mostrar os próprios homens como inimigos.
--   A correção: gravar A QUE PARTIDO O ELEMENTO PERTENCE e derivar a
--   hostilidade na RENDERIZAÇÃO, em função de quem está olhando
--   (frontend/simbolos.js, função hostilidadeRelativa()).
--
-- O QUE ELA FAZ:
--   1. Tabela `partidos` (por turma, extensível — Azul e Vermelho como seed).
--   2. `perfis.partido_id` e `perfis.preferencias_visualizacao` (jsonb).
--   3. Renomeia `marcacoes_inimigas` -> `elementos_marcados`, trocando a
--      coluna `hostilidade` (absoluta) por `partido_id` (relativa).
--   4. `fn_usuarios_visiveis()` — PONTO ÚNICO DE MUDANÇA da visibilidade.
--   5. Reescreve as policies de posições, histórico e marcações para
--      chamarem essa função em vez de inlinar `turma_id = fn_minha_turma()`.
--
-- INCREMENTAL: aplicar DEPOIS de 0001 e 0002, que NÃO são reescritas.
-- Este arquivo é idempotente: pode ser reaplicado sem quebrar nem perder dado.
--
-- ATENÇÃO ao reaplicar 0001 depois desta migration: a seção 9 (Realtime) de
-- 0001 referencia `public.marcacoes_inimigas`, que deixa de existir aqui. Se
-- precisar reaplicar 0001 num banco já com 0003, rode 0003 logo em seguida —
-- a seção 8 abaixo reconcilia a publicação.
-- =============================================================================

-- =============================================================================
-- 1. PARTIDOS
-- =============================================================================
-- Tabela, não enum — pelo mesmo motivo de `catalogo_permissoes`: uma terceira
-- força, um partido "civil" ou um "verde/neutro" entram com um INSERT, sem
-- migration nova.
--
-- O partido é POR TURMA (e não global) porque a turma é a unidade de
-- isolamento do sistema: o "Azul" do exercício de blindados não é o mesmo
-- "Azul" do exercício de montanha, e não faz sentido um vazar no outro.

create table if not exists public.partidos (
  id                uuid primary key default gen_random_uuid(),
  turma_id          uuid not null references public.turmas (id) on delete cascade,
  nome              text not null,
  -- Como este partido se relaciona com os OUTROS na derivação de hostilidade:
  --   'beligerante' -> hostil para os demais beligerantes, amigo para o próprio
  --   'neutro'      -> neutro para todo mundo (verde, civil, ONG, imprensa...)
  -- É o que permite acrescentar um partido "civil" sem tocar em código.
  tipo              text not null default 'beligerante'
                    check (tipo in ('beligerante', 'neutro')),
  -- Cor de apoio para a interface (legenda, filtros, painel do instrutor).
  -- NÃO é a cor do símbolo militar: essa vem do dígito de hostilidade do SIDC,
  -- derivado em tempo de renderização — ver frontend/simbolos.js.
  cor               text not null default '#4a90d9'
                    check (cor ~ '^#[0-9a-fA-F]{6}$'),
  -- Ordem de exibição nas listas/filtros.
  ordem             smallint not null default 0,
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (turma_id, nome)
);

comment on table public.partidos is
  'Partido (força) dentro de uma turma: Azul, Vermelho, Verde/neutro, civil... Tabela e não enum, para crescer com INSERT. A hostilidade NÃO é gravada: é derivada do par (partido de quem olha, partido do elemento).';
comment on column public.partidos.tipo is
  'beligerante = hostil para os demais beligerantes; neutro = neutro para todos. Ver hostilidadeRelativa() em frontend/simbolos.js.';
comment on column public.partidos.cor is
  'Cor de apoio da interface (legenda/filtros). A cor do SÍMBOLO vem do dígito de hostilidade do SIDC, que é relativo ao observador.';

create index if not exists idx_partidos_turma on public.partidos (turma_id) where ativo;

drop trigger if exists trg_partidos_atualizado_em on public.partidos;
create trigger trg_partidos_atualizado_em
  before update on public.partidos
  for each row execute function public.fn_tocar_atualizado_em();

-- Seed: Azul e Vermelho em toda turma que já existe.
-- `on conflict do nothing` sobre a unique (turma_id, nome) torna reaplicável.
insert into public.partidos (turma_id, nome, tipo, cor, ordem)
select t.id, v.nome, v.tipo, v.cor, v.ordem
from public.turmas t
cross join (values
  ('Azul',     'beligerante', '#1a5296', 1),
  ('Vermelho', 'beligerante', '#c0392b', 2)
) as v(nome, tipo, cor, ordem)
on conflict (turma_id, nome) do nothing;

-- E nas turmas criadas daqui em diante, pelo mesmo caminho.
create or replace function public.fn_criar_partidos_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.partidos (turma_id, nome, tipo, cor, ordem) values
    (new.id, 'Azul',     'beligerante', '#1a5296', 1),
    (new.id, 'Vermelho', 'beligerante', '#c0392b', 2)
  on conflict (turma_id, nome) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_turmas_partidos_padrao on public.turmas;
create trigger trg_turmas_partidos_padrao
  after insert on public.turmas
  for each row execute function public.fn_criar_partidos_padrao();

-- =============================================================================
-- 2. PERFIS — partido e preferências de visualização
-- =============================================================================

alter table public.perfis
  add column if not exists partido_id uuid references public.partidos (id) on delete set null;

-- Filtros que o USUÁRIO escolhe (o que ele quer ver dentro do que já lhe é
-- permitido). Não confundir com permissão: permissão é o que o INSTRUTOR
-- deixa ver, mora na RLS e não se contorna. Isto aqui é conforto visual, mora
-- numa coluna que o próprio dono edita, e fica no banco (e não no
-- localStorage) para sobreviver a troca de aparelho no meio do exercício.
alter table public.perfis
  add column if not exists preferencias_visualizacao jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.perfis
    add constraint perfis_preferencias_objeto
    check (jsonb_typeof(preferencias_visualizacao) = 'object');
exception when duplicate_object then null;
end $$;

comment on column public.perfis.partido_id is
  'Força a que este usuário pertence dentro da turma. Define o que ele enxerga (fn_usuarios_visiveis) e como os elementos aparecem para ele (hostilidade relativa). Só o instrutor pode alterar.';
comment on column public.perfis.preferencias_visualizacao is
  'Filtros de visualização escolhidos pelo próprio usuário (camadas ligadas, o que esconder). FILTRO, não PERMISSÃO: não é barreira de segurança.';

-- Índice pensado para fn_usuarios_visiveis(), que roda dentro de policy de RLS
-- em TODA leitura de posição — com 60+ usuários mandando GPS a cada poucos
-- segundos, é o caminho mais quente do banco. (turma_id, partido_id) cobre
-- exatamente o predicado da função, e o `include (papel)` evita ir à heap.
create index if not exists idx_perfis_turma_partido
  on public.perfis (turma_id, partido_id) include (papel);

-- =============================================================================
-- 3. PERFIS — proteções de escrita
-- =============================================================================
-- Duas regras novas, ambas necessárias para o partido significar alguma coisa:
--   (a) o ALUNO não muda o próprio partido. Se pudesse, bastaria um UPDATE
--       para o Vermelho virar Azul e ler as posições do Azul — a RLS inteira
--       desta etapa cairia por terra.
--   (b) o INSTRUTOR pode corrigir o partido de quem estiver errado (é a
--       operação normal de organizar o exercício), desde que o partido
--       pertença à turma do perfil.

-- Reescreve a função de 0002 acrescentando a regra do partido. O resto do
-- corpo (papel e turma) é idêntico ao de 0002 — mantido aqui na íntegra
-- porque `create or replace function` substitui o corpo inteiro.
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
    -- NOVO na 0003: partido é atribuição de comando, não escolha do aluno.
    -- A exceção é a troca de turma (RPC entrar_na_turma), que zera o partido
    -- logo abaixo em fn_normalizar_partido_do_perfil() — por isso a checagem
    -- ignora o caso "virou nulo junto com a mudança de turma".
    if new.partido_id is distinct from old.partido_id
       and not (new.partido_id is null
                and new.turma_id is distinct from old.turma_id) then
      raise exception 'Somente o instrutor da turma define o partido.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Coerência partido <-> turma. Roda em INSERT e UPDATE, inclusive para
-- instrutor e service_role: um partido de OUTRA turma na coluna seria um furo
-- silencioso em fn_usuarios_visiveis().
-- Nome com 'v' para rodar DEPOIS de trg_proteger_campos_do_perfil ('p'):
-- o Postgres dispara triggers de mesmo evento em ordem alfabética de nome.
create or replace function public.fn_normalizar_partido_do_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Partido é POR TURMA: sair da turma zera o partido em vez de deixar uma
  -- referência órfã apontando para a força de outro exercício.
  if tg_op = 'UPDATE'
     and new.turma_id is distinct from old.turma_id
     and new.partido_id is not distinct from old.partido_id then
    new.partido_id := null;
  end if;

  if new.partido_id is not null then
    if not exists (
      select 1 from public.partidos pa
      where pa.id = new.partido_id
        and pa.turma_id is not distinct from new.turma_id
    ) then
      raise exception 'O partido informado não pertence à turma deste perfil.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_partido_do_perfil on public.perfis;
create trigger trg_validar_partido_do_perfil
  before insert or update of partido_id, turma_id on public.perfis
  for each row execute function public.fn_normalizar_partido_do_perfil();

-- =============================================================================
-- 4. MARCAÇÕES: marcacoes_inimigas -> elementos_marcados
-- =============================================================================
-- A renomeação é segura AGORA e não vai ser depois: a Etapa 5 (marcação no
-- mapa) ainda não foi escrita e nenhum arquivo de frontend/ referencia esta
-- tabela — verificado por grep em .js/.html antes de escrever esta migration.
-- O nome antigo mentia sobre o modelo novo: a linha não guarda mais "um
-- inimigo", guarda "um elemento observado, pertencente a tal partido" — que
-- pode ser inimigo, amigo ou neutro dependendo de quem olha.

do $$
begin
  if to_regclass('public.marcacoes_inimigas') is not null
     and to_regclass('public.elementos_marcados') is null then
    alter table public.marcacoes_inimigas rename to elementos_marcados;
    raise notice 'Tabela marcacoes_inimigas renomeada para elementos_marcados.';
  end if;
end $$;

-- `alter table ... rename` renomeia a TABELA, mas não as constraints nem os
-- índices que carregam o nome antigo. Os índices de 0001 já nasceram com nome
-- neutro (idx_marcacoes_*), os triggers idem (trg_marcacoes_*); as constraints
-- geradas automaticamente pelo Postgres, não — arrumadas aqui por higiene, para
-- ninguém tropeçar em `marcacoes_inimigas_pkey` daqui a seis meses.
do $$
declare
  r record;
begin
  for r in
    select conname,
           replace(conname, 'marcacoes_inimigas', 'elementos_marcados') as novo
    from pg_constraint
    where conrelid = to_regclass('public.elementos_marcados')
      and conname like 'marcacoes_inimigas%'
  loop
    execute format('alter table public.elementos_marcados rename constraint %I to %I',
                   r.conname, r.novo);
  end loop;

  for r in
    select indexname,
           replace(indexname, 'marcacoes_inimigas', 'elementos_marcados') as novo
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'elementos_marcados'
      and indexname like 'marcacoes_inimigas%'
  loop
    execute format('alter index public.%I rename to %I', r.indexname, r.novo);
  end loop;
end $$;

-- O partido DO ELEMENTO OBSERVADO. É esta coluna que substitui `hostilidade`.
-- Nula = partido não identificado (a informação legítima "vi alguém, não sei
-- de quem é") — renderiza como DESCONHECIDO para qualquer observador.
alter table public.elementos_marcados
  add column if not exists partido_id uuid references public.partidos (id) on delete set null;

comment on table public.elementos_marcados is
  'Elementos observados e marcados no mapa pelos usuários, compartilhados na turma. Guardam o PARTIDO do elemento, não uma hostilidade absoluta: a hostilidade é derivada na renderização em função do partido de quem está olhando.';
comment on column public.elementos_marcados.partido_id is
  'Partido do elemento observado. Nulo = partido não identificado. A hostilidade exibida sai do par (partido do observador, este partido) — ver hostilidadeRelativa() em frontend/simbolos.js.';
comment on column public.elementos_marcados.sidc is
  'SIDC APP-6D de 20 dígitos. Os dígitos 3-4 (hostilidade) gravados aqui são um PLACEHOLDER: o cliente os substitui em tempo de renderização pelo valor relativo ao observador. Quem lê este SIDC cru NÃO deve confiar na hostilidade dele.';
comment on column public.elementos_marcados.removida_em is
  'Exclusão lógica: quando preenchido, a marcação não deve ser exibida no mapa.';

-- O default de 0001 era '1006...' (06 = hostil), coerente com o modelo antigo.
-- Passa a '1001...' (01 = desconhecido): um valor que não afirma nada, já que
-- a afirmação verdadeira agora está em partido_id.
alter table public.elementos_marcados
  alter column sidc set default '10011000000000000000';

-- O título default 'Inimigo' tem o mesmo problema do nome da tabela.
alter table public.elementos_marcados
  alter column titulo set default 'Elemento';

-- A coluna `hostilidade` (enum absoluto) é o que esta migration corrige.
-- Não a apagamos às cegas: se houver linha gravada, o dado é preservado sob o
-- nome `hostilidade_legado` e fica visível para quem for migrar à mão. Na
-- prática a tabela está vazia (a Etapa 5 nunca escreveu nela), e o caminho
-- normal é a coluna simplesmente sair.
do $$
declare
  v_linhas bigint;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'elementos_marcados'
      and column_name = 'hostilidade'
  ) then
    execute 'select count(*) from public.elementos_marcados' into v_linhas;

    if v_linhas = 0 then
      alter table public.elementos_marcados drop column hostilidade;
      raise notice 'Coluna hostilidade removida (tabela vazia): o modelo agora é relativo, via partido_id.';
    else
      alter table public.elementos_marcados rename column hostilidade to hostilidade_legado;
      alter table public.elementos_marcados alter column hostilidade_legado drop not null;
      alter table public.elementos_marcados alter column hostilidade_legado drop default;
      comment on column public.elementos_marcados.hostilidade_legado is
        'OBSOLETA (modelo de hostilidade absoluta, anterior à Etapa 4.5). Preservada porque havia dado gravado. Preencha partido_id e remova esta coluna à mão.';
      raise warning 'A tabela tinha % linha(s): a coluna hostilidade foi preservada como hostilidade_legado. Preencha partido_id e remova a coluna depois.', v_linhas;
    end if;
  end if;
end $$;

-- O enum hostilidade_marcacao de 0001 deixa de ser usado pelo schema. Não é
-- removido: dropar tipo é irreversível e ele não custa nada parado.
comment on type public.hostilidade_marcacao is
  'OBSOLETO desde a Etapa 4.5 (migration 0003). A hostilidade não é mais gravada — é derivada do partido do observador. Mantido apenas para não quebrar dump/restore antigo.';

create index if not exists idx_elementos_marcados_partido
  on public.elementos_marcados (partido_id) where removida_em is null;

-- Mesma coerência partido <-> turma exigida em perfis.
create or replace function public.fn_validar_partido_do_elemento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.partido_id is not null then
    if not exists (
      select 1 from public.partidos pa
      where pa.id = new.partido_id and pa.turma_id = new.turma_id
    ) then
      raise exception 'O partido informado não pertence à turma desta marcação.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_validar_partido_do_elemento on public.elementos_marcados;
create trigger trg_validar_partido_do_elemento
  before insert or update of partido_id, turma_id on public.elementos_marcados
  for each row execute function public.fn_validar_partido_do_elemento();

-- =============================================================================
-- 5. fn_usuarios_visiveis() — O PONTO ÚNICO DE MUDANÇA
-- =============================================================================
-- ESTA FUNÇÃO É O CONTRATO DESTA ETAPA. Leia antes de mexer em qualquer
-- policy de posição ou marcação.
--
-- Ela responde a UMA pergunta: "quais usuários o chamador tem direito de
-- enxergar?". Todas as policies de posicoes_atuais, posicoes_historico e
-- elementos_marcados passam por aqui — nenhuma delas repete a regra.
--
-- HOJE ela devolve: eu mesmo + todo mundo do MEU PARTIDO na MINHA TURMA
-- (+ a turma inteira, se eu for instrutor dela).
--
-- NA ETAPA 6.5 (hierarquia ORBAT) MUDA SÓ O CORPO DESTA FUNÇÃO — passa a
-- consultar a árvore de unidades ("minha unidade + subordinadas") em vez do
-- partido. NENHUMA POLICY PRECISA SER REESCRITA. É esse o mecanismo que
-- mantém a porta aberta; é mais importante que qualquer coluna reservada.
-- Ao trocar o corpo, manter as três invariantes abaixo, ou a RLS afrouxa:
--   (I1) sempre incluir auth.uid() — cada um lê a própria posição;
--   (I2) nunca devolver id de perfil de OUTRA turma para um aluno;
--   (I3) instrutor da turma continua vendo a turma inteira, todos os partidos.
--
-- DESEMPENHO — isto roda dentro de policy, ou seja, em TODA leitura de
-- posição, com 60+ usuários mandando GPS a cada poucos segundos:
--   * É `stable` + `parallel safe`, e nas policies aparece como
--     `x in (select public.fn_usuarios_visiveis())`. Sendo uma subconsulta
--     NÃO correlacionada (não referencia coluna da linha sendo testada), o
--     planejador a executa UMA VEZ por consulta e resolve as linhas por hash
--     — e não uma vez por linha.
--   * O predicado casa com idx_perfis_turma_partido (turma_id, partido_id)
--     include (papel), criado na seção 2.
--   * O ramo de instrutor só toca `turmas` quando o chamador é instrutor.
--   * SECURITY DEFINER: não pode fazer `select` em `perfis` de dentro de uma
--     policy sem isto — a policy de perfis consultaria perfis e recursaria.
--     Mesmo padrão de fn_meu_papel/fn_minha_turma/fn_sou_instrutor (0002).
--     Ao trocar o corpo na 6.5, MANTER security definer.

create or replace function public.fn_meu_partido()
returns uuid
language sql
stable
security definer
parallel safe
set search_path = public
as $$
  select partido_id from public.perfis where id = auth.uid();
$$;

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
  -- (I1) sempre a si mesmo, mesmo sem turma e sem partido.
  select id from eu
  union
  -- Colegas da mesma turma. A regra do partido:
  --   * instrutor lotado na turma vê todos os partidos dela (I3);
  --   * aluno vê quem está no MESMO partido que ele.
  -- Partido nulo NÃO é coringa: quem ainda não foi distribuído numa força não
  -- enxerga ninguém além de si, e não é enxergado por ninguém. É a leitura
  -- restritiva, escolhida de propósito — o preço é que, num banco recém
  -- migrado (onde ninguém tem partido ainda), o mapa fica vazio até o
  -- instrutor distribuir as forças. Ver a seção "Depois de aplicar" em
  -- backend/README.md para o UPDATE que faz isso.
  select p.id
  from public.perfis p, eu
  where p.turma_id is not null
    and p.turma_id = eu.turma_id
    and (
      eu.papel = 'instrutor'
      or (eu.partido_id is not null and p.partido_id = eu.partido_id)
    )
  union
  -- Instrutor responsável por uma turma na qual ele não está lotado
  -- (turmas.instrutor_id) — mesmo alcance que fn_sou_instrutor_da_turma() já
  -- concede em 0002. Sem este ramo, as policies de histórico e marcações
  -- ficariam mais restritas do que eram antes desta migration.
  select p.id
  from public.perfis p
  join public.turmas t on t.id = p.turma_id
  where (select papel from eu) = 'instrutor'
    and t.instrutor_id = auth.uid();
$$;

comment on function public.fn_usuarios_visiveis() is
  'PONTO ÚNICO DE MUDANÇA da visibilidade entre usuários. Hoje: eu + meu partido na minha turma (+ turma inteira, se instrutor dela). Na Etapa 6.5 troca-se SÓ o corpo desta função para consultar a árvore ORBAT — as policies não são reescritas.';

revoke all on function public.fn_meu_partido()      from public;
revoke all on function public.fn_usuarios_visiveis() from public;
grant execute on function public.fn_meu_partido()      to authenticated;
grant execute on function public.fn_usuarios_visiveis() to authenticated;

-- =============================================================================
-- 6. RLS DE PARTIDOS
-- =============================================================================

alter table public.partidos enable row level security;

-- Todo mundo da turma lê a lista de partidos dela. Não é vazamento: saber que
-- "existe um Vermelho" é premissa do exercício; o que precisa ser protegido é
-- QUEM está nele e ONDE está — e isso é perfis/posicoes_atuais, não aqui.
-- A interface precisa desta leitura para mostrar nome e cor na legenda e nos
-- filtros, e para o cliente conseguir derivar a hostilidade relativa.
drop policy if exists partidos_ler on public.partidos;
create policy partidos_ler on public.partidos
  for select to authenticated
  using (
    turma_id = public.fn_minha_turma()
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- Criar/editar/remover partido é organização do exercício: só o instrutor.
drop policy if exists partidos_escrever on public.partidos;
create policy partidos_escrever on public.partidos
  for all to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id))
  with check (public.fn_sou_instrutor_da_turma(turma_id));

-- =============================================================================
-- 7. POLICIES QUE PASSAM A USAR fn_usuarios_visiveis()
-- =============================================================================
-- Todas as trocas abaixo são de LEITURA. As policies de escrita (mandar a
-- própria posição, criar a própria marcação) continuam como em 0002: elas
-- perguntam "isto é meu?", não "quem eu enxergo?" — pergunta diferente,
-- função diferente.
--
-- Em cada uma, `turma_id = fn_minha_turma()` some e no lugar entra
-- `<coluna de usuário> in (select fn_usuarios_visiveis())`. O ramo
-- `fn_sou_instrutor_da_turma(turma_id)` é mantido: ele responde a outra
-- pergunta ("mando nesta turma?") e é o que preserva o alcance do instrutor
-- exatamente como era em 0002.

-- ── posicoes_atuais ────────────────────────────────────────────────────────
drop policy if exists posicoes_ler on public.posicoes_atuais;
create policy posicoes_ler on public.posicoes_atuais
  for select to authenticated
  using (
    usuario_id in (select public.fn_usuarios_visiveis())
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- ── posicoes_historico ─────────────────────────────────────────────────────
-- Cuidado deliberado: NÃO virou "vejo o histórico de todo mundo que eu
-- enxergo". Em 0002, aluno lê só o próprio rastro, e widening isso aqui
-- afrouxaria a RLS por tabela de arrasto — a permissão `ver_historico_rastro`
-- é checada no cliente (Etapa 6b) e cliente não é barreira de segurança.
-- fn_usuarios_visiveis() entra como ESCOPO (o instrutor vê o rastro de quem
-- ele enxerga); o direito continua sendo do instrutor.
drop policy if exists historico_ler on public.posicoes_historico;
create policy historico_ler on public.posicoes_historico
  for select to authenticated
  using (
    usuario_id = auth.uid()
    or (
      public.fn_sou_instrutor_da_turma(turma_id)
      and usuario_id in (select public.fn_usuarios_visiveis())
    )
  );

-- ── elementos_marcados ─────────────────────────────────────────────────────
-- As policies de 0001/0002 acompanharam a tabela na renomeação (policy
-- pertence à tabela), mas são recriadas aqui com o nome novo e com a leitura
-- passando por fn_usuarios_visiveis(). Os nomes antigos (marcacoes_*) são
-- derrubados para não sobrar policy órfã mais permissiva convivendo com a
-- nova — policies do mesmo comando se somam por OR, então uma sobra
-- silenciosa seria exatamente o tipo de afrouxamento que esta etapa não pode
-- introduzir.
drop policy if exists marcacoes_ler              on public.elementos_marcados;
drop policy if exists marcacoes_criar            on public.elementos_marcados;
drop policy if exists marcacoes_editar_propria   on public.elementos_marcados;
drop policy if exists marcacoes_editar_instrutor on public.elementos_marcados;
drop policy if exists marcacoes_remover          on public.elementos_marcados;

-- Você vê as marcações feitas por quem você enxerga. Amarrar no AUTOR (e não
-- na turma) é o que faz o Azul não receber a marcação que o Vermelho fez do
-- próprio dispositivo — que, além de poluir, entregaria a intenção do
-- adversário.
drop policy if exists elementos_ler on public.elementos_marcados;
create policy elementos_ler on public.elementos_marcados
  for select to authenticated
  using (
    autor_id in (select public.fn_usuarios_visiveis())
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

drop policy if exists elementos_criar on public.elementos_marcados;
create policy elementos_criar on public.elementos_marcados
  for insert to authenticated
  with check (
    autor_id = auth.uid()
    and turma_id = public.fn_minha_turma()
  );

drop policy if exists elementos_editar_proprio on public.elementos_marcados;
create policy elementos_editar_proprio on public.elementos_marcados
  for update to authenticated
  using (autor_id = auth.uid())
  with check (
    autor_id = auth.uid()
    and turma_id = public.fn_minha_turma()
  );

drop policy if exists elementos_editar_instrutor on public.elementos_marcados;
create policy elementos_editar_instrutor on public.elementos_marcados
  for update to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id))
  with check (public.fn_sou_instrutor_da_turma(turma_id));

drop policy if exists elementos_remover on public.elementos_marcados;
create policy elementos_remover on public.elementos_marcados
  for delete to authenticated
  using (
    autor_id = auth.uid()
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- =============================================================================
-- 8. REALTIME
-- =============================================================================
-- `alter table ... rename` NÃO tira a tabela da publicação: a publicação
-- guarda o OID, não o nome — então elementos_marcados continua publicada
-- sozinha. Isto aqui é a verificação disso (e o conserto do caso em que 0001
-- foi reaplicado depois de 0003, quando o `add table marcacoes_inimigas`
-- falharia e deixaria a publicação incompleta).

alter table public.elementos_marcados replica identity full;
alter table public.partidos           replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'elementos_marcados'
    ) then
      alter publication supabase_realtime add table public.elementos_marcados;
      raise notice 'elementos_marcados (re)adicionada à publicação supabase_realtime.';
    end if;

    -- Partidos entram na publicação para que renomear/recolorir uma força, ou
    -- criar uma terceira no meio do exercício, chegue ao app sem refresh —
    -- mesma razão de as tabelas de permissão estarem publicadas desde 0001.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'partidos'
    ) then
      alter publication supabase_realtime add table public.partidos;
    end if;
  end if;
end $$;

-- =============================================================================
-- 9. GRANTS
-- =============================================================================
-- RLS filtra LINHAS; o privilégio de TABELA ainda precisa existir. Mesmo
-- critério de 0002: conceder amplo e deixar as policies serem a única barreira.

grant select, insert, update, delete on public.partidos           to authenticated;
grant select, insert, update, delete on public.elementos_marcados to authenticated;
