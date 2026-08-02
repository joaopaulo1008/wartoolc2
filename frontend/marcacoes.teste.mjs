// Teste de frontend/marcacoes.js — Etapa 5, reescrito na Etapa 9b.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/marcacoes.teste.mjs
//
// marcacoes.js em si NÃO é importado aqui: ele importa auth.js, que importa
// o supabase-js, e leaflet, que precisa de `window` — importar marcacoes.js
// diretamente falha fora do navegador (confirmado ao escrever este teste).
// Por isso a lógica de SIDC que a Etapa 5 introduziu (a tabela NATUREZA e o
// par getSIDC()/decomporSidc()) foi deixada em simbolos.js, que só depende do
// catálogo gerado (também puro) — é o mesmo motivo de simbolos.teste.mjs
// existir e rodar isolado.
//
// O QUE A ETAPA 9b MUDOU NESTE ARQUIVO
// -------------------------------------
// A versão da Etapa 5 varria as tabelas MANUAIS (5 dimensões, 13 escalões,
// 18 naturezas) com uma asserção por chave. Com o catálogo oficial são 12
// categorias e 434 ícones centrais: uma asserção por chave viraria ~450
// linhas de log dizendo a mesma coisa. As varreduras completas continuam
// acontecendo — cobrindo AGORA o catálogo inteiro, não uma amostra — mas
// reportam uma asserção por categoria, dizendo quantos itens passaram. Se um
// único item falhar, a asserção da categoria falha e mostra qual.
//
// A verificação que mais importa aqui não mudou: montar o SIDC a partir das
// escolhas do formulário (nunca hostilidade) e voltar do SIDC gravado para
// essas mesmas escolhas, que é o que o formulário de EDIÇÃO precisa — e é o
// caminho que o instrutor usa para corrigir a simbologia de um aluno.
import {
  getSIDC, decomporSidc, descreverSidc, sidcDeFabrica, chaveNatureza,
  nomeDoItem, codigoDoItem, itensDaCategoria, categoriaPorId, categoriaPorSymbolSet,
  designacaoDoMapa,
  NATUREZA, DIMENSAO, ESCALAO, ESCALAO_ROTULO, CATEGORIAS,
} from './simbolos.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = JSON.stringify(obtido) === JSON.stringify(esperado);
  bom ? passou++ : falhou++;
  const marca = bom ? 'PASSOU' : '** FALHOU **';
  console.log(`  ${marca.padEnd(14)} ${descricao}`);
  if (!bom) {
    console.log(`                 esperado: ${JSON.stringify(esperado)}`);
    console.log(`                 obtido:   ${JSON.stringify(obtido)}`);
  }
}

// ── A marcação nunca grava hostilidade ──────────────────────────────────────
console.log('\ngetSIDC() a partir do formulário de marcação (Etapa 5)');
const sidcInfantaria = getSIDC({
  dimensao: 'UNIDADES',
  escalao: 'PEL',
  natureza_code: NATUREZA['Infantaria'],
});
ok('o dígito de hostilidade sai como placeholder (01, desconhecido) — não é pedido no formulário',
  sidcInfantaria.slice(2, 4), '01');
ok('dimensão/escalão/natureza ficam nas posições certas do SIDC de 20 dígitos',
  sidcInfantaria, '10' + '01' + '10' + '0' + '0' + '13' + '121100'.padEnd(10, '0'));
ok('natureza desconhecida (não cadastrada em NATUREZA) cai no 000000 — sem quebrar',
  getSIDC({ dimensao: 'UNIDADES', escalao: 'PEL', natureza_code: undefined }).slice(10),
  '0000000000');
ok('"Infantaria" agora vem do catálogo oficial (121100), não da tabela reduzida da Etapa 5',
  NATUREZA['Infantaria'], '121100');

// ── Compatibilidade: o que já gravava SIDC antes da 9b continua igual ───────
// backend/seed/criar_usuarios.mjs (Etapa 2c) monta o SIDC a partir das
// colunas do CSV, que usam as chaves ANTIGAS. Se qualquer uma delas mudasse
// de valor, contas criadas pelo seed nasceriam com um símbolo diferente do
// que o operador escreveu na planilha — em silêncio.
console.log('\nCompatibilidade com o CSV do seed (Etapa 2c) e com dados anteriores à 9b');
ok('CSV do instrutor: AMIGO/UNIDADE/CIA sem natureza -> o mesmo SIDC de antes',
  getSIDC({ hostilidade: 'AMIGO', dimensao: 'UNIDADE', escalao: 'CIA', natureza_code: '' }),
  '10031000140000000000');
ok('CSV de aluno: AMIGO/INDIVIDUO/NONE -> o mesmo SIDC de antes',
  getSIDC({ hostilidade: 'AMIGO', dimensao: 'INDIVIDUO', escalao: 'NONE', natureza_code: '' }),
  '10032700000000000000');
ok('alias legado UNIDADE continua valendo 10 (symbol set de unidades)', DIMENSAO.UNIDADE, '10');
ok('alias legado EQUIPAMENTO continua valendo 15', DIMENSAO.EQUIPAMENTO, '15');
ok('alias legado INSTALACAO continua valendo 20', DIMENSAO.INSTALACAO, '20');
ok('alias legado INDIVIDUO continua valendo 27', DIMENSAO.INDIVIDUO, '27');
ok('alias legado AEREO continua valendo 05 — errado no APP-6D, preservado de propósito',
  DIMENSAO.AEREO, '05');
ok('e a chave CERTA para aeronave no APP-6D é 01, que o catálogo trouxe',
  DIMENSAO.AERONAVES, '01');
ok('05 decompõe como ESPACIAIS (o significado real de 05), não como AEREO',
  decomporSidc('10010500000000000000').dimensao, 'ESPACIAIS');
ok('SIDC de 20 dígitos já pronto continua passando direto, sem remontagem',
  getSIDC({ sidc: '10061510013012020000', dimensao: 'UNIDADES' }), '10061510013012020000');

// ── Varredura completa do catálogo ──────────────────────────────────────────
// Uma asserção por categoria; por dentro, TODOS os itens daquela categoria.
// Prova que qualquer coisa que o formulário deixe escolher produz um SIDC
// aceito pelo banco e volta a ser a mesma escolha na hora de editar.
console.log('\nRoundtrip do catálogo oficial: escolha -> SIDC -> escolha (todas as 12 categorias)');
const REGEX_DO_BANCO = /^[0-9]{20}$/;  // o mesmo check de perfis.sidc / elementos_marcados.sidc (0001)
let totalItens = 0;
for (const cat of CATEGORIAS) {
  const falhas = [];
  let n = 0;
  for (const grupo of cat.grupos) {
    for (const [codigo, nome] of grupo.itens) {
      n++;
      const sidc = getSIDC({ dimensao: cat.id, escalao: 'PEL', natureza_code: codigo });
      const volta = decomporSidc(sidc);
      if (!REGEX_DO_BANCO.test(sidc)) falhas.push(`${codigo}: SIDC "${sidc}" seria rejeitado pelo check do banco`);
      else if (volta.categoriaId !== cat.id) falhas.push(`${codigo}: categoria voltou "${volta.categoriaId}"`);
      else if (volta.codigoEntidade !== codigo) falhas.push(`${codigo}: entidade voltou "${volta.codigoEntidade}"`);
      else if (volta.natureza !== chaveNatureza(cat.id, codigo)) falhas.push(`${codigo}: natureza voltou "${volta.natureza}"`);
      else if (nomeDoItem(cat.id, codigo) !== nome) falhas.push(`${codigo}: nomeDoItem devolveu "${nomeDoItem(cat.id, codigo)}"`);
      else if (codigoDoItem(cat.id, nome) !== codigo) falhas.push(`${nome}: codigoDoItem devolveu "${codigoDoItem(cat.id, nome)}"`);
      else if (volta.escalao !== 'PEL') falhas.push(`${codigo}: escalão voltou "${volta.escalao}"`);
    }
  }
  totalItens += n;
  ok(`${cat.nome} (symbol set ${cat.symbolSet}): ${n} ícone(s) central(is) fazem roundtrip`, falhas, []);
}
ok('o catálogo inteiro foi varrido (434 ícones centrais)', totalItens, 434);

// ── Modificadores (novidade da 9b — dígitos 17-20) ──────────────────────────
console.log('\nModificadores "sector 1"/"sector 2" do catálogo (dígitos 17-18 e 19-20)');
for (const cat of CATEGORIAS) {
  if (!cat.mod1.length && !cat.mod2.length) continue;
  const primeiroItem = cat.grupos[0].itens[0][0];
  const falhas = [];
  for (const [cod] of cat.mod1) {
    const sidc = getSIDC({ dimensao: cat.id, natureza_code: primeiroItem, mod1: cod });
    if (!REGEX_DO_BANCO.test(sidc)) falhas.push(`mod1 ${cod}: SIDC inválido "${sidc}"`);
    else if (decomporSidc(sidc).mod1 !== cod) falhas.push(`mod1 ${cod}: voltou "${decomporSidc(sidc).mod1}"`);
  }
  for (const [cod] of cat.mod2) {
    const sidc = getSIDC({ dimensao: cat.id, natureza_code: primeiroItem, mod2: cod });
    if (!REGEX_DO_BANCO.test(sidc)) falhas.push(`mod2 ${cod}: SIDC inválido "${sidc}"`);
    else if (decomporSidc(sidc).mod2 !== cod) falhas.push(`mod2 ${cod}: voltou "${decomporSidc(sidc).mod2}"`);
  }
  ok(`${cat.nome}: ${cat.mod1.length} mod1 + ${cat.mod2.length} mod2 fazem roundtrip`, falhas, []);
}
ok('os dois modificadores juntos ocupam exatamente os 4 últimos dígitos',
  getSIDC({ dimensao: 'UNIDADES', natureza_code: '121100', mod1: '01', mod2: '27' }).slice(10),
  '121100' + '01' + '27');
ok('natureza_code de 10 dígitos (como o `sidcBR` do portal vem) ganha de mod1/mod2 avulsos',
  getSIDC({ dimensao: 'UNIDADES', natureza_code: '1211000127', mod1: '99', mod2: '99' }).slice(10),
  '1211000127');
ok('modificador ausente vira 00 — o padrão "não especificado" do catálogo',
  getSIDC({ dimensao: 'UNIDADES', natureza_code: '121100' }).slice(16), '0000');

// ── Escalão (continua sendo tabela manual: o portal não publica) ────────────
console.log('\ndecomporSidc() — escalão (amplificador, fora do catálogo do portal)');
function primeiraChaveDoValor(tabela, chave) {
  return Object.keys(tabela).find((k) => tabela[k] === tabela[chave]) === chave;
}
for (const escalaoChave of Object.keys(ESCALAO)) {
  if (!primeiraChaveDoValor(ESCALAO, escalaoChave)) continue;
  const sidc = getSIDC({ dimensao: 'UNIDADES', escalao: escalaoChave, natureza_code: NATUREZA['Infantaria'] });
  ok(`roundtrip escalão=${escalaoChave || '(vazio)'}`, decomporSidc(sidc).escalao, escalaoChave);
}
ok('todo escalão que o formulário mostra tem rótulo em português',
  Object.keys(ESCALAO).filter((k) => k !== '' && !ESCALAO_ROTULO[k]), []);

// ── Robustez: SIDC que não deveria existir não pode quebrar a tela ──────────
console.log('\ndecomporSidc() — entrada inválida e casos de borda');
const vazio = decomporSidc('nao-e-sidc');
ok('SIDC malformado decompõe para campos vazios (não quebra o formulário)',
  [vazio.dimensao, vazio.escalao, vazio.natureza, vazio.categoriaId, vazio.codigoEntidade],
  ['', '', '', '', '']);
ok('SIDC malformado também zera os campos novos da 9b',
  [vazio.situacao, vazio.hqtf, vazio.mod1, vazio.mod2], ['', '', '', '']);
ok('symbol set que não existe no catálogo (99) decompõe com categoria vazia, sem lançar',
  decomporSidc('10019900000000000000').categoriaId, '');
ok('entidade que não existe naquela categoria decompõe natureza vazia',
  decomporSidc(getSIDC({ dimensao: 'UNIDADES', natureza_code: '999999' })).natureza, '');
ok('SIDC default de perfis.sidc (0001) decompõe para o que ele é no catálogo oficial',
  decomporSidc('10031000000000000000').natureza,
  'Comando Nomeado (sigla do Comando no setor central)');
ok('categoriaPorSymbolSet devolve null para symbol set desconhecido',
  categoriaPorSymbolSet('99'), null);
ok('categoriaPorId devolve null para id desconhecido', categoriaPorId('nao_existe'), null);
ok('itensDaCategoria devolve [] para id desconhecido (nunca lança)',
  itensDaCategoria('nao_existe'), []);

// ── Desambiguação de nomes repetidos entre categorias ──────────────────────
console.log('\nNATUREZA: nomes que se repetem entre categorias');
ok('"Despistador" existe em três categorias e cada uma tem a própria chave',
  ['Despistador (Guerra de minas)', 'Despistador (Marítimos de superfície)', 'Despistador (Submarinos)']
    .map((k) => NATUREZA[k]),
  ['130000', '120600', '130300']);
ok('e não sobrou nenhuma chave "Despistador" pelada, que sobrescreveria as outras',
  NATUREZA['Despistador'], undefined);
ok('o formulário, porém, mostra o NomeBR puro (a categoria já foi escolhida antes)',
  nomeDoItem('submarinos', '130300'), 'Despistador');
ok('chaveNatureza() é a ponte entre os dois',
  chaveNatureza('submarinos', '130300'), 'Despistador (Submarinos)');

// ── descreverSidc(): o resumo em português que o popup mostra ──────────────
console.log('\ndescreverSidc() — o que o popup da marcação mostra');
ok('natureza + escalão + modificador, em português oficial',
  descreverSidc(getSIDC({ dimensao: 'UNIDADES', escalao: 'PEL', natureza_code: '121100', mod1: '01' })),
  'Infantaria · Pelotão · Aeromóvel');
ok('sem escalão, o campo simplesmente não aparece',
  descreverSidc(getSIDC({ dimensao: 'UNIDADES', escalao: 'NONE', natureza_code: '121100' })),
  'Infantaria');
ok('os dois modificadores aparecem quando os dois foram escolhidos',
  descreverSidc(getSIDC({ dimensao: 'UNIDADES', escalao: 'BN', natureza_code: '130300', mod1: '03', mod2: '47' })),
  'Artilharia de Campanha · Batalhão · Ataque · Rebocado');
ok('SIDC inválido descreve como string vazia, nunca lança', descreverSidc('xxx'), '');
ok('symbol set fora do catálogo também descreve vazio', descreverSidc('10019900000000000000'), '');

// ── designacaoDoMapa(): o que vai escrito AO LADO do símbolo ───────────────
// Regressão vista em campo em 2026-08-02: o mapa aparecia com o nome oficial
// inteiro do tipo ("Cavalaria Blindada ou Mecanizada, Carros de Combate
// (código específico apenas para compatibilidade com a OTAN)") atravessando a
// tela. No APP-6D aquele campo é a DESIGNAÇÃO da unidade, não o tipo — o tipo
// já está no desenho do símbolo.
console.log('\ndesignacaoDoMapa() — designação da unidade, nunca o tipo');
const SIDC_CAV = getSIDC({ dimensao: 'UNIDADES', escalao: 'PEL', natureza_code: '120500' });
ok('uma designação de verdade passa inteira', designacaoDoMapa('1º/5º RCC', SIDC_CAV), '1º/5º RCC');
ok('vazio continua vazio (o símbolo sai limpo)', designacaoDoMapa('', SIDC_CAV), '');
ok('só espaço também', designacaoDoMapa('   ', SIDC_CAV), '');
ok('null/undefined não viram a string "null"',
  [designacaoDoMapa(null, SIDC_CAV), designacaoDoMapa(undefined, SIDC_CAV)], ['', '']);
ok('O CASO RELATADO: o nome do TIPO gravado como título não é designação — some',
  designacaoDoMapa('Cavalaria Blindada ou Mecanizada, Carros de Combate\n' +
                   '(código específico apenas para compatibilidade com a OTAN)', SIDC_CAV), '');
ok('e some também na forma já limpa, sem a nota da planilha',
  designacaoDoMapa('Cavalaria Blindada ou Mecanizada, Carros de Combate', SIDC_CAV), '');
ok('vale para qualquer categoria, não só cavalaria',
  designacaoDoMapa('Morteiro', getSIDC({ dimensao: 'EQUIPAMENTOS_VIATURAS', natureza_code: '111400' })), '');
ok('"Inimigo", o default de titulo no schema (0001), também não é designação',
  designacaoDoMapa('Inimigo', SIDC_CAV), '');
ok('uma designação que POR ACASO parece nome de tipo mas não é o do SIDC passa',
  designacaoDoMapa('Infantaria', SIDC_CAV), 'Infantaria');
ok('texto longo é truncado com reticências, não estoura o layout',
  designacaoDoMapa('12345678901234567890', SIDC_CAV), '12345678901…');
ok('exatamente no limite não trunca', designacaoDoMapa('123456789012', SIDC_CAV), '123456789012');
ok('o limite é ajustável (o popup usa 40, o mapa usa 12)',
  designacaoDoMapa('1º Esqd/5º RCC Mec', SIDC_CAV, { maximo: 40 }), '1º Esqd/5º RCC Mec');
ok('SIDC inválido não impede mostrar a designação digitada',
  designacaoDoMapa('1º/5º RCC', 'nao-e-sidc'), '1º/5º RCC');

// A separação nome/observação, feita na geração do catálogo (2026-08-02).
console.log('\nNome x observação: a nota da planilha não faz parte do nome');
ok('nenhum nome do catálogo tem quebra de linha embutida',
  CATEGORIAS.flatMap((c) => c.grupos.flatMap((g) => g.itens))
    .filter(([, nome]) => nome.includes('\n')).length, 0);
ok('nenhum rótulo de modificador tem quebra de linha embutida',
  CATEGORIAS.flatMap((c) => [...c.mod1, ...c.mod2])
    .filter(([, rotulo]) => rotulo.includes('\n')).length, 0);
ok('a nota não some do catálogo: vira o terceiro elemento da tupla',
  nomeDoItem('unidades', '120500') === 'Cavalaria Blindada ou Mecanizada, Carros de Combate' &&
  CATEGORIAS.find((c) => c.id === 'unidades').grupos
    .flatMap((g) => g.itens).find(([cod]) => cod === '120500')[2]
    .includes('compatibilidade com a OTAN'),
  true);
ok('e o resumo do popup não arrasta mais a nota junto',
  descreverSidc(SIDC_CAV), 'Cavalaria Blindada ou Mecanizada, Carros de Combate · Pelotão');

// ── Precedência da origem do SIDC do usuário (Etapa 9b, decisão 3) ─────────
console.log('\nsidcDeFabrica() — de onde vem o símbolo de um usuário');
const PERFIL_SEED = { sidc: '10031000140000000000' };
ok('perfil com sidc (vindo do seed da 2c ou do default do schema) usa o do perfil',
  sidcDeFabrica(PERFIL_SEED), '10031000140000000000');
ok('perfil sem sidc cai no default do schema, nunca em undefined',
  sidcDeFabrica({}), '10031000000000000000');
ok('perfil nulo também cai no default (a tela nunca fica sem símbolo)',
  sidcDeFabrica(null), '10031000000000000000');
ok('PONTO DE EXTENSÃO DA 6.5: quando houver ORBAT, o sidc da unidade ganha do perfil',
  sidcDeFabrica(PERFIL_SEED, { sidcDaUnidade: '10031000170000000000' }), '10031000170000000000');
ok('sidc de unidade malformado é ignorado (não derruba para um símbolo inválido)',
  sidcDeFabrica(PERFIL_SEED, { sidcDaUnidade: 'orbat-ainda-nao-existe' }), '10031000140000000000');

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
