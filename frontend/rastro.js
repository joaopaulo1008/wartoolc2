// rastro.js — Etapa 6b do roadmap: a MATEMÁTICA do rastro e do replay.
//
// Por que este arquivo existe, separado de debriefing.js
// -----------------------------------------------------
// Mesma separação que o projeto já faz em outros lugares (permissoes.js é o
// dado, instrutor-permissoes.js é a tela): aqui mora só a lógica pura —
// nenhum DOM, nenhum Leaflet, nenhum Supabase, nenhum `window`. É isso que
// torna esta parte testável em Node (frontend/rastro.teste.mjs), do mesmo
// jeito que simbolos.js virou testável na Etapa 4.5.
//
// E a parte que precisa de teste é justamente esta. "Onde este aluno estava
// às 14h37?" é uma pergunta que se responde errado em silêncio: uma busca
// binária com o limite trocado, ou uma interpolação que atravessa uma perda
// de sinal de vinte minutos em linha reta, produzem um replay que PARECE
// certo e afirma coisa que não aconteceu. Num debriefing isso não é bug de
// interface, é informação falsa sobre o exercício.
//
// As três regras que este módulo implementa
// -----------------------------------------
//   1. AMOSTRAGEM — quantos pontos pedir ao banco, dado o tamanho da janela e
//      quantos alunos foram escolhidos (calcularIntervaloAmostragem). O corte
//      de verdade acontece no servidor, em fn_rastro_historico (migration
//      0005); aqui só se decide o tamanho do balde.
//   2. PERDA DE SINAL — dois pontos consecutivos separados por mais que
//      GAP_SEM_SINAL_MS não são um trecho percorrido, são um buraco. Nem a
//      trilha desenhada os liga em linha reta (segmentar), nem o replay
//      interpola entre eles (posicaoNoInstante).
//   3. RECONSTITUIÇÃO — onde cada um estava num instante qualquer, incluindo
//      instantes entre duas leituras (posicaoNoInstante).
//
// Os dois limiares de perda de sinal são DE PROPÓSITO os mesmos de
// colegas.js (AVISO_PARADO_MS / REMOVER_MS): o instrutor que viu um avatar
// esmaecer no mapa ao vivo e depois sumir precisa ver o mesmo comportamento,
// pelo mesmo motivo, quando reproduz aquele momento no debriefing. Se os
// números divergirem, o replay contradiz a memória de quem estava lá.

// ── Limiares de perda de sinal ───────────────────────────────────────────
// gps.js grava um heartbeat a cada 30s mesmo com o aluno parado, então um
// intervalo muito maior que isso significa que o dado parou de chegar — não
// que o aluno ficou parado (parado ele continua carimbando).
//   GAP_ESMAECER_MS  — 2 heartbeats perdidos: ainda mostra onde ele estava,
//                      mas esmaecido, como "sem novidade".
//   GAP_SEM_SINAL_MS — 4 heartbeats perdidos: tira do mapa. Daqui para cima
//                      também não se interpola: ligar dois pontos separados
//                      por 2 minutos em linha reta é inventar um trajeto.
export const GAP_ESMAECER_MS  = 60_000;
export const GAP_SEM_SINAL_MS = 120_000;

// ── Amostragem ───────────────────────────────────────────────────────────
// Piso de 5s porque é o INTERVALO_MIN de gps.js: nenhum aluno grava duas
// posições com menos de 5s de diferença, então balde menor que isso não
// devolve nem um ponto a mais — só dá a impressão falsa de mais resolução.
export const INTERVALO_MINIMO_S = 5;

// Dois tetos independentes, e o maior dos dois vence:
//
//   POR ALUNO — 1000 não é número redondo por acaso: é o `max-rows` padrão do
//   PostgREST no Supabase, ou seja, o tamanho de uma resposta. Garantindo que
//   NENHUM aluno passe disso, debriefing.js pode buscar o rastro em lotes de
//   alunos (cada lote numa requisição) em vez de paginar por deslocamento —
//   e isso importa: paginar uma RPC por offset faz o PostgREST reexecutar a
//   função INTEIRA a cada página, então 12 páginas custariam 12 varreduras do
//   mesmo intervalo. Dividindo por aluno, a soma das requisições custa UMA
//   varredura. Além disso, uma trilha com mais de mil pontos não fica mais
//   legível, fica mais pesada: a 30s de cadência, dois pontos de um homem a pé
//   caem a poucos metros um do outro e o mapa não tem pixels para separá-los.
//
//   TOTAL — o que protege a memória do navegador quando o instrutor escolhe a
//   turma inteira: um punhado de polylines que o Leaflet desenha sem engasgar.
export const ALVO_PONTOS_POR_ALUNO = 1000;
export const ALVO_PONTOS_TOTAL     = 12000;

// Valores "redondos" para o balde. Existem para o rótulo na tela fazer
// sentido para quem lê ("1 ponto a cada 2 min" em vez de "a cada 73 s") e
// para o instrutor conseguir repetir a mesma consulta depois.
export const PASSOS_SUGERIDOS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

// Tamanho do balde de amostragem, em segundos, para uma janela de `duracaoS`
// segundos com `qtdAlunos` alunos selecionados. Arredonda para cima até o
// próximo valor de PASSOS_SUGERIDOS.
export function calcularIntervaloAmostragem(duracaoS, qtdAlunos) {
  const alunos = Math.max(1, Math.floor(qtdAlunos) || 1);
  const duracao = Math.max(1, Number(duracaoS) || 1);

  const exigidoPorAluno = duracao / ALVO_PONTOS_POR_ALUNO;
  const exigidoPeloTotal = (duracao * alunos) / ALVO_PONTOS_TOTAL;

  const bruto = Math.max(
    INTERVALO_MINIMO_S,
    Math.ceil(exigidoPorAluno),
    Math.ceil(exigidoPeloTotal)
  );

  return PASSOS_SUGERIDOS.find((p) => p >= bruto) ?? PASSOS_SUGERIDOS[PASSOS_SUGERIDOS.length - 1];
}

// Rótulo humano do balde — mora aqui, e não na tela, porque está amarrado a
// PASSOS_SUGERIDOS: quem mexer na lista vê o rótulo logo abaixo.
export function rotuloIntervalo(segundos) {
  const s = Math.round(Number(segundos) || 0);
  if (s < 60) return `${s} s`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

// ── Montagem das trilhas ─────────────────────────────────────────────────
// Recebe as linhas cruas devolvidas por fn_rastro_historico (ou por um select
// direto em posicoes_historico — as colunas usadas são as mesmas) e devolve
// um Map usuario_id -> trilha, com os pontos ordenados no tempo.
//
// Ordenar aqui é defensivo, não redundante: a RPC já devolve
// `order by usuario_id, medido_em`, mas o cliente pagina a resposta e nada
// impede alguém, depois, de trocar a origem do dado. Todo o resto deste
// arquivo (busca binária, segmentação, interpolação) PRESSUPÕE ordem
// crescente — deixar isso na mão de quem chama é como a busca binária começa
// a devolver a posição errada em silêncio.
// `Number(null)` é 0 e `Number('')` é 0 — não NaN. Sem esta guarda, uma linha
// com coordenada nula viraria um ponto legítimo na costa da África, no meio da
// trilha, e o replay levaria o símbolo até lá e de volta. As colunas são
// `not null` no schema (0001), então isto é defesa contra o dado chegar por
// outro caminho, não contra o banco.
function numeroOuNaN(valor) {
  if (valor === null || valor === undefined || valor === '') return NaN;
  return Number(valor);
}

export function montarTrilhas(linhas) {
  const trilhas = new Map();

  for (const linha of linhas || []) {
    const t = typeof linha.medido_em === 'number'
      ? linha.medido_em
      : Date.parse(linha.medido_em);
    const lat = numeroOuNaN(linha.latitude);
    const lon = numeroOuNaN(linha.longitude);
    // Linha inutilizável (carimbo ilegível, coordenada nula) é descartada em
    // silêncio: um NaN no meio da trilha vira uma polyline quebrada e uma
    // interpolação que devolve NaN — pior do que um ponto a menos.
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let trilha = trilhas.get(linha.usuario_id);
    if (!trilha) {
      trilha = { usuarioId: linha.usuario_id, pontos: [], leiturasBrutas: 0 };
      trilhas.set(linha.usuario_id, trilha);
    }

    trilha.pontos.push({
      t,
      lat,
      lon,
      precisao: linha.precisao_m != null ? Number(linha.precisao_m) : null,
      velocidade: linha.velocidade_ms != null ? Number(linha.velocidade_ms) : null,
      rumo: linha.rumo_graus != null ? Number(linha.rumo_graus) : null,
      // Quantas gravações reais este ponto representa (a RPC agrupa por balde).
      // Sem a RPC — ou num balde de 5s, onde cada ponto é uma leitura só — vem 1.
      leituras: Number(linha.leituras_no_balde) || 1,
    });
    trilha.leiturasBrutas += Number(linha.leituras_no_balde) || 1;
  }

  for (const trilha of trilhas.values()) {
    trilha.pontos.sort((a, b) => a.t - b.t);
    // Carimbos repetidos existem: `medido_em` vem do relógio do CELULAR do
    // aluno (não do servidor), e dois baldes distintos podem colidir se o
    // relógio dele voltar. Um t duplicado quebraria a busca binária e daria
    // divisão por zero na interpolação.
    trilha.pontos = trilha.pontos.filter((p, i, arr) => i === 0 || p.t !== arr[i - 1].t);
    trilha.inicio = trilha.pontos.length ? trilha.pontos[0].t : null;
    trilha.fim    = trilha.pontos.length ? trilha.pontos[trilha.pontos.length - 1].t : null;
  }

  return trilhas;
}

// Janela coberta pelo conjunto todo — é o começo e o fim da linha do tempo do
// replay. Devolve { inicio, fim } em ms, ou null se não houver ponto nenhum.
export function janelaDasTrilhas(trilhas) {
  let inicio = null;
  let fim = null;
  for (const trilha of trilhas.values()) {
    if (!trilha.pontos.length) continue;
    if (inicio === null || trilha.inicio < inicio) inicio = trilha.inicio;
    if (fim === null || trilha.fim > fim) fim = trilha.fim;
  }
  return inicio === null ? null : { inicio, fim };
}

// ── Busca do ponto vigente ───────────────────────────────────────────────
// Maior índice i com pontos[i].t <= t, ou -1 se t for anterior ao primeiro
// ponto. Busca binária porque isto roda para CADA aluno a CADA quadro do
// replay: com 60 alunos a 10 quadros por segundo, uma varredura linear sobre
// 2000 pontos seria 1,2 milhão de comparações por segundo à toa.
//
// Não dá para usar um cursor que só avança (mais barato ainda) porque o
// instrutor arrasta a barra de tempo para trás o tempo todo — é justamente
// para isso que ela existe.
export function indiceAntesDe(pontos, t) {
  let baixo = 0;
  let alto = pontos.length - 1;
  let achado = -1;
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1;
    if (pontos[meio].t <= t) {
      achado = meio;
      baixo = meio + 1;
    } else {
      alto = meio - 1;
    }
  }
  return achado;
}

// ── Segmentação por perda de sinal ───────────────────────────────────────
// Quebra a lista de pontos em trechos contínuos. Um intervalo maior que
// `gapMs` entre dois pontos consecutivos encerra o trecho: a trilha desenhada
// NÃO liga os dois em linha reta, porque não se sabe por onde a pessoa andou
// nesse tempo — e uma reta atravessando um rio ou um morro é exatamente o
// tipo de coisa que alguém aponta no debriefing como se fosse fato.
export function segmentar(pontos, gapMs = GAP_SEM_SINAL_MS) {
  const segmentos = [];
  let atual = [];
  for (let i = 0; i < pontos.length; i++) {
    if (i > 0 && pontos[i].t - pontos[i - 1].t > gapMs) {
      if (atual.length) segmentos.push(atual);
      atual = [];
    }
    atual.push(pontos[i]);
  }
  if (atual.length) segmentos.push(atual);
  return segmentos;
}

// ── Reconstituição num instante ──────────────────────────────────────────
// A pergunta central do replay: "onde este aluno estava em t?".
//
// Devolve null quando t é anterior ao primeiro ponto — ele ainda não entrou
// em cena e não deve ser desenhado. Caso contrário devolve
// { lat, lon, estado, idade, interpolado, ponto, proximo, fracao }, onde
// `estado` é:
//   'ok'        — posição confiável (leitura recente ou interpolação curta);
//   'esmaecido' — passou de GAP_ESMAECER_MS sem leitura nova: desenhar mais
//                 apagado, como colegas.js faz no mapa ao vivo;
//   'sem_sinal' — passou de GAP_SEM_SINAL_MS: tirar do mapa. A posição vai
//                 junto assim mesmo, para quem chamar poder mostrar "último
//                 ponto conhecido" se quiser.
//
// A INTERPOLAÇÃO é linear e só acontece DENTRO de um trecho contínuo (dois
// pontos separados por até gapSemSinalMs). Ela existe porque a cadência real
// é de 30s: sem interpolar, o replay anda aos trancos e fica difícil de ler.
// Mas ela é uma suavização entre duas medidas próximas, não uma extrapolação:
// atravessado o limiar de perda de sinal, o símbolo PARA no último ponto
// conhecido, esmaece e some — que é a representação honesta de "o dado parou
// de chegar aqui".
export function posicaoNoInstante(pontos, t, opcoes = {}) {
  const {
    gapSemSinalMs = GAP_SEM_SINAL_MS,
    gapEsmaecerMs = GAP_ESMAECER_MS,
    interpolar = true,
  } = opcoes;

  if (!pontos || pontos.length === 0) return null;

  const i = indiceAntesDe(pontos, t);
  if (i < 0) return null; // antes do primeiro ponto: ainda não há o que mostrar

  const atual = pontos[i];
  const proximo = i + 1 < pontos.length ? pontos[i + 1] : null;
  const vao = proximo ? proximo.t - atual.t : Infinity;

  if (interpolar && proximo && vao <= gapSemSinalMs) {
    const fracao = vao === 0 ? 0 : (t - atual.t) / vao;
    return {
      lat: atual.lat + (proximo.lat - atual.lat) * fracao,
      lon: atual.lon + (proximo.lon - atual.lon) * fracao,
      estado: 'ok',
      idade: 0,
      interpolado: fracao > 0,
      fracao,
      ponto: atual,
      proximo,
    };
  }

  // Sem próximo ponto, ou com um buraco grande demais para atravessar:
  // segura no último ponto conhecido e deixa a idade decidir o estado.
  const idade = t - atual.t;
  const estado = idade >= gapSemSinalMs
    ? 'sem_sinal'
    : idade >= gapEsmaecerMs
      ? 'esmaecido'
      : 'ok';

  return {
    lat: atual.lat,
    lon: atual.lon,
    estado,
    idade,
    interpolado: false,
    fracao: 0,
    ponto: atual,
    proximo,
  };
}

// Trecho já percorrido até t, em segmentos de [lat, lon] prontos para o
// Leaflet. Respeita a mesma segmentação da trilha completa (não liga trechos
// separados por perda de sinal) e, quando a posição em t é interpolada,
// acrescenta esse ponto na ponta — é o que faz a linha "crescer" junto com o
// símbolo em vez de dar saltos de 30 em 30 segundos.
export function trechoAte(pontos, t, opcoes = {}) {
  const { gapSemSinalMs = GAP_SEM_SINAL_MS, interpolar = true } = opcoes;
  if (!pontos || pontos.length === 0) return [];

  const segmentos = [];
  let atual = [];
  for (let i = 0; i < pontos.length; i++) {
    if (pontos[i].t > t) break;
    if (i > 0 && pontos[i].t - pontos[i - 1].t > gapSemSinalMs) {
      if (atual.length) segmentos.push(atual);
      atual = [];
    }
    atual.push([pontos[i].lat, pontos[i].lon]);
  }
  if (atual.length) segmentos.push(atual);
  if (segmentos.length === 0) return [];

  if (interpolar) {
    const pos = posicaoNoInstante(pontos, t, { ...opcoes, interpolar: true });
    if (pos && pos.interpolado) segmentos[segmentos.length - 1].push([pos.lat, pos.lon]);
  }
  return segmentos;
}

// ── Distância percorrida ─────────────────────────────────────────────────
// Haversine com raio médio da Terra. Precisão de sobra para a escala aqui
// (dezenas de metros entre pontos consecutivos), e sem depender de biblioteca.
export function distanciaMetros(a, b) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Soma da trilha, pulando os buracos de sinal pelo mesmo motivo de segmentar:
// somar a reta que atravessa 20 minutos de silêncio infla a distância
// percorrida e vira número errado no debriefing.
export function distanciaTrilhaM(pontos, gapMs = GAP_SEM_SINAL_MS) {
  let total = 0;
  for (const segmento of segmentar(pontos || [], gapMs)) {
    for (let i = 1; i < segmento.length; i++) {
      total += distanciaMetros(segmento[i - 1], segmento[i]);
    }
  }
  return total;
}
