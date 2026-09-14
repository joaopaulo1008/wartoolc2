// Teste de frontend/basemaps.js — Etapa 7.1.
//
//     node frontend/basemaps.teste.mjs
//
// Este teste existe por um motivo só, e é um motivo histórico: a tabela de
// mapas base chegou a estar copiada em QUATRO lugares (index.html,
// debriefing.js, situacao.js e o seletor de HTML de cada uma). A Etapa 7.1
// reduziu a lista de onze opções para seis, e uma redução aplicada em quatro
// cópias à mão é uma divergência esperando para acontecer — foi exatamente
// assim que a Etapa 4.5 encontrou as tabelas de SIDC.
//
// Até a Etapa 9a sobravam DUAS cópias: `basemaps.js` (a fonte) e o `<script>`
// clássico de `index.html`, que não podia importar módulo e por isso não
// tinha como ler a primeira. A Etapa 9a (migração para bundler) fechou essa
// cópia: index.html agora importa `criarBasemaps`/`BASEMAP_FALLBACK` direto
// de basemaps.js — não há mais um segundo objeto BASEMAPS para divergir da
// fonte. (Ele também importava de kml.js, por causa das camadas fixas do
// repositório; isso acabou na Etapa 11, junto com elas.)
//
// O que continua sendo cópia de verdade, e por isso continua testado aqui, é
// o HTML dos rádios do seletor (`<input name=basemap value=...>`): esses são
// marcação estática, não código importável, e uma chave adicionada/removida
// de OPCOES_BASEMAP sem o rádio correspondente quebra o seletor em silêncio
// — foi assim que o fallback do `camada_bdgex` apontou para o `osm` depois
// que ele saiu da lista.
//
// Se este teste falhar, não "conserte o teste": significa que os rádios do
// HTML e a lista de basemaps.js divergiram, ou que index.html voltou a
// duplicar algo que devia estar importando.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Etapa 9a: os metadados puros moraram em basemaps.js até aqui; agora vivem
// em basemaps-dados.js, justamente para este teste poder importar sem
// puxar `import * as L from 'leaflet'` (que executa na hora e quebra fora
// do navegador) — ver o cabeçalho de basemaps-dados.js.
import {
  OPCOES_BASEMAP, BASEMAP_PADRAO, BASEMAP_FALLBACK,
} from './basemaps-dados.js';
import { CORES_CAMADA } from './kml.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(aqui, 'index.html'), 'utf-8');

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = Object.is(obtido, esperado);
  bom ? passou++ : falhou++;
  console.log(`${bom ? 'PASSOU' : '** FALHOU **'}  ${descricao}`);
  if (!bom) console.log(`          esperado: ${JSON.stringify(esperado)}\n          obtido:   ${JSON.stringify(obtido)}`);
}
function okVerdade(descricao, condicao) { ok(descricao, !!condicao, true); }

const chaves = OPCOES_BASEMAP.map((o) => o.chave);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── A fonte (basemaps.js) ─────────────────────────────────');

ok('são seis opções', chaves.length, 6);
ok('não há chave repetida', new Set(chaves).size, chaves.length);
ok('o BDGEx vem primeiro — é a carta do Exército', chaves[0], 'bdgex');
ok('e é com ele que o app abre', BASEMAP_PADRAO, 'bdgex');

// O fallback é a peça que quebrou quando o OSM saiu da lista: a permissão
// `camada_bdgex` manda o aluno para ele quando o instrutor desliga a carta, e
// apontar para uma chave inexistente deixaria o mapa VAZIO, sem erro nenhum.
okVerdade('o fallback do camada_bdgex existe na lista', chaves.includes(BASEMAP_FALLBACK));
okVerdade('e não é o próprio BDGEx (senão não seria fallback)', BASEMAP_FALLBACK !== 'bdgex');

okVerdade('toda opção tem rótulo', OPCOES_BASEMAP.every((o) => typeof o.rotulo === 'string' && o.rotulo.length > 0));
okVerdade('toda opção tem miniatura', OPCOES_BASEMAP.every((o) => typeof o.thumb === 'string' && o.thumb.length > 0));

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── O que index.html ainda duplica de propósito: os rádios ─');

// 1. Os rádios do seletor — é o que o aluno de fato vê. Um mapa em
//    OPCOES_BASEMAP sem rádio é opção que ninguém consegue escolher; um rádio
//    sem entrada na lista quebra o mapa ao ser clicado (criarBasemaps()
//    lançaria ao tentar ler uma chave que não existe).
const chavesRadio = [...html.matchAll(/name="basemap" value="(\w+)"/g)].map((m) => m[1]);
ok('os rádios do seletor batem com a lista, na mesma ordem',
  chavesRadio.join(','), chaves.join(','));

// 2. O rádio marcado tem que ser o padrão.
const marcado = html.match(/name="basemap" value="(\w+)" checked/);
ok('o rádio marcado é o padrão', marcado?.[1], BASEMAP_PADRAO);

okVerdade('e não sobrou nenhum value=osm solto no seletor (saiu na Etapa 7.1)',
  !/name=basemap\]\[value=osm/.test(html) && !/value="osm"/.test(html));

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Etapa 9a: index.html IMPORTA em vez de duplicar ───────');

// A Etapa 9a fechou as duas cópias que este arquivo vigiava desde a Etapa
// 7.1/7: o objeto BASEMAPS do <script> clássico e a CORES_CAMADA local.
// Continua valendo checar que o import realmente está lá — um `import`
// apagado por engano reintroduziria a divergência calada de sempre, só que
// como `ReferenceError` em vez de silêncio.
okVerdade("index.html importa criarBasemaps/BASEMAP_FALLBACK de basemaps.js",
  /import\s*\{[^}]*criarBasemaps[^}]*\}\s*from\s*'\.\/basemaps\.js'/.test(html));
// Etapa 11: index.html deixou de importar de kml.js, e a asserção INVERTEU de
// sentido. CORES_CAMADA/FAIXAS_PANE/escaparHtml chegavam aqui por causa das
// camadas fixas do repositório (EXTRA_LAYERS), removidas junto com o COP de
// junho. Quem usa kml.js hoje é camadas.js — e é lá que deve continuar. Um
// import desses reaparecendo em index.html quer dizer que uma camada de
// arquivo voltou a ser desenhada pela TELA em vez de pelo módulo dela, que é
// a divergência que este arquivo existe para pegar.
okVerdade('index.html NÃO importa de kml.js (as camadas de arquivo são de camadas.js)',
  !/from\s*'\.\/kml\.js'/.test(html));
okVerdade('e não voltou a declarar um BASEMAPS ou CORES_CAMADA locais',
  !/const BASEMAPS = \{/.test(html) && !/const CORES_CAMADA = \[/.test(html));

// As duas armadilhas do BDGEx continuam travadas na FONTE (basemaps.js). As
// duas falham do mesmo jeito — tile em branco, sem erro nenhum no console —,
// que é por que valem um teste em vez de confiança:
//   (a) `ctm50` sozinha existe só em parte do território (RS, SC, PR, SP, RJ,
//       ES e pedaços de outros estados). Num exercício fora dessa cobertura,
//       o aluno abre o app e vê um mapa branco.
//   (b) `crs: L.CRS.EPSG4326` pede ao mapcache uma grade que ele não tem em
//       cache. Mapcache não é WMS completo: grade errada não dá erro, dá
//       tile vazio. O sufixo `_mercator` da camada é literal.
//
// Roda sobre o código SEM COMENTÁRIOS — não é preciosismo: a primeira versão
// deste bloco falhou de imediato porque o comentário que explica a mudança
// cita `crs: L.CRS.EPSG4326` e `ctm50` para dizer que eles NÃO devem estar
// lá, e a regex ingênua achava as duas coisas no texto que as proíbe.
const semComentarios = (texto) => texto
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');
const basemapsJs = semComentarios(readFileSync(join(aqui, 'basemaps.js'), 'utf-8'));
okVerdade('basemaps.js: usa a camada multiescalas, não a ctm50',
  /layers:\s*'ctmmultiescalas_mercator'/.test(basemapsJs) && !/'ctm50'/.test(basemapsJs));
okVerdade('basemaps.js: não força EPSG4326 no BDGEx',
  !/crs:\s*L\.CRS\.EPSG4326/.test(basemapsJs));
okVerdade('basemaps.js: o BDGEx herda o protocolo da página (sem http:// fixo)',
  /location\.protocol\}\/\/bdgex\.eb\.mil\.br/.test(basemapsJs) &&
  !/http:\/\/bdgex\.eb\.mil\.br/.test(basemapsJs));

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Cores de camada: uma fonte só (a legenda de forças saiu) ──');

// Até a Etapa 11 este bloco comparava à mão os tons de CORES_CAMADA (kml.js)
// com os pontinhos "Amigo"/"Hostil" da legenda de forças de index.html — um
// par de valores hexadecimais escritos duas vezes, em HTML estático e em
// JavaScript, que só um teste mantinha juntos.
//
// A legenda saiu com o COP de junho, e com ela a duplicação. Restou UM lugar
// escrevendo cada cor, que é o estado desejado — então a asserção que vale
// hoje é a que trava o valor na FONTE e prova que a cópia não voltou.
okVerdade('CORES_CAMADA continua com o azul e o vermelho da simbologia (amigo/hostil)',
  CORES_CAMADA.some((c) => c.valor === '#4a90d9') &&
  CORES_CAMADA.some((c) => c.valor === '#e05252'));
okVerdade('e index.html não tem mais cor de camada escrita à mão no HTML',
  !html.includes('background:#4a90d9') && !html.includes('background:#e05252'));
okVerdade('e são as mesmas cores de CORES_CAMADA (kml.js)',
  CORES_CAMADA.some((c) => c.valor === '#4a90d9') && CORES_CAMADA.some((c) => c.valor === '#e05252'));

// ─────────────────────────────────────────────────────────────────────────
// Duas correções de campo de 2026-09-14 que vivem no HTML/no módulo, e que
// falhariam em silêncio se alguém as desfizesse sem querer.
console.log('\n── Correções de campo que moram no HTML ─────────────────');

const instrutorHtml = readFileSync(join(aqui, 'instrutor.html'), 'utf-8');
const painelJs = readFileSync(join(aqui, 'painel-lateral.js'), 'utf-8');

// 1. Carimbo de build no rodapé. "Continua igual" foi cache do navegador duas
//    vezes; o carimbo é o que torna isso conferível de fora. Sem o <span> o
//    módulo não tem onde escrever e volta a não haver como saber a versão.
okVerdade('index.html tem o <span id="versao-build"> no rodapé',
  /id="versao-build"/.test(html));
okVerdade('instrutor.html também (é o instrutor quem costuma perguntar)',
  /id="versao-build"/.test(instrutorHtml));
okVerdade('e as duas telas chamam mostrarVersao()',
  /mostrarVersao\(\)/.test(html) && /mostrarVersao\(\)/.test(instrutorHtml));

// 2. Cartão do painel nasce RECOLHIDO. O pedido foi "que eles abram somente se
//    o usuário clicar" — e o estado inicial virou o padrão do módulo, não uma
//    opção repetida em cada ponto de montagem. Um `recolhido = false` de volta
//    na assinatura desfaz isso em todos os cartões de uma vez, calado.
okVerdade('tornarRecolhivel() nasce recolhido por padrão',
  /recolhido\s*=\s*true/.test(painelJs) && !/recolhido\s*=\s*false\s*\}\s*=\s*\{\}/.test(painelJs));
okVerdade('e index.html não reabre nenhum cartão passando { recolhido: false }',
  !/recolhido:\s*false/.test(html));

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(58)}`);
console.log(`${passou} passaram, ${falhou} falharam de ${passou + falhou}`);
if (falhou > 0) process.exit(1);
