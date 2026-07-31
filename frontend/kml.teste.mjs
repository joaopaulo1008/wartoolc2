// Teste de frontend/kml.js — Etapa 7.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/kml.teste.mjs
//
// O que ele prova, e por que cada coisa está aqui:
//
//   1. OS LIMITES RECUSAM ANTES DE FAZER ESTRAGO. Um arquivo grande demais é
//      barrado pelo tamanho (antes de ler), um zip bomb é barrado pelo
//      tamanho DESCOMPACTADO lido do diretório do zip (antes de inflar), e um
//      calco de dezenas de milhares de feições é recusado (antes de o Leaflet
//      montar um nó de SVG para cada uma e o celular do aluno congelar).
//   2. SIMPLIFICAR NÃO MOVE O CALCO DE LUGAR. Douglas-Peucker preserva o
//      primeiro e o último ponto, mantém a ordem, mantém o anel do polígono
//      fechado, e nunca desloca um ponto mantido mais do que a tolerância.
//      Um erro aqui não trava nada: desenha um limite de zona de ação alguns
//      metros fora do lugar, e ninguém percebe olhando.
//   3. NADA VINDO DO ARQUIVO SAI COMO HTML. A defesa de verdade é o
//      textContent de camadas.js, mas se `textoSimples` devolvesse tags
//      alguém, um dia, interpolaria isso numa string de HTML.

import {
  LIMITE_BYTES_LOCAL,
  LIMITE_BYTES_COMPARTILHADO,
  LIMITE_BYTES_DESCOMPACTADO,
  LIMITE_FEICOES,
  ALVO_VERTICES,
  TOLERANCIAS_M,
  FAIXAS_PANE,
  TETO_PANE,
  CAMADAS_POR_FAIXA,
  LIMITE_GUARDADO_BYTES,
  LIMITE_GUARDADOS,
  planejarGuardar,
  formatoDoArquivo,
  nomeDeCamada,
  formatarBytes,
  validarArquivo,
  escolherEntradaKmz,
  validarEntradaKmz,
  contarGeometria,
  simplificarLinha,
  simplificarGeoJson,
  planejarCarga,
  textoSimples,
  escaparHtml,
  propriedadesVisiveis,
  tituloDaFeicao,
} from './kml.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = Object.is(obtido, esperado);
  bom ? passou++ : falhou++;
  const marca = bom ? 'PASSOU' : '** FALHOU **';
  console.log(`${marca}  ${descricao}`);
  if (!bom) console.log(`          esperado: ${JSON.stringify(esperado)}\n          obtido:   ${JSON.stringify(obtido)}`);
}
function okVerdade(descricao, condicao) { ok(descricao, !!condicao, true); }

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Formato e nome do arquivo ──────────────────────────────');

ok('.kml é reconhecido',                     formatoDoArquivo('calco.kml'), 'kml');
ok('.KMZ maiúsculo é reconhecido',           formatoDoArquivo('CALCO.KMZ'), 'kmz');
ok('.geojson não é aceito por esta via',     formatoDoArquivo('a.geojson'), null);
ok('nome sem extensão não é aceito',         formatoDoArquivo('calco'), null);
ok('nulo não quebra',                        formatoDoArquivo(null), null);
// O MIME não entra na decisão de propósito: o navegador reporta .kmz de
// meia dúzia de maneiras diferentes conforme o sistema operacional.
ok('extensão dentro do nome não engana',     formatoDoArquivo('kml.txt'), null);

ok('nome de camada tira extensão',           nomeDeCamada('Limites 3 Bda.kmz'), 'Limites 3 Bda');
ok('nome de camada tira caminho do Windows', nomeDeCamada('C:\\calcos\\eixos.kml'), 'eixos');
ok('nome de camada tira caminho do Unix',    nomeDeCamada('/tmp/eixos.kml'), 'eixos');
ok('nome vazio ganha rótulo',                nomeDeCamada('.kml'), 'Camada sem nome');
ok('nome de camada é cortado em 80',         nomeDeCamada(`${'a'.repeat(200)}.kml`).length, 80);

ok('formatarBytes em B',  formatarBytes(512), '512 B');
ok('formatarBytes em kB', formatarBytes(2048), '2 kB');
ok('formatarBytes em MB', formatarBytes(3 * 1024 * 1024), '3.0 MB');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Faixas de pane: nada tapa um símbolo militar ───────────');

// A invariante que importa: as três faixas não se sobrepõem e todas ficam
// abaixo do shadowPane (500), logo abaixo do markerPane (600) do Leaflet.
// Se alguém empurrar uma faixa para cima para "ver melhor" o calco, um
// arquivo passa a poder esconder a posição de um aluno no mapa.
const faixas = [FAIXAS_PANE.repositorio, FAIXAS_PANE.compartilhado, FAIXAS_PANE.local];
okVerdade('repositório fica embaixo de compartilhado',
  FAIXAS_PANE.repositorio < FAIXAS_PANE.compartilhado);
okVerdade('compartilhado fica embaixo do local (o aluno pediu para ver)',
  FAIXAS_PANE.compartilhado < FAIXAS_PANE.local);
okVerdade('as faixas não se sobrepõem',
  faixas.every((base, i) => i === 0 || base >= faixas[i - 1] + CAMADAS_POR_FAIXA));
okVerdade('nenhuma camada de arquivo alcança o teto de 500 (shadowPane)',
  FAIXAS_PANE.local + CAMADAS_POR_FAIXA <= TETO_PANE);
okVerdade('e o teto continua abaixo do markerPane (600) do Leaflet',
  TETO_PANE < 600);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Limite de tamanho: recusa ANTES de ler o arquivo ───────');

ok('arquivo local no limite passa',
  validarArquivo({ nome: 'a.kml', tamanho: LIMITE_BYTES_LOCAL }).ok, true);
ok('um byte acima do limite local não passa',
  validarArquivo({ nome: 'a.kml', tamanho: LIMITE_BYTES_LOCAL + 1 }).ok, false);
ok('arquivo vazio não passa',
  validarArquivo({ nome: 'a.kml', tamanho: 0 }).ok, false);
ok('extensão errada não passa',
  validarArquivo({ nome: 'a.zip', tamanho: 10 }).ok, false);

// A regra central da etapa: o limite do calco COMPARTILHADO é menor que o do
// arquivo local, e é menor por causa do egress (60 alunos baixando o mesmo
// arquivo pelo 4G do campo). Se alguém um dia igualar os dois, este teste cai.
okVerdade('limite compartilhado é menor que o local',
  LIMITE_BYTES_COMPARTILHADO < LIMITE_BYTES_LOCAL);
ok('arquivo de 4 MB serve como local',
  validarArquivo({ nome: 'a.kmz', tamanho: 4 * 1024 * 1024 }).ok, true);
ok('o MESMO arquivo de 4 MB não serve como calco da turma',
  validarArquivo({ nome: 'a.kmz', tamanho: 4 * 1024 * 1024 }, { compartilhado: true }).ok, false);
okVerdade('a recusa do calco explica por que o limite é menor',
  validarArquivo({ nome: 'a.kmz', tamanho: 4 * 1024 * 1024 }, { compartilhado: true })
    .motivo.includes('60 alunos'));

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Guardar no aparelho: recusa, nunca descarta em silêncio ');

const MB = 1024 * 1024;
const guardado = (tamanho) => ({ id: `g${tamanho}`, tamanho });

ok('primeiro arquivo cabe',
  planejarGuardar([], { tamanho: 2 * MB }).ok, true);
ok('cabe enquanto a soma couber',
  planejarGuardar([guardado(10 * MB), guardado(10 * MB)], { tamanho: 3 * MB }).ok, true);
ok('não cabe quando a soma estoura',
  planejarGuardar([guardado(10 * MB), guardado(10 * MB)], { tamanho: 5 * MB }).ok, false);
ok('exatamente no limite ainda cabe',
  planejarGuardar([guardado(LIMITE_GUARDADO_BYTES - MB)], { tamanho: MB }).ok, true);
ok('arquivo maior que o limite total nunca cabe, nem com a lista vazia',
  planejarGuardar([], { tamanho: LIMITE_GUARDADO_BYTES + 1 }).ok, false);
ok('teto de quantidade também barra, mesmo com espaço de sobra',
  planejarGuardar(Array.from({ length: LIMITE_GUARDADOS }, () => guardado(1024)), { tamanho: 1024 }).ok, false);
ok('um a menos que o teto ainda passa',
  planejarGuardar(Array.from({ length: LIMITE_GUARDADOS - 1 }, () => guardado(1024)), { tamanho: 1024 }).ok, true);
ok('lista ausente não quebra', planejarGuardar(null, { tamanho: 1024 }).ok, true);

// O ponto da decisão: recusar em vez de descartar o mais antigo para abrir
// espaço. Um aluno que abriu um calco ontem e não o encontra hoje não vai
// imaginar que o app o descartou — vai achar que o app perdeu o arquivo dele.
// Por isso toda recusa diz (a) o que fazer e (b) que a camada continua no
// mapa agora. Se alguém trocar isto por despejo automático, estes dois caem.
const recusa = planejarGuardar([guardado(20 * MB)], { tamanho: 5 * MB });
okVerdade('a recusa diz o que fazer para caber',
  recusa.motivo.includes('Tire um da lista'));
okVerdade('a recusa deixa claro que a camada continua no mapa agora',
  recusa.motivo.includes('nesta sessão'));
okVerdade('a recusa por quantidade também diz o que fazer',
  planejarGuardar(Array.from({ length: LIMITE_GUARDADOS }, () => guardado(1024)), { tamanho: 1024 })
    .motivo.includes('Tire um da lista'));
okVerdade('o arquivo grande demais avisa que some no F5',
  planejarGuardar([], { tamanho: LIMITE_GUARDADO_BYTES + 1 })
    .motivo.includes('recarregar'));

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Dentro do KMZ ─────────────────────────────────────────');

ok('doc.kml na raiz ganha de outros .kml',
  escolherEntradaKmz(['files/a.kml', 'doc.kml', 'z.kml']), 'doc.kml');
ok('sem doc.kml, o primeiro em ordem alfabética (determinístico)',
  escolherEntradaKmz(['z.kml', 'files/a.kml']), 'files/a.kml');
ok('lixo do macOS é ignorado',
  escolherEntradaKmz(['__MACOSX/doc.kml', 'real.kml']), 'real.kml');
ok('arquivo ._ do macOS é ignorado',
  escolherEntradaKmz(['pasta/._doc.kml', 'pasta/doc.kml']), 'pasta/doc.kml');
ok('zip sem nenhum .kml devolve null',
  escolherEntradaKmz(['imagem.png', 'leiame.txt']), null);
ok('lista vazia devolve null', escolherEntradaKmz([]), null);

// Zip bomb: 1 MB comprimido, 900 MB inflados. Barrado pelo `originalSize` do
// diretório central, ou seja, ANTES de inflar — que é o único momento em que
// barrar ainda adianta.
ok('entrada escolhida de tamanho normal é inflada',
  validarEntradaKmz({ name: 'doc.kml', originalSize: 5 * 1024 * 1024 }, 'doc.kml'), true);
ok('zip bomb é barrado antes de inflar',
  validarEntradaKmz({ name: 'doc.kml', originalSize: 900 * 1024 * 1024 }, 'doc.kml'), false);
ok('exatamente no limite descompactado ainda passa',
  validarEntradaKmz({ name: 'doc.kml', originalSize: LIMITE_BYTES_DESCOMPACTADO }, 'doc.kml'), true);
ok('as OUTRAS entradas do zip nunca são infladas',
  validarEntradaKmz({ name: 'imagem.png', originalSize: 100 }, 'doc.kml'), false);
ok('originalSize ausente não bloqueia (nem todo zip preenche)',
  validarEntradaKmz({ name: 'doc.kml' }, 'doc.kml'), true);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Contagem de geometria ─────────────────────────────────');

const linha = (n) => ({
  type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: Array.from({ length: n }, (_, i) => [-47 + i * 1e-4, -22]) },
});
const fc = (features) => ({ type: 'FeatureCollection', features });

ok('conta feições', contarGeometria(fc([linha(3), linha(4)])).feicoes, 2);
ok('conta vértices somando as feições', contarGeometria(fc([linha(3), linha(4)])).vertices, 7);
ok('ponto conta 1 vértice',
  contarGeometria(fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [-47, -22] } }])).vertices, 1);
ok('polígono conta os vértices do anel',
  contarGeometria(fc([{ type: 'Feature', geometry: { type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }])).vertices, 4);
ok('GeometryCollection é percorrida (togeojson gera para MultiGeometry)',
  contarGeometria(fc([{ type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [
    { type: 'Point', coordinates: [0, 0] },
    { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]] },
  ] } }])).vertices, 4);
ok('feição sem geometria não quebra a contagem',
  contarGeometria(fc([{ type: 'Feature', properties: {}, geometry: null }])).vertices, 0);
ok('objeto que não é FeatureCollection devolve zero', contarGeometria(null).feicoes, 0);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Simplificação: não move o calco de lugar ──────────────');

// Uma reta com ruído de ~0,2 m em volta: com tolerância de 5 m, tudo que está
// no meio é ruído e some; as pontas ficam.
const quaseReta = Array.from({ length: 101 }, (_, i) => [
  -47 + i * 1e-4,
  -22 + ((i % 2) ? 2e-6 : -2e-6),
]);
const simplificada = simplificarLinha(quaseReta, 5);
okVerdade('reduz uma quase-reta a poucos pontos', simplificada.length < 10);
ok('mantém o PRIMEIRO ponto', simplificada[0][0], quaseReta[0][0]);
ok('mantém o ÚLTIMO ponto',
  simplificada[simplificada.length - 1][0], quaseReta[quaseReta.length - 1][0]);
okVerdade('mantém a ordem crescente da linha',
  simplificada.every((p, i) => i === 0 || p[0] > simplificada[i - 1][0]));

// Um cotovelo de verdade (~500 m fora da reta) NÃO pode ser aplainado por uma
// tolerância de 5 m: se fosse, um eixo de progressão com uma curva real
// viraria uma linha reta que ninguém percorreu.
const cotovelo = [[-47, -22], [-46.995, -21.9955], [-46.99, -22]];
ok('vértice real (500 m fora da reta) sobrevive à tolerância de 5 m',
  simplificarLinha(cotovelo, 5).length, 3);
ok('o mesmo vértice some com tolerância de 1000 m',
  simplificarLinha(cotovelo, 1000).length, 2);

ok('linha de 2 pontos é devolvida inteira', simplificarLinha([[0, 0], [1, 1]], 10).length, 2);
ok('tolerância zero não mexe em nada', simplificarLinha(quaseReta, 0).length, quaseReta.length);
ok('lista vazia não quebra', simplificarLinha([], 10).length, 0);

// Ponto crítico: um anel simplificado tem que continuar FECHADO, senão o
// Leaflet desenha uma área aberta e a "zona" deixa de ser uma zona.
const anelRuidoso = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        ...Array.from({ length: 40 }, (_, i) => [-47 + i * 1e-4, -22 + ((i % 2) ? 1e-6 : -1e-6)]),
        [-46.996, -21.99],
        [-47, -22],
      ]],
    },
  }],
};
const anelSimplificado = simplificarGeoJson(anelRuidoso, 25).features[0].geometry.coordinates[0];
ok('anel continua fechado depois de simplificado',
  `${anelSimplificado[0][0]},${anelSimplificado[0][1]}`,
  `${anelSimplificado[anelSimplificado.length - 1][0]},${anelSimplificado[anelSimplificado.length - 1][1]}`);
okVerdade('anel continua com pelo menos 4 posições', anelSimplificado.length >= 4);
okVerdade('anel de fato encolheu', anelSimplificado.length < 42);

// Um triângulo já é o mínimo: simplificar não pode degenerá-lo numa linha.
const triangulo = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon',
    coordinates: [[[0, 0], [0.00001, 0], [0.000005, 0.00001], [0, 0]]] } }],
};
ok('triângulo minúsculo não degenera em linha',
  simplificarGeoJson(triangulo, 25).features[0].geometry.coordinates[0].length, 4);

ok('ponto não é afetado pela simplificação',
  simplificarGeoJson(fc([{ type: 'Feature', properties: {},
    geometry: { type: 'Point', coordinates: [-47, -22] } }]), 25)
    .features[0].geometry.coordinates[0], -47);

// Idempotência: rodar de novo com a mesma tolerância não pode ir corroendo a
// geometria a cada passagem. Em LINHA ABERTA isso vale exatamente.
const linhaUmaVez  = simplificarGeoJson(fc([{ type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: quaseReta } }]), 5);
const linhaDuasVez = simplificarGeoJson(linhaUmaVez, 5);
ok('em linha aberta, simplificar é idempotente',
  contarGeometria(linhaDuasVez).vertices, contarGeometria(linhaUmaVez).vertices);

// Em ANEL FECHADO, não é — e o teste registra isso em vez de esconder.
// Motivo: num anel o primeiro e o último ponto são o MESMO, então a reta de
// referência do Douglas-Peucker é degenerada e a primeira medida vira
// distância radial ao ponto inicial, não perpendicular a uma reta. Trocando o
// conjunto de pontos, a árvore de recursão da segunda passagem é outra, e ela
// pode remover mais um ponto.
//
// Isso NÃO afeta o app, e é por isso que a garantia certa aqui é a fraca:
// planejarCarga() sempre simplifica a partir do GeoJSON ORIGINAL a cada
// tentativa de tolerância — nunca em cima do resultado da anterior. Nenhum
// caminho do código chama simplificação duas vezes sobre o mesmo dado. Se
// algum dia alguém encadear, este teste é o aviso de que a conta muda.
const anelUmaVez  = simplificarGeoJson(anelRuidoso, 25);
const anelDuasVez = simplificarGeoJson(anelUmaVez, 25);
okVerdade('em anel fechado, a segunda passagem nunca CRESCE',
  contarGeometria(anelDuasVez).vertices <= contarGeometria(anelUmaVez).vertices);
const anel2 = anelDuasVez.features[0].geometry.coordinates[0];
ok('e o anel continua fechado depois da segunda passagem',
  `${anel2[0][0]},${anel2[0][1]}`, `${anel2[anel2.length - 1][0]},${anel2[anel2.length - 1][1]}`);
okVerdade('e continua com pelo menos 4 posições', anel2.length >= 4);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── A decisão: cabe, cabe simplificando, ou não cabe ──────');

ok('calco pequeno passa sem tocar na geometria', planejarCarga(fc([linha(10)])).acao, 'ok');
ok('e devolve o MESMO objeto, sem cópia à toa',
  planejarCarga(fc([linha(10)])).geojson.features[0].geometry.coordinates.length, 10);

ok('arquivo sem feição desenhável é recusado', planejarCarga(fc([])).acao, 'recusado');
okVerdade('e a recusa sugere a causa provável (NetworkLink, só estilos)',
  planejarCarga(fc([])).motivo.includes('NetworkLink'));

// Feições demais: recusa direto, SEM tentar simplificar. Douglas-Peucker tira
// vértices de dentro de uma linha, nunca apaga a linha — tentar seria gastar
// segundos de CPU para chegar ao mesmo "não".
const muitasFeicoes = fc(Array.from({ length: LIMITE_FEICOES + 1 }, () => linha(2)));
ok('feições acima do limite: recusado', planejarCarga(muitasFeicoes).acao, 'recusado');
okVerdade('e a mensagem diz o número e o que fazer',
  planejarCarga(muitasFeicoes).motivo.includes('QGIS'));
ok('exatamente no limite de feições ainda passa',
  planejarCarga(fc(Array.from({ length: LIMITE_FEICOES }, () => linha(2)))).acao, 'ok');

// Poucas feições, muitos vértices: é o caso que a simplificação existe para
// resolver — um polígono digitalizado em cima de imagem de satélite.
const pesado = fc([linha(ALVO_VERTICES + 5000)]);
const plano = planejarCarga(pesado);
ok('vértices acima do alvo: simplifica em vez de recusar', plano.acao, 'simplificado');
okVerdade('e o resultado cabe no alvo', plano.depois.vertices <= ALVO_VERTICES);
okVerdade('a tolerância escolhida sai da lista', TOLERANCIAS_M.includes(plano.toleranciaM));
okVerdade('escolhe a MENOR tolerância que resolve', plano.toleranciaM === TOLERANCIAS_M[0]);
ok('a contagem "antes" preserva o tamanho original', plano.antes.vertices, ALVO_VERTICES + 5000);
okVerdade('nenhuma feição é perdida ao simplificar',
  plano.depois.feicoes === plano.antes.feicoes);

// O teto de 25 m é a menor distância que a carta 1:50.000 consegue
// representar (0,5 mm de papel). Acima disso a resposta é recusar, não
// afrouxar — este teste é o que impede alguém de acrescentar um "100" à lista
// para fazer um arquivo grande passar.
ok('a tolerância máxima é 25 m (0,5 mm na carta 1:50.000)',
  TOLERANCIAS_M[TOLERANCIAS_M.length - 1], 25);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Texto vindo do arquivo: nunca sai HTML ────────────────');

const ataque = '<img src=x onerror="alert(1)"><script>roubar()<\/script>Posto de comando';
const limpo = textoSimples(ataque);
okVerdade('nenhum "<" sobra no texto',        !limpo.includes('<'));
okVerdade('nenhum ">" sobra no texto',        !limpo.includes('>'));
okVerdade('nenhum "onerror" sobra',           !limpo.includes('onerror'));
okVerdade('o conteúdo de <script> some inteiro', !limpo.includes('roubar'));
okVerdade('mas o texto legítimo permanece',   limpo.includes('Posto de comando'));

ok('<br> vira quebra de linha',  textoSimples('a<br>b'), 'a\nb');
ok('</p> vira quebra de linha',  textoSimples('<p>a</p><p>b</p>'), 'a\nb');
ok('entidades comuns são resolvidas', textoSimples('Bda &amp; Rgt'), 'Bda & Rgt');
// Entidade escapada em HTML vira texto puro: é o resultado certo, porque quem
// exibe usa textContent — e não reinterpreta o resultado como HTML.
ok('&lt;b&gt; vira texto, não tag', textoSimples('&lt;b&gt;x&lt;/b&gt;'), '<b>x</b>');
ok('espaços colapsam',           textoSimples('a     b'), 'a b');
ok('nulo vira string vazia',     textoSimples(null), '');
ok('número vira texto',          textoSimples(42), '42');

ok('escaparHtml fecha as cinco',
  escaparHtml(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
ok('escaparHtml de nulo é vazio', escaparHtml(null), '');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Popup: só o que interessa, e podado ───────────────────');

const props = {
  name: 'PC 3ª Cia',
  description: '<b>Observado</b> às 14h37<br>Efetivo: 30',
  stroke: '#ff0000',
  'stroke-width': 2,
  styleUrl: '#estilo1',
  obs: 'x'.repeat(600),
  vazio: '',
  aninhado: { nao: 'entra' },
};
const campos = propriedadesVisiveis(props);
const chaves = campos.map(([k]) => k);
okVerdade('chave de estilo (stroke) não aparece',    !chaves.includes('stroke'));
okVerdade('chave de estilo (styleUrl) não aparece',  !chaves.includes('styleUrl'));
okVerdade('propriedade vazia não aparece',           !chaves.includes('vazio'));
okVerdade('objeto aninhado não aparece',             !chaves.includes('aninhado'));
okVerdade('description aparece',                      chaves.includes('description'));
ok('description vem sem tags',
  campos.find(([k]) => k === 'description')[1], 'Observado às 14h37\nEfetivo: 30');
ok('texto longo é cortado em 400 + reticência',
  campos.find(([k]) => k === 'obs')[1].length, 401);
ok('no máximo 12 campos',
  propriedadesVisiveis(Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`c${i}`, `v${i}`])
  )).length, 12);
ok('props ausente devolve lista vazia', propriedadesVisiveis(null).length, 0);

ok('título sai de name',           tituloDaFeicao({ name: 'Eixo Azul' }), 'Eixo Azul');
ok('título aceita o apelido nome', tituloDaFeicao({ nome: 'Eixo Azul' }), 'Eixo Azul');
ok('título sem name é vazio',      tituloDaFeicao({ description: 'x' }), '');
ok('título vem sem HTML',          tituloDaFeicao({ name: '<i>PC</i>' }), 'PC');

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(58)}`);
console.log(`${passou} passaram, ${falhou} falharam de ${passou + falhou}`);
if (falhou > 0) process.exit(1);
