// designacao.teste.mjs — a numeração do calunga.   Rodar: node frontend/designacao.teste.mjs
import * as D from './designacao.js';
let passou = 0; const falhas = [];
function ok(nome, obtido, esperado) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) passou += 1;
  else { falhas.push(nome); console.log(`  ** FALHOU **  ${nome}\n     esperado: ${JSON.stringify(esperado)}\n     obtido:   ${JSON.stringify(obtido)}`); }
}
ok('normalizar: vazio/espaços/null/undefined → null', [D.normalizarCampo(''), D.normalizarCampo('  '), D.normalizarCampo(null), D.normalizarCampo(undefined)], [null, null, null, null]);
ok('normalizar apara', D.normalizarCampo('  1 '), '1');
ok('número 0 (zero) é um número válido, não "vazio"', D.normalizarCampo(0), '0');
ok('número de 4 passa, de 5 não', [D.validarNumero('1234').ok, D.validarNumero('12345').ok], [true, false]);
ok('número vazio passa e vira null', D.validarNumero('  '), { ok: true, valor: null });
ok('fração de 20 passa, de 21 não', [D.validarFracao('x'.repeat(20)).ok, D.validarFracao('x'.repeat(21)).ok], [true, false]);
// A regra de compatibilidade
ok('sem número: o nome de guerra continua ao lado do símbolo', D.opcoesDeDesignacao({ nome_guerra: 'Paulo' }), { designacao: 'Paulo', numeroEsq: '', numeroDir: '' });
ok('com os dois números: números, e o nome de guerra sai', D.opcoesDeDesignacao({ nome_guerra: 'Paulo', numero_esq: '1', numero_dir: '2' }), { designacao: '', numeroEsq: '1', numeroDir: '2' });
ok('só o da esquerda', D.opcoesDeDesignacao({ nome_guerra: 'Paulo', numero_esq: '1' }), { designacao: '', numeroEsq: '1', numeroDir: '' });
ok('só o da direita', D.opcoesDeDesignacao({ nome_guerra: 'Paulo', numero_dir: '2' }), { designacao: '', numeroEsq: '', numeroDir: '2' });
ok('número só de espaços conta como ausente', D.opcoesDeDesignacao({ nome_guerra: 'Paulo', numero_esq: ' ' }).designacao, 'Paulo');
ok('perfil nulo não quebra', D.opcoesDeDesignacao(null), { designacao: '', numeroEsq: '', numeroDir: '' });
ok('o nome da fração NÃO entra no desenho', Object.keys(D.opcoesDeDesignacao({ nome_guerra: 'P', numero_esq: '1', nome_fracao: 'Pel' })).includes('nome_fracao'), false);
ok('chave de desenho muda com número', D.chaveDeDesenho({ sidc: 'a', nome_guerra: 'b' }) !== D.chaveDeDesenho({ sidc: 'a', nome_guerra: 'b', numero_esq: '1' }), true);
ok('chave de desenho NÃO muda com o nome da fração', D.chaveDeDesenho({ sidc: 'a', nome_guerra: 'b', nome_fracao: 'x' }), D.chaveDeDesenho({ sidc: 'a', nome_guerra: 'b', nome_fracao: 'y' }));
ok('nome da fração', [D.nomeDaFracao({ nome_fracao: ' 1º Pel ' }), D.nomeDaFracao({}), D.nomeDaFracao(null)], ['1º Pel', '', '']);
ok('escaparTexto', D.escaparTexto('<img src=x onerror=alert(1)> & "a"'), '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;a&quot;');
ok('resumo dos números', [D.resumoDosNumeros({ numero_esq: '1', numero_dir: '2' }), D.resumoDosNumeros({ numero_dir: '2' }), D.resumoDosNumeros({})], ['1 | 2', '· | 2', '']);
console.log(`\n${passou} passaram, ${falhas.length} falharam, ${passou + falhas.length} total`);
process.exit(falhas.length ? 1 : 0);
