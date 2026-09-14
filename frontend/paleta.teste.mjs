// Teste de frontend/paleta.js e frontend/vigia-ausencia.js (2026-09-14).
//
// Roda sem navegador e sem dependência nenhuma:
//     node frontend/paleta.teste.mjs
//
// Duas mudanças do mesmo dia, testadas no mesmo arquivo porque ambas são
// regra pura sobre o que a tela mostra:
//
//   1. A ETIQUETA DE IDADE que substituiu o esmaecimento dos avatares.
//      O que precisa de teste aqui não é a aparência, é a FRONTEIRA: a
//      etiqueta não pode aparecer numa posição recente (senão todo avatar do
//      exercício nasce com um rótulo grudado) e TEM que aparecer a partir do
//      limiar (senão a mudança de 2026-09-14 apenas removeu informação da
//      tela, que era exatamente o risco de tirar o esmaecimento).
//
//   2. A PALETA DE ÍCONES RÁPIDOS: validação de preset, ordenação estável e
//      a regra do modo híbrido. O SIDC do preset é copiado direto para a
//      marcação gravada, então um preset que passa na validação com um SIDC
//      ruim vira marcação errada na tela de 60 pessoas.

import {
  rotuloIdade, AVISO_PARADO_MS, SEM_SINAL_MS, INTERVALO_VIGIA_MS,
} from './vigia-ausencia.js';
import {
  validarPreset, cabeMaisUm, ordenarPaleta, vigentes, proximaOrdem,
  modoDoPreset, valoresDaMarcacao, MAX_PRESETS, MAX_ROTULO, PASSO_ORDEM,
} from './paleta.js';

let passou = 0, falhou = 0;
function ok(descricao, obtido, esperado) {
  const bom = JSON.stringify(obtido) === JSON.stringify(esperado);
  bom ? passou++ : falhou++;
  console.log(`  ${(bom ? 'PASSOU' : '** FALHOU **').padEnd(14)} ${descricao}`);
  if (!bom) console.log(`                 esperado: ${JSON.stringify(esperado)}\n                 obtido:   ${JSON.stringify(obtido)}`);
}

// =============================================================================
console.log('\nEtiqueta de idade — a fronteira do silêncio');
// =============================================================================
ok('posição de agora não ganha etiqueta', rotuloIdade(0), '');
ok('1 segundo antes do limiar ainda é silêncio', rotuloIdade(AVISO_PARADO_MS - 1000), '');
ok('exatamente no limiar já avisa', rotuloIdade(AVISO_PARADO_MS), '1m');
ok('idade negativa (relógio adiantado) não vira etiqueta', rotuloIdade(-5000), '');
// idadeMs() trata `atualizado_em` nulo como "agora" desde a Etapa 4; um NaN
// chegando aqui por outro caminho não pode virar "NaNm" ao lado do símbolo.
ok('idade inválida não vira etiqueta', rotuloIdade(NaN), '');
ok('idade indefinida não vira etiqueta', rotuloIdade(undefined), '');

console.log('\nEtiqueta de idade — granularidade');
ok('2 minutos', rotuloIdade(2 * 60_000), '2m');
ok('2m59s continua 2m (não conta segundos)', rotuloIdade(2 * 60_000 + 59_000), '2m');
ok('59 minutos', rotuloIdade(59 * 60_000), '59m');
ok('1 hora cheia sai sem minutos', rotuloIdade(60 * 60_000), '1h');
ok('1h35', rotuloIdade(95 * 60_000), '1h35');
ok('1h05 com zero à esquerda (não "1h5")', rotuloIdade(65 * 60_000), '1h05');
ok('acima de 24h satura', rotuloIdade(30 * 3600_000), '+24h');
// A etiqueta divide espaço com um símbolo de 26px num celular: qualquer
// rótulo com mais de 5 caracteres começa a cobrir o desenho.
ok('nenhum rótulo passa de 5 caracteres',
  [0, AVISO_PARADO_MS, SEM_SINAL_MS, 59 * 60_000, 95 * 60_000, 30 * 3600_000]
    .every((ms) => rotuloIdade(ms).length <= 5), true);

console.log('\nLimiares — as invariantes que a mudança de 2026-09-14 não pode quebrar');
ok('o limiar de aviso continua em 2 heartbeats (60s)', AVISO_PARADO_MS, 60_000);
ok('o limiar de sem-sinal continua em 4 heartbeats (120s)', SEM_SINAL_MS, 120_000);
ok('sem-sinal vem depois de atrasado', SEM_SINAL_MS > AVISO_PARADO_MS, true);
// A vigia precisa rodar com folga dentro do primeiro limiar, senão um avatar
// passaria até 60s atrasado sem a etiqueta aparecer.
ok('a vigia checa bem antes do primeiro limiar', INTERVALO_VIGIA_MS * 2 <= AVISO_PARADO_MS, true);
// No instante em que a etiqueta aparece pela primeira vez ela diz "1m", nunca
// "0m" — "0m" ao lado de um símbolo parece defeito, não informação.
ok('a primeira etiqueta nunca é "0m"', rotuloIdade(AVISO_PARADO_MS).startsWith('0'), false);

// =============================================================================
console.log('\nPaleta — validação de preset');
// =============================================================================
const SIDC_OK = '10011500001202000000'; // Carro de Combate, do catálogo oficial
ok('preset válido passa', validarPreset({ rotulo: 'CC', sidc: SIDC_OK }).ok, true);
ok('rótulo vazio é recusado', validarPreset({ rotulo: '', sidc: SIDC_OK }).ok, false);
ok('rótulo só de espaços é recusado', validarPreset({ rotulo: '   ', sidc: SIDC_OK }).ok, false);
ok('rótulo longo demais é recusado',
  validarPreset({ rotulo: 'x'.repeat(MAX_ROTULO + 1), sidc: SIDC_OK }).ok, false);
ok('rótulo no limite exato passa',
  validarPreset({ rotulo: 'x'.repeat(MAX_ROTULO), sidc: SIDC_OK }).ok, true);
ok('o rótulo sai sem espaços nas pontas',
  validarPreset({ rotulo: '  CC  ', sidc: SIDC_OK }).valor.rotulo, 'CC');

// O SIDC é COPIADO para a marcação sem passar por getSIDC() de novo, então um
// formato errado aqui vira símbolo errado no mapa — exatamente a classe de
// erro que a Etapa 9b encontrou nas tabelas escritas à mão.
ok('SIDC curto é recusado', validarPreset({ rotulo: 'CC', sidc: '100115000012020' }).ok, false);
ok('SIDC longo é recusado', validarPreset({ rotulo: 'CC', sidc: SIDC_OK + '0' }).ok, false);
ok('SIDC com letra é recusado', validarPreset({ rotulo: 'CC', sidc: '1001150000120200000X' }).ok, false);
ok('SIDC ausente é recusado', validarPreset({ rotulo: 'CC' }).ok, false);
ok('SIDC não-string é recusado', validarPreset({ rotulo: 'CC', sidc: 12345 }).ok, false);
// O mesmo formato que o `check` de 0010 e o de perfis/elementos_marcados.
ok('a regra de SIDC é a mesma do banco (20 dígitos)', /^[0-9]{20}$/.test(SIDC_OK), true);

console.log('\nPaleta — teto de tamanho');
ok('paleta vazia cabe mais', cabeMaisUm([]).cabe, true);
ok('paleta vazia informa quantos cabem', cabeMaisUm([]).restam, MAX_PRESETS);
ok('no teto não cabe mais', cabeMaisUm(new Array(MAX_PRESETS).fill({})).cabe, false);
ok('no teto o erro explica o motivo', cabeMaisUm(new Array(MAX_PRESETS).fill({})).erro.includes('celular'), true);
ok('um abaixo do teto ainda cabe', cabeMaisUm(new Array(MAX_PRESETS - 1).fill({})).cabe, true);
ok('entrada inválida não quebra a conta', cabeMaisUm(null).cabe, true);
// O mesmo número está no trigger fn_limitar_icones_rapidos (0010). Se um dia
// divergirem, o cliente deixa acrescentar e o banco recusa — erro cru do
// PostgREST na cara do instrutor.
ok('o teto do cliente é 12, igual ao do banco', MAX_PRESETS, 12);

console.log('\nPaleta — ordenação estável');
const desordenada = [
  { id: 'c', ordem: 20, criado_em: '2026-09-01T10:00:00Z' },
  { id: 'a', ordem: 10, criado_em: '2026-09-01T10:00:00Z' },
  { id: 'b', ordem: 10, criado_em: '2026-09-01T09:00:00Z' },
];
ok('ordena por ordem e desempata por criado_em',
  ordenarPaleta(desordenada).map((x) => x.id), ['b', 'a', 'c']);
// O seed de 0010 insere os 8 presets padrão numa transação só, e vários
// bancos carimbam now() idêntico para todos. Sem o terceiro critério (id), a
// paleta trocaria de arranjo entre uma carga de página e outra — na mão de
// quem decorou onde ficava o botão do CC.
const empatadas = [
  { id: 'z', ordem: 10, criado_em: '2026-09-01T10:00:00Z' },
  { id: 'm', ordem: 10, criado_em: '2026-09-01T10:00:00Z' },
  { id: 'a', ordem: 10, criado_em: '2026-09-01T10:00:00Z' },
];
ok('empate total desempata por id (arranjo estável)',
  ordenarPaleta(empatadas).map((x) => x.id), ['a', 'm', 'z']);
ok('a ordenação não depende da ordem de entrada',
  ordenarPaleta([...empatadas].reverse()).map((x) => x.id),
  ordenarPaleta(empatadas).map((x) => x.id));
ok('ordenar não muda o array original', desordenada[0].id, 'c');
ok('entrada vazia devolve lista vazia', ordenarPaleta(null), []);

console.log('\nPaleta — exclusão lógica e próxima ordem');
const comRemovido = [
  { id: 'a', ordem: 10 },
  { id: 'b', ordem: 20, removido_em: '2026-09-10T12:00:00Z' },
  { id: 'c', ordem: 30 },
];
ok('vigentes ignora o que foi removido', vigentes(comRemovido).map((x) => x.id), ['a', 'c']);
// Um preset removido não segura a vaga dele: o teto conta só o vigente, e o
// trigger de 0010 faz a mesma conta.
ok('o removido não conta para o teto', cabeMaisUm(vigentes(comRemovido)).restam, MAX_PRESETS - 2);
ok('o novo entra depois do último vigente', proximaOrdem(comRemovido), 30 + PASSO_ORDEM);
ok('paleta vazia começa em um passo', proximaOrdem([]), PASSO_ORDEM);
// Passo maior que 1 é o que permite inserir alguém no meio depois sem
// renumerar a lista inteira (um UPDATE por linha = um evento de Realtime por
// linha, para os 60 aparelhos da turma).
ok('o passo deixa espaço entre os itens', PASSO_ORDEM > 1, true);

// =============================================================================
console.log('\nPaleta — o modo híbrido (quantos toques a marcação custa)');
// =============================================================================
const comPartido = { id: 'p1', rotulo: 'CC', sidc: SIDC_OK, partido_padrao_id: 'uuid-vermelho' };
const semPartido = { id: 'p2', rotulo: 'Vtr', sidc: SIDC_OK, partido_padrao_id: null };
ok('preset com força grava direto', modoDoPreset(comPartido), 'gravar');
ok('preset sem força pergunta', modoDoPreset(semPartido), 'perguntar');
ok('preset inexistente não grava nada por engano', modoDoPreset(null), 'perguntar');
ok('partido vazio conta como sem força',
  modoDoPreset({ partido_padrao_id: '' }), 'perguntar');

console.log('\nPaleta — valores que vão para a marcação');
ok('o SIDC é copiado sem transformação', valoresDaMarcacao(comPartido).sidc, SIDC_OK);
ok('o partido do preset é usado quando existe',
  valoresDaMarcacao(comPartido).partidoId, 'uuid-vermelho');
ok('a escolha do aluno tem precedência sobre o padrão',
  valoresDaMarcacao(comPartido, 'uuid-azul').partidoId, 'uuid-azul');
ok('"Não identificado" (string vazia) vira nulo, não string vazia',
  valoresDaMarcacao(semPartido, '').partidoId, null);
ok('preset sem força e sem escolha grava partido nulo',
  valoresDaMarcacao(semPartido).partidoId, null);
// A designação é o número/nome da unidade observada, e ninguém sabe isso de
// antemão. Gravar o tipo aqui foi a regressão de 2026-08-02, que pôs o nome
// oficial inteiro atravessando o mapa ao lado do símbolo.
ok('a designação sai vazia (o tipo já está no SIDC)',
  valoresDaMarcacao(comPartido).designacao, '');

// =============================================================================
console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou > 0 ? 1 : 0);
