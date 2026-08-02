// simbolos.js — Etapa 4.5: FONTE ÚNICA da montagem de SIDC e da hostilidade.
//               Etapa 9b: a FONTE DOS DADOS passou a ser o catálogo oficial.
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
// Até a Etapa 9a, o <script> clássico de index.html não conseguia fazer
// `import` — a ponte era `window.WartoolSimbolos`, publicada no final deste
// arquivo. Com o bundler (Vite), index.html virou um module de verdade e
// importa getSIDC()/etc. direto daqui; a ponte foi removida.
//
// O que a Etapa 9b mudou aqui (e o que ela NÃO mudou)
// ---------------------------------------------------
// MUDOU: `DIMENSAO` e `NATUREZA`, que eram tabelas reduzidas escritas à mão
// (a partir de `legacy-qgis/cop_tatico_v7.py`), agora são DERIVADAS do
// catálogo oficial do Portal de Simbologia Militar do MD/EB — 12 categorias,
// 434 ícones centrais com o rótulo em português (`NomeBR`) e 488
// modificadores. Ver `frontend/simbolos-catalogo.js` (gerado) e
// `data/simbologia-eb/PROCEDENCIA.md` (de onde veio, com SHA-256 e data).
//
// NÃO MUDOU: a API pública. `getSIDC()`, `decomporSidc()`, `chavePorValor()`,
// `hostilidadeRelativa()`, `aplicarHostilidade()` e `sidcParaObservador()`
// continuam com a mesma assinatura e o mesmo contrato — é isso que faz
// `icones.js`, `gps.js`, `colegas.js`, `index.html` e
// `backend/seed/criar_usuarios.mjs` não precisarem de uma linha de mudança.
// `decomporSidc()` passou a devolver CAMPOS A MAIS (categoria, código de
// entidade, modificadores, situação, hqtf); os três que já devolvia continuam
// significando o mesmo.
//
// NÃO MUDOU TAMBÉM: a hostilidade continua fora do catálogo, de propósito. O
// portal não publica tabela de hostilidade porque, no APP-6D, ela é um campo
// de quem observa — exatamente a decisão da Etapa 4.5.

import { CATEGORIAS, NOMES_REPETIDOS } from './simbolos-catalogo.js';

export { CATEGORIAS };

// ── Tabelas que continuam escritas à mão, e por quê ─────────────────────────
// Os 12 arquivos do portal cobrem o SYMBOL SET (dígitos 5-6), a ENTIDADE
// (11-16) e os dois MODIFICADORES (17-20). Os quatro campos abaixo ficam nos
// dígitos 3-4 (hostilidade), 7 (situação), 8 (HQ/TF/simulacro) e 9-10
// (escalão) — os "amplificadores" do APP-6D, que o portal não publica como
// tabela porque não são parte do catálogo de símbolos: são atributos de como
// AQUELE símbolo aparece, não de o que ele é. Continuam vindo de
// `legacy-qgis/cop_tatico_v7.py`, sem alteração de conteúdo desde a Etapa 4.5.

export const HOSTILIDADE = {
  AMIGO: '03', PRESUMIDO: '02', HOSTIL: '06', SUSPEITO: '05',
  NEUTRO: '04', DESCONHECIDO: '01',
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

// Rótulos em português para ESCALAO — antes o <select> mostrava a própria
// chave ("SQD", "PEL"), que é a abreviação em inglês do APP-6D. Com o resto
// do formulário em português oficial (Etapa 9b), manter só a sigla ficaria
// destoante. A CHAVE não muda (é ela que vai para getSIDC() e que o CSV do
// seed usa) — só o que se mostra na tela.
export const ESCALAO_ROTULO = {
  NONE: 'Sem escalão',
  SQD: 'Esquadra / Grupo de Combate',
  SEC: 'Seção / Pelotão pequeno',
  PEL: 'Pelotão',
  CIA: 'Companhia',
  BIA: 'Bateria',
  ESC: 'Esquadrão',
  BN: 'Batalhão',
  GRU: 'Grupo / Regimento',
  BDA: 'Brigada',
  DIV: 'Divisão',
  CRP: 'Corpo de Exército',
  EX: 'Exército',
};

// ── Índices do catálogo ─────────────────────────────────────────────────────
// Montados uma vez, na carga do módulo. São só Maps sobre o array já
// importado — nada de cópia dos dados.
const porId = new Map();
const porSymbolSet = new Map();
for (const cat of CATEGORIAS) {
  porId.set(cat.id, cat);
  porSymbolSet.set(cat.symbolSet, cat);
}

export function categoriaPorId(id) { return porId.get(id) || null; }
export function categoriaPorSymbolSet(ss) { return porSymbolSet.get(ss) || null; }

// Dentro de uma categoria: código de 6 dígitos -> NomeBR, e o inverso.
const nomePorCodigo = new Map();  // `${catId}|${codigo}` -> NomeBR
const codigoPorNome = new Map();  // `${catId}|${NomeBR}` -> codigo
for (const cat of CATEGORIAS) {
  for (const grupo of cat.grupos) {
    for (const [codigo, nome] of grupo.itens) {
      nomePorCodigo.set(`${cat.id}|${codigo}`, nome);
      codigoPorNome.set(`${cat.id}|${nome}`, codigo);
    }
  }
}

// O NomeBR oficial de um item, ou '' se não existir naquela categoria.
export function nomeDoItem(categoriaId, codigo) {
  return nomePorCodigo.get(`${categoriaId}|${codigo}`) || '';
}
export function codigoDoItem(categoriaId, nome) {
  return codigoPorNome.get(`${categoriaId}|${nome}`) || '';
}

// Rótulo de modificador dentro de uma categoria ('' quando o código não
// existe lá — modificador é opcional e nem toda categoria tem os dois).
function rotuloModificador(categoria, campo, codigo) {
  if (!categoria || !codigo || codigo === '00') return '';
  const achado = categoria[campo].find(([c]) => c === codigo);
  return achado ? achado[1] : '';
}
export function nomeDoModificador1(categoriaId, codigo) {
  return rotuloModificador(porId.get(categoriaId), 'mod1', codigo);
}
export function nomeDoModificador2(categoriaId, codigo) {
  return rotuloModificador(porId.get(categoriaId), 'mod2', codigo);
}

// ── DIMENSAO: derivada do catálogo, com os aliases legados ──────────────────
// "Dimensão" é como este projeto sempre chamou o par de dígitos 5-6 do SIDC.
// No APP-6D o nome disso é SYMBOL SET, e é exatamente o que separa os 12
// arquivos do portal — ou seja: uma categoria do catálogo É uma dimensão.
// Desde a Etapa 9b esta tabela é gerada a partir daí, e não mais mantida à
// mão em paralelo.
//
// As cinco chaves antigas (UNIDADE, EQUIPAMENTO, INSTALACAO, AEREO,
// INDIVIDUO) continuam aqui como ALIASES porque são o que
// `backend/seed/usuarios_exercicio.csv` traz na coluna `dimensao` (Etapa 2c,
// adiada mas com o formato já definido) e o que está gravado em SIDCs
// criados antes desta etapa. Elas apontam para os MESMOS valores de antes —
// nenhum SIDC já gravado muda de significado.
//
// ATENÇÃO a uma delas: `AEREO: '05'` estava ERRADO. No APP-6D, `05` é
// **Space** (espaciais) e aeronaves são `01`. O erro veio junto da tabela
// manual e nunca foi percebido porque nenhuma marcação aérea chegou a ser
// criada. O alias é preservado com o valor errado de propósito — mudá-lo
// reescreveria o significado de qualquer dado antigo que o tenha usado. Quem
// quer aeronave hoje escolhe a categoria `AERONAVES` ('01'), que é a certa;
// `chavePorValor(DIMENSAO, '05')` devolve `ESPACIAIS`, que também é a certa.
export const DIMENSAO = {};
for (const cat of CATEGORIAS) DIMENSAO[cat.id.toUpperCase()] = cat.symbolSet;
Object.assign(DIMENSAO, {
  UNIDADE: '10',      // alias legado de UNIDADES
  EQUIPAMENTO: '15',  // alias legado de EQUIPAMENTOS_VIATURAS
  INSTALACAO: '20',   // alias legado de INSTALACOES
  INDIVIDUO: '27',    // alias legado de INDIVIDUOS_DESEMBARCADOS
  AEREO: '05',        // alias legado ERRADO (05 = espaciais); ver acima
});

// ── NATUREZA: a tabela plana, agora derivada do catálogo ────────────────────
// Era escrita à mão com 18 entradas; hoje são as 434 do catálogo oficial,
// indexadas pelo `NomeBR`. Continua existindo porque é a forma "nome humano
// -> código de entidade" que a Etapa 5 estabeleceu e que o par
// getSIDC()/decomporSidc() usa.
//
// Um punhado de nomes se repete entre categorias diferentes ("Despistador"
// existe em guerra de minas, marítimos de superfície e submarinos, com
// códigos diferentes). Nesses casos a chave ganha a categoria entre
// parênteses, para uma não sobrescrever a outra. O FORMULÁRIO não mostra esse
// sufixo: lá a categoria já foi escolhida antes, e o rótulo exibido é o
// `NomeBR` puro (ver `itensDaCategoria()`).
export const NATUREZA = {};
for (const cat of CATEGORIAS) {
  for (const grupo of cat.grupos) {
    for (const [codigo, nome] of grupo.itens) {
      NATUREZA[NOMES_REPETIDOS.has(nome) ? `${nome} (${cat.nome})` : nome] = codigo;
    }
  }
}

// A chave que este item tem em NATUREZA (com o sufixo de desambiguação, se
// for o caso). Serve para a ponte entre o formulário hierárquico novo e
// qualquer código que ainda pense em termos da tabela plana.
export function chaveNatureza(categoriaId, codigo) {
  const cat = porId.get(categoriaId);
  const nome = nomeDoItem(categoriaId, codigo);
  if (!cat || !nome) return '';
  return NOMES_REPETIDOS.has(nome) ? `${nome} (${cat.nome})` : nome;
}

// Os itens de uma categoria já agrupados para virar <optgroup> no formulário.
// Devolve [] para categoria desconhecida — nunca lança.
export function itensDaCategoria(categoriaId) {
  const cat = porId.get(categoriaId);
  return cat ? cat.grupos : [];
}

// Posição do par de dígitos de hostilidade dentro do SIDC de 20 dígitos:
//   10 | hostilidade(2) | dimensão(2) | situação(1) | hqtf(1) | escalão(2) | natureza(10)
//   ^^   ^^
//   0-1  2-3
const POS_HOSTILIDADE = 2;

// ── Montagem do SIDC ────────────────────────────────────────────────────────
// A assinatura é a mesma da Etapa 4.5 — `props.natureza_code` de 6 dígitos e
// sem modificador continua produzindo BYTE A BYTE o mesmo SIDC de antes (é o
// que mantém `backend/seed/criar_usuarios.mjs` e `index.html` funcionando sem
// mudança). A Etapa 9b só acrescentou duas entradas OPCIONAIS:
//
//   props.mod1 / props.mod2 — códigos de 2 dígitos das colunas "sector 1" e
//     "sector 2" do catálogo, que ocupam os dígitos 17-18 e 19-20. Ignorados
//     quando `natureza_code` já vier com os 10 dígitos completos.
//
// `natureza_code` aceita 6 dígitos (só a entidade, forma antiga) ou 10 (a
// entidade com os modificadores já embutidos, que é como o `sidcBR` do
// portal vem).
function doisDigitos(valor) {
  const s = String(valor == null ? '' : valor).replace(/\D/g, '');
  if (!s) return '00';
  return s.length >= 2 ? s.slice(0, 2) : s.padStart(2, '0');
}

export function getSIDC(props) {
  if (props.sidc && props.sidc.length === 20) return props.sidc;
  const h   = HOSTILIDADE[(props.hostilidade || '').toUpperCase()] || '01';
  const d   = DIMENSAO[(props.dimensao || '').toUpperCase()] || '10';
  const s   = SITUACAO[(props.situacao || '').toUpperCase()] || '0';
  const hq  = HQTF[props.hqtf || ''] || '0';
  const e   = ESCALAO[(props.escalao || '').toUpperCase()] || '00';

  const base = String(props.natureza_code || '000000');
  const nat = base.length >= 10
    ? base.slice(0, 10)
    : base.padEnd(6, '0').slice(0, 6) + doisDigitos(props.mod1) + doisDigitos(props.mod2);

  return `10${h}${d}${s}${hq}${e}${nat}`;
}

// ── Decomposição do SIDC (inverso de getSIDC) ───────────────────────────────
// Usada pela Etapa 5 (frontend/marcacoes.js) para PRÉ-PREENCHER o formulário
// de edição de uma marcação: como só o SIDC final é gravado em
// elementos_marcados (não os rótulos humanos que o formulário usa), editar
// precisa voltar do SIDC para "que dimensão/escalão/natureza foi escolhida".
// Mora aqui (não em marcacoes.js) pelo mesmo motivo de getSIDC() morar aqui:
// é o par monta/desmonta do MESMO formato de SIDC, e simbolos.js é a fonte
// única dele — duas cópias da mesma tabela é como a leitura de volta do SIDC
// começa a divergir da montagem em silêncio.
export function chavePorValor(tabela, valor) {
  return Object.keys(tabela).find((k) => tabela[k] === valor) || '';
}

// Vazio no formato que TODO chamador espera — um SIDC inválido não pode
// quebrar o formulário nem o popup.
const DECOMPOSICAO_VAZIA = Object.freeze({
  dimensao: '', escalao: '', natureza: '',
  situacao: '', hqtf: '',
  categoriaId: '', codigoEntidade: '', mod1: '', mod2: '',
});

// Etapa 9b: a busca da natureza deixou de varrer uma tabela global e passou a
// ser resolvida DENTRO da categoria que o próprio SIDC declara (dígitos 5-6).
// É mais barato e mais correto: dois símbolos de categorias diferentes podem
// ter o mesmo código de entidade e significar coisas distintas — a busca
// global acertaria por sorte, dependendo da ordem das chaves.
export function decomporSidc(sidc) {
  if (typeof sidc !== 'string' || !/^[0-9]{20}$/.test(sidc)) return { ...DECOMPOSICAO_VAZIA };

  const symbolSet = sidc.slice(4, 6);
  const categoria = porSymbolSet.get(symbolSet) || null;
  const codigoEntidade = sidc.slice(10, 16);
  const mod1 = sidc.slice(16, 18);
  const mod2 = sidc.slice(18, 20);

  return {
    // Os três campos que já existiam desde a Etapa 5, com o mesmo significado.
    dimensao: chavePorValor(DIMENSAO, symbolSet),
    escalao: chavePorValor(ESCALAO, sidc.slice(8, 10)),
    natureza: categoria ? chaveNatureza(categoria.id, codigoEntidade) : '',
    // Campos novos da Etapa 9b, para o formulário hierárquico.
    situacao: chavePorValor(SITUACAO, sidc.slice(6, 7)),
    hqtf: chavePorValor(HQTF, sidc.slice(7, 8)),
    categoriaId: categoria ? categoria.id : '',
    codigoEntidade,
    mod1,
    mod2,
  };
}

// Um resumo em português do que um SIDC representa, para popup e listagem —
// "Infantaria · Pelotão · Aeromóvel". Devolve '' quando não dá para dizer
// nada (SIDC inválido ou categoria desconhecida), e nunca lança.
export function descreverSidc(sidc) {
  const d = decomporSidc(sidc);
  if (!d.categoriaId) return '';
  const partes = [nomeDoItem(d.categoriaId, d.codigoEntidade) || d.codigoEntidade];
  if (d.escalao && d.escalao !== 'NONE') partes.push(ESCALAO_ROTULO[d.escalao] || d.escalao);
  const m1 = nomeDoModificador1(d.categoriaId, d.mod1);
  const m2 = nomeDoModificador2(d.categoriaId, d.mod2);
  if (m1) partes.push(m1);
  if (m2) partes.push(m2);
  return partes.join(' · ');
}

// ── Hostilidade relativa ────────────────────────────────────────────────────
// NÃO MEXER sem ler os testes de simbolos.teste.mjs: esta função foi corrigida
// uma vez em produção (Etapa 11) e a ORDEM DAS GUARDAS é o que a corrigiu.
//
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

// ── De onde vem o SIDC "de fábrica" de um usuário (Etapa 9b, decisão 3) ─────
// Precedência, da mais forte para a mais fraca. É aqui — numa função só —
// que essa pergunta é respondida; nenhuma tela deve reimplementar a regra.
//
//   1. ORBAT (Etapa 6.5, ADIADA).  Quando existir hierarquia de unidades, o
//      símbolo do usuário é uma consequência da unidade em que ele está
//      lotado, não uma escolha dele — uma pessoa transferida de Pel para Cia
//      muda de símbolo por transferência, não por edição de perfil. É por
//      isso que a ORBAT vem PRIMEIRO: ela é a fonte mais autoritativa das
//      três. Ver o ponto de extensão marcado abaixo.
//   2. Seed do exercício (Etapa 2c, ADIADA, mecanismo pronto).
//      `backend/seed/usuarios_exercicio.csv` traz dimensão/escalão/natureza
//      por linha e `criar_usuarios.mjs` monta o SIDC com o MESMO getSIDC()
//      deste arquivo, gravando direto em `perfis.sidc` na criação da conta.
//   3. `perfis.sidc` como está no banco. Que é o resultado do item 2 quando
//      ele rodou, ou o default do schema ('10031000000000000000', 0001)
//      quando a conta veio do cadastro aberto de `login.html`.
//
// Note que 2 e 3 são a MESMA COLUNA — o seed não é uma origem paralela, é
// quem preenche a coluna antes de o usuário existir. Por isso a resolução em
// tempo de execução é curta: leia `perfis.sidc`. A precedência só fica
// visível de verdade quando a ORBAT entrar, e é exatamente por isso que a
// função existe já agora, com o ponto de extensão marcado.
//
// O QUE NÃO É UMA ORIGEM: o próprio usuário. `login.html` não pede símbolo no
// cadastro e a Etapa 9b decidiu que continua não pedindo. Dois motivos: (a)
// símbolo militar não é preferência pessoal, é o que a fração é — deixar o
// aluno escolher recria, no eixo do símbolo, o mesmo problema que a Etapa 4.5
// resolveu tirando o partido da mão dele; (b) `fn_proteger_campos_do_perfil`
// (0002/0003) já é o lugar onde se decide o que o aluno pode mexer no próprio
// perfil, e `sidc` deliberadamente não entrou nessa lista. Corrigir o símbolo
// de um aluno é atribuição do instrutor, no mesmo espírito da autoridade que
// ele já tem sobre partido e sobre as marcações da turma.
export function sidcDeFabrica(perfil, { sidcDaUnidade = null } = {}) {
  // ── PONTO DE EXTENSÃO DA ETAPA 6.5 ──────────────────────────────────────
  // Quando a hierarquia ORBAT existir, `sidcDaUnidade` passa a ser
  // preenchido por quem chama (a partir de `perfis.unidade_id` ->
  // `unidades.sidc`) e ganha desta linha, sem que mais nada aqui mude. Até
  // lá nenhum chamador passa a opção, então o comportamento é o de sempre.
  if (sidcDaUnidade && /^[0-9]{20}$/.test(sidcDaUnidade)) return sidcDaUnidade;

  // Seed da Etapa 2c e cadastro aberto caem os dois aqui: `perfis.sidc`.
  const doPerfil = perfil && perfil.sidc;
  if (doPerfil && /^[0-9]{20}$/.test(doPerfil)) return doPerfil;

  // Último recurso: o mesmo default do schema (backend/supabase/0001, linha
  // do `default` de perfis.sidc). Repetido aqui só para o cliente nunca
  // desenhar `undefined` — não é uma quarta origem.
  return '10031000000000000000';
}
