// selo-simulacao.js — o aviso "SIMULAÇÃO" no rodapé.
//
// Por que existe
// --------------
// Numa turma em modo 'manual' ou 'externa' a posição que está no mapa NÃO é a
// do GPS. Quem olha o mapa — o aluno, o instrutor, quem assiste ao debriefing —
// não pode ter como confundir uma coisa com a outra. Mesma ideia do carimbo de
// build (versao.js): tornar VISÍVEL o que de fora não se adivinha.
//
// O texto vem de `rotuloModo()` (fonte-posicao.js, puro e testado); aqui só se
// liga isso ao DOM. Em modo 'gps' o selo fica escondido, e o rodapé é idêntico
// ao de antes.
import { observarModoPosicao } from './modo-posicao.js';
import { rotuloModo } from './fonte-posicao.js';

// Espera, no HTML:
//   <span id="selo-simulacao" hidden><strong id="selo-simulacao-texto"></strong>&nbsp;|&nbsp;</span>
// O separador mora DENTRO do invólucro para sumir junto com o selo — senão o
// rodapé ficaria com um "|" solto em modo gps.
// Silencioso se os elementos não existirem (outras telas não têm rodapé).
export function ligarSeloSimulacao() {
  if (typeof document === 'undefined') return () => {};
  const envolucro = document.getElementById('selo-simulacao');
  const texto = document.getElementById('selo-simulacao-texto');
  if (!envolucro || !texto) return () => {};
  return observarModoPosicao(({ modo }) => {
    const rotulo = rotuloModo(modo);
    texto.textContent = rotulo;
    envolucro.hidden = !rotulo;
  });
}
