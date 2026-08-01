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
// Hoje sobraram DUAS cópias: `basemaps.js` (a fonte) e o `<script>` clássico
// de `index.html`, que não pode importar módulo e por isso não tem como ler a
// primeira. A cópia só desaparece na Etapa 9. Até lá, quem garante que as
// duas dizem a mesma coisa é este arquivo — ele LÊ o HTML e compara.
//
// Se este teste falhar, não "conserte o teste": significa que alguém
// acrescentou ou tirou um mapa de um lado só, e alguma das três telas está
// oferecendo uma opção que a outra não tem (ou pior, apontando para uma chave
// que não existe mais, que é como o fallback do `camada_bdgex` quebrou
// quando o OSM saiu da lista).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  OPCOES_BASEMAP, BASEMAP_PADRAO, BASEMAP_FALLBACK,
} from './basemaps.js';
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
console.log('\n── A cópia em index.html (script clássico, some na Etapa 9)');

// 1. As chaves do objeto BASEMAPS do script clássico.
const blocoBasemaps = html.match(/const BASEMAPS = \{([\s\S]*?)\n\};/);
okVerdade('o objeto BASEMAPS foi encontrado em index.html', !!blocoBasemaps);
const chavesHtml = [...(blocoBasemaps?.[1] || '').matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
ok('index.html declara as MESMAS chaves, na MESMA ordem',
  chavesHtml.join(','), chaves.join(','));

// 2. Os rádios do seletor — é o que o aluno de fato vê. Um mapa em BASEMAPS
//    sem rádio é código morto; um rádio sem entrada em BASEMAPS quebra o mapa
//    ao ser clicado.
const chavesRadio = [...html.matchAll(/name="basemap" value="(\w+)"/g)].map((m) => m[1]);
ok('os rádios do seletor batem com a lista, na mesma ordem',
  chavesRadio.join(','), chaves.join(','));

// 3. O rádio marcado tem que ser o padrão.
const marcado = html.match(/name="basemap" value="(\w+)" checked/);
ok('o rádio marcado é o padrão', marcado?.[1], BASEMAP_PADRAO);

// 4. O fallback do script clássico é uma constante, e não um valor solto —
//    era um literal 'osm' até a Etapa 7.1, e foi assim que ele apontou para
//    um mapa que já não existia.
const fallbackHtml = html.match(/const FALLBACK_BASEMAP = '(\w+)';/);
ok('index.html define FALLBACK_BASEMAP', fallbackHtml?.[1], BASEMAP_FALLBACK);
okVerdade('e não sobrou nenhum value=osm solto no seletor',
  !/name=basemap\]\[value=osm/.test(html) && !/value="osm"/.test(html));

// 5. O BDGEx não pode voltar a ter protocolo fixo: numa página https, `http://`
//    é conteúdo misto e o navegador bloqueia — a carta mais importante do
//    projeto sumiria no deploy, sem erro além do mapa vazio.
okVerdade('o BDGEx herda o protocolo da página em index.html',
  /location\.protocol\}\/\/bdgex\.eb\.mil\.br/.test(html));
okVerdade('e não há http:// fixo apontando para o bdgex',
  !/http:\/\/bdgex\.eb\.mil\.br/.test(html));

// 6. As duas armadilhas do BDGEx, travadas nas DUAS cópias. As duas falham do
//    mesmo jeito — tile em branco, sem erro nenhum no console —, que é por que
//    valem um teste em vez de confiança:
//    (a) `ctm50` sozinha existe só em parte do território (RS, SC, PR, SP, RJ,
//        ES e pedaços de outros estados). Num exercício fora dessa cobertura, o
//        aluno abre o app e vê um mapa branco.
//    (b) `crs: L.CRS.EPSG4326` pede ao mapcache uma grade que ele não tem em
//        cache. Mapcache não é WMS completo: grade errada não dá erro, dá
//        tile vazio. O sufixo `_mercator` da camada é literal.
//
// As duas checagens rodam sobre o código SEM COMENTÁRIOS. Não é preciosismo:
// a primeira versão deste bloco falhou de imediato porque o comentário que
// explica a mudança cita `crs: L.CRS.EPSG4326` e `ctm50` para dizer que eles
// NÃO devem estar lá — e a regex, ingênua, achava as duas coisas no texto que
// as proíbe. Mesma pegadinha do `<script>` dentro de comentário em index.html.
const semComentarios = (texto) => texto
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

for (const [nome, fonte] of [
  ['basemaps.js', semComentarios(readFileSync(join(aqui, 'basemaps.js'), 'utf-8'))],
  ['index.html', semComentarios(html)],
]) {
  okVerdade(`${nome}: usa a camada multiescalas, não a ctm50`,
    /layers:\s*'ctmmultiescalas_mercator'/.test(fonte) && !/'ctm50'/.test(fonte));
  okVerdade(`${nome}: não força EPSG4326 no BDGEx`,
    !/crs:\s*L\.CRS\.EPSG4326/.test(fonte));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── A outra cópia: as cores de camada ─────────────────────');

// Mesma situação da lista de mapas, mesmo motivo: `CORES_CAMADA` mora em
// kml.js, e o `<script>` clássico de index.html precisa das mesmas três cores
// para o seletor das camadas do repositório. Enquanto ele não puder importar
// (Etapa 9), quem impede as duas de divergirem é este bloco.
const bloco = html.match(/const CORES_CAMADA = \[([\s\S]*?)\n\];/);
okVerdade('index.html declara CORES_CAMADA', !!bloco);
const coresHtml = [...(bloco?.[1] || '').matchAll(/valor:\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
ok('as três cores de index.html são as mesmas de kml.js, na mesma ordem',
  coresHtml.join(','), CORES_CAMADA.map((c) => c.valor).join(','));

// Azul e vermelho não são cores quaisquer: são os MESMOS tons dos pontinhos
// de Amigo e Hostil na legenda de forças, logo acima no mesmo painel. Se
// alguém trocar um dos dois de um lado só, a mesma cor passa a querer dizer
// duas coisas diferentes na mesma tela.
okVerdade('o azul é o mesmo da legenda "Amigo"', html.includes('background:#4a90d9'));
okVerdade('o vermelho é o mesmo da legenda "Hostil"', html.includes('background:#e05252'));

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(58)}`);
console.log(`${passou} passaram, ${falhou} falharam de ${passou + falhou}`);
if (falhou > 0) process.exit(1);
