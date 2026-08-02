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
  CATEGORIAS, categoriaPorId, itensDaCategoria, nomeDoItem, designacaoDoMapa,
  ESCALAO_ROTULO,
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
let obterMinhaPosicao = null;

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
  const v = obterMinhaPosicao
    ? visada(obterMinhaPosicao(), { lat: row.latitude, lon: row.longitude })
    : null;
  const linhaVisada = v
    ? `<div class="popup-row"><span class="popup-label">Do meu posto</span>` +
      `<span class="popup-value">${escapar(formatarVisada(v))}</span></div>`
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
      `<div class="popup-row"><span class="popup-label">Marcado por</span><span class="popup-value">${escapar(autorNome)} às ${quando}</span></div>` +
      linhaEdicao +
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
    #marcacao-painel .mc-coord {
      font-size:11px; color:#7a9ab8; margin-bottom:12px; padding:5px 7px;
      background:#16263a; border:1px solid #23405e; border-radius:4px;
      font-variant-numeric:tabular-nums;
    }
    .mc-botoes { display:flex; gap:6px; margin-top:8px; }
    .mc-btn { padding:3px 10px; border-radius:4px; font-size:11px; cursor:pointer; border:1px solid #999; background:#f0f0f0; }
    .mc-btn-remover { border-color:#c0392b; color:#c0392b; }
    .mc-corrigida .popup-value { color:#f5c842; }
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
function construirOpcoesCategoria(idSelecionado) {
  return CATEGORIAS
    .map((c) => `<option value="${c.id}"${c.id === idSelecionado ? ' selected' : ''}>${escapar(c.nome)}</option>`)
    .join('');
}

// Os ícones centrais de UMA categoria, com <optgroup> por entidade APP-6D.
// O rótulo mostrado é o `NomeBR` puro — sem o sufixo de desambiguação que a
// tabela plana NATUREZA usa, porque aqui a categoria já foi escolhida (ver o
// comentário de `chaveNatureza()` em simbolos.js).
function construirOpcoesItem(categoriaId, codigoSelecionado) {
  return itensDaCategoria(categoriaId)
    .map((grupo) => {
      // O terceiro elemento da tupla, quando existe, é a OBSERVAÇÃO que o
      // portal trazia colada no nome ("código específico apenas para
      // compatibilidade com a OTAN", sinônimos, código OTAN de posto). Vai
      // como `title=`, não no rótulo: num <select> de celular ela empurraria
      // o nome para fora da tela — que é o mesmo problema que a correção de
      // 2026-08-02 resolveu no mapa.
      const opcoes = grupo.itens
        .map(([codigo, nome, observacao]) =>
          `<option value="${codigo}"${codigo === codigoSelecionado ? ' selected' : ''}` +
          `${observacao ? ` title="${escapar(observacao)}"` : ''}>${escapar(nome)}</option>`)
        .join('');
      return `<optgroup label="${escapar(grupo.nome)}">${opcoes}</optgroup>`;
    })
    .join('');
}

// Modificador é opcional: o código '00' ("Não especificado") já vem do
// catálogo como primeira linha de toda tabela, então não é preciso inventar
// uma opção vazia aqui.
function construirOpcoesModificador(lista, codigoSelecionado) {
  return lista
    .map(([codigo, rotulo, observacao]) =>
      `<option value="${codigo}"${codigo === codigoSelecionado ? ' selected' : ''}` +
      `${observacao ? ` title="${escapar(observacao)}"` : ''}>${escapar(rotulo)}</option>`)
    .join('');
}

function construirOpcoesEscalao(chaveSelecionada) {
  // ESCALAO tem chaves sinônimas (CIA/BIA/ESC valem '14') e uma chave ''
  // sinônima de NONE — as duas coisas existem para aceitar entrada vinda de
  // dados antigos e do CSV do seed, não para virarem opções repetidas no
  // <select>. Mostramos só as que têm rótulo próprio em ESCALAO_ROTULO.
  return Object.keys(ESCALAO_ROTULO)
    .map((chave) =>
      `<option value="${chave}"${chave === chaveSelecionada ? ' selected' : ''}>${escapar(ESCALAO_ROTULO[chave])}</option>`)
    .join('');
}

function construirOpcoesPartido(partidoIdSelecionado) {
  const naoIdentificado = `<option value=""${!partidoIdSelecionado ? ' selected' : ''}>Não identificado</option>`;
  const outros = partidosDaTurma
    .map((p) => `<option value="${p.id}"${p.id === partidoIdSelecionado ? ' selected' : ''}>${p.nome}</option>`)
    .join('');
  return naoIdentificado + outros;
}

function fecharFormulario() {
  if (painelAberto) {
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
function abrirFormulario(latlng, { marcacaoExistente } = {}) {
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
  const preenchido = marcacaoExistente ? decomporSidc(marcacaoExistente.sidc) : {};
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
    <label>Categoria
      <select id="mc-categoria">${construirOpcoesCategoria(categoriaInicial)}</select>
    </label>
    <label>Tipo / natureza
      <select id="mc-item">${construirOpcoesItem(categoriaInicial, preenchido.codigoEntidade)}</select>
    </label>
    <p class="mc-dica">Nomes oficiais do Portal de Simbologia Militar (MD33-M-02).</p>
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
      <select id="mc-partido">${construirOpcoesPartido(marcacaoExistente?.partido_id)}</select>
    </label>
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

  selCategoria.addEventListener('change', () => {
    // Trocar de categoria zera a escolha de item e de modificador — não há
    // como "manter" nada: os códigos de entidade e os modificadores são
    // definidos POR symbol set, e o mesmo código significa outra coisa em
    // outra categoria.
    selItem.innerHTML = construirOpcoesItem(selCategoria.value, '');
    montarModificadores(selCategoria.value, '00', '00');
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
async function salvarMarcacao({ latlng, marcacaoExistente, valores }) {
  // Etapa 9b: o SIDC é montado a partir da CATEGORIA (que é o symbol set) e
  // do código de entidade escolhidos no catálogo, mais os dois modificadores.
  // Continua sendo `getSIDC()` de simbolos.js montando um SIDC NOVO e
  // completo — nunca splicing de dígitos do SIDC antigo (decisão da Etapa 5,
  // mantida: `decomporSidc()` serve só para PRÉ-PREENCHER).
  const sidc = getSIDC({
    dimensao: valores.categoriaId,
    escalao: valores.escalao,
    natureza_code: valores.codigoEntidade,
    mod1: valores.mod1,
    mod2: valores.mod2,
  });
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
      .update({ sidc, partido_id: valores.partidoId, titulo })
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
  obterMinhaPosicao: posicao,
} = {}) {
  mapaRef = map;
  meuUserId = userId;
  turmaIdRef = turmaId;
  meuPartido = perfil?.partido || null;
  meuPapel = perfil?.papel;
  avaliarCriacaoExtra = extra || null;
  obterMinhaPosicao = posicao || null;

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
