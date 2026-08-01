// simbolos.js — Etapa 4.5: FONTE ÚNICA da montagem de SIDC e da hostilidade.
//
// Por que este arquivo existe
// ---------------------------
// Até a Etapa 4, as tabelas de conversão APP-6D (HOSTILIDADE, DIMENSAO,
// SITUACAO, ESCALAO, HQTF) e a função getSIDC() viviam soltas dentro do
// <script> clássico de index.html. Com a hostilidade virando RELATIVA, mais de
// um arquivo passa a precisar dessa conversão (index.html para o COP legado,
// colegas.js para os avatares, e a Etapa 5 para as marcações). Duas cópias das
// mesmas tabelas é como o SIDC começa a divergir em silêncio — então elas
// mudaram de casa para cá e index.html passou a consumir daqui.
//
// A regra da hostilidade relativa
// -------------------------------
// A hostilidade NÃO é um fato do elemento; é uma relação entre QUEM OLHA e o
// elemento. O banco (backend/supabase/0003_partidos.sql) guarda apenas o
// PARTIDO do elemento; o dígito de hostilidade do SIDC é calculado aqui, na
// hora de desenhar. O mesmo pelotão sai hostil na tela do Azul e amigo na tela
// do Vermelho, a partir da MESMA linha do banco.
//
// Este módulo é ES module, mas o <script> clássico de index.html não consegue
// fazer `import`. A ponte é `window.WartoolSimbolos`, publicada no final do
// arquivo: uma única definição, dois caminhos de acesso. A ponte some na Etapa
// 9, quando o frontend virar SPA com bundler e tudo passar a ser `import`.

// ── Tabelas de conversão APP-6D ─────────────────────────────────────────────
// Vieram de frontend/index.html sem alteração de conteúdo. Continuam sendo
// tabelas reduzidas, escritas à mão — a substituição pelas tabelas oficiais do
// `stanag-app6` está prevista na Etapa 9 e deve acontecer AQUI, num lugar só.

export const HOSTILIDADE = {
  AMIGO: '03', PRESUMIDO: '02', HOSTIL: '06', SUSPEITO: '05',
  NEUTRO: '04', DESCONHECIDO: '01',
};
export const DIMENSAO = {
  UNIDADE: '10', EQUIPAMENTO: '15', INSTALACAO: '20',
  AEREO: '05', INDIVIDUO: '27',
};
export const SITUACAO = {
  CONFIRMADA: '0', ESTIMADA: '1', PLANEJADA: '1', SUSPEITA: '1',
};
export const ESCALAO = {
  NONE: '00', SQD: '11', SEC: '12', PEL: '13', CIA: '14',
  BIA: '14', ESC: '14', BN: '15', GRU: '16', BDA: '17',
  DIV: '18', CRP: '19', EX: '20', '': '00',
};
export const HQTF = {
  '': '0', 'Nenhum': '0', 'Simulacro / Feint': '1',
  'HQ / Posto de Comando': '2', 'HQ + Simulacro': '3',
  'Força-Tarefa': '4', 'Força-Tarefa + Simulacro': '5',
  'Força-Tarefa + HQ': '6', 'Força-Tarefa + HQ + Simul': '7',
};

// Reduzida a partir de NATUREZA_MAP em legacy-qgis/cop_tatico_v7.py (mesma
// fonte que já alimentou HOSTILIDADE/DIMENSAO/SITUACAO/ESCALAO/HQTF acima),
// guardando só o código de entidade de 6 dígitos — getSIDC() já faz o
// padEnd(10) sozinho. Diferente do script legado, aqui a "dimensão" (SS) NÃO
// vem embutida no valor: quem marca escolhe DIMENSAO separadamente no
// formulário (Etapa 5), então esta tabela cobre só o "tipo/natureza" em si.
// Reduzida de propósito (não é o catálogo completo do APP-6D) — candidata a
// virar as tabelas oficiais do stanag-app6 na Etapa 9, como as demais.
export const NATUREZA = {
  'Infantaria': '121100',
  'Infantaria Mecanizada': '121103',
  'Blindado (Carro de Combate)': '121200',
  'Cavalaria': '121300',
  'Artilharia de Campanha': '130300',
  'Artilharia Antiaérea': '130100',
  'Morteiros': '130800',
  'Engenharia': '140700',
  'Comunicações / Sinal': '111000',
  'Inteligência': '150300',
  'Posto de Comando': '120000',
  'Suprimento / Logística': '163600',
  'Manutenção': '163700',
  'Saúde / Médico': '163800',
  'Instalação Militar (genérica)': '110000',
  'Depósito de Munição': '110300',
  'Viatura': '140100',
  'Desconhecido / Não identificado': '000000',
};

// Posição do par de dígitos de hostilidade dentro do SIDC de 20 dígitos:
//   10 | hostilidade(2) | dimensão(2) | situação(1) | hqtf(1) | escalão(2) | natureza(10)
//   ^^   ^^
//   0-1  2-3
const POS_HOSTILIDADE = 2;

// ── Montagem do SIDC (idêntica à que estava em index.html) ──────────────────
export function getSIDC(props) {
  if (props.sidc && props.sidc.length === 20) return props.sidc;
  const h   = HOSTILIDADE[(props.hostilidade || '').toUpperCase()] || '01';
  const d   = DIMENSAO[(props.dimensao || '').toUpperCase()] || '10';
  const s   = SITUACAO[(props.situacao || '').toUpperCase()] || '0';
  const hq  = HQTF[props.hqtf || ''] || '0';
  const e   = ESCALAO[(props.escalao || '').toUpperCase()] || '00';
  const nat = (props.natureza_code || '000000').padEnd(10, '0');
  return `10${h}${d}${s}${hq}${e}${nat}`;
}

// ── Decomposição do SIDC (inverso de getSIDC) ───────────────────────────────
// Usada pela Etapa 5 (frontend/marcacoes.js) para PRÉ-PREENCHER o formulário
// de edição de uma marcação: como só o SIDC final é gravado em
// elementos_marcados (não os rótulos humanos que o formulário usa), editar
// precisa voltar do SIDC para "que dimensão/escalão/natureza foi escolhida".
// Funciona porque DIMENSAO/ESCALAO/NATUREZA são tabelas REDUZIDAS e
// conhecidas: procura, em cada uma, a CHAVE cujo valor bate com o trecho
// correspondente do SIDC. Mora aqui (não em marcacoes.js) pelo mesmo motivo
// de getSIDC() morar aqui: é o par assembla/desmonta do MESMO formato de
// SIDC, e simbolos.js é a fonte única dele — duas cópias da mesma tabela é
// como a leitura de volta do SIDC começa a divergir da montagem em silêncio.
export function chavePorValor(tabela, valor) {
  return Object.keys(tabela).find((k) => tabela[k] === valor) || '';
}

export function decomporSidc(sidc) {
  if (typeof sidc !== 'string' || !/^[0-9]{20}$/.test(sidc)) {
    return { dimensao: '', escalao: '', natureza: '' };
  }
  const dimensao = chavePorValor(DIMENSAO, sidc.slice(4, 6));
  const escalao = chavePorValor(ESCALAO, sidc.slice(8, 10));
  // NATUREZA guarda códigos de 6 dígitos; getSIDC() os estende para 10 com
  // padEnd — por isso a comparação usa só os 6 primeiros dígitos do trecho.
  const natureza = chavePorValor(NATUREZA, sidc.slice(10, 16));
  return { dimensao, escalao, natureza };
}

// ── Hostilidade relativa ────────────────────────────────────────────────────
// Recebe DOIS partidos, no formato { id, tipo, ordem }, onde `tipo` é
// 'beligerante' ou 'neutro' e `ordem` é a coluna de mesmo nome em
// `partidos` (Azul = 1, Vermelho = 2 por padrão). Devolve a chave de
// HOSTILIDADE a usar, ou `null` quando não há como afirmar nada — e `null`
// aqui significa "não mexa no SIDC gravado", não "desconhecido".
//
// Note que o 'neutro' é decidido pela COLUNA `tipo` do partido, e não por uma
// lista de nomes aqui dentro: é isso que permite acrescentar um partido
// "civil" ou "imprensa" com um INSERT no banco, sem tocar neste arquivo.
//
// CORREÇÃO na Etapa 11 (relatado em campo: "o instrutor vê os dois partidos
// como azul"). Até então, observador sem partido SEMPRE devolvia `null`
// (passthrough), pensado para o caso "ninguém tem partido ainda" — mas o
// mesmo caminho também é o do INSTRUTOR (que nunca tem partido, por design,
// e enxerga os dois lados ao mesmo tempo em frontend/situacao.js). Como o
// SIDC gravado em `perfis.sidc`/`elementos_marcados.sidc` tem SEMPRE o
// placeholder de hostilidade AMIGO (`03` — é o default do schema), o
// passthrough fazia Azul e Vermelho desenharem IDÊNTICOS para o instrutor.
// A ORDEM DESTAS GUARDAS CONTINUA IMPORTANDO (há teste em simbolos.teste.mjs):
export function hostilidadeRelativa(partidoObservador, partidoElemento) {
  const ele = partidoElemento || null;
  const obs = partidoObservador || null;

  // Observador E elemento sem partido: é a chamada "self" do próprio avatar
  // (ver icones.js — gps.js não passa nenhum dos dois). Não há relação
  // nenhuma a derivar aqui, então não se afirma nada — precisa vir ANTES de
  // qualquer outra guarda, senão o próprio avatar de quem ainda não tem
  // partido passaria a desenhar como DESCONHECIDO.
  if ((!obs || !obs.id) && (!ele || !ele.id)) return null;

  // Elemento sem partido, mas ALGUÉM está de fato olhando (com ou sem
  // partido): "vi alguém, não sei de quem é" — é uma afirmação de verdade, e
  // não falta de contexto.
  if (!ele || !ele.id) return 'DESCONHECIDO';

  // Um partido neutro é neutro para todo mundo, inclusive para ele mesmo —
  // não depende de o observador ter partido.
  if (ele.tipo === 'neutro') return 'NEUTRO';

  if (obs && obs.id) {
    if (obs.id === ele.id) return 'AMIGO';
    // Observador neutro não tem inimigos.
    if (obs.tipo === 'neutro') return 'NEUTRO';
    // Dois beligerantes diferentes.
    return 'HOSTIL';
  }

  // Observador SEM partido, mas o ELEMENTO tem um conhecido — tipicamente o
  // instrutor olhando um aluno já distribuído numa força. Não existe "eu"
  // para comparar, então isto NÃO é hostilidade relativa de verdade: é uma
  // referência FIXA (o partido de menor `ordem` da turma — Azul, por
  // padrão — conta como "amigo"/azul; qualquer outro beligerante conta como
  // "hostil"/vermelho) só para dar distinção visual às duas forças na tela
  // do instrutor, na mesma convenção de cor já usada nos calcos (Etapa 7.1:
  // "azul e vermelho são os mesmos tons da legenda de forças"). Se o
  // chamador não mandar `ordem` (embed antigo, não atualizado), não dá para
  // saber qual referência usar — melhor devolver `null` (preserva o SIDC)
  // do que arriscar uma cor errada.
  if (typeof ele.ordem === 'number') return ele.ordem <= 1 ? 'AMIGO' : 'HOSTIL';
  return null;
}

// Troca os dígitos 3-4 de um SIDC de 20 dígitos pelo par de hostilidade.
// `hostilidade` é uma chave de HOSTILIDADE ('AMIGO', 'HOSTIL', ...).
export function aplicarHostilidade(sidc, hostilidade) {
  const par = HOSTILIDADE[(hostilidade || '').toUpperCase()];
  if (!par) return sidc;
  if (typeof sidc !== 'string' || !/^[0-9]{20}$/.test(sidc)) return sidc;
  return sidc.slice(0, POS_HOSTILIDADE) + par + sidc.slice(POS_HOSTILIDADE + 2);
}

// O atalho que quase todo chamador quer: "me dê o SIDC deste elemento COMO
// ELE DEVE APARECER para este observador".
//
// É por aqui que passam o avatar do colega (colegas.js) e, na Etapa 5, a
// marcação no mapa. O SIDC gravado no banco tem os dígitos de hostilidade
// como PLACEHOLDER — quem lê o banco cru não deve confiar neles.
export function sidcParaObservador(sidc, partidoObservador, partidoElemento) {
  const h = hostilidadeRelativa(partidoObservador, partidoElemento);
  if (!h) return sidc;
  return aplicarHostilidade(sidc, h);
}

// ── Ponte para o <script> clássico de index.html ────────────────────────────
// Um <script> sem type="module" não pode fazer `import`. Em vez de duplicar as
// tabelas lá (que é exatamente o problema que este arquivo resolve), o módulo
// se publica em `window.WartoolSimbolos` e index.html consome de lá.
// Módulos são deferred: este bloco roda depois do parsing do HTML e ANTES do
// DOMContentLoaded — por isso index.html só chama as funções de dentro de um
// listener de DOMContentLoaded.
if (typeof window !== 'undefined') {
  window.WartoolSimbolos = {
    HOSTILIDADE, DIMENSAO, SITUACAO, ESCALAO, HQTF, NATUREZA,
    getSIDC, decomporSidc, hostilidadeRelativa, aplicarHostilidade, sidcParaObservador,
  };
}
