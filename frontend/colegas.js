// colegas.js — Etapa 4 do roadmap: ver os outros usuários em tempo real.
//
// Responsabilidade deste módulo: mostrar, no mesmo mapa que gps.js já
// desenha o SEU avatar, um avatar para cada colega de turma que está
// mandando posição — e tirar do mapa quem parou de mandar.
//
// Três peças, nesta ordem de execução:
//   1. Estado inicial — um SELECT comum (não Realtime) em posicoes_atuais,
//      filtrado pela turma. Necessário porque o Realtime só avisa de
//      mudanças a partir do instante em que o cliente assina o canal — ele
//      NÃO manda "o que já existia antes" (não faz backfill). Sem esse
//      select, só apareceria gente que se mexeu depois que você abriu a
//      página.
//   2. Canal Realtime — a partir daqui, INSERT/UPDATE/DELETE em
//      posicoes_atuais da turma chegam ao vivo.
//   3. Vigia de ausência — um setInterval local que remove do mapa quem
//      parou de mandar posição (ex.: fechou o app sem avisar ninguém). Sem
//      isso, a última posição gravada ficaria como um "fantasma" parado
//      para sempre, porque não existe nenhum evento de "usuário sumiu" —
//      só INSERT/UPDATE (posição nova) e DELETE (alguém apagou a linha,
//      normalmente o instrutor).
//
// Reusa o mesmo cliente Supabase de auth.js — mesmo motivo de gps.js: evita
// duplicar estado de sessão no navegador com um segundo createClient.
import { supabase, buscarPerfisDaTurma, buscarPerfilBasico } from './auth.js';
// Etapa 5: o helper de ícone (resolver a hostilidade relativa via
// sidcParaObservador() e montar o L.divIcon via milsymbol, com fallback) saiu
// daqui e de gps.js para frontend/icones.js — a marcação de elemento no mapa
// virou o terceiro consumidor previsto no comentário original deste arquivo.
import { criarIconeSimbolo } from './icones.js';
// Etapa 6a: `ver_posicao_outros` liga e desliga este módulo inteiro. Quando
// desligada, não basta esconder os avatares: o canal Realtime também é
// fechado, porque não faz sentido continuar recebendo posição que não vai
// ser desenhada (com 60+ alunos mandando GPS, é tráfego à toa no aparelho de
// quem está proibido de ver). Quando religa, o módulo refaz o caminho
// completo — select inicial e depois assinatura —, exatamente como faria numa
// carga de página, porque o Realtime não faz backfill do que passou enquanto
// o canal estava fechado.
import { observarPermissao } from './permissoes.js';
// Etapa 6c: os limiares de "sumiu" (esmaecer/remover) e o cálculo de idade
// saíram para frontend/vigia-ausencia.js quando a tela ao vivo do instrutor
// (frontend/situacao.js) passou a precisar do MESMO comportamento — ver o
// cabeçalho de lá para o raciocínio completo. Este módulo continua dono do
// PRÓPRIO laço (ele decide o que "esmaecer"/"remover" significam para um
// avatar de colega), só não guarda mais os números nem a conta de idade.
import { REMOVER_MS, idadeMs, iniciarVigia } from './vigia-ausencia.js';

// ── Estado do módulo ─────────────────────────────────────────────────────
// perfisCache: usuario_id -> { id, nome_guerra, sidc }. Povoado de uma vez
// só no início (buscarPerfisDaTurma) e, depois, sob demanda (ver
// obterPerfil) para quem chegar depois — posicoes_atuais NÃO guarda nome
// nem sidc, só coordenadas, então sem esse cache o avatar do colega não
// saberia nem o símbolo nem o nome a mostrar.
const perfisCache = new Map();

// colegas: usuario_id -> { marker (Leaflet), perfil, ultimaAtualizacaoEm (ms) }
const colegas = new Map();

let canalAtual = null;
let vigiaControlador = null; // { parar() }, de iniciarVigia() em vigia-ausencia.js

// Etapa 6a: contexto guardado no início (para poder religar sem os
// parâmetros originais) e o interruptor de `ver_posicao_outros`.
let contexto = null;
let ativo = false;

// Partido de QUEM ESTÁ OLHANDO ({ id, tipo } vindo de perfil.partido em
// auth.js), guardado no início por iniciarColegas(). É metade do par que
// decide a hostilidade de cada símbolo; a outra metade é o partido do colega.
// Hoje, na prática, todo colega visível está no MESMO partido que você (a RLS
// de 0003 não deixa a posição do outro partido nem chegar ao navegador), então
// o resultado é sempre "amigo" — o que muda é que agora isso é DERIVADO, e
// não presumido. Desde a Etapa 5, o mesmo cálculo (agora em icones.js) é
// reusado por frontend/marcacoes.js para dar "hostil" quando o elemento
// marcado é de um partido beligerante diferente do seu — sem lógica nova.
let meuPartido = null;

// ── UI: status ───────────────────────────────────────────────────────────
function status(texto, cor) {
  const el = document.getElementById('colegas-status');
  if (!el) return;
  el.textContent = `Colegas: ${texto}`;
  el.style.color = cor || '#7a9ab8';
}

// ── Ícone (símbolo NATO via milsymbol) ───────────────────────────────────
// Mesma ideia de criarIconeProprio() em gps.js (mesma biblioteca, mesmo
// SIDC de 20 dígitos vindo de perfis.sidc) — o desenho em si é
// criarIconeSimbolo(), compartilhado desde a Etapa 5 (frontend/icones.js).
// Tamanho levemente menor (28 vs. 30 do próprio avatar em gps.js) para o
// SEU avatar se destacar visualmente entre os colegas, não para indicar
// hierarquia nenhuma.
// O SIDC gravado em perfis.sidc traz um dígito de hostilidade que NÃO deve
// ser levado ao pé da letra: quem decide isso é o par (meu partido, partido
// dele) — criarIconeSimbolo() resolve isso internamente via
// sidcParaObservador(). Se algum dos dois ainda não tem partido, o SIDC
// original passa sem mexer — comportamento das Etapas 3 e 4, preservado.
function criarIconeColega(sidc, nomeGuerra, partidoDoColega) {
  return criarIconeSimbolo(sidc, {
    partidoObservador: meuPartido,
    partidoElemento: partidoDoColega,
    tamanho: 28,
    designacao: nomeGuerra,
    corFallback: '#f5a623',
    tamanhoFallback: 20,
  });
}

function popupColega(perfil, row) {
  const atualizado = row.atualizado_em
    ? new Date(row.atualizado_em).toLocaleTimeString('pt-BR')
    : '—';
  const precisao = row.precisao_m != null ? `±${Math.round(row.precisao_m)}m` : '—';
  return (
    `<b>${perfil.nome_guerra || 'Sem nome de guerra'}</b><br>` +
    `Precisão: ${precisao}<br>` +
    `Atualizado: ${atualizado}`
  );
}

// Perfil de um colega: procura no cache; se não achar (colega novo que
// entrou na turma depois do carregamento inicial), busca sob demanda e
// guarda no cache para a próxima vez.
async function obterPerfil(usuarioId) {
  let perfil = perfisCache.get(usuarioId);
  if (perfil) return perfil;

  perfil = await buscarPerfilBasico(usuarioId);
  if (!perfil) return null; // sem perfil legível (RLS, conta removida etc.) — ignora esta posição
  perfisCache.set(usuarioId, perfil);
  return perfil;
}

// Desenha ou atualiza o avatar de um colega a partir de uma linha de
// posicoes_atuais (seja do select inicial, seja de um evento Realtime).
async function upsertAvatar(row, { map }) {
  if (!ativo) return; // permissão caiu antes desta linha chegar
  const perfil = await obterPerfil(row.usuario_id);
  if (!perfil) return;
  // obterPerfil() pode ter ido ao servidor; nesse intervalo o instrutor pode
  // ter desligado a permissão. Sem esta segunda checagem, um avatar
  // "atrasado" apareceria depois da tela já ter sido limpa.
  if (!ativo) return;

  let estado = colegas.get(row.usuario_id);
  if (!estado) {
    const marker = L.marker([row.latitude, row.longitude], {
      icon: criarIconeColega(perfil.sidc, perfil.nome_guerra, perfil.partido),
      // Abaixo do próprio avatar (gps.js usa zIndexOffset 1000), mas acima
      // do painel COP legado (sem offset).
      zIndexOffset: 500,
    }).addTo(map);
    estado = { marker, perfil };
    colegas.set(row.usuario_id, estado);
  } else {
    estado.marker.setLatLng([row.latitude, row.longitude]);
    estado.marker.setOpacity(1); // pode ter sido esmaecido pela vigia; voltou a se mover, então "está vivo"
  }

  estado.ultimaAtualizacaoEm = row.atualizado_em ? new Date(row.atualizado_em).getTime() : Date.now();
  estado.marker.bindPopup(popupColega(perfil, row));

  status(`${colegas.size} visível${colegas.size === 1 ? '' : 'eis'}`, '#7af57a');
}

function removerAvatar(usuarioId, { map }) {
  const estado = colegas.get(usuarioId);
  if (!estado) return;
  map.removeLayer(estado.marker);
  colegas.delete(usuarioId);
  status(`${colegas.size} visível${colegas.size === 1 ? '' : 'eis'}`, '#7a9ab8');
}

// ── 1. Estado inicial (select comum, não Realtime) ──────────────────────
async function carregarEstadoInicial(turmaId, userId, { map }) {
  const { data, error } = await supabase
    .from('posicoes_atuais')
    .select('usuario_id, latitude, longitude, precisao_m, atualizado_em')
    .eq('turma_id', turmaId)
    .neq('usuario_id', userId); // exclui a si mesmo — gps.js já desenha o próprio avatar

  if (error) {
    console.error('Falha ao carregar posições iniciais dos colegas:', error);
    status('erro ao carregar posições iniciais', '#e05252');
    return;
  }

  for (const row of data || []) {
    // Se a posição já estava "morta" (mais velha que REMOVER_MS) antes
    // mesmo de você abrir a página, nem desenha — evita um flash de avatar
    // que a vigia ia remover nos próximos 15s de qualquer jeito.
    if (idadeMs(row.atualizado_em) >= REMOVER_MS) continue;
    await upsertAvatar(row, { map });
  }

  if (colegas.size === 0) status('nenhum colega visível ainda', '#7a9ab8');
}

// ── 2. Canal Realtime ─────────────────────────────────────────────────────
// "Realtime" = o serviço do Supabase que empurra mudanças do banco para o
// navegador via WebSocket, sem o cliente precisar ficar perguntando
// (polling) — é o que substitui o polling de 2min do pipeline QGIS antigo.
// "canal" = um tópico de mensagens: você assina um canal e só recebe os
// eventos configurados nele (aqui, um único tipo: postgres_changes).
// "postgres_changes" = o tipo de evento do Realtime que dispara toda vez que
// uma linha muda numa tabela do Postgres (INSERT, UPDATE ou DELETE) — o
// backend precisou publicar a tabela para isso funcionar (ver
// "Tempo real" em backend/README.md).
// "payload" = o objeto que chega no callback abaixo, com `eventType`
// ('INSERT' | 'UPDATE' | 'DELETE'), `new` (a linha depois da mudança — vazia
// em DELETE) e `old` (a linha antes — só vem preenchida por causa do
// REPLICA IDENTITY FULL configurado no backend; sem isso, DELETE chegaria
// sem dizer QUEM foi apagado).
// "assinar" (subscribe) = confirmar a inscrição e abrir a conexão de
// verdade — os .on() sozinhos só registram o que fazer quando algo chegar;
// nada chega enquanto subscribe() não for chamado.
function assinarCanal(turmaId, userId, { map }) {
  canalAtual = supabase
    .channel(`posicoes-turma-${turmaId}`)
    .on(
      'postgres_changes',
      {
        event: '*', // INSERT, UPDATE e DELETE, todos no mesmo callback
        schema: 'public',
        table: 'posicoes_atuais',
        // Filtra no SERVIDOR (não traz da turma errada para o navegador
        // filtrar depois) — sintaxe do PostgREST, "coluna=eq.valor".
        filter: `turma_id=eq.${turmaId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const usuarioId = payload.old?.usuario_id;
          if (!usuarioId || usuarioId === userId) return; // sua própria linha some junto com sua sessão; gps.js cuida do seu avatar
          removerAvatar(usuarioId, { map });
          return;
        }
        const row = payload.new;
        if (!row || row.usuario_id === userId) return; // ignora a si mesmo — evita desenhar um segundo avatar seu
        upsertAvatar(row, { map });
      }
    )
    .subscribe((estadoCanal) => {
      if (estadoCanal === 'SUBSCRIBED') {
        status(`${colegas.size} visível${colegas.size === 1 ? '' : 'eis'} (ao vivo)`, '#7af57a');
      } else if (estadoCanal === 'CHANNEL_ERROR' || estadoCanal === 'TIMED_OUT') {
        status('conexão em tempo real falhou — recarregue a página', '#e05252');
      }
    });
}

// ── 3. Vigia de ausência ──────────────────────────────────────────────────
// O laço em si (os dois limiares, o intervalo de checagem) mora em
// vigia-ausencia.js desde a Etapa 6c; aqui só se decide o que "esmaecer" e
// "remover" significam para um avatar de colega.
function iniciarVigiaAusencia(map) {
  if (vigiaControlador) return;
  vigiaControlador = iniciarVigia({
    listarEstados: () => [...colegas].map(([usuarioId, estado]) => ({
      usuarioId, ultimaAtualizacaoEm: estado.ultimaAtualizacaoEm, marker: estado.marker,
    })),
    aoEsmaecer: (e) => e.marker.setOpacity(0.4),
    aoRemover: (e) => removerAvatar(e.usuarioId, { map }),
  });
}

// ── Ponto de entrada ──────────────────────────────────────────────────────
// map: instância do Leaflet, passada explicitamente (mesmo padrão de
// gps.js — ver comentário lá sobre por que não ler `map` como global).
// userId: session.user.id (igual perfis.id).
// turmaId: perfil.turma_id (perfil vindo de buscarPerfil() em auth.js).
// partido: perfil.partido — { id, nome, tipo, cor } ou null (Etapa 4.5).
//   Opcional de propósito: se quem chamar não passar, os avatares saem com o
//   SIDC gravado, exatamente como na Etapa 4.
export async function iniciarColegas({ map, userId, turmaId, partido }) {
  meuPartido = partido || null;

  if (!turmaId) {
    // Sem turma, não há "colegas de turma" para mostrar — mesma lógica de
    // gps.js: nem tenta montar o estado ou assinar canal à toa.
    status('aguardando você entrar em uma turma', '#f5c842');
    return;
  }

  contexto = { map, userId, turmaId };

  // Etapa 6a: o observador é chamado na hora com o valor atual (fazendo o
  // papel do "start" que existia aqui antes) e de novo a cada mudança do
  // instrutor.
  observarPermissao('ver_posicao_outros', (habilitada) => {
    if (habilitada) ativar();
    else desativar();
  });

  window.addEventListener('beforeunload', desativar);
}

async function ativar() {
  if (ativo || !contexto) return;
  ativo = true;
  const { map, userId, turmaId } = contexto;

  status('carregando…');

  // Busca todos os perfis da turma de uma vez (não sob demanda, um por um)
  // porque uma turma de exercício é pequena (dezenas de pessoas, não
  // milhares) — um round-trip só é mais simples e mais rápido do que
  // esperar cada posição chegar para só então descobrir o nome de quem é.
  // obterPerfil() ainda cobre, sob demanda, quem entrar na turma DEPOIS
  // deste carregamento (ver comentário lá).
  const perfis = await buscarPerfisDaTurma(turmaId, { excluirId: userId });
  perfis.forEach((p) => perfisCache.set(p.id, p));

  if (!ativo) return; // desligado durante a busca

  await carregarEstadoInicial(turmaId, userId, { map });
  if (!ativo) return;

  assinarCanal(turmaId, userId, { map });
  iniciarVigiaAusencia(map);
}

function desativar() {
  if (!contexto) return;
  ativo = false;

  if (canalAtual) {
    supabase.removeChannel(canalAtual);
    canalAtual = null;
  }
  if (vigiaControlador) {
    vigiaControlador.parar();
    vigiaControlador = null;
  }
  // Tira todos os avatares do mapa. O status é escrito DEPOIS do laço porque
  // removerAvatar() também escreve status (a contagem regressiva de "N
  // visíveis") e sobrescreveria a mensagem de permissão.
  for (const usuarioId of [...colegas.keys()]) {
    removerAvatar(usuarioId, contexto);
  }
  status('ver a posição dos outros está desabilitado pelo instrutor', '#f5c842');
}
