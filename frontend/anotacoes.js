// anotacoes.js — a parte PURA das caixas de texto no mapa (2026-09-14).
//
// Sem DOM, sem Leaflet, sem Supabase: só regras sobre o dado. Testável em
// Node (`node frontend/anotacoes.teste.mjs`), no mesmo padrão de paleta.js,
// rastro.js, visada.js e coordenadas.js.
//
// A divisão de três que o projeto usa desde a Etapa 5 vale aqui também:
//   anotacoes.js        — este arquivo: o que é uma anotação válida.
//   anotacoes-banco.js  — a conversa com o Supabase e o Realtime.
//   anotacoes-tela.js   — o desenho no mapa e a interface de edição.
//
// POR QUE A VALIDAÇÃO MORA AQUI E NÃO NO FORMULÁRIO
// --------------------------------------------------
// O `check (length(btrim(texto)) between 1 and 200)` da migration 0013 é a
// barreira real. Esta função existe para o instrutor ver uma frase em
// português ANTES de o banco recusar — e, principalmente, para a mesma regra
// valer nos dois pontos que gravam (criar e editar) sem virar duas cópias que
// divergem. É o critério de sempre do projeto: a segunda cópia de uma regra é
// a que erra em silêncio.

// Mesmo número do `check` da 0013. Repetido aqui de propósito, com o teste
// garantindo que os dois lados falam do mesmo limite: o cliente precisa saber
// o teto para desenhar o contador de caracteres, e ir perguntar ao banco a
// cada tecla não é opção.
export const LIMITE_TEXTO = 200;

// O que sobra depois de tirar espaço das pontas — é sobre ISTO que o limite
// vale, e é isto que vai gravado. Normalizar na validação (em vez de deixar
// para quem chama) é o que impede gravar " PC " numa tela e "PC" na outra.
//
// Quebras de linha são preservadas: uma anotação de duas linhas é legítima
// ("Reabastecimento\naté as 14h") e o desenho no mapa respeita isso. O que
// some é só o espaço nas extremidades.
export function normalizarTexto(texto) {
  if (typeof texto !== 'string') return '';
  return texto.replace(/\r\n/g, '\n').trim();
}

// Cor: aceita só `#rrggbb`, que é o formato do `check` da 0013. Devolve a cor
// padrão quando não reconhece, em vez de recusar a anotação inteira — errar a
// cor não é motivo para perder o texto que a pessoa acabou de escrever.
export const COR_PADRAO = '#f5c842';
export function corValidaOuPadrao(cor) {
  return (typeof cor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cor)) ? cor : COR_PADRAO;
}

// Coordenada: o `check` da 0013 é o mesmo de elementos_marcados. Aqui a
// pergunta é outra e mais simples — o clique no mapa sempre dá números
// válidos, então o que esta função pega é o caso de um estado quebrado
// (undefined vindo de um evento que não era de mapa).
function coordenadaValida(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// Devolve { ok: true, valor } pronto para gravar, ou { ok: false, erro } com a
// frase que vai para a tela. Mesmo formato de validarPreset() em paleta.js —
// quem chama já conhece essa forma.
//
// `partidoId` vazio vira `null` e isso NÃO é um erro: nulo é o caso comum
// ("todos veem"), e transformá-lo em recusa obrigaria a escolher uma força
// para escrever um recado geral.
export function validarAnotacao({ texto, latitude, longitude, partidoId, cor } = {}) {
  const limpo = normalizarTexto(texto);

  if (limpo === '') {
    return { ok: false, erro: 'Escreva o texto da anotação.' };
  }
  if (limpo.length > LIMITE_TEXTO) {
    return {
      ok: false,
      erro: `A anotação tem ${limpo.length} caracteres; o limite é ${LIMITE_TEXTO}. `
          + 'Ela é desenhada por cima da carta, e um texto longo tapa o terreno.',
    };
  }
  if (!coordenadaValida(latitude, longitude)) {
    return { ok: false, erro: 'Toque num ponto do mapa para colocar a anotação.' };
  }

  return {
    ok: true,
    valor: {
      texto: limpo,
      latitude,
      longitude,
      partidoId: partidoId || null,
      cor: corValidaOuPadrao(cor),
    },
  };
}

// Resumo de uma linha para a LISTA do painel — o mapa mostra o texto inteiro,
// a lista não pode. Quebra de linha vira espaço (uma lista de uma linha por
// item não comporta texto multilinha), e o corte marca que cortou.
export function resumirTexto(texto, { maximo = 48 } = {}) {
  const limpo = normalizarTexto(texto).replace(/\s*\n\s*/g, ' ');
  if (limpo.length <= maximo) return limpo;
  // `maximo - 1` para a reticência caber DENTRO do limite pedido: quem pede 48
  // quer 48 no total, não 49.
  return `${limpo.slice(0, maximo - 1)}…`;
}

// Quem vê esta anotação, em palavras — para a lista do instrutor e para o
// popup. `partidos` é a lista da turma (buscarPartidosDaTurma).
//
// Diz "todos" para nulo, e não "sem força": em `elementos_marcados` partido
// nulo significa "não identificado", aqui significa "a turma inteira". Usar a
// mesma palavra nos dois lugares para significados opostos seria a armadilha.
export function descreverAlcance(partidoId, partidos = []) {
  if (!partidoId) return 'todos da turma';
  const p = (partidos || []).find((x) => x && x.id === partidoId);
  return p ? `só ${p.nome}` : 'só uma força (removida)';
}
