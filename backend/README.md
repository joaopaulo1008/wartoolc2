# Backend — WartoolC2 (Supabase)

Schema Postgres, regras de acesso (RLS) e configuração de tempo real do WartoolC2. Corresponde à **Etapa 1** do [ROADMAP](../docs/ROADMAP.md).

Aqui só existe o **backend**: o frontend que consome isto vem nas Etapas 2 em diante.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `supabase/0001_schema_inicial.sql` | Tabelas, tipos, triggers, índices, view de permissões e publicação Realtime |
| `supabase/0002_rls.sql` | Row Level Security: funções auxiliares, políticas, grants e a RPC `entrar_na_turma` |
| `supabase/0003_partidos.sql` | Partidos por turma, hostilidade relativa e `fn_usuarios_visiveis()` (Etapa 4.5) |
| `supabase/0004_perfis_realtime.sql` | Publica `perfis` no Realtime, para a troca de força feita pelo instrutor chegar ao app do aluno (Etapa 6a) |
| `supabase/0005_rastro_historico.sql` | `fn_rastro_historico()`: leitura amostrada de `posicoes_historico` para o debriefing (Etapa 6b) |
| `testes/00_stub_supabase.sql` | Recria o mínimo do ambiente Supabase para rodar as migrations num Postgres cru. **Não rodar no Supabase** |
| `testes/01_teste_partidos.sql` | Teste de RLS com dois partidos: 43 verificações |

Aplicar **nesta ordem**. Todas são idempotentes (`if not exists` / `drop ... if exists`), então podem ser reaplicadas sem quebrar nem perder dado.

> Uma ressalva sobre reaplicar a `0001` depois da `0003`: a seção 9 dela referencia `marcacoes_inimigas`, que a `0003` renomeia. Se precisar reaplicar a `0001` num banco já migrado, rode a `0003` logo em seguida — a seção 8 dela reconcilia a publicação do Realtime.

## O schema em uma olhada

```
turmas ─────┬────< perfis ──────────< posicoes_atuais ──(trigger)──> posicoes_historico
   │        │         │
   │        └────< partidos <────────┤ (perfis.partido_id)
   │                  │              │
   │                  └──────────────┴< elementos_marcados (elementos_marcados.partido_id)
   │                  │
   │                  └──────────────< permissoes_usuario ─┐
   └────────────────────────────────< permissoes_turma ────┼──> vw_permissoes_efetivas
                                       catalogo_permissoes ┘
```

### `turmas`

Unidade de isolamento do sistema — um exercício de instrução. Tudo mais pendura aqui. O aluno entra numa turma informando o `codigo_acesso` (ex.: `5BDA-2026`); o `instrutor_id` aponta o responsável.

### `perfis`

Espelha `auth.users` (Supabase Auth) com os dados de domínio: `papel` (`instrutor` | `usuario`), `turma_id`, `nome_guerra`, `posto_graduacao` e o `sidc` — o código APP-6 do símbolo que representa o usuário no mapa, renderizado pelo milsymbol.

Criado automaticamente por trigger em `auth.users`: quando alguém se cadastra, o perfil aparece sozinho, lendo `nome_completo` e `papel` dos metadados do `signUp`.

### `posicoes_atuais` + `posicoes_historico`

Divisão deliberada:

- **`posicoes_atuais`** — uma linha por usuário, sobrescrita a cada leitura do GPS. É esta tabela que o mapa assina via Realtime: payload pequeno, poucas linhas, aguenta 60+ clientes simultâneos.
- **`posicoes_historico`** — append-only, para reconstituir o rastro no debriefing.

O cliente escreve **só em `posicoes_atuais`** (um `upsert`); um trigger copia para o histórico. Nenhuma lógica de duplicação no frontend.

### `partidos` (0003)

As forças em disputa dentro de uma turma — Azul e Vermelho de saída, criados automaticamente em toda turma nova. É **tabela e não enum**: acrescentar uma terceira força, um "verde/neutro" ou um partido "civil" é um `insert`, sem migration.

A coluna `tipo` (`beligerante` | `neutro`) é o que faz isso funcionar sem tocar em código: a derivação de hostilidade lê o `tipo`, não uma lista de nomes escrita no JavaScript. Um partido `neutro` sai neutro para todo mundo.

`cor` é só para a interface (legenda, filtros). **A cor do símbolo militar não vem daqui** — vem do dígito de hostilidade do SIDC, que é relativo a quem olha.

### `elementos_marcados` (0003, era `marcacoes_inimigas`)

Elementos que o usuário marca tocando no mapa, compartilhados com quem ele enxerga. Guardam `sidc`, **`partido_id`**, `titulo`, `descricao`, `efetivo_estimado` e `confianca` (1–5).

A troca de `hostilidade` (enum absoluto) por `partido_id` é a correção central da Etapa 4.5. Com Azul e Vermelho no mesmo exercício, gravar "hostil" é gravar uma meia-verdade: o mesmo pelotão é hostil para um lado e amigo para o outro. Guarda-se **a que partido o elemento pertence**, que é o fato; a hostilidade é derivada na hora de desenhar, por `sidcParaObservador()` em `frontend/simbolos.js`.

Consequência para quem for ler esta tabela: **os dígitos 3-4 do `sidc` gravado são um placeholder** (`01`, desconhecido). Não confie neles; passe pelo `sidcParaObservador()`.

`partido_id` nulo é legítimo: significa "vi alguém, não sei de quem é" e renderiza como DESCONHECIDO.

Exclusão é **lógica** (`removida_em` / `removida_por`), para o instrutor auditar depois o que foi apagado durante o exercício.

### Permissões — três camadas

| Tabela | Papel |
|---|---|
| `catalogo_permissoes` | Catálogo das chaves que o app conhece, com um `padrao` global. É tabela, não enum: dá para adicionar permissão nova sem migration |
| `permissoes_turma` | Padrão que o instrutor define para a turma inteira |
| `permissoes_usuario` | Override individual de um aluno específico |

A resolução final sai da view **`vw_permissoes_efetivas`**, com a precedência:

```
papel instrutor (tudo true) > override do usuário > padrão da turma > padrão do catálogo
```

A view também devolve a coluna `origem`, que diz qual das camadas decidiu. **Desde a Etapa 6a é isso que o painel do instrutor (`frontend/instrutor.html`) mostra em cada linha** — "herdado da turma" vs. "ajustado para este aluno" —, e é o que decide qual botão faz sentido oferecer: mudar o padrão da turma ou desfazer o ajuste individual.

Duas coisas para quem for mexer nisso depois:

- **O cliente lê da view, não das tabelas.** A única exceção é o painel de *padrão da turma*, que lê `permissoes_turma` direto — a view resolve a permissão de um **usuário** e por isso não sabe responder "esta chave está definida no nível da turma ou está caindo no padrão do catálogo?", que é justamente a diferença que aquele painel mostra e que o botão de limpar apaga.
- **A RLS não conhece estas chaves.** Ela restringe por turma e por partido (`fn_usuarios_visiveis`). O catálogo de permissões é aplicado no navegador, para a interface obedecer o instrutor — desligar `ver_posicao_outros` tira os colegas da tela, não do alcance da API. É suficiente para instrução; se alguma chave precisar valer de verdade, o lugar é uma policy nova, não o JavaScript.

Chaves cadastradas: `ver_mapa`, `ver_propria_posicao`, `ver_posicao_outros`, `enviar_posicao_gps`, `criar_marcacao_inimiga`, `editar_marcacao_propria`, `ver_marcacoes_outros`, `trocar_mapa_base`, `carregar_kml`, `carregar_imagem_geo`, `ver_historico_rastro` e as camadas `camada_manobra`, `camada_inimigo`, `camada_logistica`, `camada_obstaculos`, `camada_bdgex`.

## Geometria: lat/lon + `geom` derivada

Cada tabela com posição tem `latitude`/`longitude` (`double precision`) **e** uma coluna `geom geography(Point,4326)` com índice GIST.

- `latitude`/`longitude` são a **fonte de verdade** — é o que o frontend lê e escreve, direto no formato que o Leaflet espera, sem conversão nem parsing de WKB.
- `geom` é **derivada por trigger** e existe só para consultas espaciais no banco (`ST_DWithin` para geocercas, `ST_Distance` para proximidade). O frontend pode ignorá-la por completo.

Custa poucas linhas de SQL e evita uma migration futura quando aparecer a primeira necessidade de "alertar quando o aluno entrar na área X".

## Regras de acesso (RLS)

RLS está **ligada em todas as tabelas**. Resumo:

| | Aluno (`usuario`) | Instrutor |
|---|---|---|
| Posição própria | lê e escreve | lê |
| Posição dos colegas | lê **do próprio partido** | lê tudo da turma; pode apagar, não pode forjar |
| Histórico | só o próprio | tudo da turma |
| Marcações | cria/edita as próprias; lê as de quem enxerga | lê e edita todas da turma |
| Permissões | só lê as próprias | define para a turma e por aluno |
| Partidos | lê os da sua turma | cria, edita e **atribui a cada aluno** |
| Turma | lê a sua | cria e administra as suas |
| Próprio papel | **não pode alterar** | — |
| Próprio partido | **não pode alterar** | altera o de qualquer aluno da sua turma |

### `fn_usuarios_visiveis()` — o ponto único (0003)

A partir da 0003, as policies de leitura de `posicoes_atuais`, `posicoes_historico` e `elementos_marcados` **não perguntam mais "é da minha turma?"**. Elas perguntam uma coisa só:

```sql
usuario_id in (select public.fn_usuarios_visiveis())
```

Hoje a função devolve *eu + todo mundo do meu partido, na minha turma* (+ a turma inteira, se eu for instrutor dela). Na **Etapa 6.5** troca-se **só o corpo dela** para consultar a árvore ORBAT — nenhuma policy é reescrita. É esse o mecanismo que mantém a porta aberta; a seção 5 da migration lista as três invariantes que o corpo novo tem de manter, e `testes/01_teste_partidos.sql` é o que verifica se elas continuam de pé.

**Desempenho** (a função roda em toda leitura de posição, com 60+ usuários mandando GPS a cada poucos segundos): ela é `stable` + `parallel safe` e a subconsulta é **não correlacionada**, então o planejador a executa uma vez por consulta e resolve as linhas por hash. Confere com:

```sql
explain analyze select * from public.posicoes_atuais;
-- Filter: ((hashed SubPlan 1) OR fn_sou_instrutor_da_turma(turma_id))
--   SubPlan 1 ... (actual rows=N loops=1)   <- loops=1 é o que importa
```

Se um dia a função passar a receber parâmetro vindo da linha, ela vira correlacionada, o `loops=1` vira `loops=N` e esse ganho evapora.

**Partido nulo é restritivo:** quem ainda não foi distribuído numa força enxerga só a si mesmo e não é enxergado por ninguém. O instrutor é a exceção — vê a turma inteira, os dois partidos.

Três detalhes que valem registro:

1. **Funções `SECURITY DEFINER`.** As policies de `perfis` precisam consultar `perfis` para descobrir papel e turma do chamador. Se essa consulta passasse pela própria RLS, haveria recursão infinita. `fn_meu_papel()`, `fn_minha_turma()`, `fn_sou_instrutor()` e `fn_sou_instrutor_da_turma()` rodam com privilégio do dono e quebram o ciclo. Elas expõem apenas dados do próprio chamador.

2. **`entrar_na_turma(codigo)`.** `WITH CHECK` não enxerga o valor antigo da linha, então sozinho não impediria o aluno de trocar o próprio `turma_id` para uma turma alheia — bastaria adivinhar o UUID. Um trigger `BEFORE UPDATE` bloqueia a troca direta, e a RPC `entrar_na_turma()` é o único caminho, validando o `codigo_acesso`:

   ```js
   const { data, error } = await supabase.rpc('entrar_na_turma', { p_codigo: '5BDA-2026' })
   ```

3. **`posicoes_historico` é imutável pelo cliente.** Só tem policy de `SELECT` e só `GRANT SELECT`; a escrita acontece exclusivamente pelo trigger `SECURITY DEFINER`. Ninguém reescreve o próprio rastro.

### `fn_rastro_historico()` — leitura amostrada do rastro (0005)

A Etapa 6b (debriefing) é a primeira a **ler** `posicoes_historico`. O problema dela não é permissão — a RLS já estava pronta desde a 0002/0003 — é **volume**: com o throttling de `gps.js` (mínimo de 5s, distância de 10m, heartbeat de 30s), 60 alunos gravam de 120 a 720 linhas por minuto, e um exercício de 4 horas chega perto de 170 mil linhas.

A função devolve **um ponto por aluno por balde de N segundos** dentro de uma janela obrigatória, mais `leituras_no_balde` (quantas gravações reais aquele ponto representa — é o que deixa a tela dizer "1.240 pontos, representando 43.180 leituras" em vez de fingir que o rastro tem 1.240 posições).

Três coisas para quem for mexer nisso:

- **É `security invoker`, e isso não é detalhe.** Quase toda função deste projeto é `security definer`, mas por um motivo específico: elas são chamadas *de dentro* de policies e recursariam. Esta é chamada *de fora*, pelo cliente, e lê uma tabela protegida — `security definer` aqui faria a função **passar por cima de `historico_ler`**, e qualquer aluno autenticado leria o rastro de qualquer pessoa bastando ter o UUID. Sendo invoker, um aluno que chame a RPC recebe só o próprio rastro. É por isso que a permissão `ver_historico_rastro`, que é checada no navegador, não precisa ser barreira.
- **A consulta foi moldada para `idx_hist_usuario_tempo (usuario_id, medido_em desc)`**: igualdade na lista de alunos, faixa no tempo. `turma_id` **não** entra no filtro de propósito — empurraria o planejador para o índice por turma, muito menos seletivo, e a turma já é garantida pela policy.
- **A janela de tempo continua obrigatória mesmo com a amostragem.** A policy `historico_ler` chama `fn_sou_instrutor_da_turma(turma_id)` com uma coluna *da linha*, ou seja, de forma **correlacionada** — roda uma vez por linha bruta. Amostrar reduz o tráfego e a memória do navegador, não o trabalho do Postgres; quem limita esse trabalho é a janela. Se isso virar gargalo medido (Etapa 10), o conserto é na policy — trocar por algo não correlacionado, como `turma_id in (select fn_minhas_turmas())` —, não na função.

```sql
select * from public.fn_rastro_historico(
  array['<uuid-do-aluno>']::uuid[],
  now() - interval '1 hour', now(),
  30,      -- um ponto a cada 30 s
  12000    -- teto de linhas
);
```

> Testar isso pelo SQL Editor **não prova nada sobre a RLS**: ele roda como `service_role`. Para provar o isolamento, chame a RPC pelo app com o token de um aluno — ele deve receber só o próprio rastro mesmo passando o UUID de um colega.

## Tempo real

Ficam publicadas em `supabase_realtime`: `posicoes_atuais`, `elementos_marcados`, `partidos`, `permissoes_usuario`, `permissoes_turma` e — desde a `0004` — `perfis`. Todas com `REPLICA IDENTITY FULL`, para que o payload de `UPDATE`/`DELETE` traga a linha antiga e o cliente consiga comparar/filtrar.

Publicar as tabelas de permissão é o que faz o painel do instrutor surtir efeito **imediato** no app do aluno, sem refresh. `partidos` entrou pela mesma razão: renomear uma força ou criar uma terceira no meio do exercício chega ao app sem ninguém precisar recarregar a página.

`perfis` entrou na `0004` para fechar o caso mais pesado dos três: quando o instrutor move um aluno de força, muda **a hostilidade com que ele vê tudo** (a derivação compara o partido do observador com o do elemento) e **quem ele enxerga** (`fn_usuarios_visiveis`, consultada pelas policies de posição e marcação). Sem a publicação, o aluno continuaria com o mapa do lado antigo até apertar F5 — e nada avisaria que era preciso. O cliente (`frontend/perfil-ao-vivo.js`) assina só a própria linha e recarrega a página após um aviso curto; recarregar é deliberado, não preguiça — ver o cabeçalho daquele arquivo.

> Publicar a tabela **não alarga o que ninguém enxerga**: o Realtime aplica a RLS de `SELECT` antes de entregar cada evento, e `perfis_ler` já permitia a qualquer colega de turma ler essas mesmas colunas por consulta comum. Muda o caminho (empurrado em vez de perguntado), não o alcance.

Renomear uma tabela **não** a tira da publicação (a publicação guarda o OID, não o nome), então `elementos_marcados` seguiu publicada sozinha depois da renomeação — a seção 8 da `0003` verifica isso em vez de presumir.

## Como aplicar

### Opção A — Dashboard (mais rápido para começar)

1. Crie o projeto em [supabase.com](https://supabase.com) (o plano Free atende o orçamento de R$ 200/mês do projeto).
2. **Database → Extensions**: habilite `postgis` e `pgcrypto`.
3. **SQL Editor → New query**: cole o conteúdo de `supabase/0001_schema_inicial.sql` e rode.
4. Nova query: cole `supabase/0002_rls.sql` e rode.
5. **Database → Tables**: confira que as 8 tabelas apareceram com o cadeado de RLS ativo.

### Opção B — Supabase CLI (recomendado a partir da Etapa 2)

```bash
npm install -g supabase

cd backend
supabase login
supabase link --project-ref <ref-do-projeto>    # o ref está na URL do dashboard

supabase db push        # aplica as migrations de supabase/ em ordem
```

Para desenvolver offline, com Postgres + Studio locais em Docker:

```bash
cd backend
supabase start          # sobe a stack local
supabase db reset       # recria o banco e reaplica todas as migrations
supabase stop
```

> As migrations seguem o padrão numérico `NNNN_descricao.sql`. Ao criar a próxima, siga a sequência (`0003_...`) — o CLI aplica em ordem alfabética.

### Problemas comuns de conexão

**"O dashboard sugeriu `supabase db pull` e eu travei."**
Ignore. `db pull` **baixa** um schema que já existe no servidor e o converte em migration local — o inverso do que você quer. Aqui as migrations já estão escritas e o banco remoto está vazio. Aquele painel "Connect" mostra comandos genéricos, não um passo obrigatório do setup. Use o SQL Editor (Opção A).

**A conexão estoura o tempo, sem erro claro.**
A *Direct connection* (`db.<ref>.supabase.co`) resolve **só para IPv6**, e boa parte das redes domésticas e corporativas no Brasil é IPv4. Use a string do **Session pooler**, que é IPv4 — no dashboard, botão **Connect** → aba **Session pooler**:

```
postgresql://postgres.<ref>:<SENHA>@aws-0-<regiao>.pooler.supabase.com:5432/postgres
```

**"Senha incorreta."**
`<SENHA>` é a **senha do banco**, definida na criação do projeto — não é a `anon key` nem a senha da conta Supabase. Para redefinir: **Settings → Database → Reset database password**. Se a senha contiver `@`, `#`, `/` ou `:`, ela quebra a URL: use uma senha só com letras e números, ou codifique os caracteres.

### Verificação rápida depois de aplicar

```sql
-- 9 tabelas do projeto (8 + partidos), todas com rowsecurity = true.
-- `spatial_ref_sys` também aparece: é do PostGIS, não é nossa e não tem RLS.
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;

-- 24 políticas depois da 0003 (eram 22 antes; as 5 de marcações viraram 5 de
-- elementos_marcados e entraram 2 novas em partidos)
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' order by tablename;

-- catálogo de permissões populado (16 chaves)
select categoria, count(*) from public.catalogo_permissoes group by categoria;
```

## Depois de aplicar a 0003 (Etapa 4.5)

A `0003` é **incremental**: aplique-a sobre o banco que já está no ar, sem tocar em `0001` nem `0002`. No SQL Editor, cole o arquivo inteiro e rode. Ela é idempotente — rodar duas vezes não quebra nem perde dado.

### 1. Confira que a renomeação e o Realtime ficaram de pé

```sql
select
  to_regclass('public.marcacoes_inimigas') as antiga_deve_ser_null,
  to_regclass('public.elementos_marcados') as nova_deve_existir,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename in ('elementos_marcados','partidos')) as publicadas_deve_ser_2,
  (select count(*) from public.partidos) as partidos_deve_ser_2_por_turma;
```

### 2. **Distribua as forças — sem isso o mapa fica vazio**

Este passo não é opcional. Partido nulo é restritivo por decisão: enquanto ninguém tiver partido, **cada aluno enxerga só a si mesmo** e a Etapa 4 parece ter parado de funcionar. O instrutor continua vendo todo mundo.

Veja quem está sem força:

```sql
select p.id, p.nome_guerra, p.papel, t.codigo_acesso, pa.nome as partido
from public.perfis p
left join public.turmas t   on t.id  = p.turma_id
left join public.partidos pa on pa.id = p.partido_id
order by t.codigo_acesso, pa.nome nulls first, p.nome_guerra;
```

E atribua. **Desde a Etapa 6a o caminho normal é o painel do instrutor** (`frontend/instrutor.html` → selecione o aluno → seletor **Força** no topo da grade). Com a `0004` aplicada, o app do aluno recarrega sozinho quando isso muda. O SQL abaixo continua valendo para distribuir a turma inteira de uma vez, que é mais rápido do que clicar aluno por aluno na montagem do exercício:

```sql
-- todo mundo da turma TESTE para o Azul, para voltar ao comportamento de antes
update public.perfis p set partido_id = (
  select id from public.partidos
  where turma_id = p.turma_id and nome = 'Azul'
)
where p.papel = 'usuario'
  and p.turma_id = (select id from public.turmas where codigo_acesso = 'TESTE');

-- e depois mova para o Vermelho quem for do outro lado
update public.perfis p set partido_id = (
  select id from public.partidos
  where turma_id = p.turma_id and nome = 'Vermelho'
)
where p.nome_guerra in ('fulano', 'beltrano');
```

O instrutor **não** precisa de partido: ele enxerga a turma inteira de qualquer jeito.

### 3. Prove o isolamento com uma conta de verdade

Abra o app com um aluno do Azul e outro do Vermelho ao mesmo tempo (duas janelas anônimas). Cada um deve ver só os do próprio lado; o instrutor, os dois. O contador `#colegas-status` na topbar é o jeito mais rápido de conferir.

Para ver o mesmo pela API, sem UI, use um JWT de aluno e:

```sql
-- rodando como o aluno (não pelo SQL Editor, que é service_role e ignora RLS)
select * from public.fn_usuarios_visiveis();
```

> **Atenção:** o SQL Editor do Supabase roda como `service_role` e **passa por cima da RLS**. Qualquer teste de visibilidade feito lá vai mostrar tudo e não prova nada. Teste pelo app, ou pelo PostgREST com o token do aluno.

### Rodando os testes fora do Supabase

`backend/testes/` roda contra um Postgres+PostGIS qualquer, sem Supabase:

```bash
createdb wt
psql -d wt -f backend/testes/00_stub_supabase.sql
psql -d wt -f backend/supabase/0001_schema_inicial.sql
psql -d wt -f backend/supabase/0002_rls.sql
psql -d wt -f backend/supabase/0003_partidos.sql
psql -d wt -f backend/supabase/0004_perfis_realtime.sql
psql -d wt -f backend/supabase/0005_rastro_historico.sql
psql -d wt -f backend/testes/01_teste_partidos.sql   # 43 verificações

node frontend/simbolos.teste.mjs                     # 20 verificações
node frontend/marcacoes.teste.mjs                    # 40 verificações
node frontend/rastro.teste.mjs                       # 64 verificações
```

`00_stub_supabase.sql` cria o schema `auth`, a função `auth.uid()`, os papéis e a publicação que o Supabase já traz prontos — **não rode esse arquivo no Supabase**. Em Postgres 14 é preciso comentar a linha `alter view ... set (security_invoker = true)` de `0002` (é PG15+; o Supabase tem PG15+).

### Criando o primeiro instrutor

O `papel` vem dos metadados do `signUp`, mas deixar o cliente escolher o próprio papel seria uma brecha óbvia. Em produção, cadastre normalmente (todo mundo nasce `usuario`) e promova pelo SQL Editor, que roda como `service_role` e passa por cima da RLS:

```sql
update public.perfis set papel = 'instrutor'
where id = (select id from auth.users where email = 'instrutor@exemplo.mil');
```

## Próximo passo

**Etapa 6a — Painel do instrutor (permissões por usuário): concluída.** Também sem migration nova: as três tabelas de permissão, a `vw_permissoes_efetivas` e a publicação delas no Realtime existem desde a `0001`/`0002` — a 6a foi a primeira a usá-las, em `frontend/permissoes.js` (fonte única de permissão no cliente) e `frontend/instrutor-permissoes.js` (a tela). Ver [../docs/ROADMAP.md](../docs/ROADMAP.md) e a seção "Decisões da Etapa 6a" em [../CLAUDE.md](../CLAUDE.md).

O painel também distribui as **forças** (`perfis.partido_id`), operação que antes só existia como `UPDATE` no SQL Editor — nenhuma regra nova foi precisa (a policy `perfis_editar_instrutor` e os triggers da `0003` já cobriam), só a tela. A única migration desta etapa é a **`0004`**, que publica `perfis` no Realtime para essa troca chegar ao aluno.

**Aplique a `0004` junto:** sem ela o painel funciona, mas o aluno só vê o efeito da troca de força no próximo F5.

Uma pegadinha operacional que aparece agora: escrever em `permissoes_turma`/`permissoes_usuario` exige passar por `fn_sou_instrutor_da_turma()`, ou seja, o instrutor precisa **estar lotado na turma** (`perfis.turma_id`) **ou ser o responsável dela** (`turmas.instrutor_id`). Num banco onde a turma `TESTE` foi criada pelo SQL Editor sem `instrutor_id`, o segundo caminho não existe — o painel detecta isso, desabilita os controles e mostra o `update` de correção. Para resolver de uma vez:

```sql
update public.turmas
set instrutor_id = (select id from auth.users where email = 'instrutor@wartool.local')
where codigo_acesso = 'TESTE';
```

**Etapa 6b — histórico/replay de posições: concluída.** A única migration é a **`0005`**, e ela não cria nem altera regra nenhuma: só acrescenta `fn_rastro_historico()`, uma função de LEITURA `security invoker` (ver a seção sobre ela acima). O dado já era gravado desde a Etapa 3 e a RLS já deixava o instrutor lê-lo — o que faltava era a tela e uma forma de ler o rastro sem trazer 170 mil linhas para o navegador.

**Aplique a `0005`:** sem ela, a aba de debriefing avisa que a função não existe e não busca nada. O resto do painel continua funcionando normalmente.

Próximo: **Etapa 6.5 (hierarquia ORBAT)** ou **Etapa 7 (upload de KML)** — ver [../docs/ROADMAP.md](../docs/ROADMAP.md).
