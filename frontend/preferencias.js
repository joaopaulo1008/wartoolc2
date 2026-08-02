// preferencias.js — Etapa 9b: a FONTE ÚNICA das preferências de
// visualização do próprio usuário (`perfis.preferencias_visualizacao`).
//
// Preferência NÃO é permissão
// ---------------------------
// A distinção é do projeto desde a Etapa 4.5 e vale repetir aqui, porque
// este arquivo e `permissoes.js` se parecem por fora (os dois têm um valor
// central e observadores) e são coisas opostas por dentro:
//
//   permissoes.js  — o que o INSTRUTOR deixa ver. Mora na RLS e nas tabelas
//                    de permissão; o cliente só obedece. Mudança vem de fora.
//   preferencias.js — o que o USUÁRIO escolhe ver. Mora numa coluna que o
//                    próprio dono edita; ninguém mais é afetado. Mudança vem
//                    de dentro.
//
// Por isso aqui não há canal de Realtime nem fallback permissivo: a única
// pessoa que muda esta preferência é quem está olhando para a tela.
//
// O QUE ESTE MÓDULO COBRE, HOJE: só `formato_coordenada`.
// -------------------------------------------------------
// `preferencias_visualizacao` (jsonb) existe desde a 0003 e nunca tinha sido
// consumida por interface nenhuma — a "interface de filtros" prometida lá
// continua pendente, e a Etapa 9b deliberadamente NÃO a fez (ver o "NÃO
// implemente" do prompt da etapa). O que esta etapa fez foi a primeira chave
// de verdade, e o encanamento (ler do perfil, gravar de volta, avisar quem
// desenha) para a próxima chave ser barata.
//
// Por que a formatação de coordenada passa por AQUI e não é chamada direto
// -----------------------------------------------------------------------
// `coordenadas.js` é puro: sabe converter, não sabe qual formato o usuário
// escolheu. As três telas que mostram coordenada (gps.js, colegas.js,
// marcacoes.js) precisam das duas coisas juntas. Se cada uma lesse a
// preferência por conta própria, teríamos três lugares para esquecer de
// atualizar quando o formato mudasse — que é exatamente o bug "mudei o
// formato e o popup do colega continuou em UTM". Então há uma função só,
// `formatarCoordenada()`, e as três chamam ela.

import { supabase } from './auth.js';
import {
  FORMATO_PADRAO, formatoValido, formatar as formatarComFormato,
} from './coordenadas.js';

// ── Estado do módulo ────────────────────────────────────────────────────────
let meuUserId = null;
let formatoAtual = FORMATO_PADRAO;
const observadores = new Set();

// ── Leitura ─────────────────────────────────────────────────────────────────
export function formatoCoordenada() {
  return formatoAtual;
}

// O ÚNICO jeito de escrever uma coordenada na tela neste app. Combina o
// "como converter" (coordenadas.js, puro) com o "qual formato" (aqui).
export function formatarCoordenada(lat, lon) {
  return formatarComFormato(lat, lon, formatoAtual);
}

// Mesmo contrato de observarPermissao(): chama o callback IMEDIATAMENTE com o
// valor atual (quem observa não precisa duplicar "e o estado inicial?") e de
// novo a cada mudança. Devolve a função de cancelamento.
export function observarFormatoCoordenada(callback) {
  observadores.add(callback);
  try {
    callback(formatoAtual);
  } catch (e) {
    console.error('Observador de formato de coordenada falhou na chamada inicial:', e);
  }
  return () => observadores.delete(callback);
}

function notificar() {
  for (const cb of observadores) {
    try {
      cb(formatoAtual);
    } catch (e) {
      console.error('Observador de formato de coordenada falhou:', e);
    }
  }
}

// ── Escrita ─────────────────────────────────────────────────────────────────
// Otimista de propósito: o valor local muda e os observadores são avisados
// ANTES de o banco confirmar. É o que faz o "efeito imediato, sem recarregar"
// ser imediato de verdade num celular com rede ruim — e o custo de errar é
// ridículo (a tela mostra a coordenada no formato que a pessoa acabou de
// pedir, e na próxima carga volta ao que estava gravado).
//
// A gravação usa `update` com merge do jsonb inteiro, não um `jsonb_set` no
// servidor, porque o cliente já tem o objeto completo em mãos e porque
// misturar as duas formas seria uma segunda maneira de escrever a mesma
// coluna. `preferenciasAtuais` guarda o resto do objeto para as chaves
// futuras (filtros de camada) não serem apagadas por esta gravação.
let preferenciasAtuais = {};

export async function definirFormatoCoordenada(formato) {
  if (!formatoValido(formato)) return false;
  if (formato === formatoAtual) return true;

  formatoAtual = formato;
  preferenciasAtuais = { ...preferenciasAtuais, formato_coordenada: formato };
  notificar();

  if (!meuUserId) return true;  // ainda não iniciado (ou tela sem sessão): só local

  const { error } = await supabase
    .from('perfis')
    .update({ preferencias_visualizacao: preferenciasAtuais })
    .eq('id', meuUserId);

  if (error) {
    // Não desfaz a mudança local: ver o comentário sobre otimismo acima. O
    // console é o canal certo aqui — um alert() no meio de um exercício, por
    // causa de uma preferência de exibição, seria pior que o problema.
    console.error('Não foi possível gravar o formato de coordenada:', error);
    return false;
  }
  return true;
}

// ── Ponto de entrada ────────────────────────────────────────────────────────
// `perfil` é o objeto que `buscarPerfil()` (auth.js) já devolve — e que já
// traz `preferencias_visualizacao` no select desde a Etapa 4.5, sem nunca ter
// sido lido. Nenhuma consulta nova é feita aqui: a Etapa 9b só passou a usar
// um dado que já vinha no mesmo round-trip.
//
// Chave ausente ou com valor estranho (edição manual no banco, versão futura
// do app gravando um formato que esta ainda não conhece) cai no padrão, sem
// avisar nada — é preferência de exibição, não configuração crítica.
export function iniciarPreferencias({ userId, perfil } = {}) {
  meuUserId = userId || null;
  const prefs = (perfil && perfil.preferencias_visualizacao) || {};
  preferenciasAtuais = typeof prefs === 'object' && prefs !== null ? { ...prefs } : {};

  const gravado = preferenciasAtuais.formato_coordenada;
  formatoAtual = formatoValido(gravado) ? gravado : FORMATO_PADRAO;
  notificar();
  return formatoAtual;
}

// Teardown simétrico ao de permissoes.js/marcacoes.js. Ninguém chama isto
// hoje — a preferência é do USUÁRIO, não da turma, então trocar de turma em
// `situacao.js` não deveria mesmo resetá-la. Existe para o caso de uma tela
// futura precisar trocar de usuário sem recarregar a página, que é o único
// cenário em que o estado daqui fica errado.
export function pararPreferencias() {
  observadores.clear();
  meuUserId = null;
  preferenciasAtuais = {};
  formatoAtual = FORMATO_PADRAO;
}
