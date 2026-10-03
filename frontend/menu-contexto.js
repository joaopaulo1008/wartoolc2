// menu-contexto.js — o menu do TOQUE LONGO no mapa.
//
// O que ele é
// -----------
// Toque curto no mapa abre o formulário de marcação (marcacoes.js), e sempre
// foi assim. O toque longo passou a abrir um menu pequeno no ponto tocado, com
// as coisas que a pessoa quer saber DAQUELE ponto sem necessariamente marcar
// nada:
//
//   1. Marcar elemento aqui   — o mesmo que o toque curto
//   2. A coordenada do ponto  — no formato que ela escolheu (preferencias.js)
//   3. A visada do posto dela até ali — distância e lançamento de quadrícula
//
// As duas últimas **já vêm lidas no menu**, não são telas que se abrem: o
// valor está escrito na linha, e tocar nela copia. Foi o que tornou a entrega
// barata — o trabalho que parecia ser "duas telas novas" é uma linha de texto
// cada, porque as contas já existiam (`visada.js` desde 2026-08-02,
// `preferencias.js` desde a 9b).
//
// ── "Marcar elemento aqui" é o ÚNICO caminho desde 2026-10-02 ────────────
// Nasceu como sinônimo do toque curto, servindo de saída para quem abrisse o
// menu sem querer. Deixou de ser sinônimo: **o toque curto não cria mais
// marcação** (ver o comentário de `ativarCliqueNoMapa` em marcacoes.js), a
// pedido de quem usa — tocar na tela para apontar algo, ou para começar um
// arrasto, abria formulário sozinho.
//
// Então esta entrada passou de conveniência a porta principal, e isso é o que
// simplifica a explicação em vez de complicar: toque curto inspeciona, toque
// longo age. O formulário que ela abre é o completo — fileira de presets no
// topo, catálogo inteiro embaixo —, porque nunca houve outro.
//
// ── Por que não é um L.popup ──────────────────────────────────────────────
// Seria o caminho óbvio, e está errado por dois motivos: o popup do Leaflet é
// único por mapa (abrir este FECHARIA o popup da marcação que a pessoa
// estivesse lendo, e vice-versa), e ele entra na mesma fila de cliques que o
// bug de 2026-08-01 criou. Um <div> posicionado à mão dentro do contêiner do
// mapa não disputa nada com ninguém.
//
// ── A fila de cliques ─────────────────────────────────────────────────────
// O toque longo dispara com o dedo AINDA na tela; o `click` do Leaflet vem
// depois, no pointerup, e abriria o formulário de marcação por baixo do menu.
// A solução não é nova: `suspenderClique()`/`retomarClique()` de marcacoes.js,
// a mesma convenção que offline-tela.js usa desde 2026-08-01. Foi por causa
// deste segundo consumidor que ela virou contador em vez de booleano — ver o
// comentário lá.
import * as L from 'leaflet';
import { ligarToqueLongo } from './toque-longo.js';
import {
  abrirMarcacaoEm, podeMarcarAqui,
  suspenderClique, retomarClique, cliqueEstaSuspenso,
} from './marcacoes.js';
import { formatarCoordenada } from './preferencias.js';
import { visada, formatarVisada } from './visada.js';

const CLASSE = 'mctx';

// Onde o dedo NÃO abre o menu. Marcador, popup e controle já têm significado
// próprio para o toque; o `.mctx` é o próprio menu, para um toque dentro dele
// não armar um segundo gesto por baixo.
const IGNORAR = '.leaflet-marker-icon, .leaflet-popup, .leaflet-control, .' + CLASSE;

let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados || typeof document === 'undefined') return;
  estilosInjetados = true;
  const s = document.createElement('style');
  s.textContent = `
    .${CLASSE} {
      position: absolute; z-index: 1200; min-width: 208px; max-width: 74vw;
      background: #1E2616; border: 1px solid #4B5A2E; border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0,0,0,.5); overflow: hidden;
      font-size: 12px; color: #e8eaf0; -webkit-tap-highlight-color: transparent;
    }
    .${CLASSE}-item {
      display: block; width: 100%; text-align: left; background: none; border: 0;
      border-bottom: 1px solid #252F1A; color: inherit; font: inherit;
      /* 44px é o mínimo de alvo de toque; com duas linhas passa disso. */
      min-height: 44px; padding: 8px 12px; cursor: pointer;
    }
    .${CLASSE}-item:last-child { border-bottom: 0; }
    .${CLASSE}-item:active { background: #2D3822; }
    .${CLASSE}-item:disabled { cursor: default; opacity: .6; }
    .${CLASSE}-rot { display: block; color: #EADFBE; }
    .${CLASSE}-val {
      display: block; margin-top: 2px; color: #f5f7fa;
      font-variant-numeric: tabular-nums; word-break: break-word;
    }
    /* A lacuna DECLARADA: quando não há posto, a linha continua e diz por quê.
       Mesma regra do vetor no popup da marcação (2026-09-14) — some é
       indistinguível de "a função foi removida". */
    .${CLASSE}-ausente .${CLASSE}-val { color: #B5B096; font-style: italic; }
  `;
  document.head.appendChild(s);
}

let aberto = null;   // { el, fechar }

function fechar() {
  if (!aberto) return;
  const { el } = aberto;
  aberto = null;
  el.remove();
  // O clique que FECHOU o menu ainda está a caminho do Leaflet. Soltar a
  // suspensão na próxima volta do laço é o que impede esse clique de virar um
  // formulário de marcação no ponto em que a pessoa tocou só para sair daqui.
  setTimeout(retomarClique, 0);
}

// Uma linha do menu. `valor` já vem pronto (é leitura, não cálculo);
// `aoTocar` é opcional — sem ela a linha é só informação.
function linha(rotulo, valor, { aoTocar, desabilitado, ausente } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${CLASSE}-item${ausente ? ` ${CLASSE}-ausente` : ''}`;
  b.disabled = !!desabilitado;
  const r = document.createElement('span');
  r.className = `${CLASSE}-rot`;
  r.textContent = rotulo;
  b.appendChild(r);
  if (valor) {
    const v = document.createElement('span');
    v.className = `${CLASSE}-val`;
    v.textContent = valor;
    b.appendChild(v);
  }
  if (aoTocar && !desabilitado) {
    b.addEventListener('click', (ev) => { ev.stopPropagation(); aoTocar(b, v0(b)); });
  }
  return b;
}
const v0 = (b) => b.querySelector(`.${CLASSE}-val`);

// Copiar depende de HTTPS e de um gesto do usuário — as duas condições valem
// aqui. Quando mesmo assim falhar (navegador antigo, permissão negada), o
// valor CONTINUA legível na tela: era para isso que ele estava escrito na
// linha, e não escondido atrás do toque.
async function copiar(texto, alvoValor, textoOriginal) {
  try {
    await navigator.clipboard.writeText(texto);
    if (alvoValor) {
      alvoValor.textContent = `${textoOriginal}  ✓ copiado`;
      setTimeout(() => { if (alvoValor.isConnected) alvoValor.textContent = textoOriginal; }, 1400);
    }
  } catch {
    if (alvoValor) {
      alvoValor.textContent = `${textoOriginal}  (copie à mão)`;
      setTimeout(() => { if (alvoValor.isConnected) alvoValor.textContent = textoOriginal; }, 2200);
    }
  }
}

function abrir(map, latlng, ponto, { obterPosto, obterPosicionamento }) {
  fechar();
  injetarEstilos();

  const el = document.createElement('div');
  el.className = CLASSE;

  // 1. Marcar. A permissão e a lotação são decididas por marcacoes.js — este
  //    módulo não tem opinião própria sobre quem pode criar marcação.
  const r = podeMarcarAqui();
  // A recusa fica ESCRITA na linha, em vez de a linha sumir. É a regra que
  // custou uma sessão de investigação em 2026-09-14, quando a linha do vetor
  // sumia em silêncio e o relato de campo foi "não há mais informações sobre
  // o lançamento", com o código intacto: uma lacuna declarada é informação,
  // uma lacuna silenciosa é uma afirmação errada.
  el.appendChild(linha('Marcar elemento aqui',
    r.permitido ? '' : (r.motivo || 'um formulário já está aberto'),
    {
      desabilitado: !r.permitido,
      ausente: !r.permitido,
      aoTocar: () => { const ll = latlng; fechar(); abrirMarcacaoEm(ll); },
    },
  ));

  // 2. Posicionar-me aqui — SÓ em simulação (turma em modo 'manual'). Em
  //    exercício com GPS a linha não aparece: ali ela não faltou, ela não se
  //    aplica, e uma linha desligada em todo exercício real seria só ruído.
  //    O que decide é perguntado AQUI, ao abrir o menu, e não guardado: se o
  //    instrutor trocar o modo, o próximo menu já reflete. Quando o instrutor
  //    desligou o envio de posição a linha aparece desabilitada e diz por quê.
  const posicionamento = obterPosicionamento ? obterPosicionamento() : null;
  if (posicionamento) {
    el.appendChild(linha('Posicionar-me aqui',
      posicionamento.desabilitado
        ? (posicionamento.motivo || 'indisponível agora')
        : 'simulação — define a posição do meu posto',
      {
        desabilitado: posicionamento.desabilitado,
        ausente: posicionamento.desabilitado,
        aoTocar: () => { const ll = latlng; fechar(); posicionamento.aoPosicionar(ll); },
      },
    ));
  }

  // 3. Coordenada, no formato escolhido pela pessoa.
  const coord = formatarCoordenada(latlng.lat, latlng.lng);
  el.appendChild(linha('Coordenada', coord, {
    aoTocar: (_b, v) => copiar(coord, v, coord),
  }));

  // 4. Visada do posto até aqui. Mesmo par de funções do popup da marcação, e
  //    o mesmo "qd" ao fim: o lançamento é de QUADRÍCULA. Um segundo caminho
  //    de cálculo aqui seria a forma mais fácil de um dia os dois discordarem.
  const posto = obterPosto ? obterPosto() : null;
  const temPosto = posto && Number.isFinite(posto.lat) && Number.isFinite(posto.lon);
  const rotuloPosto = `${(posto && posto.rotulo) || 'Do meu posto'} até aqui`;
  if (temPosto) {
    const v = visada({ lat: posto.lat, lon: posto.lon }, { lat: latlng.lat, lon: latlng.lng });
    const txt = formatarVisada(v);
    el.appendChild(linha(rotuloPosto, txt, { aoTocar: (_b, alvo) => copiar(txt, alvo, txt) }));
  } else if (posto) {
    el.appendChild(linha(rotuloPosto, `— ${posto.motivo || 'sem posição própria'}`,
      { desabilitado: true, ausente: true }));
  }
  // Sem hook nenhum (o painel do instrutor), a linha não aparece: ali ela não
  // faltou, ela não se aplica. Mesma regra do popup da marcação.

  const container = map.getContainer();
  container.appendChild(el);

  // Posicionamento: encosta no ponto tocado, mas nunca sai do mapa. Medido
  // depois de inserido, porque a altura depende de quantas linhas entraram.
  const cx = container.clientWidth, cy = container.clientHeight;
  const larg = el.offsetWidth, alt = el.offsetHeight;
  const MARGEM = 8;
  let x = ponto.x + 2;
  let y = ponto.y + 2;
  if (x + larg + MARGEM > cx) x = Math.max(MARGEM, ponto.x - larg - 2);
  if (y + alt + MARGEM > cy) y = Math.max(MARGEM, ponto.y - alt - 2);
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;

  // O menu é um <div> DENTRO do contêiner do mapa: sem isto, rolar dentro dele
  // daria zoom e um duplo toque daria zoom também.
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);

  aberto = { el };
  suspenderClique();
}

// Liga o gesto ao mapa.
//
//   map         a instância do Leaflet (mesmo padrão de `map` explícito dos
//               outros módulos — nunca lido como global)
//   obterPosto  a MESMA função que index.html passa a iniciarMarcacoes() como
//               `obterPostoObservacao`. Passar a mesma é o que garante que a
//               visada do menu e a do popup concordem, inclusive no motivo
//               quando não há posição.
//   obterPosicionamento  opcional (2026-10-02). Devolve `null` quando a linha
//               "Posicionar-me aqui" não se aplica, ou
//               `{ desabilitado, motivo, aoPosicionar(latlng) }`. É
//               `obterPosicionamentoManual` de gps.js. Sem ele (o painel do
//               instrutor) a linha não existe.
//
// Devolve a função que desliga tudo.
export function ligarMenuDoMapa({ map, obterPosto, obterPosicionamento } = {}) {
  if (!map) return () => {};
  injetarEstilos();
  const container = map.getContainer();

  const desligarGesto = ligarToqueLongo(container, {
    ignorar: (ev) => !!(ev.target && ev.target.closest && ev.target.closest(IGNORAR)),
    aoDisparar: ({ x, y }) => {
      // Outra interação de clique está ativa no mesmo mapa (desenhar área
      // offline, hoje). Um terceiro significado para o toque, no meio de um
      // gesto que já tem dois, é como o bug de 2026-08-01 nasceu.
      if (cliqueEstaSuspenso()) return;
      const r = container.getBoundingClientRect();
      const ponto = L.point(x - r.left, y - r.top);
      abrir(map, map.containerPointToLatLng(ponto), ponto, { obterPosto, obterPosicionamento });
    },
  });

  // Fechar. Qualquer coisa que mude o que está debaixo do menu o invalida: o
  // menu fala de UM ponto, e o ponto se move quando o mapa se move.
  const aoTeclar = (ev) => { if (ev.key === 'Escape') fechar(); };
  const aoTocarFora = (ev) => {
    if (!aberto) return;
    if (ev.target && ev.target.closest && ev.target.closest('.' + CLASSE)) return;
    fechar();
  };
  document.addEventListener('keydown', aoTeclar);
  document.addEventListener('pointerdown', aoTocarFora, true);
  map.on('movestart', fechar);
  map.on('zoomstart', fechar);

  return () => {
    fechar();
    desligarGesto();
    document.removeEventListener('keydown', aoTeclar);
    document.removeEventListener('pointerdown', aoTocarFora, true);
    map.off('movestart', fechar);
    map.off('zoomstart', fechar);
  };
}
