-- =============================================================================
-- 0017 — O papel de uma conta nova NÃO vem mais dos metadados do cadastro
-- =============================================================================
-- O defeito (achado em 2026-10-02, reproduzido num Postgres, não no Supabase)
-- ---------------------------------------------------------------------------
-- A trigger `fn_criar_perfil_para_novo_usuario` (0001) criava o perfil de toda
-- conta nova lendo o papel de `auth.users.raw_user_meta_data ->> 'papel'`. No
-- cadastro público, esse JSON é o `options.data` do `supabase.auth.signUp()` —
-- ou seja, é escolhido pelo NAVEGADOR de quem se cadastra. Resultado: qualquer
-- pessoa com a URL e a chave pública do projeto (que são públicas por design)
-- podia chamar signUp com `{ papel: 'instrutor' }` e nascer instrutora, sem
-- código de turma nenhum. O comentário do 0001 dizia o contrário ("papel não é
-- escolhido pelo cliente"); a trigger fazia o oposto.
--
-- A correção
-- ----------
-- A trigger passa a IGNORAR o papel dos metadados: toda conta nasce 'usuario'.
-- Promover alguém a instrutor é um UPDATE em `perfis.papel`, que só passa por:
--   - quem já é instrutor (policy + `fn_proteger_campos_do_perfil`, 0002); ou
--   - a service_role / jobs sem JWT (auth.uid() nulo) — o caso do script
--     backend/seed/criar_usuarios.mjs e da Edge Function `importar-turma`,
--     que já fazem exatamente isso.
-- `nome_completo` continua vindo dos metadados: é só rótulo.
--
-- O que esta migration NÃO faz: não rebaixa ninguém. Contas que já viraram
-- instrutor por este caminho continuam instrutoras. Audite ANTES ou DEPOIS de
-- aplicar (só leitura):
--
--   select p.id, p.nome_guerra, p.nome_completo, u.email, u.created_at, p.turma_id
--     from public.perfis p
--     join auth.users u on u.id = p.id
--    where p.papel = 'instrutor'
--    order by u.created_at;
--
-- Toda linha dessa lista que você não reconhece como instrutor de verdade é
-- suspeita; rebaixe à mão com `update public.perfis set papel = 'usuario' where id = '...'`
-- (e troque a senha ou apague a conta no painel do Supabase).
--
-- Idempotente: CREATE OR REPLACE; rodar duas vezes não quebra nada. Aplicar
-- DEPOIS de 0016. A trigger `trg_auth_novo_usuario` (0001) continua a mesma:
-- só a função muda.
-- =============================================================================

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
    -- Sempre 'usuario'. NUNCA ler o papel de raw_user_meta_data: no signUp
    -- público esse campo é do cliente.
    'usuario'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.fn_criar_perfil_para_novo_usuario() is
  'Cria o perfil de toda conta nova com papel usuario. O papel NÃO é lido dos metadados do cadastro (0017): promover a instrutor é UPDATE por quem já é instrutor ou pela service_role.';
