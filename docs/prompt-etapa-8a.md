# Prompt para abrir a Etapa 8a — Mapa offline

**Modelo sugerido: intermediário a forte.** A etapa tem pouca superfície de tela e muita
decisão de arquitetura com modo de falha silencioso (Service Worker, cota de navegador,
resposta opaca, termos de uso de serviço de terceiro). Não é volume de código; é o tipo de
coisa em que errar não dá erro.

**A Etapa 11 (deploy) já está concluída** (GitHub Pages, `https://joaopaulo1008.github.io/wartoolc2/`
— não Vercel/Netlify como cogitado antes; ver "Decisões da Etapa 11" em `CLAUDE.md`). É o que
destrava esta etapa: Service Worker só registra em contexto seguro, e agora existe um domínio
https de verdade para testar no celular.

**A pendência que mais importava para abrir esta etapa já fechou em campo, em 2026-08-01: o
BDGEx desenha em produção**, confirmado no item 2 do roteiro (`docs/roteiro-teste-campo.md`) —
o mapa base do Exército é elegível para cache offline, não é mais uma decisão em aberto. Os
itens 1 e 3 do roteiro também passaram (cadastro barrando código errado / entrando com o
certo; dois celulares vendo a posição um do outro em tempo real).

---

Lê o CLAUDE.md e o docs/ROADMAP.md do projeto WartoolC2 (pasta `wartoolc2/`), e também
`frontend/basemaps.js` (a FONTE ÚNICA dos 6 mapas base, e em especial o comentário sobre o
BDGEx: camada `ctmmultiescalas_mercator`, protocolo herdado da página e o plano B dos
endpoints `/teogc/`), `frontend/basemaps.teste.mjs` (o teste que LÊ o `index.html` para as
duas cópias não divergirem — é o padrão a seguir se você criar mais uma cópia),
`frontend/armazem-camadas.js` (o precedente de armazenamento no navegador: IndexedDB, falha
suave, escopo por usuário), `frontend/kml.js` (em especial `planejarCarga()`, `planejarGuardar()`
e `FAIXAS_PANE` — é o padrão de "decidir limite em módulo puro e testável"),
`frontend/kml.teste.mjs` e `frontend/rastro.teste.mjs` (o formato de teste do projeto),
`frontend/camadas.js` (o painel de camadas de arquivo — ver a tarefa pequena abaixo antes de
mexer nele), e o bloco `<script type="module">` do fim de `frontend/index.html`, que é quem
passa `map` para os módulos, antes de começar.

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

## Tarefa pequena e separada, antes ou depois do offline: tirar a opacidade das camadas KML/KMZ

A pedido de quem usa (achado depois da entrega da 7.1, não é sobre offline): **o controle de
opacidade das camadas de ARQUIVO (KML/KMZ) não faz sentido e deve sair.** É o slider `⋯` de
`frontend/camadas.js` (`.cam-opacidade`, `registro.opacidade`, o `range` que ajusta
`pane.style.opacity`) — vale tanto para os calcos publicados pelo instrutor quanto para o
arquivo que o próprio aluno abre no aparelho, já que os dois passam pelo mesmo módulo. Um
calco/traçado tático não ganha nada em ficar semitransparente; o que importa é a cor (que
continua) e ligar/desligar (que continua).

**Não confundir com a opacidade de `EXTRA_LAYERS`** (o painel "Camadas" de `frontend/index.html`,
`.extra-opacidade`, os GeoJSON do repositório tipo `data/man5bdacbld.geojson`) — essa é outra
funcionalidade, não foi mencionada e não deve mudar aqui.

Ao tirar: remova o botão de detalhe (`⋯`) e o `range` de `frontend/camadas.js` (o seletor de
cor continua, é ele quem fica como controle principal da linha desde a 7.1), pare de gravar/ler
`opacidade` nos registros de camada (ou deixe fixa em `1` internamente, se simplificar mais
não mexer no formato de `novoRegistro()`/`montarCamadaLocal()` — decida e diga qual caminho
seguiu), e ajuste os comentários de `camadas.js` que hoje explicam por que a opacidade virou
secundária (linhas ~488-489, ~542) — eles vão ficar desatualizados se o controle sumir e o
texto continuar dizendo que ele existe "atrás do botão de detalhe".

## Decida e justifique, antes de codar (offline):

1. **COMO INTERCEPTAR O TILE.** O Leaflet pede tile como `<img src>`. Duas respostas
   defensáveis, e a escolha muda a etapa inteira:
   (a) **Service Worker + Cache API** — intercepta o `fetch` do `<img>` e devolve do cache;
   (b) **subclasse de `L.TileLayer` com `createTile` sobrescrito** + `fetch()` + IndexedDB,
       montando a imagem a partir de um Blob.
   O ponto que decide é **CORS**: em (b), um `fetch()` cross-origin sem
   `Access-Control-Allow-Origin` devolve resposta *opaque*, cujos bytes não dá para ler — e
   **ainda não sabemos se o BDGEx manda esse cabeçalho** (agora que o mapa confirmadamente
   desenha em produção, isso dá para checar de verdade: abra o DevTools do celular/desktop na
   aba Network, olhe a resposta de um tile do BDGEx e veja se `Access-Control-Allow-Origin`
   aparece). Em (a) a resposta opaca é guardada e devolvida ao `<img>` sem ninguém precisar
   lê-la. Em compensação, o Chrome infla a cota ocupada por resposta opaca (*padding*), então a
   estimativa de MB mostrada ao usuário vai ser otimista — e isso precisa estar dito na tela,
   não só num comentário. Pese as duas e diga qual escolheu.

2. **CONTEXTO SEGURO.** Service Worker só roda em HTTPS (`localhost` é a exceção explícita da
   spec) — a mesma restrição que a Etapa 3 já documentou para a geolocalização. Isso deixou de
   ser teórico: o site publicado já está em https, então dá para testar de verdade, não só
   argumentar. Decida o que o app faz quando não há contexto seguro (ex.: alguém abrindo por
   `http://` de propósito): esconder a função, mostrá-la desabilitada com o motivo, ou algo
   mais.

3. **QUAIS MAPAS PODEM SER SALVOS.** Baixar tile em massa viola os termos de uso da maioria
   dos serviços: o **Google proíbe explicitamente** cache e pré-carga, e o OpenTopoMap
   desencoraja download em bloco. O BDGEx é serviço do próprio Exército, é a carta que importa
   para a instrução, e **já está confirmado desenhando em produção** — é o candidato natural a
   vir habilitado. Decida quais das seis opções de `basemaps.js` ficam elegíveis, e deixe o
   motivo visível para quem usa — não só num comentário. Lembre que o CLAUDE.md já registra o
   Google como risco jurídico desde a Etapa 0.

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

**O que eu preciso (offline):**

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
`frontend/basemaps.teste.mjs` (24) e `frontend/dispersar-avatares.teste.mjs` (14 — resolve
avatares empilhados em colegas.js/situacao.js, achado no teste de campo). Se a tarefa da
opacidade mexer em algo que `kml.teste.mjs` cobre (confira antes: o teste é sobre
`planejarCarga`/`planejarGuardar`/`FAIXAS_PANE`, não sobre o range de opacidade em si — mas
vale conferir), rode de novo depois da mudança. Se houver migration nova (offline não deve
precisar; a tarefa da opacidade não deveria mexer em banco), valide o SQL com
`backend/testes/valida_sql.py` e aplique com `backend/scripts/aplicar_migrations.sh`.

**Pendências de teste ao vivo acumuladas** — o roteiro completo está em
`docs/roteiro-teste-campo.md`. **Itens 1, 2 e 3 já confirmados em campo (2026-08-01)**:
cadastro barrando código errado e aceitando o certo; BDGEx desenhando em produção (fecha a
pendência que mais importava para abrir a 8a); dois celulares vendo a posição um do outro em
tempo real. Falta confirmar: hostilidade relativa nas marcações (mesmo partido vs. partidos
diferentes) e nos avatares do instrutor (Azul/Vermelho com cores diferentes — regressão
corrigida depois da entrega da 11); avatares empilhados se separando no mapa
(`dispersar-avatares.js`); a topbar do celular não cobrir mais o painel/botão de opções e
nascer colapsada (`#status-detalhes`/`#side-panel` dentro de `#mapa-wrap`); instrutor
desabilitando `enviar_posicao_gps` e o app do aluno reagindo sem F5; instrutor clicando
"Voltar ao padrão da turma" (o mais incerto — depende do evento `DELETE` casar com o filtro do
canal); instrutor trocando a força de um aluno e o app dele recarregando sozinho; da Etapa 6b:
aplicar a `0005` e conferir `prosecdef = false`, o `explain analyze` da RPC usando
`idx_hist_usuario_tempo`, e chamar a RPC com token de aluno passando o UUID de um colega; da
Etapa 7: **com token de aluno do Vermelho, baixar pelo caminho direto o objeto de um calco
publicado só para o Azul — tem que dar erro**, aplicar a `0006` e conferir que o bucket nasceu
privado, publicar um calco com a turma toda com o app aberto e ver aparecer sem F5; e da 11:
migration `0007` aplicada.
