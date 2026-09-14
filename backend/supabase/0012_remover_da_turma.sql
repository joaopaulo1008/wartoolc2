-- =============================================================================
-- WartoolC2 — Migration 0012: tirar um aluno da turma, pelo painel
--
-- Incremental sobre 0001..0011, que NÃO são reescritas. Idempotente: rodar
-- duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0011_alvo_altitude_dimensoes.sql.
--
-- POR QUE ESTA MIGRATION EXISTE — E POR QUE ELA NÃO DEVERIA PRECISAR EXISTIR
-- --------------------------------------------------------------------------
-- Pedido de quem conduz a instrução (2026-09-14): "quero poder excluir alunos".
-- A forma escolhida, depois de olhar o custo das três, foi a que NÃO apaga
-- nada: `turma_id = null`. A conta continua, as marcações continuam, o rastro
-- continua, e a pessoa volta digitando o código da turma.
--
-- Isso parecia não exigir migration nenhuma — a policy `perfis_editar_instrutor`
-- (0002) já deixa o instrutor editar os perfis da turma dele, e `turma_id` é só
-- mais uma coluna. **Estava errado, e quem disse foi o Postgres, não o
-- raciocínio.** Rodando o UPDATE contra um banco de verdade
-- (backend/testes/04_teste_perfil_instrutor.sql), ele é recusado com
-- `42501 / new row violates row-level security policy for table "perfis"` —
-- mesmo com o instrutor lotado na turma, e mesmo trocando o `with check` da
-- policy de UPDATE por `true`.
--
-- A BARREIRA É A POLICY DE **SELECT**, NÃO A DE UPDATE
-- -----------------------------------------------------
-- Medido, não deduzido: com `perfis_ler` trocada por `using (true)`, o mesmo
-- UPDATE passa; com o `with check` da policy de UPDATE trocado por `true`, ele
-- continua sendo recusado. Ou seja, o que barra é a linha DEPOIS da alteração
-- deixar de ser visível para quem alterou:
--
--   perfis_ler = id = auth.uid()
--             or (turma_id is not null and turma_id = fn_minha_turma())
--             or fn_sou_instrutor_da_turma(turma_id)
--
-- Com `turma_id` indo a NULO, os três termos ficam falsos para o instrutor: não
-- é a linha dele, não é a turma dele, e `fn_sou_instrutor_da_turma(null)` é
-- falso por construção. A linha some da vista dele no instante em que muda —
-- e o Postgres recusa a escrita em vez de deixar alguém apagar dado para fora
-- do próprio campo de visão.
--
-- Isso não é defeito da 0002: é a proteção funcionando. O caminho certo não é
-- afrouxar `perfis_ler` (alargar leitura para viabilizar escrita seria trocar
-- uma garantia real por conveniência), e sim uma função `security definer`
-- que faz a operação inteira sob a autoridade do banco depois de conferir,
-- ela mesma, quem está chamando. É EXATAMENTE o padrão que a 0002 já usa em
-- `entrar_na_turma()`, e pelo mesmo motivo: a operação atravessa a fronteira
-- do que o chamador enxerga.

-- =============================================================================
-- 1. A FUNÇÃO
-- =============================================================================
-- Confere tudo ANTES de escrever, e cada `raise` diz o que fazer. As quatro
-- guardas, na ordem em que importam:
--
--   1. autenticado — sem isso `auth.uid()` é nulo e nada mais faz sentido;
--   2. quem chama é instrutor DA TURMA em que a pessoa está (não de qualquer
--      turma) — é a mesma pergunta que `perfis_editar_instrutor` faria;
--   3. ninguém se remove — o instrutor sairia da turma que está conduzindo e
--      perderia o painel no meio do exercício;
--   4. instrutor não é removido por aqui — tirar quem conduz a instrução da
--      própria turma é operação de administração, não de painel.
--
-- Idempotente de propósito: remover quem já está sem turma não é erro, é o
-- estado desejado. Dois cliques no botão não podem virar uma exceção na cara
-- de quem está em campo.
create or replace function public.fn_remover_da_turma(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turma uuid;
  v_papel text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;

  if p_usuario = auth.uid() then
    raise exception 'Você não pode remover a si mesmo da turma.'
      using errcode = '42501';
  end if;

  select turma_id, papel into v_turma, v_papel
  from public.perfis where id = p_usuario;

  if not found then
    raise exception 'Usuário não encontrado.' using errcode = '42501';
  end if;

  -- Já está fora: nada a fazer, e isso não é erro.
  if v_turma is null then
    return;
  end if;

  if not public.fn_sou_instrutor_da_turma(v_turma) then
    raise exception 'Somente o instrutor da turma pode remover alguém dela.'
      using errcode = '42501';
  end if;

  if v_papel = 'instrutor' then
    raise exception 'Instrutor não é removido pelo painel.'
      using errcode = '42501';
  end if;

  -- O partido NÃO é zerado aqui de propósito: quem faz isso é
  -- `fn_normalizar_partido_do_perfil` (0003), e a regra dele ("partido é por
  -- turma: sair da turma zera o partido") só dispara quando o partido chega
  -- INALTERADO junto com a troca de turma. Zerar aqui desarmaria o caminho que
  -- já está testado desde a 0003.
  update public.perfis set turma_id = null where id = p_usuario;

  -- A POSIÇÃO ATUAL SAI JUNTO, e só ela.
  --
  -- Sem isto o aluno removido continuaria desenhado no mapa do INSTRUTOR: a
  -- linha de `posicoes_atuais` guarda o `turma_id` de quando foi gravada, e
  -- `posicoes_ler` (0003) deixa o instrutor ver tudo daquela turma. Para os
  -- colegas ele some sozinho (eles dependem de `fn_usuarios_visiveis()`, que
  -- passa a não devolvê-lo) — então o sintoma seria o pior tipo: some para uns
  -- e fica para outros, e quem clicou no botão é justamente quem continuaria
  -- vendo o fantasma.
  --
  -- `posicoes_atuais` é a ÚLTIMA posição, não o histórico. O rastro inteiro
  -- fica em `posicoes_historico`, intocado — é o que sustenta a promessa que o
  -- botão faz na tela ("as marcações e o rastro dele ficam guardados para o
  -- debriefing"). Apagar linha de `posicoes_atuais` também não é novidade: o
  -- painel já faz isso desde a Etapa 6c ("apagar posição fantasma").
  delete from public.posicoes_atuais where usuario_id = p_usuario;
end;
$$;

comment on function public.fn_remover_da_turma(uuid) is
  'Tira um aluno da turma (turma_id = null) e apaga a posição ATUAL dele. Não apaga conta, marcações nem rastro histórico. security definer porque a linha deixa de ser visível para o instrutor no instante em que muda — ver o cabeçalho da 0012.';

revoke all on function public.fn_remover_da_turma(uuid) from public;
grant execute on function public.fn_remover_da_turma(uuid) to authenticated;

-- =============================================================================
-- 2. O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
-- =============================================================================
--   * Não afrouxa `perfis_ler`. Ver o cabeçalho: alargar leitura para viabilizar
--     escrita trocaria uma garantia real por conveniência de interface.
--   * Não apaga conta. Isso exigiria a `service_role` (Admin API, nunca no
--     navegador) e, pelos `on delete cascade` de `elementos_marcados.autor_id`,
--     `posicoes_historico.usuario_id` e `calcos.autor_id`, levaria o debriefing
--     daquele aluno junto. Se um dia for preciso, é script em `backend/`, com
--     confirmação, e não botão de painel.
--   * Não usa `perfis.ativo`. A coluna existe desde a 0001 e ninguém escreve
--     nela; fazê-la VALER exigiria mexer em `fn_usuarios_visiveis()`, que é o
--     que toda policy de posição e marcação consulta — e que a Etapa 6.5 já
--     vai reescrever. Duas mãos no mesmo corpo de função, em etapas diferentes,
--     é como se perde uma regra de visibilidade sem ninguém notar.
--   * Não protege `perfis.sidc` contra o próprio dono. Medido na 04: pela API,
--     com o token dele, um aluno CONSEGUE trocar o próprio símbolo — a decisão
--     da 9b ("símbolo é atribuição, não preferência") vale para a interface,
--     que não oferece o caminho, mas não está no banco. Fechar isso é uma linha
--     em `fn_proteger_campos_do_perfil`; ficou de fora desta migration porque é
--     decisão de escopo de quem conduz a instrução, não consequência do pedido.
