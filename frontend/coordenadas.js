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
//
// `zonaForcada` (2026-10-02, opcional): converte NA ZONA PEDIDA em vez de na
// zona natural da longitude. Sem isto não existe grade UTM quando a tela
// cruza uma fronteira de fuso: as linhas da zona 21 precisam continuar a
// leste de 54° W para fechar o desenho, e `zonaUtm()` devolveria 22 para
// esses pontos — a grade quebraria no meio da tela, com um salto de 500 km
// no valor do este. Isso se chama "extensão de zona" e é prática normal em
// carta militar: a quadrícula da folha continua além do fuso.
//
// Fora da zona natural a distorção cresce (o UTM é projetado para ±3° do
// meridiano central), e por isso NÃO é o padrão: só quem desenha grade pede.
export function paraUtm(lat, lon, zonaForcada) {
  if (!coordenadaValida(lat, lon)) return null;
  if (lat < LAT_MIN_UTM || lat > LAT_MAX_UTM) return null;

  const zona = (Number.isInteger(zonaForcada) && zonaForcada >= 1 && zonaForcada <= 60)
    ? zonaForcada
    : zonaUtm(lat, lon);
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

// ── UTM inverso ─────────────────────────────────────────────────────────────
// O caminho de volta: (zona, hemisfério, este, norte) -> (lat, lon).
//
// Por que ele passou a existir (2026-10-02)
// -----------------------------------------
// Até aqui só havia o caminho de ida, e bastava: as três telas recebiam
// lat/lon do GPS e precisavam ESCREVER a posição. A grade de quadrículas
// inverte o problema — uma linha de grade é definida por um valor REDONDO de
// este ou de norte (E = 584 000 m), e para desenhá-la no Leaflet, que só
// conhece lat/lon, é preciso voltar. Sem isto, não há grade UTM: haveria uma
// grade geográfica fingindo ser UTM, que é pior que não ter nenhuma.
//
// É a Transversa de Mercator INVERSA de Snyder (§8, eqs. 8-17 a 8-25), no
// mesmo elipsoide e com as MESMAS constantes do caminho de ida logo acima —
// de propósito, porque duas tabelas de constantes é como ida e volta deixam
// de fechar. `phi1` é a "latitude de pé" (footpoint latitude), e `mu`, `E1`,
// `C1`, `T1`, `N1`, `R1` e `D` são as abreviações do próprio Snyder,
// mantidas para o código poder ser conferido linha a linha contra o manual.
//
// Os valores esperados do teste saíram do PROJ 9.5.1 (via pyproj), a mesma
// referência do caminho de ida — e incluem interseções de grade com este e
// norte redondos, que é o uso real deste código, não só pontos reconvertidos.
export function deUtm({ zona, hemisferio, este, norte } = {}) {
  if (!Number.isInteger(zona) || zona < 1 || zona > 60) return null;
  if (!numeroValido(este) || !numeroValido(norte)) return null;

  // Qualquer coisa diferente de 'N' é tratada como sul. É o hemisfério do
  // Brasil inteiro menos a borda norte, e um valor estranho vindo de dado
  // gravado não pode devolver uma coordenada no hemisfério errado — devolve a
  // do hemisfério provável.
  const hemisferioNorte = hemisferio === 'N';

  const meridianoCentral = (zona - 1) * 6 - 180 + 3;
  const x = este - FALSO_ESTE;
  const y = hemisferioNorte ? norte : norte - FALSO_NORTE_SUL;

  const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 * E2 * E2 / 256));

  const phi1 = mu
    + (3 * E1 / 2 - 27 * E1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * E1 * E1 / 16 - 55 * E1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * E1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * E1 ** 4 / 512) * Math.sin(8 * mu);

  const senoPhi1 = Math.sin(phi1);
  const cossenoPhi1 = Math.cos(phi1);
  const tangentePhi1 = Math.tan(phi1);

  const C1 = EP2 * cossenoPhi1 * cossenoPhi1;
  const T1 = tangentePhi1 * tangentePhi1;
  const N1 = A / Math.sqrt(1 - E2 * senoPhi1 * senoPhi1);
  const R1 = A * (1 - E2) / (1 - E2 * senoPhi1 * senoPhi1) ** 1.5;
  const D = x / (N1 * K0);

  const lat = (phi1 - (N1 * tangentePhi1 / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720
  )) / GRAU;

  const lon = meridianoCentral + ((
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120
  ) / cossenoPhi1) / GRAU;

  if (!coordenadaValida(lat, lon)) return null;
  return { lat, lon };
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

// "23K 683478 mE 7460686 mN"
//
// POR QUE "mE"/"mN" E NÃO "E"/"N" (relatado em campo, 2026-08-02)
// ----------------------------------------------------------------
// A primeira versão desta função escrevia "683478E 7460686N", que é a
// notação mais comum em GIS e no MGRS. Ela foi lida como HEMISFÉRIO — "mas
// nós estamos a oeste e ao sul, e está escrito E e N". A leitura errada é
// compreensível: num app que mostra também grau decimal e GMS, onde S e W
// SÃO hemisfério, um "E" colado no fim de um número puxa para o mesmo
// sentido.
//
// Em UTM, `E` e `N` nunca são hemisfério: são os nomes dos dois EIXOS da
// quadrícula — *easting* e *northing* —, medidos em metros, e valem E e N em
// qualquer lugar do planeta. Um ponto em Curitiba tem easting positivo
// porque a origem falsa da zona fica 500 km a OESTE do meridiano central
// (é para isso que existe o falso este: ninguém tem coordenada negativa); e
// tem northing ~7.200.000 porque no hemisfério sul o equador vale
// 10.000.000 (falso norte), então 7,2 milhões são ~2,8 milhões de metros AO
// SUL do equador.
//
// O "m" resolve isso sem alongar muito a linha: "584770 mE" lê-se "584.770
// metros no eixo E", não "584.770 leste". É também a convenção impressa nas
// cartas, que é a referência que o instrutor tem na mão.
//
// O HEMISFÉRIO continua na letra da faixa (`J` = 32°S a 24°S). Deliberadamente
// NÃO se escreve "22 S" no lugar: essa convenção colide com a faixa MGRS `S`,
// que é do hemisfério NORTE (Mediterrâneo/Iraque) — é justamente o tipo de
// ambiguidade que faz alguém plotar no hemisfério errado.
//
// Metro inteiro: a precisão do GPS de celular é de 5 a 15 m (ver "Pontos de
// atenção conhecidos" em CLAUDE.md), então casa decimal aqui seria precisão
// falsa.
//
// Espaço simples entre os grupos, e não dois: estas strings vão para dentro
// de HTML (popups do Leaflet), que colapsa espaço em branco repetido — o
// alinhamento viria errado de qualquer jeito. Quem separa os grupos são os
// próprios sufixos `mE`/`mN`.
export function formatarUtm(lat, lon) {
  const u = paraUtm(lat, lon);
  if (!u) return formatarDecimal(lat, lon);  // fora da faixa do UTM (polos): melhor grau decimal que nada
  const banda = u.banda || u.hemisferio;
  return `${u.zona}${banda} ${Math.round(u.este)} mE ${Math.round(u.norte)} mN`;
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
