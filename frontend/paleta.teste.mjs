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
// Para a seção de hostilidade da paleta. svgDoSimbolo() em si não é testável
// aqui (importa leaflet/milsymbol, que não rodam em Node) — mas a regra que
// ela precisa aplicar é esta, e é puramente de simbolos.js.
import { sidcParaObservador, sidcExigeDesignacao } from './simbolos.js';
// Puro também (só monta strings de <option> a partir do catálogo) — é o que
// permite testar aqui a lista que a aba do instrutor oferece.
import { opcoesItem } from './catalogo-form.js';

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
console.log('\nPaleta — a COR do botão (regressão de 2026-09-14)');
// =============================================================================
// Bug relatado no primeiro uso: TODOS os botões da paleta saíam amarelos, o
// losango de "desconhecido" do APP-6D. Causa: svgDoSimbolo() desenhava o SIDC
// CRU, e o dígito de hostilidade gravado é sempre um placeholder — a
// hostilidade é RELATIVA desde a Etapa 4.5 e tem que ser derivada na hora de
// desenhar, em QUALQUER lugar que desenhe, não só no mapa.
//
// Estes casos travam a regra que a paleta precisa aplicar. Se alguém "otimizar"
// svgDoSimbolo() de volta para desenhar o SIDC gravado, a primeira asserção
// abaixo continua passando (ela é sobre simbolos.js) — por isso a última
// asserção é a que importa: ela declara, em uma linha, que o SIDC gravado NÃO
// serve para desenhar.
const AZUL = { id: 'a', tipo: 'beligerante', ordem: 1 };
const VERM = { id: 'v', tipo: 'beligerante', ordem: 2 };
const hostilidadeDe = (sidc) => sidc.slice(2, 4);

ok('o SIDC GRAVADO tem hostilidade placeholder (nunca desenhe cru)',
  hostilidadeDe(SIDC_OK), '01');
ok('instrutor (sem força) vendo preset do Vermelho -> HOSTIL',
  hostilidadeDe(sidcParaObservador(SIDC_OK, null, VERM)), '06');
ok('instrutor (sem força) vendo preset do Azul -> AMIGO',
  hostilidadeDe(sidcParaObservador(SIDC_OK, null, AZUL)), '03');
ok('aluno do Azul vendo preset do Vermelho -> HOSTIL',
  hostilidadeDe(sidcParaObservador(SIDC_OK, AZUL, VERM)), '06');
// O MESMO preset, dois alunos, duas cores — é a prova de que o botão não pode
// ter uma cor fixa gravada junto com ele.
ok('aluno do Vermelho vendo o MESMO preset -> AMIGO',
  hostilidadeDe(sidcParaObservador(SIDC_OK, VERM, VERM)), '03');
ok('o mesmo preset desenha DIFERENTE para os dois lados',
  sidcParaObservador(SIDC_OK, AZUL, VERM) !== sidcParaObservador(SIDC_OK, VERM, VERM), true);
// Preset "Perguntar ao aluno": amarelo é a resposta certa, não um bug.
ok('preset sem força continua desconhecido (a força quem escolhe é o aluno)',
  hostilidadeDe(sidcParaObservador(SIDC_OK, AZUL, null)), '01');

// =============================================================================
// Símbolo sem desenho central NUNCA vira preset (2026-09-14)
// =============================================================================
//
// Relatado em campo, e a frase de quem usa é o requisito inteiro: *"o sentido
// de ter um banco de símbolos rápidos é justamente ele aparecer daquela forma
// no mapa"*. "Comando Nomeado" (`10:000000`) é desenhado com a SIGLA da unidade
// no centro, e um preset não tem onde guardar sigla — então ali ele sai como
// moldura vazia, no botão e no mapa.
//
// Por que RECUSAR aqui e só AVISAR no formulário de marcação: lá existe o campo
// da sigla, então o símbolo funciona e a decisão é de quem marca. Aqui não
// existe o que preencher.
//
// O agravante que fez isso acontecer de verdade: `000000` é o PRIMEIRO item da
// categoria "Unidades" (grupo de um item só), ou seja o que fica selecionado
// sozinho quando alguém abre aquela categoria e não mexe no <select>.
console.log('\n── Preset que sairia sem desenho: recusa, não aviso ──────');

// SIDC de "Comando Nomeado": symbol set 10, entidade 000000.
const SIDC_SEM_DESENHO = '10011000000000000000';
ok('o SIDC do Comando Nomeado é reconhecido como "exige sigla"',
  sidcExigeDesignacao(SIDC_SEM_DESENHO), true);
ok('e o SIDC de um preset normal, não',
  sidcExigeDesignacao(SIDC_OK), false);
ok('SIDC malformado devolve false — "não sei dizer" não é "exige sigla"',
  sidcExigeDesignacao('nao-e-sidc'), false);

const recusado = validarPreset({ rotulo: 'Cmdo', sidc: SIDC_SEM_DESENHO });
ok('validarPreset RECUSA um preset com esse símbolo', recusado.ok, false);
ok('e a recusa explica o motivo, não só "inválido"',
  /sigla/i.test(recusado.erro || ''), true);
ok('e diz para onde ir (o formulário completo tem o campo)',
  /formul/i.test(recusado.erro || ''), true);
ok('o preset normal continua passando (a recusa é cirúrgica)',
  validarPreset({ rotulo: 'CC', sidc: SIDC_OK }).ok, true);

// A lista de ícones da aba do instrutor não pode nem OFERECER a opção — uma
// interface que oferece e depois nega é pior que uma que não oferece.
const itensUnidades = opcoesItem('unidades', '');
const itensUnidadesFiltrado = opcoesItem('unidades', '', { somenteComDesenho: true });
ok('sem o filtro, "Comando Nomeado" está na lista (é o caminho do formulário de marcação)',
  itensUnidades.includes('value="000000"'), true);
ok('com o filtro, ele some',
  itensUnidadesFiltrado.includes('value="000000"'), false);
ok('e o <optgroup> vazio some junto, sem deixar título de seção órfão',
  itensUnidadesFiltrado.includes('Comando e Controle não especificado'), false);
ok('o resto da categoria continua inteiro (some UM item, não o grupo todo)',
  itensUnidadesFiltrado.includes('value="121100"'), true);
ok('e o filtro não mexe em outra categoria',
  opcoesItem('aeronaves', '', { somenteComDesenho: true }) === opcoesItem('aeronaves', ''), true);

// A paleta PADRÃO da 0010 é escrita à mão na migration — se um dia alguém
// trocar um código ali por um que não desenha, é aqui que aparece.
console.log('\n── A paleta padrão da 0010 desenha, preset a preset ──────');
const PALETA_PADRAO = [
  ['CC',      '10011500001202000000'],
  ['VBTP',    '10011500001201030000'],
  ['Inf',     '10011000001211000000'],
  ['Inf Mec', '10011000001211020000'],
  ['Rec',     '10011000001205010000'],
  ['Art Cmp', '10011000001303000000'],
  ['Mrt',     '10011500001114000000'],
  ['Vtr',     '10011500001401000000'],
];
for (const [rotulo, sidc] of PALETA_PADRAO) {
  ok(`"${rotulo}" passa na validação e tem desenho próprio`,
    validarPreset({ rotulo, sidc }).ok, true);
}

// =============================================================================
// A lacuna de envio quando o celular dorme (2026-09-14)
// =============================================================================
//
// Pergunta de campo: *"sempre que apagar a tela do celular perderei a
// atualização da posição?"* Sim — o sistema congela a página e não há API web
// de geolocalização em segundo plano. O que gps.js faz ao despertar é gravar
// na hora e DIZER quanto tempo ficou sem enviar.
//
// A decisão de "vale relatar?" não é uma regra nova: é `rotuloIdade()`, a
// mesma que escreve a etiqueta ao lado do avatar na tela de quem acompanha.
// Isso amarra as duas pontas por construção — o aluno só é avisado de uma
// lacuna que alguém do outro lado teve chance de ver, e com as MESMAS
// palavras. Se alguém mexer no limiar, as duas mudam juntas ou nenhuma muda.
console.log('\n── Lacuna de envio: o aluno lê o que o instrutor viu ────');

ok('lacuna curta (um piscar de tela) não vira relato',
  rotuloIdade(AVISO_PARADO_MS - 1), '');
ok('no limiar em que o instrutor passa a ver etiqueta, o aluno passa a ser avisado',
  rotuloIdade(AVISO_PARADO_MS), '1m');
ok('celular no bolso por 12 minutos -> "12m", igual ao que o instrutor viu',
  rotuloIdade(12 * 60_000), '12m');
ok('exercício inteiro com a tela apagada -> "+24h", sem número absurdo',
  rotuloIdade(30 * 60 * 60_000), '+24h');
ok('e o rótulo cabe na linha de status (nunca mais que 5 caracteres)',
  [0, AVISO_PARADO_MS, 12 * 60_000, 95 * 60_000, 30 * 60 * 60_000]
    .every((ms) => rotuloIdade(ms).length <= 5), true);

// =============================================================================
console.log(`\n${passou} passou, ${falhou} falhou, ${passou + falhou} total\n`);
process.exit(falhou > 0 ? 1 : 0);
