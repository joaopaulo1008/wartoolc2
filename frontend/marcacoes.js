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
import * as L from 'leaflet';
import { supabase, traduzirErro, buscarPerfilBasico, buscarPartidosDaTurma } from './auth.js';
import { getSIDC, decomporSidc, DIMENSAO, ESCALAO, NATUREZA } from './simbolos.js';
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

async function obterPerfilAutor(autorId) {
  if (perfisAutorCache.has(autorId)) return perfisAutorCache.get(autorId);
  const perfil = await buscarPerfilBasico(autorId); // pode devolver null (RLS, conta removida) — cacheia mesmo assim
  perfisAutorCache.set(autorId, perfil);
  return perfil;
}

// ── Ícone + popup de cada marcação ───────────────────────────────────────
// Tamanho intermediário entre o próprio avatar (30, gps.js) e o do colega
// (28, colegas.js) — não indica hierarquia nenhuma, só uma escolha visual
// para diferenciar "elemento marcado" de "gente com GPS ligado".
const TAMANHO_ICONE = 26;
const COR_FALLBACK = '#e05252';

function construirPopupHtml(row, autorPerfil) {
  const partido = row.partido_id ? partidosPorId.get(row.partido_id) : null;
  const nomePartido = partido ? partido.nome : 'Não identificado';
  const autorNome = autorPerfil ? (autorPerfil.nome_guerra || 'Sem nome de guerra') : '…';
  const quando = row.criada_em
    ? new Date(row.criada_em).toLocaleTimeString('pt-BR')
    : '—';
  // Etapa 6a: o autor só vê Editar/Remover se `editar_marcacao_propria`
  // estiver habilitada. O instrutor não depende dessa chave (a própria view
  // já devolve tudo habilitado para ele, mas a policy
  // `elementos_editar_instrutor` é o que realmente vale).
  const podeMexer = meuPapel === 'instrutor' || (row.autor_id === meuUserId && podeEditarPropria());
  const botoes = podeMexer
    ? `<div class="mc-botoes">
         <button id="mc-editar-${row.id}" type="button" class="mc-btn">Editar</button>
         <button id="mc-remover-${row.id}" type="button" class="mc-btn mc-btn-remover">Remover</button>
       </div>`
    : '';
  return (
    `<div class="popup-content">` +
      `<div class="popup-title">${row.titulo || 'Elemento'}</div>` +
      `<div class="popup-row"><span class="popup-label">Partido</span><span class="popup-value">${nomePartido}</span></div>` +
      `<div class="popup-row"><span class="popup-label">Marcado por</span><span class="popup-value">${autorNome} às ${quando}</span></div>` +
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
  const autor = await obterPerfilAutor(estado.row.autor_id);
  // A marcação pode ter mudado (ou sumido) enquanto a busca do autor corria.
  const estadoAtual = marcadores.get(id);
  if (!estadoAtual) return;
  marker.getPopup()?.setContent(construirPopupHtml(estadoAtual.row, autor));

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
    designacao: row.titulo,
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
      estado.marker.getPopup().setContent(construirPopupHtml(row, perfisAutorCache.get(row.autor_id)));
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
      border-radius:8px; padding:16px 20px; min-width:260px;
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
    #marcacao-painel select {
      display:block; width:100%; margin-top:4px; padding:5px 6px;
      background:#16263a; color:#e8eaf0; border:1px solid #2a4a6b; border-radius:4px;
    }
    #marcacao-painel .mc-acoes {
      display:flex; justify-content:flex-end; gap:8px; margin-top:14px;
    }
    #marcacao-painel button {
      padding:5px 14px; border-radius:4px; font-size:12px; cursor:pointer; border:1px solid #2a5a8c;
    }
    #marcacao-painel .mc-salvar { background:#1a3a5c; color:#7ab8f5; }
    #marcacao-painel .mc-cancelar { background:transparent; color:#c8d8e8; border-color:#3a5a7a; }
    .mc-botoes { display:flex; gap:6px; margin-top:8px; }
    .mc-btn { padding:3px 10px; border-radius:4px; font-size:11px; cursor:pointer; border:1px solid #999; background:#f0f0f0; }
    .mc-btn-remover { border-color:#c0392b; color:#c0392b; }
  `;
  document.head.appendChild(style);
}

function construirOpcoes(tabela, valorSelecionado) {
  // ESCALAO tem uma chave '' sinônima de NONE (mesmo valor '00') — só serve
  // para aceitar entrada vazia vinda de dados antigos, não para aparecer como
  // uma opção sem rótulo no <select>. As demais tabelas não têm chave vazia.
  return Object.keys(tabela)
    .filter((chave) => chave !== '')
    .map((chave) => `<option value="${chave}"${chave === valorSelecionado ? ' selected' : ''}>${chave}</option>`)
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

  const preenchido = marcacaoExistente ? decomporSidc(marcacaoExistente.sidc) : {};

  const painel = document.createElement('div');
  painel.id = 'marcacao-painel';
  painel.innerHTML = `
    <h3>${marcacaoExistente ? 'Editar marcação' : 'Nova marcação'}</h3>
    <label>Tipo / natureza
      <select id="mc-natureza">${construirOpcoes(NATUREZA, preenchido.natureza)}</select>
    </label>
    <label>Dimensão
      <select id="mc-dimensao">${construirOpcoes(DIMENSAO, preenchido.dimensao)}</select>
    </label>
    <label>Escalão
      <select id="mc-escalao">${construirOpcoes(ESCALAO, preenchido.escalao)}</select>
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

  document.getElementById('mc-cancelar').addEventListener('click', fecharFormulario);
  document.getElementById('mc-salvar').addEventListener('click', async () => {
    const valores = {
      natureza: document.getElementById('mc-natureza').value,
      dimensao: document.getElementById('mc-dimensao').value,
      escalao: document.getElementById('mc-escalao').value,
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
  const naturezaCodigo = NATUREZA[valores.natureza] || NATUREZA['Desconhecido / Não identificado'];
  const sidc = getSIDC({
    dimensao: valores.dimensao,
    escalao: valores.escalao,
    natureza_code: naturezaCodigo,
  });
  const titulo = valores.natureza || 'Elemento';

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
export async function iniciarMarcacoes({ map, userId, turmaId, perfil, avaliarCriacaoExtra: extra } = {}) {
  mapaRef = map;
  meuUserId = userId;
  turmaIdRef = turmaId;
  meuPartido = perfil?.partido || null;
  meuPapel = perfil?.papel;
  avaliarCriacaoExtra = extra || null;

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
