// barra-coordenada.js — a coordenada do ponto que a pessoa está olhando,
// escrita no rodapé, do jeito que o Google Earth faz.
//
// Pedido de quem usa. O que ele esconde, e que decidiu o desenho
// -------------------------------------------------------------
// "A coordenada da posição do mouse" não existe em tela de toque: não há
// cursor, e o dedo tapa exatamente o ponto que ele aponta. Então são duas
// interfaces, e a escolha foi feita por quem usa:
//
//   monitor  — a coordenada SEGUE o cursor, como no Google Earth.
//   celular  — uma cruz fina no CENTRO da tela, e a coordenada é a dela. É
//              como se lê carta: põe-se o centro no ponto.
//
// A detecção é por `(hover: hover) and (pointer: fine)`, não por string de
// navegador. User-agent mente, e mente em campo: um tablet com teclado
// acoplado, um celular em "modo desktop", um notebook com tela de toque. A
// media query responde sobre o APARELHO DE ENTRADA que está em uso, que é
// exatamente a pergunta.
//
// ── Sobre a zona UTM aparecer aqui ───────────────────────────────────────
// `formatarUtm()` já começa com a zona ("22J 584368 mE…"), então em UTM a
// zona não é repetida. Nos outros dois formatos (grau decimal e GMS) ela não
// aparece em lugar nenhum — e com o exercício mudando de estado isso deixou
// de ser detalhe: Ponta Grossa/PR é 22J e Rosário do Sul/RS é 21J. Então a
// zona entra como etiqueta própria SÓ quando o formato escolhido não a traz.
//
// ── Throttle ─────────────────────────────────────────────────────────────
// `mousemove` dispara a cada pixel. Formatar em UTM é uma Transversa de
// Mercator por chamada — barato para um ponto, caro centenas de vezes por
// segundo. Então a posição é só guardada no evento, e a escrita acontece uma
// vez por quadro (`requestAnimationFrame`), que é a frequência máxima em que
// alguém poderia enxergar a mudança.
import * as L from 'leaflet';
import { formatarCoordenada, observarFormatoCoordenada, formatoCoordenada } from './preferencias.js';
import { zonaUtm, bandaUtm } from './coordenadas.js';

const CLASSE_CRUZ = 'brc-cruz';

// Monitor com mouse de verdade? `matchMedia` pode não existir em ambiente
// sem DOM (um teste em Node importando este arquivo), daí a guarda.
function ponteiroFino() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados || typeof document === 'undefined') return;
  estilosInjetados = true;
  const s = document.createElement('style');
  s.textContent = `
    #barra-coordenada {
      font-variant-numeric: tabular-nums; color: #EADFBE; white-space: nowrap;
    }
    #barra-coordenada .brc-zona { color: #A9A584; }
    #barra-coordenada .brc-vazio { color: #7A7C5C; }
    /* A cruz do centro, só em tela de toque. Fina de propósito: ela marca um
       ponto, não chama atenção. Duas linhas com contorno claro para ser
       visível tanto sobre o OSM quanto sobre imagem de satélite. */
    .${CLASSE_CRUZ} {
      position: absolute; left: 50%; top: 50%; z-index: 430;
      width: 26px; height: 26px; margin: -13px 0 0 -13px;
      pointer-events: none;
    }
    .${CLASSE_CRUZ}::before, .${CLASSE_CRUZ}::after {
      content: ''; position: absolute; background: #1E2616;
      box-shadow: 0 0 0 1px rgba(255,255,255,.75);
    }
    .${CLASSE_CRUZ}::before { left: 50%; top: 0; width: 1px; height: 100%; margin-left: -.5px; }
    .${CLASSE_CRUZ}::after  { top: 50%; left: 0; height: 1px; width: 100%; margin-top: -.5px; }
  `;
  document.head.appendChild(s);
}

// map: instância do Leaflet (mesmo padrão de `map` explícito dos outros
//      módulos — nunca lido como global)
// alvo: o nó onde escrever. Se não vier, procura #barra-coordenada.
//
// Devolve a função que desliga tudo.
export function ligarBarraCoordenada({ map, alvo } = {}) {
  if (!map) return () => {};
  injetarEstilos();

  const el = alvo || document.getElementById('barra-coordenada');
  if (!el) return () => {};

  const segueCursor = ponteiroFino();
  const container = map.getContainer();
  let cruz = null;
  if (!segueCursor) {
    cruz = document.createElement('div');
    cruz.className = CLASSE_CRUZ;
    container.appendChild(cruz);
  }

  let ponto = null;          // L.LatLng ou null
  let quadroPendente = null;

  function escrever() {
    quadroPendente = null;
    if (!ponto) {
      // Lacuna DECLARADA, não silenciosa — a mesma regra do vetor "Do meu
      // posto" e do menu de toque longo: um espaço em branco no rodapé é
      // indistinguível de "esta funcionalidade sumiu".
      el.innerHTML = '<span class="brc-vazio">passe o cursor sobre o mapa</span>';
      return;
    }
    const texto = formatarCoordenada(ponto.lat, ponto.lng);
    // Ver o comentário sobre a zona no topo: em UTM ela já vem no texto.
    if (formatoCoordenada() === 'utm') {
      el.textContent = texto;
      return;
    }
    const z = zonaUtm(ponto.lat, ponto.lng);
    const etiqueta = z ? `${z}${bandaUtm(ponto.lat)}` : '';
    // O separador é caractere de verdade, com espaço INQUEBRÁVEL dos dois
    // lados — não margem de CSS. Quem copia a linha do rodapé leva
    // "21J · -30.25, -54.91"; com margem de CSS levaria "21J-30.25...", e
    // foi assim que saiu na primeira medição em navegador.
    el.innerHTML = etiqueta
      ? `<span class="brc-zona">${etiqueta}</span>&nbsp;·&nbsp;${texto}`
      : texto;
  }

  function agendar() {
    if (quadroPendente !== null) return;
    quadroPendente = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame(escrever)
      : setTimeout(escrever, 16);
  }

  function definir(p) {
    ponto = p;
    agendar();
  }

  const aoMover = (ev) => definir(ev.latlng);
  const aoSair = () => definir(null);
  const aoCentro = () => definir(map.getCenter());

  if (segueCursor) {
    map.on('mousemove', aoMover);
    map.on('mouseout', aoSair);
    escrever();  // o estado inicial é a lacuna declarada, e ela aparece de cara
  } else {
    // Em tela de toque a coordenada é a do centro, e ela muda com o mapa.
    // `move` (não `moveend`) de propósito: aqui o número ACOMPANHANDO o
    // arrasto é o comportamento desejado — é o que faz a cruz servir para
    // procurar um ponto. O custo está contido pelo throttle de um quadro.
    map.on('move', aoCentro);
    map.on('zoom', aoCentro);
    aoCentro();
  }

  // Trocar o formato no painel tem que valer NA HORA, sem recarregar — mesma
  // exigência dos popups desde a Etapa 9b.
  const desligarFormato = observarFormatoCoordenada(() => agendar());

  return () => {
    desligarFormato();
    if (segueCursor) {
      map.off('mousemove', aoMover);
      map.off('mouseout', aoSair);
    } else {
      map.off('move', aoCentro);
      map.off('zoom', aoCentro);
    }
    if (quadroPendente !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(quadroPendente);
      else clearTimeout(quadroPendente);
    }
    if (cruz) cruz.remove();
  };
}
