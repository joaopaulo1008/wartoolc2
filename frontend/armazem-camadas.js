// armazem-camadas.js — Etapa 7: o arquivo do aluno sobrevive ao F5.
//
// Por que IndexedDB, e não as alternativas
// ----------------------------------------
//   * `localStorage` NÃO serve: teto de ~5 MB e só aceita string, então um
//     arquivo de 8 MB viraria ~11 MB em base64 — nem cabe, nem seria honesto
//     gastar o orçamento inteiro de storage do domínio com um calco.
//   * A File System Access API (guardar o *handle* do arquivo no disco, em vez
//     de uma cópia) seria melhor em teoria — ocupa zero e acompanha edições do
//     arquivo. Mas só existe no Chrome/Edge de desktop e pede permissão de
//     novo a cada sessão. O uso desta etapa é celular em campo; não serve.
//   * IndexedDB guarda ArrayBuffer nativamente, tem cota generosa e é o que
//     todo navegador de celular suporta.
//
// O QUE SE GUARDA: OS BYTES ORIGINAIS
// -----------------------------------
// Não o GeoJSON já convertido. Ver o comentário de LIMITE_GUARDADO_BYTES em
// kml.js para o raciocínio — é o mesmo de subir o arquivo original para o
// Storage em vez do simplificado.
//
// ESCOPO POR USUÁRIO, MAS SEM APAGAR NO LOGOUT
// --------------------------------------------
// Decisão tomada com o uso real em vista: o celular é PESSOAL de cada aluno,
// então apagar tudo no `sair()` só faria ele perder o calco toda vez que
// trocasse de sessão, sem proteger ninguém de nada.
//
// Ainda assim, cada registro carrega o `usuario_id` e a leitura é sempre
// filtrada por ele. Isso não é redundância: cobre o aparelho que
// eventualmente for emprestado, ou o instrutor que entra na conta dele no
// celular de um aluno para conferir alguma coisa. Sem essa chave, o calco de
// um partido apareceria para quem entrasse depois — e num exercício com Azul
// e Vermelho isso é exatamente o que não pode acontecer.
//
// FALHA É SEMPRE SUAVE
// --------------------
// Navegação privada, cota negada, IndexedDB desabilitado por política: nada
// disso pode derrubar a camada. Toda função aqui devolve um resultado
// utilizável em vez de lançar, e camadas.js segue com a camada só em memória,
// avisando na tela que ela some ao recarregar. Perder a persistência é um
// aborrecimento; perder o calco no meio do exercício não é.

const BANCO = 'wartool-camadas';
const VERSAO = 1;
const LOJA = 'arquivos';

let promessaBanco = null;
// Uma vez que o IndexedDB se mostrou indisponível, não adianta insistir a
// cada arquivo aberto — cada tentativa custaria uma promessa rejeitada e um
// erro no console para nada.
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
      console.warn('IndexedDB indisponível — as camadas não serão guardadas:', e);
      resolve(null);
      return;
    }

    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      if (!bd.objectStoreNames.contains(LOJA)) {
        const loja = bd.createObjectStore(LOJA, { keyPath: 'id' });
        // Índice por usuário: é por ele que toda leitura passa.
        loja.createIndex('por_usuario', 'usuario_id', { unique: false });
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => {
      indisponivel = true;
      console.warn('Não foi possível abrir o armazém de camadas:', pedido.error);
      resolve(null);
    };
    // Acontece quando outra aba do app está com uma versão diferente aberta.
    pedido.onblocked = () => {
      indisponivel = true;
      console.warn('Armazém de camadas bloqueado por outra aba aberta.');
      resolve(null);
    };
  });
  return promessaBanco;
}

// Envelope único para as operações: abre o banco, roda a transação e nunca
// deixa uma exceção escapar. `padrao` é o que sai quando não deu.
async function comLoja(modo, tarefa, padrao) {
  const bd = await abrir();
  if (!bd) return padrao;
  return new Promise((resolve) => {
    let transacao;
    try {
      transacao = bd.transaction(LOJA, modo);
    } catch (e) {
      console.warn('Transação do armazém de camadas falhou:', e);
      resolve(padrao);
      return;
    }
    let resultado = padrao;
    transacao.oncomplete = () => resolve(resultado);
    transacao.onerror = () => {
      // QuotaExceededError cai aqui. Não é erro de programação: é o disco do
      // aparelho cheio, e a resposta certa é seguir sem guardar.
      console.warn('Operação no armazém de camadas falhou:', transacao.error);
      resolve(padrao);
    };
    transacao.onabort = () => resolve(padrao);
    try {
      tarefa(transacao.objectStore(LOJA), (v) => { resultado = v; });
    } catch (e) {
      console.warn('Erro no armazém de camadas:', e);
      try { transacao.abort(); } catch (_) { /* já abortada */ }
      resolve(padrao);
    }
  });
}

// ── Leitura ──────────────────────────────────────────────────────────────
// Sempre filtrada por usuário — ver a nota no topo do arquivo. Devolve em
// ordem de `ordem` para as camadas voltarem empilhadas como o aluno deixou.
export async function listarArquivos(usuarioId) {
  if (!usuarioId) return [];
  const lista = await comLoja('readonly', (loja, definir) => {
    const pedido = loja.index('por_usuario').getAll(usuarioId);
    pedido.onsuccess = () => definir(pedido.result || []);
  }, []);
  return lista.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

// ── Escrita ──────────────────────────────────────────────────────────────
// Devolve true/false em vez de lançar: quem chama precisa saber se deu, para
// avisar na tela, mas não pode quebrar se não deu.
export async function guardarArquivo(registro) {
  if (!registro || !registro.id || !registro.usuario_id) return false;
  return comLoja('readwrite', (loja, definir) => {
    const pedido = loja.put({ ...registro, guardado_em: Date.now() });
    pedido.onsuccess = () => definir(true);
  }, false);
}

// Só as preferências (opacidade, ordem, caixa marcada) — sem reescrever os
// bytes, que são a parte cara. Chamada com frequência: arrastar o controle de
// opacidade termina aqui.
export async function atualizarPreferencias(id, preferencias) {
  if (!id) return false;
  return comLoja('readwrite', (loja, definir) => {
    const leitura = loja.get(id);
    leitura.onsuccess = () => {
      const atual = leitura.result;
      // Some se o registro foi removido entre a leitura e agora (outra aba,
      // por exemplo). Não é erro: não há o que atualizar.
      if (!atual) { definir(false); return; }
      const gravacao = loja.put({ ...atual, ...preferencias });
      gravacao.onsuccess = () => definir(true);
    };
  }, false);
}

export async function removerArquivo(id) {
  if (!id) return false;
  return comLoja('readwrite', (loja, definir) => {
    const pedido = loja.delete(id);
    pedido.onsuccess = () => definir(true);
  }, false);
}

// Existe para o caso de o aluno querer limpar o aparelho de uma vez, e para
// quem precisar fazer faxina depois de um exercício. NÃO é chamada no
// `sair()`, de propósito — ver a nota sobre escopo no topo do arquivo.
export async function removerDoUsuario(usuarioId) {
  if (!usuarioId) return false;
  return comLoja('readwrite', (loja, definir) => {
    const pedido = loja.index('por_usuario').getAllKeys(usuarioId);
    pedido.onsuccess = () => {
      for (const chave of pedido.result || []) loja.delete(chave);
      definir(true);
    };
  }, false);
}

// ── Durabilidade ─────────────────────────────────────────────────────────
// Sem isto, o navegador pode despejar o armazenamento quando o disco aperta —
// e o Safari/iOS apaga storage de script depois de ~7 dias sem uso do site.
// `persist()` pede para o navegador tratar os dados como duráveis. Ele pode
// simplesmente negar (e nega, em vários casos, sem explicar), então isto é
// uma melhoria de chance, não uma garantia — e é por isso que não se checa o
// resultado para decidir nada.
export async function pedirDurabilidade() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const jaEra = await navigator.storage.persisted();
      if (!jaEra) await navigator.storage.persist();
    }
  } catch (e) { /* navegador sem a API, ou negou — segue sem */ }
}
