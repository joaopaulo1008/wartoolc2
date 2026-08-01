// kml.js — Etapa 7 do roadmap: a PARTE PURA de transformar um arquivo
// KML/KMZ em camada de mapa.
//
// Por que este arquivo existe, separado de camadas.js
// ---------------------------------------------------
// Mesma separação que o projeto já faz três vezes (permissoes.js é o dado,
// instrutor-permissoes.js é a tela; rastro.js é a matemática, debriefing.js é
// a tela): aqui mora só lógica pura — nenhum DOM, nenhum DOMParser, nenhum
// Leaflet, nenhum Supabase, nenhum `window`. É isso que torna esta parte
// testável em Node (frontend/kml.teste.mjs).
//
// E a parte que precisa de teste é justamente esta, por dois motivos que se
// parecem com o que a 6b enfrentou:
//
//   1. LIMITE ERRADO NÃO APARECE COMO BUG, APARECE COMO TRAVAMENTO. Um calco
//      de QGIS com 40 mil feições não dá erro: o Leaflet aceita, monta 40 mil
//      nós de SVG e o celular do aluno congela no meio do exercício. Quem
//      decide "isto não cabe" precisa ser código com teste, não a esperança
//      de que o arquivo venha pequeno.
//   2. SIMPLIFICAR É MEXER NO DADO. Reduzir vértices para o mapa aguentar é
//      legítimo, mas uma simplificação com o sinal trocado, ou que perca o
//      último ponto de uma linha, desenha um limite de zona de ação alguns
//      metros fora do lugar — e ninguém percebe olhando.
//
// O que NÃO está aqui, de propósito: o parsing do XML e a descompactação do
// zip. Os dois dependem de API do navegador (DOMParser) ou de biblioteca
// carregada por CDN, e nenhum dos dois tem regra nossa dentro — a regra é o
// que fazer ANTES (aceitar o arquivo?) e DEPOIS (cabe no mapa?). camadas.js
// faz a ponte entre os dois.

// ── Limites de tamanho ───────────────────────────────────────────────────
//
// São DOIS limites, e a diferença entre eles não é arbitrária: é a diferença
// entre um arquivo que fica no aparelho de quem escolheu e um arquivo que 60
// aparelhos vão baixar pelo 4G do campo.
//
//   LOCAL (aluno) — 8 MB. Não passa por rede nem ocupa cota de ninguém, então
//   o único limite real é o navegador: um KML de 8 MB vira ~16 MB de string
//   (JavaScript guarda texto em UTF-16) e, depois do parse, uma árvore de DOM
//   facilmente 10x maior. 8 MB já é o teto do que um celular de exercício
//   aguenta sem o navegador matar a aba.
//
//   COMPARTILHADO (calco do instrutor) — 2 MB. Sai da conta de egress do
//   plano Free do Supabase, feita no cabeçalho de
//   backend/supabase/0006_calcos.sql: 2 MB × 60 alunos × 3 calcos × ~5
//   recargas ≈ 1,8 GB, mais de um terço dos 5 GB/mês, num único exercício.
//   Este número tem cópia no `check` da tabela e no `file_size_limit` do
//   bucket — as três cópias existem porque falham em momentos diferentes
//   (aqui, antes de gastar o upload; lá, se o cliente for adulterado).
export const LIMITE_BYTES_LOCAL         = 8 * 1024 * 1024;
export const LIMITE_BYTES_COMPARTILHADO = 2 * 1024 * 1024;

// KMZ é KML zipado, e texto XML comprime muito bem — 10:1 é comum, 100:1 é
// possível de propósito. Um .kmz de 2 MB pode conter 200 MB de KML, o que
// derruba a aba antes de qualquer contagem de feições acontecer.
//
// Por isso o tamanho DESCOMPACTADO tem limite próprio, e ele é verificado no
// diretório central do zip ANTES de inflar (`validarEntradaKmz` é usada como
// filtro do fflate). Checar depois de inflar seria checar depois do estrago.
export const LIMITE_BYTES_DESCOMPACTADO = 32 * 1024 * 1024;

// ── Limites de desenho ───────────────────────────────────────────────────
//
// FEIÇÕES. Cada feição vira um nó de SVG no pane do Leaflet. A conta que
// importa não é de memória, é de layout: o navegador recalcula a posição de
// todo nó a cada pan/zoom, e a partir de alguns milhares isso passa de
// milissegundos para segundos — em celular, com o dedo na tela. 5.000 é o
// ponto onde um calco ainda é usável; acima disso o arquivo é recusado com
// uma mensagem que diz o que fazer, em vez de aceito e travado depois.
export const LIMITE_FEICOES = 5000;

// VÉRTICES. Um calco pode ter poucas feições e mesmo assim ser pesado: um
// único polígono de área de responsabilidade exportado de imagem de satélite
// traz dezenas de milhares de pontos. Acima de ALVO, simplifica; acima de
// LIMITE mesmo depois de simplificar no máximo, recusa.
export const ALVO_VERTICES   = 40_000;
export const LIMITE_VERTICES = 150_000;

// Tolerâncias de simplificação, em METROS, em ordem crescente. O teto de 25 m
// não é chute: a carta de referência do projeto é a BDGEx 1:50.000, onde
// 0,5 mm de papel — a espessura de um traço a lápis, o menor detalhe que
// alguém consegue plotar — vale 25 m no terreno. Simplificar mais que isso
// deslocaria a linha mais do que a própria carta é capaz de representar, ou
// seja, passaria a mentir sobre onde o limite está. Se 25 m não bastarem para
// caber, a resposta certa é recusar e mandar simplificar no QGIS, não afrouxar
// aqui.
export const TOLERANCIAS_M = [1, 2, 5, 10, 25];

// Grau de latitude em metros. Serve só para converter tolerância em graus na
// simplificação; não é geodésia de precisão e não precisa ser.
const METROS_POR_GRAU = 111_320;

// ── Cores de camada ──────────────────────────────────────────────────────
//
// Três opções, e não um seletor livre de cor. Não é limitação técnica: é que
// calco militar tem convenção de cor, e um seletor livre convida a inventar
// uma. Azul e vermelho são exatamente os mesmos tons já usados na legenda de
// forças de index.html (`.layer-dot` de Amigo e Hostil), para a mesma cor
// querer dizer a mesma coisa nos dois lugares da tela.
//
// Preto não é `#000000` cheio: sobre a carta BDGEx e sobre imagem de satélite
// escura, preto puro some no traço fino. `#1a1a1a` lê como preto e continua
// distinguível.
export const CORES_CAMADA = [
  { nome: 'Azul',     valor: '#4a90d9' },
  { nome: 'Preta',    valor: '#1a1a1a' },
  { nome: 'Vermelha', valor: '#e05252' },
];

export const COR_CAMADA_PADRAO = CORES_CAMADA[0].valor;

export function corDeCamadaValida(valor) {
  return CORES_CAMADA.some((c) => c.valor.toLowerCase() === String(valor || '').toLowerCase());
}

// ── Quanto guardar no aparelho ───────────────────────────────────────────
//
// O arquivo que o aluno abre fica guardado no IndexedDB do navegador dele
// para sobreviver ao F5 — ver frontend/armazem-camadas.js. O que se guarda
// são os BYTES ORIGINAIS, não o GeoJSON já processado, pelo mesmo motivo que
// o calco publicado sobe original: o KMZ comprimido ocupa uma fração do
// GeoJSON expandido, e reprocessar na abertura faz uma melhoria futura nos
// limites ou na tolerância valer para o que já está guardado, sem o aluno
// precisar carregar de novo.
//
// Os dois tetos abaixo NÃO existem por causa da cota do navegador — essa é
// generosa (centenas de MB). Existem porque cada arquivo guardado é
// reprocessado na abertura da página: oito arquivos de 8 MB seriam ~64 MB de
// KML para parsear antes de o mapa aparecer, num celular, no campo. O teto de
// arquivos é o que protege o tempo de abertura; o de bytes protege a memória.
export const LIMITE_GUARDADO_BYTES = 24 * 1024 * 1024;
export const LIMITE_GUARDADOS      = 8;

// Decide se cabe guardar mais um arquivo. Devolve { ok } ou { ok: false,
// motivo } com a frase para a tela.
//
// DECISÃO: quando não cabe, RECUSA e diz o que fazer — não descarta o arquivo
// mais antigo em silêncio. É a mesma postura da Etapa 6b, onde o debriefing
// avisa que o resultado foi cortado em vez de mostrar um rastro incompleto
// com cara de completo: o aluno que abriu um calco ontem e não o encontra
// hoje não vai imaginar que o app o descartou para abrir espaço — vai achar
// que o app perdeu o arquivo dele. Recusar é chato uma vez; descartar em
// silêncio confunde para sempre.
export function planejarGuardar(guardados, novo) {
  const lista = Array.isArray(guardados) ? guardados : [];
  const tamanhoNovo = Number(novo && novo.tamanho) || 0;

  if (tamanhoNovo > LIMITE_GUARDADO_BYTES) {
    return {
      ok: false,
      motivo: `Este arquivo sozinho (${formatarBytes(tamanhoNovo)}) passa do que dá para guardar no aparelho `
            + `(${formatarBytes(LIMITE_GUARDADO_BYTES)}). Ele continua no mapa nesta sessão, mas some ao recarregar a página.`,
    };
  }

  if (lista.length >= LIMITE_GUARDADOS) {
    return {
      ok: false,
      motivo: `Já há ${LIMITE_GUARDADOS} arquivos guardados no aparelho, que é o máximo — cada um é relido `
            + `toda vez que você abre o app. Tire um da lista para este ficar guardado. `
            + `Ele continua no mapa nesta sessão.`,
    };
  }

  const ocupado = lista.reduce((s, g) => s + (Number(g.tamanho) || 0), 0);
  if (ocupado + tamanhoNovo > LIMITE_GUARDADO_BYTES) {
    return {
      ok: false,
      motivo: `Não cabe: os arquivos guardados já somam ${formatarBytes(ocupado)} de `
            + `${formatarBytes(LIMITE_GUARDADO_BYTES)}. Tire um da lista para este ficar guardado. `
            + `Ele continua no mapa nesta sessão.`,
    };
  }

  return { ok: true, ocupadoDepois: ocupado + tamanhoNovo };
}

// ── Ordenação das camadas (panes do Leaflet) ─────────────────────────────
//
// Opacidade e ordem são resolvidas do mesmo jeito para TODA camada de arquivo:
// cada uma ganha um `pane` próprio no Leaflet, a opacidade é a opacidade CSS
// do pane e a ordem é o z-index dele. Um mecanismo só, que já funciona para
// vetor e vai funcionar para a imagem georreferenciada da Etapa 8 sem mudança
// — e que não depende de mexer no `style` de cada feição, que quebraria a cor
// que veio do próprio KML.
//
// As três faixas, e por que nessa ordem (de baixo para cima):
//   REPOSITÓRIO   — o GeoJSON commitado (EXTRA_LAYERS, em index.html). É o
//                   fundo do exercício, o que está lá desde sempre.
//   COMPARTILHADO — o calco que o instrutor publicou. Vem por cima do fundo:
//                   é a informação mais nova e é dele que a instrução trata.
//   LOCAL         — o arquivo que o próprio aluno carregou. Fica por cima de
//                   tudo porque foi ele quem pediu para ver aquilo agora.
//
// TETO em 500 não é folga escolhida a esmo: é o `shadowPane` do Leaflet, e
// logo acima vêm `markerPane` (600), `tooltipPane` (650) e `popupPane` (700).
// Manter as camadas de arquivo abaixo disso é o que garante que NENHUM calco
// consegue tapar um símbolo militar no mapa — um calco que esconde a posição
// de um aluno seria pior do que não ter calco nenhum.
//
// Estes números têm uma cópia no <script> clássico de index.html, que não pode
// importar este arquivo (mesma limitação que criou as pontes
// window.WartoolSimbolos e window.WartoolCamadas). As duas cópias andam juntas
// até a Etapa 9. O teste em kml.teste.mjs trava as invariantes: as faixas não
// se sobrepõem e nenhuma encosta no teto.
export const FAIXAS_PANE = {
  repositorio:   410,
  compartilhado: 440,
  local:         470,
};
export const TETO_PANE = 500;
export const CAMADAS_POR_FAIXA = 30;

// ── Extensões e formato ──────────────────────────────────────────────────

// Devolve 'kml', 'kmz' ou null. Vai pelo nome do arquivo porque o MIME que o
// navegador reporta para .kmz é imprestável — muda com o sistema operacional
// e com que programas estão instalados (application/zip, octet-stream,
// x-zip-compressed ou string vazia). Ver a nota sobre `allowed_mime_types` no
// cabeçalho da migration 0006.
export function formatoDoArquivo(nomeArquivo) {
  const nome = String(nomeArquivo || '').toLowerCase();
  if (nome.endsWith('.kml')) return 'kml';
  if (nome.endsWith('.kmz')) return 'kmz';
  return null;
}

// Nome de exibição da camada: o nome do arquivo sem extensão e sem caminho,
// colapsando espaços e cortando em 80 (mesmo teto do `check` de calcos.nome,
// para o instrutor não escrever no painel algo que o banco vai rejeitar).
//
// NÃO tem nada a ver com segurança: quem impede o nome de virar HTML é o
// `textContent` de quem o exibe (ver o comentário de textoSimples abaixo).
// Etapa 8b: a lista de extensões reconhecidas ganhou jpg/jpeg/png — esta
// função virou o nomeador genérico de "camada de arquivo", não só de KML, e
// instrutor-calcos.js a reusa para sugerir o nome da imagem georreferenciada
// a partir do nome do arquivo, do mesmo jeito que já fazia para calco vetor.
export function nomeDeCamada(nomeArquivo) {
  const base = String(nomeArquivo || '')
    .split(/[\\/]/).pop()
    .replace(/\.(kml|kmz|jpe?g|png)$/i, '')
    .replace(/[\s ]+/g, ' ')
    .trim();
  if (!base) return 'Camada sem nome';
  return base.length > 80 ? `${base.slice(0, 79)}…` : base;
}

export function formatarBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} kB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Aceitar (ou não) o arquivo, antes de ler qualquer byte ───────────────
// Devolve { ok, motivo } — `motivo` é a frase que vai para a tela, já em
// PT-BR e já dizendo o que fazer, não só o que deu errado.
export function validarArquivo({ nome, tamanho }, { compartilhado = false } = {}) {
  const formato = formatoDoArquivo(nome);
  if (!formato) {
    return { ok: false, motivo: 'Só aceita arquivo .kml ou .kmz.' };
  }
  const teto = compartilhado ? LIMITE_BYTES_COMPARTILHADO : LIMITE_BYTES_LOCAL;
  if (!(Number(tamanho) > 0)) {
    return { ok: false, motivo: 'O arquivo está vazio.' };
  }
  if (tamanho > teto) {
    const extra = compartilhado
      ? ' Calco publicado para a turma tem limite menor que o arquivo local, porque os 60 alunos baixam cada um o seu.'
      : '';
    return {
      ok: false,
      motivo: `O arquivo tem ${formatarBytes(tamanho)} e o limite é ${formatarBytes(teto)}.${extra}`,
    };
  }
  return { ok: true, formato };
}

// ── Dentro do KMZ ────────────────────────────────────────────────────────

// Um KMZ é um zip que pode ter imagens, ícones e vários .kml. A convenção do
// formato é que o documento principal se chama doc.kml na raiz; na prática os
// exportadores nem sempre respeitam, então a regra é: doc.kml na raiz se
// existir, senão o primeiro .kml em ordem alfabética (determinístico — o
// mesmo arquivo tem que abrir igual toda vez).
//
// Entradas de metadado do macOS (__MACOSX/, ._algo) são ignoradas: elas
// existem em quase todo zip feito em Mac e não são documento nenhum.
export function escolherEntradaKmz(nomes) {
  const candidatos = (nomes || [])
    .filter((n) => typeof n === 'string')
    .filter((n) => n.toLowerCase().endsWith('.kml'))
    .filter((n) => !n.startsWith('__MACOSX/') && !n.split('/').pop().startsWith('._'));
  if (candidatos.length === 0) return null;
  const raiz = candidatos.find((n) => n.toLowerCase() === 'doc.kml');
  if (raiz) return raiz;
  return candidatos.slice().sort()[0];
}

// Filtro do fflate: recebe a entrada do diretório central do zip (que já traz
// `originalSize`, o tamanho DESCOMPACTADO) e diz se vale inflar. É a defesa
// contra zip bomb, e ela só funciona porque acontece ANTES da inflação — daí
// ser uma função separada, e não uma checagem no resultado.
export function validarEntradaKmz(entrada, entradaEscolhida) {
  if (!entrada || entrada.name !== entradaEscolhida) return false;
  const tamanho = Number(entrada.originalSize);
  // originalSize ausente/zero não é sinal de arquivo vazio — alguns zips não
  // preenchem o campo. Deixa passar e o limite de bytes do texto pega depois.
  if (Number.isFinite(tamanho) && tamanho > LIMITE_BYTES_DESCOMPACTADO) return false;
  return true;
}

// ── Contagem de geometria ────────────────────────────────────────────────
// Percorre um FeatureCollection contando feições e vértices sem materializar
// nada. Vale para todos os tipos de geometria do GeoJSON, inclusive
// GeometryCollection, que o togeojson produz para Placemark com MultiGeometry.

function contarVerticesDaGeometria(geom) {
  if (!geom) return 0;
  if (geom.type === 'GeometryCollection') {
    return (geom.geometries || []).reduce((s, g) => s + contarVerticesDaGeometria(g), 0);
  }
  const contar = (c) => {
    if (!Array.isArray(c)) return 0;
    // Uma posição é [lng, lat(, alt)] — números na primeira dimensão.
    if (typeof c[0] === 'number') return 1;
    return c.reduce((s, x) => s + contar(x), 0);
  };
  return contar(geom.coordinates);
}

export function contarGeometria(geojson) {
  const feicoes = (geojson && Array.isArray(geojson.features)) ? geojson.features : [];
  let vertices = 0;
  for (const f of feicoes) vertices += contarVerticesDaGeometria(f && f.geometry);
  return { feicoes: feicoes.length, vertices };
}

// ── Simplificação (Douglas-Peucker) ──────────────────────────────────────
//
// Distância perpendicular do ponto `p` ao segmento `a`-`b`, em metros, na
// aproximação equirretangular: longitude encolhe por cos(latitude). Para os
// poucos quilômetros de um calco de exercício o erro dessa aproximação é
// muito menor que a menor tolerância que usamos (1 m).
function distanciaPerpendicularM(p, a, b, cosLat) {
  const px = (p[0] - a[0]) * cosLat * METROS_POR_GRAU;
  const py = (p[1] - a[1]) * METROS_POR_GRAU;
  const bx = (b[0] - a[0]) * cosLat * METROS_POR_GRAU;
  const by = (b[1] - a[1]) * METROS_POR_GRAU;
  const norma = bx * bx + by * by;
  if (norma === 0) return Math.hypot(px, py); // a e b coincidem
  // Projeção escalar limitada ao segmento: sem o clamp, um ponto "atrás" de
  // `a` teria distância medida até a reta infinita, não até o segmento — e
  // seria descartado por engano numa curva fechada.
  let t = (px * bx + py * by) / norma;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

// Douglas-Peucker iterativo (pilha explícita, não recursão): uma linha de
// 100 mil pontos estoura a pilha de chamadas do JavaScript, e é exatamente
// esse tamanho de linha que faz a simplificação ser necessária.
//
// Garantias que o teste trava: o PRIMEIRO e o ÚLTIMO ponto nunca são
// removidos, e a ordem é preservada. É o que mantém um anel de polígono
// fechado e uma linha de limite terminando onde terminava.
export function simplificarLinha(pontos, toleranciaM) {
  if (!Array.isArray(pontos) || pontos.length <= 2 || !(toleranciaM > 0)) {
    return pontos;
  }
  const cosLat = Math.cos((Number(pontos[0][1]) || 0) * Math.PI / 180) || 1e-6;

  const manter = new Array(pontos.length).fill(false);
  manter[0] = true;
  manter[pontos.length - 1] = true;

  const pilha = [[0, pontos.length - 1]];
  while (pilha.length) {
    const [ini, fim] = pilha.pop();
    let maior = -1;
    let indice = -1;
    for (let i = ini + 1; i < fim; i++) {
      const d = distanciaPerpendicularM(pontos[i], pontos[ini], pontos[fim], cosLat);
      if (d > maior) { maior = d; indice = i; }
    }
    if (indice !== -1 && maior > toleranciaM) {
      manter[indice] = true;
      pilha.push([ini, indice], [indice, fim]);
    }
  }
  return pontos.filter((_, i) => manter[i]);
}

// Um anel de polígono precisa continuar fechado depois de simplificado, e
// precisa de pelo menos 4 posições (3 distintas + a repetição da primeira)
// para continuar sendo um polígono. Se a simplificação o reduzir abaixo
// disso, ele volta inteiro: um polígono degenerado desenharia uma linha no
// lugar de uma área, o que é pior do que não simplificar.
function simplificarAnel(anel, toleranciaM) {
  const simplificado = simplificarLinha(anel, toleranciaM);
  if (simplificado.length < 4) return anel;
  const primeiro = simplificado[0];
  const ultimo = simplificado[simplificado.length - 1];
  if (primeiro[0] !== ultimo[0] || primeiro[1] !== ultimo[1]) {
    simplificado.push([primeiro[0], primeiro[1]]);
  }
  return simplificado;
}

function simplificarGeometria(geom, toleranciaM) {
  if (!geom) return geom;
  switch (geom.type) {
    case 'Point':
    case 'MultiPoint':
      return geom; // ponto não tem o que simplificar
    case 'LineString':
      return { ...geom, coordinates: simplificarLinha(geom.coordinates, toleranciaM) };
    case 'MultiLineString':
      return { ...geom, coordinates: geom.coordinates.map((l) => simplificarLinha(l, toleranciaM)) };
    case 'Polygon':
      return { ...geom, coordinates: geom.coordinates.map((a) => simplificarAnel(a, toleranciaM)) };
    case 'MultiPolygon':
      return {
        ...geom,
        coordinates: geom.coordinates.map((p) => p.map((a) => simplificarAnel(a, toleranciaM))),
      };
    case 'GeometryCollection':
      return {
        ...geom,
        geometries: (geom.geometries || []).map((g) => simplificarGeometria(g, toleranciaM)),
      };
    default:
      return geom;
  }
}

export function simplificarGeoJson(geojson, toleranciaM) {
  if (!geojson || !Array.isArray(geojson.features) || !(toleranciaM > 0)) return geojson;
  return {
    ...geojson,
    features: geojson.features.map((f) => ({
      ...f,
      geometry: simplificarGeometria(f.geometry, toleranciaM),
    })),
  };
}

// ── A decisão: cabe, cabe simplificando, ou não cabe ─────────────────────
//
// Ponto único de "este arquivo pode ir para o mapa?". Devolve sempre o mesmo
// formato, e camadas.js só obedece:
//
//   { acao: 'ok'          , geojson, antes, depois }
//   { acao: 'simplificado', geojson, antes, depois, toleranciaM }
//   { acao: 'recusado'    , motivo, antes }
//
// A ordem das checagens importa: FEIÇÕES primeiro, porque nenhuma
// simplificação reduz a contagem de feições — Douglas-Peucker tira vértices
// de dentro de uma linha, nunca apaga a linha. Tentar simplificar um arquivo
// de 40 mil feições seria gastar segundos de CPU para chegar ao mesmo "não".
export function planejarCarga(geojson) {
  const antes = contarGeometria(geojson);

  if (antes.feicoes === 0) {
    return {
      acao: 'recusado',
      antes,
      motivo: 'O arquivo não tem nenhuma feição desenhável (pode ser só estilos, pastas ou um NetworkLink apontando para outro arquivo).',
    };
  }

  if (antes.feicoes > LIMITE_FEICOES) {
    return {
      acao: 'recusado',
      antes,
      motivo: `O arquivo tem ${antes.feicoes.toLocaleString('pt-BR')} feições e o limite é ${LIMITE_FEICOES.toLocaleString('pt-BR')}. Divida o calco em camadas menores ou filtre as feições no QGIS antes de carregar.`,
    };
  }

  if (antes.vertices <= ALVO_VERTICES) {
    return { acao: 'ok', geojson, antes, depois: antes };
  }

  for (const toleranciaM of TOLERANCIAS_M) {
    const simplificado = simplificarGeoJson(geojson, toleranciaM);
    const depois = contarGeometria(simplificado);
    if (depois.vertices <= ALVO_VERTICES) {
      return { acao: 'simplificado', geojson: simplificado, antes, depois, toleranciaM };
    }
  }

  // Nem com a tolerância máxima coube no alvo. Ainda assim, se ficou abaixo do
  // limite absoluto, vale desenhar simplificado ao máximo — é melhor um calco
  // pesado que um calco nenhum. Acima do limite, recusa.
  const toleranciaM = TOLERANCIAS_M[TOLERANCIAS_M.length - 1];
  const simplificado = simplificarGeoJson(geojson, toleranciaM);
  const depois = contarGeometria(simplificado);
  if (depois.vertices <= LIMITE_VERTICES) {
    return { acao: 'simplificado', geojson: simplificado, antes, depois, toleranciaM };
  }
  return {
    acao: 'recusado',
    antes,
    motivo: `O desenho tem ${antes.vertices.toLocaleString('pt-BR')} vértices e continua com ${depois.vertices.toLocaleString('pt-BR')} mesmo simplificado a ${toleranciaM} m — acima disso a linha sairia do lugar mais do que a carta 1:50.000 consegue representar. Simplifique a geometria no QGIS antes de carregar.`,
  };
}

// ── Texto vindo do arquivo ───────────────────────────────────────────────
//
// ATENÇÃO, e este é o ponto de segurança da etapa.
//
// KML traz `<description>` com HTML arbitrário dentro — é assim que o Google
// Earth mostra fotos e links no balão. Até agora isso não era problema: o
// único GeoJSON que o app desenhava era um arquivo que NÓS exportamos do QGIS
// e commitamos no repositório, e `carregarExtraLayers()` em index.html
// interpolava o nome direto num template (`<b>${nome}</b>`) sem escapar. A
// partir desta etapa o arquivo vem de fora — e no caso do calco publicado ele
// é desenhado na tela de 60 pessoas.
//
// A defesa NÃO é esta função. A defesa é que camadas.js monta os popups com
// `document.createElement` + `textContent`, nunca com `innerHTML` — ou seja,
// não existe caminho pelo qual um `<script>` do arquivo vire nó de script,
// mesmo que esta função deixasse passar tudo. É segurança por construção, e
// não por lembrar de escapar em cada ponto de saída, que é o tipo de coisa
// que alguém esquece na décima linha.
//
// Esta função existe só para LEGIBILIDADE: uma `<description>` cheia de
// `<table>` e `<br>` mostrada como texto cru fica ilegível. Ela tira as tags
// e resolve as quatro entidades comuns. Se ela errar, o resultado é um texto
// feio — nunca HTML executado.
export function textoSimples(html) {
  if (html == null) return '';
  const semTags = String(html)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return semTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

// Escape de HTML, mesmo critério (e mesmo corpo) de debriefing.js e
// instrutor-permissoes.js. Vira export aqui porque esta etapa é o TERCEIRO
// consumidor — o mesmo gatilho que fez `icones.js` nascer na Etapa 5.
//
// Usado só para o que é NOSSO (rótulos, números já formatados). Dado vindo do
// arquivo não passa por aqui: passa por textContent. Escapar é o plano B de
// quem constrói string de HTML; construir DOM é não precisar de plano B.
export function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Chaves que o togeojson gera a partir de <Style>/<simplestyle> e que não
// interessam a ninguém no popup — são instrução de desenho, não informação
// sobre o elemento.
const CHAVES_DE_ESTILO = new Set([
  'stroke', 'stroke-width', 'stroke-opacity',
  'fill', 'fill-opacity', 'icon', 'icon-scale', 'icon-offset',
  'icon-offset-units', 'styleUrl', 'styleHash', 'styleMapHash',
  'visibility', 'tessellate', 'extrude', 'altitudeMode', 'coordTimes',
]);

// Pares [rótulo, valor] para o popup, já em texto puro e já podados: no
// máximo 12 linhas e 400 caracteres por valor. O corte não é estético — uma
// `<description>` de KML pode trazer uma página inteira de HTML, e um popup
// do tamanho da tela esconde o mapa que a pessoa está tentando ler.
export function propriedadesVisiveis(props, { maxCampos = 12, maxTexto = 400 } = {}) {
  if (!props || typeof props !== 'object') return [];
  const saida = [];
  for (const [chave, valor] of Object.entries(props)) {
    if (CHAVES_DE_ESTILO.has(chave)) continue;
    if (valor == null || typeof valor === 'object') continue;
    const texto = textoSimples(valor);
    if (!texto) continue;
    saida.push([chave, texto.length > maxTexto ? `${texto.slice(0, maxTexto)}…` : texto]);
    if (saida.length >= maxCampos) break;
  }
  return saida;
}

// Título da feição: o que o KML chama de `name`, com os apelidos que outros
// exportadores usam. Sempre texto puro.
export function tituloDaFeicao(props) {
  if (!props || typeof props !== 'object') return '';
  for (const chave of ['name', 'Name', 'nome', 'NOME', 'title', 'titulo']) {
    if (props[chave] != null && props[chave] !== '') {
      const texto = textoSimples(props[chave]);
      if (texto) return texto.length > 120 ? `${texto.slice(0, 119)}…` : texto;
    }
  }
  return '';
}
