-- =============================================================================
-- WartoolC2 — Migration 0007: validar código de turma ANTES do cadastro
--
-- Incremental sobre 0001-0006, que NÃO são reescritas. Idempotente: rodar
-- duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0006_calcos.sql.
--
-- POR QUE ESTA MIGRATION EXISTE
-- -----------------------------
-- A Etapa 11 (deploy) tinha fechado o cadastro por completo (signup desligado
-- no painel + contas só via Admin API), pela leitura de que qualquer
-- autocadastro numa URL pública era risco demais. Decisão revista a pedido:
-- o cadastro volta a ser aberto, mas passa a EXIGIR o código da turma — a
-- "senha do exercício" — já na hora de criar a conta, em vez de a conta
-- nascer solta e entrar na turma TESTE fixa depois.
--
-- Isso é seguro pelo mesmo motivo que já valia desde a Etapa 4.5: uma conta
-- SEM turma não enxerga ninguém e não é enxergada (partido nulo é
-- restritivo, turma nula idem). O código de turma continua sendo a barreira
-- real de quem entra no exercício — só que agora ela é checada no momento
-- certo, não numa RPC separada chamada depois do signUp com um código fixo.
--
-- O PROBLEMA QUE ESTA FUNÇÃO RESOLVE
-- -----------------------------------
-- entrar_na_turma(codigo) (0002) já valida o código — mas ela EXIGE
-- auth.uid(), ou seja, só pode ser chamada por quem já tem sessão. Isso cria
-- uma ordem inevitável: signUp() PRIMEIRO (cria a conta no Supabase Auth),
-- código depois. Se o código estiver errado, a conta já foi criada — sem
-- problema de segurança (fica sem turma, restritiva), mas ruim de UX: a
-- pessoa erra o código, gasta um "usuário" e precisa outro para tentar de
-- novo.
--
-- fn_codigo_turma_valido(codigo) resolve isso: é pública (não exige sessão),
-- só responde SIM/NÃO — nunca devolve o UUID da turma nem qualquer outro
-- dado —, e o formulário de cadastro chama ela ANTES de signUp(), pra avisar
-- "código inválido" sem gastar uma conta. A validação de verdade continua
-- sendo entrar_na_turma() logo depois do signUp(), como já era.
-- =============================================================================

create or replace function public.fn_codigo_turma_valido(p_codigo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.turmas
    where codigo_acesso = p_codigo and ativa
  );
$$;

revoke all on function public.fn_codigo_turma_valido(text) from public;
-- `anon` (não só `authenticated`): precisa funcionar ANTES do login, no
-- próprio formulário de cadastro.
grant execute on function public.fn_codigo_turma_valido(text) to anon, authenticated;

-- =============================================================================
-- Verificação rápida depois de aplicar
-- =============================================================================
--   select public.fn_codigo_turma_valido('código-real-da-turma');   -- true
--   select public.fn_codigo_turma_valido('qualquer-coisa');         -- false
--
-- LEMBRETE OPERACIONAL, não desta migration: se `codigo_acesso` da turma
-- ainda for 'TESTE' (fácil de adivinhar), troque por algo não óbvio antes de
-- divulgar a URL publicada — é ele que faz o papel de "senha do exercício":
--   update public.turmas set codigo_acesso = 'algo-não-adivinhável' where nome = '...';
