// situacao-usuario.js — a parte PURA do recado de situação e do pedido de
// apoio (2026-09-15).
//
// Sem DOM, sem Leaflet, sem Supabase. Testável em Node
// (`node frontend/situacao-usuario.teste.mjs`), no padrão de anotacoes.js,
// paleta.js, visada.js e rastro.js.
//
// O nome é `situacao-usuario` e não `situacao` porque `situacao.js` já existe
// e é outra coisa: a ABA "Situação atual" do painel do instrutor (Etapa 6c).
// Duas coisas com o mesmo nome em `frontend/` seria a confusão garantida.
//
// AS DUAS COISAS SÃO SEPARADAS E ESTE ARQUIVO É ONDE ISSO FICA EVIDENTE
// ---------------------------------------------------------------------
// `ESTADOS` é o recado do JOGO. `pedidos_apoio` é a coisa séria. Não existe
// um estado 'emergencia' na lista, de propósito — ver o cabeçalho da
// migration 0014. Se alguém acrescentar um aqui, o teste quebra.

// ── Estados possíveis ────────────────────────────────────────────────────
// Espelha o `check` de `situacoes.estado` na 0014. A ordem é a da lista na
// tela. `normal` é o padrão e **não desenha nada** — um popup que anunciasse
// "estado: normal" para todo mundo o tempo todo seria ruído que ensina a
// ignorar o campo, e aí o dia em que dissesse outra coisa ninguém veria.
export const ESTADOS = [
  { valor: 'normal',        rotulo: 'Sem novidade',            cor: null },
  { valor: 'em_contato',    rotulo: 'Em contato',              cor: '#e05252' },
  { valor: 'sem_municao',   rotulo: 'Sem munição',             cor: '#f5c842' },
  { valor: 'pane_viatura',  rotulo: 'Viatura em pane',         cor: '#f5c842' },
  { valor: 'sem_condicoes', rotulo: 'Sem condições de prosseguir', cor: '#e08a52' },
];

export const ESTADO_PADRAO = 'normal';
export const LIMITE_TEXTO_SITUACAO = 80;
export const LIMITE_MOTIVO_APOIO = 200;

const POR_VALOR = new Map(ESTADOS.map((e) => [e.valor, e]));

export function estadoValido(valor) {
  return POR_VALOR.has(valor);
}

// Rótulo em português de um estado. Um valor desconhecido (linha gravada por
// uma versão mais nova do app, ou direto no SQL) devolve '' em vez de chutar:
// escrever o código cru no popup ("sem_municao") seria pior do que não
// escrever nada.
export function rotuloDoEstado(valor) {
  const e = POR_VALOR.get(valor);
  return e ? e.rotulo : '';
}

export function corDoEstado(valor) {
  const e = POR_VALOR.get(valor);
  return e ? e.cor : null;
}

function limpar(texto) {
  return typeof texto === 'string' ? texto.replace(/\r\n/g, '\n').trim() : '';
}

// Valida o par estado + texto antes de gravar. Devolve { ok, valor } ou
// { ok:false, erro }, mesmo formato de validarAnotacao()/validarPreset().
//
// Texto em branco vira `null`, não `''`: o `check` da 0014 exige que, HAVENDO
// texto, ele tenha conteúdo — e `null` é o jeito honesto de dizer "não há".
export function validarSituacao({ estado, texto } = {}) {
  const e = estado || ESTADO_PADRAO;
  if (!estadoValido(e)) {
    return { ok: false, erro: 'Estado desconhecido.' };
  }
  const t = limpar(texto);
  if (t.length > LIMITE_TEXTO_SITUACAO) {
    return {
      ok: false,
      erro: `O recado tem ${t.length} caracteres; o limite é ${LIMITE_TEXTO_SITUACAO}.`,
    };
  }
  return { ok: true, valor: { estado: e, texto: t === '' ? null : t } };
}

// A linha que vai para o POPUP, em uma string, ou '' quando não há o que
// dizer. É o ponto em que "sem novidade e sem texto" vira silêncio — a regra
// que impede o campo de virar ruído.
export function linhaDeSituacao(row) {
  if (!row) return '';
  const rotulo = rotuloDoEstado(row.estado);
  const texto = limpar(row.texto);
  // 'normal' sem texto não fala nada. 'normal' COM texto fala o texto: alguém
  // que escreveu "chegando ao PC" não está em estado anormal e mesmo assim
  // tem algo a dizer.
  // Sem rótulo a mostrar (é o padrão, ou é um valor que esta versão do app
  // não conhece): sobra o texto, e só ele. Devolver " — alguma coisa" com um
  // travessão órfão seria o sintoma visível de um estado que o app não
  // entende, escrito no popup de quem está em campo.
  if (!rotulo || row.estado === ESTADO_PADRAO) return texto;
  return texto ? `${rotulo} — ${texto}` : rotulo;
}

// ── Pedido de apoio ──────────────────────────────────────────────────────
// Como a posição do pedido deve ser APRESENTADA. Esta função é a razão de o
// módulo existir: um pedido de apoio com coordenada de oito minutos atrás,
// mostrada com cara de agora, manda gente para o lugar errado — e "lugar
// errado" aqui é alguém procurando outra pessoa no mato.
//
// Três respostas possíveis, e nenhuma delas é silêncio:
//   sem posição      -> diz que não há, para quem recebe usar rádio/rastro.
//   posição recente  -> diz que é de agora.
//   posição velha    -> diz a idade, em vez de deixar parecer atual.
export const POSICAO_RECENTE_MS = 60_000;

export function descreverPosicaoDoPedido(pedido, { agora = Date.now() } = {}) {
  if (!pedido || !Number.isFinite(pedido.latitude) || !Number.isFinite(pedido.longitude)) {
    return { temPosicao: false, rotulo: 'sem posição conhecida', velha: true };
  }
  const medidoEm = pedido.posicao_em ? new Date(pedido.posicao_em).getTime() : null;
  if (!medidoEm || !Number.isFinite(medidoEm)) {
    // Coordenada sem carimbo: existe, mas não dá para dizer de quando é.
    // Tratada como VELHA — o erro seguro é o que desconfia.
    return { temPosicao: true, rotulo: 'posição sem hora conhecida', velha: true };
  }
  const idade = agora - medidoEm;
  if (idade <= POSICAO_RECENTE_MS) {
    return { temPosicao: true, rotulo: 'posição do momento do acionamento', velha: false, idadeMs: idade };
  }
  return {
    temPosicao: true,
    rotulo: `posição de ${duracaoCurta(idade)} antes do acionamento`,
    velha: true,
    idadeMs: idade,
  };
}

// "45s", "3m", "1h12m". Própria em vez de reusar `rotuloIdade()` de
// vigia-ausencia.js porque aquela devolve '' abaixo do limiar de aviso (é uma
// etiqueta que precisa sumir quando está tudo bem) — e aqui NUNCA pode
// devolver vazio: um pedido de apoio sem a idade da posição é o caso que esta
// função existe para impedir.
export function duracaoCurta(ms) {
  const seg = Math.max(0, Math.round(ms / 1000));
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, '0')}m`;
}

// Em que fase está o pedido. Ordem importa: encerrado vence reconhecido.
export function faseDoPedido(pedido) {
  if (!pedido) return 'nenhum';
  if (pedido.encerrado_em) return 'encerrado';
  if (pedido.reconhecido_em) return 'reconhecido';
  return 'aberto';
}

// Um pedido aberto ou reconhecido continua PESANDO na tela; só o encerrado
// sai. Reconhecer não apaga — "estou vendo" não é "está resolvido", e um
// pedido que sumisse ao ser reconhecido deixaria de ser acompanhado.
export function pedidoEstaVigente(pedido) {
  const f = faseDoPedido(pedido);
  return f === 'aberto' || f === 'reconhecido';
}

// ── A resposta do instrutor (2026-09-15, migration 0015) ─────────────────
// "Reconhecido" é quase nada para quem está em campo: não diz quem viu, se
// alguém saiu, por onde nem em quanto tempo. A resposta é o que transforma um
// carimbo numa informação utilizável.
//
// POR QUE EXISTEM RESPOSTAS PRONTAS
// ----------------------------------
// Digitar leva tempo justamente no momento em que há menos. Três toques
// cobrem o que se responde na maioria das vezes, e o campo livre continua ali
// para quem puder detalhar. A lista é curta de propósito: uma lista longa
// obriga a LER antes de escolher, que é o custo que ela existia para evitar.
//
// Não são doutrina: são o rascunho que quem conduz a instrução vai corrigir
// depois do primeiro uso em campo. Mudá-las é editar este array.
export const RESPOSTAS_PRONTAS = [
  'Ciente, apoio a caminho',
  'Ciente, aguarde no local',
  'Ciente, desloque para o PC',
];

export const LIMITE_RESPOSTA = 200;

export function validarResposta(texto) {
  const t = limpar(texto);
  if (t === '') return { ok: false, erro: 'Escreva ou escolha uma resposta.' };
  if (t.length > LIMITE_RESPOSTA) {
    return { ok: false, erro: `A resposta tem ${t.length} caracteres; o limite é ${LIMITE_RESPOSTA}.` };
  }
  return { ok: true, valor: t };
}

// Em que pé está a resposta, para as duas telas dizerem a mesma coisa:
//   'nenhuma'    — ainda não respondeu.
//   'enviada'    — respondeu, e o autor NÃO confirmou que leu. Com a tela do
//                  celular apagada este é o caso provável, não o raro — por
//                  isso ele é um estado próprio e não se parece com 'lida'.
//   'lida'       — o autor carimbou que viu.
export function faseDaResposta(pedido) {
  if (!pedido || !pedido.resposta) return 'nenhuma';
  return pedido.resposta_vista_em ? 'lida' : 'enviada';
}

// O rótulo que a FAIXA do instrutor mostra. Nunca devolve algo que sugira
// entrega quando não houve: "respondido" e "lido" são palavras diferentes de
// propósito, e um pedido respondido sem confirmação diz há quanto tempo está
// assim — é o que decide se ele insiste pelo rádio.
export function rotuloDaResposta(pedido, { agora = Date.now() } = {}) {
  const fase = faseDaResposta(pedido);
  if (fase === 'nenhuma') return '';
  if (fase === 'lida') {
    const t = new Date(pedido.resposta_vista_em);
    return `respondido · lido às ${t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const enviadaEm = pedido.respondido_em ? new Date(pedido.respondido_em).getTime() : null;
  const ha = enviadaEm ? ` há ${duracaoCurta(agora - enviadaEm)}` : '';
  return `respondido${ha} · SEM confirmação de leitura`;
}

export function validarMotivo(texto) {
  const t = limpar(texto);
  if (t.length > LIMITE_MOTIVO_APOIO) {
    return { ok: false, erro: `O motivo tem ${t.length} caracteres; o limite é ${LIMITE_MOTIVO_APOIO}.` };
  }
  return { ok: true, valor: t === '' ? null : t };
}
