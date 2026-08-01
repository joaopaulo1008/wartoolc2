// debriefing.js — Etapa 6b do roadmap: histórico/replay de posições.
//
// Responsabilidade deste módulo: a TELA de debriefing dentro do painel do
// instrutor — escolher alunos e intervalo, buscar o rastro, desenhar as
// trilhas no mapa e andar no tempo reconstituindo onde cada um estava.
//
// A matemática (amostragem, perda de sinal, busca do ponto vigente,
// interpolação, distância) NÃO está aqui: mora em frontend/rastro.js, que não
// conhece DOM nem Leaflet e por isso é testável em Node
// (frontend/rastro.teste.mjs). Mesma separação de permissoes.js/
// instrutor-permissoes.js: um módulo para a regra, outro para a tela.
//
// O dado já existe desde a Etapa 3
// --------------------------------
// Ninguém escreve nada aqui. O cliente sempre gravou só em `posicoes_atuais`;
// o trigger `trg_arquivar_posicao` (0001) copia cada gravação para
// `posicoes_historico`, que é IMUTÁVEL pelo cliente por decisão da Etapa 1 —
// só tem policy de SELECT e só `grant select`. Ninguém reescreve o próprio
// rastro, nem o instrutor. Esta tela é 100% leitura.
//
// Quem enxerga o quê continua sendo a policy `historico_ler`, reescrita na
// 0003: o rastro próprio sempre; o rastro dos outros só para o instrutor da
// turma, e ainda assim limitado a `fn_usuarios_visiveis()`. Note que essa
// policy é MAIS restrita que a de `posicoes_atuais` de propósito (o comentário
// na 0003 explica): "vejo o histórico de todo mundo que eu enxergo" seria
// afrouxar a RLS de arrasto, e a permissão `ver_historico_rastro` é checada no
// cliente — cliente não é barreira de segurança.
//
// O problema desta etapa é VOLUME, não permissão
// ----------------------------------------------
// 60 alunos × heartbeat de 30s × horas de exercício chega perto de 170 mil
// linhas num exercício de 4 horas (a conta completa está no cabeçalho de
// backend/supabase/0005_rastro_historico.sql). Três defesas, em camadas:
//
//   1. JANELA DE TEMPO OBRIGATÓRIA. Não existe "buscar tudo" nesta tela. Sem
//      intervalo, o índice `idx_hist_usuario_tempo (usuario_id, medido_em
//      desc)` não serve para nada e a consulta vira varredura de tabela. A
//      consulta é montada exatamente no formato do índice: igualdade na lista
//      de alunos, faixa no tempo.
//   2. AMOSTRAGEM NO SERVIDOR. A RPC `fn_rastro_historico` (0005) devolve um
//      ponto por aluno por balde de N segundos, com N calculado a partir do
//      tamanho da janela e de quantos alunos foram escolhidos
//      (calcularIntervaloAmostragem em rastro.js). A redução acontece ANTES
//      da rede: 170 mil linhas viram ~7 mil pontos.
//   3. BUSCA EM LOTES DE ALUNOS. Mesmo amostrada, a resposta passa do
//      `max-rows` do PostgREST (1000 por padrão no Supabase). A saída óbvia
//      seria paginar por deslocamento — e é a errada aqui: o PostgREST
//      REEXECUTA a função inteira a cada página, então 12 páginas custariam 12
//      varreduras do mesmo intervalo. Como a resolução automática garante que
//      nenhum aluno sozinho passa de 1000 pontos (ALVO_PONTOS_POR_ALUNO em
//      rastro.js, com teste), a divisão é por ALUNO: cada requisição leva o
//      maior lote de alunos que ainda cabe numa página, e a soma das
//      requisições custa UMA varredura. A paginação por deslocamento sobra só
//      como rede de segurança, para quando o instrutor força uma resolução
//      fina à mão. A contagem exata (`count`) vem junto para a tela saber
//      quando parou porque acabou e quando parou porque bateu no teto — e
//      AVISAR, em vez de desenhar um rastro incompleto que parece completo.
//
// Por que não Realtime aqui
// -------------------------
// `posicoes_historico` não é publicada e não deve ser. Debriefing é uma
// consulta a um passado fechado: assinar mudança de uma tabela append-only que
// recebe 720 inserts por minuto durante o exercício seria a pior aplicação
// possível de Realtime no projeto. A tela busca quando o instrutor manda.

// Etapa 9a: `L` vinha de <script src=CDN> como global; agora é import de
// verdade (leaflet pinado em package.json na mesma versão que já se usava).
import * as L from 'leaflet';
import { supabase, buscarUsuariosDaTurma } from './auth.js';
// Símbolo NATO: SEMPRE por aqui. criarIconeSimbolo() resolve a hostilidade
// relativa (sidcParaObservador) e monta o L.divIcon via milsymbol, com
// fallback para SIDC inválido — é o mesmo caminho de gps.js, colegas.js e
// marcacoes.js desde a Etapa 5. Redefinir o desenho do símbolo aqui seria a
// quarta cópia que icones.js existe para impedir.
import { criarIconeSimbolo } from './icones.js';
import { criarBasemaps, preencherSeletorBasemap, BASEMAP_PADRAO, trocarBasemap } from './basemaps.js';
// Etapa 6b: `ver_historico_rastro` deixa de ser "sem efeito ainda". Hoje esta
// tela só existe para o instrutor (que recebe tudo habilitado pelo papel, via
// vw_permissoes_efetivas), então na prática a chave está sempre ligada aqui —
// o que o observador garante é que, no dia em que o rastro for exposto ao
// aluno, o interruptor já vale sem código novo.
import { observarPermissao } from './permissoes.js';
import {
  GAP_SEM_SINAL_MS,
  ALVO_PONTOS_TOTAL,
  PASSOS_SUGERIDOS,
  calcularIntervaloAmostragem,
  rotuloIntervalo,
  montarTrilhas,
  janelaDasTrilhas,
  segmentar,
  posicaoNoInstante,
  trechoAte,
  distanciaTrilhaM,
} from './rastro.js';

// ── Constantes de consulta ───────────────────────────────────────────────
// PAGINA casa com o `max-rows` padrão do Supabase (1000). Se o projeto
// aumentar esse limite, este número pode subir junto — não pode passar dele,
// senão cada página volta cortada.
const PAGINA = 1000;
// Teto de segurança do laço. Com LIMITE_SERVIDOR = 12000 nunca é atingido; ele
// existe para um erro futuro (limite servidor maior, contagem indisponível)
// não virar laço infinito de requisições.
const MAX_PAGINAS = 20;
// Repassado como p_limite para a RPC. A função também trunca do lado do
// servidor; comparar o total devolvido com este número é como a tela sabe que
// truncou.
const LIMITE_SERVIDOR = ALVO_PONTOS_TOTAL;
// Janela máxima aceita. Não é capricho: a policy `historico_ler` chama
// `fn_sou_instrutor_da_turma(turma_id)` com uma coluna DA LINHA, ou seja, de
// forma correlacionada — ela roda uma vez por linha BRUTA da janela, e a
// amostragem não reduz esse trabalho (ver "CUSTO CONHECIDO" na 0005). A janela
// é o que limita quantas linhas a policy precisa avaliar.
const JANELA_MAXIMA_MS = 24 * 3600 * 1000;
const JANELA_AVISO_MS = 6 * 3600 * 1000;

// ── Aparência ────────────────────────────────────────────────────────────
// Uma cor por ALUNO selecionado, não por partido. Numa turma real quase todos
// os selecionados estão do mesmo lado, então colorir por partido deixaria 15
// trilhas azuis sobrepostas e indistinguíveis — que é justamente o contrário
// do que um debriefing precisa. O partido continua sendo dito de duas formas
// mais confiáveis que a cor da linha: pelo SÍMBOLO (a hostilidade que
// criarIconeSimbolo deriva) e pelo rótulo no resumo.
const PALETA = [
  '#7ab8f5', '#f5c842', '#7af57a', '#f57a7a', '#c88af5', '#f5a623',
  '#5ce0d8', '#e05292', '#a0d468', '#d0a060', '#8ab0d0', '#e0e0e0',
];

const VELOCIDADES = [1, 2, 5, 10, 30, 60, 120];
// Um quadro a cada ~60ms (≈16/s). requestAnimationFrame dispara a 60/s, mas
// remexer 60 marcadores 60 vezes por segundo é trabalho jogado fora: o olho
// não distingue, e o notebook do instrutor está com o mapa, o painel e o
// navegador inteiro abertos.
const INTERVALO_QUADRO_MS = 60;
// Volta de aba oculta: requestAnimationFrame para de disparar, então o dt do
// primeiro quadro depois seria de minutos e o replay saltaria o exercício
// inteiro. Limitar o dt faz o tempo simplesmente continuar de onde parou.
const DT_MAXIMO_MS = 250;

// ── Estado do módulo ─────────────────────────────────────────────────────
let contexto = null;         // { userId, perfil }
let turmaAtual = null;
let permitido = true;        // ver_historico_rastro
let iniciado = false;        // a aba já foi aberta ao menos uma vez?
// Etapa 6c: guarda a Promise do primeiro carregarAlunos(), para
// abrirRastroDoAluno() poder esperar ele terminar antes de selecionar
// alguém — sem isso, um pulo vindo da aba "Situação atual" antes de o
// instrutor ter aberto o Debriefing nesta sessão encontraria `alunos` vazio.
let carregamentoInicial = null;

let map = null;
let basemapAtual = null;
let camadaTrilhas = null;

let alunos = [];             // perfis da turma (com sidc e partido)
const selecionados = new Set();
const corPorAluno = new Map();

let trilhas = new Map();     // usuario_id -> { pontos, leiturasBrutas, inicio, fim }
let janela = null;           // { inicio, fim } em ms
let intervaloUsado = null;   // balde efetivamente pedido, em segundos

// Camadas por aluno: usuario_id -> { completa, percorrida, marcador }
const camadas = new Map();

const replay = {
  t: null,
  tocando: false,
  velocidade: 10,
  rafId: null,
  ultimoTick: null,
  ultimoDesenho: 0,
};

let buscando = false;

// ── Helpers de tela ──────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const nf = new Intl.NumberFormat('pt-BR');

function nomeDoAluno(u) {
  const nome = u.nome_guerra || u.nome_completo || '(sem nome)';
  return u.posto_graduacao ? `${u.posto_graduacao} ${nome}` : nome;
}

function avisar(texto, tipo) {
  const caixa = el('debriefing-aviso');
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

function status(texto) {
  const alvo = el('debriefing-status');
  if (alvo) alvo.textContent = texto || '';
}

function relogio(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour12: false });
}

function dataHora(ms) {
  return new Date(ms).toLocaleString('pt-BR', { hour12: false });
}

function duracaoCurta(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}h${String(m).padStart(2, '0')}m`
    : `${m}m${String(s).padStart(2, '0')}s`;
}

function distanciaCurta(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

// Converte o valor de um <input type="datetime-local"> (que vem SEM fuso, no
// horário local de quem digitou) num Date. `new Date('2026-07-31T13:00')`
// interpreta como hora local, que é exatamente o que o instrutor quis dizer.
function lerCampoData(id) {
  const valor = el(id)?.value;
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isFinite(d.getTime()) ? d : null;
}

// O inverso: joga um Date num datetime-local, respeitando o fuso local (o
// toISOString() daria UTC e a tela mostraria a hora errada).
function escreverCampoData(id, data) {
  const alvo = el(id);
  if (!alvo) return;
  const p = (n) => String(n).padStart(2, '0');
  alvo.value = `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`
    + `T${p(data.getHours())}:${p(data.getMinutes())}`;
}

// ── Mapa ─────────────────────────────────────────────────────────────────
// Os mapas base vêm de frontend/basemaps.js desde a Etapa 7.1 — antes esta
// tela tinha a própria cópia de um subconjunto de 4 opções, e o BDGEx do
// Exército, que é a carta mais importante do projeto, não estava entre elas.
// A unificação estava adiada para a Etapa 9 (decisão registrada aqui na 6b),
// e foi antecipada quando a lista caiu de onze opções para seis: aplicar a
// redução em quatro cópias à mão era garantir que uma divergisse.

let basemaps = null;

function garantirMapa() {
  if (map) {
    // O container fica dentro de uma aba escondida; enquanto ela está com
    // display:none o Leaflet mede o div como 0×0 e desenha os tiles errados.
    // invalidateSize() depois que a aba aparece é o conserto padrão.
    setTimeout(() => map.invalidateSize(), 0);
    return map;
  }

  basemaps = criarBasemaps();
  map = L.map('debriefing-mapa', { center: [-22, -47], zoom: 10 });
  preencherSeletorBasemap(el('debriefing-basemap'));
  basemapAtual = trocarBasemap(map, basemaps, BASEMAP_PADRAO, null);
  camadaTrilhas = L.layerGroup().addTo(map);

  const seletor = el('debriefing-basemap');
  if (seletor) {
    seletor.addEventListener('change', () => {
      if (!basemaps[seletor.value]) return;
      basemapAtual = trocarBasemap(map, basemaps, seletor.value, basemapAtual);
    });
  }

  setTimeout(() => map.invalidateSize(), 0);
  return map;
}

// ── Lista de alunos ──────────────────────────────────────────────────────
async function carregarAlunos() {
  if (!turmaAtual) {
    alunos = [];
    selecionados.clear();
    renderizarListaAlunos();
    return;
  }
  const lista = await buscarUsuariosDaTurma(turmaAtual.id);
  // O instrutor também tem posição no histórico (ele pode estar em campo com
  // o app aberto), então não é filtrado da lista — só desce para o fim, que é
  // o que buscarUsuariosDaTurma já não faz (ela põe instrutor primeiro, útil
  // na grade de permissões, atrapalha aqui).
  alunos = [...lista].sort((a, b) => {
    if (a.papel !== b.papel) return a.papel === 'instrutor' ? 1 : -1;
    return 0;
  });

  corPorAluno.clear();
  alunos.forEach((u, i) => corPorAluno.set(u.id, PALETA[i % PALETA.length]));

  // Tira da seleção quem saiu da turma.
  for (const id of [...selecionados]) {
    if (!alunos.some((u) => u.id === id)) selecionados.delete(id);
  }
  renderizarListaAlunos();
}

function renderizarListaAlunos() {
  const caixa = el('debriefing-alunos');
  if (!caixa) return;

  if (alunos.length === 0) {
    caixa.innerHTML = '<div class="lista-vazia">Ninguém entrou nesta turma ainda.</div>';
    atualizarContagemSelecao();
    return;
  }

  caixa.innerHTML = alunos.map((u) => {
    const cor = corPorAluno.get(u.id);
    const partido = u.partido
      ? `<span class="tag-partido" style="border-color:${esc(u.partido.cor)};color:${esc(u.partido.cor)}">${esc(u.partido.nome)}</span>`
      : '<span class="tag-partido tag-sem">sem força</span>';
    return `
      <label class="aluno-linha">
        <input type="checkbox" data-id="${esc(u.id)}" ${selecionados.has(u.id) ? 'checked' : ''}>
        <span class="aluno-cor" style="background:${esc(cor)}"></span>
        <span class="aluno-nome">${esc(nomeDoAluno(u))}</span>
        ${partido}
      </label>`;
  }).join('');

  caixa.querySelectorAll('input[type=checkbox][data-id]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) selecionados.add(input.dataset.id);
      else selecionados.delete(input.dataset.id);
      atualizarContagemSelecao();
      atualizarPrevisao();
    });
  });

  atualizarContagemSelecao();
}

function atualizarContagemSelecao() {
  const alvo = el('debriefing-selecao');
  if (alvo) {
    alvo.textContent = selecionados.size === 0
      ? 'nenhum aluno escolhido'
      : `${selecionados.size} de ${alunos.length} escolhido${selecionados.size === 1 ? '' : 's'}`;
  }
}

// ── Janela de tempo ──────────────────────────────────────────────────────
function aplicarPreset(valor) {
  if (valor === 'personalizado') return;
  const agora = new Date();
  let inicio;
  if (valor === 'hoje') {
    inicio = new Date(agora);
    inicio.setHours(0, 0, 0, 0);
  } else {
    inicio = new Date(agora.getTime() - Number(valor) * 3600 * 1000);
  }
  escreverCampoData('debriefing-inicio', inicio);
  escreverCampoData('debriefing-fim', agora);
  atualizarPrevisao();
}

// Mostra, ANTES de consultar, qual balde de amostragem vai ser usado e por
// quê. É o que torna a decisão de volume visível para quem opera, em vez de
// ela acontecer escondida e o instrutor achar que está vendo o rastro cru.
function atualizarPrevisao() {
  const alvo = el('debriefing-previsao');
  if (!alvo) return;

  const inicio = lerCampoData('debriefing-inicio');
  const fim = lerCampoData('debriefing-fim');
  if (!inicio || !fim || fim <= inicio || selecionados.size === 0) {
    alvo.textContent = '';
    return;
  }

  const duracaoS = (fim - inicio) / 1000;
  const escolhido = el('debriefing-resolucao')?.value || 'auto';
  const passo = escolhido === 'auto'
    ? calcularIntervaloAmostragem(duracaoS, selecionados.size)
    : Number(escolhido);
  const pontos = Math.ceil(duracaoS / passo) * selecionados.size;

  alvo.textContent =
    `Janela de ${duracaoCurta(fim - inicio)} · 1 ponto a cada ${rotuloIntervalo(passo)}`
    + ` · até ${nf.format(pontos)} pontos`
    + (escolhido === 'auto' ? ' (resolução automática)' : '');
}

// ── Consulta ─────────────────────────────────────────────────────────────

// Quantos alunos cabem numa requisição. `pontosPorAluno` é um TETO seguro
// (duração ÷ balde), não uma estimativa: um aluno pode ter menos pontos que
// isso — se ficou sem sinal, por exemplo — mas nunca mais.
function tamanhoDoLote(pontosPorAluno) {
  return Math.max(1, Math.floor(PAGINA / Math.max(1, pontosPorAluno)));
}

// Um lote de alunos, com paginação por deslocamento como rede de segurança.
// A paginação só entra quando o teto por aluno estoura uma página — o que a
// resolução automática impede, mas a resolução escolhida à mão não (5s numa
// janela de 24h dá 17 mil pontos por aluno).
async function buscarLote({ usuarios, inicio, fim, intervaloS }) {
  const linhas = [];
  let total = null;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * PAGINA;
    const { data, error, count } = await supabase
      .rpc(
        'fn_rastro_historico',
        {
          p_usuarios: usuarios,
          p_inicio: inicio.toISOString(),
          p_fim: fim.toISOString(),
          p_intervalo_s: intervaloS,
          p_limite: LIMITE_SERVIDOR,
        },
        // A contagem exata só na primeira página do lote: é ela que diz se
        // acabou de verdade ou se o `max-rows` cortou. Sem ela, "veio menos
        // que uma página cheia" confundiria as duas coisas — e essa confusão
        // é exatamente o modo de falha que esta tela não pode ter.
        pagina === 0 ? { count: 'exact' } : undefined
      )
      .range(de, de + PAGINA - 1);

    if (error) return { erro: error };

    if (count != null) total = count;
    const recebido = data || [];
    linhas.push(...recebido);

    if (total != null) {
      if (linhas.length >= total) return { linhas, total };
    } else if (recebido.length < PAGINA) {
      return { linhas, total: linhas.length };
    }
  }

  return { linhas, total, truncadoPorSeguranca: true };
}

async function buscarRastro({ usuarios, inicio, fim, intervaloS }) {
  const duracaoS = (fim - inicio) / 1000;
  const pontosPorAluno = Math.max(1, Math.ceil(duracaoS / intervaloS));
  const porLote = tamanhoDoLote(pontosPorAluno);

  const linhas = [];
  let truncado = false;
  let requisicoes = 0;

  for (let i = 0; i < usuarios.length; i += porLote) {
    const lote = usuarios.slice(i, i + porLote);
    const parcial = await buscarLote({ usuarios: lote, inicio, fim, intervaloS });
    requisicoes++;
    if (parcial.erro) return { erro: parcial.erro };

    linhas.push(...parcial.linhas);
    if (parcial.truncadoPorSeguranca) truncado = true;
    // O servidor também trunca (p_limite): um lote que volta exatamente no
    // teto quase certamente foi cortado lá dentro.
    if (parcial.total != null && parcial.total >= LIMITE_SERVIDOR) truncado = true;

    // Teto global, para o navegador não engolir 60 lotes cheios.
    if (linhas.length >= LIMITE_SERVIDOR) {
      truncado = true;
      break;
    }
  }

  return { linhas, truncado, requisicoes, porLote };
}

async function buscar() {
  if (buscando) return;

  const inicio = lerCampoData('debriefing-inicio');
  const fim = lerCampoData('debriefing-fim');

  if (selecionados.size === 0) {
    avisar('Escolha pelo menos um aluno na lista ao lado.', 'erro');
    return;
  }
  if (!inicio || !fim) {
    avisar('Preencha o início e o fim do intervalo. A janela de tempo é obrigatória — '
      + 'sem ela a consulta varreria o histórico inteiro.', 'erro');
    return;
  }
  if (fim <= inicio) {
    avisar('O fim do intervalo precisa ser depois do início.', 'erro');
    return;
  }
  if (fim - inicio > JANELA_MAXIMA_MS) {
    avisar(`A janela máxima é de ${JANELA_MAXIMA_MS / 3600000} horas. `
      + 'Um exercício mais longo se analisa em pedaços — a amostragem reduz os pontos '
      + 'desenhados, mas não o trabalho que o banco tem de fazer para achar as linhas.', 'erro');
    return;
  }

  buscando = true;
  pausar();
  avisar('');
  status('buscando…');
  // O botão só é alcançável com a aba aberta (e portanto com o mapa montado),
  // mas garantir aqui evita que uma chamada futura de outro lugar caia num
  // camadaTrilhas nulo em desenharTrilhasCompletas().
  garantirMapa();
  el('debriefing-buscar')?.setAttribute('disabled', 'disabled');

  const usuarios = [...selecionados];
  const duracaoS = (fim - inicio) / 1000;
  const escolhido = el('debriefing-resolucao')?.value || 'auto';
  intervaloUsado = escolhido === 'auto'
    ? calcularIntervaloAmostragem(duracaoS, usuarios.length)
    : Number(escolhido);

  const resultado = await buscarRastro({ usuarios, inicio, fim, intervaloS: intervaloUsado });

  buscando = false;
  el('debriefing-buscar')?.removeAttribute('disabled');

  if (resultado.erro) {
    status('');
    // PGRST202 = o PostgREST não achou a função. É o sintoma exato de a
    // migration 0005 ainda não ter sido aplicada — vale dizer isso em vez de
    // repassar o erro cru.
    const codigo = resultado.erro.code || '';
    if (codigo === 'PGRST202' || /fn_rastro_historico/.test(resultado.erro.message || '')) {
      avisar('A função de leitura do rastro não existe neste banco. Aplique '
        + 'backend/supabase/0005_rastro_historico.sql pelo SQL Editor do Supabase '
        + 'e tente de novo.', 'erro');
    } else {
      avisar(`Não foi possível ler o histórico: ${resultado.erro.message}`, 'erro');
    }
    return;
  }

  trilhas = montarTrilhas(resultado.linhas);
  janela = janelaDasTrilhas(trilhas);

  limparMapa();

  if (!janela) {
    status('');
    avisar('Nenhuma posição gravada nesse intervalo para quem foi escolhido. '
      + 'Confira o horário (o campo usa o fuso deste computador) e se o app dos alunos '
      + 'estava aberto com o GPS ligado.', 'info');
    renderizarResumo();
    renderizarControles();
    return;
  }

  desenharTrilhasCompletas();
  replay.t = janela.inicio;
  renderizarControles();
  desenharInstante(replay.t);
  renderizarResumo();
  enquadrar();

  const pontos = resultado.linhas.length;
  let leituras = 0;
  for (const trilha of trilhas.values()) leituras += trilha.leiturasBrutas;

  status(`${nf.format(pontos)} pontos · ${rotuloIntervalo(intervaloUsado)} por ponto`
    + ` · ${resultado.requisicoes} consulta${resultado.requisicoes === 1 ? '' : 's'}`);

  const avisos = [];
  if (leituras > pontos) {
    avisos.push(`${nf.format(pontos)} pontos desenhados, representando `
      + `${nf.format(leituras)} leituras de GPS (1 ponto a cada ${rotuloIntervalo(intervaloUsado)}).`);
  }
  if (resultado.truncado) {
    avisos.push(`O resultado bateu no teto de ${nf.format(LIMITE_SERVIDOR)} pontos e foi CORTADO — `
      + 'o rastro mostrado está incompleto. Reduza o intervalo, escolha menos alunos '
      + 'ou aumente o tempo por ponto.');
  }
  if (fim - inicio > JANELA_AVISO_MS) {
    avisos.push('Janela longa: a consulta fica mais lenta conforme o intervalo cresce, '
      + 'mesmo com a amostragem (a regra de acesso é avaliada por linha bruta).');
  }
  if (avisos.length) {
    avisar(avisos.join(' '), resultado.truncado ? 'erro' : 'info');
  }
}

// ── Desenho ──────────────────────────────────────────────────────────────
function limparMapa() {
  if (camadaTrilhas) camadaTrilhas.clearLayers();
  camadas.clear();
}

function perfilDe(usuarioId) {
  return alunos.find((u) => u.id === usuarioId) || null;
}

function desenharTrilhasCompletas() {
  const mostrar = el('debriefing-mostrar-trilha')?.checked !== false;

  for (const [usuarioId, trilha] of trilhas) {
    const perfil = perfilDe(usuarioId);
    const cor = corPorAluno.get(usuarioId) || PALETA[0];

    // Uma polyline por trilha, com MÚLTIPLOS segmentos: segmentar() já separa
    // os trechos por perda de sinal, e o Leaflet aceita array de arrays. Ligar
    // os dois lados de um silêncio de 10 minutos em linha reta desenharia um
    // trajeto que ninguém percorreu.
    const segmentos = segmentar(trilha.pontos).map((seg) => seg.map((p) => [p.lat, p.lon]));

    const completa = L.polyline(segmentos, {
      color: cor, weight: 2, opacity: mostrar ? 0.45 : 0, dashArray: '4 4',
    }).addTo(camadaTrilhas);

    completa.bindPopup(popupTrilha(perfil, trilha));

    // A parte já percorrida até o instante do replay, desenhada por cima e
    // mais forte. Nasce vazia e cresce em desenharInstante().
    const percorrida = L.polyline([], {
      color: cor, weight: 4, opacity: 0.95,
    }).addTo(camadaTrilhas);

    camadas.set(usuarioId, { completa, percorrida, marcador: null, cor, perfil });
  }
}

function popupTrilha(perfil, trilha) {
  const distancia = distanciaTrilhaM(trilha.pontos);
  return (
    `<b>${esc(perfil ? nomeDoAluno(perfil) : 'Usuário desconhecido')}</b><br>`
    + `${nf.format(trilha.pontos.length)} pontos `
    + `(${nf.format(trilha.leiturasBrutas)} leituras)<br>`
    + `Percurso: ${distanciaCurta(distancia)}<br>`
    + `De ${dataHora(trilha.inicio)}<br>`
    + `até ${dataHora(trilha.fim)}`
  );
}

// O coração do replay: para cada aluno, onde ele estava em `t`.
function desenharInstante(t) {
  if (!map || !janela) return;
  const interpolar = el('debriefing-interpolar')?.checked !== false;

  for (const [usuarioId, camada] of camadas) {
    const trilha = trilhas.get(usuarioId);
    if (!trilha) continue;

    const pos = posicaoNoInstante(trilha.pontos, t, { interpolar });

    // Antes do primeiro ponto, ou já sem sinal: fora do mapa. Some da tela
    // pelo mesmo critério que colegas.js usa ao vivo (4 heartbeats perdidos),
    // para o replay não contradizer o que o instrutor viu na hora.
    if (!pos || pos.estado === 'sem_sinal') {
      if (camada.marcador) {
        camadaTrilhas.removeLayer(camada.marcador);
        camada.marcador = null;
      }
      camada.percorrida.setLatLngs(pos ? trechoAte(trilha.pontos, t, { interpolar }) : []);
      continue;
    }

    camada.percorrida.setLatLngs(trechoAte(trilha.pontos, t, { interpolar }));

    if (!camada.marcador) {
      camada.marcador = L.marker([pos.lat, pos.lon], {
        icon: criarIconeSimbolo(camada.perfil?.sidc, {
          // O observador é o INSTRUTOR. Ele normalmente não tem partido, e
          // nesse caso hostilidadeRelativa() devolve null de propósito — o
          // SIDC gravado passa intacto, sem inventar hostilidade (ver a ordem
          // das guardas em simbolos.js). Se o instrutor estiver lotado numa
          // força, o rastro sai com a hostilidade daquele ponto de vista, que
          // é o comportamento correto e o mesmo do mapa ao vivo.
          partidoObservador: contexto?.perfil?.partido || null,
          partidoElemento: camada.perfil?.partido || null,
          tamanho: 26,
          designacao: camada.perfil?.nome_guerra || '',
          corFallback: camada.cor,
          tamanhoFallback: 18,
        }),
        zIndexOffset: 600,
      }).addTo(camadaTrilhas);
    } else {
      camada.marcador.setLatLng([pos.lat, pos.lon]);
    }

    camada.marcador.setOpacity(pos.estado === 'esmaecido' ? 0.4 : 1);
  }

  const marcadorTempo = el('debriefing-relogio');
  if (marcadorTempo) {
    marcadorTempo.textContent = `${relogio(t)} · +${duracaoCurta(t - janela.inicio)}`;
  }
  const barra = el('debriefing-barra');
  if (barra && document.activeElement !== barra) {
    const total = janela.fim - janela.inicio;
    barra.value = String(total > 0 ? Math.round(((t - janela.inicio) / total) * 1000) : 0);
  }
}

function enquadrar() {
  if (!map) return;
  const limites = [];
  for (const trilha of trilhas.values()) {
    for (const p of trilha.pontos) limites.push([p.lat, p.lon]);
  }
  if (limites.length) map.fitBounds(L.latLngBounds(limites), { padding: [40, 40] });
}

// ── Resumo (a tabela do debriefing) ──────────────────────────────────────
function renderizarResumo() {
  const caixa = el('debriefing-resumo');
  if (!caixa) return;

  if (!trilhas.size) {
    caixa.innerHTML = '';
    return;
  }

  const linhas = [...trilhas.entries()].map(([usuarioId, trilha]) => {
    const perfil = perfilDe(usuarioId);
    const cor = corPorAluno.get(usuarioId) || PALETA[0];
    const buracos = segmentar(trilha.pontos).length - 1;
    return `
      <tr>
        <td><span class="aluno-cor" style="background:${esc(cor)}"></span> ${esc(perfil ? nomeDoAluno(perfil) : usuarioId)}</td>
        <td>${esc(perfil?.partido?.nome || '—')}</td>
        <td>${nf.format(trilha.pontos.length)}</td>
        <td>${nf.format(trilha.leiturasBrutas)}</td>
        <td>${esc(distanciaCurta(distanciaTrilhaM(trilha.pontos)))}</td>
        <td>${esc(relogio(trilha.inicio))} – ${esc(relogio(trilha.fim))}</td>
        <td>${buracos > 0 ? `${buracos}` : '—'}</td>
      </tr>`;
  }).join('');

  caixa.innerHTML = `
    <table class="tabela-resumo">
      <thead>
        <tr>
          <th>Aluno</th><th>Força</th><th>Pontos</th><th>Leituras</th>
          <th>Percurso</th><th>Do … ao</th>
          <th title="Trechos separados por mais de ${GAP_SEM_SINAL_MS / 1000}s sem posição — app fechado, sem sinal ou GPS sem fixar">Cortes</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>`;
}

// ── Replay: play / pause / velocidade / barra ────────────────────────────
function renderizarControles() {
  const caixa = el('debriefing-controles');
  if (!caixa) return;
  caixa.style.display = janela ? 'flex' : 'none';
  if (!janela) return;

  const marcadorJanela = el('debriefing-janela');
  if (marcadorJanela) {
    marcadorJanela.textContent =
      `${dataHora(janela.inicio)} → ${dataHora(janela.fim)} (${duracaoCurta(janela.fim - janela.inicio)})`;
  }
  atualizarBotaoTocar();
}

function atualizarBotaoTocar() {
  const botao = el('debriefing-tocar');
  if (botao) botao.textContent = replay.tocando ? '⏸ Pausar' : '▶ Reproduzir';
}

function tocar() {
  if (!janela || replay.tocando) return;
  // Chegou ao fim: um novo play recomeça, em vez de não fazer nada.
  if (replay.t >= janela.fim) replay.t = janela.inicio;
  replay.tocando = true;
  replay.ultimoTick = null;
  replay.rafId = requestAnimationFrame(quadro);
  atualizarBotaoTocar();
}

function pausar() {
  replay.tocando = false;
  if (replay.rafId) {
    cancelAnimationFrame(replay.rafId);
    replay.rafId = null;
  }
  atualizarBotaoTocar();
}

function quadro(agora) {
  if (!replay.tocando || !janela) return;

  const dt = replay.ultimoTick == null
    ? 0
    : Math.min(agora - replay.ultimoTick, DT_MAXIMO_MS);
  replay.ultimoTick = agora;

  replay.t += dt * replay.velocidade;

  if (replay.t >= janela.fim) {
    replay.t = janela.fim;
    desenharInstante(replay.t);
    pausar();
    return;
  }

  if (agora - replay.ultimoDesenho >= INTERVALO_QUADRO_MS) {
    replay.ultimoDesenho = agora;
    desenharInstante(replay.t);
  }
  replay.rafId = requestAnimationFrame(quadro);
}

function irPara(t) {
  if (!janela) return;
  replay.t = Math.min(Math.max(t, janela.inicio), janela.fim);
  desenharInstante(replay.t);
}

// ── Permissão ────────────────────────────────────────────────────────────
// A chave sai de "sem efeito ainda" (CHAVES_APLICADAS em permissoes.js) e
// passa a valer aqui. Para o instrutor a view devolve tudo habilitado pelo
// papel, então na prática isto nunca desliga hoje; o valor está em a tela já
// nascer obedecendo, para o dia em que o rastro for oferecido ao aluno.
//
// Vale repetir o aviso de permissoes.js: isto é interface, não segurança.
// Quem impede um aluno de ler o rastro dos outros é a policy `historico_ler`
// (0003) — e ela continua valendo mesmo com esta checagem contornada no
// console, porque a RPC da 0005 é `security invoker`.
function aplicarPermissao(habilitada) {
  permitido = habilitada;

  const aba = el('aba-debriefing');
  if (aba) {
    aba.disabled = !habilitada;
    aba.title = habilitada ? '' : 'O instrutor desabilitou o histórico de rastro';
  }

  const painel = el('painel-debriefing');
  if (!painel) return;

  const bloqueio = el('debriefing-bloqueio');
  if (bloqueio) bloqueio.style.display = habilitada ? 'none' : 'block';
  const corpo = el('debriefing-corpo');
  if (corpo) corpo.style.display = habilitada ? '' : 'none';

  if (!habilitada) {
    pausar();
    limparMapa();
    trilhas = new Map();
    janela = null;
    renderizarControles();
    renderizarResumo();
    status('');
    return;
  }

  // Religou com a aba já aberta: monta o que aoAbrirDebriefing() teria montado.
  // A checagem de `hidden` é o que impede o caso comum — o observador dispara
  // uma vez durante iniciarDebriefing(), com a aba ainda fechada — de criar um
  // mapa Leaflet dentro de um container 0×0.
  if (painel && !painel.hidden) aoAbrirDebriefing();
}

// ── Ponto de entrada ─────────────────────────────────────────────────────
// Chamado por instrutor.html depois de exigirSessao('instrutor') e de
// iniciarPermissoes(). A turma vem de instrutor-permissoes.js, via
// observarTurma() — o painel inteiro trabalha sempre sobre a MESMA turma
// selecionada lá em cima, e trocar de turma aqui teria dois seletores
// discordando na mesma tela.
export function iniciarDebriefing({ userId, perfil }) {
  contexto = { userId, perfil };

  // Resolução: "automática" + os passos fixos, com o rótulo já formatado.
  const seletorResolucao = el('debriefing-resolucao');
  if (seletorResolucao) {
    seletorResolucao.innerHTML = '<option value="auto">automática</option>'
      + PASSOS_SUGERIDOS.map((p) => `<option value="${p}">1 ponto a cada ${rotuloIntervalo(p)}</option>`).join('');
    seletorResolucao.addEventListener('change', atualizarPrevisao);
  }

  const seletorVelocidade = el('debriefing-velocidade');
  if (seletorVelocidade) {
    seletorVelocidade.innerHTML = VELOCIDADES
      .map((v) => `<option value="${v}"${v === replay.velocidade ? ' selected' : ''}>${v}×</option>`)
      .join('');
    seletorVelocidade.addEventListener('change', () => {
      replay.velocidade = Number(seletorVelocidade.value) || 1;
    });
  }

  el('debriefing-preset')?.addEventListener('change', (ev) => aplicarPreset(ev.target.value));
  el('debriefing-inicio')?.addEventListener('change', () => {
    const preset = el('debriefing-preset');
    if (preset) preset.value = 'personalizado';
    atualizarPrevisao();
  });
  el('debriefing-fim')?.addEventListener('change', () => {
    const preset = el('debriefing-preset');
    if (preset) preset.value = 'personalizado';
    atualizarPrevisao();
  });

  el('debriefing-buscar')?.addEventListener('click', buscar);

  el('debriefing-todos')?.addEventListener('click', () => {
    alunos.forEach((u) => selecionados.add(u.id));
    renderizarListaAlunos();
    atualizarPrevisao();
  });
  el('debriefing-nenhum')?.addEventListener('click', () => {
    selecionados.clear();
    renderizarListaAlunos();
    atualizarPrevisao();
  });

  el('debriefing-tocar')?.addEventListener('click', () => {
    replay.tocando ? pausar() : tocar();
  });
  el('debriefing-inicio-replay')?.addEventListener('click', () => {
    pausar();
    if (janela) irPara(janela.inicio);
  });

  el('debriefing-barra')?.addEventListener('input', (ev) => {
    if (!janela) return;
    const fracao = Number(ev.target.value) / 1000;
    irPara(janela.inicio + fracao * (janela.fim - janela.inicio));
  });

  el('debriefing-mostrar-trilha')?.addEventListener('change', (ev) => {
    const mostrar = ev.target.checked;
    for (const camada of camadas.values()) {
      camada.completa.setStyle({ opacity: mostrar ? 0.45 : 0 });
    }
  });
  el('debriefing-interpolar')?.addEventListener('change', () => {
    if (janela) desenharInstante(replay.t);
  });

  // Janela padrão: a última hora. É o intervalo mais provável logo depois de
  // um exercício e já deixa a tela utilizável sem ninguém digitar data.
  aplicarPreset('1');

  observarPermissao('ver_historico_rastro', aplicarPermissao);

  window.addEventListener('beforeunload', pausar);
}

// Chamado por instrutor.html toda vez que a aba do debriefing é aberta. O
// mapa só é criado aqui, e não em iniciarDebriefing(), porque um Leaflet
// montado num container com display:none mede 0×0 e carrega os tiles errados
// — e porque não faz sentido baixar tiles para uma aba que talvez nunca seja
// aberta nesta sessão.
export function aoAbrirDebriefing() {
  if (!permitido) return;
  garantirMapa();
  if (!iniciado) {
    iniciado = true;
    carregamentoInicial = carregarAlunos().then(atualizarPrevisao);
  }
}

// Etapa 6c: atalho vindo da aba "Situação atual" — o instrutor vê um aluno
// no mapa ao vivo e quer o rastro DELE, sem digitar nada de novo. Quem troca
// a aba visível para "Debriefing" antes de chamar isto é instrutor.html
// (mesmo motivo de sempre: montar o Leaflet com o container ainda
// display:none mede 0×0 e carrega os tiles errados — ver aoAbrirDebriefing
// acima e o comentário de garantirMapa()). Esta função só cuida do que vem
// DEPOIS da aba já estar visível: garantir que o mapa e a lista de alunos
// existem (aoAbrirDebriefing é idempotente), esperar o carregamento inicial
// se for a primeira vez, selecionar só este aluno e buscar — a janela de
// tempo já está preenchida (o padrão "última hora" é aplicado desde
// iniciarDebriefing, independente da aba estar aberta).
export async function abrirRastroDoAluno(usuarioId) {
  if (!permitido) return; // ver_historico_rastro desligada — nada para abrir
  aoAbrirDebriefing();
  if (carregamentoInicial) await carregamentoInicial;

  if (!alunos.some((u) => u.id === usuarioId)) return; // saiu da turma nesse meio-tempo

  selecionados.clear();
  selecionados.add(usuarioId);
  renderizarListaAlunos();
  atualizarPrevisao();
  await buscar();
}

// Chamado por instrutor-permissoes.js quando o instrutor troca de turma no
// seletor do topo: a lista de alunos muda e o que estava desenhado passa a ser
// de outra turma.
export function definirTurmaDebriefing(turma) {
  const mudou = turma?.id !== turmaAtual?.id;
  turmaAtual = turma || null;
  if (!mudou) return;

  pausar();
  selecionados.clear();
  trilhas = new Map();
  janela = null;
  limparMapa();
  renderizarControles();
  renderizarResumo();
  status('');
  avisar('');
  if (iniciado) carregarAlunos().then(atualizarPrevisao);
}
