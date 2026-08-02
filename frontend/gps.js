// gps.js — Etapa 3 do roadmap: GPS próprio no mapa.
//
// Responsabilidade deste módulo: capturar a posição do GPS do navegador de
// forma contínua, desenhar o próprio avatar (símbolo NATO) se movendo no
// mapa, e gravar essa posição no backend sem sobrecarregar a rede.
//
// Importa o MESMO cliente Supabase de auth.js (em vez de criar um segundo
// `createClient`) — assim a sessão de login já validada em auth.js é reusada,
// sem duplicar estado de autenticação no navegador.
// Etapa 9a: `L` vinha de <script src=CDN> como global; agora é import de
// verdade (leaflet pinado em package.json na mesma versão que já se usava).
import * as L from 'leaflet';
import { supabase, traduzirErro } from './auth.js';
// Etapa 5: o helper de ícone (montar L.divIcon a partir de um SIDC via
// milsymbol, com fallback) saiu daqui e de colegas.js para frontend/icones.js
// — a marcação de elemento no mapa virou o terceiro consumidor previsto no
// comentário de colegas.js. Ver o cabeçalho de icones.js para o raciocínio.
import { criarIconeSimbolo } from './icones.js';
// Etapa 6a: as duas chaves de permissão que mandam neste módulo.
//   enviar_posicao_gps  -> pode GRAVAR a própria posição no banco
//   ver_propria_posicao -> pode VER o próprio avatar desenhado no mapa
// São independentes de propósito: desligar o envio não precisa cegar o aluno
// sobre onde ele mesmo está (o desenho local não custa rede nem grava nada),
// e esconder o avatar não precisa parar o rastreamento que o instrutor
// acompanha. O `watchPosition` só é desligado quando AS DUAS estão desligadas
// — aí não sobrou motivo para manter o GPS do aparelho ativo gastando bateria.
import { observarPermissao, pode } from './permissoes.js';
// Etapa 9b: a coordenada da própria posição, no formato que o usuário
// escolheu. A formatação NÃO mora aqui — mora em coordenadas.js (conversão
// pura) atrás de preferencias.js (qual formato) — porque colegas.js e
// marcacoes.js mostram a mesma coisa e três cópias divergiriam.
import { formatarCoordenada, observarFormatoCoordenada } from './preferencias.js';

// ── watchPosition ────────────────────────────────────────────────────────
// `navigator.geolocation.watchPosition(sucesso, erro, opcoes)` é a API do
// navegador para localização CONTÍNUA: diferente de `getCurrentPosition`
// (uma leitura só), ela registra um observador que o navegador chama de novo
// sempre que tem uma posição nova — em teoria, cada poucos segundos, mas sem
// intervalo fixo garantido (por isso o throttling manual abaixo).
const WATCH_OPTIONS = {
  enableHighAccuracy: true, // pede o GPS de verdade do aparelho, não só a localização aproximada por rede/wifi
  maximumAge: 5_000,        // aceita uma leitura já em cache do navegador de até 5s atrás, em vez de forçar sempre uma nova
  timeout: 15_000,          // desiste de uma leitura específica depois de 15s (dispara erro TIMEOUT)
};

// ── Throttling ───────────────────────────────────────────────────────────
// "Throttling" = limitar a frequência de uma ação. Aqui, quantas vezes por
// minuto o navegador GRAVA a posição no banco (upsert). O `watchPosition`
// pode chamar nosso callback várias vezes por segundo; sem limitar, cada
// aluno geraria centenas de escritas por minuto sem ganho nenhum de precisão
// visível no mapa — e com 60+ alunos isso pesa no Supabase à toa.
//
// Três regras, combinadas:
//   1. INTERVALO_MINIMO_MS — teto: nunca grava mais de uma vez a cada N
//      segundos, mesmo que a pessoa esteja correndo.
//   2. DISTANCIA_MINIMA_M — piso: ignora leituras que "andaram" menos que
//      isso desde a última gravação. Necessário porque o GPS de celular tem
//      erro de 5-15m mesmo parado (ver CLAUDE.md, "Pontos de atenção") — sem
//      esse filtro, alguém parado geraria gravações constantes só por causa
//      do tremor (jitter) do sinal.
//   3. HEARTBEAT_MS — mesmo que a pessoa fique parada (sem passar no filtro
//      de distância), força uma gravação a cada N segundos. Sem isso, o
//      "atualizado às" de alguém parado ficaria congelado, e não daria pra
//      distinguir "está parado" de "perdeu conexão".
//
// O upsert só acontece quando (1) permite E ((2) ou (3) for verdade).
const INTERVALO_MINIMO_MS = 5_000;   // 5s → no máximo 12 gravações/minuto por usuário
const DISTANCIA_MINIMA_M  = 10;      // abaixo disso, é ruído do GPS, não movimento real
const HEARTBEAT_MS        = 30_000;  // 30s sem gravar → grava mesmo parado, como "sinal de vida"
const SEM_SINAL_MS        = 20_000;  // 20s sem NENHUMA leitura (nem descartada) → avisa na tela

// Estado do módulo (só existe um "próprio avatar" por página carregada).
let marcadorProprio  = null;
let watchId          = null;
let ultimaPosGravada = null; // { lat, lon } da última gravação aceita no banco
let ultimoEnvioEm    = 0;    // Date.now() da última gravação aceita
let ultimaLeituraEm  = 0;    // Date.now() da última leitura do GPS, aceita ou não
let vigiaSinalId      = null;

// Etapa 6a: contexto guardado no início para o watch poder ser religado
// quando o instrutor reabilitar a permissão no meio da sessão.
let contexto = null;
let jaCentralizou = false;   // o mapa só se centraliza na PRIMEIRA leitura da sessão

// Etapa 9b: o que está DESENHADO no popup agora — { lat, lon, accuracy,
// timestamp }. Guardado à parte de `ultimaPosGravada` (que é sobre o
// throttle de gravação, não sobre o que está na tela) para o popup poder ser
// remontado quando o formato de coordenada mudar, sem esperar leitura nova.
let ultimaPosicaoDesenhada = null;

// Onde EU estou agora, para quem precisar medir alguma coisa a partir daqui —
// hoje só o vetor de observação até uma marcação (visada.js, consumido por
// marcacoes.js). Devolve { lat, lon } ou `null`.
//
// Lê `ultimaPosicaoDesenhada`, e não uma variável nova, de propósito: assim a
// posição só é oferecida quando o avatar próprio está de fato sendo
// desenhado. Se o instrutor desligar `ver_propria_posicao`, isto passa a
// devolver null e o vetor simplesmente some do popup — em vez de o app
// continuar publicando a própria posição por uma porta lateral que a
// permissão não cobre.
export function minhaPosicao() {
  if (!ultimaPosicaoDesenhada) return null;
  return { lat: ultimaPosicaoDesenhada.lat, lon: ultimaPosicaoDesenhada.lon };
}

function popupProprio(perfil, pos) {
  return (
    `<b>${perfil.nome_guerra || 'Você'}</b><br>` +
    `${formatarCoordenada(pos.lat, pos.lon)}<br>` +
    `Precisão: ±${Math.round(pos.accuracy)}m<br>` +
    `Atualizado: ${new Date(pos.timestamp).toLocaleTimeString('pt-BR')}`
  );
}

// Atalhos de leitura: o valor mora em permissoes.js (fonte única), aqui só
// se pergunta. Ver o comentário de observarPermissao() lá sobre por que NÃO
// guardar uma cópia local.
const podeEnviar    = () => pode('enviar_posicao_gps');
const podeVerAvatar = () => pode('ver_propria_posicao');

// Distância em metros entre dois pontos lat/lon (fórmula de Haversine — trata
// a Terra como uma esfera; erro desprezível para escala de exercício de campo).
function distanciaMetros(a, b) {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function deveGravar(novaPos) {
  const agora = Date.now();
  if (agora - ultimoEnvioEm < INTERVALO_MINIMO_MS) return false; // regra 1: teto de frequência
  if (!ultimaPosGravada) return true;                            // primeira leitura: sempre grava
  if (distanciaMetros(ultimaPosGravada, novaPos) >= DISTANCIA_MINIMA_M) return true; // regra 2
  if (agora - ultimoEnvioEm >= HEARTBEAT_MS) return true;        // regra 3: sinal de vida
  return false;
}

// ── UI: status do GPS ────────────────────────────────────────────────────
// Escreve no elemento #gps-status (adicionado à topbar de index.html) para
// dar feedback em PT-BR, legível por quem não é técnico.
function status(texto, cor) {
  const el = document.getElementById('gps-status');
  if (!el) return;
  el.textContent = `GPS: ${texto}`;
  el.style.color = cor || '#7a9ab8';
}

// ── Ícone (símbolo NATO via milsymbol) ───────────────────────────────────
// O SIDC já vem pronto de perfis.sidc (schema da Etapa 1, default "amigo +
// unidade") — este módulo NÃO monta o código na mão, diferente do getSIDC()
// usado no painel COP legado dentro de index.html (que monta a partir de
// planilha). Desenho do ícone em si é criarIconeSimbolo(), compartilhado com
// colegas.js e marcacoes.js desde a Etapa 5 (ver frontend/icones.js).
// partidoObservador/partidoElemento ficam de fora de propósito: o próprio
// avatar não tem hostilidade relativa a resolver (a pessoa é sempre "amigo"
// de si mesma), então o SIDC gravado passa intacto.
function criarIconeProprio(sidc, nomeGuerra) {
  return criarIconeSimbolo(sidc, {
    tamanho: 30,
    designacao: nomeGuerra,
    corFallback: '#4a90d9',
    tamanhoFallback: 22,
  });
}

// ── Vigia de perda de sinal ───────────────────────────────────────────────
// Não existe um evento de "perdi o sinal de GPS": se o sinal cair no meio da
// sessão (ex.: entrou num prédio), o navegador simplesmente PARA de chamar o
// callback de sucesso, em silêncio — nenhum erro é disparado. Por isso
// checamos periodicamente há quanto tempo não chega leitura nenhuma (aceita
// ou não) e avisamos na tela se passar muito tempo.
function iniciarVigiaSinal() {
  if (vigiaSinalId) return;
  vigiaSinalId = setInterval(() => {
    if (!ultimaLeituraEm) return;
    const semSinalHa = Date.now() - ultimaLeituraEm;
    if (semSinalHa >= SEM_SINAL_MS) {
      status(`sem sinal há ${Math.round(semSinalHa / 1000)}s`, '#f5c842');
    }
  }, 5_000);
}

// ── Ponto de entrada ──────────────────────────────────────────────────────
// map: instância do Leaflet já criada em index.html, passada explicitamente
// como parâmetro (em vez deste módulo depender de achar uma variável global
// `map`) — mais fácil de entender e de manter se index.html virar SPA com
// bundler na Etapa 9, quando esse tipo de dependência implícita de escopo
// global deixaria de funcionar.
// userId: session.user.id (UUID do Supabase Auth — é o MESMO id de perfis.id).
// perfil: objeto devolvido por buscarPerfil() em auth.js (papel, nome_guerra,
// turma_id, sidc, turma).
export function iniciarRastreamentoProprio({ map, userId, perfil }) {
  if (!('geolocation' in navigator)) {
    status('não suportado neste navegador', '#e05252');
    return;
  }

  if (!perfil.turma_id) {
    // Sem turma, a policy de RLS de posicoes_atuais rejeitaria a gravação
    // mesmo assim (e não faz sentido aparecer num mapa sem turma) — melhor
    // nem chamar watchPosition e pedir a permissão do navegador à toa.
    status('aguardando você entrar em uma turma', '#f5c842');
    return;
  }

  contexto = { map, userId, perfil };

  // Cada observador é chamado NA HORA com o valor atual (então isto também
  // faz o papel do "start" original) e de novo a cada mudança feita pelo
  // instrutor — daí a reação em tempo real sem recarregar a página.
  observarPermissao('enviar_posicao_gps', () => avaliarRastreamento());
  observarPermissao('ver_propria_posicao', (habilitada) => {
    if (!habilitada) removerMarcadorProprio(); // a próxima leitura redesenha, se voltar
    avaliarRastreamento();
  });

  // Etapa 9b: trocar UTM/decimal/DMS tem efeito imediato aqui também. Sem
  // isto, quem estivesse parado (sem leitura nova por até 30s, ou nenhuma se
  // o sinal caiu) veria o formato antigo continuar no popup e concluiria que
  // o seletor não funciona.
  observarFormatoCoordenada(() => {
    if (!marcadorProprio || !ultimaPosicaoDesenhada) return;
    marcadorProprio.bindPopup(popupProprio(perfil, ultimaPosicaoDesenhada));
  });

  window.addEventListener('beforeunload', pararWatch);
}

// Liga/desliga o watchPosition conforme sobrou (ou não) motivo para ele
// existir, e escreve na topbar por que o GPS está no estado em que está.
function avaliarRastreamento() {
  if (!contexto) return;

  if (!podeEnviar() && !podeVerAvatar()) {
    pararWatch();
    status('desabilitado pelo instrutor', '#f5c842');
    return;
  }

  ligarWatch();

  if (!podeEnviar()) {
    status('envio ao servidor desabilitado pelo instrutor', '#f5c842');
  } else if (!podeVerAvatar()) {
    status('enviando (seu avatar está oculto pelo instrutor)', '#f5c842');
  } else if (ultimaLeituraEm) {
    // Voltou a ser tudo permitido com o watch já rodando: limpa o aviso
    // anterior na hora, em vez de deixar "desabilitado pelo instrutor" na
    // tela até a próxima leitura do GPS chegar (pode demorar segundos).
    status('ativo', '#7af57a');
  }
}

function ligarWatch() {
  if (watchId !== null) return; // já ligado
  status('solicitando permissão…');
  watchId = navigator.geolocation.watchPosition(
    (posicao) => aoReceberPosicao(posicao, contexto),
    aoErrar,
    WATCH_OPTIONS
  );
  iniciarVigiaSinal();
}

function pararWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (vigiaSinalId) {
    clearInterval(vigiaSinalId);
    vigiaSinalId = null;
  }
  // Zera o throttling: quando o rastreamento voltar, a primeira leitura deve
  // ser gravada na hora, sem esperar o intervalo mínimo contado a partir de
  // uma gravação que aconteceu antes da pausa.
  ultimaPosGravada = null;
  ultimoEnvioEm = 0;
  ultimaLeituraEm = 0;
}

function removerMarcadorProprio() {
  if (!marcadorProprio || !contexto) return;
  contexto.map.removeLayer(marcadorProprio);
  marcadorProprio = null;
}

function aoReceberPosicao(posicao, { map, userId, perfil }) {
  ultimaLeituraEm = Date.now();
  const { latitude, longitude, altitude, accuracy, heading, speed } = posicao.coords;
  const novaPos = { lat: latitude, lon: longitude };

  // Marcador local: atualiza a CADA leitura, sem throttle — é só desenho no
  // navegador (não custa rede, não grava nada), então dá feedback visual
  // imediato mesmo em leituras que não vão gerar upsert.
  // Etapa 6a: só desenha se `ver_propria_posicao` estiver habilitada.
  if (podeVerAvatar()) {
    if (!marcadorProprio) {
      marcadorProprio = L.marker([latitude, longitude], {
        icon: criarIconeProprio(perfil.sidc, perfil.nome_guerra),
        zIndexOffset: 1000, // fica por cima dos ícones do painel COP legado
      }).addTo(map);
      if (!jaCentralizou) {
        map.setView([latitude, longitude], 16); // centraliza no próprio avatar só na primeira vez
        jaCentralizou = true;
      }
    } else {
      marcadorProprio.setLatLng([latitude, longitude]);
    }
    // Etapa 9b: a coordenada entrou no popup. `ultimaPosicaoDesenhada` guarda
    // o que está na tela para o observador de formato (lá embaixo) conseguir
    // remontar o popup quando o usuário trocar de UTM para grau decimal sem
    // esperar a próxima leitura do GPS — que pode demorar 30s (heartbeat) ou
    // não vir nunca, se a pessoa estiver parada dentro de um prédio.
    ultimaPosicaoDesenhada = { lat: latitude, lon: longitude, accuracy, timestamp: posicao.timestamp };
    marcadorProprio.bindPopup(popupProprio(perfil, ultimaPosicaoDesenhada));
  }

  if (podeEnviar() && podeVerAvatar()) {
    status(`ativo (precisão ±${Math.round(accuracy)}m)`, '#7af57a');
  } else if (podeEnviar()) {
    status(`enviando, avatar oculto pelo instrutor (±${Math.round(accuracy)}m)`, '#f5c842');
  } else {
    status(`envio desabilitado pelo instrutor (±${Math.round(accuracy)}m)`, '#f5c842');
  }

  // Gravação no backend: só quando a permissão permite E o throttle (regras
  // 1-3 acima) libera. A ordem importa — com o envio desligado, nem contamos
  // a leitura como "gravação que aconteceu".
  if (!podeEnviar()) return;
  if (!deveGravar(novaPos)) return;
  ultimaPosGravada = novaPos;
  ultimoEnvioEm = Date.now();

  gravarPosicao({
    userId, turmaId: perfil.turma_id,
    latitude, longitude, altitude, accuracy, heading, speed,
    timestamp: posicao.timestamp,
  });
}

// "upsert" = grava se a linha não existir, atualiza se já existir — aqui pela
// chave primária `usuario_id` de posicoes_atuais (uma linha por usuário).
// Escrevemos SÓ nesta tabela: um trigger no banco copia sozinho para
// posicoes_historico (ver CLAUDE.md / backend/README.md) — nenhuma lógica de
// duplicação de histórico deve entrar no frontend.
async function gravarPosicao({ userId, turmaId, latitude, longitude, altitude, accuracy, heading, speed, timestamp }) {
  const { error } = await supabase.from('posicoes_atuais').upsert(
    {
      usuario_id: userId,
      turma_id: turmaId,
      latitude,
      longitude,
      altitude_m: altitude,
      precisao_m: accuracy,
      // heading/speed podem vir `null` (sem suporte) ou `NaN` (parado, pela
      // spec do W3C) — em ambos os casos o JSON enviado ao Supabase vira
      // `null` (JSON não tem NaN), o que já é aceito pelo `check` da tabela.
      rumo_graus: heading,
      velocidade_ms: speed,
      medido_em: new Date(timestamp).toISOString(),
    },
    { onConflict: 'usuario_id' }
  );
  if (error) {
    console.warn('Falha ao gravar posição GPS:', error);
    status(`erro ao enviar posição (${traduzirErro(error)})`, '#e05252');
  }
}

// ── Erros de geolocalização, traduzidos para PT-BR simples ───────────────
function aoErrar(erro) {
  let msg;
  switch (erro.code) {
    case erro.PERMISSION_DENIED:
      msg = 'permissão negada — permita o acesso à localização nas configurações do navegador e recarregue a página';
      break;
    case erro.POSITION_UNAVAILABLE:
      msg = 'localização indisponível agora (sinal fraco ou ambiente fechado) — tentando de novo…';
      break;
    case erro.TIMEOUT:
      msg = 'demorou demais para responder — tentando de novo…';
      break;
    default:
      msg = `erro desconhecido (${erro.message})`;
  }
  status(msg, '#e05252');
  console.warn('Erro de geolocalização:', erro);
}
