-- =============================================================================
-- 0010 — ÍCONES RÁPIDOS (paleta de marcação definida pelo instrutor)
-- =============================================================================
-- Incremental sobre 0001–0009. Nenhuma migration anterior é reescrita, nenhuma
-- policy existente é alterada.
--
-- O PROBLEMA
-- ----------
-- Desde a Etapa 9b, marcar um elemento custa, no mínimo: tocar o mapa ->
-- categoria -> ícone central (dentro de 434) -> modificador 1 -> modificador 2
-- -> escalão -> partido -> designação -> salvar. O catálogo hierárquico foi a
-- decisão certa (a tabela manual que ele substituiu estava ERRADA em 13 dos 18
-- códigos, e a hierarquia impede combinação inválida) — mas ele é uma
-- ferramenta de precisão, e em campo, com luva, sob chuva, um contato que dura
-- 20 segundos não cabe em oito toques.
--
-- Esta tabela é o atalho: o instrutor monta, para a turma dele, uma paleta
-- pequena de presets prontos ("CC", "VBTP", "Inf Mec"...). O aluno toca no
-- preset e depois no mapa, e a marcação está gravada. O caminho de escrita
-- continua sendo o MESMO `insert` em `elementos_marcados` que marcacoes.js já
-- fazia — não existe segundo caminho para o banco, nem tabela de marcação
-- paralela. O que muda é só de onde vem o SIDC: de oito toques no catálogo, ou
-- de uma linha desta tabela.
--
-- POR QUE UMA TABELA, E NÃO UMA LISTA NO CÓDIGO
-- ---------------------------------------------
-- Uma lista fixa no frontend seria muito mais barata, e foi descartada por um
-- motivo só, mas decisivo: um exercício de reconhecimento, um de logística e
-- um de defesa de área querem paletas diferentes, e quem sabe qual é a certa é
-- quem conduz a instrução — não quem escreve o código. É exatamente o mesmo
-- raciocínio de `catalogo_permissoes` ser linhas e não enum (Etapa 1) e de
-- `partidos` ser tabela e não enum (Etapa 4.5): o que varia por exercício não
-- pode exigir deploy.
--
-- NADA AQUI É PADRÃO NOVO — é recombinação do que as migrations anteriores já
-- estabeleceram:
--   * RLS de escrita restrita ao instrutor da turma + leitura para a turma:
--     `calcos_escrever`/`calcos_ler` (0006).
--   * Exclusão lógica (`removido_em`/`removido_por`): decisão da Etapa 1,
--     reafirmada em `elementos_marcados` (0003) e em `calcos` (0006).
--   * Conjunto padrão criado por trigger em toda turma nova:
--     `fn_criar_partidos_padrao` (0003), que cria Azul e Vermelho.
--   * `check (sidc ~ '^[0-9]{20}$')`: `perfis` e `elementos_marcados` (0001).
--   * Publicação no Realtime com REPLICA IDENTITY FULL: 0001/0004/0006.
--
-- O QUE ESTA MIGRATION NÃO FAZ, DE PROPÓSITO
-- ------------------------------------------
-- Nenhuma chave nova em `catalogo_permissoes`. A paleta é um atalho para criar
-- marcação, e criar marcação JÁ é governado por `criar_marcacao_inimiga`
-- (Etapa 6a) — o aluno que não pode marcar não pode marcar pela paleta
-- tampouco, e o cliente esconde a paleta pela MESMA chave que já esconde o
-- formulário. Uma chave própria daria ao instrutor dois interruptores para a
-- mesma capacidade, que é a forma mais fácil de deixar um aluno num estado que
-- ninguém sabe explicar.

-- =============================================================================
-- 1. TABELA
-- =============================================================================

create table if not exists public.icones_rapidos (
  id           uuid primary key default gen_random_uuid(),
  turma_id     uuid not null references public.turmas (id) on delete cascade,

  -- Rótulo do botão. Curto de propósito: ele divide a largura de um celular
  -- com outros 7 botões e com o símbolo desenhado dentro do próprio botão.
  -- 14 caracteres é o que cabe em duas linhas num botão de ~72px; o cliente
  -- também limita o <input>, mas quem garante é este check.
  rotulo       text not null,

  -- APP-6D de 20 dígitos, o MESMO formato de perfis.sidc e de
  -- elementos_marcados.sidc — é ele que vai, copiado sem transformação
  -- nenhuma, para a marcação criada. O dígito de hostilidade gravado aqui é
  -- placeholder e não significa nada: quem lê sempre passa por
  -- sidcParaObservador() (Etapa 4.5), que recalcula a hostilidade pelo par
  -- (partido de quem olha, partido do elemento).
  sidc         text not null,

  -- CUIDADO — este campo NÃO tem o mesmo significado de `calcos.partido_id`,
  -- e por isso não tem o mesmo nome.
  --   calcos.partido_id        = PARA QUEM o calco é visível (nulo = turma inteira).
  --   icones_rapidos.partido_padrao_id = que partido a marcação criada por
  --                              este preset recebe (nulo = perguntar ao aluno).
  -- A paleta inteira é visível para a turma inteira; não há calco a endereçar
  -- aqui. Um nome igual com semântica oposta em duas tabelas vizinhas é o tipo
  -- de coisa que alguém copia de uma policy para a outra sem reler.
  --
  -- Nulo é o modo "híbrido" pedido: preset com partido definido grava num
  -- toque; preset sem partido abre SÓ o seletor de partido, nada mais. Assim o
  -- instrutor decide, preset a preset, onde a velocidade vale mais que a
  -- confirmação — "CC" é quase sempre hostil, "Viatura" pode ser civil.
  partido_padrao_id uuid references public.partidos (id) on delete set null,

  -- Posição na paleta. Não é unique: empate é desfeito por criado_em, e exigir
  -- unicidade obrigaria o cliente a renumerar a lista inteira para inserir um
  -- item no meio — três UPDATEs viram doze, cada um virando evento de Realtime
  -- para os 60 aparelhos da turma.
  ordem        smallint not null default 100,

  -- Nulo tem significado: "veio da paleta padrão", criada pelo trigger da
  -- seção 4, não por uma pessoa. O painel do instrutor mostra isso em vez de
  -- inventar um autor. Imutável depois de gravado (ver a seção 3).
  criado_por   uuid references public.perfis (id) on delete set null,
  criado_em    timestamptz not null default now(),
  removido_em  timestamptz,
  removido_por uuid references public.perfis (id) on delete set null,

  constraint icones_rapidos_sidc_formato
    check (sidc ~ '^[0-9]{20}$'),
  constraint icones_rapidos_rotulo_tamanho
    check (char_length(btrim(rotulo)) between 1 and 14)
);

comment on table public.icones_rapidos is
  'Paleta de presets de marcação definida pelo instrutor, por turma. Atalho para elementos_marcados: o SIDC daqui é copiado para a marcação criada, sem transformação.';
comment on column public.icones_rapidos.partido_padrao_id is
  'Partido que a MARCAÇÃO criada por este preset recebe; nulo = perguntar ao aluno. NÃO confundir com calcos.partido_id, que diz para quem o calco é visível.';
comment on column public.icones_rapidos.sidc is
  'APP-6D de 20 dígitos. O dígito de hostilidade é placeholder — a hostilidade é relativa e recalculada na renderização (sidcParaObservador).';

-- A paleta é sempre lida inteira, por turma, filtrando o que está vigente —
-- é a única consulta que existe sobre esta tabela.
create index if not exists idx_icones_rapidos_turma
  on public.icones_rapidos (turma_id, ordem, criado_em)
  where removido_em is null;

-- =============================================================================
-- 2. TETO DE TAMANHO DA PALETA
-- =============================================================================
-- Um `check` não consegue contar linhas, então o teto é um trigger.
--
-- Ele existe porque a paleta compete por espaço com o mapa num celular: 12
-- botões já ocupam um cartão inteiro do painel lateral, e uma paleta de 40
-- itens deixa de ser um atalho e vira o mesmo problema de navegação que o
-- catálogo de 434 — só que pior, porque sem hierarquia para filtrar.
--
-- Recusar em vez de aceitar e degradar segue a postura já registrada em
-- LIMITE_FEICOES (Etapa 7) e no teto de tiles (Etapa 8a): dizer não com o
-- motivo, e não deixar o usuário descobrir o limite pelo app travando.
create or replace function public.fn_limitar_icones_rapidos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
begin
  -- Só conta quando a linha em questão vai ficar VIGENTE: editar ou remover um
  -- preset numa paleta que já está no teto não pode ser barrado.
  if new.removido_em is not null then
    return new;
  end if;

  select count(*) into v_total
  from public.icones_rapidos
  where turma_id = new.turma_id
    and removido_em is null
    and id <> new.id;

  if v_total >= 12 then
    raise exception
      'A paleta de ícones rápidos desta turma já tem % itens (máximo 12). Remova um antes de acrescentar outro.', v_total
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_limitar_icones_rapidos on public.icones_rapidos;
create trigger trg_limitar_icones_rapidos
  before insert or update on public.icones_rapidos
  for each row execute function public.fn_limitar_icones_rapidos();

-- =============================================================================
-- 3. RLS
-- =============================================================================

alter table public.icones_rapidos enable row level security;

-- LEITURA: a turma inteira, os dois partidos. Ao contrário de `calcos_ler`,
-- NÃO há recorte por partido — a paleta é uma ferramenta de trabalho, não um
-- dado do exercício: saber que existe um botão "CC" não conta nada a ninguém
-- sobre o que o outro lado está fazendo. E `fn_usuarios_visiveis()` também não
-- entra aqui, pelo mesmo motivo que não entrou em `calcos` (Etapa 7): aquela
-- função responde "quais PESSOAS eu enxergo" e é amarrada ao AUTOR da linha —
-- aqui o autor é sempre o instrutor, então usá-la ou faria a paleta vazar
-- lógica que não é dela, ou a esconderia de todo mundo.
drop policy if exists icones_rapidos_ler on public.icones_rapidos;
create policy icones_rapidos_ler on public.icones_rapidos
  for select to authenticated
  using (
    public.fn_sou_instrutor_da_turma(turma_id)
    or turma_id = public.fn_minha_turma()
  );

-- ESCRITA: só o instrutor da turma. Se o aluno pudesse editar a paleta, a
-- chave `criar_marcacao_inimiga` continuaria valendo (ele ainda precisa de
-- permissão para marcar), mas a AUTORIDADE do instrutor sobre a simbologia da
-- turma — estabelecida na Etapa 9b — cairia: cada aluno teria a própria
-- taxonomia, e o mapa da turma deixaria de ser uma linguagem comum.
--
-- SÃO TRÊS POLICIES, e não um `for all` como em `calcos_escrever` (0006). A
-- diferença não é estilo: um `for all` com
-- `with check (... and criado_por = auth.uid())` aplica essa exigência também
-- ao UPDATE, e aí o instrutor **não consegue editar a paleta PADRÃO** — as
-- linhas que o trigger da seção 4 criou têm `criado_por` nulo, porque não foi
-- pessoa nenhuma que as criou. O resultado seria a função falhando exatamente
-- no caso de uso principal ("a turma nasce com uma paleta e o instrutor
-- ajusta"), e falhando de um jeito difícil de diagnosticar: só nos presets
-- padrão, só no UPDATE, sem erro que explique o motivo. (Apanhado por
-- backend/testes/02_teste_icones_rapidos.sql antes de ir para o ar; `calcos`
-- tem a mesma forma de policy e não sofre disso só porque lá toda linha nasce
-- de um instrutor de verdade.)
--
-- A separação também é a modelagem certa: `criado_por` é carimbo de CRIAÇÃO.
-- Ele se afirma uma vez, na inserção — reafirmá-lo a cada edição diria que
-- "quem edita passa a ser o criador", que é outra coisa.
drop policy if exists icones_rapidos_escrever on public.icones_rapidos;

-- Criar: `criado_por` obrigado a ser quem escreve — mesmo raciocínio de
-- `calcos_escrever` (0006). Sem isso um instrutor cadastraria preset em nome
-- de outro e o painel mentiria sobre quem montou a paleta.
drop policy if exists icones_rapidos_criar on public.icones_rapidos;
create policy icones_rapidos_criar on public.icones_rapidos
  for insert to authenticated
  with check (
    public.fn_sou_instrutor_da_turma(turma_id)
    and criado_por = auth.uid()
  );

-- Editar: instrutor da turma, nos dois lados. O `with check` repete o `using`
-- de propósito — sem ele, um instrutor poderia mover um preset da própria
-- turma para OUTRA turma com um update em `turma_id`, escapando pela porta de
-- saída (a linha some do alcance dele, mas já foi parar lá).
drop policy if exists icones_rapidos_editar on public.icones_rapidos;
create policy icones_rapidos_editar on public.icones_rapidos
  for update to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id))
  with check (public.fn_sou_instrutor_da_turma(turma_id));

-- Remover de verdade. A interface usa exclusão LÓGICA (removido_em, como
-- `calcos` e `elementos_marcados`); este DELETE existe para limpeza
-- administrativa, e restringi-lo custa uma linha.
drop policy if exists icones_rapidos_remover on public.icones_rapidos;
create policy icones_rapidos_remover on public.icones_rapidos
  for delete to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id));

-- `criado_por` é imutável depois de gravado. Um `with check` não consegue
-- garantir isso (não enxerga OLD), então é trigger — mesma escolha, e pelo
-- mesmo motivo, de `fn_carimbar_edicao_do_elemento` na 0009: campo de
-- auditoria que depende de o cliente se comportar é campo que a próxima tela
-- esquece. Nulo continua nulo: é o que marca um preset como "veio da paleta
-- padrão", não de uma pessoa.
create or replace function public.fn_preservar_autor_do_icone()
returns trigger
language plpgsql
as $$
begin
  new.criado_por := old.criado_por;
  new.criado_em  := old.criado_em;
  return new;
end;
$$;

drop trigger if exists trg_preservar_autor_do_icone on public.icones_rapidos;
create trigger trg_preservar_autor_do_icone
  before update on public.icones_rapidos
  for each row execute function public.fn_preservar_autor_do_icone();

-- =============================================================================
-- 4. PALETA PADRÃO EM TODA TURMA NOVA
-- =============================================================================
-- Mesmo padrão de `fn_criar_partidos_padrao` (0003): a turma nasce utilizável,
-- e o instrutor edita o que quiser em vez de partir de uma tela vazia. Sem
-- isto, a função só existiria para quem descobrisse a aba e a configurasse —
-- e a maioria dos exercícios simplesmente não teria paleta.
--
-- ATENÇÃO AO NOME DO TRIGGER (`trg_turmas_z_...`). O Postgres dispara triggers
-- de mesmo timing em ordem ALFABÉTICA de nome, e esta função precisa rodar
-- DEPOIS de `trg_turmas_partidos_padrao` (0003), porque os presets referenciam
-- o partido 'Vermelho' que aquele trigger acabou de criar. O `z_` é o que
-- garante a ordem, e está documentado aqui para ninguém "arrumar" o nome
-- depois. A função ainda assim NÃO depende disso para funcionar: se o partido
-- não for encontrado, os presets entram com partido nulo (modo "perguntar"),
-- que é degradação aceitável, não erro.
--
-- Os SIDCs abaixo NÃO foram escritos à mão. Foram gerados por getSIDC()
-- (frontend/simbolos.js) a partir dos códigos de entidade do catálogo oficial
-- do MD/EB e conferidos de volta por descreverSidc() — o comentário ao lado de
-- cada um é o rótulo oficial que o código realmente significa. Esse cuidado é
-- consequência direta do achado da Etapa 9b: a tabela escrita à mão que o
-- catálogo substituiu errava 13 dos 18 códigos, e "Infantaria Mecanizada"
-- vinha desenhando apoio de fogo havia meses sem ninguém notar.
--
-- Escalão fica em branco ('00') em todos: um preset diz O QUE é, não de que
-- tamanho — forçar "pelotão" faria o aluno gravar um escalão que ele não
-- observou. Quem souber o escalão abre o formulário completo (toque longo).
create or replace function public.fn_criar_icones_rapidos_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vermelho uuid;
begin
  select id into v_vermelho
  from public.partidos
  where turma_id = new.id and nome = 'Vermelho'
  limit 1;

  insert into public.icones_rapidos (turma_id, rotulo, sidc, partido_padrao_id, ordem) values
    (new.id, 'CC',      '10011500001202000000', v_vermelho, 10), -- Carro de Combate
    (new.id, 'VBTP',    '10011500001201030000', v_vermelho, 20), -- Vtr Bld de Transporte de Pessoal
    (new.id, 'Inf',     '10011000001211000000', v_vermelho, 30), -- Infantaria
    (new.id, 'Inf Mec', '10011000001211020000', v_vermelho, 40), -- Infantaria Blindada ou Mecanizada
    (new.id, 'Rec',     '10011000001205010000', v_vermelho, 50), -- Reconhecimento Blindado
    (new.id, 'Art Cmp', '10011000001303000000', v_vermelho, 60), -- Artilharia de Campanha
    (new.id, 'Mrt',     '10011500001114000000', v_vermelho, 70), -- Morteiro
    -- Sem partido de propósito: uma viatura não blindada tanto pode ser do
    -- adversário quanto tráfego civil. É o preset que exercita o modo
    -- "perguntar" e mostra ao instrutor que ele existe.
    (new.id, 'Vtr',     '10011500001401000000', null,       80); -- Vtr operacional não blindada

  return new;
end;
$$;

drop trigger if exists trg_turmas_z_icones_rapidos_padrao on public.turmas;
create trigger trg_turmas_z_icones_rapidos_padrao
  after insert on public.turmas
  for each row execute function public.fn_criar_icones_rapidos_padrao();

-- Turmas que JÁ existiam quando esta migration rodou não passaram pelo trigger.
-- Semeia só as que não têm nenhum preset — assim reaplicar a migration (que é
-- escrita para ser idempotente, como todas deste projeto) não duplica a paleta
-- nem desfaz o que o instrutor já editou.
do $$
declare
  r record;
  v_vermelho uuid;
begin
  for r in
    select t.id from public.turmas t
    where not exists (select 1 from public.icones_rapidos i where i.turma_id = t.id)
  loop
    select id into v_vermelho
    from public.partidos where turma_id = r.id and nome = 'Vermelho' limit 1;

    insert into public.icones_rapidos (turma_id, rotulo, sidc, partido_padrao_id, ordem) values
      (r.id, 'CC',      '10011500001202000000', v_vermelho, 10),
      (r.id, 'VBTP',    '10011500001201030000', v_vermelho, 20),
      (r.id, 'Inf',     '10011000001211000000', v_vermelho, 30),
      (r.id, 'Inf Mec', '10011000001211020000', v_vermelho, 40),
      (r.id, 'Rec',     '10011000001205010000', v_vermelho, 50),
      (r.id, 'Art Cmp', '10011000001303000000', v_vermelho, 60),
      (r.id, 'Mrt',     '10011500001114000000', v_vermelho, 70),
      (r.id, 'Vtr',     '10011500001401000000', null,       80);

    raise notice 'Paleta de ícones rápidos semeada para a turma %.', r.id;
  end loop;
end $$;

-- =============================================================================
-- 5. REALTIME
-- =============================================================================
-- O instrutor acrescenta "VBR" no meio do exercício e o botão aparece nos 60
-- aparelhos sem ninguém recarregar — mesmo efeito (e mesmo mecanismo) que
-- `calcos` tem desde a Etapa 7 e as tabelas de permissão desde a 6a.
--
-- Publicar não alarga o alcance de ninguém: o Realtime aplica a policy de
-- SELECT antes de entregar cada evento.

alter table public.icones_rapidos replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'icones_rapidos'
    ) then
      alter publication supabase_realtime add table public.icones_rapidos;
      raise notice 'icones_rapidos adicionada à publicação supabase_realtime.';
    end if;
  end if;
end $$;

-- =============================================================================
-- 6. GRANTS
-- =============================================================================
-- Como sempre neste projeto: o grant abre a porta, a RLS decide quem passa.

grant select, insert, update, delete on public.icones_rapidos to authenticated;
