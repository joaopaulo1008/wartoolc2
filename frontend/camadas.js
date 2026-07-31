// camadas.js — Etapa 7 do roadmap: camadas de arquivo no mapa do aluno.
//
// Mesmo padrão de módulo de gps.js/colegas.js/marcacoes.js: reusa o cliente
// Supabase por meio de calcos.js, recebe `map` por parâmetro (nunca lê `map`
// como global) e monta a própria interface, sem depender de HTML pré-existente
// em index.html.
//
// Este módulo cuida de DUAS coisas que parecem uma só e não são:
//
//   1. O ARQUIVO DO ALUNO. Ele escolhe um .kml/.kmz do próprio aparelho, a
//      camada aparece só para ele e some ao recarregar a página. Não sobe
//      nada, não grava nada. Governado por `carregar_kml`.
//
//   2. O CALCO DO INSTRUTOR. Publicado pelo painel (instrutor-calcos.js),
//      guardado no Supabase Storage, baixado por cada aluno que tem direito de
//      ver. Governado pela chave de CAMADA que o instrutor escolheu ao
//      publicar (camada_manobra / camada_inimigo / camada_logistica /
//      camada_obstaculos).
//
// Manter os dois separados é o que impede a lavagem de permissão: se o aluno
// pudesse classificar o próprio arquivo numa categoria, ele carregaria
// qualquer coisa, chamaria de "manobra" e recuperaria uma camada que o
// instrutor tinha desligado. O arquivo local não tem categoria — responde só
// a `carregar_kml`, e é visto só por quem o abriu.
//
// A REGRA DE SEMPRE, herdada da ponte window.WartoolCamadas (Etapa 6a):
// permissão do instrutor e escolha do aluno são coisas diferentes e as duas
// são respeitadas. A camada só aparece quando o instrutor PERMITE e o aluno
// MARCOU a caixa — e nada aqui desmarca a caixa do aluno, para que reabilitar
// devolva o estado que ele tinha escolhido, não "tudo ligado".
//
// OPACIDADE E ORDEM: UM MECANISMO SÓ
// ----------------------------------
// Cada camada ganha um `pane` próprio do Leaflet. A opacidade é a opacidade
// CSS do pane; a ordem é o z-index dele. Ver FAIXAS_PANE em kml.js para as
// faixas e para por que nenhuma delas encosta no markerPane — um calco não
// pode tapar um símbolo militar. Fazer opacidade por `setStyle` em cada feição
// seria pior: sobrescreveria a cor que veio do próprio KML, não valeria para a
// imagem georreferenciada da Etapa 8, e obrigaria a percorrer milhares de
// feições a cada arrastar do controle.

import { observarPermissao, pode } from './permissoes.js';
import {
  buscarCalcosDaTurma, baixarCalco, assinarCalcos, desassinarCalcos, ROTULO_CATEGORIA,
} from './calcos.js';
import {
  FAIXAS_PANE, CAMADAS_POR_FAIXA, CORES_CAMADA, COR_CAMADA_PADRAO,
  validarArquivo, nomeDeCamada, formatarBytes, planejarGuardar,
  propriedadesVisiveis, tituloDaFeicao,
} from './kml.js';
import { tornarRecolhivel } from './painel-lateral.js';
import { lerArquivoKml } from './kml-navegador.js';
import {
  listarArquivos, guardarArquivo, atualizarPreferencias,
  removerArquivo, pedirDurabilidade,
} from './armazem-camadas.js';

// As quatro chaves de camada que um calco pode vestir. Cópia curta de
// CATEGORIAS em calcos.js; aqui só interessa a lista de chaves a observar.
const CHAVES_DE_CATEGORIA = [
  'camada_manobra', 'camada_inimigo', 'camada_logistica', 'camada_obstaculos',
];

// ── Estado do módulo ─────────────────────────────────────────────────────
// Um "usuário logado" por página, então o estado mora no módulo — mesmo
// padrão de gps.js/colegas.js/marcacoes.js.
//
// camadas: id -> registro. Guarda TUDO que já foi carregado, desenhado ou
// não. Mesmo motivo do par `linhas`/`marcadores` em marcacoes.js: quando o
// instrutor desliga a chave, a camada sai do mapa mas não da memória, e
// religar redesenha na hora — sem baixar o arquivo de novo e, no caso do
// arquivo local, sem pedir para o aluno escolhê-lo outra vez (o que seria
// impossível: o navegador não guarda o arquivo).
const camadas = new Map();

let mapaRef = null;
let turmaIdRef = null;
let meuUserId = null;
let canalCalcos = null;
let raizPainel = null;
let sequencia = 0;
// Seletor do contêiner onde o card é pendurado. `#side-panel` é o do app do
// aluno (index.html); a aba "Situação atual" do instrutor (Etapa 6c) passa o
// dela. Parametrizar isto foi o que permitiu o mesmo módulo servir às duas
// telas sem uma linha de HTML pré-escrito em nenhuma das duas.
let seletorContainer = '#side-panel';

// ── UI: status ───────────────────────────────────────────────────────────
function status(texto, cor) {
  const el = document.getElementById('camadas-status');
  if (!el) return;
  el.textContent = `Camadas: ${texto}`;
  el.style.color = cor || '#7a9ab8';
}

function statusContagem() {
  const total = camadas.size;
  const desenhadas = [...camadas.values()].filter((c) => c.noMapa).length;
  if (total === 0) { status('nenhuma carregada', '#7a9ab8'); return; }
  const ocultas = total - desenhadas;
  if (ocultas > 0) status(`${desenhadas} de ${total} visíveis`, '#f5c842');
  else status(`${total} carregada${total === 1 ? '' : 's'}`, '#7af57a');
}

// ── Estilos próprios (o módulo é autocontido, como marcacoes.js) ─────────
let estilosInjetados = false;
function injetarEstilos() {
  if (estilosInjetados) return;
  estilosInjetados = true;
  const style = document.createElement('style');
  style.textContent = `
    /* O card herda .panel-card quando está no app do aluno (index.html), mas
       essa classe não existe no painel do instrutor — então o visual base vem
       daqui, para o mesmo módulo ficar apresentável nas duas telas sem
       depender do CSS de nenhuma delas. */
    #card-camadas {
      background:rgba(13,27,42,.92); border:1px solid #2a4a6b;
      border-radius:6px; padding:10px 14px; font-size:12px; min-width:170px;
    }
    #card-camadas h3 {
      font-size:11px; letter-spacing:.06em; text-transform:uppercase;
      color:#7a9ab8; margin-bottom:8px;
    }
    #card-camadas .cam-secao { margin-bottom:10px; }
    #card-camadas .cam-secao:last-child { margin-bottom:0; }
    #card-camadas .cam-subtitulo {
      font-size:10px; letter-spacing:.06em; text-transform:uppercase;
      color:#5a7a98; margin:8px 0 6px; border-top:1px solid #23405e; padding-top:8px;
    }
    #card-camadas .cam-linha { margin-bottom:8px; }
    #card-camadas .cam-topo { display:flex; align-items:center; gap:6px; }
    #card-camadas .cam-nome {
      flex:1; font-size:12px; color:#c8d8e8; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap;
    }
    #card-camadas .cam-dot { width:10px; height:10px; border-radius:2px; flex-shrink:0; }
    #card-camadas .cam-mini {
      background:transparent; border:1px solid #2a4a6b; color:#7a9ab8;
      border-radius:3px; width:18px; height:18px; line-height:1; font-size:10px;
      cursor:pointer; padding:0; flex-shrink:0;
    }
    #card-camadas .cam-mini:hover:not(:disabled) { color:#c8d8e8; border-color:#4a6a8a; }
    #card-camadas .cam-mini:disabled { opacity:.3; cursor:default; }
    /* Bolinhas de cor. Empurradas para o fim da linha pelo nome (que é
       flex:1), para a coluna de nomes continuar alinhada entre as camadas. */
    #card-camadas .cam-cores { display:flex; gap:3px; flex-shrink:0; }
    #card-camadas .cam-cor {
      width:13px; height:13px; border-radius:50%; padding:0; cursor:pointer;
      border:1px solid #4a6a8a;
    }
    #card-camadas .cam-cor.ativa { border-color:#e8eaf0; box-shadow:0 0 0 1px #e8eaf0; }
    #card-camadas .cam-opacidade { display:flex; align-items:center; gap:6px; margin-top:3px; padding-left:18px; }
    #card-camadas .cam-opacidade input[type=range] { flex:1; height:14px; cursor:pointer; }
    #card-camadas .cam-pct { font-size:10px; color:#5a7a98; min-width:30px; text-align:right; }
    #card-camadas .cam-meta { font-size:10px; color:#5a7a98; padding-left:18px; }
    #card-camadas .cam-aviso {
      font-size:11px; color:#f5c842; line-height:1.5;
      background:#3a3a1a; border:1px solid #6c5a2a; border-radius:4px;
      padding:6px 8px; margin-top:6px;
    }
    #card-camadas .cam-erro {
      font-size:11px; color:#f57a7a; line-height:1.5;
      background:#3a1a1a; border:1px solid #6c2a2a; border-radius:4px;
      padding:6px 8px; margin-top:6px;
    }
    #card-camadas .cam-vazio { font-size:11px; color:#5a7a98; font-style:italic; }
    #card-camadas .cam-botao {
      width:100%; background:#1a3a5c; color:#7ab8f5; border:1px solid #2a5a8c;
      border-radius:4px; padding:5px 10px; font-size:12px; cursor:pointer; margin-top:4px;
    }
    #card-camadas .cam-botao:hover:not(:disabled) { background:#22456c; }
    #card-camadas .cam-botao:disabled { opacity:.4; cursor:not-allowed; }
  `;
  document.head.appendChild(style);
}

// ── Painel ───────────────────────────────────────────────────────────────
// O card é montado inteiro por este módulo e pendurado em #side-panel, que
// já existe em index.html. Nada de HTML pré-escrito lá para este painel:
// assim o módulo funciona igual quando a Etapa 9 trocar o index.html por uma
// SPA, e não fica um card órfão na tela se o módulo falhar ao iniciar.
function montarPainel() {
  injetarEstilos();
  const lateral = document.querySelector(seletorContainer);
  if (!lateral) return null;

  const card = document.createElement('div');
  card.className = 'panel-card';
  card.id = 'card-camadas';
  card.innerHTML = `
    <h3>Camadas de arquivo</h3>
    <div class="cam-secao" id="cam-secao-calcos">
      <div class="cam-subtitulo" style="border-top:none;padding-top:0">Calcos do instrutor</div>
      <div id="cam-lista-calcos"><span class="cam-vazio">Nenhum publicado.</span></div>
    </div>
    <div class="cam-secao" id="cam-secao-local">
      <div class="cam-subtitulo">Meus arquivos</div>
      <div id="cam-lista-local"></div>
      <div id="cam-local-controles"></div>
      <div id="cam-local-mensagem"></div>
    </div>
  `;
  lateral.appendChild(card);
  // O cartão recolhe pelo título, como os demais do painel. Feito aqui, e não
  // por quem chama, para valer nas DUAS telas que usam este módulo — a aba
  // "Situação atual" do instrutor não tem o bloco de montagem de painel que
  // index.html tem.
  tornarRecolhivel(card);
  return card;
}

// ── Um registro de camada ────────────────────────────────────────────────
// origem: 'local' (arquivo do aluno) ou 'calco' (publicado pelo instrutor).
// chave:  a permissão que manda nesta camada.
function novoRegistro({ id, nome, origem, chave, cor, meta, opacidade, ordem, querVer }) {
  const registro = {
    id, nome, origem, chave,
    cor: cor || COR_CAMADA_PADRAO,
    // O arquivo pode trazer estilo próprio (<Style> do KML). Enquanto o
    // usuário não escolher uma cor à mão, o estilo do arquivo manda — foi o
    // autor do calco que o desenhou assim. A partir do primeiro clique numa
    // bolinha, a escolha dele passa a valer sobre tudo: quem pede vermelho
    // quer vermelho, não "vermelho onde o arquivo não disser nada".
    corForcada: false,
    meta: meta || '',
    layer: null,
    pane: `wt-camada-${id}`,
    opacidade: Number.isFinite(opacidade) ? opacidade : 1,
    ordem: Number.isFinite(ordem) ? ordem : sequencia,
    querVer: querVer !== false,   // escolha do ALUNO (a caixa marcada)
    noMapa: false,
    guardado: false,              // conseguiu ficar no IndexedDB?
  };
  // A sequência precisa acompanhar as ordens restauradas, senão o primeiro
  // arquivo aberto depois de um F5 nasceria empatado com um já existente.
  sequencia = Math.max(sequencia, registro.ordem) + 1;
  return registro;
}

// ── Persistência das preferências ────────────────────────────────────────
// Só para camada LOCAL: a do calco tem o padrão do instrutor no banco, e o
// ajuste do aluno sobre ela é da sessão (opacidade é preferência de quem
// olha, e persistir a preferência sobre um calco alheio é assunto de
// `preferencias_visualizacao`, que continua fora de escopo).
//
// Debounce porque arrastar o controle de opacidade dispara dezenas de
// eventos, e cada um seria uma transação de IndexedDB.
const gravacoesPendentes = new Map();
function guardarPreferencias(registro) {
  if (registro.origem !== 'local' || !registro.guardado) return;
  clearTimeout(gravacoesPendentes.get(registro.id));
  gravacoesPendentes.set(registro.id, setTimeout(() => {
    gravacoesPendentes.delete(registro.id);
    atualizarPreferencias(registro.id, {
      opacidade: registro.opacidade,
      ordem: registro.ordem,
      querVer: registro.querVer,
      cor: registro.cor,
      corForcada: registro.corForcada,
    });
  }, 400));
}

// ── Desenho ──────────────────────────────────────────────────────────────

// Cor vinda do arquivo só é aceita se for exatamente `#rrggbb`. Não é
// paranoia decorativa: `stroke`/`fill` do KML entram num atributo de SVG, e a
// disciplina desta etapa é não confiar em NADA que veio de dentro do arquivo —
// nem no que parece inofensivo. Fora do formato, usa a cor da camada.
function corValida(valor, padrao) {
  return (typeof valor === 'string' && /^#[0-9a-fA-F]{6}$/.test(valor)) ? valor : padrao;
}

function estiloDaFeicao(registro) {
  return (feature) => {
    const p = (feature && feature.properties) || {};
    const ehArea = !!(feature && feature.geometry && String(feature.geometry.type).includes('Polygon'));
    const preenchimento = Number(p['fill-opacity']);
    // Com cor escolhida à mão, o estilo do arquivo é ignorado — ver
    // `corForcada` em novoRegistro().
    if (registro.corForcada) {
      return {
        color: registro.cor,
        weight: Math.min(Math.max(Number(p['stroke-width']) || 2, 1), 8),
        opacity: 1,
        fillColor: registro.cor,
        fillOpacity: ehArea ? (Number.isFinite(preenchimento) ? Math.min(preenchimento, 0.6) : 0.15) : 0,
      };
    }
    return {
      color: corValida(p.stroke, registro.cor),
      // Espessura limitada: um `stroke-width` de 200 vindo do arquivo cobriria
      // o mapa inteiro com uma linha.
      weight: Math.min(Math.max(Number(p['stroke-width']) || 2, 1), 8),
      // A opacidade da CAMADA mora no pane; aqui fica sempre 1 para as duas
      // não se multiplicarem e o controle deslizante mentir sobre o resultado.
      opacity: 1,
      fillColor: corValida(p.fill, registro.cor),
      fillOpacity: ehArea ? (Number.isFinite(preenchimento) ? Math.min(preenchimento, 0.6) : 0.15) : 0,
    };
  };
}

// Popup montado por DOM, com textContent — NUNCA innerHTML.
//
// Este é o ponto de segurança da etapa. O `<description>` de um KML carrega
// HTML arbitrário (é assim que o Google Earth mostra fotos e links), e a
// partir desta etapa o arquivo vem de fora: no caso do calco publicado, ele é
// desenhado na tela de 60 pessoas. Escapar com esc() funcionaria, mas depende
// de alguém lembrar de escapar em todo ponto de saída, para sempre. Montar
// nós de DOM e atribuir textContent torna a injeção impossível por
// construção: não existe caminho pelo qual o texto vire marcação.
//
// `propriedadesVisiveis()` e `tituloDaFeicao()` (kml.js) já tiram as tags e
// podam o tamanho — mas isso é por LEGIBILIDADE, não é a barreira. A barreira
// é o textContent.
function construirPopup(props, registro) {
  const raiz = document.createElement('div');
  raiz.className = 'popup-content';

  const titulo = document.createElement('div');
  titulo.className = 'popup-title';
  titulo.textContent = tituloDaFeicao(props) || registro.nome;
  raiz.appendChild(titulo);

  const campos = propriedadesVisiveis(props);
  if (campos.length === 0) {
    const vazio = document.createElement('div');
    vazio.className = 'popup-value';
    vazio.textContent = 'Sem informações adicionais.';
    raiz.appendChild(vazio);
    return raiz;
  }

  for (const [rotulo, valor] of campos) {
    const linha = document.createElement('div');
    linha.className = 'popup-row';
    const l = document.createElement('span');
    l.className = 'popup-label';
    l.textContent = rotulo;
    const v = document.createElement('span');
    v.className = 'popup-value';
    v.style.whiteSpace = 'pre-line';
    v.textContent = valor;
    linha.append(l, v);
    raiz.appendChild(linha);
  }
  return raiz;
}

function garantirPane(registro) {
  if (!mapaRef.getPane(registro.pane)) mapaRef.createPane(registro.pane);
  return mapaRef.getPane(registro.pane);
}

function construirCamada(registro, geojson) {
  garantirPane(registro);
  registro.layer = L.geoJSON(geojson, {
    pane: registro.pane,
    style: estiloDaFeicao(registro),
    // Ponto vira circleMarker, e NÃO o ícone declarado no KML. Um <IconStyle>
    // aponta para uma URL remota: honrá-la faria o navegador de cada aluno
    // buscar imagem num servidor de terceiro, entregando o IP dele (e o
    // momento em que abriu o calco) a quem hospeda o arquivo — um pixel de
    // rastreamento embutido num calco funcionaria perfeitamente. Além disso a
    // imagem pode não existir mais, e aí o ponto sumiria do mapa.
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      pane: registro.pane,
      radius: 5,
      color: corValida(feature?.properties?.stroke, registro.cor),
      weight: 2,
      fillColor: corValida(feature?.properties?.['icon-color'], registro.cor),
      fillOpacity: 0.7,
    }),
    onEachFeature: (feature, layer) => {
      // O conteúdo é montado só quando o popup ABRE: com milhares de feições,
      // montar tudo na carga custaria milhares de nós de DOM que ninguém vai
      // olhar. Mesmo raciocínio de aoAbrirPopup() em marcacoes.js.
      layer.bindPopup(() => construirPopup(feature && feature.properties, registro), { maxWidth: 280 });
    },
  });
}

// ── Visibilidade ─────────────────────────────────────────────────────────
// A conjunção de sempre: instrutor PERMITE e aluno MARCOU.
function deveMostrar(registro) {
  return pode(registro.chave) && registro.querVer;
}

function aplicarVisibilidade(registro) {
  if (!registro.layer) return;
  const mostrar = deveMostrar(registro);
  if (mostrar && !registro.noMapa) {
    registro.layer.addTo(mapaRef);
    registro.noMapa = true;
  } else if (!mostrar && registro.noMapa) {
    mapaRef.removeLayer(registro.layer);
    registro.noMapa = false;
  }
}

function aplicarOpacidade(registro) {
  const pane = mapaRef.getPane(registro.pane);
  if (pane) pane.style.opacity = String(registro.opacidade);
}

// Ordem: z-index do pane, dentro da faixa da origem. Recalculado inteiro a
// cada mudança em vez de ajustado ponto a ponto — são poucas camadas e um
// recálculo completo não tem como ficar inconsistente.
function aplicarOrdem() {
  for (const origem of ['calco', 'local']) {
    const base = origem === 'calco' ? FAIXAS_PANE.compartilhado : FAIXAS_PANE.local;
    const lista = [...camadas.values()]
      .filter((c) => c.origem === origem)
      .sort((a, b) => a.ordem - b.ordem);
    lista.forEach((registro, i) => {
      const pane = mapaRef.getPane(registro.pane);
      // O corte em CAMADAS_POR_FAIXA - 1 é o que impede uma faixa de invadir a
      // seguinte se alguém carregar dezenas de arquivos: da 30ª em diante, as
      // camadas empilham no topo da própria faixa em vez de subir por cima da
      // faixa de cima. Ver FAIXAS_PANE em kml.js.
      if (pane) pane.style.zIndex = String(base + Math.min(i, CAMADAS_POR_FAIXA - 1));
    });
  }
}

function reavaliarTudo() {
  for (const registro of camadas.values()) aplicarVisibilidade(registro);
  statusContagem();
  redesenharListas();
}

// ── Remoção ──────────────────────────────────────────────────────────────
function descartar(id) {
  const registro = camadas.get(id);
  if (!registro) return;
  // Tirar da lista é uma decisão do aluno, então tira do aparelho também —
  // senão a camada voltaria sozinha no próximo F5, que é o oposto do que ele
  // pediu ao clicar no ×.
  if (registro.origem === 'local') removerArquivo(id);
  if (registro.layer && registro.noMapa) mapaRef.removeLayer(registro.layer);
  // O pane fica no DOM (o Leaflet não tem removePane público e um <div> vazio
  // não custa nada), mas o registro sai — sem isso, um calco removido pelo
  // instrutor continuaria ocupando posição na ordenação.
  camadas.delete(id);
  aplicarOrdem();
  statusContagem();
  redesenharListas();
}

// ── Lista na tela ────────────────────────────────────────────────────────
// Redesenhada inteira a cada mudança. São poucas linhas e nenhuma delas tem
// estado que se perca (o estado mora no registro), então reconstruir é mais
// simples e mais seguro do que remendar nós existentes.
function linhaDaCamada(registro, indice, total) {
  const linha = document.createElement('div');
  linha.className = 'cam-linha';

  const topo = document.createElement('div');
  topo.className = 'cam-topo';

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = registro.querVer;
  // Bloqueada pelo instrutor: a caixa continua visível e continua refletindo a
  // escolha do aluno, mas não responde. Some seria pior — ele não saberia que
  // a camada existe nem por que sumiu.
  check.disabled = !pode(registro.chave);
  check.addEventListener('change', () => {
    registro.querVer = check.checked;
    aplicarVisibilidade(registro);
    guardarPreferencias(registro);
    statusContagem();
  });

  const dot = document.createElement('span');
  dot.className = 'cam-dot';
  dot.style.background = registro.cor;

  const nome = document.createElement('span');
  nome.className = 'cam-nome';
  nome.textContent = registro.nome;      // nome de arquivo é dado de fora: textContent
  nome.title = registro.nome;

  topo.append(check, dot, nome);

  // Seletor de cor: três bolinhas, de CORES_CAMADA (kml.js). Substituiu a
  // opacidade como controle PRINCIPAL da linha porque é o que muda a leitura
  // de um calco sobre a carta — a opacidade continua existindo, agora atrás
  // do botão de detalhe logo abaixo.
  const cores = document.createElement('span');
  cores.className = 'cam-cores';
  for (const opcao of CORES_CAMADA) {
    const bolinha = document.createElement('button');
    bolinha.type = 'button';
    bolinha.className = 'cam-cor';
    if (registro.corForcada && registro.cor.toLowerCase() === opcao.valor.toLowerCase()) {
      bolinha.classList.add('ativa');
    }
    bolinha.style.background = opcao.valor;
    bolinha.title = `Cor ${opcao.nome}`;
    bolinha.setAttribute('aria-label', `Cor ${opcao.nome}`);
    bolinha.addEventListener('click', () => {
      registro.cor = opcao.valor;
      registro.corForcada = true;
      if (registro.layer) registro.layer.setStyle(estiloDaFeicao(registro));
      guardarPreferencias(registro);
      redesenharListas();
    });
    cores.appendChild(bolinha);
  }
  topo.appendChild(cores);

  const subir = document.createElement('button');
  subir.type = 'button';
  subir.className = 'cam-mini';
  subir.textContent = '▲';
  subir.title = 'Trazer para cima';
  subir.disabled = indice === 0;
  subir.addEventListener('click', () => trocarOrdem(registro, -1));

  const descer = document.createElement('button');
  descer.type = 'button';
  descer.className = 'cam-mini';
  descer.textContent = '▼';
  descer.title = 'Mandar para baixo';
  descer.disabled = indice === total - 1;
  descer.addEventListener('click', () => trocarOrdem(registro, 1));

  topo.append(subir, descer);

  if (registro.origem === 'local') {
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'cam-mini';
    fechar.textContent = '×';
    fechar.title = 'Tirar esta camada';
    fechar.addEventListener('click', () => descartar(registro.id));
    topo.append(fechar);
  }

  // Botão de detalhe: a opacidade deixou de ser o controle principal da linha
  // (a cor tomou o lugar) e passou a viver aqui atrás. Continua útil para ler
  // a carta por baixo do calco — só não merecia uma linha inteira do painel
  // em cada camada, num celular.
  const detalhe = document.createElement('button');
  detalhe.type = 'button';
  detalhe.className = 'cam-mini';
  detalhe.textContent = '⋯';
  detalhe.title = 'Opacidade';
  topo.appendChild(detalhe);

  linha.appendChild(topo);

  const faixa = document.createElement('div');
  faixa.className = 'cam-opacidade';
  faixa.hidden = true;
  detalhe.addEventListener('click', () => { faixa.hidden = !faixa.hidden; });
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0'; range.max = '100'; range.step = '5';
  range.value = String(Math.round(registro.opacidade * 100));
  range.title = 'Opacidade';
  const pct = document.createElement('span');
  pct.className = 'cam-pct';
  pct.textContent = `${range.value}%`;
  range.addEventListener('input', () => {
    registro.opacidade = Number(range.value) / 100;
    pct.textContent = `${range.value}%`;
    aplicarOpacidade(registro);
    guardarPreferencias(registro);
  });
  faixa.append(range, pct);
  linha.appendChild(faixa);

  if (registro.meta) {
    const meta = document.createElement('div');
    meta.className = 'cam-meta';
    meta.textContent = registro.meta;
    linha.appendChild(meta);
  }

  return linha;
}

function trocarOrdem(registro, direcao) {
  const lista = [...camadas.values()]
    .filter((c) => c.origem === registro.origem)
    .sort((a, b) => a.ordem - b.ordem);
  const i = lista.indexOf(registro);
  const j = i + direcao;
  if (j < 0 || j >= lista.length) return;
  const trocada = lista[j].ordem;
  lista[j].ordem = registro.ordem;
  registro.ordem = trocada;
  aplicarOrdem();
  guardarPreferencias(registro);
  guardarPreferencias(lista[j]);
  redesenharListas();
}

function preencherLista(elementoId, origem, textoVazio) {
  const alvo = document.getElementById(elementoId);
  if (!alvo) return;
  alvo.textContent = '';
  const lista = [...camadas.values()]
    .filter((c) => c.origem === origem)
    .sort((a, b) => b.ordem - a.ordem); // topo da lista = topo do mapa
  if (lista.length === 0) {
    if (textoVazio) {
      const vazio = document.createElement('span');
      vazio.className = 'cam-vazio';
      vazio.textContent = textoVazio;
      alvo.appendChild(vazio);
    }
    return;
  }
  lista.forEach((registro, i) => alvo.appendChild(linhaDaCamada(registro, i, lista.length)));
}

function redesenharListas() {
  preencherLista('cam-lista-calcos', 'calco', 'Nenhum publicado.');
  preencherLista('cam-lista-local', 'local', '');
}

function mensagemLocal(texto, tipo) {
  const alvo = document.getElementById('cam-local-mensagem');
  if (!alvo) return;
  alvo.textContent = '';
  if (!texto) return;
  const div = document.createElement('div');
  div.className = tipo === 'erro' ? 'cam-erro' : 'cam-aviso';
  div.textContent = texto;   // pode conter nome de arquivo: textContent
  alvo.appendChild(div);
}

// ── Upload local ─────────────────────────────────────────────────────────
function montarControlesLocais() {
  const alvo = document.getElementById('cam-local-controles');
  if (!alvo) return;
  alvo.textContent = '';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.kml,.kmz';
  input.multiple = true;
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const arquivos = [...input.files];
    input.value = '';   // permite reabrir o MESMO arquivo depois de descartado
    for (const arquivo of arquivos) await carregarArquivoLocal(arquivo);
  });

  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'cam-botao';
  botao.id = 'cam-abrir';
  botao.textContent = 'Abrir arquivo KML/KMZ…';
  botao.addEventListener('click', () => input.click());

  alvo.append(botao, input);
  aplicarPermissaoLocal();
}

// `carregar_kml` nasce com `padrao = false` no catálogo (0001), então o estado
// NORMAL de um aluno recém-cadastrado é este: desligado. Um botão que some
// pareceria app quebrado, e um botão que some sem explicação é pior ainda —
// ele nem saberia que a função existe para pedir ao instrutor. Por isso o
// controle continua na tela, desabilitado, com a frase dizendo de onde vem o
// bloqueio.
function aplicarPermissaoLocal() {
  const botao = document.getElementById('cam-abrir');
  const liberado = pode('carregar_kml');
  if (botao) {
    botao.disabled = !liberado;
    botao.textContent = liberado
      ? 'Abrir arquivo KML/KMZ…'
      : 'Abrir arquivo KML/KMZ (bloqueado)';
  }
  if (!liberado) {
    mensagemLocal(
      'Carregar arquivo próprio está desabilitado pelo instrutor. '
      + 'Esta função vem desligada por padrão — peça a ele para liberar no painel, '
      + 'que ela aparece aqui sem você precisar recarregar a página.'
    );
  } else {
    mensagemLocal('');
  }
}

// Monta a camada local a partir de um resultado já processado. Compartilhado
// entre "o aluno acabou de escolher o arquivo" e "restaurando o que estava
// guardado no aparelho" — os dois chegam aqui com o mesmo formato, e por isso
// uma camada restaurada é indistinguível de uma recém-aberta.
function montarCamadaLocal({ id, nome, resultado, opacidade, ordem, querVer, cor, corForcada }) {
  const registro = novoRegistro({
    id,
    nome,
    origem: 'local',
    chave: 'carregar_kml',
    meta: descreverCarga(resultado),
    opacidade,
    ordem,
    querVer,
    cor,
  });
  registro.corForcada = !!corForcada;
  camadas.set(registro.id, registro);
  construirCamada(registro, resultado.geojson);
  aplicarOpacidade(registro);
  aplicarOrdem();
  aplicarVisibilidade(registro);
  statusContagem();
  redesenharListas();
  return registro;
}

// ── Restauração no boot ──────────────────────────────────────────────────
// Reprocessa os bytes guardados. É mais caro do que guardar o GeoJSON pronto,
// e é de propósito (ver o comentário de LIMITE_GUARDADO_BYTES em kml.js): os
// limites e a tolerância de simplificação de hoje valem para o arquivo que o
// aluno guardou semana passada.
//
// O efeito colateral disso precisa ser tratado, e é o `if` de baixo: se os
// limites ficarem MAIS estritos, um arquivo aceito antes pode ser recusado
// agora. Nesse caso ele sai do aparelho e o aluno é avisado — deixá-lo
// guardado seria manter um arquivo que nunca mais vai abrir, gastando espaço
// e tempo de boot toda vez.
async function restaurarGuardados() {
  const guardados = await listarArquivos(meuUserId);
  if (guardados.length === 0) return;

  const recusados = [];
  for (const item of guardados) {
    let resultado;
    try {
      resultado = await lerArquivoKml(item.bytes, `x.${item.formato}`);
    } catch (e) {
      resultado = { acao: 'recusado', motivo: e.message };
    }
    if (resultado.acao === 'recusado') {
      recusados.push(item.nome);
      await removerArquivo(item.id);
      continue;
    }
    const registro = montarCamadaLocal({
      id: item.id,
      nome: item.nome,
      resultado,
      opacidade: item.opacidade,
      ordem: item.ordem,
      querVer: item.querVer,
      cor: item.cor,
      corForcada: item.corForcada,
    });
    registro.guardado = true;
  }

  if (recusados.length) {
    mensagemLocal(
      `Não foi possível reabrir: ${recusados.join(', ')}. `
      + 'O arquivo foi retirado do aparelho — carregue de novo se ainda precisar dele.',
      'erro'
    );
  }
}

async function carregarArquivoLocal(arquivo) {
  // Checagem na hora do uso, não uma cópia guardada: se a permissão caiu entre
  // abrir o seletor de arquivos e escolher, o certo é não carregar. Mesma
  // disciplina de podeCriar() em marcacoes.js.
  if (!pode('carregar_kml')) {
    mensagemLocal('O instrutor desabilitou o carregamento de arquivos.', 'erro');
    return;
  }

  const valido = validarArquivo({ nome: arquivo.name, tamanho: arquivo.size });
  if (!valido.ok) {
    mensagemLocal(`${arquivo.name}: ${valido.motivo}`, 'erro');
    return;
  }

  mensagemLocal(`Lendo ${arquivo.name} (${formatarBytes(arquivo.size)})…`);
  let bytes;
  let resultado;
  try {
    bytes = await arquivo.arrayBuffer();
    resultado = await lerArquivoKml(bytes, arquivo.name);
  } catch (e) {
    mensagemLocal(`${arquivo.name}: falha ao ler (${e.message}).`, 'erro');
    return;
  }

  if (resultado.acao === 'recusado') {
    mensagemLocal(`${arquivo.name}: ${resultado.motivo}`, 'erro');
    return;
  }

  const registro = montarCamadaLocal({
    id: crypto.randomUUID(),
    nome: nomeDeCamada(arquivo.name),
    resultado,
  });
  enquadrar(registro);

  const recadoGuardar = await tentarGuardar(registro, arquivo, bytes);

  // Simplificação é mexer no dado, então é dita em voz alta — nunca em
  // silêncio. Mesma postura da Etapa 6b, onde o debriefing avisa quantas
  // leituras cada ponto representa em vez de mostrar um rastro amostrado com
  // cara de completo.
  const recadoSimplificar = resultado.acao === 'simplificado'
    ? `${arquivo.name}: carregado com a geometria simplificada a ${resultado.toleranciaM} m `
      + `(${resultado.antes.vertices.toLocaleString('pt-BR')} vértices → `
      + `${resultado.depois.vertices.toLocaleString('pt-BR')}) para o mapa não travar.`
    : '';

  const recado = [recadoSimplificar, recadoGuardar].filter(Boolean).join(' ');
  mensagemLocal(recado, recadoGuardar ? 'aviso' : '');
}

// Guarda os bytes ORIGINAIS no aparelho. Devolve '' quando deu certo, ou a
// frase a mostrar quando não deu.
//
// Falhar aqui NÃO é falhar em carregar: a camada já está no mapa e continua
// lá. O que se perde é sobreviver ao F5, e é isso — e só isso — que a
// mensagem diz. Confundir as duas coisas faria o aluno achar que o arquivo
// não abriu, quando ele está bem na frente dele.
async function tentarGuardar(registro, arquivo, bytes) {
  const guardados = await listarArquivos(meuUserId);
  const plano = planejarGuardar(guardados, { tamanho: arquivo.size });
  if (!plano.ok) return plano.motivo;

  const ok = await guardarArquivo({
    id: registro.id,
    usuario_id: meuUserId,
    nome: registro.nome,
    formato: arquivo.name.toLowerCase().endsWith('.kmz') ? 'kmz' : 'kml',
    tamanho: arquivo.size,
    bytes,
    opacidade: registro.opacidade,
    ordem: registro.ordem,
    querVer: registro.querVer,
  });
  if (!ok) {
    return 'Não foi possível guardar este arquivo no aparelho (armazenamento indisponível ou cheio). '
         + 'Ele continua no mapa nesta sessão, mas some ao recarregar a página.';
  }
  registro.guardado = true;
  return '';
}

function descreverCarga(resultado) {
  const f = resultado.antes.feicoes.toLocaleString('pt-BR');
  const base = `${f} feição${resultado.antes.feicoes === 1 ? '' : 'ões'}`;
  return resultado.acao === 'simplificado' ? `${base} · simplificado a ${resultado.toleranciaM} m` : base;
}

// Enquadra só o arquivo LOCAL, e só quando ele tem extensão válida. O calco do
// instrutor não move a câmera de propósito: ele pode chegar por Realtime no
// meio do exercício, e arrastar o mapa de 60 alunos para outro lugar enquanto
// eles estão olhando a própria posição seria hostil.
function enquadrar(registro) {
  try {
    const limites = registro.layer.getBounds();
    if (limites.isValid()) mapaRef.fitBounds(limites, { padding: [40, 40] });
  } catch (e) { /* geometria sem extensão utilizável — deixa a câmera onde está */ }
}

// ── Calcos do instrutor ──────────────────────────────────────────────────
async function desenharCalco(linha) {
  const existente = camadas.get(linha.id);
  if (existente) {
    // Já está no mapa: o instrutor mudou nome/cor/ordem/opacidade padrão, não
    // os bytes (trocar o arquivo é publicar outro calco). Não vale baixar de
    // novo — só atualizar o que mudou.
    existente.nome = linha.nome;
    // A cor padrão do instrutor só vale enquanto o aluno não escolheu a dele.
    // Sem esta guarda, o instrutor renomear o calco desfaria a escolha de cor
    // de todo mundo que já tinha ajustado.
    if (!existente.corForcada) existente.cor = linha.cor;
    existente.chave = linha.categoria;
    if (existente.layer) existente.layer.setStyle(estiloDaFeicao(existente));
    aplicarVisibilidade(existente);
    redesenharListas();
    return;
  }

  const registro = novoRegistro({
    id: linha.id,
    nome: linha.nome,
    origem: 'calco',
    chave: linha.categoria,
    cor: linha.cor,
    meta: `${ROTULO_CATEGORIA[linha.categoria] || linha.categoria} · ${formatarBytes(linha.tamanho_bytes)}`,
  });
  registro.opacidade = Number.isFinite(linha.opacidade) ? linha.opacidade : 1;
  camadas.set(registro.id, registro);
  redesenharListas();

  const { erro, bytes } = await baixarCalco(linha.caminho);
  if (erro) {
    console.warn('Falha ao baixar calco', linha.nome, erro);
    registro.meta = 'não foi possível baixar este calco';
    redesenharListas();
    return;
  }

  const resultado = await lerArquivoKml(bytes, `x.${linha.formato}`);
  if (resultado.acao === 'recusado') {
    console.warn('Calco recusado no cliente:', linha.nome, resultado.motivo);
    registro.meta = resultado.motivo;
    redesenharListas();
    return;
  }

  registro.meta = `${ROTULO_CATEGORIA[linha.categoria] || linha.categoria} · ${descreverCarga(resultado)}`;
  construirCamada(registro, resultado.geojson);
  aplicarOpacidade(registro);
  aplicarOrdem();
  aplicarVisibilidade(registro);
  statusContagem();
  redesenharListas();
}

async function carregarCalcosIniciais(turmaId) {
  const linhas = await buscarCalcosDaTurma(turmaId);
  if (linhas === null) {
    status('não foi possível ler os calcos', '#f5c842');
    return;
  }
  // Em série, de propósito: 4 downloads simultâneos no 4G do campo competem
  // pela mesma banda e todos ficam lentos. Um de cada vez, a primeira camada
  // aparece antes.
  for (const linha of linhas) await desenharCalco(linha);
  statusContagem();
}

// ── Ponto de entrada ─────────────────────────────────────────────────────
// map: instância do Leaflet, passada explicitamente (mesmo padrão de gps.js,
//      colegas.js e marcacoes.js).
// userId/turmaId/perfil: como nos outros módulos.
//
// Precisa rodar DEPOIS de `await iniciarPermissoes()` em index.html, como os
// demais: o primeiro observarPermissao() já recebe o valor real e nada pisca
// na tela antes de sumir.
export async function iniciarCamadas({ map, userId, turmaId, container }) {
  mapaRef = map;
  meuUserId = userId || null;
  turmaIdRef = turmaId || null;
  if (container) seletorContainer = container;

  raizPainel = montarPainel();
  if (!raizPainel) return;
  montarControlesLocais();

  // As cinco chaves entram como observadores, não como leitura única: quando o
  // instrutor mexe no painel, a reação é imediata e sem recarregar a página.
  // `carregar_kml` mexe em duas coisas — o botão e as camadas locais já
  // abertas —, e as camadas locais saem do mapa mas FICAM na memória, para
  // religar devolver o que o aluno tinha. Isso é essencial aqui, mais até do
  // que em marcacoes.js: o navegador não guarda o arquivo escolhido, então
  // descartar a camada significaria pedir para o aluno procurar o arquivo de
  // novo no meio do exercício.
  observarPermissao('carregar_kml', () => {
    aplicarPermissaoLocal();
    reavaliarTudo();
  });
  for (const chave of CHAVES_DE_CATEGORIA) {
    observarPermissao(chave, () => reavaliarTudo());
  }

  // Os arquivos guardados voltam ANTES dos calcos: são do próprio aluno, já
  // estão no aparelho e não dependem de rede — não faz sentido ele esperar um
  // download para rever o que já era dele. `pedirDurabilidade()` não é
  // aguardado porque o resultado não muda nada do que acontece a seguir.
  pedirDurabilidade();
  await restaurarGuardados();

  if (!turmaIdRef) {
    // Sem turma não há calco para buscar (a policy `calcos_ler` não devolveria
    // nada mesmo). O arquivo local continua funcionando: ele não depende de
    // turma nenhuma. Mesma postura de gps.js/colegas.js — não assina canal à
    // toa, mas também não desliga o que funciona sem turma.
    status('sem turma — só arquivos próprios', '#f5c842');
    redesenharListas();
    return;
  }

  status('carregando…');
  await carregarCalcosIniciais(turmaIdRef);

  // Select inicial primeiro, assinatura depois: o Realtime não faz backfill.
  // Mesma ordem de colegas.js e marcacoes.js.
  canalCalcos = assinarCalcos(turmaIdRef, {
    aoMudar: (linha) => desenharCalco(linha),
    aoSair: (id) => descartar(id),
  });

  window.addEventListener('beforeunload', pararCamadas);
}

// Trocar a turma no seletor do painel do instrutor (Etapa 6c). Os CALCOS são
// por turma e trocam inteiros; os arquivos LOCAIS ficam — eles são do usuário,
// não da turma, e tirá-los do mapa porque ele olhou outra turma seria
// arbitrário.
//
// Não existe equivalente disto no app do aluno: ele tem uma turma só, e
// trocar de turma lá já recarrega a página.
export async function definirTurmaCamadas(turmaId) {
  const novo = turmaId || null;
  if (novo === turmaIdRef) return;
  turmaIdRef = novo;

  if (canalCalcos) { desassinarCalcos(canalCalcos); canalCalcos = null; }
  for (const registro of [...camadas.values()]) {
    if (registro.origem === 'calco') descartar(registro.id);
  }

  if (!turmaIdRef) { statusContagem(); return; }

  await carregarCalcosIniciais(turmaIdRef);
  canalCalcos = assinarCalcos(turmaIdRef, {
    aoMudar: (linha) => desenharCalco(linha),
    aoSair: (id) => descartar(id),
  });
}

export function pararCamadas() {
  if (canalCalcos) {
    desassinarCalcos(canalCalcos);
    canalCalcos = null;
  }
}
