-- =============================================================================
-- WartoolC2 — Migration 0015: a resposta do instrutor ao pedido de apoio
--
-- Incremental sobre 0001..0014, que NÃO são reescritas. Idempotente.
-- Aplicar DEPOIS de 0014_situacao_e_apoio.sql.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ------------------------------
-- Pergunta de quem conduz a instrução, no dia seguinte à 0014: *"o instrutor
-- pode informar o usuário que está ciente e mandando ajuda?"* Não podia. A
-- 0014 entregou `reconhecido_em`/`reconhecido_por`, e o cartão do aluno dizia
-- apenas "Seu pedido de apoio foi RECONHECIDO".
--
-- **"Reconhecido" é quase nada para quem está em campo.** Não diz quem viu,
-- não diz se alguém saiu, não diz por onde nem em quanto tempo. A pessoa que
-- acionou fica sabendo que a mensagem não se perdeu, e só. Três colunas
-- resolvem: o texto da resposta, e o par que fecha o laço do outro lado.
--
-- NENHUMA POLICY NOVA, E ISSO NÃO É SORTE
-- ----------------------------------------
-- `pedidos_apoio_atualizar` (0014) já libera "o próprio autor OU o instrutor
-- da turma", que é exatamente quem precisa escrever aqui: o instrutor
-- responde, o autor carimba que leu. Acrescentar coluna não muda regra de
-- acesso — mesma postura da 0009 e da 0011.

-- =============================================================================
-- 1. A RESPOSTA
-- =============================================================================
-- 200 caracteres: é um recado operacional ("Vtr socorro saindo do PC, ~10
-- min"), não um relatório. Quem tem mais a dizer usa o rádio — e a tela do
-- aluno diz isso desde a 0014.
alter table public.pedidos_apoio
  add column if not exists resposta text;

alter table public.pedidos_apoio
  add column if not exists respondido_em timestamptz;

alter table public.pedidos_apoio
  add column if not exists respondido_por uuid references public.perfis (id) on delete set null;

-- Quando o AUTOR confirmou que leu. Sem esta coluna o instrutor manda
-- "apoio a caminho" e nunca sabe se chegou a alguém — e a limitação que a
-- 0014 já declara (o navegador congela com a tela apagada) torna isso
-- provável, não teórico. `resposta_vista_em` é a diferença entre "eu mandei"
-- e "ele leu", e é o instrutor quem precisa dessa diferença para decidir se
-- insiste pelo rádio.
alter table public.pedidos_apoio
  add column if not exists resposta_vista_em timestamptz;

comment on column public.pedidos_apoio.resposta is
  'O que o instrutor respondeu a quem pediu apoio ("Ciente, apoio a caminho"). Até 200 caracteres: é recado operacional, não relatório.';
comment on column public.pedidos_apoio.resposta_vista_em is
  'Quando o AUTOR confirmou que leu a resposta. Nulo = mandada mas não confirmada — que com a tela do celular apagada é o caso provável, não o raro. É o que separa "mandei" de "ele leu".';

do $$
begin
  -- O par texto+autoria anda junto, como `reconhecido_em`/`reconhecido_por` na
  -- 0014 e `altitude_m`/`altitude_fonte` na 0011: uma resposta sem nome não
  -- diz a quem obedecer, e um nome sem resposta é sintoma de cliente quebrado.
  if not exists (select 1 from pg_constraint where conname = 'pedidos_apoio_resposta_coerente') then
    alter table public.pedidos_apoio
      add constraint pedidos_apoio_resposta_coerente
      check (
        (resposta is null and respondido_em is null and respondido_por is null)
        or (resposta is not null and respondido_em is not null and respondido_por is not null)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pedidos_apoio_resposta_tamanho') then
    alter table public.pedidos_apoio
      add constraint pedidos_apoio_resposta_tamanho
      check (resposta is null or length(btrim(resposta)) between 1 and 200);
  end if;

  -- Não existe "li uma resposta que não chegou". Sem isto, um cliente com
  -- defeito poderia carimbar leitura numa linha sem resposta, e a faixa do
  -- instrutor mostraria "lido" para uma mensagem que ele nunca mandou — o tipo
  -- de mentira que este projeto recusa desde a Etapa 6b.
  if not exists (select 1 from pg_constraint where conname = 'pedidos_apoio_visto_exige_resposta') then
    alter table public.pedidos_apoio
      add constraint pedidos_apoio_visto_exige_resposta
      check (resposta_vista_em is null or resposta is not null);
  end if;
end $$;

-- =============================================================================
-- 2. O CARIMBO É DO BANCO, NÃO DA BOA VONTADE DO CLIENTE
-- =============================================================================
-- Os `check` acima garantem que o TRIO existe junto, mas não impedem o caso
-- que apareceu ao rodar o teste: trocar só o texto de uma resposta que já
-- tinha autoria deixa `respondido_em` com a hora ANTIGA. A linha continua
-- coerente para o `check` e mentirosa para quem lê — "Ciente, aguarde no
-- local · 14:31" quando a mensagem foi reescrita às 14:48.
--
-- Pior: sem isto, uma resposta NOVA herdaria o `resposta_vista_em` da
-- anterior, e o instrutor veria "lido" para uma correção que a pessoa nunca
-- viu. Num pedido de apoio, é a diferença entre saber e achar que sabe.
--
-- O cliente já faz as duas coisas certas (ver `responderPedido` em
-- frontend/situacao-banco.js). O trigger existe porque "o cliente faz certo"
-- não é garantia: vale para o app de hoje, não para o SQL Editor, nem para o
-- app de amanhã.
create or replace function public.fn_carimbar_resposta_apoio()
returns trigger
language plpgsql
as $$
begin
  if new.resposta is distinct from old.resposta then
    new.respondido_em := now();
    -- Resposta nova zera a confirmação: o "lido" era da mensagem anterior.
    new.resposta_vista_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_carimbar_resposta_apoio on public.pedidos_apoio;
create trigger trg_carimbar_resposta_apoio
  before update of resposta on public.pedidos_apoio
  for each row execute function public.fn_carimbar_resposta_apoio();

-- =============================================================================
-- 3. O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
-- =============================================================================
--   * **Não vira conversa.** Uma coluna guarda UMA resposta: a vigente.
--     Responder de novo sobrescreve, e `respondido_em` diz de quando é. Um
--     chat exigiria tabela de mensagens, ordenação, não-lidas e uma tela
--     própria — e transformaria o recurso em algo para se ficar olhando,
--     quando o que se quer é o contrário: resolver e voltar para o terreno.
--   * **Não notifica fora do app.** Mesma razão da 0014: push exigiria
--     Service Worker, VAPID e servidor, e continuaria sem funcionar com o app
--     fechado em iOS. A resposta aparece quando o aluno tem o app aberto — e
--     `resposta_vista_em` existe justamente para o instrutor saber quando isso
--     NÃO aconteceu, em vez de presumir que aconteceu.
--   * **Não deixa o colega de força responder.** `pedidos_apoio_atualizar`
--     (0014) já restringe a autor e instrutor, e isso continua: quem socorre
--     vai ao local, não manda recado oficial em nome de quem conduz.
--   * Não guarda histórico das respostas anteriores. Se um dia o debriefing
--     precisar de "o que foi respondido e quando, em cada passo", aí é tabela
--     filha — não mais colunas aqui.
