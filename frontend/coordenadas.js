// coordenadas.js — Etapa 9b: a FONTE ÚNICA de "como se escreve esta posição".
//
// Por que este arquivo existe
// ---------------------------
// Três telas mostram coordenada hoje: o popup do próprio avatar (gps.js), o
// popup de cada colega (colegas.js) e o popup de cada marcação
// (marcacoes.js). Antes da Etapa 9b nenhuma delas mostrava coordenada de
// verdade — e a tentação óbvia, ao acrescentar, seria escrever
// `lat.toFixed(5)` nos três arquivos. Três cópias de uma regra de formatação
// é como o UTM de um lugar passa a sair com a zona certa numa tela e errada
// na outra, em silêncio, sem ninguém perceber em campo. Então a formatação
// mora aqui, e as três telas chamam `formatar()`.
//
// Módulo PURO, no mesmo padrão de rastro.js / kml.js / basemaps-dados.js:
// sem Leaflet, sem DOM, sem Supabase. É isso que permite testá-lo em Node
// puro (`node frontend/coordenadas.teste.mjs`).
//
// UTM: por que a matemática está aqui, e não num pacote npm
// ---------------------------------------------------------
// Decisão do item 6 da Etapa 9b. Com o bundler (Etapa 9a) daria para
// acrescentar o pacote `utm` do npm sem custo de CDN; optamos por não fazer
// isso, por três motivos, na ordem em que pesaram:
//
//   1. O build da 9a JÁ emite aviso de chunk grande. Uma dependência a mais
//      no bundle do aluno, para ~60 linhas de fórmula, não se paga.
//   2. O projeto já tem o padrão de "matemática pura e testável no
//      repositório" (rastro.js faz distância geodésica, kml.js faz parsing) —
//      e é justamente esse padrão que permite o teste ao lado do código, que
//      é o que dá confiança de que a ZONA está certa. Um pacote externo eu
//      testaria do mesmo jeito, e ainda teria de mantê-lo atualizado.
//   3. Em campo, menos peças móveis. Uma dependência é mais uma coisa que
//      pode mudar de comportamento numa atualização.
//
// A fórmula é a Transversa de Mercator direta de Snyder (J.P. Snyder, "Map
// Projections — A Working Manual", USGS Professional Paper 1395, 1987,
// §8), no elipsoide WGS84 — o mesmo que o GPS do celular entrega. Os valores
// esperados do teste NÃO foram inventados: saíram do PROJ 9.5.1 (via pyproj),
// que é a mesma biblioteca por trás do QGIS — ver o cabeçalho de
// `coordenadas.teste.mjs` para o procedimento exato de regerá-los.
//
// Por que UTM não é uma regra de três: a Terra é um elipsoide, não uma
// esfera, e a projeção precisa (a) achar a ZONA a partir da longitude, com
// as exceções da Noruega e de Svalbard, (b) integrar o arco de meridiano até
// a latitude e (c) aplicar uma série em potências da distância ao meridiano
// central. Errar a zona é o erro mais fácil de cometer e o mais difícil de
// perceber: o par de números continua parecendo plausível, só aponta para
// centenas de quilômetros de distância.

// ── Os três formatos ────────────────────────────────────────────────────────
// A chave gravada em `perfis.preferencias_visualizacao.formato_coordenada`
// (ver preferencias.js) é uma destas três strings.
export const FORMATOS = ['utm', 'decimal', 'dms'];

// UTM é o padrão. Motivo: é o que o Exército usa em campo e o que está
// impresso nas cartas do BDGEx que o app já serve como mapa de fundo (Etapas
// 7.1 e 8a) — abrir o app e ler uma coordenada no MESMO sistema da carta na
// mão do instrutor é o comportamento que não exige explicação. Grau decimal
// é o que o GPS do celular mostra nativamente e continua a um toque de
// distância, para quem estiver conferindo contra outro aparelho.
export const FORMATO_PADRAO = 'utm';

export const ROTULO_FORMATO = {
  utm: 'UTM (carta)',
  decimal: 'Grau decimal',
  dms: 'Grau, minuto, segundo',
};

export function formatoValido(formato) {
  return FORMATOS.includes(formato);
}

// ── Elipsoide WGS84 ─────────────────────────────────────────────────────────
const A = 6378137.0;                 // semieixo maior, em metros
const F = 1 / 298.257223563;         // achatamento
const E2 = F * (2 - F);              // primeira excentricidade ao quadrado
const EP2 = E2 / (1 - E2);           // segunda excentricidade ao quadrado
const K0 = 0.9996;                   // fator de escala no meridiano central (definição do UTM)
const FALSO_ESTE = 500000;           // metros — desloca a origem para o oeste da zona
const FALSO_NORTE_SUL = 10000000;    // metros — no hemisfério sul o equador vale 10.000.000 m

const GRAU = Math.PI / 180;

// Faixa de latitude coberta pelo UTM. Fora dela a projeção não é definida
// (usa-se UPS, que este projeto não precisa) — `paraUtm()` devolve null e
// `formatar()` cai para grau decimal.
const LAT_MIN_UTM = -80;
const LAT_MAX_UTM = 84;

// Letras das faixas de latitude (MGRS). 'I' e 'O' não existem, para não se
// confundirem com 1 e 0 — é por isso que a sequência tem buraco. Cada faixa
// tem 8°, exceto 'X', que tem 12° (de 72°N a 84°N).
const BANDAS = 'CDEFGHJKLMNPQRSTUVWX';

function numeroValido(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function coordenadaValida(lat, lon) {
  return numeroValido(lat) && numeroValido(lon) &&
         lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// ── Zona UTM ────────────────────────────────────────────────────────────────
// A regra geral são 60 fusos de 6° começando em 180°W. As duas exceções
// abaixo são parte da definição do UTM (não são "gambiarra de biblioteca"):
// a zona 32 foi alargada para o sudoeste da Noruega e as zonas de Svalbard
// foram redesenhadas. Elas não afetam o Brasil, mas estão aqui porque uma
// função chamada `zonaUtm` que só acerta no Brasil é uma armadilha para o
// próximo que a usar.
export function zonaUtm(lat, lon) {
  if (!coordenadaValida(lat, lon)) return null;

  // 180° exato pertence à zona 1 (o `floor` sozinho devolveria 61).
  let zona = Math.floor((lon + 180) / 6) + 1;
  if (zona > 60) zona = 1;

  // Sudoeste da Noruega: a zona 32 avança sobre a 31.
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zona = 32;

  // Svalbard: quatro zonas de 9° e 12° no lugar de seis de 6°.
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zona = 31;
    else if (lon >= 9 && lon < 21) zona = 33;
    else if (lon >= 21 && lon < 33) zona = 35;
    else if (lon >= 33 && lon < 42) zona = 37;
  }
  return zona;
}

// Letra da faixa de latitude. Devolve '' fora da faixa coberta pelo UTM.
export function bandaUtm(lat) {
  if (!numeroValido(lat) || lat < LAT_MIN_UTM || lat > LAT_MAX_UTM) return '';
  if (lat >= 72) return 'X';  // a faixa X tem 12°, não 8° — a conta abaixo não a cobre
  return BANDAS[Math.floor((lat + 80) / 8)] || '';
}

// Converte para UTM. Devolve
//   { zona, banda, hemisferio: 'N'|'S', este, norte }
// com `este`/`norte` em METROS (número, não string), ou `null` se a
// coordenada for inválida ou estiver fora da faixa do UTM.
export function paraUtm(lat, lon) {
  if (!coordenadaValida(lat, lon)) return null;
  if (lat < LAT_MIN_UTM || lat > LAT_MAX_UTM) return null;

  const zona = zonaUtm(lat, lon);
  const meridianoCentral = (zona - 1) * 6 - 180 + 3;

  const phi = lat * GRAU;
  const dLambda = (lon - meridianoCentral) * GRAU;

  const senoPhi = Math.sin(phi);
  const cossenoPhi = Math.cos(phi);
  const tangentePhi = Math.tan(phi);

  // N = raio de curvatura da grande normal; T, C e Aa são as abreviações de
  // Snyder (§8, eqs. 8-9 a 8-15) — mantidas para o código poder ser conferido
  // linha a linha contra o manual.
  const N = A / Math.sqrt(1 - E2 * senoPhi * senoPhi);
  const T = tangentePhi * tangentePhi;
  const C = EP2 * cossenoPhi * cossenoPhi;
  const Aa = dLambda * cossenoPhi;

  // M = distância, sobre o meridiano, do equador até esta latitude.
  const M = A * (
    (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 * E2 * E2 / 256) * phi
    - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 * E2 * E2 / 1024) * Math.sin(2 * phi)
    + (15 * E2 * E2 / 256 + 45 * E2 * E2 * E2 / 1024) * Math.sin(4 * phi)
    - (35 * E2 * E2 * E2 / 3072) * Math.sin(6 * phi)
  );

  const este = K0 * N * (
    Aa
    + (1 - T + C) * Aa ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5 / 120
  ) + FALSO_ESTE;

  let norte = K0 * (
    M + N * tangentePhi * (
      Aa * Aa / 2
      + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6 / 720
    )
  );

  const hemisferio = lat < 0 ? 'S' : 'N';
  if (hemisferio === 'S') norte += FALSO_NORTE_SUL;

  return { zona, banda: bandaUtm(lat), hemisferio, este, norte };
}

// ── Grau, minuto, segundo ───────────────────────────────────────────────────
// Devolve { grau, minuto, segundo, hemisferio } para UM eixo. `segundo` já
// vem arredondado para uma casa decimal — e o arredondamento pode estourar
// para 60, que precisa subir para o minuto (e o minuto, para o grau). Sem
// esse cuidado apareceria "22°59'60.0"", que existe em toda calculadora
// escrita às pressas.
function eixoParaGms(valor, positivo, negativo) {
  const hemisferio = valor < 0 ? negativo : positivo;
  const absoluto = Math.abs(valor);

  let grau = Math.floor(absoluto);
  let minuto = Math.floor((absoluto - grau) * 60);
  let segundo = Math.round(((absoluto - grau) * 60 - minuto) * 60 * 10) / 10;

  if (segundo >= 60) { segundo -= 60; minuto += 1; }
  if (minuto >= 60) { minuto -= 60; grau += 1; }

  return { grau, minuto, segundo, hemisferio };
}

// { lat: {grau, minuto, segundo, hemisferio}, lon: {...} } ou null.
export function paraGms(lat, lon) {
  if (!coordenadaValida(lat, lon)) return null;
  return {
    lat: eixoParaGms(lat, 'N', 'S'),
    lon: eixoParaGms(lon, 'E', 'W'),
  };
}

// ── Formatação para a tela ──────────────────────────────────────────────────
// O que aparece quando não dá para dizer nada. Igual ao que os popups já
// usavam para campos ausentes antes desta etapa.
const SEM_VALOR = '—';

// "23K 683478E 7460686N" — a zona e a letra da faixa juntas na frente são o
// que torna a leitura inequívoca (a letra já diz o hemisfério, então não
// precisa de um "S" solto que se confunde com a coordenada sul).
// Metro inteiro: a precisão do GPS de celular é de 5 a 15 m (ver "Pontos de
// atenção conhecidos" em CLAUDE.md), então casa decimal aqui seria precisão
// falsa.
export function formatarUtm(lat, lon) {
  const u = paraUtm(lat, lon);
  if (!u) return formatarDecimal(lat, lon);  // fora da faixa do UTM (polos): melhor grau decimal que nada
  const banda = u.banda || u.hemisferio;
  return `${u.zona}${banda} ${Math.round(u.este)}E ${Math.round(u.norte)}N`;
}

// "-22.951916, -43.210487" — seis casas ≈ 0,1 m no equador, que é mais do
// que o GPS entrega, mas é o formato que se copia e cola em outro aplicativo
// sem perda. Aqui a casa decimal a mais não é precisão falsa: é fidelidade
// ao número que veio do aparelho.
export function formatarDecimal(lat, lon) {
  if (!coordenadaValida(lat, lon)) return SEM_VALOR;
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

// "22°57'06.9\"S  43°12'37.8\"W"
export function formatarGms(lat, lon) {
  const g = paraGms(lat, lon);
  if (!g) return SEM_VALOR;
  const eixo = (e) => `${e.grau}°${String(e.minuto).padStart(2, '0')}'` +
                      `${e.segundo.toFixed(1).padStart(4, '0')}"${e.hemisferio}`;
  return `${eixo(g.lat)} ${eixo(g.lon)}`;
}

// O ÚNICO ponto de entrada que as telas usam. Formato desconhecido cai no
// padrão em vez de quebrar: um valor estranho gravado em
// `preferencias_visualizacao` (edição manual, versão futura do app) não pode
// deixar o popup sem coordenada nenhuma.
export function formatar(lat, lon, formato) {
  if (!coordenadaValida(lat, lon)) return SEM_VALOR;
  switch (formatoValido(formato) ? formato : FORMATO_PADRAO) {
    case 'decimal': return formatarDecimal(lat, lon);
    case 'dms': return formatarGms(lat, lon);
    default: return formatarUtm(lat, lon);
  }
}
