-- =============================================================================
-- WartoolC2 — Migration 0005: leitura amostrada de `posicoes_historico`
--
-- Incremental sobre 0001/0002/0003/0004, que NÃO são reescritas. Idempotente:
-- rodar duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0004_perfis_realtime.sql.
--
-- ATENÇÃO — ESTA MIGRATION NÃO CRIA NEM AFROUXA NENHUMA REGRA DE ACESSO.
-- Ela cria UMA função de leitura, e essa função é `security invoker`: ela
-- enxerga exatamente as linhas que a policy `historico_ler` (reescrita na
-- 0003) deixaria o chamador enxergar por um `select` comum. Ver a seção
-- "POR QUE SECURITY INVOKER" mais abaixo — é o ponto mais importante do
-- arquivo.
--
-- POR QUE ESTA MIGRATION EXISTE
-- -----------------------------
-- A Etapa 6b (debriefing) é a primeira a LER `posicoes_historico`. O dado já
-- é gravado desde a Etapa 3 — o cliente faz upsert só em `posicoes_atuais` e
-- o trigger `trg_arquivar_posicao` copia cada gravação para cá — e a RLS já
-- deixava o instrutor ler o rastro de quem ele enxerga. Faltava só a tela.
--
-- O problema não é permissão, é VOLUME. Com o throttling de gps.js (intervalo
-- mínimo de 5s, distância mínima de 10m, heartbeat de 30s), cada aluno grava
-- entre 2 e 12 linhas por minuto. Numa turma de 60 alunos:
--
--   parado (só heartbeat) : 60 × 2/min  =   120 linhas/min =   7.200/hora
--   em movimento contínuo : 60 × 12/min =   720 linhas/min =  43.200/hora
--
-- Um exercício de 4 horas fica, no pior caso, perto de 170 mil linhas. Um
-- `select *` no rastro inteiro é inviável por três motivos independentes:
--
--   1. O PostgREST do Supabase corta a resposta em `max-rows` (padrão 1000 no
--      projeto), então o cliente receberia um pedaço silenciosamente truncado
--      — o pior modo de falhar, porque o mapa desenharia um rastro incompleto
--      sem dizer que está incompleto;
--   2. mesmo paginando, seriam ~170 requisições e dezenas de MB no notebook
--      do instrutor, para desenhar uma trilha que a tela não tem pixels para
--      distinguir: a 30s de cadência, dois pontos de um homem a pé ficam a
--      poucos metros um do outro;
--   3. o replay não fica melhor com mais pontos — fica igual, com mais RAM.
--
-- A saída é AMOSTRAR NO SERVIDOR: um ponto por aluno por balde de tempo. É o
-- que esta função faz. Com balde de 120s, as 170 mil linhas viram ~7.200
-- pontos — uma redução de ~24x que acontece ANTES de a rede ser usada.
--
-- Isso NÃO substitui as outras duas defesas, que continuam no cliente
-- (frontend/debriefing.js):
--   * JANELA DE TEMPO OBRIGATÓRIA — `p_inicio`/`p_fim` não têm valor padrão
--     de propósito. Sem intervalo, a consulta varreria a tabela inteira e o
--     índice `idx_hist_usuario_tempo` não serviria para nada;
--   * PAGINAÇÃO — mesmo amostrada, a resposta pode passar de `max-rows`; o
--     cliente pagina com Range até esgotar ou bater no teto.
--
-- COMO A CONSULTA FOI MOLDADA PARA OS ÍNDICES QUE JÁ EXISTEM
-- ----------------------------------------------------------
-- A 0001 criou dois índices em `posicoes_historico`:
--
--   idx_hist_usuario_tempo (usuario_id, medido_em desc)
--   idx_hist_turma_tempo   (turma_id,   medido_em desc)
--
-- O filtro desta função é `usuario_id = any(p_usuarios) and medido_em >=
-- p_inicio and medido_em < p_fim` — exatamente o formato de
-- `idx_hist_usuario_tempo`: igualdade na primeira coluna, faixa na segunda.
-- O planejador resolve isso como um index scan por aluno selecionado (bitmap,
-- quando são muitos), sem tocar no resto da tabela.
--
-- Note o que NÃO está no filtro: `turma_id`. É deliberado. Filtrar por turma
-- empurraria o planejador para `idx_hist_turma_tempo`, que é muito menos
-- seletivo (uma turma inteira contra os alunos escolhidos) — e a turma já é
-- garantida pela policy `historico_ler`, que exige
-- `fn_sou_instrutor_da_turma(turma_id)`. Repetir a regra na consulta daria
-- uma segunda cópia dela, livre para divergir; deixá-la só na policy mantém a
-- barreira num lugar só.
--
-- CUSTO CONHECIDO, REGISTRADO DE PROPÓSITO
-- ----------------------------------------
-- A policy `historico_ler` chama `fn_sou_instrutor_da_turma(turma_id)`, que
-- recebe uma coluna DA LINHA — ou seja, é CORRELACIONADA e roda uma vez por
-- linha candidata. É o oposto do `x in (select fn_usuarios_visiveis())` do
-- mesmo predicado, que o planejador resolve por hash uma vez só (ver a seção
-- 5 da 0003 e "Desempenho" em backend/README.md).
--
-- Consequência prática: o custo desta consulta cresce com o número de linhas
-- BRUTAS na janela, não com o número de pontos devolvidos. Amostrar reduz o
-- tráfego e a memória do navegador, não o trabalho do Postgres. É por isso
-- que a janela de tempo continua obrigatória mesmo com a amostragem pronta —
-- ela é o que limita quantas linhas a policy precisa avaliar.
--
-- Se um dia isso virar gargalo medido (Etapa 10, teste de carga), o conserto
-- é na policy, não aqui: trocar `fn_sou_instrutor_da_turma(turma_id)` por uma
-- forma não correlacionada, por exemplo `turma_id in (select
-- fn_minhas_turmas())`. Não está sendo feito agora porque seria mexer numa
-- regra de acesso testada (backend/testes/01_teste_partidos.sql) sem medida
-- que justifique.
--
-- POR QUE SECURITY INVOKER (E NÃO DEFINER)
-- ----------------------------------------
-- Quase toda função deste projeto é `security definer` — mas por um motivo
-- específico: `fn_meu_papel`, `fn_minha_turma`, `fn_usuarios_visiveis` e
-- companhia são chamadas DE DENTRO de policies e precisam consultar `perfis`
-- sem passar pela RLS de `perfis`, senão recursam.
--
-- Esta função é o caso oposto: ela é chamada DE FORA, pelo cliente, e lê uma
-- tabela protegida. `security definer` aqui faria a função rodar com o
-- privilégio do dono e PASSAR POR CIMA de `historico_ler` — qualquer aluno
-- autenticado poderia pedir o rastro de qualquer pessoa, bastando ter o UUID.
-- Seria transformar uma otimização de transporte num buraco de RLS.
--
-- Sendo `security invoker` (o padrão para `language sql`, escrito aqui de
-- forma explícita justamente para ninguém "consertar" isso depois), a policy
-- é aplicada dentro da função. Um aluno que chame esta RPC recebe só o
-- PRÓPRIO rastro, porque é isso que `historico_ler` lhe dá:
--
--   usuario_id = auth.uid()
--   or (fn_sou_instrutor_da_turma(turma_id)
--       and usuario_id in (select fn_usuarios_visiveis()))
--
-- Isso importa para além do zelo: a permissão `ver_historico_rastro` do
-- catálogo, ligada na Etapa 6b, é checada NO NAVEGADOR e não é barreira de
-- segurança (ver o aviso no topo de frontend/permissoes.js). Quem impede o
-- aluno de ler o rastro dos outros é esta policy — e ela só continua valendo
-- porque a função não a contorna.
-- =============================================================================

-- =============================================================================
-- 1. fn_rastro_historico — rastro amostrado por balde de tempo
-- =============================================================================
-- Devolve UM ponto por aluno por balde de `p_intervalo_s` segundos: o mais
-- antigo dentro do balde (o primeiro `medido_em`), para o instante do ponto
-- ficar alinhado com o começo do balde e o replay não "adiantar" ninguém.
--
-- `leituras_no_balde` diz quantas leituras reais aquele ponto está
-- representando. Não é enfeite: é o que permite a tela informar honestamente
-- "1.240 pontos, representando 43.180 leituras" em vez de deixar o instrutor
-- achar que o aluno só mandou 1.240 posições. Sai de graça na mesma passagem.
--
-- Parâmetros:
--   p_usuarios    — perfis cujo rastro se quer. Obrigatório; sem lista não há
--                   como usar idx_hist_usuario_tempo.
--   p_inicio/p_fim— janela [inicio, fim). Obrigatórios, sem default.
--   p_intervalo_s — tamanho do balde em segundos. Mínimo de 5s porque é o
--                   intervalo mínimo entre gravações em gps.js (INTERVALO_MIN):
--                   pedir menos que isso não traz ponto novo, só ilude.
--   p_limite      — teto de linhas devolvidas. Existe para uma janela grande
--                   demais falhar de forma VISÍVEL (a tela avisa que truncou)
--                   em vez de derrubar o navegador.

create or replace function public.fn_rastro_historico(
  p_usuarios    uuid[],
  p_inicio      timestamptz,
  p_fim         timestamptz,
  p_intervalo_s integer default 30,
  p_limite      integer default 12000
)
returns table (
  usuario_id        uuid,
  medido_em         timestamptz,
  latitude          double precision,
  longitude         double precision,
  precisao_m        double precision,
  velocidade_ms     double precision,
  rumo_graus        double precision,
  leituras_no_balde integer
)
language sql
stable
security invoker   -- NÃO TROCAR. Ver "POR QUE SECURITY INVOKER" no topo.
parallel safe
set search_path = public
as $$
  with parametros as (
    select
      -- 5s é o piso do throttling de gps.js; abaixo disso o balde só produz
      -- mais linhas idênticas. 86400s (1 dia) é o teto, para um valor absurdo
      -- virar "um ponto por dia" em vez de estourar a aritmética.
      least(greatest(coalesce(p_intervalo_s, 30), 5), 86400)::bigint as passo,
      least(greatest(coalesce(p_limite, 12000), 1), 100000)          as teto
  ),
  bruto as (
    select
      h.usuario_id,
      h.medido_em,
      h.latitude,
      h.longitude,
      h.precisao_m,
      h.velocidade_ms,
      h.rumo_graus,
      -- Balde = época dividida pelo passo. Aritmética pura em vez de
      -- date_bin() de propósito: date_bin é PG14+, e backend/testes/ roda
      -- contra um Postgres qualquer (ver "Rodando os testes fora do Supabase"
      -- em backend/README.md). Não há ganho em exigir versão por isto.
      floor(extract(epoch from h.medido_em) / p.passo)::bigint as balde
    from public.posicoes_historico h
    cross join parametros p
    -- Este predicado é o que casa com idx_hist_usuario_tempo
    -- (usuario_id, medido_em desc). Ver "COMO A CONSULTA FOI MOLDADA" no topo.
    where h.usuario_id = any(p_usuarios)
      and h.medido_em >= p_inicio
      and h.medido_em <  p_fim
  ),
  numerado as (
    select
      b.*,
      row_number() over (partition by b.usuario_id, b.balde order by b.medido_em) as posicao,
      count(*)     over (partition by b.usuario_id, b.balde)                      as no_balde
    from bruto b
  )
  select
    n.usuario_id,
    n.medido_em,
    n.latitude,
    n.longitude,
    n.precisao_m,
    n.velocidade_ms,
    n.rumo_graus,
    n.no_balde::integer
  from numerado n
  where n.posicao = 1
  -- Ordem estável e útil ao cliente: agrupa por aluno e já entrega o tempo
  -- crescente, que é como frontend/rastro.js espera os pontos (ele assume
  -- ordenação para a busca binária do replay).
  order by n.usuario_id, n.medido_em
  limit (select teto from parametros);
$$;

comment on function public.fn_rastro_historico(uuid[], timestamptz, timestamptz, integer, integer) is
  'Rastro histórico amostrado: um ponto por aluno por balde de p_intervalo_s segundos, dentro da janela [p_inicio, p_fim). SECURITY INVOKER de propósito — a policy historico_ler continua sendo a barreira, e um aluno que chame isto recebe só o próprio rastro.';

-- Mesmo padrão de grant das funções da 0003: tira do public e devolve só a
-- quem tem sessão. `anon` não entra — rastro não é dado de tela de login.
revoke all on function public.fn_rastro_historico(uuid[], timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.fn_rastro_historico(uuid[], timestamptz, timestamptz, integer, integer) to authenticated;

-- =============================================================================
-- 2. Verificação rápida depois de aplicar
-- =============================================================================
-- A função deve existir e estar marcada como INVOKER (prosecdef = false).
-- Se `prosecdef` vier `t`, alguém trocou para definer e a RLS do histórico
-- deixou de valer para esta função — ver o topo do arquivo.
--
--   select proname, prosecdef as eh_definer, provolatile
--   from pg_proc where proname = 'fn_rastro_historico';
--   -- esperado: fn_rastro_historico | f | s
--
-- E o plano deve usar o índice por usuário, não um seq scan:
--
--   explain analyze
--   select * from public.fn_rastro_historico(
--     array(select id from public.perfis where papel = 'usuario' limit 5),
--     now() - interval '2 hours', now(), 30, 12000);
--   -- esperado: Index Scan (ou Bitmap) using idx_hist_usuario_tempo
--
-- ATENÇÃO ao testar pelo SQL Editor do Supabase: ele roda como `service_role`
-- e passa por cima da RLS, então a função vai devolver tudo e isso NÃO prova
-- que a policy está valendo. Para provar o isolamento, chame a RPC pelo app
-- com o token de um aluno: ele deve receber só o próprio rastro, mesmo
-- passando o UUID de um colega em p_usuarios.
