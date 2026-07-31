// kml-navegador.js — Etapa 7: a parte do KML/KMZ que SÓ existe no navegador.
//
// Por que este arquivo existe separado de kml.js
// ----------------------------------------------
// kml.js é puro e testável em Node — é lá que estão os limites, a contagem, a
// simplificação e a decisão de aceitar ou recusar. Mas duas coisas dessa
// pipeline não têm como ser puras:
//
//   1. o PARSING do XML, que usa o DOMParser do navegador;
//   2. a DESCOMPACTAÇÃO do KMZ, que precisa de uma biblioteca de zip.
//
// Nenhuma das duas tem regra NOSSA dentro: são conversões de formato. Juntá-
// las a kml.js tornaria o módulo inteiro não-testável por causa de vinte
// linhas sem lógica de decisão. Ficam aqui, e este arquivo é a única costura
// entre o formato bruto e `planejarCarga()`.
//
// Dois consumidores: camadas.js (o aluno abrindo o próprio arquivo, e o app
// abrindo o calco baixado do Storage) e instrutor-calcos.js (o instrutor
// conferindo o arquivo ANTES de publicar — é assim que ele descobre que o
// calco tem feições demais sem gastar o upload).
//
// BIBLIOTECAS POR CDN, EM ESM E SOB DEMANDA
// -----------------------------------------
// O frontend ainda é HTML estático sem bundler (isso é a Etapa 9), então
// biblioteca nova entra como `supabase-js` já entra em auth.js: import de ESM
// direto do CDN. A diferença é o SOB DEMANDA — aqui é `await import()` dentro
// da função, não `import` no topo do arquivo.
//
// Não é elegância: `carregar_kml` nasce com `padrao = false` no catálogo, ou
// seja, a maioria dos alunos NUNCA vai abrir um arquivo. Importar no topo
// faria os ~120 kB das duas bibliotecas serem baixados pelo 4G de 60 celulares
// em campo, na carga da página, para um recurso que quase ninguém usa. Com o
// import dentro da função, quem não carrega arquivo não paga nada — e quem
// carrega paga uma vez (o navegador cacheia o módulo).

import {
  escolherEntradaKmz,
  validarEntradaKmz,
  formatoDoArquivo,
  planejarCarga,
} from './kml.js';

const CDN_TOGEOJSON = 'https://esm.sh/@tmcw/togeojson@7.1.2';
const CDN_FFLATE    = 'https://esm.sh/fflate@0.8.3';

let bibliotecas = null;
let carregando = null;

// Uma carga só, mesmo com dois arquivos escolhidos ao mesmo tempo: a promessa
// em voo é reaproveitada em vez de disparar um segundo download.
async function obterBibliotecas() {
  if (bibliotecas) return bibliotecas;
  if (carregando) return carregando;
  carregando = (async () => {
    const [togeojson, fflate] = await Promise.all([
      import(/* @vite-ignore */ CDN_TOGEOJSON),
      import(/* @vite-ignore */ CDN_FFLATE),
    ]);
    bibliotecas = { kml: togeojson.kml, unzipSync: fflate.unzipSync };
    return bibliotecas;
  })();
  try {
    return await carregando;
  } finally {
    carregando = null;
  }
}

// ── KMZ -> texto do KML ──────────────────────────────────────────────────
//
// O `filter` do fflate é o ponto que importa aqui, e ele existe por segurança,
// não por desempenho: ele decide o que INFLAR, olhando o `originalSize` que já
// está no diretório central do zip. Sem isso, um .kmz de 2 MB declarando 900 MB
// de conteúdo seria inflado inteiro antes de qualquer checagem — e a aba
// morreria antes de a checagem acontecer. Ver `validarEntradaKmz` em kml.js.
//
// Só a entrada escolhida é inflada. As imagens e ícones que o KMZ costuma
// trazer junto são ignorados de propósito: o app não desenha ícone de arquivo
// (ver o comentário sobre `pointToLayer` em camadas.js).
function extrairKmlDoKmz(bytes, unzipSync) {
  const zip = new Uint8Array(bytes);

  // Primeira passada só para listar os nomes, sem inflar nada: o filtro que
  // devolve `false` sempre faz o fflate percorrer o diretório e não
  // descomprimir uma única entrada.
  const nomes = [];
  unzipSync(zip, { filter: (e) => { nomes.push(e.name); return false; } });

  const escolhida = escolherEntradaKmz(nomes);
  if (!escolhida) {
    return { erro: 'O arquivo .kmz não contém nenhum documento .kml dentro.' };
  }

  let conteudo;
  try {
    conteudo = unzipSync(zip, { filter: (e) => validarEntradaKmz(e, escolhida) });
  } catch (e) {
    return { erro: `Não foi possível abrir o .kmz (${e.message}).` };
  }

  const dados = conteudo[escolhida];
  if (!dados) {
    return {
      erro: 'O documento dentro do .kmz é grande demais depois de descompactado. '
          + 'Arquivo zipado pequeno pode esconder um KML enorme — abra no QGIS e exporte simplificado.',
    };
  }
  return { texto: new TextDecoder('utf-8').decode(dados) };
}

// ── Texto do KML -> GeoJSON ──────────────────────────────────────────────
//
// `DOMParser` com 'text/xml' NÃO executa script nenhum e não carrega recurso
// externo — o documento resultante é uma árvore inerte. Isso é o primeiro
// anteparo, mas não é no que o app se apoia: o que impede o `<description>`
// do arquivo de virar HTML na tela é camadas.js montar os popups com
// `textContent`. Ver a seção sobre isso no fim de kml.js.
function textoParaGeoJson(texto, kml) {
  const doc = new DOMParser().parseFromString(texto, 'text/xml');

  // O DOMParser não lança exceção com XML malformado: ele devolve um documento
  // contendo um <parsererror>. Sem esta checagem, um arquivo corrompido
  // chegaria como "0 feições" e a mensagem culparia o conteúdo do calco em vez
  // do arquivo estar quebrado.
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { erro: 'O arquivo não é um KML válido (o XML está malformado).' };
  }
  if (!doc.documentElement || doc.documentElement.nodeName === 'parsererror') {
    return { erro: 'O arquivo não é um KML válido.' };
  }
  return { geojson: kml(doc) };
}

// ── Ponto de entrada ─────────────────────────────────────────────────────
//
// Recebe bytes (ArrayBuffer/Uint8Array, de um <input type=file> ou do
// Storage) e devolve o que camadas.js precisa para desenhar, OU um motivo em
// PT-BR para mostrar na tela. Nunca lança.
//
// A resposta tem o mesmo formato de `planejarCarga()` mais o `geojson`:
//   { acao: 'ok'|'simplificado', geojson, antes, depois, toleranciaM? }
//   { acao: 'recusado', motivo }
//
// A ordem — descompactar, parsear, decidir — é a única possível: só dá para
// contar feições depois de ter GeoJSON. Os limites que valem ANTES disso
// (tamanho do arquivo, tamanho descompactado) já foram aplicados por
// `validarArquivo()` em quem chamou e pelo filtro do zip aqui dentro.
export async function lerArquivoKml(bytes, nomeArquivo) {
  const formato = formatoDoArquivo(nomeArquivo);
  if (!formato) return { acao: 'recusado', motivo: 'Só aceita arquivo .kml ou .kmz.' };

  let libs;
  try {
    libs = await obterBibliotecas();
  } catch (e) {
    return {
      acao: 'recusado',
      motivo: 'Não foi possível carregar o leitor de KML (o app precisa de internet '
            + 'na primeira vez que alguém abre um arquivo). Detalhe: ' + e.message,
    };
  }

  let texto;
  if (formato === 'kmz') {
    const r = extrairKmlDoKmz(bytes, libs.unzipSync);
    if (r.erro) return { acao: 'recusado', motivo: r.erro };
    texto = r.texto;
  } else {
    texto = new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }

  let geojson;
  try {
    const r = textoParaGeoJson(texto, libs.kml);
    if (r.erro) return { acao: 'recusado', motivo: r.erro };
    geojson = r.geojson;
  } catch (e) {
    return { acao: 'recusado', motivo: `Não foi possível interpretar o KML (${e.message}).` };
  }

  return planejarCarga(geojson);
}
