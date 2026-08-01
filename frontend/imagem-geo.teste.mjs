// Teste de frontend/imagem-geo.js — Etapa 8b.
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/imagem-geo.teste.mjs
//
// O que ele prova, e por que cada coisa está aqui:
//
//   1. TAMANHO RECUSA ANTES DE GASTAR O UPLOAD, no mesmo espírito de
//      validarArquivo() em kml.js — e com um teto DIFERENTE (3 MB, contra os
//      2 MB do KML compartilhado), porque a decisão 3 da Etapa 8b tratou os
//      dois como problemas parecidos mas não idênticos.
//   2. BOUNDS INCOERENTES NUNCA VIRAM UM `L.imageOverlay` DESENHADO NO LUGAR
//      ERRADO. Cantos invertidos, fora do globo ou formando um retângulo
//      degenerado são recusados ANTES de chegar no Leaflet — o mesmo
//      raciocínio de planejarCarga() em kml.js recusar geometria grande demais
//      antes do navegador tentar desenhar.
//   3. A CONTA DE EGRESS É CALCULADA SOBRE O TAMANHO REAL, não uma tabela
//      fixa — dobrar o arquivo tem que dobrar a estimativa, e mudar o número
//      de alunos/recargas (parâmetro opcional) tem que mudar o resultado sem
//      exigir reescrever a fórmula em outro lugar.

import {
  LIMITE_BYTES_IMAGEM,
  ALUNOS_TIPICOS,
  RECARGAS_TIPICAS,
  EGRESS_MENSAL_PLANO_FREE_BYTES,
  formatoDoArquivoImagem,
  validarArquivoImagem,
  validarBounds,
  estimarEgress,
  textoEgress,
} from './imagem-geo.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = Object.is(obtido, esperado);
  bom ? passou++ : falhou++;
  const marca = bom ? 'PASSOU' : '** FALHOU **';
  console.log(`${marca}  ${descricao}`);
  if (!bom) console.log(`          esperado: ${JSON.stringify(esperado)}\n          obtido:   ${JSON.stringify(obtido)}`);
}
function okVerdade(descricao, condicao) { ok(descricao, !!condicao, true); }

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── Formato do arquivo ─────────────────────────────────────');

ok('.jpg é reconhecido',                formatoDoArquivoImagem('foto.jpg'), 'jpg');
ok('.JPEG maiúsculo normaliza para jpg', formatoDoArquivoImagem('FOTO.JPEG'), 'jpg');
ok('.png é reconhecido',                formatoDoArquivoImagem('carta.png'), 'png');
ok('.kml não é aceito por esta via',    formatoDoArquivoImagem('calco.kml'), null);
ok('nome sem extensão não é aceito',    formatoDoArquivoImagem('foto'), null);
ok('nulo não quebra',                   formatoDoArquivoImagem(null), null);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── validarArquivoImagem ───────────────────────────────────');

okVerdade('arquivo .png dentro do limite passa',
  validarArquivoImagem({ nome: 'ortofoto.png', tamanho: LIMITE_BYTES_IMAGEM }).ok);
ok('formato devolvido é o normalizado',
  validarArquivoImagem({ nome: 'ortofoto.JPEG', tamanho: 1000 }).formato, 'jpg');
okVerdade('arquivo 1 byte acima do limite é recusado',
  !validarArquivoImagem({ nome: 'grande.jpg', tamanho: LIMITE_BYTES_IMAGEM + 1 }).ok);
okVerdade('mensagem de recusa por tamanho cita o limite',
  validarArquivoImagem({ nome: 'grande.jpg', tamanho: LIMITE_BYTES_IMAGEM + 1 }).motivo.includes('3.0 MB')
  || validarArquivoImagem({ nome: 'grande.jpg', tamanho: LIMITE_BYTES_IMAGEM + 1 }).motivo.includes('MB'));
okVerdade('extensão não suportada é recusada',
  !validarArquivoImagem({ nome: 'mapa.tif', tamanho: 1000 }).ok);
okVerdade('arquivo vazio é recusado',
  !validarArquivoImagem({ nome: 'vazio.png', tamanho: 0 }).ok);
okVerdade('tamanho negativo é recusado',
  !validarArquivoImagem({ nome: 'x.png', tamanho: -5 }).ok);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── validarBounds ──────────────────────────────────────────');

const bboxOk = { norte: -22.00, sul: -22.05, leste: -47.00, oeste: -47.08 };
okVerdade('retângulo coerente passa', validarBounds(bboxOk).ok);
ok('bounds devolvido tem os quatro números',
  Object.keys(validarBounds(bboxOk).bounds).sort().join(','),
  'leste,norte,oeste,sul');

okVerdade('norte igual a sul é recusado',
  !validarBounds({ norte: -22, sul: -22, leste: -47, oeste: -47.1 }).ok);
okVerdade('norte abaixo de sul (invertido) é recusado',
  !validarBounds({ norte: -22.05, sul: -22.00, leste: -47.00, oeste: -47.08 }).ok);
okVerdade('leste igual a oeste é recusado',
  !validarBounds({ norte: -22, sul: -22.05, leste: -47, oeste: -47 }).ok);
okVerdade('leste à esquerda do oeste (invertido) é recusado',
  !validarBounds({ norte: -22, sul: -22.05, leste: -47.08, oeste: -47.00 }).ok);
okVerdade('latitude fora do globo é recusada',
  !validarBounds({ norte: 95, sul: -22.05, leste: -47.00, oeste: -47.08 }).ok);
okVerdade('longitude fora do globo é recusada',
  !validarBounds({ norte: -22, sul: -22.05, leste: 185, oeste: -47.08 }).ok);
okVerdade('valor não numérico é recusado',
  !validarBounds({ norte: 'x', sul: -22.05, leste: -47.00, oeste: -47.08 }).ok);
okVerdade('campo ausente é recusado',
  !validarBounds({ norte: -22, sul: -22.05, leste: -47.00 }).ok);
okVerdade('retângulo degenerado (dois cliques quase no mesmo ponto) é recusado',
  !validarBounds({ norte: -22.000000, sul: -22.000001, leste: -47.000000, oeste: -47.000001 }).ok);
okVerdade('retângulo pequeno mas real (dezenas de metros) passa',
  validarBounds({ norte: -22.0000, sul: -22.0006, leste: -47.0000, oeste: -47.0006 }).ok);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n── estimarEgress / textoEgress ────────────────────────────');

const um = estimarEgress(1 * 1024 * 1024, { alunos: 60, recargas: 5 });
const dois = estimarEgress(2 * 1024 * 1024, { alunos: 60, recargas: 5 });
ok('dobrar o arquivo dobra o custo por carga', dois.porCarga, um.porCarga * 2);
ok('custo por carga é tamanho × alunos',
  um.porCarga, 1 * 1024 * 1024 * 60);
ok('custo por exercício é custo por carga × recargas',
  um.porExercicio, um.porCarga * 5);
ok('percentual mensal usa o teto do plano Free (5 GB)',
  Math.round((um.porExercicio / EGRESS_MENSAL_PLANO_FREE_BYTES) * 100 * 100),
  Math.round(um.percentualMensal * 100));
ok('padrão de alunos/recargas é 60 e 5',
  JSON.stringify([ALUNOS_TIPICOS, RECARGAS_TIPICAS]), JSON.stringify([60, 5]));
okVerdade('parâmetro de alunos muda o resultado',
  estimarEgress(1024, { alunos: 10, recargas: 5 }).porCarga
  < estimarEgress(1024, { alunos: 60, recargas: 5 }).porCarga);
ok('tamanho ausente não quebra (vira 0)', estimarEgress(undefined).porCarga, 0);

okVerdade('texto de egress cita o tamanho do arquivo',
  textoEgress(2 * 1024 * 1024).includes('2.0 MB'));
okVerdade('texto de egress cita a palavra egress ou orçamento',
  /egress|orçamento/i.test(textoEgress(1024 * 1024)));

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(58)}`);
console.log(`${passou} passaram, ${falhou} falharam de ${passou + falhou}`);
if (falhou > 0) process.exit(1);
