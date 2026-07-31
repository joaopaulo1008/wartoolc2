-- =============================================================================
-- WartoolC2 — Migration 0001: schema inicial
-- Etapa 1 do docs/ROADMAP.md
--
-- Cria: turmas, perfis (usuários + papéis), posições GPS (atual + histórico),
--       marcações de posição inimiga e permissões (turma + override por usuário).
--
-- As regras de Row Level Security ficam na migration 0002_rls.sql.
-- Aplicar nesta ordem: 0001 -> 0002.
-- =============================================================================

create extension if not exists "postgis";
create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. TIPOS
-- =============================================================================

-- Papel do usuário dentro do sistema.
do $$ begin
  create type papel_usuario as enum ('instrutor', 'usuario');
exception when duplicate_object then null;
end $$;

-- Hostilidade conforme APP-6 (usada nas marcações).
do $$ begin
  create type hostilidade_marcacao as enum (
    'hostil',        -- H
    'suspeito',      -- S
    'neutro',        -- N
    'amigo',         -- F
    'desconhecido'   -- U
  );
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- 2. FUNÇÃO UTILITÁRIA — atualizar_em automático
-- =============================================================================

create or replace function public.fn_tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- Preenche a coluna `geom` (PostGIS) a partir de latitude/longitude.
-- Estratégia híbrida: latitude/longitude são a fonte de verdade lida direto
-- pelo frontend (Leaflet); `geom` existe apenas para consultas espaciais
-- (geocerca, raio, proximidade) e é derivada automaticamente.
create or replace function public.fn_sincronizar_geom()
returns trigger
language plpgsql
as $$
begin
  if new.latitude is null or new.longitude is null then
    new.geom := null;
  else
    new.geom := st_setsrid(st_makepoint(new.longitude, new.latitude), 4326)::geography;
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 3. TURMAS
-- =============================================================================
-- Uma turma é a unidade de isolamento do sistema: um exercício/instrução com
-- um instrutor responsável e um conjunto de alunos. Instrutor enxerga e edita
-- tudo da SUA turma; aluno enxerga apenas a turma da qual participa.

create table if not exists public.turmas (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  descricao         text,
  -- Instrutor responsável. Referencia perfis, criado logo abaixo (FK adicionada
  -- ao final do arquivo para resolver a dependência circular turmas <-> perfis).
  instrutor_id      uuid,
  -- Código curto que o aluno digita para entrar na turma (ex.: "5BDA-2026").
  codigo_acesso     text unique not null,
  ativa             boolean not null default true,
  criada_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on table public.turmas is
  'Turma/exercício de instrução. Unidade de isolamento de dados entre grupos.';
comment on column public.turmas.codigo_acesso is
  'Código curto informado pelo aluno para ingressar na turma.';

create index if not exists idx_turmas_instrutor on public.turmas (instrutor_id);
create index if not exists idx_turmas_ativa on public.turmas (ativa) where ativa;

drop trigger if exists trg_turmas_atualizado_em on public.turmas;
create trigger trg_turmas_atualizado_em
  before update on public.turmas
  for each row execute function public.fn_tocar_atualizado_em();

-- =============================================================================
-- 4. PERFIS (usuários e papéis)
-- =============================================================================
-- Espelha auth.users (gerenciado pelo Supabase Auth) com os dados de domínio:
-- papel, turma, nome de guerra e o símbolo NATO que representa o usuário no mapa.

create table if not exists public.perfis (
  -- Mesmo id de auth.users: 1 perfil por conta.
  id                uuid primary key references auth.users (id) on delete cascade,
  turma_id          uuid references public.turmas (id) on delete set null,
  papel             papel_usuario not null default 'usuario',
  nome_completo     text not null,
  -- Nome de guerra / identificação exibida no mapa junto ao símbolo.
  nome_guerra       text,
  -- Posto/graduação (ex.: 'Cap', 'Sgt', '3º Sgt'). Texto livre por ora.
  posto_graduacao   text,
  -- Código SIDC de 20 dígitos (APP-6D) do símbolo que representa este usuário
  -- no mapa. Mesmo formato que `getSIDC()` monta hoje em frontend/index.html:
  --   10 | hostilidade(2) | dimensao(2) | situacao(1) | hqtf(1) | escalao(2) | natureza(10)
  -- Padrão: amigo (03) + unidade (10) + confirmada (0) + sem hqtf (0) + sem escalão (00).
  sidc              text not null default '10031000000000000000'
                    check (sidc ~ '^[0-9]{20}$'),
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on table public.perfis is
  'Dados de domínio de cada conta do Supabase Auth: papel, turma e símbolo militar.';
comment on column public.perfis.papel is
  'instrutor = controla a turma; usuario = aluno em campo.';
comment on column public.perfis.sidc is
  'SIDC APP-6D de 20 dígitos usado pelo milsymbol para desenhar o avatar do usuário. Mesmo formato de getSIDC() em frontend/index.html.';

create index if not exists idx_perfis_turma on public.perfis (turma_id);
create index if not exists idx_perfis_papel on public.perfis (papel);

drop trigger if exists trg_perfis_atualizado_em on public.perfis;
create trigger trg_perfis_atualizado_em
  before update on public.perfis
  for each row execute function public.fn_tocar_atualizado_em();

-- Fecha a dependência circular: turmas.instrutor_id -> perfis.id
alter table public.turmas
  drop constraint if exists fk_turmas_instrutor;
alter table public.turmas
  add constraint fk_turmas_instrutor
  foreign key (instrutor_id) references public.perfis (id) on delete set null;

-- Cria automaticamente um perfil quando uma conta nova é criada no Auth.
-- Os metadados vêm do signUp do cliente (options.data).
create or replace function public.fn_criar_perfil_para_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome_completo, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome_completo', new.email, 'Sem nome'),
    coalesce((new.raw_user_meta_data ->> 'papel')::papel_usuario, 'usuario')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_novo_usuario on auth.users;
create trigger trg_auth_novo_usuario
  after insert on auth.users
  for each row execute function public.fn_criar_perfil_para_novo_usuario();

-- =============================================================================
-- 5. POSIÇÕES GPS — ATUAL
-- =============================================================================
-- Uma linha por usuário, sobrescrita a cada atualização do celular.
-- É esta tabela que o mapa assina via Supabase Realtime (payload pequeno,
-- poucas linhas, ideal para 60+ clientes simultâneos).

create table if not exists public.posicoes_atuais (
  usuario_id        uuid primary key references public.perfis (id) on delete cascade,
  turma_id          uuid references public.turmas (id) on delete set null,
  latitude          double precision not null check (latitude between -90 and 90),
  longitude         double precision not null check (longitude between -180 and 180),
  -- Altitude em metros (pode vir nula do navegador).
  altitude_m        double precision,
  -- Precisão horizontal reportada pelo GPS, em metros.
  precisao_m        double precision check (precisao_m is null or precisao_m >= 0),
  -- Rumo em graus (0 = norte, sentido horário) e velocidade em m/s.
  rumo_graus        double precision check (rumo_graus is null or rumo_graus between 0 and 360),
  velocidade_ms     double precision check (velocidade_ms is null or velocidade_ms >= 0),
  -- Nível de bateria do dispositivo (0..100), útil para o instrutor.
  bateria_pct       smallint check (bateria_pct is null or bateria_pct between 0 and 100),
  -- Derivada de latitude/longitude por trigger. Não escrever manualmente.
  geom              geography(Point, 4326),
  -- Momento da leitura no dispositivo vs. momento da gravação no servidor.
  medido_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on table public.posicoes_atuais is
  'Última posição conhecida de cada usuário. Uma linha por usuário, sobrescrita. Fonte do mapa ao vivo (Realtime).';
comment on column public.posicoes_atuais.geom is
  'Ponto PostGIS derivado de latitude/longitude por trigger. Uso interno para consultas espaciais.';

create index if not exists idx_posicoes_atuais_turma on public.posicoes_atuais (turma_id);
create index if not exists idx_posicoes_atuais_geom on public.posicoes_atuais using gist (geom);

drop trigger if exists trg_posicoes_atuais_geom on public.posicoes_atuais;
create trigger trg_posicoes_atuais_geom
  before insert or update of latitude, longitude on public.posicoes_atuais
  for each row execute function public.fn_sincronizar_geom();

drop trigger if exists trg_posicoes_atuais_atualizado_em on public.posicoes_atuais;
create trigger trg_posicoes_atuais_atualizado_em
  before update on public.posicoes_atuais
  for each row execute function public.fn_tocar_atualizado_em();

-- =============================================================================
-- 6. POSIÇÕES GPS — HISTÓRICO
-- =============================================================================
-- Append-only. Permite reconstituir o rastro de cada usuário depois do
-- exercício (replay/debriefing). Alimentado por trigger a partir de
-- posicoes_atuais — o cliente escreve em UM lugar só.

create table if not exists public.posicoes_historico (
  id                bigserial primary key,
  usuario_id        uuid not null references public.perfis (id) on delete cascade,
  turma_id          uuid references public.turmas (id) on delete set null,
  latitude          double precision not null,
  longitude         double precision not null,
  altitude_m        double precision,
  precisao_m        double precision,
  rumo_graus        double precision,
  velocidade_ms     double precision,
  geom              geography(Point, 4326),
  medido_em         timestamptz not null default now(),
  registrado_em     timestamptz not null default now()
);

comment on table public.posicoes_historico is
  'Rastro histórico (append-only) das posições GPS. Preenchido automaticamente a partir de posicoes_atuais.';

create index if not exists idx_hist_usuario_tempo
  on public.posicoes_historico (usuario_id, medido_em desc);
create index if not exists idx_hist_turma_tempo
  on public.posicoes_historico (turma_id, medido_em desc);
create index if not exists idx_hist_geom
  on public.posicoes_historico using gist (geom);

-- Copia toda gravação de posicoes_atuais para o histórico.
create or replace function public.fn_arquivar_posicao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.posicoes_historico (
    usuario_id, turma_id, latitude, longitude, altitude_m,
    precisao_m, rumo_graus, velocidade_ms, geom, medido_em
  )
  values (
    new.usuario_id, new.turma_id, new.latitude, new.longitude, new.altitude_m,
    new.precisao_m, new.rumo_graus, new.velocidade_ms, new.geom, new.medido_em
  );
  return new;
end;
$$;

drop trigger if exists trg_arquivar_posicao on public.posicoes_atuais;
create trigger trg_arquivar_posicao
  after insert or update on public.posicoes_atuais
  for each row execute function public.fn_arquivar_posicao();

-- =============================================================================
-- 7. MARCAÇÕES DE POSIÇÃO INIMIGA
-- =============================================================================
-- Criadas pelos usuários tocando no mapa. Compartilhadas com toda a turma.
-- Exclusão é lógica (removida_em), para o instrutor conseguir auditar depois.

create table if not exists public.marcacoes_inimigas (
  id                uuid primary key default gen_random_uuid(),
  turma_id          uuid not null references public.turmas (id) on delete cascade,
  -- Quem criou a marcação.
  autor_id          uuid not null references public.perfis (id) on delete cascade,
  latitude          double precision not null check (latitude between -90 and 90),
  longitude         double precision not null check (longitude between -180 and 180),
  geom              geography(Point, 4326),
  -- Símbolo APP-6D de 20 dígitos (mesmo formato de perfis.sidc).
  -- Padrão: hostil (06) + unidade (10).
  sidc              text not null default '10061000000000000000'
                    check (sidc ~ '^[0-9]{20}$'),
  hostilidade       hostilidade_marcacao not null default 'hostil',
  -- Rótulo curto exibido no mapa e observações livres.
  titulo            text not null default 'Inimigo',
  descricao         text,
  -- Efetivo/quantidade estimada e nível de confiança da informação (1..5).
  efetivo_estimado  text,
  confianca         smallint check (confianca is null or confianca between 1 and 5),
  -- Exclusão lógica.
  removida_em       timestamptz,
  removida_por      uuid references public.perfis (id) on delete set null,
  criada_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on table public.marcacoes_inimigas is
  'Marcações de posição inimiga criadas pelos usuários no mapa, compartilhadas na turma.';
comment on column public.marcacoes_inimigas.removida_em is
  'Exclusão lógica: quando preenchido, a marcação não deve ser exibida no mapa.';

create index if not exists idx_marcacoes_turma
  on public.marcacoes_inimigas (turma_id) where removida_em is null;
create index if not exists idx_marcacoes_autor on public.marcacoes_inimigas (autor_id);
create index if not exists idx_marcacoes_geom on public.marcacoes_inimigas using gist (geom);

drop trigger if exists trg_marcacoes_geom on public.marcacoes_inimigas;
create trigger trg_marcacoes_geom
  before insert or update of latitude, longitude on public.marcacoes_inimigas
  for each row execute function public.fn_sincronizar_geom();

drop trigger if exists trg_marcacoes_atualizado_em on public.marcacoes_inimigas;
create trigger trg_marcacoes_atualizado_em
  before update on public.marcacoes_inimigas
  for each row execute function public.fn_tocar_atualizado_em();

-- =============================================================================
-- 8. PERMISSÕES (camadas e funções habilitadas)
-- =============================================================================
-- Duas camadas de configuração:
--   permissoes_turma   -> padrão aplicado a todos os alunos da turma
--   permissoes_usuario -> override individual (só o que o instrutor mudou)
-- A resolução final é feita pela view `vw_permissoes_efetivas` (override vence).

-- Catálogo de chaves de permissão reconhecidas pelo app.
-- Mantido como tabela (e não enum) para poder crescer sem migration.
create table if not exists public.catalogo_permissoes (
  chave             text primary key,
  descricao         text not null,
  -- 'funcao' = ação na interface; 'camada' = visibilidade de camada do mapa.
  categoria         text not null check (categoria in ('funcao', 'camada')),
  -- Valor aplicado quando não há configuração nem na turma nem no usuário.
  padrao            boolean not null default true
);

comment on table public.catalogo_permissoes is
  'Catálogo das chaves de permissão que o app conhece (funções e camadas).';

insert into public.catalogo_permissoes (chave, descricao, categoria, padrao) values
  ('ver_mapa',                'Abrir o mapa tático',                              'funcao', true),
  ('ver_propria_posicao',     'Ver o próprio avatar no mapa',                     'funcao', true),
  ('ver_posicao_outros',      'Ver a posição dos demais usuários da turma',       'funcao', true),
  ('enviar_posicao_gps',      'Enviar a própria posição de GPS ao servidor',      'funcao', true),
  ('criar_marcacao_inimiga',  'Criar marcações de posição inimiga',               'funcao', true),
  ('editar_marcacao_propria', 'Editar/remover as próprias marcações',             'funcao', true),
  ('ver_marcacoes_outros',    'Ver marcações inimigas criadas por outros',        'funcao', true),
  ('trocar_mapa_base',        'Trocar a camada de fundo do mapa',                 'funcao', true),
  ('carregar_kml',            'Carregar arquivos KML/KMZ próprios',               'funcao', false),
  ('carregar_imagem_geo',     'Carregar imagem georreferenciada própria',         'funcao', false),
  ('ver_historico_rastro',    'Ver o rastro histórico de posições',               'funcao', false),
  ('camada_manobra',          'Camada de manobra (calcos e medidas de coord.)',   'camada', true),
  ('camada_inimigo',          'Camada de dispositivo inimigo',                    'camada', true),
  ('camada_logistica',        'Camada de logística',                              'camada', false),
  ('camada_obstaculos',       'Camada de obstáculos e barreiras',                 'camada', false),
  ('camada_bdgex',            'Carta topográfica BDGEx 1:50.000',                 'camada', true)
on conflict (chave) do nothing;

-- Padrão da turma.
create table if not exists public.permissoes_turma (
  turma_id          uuid not null references public.turmas (id) on delete cascade,
  chave             text not null references public.catalogo_permissoes (chave) on delete cascade,
  habilitada        boolean not null,
  definida_por      uuid references public.perfis (id) on delete set null,
  atualizado_em     timestamptz not null default now(),
  primary key (turma_id, chave)
);

comment on table public.permissoes_turma is
  'Permissão padrão aplicada a todos os alunos de uma turma. Definida pelo instrutor.';

drop trigger if exists trg_perm_turma_atualizado_em on public.permissoes_turma;
create trigger trg_perm_turma_atualizado_em
  before update on public.permissoes_turma
  for each row execute function public.fn_tocar_atualizado_em();

-- Override individual (vence sobre o padrão da turma).
create table if not exists public.permissoes_usuario (
  usuario_id        uuid not null references public.perfis (id) on delete cascade,
  chave             text not null references public.catalogo_permissoes (chave) on delete cascade,
  habilitada        boolean not null,
  definida_por      uuid references public.perfis (id) on delete set null,
  atualizado_em     timestamptz not null default now(),
  primary key (usuario_id, chave)
);

comment on table public.permissoes_usuario is
  'Override individual de permissão. Tem precedência sobre permissoes_turma.';

drop trigger if exists trg_perm_usuario_atualizado_em on public.permissoes_usuario;
create trigger trg_perm_usuario_atualizado_em
  before update on public.permissoes_usuario
  for each row execute function public.fn_tocar_atualizado_em();

-- Resolução final: override do usuário > padrão da turma > padrão do catálogo.
-- Instrutor sempre recebe tudo habilitado.
create or replace view public.vw_permissoes_efetivas as
select
  p.id                                   as usuario_id,
  p.turma_id,
  c.chave,
  c.categoria,
  case
    when p.papel = 'instrutor' then true
    else coalesce(pu.habilitada, pt.habilitada, c.padrao)
  end                                    as habilitada,
  case
    when p.papel = 'instrutor' then 'papel_instrutor'
    when pu.habilitada is not null then 'override_usuario'
    when pt.habilitada is not null then 'padrao_turma'
    else 'padrao_catalogo'
  end                                    as origem
from public.perfis p
cross join public.catalogo_permissoes c
left join public.permissoes_usuario pu
  on pu.usuario_id = p.id and pu.chave = c.chave
left join public.permissoes_turma pt
  on pt.turma_id = p.turma_id and pt.chave = c.chave;

comment on view public.vw_permissoes_efetivas is
  'Permissão final de cada usuário: override individual > padrão da turma > padrão do catálogo. Instrutor recebe tudo.';

-- =============================================================================
-- 9. REALTIME
-- =============================================================================
-- Publica as tabelas que o cliente precisa assinar ao vivo.
-- REPLICA IDENTITY FULL é necessário para que o payload de UPDATE/DELETE
-- traga a linha antiga (usado pelo filtro por turma no cliente).

alter table public.posicoes_atuais     replica identity full;
alter table public.marcacoes_inimigas  replica identity full;
alter table public.permissoes_usuario  replica identity full;
alter table public.permissoes_turma    replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.posicoes_atuais;
    alter publication supabase_realtime add table public.marcacoes_inimigas;
    alter publication supabase_realtime add table public.permissoes_usuario;
    alter publication supabase_realtime add table public.permissoes_turma;
  end if;
exception when duplicate_object then
  null;
end $$;
