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
// QUAL NORTE: QUADRÍCULA (definido pelo usuário em 2026-08-02)
// -------------------------------------------------------------
// Existem três nortes possíveis, e um azimute sem dizer qual deles usa é um
// número perigoso:
//
//   * VERDADEIRO — norte geográfico. É o que a geodésia (Vincenty, abaixo)
//     devolve naturalmente.
//   * QUADRÍCULA — o norte das linhas verticais da carta. Difere do
//     verdadeiro pela CONVERGÊNCIA MERIDIANA, que cresce com a distância ao
//     meridiano central da zona UTM: no Brasil chega a ~1,45° na borda de uma
//     zona, ou seja **~26 milésimos**.
//   * MAGNÉTICO — o da bússola. Difere pela declinação magnética, que varia
//     com o lugar e com o ANO. Exige um modelo (IGRF/WMM) que este projeto
//     não tem.
//
// **Em apoio de fogo, lançamento é SEMPRE em relação ao norte de quadrícula**
// — é assim que se mede na carta e é o que a peça recebe. Então é isso que
// este módulo entrega e é isso que a tela mostra (sufixo `qd`). A primeira
// versão mostrava o verdadeiro; foi corrigido no mesmo dia, com a resposta de
// quem usa.
//
// O verdadeiro continua sendo devolvido junto (`azimuteVerdadeiroGraus`), por
// dois motivos: é o que se compara com uma fonte geodésica externa quando se
// quer conferir a conta, e é o ponto de partida se um dia entrar o magnético.

// eslint-disable-next-line -- coordenadas.js é puro (não importa nada), então
// não há risco de ciclo; é de lá que vem a zona UTM que define o meridiano
// central usado na convergência.
import { zonaUtm } from './coordenadas.js';

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

// ── Convergência meridiana ──────────────────────────────────────────────────
// O ângulo entre o norte VERDADEIRO e o norte da QUADRÍCULA no ponto dado.
// Positivo quando o norte da quadrícula está a leste do verdadeiro.
//
//     azimute de quadrícula = azimute verdadeiro − convergência
//
// A fórmula é a expressão esférica exata, `atan(tan Δλ · sen φ)`, com Δλ
// medido a partir do meridiano central da zona UTM do ponto. Conferida contra
// o `meridian_convergence` do PROJ em oito pontos do Brasil (do meridiano
// central às duas bordas da zona): concorda dentro de **0,01 mili-grau**, ou
// 0,0002 milésimo. A forma de primeira ordem que muitos manuais trazem
// (`Δλ · sen φ`) erra até 0,94 mili-grau na borda da zona — ainda pequeno,
// mas o `atan` é igualmente barato e não tem esse resíduo.
//
// Devolve graus, ou `null` se o ponto for inválido.
//
// A zona é a do ponto passado — que, em `visada()`, é o do OBSERVADOR. É o
// correto: quem tem a carta na mão (e a quadrícula impressa nela) é ele. Se o
// alvo estiver na zona vizinha, o lançamento continua sendo medido na
// quadrícula do observador, que é o que ele consegue conferir.
export function convergenciaMeridiana(ponto) {
  if (!pontoValido(ponto)) return null;
  const zona = zonaUtm(ponto.lat, ponto.lon);
  if (zona == null) return null;
  const meridianoCentral = (zona - 1) * 6 - 180 + 3;
  const dLambda = (ponto.lon - meridianoCentral) * GRAU;
  return Math.atan(Math.tan(dLambda) * Math.sin(ponto.lat * GRAU)) / GRAU;
}

// ── Inversa de Vincenty ─────────────────────────────────────────────────────
// `de` e `para`: { lat, lon } em grau decimal (o formato que o projeto usa em
// todo lugar — posicoes_atuais, elementos_marcados, Leaflet).
//
// Devolve, ou `null` quando não dá para afirmar nada (ponto inválido, ou não
// convergiu):
//
//   distanciaM              distância no ELIPSOIDE (chão), em metros. É a que
//                           a peça precisa — não a distância na quadrícula,
//                           que traz junto o fator de escala do UTM (até
//                           ~4 m em 10 km).
//   azimuteGraus            azimute de QUADRÍCULA, que é o lançamento.
//   azimuteMil              o mesmo, em milésimos NATO.
//   azimuteVerdadeiroGraus  o verdadeiro, para conferência contra fonte
//                           geodésica externa.
//   convergenciaGraus       a diferença entre os dois, no ponto do observador.
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
    if (senSigma === 0) {
      return {
        distanciaM: 0, azimuteGraus: 0, azimuteMil: 0,
        azimuteVerdadeiroGraus: 0, convergenciaGraus: convergenciaMeridiana(de) ?? 0,
      };
    }

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
  const azimuteVerdadeiroGraus = (azimuteRad / GRAU + 360) % 360;

  // A conversão para quadrícula. Se a convergência não puder ser calculada
  // (ponto fora da faixa do UTM — polos), o azimute de quadrícula não existe;
  // devolvemos o verdadeiro com convergência 0 em vez de `null`, porque perder
  // o vetor inteiro por causa do NORTE seria pior do que dar o vetor com o
  // norte que se tem. Não acontece em nenhum exercício no Brasil.
  const convergenciaGraus = convergenciaMeridiana(de) ?? 0;
  const azimuteGraus = (azimuteVerdadeiroGraus - convergenciaGraus + 360) % 360;

  return {
    distanciaM,
    azimuteGraus,
    azimuteMil: grausParaMilesimos(azimuteGraus),
    azimuteVerdadeiroGraus,
    convergenciaGraus,
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

// A linha inteira, como aparece no popup da marcação. O "qd" ao fim NÃO é
// enfeite: é a marca de que o lançamento é de QUADRÍCULA — e é o que permite
// alguém perceber, de relance, se um dia o app voltar a mostrar o verdadeiro
// (ver o cabeçalho deste arquivo).
export function formatarVisada(v) {
  if (!v) return '';
  return `${formatarDistancia(v.distanciaM)} · ${formatarAzimute(v.azimuteGraus)} qd`;
}
