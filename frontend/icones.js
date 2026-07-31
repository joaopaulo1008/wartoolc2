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
import { sidcParaObservador } from './simbolos.js';

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
export function criarIconeSimbolo(sidc, {
  partidoObservador = null,
  partidoElemento   = null,
  tamanho           = 28,
  designacao        = '',
  corFallback       = '#4a90d9',
  tamanhoFallback   = 22,
} = {}) {
  const sidcFinal = sidcParaObservador(sidc, partidoObservador, partidoElemento);
  try {
    const sym = new ms.Symbol(sidcFinal, {
      size: tamanho,
      uniqueDesignation: designacao || '',
    });
    const anchor = sym.getAnchor();
    const size = sym.getSize();
    return L.divIcon({
      html: sym.asSVG(),
      className: '',
      iconSize: [size.width, size.height],
      iconAnchor: [anchor.x, anchor.y],
    });
  } catch (e) {
    console.warn('SIDC inválido, usando ícone genérico:', sidcFinal, e);
    return L.divIcon({
      html: `<div style="background:${corFallback};width:${tamanhoFallback}px;height:${tamanhoFallback}px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 4px #000"></div>`,
      className: '',
      iconSize: [tamanhoFallback, tamanhoFallback],
      iconAnchor: [tamanhoFallback / 2, tamanhoFallback / 2],
    });
  }
}
