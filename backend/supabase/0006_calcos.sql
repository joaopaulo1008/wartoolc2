-- =============================================================================
-- WartoolC2 — Migration 0006: calcos KML/KMZ publicados pelo instrutor
--
-- Incremental sobre 0001..0005, que NÃO são reescritas. Idempotente: rodar
-- duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0005_rastro_historico.sql.
--
-- POR QUE ESTA MIGRATION EXISTE
-- -----------------------------
-- A Etapa 7 traz DOIS caminhos para um arquivo KML/KMZ virar camada no mapa, e
-- eles são coisas diferentes — misturá-los seria o erro central da etapa:
--
--   (1) O ARQUIVO DO ALUNO. Ele escolhe um arquivo no próprio aparelho, a
--       camada aparece só para ele e some no F5. Não passa por aqui: não toca
--       rede, não toca banco, não toca esta migration. É governado pela chave
--       `carregar_kml`, cuja descrição no catálogo (0001) é literalmente
--       "Carregar arquivos KML/KMZ PRÓPRIOS" e cujo padrão é `false`.
--
--   (2) O CALCO DO INSTRUTOR. Ele publica um arquivo e ele aparece no app dos
--       alunos, que ligam/desligam e ajustam opacidade. Isso precisa de um
--       lugar para os bytes (Supabase Storage) e de uma linha de metadados
--       (esta tabela) — é o que esta migration cria.
--
-- QUEM PUBLICA: SÓ O INSTRUTOR DA TURMA. Não é zelo, é redução de superfície.
-- Um calco é HTML de terceiro desenhado na tela de 60 pessoas (ver a seção
-- XSS mais abaixo); deixar aluno publicar transformaria um `<description>`
-- malicioso num ataque de aluno contra a turma. O cliente sanitiza de todo
-- jeito — o instrutor também baixa arquivo da internet —, mas a barreira que
-- vale é esta policy, não o JavaScript.
--
-- CATEGORIA: O CALCO SE PENDURA NUMA CHAVE DE PERMISSÃO QUE JÁ EXISTE
-- -------------------------------------------------------------------
-- `calcos.categoria` não é rótulo livre: é uma FK para `catalogo_permissoes`,
-- restrita às quatro chaves de camada. O instrutor classifica o calco ao
-- publicar, e o app aplica a permissão daquela chave à camada.
--
-- É isso que finalmente dá efeito a `camada_logistica` e `camada_obstaculos`,
-- que estavam no painel do instrutor marcadas como "sem efeito ainda" desde a
-- 6a por não existir camada nenhuma correspondente no app. Agora existe: a
-- camada de logística é o calco de logística que o instrutor publicou.
--
-- E o motivo de a categoria ser escolhida por QUEM PUBLICA (instrutor) e não
-- por quem carrega: se o aluno pudesse classificar o próprio arquivo, ele
-- lavaria permissão — carregaria qualquer coisa, chamaria de "manobra" e
-- ganharia de volta uma camada que o instrutor tinha desligado. Por isso o
-- arquivo LOCAL do aluno (caminho 1) não tem categoria nenhuma: responde só a
-- `carregar_kml`, e é visível só para ele mesmo.
--
-- QUEM VÊ: TURMA, COM RECORTE OPCIONAL POR PARTIDO
-- ------------------------------------------------
-- `partido_id` nulo  -> a turma inteira (terreno, limites, medidas comuns).
-- `partido_id` setado -> só aquele partido (+ instrutor da turma).
--
-- O segundo caso é o que impede o calco de manobra do Azul de aparecer para o
-- Vermelho. Note que a regra NÃO é `fn_usuarios_visiveis()`, usada por
-- posições e marcações, e a diferença é proposital: aquela função responde
-- "quais PESSOAS eu enxergo" e é amarrada ao AUTOR da linha. Aqui o autor é
-- sempre o instrutor — que os dois partidos enxergam —, então usá-la faria
-- todo calco vazar para todo mundo. A pergunta certa aqui é sobre o
-- DESTINATÁRIO do calco, não sobre o autor dele, e é outra pergunta.
--
-- Consequência a não esquecer na Etapa 6.5 (ORBAT): trocar o corpo de
-- `fn_usuarios_visiveis()` NÃO muda nada nesta tabela. Se um dia o calco
-- precisar ser endereçado por unidade em vez de por partido, é aqui que muda.
--
-- DESEMPENHO: esta tabela não é caminho quente. Um calco é lido uma vez na
-- carga da página e depois só quando o instrutor publica outro (Realtime).
-- Nada a ver com `posicoes_atuais`, que é lida com 60 aparelhos gravando a
-- cada poucos segundos — por isso aqui cabe uma policy correlacionada sem
-- as precauções que a 4.5 teve que tomar em fn_usuarios_visiveis().
--
-- COTA E EGRESS — DE ONDE SAI O LIMITE DE 2 MB
-- --------------------------------------------
-- O limite não é chute nem "arquivo costuma ser pequeno". Ele sai da conta do
-- plano Free do Supabase (1 GB de armazenamento, 5 GB de egress/mês) contra o
-- uso real, que é o oposto do confortável: 60 alunos baixam O MESMO arquivo,
-- cada um pelo próprio 4G, no campo.
--
--   2 MB × 60 alunos                       = 120 MB por calco, por carga
--   3 calcos publicados                    = 360 MB para a turma abrir o app
--   ~5 recargas ao longo de um exercício   = 1,8 GB em um exercício
--
-- Ou seja: 2 MB já consome mais de um terço do egress mensal num único
-- exercício. Dobrar para 4 MB estouraria o plano com dois exercícios no mês.
-- O limite fica em 2 MB por calco e é enforced em TRÊS lugares independentes,
-- porque cada um falha de um jeito diferente:
--   * no navegador (frontend/kml.js) — para o instrutor saber ANTES de gastar
--     o upload, e com mensagem que diz o que fazer;
--   * no bucket (`file_size_limit`) — para um cliente adulterado não subir;
--   * nesta tabela (`check`) — para a linha de metadados não mentir sobre o
--     tamanho do objeto.
-- O arquivo LOCAL do aluno tem limite maior (8 MB, ver frontend/kml.js) por
-- um motivo simples: ele não passa por rede nem ocupa cota de ninguém.
--
-- EXCLUSÃO: LINHA LÓGICA, BYTES DE VERDADE
-- ----------------------------------------
-- `removido_em`/`removido_por` seguem a decisão da Etapa 1 (o instrutor audita
-- depois o que foi retirado durante o exercício). Mas, diferente de
-- `elementos_marcados`, o OBJETO no Storage é apagado de verdade junto — a
-- linha custa bytes desprezíveis e serve de registro; o arquivo custa cota, e
-- cota é dinheiro. O efeito colateral é que "desremover" um calco não existe:
-- republica-se. Está registrado aqui de propósito para ninguém tentar depois.
-- =============================================================================

-- =============================================================================
-- 1. TABELA
-- =============================================================================

create table if not exists public.calcos (
  id                uuid primary key default gen_random_uuid(),
  turma_id          uuid not null references public.turmas (id) on delete cascade,
  -- Autor é sempre o instrutor que publicou (garantido pelo WITH CHECK da
  -- policy de escrita). Guardado para o painel dizer quem foi.
  autor_id          uuid not null references public.perfis (id) on delete cascade,

  nome              text not null
                    check (length(btrim(nome)) between 1 and 80),

  -- Chave de permissão que manda nesta camada. FK para o catálogo, e não texto
  -- solto, para não existir calco pendurado numa chave que o app não conhece.
  -- O `check` restringe às chaves de CAMADA: um calco não pode se pendurar em
  -- `enviar_posicao_gps`, que é função, nem em `carregar_kml`, que governa o
  -- arquivo local do aluno e não este caminho.
  categoria         text not null
                    references public.catalogo_permissoes (chave)
                    check (categoria in (
                      'camada_manobra', 'camada_inimigo',
                      'camada_logistica', 'camada_obstaculos'
                    )),

  -- Nulo = a turma inteira. Setado = só aquele partido (+ instrutor).
  partido_id        uuid references public.partidos (id) on delete set null,

  -- Caminho do objeto no bucket `calcos`. NÃO é escolhido pelo cliente: o
  -- trigger da seção 3 sobrescreve com <turma_id>/<id>.<formato>. Ver lá o
  -- motivo (é o que amarra o objeto do Storage à linha que o autoriza).
  caminho           text not null unique,
  formato           text not null check (formato in ('kml', 'kmz')),

  tamanho_bytes     integer not null
                    check (tamanho_bytes > 0 and tamanho_bytes <= 2097152),
  -- Quantas feições o cliente contou ao parsear. Só informativo (o painel
  -- avisa "1.240 feições"); o corte de verdade acontece no navegador, em
  -- frontend/kml.js, antes do upload.
  num_feicoes       integer not null default 0 check (num_feicoes >= 0),

  -- Aparência PADRÃO sugerida pelo instrutor. O aluno pode ajustar a opacidade
  -- na tela dele sem que isso volte para cá: opacidade é PREFERÊNCIA de quem
  -- olha, não permissão (mesma distinção da 4.5 entre
  -- `preferencias_visualizacao` e as tabelas de permissão).
  cor               text not null default '#f5c842'
                    check (cor ~ '^#[0-9a-fA-F]{6}$'),
  opacidade         real not null default 1
                    check (opacidade >= 0 and opacidade <= 1),
  ordem             smallint not null default 0,

  criado_em         timestamptz not null default now(),
  removido_em       timestamptz,
  removido_por      uuid references public.perfis (id) on delete set null
);

comment on table public.calcos is
  'Calcos KML/KMZ publicados pelo INSTRUTOR para a turma (Etapa 7). Os bytes ficam no bucket `calcos` do Storage; aqui ficam os metadados e a regra de quem vê. O arquivo que o ALUNO carrega para si mesmo não passa por aqui — é local ao navegador dele.';
comment on column public.calcos.categoria is
  'Chave de permissão de CAMADA que governa este calco (camada_manobra/inimigo/logistica/obstaculos). É o instrutor quem classifica: se o aluno pudesse, classificaria o próprio arquivo para recuperar uma camada desligada.';
comment on column public.calcos.partido_id is
  'Nulo = turma inteira. Setado = só aquele partido (+ instrutor da turma). É o que impede o calco do Azul de aparecer para o Vermelho.';
comment on column public.calcos.caminho is
  'Caminho do objeto no bucket `calcos`, sempre <turma_id>/<id>.<formato>. Sobrescrito por trigger — o cliente não escolhe, porque o caminho é o que as policies de storage.objects usam para achar a linha que autoriza o download.';
comment on column public.calcos.opacidade is
  'Opacidade PADRÃO sugerida pelo instrutor. O ajuste que o aluno faz na tela dele é local e não volta para cá.';

-- Índice do único acesso que existe: "os calcos vigentes desta turma".
create index if not exists idx_calcos_turma
  on public.calcos (turma_id, ordem) where removido_em is null;

-- =============================================================================
-- 2. CAMINHO DO OBJETO E COERÊNCIA DO PARTIDO
-- =============================================================================
-- Duas garantias que não podem ficar no cliente.
--
-- (a) O CAMINHO. As policies de `storage.objects` (seção 5) autorizam o
--     download procurando a linha de `calcos` cujo `caminho` é igual ao nome
--     do objeto. Se o cliente pudesse escolher o caminho, um instrutor de uma
--     turma poderia cadastrar uma linha apontando para o objeto de OUTRA
--     turma e, com isso, autorizar a própria turma a baixá-lo. Por isso o
--     caminho é derivado de turma_id + id e sobrescrito aqui, sempre.
--
-- (b) O PARTIDO pertence à turma do calco — mesma coerência já exigida em
--     `perfis` (fn_normalizar_partido_do_perfil, 0003) e em
--     `elementos_marcados` (fn_validar_partido_do_elemento, 0003). Sem isso,
--     um partido_id de outra turma tornaria o calco invisível para todo mundo,
--     por um motivo que ninguém descobriria olhando a tela.

create or replace function public.fn_normalizar_calco()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.caminho := new.turma_id::text || '/' || new.id::text || '.' || new.formato;

  if new.partido_id is not null then
    if not exists (
      select 1 from public.partidos pa
      where pa.id = new.partido_id and pa.turma_id = new.turma_id
    ) then
      raise exception 'O partido informado não pertence à turma deste calco.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalizar_calco on public.calcos;
create trigger trg_normalizar_calco
  before insert or update of turma_id, partido_id, formato on public.calcos
  for each row execute function public.fn_normalizar_calco();

-- Inverso do caminho: dado '<turma_id>/<id>.kmz', devolve o uuid da turma.
-- Existe para a policy de ESCRITA em storage.objects (seção 5), que precisa
-- saber de que turma é a pasta antes de a linha de `calcos` existir.
--
-- O `case` não é preciosismo: `'lixo'::uuid` levanta exceção, e uma exceção
-- dentro de uma policy vira erro na cara do usuário em vez de "não
-- autorizado". Nome fora do padrão devolve nulo, e
-- fn_sou_instrutor_da_turma(null) é falso — nega, que é o que se quer.
--
-- `immutable`: depende só do argumento. Isso permite ao planejador dobrar a
-- chamada em vez de reavaliá-la por linha.
create or replace function public.fn_turma_do_caminho(p_caminho text)
returns uuid
language sql
immutable
parallel safe
as $$
  select case
    when split_part(coalesce(p_caminho, ''), '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_caminho, '/', 1)::uuid
  end;
$$;

comment on function public.fn_turma_do_caminho(text) is
  'Extrai o uuid da turma da primeira parte de um caminho de objeto do bucket `calcos`. Devolve nulo (que nega, via fn_sou_instrutor_da_turma) se o caminho não estiver no formato esperado.';

revoke all on function public.fn_turma_do_caminho(text) from public;
grant execute on function public.fn_turma_do_caminho(text) to authenticated;

-- =============================================================================
-- 3. RLS DA TABELA
-- =============================================================================

alter table public.calcos enable row level security;

-- LEITURA. Duas formas de enxergar um calco:
--   * ser instrutor da turma (vê tudo, dos dois partidos — é ele quem monta o
--     exercício e precisa conferir o que publicou para cada lado);
--   * estar na turma E o calco ser da turma inteira (partido_id nulo) ou do
--     meu partido.
--
-- Não filtra `removido_em`: mesmo critério de `elementos_marcados` (0003) —
-- a exclusão lógica existe para auditar, e quem filtra o que está vigente é a
-- consulta do cliente. Um calco removido não é vazamento: os bytes dele já
-- não existem mais no Storage.
drop policy if exists calcos_ler on public.calcos;
create policy calcos_ler on public.calcos
  for select to authenticated
  using (
    public.fn_sou_instrutor_da_turma(turma_id)
    or (
      turma_id = public.fn_minha_turma()
      and (partido_id is null or partido_id = public.fn_meu_partido())
    )
  );

-- ESCRITA (publicar, editar aparência, remover): só o instrutor da turma, e o
-- `autor_id` é obrigado a ser ele mesmo — sem isso um instrutor poderia
-- publicar em nome de outro, e o painel mentiria sobre quem colocou aquilo no
-- mapa dos alunos.
drop policy if exists calcos_escrever on public.calcos;
create policy calcos_escrever on public.calcos
  for all to authenticated
  using (public.fn_sou_instrutor_da_turma(turma_id))
  with check (
    public.fn_sou_instrutor_da_turma(turma_id)
    and autor_id = auth.uid()
  );

-- =============================================================================
-- 4. BUCKET
-- =============================================================================
-- Privado (`public = false`): objeto de bucket público é servido por URL
-- adivinhável, sem passar por RLS nenhuma — seria o mesmo que não ter escrito
-- a seção 5. O cliente baixa com `supabase.storage.from('calcos').download()`,
-- que leva o JWT do usuário e passa pelas policies.
--
-- `file_size_limit` em 2 MB: ver a conta de egress no cabeçalho.
--
-- Sobre `allowed_mime_types`: NÃO é usado de propósito. O navegador reporta
-- .kmz como application/octet-stream, application/zip, application/x-zip-
-- compressed ou string vazia, dependendo do sistema operacional e de quais
-- programas estão instalados — uma lista branca de MIME rejeitaria arquivos
-- legítimos e não barraria nenhum ilegítimo, já que o MIME é declarado pelo
-- cliente. O que de fato valida o conteúdo é o parsing em frontend/kml.js.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage.buckets não existe neste banco — bucket `calcos` não criado. Normal num Postgres cru (backend/testes/00_stub_supabase.sql); NÃO é normal no Supabase.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('calcos', 'calcos', false, 2097152)
  on conflict (id) do update
    set public = false,
        file_size_limit = 2097152;
end $$;

-- =============================================================================
-- 5. RLS DO STORAGE
-- =============================================================================
-- O objeto vive em `storage.objects` com `name = '<turma_id>/<id>.<formato>'`,
-- que é exatamente a coluna `calcos.caminho` (garantida pelo trigger da
-- seção 2).
--
-- DECISÃO IMPORTANTE — a policy de leitura do objeto NÃO repete a regra de
-- quem vê o calco. Ela pergunta "existe uma linha de `calcos` com este
-- caminho que EU consiga ler?" e deixa `calcos_ler` responder. É o mesmo
-- princípio de fn_usuarios_visiveis() na 4.5: uma regra, um lugar. Se a
-- condição de partido fosse copiada para cá, as duas cópias divergiriam no
-- dia em que a Etapa 6.5 mudasse o recorte.
--
-- Isso se apoia num comportamento documentado do PostgreSQL: uma tabela
-- referenciada dentro da expressão de uma policy tem as policies DELA
-- aplicadas normalmente. É verdade, mas é uma dependência que merece ser
-- verificada AO VIVO, porque se algum dia deixasse de valer o modo de falha
-- seria ABERTO (o `exists` acharia a linha de qualquer calco e liberaria o
-- objeto), não fechado. O teste está registrado nas pendências da Etapa 7 no
-- ROADMAP: com token de aluno do Vermelho, baixar pelo caminho direto o
-- objeto de um calco do Azul tem que dar erro.
--
-- Nota de manutenção: um objeto sem linha correspondente em `calcos` (upload
-- que subiu e cujo insert falhou depois) fica ILEGÍVEL para todo mundo e
-- invisível no painel — órfão ocupando cota. O cliente cobre isso apagando o
-- objeto quando o insert falha; se sobrar lixo, é limpeza manual pelo painel
-- do Storage.

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects não existe neste banco — policies de Storage não criadas.';
    return;
  end if;

  execute 'drop policy if exists calcos_objeto_ler on storage.objects';
  execute $pol$
    create policy calcos_objeto_ler on storage.objects
      for select to authenticated
      using (
        bucket_id = 'calcos'
        and exists (
          select 1 from public.calcos c
          where c.caminho = storage.objects.name
            and c.removido_em is null
        )
      )
  $pol$;

  -- Escrever/apagar objeto: instrutor da turma cuja pasta é a primeira parte
  -- do caminho. Aqui a regra NÃO pode se apoiar em `calcos`, porque no upload
  -- o objeto sobe ANTES de a linha existir — não haveria o que consultar.
  execute 'drop policy if exists calcos_objeto_escrever on storage.objects';
  execute $pol$
    create policy calcos_objeto_escrever on storage.objects
      for all to authenticated
      using (
        bucket_id = 'calcos'
        and public.fn_sou_instrutor_da_turma(public.fn_turma_do_caminho(name))
      )
      with check (
        bucket_id = 'calcos'
        and public.fn_sou_instrutor_da_turma(public.fn_turma_do_caminho(name))
      )
  $pol$;
end $$;

-- =============================================================================
-- 6. REALTIME
-- =============================================================================
-- É o que faz o "na hora" da etapa ser verdade: o instrutor publica um calco
-- durante o exercício e ele aparece no aparelho dos alunos sem ninguém
-- recarregar nada — mesma razão de as tabelas de permissão estarem publicadas
-- desde a 0001 e de `perfis` ter entrado na 0004.
--
-- Publicar não alarga o alcance de ninguém: o Realtime aplica a policy de
-- SELECT antes de entregar cada evento, então `calcos_ler` continua valendo —
-- o aluno do Vermelho não recebe o evento do calco do Azul.

alter table public.calcos replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'calcos'
    ) then
      alter publication supabase_realtime add table public.calcos;
      raise notice 'calcos adicionada à publicação supabase_realtime.';
    end if;
  end if;
end $$;

-- =============================================================================
-- 7. GRANTS
-- =============================================================================

grant select, insert, update, delete on public.calcos to authenticated;
