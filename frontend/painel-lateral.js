// painel-lateral.js — Etapa 7.1: o painel de camadas para de tomar a tela.
//
// Por que este arquivo existe
// ---------------------------
// O painel lateral cresceu por acumulação: mapa base (Etapa 0), forças
// (Etapa 0), camadas do repositório (Etapa 6a) e camadas de arquivo
// (Etapa 7). No monitor isso passa; num celular em campo — que é o uso real —
// o conjunto cobria boa parte do mapa, que é justamente o que a pessoa abriu o
// app para ver.
//
// Duas coisas resolvem isso, e as duas estão aqui:
//   1. RECOLHER CADA CARTÃO. O título vira botão; o corpo some. Serve para o
//      "Mapa Base", que é o maior e o menos usado — depois de escolher a
//      carta, ninguém mexe nele de novo durante o exercício.
//   2. RECOLHER O PAINEL INTEIRO num botão. Em tela estreita ele nasce
//      recolhido: o mapa aparece inteiro e o painel é uma decisão, não uma
//      imposição.
//
// Módulo próprio, e não mais uma função em camadas.js, porque isto não é sobre
// camadas: vale para qualquer cartão do painel, inclusive os dois (Mapa Base e
// Forças) que moram no <script> clássico de index.html e que camadas.js não
// tem nada a ver com. É o mesmo critério que criou icones.js na Etapa 5 e
// vigia-ausencia.js na 6c — a segunda tela que precisa do mesmo
// comportamento é a hora de extrair.
//
// Sem estado persistido de propósito: o que fica recolhido nesta sessão volta
// ao padrão na próxima. Guardar isso exigiria decidir onde (localStorage por
// usuário? `preferencias_visualizacao`, que continua fora de escopo?), e a
// escolha errada é mais cara de desfazer do que reabrir um cartão.

// Abaixo desta largura o painel nasce recolhido. 820px não é o "breakpoint de
// tablet" de nenhum framework — é onde o painel (170px de largura mínima
// somados à margem) passa a comer uma fatia do mapa que atrapalha mais do que
// ajuda.
export const LARGURA_PAINEL_ABERTO = 820;

let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados) return;
  estilosInjetados = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Cartão recolhível: o corpo é envolvido por .pl-corpo, que é o que some.
       O <h3> vira botão e ganha o indicador. */
    .pl-titulo {
      display:flex; align-items:center; gap:6px;
      cursor:pointer; user-select:none; margin-bottom:8px;
    }
    .pl-titulo:hover { color:#c8d8e8; }
    .pl-seta { font-size:9px; line-height:1; transition:transform .12s ease; }
    .pl-recolhido .pl-seta { transform:rotate(-90deg); }
    .pl-recolhido .pl-titulo { margin-bottom:0; }
    .pl-recolhido .pl-corpo { display:none; }

    /* Botão que recolhe o painel inteiro. Fica onde o painel começa, para o
       polegar achar no mesmo lugar com o painel aberto ou fechado.
       `top:10px` (não mais 58px): o botão é inserido como irmão do painel, no
       mesmo pai (ver `painel.parentElement.insertBefore` abaixo) — desde a
       correção de mobile pós-campo esse pai é #mapa-wrap, que já tem
       `position:relative` e só começa depois da topbar. Um valor fixo pequeno
       aqui vale para qualquer altura de topbar; um valor fixo grande (58px)
       só valia enquanto a topbar coubesse numa linha só. */
    #pl-botao {
      position:absolute; top:10px; right:10px; z-index:1002;
      background:rgba(13,27,42,.92); color:#a8c8e8;
      border:1px solid #2a4a6b; border-radius:6px;
      padding:7px 11px; font-size:13px; line-height:1; cursor:pointer;
      font-family:inherit;
    }
    #pl-botao:hover { color:#e8eaf0; border-color:#3a6a9b; }
    /* Com o painel aberto, o botão encosta nele em vez de flutuar solto. */
    #pl-botao.pl-aberto { border-bottom-right-radius:0; border-bottom-left-radius:0; }
    .pl-oculto { display:none !important; }
  `;
  document.head.appendChild(style);
}

// Torna um cartão recolhível. Tudo que já está dentro dele, menos o <h3>,
// passa a viver num .pl-corpo — assim funciona com qualquer cartão, incluindo
// os que foram escritos à mão no HTML antes deste módulo existir.
//
// Idempotente: chamar duas vezes no mesmo cartão não empilha invólucros.
export function tornarRecolhivel(cartao, { recolhido = false } = {}) {
  if (!cartao || cartao.dataset.plRecolhivel === '1') return cartao;
  injetarEstilos();
  cartao.dataset.plRecolhivel = '1';

  const titulo = cartao.querySelector('h3');
  if (!titulo) return cartao;

  const corpo = document.createElement('div');
  corpo.className = 'pl-corpo';
  // Move o que vem DEPOIS do título; o próprio título fica onde está.
  while (titulo.nextSibling) corpo.appendChild(titulo.nextSibling);
  cartao.appendChild(corpo);

  titulo.classList.add('pl-titulo');
  const seta = document.createElement('span');
  seta.className = 'pl-seta';
  seta.textContent = '▼';
  titulo.prepend(seta);

  titulo.setAttribute('role', 'button');
  titulo.setAttribute('tabindex', '0');
  const alternar = () => {
    const agoraRecolhido = cartao.classList.toggle('pl-recolhido');
    titulo.setAttribute('aria-expanded', String(!agoraRecolhido));
  };
  titulo.addEventListener('click', alternar);
  // Teclado: o <h3> não é um <button>, então Enter/Espaço precisam ser
  // ligados à mão para quem navega sem mouse.
  titulo.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); alternar(); }
  });

  if (recolhido) cartao.classList.add('pl-recolhido');
  titulo.setAttribute('aria-expanded', String(!recolhido));
  return cartao;
}

// Botão que mostra/esconde o painel inteiro.
//
// `recolherAbaixoDe` é medido UMA VEZ, na montagem, e não por listener de
// resize: girar o celular no meio do exercício não deve fechar na cara da
// pessoa o painel que ela acabou de abrir. O estado passa a ser dela a partir
// do primeiro toque.
export function iniciarPainelRecolhivel({
  seletor = '#side-panel',
  rotuloAberto = '✕',
  rotuloFechado = '☰',
  recolherAbaixoDe = LARGURA_PAINEL_ABERTO,
} = {}) {
  injetarEstilos();
  const painel = document.querySelector(seletor);
  if (!painel || document.getElementById('pl-botao')) return null;

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.id = 'pl-botao';
  botao.title = 'Mostrar/ocultar o painel de camadas';
  botao.setAttribute('aria-controls', painel.id || 'side-panel');

  let aberto = window.innerWidth > recolherAbaixoDe;

  function aplicar() {
    painel.classList.toggle('pl-oculto', !aberto);
    botao.textContent = aberto ? rotuloAberto : rotuloFechado;
    botao.classList.toggle('pl-aberto', aberto);
    botao.setAttribute('aria-expanded', String(aberto));
    // Com o painel aberto o botão sobe para não cobrir o primeiro cartão;
    // fechado, ocupa o lugar que o painel deixou. Mesma diferença de ~32px de
    // antes, só que a partir da nova base de 10px (ver comentário do #pl-botao
    // acima) em vez da antiga base de 58px.
    botao.style.top = aberto ? '-22px' : '10px';
  }

  botao.addEventListener('click', () => { aberto = !aberto; aplicar(); });
  painel.parentElement.insertBefore(botao, painel);
  aplicar();

  return { botao, mostrar: () => { aberto = true; aplicar(); } };
}
