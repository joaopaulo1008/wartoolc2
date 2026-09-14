// marcacoes.js — Etapa 5 do roadmap: marcação de elemento no mapa.
//
// Responsabilidade deste módulo: deixar o usuário tocar no mapa, descrever o
// que viu (tipo/natureza, dimensão, escalão e o PARTIDO do elemento — nunca
// "hostilidade", que não existe mais como campo de entrada desde a Etapa 4.5)
// e gravar isso em `elementos_marcados`, compartilhado com quem a RLS deixar
// ver. Mostra também as marcações dos outros, sempre desenhadas através de
// `sidcParaObservador()` — nunca o SIDC cru gravado no banco.
//
// A tabela `elementos_marcados` e a RLS dela já existem desde a Etapa 4.5
// (backend/supabase/0003_partidos.sql) — este módulo só é o primeiro a
// escrever nela. Mesmo padrão de módulo que gps.js/colegas.js: reusa o
// cliente Supabase de auth.js, recebe `map` por parâmetro (nunca lê `map`
// como global) e cuida só desta responsabilidade.
// Etapa 9a: `L` vinha de <script src=CDN> como global; agora é import de
// verdade (leaflet pinado em package.json na mesma versão que já se usava).
// (marcacoes.teste.mjs continua sem importar este arquivo — só simbolos.js —
// então este import não afeta o teste em Node.)
// Etapa 9b: o formulário deixou de ser quatro <select> planos sobre tabelas
// escritas à mão e passou a navegar o CATÁLOGO OFICIAL do MD/EB —
// categoria -> ícone central (agrupado por entidade APP-6D) -> modificadores.
// Ver o cabeçalho de simbolos.js e data/simbologia-eb/PROCEDENCIA.md.
// A coordenada do elemento passou a aparecer no popup, no formato que o
// usuário escolheu (preferencias.js).
import * as L from 'leaflet';
import { supabase, traduzirErro, buscarPerfilBasico, buscarPartidosDaTurma } from './auth.js';
import {
  getSIDC, decomporSidc, descreverSidc,
  CATEGORIAS, categoriaPorId, nomeDoItem, designacaoDoMapa, exigeDesignacao,
  sidcExigeDesignacao, sidcDaMarcacao,
} from './simbolos.js';
import { formatarCoordenada, observarFormatoCoordenada } from './preferencias.js';
// Distância e azimute de quem observa até o elemento marcado — o vetor que o
// observador avançado precisa para pedir fogo. Matemática pura e testável
// (inversa de Vincenty sobre o elipsoide); ver o cabeçalho de visada.js para
// por que NÃO reusa o haversine de rastro.js.
import { visada, formatarVisada } from './visada.js';
// O desenho do símbolo (resolver a hostilidade relativa + montar o L.divIcon,
// com fallback) é compartilhado com gps.js e colegas.js desde a Etapa 5 — ver
// frontend/icones.js para o raciocínio da extração.
import { criarIconeSimbolo } from './icones.js';
// Etapa 6a: três chaves mandam neste módulo.
//   criar_marcacao_inimiga   -> o toque no mapa abre (ou não) o formulário
//   editar_marcacao_propria  -> aparecem (ou não) os botões Editar/Remover
//   ver_marcacoes_outros     -> as marcações de OUTRAS pessoas são desenhadas
// A última é a única que exige guardar estado a mais: ver o comentário de
// `linhas` logo abaixo.
import { observarPermissao, pode } from './permissoes.js';
// Paleta de ícones rápidos (2026-09-14): a regra pura de "o que este preset
// faz quando tocado" e "que valores a marcação recebe". Este módulo continua
// sendo o único que escreve em `elementos_marcados` — a paleta é um atalho
// para o MESMO salvarMarcacao(), nunca um segundo caminho até o banco.
import { modoDoPreset, valoresDaMarcacao } from './paleta.js';
// A fileira de botões desenhada DENTRO deste formulário. Ela recebe o
// contêiner por parâmetro e devolve o preset tocado; quem grava continua sendo
// salvarMarcacao(), aqui embaixo. Ver o cabeçalho de paleta-tela.js para por
// que a paleta deixou de ser um cartão do painel lateral.
import { montarPaleta, desmontarPaleta } from './paleta-tela.js';
import {
  opcoesCategoria, opcoesItem, opcoesModificador, opcoesEscalao,
} from './catalogo-form.js';

// ── Estado do módulo ─────────────────────────────────────────────────────
// marcadores: id (uuid de elementos_marcados) -> { marker (Leaflet), row }.
// Só as marcações DESENHADAS no mapa agora.
const marcadores = new Map();

// linhas: id -> row. TODAS as marcações que a RLS deixou chegar ao
// navegador, desenhadas ou não.
//
// Por que as duas coisas separadas: quando o instrutor desliga
// `ver_marcacoes_outros`, as marcações dos outros saem do mapa mas continuam
// chegando pelo Realtime (a RLS não conhece o catálogo de permissões — ver o
// aviso no topo de permissoes.js). Guardando a linha aqui, religar a
// permissão redesenha tudo na hora, sem um novo select; se só tivéssemos o
// mapa de marcadores, o que passou enquanto estava desligado teria sumido
// para sempre (o Realtime não faz backfill).
const linhas = new Map();

// partidosPorId: id do partido -> { id, nome, tipo, cor }. Buscado uma vez no
// início (a turma inteira, igual buscarPerfisDaTurma em colegas.js) — usado
// tanto para montar o <select> do formulário quanto para saber o partido do
// ELEMENTO na hora de derivar a hostilidade relativa de cada marcação.
const partidosPorId = new Map();
let partidosDaTurma = [];

// Cache de perfil do AUTOR de cada marcação (para o popup mostrar "marcado
// por fulano"), no mesmo espírito do fallback sob demanda de colegas.js —
// aqui sempre sob demanda, porque nem toda marcação é vista com o mesmo
// autor duas vezes seguidas.
const perfisAutorCache = new Map();

let mapaRef = null;
let meuUserId = null;
let turmaIdRef = null;
let meuPartido = null;   // { id, tipo } — de QUEM ESTÁ OLHANDO, igual colegas.js
let meuPapel = null;     // 'usuario' | 'instrutor'

let canalAtual = null;
let painelAberto = null;   // nó DOM do formulário, enquanto estiver aberto
let marcadorTemporario = null; // "fantasma" no ponto clicado, só durante criação

// Etapa 6c: guarda de criação ADICIONAL, além de `criar_marcacao_inimiga`.
// Existe para a pegadinha registrada no ROADMAP: a policy `elementos_criar`
// (0003) exige `turma_id = fn_minha_turma()` — estar LOTADO na turma — e não
// `fn_sou_instrutor_da_turma()` (lotado OU responsável). Um instrutor que só
// RESPONDE pela turma (turmas.instrutor_id) sem estar lotado nela passa em
// `pode('criar_marcacao_inimiga')` (a view devolve tudo habilitado pelo
// papel) e mesmo assim levaria um erro cru do PostgREST ao tentar criar. O
// app do aluno nunca passa esta opção (fica `null`, então o comportamento de
// antes da Etapa 6c continua idêntico); só frontend/situacao.js passa uma
// função aqui, para avisar ANTES do clique em vez de deixar o insert falhar.
// Formato esperado: () => { permitido: boolean, motivo?: string }.
let avaliarCriacaoExtra = null;

// Função OPCIONAL que devolve { lat, lon } de quem está olhando, ou null.
// Injetada por quem chama iniciarMarcacoes(), no mesmo padrão de
// `avaliarCriacaoExtra` logo acima — e pelo mesmo motivo: marcacoes.js não
// deve saber que gps.js existe.
//
// `frontend/index.html` (app do aluno) passa `minhaPosicao` de gps.js;
// `frontend/situacao.js` (painel do instrutor) NÃO passa nada, porque ali não
// há GPS próprio rodando — e o vetor "do meu posto até o alvo" não significa
// nada para quem está olhando o exercício de fora. Sem a função, o popup
// simplesmente não mostra a linha, sem nenhum tratamento especial.
// **Generalizado em 2026-09-14**: era `obterMinhaPosicao()`, sem argumento,
// devolvendo a posição de quem olha. Virou `obterPostoObservacao(row)` porque a
// tela do instrutor precisava da MESMA linha com outra origem — o posto de quem
// MARCOU aquele elemento —, e "quem marcou" só se sabe olhando a marcação.
//
// Contrato: recebe a linha da marcação e devolve
//   { lat, lon, rotulo }   -> tem posto, desenha o vetor com esse título
//   { rotulo, motivo }     -> NÃO tem posto, e diz por quê (vira a linha cinza)
//   null                   -> esta tela não tem observador; a linha nem aparece
//
// O MOTIVO da ausência mora em quem injeta, não aqui: no app do aluno é "GPS
// ainda não fixou" ou "o instrutor ocultou sua posição"; no painel é "o autor
// ainda não reportou posição". Centralizar isso em marcacoes.js faria este
// módulo saber coisas das duas telas — é o oposto do que a injeção serve.
let obterPostoObservacao = null;

// Referência ao handler de clique registrado no mapa, para poder tirá-lo em
// pararMarcacoes() (Etapa 6c) sem sobrar um segundo listener duplicado numa
// futura chamada de iniciarMarcacoes() no mesmo mapa (troca de turma).
let cliqueHandler = null;

// Bug de campo (2026-08-01): index.html usa o MESMO mapa Leaflet para este
// módulo (tocar para marcar elemento) e para offline-tela.js (tocar duas
// vezes para desenhar a área a salvar) — os dois registram o próprio
// map.on('click', ...) e o Leaflet chama TODOS os listeners de 'click' do
// mapa, sem um "parar aqui" entre eles. Resultado: clicar para marcar o
// primeiro canto do retângulo offline também abria o formulário de
// marcação. `suspenderClique`/`retomarClique` dão a quem estiver com outra
// interação de clique ativa no mesmo mapa (hoje só offline-tela.js) um jeito
// de avisar "não é para mim" sem os dois módulos precisarem se conhecer além
// disso — o handler consulta a flag na hora do clique, então não importa a
// ordem de registro dos listeners.
let cliqueSuspenso = false;
export function suspenderClique() { cliqueSuspenso = true; }
export function retomarClique() { cliqueSuspenso = false; }

// Funções de cancelamento dos observarPermissao() registrados em
// iniciarMarcacoes(), para pararMarcacoes() poder desligá-los (Etapa 6c). O
// app do aluno nunca chama pararMarcacoes() (só inicia uma vez por carga de
// página), então este array não muda nada do comportamento de antes dela.
let desligarObservadores = [];

// Etapa 6a: atalhos de leitura das três permissões deste módulo. O valor mora
// em permissoes.js (fonte única) e é consultado na hora do uso — nada de
// copiar para uma variável daqui, que seria uma segunda fonte de verdade
// esperando para ficar desatualizada.
const podeCriar         = () => pode('criar_marcacao_inimiga');
const podeEditarPropria = () => pode('editar_marcacao_propria');
const podeVerDeOutros   = () => pode('ver_marcacoes_outros');

// ── UI: status ───────────────────────────────────────────────────────────
function status(texto, cor) {
  const el = document.getElementById('marcacoes-status');
  if (!el) return;
  el.textContent = `Marcações: ${texto}`;
  el.style.color = cor || '#7a9ab8';
}

function statusContagem() {
  const n = marcadores.size;
  const ocultas = linhas.size - marcadores.size;
  const base = `${n} marcação${n === 1 ? '' : 'ões'} visível${n === 1 ? '' : 'eis'}`;
  if (ocultas > 0) {
    status(`${base} (${ocultas} oculta${ocultas === 1 ? '' : 's'} pelo instrutor)`, '#f5c842');
  } else {
    status(base, '#7af57a');
  }
}

// ── Partidos da turma ────────────────────────────────────────────────────
// A consulta em si mora em auth.js desde a Etapa 6a (o painel do instrutor
// virou o segundo consumidor). Aqui só se usa: mesmo motivo de
// buscarPerfisDaTurma em colegas.js, a turma de exercício é pequena, então um
// round-trip só no início é mais simples do que buscar sob demanda.

// Serve tanto para o AUTOR quanto para quem EDITOU por último (Etapa 9b): o
// cache é por id de usuário, não por papel na marcação.
async function obterPerfilDe(usuarioId) {
  if (!usuarioId) return null;
  if (perfisAutorCache.has(usuarioId)) return perfisAutorCache.get(usuarioId);
  const perfil = await buscarPerfilBasico(usuarioId); // pode devolver null (RLS, conta removida) — cacheia mesmo assim
  perfisAutorCache.set(usuarioId, perfil);
  return perfil;
}

// ── Ícone + popup de cada marcação ───────────────────────────────────────
// Tamanho intermediário entre o próprio avatar (30, gps.js) e o do colega
// (28, colegas.js) — não indica hierarquia nenhuma, só uma escolha visual
// para diferenciar "elemento marcado" de "gente com GPS ligado".
const TAMANHO_ICONE = 26;
const COR_FALLBACK = '#e05252';

function escapar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function construirPopupHtml(row, autorPerfil, editorPerfil) {
  const partido = row.partido_id ? partidosPorId.get(row.partido_id) : null;
  const nomePartido = partido ? partido.nome : 'Não identificado';
  const autorNome = autorPerfil ? (autorPerfil.nome_guerra || 'Sem nome de guerra') : '…';
  const quando = row.criada_em
    ? new Date(row.criada_em).toLocaleTimeString('pt-BR')
    : '—';

  // O QUE o elemento é, em português oficial, derivado do SIDC — natureza,
  // escalão e modificadores. Vem do símbolo gravado, não do `titulo`: desde a
  // correção de 2026-08-02 o `titulo` guarda a DESIGNAÇÃO da unidade (o
  // número dela), que é outra coisa.
  const detalhe = descreverSidc(row.sidc);
  // O cabeçalho do popup é a designação quando ela existe ("1º/5º RCC"); sem
  // ela, é o nome do tipo. Nunca fica vazio.
  const designacao = designacaoDoMapa(row.titulo, row.sidc, { maximo: 40 });
  const tituloPopup = designacao || detalhe || 'Elemento';
  const linhaDetalhe = (detalhe && detalhe !== tituloPopup)
    ? `<div class="popup-row"><span class="popup-label">Símbolo</span><span class="popup-value">${escapar(detalhe)}</span></div>`
    : '';

  // Etapa 9b: a coordenada, no formato que ESTE usuário escolheu. Vem de
  // preferencias.js (que combina a preferência com coordenadas.js) — nunca
  // formatada aqui, para as três telas não divergirem.
  const linhaCoordenada =
    `<div class="popup-row"><span class="popup-label">Coordenada</span>` +
    `<span class="popup-value">${escapar(formatarCoordenada(row.latitude, row.longitude))}</span></div>`;

  // Vetor de observação: distância e azimute DAQUI (de quem está olhando a
  // tela) até o elemento marcado — o dado que o observador avançado precisa
  // para pedir fogo. Some sozinho quando não há posição própria (instrutor,
  // GPS ainda sem fixo, ou `ver_propria_posicao` desligada pelo instrutor),
  // porque `visada()` devolve null e `formatarVisada(null)` devolve ''.
  //
  // Calculado na ABERTURA do popup, não a cada leitura de GPS: quem consulta
  // o vetor está parado olhando a tela naquele instante, e recalcular a cada
  // 5 s todos os popups fechados seria trabalho jogado fora.
  // **A linha NÃO some mais em silêncio quando não há posição própria**
  // (2026-09-14). Ela sumia, e o relato de campo foi exatamente este: *"não há
  // mais informações sobre o lançamento"* — com o código intacto e publicado.
  // Some é indistinguível de "a função foi removida": quem está com o app na
  // mão não tem como saber se o GPS ainda não fixou, se o instrutor ocultou a
  // posição dele, ou se alguém quebrou alguma coisa. Custou uma sessão inteira
  // de investigação para responder "está aguardando o GPS".
  //
  // É a mesma regra que vale no resto do projeto desde a Etapa 6b: uma lacuna
  // declarada é informação, uma lacuna silenciosa é uma afirmação errada. Só
  // que aqui a afirmação errada era sobre o próprio app.
  const posto = obterPostoObservacao ? obterPostoObservacao(row) : null;
  const v = (posto && Number.isFinite(posto.lat) && Number.isFinite(posto.lon))
    ? visada({ lat: posto.lat, lon: posto.lon }, { lat: row.latitude, lon: row.longitude })
    : null;
  let linhaVisada = '';
  if (v) {
    linhaVisada = `<div class="popup-row"><span class="popup-label">${escapar(posto.rotulo || 'Do meu posto')}</span>` +
      `<span class="popup-value">${escapar(formatarVisada(v))}</span></div>`;
  } else if (posto && posto.motivo) {
    linhaVisada = `<div class="popup-row mc-visada-ausente">` +
      `<span class="popup-label">${escapar(posto.rotulo || 'Do meu posto')}</span>` +
      `<span class="popup-value">— ${escapar(posto.motivo)}</span></div>`;
  }
  // Sem hook nenhum (`null`), a linha continua ausente e sem explicação: ali ela
  // não faltou, ela não se aplica.

  // Dados de tiro (migration 0011). Ficam JUNTO do vetor, não espalhados, porque
  // é assim que são lidos: distância, lançamento, cota e dimensão formam uma
  // descrição só. Cada pedaço só aparece se existir — um alvo sem dimensão
  // conhecida não ganha "— m", ganha nada.
  //
  // **A cota nunca aparece sem a origem.** `altitude_fonte` é gravada junto
  // pelo `check` da 0011, e o rótulo a mostra: "820 m (lida na carta)". Quando
  // um dia houver consulta a modelo de elevação, a mesma linha dirá isso, e
  // quem lê continua sabendo qual das duas está vendo — que é a diferença que
  // importa no tiro.
  const FONTE_ALTITUDE = { manual: 'lida na carta', mde: 'modelo de elevação' };
  const linhaAltitude = (row.altitude_m !== null && row.altitude_m !== undefined)
    ? `<div class="popup-row"><span class="popup-label">Altitude</span>` +
      `<span class="popup-value">${escapar(row.altitude_m)} m` +
      `<span class="mc-fonte"> (${escapar(FONTE_ALTITUDE[row.altitude_fonte] || row.altitude_fonte || 'origem não registrada')})</span>` +
      `</span></div>`
    : '';

  const dimensoes = [];
  if (row.frente_m) dimensoes.push(`${row.frente_m} m de frente`);
  if (row.profundidade_m) dimensoes.push(`${row.profundidade_m} m de profundidade`);
  const linhaDimensao = dimensoes.length
    ? `<div class="popup-row"><span class="popup-label">Dimensão</span>` +
      `<span class="popup-value">${escapar(dimensoes.join(' × '))}</span></div>`
    : '';

  // Etapa 9b: a linha que existe para o aluno não ver o próprio símbolo mudar
  // sozinho. `editada_por` é carimbado por trigger no banco (migration 0009)
  // e só difere de `autor_id` quando outra pessoa — na prática, o instrutor —
  // corrigiu a marcação. Ver a decisão do item 4 da etapa.
  let linhaEdicao = '';
  if (row.editada_em && row.editada_por && row.editada_por !== row.autor_id) {
    const editorNome = editorPerfil ? (editorPerfil.nome_guerra || 'Sem nome de guerra') : '…';
    const quandoEdicao = new Date(row.editada_em).toLocaleTimeString('pt-BR');
    linhaEdicao =
      `<div class="popup-row mc-corrigida"><span class="popup-label">Corrigido por</span>` +
      `<span class="popup-value">${escapar(editorNome)} às ${quandoEdicao}</span></div>`;
  }

  // A marcação que saiu como losango vazio explica a si mesma (2026-09-14).
  //
  // **O texto desta linha foi REESCRITO depois de achar a causa de verdade**, e
  // a primeira versão dele é um bom exemplo de aviso que orienta errado. Ela
  // dizia "edite e preencha a sigla", porque na época eu achava que a pessoa
  // tinha escolhido "Comando Nomeado" de propósito. Não tinha: a esmagadora
  // maioria destas marcações veio do defeito de gravação da paleta (ver
  // `sidcDaMarcacao()` em simbolos.js), onde este símbolo é o DEFAULT que sobra
  // quando nenhum campo chega — ou seja, o símbolo não é o que ninguém
  // escolheu, e mandar preencher a sigla consertaria o desenho mantendo o
  // elemento errado.
  //
  // O texto agora diz as duas coisas, na ordem provável: quase certamente o
  // símbolo está errado e deve ser trocado; se for mesmo um comando nomeado,
  // aí sim falta a sigla. O botão Editar está logo abaixo e resolve os dois.
  //
  // A linha aparece SÓ quando as duas condições valem (símbolo exige sigla E a
  // designação está vazia) — com a sigla preenchida o símbolo desenha certo e
  // não há nada a dizer.
  const linhaSemDesenho = (sidcExigeDesignacao(row.sidc) && !designacao)
    ? `<div class="popup-row mc-sem-desenho"><span class="popup-label">Sem desenho</span>` +
      `<span class="popup-value">Este elemento está gravado como <b>Comando Nomeado</b>, ` +
      `que é desenhado com a SIGLA da unidade no centro — sem sigla, sai vazio. ` +
      `Marcações feitas pela paleta antes da correção de 14/09 caíram nele por engano: ` +
      `se não era isto que você marcou, <b>edite e escolha o símbolo certo</b>. ` +
      `Se era, preencha "Designação da unidade".</span></div>`
    : '';

  // Etapa 6a: o autor só vê Editar/Remover se `editar_marcacao_propria`
  // estiver habilitada. O instrutor não depende dessa chave (a própria view
  // já devolve tudo habilitado para ele, mas a policy
  // `elementos_editar_instrutor` é o que realmente vale).
  //
  // Etapa 9b: esta linha É a autoridade do instrutor sobre a simbologia da
  // turma, e ela NÃO mudou nesta etapa — só o formulário que ela abre. Um
  // instrutor abrindo a aba "Situação atual" (situacao.js) continua vendo
  // Editar em QUALQUER marcação de QUALQUER aluno, e o `abrirFormulario(...,
  // { marcacaoExistente })` logo abaixo é o mesmo caminho de código de
  // sempre, agora com o catálogo oficial por trás.
  const podeMexer = meuPapel === 'instrutor' || (row.autor_id === meuUserId && podeEditarPropria());
  const botoes = podeMexer
    ? `<div class="mc-botoes">
         <button id="mc-editar-${row.id}" type="button" class="mc-btn">Editar</button>
         <button id="mc-remover-${row.id}" type="button" class="mc-btn mc-btn-remover">Remover</button>
       </div>`
    : '';
  return (
    `<div class="popup-content">` +
      `<div class="popup-title">${escapar(tituloPopup)}</div>` +
      linhaDetalhe +
      `<div class="popup-row"><span class="popup-label">Partido</span><span class="popup-value">${escapar(nomePartido)}</span></div>` +
      linhaCoordenada +
      linhaVisada +
      linhaAltitude +
      linhaDimensao +
      `<div class="popup-row"><span class="popup-label">Marcado por</span><span class="popup-value">${escapar(autorNome)} às ${quando}</span></div>` +
      linhaEdicao +
      linhaSemDesenho +
      botoes +
    `</div>`
  );
}

// O conteúdo do popup é montado SÓ quando ele abre (evento 'popupopen'), em
// vez de fixado no bindPopup() lá na criação do marcador — assim ele sempre
// reflete o estado MAIS RECENTE da marcação (ex.: depois de uma edição), e só
// busca o perfil do autor quando alguém de fato clica para ver.
async function aoAbrirPopup(id, marker) {
  const estado = marcadores.get(id);
  if (!estado) return;
  // Os dois perfis (autor e, se houver, quem corrigiu) numa rodada só.
  const [autor, editor] = await Promise.all([
    obterPerfilDe(estado.row.autor_id),
    obterPerfilDe(estado.row.editada_por),
  ]);
  // A marcação pode ter mudado (ou sumido) enquanto a busca do autor corria.
  const estadoAtual = marcadores.get(id);
  if (!estadoAtual) return;
  marker.getPopup()?.setContent(construirPopupHtml(estadoAtual.row, autor, editor));

  // Os botões só existem no DOM depois que o Leaflet renderiza o conteúdo do
  // popup — setTimeout(0) empurra a ligação dos eventos para depois disso.
  setTimeout(() => {
    const btnEditar = document.getElementById(`mc-editar-${id}`);
    const btnRemover = document.getElementById(`mc-remover-${id}`);
    if (btnEditar) {
      btnEditar.addEventListener('click', () => {
        const atual = marcadores.get(id);
        marker.closePopup();
        if (atual) abrirFormulario(marker.getLatLng(), { marcacaoExistente: atual.row });
      });
    }
    if (btnRemover) {
      btnRemover.addEventListener('click', () => removerMarcacao(id));
    }
  }, 0);
}

// Cria o marcador na primeira vez que uma linha aparece (select inicial ou
// INSERT do Realtime); nas vezes seguintes (UPDATE — ex.: edição), só troca o
// ícone e, se o popup estiver aberto, atualiza o conteúdo dele. Mesmo padrão
// de upsertAvatar() em colegas.js.
function criarOuAtualizarMarcador(row, { map }) {
  const partidoElemento = row.partido_id ? partidosPorId.get(row.partido_id) : null;
  const icon = criarIconeSimbolo(row.sidc, {
    partidoObservador: meuPartido,
    partidoElemento,
    tamanho: TAMANHO_ICONE,
    // A DESIGNAÇÃO da unidade (o número/nome dela), nunca o tipo — o tipo já
    // está no desenho do símbolo. Ver designacaoDoMapa() em simbolos.js: ela
    // devolve '' quando o `titulo` gravado é, na verdade, o nome do tipo, que
    // é como ficaram as marcações criadas entre a Etapa 9b e a correção de
    // 2026-08-02. Sem isso, o nome oficial inteiro era escrito ao lado do
    // símbolo e atravessava a tela.
    designacao: designacaoDoMapa(row.titulo, row.sidc),
    corFallback: COR_FALLBACK,
    tamanhoFallback: 20,
  });

  let estado = marcadores.get(row.id);
  if (!estado) {
    const marker = L.marker([row.latitude, row.longitude], {
      icon,
      zIndexOffset: 750, // entre o próprio avatar (1000, gps.js) e os colegas (500, colegas.js)
    }).addTo(map);
    marker.bindPopup('', { maxWidth: 260 });
    marker.on('popupopen', () => aoAbrirPopup(row.id, marker));
    estado = { marker };
    marcadores.set(row.id, estado);
  } else {
    estado.marker.setIcon(icon);
    if (estado.marker.isPopupOpen()) {
      estado.marker.getPopup().setContent(construirPopupHtml(
        row, perfisAutorCache.get(row.autor_id), perfisAutorCache.get(row.editada_por)
      ));
    }
  }
  estado.row = row;
  statusContagem();
}

function removerMarcadorDoMapa(id) {
  const estado = marcadores.get(id);
  if (!estado) return;
  mapaRef.removeLayer(estado.marker);
  marcadores.delete(id);
  statusContagem();
}

// ── Visibilidade por permissão (Etapa 6a) ────────────────────────────────
// A marcação que EU fiz é sempre minha para ver — `ver_marcacoes_outros`,
// como o nome diz, só decide sobre as dos outros. O instrutor não depende da
// chave (a view devolve tudo habilitado para ele pelo papel).
function deveMostrar(row) {
  if (row.autor_id === meuUserId) return true;
  if (meuPapel === 'instrutor') return true;
  return podeVerDeOutros();
}

// Único caminho de entrada de uma linha vinda do banco (select inicial,
// Realtime ou resposta de um insert/update): guarda a linha e decide se ela
// aparece no mapa agora.
function registrarLinha(row, ctx) {
  linhas.set(row.id, row);
  if (deveMostrar(row)) criarOuAtualizarMarcador(row, ctx);
  else removerMarcadorDoMapa(row.id);
  statusContagem();
}

// A marcação deixou de existir (exclusão lógica ou DELETE de verdade): sai do
// mapa E da memória — diferente de "está oculta por permissão", que só sai do
// mapa.
function esquecerLinha(id) {
  linhas.delete(id);
  removerMarcadorDoMapa(id);
  statusContagem();
}

// Chamado quando `ver_marcacoes_outros` muda: reavalia tudo que já está na
// memória, sem ir ao banco de novo.
function reavaliarVisibilidade(ctx) {
  for (const row of linhas.values()) {
    if (deveMostrar(row)) criarOuAtualizarMarcador(row, ctx);
    else removerMarcadorDoMapa(row.id);
  }
  statusContagem();
}

// ── 1. Estado inicial (select comum, não Realtime) ──────────────────────
// Mesmo motivo de carregarEstadoInicial() em colegas.js: o Realtime não faz
// backfill do que já existia, só avisa de mudanças a partir da assinatura.
// A RLS (`elementos_ler`, 0003) já filtra para autor_id in
// fn_usuarios_visiveis() OU instrutor da turma — este select não precisa (e
// não deve) tentar repetir essa regra no cliente.
async function carregarEstadoInicial(turmaId, ctx) {
  const { data, error } = await supabase
    .from('elementos_marcados')
    .select('*')
    .eq('turma_id', turmaId)
    .is('removida_em', null);

  if (error) {
    console.error('Falha ao carregar marcações iniciais:', error);
    status('erro ao carregar marcações', '#e05252');
    return;
  }

  (data || []).forEach((row) => registrarLinha(row, ctx));
  if (marcadores.size === 0 && linhas.size === 0) status('nenhuma marcação visível ainda', '#7a9ab8');
}

// ── 2. Canal Realtime ─────────────────────────────────────────────────────
// Mesmo padrão de assinarCanal() em colegas.js: filtra no SERVIDOR por
// turma_id (sintaxe do PostgREST) e confia na RLS para restringir ainda mais
// a quem o chamador de fato enxerga — a RLS de elementos_marcados é mais
// estrita que turma_id (usa fn_usuarios_visiveis() pelo AUTOR), então este
// filtro é só uma otimização de rede, não a barreira de segurança.
// Exclusão é LÓGICA (removida_em): por isso um "apagar" chega como um evento
// UPDATE com removida_em preenchido, não como DELETE — tratado abaixo do
// mesmo jeito (tira do mapa). O ramo DELETE fica por robustez (cobre o caso
// de alguém excluir de verdade pelo SQL Editor/service_role).
function assinarCanal(turmaId, ctx) {
  canalAtual = supabase
    .channel(`marcacoes-turma-${turmaId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'elementos_marcados',
        filter: `turma_id=eq.${turmaId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = payload.old?.id;
          if (id) esquecerLinha(id);
          return;
        }
        const row = payload.new;
        if (!row) return;
        if (row.removida_em) {
          esquecerLinha(row.id);
        } else {
          registrarLinha(row, ctx);
        }
      }
    )
    .subscribe((estadoCanal) => {
      if (estadoCanal === 'SUBSCRIBED') {
        statusContagem();
      } else if (estadoCanal === 'CHANNEL_ERROR' || estadoCanal === 'TIMED_OUT') {
        status('conexão em tempo real falhou — recarregue a página', '#e05252');
      }
    });
}

// ── Formulário de marcação (criar/editar) ────────────────────────────────
// Painel fixo na tela (não posicionado no ponto do clique): mais simples e
// robusto do que converter latlng em pixel para ancorar um popup, e cumpre a
// mesma promessa ("formulário simples") sem depender de espaço livre ao redor
// do clique. Injeta o próprio CSS uma vez, em vez de mexer no <style> de
// index.html — o módulo fica autocontido.
let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados) return;
  estilosInjetados = true;
  const style = document.createElement('style');
  style.textContent = `
    #marcacao-painel {
      position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
      z-index:2000; background:#0d1b2a; border:1px solid #2a4a6b;
      border-radius:8px; padding:16px 20px; min-width:280px; max-width:min(92vw,380px);
      max-height:88vh; overflow-y:auto;
      box-shadow:0 4px 24px rgba(0,0,0,.5); font-family:'Segoe UI',Arial,sans-serif;
      color:#e8eaf0;
    }
    #marcacao-painel h3 {
      font-size:13px; letter-spacing:.05em; text-transform:uppercase;
      color:#a8c8e8; margin-bottom:12px;
    }
    #marcacao-painel label {
      display:block; font-size:12px; color:#7a9ab8; margin-bottom:10px;
    }
    #marcacao-painel select, #marcacao-painel input[type=text] {
      display:block; width:100%; margin-top:4px; padding:5px 6px;
      background:#16263a; color:#e8eaf0; border:1px solid #2a4a6b; border-radius:4px;
      font-family:inherit; font-size:13px; box-sizing:border-box;
    }
    #marcacao-painel input[type=text]::placeholder { color:#3f5f7f; }
    #marcacao-painel .mc-acoes {
      display:flex; justify-content:flex-end; gap:8px; margin-top:14px;
    }
    #marcacao-painel button {
      padding:5px 14px; border-radius:4px; font-size:12px; cursor:pointer; border:1px solid #2a5a8c;
    }
    #marcacao-painel .mc-salvar { background:#1a3a5c; color:#7ab8f5; }
    #marcacao-painel .mc-cancelar { background:transparent; color:#c8d8e8; border-color:#3a5a7a; }
    #marcacao-painel optgroup { background:#0d1b2a; color:#7a9ab8; font-style:normal; }
    #marcacao-painel option { background:#16263a; color:#e8eaf0; }
    #marcacao-painel .mc-dica {
      font-size:11px; color:#5f7f9f; margin:-6px 0 10px; line-height:1.35;
    }
    #marcacao-painel .mc-aviso {
      color:#f5c842; background:#2a2412; border:1px solid #5a4a1a;
      border-radius:4px; padding:6px 8px; margin:0 0 10px;
    }
    /* Paleta de ícones rápidos: a escolha de partido do modo "perguntar".
       Botões grandes de propósito — é a única coisa que separa o toque no
       mapa da marcação gravada, e quem está usando isto está em campo, com
       luva, no sol. */
    #marcacao-painel .mc-partidos {
      display:flex; flex-direction:column; gap:8px; margin:4px 0 2px;
    }
    #marcacao-painel .mc-partido-btn {
      padding:11px 14px; font-size:14px; text-align:left;
      background:#16263a; color:#e8eaf0; border:1px solid #2a4a6b;
    }
    #marcacao-painel .mc-partido-btn:disabled { opacity:.5; cursor:default; }
    #marcacao-painel .mc-coord {
      font-size:11px; color:#7a9ab8; margin-bottom:12px; padding:5px 7px;
      background:#16263a; border:1px solid #23405e; border-radius:4px;
      font-variant-numeric:tabular-nums;
    }
    .mc-botoes { display:flex; gap:6px; margin-top:8px; }
    .mc-btn { padding:3px 10px; border-radius:4px; font-size:11px; cursor:pointer; border:1px solid #999; background:#f0f0f0; }
    .mc-btn-remover { border-color:#c0392b; color:#c0392b; }
    .mc-corrigida .popup-value { color:#f5c842; }
    /* Vetor ainda indisponível: cinza, não âmbar. Não é problema nem aviso —
       é um dado que ainda vai chegar (ou que o instrutor escolheu não dar). */
    .mc-visada-ausente .popup-value { color:#8a8a8a; font-style:italic; }
    /* A origem da cota, menor e mais apagada que o número — presente sempre,
       sem competir com o valor. */
    .mc-fonte { color:#888; font-size:11px; }
    /* Os três campos de tiro, atrás de um <details> fechado. */
    .mc-alvo { margin:10px 0 4px; }
    .mc-alvo > summary {
      cursor:pointer; font-size:12px; color:#7a9ab8; padding:4px 0;
      list-style:none; user-select:none;
    }
    .mc-alvo > summary::before { content:'▸ '; }
    .mc-alvo[open] > summary::before { content:'▾ '; }
    .mc-alvo-par { display:flex; gap:8px; }
    .mc-alvo-par label { flex:1; min-width:0; }
    /* Mesma cor do aviso de sigla no formulário: é o mesmo assunto, visto do
       outro lado (lá antes de gravar, aqui depois). Âmbar e não vermelho —
       a marcação está lá e vale, só não consegue se desenhar. */
    .mc-sem-desenho .popup-value { color:#f5c842; line-height:1.45; }
    .mc-sem-desenho .popup-label { color:#b08900; }
  `;
  document.head.appendChild(style);
}

// ── Montagem dos <select> a partir do catálogo (Etapa 9b) ────────────────
// A estrutura escolhida (item 1 da etapa) é a HIERÁRQUICA, fiel a como o
// próprio portal do MD/EB organiza os 12 arquivos:
//
//     categoria  ->  ícone central (agrupado por entidade APP-6D)
//                ->  modificador 1  ->  modificador 2
//
// A alternativa era manter a forma antiga (um <select> plano por campo,
// só trocando os VALORES pelos oficiais). Foi descartada por um motivo
// prático e um conceitual:
//
//   * PRÁTICO: um <select> plano com 434 opções, num celular, em campo, com
//     luva. As 18 naturezas escritas à mão da Etapa 5 cabiam numa lista; o
//     catálogo oficial não cabe. Filtrar por categoria primeiro corta a lista
//     para 1 a 96 itens, e o <optgroup> por entidade dá o segundo nível de
//     leitura sem exigir um terceiro clique.
//   * CONCEITUAL: a "dimensão" do formulário antigo E a categoria do catálogo
//     são a MESMA COISA — os dígitos 5-6 do SIDC (symbol set). Manter os dois
//     campos separados seria pedir duas vezes o mesmo dado e deixar o usuário
//     combiná-los de forma inválida (uma "Fragata" com dimensão "UNIDADE"
//     produz um SIDC que a milsymbol desenha errado, e o formulário antigo
//     permitia exatamente isso). Com a hierarquia, escolher a categoria já
//     fixa o symbol set, e só aparecem itens que existem nele — a combinação
//     inválida deixa de ser possível de digitar.
//
// O que NÃO virou hierarquia: escalão e partido. Escalão é amplificador
// (dígitos 9-10), vale para qualquer categoria e tem 13 opções — continua um
// <select> plano. Partido nunca foi simbologia: é o fato do banco que a
// hostilidade relativa consome (Etapa 4.5).
// Etapa 5/9b: as quatro construtoras de <option> do catálogo saíram deste
// arquivo para frontend/catalogo-form.js em 2026-09-14, ao ganharem o segundo
// consumidor (o painel de ícones rápidos do instrutor monta o SIDC de um
// preset pelos mesmos seletores). Ver o cabeçalho de lá. Os nomes locais
// abaixo são aliases finos, só para não reescrever as chamadas no corpo do
// formulário.
const construirOpcoesCategoria   = opcoesCategoria;
const construirOpcoesItem        = opcoesItem;
const construirOpcoesModificador = opcoesModificador;
const construirOpcoesEscalao     = opcoesEscalao;

function construirOpcoesPartido(partidoIdSelecionado) {
  const naoIdentificado = `<option value=""${!partidoIdSelecionado ? ' selected' : ''}>Não identificado</option>`;
  const outros = partidosDaTurma
    .map((p) => `<option value="${p.id}"${p.id === partidoIdSelecionado ? ' selected' : ''}>${p.nome}</option>`)
    .join('');
  return naoIdentificado + outros;
}

function fecharFormulario() {
  if (painelAberto) {
    // Tira o contêiner da lista que o Realtime redesenha — senão cada
    // formulário fechado deixaria um nó órfão sendo redesenhado para sempre.
    const caixaPaleta = painelAberto.querySelector('#mc-paleta');
    if (caixaPaleta) desmontarPaleta(caixaPaleta);
    // Avisa o observador de formato de coordenada registrado em
    // abrirFormulario() para se desligar — sem isto, cada abertura de
    // formulário deixaria um callback vivo apontando para um DOM removido.
    painelAberto.dispatchEvent(new Event('mc-fechou'));
    painelAberto.remove();
    painelAberto = null;
  }
  if (marcadorTemporario) {
    mapaRef.removeLayer(marcadorTemporario);
    marcadorTemporario = null;
  }
}

// latlng: L.LatLng do ponto clicado (criação) ou da marcação existente (edição).
// marcacaoExistente: a `row` de elementos_marcados sendo editada, ou undefined
// para criar uma nova.
// sidcInicial / partidoInicial (2026-09-14): pré-preenchimento vindo de um
// preset da paleta de ícones rápidos, quando o aluno usou o TOQUE LONGO —
// "quero este símbolo, mas preciso ajustar escalão/designação". É diferente de
// `marcacaoExistente`, que além de pré-preencher coloca o formulário em modo
// EDIÇÃO (update em vez de insert). Aqui é criação normal, só começando de um
// ponto de partida em vez de da primeira categoria da lista.
function abrirFormulario(latlng, { marcacaoExistente, sidcInicial, partidoInicial } = {}) {
  fecharFormulario(); // no máximo um formulário aberto por vez
  injetarEstilos();

  // Marcador "fantasma" só na criação — na edição já existe um marcador de
  // verdade naquele ponto, não precisa de um segundo.
  if (!marcacaoExistente) {
    marcadorTemporario = L.circleMarker(latlng, {
      radius: 9, color: '#f5c842', weight: 2, dashArray: '4,3', fillOpacity: 0.15,
    }).addTo(mapaRef);
  }

  // Pré-preenchimento na EDIÇÃO. `decomporSidc()` (simbolos.js) devolve, além
  // dos três campos que já devolvia desde a Etapa 5, a categoria, o código de
  // entidade e os dois modificadores — que é exatamente o que o formulário
  // hierárquico precisa para reabrir na escolha que estava gravada.
  //
  // Isto é o que faz a EDIÇÃO PELO INSTRUTOR funcionar: ele abre a marcação
  // de um aluno já com o que o aluno escolheu selecionado, troca só o que
  // está errado e salva. Um pré-preenchimento que perdesse a escolha original
  // transformaria "corrigir a natureza" em "refazer a marcação do zero".
  const sidcParaPreencher = marcacaoExistente?.sidc || sidcInicial || '';
  const preenchido = sidcParaPreencher ? decomporSidc(sidcParaPreencher) : {};
  // SIDC gravado por um caminho que o catálogo não conhece (dado anterior à
  // 9b com natureza que saiu das tabelas manuais, ou symbol set exótico):
  // abre na primeira categoria em vez de num <select> vazio.
  const categoriaInicial = categoriaPorId(preenchido.categoriaId)
    ? preenchido.categoriaId
    : CATEGORIAS[0].id;

  // AVISO PARA DADO ANTERIOR À 9b, e é importante que ele exista.
  // As tabelas manuais da Etapa 5 tinham códigos que o catálogo oficial não
  // usa (ex.: '121200', que era "Blindado (Carro de Combate)" na tabela
  // escrita à mão e não existe nas unidades do MD/EB). Quando um desses é
  // reaberto para edição, o <select> cai no primeiro item da categoria — e
  // salvar sem perceber TROCARIA o tipo da marcação em silêncio. Com o aviso,
  // quem edita vê que precisa reescolher, em vez de descobrir depois.
  //
  // Note que o SÍMBOLO DESENHADO nunca dependeu do rótulo: a milsymbol sempre
  // desenhou a partir do código. O que muda ao reabrir é só o rótulo, que
  // agora é o oficial.
  const codigoNaoReconhecido = !!marcacaoExistente &&
    !nomeDoItem(categoriaInicial, preenchido.codigoEntidade);
  const avisoLegado = codigoNaoReconhecido
    ? `<p class="mc-dica mc-aviso">Esta marcação foi criada antes do catálogo oficial e o tipo
       dela (código ${escapar(preenchido.codigoEntidade || '?')}) não existe nele.
       <b>Escolha o tipo de novo antes de salvar</b> — salvar assim grava o primeiro da lista.</p>`
    : '';

  // A designação já gravada, se houver. Passa pelo mesmo filtro do mapa, para
  // uma marcação criada entre a Etapa 9b e a correção de 2026-08-02 (cujo
  // `titulo` é o nome do TIPO) abrir com o campo vazio, em vez de reofertar o
  // texto errado para ser regravado.
  const designacaoInicial = marcacaoExistente
    ? designacaoDoMapa(marcacaoExistente.titulo, marcacaoExistente.sidc, { maximo: 12 })
    : '';

  const painel = document.createElement('div');
  painel.id = 'marcacao-painel';
  painel.innerHTML = `
    <h3>${marcacaoExistente ? 'Editar marcação' : 'Nova marcação'}</h3>
    <div class="mc-coord" id="mc-coordenada">${escapar(formatarCoordenada(latlng.lat, latlng.lng))}</div>
    <!-- Paleta de marcação rápida. Fica AQUI, no topo do formulário, porque o
         toque no mapa já disse ONDE e o que falta é o QUÊ — ver o cabeçalho de
         paleta-tela.js. Só na CRIAÇÃO: numa edição o elemento já tem símbolo, e
         oferecer atalhos que o sobrescrevem em silêncio seria o oposto do que a
         edição serve (corrigir um campo sem refazer o resto). -->
    <div class="pal-fileira" id="mc-paleta"></div>
    <label>Categoria
      <select id="mc-categoria">${construirOpcoesCategoria(categoriaInicial)}</select>
    </label>
    <label>Tipo / natureza
      <select id="mc-item">${construirOpcoesItem(categoriaInicial, preenchido.codigoEntidade)}</select>
    </label>
    <p class="mc-dica">Nomes oficiais do Portal de Simbologia Militar (MD33-M-02).</p>
    <!-- Relatado em campo: marcação saindo como losango liso. Não é defeito —
         há símbolos cujo conteúdo É a sigla (ver ENTIDADES_SEM_DESENHO em
         simbolos.js). Sem designação eles saem sem nada dentro, e é melhor
         dizer isso ANTES de salvar do que deixar descobrir no mapa. -->
    <p class="mc-dica mc-aviso" id="mc-aviso-sigla" hidden></p>
    ${avisoLegado}
    <label>Escalão
      <select id="mc-escalao">${construirOpcoesEscalao(preenchido.escalao || 'NONE')}</select>
    </label>
    <div id="mc-modificadores"></div>
    <!-- Correção de 2026-08-02: é ISTO que vai escrito ao lado do símbolo no
         mapa — a designação da unidade, não o tipo dela (o tipo já está no
         desenho). Opcional: em branco, o símbolo sai limpo. O maxlength é o
         que impede a linha de voltar a atravessar a tela. -->
    <label>Designação da unidade <span style="color:#4a6a8a">(opcional)</span>
      <input id="mc-designacao" type="text" maxlength="12" autocomplete="off"
             placeholder="ex.: 1º/5º RCC" value="${escapar(designacaoInicial)}">
    </label>
    <label>Partido do elemento observado
      <select id="mc-partido">${construirOpcoesPartido(marcacaoExistente?.partido_id ?? partidoInicial ?? null)}</select>
    </label>
    <!-- Migration 0011, a pedido da artilharia: os dois campos que faltavam
         para o popup deixar de ser "onde está" e virar uma descrição de alvo
         utilizável num pedido de fogo. Os três são OPCIONAIS e ficam atrás de
         um <details> fechado — um contato de 20 segundos não pode ganhar três
         campos obrigatórios no caminho, e a paleta (0010) grava em dois toques
         justamente sem passar por aqui. Quem tem tempo e carta na mão abre.

         Em branco é o estado honesto: o banco recusa frente/profundidade zero
         (ver 0011) exatamente para ninguém gravar um número que outra pessoa
         leria como medida. -->
    <details class="mc-alvo">
      <summary>Dados de tiro <span style="color:#4a6a8a">(opcional)</span></summary>
      <label>Altitude do alvo (m)
        <input id="mc-altitude" type="number" step="1" min="-500" max="9000"
               inputmode="numeric" autocomplete="off" placeholder="lida na carta"
               value="${escapar(marcacaoExistente?.altitude_m ?? '')}">
      </label>
      <p class="mc-dica">Só o que você LEU na carta. O app não estima cota — uma
        altitude derivada apresentada como medida é erro caro no tiro.</p>
      <div class="mc-alvo-par">
        <label>Frente (m)
          <input id="mc-frente" type="number" step="1" min="1" max="20000"
                 inputmode="numeric" autocomplete="off"
                 value="${escapar(marcacaoExistente?.frente_m ?? '')}">
        </label>
        <label>Profundidade (m)
          <input id="mc-profundidade" type="number" step="1" min="1" max="20000"
                 inputmode="numeric" autocomplete="off"
                 value="${escapar(marcacaoExistente?.profundidade_m ?? '')}">
        </label>
      </div>
    </details>
    <div class="mc-acoes">
      <button type="button" class="mc-cancelar" id="mc-cancelar">Cancelar</button>
      <button type="button" class="mc-salvar" id="mc-salvar">Salvar</button>
    </div>
  `;
  document.body.appendChild(painel);
  painelAberto = painel;

  const selCategoria = document.getElementById('mc-categoria');
  const selItem = document.getElementById('mc-item');
  const caixaModificadores = document.getElementById('mc-modificadores');
  const selEscalao = document.getElementById('mc-escalao');
  const selPartido = document.getElementById('mc-partido');

  // Os dois <select> de modificador dependem da categoria e são REMONTADOS a
  // cada troca dela — cada categoria tem a própria tabela "sector 1"/"sector
  // 2", e algumas (guerra de minas) não têm nenhuma. Categoria sem
  // modificador simplesmente não mostra o campo, em vez de mostrar um
  // <select> com uma opção só.
  function montarModificadores(categoriaId, mod1Selecionado, mod2Selecionado) {
    const cat = categoriaPorId(categoriaId);
    if (!cat) { caixaModificadores.innerHTML = ''; return; }
    const blocos = [];
    if (cat.mod1.length) {
      blocos.push(
        `<label>Modificador 1
           <select id="mc-mod1">${construirOpcoesModificador(cat.mod1, mod1Selecionado)}</select>
         </label>`
      );
    }
    if (cat.mod2.length) {
      blocos.push(
        `<label>Modificador 2
           <select id="mc-mod2">${construirOpcoesModificador(cat.mod2, mod2Selecionado)}</select>
         </label>`
      );
    }
    caixaModificadores.innerHTML = blocos.join('');
  }

  montarModificadores(categoriaInicial, preenchido.mod1, preenchido.mod2);

  // ── Aviso "este símbolo é a sigla" ──────────────────────────────────────
  // Só aparece na combinação que de fato produz um símbolo vazio: entidade
  // sem desenho próprio E designação em branco. Preencher a designação faz o
  // aviso sumir na hora — ele ensina a regra em vez de só reclamar.
  const avisoSigla = document.getElementById('mc-aviso-sigla');
  const campoDesignacao = document.getElementById('mc-designacao');
  function avaliarAvisoSigla() {
    if (!avisoSigla) return;
    const cat = categoriaPorId(selCategoria.value);
    const precisa = cat && exigeDesignacao(cat.symbolSet, selItem.value);
    const vazia = !(campoDesignacao?.value || '').trim();
    avisoSigla.hidden = !(precisa && vazia);
    if (!avisoSigla.hidden) {
      avisoSigla.textContent =
        'Este símbolo não tem desenho próprio: ele é desenhado com a sigla da '
        + 'unidade no centro. Sem preencher "Designação da unidade", ele sai '
        + 'como um símbolo vazio no mapa.';
    }
  }
  campoDesignacao?.addEventListener('input', avaliarAvisoSigla);
  selItem.addEventListener('change', avaliarAvisoSigla);
  avaliarAvisoSigla();

  // ── Paleta de marcação rápida, dentro deste formulário ──────────────────
  // Só na criação (ver o comentário do contêiner, no HTML acima).
  //
  // Dois caminhos, decididos por modoDoPreset() (paleta.js, puro e testado):
  //   'gravar'    -> grava aqui, com a coordenada que este formulário já tem,
  //                  e fecha. Duas ações no total: tocar o mapa, tocar o botão.
  //   'perguntar' -> NÃO grava: preenche o formulário com o símbolo do preset
  //                  e leva o foco para a força. O preset já poupou os cinco
  //                  campos de simbologia; o único que falta é justamente o
  //                  que o instrutor marcou como "pergunte".
  // Toque longo sempre preenche sem gravar, mesmo em preset com força — é a
  // saída para quem quer aquele símbolo mas precisa pôr escalão ou designação.
  if (!marcacaoExistente) {
    const caixaPaleta = document.getElementById('mc-paleta');
    montarPaleta(caixaPaleta, {
      aoEscolher: async (preset, { completo }) => {
        if (!completo && modoDoPreset(preset) === 'gravar') {
          const ok = await salvarMarcacao({ latlng, valores: valoresDaMarcacao(preset) });
          if (ok) fecharFormulario();
          return;
        }
        preencherComPreset(preset);
        if (!completo) {
          // Modo "perguntar": o campo que falta é a força, então é para lá que
          // o foco vai. `scrollIntoView` porque num celular o <select> de
          // partido fica abaixo da dobra do painel.
          selPartido?.focus();
          selPartido?.scrollIntoView({ block: 'center' });
        }
      },
    });
  }

  // Reaproveita decomporSidc() — o MESMO caminho que pré-preenche uma edição.
  // Não existe um segundo jeito de "abrir um SIDC no formulário" neste
  // arquivo, o que é justamente o que impede os dois divergirem.
  function preencherComPreset(preset) {
    const d = decomporSidc(preset.sidc);
    const cat = categoriaPorId(d.categoriaId) ? d.categoriaId : CATEGORIAS[0].id;
    selCategoria.value = cat;
    selItem.innerHTML = construirOpcoesItem(cat, d.codigoEntidade);
    montarModificadores(cat, d.mod1, d.mod2);
    if (selEscalao) selEscalao.value = d.escalao || 'NONE';
    // A força do preset entra como sugestão; em preset sem força isto deixa o
    // seletor em "Não identificado", que é de onde a pessoa escolhe.
    if (selPartido) selPartido.value = preset.partido_padrao_id || '';
    avaliarAvisoSigla();
  }

  selCategoria.addEventListener('change', () => {
    // Trocar de categoria zera a escolha de item e de modificador — não há
    // como "manter" nada: os códigos de entidade e os modificadores são
    // definidos POR symbol set, e o mesmo código significa outra coisa em
    // outra categoria.
    selItem.innerHTML = construirOpcoesItem(selCategoria.value, '');
    montarModificadores(selCategoria.value, '00', '00');
    // O item mudou junto com a categoria — e a primeira entidade de "Unidades"
    // é justamente o "Comando Nomeado", o caso que gera o símbolo vazio.
    avaliarAvisoSigla();
  });

  // Trocar o formato de coordenada com o formulário aberto atualiza a linha
  // de cima na hora (a mesma promessa de "efeito imediato" dos popups).
  const pararDeObservarFormato = observarFormatoCoordenada(() => {
    const el = document.getElementById('mc-coordenada');
    if (el) el.textContent = formatarCoordenada(latlng.lat, latlng.lng);
  });
  painel.addEventListener('mc-fechou', pararDeObservarFormato);

  document.getElementById('mc-cancelar').addEventListener('click', fecharFormulario);
  document.getElementById('mc-salvar').addEventListener('click', async () => {
    const valores = {
      categoriaId: selCategoria.value,
      codigoEntidade: selItem.value,
      escalao: document.getElementById('mc-escalao').value,
      mod1: document.getElementById('mc-mod1')?.value || '00',
      mod2: document.getElementById('mc-mod2')?.value || '00',
      designacao: document.getElementById('mc-designacao').value.trim(),
      partidoId: document.getElementById('mc-partido').value || null,
      // Campo vazio vira `null`, nunca 0: o banco recusa zero de propósito
      // (0011), e "não sei" é um estado diferente de "mede zero".
      altitudeM: numeroOuNulo(document.getElementById('mc-altitude')?.value),
      frenteM: numeroOuNulo(document.getElementById('mc-frente')?.value),
      profundidadeM: numeroOuNulo(document.getElementById('mc-profundidade')?.value),
    };
    const ok = await salvarMarcacao({ latlng, marcacaoExistente, valores });
    if (ok) fecharFormulario();
  });
}

// ── Gravação ──────────────────────────────────────────────────────────────
// Nunca grava hostilidade — só natureza/dimensão/escalão (para montar o SIDC
// com o dígito de hostilidade como PLACEHOLDER, via getSIDC()) e partido_id
// (o fato que a Etapa 4.5 corrigiu). Quem lê depois, lê através de
// sidcParaObservador(), nunca deste SIDC cru.
// Campo numérico vazio -> null, nunca 0 nem NaN. Existe porque os três campos
// da 0011 são opcionais e o banco recusa zero: "não sei a dimensão" e "a
// dimensão é zero" são estados diferentes, e só o primeiro é honesto para um
// campo em branco.
function numeroOuNulo(texto) {
  const s = String(texto ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Os três campos da 0011, no formato que a tabela espera.
//
// `altitude_fonte` é derivada, NUNCA vem do formulário: hoje o app só produz
// cota digitada por quem marcou, então a fonte é sempre 'manual'. O banco
// aceita 'mde' desde a 0011 para a consulta a modelo de elevação poder entrar
// sem migration — e é aqui, num lugar só, que essa escolha passará a ser feita
// quando houver uma fonte confirmada. O `check` da 0011 garante que número e
// fonte nunca se separam no meio do caminho.
function camposDeAlvo(valores) {
  const alt = valores.altitudeM ?? null;
  return {
    altitude_m: alt,
    altitude_fonte: alt === null ? null : 'manual',
    frente_m: valores.frenteM ?? null,
    profundidade_m: valores.profundidadeM ?? null,
  };
}

async function salvarMarcacao({ latlng, marcacaoExistente, valores }) {
  // Uma linha, e o defeito mais caro desta série morava aqui.
  //
  // Até 2026-09-14 este trecho chamava `getSIDC()` direto com os CINCO campos
  // do formulário. Funcionava para o formulário e estava errado para a paleta,
  // que não tem esses cinco campos — ela tem o SIDC pronto do preset. Os cinco
  // chegavam `undefined`, `getSIDC()` caía em todos os defaults, e o default
  // dele é `10011000000000000000`: o losango vazio que apareceu no mapa.
  // **Toda marcação feita pela paleta saiu assim, desde o primeiro dia.**
  //
  // `sidcDaMarcacao()` (simbolos.js, puro e testado) é a regra inteira em uma
  // frase: se já existe um SIDC, ele É o SIDC; só se monta um quando não há.
  // O round-trip preset -> banco é travado por teste em paleta.teste.mjs.
  //
  // Continua valendo a decisão da Etapa 5 para o formulário: quando o SIDC é
  // montado, ele é montado NOVO e completo, nunca por splicing de dígitos do
  // antigo (`decomporSidc()` serve só para PRÉ-PREENCHER).
  const sidc = sidcDaMarcacao(valores);
  // `titulo` volta a ser o que a `0001` sempre disse que era — "rótulo curto
  // exibido no mapa" —, ou seja a DESIGNAÇÃO da unidade digitada pelo
  // usuário. Pode ser vazio: o tipo do elemento não precisa ser gravado
  // porque já está no SIDC (e sai de lá por `descreverSidc()`), e escrevê-lo
  // aqui foi a regressão da Etapa 9b que pôs o nome oficial inteiro ao lado
  // do símbolo no mapa.
  const titulo = valores.designacao || '';

  if (marcacaoExistente) {
    const { data, error } = await supabase
      .from('elementos_marcados')
      .update({ sidc, partido_id: valores.partidoId, titulo, ...camposDeAlvo(valores) })
      .eq('id', marcacaoExistente.id)
      .select()
      .single();
    if (error) {
      alert(`Não foi possível salvar a marcação (${traduzirErro(error)}).`);
      return false;
    }
    registrarLinha(data, { map: mapaRef });
    return true;
  }

  const { data, error } = await supabase
    .from('elementos_marcados')
    .insert({
      turma_id: turmaIdRef,
      autor_id: meuUserId,
      latitude: latlng.lat,
      longitude: latlng.lng,
      partido_id: valores.partidoId,
      sidc,
      titulo,
      ...camposDeAlvo(valores),
    })
    .select()
    .single();
  if (error) {
    alert(`Não foi possível criar a marcação (${traduzirErro(error)}).`);
    return false;
  }
  criarOuAtualizarMarcador(data, { map: mapaRef });
  return true;
}

// Exclusão lógica (removida_em/removida_por) — nunca DELETE de verdade, para
// o instrutor poder auditar depois o que foi apagado durante o exercício
// (decisão da Etapa 1, reafirmada em elementos_marcados na Etapa 4.5). A RLS
// (`elementos_remover`... na verdade este é um UPDATE, coberto por
// `elementos_editar_proprio`/`elementos_editar_instrutor`) permite ao autor
// editar a própria marcação e ao instrutor da turma editar qualquer uma.
async function removerMarcacao(id) {
  if (!confirm('Remover esta marcação do mapa?')) return;
  const { error } = await supabase
    .from('elementos_marcados')
    .update({ removida_em: new Date().toISOString(), removida_por: meuUserId })
    .eq('id', id);
  if (error) {
    alert(`Não foi possível remover a marcação (${traduzirErro(error)}).`);
    return;
  }
  esquecerLinha(id); // otimista — o evento Realtime (UPDATE) chega e é inofensivo (já sumiu)
}

// ── Toque no mapa ─────────────────────────────────────────────────────────
// O listener é registrado uma vez só e consulta a permissão na hora do
// clique, em vez de ser ligado/desligado a cada mudança: assim não há risco
// de sobrar um listener duplicado depois de o instrutor alternar a chave
// várias vezes durante o exercício.
function ativarCliqueNoMapa(map) {
  cliqueHandler = (ev) => {
    if (cliqueSuspenso) return; // outra interação de clique está ativa no mesmo mapa (ex.: desenhar área offline)
    if (painelAberto) return; // um formulário por vez
    if (!podeCriar()) {
      status('criar marcação está desabilitado pelo instrutor', '#f5c842');
      return;
    }
    // Etapa 6c: a guarda EXTRA (lotação) só existe quando quem chamou
    // iniciarMarcacoes() passou avaliarCriacaoExtra — hoje só situacao.js.
    if (avaliarCriacaoExtra) {
      const extra = avaliarCriacaoExtra();
      if (!extra.permitido) {
        status(extra.motivo || 'criar marcação não é permitido nesta turma', '#f5c842');
        return;
      }
    }
    abrirFormulario(ev.latlng);
  };
  map.on('click', cliqueHandler);
}

// ── Ponto de entrada ──────────────────────────────────────────────────────
// map: instância do Leaflet, passada explicitamente (mesmo padrão de gps.js
// e colegas.js).
// userId: session.user.id (igual perfis.id).
// turmaId: perfil.turma_id.
// perfil: objeto de buscarPerfil() em auth.js (papel, partido).
//
// Etapa 6a: as três permissões deste módulo são observadas no fim da função
// (a lacuna registrada aqui desde a Etapa 5 fechou).
//
// avaliarCriacaoExtra (Etapa 6c, opcional): ver o comentário dela lá em
// cima. `null`/omitido preserva o comportamento de sempre (app do aluno).
export async function iniciarMarcacoes({
  map, userId, turmaId, perfil,
  avaliarCriacaoExtra: extra,
  obterPostoObservacao: posto,
} = {}) {
  mapaRef = map;
  meuUserId = userId;
  turmaIdRef = turmaId;
  meuPartido = perfil?.partido || null;
  meuPapel = perfil?.papel;
  avaliarCriacaoExtra = extra || null;
  obterPostoObservacao = posto || null;

  if (!turmaId) {
    // Sem turma, a policy `elementos_criar` rejeitaria o insert mesmo assim
    // (with check turma_id = fn_minha_turma()) — nem tenta montar estado.
    status('aguardando você entrar em uma turma', '#f5c842');
    return;
  }

  status('carregando…');

  const partidos = await buscarPartidosDaTurma(turmaId);
  partidosDaTurma = partidos;
  partidos.forEach((p) => partidosPorId.set(p.id, p));

  const ctx = { map };

  // Os observadores entram ANTES do select inicial para que a primeira linha
  // que chegar já seja avaliada com o valor real de `ver_marcacoes_outros` —
  // senão as marcações dos outros piscariam na tela antes de sumir.
  // Se o instrutor cortou a permissão com o formulário de criação aberto, o
  // formulário fecha: deixá-lo aberto só levaria a um erro de RLS ao salvar.
  // Edição não é afetada (é outra chave).
  // Etapa 6c: as três chamadas guardam a função de cancelar em
  // desligarObservadores, para pararMarcacoes() poder desligá-las. O app do
  // aluno nunca chama pararMarcacoes(), então isso não muda nada para ele —
  // é só o array recebendo entradas que nunca são lidas.
  desligarObservadores.push(observarPermissao('criar_marcacao_inimiga', (habilitada) => {
    if (!habilitada && painelAberto) fecharFormulario();
  }));

  // Os botões Editar/Remover são montados quando o popup ABRE, então basta
  // fechar o que estiver aberto para o próximo já vir com o estado novo.
  desligarObservadores.push(observarPermissao('editar_marcacao_propria', () => map.closePopup()));

  desligarObservadores.push(observarPermissao('ver_marcacoes_outros', () => reavaliarVisibilidade(ctx)));

  // Etapa 9b: trocar o formato de coordenada tem que valer NA HORA, sem F5.
  // O popup só é montado quando abre (ver aoAbrirPopup), então os que ainda
  // não abriram já vão nascer certos; o que pode estar aberto neste instante
  // é redesenhado aqui. Mesmo padrão do observador de
  // `editar_marcacao_propria` logo acima.
  desligarObservadores.push(observarFormatoCoordenada(() => {
    for (const estado of marcadores.values()) {
      if (!estado.marker.isPopupOpen()) continue;
      estado.marker.getPopup().setContent(construirPopupHtml(
        estado.row,
        perfisAutorCache.get(estado.row.autor_id),
        perfisAutorCache.get(estado.row.editada_por)
      ));
    }
  }));

  await carregarEstadoInicial(turmaId, ctx);
  assinarCanal(turmaId, ctx);
  ativarCliqueNoMapa(map);

  window.addEventListener('beforeunload', () => {
    if (canalAtual) supabase.removeChannel(canalAtual);
  });
}

// Etapa 6c: teardown limpo, para frontend/situacao.js poder trocar de turma
// sem sobrepor as marcações da turma antiga com as da nova. O app do aluno
// nunca chama isto (só inicia uma vez por carga de página — trocar de turma
// lá recarrega a página inteira, decisão da Etapa 6a).
//
// Deixa `mapaRef`/`meuUserId` como estavam (quem chama vai logo em seguida
// chamar iniciarMarcacoes() de novo com o mesmo mapa e usuário, só turma
// diferente) — só desfaz o que é ESPECÍFICO da turma atual: canal Realtime,
// listener de clique, marcadores desenhados e o cache de linhas.
export function pararMarcacoes() {
  fecharFormulario();
  if (canalAtual) {
    supabase.removeChannel(canalAtual);
    canalAtual = null;
  }
  if (mapaRef && cliqueHandler) {
    mapaRef.off('click', cliqueHandler);
    cliqueHandler = null;
  }
  for (const id of [...marcadores.keys()]) removerMarcadorDoMapa(id);
  linhas.clear();
  desligarObservadores.forEach((desligar) => desligar());
  desligarObservadores = [];
}
