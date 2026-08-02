// visada.js — "de onde eu estou até aquele elemento: quanto e para onde".
//
// Para que serve
// --------------
// O observador avançado olha um elemento inimigo no terreno e precisa dizer
// duas coisas: a que DISTÂNCIA está e em que AZIMUTE. O app já tem as duas
// pontas do problema — a posição de quem observa (gps.js) e a posição da
// marcação (elementos_marcados) — e nunca tinha feito a conta entre elas.
// Este módulo faz só isso.
//
// Módulo PURO, no mesmo padrão de rastro.js / coordenadas.js /
// dispersar-avatares.js: sem Leaflet, sem DOM, sem Supabase. É o que permite
// testá-lo em Node puro (`node frontend/visada.teste.mjs`).
//
// POR QUE NÃO REUSA distanciaMetros() DE rastro.js
// -------------------------------------------------
// `rastro.js` já exporta uma distância haversine, e reusar seria o instinto
// certo — o projeto evita cópia de regra desde a Etapa 4.5. Mas o comentário
// dela é explícito sobre o regime em que vale: "precisão de sobra para a
// escala aqui (dezenas de metros entre pontos consecutivos)". Haversine trata
// a Terra como ESFERA, e o erro cresce com a distância. Medido contra o PROJ
// (elipsoide WGS84), nas latitudes do Brasil:
//
//     2 km  ->  +7,6 m   (0,38%)
//     5 km  ->  +5,3 m   (0,11%)
//    10 km  ->  -17,2 m  (0,17%)
//    20 km  ->  +75,5 m  (0,38%)
//
// Para somar o rastro de um aluno (dezenas de metros por trecho, erro que se
// dilui) isso é irrelevante. Para um vetor de observação de 20 km, 75 m é
// erro grande demais para o uso — e, pior, é um erro que NÃO aparece: o
// número continua plausível. Então aqui a conta é sobre o ELIPSOIDE.
//
// A fórmula é a INVERSA DE VINCENTY (T. Vincenty, "Direct and Inverse
// Solutions of Geodesics on the Ellipsoid with Application of Nested
// Equations", Survey Review XXIII/176, 1975), que resolve distância e azimute
// de uma vez, com precisão de milímetro no elipsoide WGS84. Os valores
// esperados do teste vieram do PROJ (via `pyproj.Geod`), não de estimativa —
// ver o cabeçalho de `visada.teste.mjs`.
//
// QUAL NORTE (importa, e não é detalhe)
// --------------------------------------
// O azimute daqui é o AZIMUTE VERDADEIRO — medido a partir do norte
// geográfico, que é o que a geodésia devolve. Não é o azimute da QUADRÍCULA
// (o norte das linhas verticais da carta) nem o MAGNÉTICO (o da bússola). As
// três referências diferem:
//
//   * verdadeiro x quadrícula: a diferença é a convergência meridiana, que
//     depende de quão longe se está do meridiano central da zona UTM. No
//     Brasil chega a ~1,5° perto da borda de uma zona — cerca de 27
//     milésimos, o suficiente para importar em apoio de fogo.
//   * verdadeiro x magnético: é a declinação magnética, que varia com o
//     lugar e com o ANO (o campo magnético se move). Depende de um modelo
//     (IGRF/WMM) que este projeto não tem.
//
// Por isso tudo que sai daqui é rotulado "verdadeiro", sempre e
// explicitamente — um azimute sem referência de norte é um número perigoso.
// Converter para quadrícula/magnético é decisão de escopo ainda não tomada
// (ver "Decisões da etapa" em CLAUDE.md); enquanto não for, é melhor dizer
// qual norte é do que entregar o número cru.

// ── Elipsoide WGS84 (o mesmo de coordenadas.js) ─────────────────────────────
const A = 6378137.0;              // semieixo maior, m
const F = 1 / 298.257223563;      // achatamento
const B = A * (1 - F);            // semieixo menor, m

const GRAU = Math.PI / 180;

// O Exército usa o milésimo NATO: 6400 por volta completa (não o milésimo
// "real" de 2π×1000 ≈ 6283, nem o russo de 6000). A conversão é exata.
export const MILESIMOS_POR_VOLTA = 6400;

// Limites de convergência de Vincenty. Pontos quase antípodas convergem
// devagar ou não convergem — irrelevante num exercício (os dois pontos estão
// na mesma área), mas a guarda existe para a função NUNCA travar a interface:
// se não convergir, devolve null e quem chama simplesmente não mostra a linha.
const MAX_ITERACOES = 200;
const TOLERANCIA = 1e-12;

function numeroValido(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function pontoValido(p) {
  return !!p && numeroValido(p.lat) && numeroValido(p.lon) &&
         p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180;
}

export function grausParaMilesimos(graus) {
  if (!numeroValido(graus)) return null;
  return (graus / 360) * MILESIMOS_POR_VOLTA;
}

// ── Inversa de Vincenty ─────────────────────────────────────────────────────
// `de` e `para`: { lat, lon } em grau decimal (o formato que o projeto usa em
// todo lugar — posicoes_atuais, elementos_marcados, Leaflet).
//
// Devolve { distanciaM, azimuteGraus, azimuteMil } ou `null` quando não dá
// para afirmar nada (ponto inválido, ou não convergiu).
//
// Os dois pontos IGUAIS devolvem distância 0 e azimute 0 — não é erro, é o
// caso de alguém marcar um elemento exatamente em cima de si.
export function visada(de, para) {
  if (!pontoValido(de) || !pontoValido(para)) return null;

  const L = (para.lon - de.lon) * GRAU;
  const U1 = Math.atan((1 - F) * Math.tan(de.lat * GRAU));
  const U2 = Math.atan((1 - F) * Math.tan(para.lat * GRAU));
  const senU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const senU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  let lambda = L, lambdaAnterior;
  let senSigma = 0, cosSigma = 0, sigma = 0, senAlfa = 0, cos2SigmaM = 0, cos2Alfa = 0;
  let i = 0;

  do {
    const senLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
    senSigma = Math.sqrt(
      (cosU2 * senLambda) ** 2 +
      (cosU1 * senU2 - senU1 * cosU2 * cosLambda) ** 2
    );
    // Pontos coincidentes: sem direção a calcular, e dividir por senSigma
    // abaixo daria NaN. Sai cedo com a resposta certa.
    if (senSigma === 0) return { distanciaM: 0, azimuteGraus: 0, azimuteMil: 0 };

    cosSigma = senU1 * senU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(senSigma, cosSigma);
    senAlfa = cosU1 * cosU2 * senLambda / senSigma;
    cos2Alfa = 1 - senAlfa * senAlfa;
    // Nas linhas equatoriais cos2Alfa é 0 e este termo é indefinido; a
    // convenção de Vincenty é tratá-lo como 0.
    cos2SigmaM = cos2Alfa !== 0 ? cosSigma - 2 * senU1 * senU2 / cos2Alfa : 0;

    const C = F / 16 * cos2Alfa * (4 + F * (4 - 3 * cos2Alfa));
    lambdaAnterior = lambda;
    lambda = L + (1 - C) * F * senAlfa * (
      sigma + C * senSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2))
    );
  } while (Math.abs(lambda - lambdaAnterior) > TOLERANCIA && ++i < MAX_ITERACOES);

  if (i >= MAX_ITERACOES) return null;  // quase antípodas — não afirma nada

  const uSq = cos2Alfa * (A * A - B * B) / (B * B);
  const Aa = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const Bb = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma = Bb * senSigma * (
    cos2SigmaM + Bb / 4 * (
      cosSigma * (-1 + 2 * cos2SigmaM ** 2)
      - Bb / 6 * cos2SigmaM * (-3 + 4 * senSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)
    )
  );

  const distanciaM = B * Aa * (sigma - deltaSigma);

  // Azimute DIRETO (de -> para), normalizado para [0, 360).
  const senLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
  const azimuteRad = Math.atan2(
    cosU2 * senLambda,
    cosU1 * senU2 - senU1 * cosU2 * cosLambda
  );
  const azimuteGraus = (azimuteRad / GRAU + 360) % 360;

  return {
    distanciaM,
    azimuteGraus,
    azimuteMil: grausParaMilesimos(azimuteGraus),
  };
}

// ── Formatação para a tela ──────────────────────────────────────────────────
// Metro inteiro abaixo de 10 km; acima disso, quilômetro com uma casa. O
// corte existe porque "14927 m" é mais difícil de ler em campo do que
// "14,9 km", e a casa decimal a mais não significa nada frente à precisão do
// GPS (5-15 m).
export function formatarDistancia(metros) {
  if (!numeroValido(metros) || metros < 0) return '—';
  if (metros < 10000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toFixed(1).replace('.', ',')} km`;
}

// Milésimo inteiro (é a unidade de trabalho — fração de milésimo não tem uso
// prático) e o grau com uma casa, entre parênteses, para quem estiver
// conferindo com transferidor em vez de goniômetro.
export function formatarAzimute(graus) {
  if (!numeroValido(graus)) return '—';
  const mil = Math.round(grausParaMilesimos(graus)) % MILESIMOS_POR_VOLTA;
  const g = graus.toFixed(1).replace('.', ',');
  return `${mil} mil (${g}°)`;
}

// A linha inteira, como aparece no popup da marcação. O "vd" ao fim NÃO é
// enfeite: é a marca de que o azimute é VERDADEIRO e não de quadrícula nem
// magnético (ver o cabeçalho deste arquivo).
export function formatarVisada(v) {
  if (!v) return '';
  return `${formatarDistancia(v.distanciaM)} · ${formatarAzimute(v.azimuteGraus)} vd`;
}
