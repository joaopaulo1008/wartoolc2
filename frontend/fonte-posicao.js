// fonte-posicao.js — de onde vem a posição própria, e o que ela precisa ter.
//
// Módulo PURO: sem DOM, sem Leaflet, sem Supabase, sem relógio escondido
// (o instante entra por parâmetro). Existe para que `gps.js` deixe de ser o
// único lugar que sabe o que é uma "posição" — e para que a simulação sem GPS
// e, mais adiante, a integração com simuladores (Steel Beasts, SABRA) entrem
// pela MESMA porta, sem refazer o resto do app.
//
// O MODELO, EM DUAS PERGUNTAS
// ---------------------------
// 1. *De onde vem a posição própria?* → o MODO da turma (`turmas.modo_posicao`,
//    migration 0016):
//      'gps'      o celular lê o GPS e grava (comportamento de sempre);
//      'manual'   simulação: o aluno posiciona o próprio posto no mapa;
//      'externa'  simulador: quem grava é um serviço no servidor, e o celular
//                 NÃO produz posição própria nenhuma.
// 2. *De onde veio ESTA posição?* → a ORIGEM, gravada junto de cada linha
//    (`posicoes_*.origem`). Os valores são os mesmos três, e não é coincidência:
//    num cliente que grava, origem e modo são a mesma coisa. A exceção é a
//    'externa', que o cliente nunca escreve — a policy do banco recusa.
//
// O QUE ESTE MÓDULO NÃO FAZ
// -------------------------
// Não decide quem PODE gravar. Isso é a RLS (regra dura 3 do CLAUDE.md): as
// funções `usaGps`, `aceitaPosicaoManual` etc. abaixo servem para a TELA
// obedecer o modo — esconder um botão, não ligar o `watchPosition` à toa. Um
// aluno com o console aberto contorna a tela; não contorna a policy.
//
// A LEITURA: o contrato que toda fonte entrega
// --------------------------------------------
// GPS, toque no mapa e (um dia) simulador entregam a mesma coisa, uma
// `Leitura`, e o resto do pipeline (throttling, desenho, gravação) não sabe de
// qual fonte veio:
//
//     { lat, lon, precisao, altitude, rumo, velocidade, instante, origem,
//       entidade }
//
// `instante` é em milissegundos (como `GeolocationPosition.timestamp`).
// `entidade` é opcional e hoje não vai para o banco: é o identificador da
// entidade no simulador de origem, para quando um mesmo serviço de integração
// entregar várias posições de uma vez. Ficar no contrato desde já evita mexer
// em todo mundo que o consome quando esse dia chegar.

export const MODOS = Object.freeze(['gps', 'manual', 'externa']);
export const ORIGENS = Object.freeze(['gps', 'manual', 'externa']);
export const MODO_PADRAO = 'gps';

// Limiares do throttling de gravação. Moram aqui, e não em gps.js, porque a
// decisão de gravar virou função pura (`decidirGravacao`) e a função e seus
// números têm que andar juntas. Os valores e as razões deles continuam
// documentados em gps.js, onde o problema é explicado.
export const INTERVALO_MINIMO_MS = 5_000;
export const DISTANCIA_MINIMA_M  = 10;
export const HEARTBEAT_MS        = 30_000;

// ── Modo ────────────────────────────────────────────────────────────────────

// Qualquer coisa que não seja um modo conhecido vira 'gps'. É deliberado: uma
// turma lida antes da migration 0016, um valor novo que este cliente ainda não
// conhece, `null` de uma resposta com erro — em todos esses casos o app deve
// continuar fazendo o que sempre fez, não parar de rastrear.
export function normalizarModo(valor) {
  return MODOS.includes(valor) ? valor : MODO_PADRAO;
}

// O celular deve ler o GPS do aparelho?
export const usaGps = (modo) => normalizarModo(modo) === 'gps';

// A tela deve oferecer "Posicionar-me aqui" e o arrasto do símbolo?
export const aceitaPosicaoManual = (modo) => normalizarModo(modo) === 'manual';

// A posição própria vem de fora (serviço de integração)?
export const posicaoVemDeFora = (modo) => normalizarModo(modo) === 'externa';

// Que origem este cliente grava neste modo? `null` = nenhuma: em 'externa' o
// cliente não escreve posição própria (e a RLS recusaria se tentasse).
export function origemDeEscrita(modo) {
  const m = normalizarModo(modo);
  return m === 'externa' ? null : m;
}

// Simulação = tudo que não é o GPS do aparelho. É a pergunta do selo no rodapé.
export const ehSimulacao = (modo) => normalizarModo(modo) !== 'gps';

// Texto do selo "SIMULAÇÃO" (rodapé). Em modo gps não há selo: `''`.
export function rotuloModo(modo) {
  switch (normalizarModo(modo)) {
    case 'manual': return 'SIMULAÇÃO · posição manual';
    case 'externa': return 'SIMULAÇÃO · posição do simulador';
    default: return '';
  }
}

// Rótulo curto para a tela (popup, selo, status).
export function rotuloOrigem(origem) {
  switch (origem) {
    case 'gps': return 'GPS';
    case 'manual': return 'posição manual (simulação)';
    case 'externa': return 'simulador';
    default: return 'origem desconhecida';
  }
}

// ── Leitura ─────────────────────────────────────────────────────────────────

const finito = (n) => typeof n === 'number' && Number.isFinite(n);

// Aceita só número finito e dentro da faixa; senão `null`. Espelha os `check`
// de `posicoes_atuais` (0001): o banco recusaria o valor de qualquer jeito, e
// a leitura inteira iria junto por causa de um campo opcional. Melhor descartar
// o campo ruim e gravar a posição.
const opcional = (n, ok) => (finito(n) && ok(n) ? n : null);

// Monta uma Leitura a partir de campos soltos. Devolve `null` se não houver
// posição utilizável (latitude ou longitude ausentes, fora da faixa, ou uma
// origem que o banco não conhece) — quem chama ignora a leitura, como já
// ignorava um GPS sem fixação.
//
// `agora` é injetado (e não `Date.now()` aqui dentro) para o teste conseguir
// fixar o instante.
export function criarLeitura(entrada = {}, { agora = Date.now() } = {}) {
  const { lat, lon, precisao, altitude, rumo, velocidade, instante, origem, entidade } = entrada;
  if (!finito(lat) || lat < -90 || lat > 90) return null;
  if (!finito(lon) || lon < -180 || lon > 180) return null;
  if (!ORIGENS.includes(origem)) return null;
  return Object.freeze({
    lat,
    lon,
    precisao: opcional(precisao, (n) => n >= 0),
    altitude: opcional(altitude, () => true),
    rumo: opcional(rumo, (n) => n >= 0 && n <= 360),
    velocidade: opcional(velocidade, (n) => n >= 0),
    instante: finito(instante) ? instante : agora,
    origem,
    entidade: typeof entidade === 'string' && entidade ? entidade : null,
  });
}

// `GeolocationPosition` (W3C) → Leitura de origem 'gps'.
//
// `heading` e `speed` chegam como `null` (sem suporte) ou `NaN` (parado, pela
// especificação) — `opcional` trata os dois como "não informado".
export function leituraDeGeolocation(posicao, opcoes) {
  const c = posicao?.coords;
  if (!c) return null;
  return criarLeitura(
    {
      lat: c.latitude,
      lon: c.longitude,
      precisao: c.accuracy,
      altitude: c.altitude,
      rumo: c.heading,
      velocidade: c.speed,
      instante: posicao.timestamp,
      origem: 'gps',
    },
    opcoes,
  );
}

// Um ponto escolhido no mapa → Leitura de origem 'manual'.
//
// Sem precisão, sem rumo, sem velocidade: o aluno disse ONDE está, não mediu
// nada. Gravar uma precisão inventada ("±5 m") seria afirmar o que ninguém
// mediu — e o debriefing não teria como distinguir de um GPS bom.
export function leituraManual(lat, lon, opcoes) {
  return criarLeitura({ lat, lon, origem: 'manual' }, opcoes);
}

// Leitura → linha de `posicoes_atuais`.
//
// `incluirOrigem` existe por causa da ORDEM DE IMPLANTAÇÃO: o front-end sai
// por push no GitHub Pages e a migration 0016 é aplicada à mão no Supabase.
// Se o cliente mandasse a coluna `origem` antes de a migration existir, o
// PostgREST recusaria TODA gravação de posição. Por isso o chamador só liga
// esta opção depois de ter lido `turmas.modo_posicao` com sucesso — prova de
// que a coluna existe. Sem a opção, a linha é idêntica à de antes da 0016.
export function paraLinhaPosicao(leitura, { userId, turmaId, incluirOrigem = false }) {
  const linha = {
    usuario_id: userId,
    turma_id: turmaId,
    latitude: leitura.lat,
    longitude: leitura.lon,
    altitude_m: leitura.altitude,
    precisao_m: leitura.precisao,
    rumo_graus: leitura.rumo,
    velocidade_ms: leitura.velocidade,
    medido_em: new Date(leitura.instante).toISOString(),
  };
  if (incluirOrigem) linha.origem = leitura.origem;
  return linha;
}

// ── Geometria e throttling ──────────────────────────────────────────────────

// Distância em metros entre dois pontos lat/lon (Haversine — trata a Terra como
// esfera; erro desprezível na escala de um exercício de campo). Veio de gps.js
// sem alteração.
export function distanciaMetros(a, b) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Decide se uma leitura deve ser GRAVADA. É `deveGravar()` de gps.js, com o
// estado passado por parâmetro em vez de lido de variáveis do módulo — a
// lógica é a mesma, regra por regra, na mesma ordem:
//
//   0. `forcar` (retomada depois do congelamento da página) fura as três;
//   1. teto de frequência: nunca antes de `intervaloMinimoMs`;
//   2. primeira leitura da sessão: sempre grava;
//   3. andou o bastante (`distanciaMinimaM`): grava;
//   4. heartbeat: parado há muito tempo, grava como sinal de vida.
//
// Não existia teste nenhum desta decisão. A suíte desta extração a fixa antes
// de qualquer mudança futura.
export function decidirGravacao({
  agora,
  ultimoEnvioEm,
  ultimaPosGravada,
  posicao,
  forcar = false,
  intervaloMinimoMs = INTERVALO_MINIMO_MS,
  distanciaMinimaM = DISTANCIA_MINIMA_M,
  heartbeatMs = HEARTBEAT_MS,
}) {
  if (forcar) return true;
  if (agora - ultimoEnvioEm < intervaloMinimoMs) return false;
  if (!ultimaPosGravada) return true;
  if (distanciaMetros(ultimaPosGravada, posicao) >= distanciaMinimaM) return true;
  if (agora - ultimoEnvioEm >= heartbeatMs) return true;
  return false;
}
