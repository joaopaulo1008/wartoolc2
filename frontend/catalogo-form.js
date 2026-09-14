// catalogo-form.js — os <option> do catálogo oficial do MD/EB (2026-09-14).
//
// Extraído de marcacoes.js ao ganhar o segundo consumidor: o painel de ícones
// rápidos do instrutor (instrutor-paleta.js) monta o SIDC de um preset pelos
// MESMOS quatro seletores hierárquicos que o aluno usa para marcar
// (categoria -> ícone central -> modificador 1 -> modificador 2), mais o
// escalão.
//
// É o critério de sempre neste projeto — icones.js na Etapa 5,
// buscarPartidosDaTurma na 6a, vigia-ausencia.js na 6c, basemaps.js na 7.1:
// a segunda cópia de uma regra é a que diverge em silêncio. E aqui a
// divergência seria cara e invisível: se o painel do instrutor montasse a
// lista por conta própria, ele poderia oferecer uma combinação categoria +
// entidade que não existe, gerar um SIDC que a milsymbol desenha como outra
// coisa, e a paleta inteira da turma passaria a marcar o elemento errado —
// que é, na letra, o bug que a Etapa 9b descobriu nas tabelas escritas à mão.
//
// Puro: só strings de HTML a partir do catálogo. Sem DOM, sem Leaflet, sem
// Supabase — testável em Node (paleta.teste.mjs cobre a montagem do SIDC que
// estes seletores alimentam).
import {
  CATEGORIAS, itensDaCategoria, ESCALAO_ROTULO, categoriaPorId, exigeDesignacao,
} from './simbolos.js';

// Escapa para uso dentro de texto e de atributo. `escapar` existia em duas
// cópias (marcacoes.js e camadas.js); esta é a que serve ao catálogo.
export function escaparHtmlCurto(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function opcoesCategoria(idSelecionado) {
  return CATEGORIAS
    .map((c) => `<option value="${c.id}"${c.id === idSelecionado ? ' selected' : ''}>${escaparHtmlCurto(c.nome)}</option>`)
    .join('');
}

// Os ícones centrais de UMA categoria, com <optgroup> por entidade APP-6D.
// O rótulo mostrado é o `NomeBR` puro — sem o sufixo de desambiguação que a
// tabela plana NATUREZA usa, porque aqui a categoria já foi escolhida (ver o
// comentário de `chaveNatureza()` em simbolos.js).
//
// `somenteComDesenho` (2026-09-14) tira da lista os símbolos cujo desenho
// central É a sigla da unidade — hoje um só, "Comando Nomeado" (`10:000000`),
// que por azar é a PRIMEIRA opção da categoria "Unidades" e portanto a que
// vem selecionada sozinha quando alguém abre aquela categoria e não mexe.
//
// Quem liga isso é a aba de montagem da paleta, e só ela: um preset não tem
// campo de designação, então essa opção ali é uma armadilha — some do mapa
// como losango vazio, que foi o defeito relatado em campo. No FORMULÁRIO DE
// MARCAÇÃO a opção continua aparecendo, porque lá existe o campo da sigla e o
// símbolo funciona; o que aquele lado faz é avisar quando o campo está vazio.
//
// Filtrar aqui, e não só recusar em validarPreset(), é o que evita a interface
// que oferece e depois nega. A recusa continua existindo como barreira — se um
// SIDC assim chegar por outro caminho, ele para lá.
export function opcoesItem(categoriaId, codigoSelecionado, { somenteComDesenho = false } = {}) {
  const categoria = categoriaPorId(categoriaId);
  const symbolSet = categoria ? categoria.symbolSet : '';
  return itensDaCategoria(categoriaId)
    .map((grupo) => {
      // O terceiro elemento da tupla, quando existe, é a OBSERVAÇÃO que o
      // portal trazia colada no nome ("código específico apenas para
      // compatibilidade com a OTAN", sinônimos, código OTAN de posto). Vai
      // como `title=`, não no rótulo: num <select> de celular ela empurraria
      // o nome para fora da tela — que é o mesmo problema que a correção de
      // 2026-08-02 resolveu no mapa.
      const itens = somenteComDesenho
        ? grupo.itens.filter(([codigo]) => !exigeDesignacao(symbolSet, codigo))
        : grupo.itens;
      // Um <optgroup> vazio ainda desenha o cabeçalho do grupo no <select> —
      // "Comando e Controle não especificado" é um grupo de UM item, então sem
      // isto o filtro deixaria um título de seção sem nada embaixo.
      if (itens.length === 0) return '';
      const opcoes = itens
        .map(([codigo, nome, observacao]) =>
          `<option value="${codigo}"${codigo === codigoSelecionado ? ' selected' : ''}` +
          `${observacao ? ` title="${escaparHtmlCurto(observacao)}"` : ''}>${escaparHtmlCurto(nome)}</option>`)
        .join('');
      return `<optgroup label="${escaparHtmlCurto(grupo.nome)}">${opcoes}</optgroup>`;
    })
    .join('');
}

// Modificador é opcional: o código '00' ("Não especificado") já vem do
// catálogo como primeira linha de toda tabela, então não é preciso inventar
// uma opção vazia aqui.
export function opcoesModificador(lista, codigoSelecionado) {
  return (lista || [])
    .map(([codigo, rotulo, observacao]) =>
      `<option value="${codigo}"${codigo === codigoSelecionado ? ' selected' : ''}` +
      `${observacao ? ` title="${escaparHtmlCurto(observacao)}"` : ''}>${escaparHtmlCurto(rotulo)}</option>`)
    .join('');
}

export function opcoesEscalao(chaveSelecionada) {
  // ESCALAO tem chaves sinônimas (CIA/BIA/ESC valem '14') e uma chave ''
  // sinônima de NONE — as duas coisas existem para aceitar entrada vinda de
  // dados antigos e do CSV do seed, não para virarem opções repetidas no
  // <select>. Mostramos só as que têm rótulo próprio em ESCALAO_ROTULO.
  return Object.keys(ESCALAO_ROTULO)
    .map((chave) =>
      `<option value="${chave}"${chave === chaveSelecionada ? ' selected' : ''}>${escaparHtmlCurto(ESCALAO_ROTULO[chave])}</option>`)
    .join('');
}
