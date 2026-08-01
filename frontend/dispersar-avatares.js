// dispersar-avatares.js — evita avatares empilhados exatamente na mesma
// posição (relatado em campo, durante o teste da Etapa 11).
//
// O problema não é sobre ZOOM
// ----------------------------
// Dois pontos que só PARECEM perto porque a tela está afastada se resolvem
// zoom por zoom (a razão de ser de clustering em mapas normais). O que foi
// relatado é outra coisa: pessoas fisicamente próximas (formadas lado a
// lado, por exemplo) mandam coordenadas quase idênticas de verdade, e nesse
// caso nenhum zoom separa os avatares — o círculo de precisão do GPS
// (5-15m, já documentado em CLAUDE.md) faz o resto ficar embaralhado mesmo
// de perto. Por isso a solução aqui é puramente GEOGRÁFICA (metros de
// latitude/longitude), não depende de projeção nem de nível de zoom, e por
// isso é testável em Node sem Leaflet.
//
// Determinismo é a regra que mais importa aqui
// -----------------------------------------------
// A mesma turma nas mesmas posições SEMPRE produz o mesmo arranjo — os
// pontos de um grupo são ordenados por `id` (não pela ordem de chegada dos
// eventos do Realtime, que não é estável) antes de distribuir os ângulos do
// círculo. Sem isso, cada posição nova de QUALQUER pessoa do grupo
// recalcularia a ordem e os avatares "tremeriam" na tela toda vez que
// alguém do grupo se mexesse — mesmo que a maioria deles não tivesse saído
// do lugar.
//
// Cada chamador (colegas.js, situacao.js) é responsável por: (1) montar a
// lista de pontos com a posição CRUA (nunca a já deslocada — senão o
// deslocamento se acumula a cada chamada), (2) chamar isto de novo depois de
// QUALQUER mudança no conjunto (entrou, saiu, moveu), e (3) aplicar
// `marker.setLatLng()` no resultado. Ver os dois módulos para o padrão.
//
// Limitação conhecida, documentada e não resolvida aqui: o PRÓPRIO avatar
// (gps.js) não entra nesta dispersão — ele é um módulo separado, sem
// conhecimento das posições dos colegas. Se o próprio usuário estiver
// EXATAMENTE em cima de um colega, os dois avatares ainda se sobrepõem. Só
// os avatares DENTRE colegas (colegas.js) e DENTRE usuários vistos pelo
// instrutor (situacao.js) são separados um do outro.

const RAIO_TERRA_M = 6371000;

// Distância aproximada em metros entre duas coordenadas — projeção
// equirectangular (não haversine completa): erro desprezível nas escalas
// desta função (poucos a poucos dezenas de metros) e mais barato que
// trigonometria esférica completa rodando a cada posição nova.
function distanciaM(a, b) {
  const latMedRad = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dLatM = (b.lat - a.lat) * Math.PI / 180 * RAIO_TERRA_M;
  const dLngM = (b.lng - a.lng) * Math.PI / 180 * RAIO_TERRA_M * Math.cos(latMedRad);
  return Math.sqrt(dLatM * dLatM + dLngM * dLngM);
}

// Desloca um ponto por `metros` no ângulo `anguloRad` (0 = norte, sentido
// horário) — a operação inversa de distanciaM().
function deslocar(ponto, metros, anguloRad) {
  const latRad = ponto.lat * Math.PI / 180;
  const dLat = (metros * Math.cos(anguloRad)) / RAIO_TERRA_M * (180 / Math.PI);
  const dLng = (metros * Math.sin(anguloRad)) / (RAIO_TERRA_M * Math.cos(latRad)) * (180 / Math.PI);
  return { lat: ponto.lat + dLat, lng: ponto.lng + dLng };
}

// pontos: [{ id, lat, lng }, ...] — posições CRUAS (não deslocadas).
// opções: raioColisaoM (a partir de quantos metros dois pontos contam como
//   "empilhados"; default 3 — dentro do próprio ruído do GPS) e
//   raioDispersaoM (o raio do círculo para onde os pontos de um grupo vão;
//   default 3, visualmente separável em qualquer zoom onde o mapa faz
//   sentido para instrução tática).
// devolve: Map id -> { lat, lng } com TODOS os pontos de entrada — os que
//   não colidiram com ninguém saem com a MESMA posição recebida (identidade).
export function dispersarPosicoes(pontos, { raioColisaoM = 3, raioDispersaoM = 3 } = {}) {
  const resultado = new Map();
  if (!Array.isArray(pontos) || pontos.length === 0) return resultado;

  // Agrupamento por proximidade TRANSITIVA: um ponto entra no grupo se
  // estiver perto de QUALQUER membro já agrupado, não só do primeiro — senão
  // uma fila de pessoas espaçadas ~2m uma da outra (cada par "colide", mas as
  // pontas estão longe) formaria vários grupos pequenos em vez de um só.
  // O(n²) é aceitável: uma turma de exercício tem dezenas de pessoas, não
  // milhares.
  const visitado = new Set();
  const grupos = [];
  for (const inicial of pontos) {
    if (visitado.has(inicial.id)) continue;
    const grupo = [inicial];
    visitado.add(inicial.id);
    for (let i = 0; i < grupo.length; i++) {
      for (const candidato of pontos) {
        if (visitado.has(candidato.id)) continue;
        if (distanciaM(grupo[i], candidato) < raioColisaoM) {
          grupo.push(candidato);
          visitado.add(candidato.id);
        }
      }
    }
    grupos.push(grupo);
  }

  for (const grupo of grupos) {
    if (grupo.length === 1) {
      resultado.set(grupo[0].id, { lat: grupo[0].lat, lng: grupo[0].lng });
      continue;
    }
    const centro = {
      lat: grupo.reduce((soma, p) => soma + p.lat, 0) / grupo.length,
      lng: grupo.reduce((soma, p) => soma + p.lng, 0) / grupo.length,
    };
    // Ordem ESTÁVEL por id — não pela ordem de chegada dos eventos.
    const ordenado = [...grupo].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    ordenado.forEach((p, i) => {
      const angulo = (2 * Math.PI * i) / ordenado.length;
      resultado.set(p.id, deslocar(centro, raioDispersaoM, angulo));
    });
  }

  return resultado;
}
