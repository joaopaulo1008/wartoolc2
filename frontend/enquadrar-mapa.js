// enquadrar-mapa.js — onde o mapa deve abrir (2026-09-15).
//
// Puro: recebe pontos, devolve um PLANO. Sem Leaflet, sem DOM — testável em
// Node (`node frontend/enquadrar-mapa.teste.mjs`), no padrão de rastro.js,
// visada.js, coordenadas.js e anotacoes.js.
//
// POR QUE ISTO VIROU UM MÓDULO
// -----------------------------
// `center: [-22, -47]` estava escrito à mão em QUATRO mapas (index.html,
// situacao.js, debriefing.js e o mapinha de imagem georreferenciada em
// instrutor-calcos.js). É um ponto arbitrário perto de
// Campinas, escolhido um dia como "algum lugar do Brasil" — para uma turma em
// Ponta Grossa, no Pantanal ou na Amazônia, o app abre a centenas de
// quilômetros de onde a instrução acontece, e quem abre acha que está
// quebrado.
//
// O padrão continua existindo (é o que fica na tela nos segundos antes de
// chegar a primeira posição), mas agora tem nome, um lugar só, e é substituído
// assim que se sabe onde as pessoas estão.
//
// O CASO QUE JUSTIFICA UMA FUNÇÃO EM VEZ DE UM `fitBounds` DIRETO
// ----------------------------------------------------------------
// `fitBounds` com todos os pontos no MESMO lugar produz uma caixa de área
// zero, e o Leaflet responde com o zoom máximo — a tela vira um quadrado de
// 20 metros. E esse não é um caso raro: é exatamente a formatura no início do
// exercício, com a turma inteira parada no mesmo pátio, dentro do erro do GPS.
// Por isso "todos praticamente no mesmo ponto" é uma resposta DIFERENTE de
// "pontos espalhados", e é isso que esta função decide.

// Onde o mapa abre enquanto não se sabe nada. Mantido igual ao que estava
// escrito nos três arquivos, para esta mudança não alterar o comportamento de
// quem abre o app sem nenhuma posição disponível.
export const CENTRO_PADRAO = [-22, -47];
export const ZOOM_PADRAO = 10;

// Zoom para "uma pessoa só" e para "todo mundo no mesmo lugar". 15 mostra o
// quarteirão/pátio em volta — perto o bastante para ser útil, longe o bastante
// para não parecer que o mapa travou.
export const ZOOM_PONTO = 15;

// Abaixo disto, os pontos são "o mesmo lugar" para efeito de enquadramento.
// 0,0005° ≈ 55 m em latitude: maior que o erro típico de um GPS de celular
// (5-15 m) e menor que qualquer dispersão tática real. Não precisa ser
// exato — precisa separar "formatura no pátio" de "duas frações em eixos
// diferentes".
export const TOLERANCIA_MESMO_PONTO = 0.0005;

function valido(p) {
  return p
    && Number.isFinite(p.lat) && Number.isFinite(p.lon)
    && p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180;
}

// Devolve:
//   null                                   — não há o que enquadrar.
//   { tipo:'ponto', lat, lon, zoom }       — um ponto só, ou todos juntos.
//   { tipo:'area', sul, oeste, norte, leste } — pontos espalhados.
//
// Quem chama traduz para `setView`/`fitBounds`. Esta função não conhece
// Leaflet de propósito: é o que a deixa testável sem navegador.
export function planejarEnquadramento(pontos, { zoomPonto = ZOOM_PONTO } = {}) {
  const bons = (Array.isArray(pontos) ? pontos : []).filter(valido);
  if (bons.length === 0) return null;

  let sul = bons[0].lat, norte = bons[0].lat;
  let oeste = bons[0].lon, leste = bons[0].lon;
  for (const p of bons) {
    if (p.lat < sul) sul = p.lat;
    if (p.lat > norte) norte = p.lat;
    if (p.lon < oeste) oeste = p.lon;
    if (p.lon > leste) leste = p.lon;
  }

  // Caixa degenerada (um ponto, ou a turma toda no mesmo pátio): `fitBounds`
  // daria zoom máximo. Ver o comentário do topo.
  if ((norte - sul) < TOLERANCIA_MESMO_PONTO && (leste - oeste) < TOLERANCIA_MESMO_PONTO) {
    return {
      tipo: 'ponto',
      lat: (sul + norte) / 2,
      lon: (oeste + leste) / 2,
      zoom: zoomPonto,
    };
  }

  return { tipo: 'area', sul, oeste, norte, leste };
}
