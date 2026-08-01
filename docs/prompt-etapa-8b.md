# Prompt para abrir a Etapa 8b — Foto aérea / carta atualizada, publicada pelo instrutor

**Modelo sugerido: intermediário (Sonnet).** Complexidade média, mas não é troca mecânica: tem
decisão real de arquitetura (georreferenciamento, formato de dado novo, conta de egress que não
fecha sozinha). Em compensação, não tem a classe de risco "modo de falha silencioso" que pesou na
8a — o arquivo vem do próprio Supabase Storage, mesmo caminho de download com token que `calcos`
já usa hoje, sem CORS nem resposta opaca envolvida.

**A Etapa 8a (mapa offline) já está concluída** — Service Worker + Cache API cacheando tiles do
BDGEx, com decisão pendente nesta etapa sobre se a distribuição da imagem reaproveita esse
mecanismo em vez de fazer todo mundo baixar o arquivo inteiro (ver item 3 abaixo).

---

Lê o CLAUDE.md e o docs/ROADMAP.md do projeto WartoolC2 (pasta `wartoolc2/`, seções "Decisões da
Etapa 7" e "Decisões da Etapa 8a"), e também `backend/supabase/0006_calcos.sql` (a tabela/bucket
que esta etapa provavelmente estende — leia o cabeçalho inteiro, em especial as seções 2-5 sobre
o trigger de caminho, RLS e policies de Storage, que são o padrão a repetir ou herdar),
`frontend/kml.js` (em especial `FAIXAS_PANE`, o comentário de linhas ~178-193 sobre o mecanismo
de pane já ter sido desenhado para servir a imagem georreferenciada "sem mudança", e
`planejarCarga()`/`planejarGuardar()` como padrão de "decidir limite em módulo puro e testável"),
`frontend/instrutor-calcos.js` (o formulário de publicação do instrutor — ver o que sobrou depois
da 8a ter tirado o controle de opacidade de lá), `frontend/camadas.js` (o painel que liga/desliga
e colore camadas de arquivo no app do aluno), `frontend/permissoes.js` (`CHAVES_APLICADAS` — note
que `carregar_imagem_geo` é a única chave do catálogo que ainda não está na lista),
`backend/supabase/0001_schema_inicial.sql` (a definição de `carregar_imagem_geo` no catálogo —
tipo `funcao`, padrão `false`, descrição "Carregar imagem georreferenciada **própria**" — compare
com a descrição de `carregar_kml`), e `frontend/carta-offline.js`/`frontend/offline-tela.js`/
`frontend/sw-bdgex.js` (o mecanismo de cache de tiles da 8a, caso a decisão do item 3 opte por
reaproveitá-lo) antes de começar.

Vamos fazer a **Etapa 8b: foto aérea ou carta atualizada, publicada pelo instrutor.**

**Contexto.** É o que sobrou da Etapa 8 original depois que a parte de maior valor para o uso
real virou a 8a (cache offline). Esta etapa herda quase tudo da Etapa 7: a tabela `calcos` e o
bucket já são "arquivo publicado pelo instrutor", não "KML especificamente" — `formato` é um
`check` de texto, acrescentar um valor é uma linha; e o mecanismo de panes do Leaflet já foi
desenhado para servir raster igual a vetor, um `L.imageOverlay` num pane herda opacidade e
z-index sem código novo.

**Uma tensão que o ROADMAP não resolve sozinho, e que você precisa decidir antes de codar** (é o
item 1 abaixo): a Etapa 7 teve DOIS caminhos para o KML virar camada — o arquivo LOCAL do aluno
(`carregar_kml`, sem rede, sem banco, é dele que decompoe `frontend/camadas.js`) e o calco
PUBLICADO pelo instrutor (tabela `calcos`, chaves `camada_*`). O catálogo de permissões só tem
UMA chave para imagem, `carregar_imagem_geo`, classificada `funcao` (não `camada`) e com a mesma
redação de "própria" que `carregar_kml` usa — ou seja, pela convenção que o próprio catálogo já
estabeleceu, essa chave deveria governar o caminho LOCAL do aluno, não o do instrutor. Mas a nota
do ROADMAP para esta etapa fala só do caminho do instrutor ("Só o instrutor publica, como já é
com os calcos"). As duas coisas não se encaixam sozinhas — decida.

## Decida e justifique, antes de codar:

1. **UM CAMINHO OU DOIS.** Implementar só o caminho do instrutor (mais simples, mais alinhado ao
   que o ROADMAP descreveu) deixa `carregar_imagem_geo` sem função correspondente — o que
   contradiz a própria nota do ROADMAP de que esta etapa é "a que liga a última chave sem efeito
   do catálogo". Implementar os dois caminhos, como a Etapa 7 fez para KML, fecha a chave de
   verdade mas dobra a superfície da etapa (duas UIs, dois fluxos de validação). Um meio-termo
   possível: implementar só o caminho do instrutor agora e deixar `carregar_imagem_geo`
   deliberadamente sem interface, com uma nota explícita em `CLAUDE.md`/`permissoes.js` dizendo
   que ela segue reservada para um caminho local futuro — decida e escreva qual dos três caminhos
   seguiu, não deixe a pergunta para quem ler o código depois.

2. **COMO GEORREFERENCIAR.** Três respostas com custo bem diferente: (a) GeoTIFF — pesa
   biblioteca nova no navegador (parsing binário), mas é o formato que ferramentas de SIG
   exportam nativamente; (b) imagem comum (jpg/png) + *world file* (`.pgw`/`.jgw`) ao lado — leve
   de implementar, mas exige que o instrutor já tenha o par de arquivos pronto, o que raramente é
   o caso em campo; (c) o instrutor arrasta os cantos da imagem sobre o próprio mapa — mais barato
   de construir, não depende de arquivo auxiliar, mas é o menos preciso e o mais fácil de errar
   sem querer. Note que `L.imageOverlay` do Leaflet aceita `bounds` **retangulares** (2 cantos:
   noroeste/sudeste) nativamente — um georreferenciamento por 4 cantos livres (rotação/distorção)
   exigiria um plugin (`L.ImageOverlay.Rotated` ou similar) que o projeto não usa hoje. Decida se
   vale a pena essa complexidade extra ou se bounds retangulares (2 cantos) bastam para o uso
   real (ortofoto de uma área pequena raramente precisa de rotação fina).

3. **TAMANHO E EGRESS.** A conta que fechou o limite de 2 MB em `calcos` (2 MB × 60 alunos = 120
   MB por calco publicado, por carga de página) não sobrevive a uma ortofoto — que facilmente
   passa de 10-20 MB. Três saídas, não excludentes entre si: (a) um teto de tamanho mais agressivo
   que o do KML, com a conta explícita de quanto isso custa de egress mensal; (b) reaproveitar o
   mecanismo de tiles da Etapa 8a — fatiar a imagem em tiles e servir como um basemap adicional
   via Service Worker, em vez de todo aparelho baixar o arquivo inteiro pela rede a cada carga de
   página; (c) aceitar que esta função é rara (não é usada toda aula) e simplesmente documentar o
   custo, deixando o instrutor decidir consciente quando publicar algo grande. Mostre a conta na
   tela antes do upload, como toda etapa anterior fez para o recurso equivalente dela.

4. **FORMATO NA TABELA (se optar por reaproveitar `calcos`).** O `check` de `calcos.formato` hoje
   só aceita `'kml'`/`'kmz'` (0006_calcos.sql, ~linha 139), e não existem colunas para bounds
   geográficos — só faz sentido para vetor, que se autodescreve. Reaproveitar a mesma tabela exige
   uma migration alterando o `check` e acrescentando colunas de bounds (ex.:
   `bounds_norte`/`bounds_sul`/`bounds_leste`/`bounds_oeste`, nuláveis para linhas de KML/KMZ) —
   menos código, mas mistura registro de vetor com raster numa linha só. Uma tabela nova dedicada
   a imagem georreferenciada isola melhor o conceito, ao custo de repetir RLS/trigger/policies de
   Storage quase idênticos aos da 0006. Decida e, se for a mesma tabela, desenhe as colunas novas.

5. **OPACIDADE, DE NOVO — MAS AQUI PODE SER DIFERENTE.** A 8a acabou de tirar o controle de
   opacidade das camadas KML/KMZ, com o argumento de que não fazia sentido para calco/traçado
   tático (só cor e liga/desliga importam). Uma ortofoto pode ser um caso diferente: opacidade
   ajuda comparar a imagem nova contra o mapa base por baixo (antes/depois de uma obra, por
   exemplo). Decida se a imagem georreferenciada reintroduz um controle de opacidade próprio
   (justificando por que o motivo da remoção na 8a não se aplica aqui) ou segue igual às demais
   camadas — e se reintroduzir, não mexa no que a 8a já tirou do KML/KMZ.

**O que eu preciso:**

1. O instrutor escolhe uma imagem (jpg/png) no próprio aparelho, define os bounds pela abordagem
   decidida no item 2, escolhe categoria (mesma faixa de `calcos.categoria`:
   manobra/inimigo/logística/obstáculos) e partido (ou turma toda), e publica — reaproveitando o
   máximo possível do fluxo que `frontend/instrutor-calcos.js` já tem para KML/KMZ.
2. Alunos (e o instrutor, na própria tela) veem a imagem sobreposta no mapa, na faixa de pane
   COMPARTILHADO junto dos calcos, respeitando liga/desliga pela chave de categoria como já
   acontece hoje.
3. O limite de tamanho é mostrado ANTES do upload, com a conta de egress visível — não um número
   solto sem explicação.
4. `carregar_imagem_geo` sai da lista de "sem efeito ainda" com uma decisão explícita (implementada
   ou conscientemente adiada, com o motivo escrito) — é a última chave do catálogo original nessa
   situação.
5. A parte pura (validação de bounds, corte de tamanho, decisão de formato/reuso de tabela) num
   módulo com teste em Node, no padrão de `rastro.js`/`kml.js`/`carta-offline.js`.
6. `CLAUDE.md` registra a decisão de reaproveitar `calcos` ou criar tabela nova, e por quê — mesmo
   padrão de "Decisões da Etapa N" das etapas anteriores.

**NÃO implemente:** a Etapa 6.5 (hierarquia ORBAT), a Etapa 9 (SPA com bundler — as pontes
`window.WartoolCamadas`/`window.WartoolSimbolos` continuam existindo), a interface de
`preferencias_visualizacao`, a Etapa 2c (seed de usuários), nem mudanças na arquitetura de
Service Worker/cache da Etapa 8a além do estritamente necessário para a decisão do item 3 (não
reabra a 8a).

**Verificação:** `node --check` nos arquivos novos/alterados (inclusive os blocos `<script>`
embutidos no HTML — `index.html` tem a palavra `<script>` dentro de um comentário HTML, que
atrapalha extração por regex ingênua) e os testes existentes continuando verdes:
`frontend/simbolos.teste.mjs` (25), `frontend/marcacoes.teste.mjs` (40),
`frontend/rastro.teste.mjs` (64), `frontend/kml.teste.mjs` (116), `frontend/basemaps.teste.mjs`
(24), `frontend/dispersar-avatares.teste.mjs` (14) e `frontend/carta-offline.teste.mjs` (68). Se
houver migration nova (provável, ao menos para o formato/bounds), valide com
`backend/testes/valida_sql.py` e aplique com `backend/scripts/aplicar_migrations.sh`.

**Pendências de teste ao vivo acumuladas** — o roteiro completo está em
`docs/roteiro-teste-campo.md`. Confirmados em campo em 2026-08-01: item 1 (código de turma
barrando/aceitando), item 2 (BDGEx desenhando em produção), item 3 (dois celulares se vendo).
Ainda em aberto no checklist daquele arquivo: itens 4a/4b (hostilidade relativa em marcações,
mesmo partido vs. partidos diferentes) e 4c (instrutor vendo Azul e Vermelho com cores
diferentes); avatares empilhados se separando (`dispersar-avatares.js`); topbar/painel no celular
em tela estreita; item 5 (status de GPS mudando sem F5); item 6 ("Voltar ao padrão da turma" sem
F5 — o mais incerto de todos, por depender de `DELETE` propagar via Realtime); item 7 (troca de
força recarregando o app do aluno sozinho); itens 8a-d (a RPC de histórico: `security invoker`,
uso do índice, isolamento entre alunos, legibilidade do replay); itens 9a-d (calcos: bucket
privado, publicação em tempo real, isolamento do objeto entre partidos — o outro item de
segurança crítico —, e `carregar_kml` desligada mostrando explicação). **Da própria Etapa 8a,
ainda não dobradas para dentro do checklist de `roteiro-teste-campo.md` — vale acrescentar lá
antes ou durante esta etapa:** desenhar uma área pequena, baixar, ativar modo avião e conferir que
a carta continua desenhando ali; conferir que fora da área a carta fica em branco sem travar;
cancelar um download no meio e confirmar que a área fica `'incompleta'` e "Completar" só busca o
que falta; apagar uma área que se sobrepõe a outra sem quebrar a outra; medir o tamanho real de um
tile do BDGEx (para corrigir `TAMANHO_TILE_ESTIMADO_BYTES` se estiver longe de 15 kB); no painel
do instrutor, conferir que o cartão de mapa offline aparece com o visual certo em `instrutor.html`
e que baixar uma área pela aba "Situação atual" também deixa o Debriefing offline na mesma área.
