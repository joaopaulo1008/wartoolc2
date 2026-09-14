// paleta.js — regra PURA da paleta de ícones rápidos (2026-09-14).
//
// Sem DOM, sem Leaflet, sem Supabase — mesmo padrão de rastro.js, kml.js,
// carta-offline.js, imagem-geo.js e coordenadas.js, e pelo mesmo motivo: o que
// decide se um preset é válido, em que ordem a paleta aparece e o que acontece
// quando o aluno toca num botão é lógica que se responde errado em silêncio.
// Aqui ela roda em Node, com teste (paleta.teste.mjs).
//
// O acesso ao banco fica em icones-rapidos.js; a tela do aluno em
// paleta-tela.js; a tela do instrutor em instrutor-paleta.js. Mesmo quarteto
// de kml.js / calcos.js / camadas.js / instrutor-calcos.js da Etapa 7.

// A única importação deste arquivo, e ela não quebra a pureza: simbolos.js
// também é puro (roda em Node, é a FONTE ÚNICA do que um SIDC significa desde
// a Etapa 4.5). Duplicar aqui a lista de símbolos sem desenho seria a segunda
// cópia de sempre — a que diverge em silêncio quando a milsymbol muda.
import { sidcExigeDesignacao } from './simbolos.js';

// ── Limites ──────────────────────────────────────────────────────────────
// Os DOIS primeiros têm cópia no `check`/trigger de 0010 — e essa duplicação é
// deliberada, na mesma disciplina de três camadas que a Etapa 7 usa para o
// tamanho de calco (navegador, bucket, tabela): o cliente recusa ANTES de
// gastar a ida ao servidor e com uma frase que o usuário entende; o banco
// recusa porque é lá que a regra vale de verdade, inclusive para quem chamar a
// API direto. Se um dia mudarem, têm que mudar nos dois lugares — por isso os
// números estão nomeados aqui e comentados lá.
export const MAX_PRESETS = 12;
export const MAX_ROTULO = 14;

// Por que 12, e não "quantos o instrutor quiser": a paleta divide a tela do
// celular com o mapa. 12 botões já ocupam um cartão inteiro do painel lateral;
// acima disso ela deixa de ser um atalho e recria, sem hierarquia nenhuma para
// filtrar, o mesmo problema de navegação que o catálogo de 434 itens tem —
// que é exatamente o problema que esta função existe para resolver.

// ── Validação de um preset ───────────────────────────────────────────────
// Devolve { ok: true, valor } ou { ok: false, erro } — mesmo formato de
// validarArquivoImagem()/validarBounds() em imagem-geo.js, para as telas
// tratarem erro de um jeito só.
export function validarPreset({ rotulo, sidc, partidoId = null, ordem = 100 } = {}) {
  const r = typeof rotulo === 'string' ? rotulo.trim() : '';
  if (!r) return { ok: false, erro: 'Dê um nome curto ao botão (ex.: "CC", "Inf Mec").' };
  if (r.length > MAX_ROTULO) {
    return { ok: false, erro: `O nome do botão tem no máximo ${MAX_ROTULO} caracteres (este tem ${r.length}).` };
  }
  // O MESMO formato de perfis.sidc e elementos_marcados.sidc — APP-6D de 20
  // dígitos. Um SIDC curto ou com letra não é "quase certo": a milsymbol
  // desenha outra coisa, ou cai no ícone genérico de fallback, e o aluno marca
  // um elemento que não é o que ele escolheu.
  if (typeof sidc !== 'string' || !/^[0-9]{20}$/.test(sidc)) {
    return { ok: false, erro: 'O símbolo escolhido não produziu um SIDC válido de 20 dígitos.' };
  }
  // Um preset tem rótulo, símbolo e força — NÃO tem designação de unidade. Por
  // isso um símbolo cujo desenho central É a sigla ("Comando Nomeado") não pode
  // ser atalho: ele sairia como moldura vazia no mapa, e antes disso como botão
  // vazio na paleta. Não há o que preencher.
  //
  // Isto é uma RECUSA, não um aviso, e a diferença é o que o lugar promete. No
  // formulário de marcação existe o campo da sigla, então lá o certo é avisar e
  // deixar a pessoa decidir. Aqui a promessa da paleta é "o que está no botão é
  // o que vai para o mapa" — um botão que não consegue mostrar o que grava
  // quebra justamente aquilo por que a paleta existe.
  if (sidcExigeDesignacao(sidc)) {
    return {
      ok: false,
      erro: 'Este símbolo é desenhado com a SIGLA da unidade no centro, e um botão da paleta '
        + 'não tem onde guardar uma sigla — ele sairia vazio no mapa. Escolha um símbolo com '
        + 'desenho próprio, ou marque este pelo formulário completo, que tem o campo "Designação '
        + 'da unidade".',
    };
  }
  const o = Number.isFinite(Number(ordem)) ? Math.trunc(Number(ordem)) : 100;
  return {
    ok: true,
    valor: { rotulo: r, sidc, partidoId: partidoId || null, ordem: o },
  };
}

// Cabe mais um? Conta só o que está VIGENTE — remover um preset (exclusão
// lógica) abre vaga, e o trigger de 0010 faz a mesma conta do mesmo jeito.
export function cabeMaisUm(presetsVigentes) {
  const n = Array.isArray(presetsVigentes) ? presetsVigentes.length : 0;
  return {
    cabe: n < MAX_PRESETS,
    restam: Math.max(0, MAX_PRESETS - n),
    erro: n < MAX_PRESETS
      ? ''
      : `A paleta já tem ${MAX_PRESETS} botões, que é o máximo que cabe na tela de um celular. Remova um antes de acrescentar outro.`,
  };
}

// ── Ordenação ────────────────────────────────────────────────────────────
// `ordem` primeiro, `criado_em` para desempatar, `id` como último critério.
// O terceiro critério não é zelo: sem ele, dois presets criados no mesmo
// milissegundo (o seed padrão insere 8 numa transação só, e vários bancos
// carimbam now() igual para todos) sairiam em ordem indefinida — e a paleta
// trocaria de arranjo entre uma carga de página e outra, na mão de quem
// decorou onde ficava o botão do CC.
export function ordenarPaleta(linhas) {
  return [...(linhas || [])].sort((a, b) => {
    const oa = Number(a.ordem ?? 100);
    const ob = Number(b.ordem ?? 100);
    if (oa !== ob) return oa - ob;
    const ta = Date.parse(a.criado_em || '') || 0;
    const tb = Date.parse(b.criado_em || '') || 0;
    if (ta !== tb) return ta - tb;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

// Só o que está vigente (exclusão lógica, como calcos e elementos_marcados).
export function vigentes(linhas) {
  return (linhas || []).filter((l) => !l.removido_em);
}

// A `ordem` de um preset novo: depois do último. Espaçada de 10 para caber
// alguém no meio depois sem renumerar a lista inteira — renumerar custaria um
// UPDATE por linha, e cada UPDATE é um evento de Realtime para os 60 aparelhos
// da turma.
export const PASSO_ORDEM = 10;
export function proximaOrdem(linhas) {
  const atuais = vigentes(linhas).map((l) => Number(l.ordem ?? 0)).filter(Number.isFinite);
  if (atuais.length === 0) return PASSO_ORDEM;
  return Math.max(...atuais) + PASSO_ORDEM;
}

// ── O que acontece quando o aluno toca num preset ────────────────────────
// Esta é a regra do modo "híbrido" decidido em 2026-09-14, e o motivo de ela
// ser uma função pura em vez de um `if` dentro do handler de clique: é ela que
// diz quantos toques a marcação custa, que é a razão de a função existir.
//
//   partido_padrao_id preenchido -> 'gravar'    (um toque: preset, depois mapa)
//   partido_padrao_id nulo       -> 'perguntar' (abre SÓ o seletor de partido)
//
// Quem decide preset a preset é o INSTRUTOR, ao montar a paleta: "CC" é quase
// sempre hostil e vale gravar direto; "Vtr" pode ser tráfego civil e vale
// perguntar. Sem esse meio-termo seria preciso escolher entre velocidade
// (sempre gravar, e o aluno registra partido errado por reflexo) e segurança
// (sempre perguntar, e some metade do ganho).
//
// O formulário COMPLETO nunca desaparece: toque longo no botão abre
// abrirFormulario() já pré-preenchido com este SIDC (ver paleta-tela.js) —
// quem precisa de escalão ou designação não perde a paleta por isso.
export function modoDoPreset(preset) {
  return preset && preset.partido_padrao_id ? 'gravar' : 'perguntar';
}

// Os valores que a marcação recebe. O SIDC vai COPIADO, sem transformação
// nenhuma: quem monta SIDC neste projeto é getSIDC() (simbolos.js), e ele já
// rodou — na tela do instrutor, quando o preset foi criado. Remontar aqui
// seria uma segunda montagem do mesmo formato, exatamente o que a Etapa 4.5
// acabou ao fazer de simbolos.js a fonte única.
//
// `designacao` sai vazia de propósito: um preset diz O QUE é o elemento, e a
// designação é o número/nome da unidade observada, que ninguém sabe de
// antemão. Vazio desenha o símbolo limpo, que é o certo para um elemento
// inimigo cuja unidade não se conhece (correção de 2026-08-02).
export function valoresDaMarcacao(preset, partidoEscolhidoId = undefined) {
  return {
    sidc: preset.sidc,
    partidoId: partidoEscolhidoId !== undefined
      ? (partidoEscolhidoId || null)
      : (preset.partido_padrao_id || null),
    designacao: '',
  };
}
