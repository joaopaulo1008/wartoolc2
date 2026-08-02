// gerar-catalogo-simbologia.mjs — Etapa 9b.
//
// Transforma o extrato do Portal de Simbologia Militar do MD/EB
// (data/simbologia-eb/*.json, ver a PROCEDENCIA.md que está lá) no módulo de
// dados puro que o app importa: frontend/simbolos-catalogo.js.
//
//     node scripts/gerar-catalogo-simbologia.mjs
//
// Por que existe um passo de geração no meio, em vez de o app ler o JSON
// direto: simbolos.js precisa das tabelas de forma SÍNCRONA (getSIDC() e
// decomporSidc() são funções puras, chamadas na hora de desenhar cada
// símbolo) e precisa continuar rodando em Node puro, sem navegador, para as
// suítes de teste (simbolos.teste.mjs / marcacoes.teste.mjs). Um `fetch()` de
// JSON quebraria as duas coisas; um `import` de módulo JS não quebra nenhuma,
// e ainda entra no bundle do Vite sem custo de rede em campo.
//
// Este script NÃO acessa a rede. A captura do portal (que é a parte que
// depende de `simbologia.eb.mil.br` estar no ar) é um passo separado e
// manual, documentado passo a passo em data/simbologia-eb/PROCEDENCIA.md —
// inclusive o trecho de JavaScript a colar no console do navegador. É de
// propósito: em campo, ninguém depende do portal; para ATUALIZAR o catálogo,
// alguém com rede roda a captura, substitui os dois JSON e roda este script.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRADA = join(RAIZ, 'data', 'simbologia-eb', 'catalogo-extraido.json');
const ENTRADA_EXT = join(RAIZ, 'data', 'simbologia-eb', 'extensoes-br.json');
const SAIDA = join(RAIZ, 'frontend', 'simbolos-catalogo.js');

// ── Rótulos que o portal NÃO fornece ──────────────────────────────────────
// Duas listas escritas à mão, e é importante saber exatamente o que é cada
// uma para não confundir "dado oficial" com "tradução nossa":
//
//   NOME_CATEGORIA — o portal identifica cada um dos 12 arquivos só pelo
//     nome do arquivo (`symbolSet-unidades-json.<hash>.js`). O rótulo em
//     português da CATEGORIA é nosso, derivado desse nome.
//
//   NOME_GRUPO — o campo `Entity` do catálogo vem em inglês (é a taxonomia
//     do APP-6D, igual à da OTAN). O portal só traduz a FOLHA (`NomeBR` de
//     cada ícone central), nunca o nível de agrupamento. Quando um ícone
//     central corresponde exatamente à entidade-raiz, usamos o `NomeBR` dele
//     (é oficial); nos demais casos, a tradução abaixo é nossa.
const NOME_CATEGORIA = {
  aeronaves: 'Aeronaves',
  atividades_eventos: 'Atividades e eventos',
  equipamentos_viaturas: 'Equipamentos e viaturas',
  espaciais: 'Espaciais',
  guerra_minas: 'Guerra de minas',
  individuos_desembarcados: 'Indivíduos desembarcados',
  instalacoes: 'Instalações',
  maritimos_superficie: 'Marítimos de superfície',
  misseis: 'Mísseis',
  organizacoes_civis: 'Organizações civis',
  submarinos: 'Submarinos',
  unidades: 'Unidades',
};

const NOME_GRUPO = {
  'Civil Disturbance': 'Distúrbio civil',
  'Civilian': 'Civil',
  'Civilian Vehicles': 'Viaturas civis',
  'Command and Control': 'Comando e Controle',
  'Engineer Vehicles and Equipment': 'Viaturas e equipamentos de Engenharia',
  'Fire Event': 'Incêndio',
  'Fires': 'Apoio de Fogo',
  'Fused Track': 'Track automático',
  'General Mine Anchor': 'Ferro (poita de mina)',
  'Hazardous Materials': 'Material perigoso',
  'Incident': 'Incidente',
  'Infrastructure': 'Infraestrutura',
  'Installation': 'Instalação',
  'Intelligence': 'Inteligência',
  'Land Mines': 'Minas terrestres',
  'Law Enforcement': 'Segurança pública',
  'Manual Track': 'Track manual',
  'Military': 'Militar',
  'Military Combatant': 'Militar combatente',
  'Military Non Combatant': 'Militar não combatente',
  'Mine-Like Contact (MILCO)': 'Contato provável mina (MILCO)',
  'Mine-Like Echo (MILEC), General': 'Contato possível mina (MILEC)',
  'Missile': 'Míssil',
  'Movement and Manoeuvre': 'Movimento e Manobra',
  'Natural Event': 'Evento natural',
  'Naval': 'Naval',
  'Non-Mine Mine-Like Object (NMLO), General': 'Contato classificado como não mina (NMLO)',
  'Obstructor': 'Obstrutor',
  'Operation': 'Operação',
  'Other Equipment': 'Outros equipamentos',
  'Protection': 'Proteção',
  'Sea Bed Installation Man-Made Military': 'Instalação no leito marinho — militar',
  'Sea Bed Installation Man-Made Non-Military': 'Instalação no leito marinho — não militar',
  'Sea Mine Decoy': 'Despistador de mina naval',
  'Sea Mine, General': 'Mina naval',
  'Sensors': 'Sensores',
  'Sustainment': 'Logística',
  'Trains': 'Ferroviário',
  'Unspecified Command and Control': 'Comando e Controle não especificado',
  'Utility Vehicles': 'Viaturas de emprego geral',
  'Vehicles': 'Viaturas blindadas',
  'Weapon': 'Armamento',
  'Weapons/Weapons System': 'Armamento / sistema de armas',
};

// ── Leitura + validação ───────────────────────────────────────────────────
const bruto = JSON.parse(readFileSync(ENTRADA, 'utf8'));
const extensoes = JSON.parse(readFileSync(ENTRADA_EXT, 'utf8'));

const problemas = [];
for (const cat of bruto) {
  if (!NOME_CATEGORIA[cat.id]) problemas.push(`categoria sem rótulo em NOME_CATEGORIA: ${cat.id}`);
  if (!/^[0-9]{2}$/.test(cat.ss)) problemas.push(`${cat.id}: symbolSet inválido "${cat.ss}"`);
  for (const grupo of cat.g) {
    if (!NOME_GRUPO[grupo.e]) problemas.push(`grupo sem rótulo em NOME_GRUPO: "${grupo.e}" (${cat.id})`);
    for (const [codigo, nome] of grupo.i) {
      if (!/^[0-9]{6}$/.test(codigo)) problemas.push(`${cat.id}: código "${codigo}" não tem 6 dígitos`);
      if (!nome || !nome.trim()) problemas.push(`${cat.id}: item ${codigo} sem NomeBR`);
    }
  }
  for (const [codigo, rotulo] of [...cat.m1, ...cat.m2]) {
    if (!/^[0-9]{2}$/.test(codigo)) problemas.push(`${cat.id}: modificador "${codigo}" não tem 2 dígitos`);
    if (!rotulo || !rotulo.trim()) problemas.push(`${cat.id}: modificador ${codigo} sem rótulo`);
  }
}
if (problemas.length) {
  console.error('Extrato inconsistente — nada foi gerado:');
  for (const p of problemas) console.error('  -', p);
  process.exit(1);
}

// ── Desambiguação de nomes repetidos ──────────────────────────────────────
// A tabela plana NATUREZA (compatibilidade com quem já importava de
// simbolos.js) é indexada por NOME, e há nomes que se repetem entre
// categorias diferentes ("Despistador" existe em guerra de minas, marítimos
// e submarinos). Quando isso acontece o nome ganha a categoria entre
// parênteses — a chave da tabela vira única sem que o rótulo mostrado no
// formulário mude (o formulário usa o NomeBR puro, dentro da categoria já
// escolhida).
const contagem = new Map();
for (const cat of bruto) for (const g of cat.g) for (const [, nome] of g.i) {
  contagem.set(nome, (contagem.get(nome) || 0) + 1);
}
const repetidos = new Set([...contagem].filter(([, n]) => n > 1).map(([nome]) => nome));

// ── Emissão ───────────────────────────────────────────────────────────────
const aspas = (s) => JSON.stringify(s);
const linhas = [];
const L = (s = '') => linhas.push(s);

L('// simbolos-catalogo.js — GERADO, NÃO EDITE À MÃO.');
L('//');
L('// Fonte: Portal de Simbologia Militar do Ministério da Defesa / Exército');
L('// Brasileiro (https://simbologia.eb.mil.br/), baseado no manual MD33-M-02 e');
L('// no catálogo MD33-C-01. Os 12 arquivos do portal foram capturados uma vez e');
L('// o extrato normalizado está em data/simbologia-eb/ — a procedência exata');
L('// (URL, SHA-256 e data de cada arquivo) está em');
L('// data/simbologia-eb/PROCEDENCIA.md.');
L('//');
L('// Para regenerar:  node scripts/gerar-catalogo-simbologia.mjs');
L('//');
L('// Formato do SIDC (APP-6D de 20 dígitos, o mesmo de perfis.sidc e de');
L('// elementos_marcados.sidc):');
L('//');
L('//   10 | hostilidade(2) | symbolSet(2) | situação(1) | hqtf(1) | escalão(2) | entidade(6) | mod1(2) | mod2(2)');
L('//    0    2               4              6             7         8            10           16       18');
L('//');
L('// O que ESTE arquivo cobre: o symbolSet (= a "categoria"), a entidade de 6');
L('// dígitos e os dois modificadores. O que ele NÃO cobre, porque o portal não');
L('// publica como tabela: hostilidade (é relativa, calculada em runtime — ver');
L('// hostilidadeRelativa() em simbolos.js), situação, HQ/TF e escalão. Esses');
L('// quatro continuam em tabelas escritas à mão em simbolos.js.');
L('');
L('// Cada categoria é um dos 12 arquivos do portal:');
L('//   id        — o nome do arquivo no portal (symbolSet-<id>-json.<hash>.js)');
L('//   nome      — rótulo em português (nosso, o portal não publica um)');
L('//   symbolSet — os dígitos 5-6 do SIDC');
L('//   grupos    — o campo `Entity` do catálogo, que agrupa os ícones centrais');
L('//               (entidade = rótulo original em inglês do APP-6D;');
L('//                nome     = rótulo em português, oficial quando o portal');
L('//                           traz um ícone central para a própria entidade,');
L('//                           nosso nos demais casos)');
L('//   itens     — [código de 6 dígitos, NomeBR oficial do portal]');
L('//   mod1/mod2 — [código de 2 dígitos, rótulo] das colunas "sector 1" e');
L('//               "sector 2" do portal ("Correspondência no Brasil" quando');
L('//               existe, senão o rótulo original em inglês)');
L('export const CATEGORIAS = [');
for (const cat of bruto) {
  L('  {');
  L(`    id: ${aspas(cat.id)},`);
  L(`    nome: ${aspas(NOME_CATEGORIA[cat.id])},`);
  L(`    symbolSet: ${aspas(cat.ss)},`);
  L('    grupos: [');
  for (const grupo of cat.g) {
    L('      {');
    L(`        entidade: ${aspas(grupo.e)},`);
    L(`        nome: ${aspas(NOME_GRUPO[grupo.e])},`);
    L('        itens: [');
    for (const [codigo, nome] of grupo.i) {
      const chave = repetidos.has(nome) ? `${nome} (${NOME_CATEGORIA[cat.id]})` : nome;
      const sufixo = chave === nome ? '' : ` // chave em NATUREZA: ${chave}`;
      L(`          [${aspas(codigo)}, ${aspas(nome)}],${sufixo}`);
    }
    L('        ],');
    L('      },');
  }
  L('    ],');
  for (const [campo, lista] of [['mod1', cat.m1], ['mod2', cat.m2]]) {
    if (!lista.length) { L(`    ${campo}: [],`); continue; }
    L(`    ${campo}: [`);
    for (const [codigo, rotulo] of lista) L(`      [${aspas(codigo)}, ${aspas(rotulo)}],`);
    L('    ],');
  }
  L('  },');
}
L('];');
L('');
L('// NOMES REPETIDOS entre categorias — para simbolos.js montar a tabela plana');
L('// NATUREZA sem uma chave sobrescrever a outra. Ver o comentário de');
L('// desambiguação em scripts/gerar-catalogo-simbologia.mjs.');
L(`export const NOMES_REPETIDOS = new Set([${[...repetidos].sort().map(aspas).join(', ')}]);`);
L('');
L('// Extensões brasileiras do catálogo (campo `ExtEntity`/`Extension` do');
L('// portal): 63 ícones cujo SIDC tem 30 dígitos, não 20 — o bloco extra é a');
L('// extensão nacional do APP-6D. NÃO são oferecidos no formulário por dois');
L('// motivos concretos, não por preguiça:');
L('//   1. `perfis.sidc` e `elementos_marcados.sidc` têm check (sidc ~ \'^[0-9]{20}$\')');
L('//      desde a 0001 — um SIDC de 30 dígitos é rejeitado pelo banco.');
L('//   2. `milsymbol` desenha APP-6D de 20 dígitos; o glifo brasileiro da');
L('//      extensão o portal serve como PNG pronto (campo `br_symbol`), não como');
L('//      algo que a milsymbol saiba montar.');
L('// Ficam aqui listados para a etapa futura que resolver isso não precisar');
L('// recapturar o portal. Formato: [categoria, sidc de 30 dígitos, NomeBR].');
L('export const EXTENSOES_BR_NAO_SUPORTADAS = [');
for (const [cat, sidc, nome] of extensoes) L(`  [${aspas(cat)}, ${aspas(sidc)}, ${aspas(nome)}],`);
L('];');
L('');

writeFileSync(SAIDA, linhas.join('\n'));

const totalItens = bruto.reduce((a, c) => a + c.g.reduce((x, g) => x + g.i.length, 0), 0);
const totalMods = bruto.reduce((a, c) => a + c.m1.length + c.m2.length, 0);
console.log(
  `frontend/simbolos-catalogo.js gerado: ${bruto.length} categorias, ` +
  `${totalItens} ícones centrais, ${totalMods} modificadores, ` +
  `${repetidos.size} nome(s) repetido(s), ${extensoes.length} extensão(ões) BR fora do formulário.`
);
