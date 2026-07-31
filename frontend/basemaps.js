// basemaps.js — Etapa 7.1: a lista de mapas base, num lugar só.
//
// Por que este arquivo existe agora, e não na Etapa 9
// ---------------------------------------------------
// A unificação dos mapas base estava adiada para a Etapa 9 desde a 6b, e a
// justificativa registrada lá era boa: mexer nisso encosta na ponte
// `window.WartoolCamadas`, que é onde a permissão `camada_bdgex` atua.
//
// O que mudou: a lista foi REDUZIDA de onze para seis, e a redução tinha que
// chegar às três telas. Fazer isso com a tabela copiada em quatro lugares
// (index.html, debriefing.js, situacao.js e — desde a 6c — mais uma vez) era
// pedir para as cópias divergirem, que é exatamente o erro que a Etapa 4.5
// corrigiu no SIDC. Além disso, as duas telas do instrutor não tinham o
// BDGEx: o mapa mais importante do projeto faltava justamente para quem
// conduz a instrução.
//
// O que este arquivo NÃO resolve: `index.html` continua com a própria cópia,
// porque as camadas dele moram num `<script>` clássico que não pode importar,
// e o `map` é criado no parsing, antes de qualquer module rodar. São DUAS
// cópias agora, não quatro — e a que sobrou tem guarda: `basemaps.teste.mjs`
// lê o HTML e falha se as duas listas divergirem. A cópia some na Etapa 9,
// junto com o resto do script clássico.
//
// SOBRE O GOOGLE: os termos padrão do Google Maps proíbem uso militar/de
// defesa. As duas opções ficam na lista por escolha explícita de quem usa e
// continuam sendo risco jurídico, não padrão — é o BDGEx que abre o app. A
// decisão está registrada em CLAUDE.md desde a Etapa 0.

// Metadados das opções, em ordem de exibição. É a parte PURA (sem Leaflet):
// dá para importar em Node, e é sobre ela que o teste compara as duas cópias.
//
// A ordem é a de importância para a instrução — BDGEx primeiro, porque é a
// carta do Exército, a que a tropa lê no papel.
export const OPCOES_BASEMAP = [
  { chave: 'bdgex',         rotulo: 'BDGEx 1:50.000 (EB)',  thumb: 'linear-gradient(135deg,#c8b87a,#8ac890)' },
  { chave: 'otopo',         rotulo: 'OpenTopoMap',          thumb: 'linear-gradient(135deg,#b8d8a8,#d8c890)' },
  { chave: 'google_sat',    rotulo: 'Google Satélite',      thumb: 'linear-gradient(135deg,#1a3a1a,#2a5a2a)' },
  { chave: 'google_hybrid', rotulo: 'Google Híbrido',       thumb: 'linear-gradient(135deg,#1a3a1a,#4a8af5)' },
  { chave: 'hybrid',        rotulo: 'Híbrido (Sat+Labels)', thumb: 'linear-gradient(135deg,#1a2a1a,#7ab8f5)' },
  { chave: 'light',         rotulo: 'Claro (CartoDB)',      thumb: 'linear-gradient(135deg,#f0f0f0,#d8d8d8)' },
];

// Com o que o app abre.
export const BASEMAP_PADRAO = 'bdgex';

// Para onde a permissão `camada_bdgex` manda o aluno quando o instrutor a
// desliga com ele já no BDGEx. Precisa ser uma chave que EXISTA na lista —
// até esta etapa o código apontava para `osm`, que saiu na redução, e o
// resultado seria mapa vazio sem erro nenhum.
export const BASEMAP_FALLBACK = 'otopo';

// Instancia as camadas do Leaflet. Só funciona no navegador (depende do `L`
// global e de `location`), por isso está separada dos metadados acima.
export function criarBasemaps() {
  return {
    // Protocolo herdado da página, e não fixo em http.
    //
    // O BDGEx é servido em http. Numa página https, conteúdo misto é
    // bloqueado pelo navegador — ou seja, com `http://` fixo a carta mais
    // importante do projeto simplesmente não desenharia depois do deploy
    // (Etapa 11), sem erro visível além do mapa vazio. Herdando o protocolo,
    // em `http://localhost` continua http (funciona como sempre) e em produção
    // vai https, que é a única forma que pode funcionar lá.
    //
    // PENDENTE DE TESTE AO VIVO: se bdgex.eb.mil.br não atender em https, a
    // saída é um proxy reverso próprio — não existe "voltar para http" numa
    // página https.
    bdgex: L.tileLayer.wms(`${location.protocol}//bdgex.eb.mil.br/mapcache`, {
      layers: 'ctm50',
      format: 'image/png',
      transparent: true,
      attribution: '© BDGEx / Exército Brasileiro',
      crs: L.CRS.EPSG4326,
      maxZoom: 18,
    }),
    otopo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenTopoMap', maxZoom: 17,
    }),
    google_sat: L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      attribution: '© Google', maxZoom: 20,
    }),
    google_hybrid: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      attribution: '© Google', maxZoom: 20,
    }),
    hybrid: L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri', maxZoom: 18,
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18, opacity: 0.8,
      }),
    ]),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© CartoDB', maxZoom: 19,
    }),
  };
}

// Preenche um <select> com as opções, na ordem. Usado pelas duas telas do
// instrutor, que têm seletor de uma linha em vez da lista de rádios do app do
// aluno.
export function preencherSeletorBasemap(select, selecionado = BASEMAP_PADRAO) {
  if (!select) return;
  select.textContent = '';
  for (const opcao of OPCOES_BASEMAP) {
    const item = document.createElement('option');
    item.value = opcao.chave;
    item.textContent = opcao.rotulo;
    if (opcao.chave === selecionado) item.selected = true;
    select.appendChild(item);
  }
}
