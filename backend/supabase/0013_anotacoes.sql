-- =============================================================================
-- WartoolC2 — Migration 0013: anotações de texto no mapa
--
-- Incremental sobre 0001..0012, que NÃO são reescritas. Idempotente: rodar
-- duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0012_remover_da_turma.sql.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ------------------------------
-- Pedido de quem conduz a instrução (2026-09-14): "quero que o instrutor possa
-- inserir caixas de texto no mapa". Escrever no mapa é metade do trabalho de
-- quem conduz um exercício — "PC 1º Esqd", "reabastecimento até 14h", "eixo
-- fechado" — e até aqui não havia caminho nenhum para isso.
--
-- POR QUE TABELA NOVA, E NÃO UMA COLUNA EM `elementos_marcados`
-- --------------------------------------------------------------
-- `elementos_marcados` já tem `titulo` e `descricao`, e a tentação era gravar
-- a anotação lá com um "tipo texto". **A visibilidade impede, e de um jeito
-- que só aparece em campo.** A policy `elementos_ler` (0003) é
-- `autor_id in (select fn_usuarios_visiveis())`, e um ALUNO só enxerga colegas
-- do MESMO partido. O instrutor não tem partido — então uma anotação criada
-- por ele naquela tabela seria invisível para todos os alunos, que é o oposto
-- exato do que uma caixa de texto serve.
--
-- Quem já resolve "o instrutor publica e a força enxerga" é `calcos` (0006), e
-- é dela que esta tabela é modelada: mesma regra de partido, mesma forma de
-- policy, mesma exclusão lógica. Uma anotação é, no fundo, um calco minúsculo
-- cujo conteúdo é uma frase em vez de um arquivo.
--
-- NÃO HÁ STORAGE AQUI. Um calco guarda bytes num bucket e por isso precisa de
-- `caminho`, de trigger de caminho e de policies em `storage.objects`. Uma
-- anotação é texto: cabe na linha, e nada disso existe nesta migration.

-- =============================================================================
-- 1. TABELA
-- =============================================================================
create table if not exists public.anotacoes (
  id                uuid primary key default gen_random_uuid(),
  turma_id          uuid not null references public.turmas (id) on delete cascade,
  -- Sempre o instrutor que escreveu (garantido pelo WITH CHECK da policy de
  -- escrita). Guardado para o painel dizer quem foi — mesma razão de calcos.
  autor_id          uuid not null references public.perfis (id) on delete cascade,

  -- 200 caracteres: uma anotação de mapa é um recado, não um parágrafo. O teto
  -- não é estética — cada anotação é desenhada PERMANENTEMENTE sobre a carta,
  -- e um texto longo tapa o terreno que a pessoa precisa enxergar. Quem tem
  -- mais a dizer publica um calco ou usa o rádio.
  --
  -- `btrim` no check para " " não passar como texto válido: uma anotação em
  -- branco desenharia uma caixa vazia no mapa de todo mundo, sem ninguém
  -- conseguir explicar de onde veio.
  texto             text not null
                    check (length(btrim(texto)) between 1 and 200),

  latitude          double precision not null check (latitude between -90 and 90),
  longitude         double precision not null check (longitude between -180 and 180),
  -- Mantida em sincronia por trigger (fn_sincronizar_geom, de 0001), como em
  -- elementos_marcados e posicoes_atuais. Existe para consulta espacial
  -- futura; nada no app de hoje lê esta coluna.
  geom              geography(Point, 4326),

  -- Nulo = a turma inteira. Setado = só aquele partido (+ instrutor da turma).
  -- Mesma semântica de `calcos.partido_id`, e mesma razão: uma ordem parcial
  -- para o Azul não pode aparecer para o Vermelho.
  partido_id        uuid references public.partidos (id) on delete set null,

  -- Cor do texto no mapa. Sugestão de quem escreveu; ao contrário da opacidade
  -- dos calcos, não há ajuste do lado do aluno — não faria sentido cada um
  -- pintar o recado do instrutor de uma cor.
  cor               text not null default '#f5c842'
                    check (cor ~ '^#[0-9a-fA-F]{6}$'),

  -- Exclusão lógica, como em elementos_marcados e calcos: o que saiu do mapa
  -- continua no banco para o debriefing poder explicar o que estava escrito
  -- na tela em cada momento.
  removida_em       timestamptz,
  removida_por      uuid references public.perfis (id) on delete set null,

  criada_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

comment on table public.anotacoes is
  'Caixas de texto que o INSTRUTOR escreve no mapa da turma (2026-09-14). Modelada em `calcos`: mesma regra de partido e mesma exclusão lógica. NÃO usa elementos_marcados porque a visibilidade daquela tabela é amarrada ao partido do AUTOR, e o instrutor não tem partido — a anotação nasceria invisível para os alunos.';
comment on column public.anotacoes.partido_id is
  'Nulo = turma inteira. Setado = só aquele partido (+ instrutor da turma).';
comment on column public.anotacoes.texto is
  'O recado, até 200 caracteres. Desenhado permanentemente sobre a carta — por isso o teto curto.';
comment on column public.anotacoes.removida_em is
  'Exclusão lógica: preenchida, a anotação some do mapa e continua no banco.';

-- Índice do único acesso que existe: "as anotações vigentes desta turma".
-- Parcial em `removida_em is null` pelo mesmo motivo de idx_calcos_turma: as
-- removidas nunca são lidas pelo mapa e só engordariam o índice.
create index if not exists idx_anotacoes_turma
  on public.anotacoes (turma_id) where removida_em is null;
create index if not exists idx_anotacoes_geom
  on public.anotacoes using gist (geom);

drop trigger if exists trg_anotacoes_geom on public.anotacoes;
create trigger trg_anotacoes_geom
  before insert or update of latitude, longitude on public.anotacoes
  for each row execute function public.fn_sincronizar_geom();

drop trigger if exists trg_anotacoes_atualizado_em on public.anotacoes;
create trigger trg_anotacoes_atualizado_em
  before update on public.anotacoes
  for each row execute function public.fn_tocar_atualizado_em();

-- =============================================================================
-- 2. RLS
-- =============================================================================
alter table public.anotacoes enable row level security;

-- LEITURA: cópia deliberada de `calcos_ler` (0006). Instrutor da turma vê
-- tudo; aluno vê o que é da turma dele E (sem partido OU do partido dele).
-- Escrita igual seria erro: quem lê é a turma, quem escreve é só o instrutor.
drop policy if exists anotacoes_ler on public.anotacoes;
create policy anotacoes_ler on public.anotacoes
  for select to authenticated
  using (
    public.fn_sou_instrutor_da_turma(turma_id)
    or (
      turma_id = public.fn_minha_turma()
      and (partido_id is null or partido_id = public.fn_meu_partido())
    )
  );

-- ESCRITA (criar, editar, mover, remover): só o instrutor da turma, e
-- `autor_id` obrigado a ser ele mesmo — sem isso um instrutor escreveria em
-- nome de outro, e o painel mentiria sobre quem pôs aquele texto no mapa de
-- 60 pessoas.
--
-- `for all` cobre insert/update/delete de uma vez. O app só faz insert e
-- update (a remoção é lógica, `removida_em`), mas deixar delete de fora
-- criaria a situação em que nem o instrutor consegue limpar uma linha que ele
-- mesmo criou por engano direto no SQL Editor.
drop policy if exists anotacoes_escrever on public.anotacoes;
create policy anotacoes_escrever on public.anotacoes
  for all to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id))
  with check (
    public.fn_sou_instrutor_da_turma(turma_id)
    and autor_id = auth.uid()
  );

grant select, insert, update, delete on public.anotacoes to authenticated;

-- =============================================================================
-- 3. REALTIME
-- =============================================================================
-- `replica identity full` para o evento de UPDATE/DELETE trazer a linha
-- ANTIGA junto — sem isso o cliente recebe "alguma anotação mudou" sem saber
-- qual, e teria que reler a turma inteira a cada evento.
--
-- O Realtime aplica a policy de SELECT antes de entregar cada evento, então
-- `anotacoes_ler` continua valendo: o aluno do Vermelho não recebe o evento da
-- anotação do Azul.
alter table public.anotacoes replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'anotacoes'
    ) then
      alter publication supabase_realtime add table public.anotacoes;
      raise notice 'anotacoes adicionada à publicação supabase_realtime.';
    end if;
  end if;
end $$;

-- =============================================================================
-- 4. O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
-- =============================================================================
--   * NÃO acrescenta chave em `catalogo_permissoes`. Foi considerado um
--     `camada_anotacoes` para o instrutor poder desligar o conjunto todo, e
--     recusado pela mesma razão que a 0011 recusou uma chave para os dados de
--     tiro: o controle que importa já existe por anotação (`partido_id`), e um
--     interruptor a mais seria mais um estado que ninguém saberia explicar em
--     campo. **LACUNA DECLARADA:** o aluno não tem como esconder as anotações
--     na tela dele. Se em campo elas atrapalharem a leitura da carta, o passo
--     seguinte é um interruptor local (preferência, não permissão) — e essa
--     decisão pertence a quem estiver com o celular na mão, não a este arquivo.
--   * NÃO guarda tamanho de fonte, rotação nem âncora. Uma anotação é um ponto
--     com texto; caixa com borda, seta e tamanho variável são um editor de
--     desenho, que é outra etapa e provavelmente outra ferramenta.
--   * NÃO entra no replay do debriefing. As colunas de tempo existem
--     (`criada_em`, `removida_em`), então dá para reconstruir depois o que
--     estava escrito em cada instante — mas a tela de debriefing não lê esta
--     tabela hoje, e dizer que lê seria mentir sobre o que o replay mostra.
--   * NÃO deixa o ALUNO escrever. Foi o pedido: é o instrutor que anota. Se um
--     dia o aluno precisar, o caminho é uma chave de permissão nova e um
--     segundo ramo no `with check` — não afrouxar o que está aqui.
