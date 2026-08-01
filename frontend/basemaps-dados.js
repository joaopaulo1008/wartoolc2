// basemaps-dados.js — Etapa 9a: extraído de basemaps.js.
//
// Por que este arquivo existe
// ---------------------------
// basemaps.js sempre teve uma metade PURA (estes três valores — nenhum
// depende de Leaflet nem do navegador) e uma metade que precisa de `L`
// (criarBasemaps()/trocarBasemap()). Enquanto o projeto não tinha bundler,
// misturar as duas no mesmo arquivo não custava nada: `basemaps.teste.mjs`
// importava só os nomes puros e nunca executava a parte com `L`.
//
// A Etapa 9a trocou `<script>` global por `import * as L from 'leaflet'` de
// verdade em basemaps.js — e um `import` estático de um pacote como Leaflet
// (que assume `window`) EXECUTA na hora, mesmo que ninguém chame
// criarBasemaps(). Rodar esse import dentro de `node basemaps.teste.mjs`
// (sem navegador, sem `window`) quebra com `ReferenceError: window is not
// defined` — confirmado ao preparar esta etapa. A separação física em dois
// arquivos resolve isso sem recorrer a import dinâmico (que tornaria
// criarBasemaps() assíncrona, mudando a assinatura para quem já chama):
// quem só precisa dos METADADOS (este arquivo, incluindo o teste) nunca
// toca em Leaflet; basemaps.js importa daqui e re-exporta, então ninguém
// que já fazia `import { OPCOES_BASEMAP, ... } from './basemaps.js'`
// precisa mudar uma linha.

// Metadados das opções, em ordem de exibição.
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
// até a Etapa 7.1 o código apontava para `osm`, que saiu na redução, e o
// resultado era mapa vazio sem erro nenhum.
export const BASEMAP_FALLBACK = 'otopo';
