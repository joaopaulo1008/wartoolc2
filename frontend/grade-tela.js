// grade-tela.js — desenha a quadrícula que grade.js descreve.
//
// A divisão com grade.js
// ----------------------
// `grade.js` responde QUAIS linhas existem, por onde passam em lat/lon e que
// rótulo levam — aritmética pura, testada em Node. Este arquivo responde ONDE
// NA TELA isso cai: converte para pixel, põe as polilinhas numa pane própria
// e encosta os rótulos nas margens. Mesma divisão de `coordenadas.js` /
// `preferencias.js` e de `toque-longo.js` / `menu-contexto.js`.
//
// ── A pane, e por que ela fica ABAIXO dos símbolos ────────────────────────
// A quadrícula é parte da CARTA, não da situação tática. Numa carta de papel
// ela está impressa debaixo de tudo que se desenha em cima — e é assim que se
// lê: a grade não disputa atenção com o símbolo, ela localiza o símbolo. Daí
// `zIndex: 350`: acima dos tiles (200) e abaixo do overlayPane (400, onde
// moram os calcos KML) e do markerPane (600, os símbolos).
//
// Consequência declarada: um polígono de calco com preenchimento opaco cobre
// a grade naquele pedaço. É o comportamento certo (o calco é informação mais
// recente que a carta), mas é bom saber antes de achar que a grade falhou.
//
// ── Redesenho em moveend/zoomend, nunca por quadro ───────────────────────
// Arrastar o mapa dispara `move` dezenas de vezes por segundo. Recalcular a
// grade a cada um deles significaria rodar o UTM inverso algumas centenas de
// vezes por arrasto, num celular. Então a grade é redesenhada quando o
// movimento TERMINA — ela some durante o arrasto e volta no lugar certo. É a
// mesma escolha que `marcacoes.js` fez ao calcular o vetor na abertura do
// popup, e não a cada leitura de GPS.
import * as L from 'leaflet';
import { grade } from './grade.js';
import { observarModoGrade } from './preferencias.js';

const PANE = 'gradePane';
const CLASSE_ROTULO = 'grd-rotulo';
const CLASSE_LEGENDA = 'grd-legenda';

// Preto a 35% com 1 px: foi o que se mostrou legível TANTO sobre o OSM
// (claro) quanto sobre imagem de satélite (meio-tom). Branco desaparece no
// OSM; a cor âmbar do projeto já significa "atenção" em todo o resto da
// interface e aqui seria ruído permanente.
//
// `pane` vai em CADA polilinha, e não só no L.layerGroup. Descoberto em
// navegador, em 2026-10-02: `L.layerGroup([], { pane })` NÃO propaga a pane
// para as camadas filhas, então as linhas caíam na `overlayPane` padrão —
// acima dos calcos KML, exatamente o contrário da decisão documentada no topo
// deste arquivo. O comentário estava certo e o código não o cumpria; só o
// teste em navegador mostrou, porque a grade aparecia bonita do mesmo jeito.
const ESTILO_LINHA = {
  pane: PANE, color: '#000000', weight: 1, opacity: 0.35, interactive: false,
};

let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados || typeof document === 'undefined') return;
  estilosInjetados = true;
  const s = document.createElement('style');
  s.textContent = `
    .${CLASSE_ROTULO} {
      position: absolute; z-index: 420; pointer-events: none;
      font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums;
      color: #0d1b2a; background: rgba(255,255,255,.82);
      padding: 0 3px; border-radius: 2px; line-height: 1.5;
      transform: translate(-50%, 0);
    }
    .${CLASSE_ROTULO}.grd-lat { transform: translate(0, -50%); }
    .${CLASSE_LEGENDA} {
      position: absolute; z-index: 420; pointer-events: none;
      /* 20px, e não 8: a atribuição do Leaflet mora no canto inferior
         direito, e a legenda montava em cima dela. Visto em captura de tela,
         não deduzido. */
      right: 8px; bottom: 20px; max-width: 60vw;
      font-size: 10px; line-height: 1.45; color: #e8eaf0;
      background: rgba(13,27,42,.78); border: 1px solid #2a4a6b;
      border-radius: 4px; padding: 3px 7px;
      font-variant-numeric: tabular-nums;
    }
    .${CLASSE_LEGENDA} b { color: #f5f7fa; font-weight: 600; }
    /* O aviso de fuso cruzado NÃO é decoração: ver o comentário em
       desenhar(), sobre por que ele existe. */
    .${CLASSE_LEGENDA} .grd-aviso { color: #f5c842; }
  `;
  document.head.appendChild(s);
}

export function ligarGrade({ map } = {}) {
  if (!map) return () => {};
  injetarEstilos();

  map.createPane(PANE);
  map.getPane(PANE).style.zIndex = '350';
  // Sem isto o pane captura clique e o toque no mapa pararia de marcar.
  map.getPane(PANE).style.pointerEvents = 'none';

  const camada = L.layerGroup([], { pane: PANE }).addTo(map);
  const container = map.getContainer();
  const caixaRotulos = document.createElement('div');
  caixaRotulos.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:420';
  container.appendChild(caixaRotulos);

  let modo = 'off';

  function limpar() {
    camada.clearLayers();
    caixaRotulos.textContent = '';
  }

  function rotulo(texto, x, y, classeExtra) {
    const d = document.createElement('div');
    d.className = CLASSE_ROTULO + (classeExtra ? ` ${classeExtra}` : '');
    d.textContent = texto;
    d.style.left = `${Math.round(x)}px`;
    d.style.top = `${Math.round(y)}px`;
    caixaRotulos.appendChild(d);
  }

  function desenhar() {
    limpar();
    if (modo === 'off') return;

    const b = map.getBounds();
    const g = grade({
      modo,
      limites: { sul: b.getSouth(), oeste: b.getWest(), norte: b.getNorth(), leste: b.getEast() },
      larguraPx: container.clientWidth,
    });
    if (!g.linhas.length) return;

    const largura = container.clientWidth;
    const altura = container.clientHeight;
    const MARGEM = 2;
    // Medidos do controle de zoom padrão do Leaflet (10px de topo + ~58px de
    // altura dos dois botões, mais folga).
    const ALTURA_CONTROLE_ZOOM = 78;
    const X_DESVIO_ZOOM = 46;

    for (const linha of g.linhas) {
      camada.addLayer(L.polyline(linha.pontos, ESTILO_LINHA));
      if (!linha.rotulo) continue;

      // Onde a linha encosta na margem. As linhas vêm de grade.js ordenadas:
      // as de este/longitude do sul para o norte, as de norte/latitude do
      // oeste para o leste. Então o último vértice de uma e o primeiro da
      // outra são exatamente os pontos de margem — nada de procurar.
      const vertical = linha.eixo === 'E' || linha.eixo === 'lon';
      const [lat, lon] = vertical
        ? linha.pontos[linha.pontos.length - 1]
        : linha.pontos[0];
      const p = map.latLngToContainerPoint(L.latLng(lat, lon));

      if (vertical) {
        // Rótulo na margem de CIMA. Fora da tela não se desenha: um rótulo
        // grudado na borda, de uma linha que não está ali, é pior que nenhum.
        if (p.x < -20 || p.x > largura + 20) continue;
        rotulo(linha.rotulo, Math.max(12, Math.min(largura - 12, p.x)), MARGEM);
      } else {
        if (p.y < -20 || p.y > altura + 20) continue;
        // O controle de zoom do Leaflet ocupa o canto superior esquerdo. Um
        // rótulo de norte que caia ali fica ATRÁS dos botões — some sem
        // explicação, que é o defeito que este projeto evita em toda parte.
        // Então ele se afasta para a direita dos botões em vez de sumir.
        const y = Math.max(8, Math.min(altura - 8, p.y));
        rotulo(linha.rotulo, y < ALTURA_CONTROLE_ZOOM ? X_DESVIO_ZOOM : MARGEM, y, 'grd-lat');
      }
    }

    // ── A legenda do canto ────────────────────────────────────────────────
    // Os dois dígitos do rótulo não localizam nada sozinhos: "84" repete a
    // cada 100 km. Quem localiza é zona + banda + o passo em vigor, e é isso
    // que a legenda carrega — como a margem de uma carta carrega.
    const leg = document.createElement('div');
    leg.className = CLASSE_LEGENDA;
    if (g.modo === 'utm') {
      leg.innerHTML = `Quadrícula <b>${g.rotuloPasso}</b> · zona <b>${g.zona}${g.banda}</b>`;
      // Aviso de fuso cruzado. Ele existe porque a grade continua sendo de UMA
      // zona (extensão de zona, ver `paraUtm`), e sem dizer isso alguém leria
      // na metade direita da tela um valor de este da zona da esquerda — e o
      // número continua plausível. É a mesma família de defeito que o
      // vazamento entre forças: não parece erro, parece informação.
      if (g.cruzaZona) {
        leg.innerHTML += `<br><span class="grd-aviso">a tela cruza para o fuso vizinho; ` +
                         `a quadrícula é toda da zona ${g.zona}</span>`;
      }
    } else {
      leg.innerHTML = `Grade geográfica <b>${g.rotuloPasso}</b>`;
    }
    caixaRotulos.appendChild(leg);
  }

  const aoMudarVista = () => desenhar();
  map.on('moveend', aoMudarVista);
  map.on('zoomend', aoMudarVista);
  map.on('resize', aoMudarVista);
  // Durante o arrasto a grade sai de cena: ver o comentário no topo. Deixá-la
  // parada enquanto o mapa anda seria pior que escondê-la — ela estaria no
  // lugar errado, afirmando coordenada errada.
  map.on('movestart', limpar);
  map.on('zoomstart', limpar);

  const desligarPref = observarModoGrade((valor) => {
    modo = valor;
    desenhar();
  });

  return () => {
    desligarPref();
    map.off('moveend', aoMudarVista);
    map.off('zoomend', aoMudarVista);
    map.off('resize', aoMudarVista);
    map.off('movestart', limpar);
    map.off('zoomstart', limpar);
    limpar();
    map.removeLayer(camada);
    caixaRotulos.remove();
  };
}
