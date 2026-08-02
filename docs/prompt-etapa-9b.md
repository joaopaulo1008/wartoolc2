# Prompt para abrir a Etapa 9b — Catálogo oficial de símbolos + correção pelo instrutor + coordenadas em 3 formatos

**Modelo sugerido: mais forte (Opus).** Não é troca mecânica de dados: tem pelo menos seis
decisões reais de arquitetura (estrutura do catálogo novo, onde buscar os JSON, precedência de
origem do SIDC, auditoria de edição, onde persistir a preferência de coordenada, biblioteca vs.
matemática própria para UTM) e mexe em módulos centrais usados por praticamente toda a
aplicação (`simbolos.js`, `marcacoes.js`, `gps.js`, `colegas.js`, `icones.js`). Maior superfície de
decisão do que a 8b, que já era "intermediário".

---

Lê o CLAUDE.md e o docs/ROADMAP.md do projeto WartoolC2 (pasta `wartoolc2/`) — em especial a
seção "Decisões da Etapa 9a" (bundler, recém-concluída) e o item **Etapa 9b** de "A fazer, em
ordem" (já tem o resultado da investigação sobre `simbologia.eb.mil.br` escrito lá: 12 arquivos
JSON públicos, um por categoria, cada um com `Entity`/`Entity Type`/`Entity Subtype` em inglês,
`sector 1`/`sector 2` (modificadores), `ExtEntity` (extensões brasileiras), `ModificadoresEB`, e
`icones_centrais` com `Code`, `NomeBR` e `sidcBR`). Lê também `frontend/simbolos.js` (as tabelas
manuais atuais — HOSTILIDADE, DIMENSAO, SITUACAO, ESCALAO, HQTF, NATUREZA — e `getSIDC()`/
`decomporSidc()`/`hostilidadeRelativa()`/`aplicarHostilidade()`/`sidcParaObservador()`, que são a
API pública que outros módulos consomem e que **não pode quebrar**), `frontend/marcacoes.js`
(inteiro — o formulário de criar/editar marcação, e note em especial a linha `const podeMexer =
meuPapel === 'instrutor' || (row.autor_id === meuUserId && podeEditarPropria())`: a autoridade do
instrutor para editar/remover QUALQUER marcação da turma **já existe hoje**, é sobre ela que o
formulário novo do catálogo tem que continuar funcionando), `frontend/gps.js` (o popup do próprio
avatar, linhas ~270-274, e como `perfil.sidc` chega pronto do banco sem ser montado na mão),
`frontend/colegas.js` (popup do colega, mesmo padrão), `frontend/icones.js` (o desenho do símbolo
compartilhado pelos três), `frontend/auth.js` (a query que já traz `preferencias_visualizacao`
junto do perfil, ~linha 212), `backend/supabase/0003_partidos.sql` (onde `perfis.preferencias_visualizacao`
jsonb foi criada, na Etapa 4.5 — **existe desde então e nunca foi consumida por nenhuma
interface** — ver o comentário "a interface de filtros não foi feita nesta etapa, só a coluna"),
`backend/supabase/0001_schema_inicial.sql` (default de `perfis.sidc`), e `backend/seed/` (o CSV
modelo da Etapa 2c — adiada, mas o formato já reserva uma coluna de SIDC por usuário) antes de
começar.

Vamos fazer a **Etapa 9b, com escopo ampliado em relação ao que estava registrado no ROADMAP**
(decisão tomada em 2026-08-01, direto com o usuário, fora do ROADMAP até agora — registre lá como
parte desta etapa). Três frentes, nesta ordem de dependência:

## Contexto

A Etapa 9a (bundler) acabou de ser concluída e commitada. A 9b original só previa trocar as
tabelas manuais de `simbolos.js` pelas do catálogo oficial. O usuário pediu para essa mesma etapa
também cobrir: (a) autoridade explícita do instrutor para corrigir simbologia errada lançada por
aluno — que **parcialmente já existe** (ver `podeMexer` acima), o trabalho real aqui é garantir que
sobrevive à reforma do formulário e cobrir o caso de auditoria; (b) de onde vem o SIDC "de origem"
de cada usuário (lista da Etapa 2c, cadastro próprio, ou uma ORBAT carregada — a Etapa 6.5, que
segue adiada); e (c) mostrar a coordenada atual, em três formatos selecionáveis (UTM, geográfica
decimal, geográfica em graus/minutos/segundos), tanto para a própria posição quanto para toda
entidade lançada por um usuário (marcações).

## Decida e justifique, antes de codar:

1. **Estrutura do catálogo novo.** Duas respostas possíveis: (a) manter a forma atual de
   `simbolos.js` (tabelas chave→código, um `<select>` plano por campo) só trocando os VALORES pelos
   do catálogo oficial; ou (b) reformular para navegação hierárquica (categoria → entidade →
   subtipo → modificador), do jeito que o próprio portal `simbologia.eb.mil.br` organiza os 12
   JSON. A opção (b) é fiel à fonte e evita listas gigantes num `<select>` só, mas é uma reforma de
   UI bem maior no formulário de `marcacoes.js`. A hostilidade **continua fora do catálogo**: ela
   segue sendo relativa/calculada em runtime por `hostilidadeRelativa()`/`aplicarHostilidade()` —
   isso não muda nesta etapa.
2. **Onde os 12 JSON vivem.** Baixar uma vez e commitar (ex.: `data/simbologia-eb/*.json`, no
   mesmo espírito de `data/*.geojson` já servido hoje) é o caminho mais robusto — não depende de
   `simbologia.eb.mil.br` estar no ar durante um exercício de campo, e evita CORS. Buscar ao vivo do
   site é mais simples de manter atualizado, mas é uma dependência de rede nova e um ponto de falha
   a mais em campo (o projeto já evita isso — ver por que `REPO_RAW` parou de apontar para
   `raw.githubusercontent.com` na Etapa 11). Decida, e se for baixar e commitar, documente a data e
   a fonte exata de onde veio cada arquivo.
3. **Precedência de origem do SIDC "de fábrica" de um usuário** (`perfis.sidc`). Três fontes
   possíveis, por ordem de prioridade a decidir: seed da Etapa 2c (CSV com SIDC por linha — hoje
   adiada, mas o mecanismo já existe), cadastro do próprio usuário (login.html não pede SIDC hoje —
   decida se isso muda), e uma ORBAT carregada (Etapa 6.5, adiada — **não implemente a 6.5**, só
   deixe pronto o ponto de extensão: por exemplo, um comentário/campo claro em `perfis` ou na
   função que resolve o SIDC do usuário, indicando onde a 6.5 entraria no meio dessa precedência
   quando for feita).
4. **Auditoria de correção do instrutor.** Hoje `elementos_marcados` tem `removida_em`/
   `removida_por` (quem apagou), mas nenhuma coluna equivalente para EDIÇÃO (quem foi o último a
   mudar natureza/entidade de uma marcação que não é dele). Decida se vale acrescentar
   `editada_em`/`editada_por` (mesma migration que ajustar as colunas do catálogo novo, se
   houver) — importante para o aluno não ficar confuso vendo o próprio símbolo mudar sozinho sem
   saber que foi o instrutor.
5. **Onde persistir o formato de coordenada escolhido.** `perfis.preferencias_visualizacao`
   (jsonb) existe desde a Etapa 4.5 e nunca foi usada por nenhuma interface — é o lugar óbvio (ex.:
   chave `formato_coordenada: 'utm' | 'decimal' | 'dms'`). Decida o padrão (UTM é o que o Exército
   usa em campo/nas cartas BDGEx; decimal é o que GPS de celular mostra nativamente) e se a escolha
   é por usuário (preferências) ou por turma (instrutor decide para todo mundo, outra chave em
   `permissoes`/`catalogo_permissoes`) — a primeira é mais simples e é a recomendação, mas
   justifique a que escolher.
6. **UTM: biblioteca ou matemática própria.** Converter lat/lon (WGS84) para UTM exige a fórmula
   de projeção Transversa de Mercator (não é trivial nem uma regra de três) e a BUSCA da zona certa
   a partir da longitude (o Brasil cruza várias zonas, aproximadamente 18S a 25S). Com bundler
   (Etapa 9a) já dá pra adicionar uma dependência leve (ex.: pacote `utm` no npm) sem custo de CDN
   — decida entre isso e implementar a fórmula à mão num módulo puro e testável (padrão de
   `rastro.js`/`kml.js`). Se for dependência nova, confira o tamanho dela no bundle antes de
   decidir (o aviso de chunk grande que já apareceu no build da 9a é um sinal de atenção).

## O que eu preciso:

1. **Fonte de dados nova**, expondo o catálogo oficial preservando a API pública que
   `colegas.js`/`gps.js`/`icones.js`/`index.html` já consomem hoje (`getSIDC()`, `decomporSidc()`,
   `chavePorValor()`, `hostilidadeRelativa()`, `aplicarHostilidade()`, `sidcParaObservador()`) — o
   objetivo é esses quatro consumidores não precisarem mudar, só a FONTE dos dados atrás de
   `simbolos.js` muda.
2. **Formulário de marcação reformulado** (`frontend/marcacoes.js`) usando o catálogo novo (rótulos
   `NomeBR` oficiais, não mais os reduzidos de hoje), na estrutura decidida no item 1 de "decida e
   justifique".
3. **Autoridade do instrutor preservada e confirmada explicitamente**: com o formulário novo, um
   instrutor abrindo `situacao.js` (aba "Situação atual") continua conseguindo editar QUALQUER
   marcação de QUALQUER aluno da turma (natureza/entidade errada incluída), salvando e propagando
   por Realtime para o aparelho do aluno — mesmo caminho de código que já existe
   (`abrirFormulario(marker.getLatLng(), { marcacaoExistente: atual.row })`), só com o catálogo
   novo por trás.
4. **Origem do SIDC do próprio usuário**, documentada e (se a decisão do item 3 de "decida e
   justifique" exigir) implementada — sem implementar a Etapa 6.5 em si.
5. **Módulo puro de coordenadas** (novo, ex. `frontend/coordenadas.js`), com conversão lat/lon para
   os três formatos (UTM com zona correta e hemisfério; decimal; graus/minutos/segundos com
   hemisfério N/S e E/W) e teste em Node (`frontend/coordenadas.teste.mjs`) cobrindo pelo menos: um
   ponto de referência conhecido (compare contra uma calculadora UTM confiável, não invente o
   valor esperado), a fronteira entre duas zonas UTM, e latitude/longitude negativas (hemisfério
   sul/oeste, o caso normal do Brasil).
6. **Seletor de formato de coordenada** (UTM / decimal / DMS), lendo e gravando em
   `perfis.preferencias_visualizacao` (ou onde o item 5 de "decida e justifique" definir), com
   efeito imediato (sem recarregar a página) na coordenada mostrada em: o popup do próprio avatar
   (`gps.js`), o popup de cada colega (`colegas.js`), e o popup de cada marcação (`marcacoes.js`) —
   as três leituras devem vir do MESMO lugar (não duplicar a lógica de formatação em três arquivos).
7. `CLAUDE.md` ganha uma seção "Decisões da Etapa 9b" cobrindo as seis decisões acima (mesmo
   padrão de "Decisões da Etapa N" de todas as etapas anteriores) e `docs/ROADMAP.md` move a etapa
   para "Feito".

## NÃO implemente:

- **Etapa 6.5** (hierarquia ORBAT) — só deixe o ponto de extensão claro na precedência de origem
  do SIDC, não implemente a árvore de unidades nem `fn_usuarios_visiveis()` nova.
- **Etapa 2c** (seed de usuários) em si — o CSV/script já existem e seguem adiados; esta etapa só
  precisa ASSUMIR que, quando ela rodar, `perfis.sidc` vem preenchido de lá.
- **Mudanças em `hostilidadeRelativa()`/`aplicarHostilidade()`** além do estritamente necessário
  para o novo formato de dados — a lógica de hostilidade relativa já está correta e testada
  (`simbolos.teste.mjs`), não mexa nela.
- **Um painel geral de `preferencias_visualizacao`** — implemente só a chave de formato de
  coordenada, não uma interface completa de filtros (isso segue registrado como pendência
  separada, ela mesma referenciada desde a Etapa 4.5).
- **Etapa 10** (teste de carga).

## Verificação:

`node --check` + parsing (`acorn`, se precisar dos mesmos cuidados de `<script>` embutido em HTML
já documentados) nos arquivos novos/alterados, e as oito suítes existentes continuando 100%
verdes — **381** casos ao todo (25 `simbolos`, 40 `marcacoes`, 64 `rastro`, 116 `kml`, 20
`basemaps`, 14 `dispersar-avatares`, 68 `carta-offline`, 34 `imagem-geo`) — mais a suíte nova de
`coordenadas.teste.mjs`. Se houver migration (provável, pelo menos para `editada_por`/`editada_em`
e/ou colunas do catálogo), valide com `backend/testes/valida_sql.py`. Se adicionar dependência npm
nova (decisão do item 6), rode `npm run build` e confira o tamanho do bundle.

## Pendências de teste ao vivo a acrescentar em `docs/roteiro-teste-campo.md`:

Escolher os três formatos de coordenada e conferir que o valor mostrado bate com o que o GPS do
celular/uma referência externa mostra (principalmente UTM — é o formato mais fácil de acertar a
zona errada sem perceber); instrutor corrigindo a natureza de uma marcação de aluno em campo real
e o aluno vendo a mudança sem precisar de F5; conferir que a precedência de origem do SIDC bate
com o que o roteiro de cadastro real (Etapa 2c, quando ativada) vai produzir.
