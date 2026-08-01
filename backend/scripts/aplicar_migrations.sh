#!/usr/bin/env bash
# aplicar_migrations.sh — roda todas as migrations de backend/supabase/*.sql
# em ordem, com um único comando, em vez de colar arquivo por arquivo no SQL
# Editor.
#
# Por que isto e não `supabase db push`
# --------------------------------------
# O `backend/README.md` já documenta o CLI do Supabase (`supabase db push`)
# como caminho recomendado — mas ele espera as migrations dentro de
# `backend/supabase/migrations/`, com nome no formato `AAAAMMDDHHMMSS_nome.sql`
# e uma tabela de controle (`supabase_migrations.schema_migrations`) dizendo o
# que já foi aplicado. Como as migrations deste projeto (`0001`...`0007`)
# sempre foram aplicadas manualmente pelo SQL Editor, essa tabela de controle
# nunca existiu — rodar `supabase db push` do jeito que os arquivos estão
# hoje não aplicaria nada (o CLI não acha migrations em `backend/supabase/`,
# só em `backend/supabase/migrations/`).
#
# Este script contorna isso sem reorganizar nada: usa `psql` puro, e funciona
# porque TODAS as migrations do projeto são escritas para ser IDEMPOTENTES de
# propósito (ver o comentário no topo de cada uma — "rodar duas vezes não
# quebra nem perde dado"): `create table if not exists`, `create type` dentro
# de `do $$ ... exception when duplicate_object then null; end $$`, `drop
# policy if exists` antes de recriar, etc. Ou seja: é seguro rodar este
# script mesmo que algumas migrations já tenham sido aplicadas antes pelo SQL
# Editor — elas simplesmente não fazem nada na segunda vez.
#
# Como usar
# ---------
#   1. Precisa de `psql` instalado (cliente do PostgreSQL; no Windows, vem
#      junto do instalador do PostgreSQL, ou `winget install PostgreSQL.psql`).
#   2. Pegue a connection string do SESSION POOLER (não a "Direct connection",
#      que só resolve IPv6 — ver backend/README.md, "Problemas comuns de
#      conexão"): dashboard do Supabase -> Connect -> aba "Session pooler".
#   3. export DATABASE_URL="postgresql://postgres.<ref>:<SENHA>@aws-0-<regiao>.pooler.supabase.com:5432/postgres"
#      (se a senha tiver @ # / : , troque a senha por uma só com letras e
#      números em Settings -> Database -> Reset database password)
#   4. bash backend/scripts/aplicar_migrations.sh
#
# O script para no primeiro erro real (não idempotência) — não tenta
# continuar aplicando o resto às cegas.

set -euo pipefail

: "${DATABASE_URL:?Defina DATABASE_URL antes de rodar (ver o cabeçalho deste arquivo).}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase" && pwd)"

echo "Aplicando migrations de: $DIR"
echo

for arquivo in "$DIR"/000*.sql; do
  echo "== $(basename "$arquivo") =="
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$arquivo"
  echo
done

echo "Todas as migrations foram aplicadas (as que já estavam em dia não fizeram nada — é o esperado)."
echo
echo "Verificação rápida:"
echo "  select tablename from pg_tables where schemaname = 'public' order by 1;"
echo "  select proname from pg_proc where proname in ('fn_rastro_historico','fn_codigo_turma_valido');"
