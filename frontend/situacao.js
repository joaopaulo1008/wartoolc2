// situacao.js — Etapa 6c do roadmap: "Situação atual", o mapa ao vivo do
// instrutor.
//
// Esta é uma LACUNA encontrada depois da 6b, não uma etapa do plano
// original: o instrutor nunca teve como ver o mapa ao vivo (`index.html`
// redireciona quem não é `usuario`), e a aba de debriefing (6b) responde
// "onde ele esteve", não "onde todo mundo está agora". O dado sempre esteve
// liberado — a policy `posicoes_ler` (0003) tem o ramo
// `fn_sou_instrutor_da_turma(turma_id)`, que entrega a turma inteira, os
// dois partidos — faltava só a tela. Nenhuma migration nova: todas as
// policies usadas aqui (`posicoes_ler`, `posicoes_remover_instrutor`,
// `elementos_criar`, `elementos_editar_instrutor`, `elementos_remover`) já
// existem desde 0002/0003, e as duas tabelas já são publicadas no Realtime.
//
// Responsabilidade deste módulo: a TELA da terceira aba do painel do
// instrutor — mapa ao vivo com os dois partidos, lista da turma ao lado, e
// as ações que só fazem sentido aqui (apagar posição fantasma, atalho para
// o rastro de alguém no Debriefing).
//
// Reuso vs. cópia — por que este é um módulo NOVO, e não colegas.js
// generalizado
// -----------------------------------------------------------------------
// colegas.js (Etapa 4) já faz "select inicial + canal Realtime + vigia de
// ausência" — a mesma espinha dorsal que esta tela precisa. Mas ele foi
// escrito para o ALUNO, e três coisas específicas dele não fazem sentido
// aqui:
//   1. Ele SEMPRE exclui o próprio usuario_id (o próprio avatar é de
//      gps.js). Aqui não existe "próprio avatar" a excluir — o instrutor não
//      manda posição desta tela — e mesmo que a linha dele exista por algum
//      motivo (ex.: já foi aluno antes de virar instrutor), ela deveria
//      APARECER, não ser filtrada — mesmo critério que debriefing.js já usa
//      ("o instrutor também tem posição no histórico... não é filtrado da
//      lista").
//   2. Ele liga/desliga o módulo INTEIRO pela permissão `ver_posicao_outros`
//      do aluno. O instrutor não tem essa amarra (recebe tudo habilitado
//      pelo papel) e a tela não deveria piscar entre "carregando" e
//      "desabilitado" por causa de uma chave que não é dele.
//   3. Ele escreve status num elemento (`#colegas-status`) que não existe
//      nesta página, e não sabe nada sobre CRIAR/EDITAR/REMOVER marcação nem
//      apagar a posição de alguém — que são metade do que esta aba faz.
// Generalizar colegas.js para cobrir os três casos different exigiria
// parametrizar praticamente toda a função (excluir-ou-não, checar-ou-não
// permissão, id de status) para um único outro consumidor — o mesmo cálculo
// que already levou o projeto a manter cópias deliberadas outras vezes
// (Etapa 4: ícone do colega vs. do próprio; ver o comentário lá). Por isso
// este módulo é novo.
//
// O que NÃO é novo, porque duas cópias já seria demais: os limiares de
// "sumiu" (esmaecer/remover) e o cálculo de idade saíram para
// frontend/vigia-ausencia.js — ver o cabeçalho de lá. Este módulo importa de
// lá, não redefine os números.
//
// Marcações (criar/editar/remover elemento no mapa) reusam frontend/
// marcacoes.js por baixo, em vez de reimplementar formulário + popup +
// Realtime pela terceira vez: o instrutor já recebe `pode('criar_marcacao_
// inimiga')` etc. = true pelo papel (vw_permissoes_efetivas), e
// `meuPapel === 'instrutor'` dentro de marcacoes.js já faz `deveMostrar()`
// devolver true para qualquer marcação e `podeMexer` no popup devolver true
// também — ou seja, o comportamento "vê e mexe em tudo" que esta aba precisa
// já existe lá, testado, sem escrever uma linha nova de RLS-no-cliente. A
// ÚNICA coisa que marcacoes.js não sabia fazer é a pegadinha de lotação (ver
// avaliarCriacaoExtra() abaixo) e trocar de turma sem recarregar a página —
// por isso ele ganhou dois acréscimos ADITIVOS (avaliarCriacaoExtra,
// pararMarcacoes) que não mudam nada do comportamento do app do aluno.
// Etapa 9a: `L` vinha de <script src=CDN> como global; agora é import de
// verdade (leaflet pinado em package.json na mesma versão que já se usava).
import * as L from 'leaflet';
import { supabase, traduzirErro, buscarUsuariosDaTurma } from './auth.js';
import { criarIconeSimbolo } from './icones.js';
import { iniciarMarcacoes, pararMarcacoes } from './marcacoes.js';
import {
  AVISO_PARADO_MS, REMOVER_MS, idadeMs, iniciarVigia,
} from './vigia-ausencia.js';
// Etapa 7: as camadas de arquivo (calcos KML/KMZ publicados + arquivo aberto
// no próprio aparelho). Reuso direto do módulo do app do aluno — ele recebe o
// mapa e o contêiner do painel por parâmetro justamente para servir às duas
// telas. Nada de segundo caminho de desenho.
import { iniciarCamadas, definirTurmaCamadas } from './camadas.js';
import { criarBasemaps, preencherSeletorBasemap, BASEMAP_PADRAO, trocarBasemap } from './basemaps.js';
// Etapa 8a (correção pós-entrega): o instrutor também precisa de um mapa que
// continue funcionando se a rede dele oscilar — a decisão original desta
// etapa deixava só o app do aluno com isto, argumentando que "Situação
// atual" depende de rede para o DADO (Realtime) de qualquer forma. Isso era
// verdade mas irrelevante: instrutor sem rede também está sem posição
// atualizada dos alunos, mas continua precisando enxergar o TERRENO por
// baixo para se orientar — exatamente o mesmo raciocínio que já valia para
// o aluno ("um app sem carta é pior que um app sem foto aérea"). Mesmo
// módulo do app do aluno, mesmo padrão de `iniciarCamadas` acima: recebe
// `map`/`camadaBdgex`/contêiner por parâmetro, nada de segundo caminho.
import { iniciarOfflineMapa } from './offline-tela.js';
// Mesma correção de colegas.js (bug relatado em campo: avatares empilhados
// quando duas ou mais pessoas ficam fisicamente próximas). Aqui o instrutor
// vê a turma INTEIRA de uma vez, então o problema aparece ainda mais — ver o
// cabeçalho de dispersar-avatares.js.
import { dispersarPosicoes } from './dispersar-avatares.js';

// ── Mapas base ───────────────────────────────────────────────────────────
// Vêm de frontend/basemaps.js desde a Etapa 7.1. Até então esta tela tinha a
// própria cópia de um subconjunto de 4 opções — e o BDGEx do Exército, a
// carta mais importante do projeto, não estava nela: faltava justamente para
// quem conduz a instrução. Ver o cabeçalho de basemaps.js.

// ── Estado do módulo ─────────────────────────────────────────────────────
let contexto = null;        // { userId, perfil } — perfil.partido é o do INSTRUTOR
let minhaTurmaId = null;    // perfis.turma_id do próprio instrutor (lotação)
let turmaAtual = null;      // vem de observarTurma() em instrutor-permissoes.js
let aoPedirRastro = null;   // callback(usuarioId), fornecido por instrutor.html

let map = null;
let basemaps = null;
let basemapAtual = null;
let camadaPosicoes = null;

let usuarios = [];          // buscarUsuariosDaTurma(turmaId) — os dois partidos
// usuario_id -> { row (posicoes_atuais), marker (Leaflet|null), ultimaAtualizacaoEm (ms) }
const posicoes = new Map();

let canalPosicoes = null;
let vigiaControlador = null; // { parar() }, de iniciarVigia()
let iniciado = false;        // a aba já foi aberta ao menos uma vez?
// Etapa 7: as camadas de arquivo (camadas.js) são montadas na primeira
// abertura da aba. O sinalizador separado de `iniciado` existe porque
// definirTurmaSituacao() pode rodar antes disso — e chamar
// definirTurmaCamadas() com o módulo ainda não montado não faria nada útil.
let camadasIniciadas = false;

// ── Helpers de tela ──────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function nomeDoUsuario(u) {
  const nome = u.nome_guerra || u.nome_completo || '(sem nome)';
  return u.posto_graduacao ? `${u.posto_graduacao} ${nome}` : nome;
}

function duracaoCurta(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function aviso(texto, tipo) {
  const caixa = el('situacao-aviso');
  if (!caixa) return;
  if (!texto) {
    caixa.style.display = 'none';
    caixa.textContent = '';
    return;
  }
  caixa.style.display = 'block';
  caixa.textContent = texto;
  caixa.className = `painel-aviso ${tipo || 'info'}`;
}

function usuarioPorId(id) {
  return usuarios.find((u) => u.id === id) || null;
}

// ── Mapa (Leaflet) ───────────────────────────────────────────────────────
// Mesmo cuidado da Etapa 6b: um Leaflet criado dentro de um container
// display:none mede 0×0 e carrega os tiles errados. Por isso o mapa só é
// montado na primeira vez que a aba abre (aoAbrirSituacao), nunca em
// iniciarSituacao().
//
// Instância PRÓPRIA, separada da de debriefing.js — decisão deliberada, não
// economia perdida: as duas telas desenham coisas com significados
// diferentes (posição AGORA vs. replay de um passado fechado) sobre o MESMO
// tipo de objeto (marcador de usuário), e compartilhar uma única instância
// exigiria limpar e reconstruir o estado inteiro toda vez que o instrutor
// trocasse de aba — um lugar fácil para um marcador do replay vazar para o
// mapa ao vivo (ou vice-versa) se alguma limpeza esquecer um caso. Leaflet é
// barato de instanciar e os tiles ficam em cache do navegador; duas
// instâncias independentes, cada uma seguindo o mesmo padrão de "só monta
// quando a aba abre", é mais simples e mais difícil de fazer errado do que
// uma instância compartilhada com dois "modos".
function garantirMapa() {
  if (map) {
    setTimeout(() => map.invalidateSize(), 0);
    return map;
  }

  basemaps = criarBasemaps();
  map = L.map('situacao-mapa', { center: [-22, -47], zoom: 10 });
  preencherSeletorBasemap(el('situacao-basemap'));
  basemapAtual = trocarBasemap(map, basemaps, BASEMAP_PADRAO, null);
  camadaPosicoes = L.layerGroup().addTo(map);

  const seletor = el('situacao-basemap');
  if (seletor) {
    seletor.addEventListener('change', () => {
      if (!basemaps[seletor.value]) return;
      basemapAtual = trocarBasemap(map, basemaps, seletor.value, basemapAtual);
    });
  }

  setTimeout(() => map.invalidateSize(), 0);
  return map;
}

function enquadrarPosicoes() {
  const pontos = [];
  for (const estado of posicoes.values()) {
    if (estado.marker) pontos.push(estado.marker.getLatLng());
  }
  if (pontos.length) map.fitBounds(L.latLngBounds(pontos), { padding: [40, 40] });
}

// ── Ícone + popup de cada posição ────────────────────────────────────────
function iconePosicao(usuario) {
  return criarIconeSimbolo(usuario?.sidc, {
    // O OBSERVADOR aqui é o INSTRUTOR (contexto.perfil.partido). Ele
    // normalmente não tem partido — perfis.partido_id nasce nulo e o painel
    // de permissões (Etapa 6a) nem oferece seletor de força para quem é
    // instrutor ("o instrutor enxerga a turma inteira, os dois lados — não
    // precisa de força"). Nesse caso hostilidadeRelativa() (simbolos.js)
    // devolve `null` DE PROPÓSITO — "não afirmo nada" — e o SIDC gravado
    // passa intacto (ver a ordem das guardas lá, coberta por teste). Isto
    // NÃO é uma lacuna desta tela: é o mesmo comportamento que o replay de
    // debriefing.js já tem para o mesmo observador, e é exatamente o que a
    // Etapa 4.5 decidiu para "quem olha sem força". Se este instrutor em
    // particular estiver lotado numa força (caso raro, mas o código não
    // presume que não), o mapa sai com a hostilidade daquele ponto de
    // vista — também correto.
    partidoObservador: contexto?.perfil?.partido || null,
    partidoElemento: usuario?.partido || null,
    tamanho: 28,
    designacao: usuario?.nome_guerra || '',
    corFallback: '#7ab8f5',
    tamanhoFallback: 20,
  });
}

function popupPosicao(usuario, row) {
  const atualizado = row.atualizado_em
    ? new Date(row.atualizado_em).toLocaleTimeString('pt-BR')
    : '—';
  const precisao = row.precisao_m != null ? `±${Math.round(row.precisao_m)}m` : '—';
  const papel = usuario?.papel === 'instrutor' ? ' <i>(instrutor)</i>' : '';
  return (
    `<b>${esc(usuario ? nomeDoUsuario(usuario) : 'Usuário desconhecido')}</b>${papel}<br>` +
    `Força: ${esc(usuario?.partido?.nome || 'sem força')}<br>` +
    `Precisão: ${precisao}<br>` +
    `Atualizado: ${atualizado}`
  );
}

// ── Estado "ao vivo / parado / sem sinal" de um usuário ──────────────────
// Os mesmos dois limiares da vigia (AVISO_PARADO_MS/REMOVER_MS), só que
// aplicados à LISTA em vez de ao marcador — é o "de relance" que o
// instrutor precisa sem abrir o popup de cada um.
function estadoDe(usuarioId) {
  const estado = posicoes.get(usuarioId);
  if (!estado) return { texto: 'sem posição', cor: '#4a6a8a', temPosicao: false };
  const idade = idadeMs(estado.row.atualizado_em);
  if (idade >= REMOVER_MS) {
    return { texto: `sem sinal há ${duracaoCurta(idade)}`, cor: '#e05252', temPosicao: true };
  }
  if (idade >= AVISO_PARADO_MS) {
    return { texto: `parado há ${duracaoCurta(idade)}`, cor: '#f5c842', temPosicao: true };
  }
  return { texto: 'ao vivo', cor: '#7af57a', temPosicao: true };
}

// ── Desenho das posições ─────────────────────────────────────────────────
// Guarda a linha mesmo quando não desenha (marker fica null) — a LISTA
// precisa saber "há quanto tempo" mesmo de quem a vigia já tirou do mapa.
function registrarPosicao(row) {
  const anterior = posicoes.get(row.usuario_id);
  posicoes.set(row.usuario_id, {
    row,
    marker: anterior?.marker || null,
    ultimaAtualizacaoEm: row.atualizado_em ? new Date(row.atualizado_em).getTime() : Date.now(),
  });
}

function desenharOuAtualizarMarcador(usuarioId) {
  const estado = posicoes.get(usuarioId);
  if (!estado || !camadaPosicoes) return;
  const usuario = usuarioPorId(usuarioId);
  const { row } = estado;

  if (!estado.marker) {
    estado.marker = L.marker([row.latitude, row.longitude], {
      icon: iconePosicao(usuario),
      zIndexOffset: 500,
    }).addTo(camadaPosicoes);
  } else {
    estado.marker.setLatLng([row.latitude, row.longitude]);
    estado.marker.setIcon(iconePosicao(usuario)); // força pode ter mudado desde o último desenho
    estado.marker.setOpacity(1); // pode ter sido esmaecido pela vigia; voltou a se mover, "está vivo"
  }
  estado.marker.bindPopup(popupPosicao(usuario, row));
  redistribuirPosicoes();
}

function removerMarcadorDoMapa(usuarioId) {
  const estado = posicoes.get(usuarioId);
  if (!estado?.marker || !camadaPosicoes) return;
  camadaPosicoes.removeLayer(estado.marker);
  estado.marker = null;
  redistribuirPosicoes();
}

// Mesma lógica de colegas.js: recalcula, a partir da posição CRUA
// (estado.row.lat/lng, nunca do que um deslocamento anterior já moveu) de
// todo mundo com marker ainda desenhado, quem precisa sair do lugar por
// estar empilhado com outro usuário — o instrutor vê a turma inteira de uma
// vez, então este é o caso onde o problema mais aparece. Determinístico:
// quem não colide com ninguém sempre volta pra própria posição exata.
function redistribuirPosicoes() {
  const pontos = [];
  for (const [id, estado] of posicoes) {
    if (!estado.marker) continue; // vigia já tirou do mapa; não participa do arranjo
    pontos.push({ id, lat: estado.row.latitude, lng: estado.row.longitude });
  }
  const posicionado = dispersarPosicoes(pontos);
  for (const [id, p] of posicionado) {
    posicoes.get(id)?.marker?.setLatLng([p.lat, p.lng]);
  }
}

// A linha some do banco de verdade (DELETE — do próprio instrutor via
// apagarPosicao(), de outro instrutor, ou do SQL Editor): diferente da
// vigia (que só ESCONDE, mantendo "há quanto tempo" na lista), aqui não
// sobra nada para lembrar — a próxima posição que a pessoa mandar recria a
// linha do zero.
function esquecerPosicao(usuarioId) {
  removerMarcadorDoMapa(usuarioId);
  posicoes.delete(usuarioId);
  renderizarLista();
}

// ── 1. Estado inicial (select comum, não Realtime) ──────────────────────
async function carregarPosicoesIniciais(turmaId) {
  const { data, error } = await supabase
    .from('posicoes_atuais')
    .select('usuario_id, latitude, longitude, precisao_m, atualizado_em')
    .eq('turma_id', turmaId);

  if (error) {
    console.error('Falha ao carregar posições da turma:', error);
    aviso(`Não foi possível carregar as posições ao vivo (${traduzirErro(error)}).`, 'erro');
    return false;
  }

  posicoes.clear();
  for (const row of data || []) {
    registrarPosicao(row);
    // Bug de campo (2026-08-01): antes, uma posição já "morta" (mais velha
    // que REMOVER_MS) nem era desenhada no mapa ao carregar a tela — o
    // instrutor perdia de vista de onde alguém esteve por último. Agora
    // SEMPRE desenha; aplicarOpacidadePorIdade() cuida de já mostrar
    // esmaecido/sem sinal de cara, sem esperar o próximo ciclo da vigia.
    desenharOuAtualizarMarcador(row.usuario_id);
    aplicarOpacidadePorIdade(row.usuario_id, idadeMs(row.atualizado_em));
  }
  renderizarLista();
  return true;
}

// ── 2. Canal Realtime ─────────────────────────────────────────────────────
function assinarCanalPosicoes(turmaId) {
  canalPosicoes = supabase
    .channel(`situacao-posicoes-turma-${turmaId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'posicoes_atuais',
        filter: `turma_id=eq.${turmaId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const usuarioId = payload.old?.usuario_id;
          if (usuarioId) esquecerPosicao(usuarioId);
          return;
        }
        const row = payload.new;
        if (!row) return;
        registrarPosicao(row);
        desenharOuAtualizarMarcador(row.usuario_id);
        renderizarLista();
      }
    )
    .subscribe((estadoCanal) => {
      if (estadoCanal === 'CHANNEL_ERROR' || estadoCanal === 'TIMED_OUT') {
        aviso('A conexão em tempo real das posições falhou — recarregue a página.', 'erro');
      }
    });
}

// ── 3. Vigia de ausência (limiares em vigia-ausencia.js) ─────────────────
// Bug de campo (teste em outra cidade, 2026-08-01): REMOVER_MS tirava o
// marcador do mapa (removerMarcadorDoMapa) quando alguém perdia sinal — o
// instrutor via o ícone sumir, mesmo a lista já mostrando "sem sinal há Xm"
// (estadoDe(), que nunca dependeu do marker existir). Pedido explícito:
// elemento amigo não some, fica na última posição conhecida, esmaecido, com
// o horário dela (popupPosicao já mostra "Atualizado: ..."). Por isso
// REMOVER_MS não remove mais o marker aqui — só esmaece mais forte que
// AVISO_PARADO_MS. O marker só sai do mapa por um DELETE de verdade
// (esquecerPosicao, via assinarCanalPosicoes ou apagarPosicao()).
const OPACIDADE_ESMAECIDA = 0.4;
const OPACIDADE_SEM_SINAL = 0.15;

function aplicarOpacidadePorIdade(usuarioId, idade) {
  const marker = posicoes.get(usuarioId)?.marker;
  if (!marker) return;
  if (idade >= REMOVER_MS) marker.setOpacity(OPACIDADE_SEM_SINAL);
  else if (idade >= AVISO_PARADO_MS) marker.setOpacity(OPACIDADE_ESMAECIDA);
}

function iniciarVigiaLocal() {
  if (vigiaControlador) return;
  vigiaControlador = iniciarVigia({
    listarEstados: () => [...posicoes].map(([usuarioId, estado]) => ({
      usuarioId, ultimaAtualizacaoEm: estado.ultimaAtualizacaoEm,
    })),
    aoEsmaecer: (e) => {
      posicoes.get(e.usuarioId)?.marker?.setOpacity(OPACIDADE_ESMAECIDA);
      renderizarLista(); // mantém "parado há Xm" contando na lista
    },
    aoRemover: (e) => {
      posicoes.get(e.usuarioId)?.marker?.setOpacity(OPACIDADE_SEM_SINAL);
      renderizarLista();
    },
  });
}

function pararVigiaLocal() {
  if (vigiaControlador) {
    vigiaControlador.parar();
    vigiaControlador = null;
  }
}

// ── Apagar posição fantasma (Etapa 6c) ───────────────────────────────────
// A policy `posicoes_remover_instrutor` (0002/0003) permite: `usuario_id =
// auth.uid() or fn_sou_instrutor_da_turma(turma_id)` — ou seja, mesmo um
// instrutor só RESPONSÁVEL (sem lotação) pode apagar, diferente da pegadinha
// de criar marcação (ver avaliarCriacaoExtra). Destrutivo e sem desfazer:
// por isso a confirmação explícita, no mesmo padrão de removerMarcacao() em
// marcacoes.js.
async function apagarPosicao(usuarioId) {
  const usuario = usuarioPorId(usuarioId);
  const nome = usuario ? nomeDoUsuario(usuario) : 'este usuário';
  const confirmado = confirm(
    `Apagar a posição de ${nome} do mapa?\n\n` +
    `Isso é destrutivo e não tem desfazer — a linha some do banco agora. ` +
    `Se o app dele continuar rodando e mandar uma posição nova, ela volta ` +
    `normalmente no próximo envio.`
  );
  if (!confirmado) return;

  const { error } = await supabase.from('posicoes_atuais').delete().eq('usuario_id', usuarioId);
  if (error) {
    aviso(`Não foi possível apagar a posição de ${nome}: ${traduzirErro(error)}.`, 'erro');
    return;
  }
  // Otimista — o evento Realtime (DELETE) chega depois e é inofensivo (já sumiu).
  esquecerPosicao(usuarioId);
}

function centralizarEm(usuarioId) {
  const estado = posicoes.get(usuarioId);
  if (!estado?.marker || !map) return;
  map.setView(estado.marker.getLatLng(), Math.max(map.getZoom(), 15));
}

// ── A pegadinha de elementos_criar (ver ROADMAP.md, Etapa 6c) ───────────
// `elementos_criar` exige `turma_id = fn_minha_turma()` — estar LOTADO na
// turma — e NÃO `fn_sou_instrutor_da_turma()` (lotado OU responsável), que é
// o que todas as OUTRAS ações desta aba (ler, editar, remover marcação;
// apagar posição) usam. Um instrutor que só RESPONDE pela turma
// (turmas.instrutor_id) sem estar lotado nela passa por
// `pode('criar_marcacao_inimiga')` (a view devolve tudo habilitado pelo
// papel) e mesmo assim levaria um erro cru do PostgREST ao tentar criar —
// exatamente o caso que avaliarPermissaoDeEscrita() em
// instrutor-permissoes.js já detecta para a grade de permissões. Aqui é o
// mesmo aviso, para a mesma causa, numa ação diferente.
function avaliarCriacaoExtra() {
  if (!turmaAtual || turmaAtual.id === minhaTurmaId) return { permitido: true };
  return {
    permitido: false,
    motivo: 'Criar marcação recusado: você não está lotado nesta turma (só responde por ela). Veja o aviso no topo desta aba.',
  };
}

function atualizarAvisoLotacao() {
  if (!turmaAtual || turmaAtual.id === minhaTurmaId) {
    aviso('');
    return;
  }
  aviso(
    `Você vê, edita e apaga marcações e posições desta turma porque é o instrutor responsável por ela, ` +
    `mas não está LOTADO nela — e a regra do banco (elementos_criar) exige lotação para CRIAR marcação ` +
    `nova aqui, não só responsabilidade. Para criar: entre nesta turma pelo código de acesso, ou rode ` +
    `update public.perfis set turma_id = '${turmaAtual.id}' where id = '${contexto?.userId}';`,
    'erro'
  );
}

// ── Lista da turma ────────────────────────────────────────────────────────
async function carregarUsuarios(turmaId) {
  usuarios = await buscarUsuariosDaTurma(turmaId);
  renderizarLista();
}

function renderizarLista() {
  const lista = el('situacao-lista');
  if (!lista) return;

  const contagem = el('situacao-contagem');
  if (contagem) contagem.textContent = String(usuarios.length);

  if (usuarios.length === 0) {
    lista.innerHTML = '<div class="lista-vazia">Ninguém entrou nesta turma ainda.</div>';
    return;
  }

  lista.innerHTML = usuarios.map((u) => {
    const estado = estadoDe(u.id);
    const partido = u.partido
      ? `<span class="tag-partido" style="border-color:${esc(u.partido.cor)};color:${esc(u.partido.cor)}">${esc(u.partido.nome)}</span>`
      : '<span class="tag-partido tag-sem">sem força</span>';
    const papel = u.papel === 'instrutor'
      ? '<span class="tag-papel tag-instrutor">instrutor</span>'
      : '<span class="tag-papel">aluno</span>';

    return `
      <div class="item-usuario" data-id="${esc(u.id)}">
        <span class="item-nome">${esc(nomeDoUsuario(u))}</span>
        <span class="item-tags">${papel}${partido}</span>
        <span class="item-meta" style="color:${estado.cor}">${esc(estado.texto)}</span>
        <div class="linha-botoes">
          <button type="button" class="btn-mini situacao-centralizar" data-id="${esc(u.id)}"${estado.temPosicao ? '' : ' disabled'}>Centralizar</button>
          <button type="button" class="btn-mini situacao-rastro" data-id="${esc(u.id)}">Ver rastro</button>
          ${estado.temPosicao
            ? `<button type="button" class="btn-mini btn-mini-perigo situacao-apagar" data-id="${esc(u.id)}">Apagar posição</button>`
            : ''}
        </div>
      </div>`;
  }).join('');

  lista.querySelectorAll('.situacao-centralizar').forEach((b) => {
    b.addEventListener('click', () => centralizarEm(b.dataset.id));
  });
  lista.querySelectorAll('.situacao-rastro').forEach((b) => {
    b.addEventListener('click', () => aoPedirRastro?.(b.dataset.id));
  });
  lista.querySelectorAll('.situacao-apagar').forEach((b) => {
    b.addEventListener('click', () => apagarPosicao(b.dataset.id));
  });
}

// ── Marcações (elementos_marcados) — reuso de marcacoes.js ───────────────
async function iniciarMarcacoesDaTurma(turmaId) {
  await iniciarMarcacoes({
    map,
    userId: contexto.userId,
    turmaId,
    // meuPapel === 'instrutor' dentro de marcacoes.js já faz "vê e mexe em
    // tudo" — nenhuma lógica nova de visibilidade precisa entrar aqui.
    perfil: contexto.perfil,
    avaliarCriacaoExtra,
  });
}

// ── Ciclo de vida ──────────────────────────────────────────────────────────
async function carregarTudo() {
  if (!turmaAtual || !map) return;
  const turmaId = turmaAtual.id;
  aviso('');

  // Sequencial, não Promise.all: desenharOuAtualizarMarcador() precisa de
  // `usuarios` já carregado para achar nome/sidc/partido de cada posição —
  // carregando em paralelo, a primeira leva de posições desenharia com
  // ícone de fallback (SIDC indefinido) até a segunda terminar, e nada
  // redesenharia depois. Turma de exercício é pequena — o round-trip extra
  // é barato, mesmo raciocínio usado em todo o projeto desde a Etapa 4.
  await carregarUsuarios(turmaId);
  const posicoesOk = await carregarPosicoesIniciais(turmaId);
  await iniciarMarcacoesDaTurma(turmaId);

  assinarCanalPosicoes(turmaId);
  iniciarVigiaLocal();

  if (posicoesOk) {
    enquadrarPosicoes();
    atualizarAvisoLotacao();
  }
}

function pararTudo() {
  if (canalPosicoes) {
    supabase.removeChannel(canalPosicoes);
    canalPosicoes = null;
  }
  pararVigiaLocal();
  if (camadaPosicoes) camadaPosicoes.clearLayers();
  posicoes.clear();
  pararMarcacoes(); // teardown aditivo de marcacoes.js (Etapa 6c) — seguro mesmo se nunca chamado iniciarMarcacoes()
}

// ── Ponto de entrada ─────────────────────────────────────────────────────
// Chamado por instrutor.html depois de exigirSessao('instrutor'). Não faz
// nenhum trabalho de mapa/rede ainda — só guarda contexto. aoPedirRastro é o
// callback que instrutor.html injeta para o botão "Ver rastro" de cada
// linha: troca a aba visível para o Debriefing (para o Leaflet de lá não
// nascer 0×0) e então chama abrirRastroDoAluno() de debriefing.js — este
// módulo não sabe nada sobre abas nem sobre debriefing.js, de propósito.
export function iniciarSituacao({ userId, perfil, aoPedirRastro: callback } = {}) {
  contexto = { userId, perfil };
  minhaTurmaId = perfil?.turma_id || null;
  aoPedirRastro = callback || null;

  window.addEventListener('beforeunload', pararTudo);
}

// Chamado por instrutor.html toda vez que a aba "Situação atual" é aberta.
// Mesma razão de aoAbrirDebriefing() na 6b: só monta o Leaflet quando o
// container já está visível.
export function aoAbrirSituacao() {
  garantirMapa();
  if (!iniciado) {
    iniciado = true;
    carregarTudo();
    // Etapa 7: as camadas de arquivo entram junto com o resto, e só quando a
    // aba abre — pelo mesmo motivo do mapa: o painel precisa de um contêiner
    // visível, e não faz sentido baixar calco para uma aba que talvez não
    // seja aberta nesta sessão.
    //
    // `#situacao-lateral` é a coluna da esquerda desta aba; no app do aluno o
    // mesmo módulo usa `#side-panel`. Não é aguardado: a lista da turma e as
    // posições não dependem disto, e um calco lento não deve segurar o mapa
    // ao vivo.
    iniciarCamadas({
      map,
      userId: contexto?.userId,
      turmaId: turmaAtual?.id,
      container: '#situacao-lateral',
    });
    camadasIniciadas = true;

    // Etapa 8a: mapa offline, mesma decisão e mesmo módulo do app do aluno.
    // `basemaps.bdgex` é a MESMA instância WMS que desenha a carta nesta
    // aba (criada em garantirMapa(), acima) — não uma cópia; é o que garante
    // que a URL de cada tile baixado bate com a que o Leaflet pede ao vivo
    // depois (ver o comentário grande em offline-tela.js). Como o Service
    // Worker registrado aqui tem escopo em toda `frontend/`, a aba
    // "Debriefing" (outra instância de Leaflet, outro BDGEx — Etapa 6b) passa
    // a se beneficiar do MESMO cache de tiles automaticamente, sem precisar
    // registrar nada de novo lá: é a mesma página, o mesmo Service Worker
    // intercepta as duas. Não é aguardado, pelo mesmo motivo de
    // `iniciarCamadas` acima.
    iniciarOfflineMapa({
      map,
      camadaBdgex: basemaps.bdgex,
      userId: contexto?.userId,
      seletorContainer: '#situacao-lateral',
    });
  }
}

// Chamado por instrutor-permissoes.js (via observarTurma()) toda vez que o
// instrutor troca de turma no seletor do topo — as três abas do painel
// trabalham sempre sobre a MESMA turma.
export function definirTurmaSituacao(turma) {
  const mudou = turma?.id !== turmaAtual?.id;
  turmaAtual = turma || null;
  if (!mudou) return;

  if (iniciado) pararTudo(); // só há algo para desligar se a aba já foi aberta alguma vez
  usuarios = [];
  renderizarLista();
  aviso('');

  // Etapa 7: os calcos são por turma e trocam junto. Só faz sentido se as
  // camadas já tiverem sido montadas — antes da primeira abertura da aba, a
  // turma nova já vai no `iniciarCamadas()` de aoAbrirSituacao().
  if (camadasIniciadas) definirTurmaCamadas(turmaAtual?.id || null);

  if (turmaAtual && iniciado) carregarTudo();
}
