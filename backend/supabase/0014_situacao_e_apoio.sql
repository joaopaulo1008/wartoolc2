-- =============================================================================
-- WartoolC2 — Migration 0014: situação do usuário e pedido de apoio
--
-- Incremental sobre 0001..0013, que NÃO são reescritas. Idempotente.
-- Aplicar DEPOIS de 0013_anotacoes.sql.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ------------------------------
-- Pedido de quem conduz a instrução (2026-09-15): "o usuário podia ter algum
-- tipo de botão de emergência, e poder escrever uma mensagem de situação que
-- aparecesse no card popup dele".
--
-- DUAS TABELAS, E A SEPARAÇÃO É O PONTO DA MIGRATION
-- ---------------------------------------------------
-- O pedido junta duas coisas que precisam ficar separadas:
--
--   `situacoes`      — o RECADO DO JOGO. "Sem munição", "viatura em pane".
--                      Faz parte do exercício, é autodeclarado, muda o tempo
--                      todo e não é urgente.
--   `pedidos_apoio`  — O PEDIDO DE APOIO. Uma pessoa de verdade, num terreno
--                      de verdade, precisando de alguém. Tem ciclo de vida
--                      (acionado -> reconhecido -> encerrado) e some do mapa
--                      só quando alguém encerra.
--
-- **Se fossem o mesmo mecanismo, no dia do acidente alguém apertaria o botão e
-- quem olha pensaria que é simulação.** Por isso são duas tabelas, dois
-- caminhos e duas cores na tela — e por isso o estado em `situacoes` NUNCA
-- pode incluir um valor tipo 'emergencia': quem precisa de apoio usa o outro
-- caminho.
--
-- O QUE ESTE SISTEMA **NÃO É**, E ISSO PRECISA ESTAR ESCRITO NA TELA
-- ------------------------------------------------------------------
-- Não é um dispositivo de segurança. O navegador CONGELA a página quando a
-- tela do celular apaga — está estabelecido neste projeto desde 2026-09-14
-- (ver "App em segundo plano" no CLAUDE.md): sem tela ligada não há GPS e
-- pode não haver envio. Alguém numa emergência real não vai desbloquear o
-- celular e abrir um app; vai usar o rádio. O cartão do aluno diz isso com
-- todas as letras, e o roteiro de campo repete. **Uma ferramenta que cria
-- confiança que não sustenta é pior do que não existir.**
--
-- POR QUE NÃO É UMA COLUNA EM `perfis`
-- -------------------------------------
-- Foi a primeira ideia — o aluno já pode editar a própria linha
-- (`perfis_editar_proprio`, 0002). **A policy de leitura impede:**
--   perfis_ler = id = auth.uid()
--             or (turma_id is not null and turma_id = fn_minha_turma())
--             or fn_sou_instrutor_da_turma(turma_id)
-- ou seja, a turma INTEIRA lê `perfis`, os dois partidos. Um "sem munição"
-- gravado ali seria legível pelo outro lado por uma chamada de API — o oposto
-- do que se quer de um recado de situação num exercício.
--
-- A forma certa é a de `posicoes_ler` (0003):
--   usuario_id in (select fn_usuarios_visiveis()) or fn_sou_instrutor_da_turma(turma_id)
-- que é exatamente "a minha força e o instrutor", decidido com quem conduz a
-- instrução. As duas tabelas abaixo copiam essa forma.
--
-- E POR QUE NÃO PENDURAR EM `posicoes_atuais`, QUE JÁ TEM ESSA RLS
-- -----------------------------------------------------------------
-- Seria de graça (a tabela já é publicada no Realtime e já é assinada pelas
-- duas telas). Mas **quem não tem linha lá é justamente quem mais precisa
-- falar**: um aluno cujo GPS nunca fixou, ou com `ver_propria_posicao`
-- desligada, não tem linha em `posicoes_atuais` — e ficaria sem como dizer
-- "estou parado, sem sinal" ou sem como pedir apoio. Acoplar "quero avisar
-- uma coisa" a "meu GPS está funcionando" é o tipo de dependência que só
-- aparece no pior momento.

-- =============================================================================
-- 1. SITUAÇÃO — o recado do jogo
-- =============================================================================
-- Uma linha por usuário, sobrescrita (mesma forma de `posicoes_atuais`): é um
-- ESTADO ATUAL, não um histórico. Quem quiser reconstruir depois usa
-- `atualizada_em` mais o debriefing.
create table if not exists public.situacoes (
  usuario_id        uuid primary key references public.perfis (id) on delete cascade,
  turma_id          uuid not null references public.turmas (id) on delete cascade,

  -- Lista curta e fechada, decidida com quem conduz a instrução. `check` em
  -- vez de tabela (o padrão que `partidos` usa) porque aqui o conjunto é
  -- pequeno e estável: se um exercício precisar de outro estado, é uma linha
  -- nesta constraint, não uma tela de administração que ninguém vai abrir.
  --
  -- **NÃO existe um estado 'emergencia' nesta lista, de propósito.** Quem
  -- precisa de apoio usa `pedidos_apoio` — ver o cabeçalho.
  estado            text not null default 'normal'
                    check (estado in (
                      'normal',        -- nada a declarar; não desenha nada
                      'em_contato',
                      'sem_municao',
                      'pane_viatura',
                      'sem_condicoes'  -- fora de condições de prosseguir
                    )),

  -- Texto livre curto, opcional, que aparece no popup junto do estado. 80
  -- caracteres porque ele é lido num popup de celular, junto da coordenada.
  -- `null` e '' são coisas diferentes aqui? Não: o `check` exige que, se
  -- houver texto, ele tenha conteúdo — texto em branco vira `null` no cliente.
  texto             text check (texto is null or length(btrim(texto)) between 1 and 80),

  atualizada_em     timestamptz not null default now()
);

comment on table public.situacoes is
  'Recado de situação autodeclarado por cada usuário ("sem munição", "viatura em pane"). Visível para a PRÓPRIA FORÇA e para o instrutor — nunca para o outro partido. NÃO é canal de emergência: para isso existe `pedidos_apoio`.';
comment on column public.situacoes.estado is
  'Lista fechada. NÃO inclui emergência de propósito: pedido de apoio é outra tabela e outro caminho, para ninguém confundir simulado com real.';

create index if not exists idx_situacoes_turma on public.situacoes (turma_id);

-- SEM TRIGGER DE CARIMBO AQUI, e vale explicar: `fn_tocar_atualizado_em`
-- (0001) escreve em `NEW.atualizado_em`, e esta coluna chama-se
-- `atualizada_em` (concorda com "situação"). Generalizar aquela função por
-- causa desta tabela mexeria numa função usada por seis tabelas testadas;
-- renomear a coluna deixaria a leitura estranha. O carimbo é do CLIENTE, que
-- manda `atualizada_em` em toda gravação — e o `default now()` cobre o insert.
-- É a única tabela do schema assim; se um dia surgir a segunda, aí sim vale
-- generalizar a função.

-- =============================================================================
-- 2. PEDIDO DE APOIO — a coisa séria
-- =============================================================================
-- EVENTOS, não estado: cada acionamento é uma linha que fica. É o que permite
-- ao debriefing responder "quando ele pediu, quanto tempo levou para alguém
-- reconhecer, quem encerrou" — perguntas que um campo booleano em `perfis`
-- não responderia, e que são exatamente as que se faz depois de um incidente.
create table if not exists public.pedidos_apoio (
  id                uuid primary key default gen_random_uuid(),
  usuario_id        uuid not null references public.perfis (id) on delete cascade,
  turma_id          uuid not null references public.turmas (id) on delete cascade,

  -- POSIÇÃO NULÁVEL, E ISSO É O CONTRÁRIO DE UM DESCUIDO.
  -- Se o GPS não fixou, o pedido TEM QUE SAIR MESMO ASSIM — sem posição, mas
  -- sai. Exigir coordenada aqui significaria que a pessoa sem sinal é
  -- justamente a que não consegue pedir ajuda. Quem recebe vê "sem posição
  -- conhecida" e age com o que tem (rádio, último ponto do rastro).
  latitude          double precision check (latitude is null or latitude between -90 and 90),
  longitude         double precision check (longitude is null or longitude between -180 and 180),
  -- Quando aquela posição foi MEDIDA. Sem isto, uma coordenada de 8 minutos
  -- atrás chegaria com cara de agora — e mandar gente para o lugar errado é
  -- o pior desfecho possível deste recurso. A tela mostra a idade.
  posicao_em        timestamptz,

  -- Texto opcional. Opcional de propósito: o acionamento tem que ser rápido,
  -- e obrigar a digitar antes de enviar atrasaria o que importa. Quem puder
  -- escrever, escreve depois — a linha aceita update.
  motivo            text check (motivo is null or length(btrim(motivo)) between 1 and 200),

  acionado_em       timestamptz not null default now(),

  -- Ciclo de vida. Reconhecer NÃO encerra: são coisas diferentes ("estou
  -- vendo" ≠ "está resolvido"), e juntar as duas faria o pedido sumir do mapa
  -- no instante em que alguém clicasse para dizer que viu.
  reconhecido_em    timestamptz,
  reconhecido_por   uuid references public.perfis (id) on delete set null,
  encerrado_em      timestamptz,
  encerrado_por     uuid references public.perfis (id) on delete set null,

  -- Coerência do ciclo: não existe "reconhecido por ninguém" nem "encerrado
  -- sem hora". O par anda junto, como `altitude_m`/`altitude_fonte` na 0011.
  constraint pedidos_apoio_reconhecido_coerente
    check ((reconhecido_em is null) = (reconhecido_por is null)),
  constraint pedidos_apoio_encerrado_coerente
    check ((encerrado_em is null) = (encerrado_por is null))
);

comment on table public.pedidos_apoio is
  'Pedidos de apoio acionados por quem está em campo. Eventos, não estado: cada acionamento fica registrado com o ciclo acionado/reconhecido/encerrado. NÃO é dispositivo de segurança — o navegador congela com a tela apagada; ver o cabeçalho da 0014.';
comment on column public.pedidos_apoio.latitude is
  'Nulável DE PROPÓSITO: sem GPS o pedido sai mesmo assim. Exigir coordenada deixaria justamente quem está sem sinal sem conseguir pedir ajuda.';
comment on column public.pedidos_apoio.posicao_em is
  'Quando a coordenada foi medida. A tela mostra a idade — coordenada velha apresentada como atual manda gente para o lugar errado.';

-- Índice do acesso que existe: "os pedidos ABERTOS desta turma". Parcial,
-- como idx_calcos_turma: os encerrados só interessam ao debriefing.
create index if not exists idx_pedidos_apoio_abertos
  on public.pedidos_apoio (turma_id, acionado_em desc) where encerrado_em is null;
create index if not exists idx_pedidos_apoio_usuario
  on public.pedidos_apoio (usuario_id, acionado_em desc);

-- =============================================================================
-- 3. RLS — a MESMA forma de `posicoes_ler`, nas duas tabelas
-- =============================================================================
alter table public.situacoes     enable row level security;
alter table public.pedidos_apoio enable row level security;

-- LEITURA: a própria força e o instrutor da turma. Cópia deliberada de
-- `posicoes_ler` (0003) — quem já enxerga a POSIÇÃO de alguém é exatamente
-- quem deve enxergar a situação e o pedido de apoio dele. Reusar a mesma
-- função (fn_usuarios_visiveis) é o que garante que, quando a Etapa 6.5
-- trocar o corpo dela pela árvore ORBAT, estas duas tabelas acompanham sem
-- ninguém lembrar de mexer aqui.
drop policy if exists situacoes_ler on public.situacoes;
create policy situacoes_ler on public.situacoes
  for select to authenticated
  using (
    usuario_id in (select public.fn_usuarios_visiveis())
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- ESCRITA DA SITUAÇÃO: só o dono. Nem o instrutor escreve aqui — é um recado
-- AUTODECLARADO, e um instrutor escrevendo "sem munição" na boca do aluno
-- seria uma afirmação falsa sobre quem está em campo. O que o instrutor
-- arbitra é a baixa/KIA, que é a Etapa 13 e uma coluna diferente.
drop policy if exists situacoes_escrever on public.situacoes;
create policy situacoes_escrever on public.situacoes
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid() and turma_id = public.fn_minha_turma());

drop policy if exists pedidos_apoio_ler on public.pedidos_apoio;
create policy pedidos_apoio_ler on public.pedidos_apoio
  for select to authenticated
  using (
    usuario_id in (select public.fn_usuarios_visiveis())
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- ACIONAR: só em nome próprio, e só na própria turma.
drop policy if exists pedidos_apoio_acionar on public.pedidos_apoio;
create policy pedidos_apoio_acionar on public.pedidos_apoio
  for insert to authenticated
  with check (usuario_id = auth.uid() and turma_id = public.fn_minha_turma());

-- ATUALIZAR (reconhecer, encerrar, acrescentar motivo): o PRÓPRIO autor ou o
-- instrutor da turma. O autor precisa poder encerrar o que ele mesmo abriu —
-- um acionamento sem querer que só o instrutor pudesse fechar viraria um
-- alarme tocando até alguém no notebook perceber.
--
-- Um colega da mesma força NÃO atualiza: ele VÊ e vai socorrer, mas "dar por
-- encerrado" é do autor ou de quem conduz. Sem isso, um terceiro encerraria um
-- pedido que não é dele e que ele não sabe se foi atendido.
drop policy if exists pedidos_apoio_atualizar on public.pedidos_apoio;
create policy pedidos_apoio_atualizar on public.pedidos_apoio
  for update to authenticated
  using (
    usuario_id = auth.uid()
    or public.fn_sou_instrutor_da_turma(turma_id)
  )
  with check (
    usuario_id = auth.uid()
    or public.fn_sou_instrutor_da_turma(turma_id)
  );

-- Sem policy de DELETE em `pedidos_apoio`: um pedido de apoio não se apaga.
-- Encerrar é o caminho, e a linha fica para o debriefing.
grant select, insert, update, delete on public.situacoes     to authenticated;
grant select, insert, update          on public.pedidos_apoio to authenticated;

-- =============================================================================
-- 4. REALTIME
-- =============================================================================
alter table public.situacoes     replica identity full;
alter table public.pedidos_apoio replica identity full;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['situacoes', 'pedidos_apoio'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
        raise notice '% adicionada à publicação supabase_realtime.', t;
      end if;
    end loop;
  end if;
end $$;

-- =============================================================================
-- 5. O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
-- =============================================================================
--   * **NÃO cria chave de permissão para o pedido de apoio, e isto não é
--     esquecimento.** Toda outra função do app pode ser desligada pelo
--     instrutor (`catalogo_permissoes`). Esta não pode: um botão de pedir
--     apoio que o instrutor tenha desligado sem querer produz o pior caso
--     imaginável — a pessoa aciona, vê a confirmação na tela, e ninguém
--     recebe. Se um dia for preciso silenciar alguém, o caminho é remover da
--     turma (0012), que é visível e deliberado.
--   * Não mexe em `perfis.status_combate` (Etapa 13, KIA/WIA). Baixa é
--     ARBITRADA pelo instrutor; situação é AUTODECLARADA pelo aluno. São
--     vizinhas e não são a mesma coluna — juntá-las faria o aluno declarar a
--     própria baixa ou o instrutor falar pela boca dele.
--   * Não notifica fora do app (push, SMS, e-mail). Notificação web exige
--     Service Worker com push, chave VAPID e um servidor para disparar — e
--     continuaria sem funcionar com o app fechado em iOS. Prometer isso sem
--     poder cumprir é pior do que a lacuna declarada.
--   * Não guarda histórico de `situacoes`. É estado atual; o histórico de
--     posição (0005) já reconstrói o essencial do debriefing.
