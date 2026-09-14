// vigia-ausencia.js — extraído na Etapa 6c a partir de frontend/colegas.js.
//
// Por que este arquivo existe
// ----------------------------
// colegas.js (Etapa 4) já tinha sua própria "vigia de ausência": um
// setInterval que reavaliava o avatar de quem parou de mandar posição,
// porque não existe nenhum evento de "usuário sumiu" (só INSERT/UPDATE de
// posição nova e DELETE de alguém apagando a linha). A Etapa 6c
// (frontend/situacao.js, o mapa ao vivo do instrutor) precisa EXATAMENTE do
// mesmo comportamento, pelo MESMO motivo, e com os MESMOS dois limiares — o
// instrutor que viu um aluno ser marcado como atrasado ao vivo precisa ver a
// mesma coisa na tela dele.
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
// Sem DOM, sem Leaflet, sem Supabase: só os limiares, o cálculo de idade e o
// rótulo curto que as telas escrevem ao lado do símbolo.

// ── O que "ausência" significa na tela, e por que mudou duas vezes ────────
//
// gps.js grava um "heartbeat" (sinal de vida) a cada 30s mesmo parado (ver
// HEARTBEAT_MS em gps.js) — então, em uso normal, `atualizado_em` nunca fica
// muito mais velha que isso. Dois patamares:
//   AVISO_PARADO_MS — passou de 2 heartbeats perdidos: "sem novidade recente".
//   SEM_SINAL_MS    — passou de 4 heartbeats perdidos: mais provável que o
//                     app tenha fechado (ou perdido internet de vez) do que
//                     só um GPS lento.
//
// O que esses patamares PROVOCAM na tela mudou duas vezes, sempre a pedido
// de quem usa em campo, e a história importa para ninguém reintroduzir o que
// já foi tirado:
//
//   1. Até 2026-08-01 — o segundo patamar REMOVIA o avatar do mapa. Um amigo
//      que perdia sinal literalmente sumia, sem deixar rastro de onde esteve.
//      Corrigido: o marcador passou a ficar na última posição conhecida, só
//      mais esmaecido.
//   2. Até 2026-09-14 — sobrava o esmaecimento (opacidade 0,4 e depois 0,15).
//      Pedido de campo: o avatar NÃO deve esmaecer; ele marca a última
//      posição conhecida do elemento, e um símbolo militar a 15% de opacidade
//      sobre a carta do BDGEx é quase invisível justamente quando é a única
//      informação que sobrou daquele elemento.
//
// **Mas tirar o esmaecimento sem pôr nada no lugar seria pior do que
// mantê-lo**, e é o motivo de `rotuloIdade()` existir: sem nenhum sinal, uma
// posição de 40 minutos atrás fica pixel por pixel idêntica a uma de 5
// segundos, e quem olha a tela lê "ele está ali". Isso é a falha silenciosa
// que o projeto recusa desde a Etapa 6b (o debriefing avisa quantas leituras
// cada ponto representa em vez de mostrar rastro amostrado com cara de
// completo) e desde a Etapa 7 (a tela diz em voz alta quando simplificou uma
// geometria). Num vetor de tiro, ler posição velha como atual é erro caro.
//
// Então a troca é: opacidade sempre 1,0 + uma ETIQUETA DE IDADE ao lado do
// símbolo. Ela diz mais do que o esmaecimento dizia — "0,4" nunca respondeu
// "há quanto tempo", e "12m" responde.
export const AVISO_PARADO_MS = 60_000;
export const SEM_SINAL_MS = 120_000;
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

// Texto da etiqueta desenhada ao lado do símbolo, ou '' quando a posição
// ainda é recente (abaixo de AVISO_PARADO_MS) e não há o que avisar.
//
// Por que NÃO reusa `duracaoCurta()` de situacao.js/debriefing.js: aquelas
// duas formatam DURAÇÃO para ler dentro de uma frase ("parado há 2m05s",
// "Janela de 1h30m") e cabem numa linha de lista. Esta aqui divide o espaço
// com um símbolo militar de 26px num celular: precisa de duas ou três
// letras, não de sete. São requisitos diferentes, e forçar uma função só
// pioraria os dois lados — é o mesmo critério que manteve `NATUREZA` fora de
// `duracaoCurta` e por aí vai. (As duas cópias de `duracaoCurta` seguem onde
// estavam, com a diferença de comportamento que já tinham abaixo de 1min;
// unificá-las mudaria o rótulo da janela do debriefing, que não tem nada a
// ver com este pedido.)
//
// Granularidade: minutos até 1h, depois horas. Segundos não entram de
// propósito — a etiqueta só aparece a partir de 1min, e ver "1m03s" contando
// ao lado de cada símbolo seria ruído, não informação.
export function rotuloIdade(idade) {
  if (!Number.isFinite(idade) || idade < AVISO_PARADO_MS) return '';
  const minutos = Math.floor(idade / 60_000);
  if (minutos < 60) return `${minutos}m`;
  const horas = Math.floor(minutos / 60);
  if (horas >= 24) return '+24h';
  const resto = minutos % 60;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, '0')}`;
}

// Fábrica de uma vigia: a cada INTERVALO_VIGIA_MS, chama listarEstados() (que
// deve devolver um array de objetos com pelo menos `ultimaAtualizacaoEm` em
// ms desde epoch) e chama aoConferir() para CADA UM, com a idade já
// calculada e os dois limiares já aplicados. Devolve { parar() }.
//
// Antes desta mudança havia dois callbacks (`aoEsmaecer`/`aoRemover`),
// disparados só ao CRUZAR um limiar. Isso bastava enquanto o efeito era um
// valor fixo de opacidade — passou a não bastar quando o efeito virou um
// texto que CONTA ("12m" precisa virar "13m" no minuto seguinte). Um
// callback só, chamado sempre, também deixa o consumidor apagar a etiqueta
// sozinho quando a posição volta a ser recente, em vez de depender de o
// caminho de upsert lembrar de limpar.
//
// Quem chama decide o que fazer com a informação (escrever a etiqueta num
// marcador Leaflet, redesenhar uma linha de lista, etc.) — esta função só
// sabe comparar tempo contra os dois limiares, para colegas.js e situacao.js
// não reimplementarem cada um o próprio laço com os mesmos números por
// dentro.
// `aoFim` (opcional) roda UMA vez ao final de cada ciclo, depois de todos os
// aoConferir. Existe para trabalho que é por CICLO e não por elemento — em
// situacao.js, redesenhar a lista lateral: no formato antigo ela era
// redesenhada de dentro do callback, ou seja até uma vez por aluno atrasado
// (60 redesenhos da lista inteira a cada 15s num exercício cheio).
export function iniciarVigia({ listarEstados, aoConferir, aoFim }) {
  const id = setInterval(() => {
    for (const estado of listarEstados()) {
      const idade = Date.now() - estado.ultimaAtualizacaoEm;
      aoConferir(estado, {
        idade,
        atrasado: idade >= AVISO_PARADO_MS,
        semSinal: idade >= SEM_SINAL_MS,
        rotulo: rotuloIdade(idade),
      });
    }
    if (aoFim) aoFim();
  }, INTERVALO_VIGIA_MS);
  return { parar: () => clearInterval(id) };
}
