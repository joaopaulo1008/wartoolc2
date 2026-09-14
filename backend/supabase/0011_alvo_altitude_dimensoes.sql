-- =============================================================================
-- WartoolC2 — Migration 0011: altitude e dimensões do alvo
--
-- Incremental sobre 0001..0010, que NÃO são reescritas. Idempotente: rodar
-- duas vezes não quebra nem perde dado.
--
-- Aplicar DEPOIS de 0010_icones_rapidos.sql.
--
-- POR QUE ESTA MIGRATION EXISTE
-- ------------------------------
-- Pedido da artilharia, trazido por quem conduz a instrução (2026-09-14):
-- poder ver, na marcação, a **altitude do alvo** e a **dimensão do alvo**.
-- São os dois campos que faltavam para o popup deixar de ser "onde está" e
-- passar a ser uma descrição de alvo utilizável num pedido de fogo — o vetor
-- (distância e lançamento) já existe desde 2026-08-02, em frontend/visada.js.
--
-- QUATRO COLUNAS, TODAS NULÁVEIS, NENHUMA POLICY TOCADA
-- ------------------------------------------------------
-- A RLS de `elementos_marcados` (0003) decide QUEM lê e QUEM escreve a linha;
-- acrescentar colunas não muda nada disso, e por isso nenhuma policy é
-- reescrita aqui — mesma postura da 0009, que acrescentou duas colunas de
-- auditoria sem tocar em regra de acesso.
--
-- Nuláveis porque **nenhum dos dois é conhecido no contato rápido**. A paleta
-- de ícones (0010) existe justamente para gravar um elemento em dois toques; se
-- estes campos fossem obrigatórios, ou a paleta deixaria de funcionar, ou o
-- app passaria a gravar zeros que alguém leria como medida. Um campo vazio é
-- honesto; um campo preenchido por default é uma afirmação falsa.

-- =============================================================================
-- 1. ALTITUDE DO ALVO — e a ORIGEM dela, que é tão importante quanto o número
-- =============================================================================
-- `altitude_m` sozinha seria um número sem procedência, e para tiro isso é
-- perigoso: uma cota derivada de modelo digital de elevação e uma cota lida na
-- carta pelo observador não valem a mesma coisa, e quem usa precisa saber qual
-- das duas está olhando. **Cota derivada apresentada como medida é o pior modo
-- de falha desta migration** — é a mesma classe de erro que o projeto recusa
-- desde a Etapa 6b (o debriefing diz quantas leituras cada ponto representa) e
-- desde a Etapa 7 (a tela avisa quando simplificou uma geometria).
--
-- Por isso as duas colunas andam JUNTAS e o `check` exige isso: ou existem as
-- duas, ou não existe nenhuma. Não há altitude anônima nesta tabela.
--
-- Os dois valores de `altitude_fonte`:
--   'manual' — o observador digitou (leu na carta, ou sabe de outra forma).
--   'mde'    — veio de um modelo digital de elevação consultado pelo app.
--
-- 'mde' AINDA NÃO TEM PRODUTOR no frontend, de propósito, e a coluna já aceita
-- o valor para a consulta poder entrar depois sem migration. A escolha da
-- fonte ficou em aberto por uma razão que não é técnica: consultar um serviço
-- público de elevação **envia a coordenada do alvo para um terceiro**. Para
-- instrução talvez não importe; para uso real, importa muito. O caminho certo
-- é um serviço do próprio Exército (o BDGEx publica serviços OGC, mas não deu
-- para confirmar daqui se algum entrega elevação por ponto) — e essa
-- confirmação precisa ser feita de dentro da rede, por alguém que possa olhar.
-- Até lá, o app grava só 'manual'.
alter table public.elementos_marcados
  add column if not exists altitude_m numeric(7,1);

alter table public.elementos_marcados
  add column if not exists altitude_fonte text;

comment on column public.elementos_marcados.altitude_m is
  'Altitude do ALVO em metros. Nulável: raramente se sabe num contato rápido. Sempre acompanhada de altitude_fonte.';
comment on column public.elementos_marcados.altitude_fonte is
  'De onde veio a altitude: manual (o observador digitou) ou mde (modelo digital de elevação). NUNCA mostrar a altitude sem dizer a fonte.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'elementos_altitude_fonte_check'
  ) then
    alter table public.elementos_marcados
      add constraint elementos_altitude_fonte_check
      check (altitude_fonte is null or altitude_fonte in ('manual', 'mde'));
  end if;

  -- As duas juntas ou nenhuma. Sem isto seria possível gravar um número sem
  -- procedência (o caso perigoso) ou uma procedência sem número (inofensivo,
  -- mas sintoma de cliente com defeito).
  if not exists (
    select 1 from pg_constraint where conname = 'elementos_altitude_com_fonte'
  ) then
    alter table public.elementos_marcados
      add constraint elementos_altitude_com_fonte
      check ((altitude_m is null) = (altitude_fonte is null));
  end if;

  -- Faixa: o Brasil vai de ~0 (nível do mar) a 2 995 m (Pico da Neblina). O
  -- teto de 9 000 e o piso de -500 não são "o mundo": são largos o bastante
  -- para nunca barrar um dado legítimo e estreitos o bastante para pegar erro
  -- de digitação óbvio (uma cota em centímetros, ou um dígito a mais).
  if not exists (
    select 1 from pg_constraint where conname = 'elementos_altitude_faixa'
  ) then
    alter table public.elementos_marcados
      add constraint elementos_altitude_faixa
      check (altitude_m is null or (altitude_m >= -500 and altitude_m <= 9000));
  end if;
end $$;

-- =============================================================================
-- 2. DIMENSÕES DO ALVO — frente × profundidade, em metros
-- =============================================================================
-- A forma escolhida foi decidida com quem usa: **dois números em metros**, que
-- é como a descrição de alvo entra no pedido de fogo. Descartadas na mesma
-- conversa: um `tipo` (pontual/linear/área) com campos variáveis, que é mais
-- fiel à doutrina mas custa um campo a mais no formulário; e desenhar a
-- geometria no mapa, que é mais natural de usar e exigiria guardar geometria
-- em vez de dois números — etapa própria, não um acréscimo.
--
-- As duas são independentes de propósito: um alvo linear (uma coluna numa
-- estrada) tem frente e profundidade desprezível, e faz sentido gravar só a
-- frente. **Não existe `check` exigindo as duas juntas** — ao contrário da
-- altitude, onde o par número+fonte é o que dá sentido ao dado.
alter table public.elementos_marcados
  add column if not exists frente_m integer;

alter table public.elementos_marcados
  add column if not exists profundidade_m integer;

comment on column public.elementos_marcados.frente_m is
  'Frente do alvo em metros (a dimensão perpendicular à direção de tiro). Nulável; independente de profundidade_m.';
comment on column public.elementos_marcados.profundidade_m is
  'Profundidade do alvo em metros. Nulável; um alvo linear normalmente tem só frente.';

do $$
begin
  -- Teto de 20 km por eixo: acima disso não é um alvo, é uma zona — e o valor
  -- quase certamente é erro de digitação. Zero é recusado junto com o negativo
  -- porque "alvo de 0 m de frente" não descreve nada: quem não sabe a dimensão
  -- deixa em branco, que é o estado honesto.
  if not exists (
    select 1 from pg_constraint where conname = 'elementos_frente_faixa'
  ) then
    alter table public.elementos_marcados
      add constraint elementos_frente_faixa
      check (frente_m is null or (frente_m > 0 and frente_m <= 20000));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'elementos_profundidade_faixa'
  ) then
    alter table public.elementos_marcados
      add constraint elementos_profundidade_faixa
      check (profundidade_m is null or (profundidade_m > 0 and profundidade_m <= 20000));
  end if;
end $$;

-- =============================================================================
-- 3. O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
-- =============================================================================
--   * Não mexe em RLS. As policies de 0003 continuam decidindo tudo sobre
--     quem lê e escreve esta tabela.
--   * Não mexe na publicação de Realtime. `elementos_marcados` já é publicada
--     com `replica identity full` desde a 0001 — colunas novas entram nos
--     eventos sozinhas, sem nada a declarar aqui.
--   * Não acrescenta chave em `catalogo_permissoes`. Preencher altitude e
--     dimensão é parte de criar/editar marcação, que já tem dono
--     (`criar_marcacao_inimiga` / `editar_marcacao_propria`, Etapa 6a). Um
--     interruptor separado para um par de campos seria mais um estado que
--     ninguém saberia explicar em campo.
--   * Não define a fonte de MDE. Ver a seção 1: é decisão que depende de
--     confirmar, de dentro da rede do Exército, se há serviço de elevação
--     próprio — e mandar coordenada de alvo para serviço público de terceiro
--     não é detalhe de implementação.
