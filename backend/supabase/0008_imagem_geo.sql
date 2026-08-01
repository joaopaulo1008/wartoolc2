-- =============================================================================
-- WartoolC2 — Migration 0008: imagem georreferenciada (foto aérea / carta
-- atualizada) publicada pelo instrutor, como um terceiro FORMATO de `calcos`
--
-- Incremental sobre 0001..0007, que NÃO são reescritas. Idempotente: rodar
-- duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0007_codigo_turma_valido.sql.
--
-- POR QUE REAPROVEITAR `calcos` EM VEZ DE CRIAR TABELA NOVA (decisão da Etapa
-- 8b, item 4 do prompt de abertura)
-- -----------------------------------------------------------------------
-- A própria migration 0006 já dizia isto no cabeçalho, ao descrever o que
-- ficaria para a Etapa 8: "A tabela `calcos` e o bucket já são 'arquivo
-- publicado pelo instrutor', não 'KML': `formato` é um `check` de texto, e
-- acrescentar um valor é uma linha." Levar essa previsão adiante em vez de
-- abrir uma tabela nova foi decisão deliberada, por três motivos:
--
--   1. RLS/TRIGGER/POLICIES DE STORAGE JÁ EXISTEM E JÁ FORAM PENSADOS PARA
--      ISTO. `calcos_ler`/`calcos_escrever` (quem publica, quem vê, recorte
--      por partido), `fn_normalizar_calco` (caminho do objeto imposto por
--      trigger) e as duas policies de `storage.objects` não mudam UMA linha
--      para servir imagem — a diferença entre um calco vetor e um calco
--      raster é só o que tem DENTRO do arquivo e quais colunas a linha usa.
--      Duplicar tudo isso numa tabela nova seria repetir, quase à risca, um
--      conjunto de regras que já foi revisado e que tem pendência de teste ao
--      vivo marcada como "o item de segurança mais importante" desde a 0006
--      (isolamento do objeto entre partidos). Duas cópias da mesma regra de
--      segurança são exatamente o tipo de coisa que diverge em silêncio — o
--      erro que a Etapa 4.5 corrigiu no SIDC e que o projeto evita desde
--      então (ver `fn_usuarios_visiveis()`, `basemaps.js`, `icones.js`).
--   2. UM SÓ LUGAR PARA "O QUE ESTÁ PUBLICADO NESTA TURMA". O painel do
--      instrutor e o painel de camadas do aluno (`frontend/camadas.js`) já
--      leem `calcos` como "os arquivos que o instrutor publicou" — uma tabela
--      nova exigiria os dois lados fazerem DUAS consultas e mesclarem listas,
--      só para reconstituir uma coisa que conceitualmente já é uma coisa só:
--      "conteúdo publicado pelo instrutor, com categoria e destinatário".
--   3. O CUSTO ACEITO É PEQUENO E NULÁVEL. Misturar vetor e raster numa linha
--      só custa quatro colunas nuláveis (as três de sempre — `cor`,
--      `opacidade`, `num_feicoes` — já eram nuláveis-na-prática para uma
--      imagem, que não tem feição nem precisa de estilo por feição) mais as
--      quatro de bounds abaixo. Não custa RLS nova, não custa trigger novo,
--      não custa bucket novo.
--
-- O QUE MUDA NA TABELA
-- ---------------------
--   * `formato` passa a aceitar também 'jpg' e 'png' (dois valores, não um
--     'imagem' genérico — para o caminho do objeto em `storage.objects`
--     continuar tendo uma extensão de verdade, `<turma_id>/<id>.jpg`, no
--     mesmo padrão de `<turma_id>/<id>.kml`; `fn_normalizar_calco`, da 0006,
--     não precisa mudar uma linha porque já monta o caminho a partir de
--     `new.formato` genericamente).
--   * quatro colunas novas, NULAS para 'kml'/'kmz' e OBRIGATÓRIAS para
--     'jpg'/'png': `bounds_norte`, `bounds_sul`, `bounds_leste`,
--     `bounds_oeste` — os dois cantos (noroeste impícito em
--     norte+oeste, sudeste em sul+leste) que `L.imageOverlay` do Leaflet
--     aceita nativamente. Ver a decisão de georreferenciamento (item 2 do
--     prompt de abertura) em `frontend/imagem-geo.js`: só bounds
--     RETANGULARES, sem rotação — um `check` garante norte > sul e
--     leste > oeste, e que os quatro valores existem juntos ou não existem
--     nenhum, nunca pela metade.
--   * `tamanho_bytes` ganha um teto MAIOR para imagem (3 MB) que para
--     KML/KMZ (2 MB, inalterado) — a conta de egress que justifica os dois
--     números está em `frontend/imagem-geo.js` (`estimarEgress`), no mesmo
--     espírito do cabeçalho da 0006 para o número do KML. O `file_size_limit`
--     do BUCKET (seção 2 abaixo) sobe para o maior dos dois, 3 MB: o bucket
--     não sabe distinguir formato, só tamanho — quem faz a distinção fina por
--     formato é este `check` da tabela, a segunda das três camadas de defesa
--     já usadas desde a 0006 (navegador, bucket, tabela).
--
-- O QUE NÃO MUDA
-- ---------------
-- RLS (seção 3 da 0006), bucket em si (só o limite numérico), as policies de
-- `storage.objects` (seção 5 da 0006) e a Realtime (seção 6) — todas
-- indiferentes a formato. `fn_normalizar_calco` (seção 2 da 0006) também não
-- muda: já monta `<turma_id>/<id>.<formato>` genericamente, e passa a
-- produzir `.jpg`/`.png` para as linhas novas sem precisar saber disso.
-- =============================================================================

-- =============================================================================
-- 1. COLUNA `formato`: aceitar 'jpg' e 'png'
-- =============================================================================
-- O nome do `check` inline de `formato text not null check (...)` na 0006 é
-- o padrão gerado pelo Postgres para um check de coluna sem nome explícito:
-- `<tabela>_<coluna>_check`. `drop ... if exists` é seguro mesmo que o nome
-- real divirja (a migration seguinte não quebra por causa disso — só o
-- `check` antigo ficaria, e o `add constraint` novo abaixo falharia por
-- redundância, o que ainda é seguro: melhor falhar alto que aceitar formato
-- fora da lista em silêncio).

alter table public.calcos drop constraint if exists calcos_formato_check;
alter table public.calcos add constraint calcos_formato_check
  check (formato in ('kml', 'kmz', 'jpg', 'png'));

-- =============================================================================
-- 2. COLUNAS DE BOUNDS (nuláveis — só imagem usa)
-- =============================================================================

alter table public.calcos add column if not exists bounds_norte  double precision;
alter table public.calcos add column if not exists bounds_sul    double precision;
alter table public.calcos add column if not exists bounds_leste  double precision;
alter table public.calcos add column if not exists bounds_oeste  double precision;

comment on column public.calcos.bounds_norte is
  'Latitude do canto NORTE do retângulo da imagem (graus decimais). NULA para kml/kmz. Ver frontend/imagem-geo.js (validarBounds) — o cliente já garante norte > sul antes de publicar; o check abaixo é a segunda camada, não a primeira.';
comment on column public.calcos.bounds_sul is
  'Latitude do canto SUL. NULA para kml/kmz.';
comment on column public.calcos.bounds_leste is
  'Longitude do canto LESTE. NULA para kml/kmz.';
comment on column public.calcos.bounds_oeste is
  'Longitude do canto OESTE. NULA para kml/kmz.';

-- Coerência: as quatro juntas para imagem, nenhuma para vetor — nunca pela
-- metade. Um `check` incompleto (por exemplo, só exigindo not null quando
-- formato='jpg') deixaria passar uma linha com norte/sul preenchidos mas
-- leste/oeste nulos, que quebraria `L.imageOverlay` no cliente de um jeito
-- que só apareceria em campo.
alter table public.calcos drop constraint if exists calcos_bounds_coerentes;
alter table public.calcos add constraint calcos_bounds_coerentes
  check (
    (
      formato in ('kml', 'kmz')
      and bounds_norte is null and bounds_sul is null
      and bounds_leste is null and bounds_oeste is null
    ) or (
      formato in ('jpg', 'png')
      and bounds_norte is not null and bounds_sul is not null
      and bounds_leste is not null and bounds_oeste is not null
      and bounds_norte between -90 and 90
      and bounds_sul   between -90 and 90
      and bounds_leste between -180 and 180
      and bounds_oeste between -180 and 180
      and bounds_norte > bounds_sul
      and bounds_leste > bounds_oeste
    )
  );

-- =============================================================================
-- 3. TAMANHO POR FORMATO
-- =============================================================================
-- Substitui o `check (tamanho_bytes > 0 and tamanho_bytes <= 2097152)` da
-- 0006 por um teto que depende do formato. O número de cada lado tem a conta
-- em frontend/imagem-geo.js (`estimarEgress`) e frontend/kml.js (comentário
-- de LIMITE_BYTES_COMPARTILHADO) — repetidos aqui só como valor, não como
-- explicação, para não ter duas fontes de verdade sobre O PORQUÊ do número.

alter table public.calcos drop constraint if exists calcos_tamanho_bytes_check;
alter table public.calcos add constraint calcos_tamanho_bytes_check
  check (
    tamanho_bytes > 0 and (
      (formato in ('kml', 'kmz') and tamanho_bytes <= 2097152)   -- 2 MB, inalterado desde a 0006
      or
      (formato in ('jpg', 'png') and tamanho_bytes <= 3145728)   -- 3 MB, novo nesta migration
    )
  );

comment on table public.calcos is
  'Calcos publicados pelo INSTRUTOR para a turma: KML/KMZ (Etapa 7) ou imagem georreferenciada (Etapa 8b — foto aérea/carta atualizada). Os bytes ficam no bucket `calcos` do Storage; aqui ficam os metadados, os bounds (só imagem) e a regra de quem vê. O arquivo que o ALUNO carrega para si mesmo não passa por aqui — é local ao navegador dele (carregar_kml só; não existe caminho local de imagem nesta etapa, ver frontend/permissoes.js).';

-- =============================================================================
-- 4. BUCKET: `file_size_limit` sobe para o maior dos dois tetos (3 MB)
-- =============================================================================
-- O bucket não distingue formato — só tamanho do objeto. Quem impede um KML
-- de 3 MB de passar é o `check` da tabela acima (e a checagem do navegador,
-- em frontend/kml.js, inalterada). Ver o cabeçalho desta migration, seção
-- "O QUE MUDA NA TABELA", para a conta completa de por que 3 MB e não mais.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets não existe neste banco — bucket `calcos` não ajustado. Normal num Postgres cru (backend/testes/00_stub_supabase.sql); NÃO é normal no Supabase.';
    return;
  end if;

  update storage.buckets
     set file_size_limit = 3145728
   where id = 'calcos';
end $$;

-- =============================================================================
-- Verificação rápida depois de aplicar
-- =============================================================================
--   -- deve aceitar (bounds coerentes, 3 MB):
--   insert into public.calcos
--     (turma_id, autor_id, nome, categoria, formato, tamanho_bytes,
--      bounds_norte, bounds_sul, bounds_leste, bounds_oeste)
--   values
--     ('<turma>', '<instrutor>', 'Teste', 'camada_manobra', 'jpg', 3000000,
--      -22.0, -22.05, -47.0, -47.05);
--
--   -- deve FALHAR (bounds invertidos):
--   ... bounds_norte = -22.05, bounds_sul = -22.0 ...   -- violaria norte > sul
--
--   -- deve FALHAR (kml com bounds preenchido):
--   ... formato = 'kml', bounds_norte = -22.0 ...        -- violaria calcos_bounds_coerentes
--
--   -- deve FALHAR (imagem de 3.5 MB):
--   ... formato = 'png', tamanho_bytes = 3670016 ...     -- violaria calcos_tamanho_bytes_check
--
-- A `0008` NÃO foi executada contra um Postgres (sem ambiente na sessão em
-- que foi escrita, como a 0004/0005/0006/0007). Validada com
-- backend/testes/valida_sql.py junto com 0001-0007.
-- =============================================================================
