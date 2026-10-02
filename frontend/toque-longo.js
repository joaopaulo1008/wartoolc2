// toque-longo.js — o gesto "manter o dedo parado" como módulo próprio.
//
// Por que este arquivo existe
// ----------------------------
// O gesto nasceu em `paleta-tela.js` (2026-09-14), à mão, com pointer events:
// toque curto escolhe o preset, toque longo preenche o formulário sem gravar.
// O menu de contexto do mapa é o SEGUNDO consumidor, e a regra do projeto é
// extrair na segunda vez — foi assim que nasceram `catalogo-form.js`,
// `basemaps.js` e `vigia-ausencia.js`.
//
// A extração não é só arrumação: a versão de `paleta-tela.js` **não tinha
// tolerância de movimento**. `pointerdown` armava o cronômetro e só soltar,
// sair ou cancelar o desarmava — rolar o formulário com o dedo em cima de um
// botão disparava o toque longo. O roteiro de campo já suspeitava disso por
// escrito, no item 15j: *"se num celular específico não disparar (ou disparar
// sozinho ao rolar o formulário), anote qual aparelho"*. A tolerância entra
// aqui, e os dois consumidores a ganham de uma vez.
//
// ── Por que NÃO usar `contextmenu` ────────────────────────────────────────
// O navegador dispara `contextmenu` no toque longo, e seria a coisa óbvia a
// escutar. Não serve por dois motivos medidos no projeto: ele não é o mesmo
// gesto em todo lugar (o iOS não o entrega no mesmo caso que o Android), e o
// Leaflet tem um `map.on('contextmenu')` que depende da mesma origem. O
// `paleta-tela.js` já tratava `contextmenu` como **inimigo a suprimir**, não
// como fonte — é o menu nativo aparecendo por cima do nosso. Aqui é igual:
// o evento é cancelado, nunca escutado.
//
// ── A parte PURA e a parte da tela ────────────────────────────────────────
// `criarMaquina()` não conhece DOM, nem `setTimeout`, nem Leaflet: recebe
// eventos já traduzidos (`{tipo, id, x, y, t}`) e devolve o que fazer
// (`armar` / `cancelar` / `disparar` / `engolir`). É o que permite testar o
// gesto em Node puro, como `rastro.js`, `visada.js` e `coordenadas.js` —
// inclusive os casos que ninguém reproduz de propósito num celular, como
// "pinça lenta não pode virar toque longo".
//
// `ligarToqueLongo()` é a casca fina que amarra isso aos pointer events.

// 500 ms é o intervalo que o próprio navegador usa para o menu de contexto em
// toque. Usar o mesmo número faz o gesto parecer nativo em vez de inventado.
export const TOQUE_LONGO_MS = 500;

// Quanto o dedo pode escorregar sem cancelar. 10 px é abaixo do que qualquer
// pessoa percebe como "mexi o dedo" e acima do tremor de quem só está parado
// segurando — inclusive com luva, que é o caso de uso aqui.
export const TOLERANCIA_PX = 10;

// A máquina de estado. Eventos que ela entende, já traduzidos pela casca:
//
//   baixo      pointerdown
//   move       pointermove
//   cima       pointerup
//   cancelado  pointercancel / pointerleave
//   clique     click (para decidir se ele deve ser engolido)
//
// Devolve sempre `{ acao }`, onde `acao` é:
//
//   armar      comece a contar (o campo `em` diz o instante alvo)
//   cancelar   pare de contar; o gesto morreu
//   disparar   só de tempoEsgotado(); vem com `x`/`y` de onde o dedo estava
//   engolir    este clique é o rabo de um toque longo já tratado
//   nada       siga a vida
export function criarMaquina({ ms = TOQUE_LONGO_MS, toleranciaPx = TOLERANCIA_PX } = {}) {
  // O toque em curso, enquanto o cronômetro está valendo. `null` = nada armado.
  let ativo = null;
  // Os dedos na tela, POR IDENTIFICADOR — não um contador. Serve a UM caso, e
  // é o caso que motivou rastrear: **a pinça começa com um pointerdown
  // parado.** Quem aproxima o zoom devagar segura o primeiro dedo por mais de
  // meio segundo antes de o segundo encostar — sem isto, aproximar o mapa
  // devagar abriria o menu de contexto no meio do gesto. O segundo `baixo`
  // mata o toque longo, e não há como rearmar sem tirar os dois dedos, porque
  // `ativo` só volta a existir num `baixo` novo.
  //
  // POR QUE UM CONJUNTO E NÃO UM NÚMERO. A primeira versão contava, e o teste
  // derrubou: quando o navegador **não entrega o `pointerup`** (o dedo sai da
  // tela durante uma rolagem, o elemento some, a página muda), o contador fica
  // travado em 1 e todo toque seguinte é lido como "segundo dedo" — o gesto
  // morre para sempre, em silêncio, e quem está com o app na mão só vê que
  // parou de abrir. Com o conjunto, um `baixo` de um identificador que já
  // estava lá é a prova de que a soltura dele se perdeu: o estado velho é
  // jogado fora e o gesto recomeça, em vez de ficar entulhado.
  const ativos = new Set();
  // O toque longo dispara com o dedo AINDA na tela; o `click` do navegador só
  // vem no `pointerup`, depois. Sem esta marca, o mesmo gesto valeria duas
  // vezes — é a flag `longo` que `paleta-tela.js` já tinha, com nome melhor.
  let engolirProximoClique = false;

  const desarmar = () => { const tinha = ativo !== null; ativo = null; return tinha ? 'cancelar' : 'nada'; };

  return {
    evento({ tipo, id = 0, x = 0, y = 0, t = 0 } = {}) {
      switch (tipo) {
        case 'baixo': {
          if (ativos.has(id)) ativos.clear(); // perdemos a soltura deste dedo: ver o comentário de `ativos`
          ativos.add(id);
          if (ativos.size > 1) return { acao: desarmar() }; // pinça: ver o comentário de `ativos`
          // Um gesto novo apaga a dívida do anterior: se um toque longo
          // disparou e o clique dele nunca chegou (o dedo saiu da tela, a
          // página rolou), a marca não pode ficar esperando para engolir um
          // clique legítimo lá adiante.
          engolirProximoClique = false;
          ativo = { id, x, y, em: t + ms };
          return { acao: 'armar', em: ativo.em };
        }
        case 'move': {
          if (!ativo || id !== ativo.id) return { acao: 'nada' };
          const dist = Math.hypot(x - ativo.x, y - ativo.y);
          return { acao: dist <= toleranciaPx ? 'nada' : desarmar() };
        }
        case 'cima':
        case 'cancelado': {
          ativos.delete(id);
          return { acao: desarmar() };
        }
        case 'clique': {
          if (!engolirProximoClique) return { acao: 'nada' };
          engolirProximoClique = false;
          return { acao: 'engolir' };
        }
        default:
          return { acao: 'nada' };
      }
    },

    // Chamado quando o cronômetro estoura. `t` é opcional de propósito: quem
    // liga o gesto de verdade já sabe que a hora chegou (foi o setTimeout que
    // chamou), e comparar de novo contra o relógio só criaria a chance de o
    // gesto morrer em silêncio por um milissegundo de diferença entre o
    // agendamento e o `Date.now()`. O teste passa `t` porque ele não tem
    // cronômetro nenhum — é ele quem finge o tempo passando.
    tempoEsgotado(t) {
      if (!ativo) return { acao: 'nada' };
      if (t !== undefined && t < ativo.em) return { acao: 'nada' };
      const { x, y } = ativo;
      ativo = null;
      engolirProximoClique = true;
      return { acao: 'disparar', x, y };
    },

    // Só para teste e diagnóstico; nada de decisão depende disto.
    get armado() { return ativo !== null; },
    get dedosNaTela() { return ativos.size; },
  };
}

// A casca. Amarra a máquina aos pointer events de um elemento.
//
//   aoDisparar({x, y, ev})  toque longo completou (dedo ainda na tela)
//   aoClicarCurto(ev)       clique que NÃO é rabo de um toque longo
//   ignorar(ev)             opcional: `true` faz o pointerdown ser ignorado
//                           por inteiro (ex.: o dedo caiu sobre um marcador)
//
// Devolve uma função que desliga tudo.
export function ligarToqueLongo(elemento, {
  aoDisparar, aoClicarCurto, ignorar, ms = TOQUE_LONGO_MS, toleranciaPx = TOLERANCIA_PX,
} = {}) {
  if (!elemento) return () => {};
  const maquina = criarMaquina({ ms, toleranciaPx });
  let timer = null;
  const limpar = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const tratar = (tipo) => (ev) => {
    if (tipo === 'baixo' && ignorar && ignorar(ev)) return;
    const r = maquina.evento({
      tipo, id: ev.pointerId ?? 0, x: ev.clientX ?? 0, y: ev.clientY ?? 0, t: Date.now(),
    });
    if (r.acao === 'armar') {
      limpar();
      timer = setTimeout(() => {
        timer = null;
        const d = maquina.tempoEsgotado();
        if (d.acao === 'disparar' && aoDisparar) aoDisparar({ x: d.x, y: d.y, ev });
      }, ms);
    } else if (r.acao === 'cancelar') {
      limpar();
    }
  };

  const aoBaixo = tratar('baixo');
  const aoMover = tratar('move');
  const aoCima = tratar('cima');
  const aoCancelar = tratar('cancelado');
  const aoSair = tratar('cancelado');
  const aoClicar = (ev) => {
    const r = maquina.evento({ tipo: 'clique' });
    if (r.acao === 'engolir') return; // já tratado pelo toque longo
    if (aoClicarCurto) aoClicarCurto(ev);
  };
  // O menu nativo do navegador apareceria por cima do nosso. Ver o comentário
  // "Por que NÃO usar contextmenu" no topo.
  const aoMenuNativo = (ev) => ev.preventDefault();

  elemento.addEventListener('pointerdown', aoBaixo);
  elemento.addEventListener('pointermove', aoMover);
  elemento.addEventListener('pointerup', aoCima);
  elemento.addEventListener('pointercancel', aoCancelar);
  elemento.addEventListener('pointerleave', aoSair);
  elemento.addEventListener('click', aoClicar);
  elemento.addEventListener('contextmenu', aoMenuNativo);

  return () => {
    limpar();
    elemento.removeEventListener('pointerdown', aoBaixo);
    elemento.removeEventListener('pointermove', aoMover);
    elemento.removeEventListener('pointerup', aoCima);
    elemento.removeEventListener('pointercancel', aoCancelar);
    elemento.removeEventListener('pointerleave', aoSair);
    elemento.removeEventListener('click', aoClicar);
    elemento.removeEventListener('contextmenu', aoMenuNativo);
  };
}
