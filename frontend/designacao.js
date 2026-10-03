// designacao.js — a numeração do "calunga" (o símbolo militar no mapa).
//
// Cada símbolo pode levar um número à ESQUERDA (a designação da fração) e um à
// DIREITA (a fração a que ela pertence): o 1º Pelotão do 2º Esquadrão é
// "1 [símbolo] 2", com os três pontos do escalão PEL acima do quadro (os pontos
// já vêm do SIDC, não daqui). Além dos números há o NOME DA FRAÇÃO (texto curto
// livre), que aparece só no popup.
//
// Os três campos moram em perfis (migration 0018) e só o instrutor os define.
//
// Módulo PURO (sem DOM, sem Supabase): testado em designacao.teste.mjs.

// Têm que ser IGUAIS aos CHECKs da migration 0018 e às validações de
// importar-turma.js e da Edge Function — importar-turma.teste.mjs confere.
export const NUMERO_MAXIMO = 4;
export const FRACAO_MAXIMA = 20;

// Texto digitado → valor gravável. Vazio (ou só espaços) vira null: no banco
// "sem número" é NULL, nunca string vazia (o CHECK recusa vazio).
export function normalizarCampo(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

// Devolve { ok:true, valor } ou { ok:false, erro }.
export function validarNumero(v, rotulo = 'Número') {
  const valor = normalizarCampo(v);
  if (valor && valor.length > NUMERO_MAXIMO) {
    return { ok: false, erro: `${rotulo}: no máximo ${NUMERO_MAXIMO} caracteres.` };
  }
  return { ok: true, valor };
}

export function validarFracao(v) {
  const valor = normalizarCampo(v);
  if (valor && valor.length > FRACAO_MAXIMA) {
    return { ok: false, erro: `Nome da fração: no máximo ${FRACAO_MAXIMA} caracteres.` };
  }
  return { ok: true, valor };
}

// O que um perfil entrega ao desenho do símbolo.
//
// Regra de compatibilidade: SEM nenhum número, o símbolo continua mostrando o
// nome de guerra ao lado (como sempre foi — contas antigas e bancos sem a 0018
// não mudam). COM pelo menos um número, os números assumem a identificação e o
// nome de guerra sai do desenho (quem olha identifica a conta pelo usuário).
export function opcoesDeDesignacao(perfil) {
  const esq = normalizarCampo(perfil?.numero_esq);
  const dir = normalizarCampo(perfil?.numero_dir);
  if (esq || dir) return { designacao: '', numeroEsq: esq || '', numeroDir: dir || '' };
  return { designacao: normalizarCampo(perfil?.nome_guerra) || '', numeroEsq: '', numeroDir: '' };
}

// Chave que muda quando o DESENHO muda: quem redesenha ao vivo compara isto.
export function chaveDeDesenho(perfil) {
  return [perfil?.sidc, perfil?.nome_guerra, perfil?.numero_esq, perfil?.numero_dir].map((x) => x ?? '').join('|');
}

// Linha do popup. '' quando não há nome de fração.
export function nomeDaFracao(perfil) {
  return normalizarCampo(perfil?.nome_fracao) || '';
}

// "1 / 2" para listas (painel do instrutor).
export function resumoDosNumeros(perfil) {
  const e = normalizarCampo(perfil?.numero_esq);
  const d = normalizarCampo(perfil?.numero_dir);
  if (!e && !d) return '';
  return `${e ?? '·'} | ${d ?? '·'}`;
}

// Para texto que vai dentro de HTML de popup. O nome da fração vem de uma coluna
// que o instrutor escreve (ou uma planilha), então nunca entra cru no HTML.
export function escaparTexto(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
