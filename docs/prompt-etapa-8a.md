# Prompt para abrir a Etapa 8a — Mapa offline

**Modelo sugerido: intermediário a forte.** A etapa tem pouca superfície de tela e muita
decisão de arquitetura com modo de falha silencioso (Service Worker, cota de navegador,
resposta opaca, termos de uso de serviço de terceiro). Não é volume de código; é o tipo de
coisa em que errar não dá erro.

**A Etapa 11 (deploy) já está concluída** (GitHub Pages, `https://joaopaulo1008.github.io/wartoolc2/`
— não Vercel/Netlify como cogitado antes; ver "Decisões da Etapa 11" em `CLAUDE.md`). É o que
destrava esta etapa: Service Worker só registra em contexto seguro, e agora existe um domínio
https de verdade para testar no celular. Falta confirmar em campo (roteiro abaixo) se o
BDGEx — o mapa base mais provável de valer a pena salvar offline — realmente desenha por ali;
se não desenhar, a decisão do item 3 abaixo muda.

---

Lê o CLAUDE.md e o docs/ROADMAP.md do projeto WartoolC2 (pasta `wartoolc2/`), e também
`frontend/basemaps.js` (a FONTE ÚNICA dos 6 mapas base, e em especial o comentário sobre o
BDGEx: camada `ctmmultiescalas_mercator`, protocolo herdado da página e o plano B dos
endpoints `/teogc/`), `frontend/basemaps.teste.mjs` (o teste que LÊ o `index.html` para as
duas cópias não divergirem — é o padrão a seguir se você criar mais uma cópia),
`frontend/armazem-camadas.js` (o precedente de armazenamento no navegador: IndexedDB, falha
suave, escopo por usuário), `frontend/kml.js` (em especial `planejarCarga()`, `planejarGuardar()`
e `FAIXAS_PANE` — é o padrão de "decidir limite em módulo puro e testável"),
`frontend/kml.teste.mjs` e `frontend/rastro.teste.mjs` (o formato de teste do projeto), e o
bloco `<script type="module">` do fim de `frontend/index.html`, que é quem passa `map` para
os módulos, antes de começar.

Vamos fazer a **Etapa 8a: salvar uma área do mapa para funcionar quando a rede oscilar.**

**Contexto e por que a etapa mudou.** A Etapa 8 era "upload de imagem georreferenciada" e foi
trocada por cache offline, a pedido. O motivo é o uso real: o projeto sempre assumiu "campo
com rede de dados disponível", e a rede de campo não cai — ela oscila. Um app que fica sem
carta por trinta segundos no meio do exercício é pior do que um app que nunca teve foto
aérea. O upload de imagem virou a Etapa 8b, menor e só para o instrutor; **não faça a 8b
aqui.**

Hoje não existe nada de offline no projeto. Todo tile vem da rede a cada pan/zoom, e o único
armazenamento local que existe é o IndexedDB de `armazem-camadas.js` (Etapa 7), que guarda o
arquivo KML/KMZ do aluno — não tiles.

**Decida e justifique, antes de codar:**

1. **COMO INTERCEPTAR O TILE.** O Leaflet pede tile como `<img src>`. Duas respostas
   defensáveis, e a escolha muda a etapa inteira:
   (a) **Service Worker + Cache API** — intercepta o `fetch` do `<img>` e devolve do cache;
   (b) **subclasse de `L.TileLayer` com `createTile` sobrescrito** + `fetch()` + IndexedDB,
       montando a imagem a partir de um Blob.
   O ponto que decide é **CORS**: em (b), um `fetch()` cross-origin sem
   `Access-Control-Allow-Origin` devolve resposta *opaque*, cujos bytes não dá para ler — e
   **não sabemos se o BDGEx manda esse cabeçalho** (não foi possível verificar; o servidor
   não responde a requisição de fora do Brasil). Em (a) a resposta opaca é guardada e
   devolvida ao `<img>` sem ninguém precisar lê-la. Em compensação, o Chrome infla a cota
   ocupada por resposta opaca (*padding*), então a estimativa de MB mostrada ao usuário vai
   ser otimista — e isso precisa estar dito na tela, não só num comentário. Pese as duas e
   diga qual escolheu.

2. **CONTEXTO SEGURO.** Service Worker só roda em HTTPS (`localhost` é a exceção explícita da
   spec) — a mesma restrição que a Etapa 3 já documentou para a geolocalização. Decida o que
   o app faz quando não há contexto seguro: esconder a função, mostrá-la desabilitada com o
   motivo, ou algo mais. E diga o que dá e o que não dá para testar sem deploy.

3. **QUAIS MAPAS PODEM SER SALVOS.** Baixar tile em massa viola os termos de uso da maioria
   dos serviços: o **Google proíbe explicitamente** cache e pré-carga, e o OpenTopoMap
   desencoraja download em bloco. O BDGEx é serviço do próprio Exército e é a carta que
   importa para a instrução. Decida quais das seis opções de `basemaps.js` ficam elegíveis, e
   deixe o motivo visível para quem usa — não só num comentário. Lembre que o CLAUDE.md já
   registra o Google como risco jurídico desde a Etapa 0.

4. **VOLUME E EDUCAÇÃO COM O SERVIDOR.** Mesma disciplina da 6b e da 7: nada de confiar que a
   área vem pequena. O número de tiles quadruplica por nível de zoom, então um retângulo
   inocente em z16 são dezenas de milhares de requisições — e 60 celulares fazendo isso ao
   mesmo tempo é um ataque involuntário à Diretoria de Serviço Geográfico. Decida e
   justifique: teto de tiles, faixa de zoom permitida, limite de concorrência e pausa entre
   lotes. E **mostre a conta na tela antes de baixar**, como o debriefing mostra o balde antes
   de consultar e o carregamento de KML mostra as feições antes de desenhar.

5. **COTA E DESPEJO.** `navigator.storage.estimate()` diz quanto há disponível;
   `persist()` (já usado em `armazem-camadas.js`) reduz a chance de despejo. Decida o que
   acontece quando o download estoura a cota no meio, e como o usuário apaga uma área salva.
   Falhar no meio e deixar meia área salva sem dizer é o pior desfecho possível.

**O que eu preciso:**

1. O usuário desenhar um retângulo no mapa, escolher a faixa de zoom, ver quantos tiles e
   quantos MB dá, e confirmar.
2. Progresso visível durante o download, com possibilidade de cancelar.
3. Lista das áreas salvas, com tamanho, e um jeito de apagar cada uma.
4. Um indicador honesto de "esta área está salva" / "você está vendo cache" — quando a rede
   oscila, quem está olhando precisa saber se o que vê é atual.
5. A parte pura (contagem de tiles, estimativa de bytes, corte de zoom, decisão de caber)
   num módulo próprio com teste em Node, no padrão de `rastro.js`/`kml.js`.
6. Decidir se isto vale para o painel do instrutor também (`situacao.js` e `debriefing.js` já
   usam `basemaps.js`) ou se é só o app do aluno — e dizer por quê.

**NÃO implemente:** a Etapa 8b (imagem/foto aérea do instrutor), a Etapa 6.5 (hierarquia
ORBAT), a Etapa 9 (SPA com bundler — as pontes `window.WartoolCamadas` e
`window.WartoolSimbolos` continuam existindo), a interface de `preferencias_visualizacao`,
nem a Etapa 2c (seed de usuários).

**Verificação:** `node --check` nos arquivos novos/alterados (inclusive os blocos `<script>`
embutidos no HTML — atenção que o `index.html` tem a palavra `<script>` dentro de um
comentário HTML e ela atrapalha extração por regex ingênua) e os testes existentes
continuando verdes: `frontend/simbolos.teste.mjs` (25), `frontend/marcacoes.teste.mjs` (40),
`frontend/rastro.teste.mjs` (64), `frontend/kml.teste.mjs` (116),
`frontend/basemaps.teste.mjs` (24) e `frontend/dispersar-avatares.teste.mjs` (14, novo —
resolve avatares empilhados em colegas.js/situacao.js, achado no teste de campo). Se houver
migration, valide o SQL com
`backend/testes/valida_sql.py` (parser oficial do Postgres via `pglast`) e aplique com
`backend/scripts/aplicar_migrations.sh` — mas provavelmente não há migration nesta etapa: é
toda de navegador.

**Pendências de teste ao vivo acumuladas** — o roteiro completo está em
`docs/roteiro-teste-campo.md` (Etapa 11); resumo do que ainda falta confirmar em campo:
dois celulares vendo a posição um do outro; hostilidade relativa nas marcações (mesmo partido
vs. partidos diferentes) e nos avatares do instrutor (Azul/Vermelho com cores diferentes —
regressão corrigida depois da entrega da 11, vale reconferir); avatares empilhados se separando
no mapa (achado e corrigido em campo, `dispersar-avatares.js`); a topbar do celular não cobrir
mais o painel/botão de opções e nascer colapsada (achado e corrigido em campo — `#side-panel`
virou filho de `#mapa-wrap`, `#status-detalhes` nasce oculto abaixo de 820px); instrutor desabilitando
`enviar_posicao_gps` e o app do aluno reagindo sem F5; instrutor clicando "Voltar ao padrão da
turma" (o mais incerto — depende do evento `DELETE` casar com o filtro do canal); instrutor
trocando a força de um aluno e o app dele recarregando sozinho; da Etapa 6b: aplicar a `0005`
e conferir `prosecdef = false`, o `explain analyze` da RPC usando `idx_hist_usuario_tempo`, e
chamar a RPC com token de aluno passando o UUID de um colega; da Etapa 7: **com token de aluno
do Vermelho, baixar pelo caminho direto o objeto de um calco publicado só para o Azul — tem
que dar erro**, aplicar a `0006` e conferir que o bucket nasceu privado, publicar um calco com
a turma toda com o app aberto e ver aparecer sem F5; da 7.1/11: confirmar que o BDGEx desenha
em produção e que `bdgex.eb.mil.br/mapcache` atende em **https** — **esta é a pendência mais
relevante para ABRIR a 8a**, porque decide se vale a pena cachear o BDGEx offline ou se a saída
é um proxy reverso antes; e da 11: cadastro com código de turma barrando código errado, e a
migration `0007` aplicada.
