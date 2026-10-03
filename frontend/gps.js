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
import { opcoesDeDesignacao, nomeDaFracao, escaparTexto } from './designacao.js';
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
// `rotuloIdade()` é o MESMO rótulo que o instrutor vê ao lado do avatar de
// quem parou de reportar ("12m", "1h35") — ver a retomada em segundo plano,
// logo abaixo. Usar a função de lá, e não um formatador próprio, é o que
// garante que o aluno leia a lacuna com as mesmas palavras e o mesmo limiar
// com que ela apareceu na tela de quem estava acompanhando.
import { rotuloIdade } from './vigia-ausencia.js';
// Fonte de posição (2026-10-02): o que é uma "leitura", a linha que vai para o
// banco e a DECISÃO de gravar saíram daqui para um módulo puro, com teste.
// Este arquivo continua dono do que depende do navegador: o watchPosition, o
// marcador no mapa e a gravação no Supabase. A razão da extração é que a
// posição passou a poder vir de mais de um lugar (GPS, toque no mapa e, no
// futuro, simulador) e o resto do pipeline não deve saber de qual.
import {
  leituraDeGeolocation, leituraManual, paraLinhaPosicao, decidirGravacao,
  usaGps, aceitaPosicaoManual, posicaoVemDeFora,
} from './fonte-posicao.js';
// Modo de posição da turma (2026-10-02, migration 0016): de onde vem a posição
// própria neste exercício — GPS, toque no mapa (simulação) ou simulador. Ver o
// cabeçalho de modo-posicao.js.
import {
  iniciarModoPosicao, observarModoPosicao, origemSuportada, reler as relerModoPosicao,
} from './modo-posicao.js';

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
// Os três limiares (INTERVALO_MINIMO_MS = 5 s, DISTANCIA_MINIMA_M = 10 m,
// HEARTBEAT_MS = 30 s) moram em fonte-posicao.js, junto de `decidirGravacao()`,
// que é a função que os usa. Os valores não mudaram; as razões estão acima.
const SEM_SINAL_MS        = 20_000;  // 20s sem NENHUMA leitura (nem descartada) → avisa na tela

// Estado do módulo (só existe um "próprio avatar" por página carregada).
let marcadorProprio  = null;
let watchId          = null;
let ultimaPosGravada = null; // { lat, lon } da última gravação aceita no banco
let ultimoEnvioEm    = 0;    // Date.now() da última gravação aceita
let ultimaLeituraEm  = 0;    // Date.now() da última leitura do GPS, aceita ou não
let vigiaSinalId      = null;
// Retomada depois de a página ser CONGELADA pelo sistema (ver o bloco grande
// mais abaixo). `forcarProximoEnvio` faz a próxima leitura furar o throttling;
// `lacunaRetomada` é o rótulo da lacuna, mostrado até a gravação acontecer.
let forcarProximoEnvio = false;
let lacunaRetomada = '';
let ouvindoRetomada = false;

// Modo de posição da turma. O valor de verdade mora em modo-posicao.js; esta é a
// cópia de que as funções DESTE módulo precisam para decidir "ligo o GPS?" sem
// importar o estado a cada linha — atualizada por `aoMudarModo()`, que é o único
// escritor. Antes de o modo ser lido, vale 'gps': o comportamento de sempre.
let modoAtual = 'gps';
let temGeolocation = true;   // o navegador tem a API (só importa no modo gps)

// Etapa 6a: contexto guardado no início para o watch poder ser religado
// quando o instrutor reabilitar a permissão no meio da sessão.
let contexto = null;
let jaCentralizou = false;   // o mapa só se centraliza na PRIMEIRA leitura da sessão

// Quem pergunta: colegas.js (2026-09-15). O mapa do aluno abre na posição
// DELE, e isso continua valendo — mas quando o GPS não fixa, ou o instrutor
// desligou `ver_propria_posicao`, ninguém centralizava nada e o mapa ficava no
// ponto padrão mesmo com os colegas desenhados na tela. Nesse caso colegas.js
// enquadra a força; esta função é como ele sabe que a vez é dele, sem precisar
// adivinhar o estado do GPS.
export function jaCentralizouNoProprio() {
  return jaCentralizou;
}

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
// `medidoEm` (2026-09-15) é acréscimo ADITIVO: quem já usava só lat/lon
// (marcacoes.js, para o vetor de observação) não muda. Ele existe para o
// pedido de apoio poder dizer DE QUANDO é a coordenada que está mandando —
// uma posição de oito minutos atrás apresentada como atual manda gente
// procurar pessoa no lugar errado. Ver descreverPosicaoDoPedido() em
// situacao-usuario.js.
export function minhaPosicao() {
  if (!ultimaPosicaoDesenhada) return null;
  return {
    lat: ultimaPosicaoDesenhada.lat,
    lon: ultimaPosicaoDesenhada.lon,
    medidoEm: ultimaPosicaoDesenhada.timestamp
      ? new Date(ultimaPosicaoDesenhada.timestamp).toISOString()
      : null,
  };
}

// ── Posição manual (simulação) ────────────────────────────────────────────
// Posiciona o posto do aluno em (lat, lon): é a única entrada da fonte
// 'manual', chamada pelo menu de toque longo e pelo arrasto do símbolo. Entra
// no MESMO pipeline do GPS (desenho, gravação), só que com origem 'manual'.
// Devolve `false` quando não se aplica (modo da turma não é manual, ou a
// coordenada é inválida).
export function posicionarMeuPosto(lat, lon) {
  if (!contexto || !aceitaPosicaoManual(modoAtual)) return false;
  const leitura = leituraManual(lat, lon);
  if (!leitura) return false;
  aoReceberLeitura(leitura, contexto);
  return true;
}

// O que o menu de toque longo pergunta ao abrir: "há uma linha de
// posicionamento para mostrar?". `null` = não se aplica (turma em modo GPS ou
// do simulador) — a linha nem aparece, porque ali ela não faltou, ela não
// existe. Em modo manual devolve o gancho; com o envio desabilitado pelo
// instrutor a linha aparece e diz por quê, em vez de sumir (lacuna declarada).
export function obterPosicionamentoManual() {
  if (!contexto || !aceitaPosicaoManual(modoAtual)) return null;
  const permitido = podeEnviar();
  return {
    desabilitado: !permitido,
    motivo: permitido ? '' : 'envio de posição desabilitado pelo instrutor',
    aoPosicionar: (latlng) => posicionarMeuPosto(latlng.lat, latlng.lng),
  };
}

function aoArrastarMeuPosto() {
  if (!marcadorProprio) return;
  const { lat, lng } = marcadorProprio.getLatLng();
  posicionarMeuPosto(lat, lng);
}

function popupProprio(perfil, pos) {
  return (
    `<b>${perfil.nome_guerra || 'Você'}</b><br>` +
    (nomeDaFracao(perfil) ? `${escaparTexto(nomeDaFracao(perfil))}<br>` : '') +
    `${formatarCoordenada(pos.lat, pos.lon)}<br>` +
    // Posição manual não tem precisão medida: dizer "±0m" seria afirmar o que ninguém mediu.
    (pos.origem === 'manual'
      ? 'Posição manual (simulação)<br>'
      : `Precisão: ±${Math.round(pos.accuracy)}m<br>`) +
    `Atualizado: ${new Date(pos.timestamp).toLocaleTimeString('pt-BR')}`
  );
}

// Atalhos de leitura: o valor mora em permissoes.js (fonte única), aqui só
// se pergunta. Ver o comentário de observarPermissao() lá sobre por que NÃO
// guardar uma cópia local.
const podeEnviar    = () => pode('enviar_posicao_gps');
const podeVerAvatar = () => pode('ver_propria_posicao');

// A distância (Haversine) e a decisão de gravar — as três regras do throttling,
// mais a retomada — moraram aqui até 2026-10-02. Agora são puras, em
// fonte-posicao.js, onde têm teste; esta função só fornece o estado do módulo.
function deveGravar(posicao) {
  return decidirGravacao({
    agora: Date.now(),
    ultimoEnvioEm,
    ultimaPosGravada,
    posicao,
    // Retomada: fura as três regras. O motivo está no bloco "Retomada depois do
    // congelamento do sistema", mais abaixo.
    forcar: forcarProximoEnvio,
  });
}

// ── UI: status do GPS ────────────────────────────────────────────────────
// Escreve no elemento #gps-status (adicionado à topbar de index.html) para
// dar feedback em PT-BR, legível por quem não é técnico.
function status(texto, cor) {
  const el = document.getElementById('gps-status');
  if (!el) return;
  el.textContent = `${usaGps(modoAtual) ? 'GPS' : 'Posição'}: ${texto}`;
  el.style.color = cor || '#7a9ab8';
}

// ── Ícone (símbolo NATO via milsymbol) ───────────────────────────────────
// O SIDC já vem pronto de perfis.sidc (schema da Etapa 1, default "amigo +
// unidade") — este módulo NÃO monta o código na mão. (Até a Etapa 11 havia um
// contraste a fazer aqui: index.html montava o SIDC com getSIDC() a partir da
// planilha do COP de junho. Aquele caminho não existe mais; getSIDC()
// continua em simbolos.js, hoje usado só pelo formulário de marcação.)
// Desenho do ícone em si é criarIconeSimbolo(), compartilhado com
// colegas.js e marcacoes.js desde a Etapa 5 (ver frontend/icones.js).
// partidoObservador/partidoElemento ficam de fora de propósito: o próprio
// avatar não tem hostilidade relativa a resolver (a pessoa é sempre "amigo"
// de si mesma), então o SIDC gravado passa intacto.
function criarIconeProprio(perfil) {
  return criarIconeSimbolo(perfil.sidc, {
    tamanho: 30,
    ...opcoesDeDesignacao(perfil),
    corFallback: '#4a90d9',
    tamanhoFallback: 22,
  });
}

// O instrutor corrigiu o meu símbolo (2026-09-14).
//
// Chamado por perfil-ao-vivo.js quando `perfis.sidc` muda por baixo da
// sessão. Redesenhar em vez de recarregar: o símbolo não muda quem eu vejo
// nem a hostilidade de nada na tela — recarregar a página de alguém em campo
// para trocar um ícone seria perder rastreamento e contexto por nada.
//
// `perfil` é o objeto que esta sessão inteira usa para desenhar; atualizá-lo
// é o que faz a próxima leitura de GPS (e o popup) já nascerem com o símbolo
// novo, em vez de voltar ao antigo no primeiro movimento.
export function atualizarMeuSimbolo(sidc) {
  const perfil = contexto?.perfil;
  if (!perfil || typeof sidc !== 'string' || !/^[0-9]{20}$/.test(sidc)) return;
  if (perfil.sidc === sidc) return;
  perfil.sidc = sidc;
  if (marcadorProprio) {
    marcadorProprio.setIcon(criarIconeProprio(perfil));
  }
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

// ── Retomada depois do congelamento do sistema (2026-09-14) ───────────────
//
// Pergunta de campo: *"tem como o app ficar ativo em segundo plano? Ou sempre
// que apagar a tela do celular perderei a atualização da posição?"*
//
// **Perde, e não há como não perder na web.** Com a tela apagada ou o app em
// segundo plano, o sistema CONGELA a página: os temporizadores param, os
// callbacks de `fetch` não executam e o `watchPosition` deixa de entregar
// leitura. Não é defeito deste módulo — é o ciclo de vida de página
// (`hidden` -> `frozen`), e no iOS acontece quase imediatamente. Geolocalização
// em segundo plano foi proposta ao Chromium em 2016 e NUNCA foi implementada;
// não existe API para ligar. Rastrear com o celular no bolso exige embrulhar
// o app em nativo (serviço de primeiro plano no Android,
// `allowsBackgroundLocationUpdates` no iOS) — outro projeto.
//
// Wake Lock (manter a tela acesa) foi considerado e RECUSADO por quem usa, com
// razão: o preço é bateria, que num exercício de várias horas sem carregador é
// caro demais para resolver só metade do problema (ele é liberado assim que a
// página deixa de estar visível, então não cobre o celular no bolso de
// qualquer forma).
//
// O que dá para fazer, e é o que está aqui: **não fingir que o buraco não
// existiu**. Ao despertar, duas coisas —
//
//   1. **Grava na hora**, furando o throttling, em vez de esperar até 30s pelo
//      próximo heartbeat. O mapa de quem acompanha volta a estar certo assim
//      que o aparelho volta, não meio minuto depois.
//   2. **Diz quanto tempo ficou sem enviar**, na linha de status, com o MESMO
//      rótulo e o MESMO limiar que o instrutor viu no avatar (`rotuloIdade`,
//      de vigia-ausencia.js). Abaixo desse limiar não há o que relatar: o
//      rótulo devolve '' e ninguém do outro lado chegou a ver lacuna nenhuma.
//
// É a mesma postura do resto do projeto: a Etapa 6b avisa quantas leituras
// cada ponto do replay representa, a Etapa 7 avisa quando simplificou uma
// geometria, e desde a etiqueta de idade o avatar parado não some — ele fica
// na última posição conhecida dizendo há quanto tempo. Uma lacuna declarada é
// informação; uma lacuna silenciosa é uma afirmação errada.
function aoDespertar() {
  // `ultimoEnvioEm` é 0 antes da primeira gravação da sessão — aí não há
  // lacuna, há um começo, e quem cuida disso é a carga normal.
  if (!ultimoEnvioEm) return;

  const lacuna = rotuloIdade(Date.now() - ultimoEnvioEm);
  if (!lacuna) return; // curta demais para alguém ter visto: nada a dizer

  forcarProximoEnvio = true;
  lacunaRetomada = lacuna;
  status(`retomando — ${lacuna} sem enviar`, '#f5c842');

  // O vigia de sinal mede "há quanto tempo não chega LEITURA". Congelado, ele
  // também ficou parado, e sem zerar aqui ele acusaria "sem sinal há 600s" no
  // primeiro ciclo depois de despertar — o que é verdade sobre o relógio e
  // mentira sobre o GPS: não houve perda de sinal, houve um aparelho dormindo.
  // A lacuna real está sendo dita pela linha acima, com o nome certo.
  ultimaLeituraEm = Date.now();
}

function ouvirRetomada() {
  if (ouvindoRetomada || typeof document === 'undefined') return;
  ouvindoRetomada = true;
  // `visibilitychange` cobre o caso comum (tela reacesa, app de volta ao
  // primeiro plano). `pageshow` com `persisted` cobre a volta pelo cache de
  // navegação do histórico, que não dispara o primeiro.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') aoDespertar();
  });
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) aoDespertar(); });
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
  if (!perfil.turma_id) {
    // Sem turma, a policy de RLS de posicoes_atuais rejeitaria a gravação
    // mesmo assim (e não faz sentido aparecer num mapa sem turma) — melhor
    // nem chamar watchPosition e pedir a permissão do navegador à toa.
    status('aguardando você entrar em uma turma', '#f5c842');
    return;
  }

  // Sem a API de geolocalização o app ainda serve para simulação (modo
  // manual), então a ausência dela deixou de ser um `return` aqui no começo:
  // vira a mensagem de `avaliarRastreamento()`, só quando o modo é GPS.
  temGeolocation = 'geolocation' in navigator;

  contexto = { map, userId, perfil };

  window.addEventListener('beforeunload', pararWatch);

  // O modo da turma é lido ANTES de qualquer observador poder ligar o watch.
  // Sem isso, um aluno de turma em simulação pediria a permissão de
  // localização à toa e tentaria gravar uma posição de GPS que a policy do
  // banco ia recusar. A espera é curta e tem teto (ver modo-posicao.js); se o
  // Supabase estiver lento o app segue como 'gps' e se corrige quando a
  // resposta chegar.
  //
  // Falha aqui NUNCA pode matar o GPS: o rastreamento existia antes desta
  // camada e tem que continuar funcionando se ela quebrar.
  Promise.resolve()
    .then(() => iniciarModoPosicao({ turmaId: perfil.turma_id }))
    .catch((e) => console.warn('Modo de posição indisponível; seguindo como GPS:', e))
    .then(ligarObservadores);
}

function ligarObservadores() {
  const { perfil } = contexto;

  // O do modo vem PRIMEIRO: os de permissão logo abaixo chamam
  // avaliarRastreamento() na hora, e ele precisa já saber de que modo se trata.
  observarModoPosicao(aoMudarModo);

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
}

// O instrutor trocou o modo da turma (ou o modo acabou de ser lido).
//
// O que estava no mapa era do modo ANTERIOR: a última posição do GPS não é onde
// o aluno "está" na simulação, e a última posição manual não é onde ele está de
// verdade. Mantê-la desenhada seria deixar uma posição de um jeito de medir
// passar por posição do outro — exatamente o que a coluna `origem` existe para
// evitar. O marcador some e o próximo posicionamento (ou a próxima leitura do
// GPS) o redesenha.
function aoMudarModo({ modo }) {
  if (modo === modoAtual) return;
  modoAtual = modo;
  removerMarcadorProprio();
  ultimaPosicaoDesenhada = null;
  ultimaPosGravada = null;
  ultimoEnvioEm = 0;
  avaliarRastreamento();
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

  // Simulação (modo manual ou externa): o GPS do aparelho NÃO é a fonte da
  // posição, então o watch não liga — nem pede permissão de localização, nem
  // gasta bateria. A posição vem de um toque no mapa (manual) ou de um serviço
  // no servidor (externa); nos dois casos o que decide o que o aluno pode
  // gravar é a policy do banco, e isto aqui só faz a tela concordar.
  if (!usaGps(modoAtual)) {
    pararWatch();
    if (posicaoVemDeFora(modoAtual)) {
      status('posição fornecida pelo simulador', '#f5c842');
    } else if (!podeEnviar()) {
      status('envio ao servidor desabilitado pelo instrutor', '#f5c842');
    } else if (!podeVerAvatar()) {
      status('simulação — seu avatar está oculto pelo instrutor', '#f5c842');
    } else if (!ultimaPosicaoDesenhada) {
      status('simulação — toque longo no mapa e escolha "Posicionar-me aqui"', '#f5c842');
    } else {
      status('simulação — posição manual', '#7af57a');
    }
    return;
  }

  if (!temGeolocation) {
    status('não suportado neste navegador', '#e05252');
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
  // Registrado uma vez só (o próprio ouvirRetomada() se protege): os
  // ouvintes são de `document`/`window`, não do watch, e removê-los e
  // recolocá-los a cada liga/desliga de permissão só criaria a chance de
  // sobrar um duplicado.
  ouvirRetomada();
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
  // Uma retomada pendente também: sem rastreamento não há lacuna de envio a
  // relatar, e deixar o sinalizador ligado faria a PRIMEIRA leitura depois de
  // religar mostrar uma recuperação que não aconteceu.
  forcarProximoEnvio = false;
  lacunaRetomada = '';
}

function removerMarcadorProprio() {
  if (!marcadorProprio || !contexto) return;
  contexto.map.removeLayer(marcadorProprio);
  marcadorProprio = null;
}

// Adaptador da fonte GPS: o navegador entrega um GeolocationPosition; o resto
// do pipeline (desenho, throttling, gravação) trabalha com uma Leitura, que é
// o que qualquer outra fonte também entregaria.
function aoReceberPosicao(posicao, ctx) {
  // Uma leitura que já estava a caminho quando o instrutor tirou a turma do
  // modo GPS não pode virar posição: o watch foi desligado, mas o callback
  // pendente ainda chega.
  if (!usaGps(modoAtual)) return;
  // Marca que CHEGOU leitura antes de qualquer outra coisa: o vigia de sinal
  // mede "há quanto tempo nada chega", e uma leitura sem fixação utilizável
  // também prova que o aparelho está respondendo.
  ultimaLeituraEm = Date.now();
  const leitura = leituraDeGeolocation(posicao);
  if (!leitura) return;
  aoReceberLeitura(leitura, ctx);
}

function aoReceberLeitura(leitura, { map, userId, perfil }) {
  const { lat: latitude, lon: longitude, precisao: accuracy } = leitura;
  const novaPos = { lat: latitude, lon: longitude };

  // Marcador local: atualiza a CADA leitura, sem throttle — é só desenho no
  // navegador (não custa rede, não grava nada), então dá feedback visual
  // imediato mesmo em leituras que não vão gerar upsert.
  // Etapa 6a: só desenha se `ver_propria_posicao` estiver habilitada.
  if (podeVerAvatar()) {
    if (!marcadorProprio) {
      marcadorProprio = L.marker([latitude, longitude], {
        icon: criarIconeProprio(perfil),
        zIndexOffset: 1000, // o próprio avatar fica por cima de todo o resto
        // Em simulação o aluno ARRASTA o próprio posto até onde ele está. Fora
        // dela o marcador não se mexe: o GPS é quem manda, e um símbolo que se
        // deixa arrastar por engano seria posição falsa em exercício real.
        draggable: aceitaPosicaoManual(modoAtual),
      }).addTo(map);
      marcadorProprio.on('dragend', aoArrastarMeuPosto);
      if (!jaCentralizou) {
        // Posição manual NÃO move o mapa: quem posiciona já está olhando para o
        // lugar, e um zoom 16 de repente é perder a visão que ele montou.
        if (leitura.origem !== 'manual') map.setView([latitude, longitude], 16); // centraliza no próprio avatar só na primeira vez
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
    ultimaPosicaoDesenhada = {
      lat: latitude, lon: longitude, accuracy, timestamp: leitura.instante, origem: leitura.origem,
    };
    marcadorProprio.bindPopup(popupProprio(perfil, ultimaPosicaoDesenhada));
  }

  if (leitura.origem === 'manual') {
    // Sem precisão medida para mostrar: o texto diz o que a posição É.
    if (podeEnviar() && podeVerAvatar()) status('simulação — posição manual', '#7af57a');
    else if (podeEnviar()) status('simulação — enviando, avatar oculto pelo instrutor', '#f5c842');
    else status('simulação — envio desabilitado pelo instrutor', '#f5c842');
  } else if (podeEnviar() && podeVerAvatar()) {
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
  // O throttling existe para conter o fluxo CONTÍNUO do GPS (jitter, várias
  // leituras por segundo). Posição manual é um gesto único e deliberado — o
  // aluno tocou ali ou soltou o símbolo ali — e filtrá-la por "andou pouco"
  // faria o posicionamento parecer que não funcionou.
  if (leitura.origem !== 'manual' && !deveGravar(novaPos)) return;
  ultimaPosGravada = novaPos;
  ultimoEnvioEm = Date.now();

  // A retomada termina aqui, e não no momento em que a página voltou a ficar
  // visível: o que fecha a lacuna é a POSIÇÃO ter sido enviada, não o celular
  // ter acordado. Entre uma coisa e outra pode haver vários segundos de GPS
  // procurando sinal, e durante eles a linha de status continua, com razão,
  // dizendo que estamos retomando.
  if (forcarProximoEnvio) {
    forcarProximoEnvio = false;
    const quanto = lacunaRetomada;
    lacunaRetomada = '';
    status(`ativo — recuperado após ${quanto} sem enviar`, '#7af57a');
  }

  gravarPosicao(leitura, { userId, turmaId: perfil.turma_id });
}

// "upsert" = grava se a linha não existir, atualiza se já existir — aqui pela
// chave primária `usuario_id` de posicoes_atuais (uma linha por usuário).
// Escrevemos SÓ nesta tabela: um trigger no banco copia sozinho para
// posicoes_historico (ver CLAUDE.md / backend/README.md) — nenhuma lógica de
// duplicação de histórico deve entrar no frontend.
async function gravarPosicao(leitura, { userId, turmaId }) {
  // A montagem da linha (inclusive o que fazer com heading/speed `null` ou
  // `NaN`, que o GPS devolve parado) mora em fonte-posicao.js.
  const { error } = await supabase.from('posicoes_atuais').upsert(
    // `incluirOrigem` só liga depois de o modo da turma ter sido lido com
    // sucesso (prova de que a migration 0016 está no banco). Antes disso a
    // linha é idêntica à de antes dela. Ver paraLinhaPosicao().
    paraLinhaPosicao(leitura, { userId, turmaId, incluirOrigem: origemSuportada() }),
    { onConflict: 'usuario_id' }
  );
  if (error && error.code === '42501') {
    // Violação de RLS. Com a 0016 a causa provável é o modo da turma ter
    // mudado sem este aparelho saber (página congelada, sem rede): a policy
    // exige que a origem gravada seja a do modo atual. Reler o modo é o que
    // corrige, em vez de insistir numa gravação que vai continuar falhando.
    console.warn('Gravação de posição recusada pela RLS — relendo o modo da turma:', error);
    status('o modo de posição da turma mudou — reajustando…', '#f5c842');
    relerModoPosicao();
    return;
  }
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
