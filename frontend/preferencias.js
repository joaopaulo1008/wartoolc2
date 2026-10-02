// preferencias.js — a FONTE ÚNICA das preferências de visualização do próprio
// usuário (`perfis.preferencias_visualizacao`).
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
// ── De uma chave para um REGISTRO (2026-10-02) ─────────────────────────────
// A Etapa 9b escreveu aqui que o encanamento existia "para a próxima chave
// ser barata". Não existia: estava cravado numa chave só — uma variável
// `formatoAtual`, um conjunto de observadores, uma função de gravação. A
// grade de quadrículas é a SEGUNDA chave, e pela regra do projeto ("extrair
// na SEGUNDA vez", como `catalogo-form.js`, `basemaps.js`, `toque-longo.js`)
// a generalização acontece agora, não na terceira.
//
// O que mudou: existe um REGISTRO de chaves, cada uma com o próprio padrão,
// o próprio validador e os próprios observadores. O que NÃO mudou: as cinco
// exportações que os seis consumidores já usam continuam com a mesma
// assinatura e o mesmo contrato — `gps.js`, `colegas.js`, `marcacoes.js`,
// `menu-contexto.js`, `situacao.js`, `index.html` e `instrutor.html` não
// precisaram de uma linha de mudança. Elas agora são casca fina sobre o
// registro.
//
// Por que a formatação de coordenada passa por AQUI e não é chamada direto
// -----------------------------------------------------------------------
// `coordenadas.js` é puro: sabe converter, não sabe qual formato o usuário
// escolheu. As telas que mostram coordenada precisam das duas coisas juntas.
// Se cada uma lesse a preferência por conta própria, teríamos vários lugares
// para esquecer de atualizar quando o formato mudasse — que é exatamente o
// bug "mudei o formato e o popup do colega continuou em UTM". Então há uma
// função só, `formatarCoordenada()`, e todas chamam ela.

import { supabase } from './auth.js';
import {
  FORMATO_PADRAO, formatoValido, formatar as formatarComFormato,
} from './coordenadas.js';
import { MODO_PADRAO as GRADE_PADRAO, modoValido as gradeValida } from './grade.js';

// ── O registro de chaves ────────────────────────────────────────────────────
// `chave` é o nome DENTRO do jsonb (snake_case, como o resto do banco).
// `validar` recusa valor estranho — e recusar aqui, na leitura, é o que faz
// uma edição manual no banco ou uma versão futura do app gravando um valor
// desconhecido cair no padrão em vez de deixar a tela sem nada.
const REGISTRO = new Map([
  ['formato_coordenada', { padrao: FORMATO_PADRAO, validar: formatoValido }],
  ['grade',              { padrao: GRADE_PADRAO,   validar: gradeValida }],
]);

// Estado por chave: valor em vigor e quem quer ser avisado.
const estado = new Map();
for (const [chave, def] of REGISTRO) {
  estado.set(chave, { valor: def.padrao, observadores: new Set() });
}

let meuUserId = null;
// O objeto jsonb inteiro, para uma gravação não apagar as chaves das outras.
let preferenciasAtuais = {};

// ── Leitura, escrita e observação genéricas ────────────────────────────────
export function valorPreferencia(chave) {
  const e = estado.get(chave);
  return e ? e.valor : undefined;
}

// Mesmo contrato de observarPermissao(): chama o callback IMEDIATAMENTE com o
// valor atual (quem observa não precisa duplicar "e o estado inicial?") e de
// novo a cada mudança. Devolve a função de cancelamento.
export function observarPreferencia(chave, callback) {
  const e = estado.get(chave);
  if (!e) return () => {};
  e.observadores.add(callback);
  try {
    callback(e.valor);
  } catch (erro) {
    console.error(`Observador de "${chave}" falhou na chamada inicial:`, erro);
  }
  return () => e.observadores.delete(callback);
}

function notificar(chave) {
  const e = estado.get(chave);
  if (!e) return;
  for (const cb of e.observadores) {
    try {
      cb(e.valor);
    } catch (erro) {
      console.error(`Observador de "${chave}" falhou:`, erro);
    }
  }
}

// Otimista de propósito: o valor local muda e os observadores são avisados
// ANTES de o banco confirmar. É o que faz o "efeito imediato, sem recarregar"
// ser imediato de verdade num celular com rede ruim — e o custo de errar é
// ridículo (a tela mostra o que a pessoa acabou de pedir, e na próxima carga
// volta ao que estava gravado).
//
// A gravação usa `update` com o jsonb inteiro, não um `jsonb_set` no
// servidor, porque o cliente já tem o objeto completo em mãos e porque
// misturar as duas formas seria uma segunda maneira de escrever a mesma
// coluna.
export async function definirPreferencia(chave, valor) {
  const def = REGISTRO.get(chave);
  const e = estado.get(chave);
  if (!def || !e) return false;
  if (!def.validar(valor)) return false;
  if (valor === e.valor) return true;

  e.valor = valor;
  preferenciasAtuais = { ...preferenciasAtuais, [chave]: valor };
  notificar(chave);

  if (!meuUserId) return true;  // ainda não iniciado (ou tela sem sessão): só local

  const { error } = await supabase
    .from('perfis')
    .update({ preferencias_visualizacao: preferenciasAtuais })
    .eq('id', meuUserId);

  if (error) {
    // Não desfaz a mudança local: ver o comentário sobre otimismo acima. O
    // console é o canal certo aqui — um alert() no meio de um exercício, por
    // causa de uma preferência de exibição, seria pior que o problema.
    console.error(`Não foi possível gravar a preferência "${chave}":`, error);
    return false;
  }
  return true;
}

// ── Formato de coordenada ───────────────────────────────────────────────────
// Casca fina sobre o registro. Mesma assinatura de sempre.
export function formatoCoordenada() {
  return valorPreferencia('formato_coordenada');
}

// O ÚNICO jeito de escrever uma coordenada na tela neste app. Combina o
// "como converter" (coordenadas.js, puro) com o "qual formato" (aqui).
export function formatarCoordenada(lat, lon) {
  return formatarComFormato(lat, lon, valorPreferencia('formato_coordenada'));
}

export function observarFormatoCoordenada(callback) {
  return observarPreferencia('formato_coordenada', callback);
}

export async function definirFormatoCoordenada(formato) {
  return definirPreferencia('formato_coordenada', formato);
}

// ── Grade de quadrículas (2026-10-02) ──────────────────────────────────────
// 'off' | 'utm' | 'geo'. A validação e o padrão moram em `grade.js`, que é o
// dono do conceito — aqui só se guarda a escolha. Mesma divisão de
// `coordenadas.js` (sabe converter) e este arquivo (sabe o que foi escolhido).
export function modoGrade() {
  return valorPreferencia('grade');
}

export function observarModoGrade(callback) {
  return observarPreferencia('grade', callback);
}

export async function definirModoGrade(modo) {
  return definirPreferencia('grade', modo);
}

// ── Ponto de entrada ────────────────────────────────────────────────────────
// `perfil` é o objeto que `buscarPerfil()` (auth.js) já devolve — e que já
// traz `preferencias_visualizacao` no select desde a Etapa 4.5. Nenhuma
// consulta nova é feita aqui.
//
// Chave ausente ou com valor estranho (edição manual no banco, versão futura
// do app gravando um valor que esta ainda não conhece) cai no padrão, sem
// avisar nada — é preferência de exibição, não configuração crítica.
export function iniciarPreferencias({ userId, perfil } = {}) {
  meuUserId = userId || null;
  const prefs = (perfil && perfil.preferencias_visualizacao) || {};
  preferenciasAtuais = typeof prefs === 'object' && prefs !== null ? { ...prefs } : {};

  for (const [chave, def] of REGISTRO) {
    const e = estado.get(chave);
    const gravado = preferenciasAtuais[chave];
    e.valor = def.validar(gravado) ? gravado : def.padrao;
    notificar(chave);
  }
  return valorPreferencia('formato_coordenada');
}

// Teardown simétrico ao de permissoes.js/marcacoes.js. Ninguém chama isto
// hoje — a preferência é do USUÁRIO, não da turma, então trocar de turma em
// `situacao.js` não deveria mesmo resetá-la. Existe para o caso de uma tela
// futura precisar trocar de usuário sem recarregar a página, que é o único
// cenário em que o estado daqui fica errado.
export function pararPreferencias() {
  meuUserId = null;
  preferenciasAtuais = {};
  for (const [chave, def] of REGISTRO) {
    const e = estado.get(chave);
    e.observadores.clear();
    e.valor = def.padrao;
  }
}
