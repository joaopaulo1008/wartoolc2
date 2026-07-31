// Teste de frontend/marcacoes.js — Etapa 5.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/marcacoes.teste.mjs
//
// marcacoes.js em si NÃO é importado aqui: ele importa auth.js, que importa
// o supabase-js de uma URL https:// (via esm.sh) — o loader padrão do Node
// não resolve esse protocolo, então importar marcacoes.js diretamente falha
// fora do navegador (confirmado ao escrever este teste). Por isso a lógica
// de SIDC que a Etapa 5 introduziu (a tabela NATUREZA e o par
// getSIDC()/decomporSidc()) foi deixada em simbolos.js, que não tem
// dependência nenhuma — é o mesmo motivo de simbolos.teste.mjs existir e
// rodar isolado. Este arquivo prova especificamente o que a Etapa 5
// acrescentou: montar o SIDC de uma marcação a partir dos rótulos do
// formulário (nunca hostilidade) e voltar do SIDC gravado para esses
// mesmos rótulos, para o formulário de edição.
import {
  getSIDC, decomporSidc, NATUREZA, DIMENSAO, ESCALAO,
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
  dimensao: 'UNIDADE',
  escalao: 'PEL',
  natureza_code: NATUREZA['Infantaria Mecanizada'],
});
ok('o dígito de hostilidade sai como placeholder (01, desconhecido) — não é pedido no formulário',
  sidcInfantaria.slice(2, 4), '01');
ok('dimensão/escalão/natureza ficam nas posições certas do SIDC de 20 dígitos',
  sidcInfantaria, '10' + '01' + '10' + '0' + '0' + '13' + '121103'.padEnd(10, '0'));
ok('natureza desconhecida (não cadastrada em NATUREZA) cai no 000000 — sem quebrar',
  getSIDC({ dimensao: 'UNIDADE', escalao: 'PEL', natureza_code: undefined }).slice(10),
  '0000000000');

// ── Decomposição (para pré-preencher o formulário de EDIÇÃO) ───────────────
// Testa uma variável de cada vez (não o produto cartesiano das três tabelas)
// — o objetivo é provar que CADA tabela decompõe de volta corretamente para
// TODAS as suas chaves reais, sem gerar centenas de asserções repetitivas.
console.log('\ndecomporSidc() — o inverso de getSIDC(), usado ao editar uma marcação');

// ESCALAO tem chaves sinônimas com o MESMO valor (CIA/BIA/ESC = '14', '' e
// NONE = '00') — decomporSidc() sempre devolve a PRIMEIRA chave do objeto com
// aquele valor, então só testamos o roundtrip para as chaves que são, elas
// mesmas, essa primeira ocorrência (senão o teste "esperaria" a chave errada
// por um motivo que não é bug nenhum).
function primeiraChaveDoValor(tabela, chave) {
  return Object.keys(tabela).find((k) => tabela[k] === tabela[chave]) === chave;
}

console.log('  (variando dimensão, com escalão=PEL e natureza=Infantaria fixos)');
for (const dimensaoChave of Object.keys(DIMENSAO)) {
  const sidc = getSIDC({ dimensao: dimensaoChave, escalao: 'PEL', natureza_code: NATUREZA.Infantaria });
  ok(`roundtrip dimensão=${dimensaoChave}`, decomporSidc(sidc).dimensao, dimensaoChave);
}

console.log('  (variando escalão, com dimensão=UNIDADE e natureza=Infantaria fixos)');
for (const escalaoChave of Object.keys(ESCALAO)) {
  if (!primeiraChaveDoValor(ESCALAO, escalaoChave)) continue;
  const sidc = getSIDC({ dimensao: 'UNIDADE', escalao: escalaoChave, natureza_code: NATUREZA.Infantaria });
  ok(`roundtrip escalão=${escalaoChave || '(vazio)'}`, decomporSidc(sidc).escalao, escalaoChave);
}

console.log('  (variando natureza, com dimensão=UNIDADE e escalão=PEL fixos)');
for (const [naturezaChave, naturezaValor] of Object.entries(NATUREZA)) {
  const sidc = getSIDC({ dimensao: 'UNIDADE', escalao: 'PEL', natureza_code: naturezaValor });
  ok(`roundtrip natureza=${naturezaChave}`, decomporSidc(sidc).natureza, naturezaChave);
}

ok('SIDC malformado decompõe para os três campos vazios (não quebra o formulário)',
  decomporSidc('nao-e-sidc'), { dimensao: '', escalao: '', natureza: '' });
ok('natureza com código que NÃO está em NATUREZA (ex.: gravado por outro caminho) decompõe vazia',
  decomporSidc(getSIDC({ dimensao: 'UNIDADE', escalao: 'PEL', natureza_code: '999999' })).natureza, '');
ok('SIDC default de perfis.sidc (000000 = "Desconhecido/Não identificado") decompõe corretamente',
  decomporSidc('10031000000000000000').natureza, 'Desconhecido / Não identificado');

console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou === 0 ? 0 : 1);
