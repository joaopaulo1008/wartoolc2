// sw-bdgex.js — Etapa 8a: o Service Worker que serve tiles do BDGEx do
// Cache API quando a rede oscila.
//
// NÃO É UM PWA DE APP-SHELL. De propósito. Este Service Worker só olha para
// requisições que vão para `bdgex.eb.mil.br` — tudo o mais (HTML, os módulos
// `.js`, o resto da rede) passa direto, sem `respondWith()` nenhum, como se
// este arquivo não existisse. Duas razões:
//
//   1. ESCOPO. A etapa pediu para salvar A CARTA, não o app inteiro offline.
//      Cachear o app-shell é um problema à parte (instalável, ícone,
//      manifest.json, estratégia de atualização do PRÓPRIO app) que não foi
//      pedido e que a Etapa 11 já registrou como ponto de atenção separado
//      (GitHub Pages/Fastly não dá controle de cache-headers por arquivo).
//   2. RISCO. Um Service Worker que intercepta o HTML/JS do próprio app pode
//      prender alguém numa versão antiga do código depois de um deploy — o
//      tipo de bug que só aparece em campo, para quem não sabe fazer
//      hard-refresh. Ficar de fora dessas requisições elimina essa classe de
//      problema por completo.
//
// SÓ QUEM BAIXA DELIBERADAMENTE ESCREVE NO CACHE. Este arquivo NUNCA chama
// `cache.put()`. Ver `frontend/offline-tela.js`: é a PÁGINA (não o Service
// Worker) que escreve no Cache API, tile por tile, dentro do fluxo explícito
// de "desenhar área -> ver quantos tiles/MB -> confirmar" — o mesmo Cache
// Storage é compartilhado entre página e Service Worker por serem do mesmo
// domínio, então não é preciso passar mensagem nenhuma para gravar. Se este
// arquivo cacheasse toda tile vista de passagem (pan/zoom normal, sem
// download deliberado), a lista de "áreas salvas" (frontend/armazem-offline.js)
// mentiria sobre o que está realmente guardado — exatamente o tipo de "meia
// área salva sem avisar" que esta etapa existe para evitar.
//
// SEM VERSIONAMENTO DE CACHE, DE PROPÓSITO. Um padrão comum de tutorial de
// Service Worker é trocar o nome do cache a cada versão e apagar os antigos
// no `activate` — aqui isso destruiria em silêncio TODAS as áreas que
// alguém baixou para usar em campo, no primeiro deploy depois de qualquer
// mudança neste arquivo. O nome do cache só muda se um dia o FORMATO do que
// está guardado precisar mudar de verdade — e mesmo aí, a migração tem que
// ser deliberada (avisar o usuário, não apagar por trás).
const CACHE_TILES_BDGEX = 'wartool-bdgex-tiles';
const HOST_BDGEX = 'bdgex.eb.mil.br';

// `skipWaiting`/`clients.claim()`: um Service Worker novo por padrão só
// assume o controle da página na PRÓXIMA navegação — quem acabou de registrar
// (mesma carga de página, ver offline-tela.js) ficaria sem interceptação até
// recarregar. Como este SW não mexe no app-shell (só em bdgex.eb.mil.br, ver
// acima), assumir controle na hora é seguro: não existe versão antiga de HTML
// para prender ninguém.
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch (e) {
    return; // request.url malformado — deixa o navegador lidar, não é problema nosso.
  }
  if (url.hostname !== HOST_BDGEX) return; // qualquer outra coisa passa direto, sem respondWith().

  event.respondWith(responderTileBDGEx(event.request));
});

async function responderTileBDGEx(request) {
  const cache = await caches.open(CACHE_TILES_BDGEX);
  const emCache = await cache.match(request);
  if (emCache) {
    avisarClientes({ tipo: 'tile-bdgex', origem: 'cache' });
    return emCache;
  }

  try {
    // `request` aqui é o MESMO objeto que o <img> do Leaflet gerou — modo
    // 'no-cors' herdado de ser uma requisição de imagem cross-origin, sem
    // precisar declarar nada à mão. Não gravamos a resposta no cache (ver o
    // cabeçalho do arquivo): esta função só SERVE, quem baixa é a página.
    const resposta = await fetch(request);
    avisarClientes({ tipo: 'tile-bdgex', origem: 'rede' });
    return resposta;
  } catch (erro) {
    // Rede indisponível e o tile não estava no cache: não há mais nada a
    // tentar. `avisarClientes` deixa a tela mostrar "sem carta aqui" em vez
    // de um <img> quebrado sem explicação.
    avisarClientes({ tipo: 'tile-bdgex', origem: 'falha' });
    throw erro;
  }
}

// Avisa toda aba aberta (não só a que originou a requisição — um tile do
// mapa em segundo plano também conta) de onde a última tile veio. É a base
// do indicador honesto "carta: rede / cache" em offline-tela.js; sozinho
// isto não decide nada, só informa.
async function avisarClientes(mensagem) {
  const clientes = await self.clients.matchAll({ type: 'window' });
  for (const cliente of clientes) cliente.postMessage(mensagem);
}
