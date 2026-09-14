// icones.js — Etapa 5 do roadmap: helper de ícone COMPARTILHADO.
//
// Por que este arquivo existe
// ----------------------------
// Até a Etapa 4, gps.js (criarIconeProprio) e colegas.js (criarIconeColega)
// tinham CADA UM a própria função para transformar um SIDC num L.divIcon do
// Leaflet via milsymbol — pequena duplicação deliberada, registrada no
// comentário de colegas.js: "vale reconsiderar se aparecer um terceiro
// consumidor (ex.: marcação de posição inimiga na Etapa 5)". A marcação de
// elemento no mapa é esse terceiro consumidor, então a duplicação sai daqui
// em vez de virar uma TERCEIRA cópia quase idêntica.
//
// Reúne as duas responsabilidades que os três chamadores (gps.js, colegas.js,
// marcacoes.js) compartilham:
//   1. Resolver a hostilidade relativa ANTES de desenhar, via
//      sidcParaObservador() de simbolos.js. Para o próprio avatar (gps.js),
//      quem chama simplesmente não passa partidoObservador/partidoElemento —
//      ambos ficam `null`, e sidcParaObservador() devolve o SIDC original sem
//      mexer (mesmo comportamento de antes desta extração).
//   2. Montar o L.divIcon a partir do milsymbol, com fallback para um círculo
//      genérico se o SIDC vier inválido — cada chamador só personaliza
//      tamanho, rótulo e cor do fallback.
//
// `ms` e `L` continuam sendo globais carregados pelas tags <script> clássicas
// de index.html (milsymbol e Leaflet via CDN) — mesmo pressuposto de gps.js e
// colegas.js: como este módulo é importado depois delas no HTML, já estão
// disponíveis quando o código roda.
// Etapa 9a: L/ms vinham de <script src=CDN> como globais; agora são import
// de verdade (leaflet/milsymbol pinados em package.json na mesma versão que
// já se usava). `import ms from 'milsymbol'` dá o objeto equivalente ao
// global `ms` de antes — o pacote já registra app6b/std2525b/std2525c/
// app6d/std2525d internamente (ver node_modules/milsymbol/index.js).
import * as L from 'leaflet';
import ms from 'milsymbol';
import { sidcParaObservador } from './simbolos.js';

// ── Etiqueta de idade (2026-09-14) ───────────────────────────────────────
// Todo símbolo desenhado por aqui nasce com um <span> vazio e escondido no
// canto superior direito. Quem tem uma noção de "há quanto tempo" sobre
// aquele símbolo (colegas.js e situacao.js, pela vigia de ausência;
// debriefing.js, pelo estado do replay) escreve nele com
// definirEtiquetaIdade(); quem não tem (gps.js, marcacoes.js) simplesmente
// nunca chama, e o span fica invisível para sempre, sem custo.
//
// Por que o span nasce SEMPRE, mesmo para quem nunca vai usar: a alternativa
// seria recriar o L.divIcon inteiro a cada mudança de idade (marker.setIcon()
// a cada 15s × 60 alunos), o que joga fora e reconstrói o SVG do milsymbol
// sem nenhuma necessidade — o desenho não mudou, só o texto ao lado. Com o
// span já no DOM, atualizar é uma escrita em textContent.
//
// Duas cores, e elas são o que sobrou da distinção que a opacidade fazia:
// âmbar para "atrasado" (passou de AVISO_PARADO_MS) e vermelho para "sem
// sinal" (passou de SEM_SINAL_MS). Os limiares continuam morando em
// vigia-ausencia.js — este módulo não os conhece, só recebe o texto e o
// booleano já decididos, para não virar uma segunda fonte dos números.
const CLASSE_ENVOLTORIO = 'wt-simbolo';
const CLASSE_ETIQUETA = 'wt-idade';
let estilosInjetados = false;

function injetarEstilos() {
  if (estilosInjetados || typeof document === 'undefined') return;
  estilosInjetados = true;
  const estilo = document.createElement('style');
  estilo.textContent = `
.${CLASSE_ENVOLTORIO} { position: relative; line-height: 0; }
.${CLASSE_ENVOLTORIO} > .${CLASSE_ETIQUETA} {
  position: absolute; top: 0; right: 0; transform: translate(40%, -40%);
  padding: 0 4px; border-radius: 7px; border: 1px solid currentColor;
  background: #11202e; color: #f5c842;
  font: 700 10px/1.5 system-ui, -apple-system, sans-serif;
  white-space: nowrap; pointer-events: none;
  box-shadow: 0 1px 3px rgba(0,0,0,.7);
}
.${CLASSE_ENVOLTORIO} > .${CLASSE_ETIQUETA}.sem-sinal { color: #ff7b7b; }
.${CLASSE_ENVOLTORIO} > .${CLASSE_ETIQUETA}[hidden] { display: none; }
`;
  document.head.appendChild(estilo);
}

function envolver(html, largura, altura) {
  const dimensao = largura && altura ? `width:${largura}px;height:${altura}px` : '';
  return `<div class="${CLASSE_ENVOLTORIO}" style="${dimensao}">${html}` +
    `<span class="${CLASSE_ETIQUETA}" hidden></span></div>`;
}

// Escreve (ou apaga) a etiqueta de idade de um marcador já desenhado, sem
// reconstruir o ícone. Texto vazio esconde a etiqueta.
//
// Silenciosamente não faz nada quando o marcador ainda não está no mapa
// (getElement() devolve undefined antes de onAdd) ou quando o ícone veio de
// outro caminho que não este módulo — é um enfeite, nunca pode derrubar o
// desenho de uma posição.
export function definirEtiquetaIdade(marker, texto, { semSinal = false } = {}) {
  const alvo = marker?.getElement?.()?.querySelector?.(`.${CLASSE_ETIQUETA}`);
  if (!alvo) return;
  alvo.textContent = texto || '';
  alvo.hidden = !texto;
  alvo.classList.toggle('sem-sinal', Boolean(texto) && semSinal);
}

// sidc: SIDC de 20 dígitos gravado (com placeholder de hostilidade, se vier
// de elementos_marcados ou de posicoes/perfis de colega).
// Opções (todas opcionais):
//   partidoObservador, partidoElemento — par que decide a hostilidade
//     relativa (ver hostilidadeRelativa em simbolos.js). Deixe os dois `null`
//     quando não houver relação a derivar (ex.: o próprio avatar).
//   tamanho            — px do símbolo milsymbol (padrão 28).
//   designacao         — rótulo (uniqueDesignation) mostrado junto ao símbolo.
//   corFallback        — cor do círculo genérico se o SIDC for inválido.
//   tamanhoFallback    — px do círculo genérico.
// O SVG do símbolo, cru, para desenhar FORA do mapa: o botão da paleta de
// ícones rápidos (paleta-tela.js) e a prévia do painel do instrutor
// (instrutor-paleta.js). São os dois consumidores que justificam a extração
// agora, pelo mesmo critério que criou este arquivo na Etapa 5 — e sem ela
// cada tela chamaria `new ms.Symbol(...)` por conta própria, que é como uma
// delas acaba esquecendo o try/catch e quebrando o painel inteiro com um SIDC
// ruim vindo do banco.
//
// Devolve '' quando o SIDC é inválido: quem chama decide o que pôr no lugar
// (um traço, o rótulo sozinho), porque aqui não há mapa nem âncora para um
// ícone genérico fazer sentido.
export function svgDoSimbolo(sidc, { tamanho = 32 } = {}) {
  try {
    return new ms.Symbol(sidc, { size: tamanho }).asSVG();
  } catch (e) {
    console.warn('SIDC inválido ao desenhar fora do mapa:', sidc, e);
    return '';
  }
}

export function criarIconeSimbolo(sidc, {
  partidoObservador = null,
  partidoElemento   = null,
  tamanho           = 28,
  designacao        = '',
  corFallback       = '#4a90d9',
  tamanhoFallback   = 22,
} = {}) {
  injetarEstilos();
  const sidcFinal = sidcParaObservador(sidc, partidoObservador, partidoElemento);
  try {
    const sym = new ms.Symbol(sidcFinal, {
      size: tamanho,
      uniqueDesignation: designacao || '',
    });
    const anchor = sym.getAnchor();
    const size = sym.getSize();
    // O envoltório tem exatamente as dimensões que o milsymbol reportou e o
    // SVG continua na origem dele, então iconSize/iconAnchor seguem valendo
    // o mesmo de antes — a etiqueta é `position:absolute` e não ocupa espaço
    // no fluxo, justamente para não deslocar o símbolo em relação ao ponto
    // geográfico que ele marca.
    return L.divIcon({
      html: envolver(sym.asSVG(), size.width, size.height),
      className: '',
      iconSize: [size.width, size.height],
      iconAnchor: [anchor.x, anchor.y],
    });
  } catch (e) {
    console.warn('SIDC inválido, usando ícone genérico:', sidcFinal, e);
    const circulo = `<div style="background:${corFallback};width:${tamanhoFallback}px;height:${tamanhoFallback}px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 4px #000"></div>`;
    return L.divIcon({
      html: envolver(circulo, tamanhoFallback, tamanhoFallback),
      className: '',
      iconSize: [tamanhoFallback, tamanhoFallback],
      iconAnchor: [tamanhoFallback / 2, tamanhoFallback / 2],
    });
  }
}
