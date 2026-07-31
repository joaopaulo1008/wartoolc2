-- =============================================================================
-- Stub do ambiente Supabase para testar as migrations num Postgres cru
-- =============================================================================
-- As migrations 0001-0003 dependem de coisas que o Supabase provê pronto e que
-- um Postgres vazio não tem: o schema `auth` com a tabela `users`, a função
-- `auth.uid()` (que lê o JWT da requisição), os papéis `anon` /
-- `authenticated` / `service_role` e a publicação `supabase_realtime`.
--
-- Este arquivo cria o mínimo desses para que 0001, 0002 e 0003 rodem e a RLS
-- possa ser exercitada de verdade. NÃO faz parte do schema do projeto e NÃO
-- deve ser rodado no Supabase — lá tudo isto já existe.
--
-- Como "logar" como um usuário nos testes:
--     set local role authenticated;
--     set local request.jwt.claim.sub = '<uuid do usuário>';
-- e para voltar ao superusuário:  reset role;
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- No Supabase, auth.uid() extrai o `sub` do JWT da requisição. O JWT chega
-- como um GUC (`request.jwt.claims`); aqui usamos o formato antigo e mais
-- simples de setar por psql.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;  exception when duplicate_object then null; end $$;

grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

do $$ begin
  create publication supabase_realtime;
exception when duplicate_object then null;
end $$;
