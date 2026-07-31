// vigia-ausencia.js — extraído na Etapa 6c a partir de frontend/colegas.js.
//
// Por que este arquivo existe
// ----------------------------
// colegas.js (Etapa 4) já tinha sua própria "vigia de ausência": um
// setInterval que esmaece e depois remove o avatar de quem parou de mandar
// posição, porque não existe nenhum evento de "usuário sumiu" (só
// INSERT/UPDATE de posição nova e DELETE de alguém apagando a linha). A
// Etapa 6c (frontend/situacao.js, o mapa ao vivo do instrutor) precisa
// EXATAMENTE do mesmo comportamento, pelo MESMO motivo, e com os MESMOS dois
// limiares — o instrutor que viu um aluno esmaecer/sumir ao vivo em
// colegas.js precisa ver a mesma coisa na tela dele.
//
// Copiar os números (60s / 120s) para dentro de situacao.js resolveria o
// problema de hoje mas criaria exatamente o risco que o projeto já evitou
// outras vezes com extração (icones.js na Etapa 5, buscarPartidosDaTurma na
// 6a): duas cópias da mesma regra, livres para divergir em silêncio se um
// dia alguém ajustar um limiar só de um lado. Como agora existem DOIS
// consumidores do mesmo comportamento (não um terceiro caso "seria bom, mas
// não vale o risco" como o de colegas.js/gps.js na Etapa 4), a extração
// acontece já, e colegas.js foi ajustado para consumir daqui — não sobrou
// segunda cópia dos números nem da função de idade.
//
// Sem DOM, sem Leaflet, sem Supabase: só os limiares e o cálculo de idade.

// gps.js grava um "heartbeat" (sinal de vida) a cada 30s mesmo parado (ver
// HEARTBEAT_MS em gps.js) — então, em uso normal, `atualizado_em` nunca fica
// muito mais velha que isso. Dois patamares:
//   AVISO_PARADO_MS — passou de 2 heartbeats perdidos: ainda mostra o
//   avatar, mas esmaecido (opacidade menor), como "sem novidade recente".
//   REMOVER_MS — passou de 4 heartbeats perdidos: tira do mapa. Nesse ponto
//   é mais provável que o app tenha fechado (ou perdido internet de vez) do
//   que só um GPS lento — não faz sentido continuar mostrando.
export const AVISO_PARADO_MS = 60_000;
export const REMOVER_MS = 120_000;
export const INTERVALO_VIGIA_MS = 15_000; // de quanto em quanto tempo a vigia checa todo mundo

// Usa `atualizadoEm` (carimbo posto pelo SERVIDOR a cada upsert), nunca
// `medido_em` (carimbo do RELÓGIO DO CELULAR de quem está sendo observado):
// um celular com hora errada bagunçaria a conta de "há quanto tempo essa
// posição parou". O relógio do servidor é a mesma referência para todo
// mundo. Aceita string ISO, Date, ou nulo (trata como "agora", isto é,
// idade zero — mesma escolha de colegas.js desde a Etapa 4).
export function idadeMs(atualizadoEm) {
  const carimbo = atualizadoEm ? new Date(atualizadoEm).getTime() : Date.now();
  return Date.now() - carimbo;
}

// Fábrica de uma vigia: a cada INTERVALO_VIGIA_MS, chama listarEstados() (que
// deve devolver um array de objetos com pelo menos `ultimaAtualizacaoEm` em
// ms desde epoch) e decide, para cada um, se chama aoEsmaecer ou aoRemover —
// ou nenhum dos dois, se ainda está "vivo". Devolve { parar() }.
//
// Quem chama decide o que "esmaecer" e "remover" significam (setOpacity num
// marker Leaflet, atualizar uma linha de lista, etc.) — esta função só sabe
// comparar tempo contra os dois limiares, para colegas.js e situacao.js não
// reimplementarem cada um o próprio laço com os mesmos números por dentro.
export function iniciarVigia({ listarEstados, aoEsmaecer, aoRemover }) {
  const id = setInterval(() => {
    for (const estado of listarEstados()) {
      const inatividade = Date.now() - estado.ultimaAtualizacaoEm;
      if (inatividade >= REMOVER_MS) {
        aoRemover(estado);
      } else if (inatividade >= AVISO_PARADO_MS) {
        aoEsmaecer(estado);
      }
    }
  }, INTERVALO_VIGIA_MS);
  return { parar: () => clearInterval(id) };
}
