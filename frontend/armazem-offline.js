// armazem-offline.js — Etapa 8a: metadados das áreas de carta salvas offline.
//
// Mesmo padrão de frontend/armazem-camadas.js (Etapa 7), banco PRÓPRIO
// (`wartool-offline`, não o mesmo de `wartool-camadas`) porque a natureza do
// dado é diferente: aqui não há bytes de arquivo nenhum para guardar — os
// TILES em si moram no Cache API do Service Worker (frontend/sw-bdgex.js),
// endereçados pela própria URL de cada tile. O que este arquivo guarda é só
// o REGISTRO de qual área foi pedida (bbox, faixa de zoom, quantos tiles,
// status), para a tela saber o que listar, o que já foi baixado e o que
// precisa recomputar para apagar depois — ver o comentário sobre exclusão em
// offline-tela.js para o porquê de não guardar a lista de URLs aqui (tiles
// podem ser compartilhados por áreas vizinhas que se sobrepõem, e recomputar
// a lista a partir de bbox+zoom, via frontend/carta-offline.js, é o que
// permite decidir com segurança "este tile ainda é usado por outra área?").
//
// STATUS TEM TRÊS VALORES, E OS TRÊS IMPORTAM PARA A TELA:
//   'baixando'   — download em andamento (permite retomar se a aba fechar no
//                  meio: na próxima abertura a área aparece como incompleta,
//                  não desaparece em silêncio).
//   'pronta'     — todos os tiles planejados foram baixados com sucesso. É o
//                  ÚNICO status que o indicador "esta área está salva"
//                  (areaCobreViewport, em carta-offline.js) aceita.
//   'incompleta' — parou no meio (erro, cota estourada, ou o usuário
//                  cancelou). NUNCA é tratada como "pronta" mesmo que tenha
//                  90% dos tiles — a pior falha desta etapa seria uma área
//                  faltando pedaço se passando por completa. A tela oferece
//                  "completar" (retomar os que faltam) ou "apagar".
//
// ESCOPO POR USUÁRIO, MESMO CRITÉRIO DE armazem-camadas.js
// ----------------------------------------------------------
// A área em si não é dado sensível (é só um retângulo de coordenadas), mas
// escopar por `usuario_id` mantém a mesma convenção de interface do resto do
// app: um aparelho emprestado ou o instrutor entrando na conta de um aluno
// não veem a lista de áreas de outra pessoa somada à própria, o que confundia
// mais do que ajudava.
//
// FALHA É SEMPRE SUAVE, MESMO MOTIVO DE armazem-camadas.js
// ----------------------------------------------------------
// Navegação privada, cota negada, IndexedDB indisponível: nada disso pode
// travar o download em si (o Cache API guarda os tiles de qualquer forma,
// desde que exista). Perder só o REGISTRO da área é um aborrecimento — a
// tela avisa e a pessoa perde a lista bonita, não os tiles já no Cache API.

const BANCO = 'wartool-offline';
const VERSAO = 1;
const LOJA = 'areas';

let promessaBanco = null;
let indisponivel = false;

function abrir() {
  if (indisponivel) return Promise.resolve(null);
  if (promessaBanco) return promessaBanco;

  promessaBanco = new Promise((resolve) => {
    let pedido;
    try {
      if (!('indexedDB' in window) || !window.indexedDB) throw new Error('sem IndexedDB');
      pedido = window.indexedDB.open(BANCO, VERSAO);
    } catch (e) {
      indisponivel = true;
      console.warn('IndexedDB indisponível — as áreas offline não serão guardadas:', e);
      resolve(null);
      return;
    }

    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      if (!bd.objectStoreNames.contains(LOJA)) {
        const loja = bd.createObjectStore(LOJA, { keyPath: 'id' });
        loja.createIndex('por_usuario', 'usuario_id', { unique: false });
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => {
      indisponivel = true;
      console.warn('Não foi possível abrir o armazém de áreas offline:', pedido.error);
      resolve(null);
    };
    pedido.onblocked = () => {
      indisponivel = true;
      console.warn('Armazém de áreas offline bloqueado por outra aba aberta.');
      resolve(null);
    };
  });
  return promessaBanco;
}

async function comLoja(modo, tarefa, padrao) {
  const bd = await abrir();
  if (!bd) return padrao;
  return new Promise((resolve) => {
    let transacao;
    try {
      transacao = bd.transaction(LOJA, modo);
    } catch (e) {
      console.warn('Transação do armazém de áreas offline falhou:', e);
      resolve(padrao);
      return;
    }
    let resultado = padrao;
    transacao.oncomplete = () => resolve(resultado);
    transacao.onerror = () => {
      // QuotaExceededError cai aqui — mas isso é sobre o REGISTRO (algumas
      // dezenas de bytes), não sobre os tiles. Ver o comentário do topo do
      // arquivo: os tiles já baixados no Cache API não dependem disto.
      console.warn('Operação no armazém de áreas offline falhou:', transacao.error);
      resolve(padrao);
    };
    transacao.onabort = () => resolve(padrao);
    try {
      tarefa(transacao.objectStore(LOJA), (v) => { resultado = v; });
    } catch (e) {
      console.warn('Erro no armazém de áreas offline:', e);
      try { transacao.abort(); } catch (_) { /* já abortada */ }
      resolve(padrao);
    }
  });
}

// ── Leitura ──────────────────────────────────────────────────────────────
// Ordenado por criado_em, mais recente primeiro — é a ordem que faz sentido
// numa lista de "o que eu salvei", diferente de armazem-camadas.js (que
// ordena por `ordem`, porque ali a ordem empilha panes no mapa).
export async function listarAreas(usuarioId) {
  if (!usuarioId) return [];
  const lista = await comLoja('readonly', (loja, definir) => {
    const pedido = loja.index('por_usuario').getAll(usuarioId);
    pedido.onsuccess = () => definir(pedido.result || []);
  }, []);
  return lista.slice().sort((a, b) => (b.criado_em || 0) - (a.criado_em || 0));
}

export async function buscarArea(id) {
  if (!id) return null;
  return comLoja('readonly', (loja, definir) => {
    const pedido = loja.get(id);
    pedido.onsuccess = () => definir(pedido.result || null);
  }, null);
}

// ── Escrita ──────────────────────────────────────────────────────────────
// `put` cobre criar E atualizar (mesmo registro, mesma chave `id`) — é assim
// que o download em andamento vai gravando `tilesBaixados` sem precisar de
// uma função separada de "atualizar progresso": menos escrita no meio de um
// laço de download que já roda a cada tile.
export async function guardarArea(registro) {
  if (!registro || !registro.id || !registro.usuario_id) return false;
  return comLoja('readwrite', (loja, definir) => {
    const pedido = loja.put({ ...registro, atualizado_em: Date.now() });
    pedido.onsuccess = () => definir(true);
  }, false);
}

export async function removerArea(id) {
  if (!id) return false;
  return comLoja('readwrite', (loja, definir) => {
    const pedido = loja.delete(id);
    pedido.onsuccess = () => definir(true);
  }, false);
}
