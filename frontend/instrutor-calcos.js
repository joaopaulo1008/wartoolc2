// instrutor-calcos.js — Etapa 7 do roadmap: aba de publicação de calcos.
// Etapa 8b: o mesmo formulário passou a publicar também imagem
// georreferenciada (foto aérea/carta atualizada), além de KML/KMZ.
//
// Mesma separação de sempre entre regra e tela: `calcos.js` é o que fala com
// o banco e com o Storage (e é compartilhado com o app do aluno), este
// arquivo é só a interface do instrutor — exatamente como `permissoes.js` e
// `instrutor-permissoes.js` na Etapa 6a. A parte pura de imagem (validar
// tamanho, validar bounds, calcular egress) mora em `frontend/imagem-geo.js`
// — este arquivo só chama, não decide.
//
// O que esta tela faz, e por que cada campo existe:
//
//   ARQUIVO      — .kml/.kmz OU .jpg/.png. É LIDO E CONFERIDO NO NAVEGADOR
//                  ANTES DE SUBIR nos dois casos: para KML, número de
//                  feições/vértices e se cabe (como desde a Etapa 7); para
//                  imagem, se cabe no teto de 3 MB e a conta de egress
//                  (frontend/imagem-geo.js, decisão 3 da Etapa 8b) — assim o
//                  instrutor decide consciente ANTES de gastar o upload, não
//                  depois de já ter subido um arquivo grande.
//   CATEGORIA    — a chave de permissão que vai mandar nesta camada. Mesma
//                  coisa para os dois formatos: é por isso que
//                  `camada_logistica`/`camada_obstaculos` (Etapa 7) e agora
//                  a imagem georreferenciada não precisaram de chave nova
//                  nenhuma no catálogo (decisão 1 da Etapa 8b).
//   PARA QUEM    — turma inteira (partido nulo) ou só um partido. É o que
//                  impede o calco de manobra do Azul de aparecer para o
//                  Vermelho. A RLS (`calcos_ler`, migration 0006) é a barreira
//                  de verdade; este seletor é como ela é alimentada.
//   COR          — só para KML/KMZ: a cor de traço padrão para as feições
//                  que não trouxerem estilo próprio no arquivo. Raster não
//                  tem stroke/fill por feição, então este campo some quando
//                  o arquivo escolhido é imagem (ver atualizarModoFormulario).
//   BOUNDS       — só para imagem: os dois cantos (noroeste/sudeste) que o
//                  instrutor marca no mini-mapa desta própria tela, dois
//                  cliques, sem plugin — mesmo espírito de
//                  `iniciarDesenhoRetangulo()` em frontend/offline-tela.js
//                  (decisão 2 da Etapa 8b: bounds retangulares bastam; ver o
//                  comentário grande no topo de frontend/imagem-geo.js).
//   OPACIDADE    — só para imagem: sugestão do instrutor (decisão 5 da Etapa
//                  8b — reintroduzida SÓ para raster, KML/KMZ continua
//                  exatamente como a Etapa 8a deixou).
//
// ~~OPACIDADE (para KML/KMZ)~~ RETIRADA na Etapa 8a, a pedido de quem usa:
// opacidade não fazia sentido para calco/traçado tático (o que importa é cor
// + ligar/desligar). A coluna `calcos.opacidade` continua existindo no banco
// e `publicarCalco()`/`atualizarCalco()` continuam aceitando o campo — só a
// INTERFACE que o expunha para KML (aqui e em `frontend/camadas.js`) foi
// removida. A Etapa 8b NÃO mexeu nisso: o campo de opacidade que existe hoje
// nesta tela é NOVO e exclusivo de imagem, não uma reintrodução do antigo.
//
// Publicar remove o calco anterior? NÃO. Cada publicação é um calco novo. Se
// o instrutor quer trocar o arquivo, ele remove o antigo e publica outro —
// substituir bytes por baixo de uma linha existente faria o aluno que já
// baixou continuar com a versão velha até recarregar, sem saber disso.

import { traduzirErro, buscarPartidosDaTurma } from './auth.js';
import {
  CATEGORIAS, ROTULO_CATEGORIA,
  buscarCalcosDaTurma, publicarCalco, removerCalco,
  assinarCalcos, desassinarCalcos,
} from './calcos.js';
import {
  validarArquivo, formatoDoArquivo, nomeDeCamada, formatarBytes,
  CORES_CAMADA, COR_CAMADA_PADRAO,
} from './kml.js';
import { lerArquivoKml } from './kml-navegador.js';
import {
  validarArquivoImagem, formatoDoArquivoImagem, validarBounds, textoEgress,
} from './imagem-geo.js';
import { criarBasemaps, BASEMAP_PADRAO } from './basemaps.js';

// ── Estado ───────────────────────────────────────────────────────────────
let meuUserId = null;
let turmaAtual = null;
let canal = null;
let partidos = [];
const linhas = new Map();      // id -> row de calcos

// Arquivo já escolhido e já conferido, aguardando o clique em Publicar.
// Guardar o resultado da conferência (e não só o arquivo) é o que evita
// parsear duas vezes o mesmo KML de vários MB, ou revalidar a imagem à toa.
//
// Formato do objeto:
//   KML/KMZ: { arquivo, formato: 'kml'|'kmz', resultado }
//   IMAGEM:  { arquivo, formato: 'jpg'|'png', bounds: {norte,sul,leste,oeste}|null }
let preparado = null;

const el = (id) => document.getElementById(id);

function aviso(texto, tipo) {
  const alvo = el('calcos-aviso');
  if (!alvo) return;
  alvo.textContent = texto || '';   // pode trazer nome de arquivo: textContent
  alvo.className = `painel-aviso ${tipo === 'erro' ? 'erro' : 'info'}`;
  alvo.style.display = texto ? 'block' : 'none';
}

// ── Formulário: campos comuns aos dois formatos ──────────────────────────
// Cor escolhida no formulário. Não fica num <input type=color> porque as
// opções são três e fixas — ver o comentário de CORES_CAMADA em kml.js.
// Só usada quando o arquivo preparado é KML/KMZ.
let corEscolhida = COR_CAMADA_PADRAO;

function montarSeletorDeCor() {
  const alvo = el('calco-cores');
  if (!alvo || alvo.childElementCount > 0) return;
  for (const opcao of CORES_CAMADA) {
    const bolinha = document.createElement('button');
    bolinha.type = 'button';
    bolinha.className = 'campo-cor';
    bolinha.style.background = opcao.valor;
    bolinha.title = opcao.nome;
    bolinha.setAttribute('aria-label', `Cor ${opcao.nome}`);
    if (opcao.valor === corEscolhida) bolinha.classList.add('ativa');
    bolinha.addEventListener('click', () => {
      corEscolhida = opcao.valor;
      alvo.querySelectorAll('.campo-cor').forEach((b) => b.classList.toggle('ativa', b === bolinha));
    });
    alvo.appendChild(bolinha);
  }
}

function montarFormulario() {
  montarSeletorDeCor();
  const selCategoria = el('calco-categoria');
  if (selCategoria && selCategoria.options.length === 0) {
    for (const c of CATEGORIAS) {
      const opt = document.createElement('option');
      opt.value = c.chave;
      opt.textContent = c.rotulo;
      selCategoria.appendChild(opt);
    }
  }
  atualizarPartidos();
}

function atualizarPartidos() {
  const sel = el('calco-partido');
  if (!sel) return;
  sel.textContent = '';
  const todos = document.createElement('option');
  todos.value = '';
  todos.textContent = 'Turma inteira (os dois partidos)';
  sel.appendChild(todos);
  for (const p of partidos) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `Só ${p.nome}`;
    sel.appendChild(opt);
  }
}

// Mostra/esconde os blocos que só fazem sentido para UM dos dois formatos.
// 'kml'/'kmz' -> mostra cor, esconde imagem; 'jpg'/'png' -> o inverso;
// null (nenhum arquivo escolhido ainda) -> esconde os dois.
function atualizarModoFormulario(formato) {
  const ehImagem = formato === 'jpg' || formato === 'png';
  const ehVetor = formato === 'kml' || formato === 'kmz';
  const campoCor = el('calco-cor-campo');
  const painelImagem = el('calco-imagem-painel');
  if (campoCor) campoCor.hidden = !ehVetor;
  if (painelImagem) painelImagem.hidden = !ehImagem;
  if (!ehImagem) pararDesenho();
}

// ── Conferência de KML/KMZ (Etapa 7, inalterada) ─────────────────────────
async function conferirArquivo(arquivo) {
  preparado = null;
  el('calco-publicar').disabled = true;
  atualizarModoFormulario('kml');

  const valido = validarArquivo({ nome: arquivo.name, tamanho: arquivo.size }, { compartilhado: true });
  if (!valido.ok) {
    aviso(`${arquivo.name}: ${valido.motivo}`, 'erro');
    return;
  }

  aviso(`Conferindo ${arquivo.name} (${formatarBytes(arquivo.size)})…`);
  let resultado;
  try {
    resultado = await lerArquivoKml(await arquivo.arrayBuffer(), arquivo.name);
  } catch (e) {
    aviso(`${arquivo.name}: falha ao ler (${e.message}).`, 'erro');
    return;
  }

  if (resultado.acao === 'recusado') {
    aviso(`${arquivo.name}: ${resultado.motivo}`, 'erro');
    return;
  }

  preparado = { arquivo, formato: valido.formato, resultado };
  const campoNome = el('calco-nome');
  if (campoNome && !campoNome.value.trim()) campoNome.value = nomeDeCamada(arquivo.name);
  el('calco-publicar').disabled = false;

  const f = resultado.antes.feicoes.toLocaleString('pt-BR');
  const v = resultado.antes.vertices.toLocaleString('pt-BR');
  aviso(
    resultado.acao === 'simplificado'
      ? `Pronto: ${f} feições, ${v} vértices. No aparelho do aluno a geometria será `
        + `simplificada a ${resultado.toleranciaM} m (${resultado.depois.vertices.toLocaleString('pt-BR')} vértices) `
        + `para o mapa não travar — o arquivo publicado continua sendo o original.`
      : `Pronto para publicar: ${f} feições, ${v} vértices, ${formatarBytes(arquivo.size)}.`
  );
}

// ── Conferência de imagem georreferenciada (Etapa 8b) ────────────────────

// Mini-mapa próprio desta aba, só para o instrutor marcar os dois cantos —
// mesma decisão de sempre no painel do instrutor (situacao.js/debriefing.js):
// cada seção mantém a PRÓPRIA instância de Leaflet, em vez de emprestar a de
// outra aba (que teria que ser reconstruída/limpa a cada troca). Montado só
// na primeira vez que uma imagem é escolhida — a maioria das publicações
// continua sendo KML/KMZ, então não faz sentido pagar o custo do mapa à toa.
let mapaImagem = null;
let desenhoAtivo = null;         // { cancelar } de iniciarDesenhoBoundsImagem
let overlayPreviewImagem = null; // L.imageOverlay local, só para conferência visual
let urlPreviewImagem = null;     // Object URL revogado ao trocar/limpar

function garantirMapaImagem() {
  const container = el('calco-imagem-mapa');
  if (!container) return null;
  if (mapaImagem) {
    setTimeout(() => mapaImagem.invalidateSize(), 0);
    return mapaImagem;
  }
  const basemaps = criarBasemaps();
  mapaImagem = L.map(container, { center: [-22, -47], zoom: 13 });
  basemaps[BASEMAP_PADRAO].addTo(mapaImagem);
  return mapaImagem;
}

// Mesmo mecanismo de iniciarDesenhoRetangulo() em frontend/offline-tela.js
// (dois cliques, prévia até o segundo, Esc cancela, sem plugin) — não
// importado de lá de propósito: são dois consumidores, e o prompt de
// abertura desta etapa pede para não tocar na arquitetura da 8a além do
// estritamente necessário. Pequena duplicação deliberada, mesmo critério já
// registrado em icones.js/marcacoes.js: extrair um terceiro lugar comum vale
// a pena quando aparecer um TERCEIRO consumidor, não no segundo.
//
// Diferença desta versão: devolve o retângulo já normalizado como
// {norte,sul,leste,oeste} (o formato que validarBounds()/publicarCalco()
// esperam), não um bbox — cada chamador usa o formato que faz sentido para
// ele.
function iniciarDesenhoBoundsImagem(map, aoConcluir) {
  let cantoA = null;
  let retanguloPreview = null;
  const cursorOriginal = map.getContainer().style.cursor;
  map.getContainer().style.cursor = 'crosshair';
  map.dragging.disable();

  function desenharPreview(latlngB) {
    if (retanguloPreview) map.removeLayer(retanguloPreview);
    retanguloPreview = L.rectangle([cantoA, latlngB], {
      color: '#f5c842', weight: 2, fillOpacity: 0.08, dashArray: '4 4',
    }).addTo(map);
  }
  function aoMover(ev) { if (cantoA) desenharPreview(ev.latlng); }
  function aoClicar(ev) {
    if (!cantoA) { cantoA = ev.latlng; desenharPreview(ev.latlng); return; }
    finalizar(ev.latlng);
  }
  function aoTeclar(ev) { if (ev.key === 'Escape') cancelar(); }

  function pararDeOuvir() {
    map.off('click', aoClicar);
    map.off('mousemove', aoMover);
    document.removeEventListener('keydown', aoTeclar);
    map.getContainer().style.cursor = cursorOriginal;
    map.dragging.enable();
  }
  function cancelar() {
    pararDeOuvir();
    if (retanguloPreview) { map.removeLayer(retanguloPreview); retanguloPreview = null; }
    aoConcluir(null);
  }
  function finalizar(latlngB) {
    pararDeOuvir();
    if (retanguloPreview) { map.removeLayer(retanguloPreview); retanguloPreview = null; }
    aoConcluir({
      norte: Math.max(cantoA.lat, latlngB.lat),
      sul: Math.min(cantoA.lat, latlngB.lat),
      leste: Math.max(cantoA.lng, latlngB.lng),
      oeste: Math.min(cantoA.lng, latlngB.lng),
    });
  }

  map.on('click', aoClicar);
  map.on('mousemove', aoMover);
  document.addEventListener('keydown', aoTeclar);

  return { cancelar };
}

function pararDesenho() {
  if (desenhoAtivo) { desenhoAtivo.cancelar(); desenhoAtivo = null; }
}

function limparPreviewOverlay() {
  if (overlayPreviewImagem && mapaImagem) { mapaImagem.removeLayer(overlayPreviewImagem); }
  overlayPreviewImagem = null;
  if (urlPreviewImagem) { URL.revokeObjectURL(urlPreviewImagem); urlPreviewImagem = null; }
}

// Depois dos dois cliques: guarda os bounds em `preparado`, libera Publicar
// e desenha a PRÓPRIA imagem escolhida sobre o retângulo — não só um
// retângulo vazio — para o instrutor conferir visualmente se o
// enquadramento bate antes de publicar. É a mesma ideia de "mostrar antes de
// gastar" que já vale para o tamanho/egress, aplicada ao georreferenciamento.
function aoConcluirDesenho(bounds) {
  desenhoAtivo = null;
  const status = el('calco-imagem-status');

  if (!bounds || !preparado) {
    if (status) status.textContent = 'Desenho cancelado — clique em "Marcar cantos no mapa" para tentar de novo.';
    return;
  }

  const validado = validarBounds(bounds);
  if (!validado.ok) {
    if (status) status.textContent = `${validado.motivo} Clique em "Marcar cantos no mapa" para tentar de novo.`;
    el('calco-publicar').disabled = true;
    return;
  }

  preparado.bounds = validado.bounds;
  el('calco-publicar').disabled = false;

  limparPreviewOverlay();
  const b = validado.bounds;
  const leafletBounds = L.latLngBounds([b.sul, b.oeste], [b.norte, b.leste]);
  urlPreviewImagem = URL.createObjectURL(preparado.arquivo);
  overlayPreviewImagem = L.imageOverlay(urlPreviewImagem, leafletBounds, {
    opacity: Number(el('calco-imagem-opacidade')?.value) || 0.85,
    interactive: false,
  }).addTo(mapaImagem);
  mapaImagem.fitBounds(leafletBounds, { padding: [30, 30] });

  if (status) {
    status.textContent = 'Cantos marcados — confira se a imagem cobre a área certa. '
      + '"Marcar cantos no mapa" desenha de novo, se precisar ajustar.';
  }
}

function iniciarDesenhoImagem() {
  pararDesenho();
  const map = garantirMapaImagem();
  if (!map) return;
  const status = el('calco-imagem-status');
  if (status) status.textContent = 'Clique no canto NOROESTE da imagem, depois no canto SUDESTE (Esc cancela).';
  el('calco-publicar').disabled = true;
  desenhoAtivo = iniciarDesenhoBoundsImagem(map, aoConcluirDesenho);
}

function limparEstadoImagem() {
  pararDesenho();
  limparPreviewOverlay();
  const status = el('calco-imagem-status');
  if (status) status.textContent = '';
}

async function conferirImagem(arquivo) {
  preparado = null;
  el('calco-publicar').disabled = true;
  atualizarModoFormulario('imagem-provisorio'); // esconde cor e desenho antigo até validar
  limparEstadoImagem();

  const valido = validarArquivoImagem({ nome: arquivo.name, tamanho: arquivo.size });
  if (!valido.ok) {
    aviso(`${arquivo.name}: ${valido.motivo}`, 'erro');
    atualizarModoFormulario(null);
    return;
  }

  atualizarModoFormulario(valido.formato);
  aviso(textoEgress(arquivo.size));

  preparado = { arquivo, formato: valido.formato, bounds: null };
  const campoNome = el('calco-nome');
  if (campoNome && !campoNome.value.trim()) campoNome.value = nomeDeCamada(arquivo.name);

  const opac = el('calco-imagem-opacidade');
  const opacValor = el('calco-imagem-opacidade-valor');
  if (opac && opacValor) opacValor.textContent = `${Math.round(Number(opac.value) * 100)}%`;

  iniciarDesenhoImagem();
}

// ── Publicar (os dois formatos) ──────────────────────────────────────────
async function publicar() {
  if (!preparado) return;
  if (!turmaAtual) { aviso('Escolha uma turma antes de publicar.', 'erro'); return; }

  const ehImagem = preparado.formato === 'jpg' || preparado.formato === 'png';
  if (ehImagem && !preparado.bounds) {
    aviso('Marque os dois cantos da imagem no mapa antes de publicar.', 'erro');
    return;
  }

  const nome = (el('calco-nome').value || '').trim() || nomeDeCamada(preparado.arquivo.name);
  const botao = el('calco-publicar');
  botao.disabled = true;
  aviso('Publicando…');

  const { erro } = await publicarCalco({
    turmaId: turmaAtual,
    autorId: meuUserId,
    nome,
    categoria: el('calco-categoria').value,
    partidoId: el('calco-partido').value || null,
    formato: preparado.formato,
    arquivo: preparado.arquivo,
    numFeicoes: ehImagem ? 0 : preparado.resultado.antes.feicoes,
    // Cor só importa para KML/KMZ; imagem manda o padrão do banco (o campo
    // nem aparece no formulário quando o arquivo é imagem).
    cor: ehImagem ? undefined : corEscolhida,
    opacidade: ehImagem ? Number(el('calco-imagem-opacidade')?.value) || 0.85 : undefined,
    ordem: linhas.size,
    boundsNorte: ehImagem ? preparado.bounds.norte : undefined,
    boundsSul: ehImagem ? preparado.bounds.sul : undefined,
    boundsLeste: ehImagem ? preparado.bounds.leste : undefined,
    boundsOeste: ehImagem ? preparado.bounds.oeste : undefined,
  });

  if (erro) {
    aviso(`Não foi possível publicar (${traduzirErro(erro)}).`, 'erro');
    botao.disabled = false;
    return;
  }

  // A linha nova chega pelo próprio canal de Realtime que esta tela assina —
  // não precisa (e não deve) ser inserida na lista aqui à mão, ou ela
  // apareceria duas vezes quando o evento chegasse.
  preparado = null;
  el('calco-arquivo').value = '';
  el('calco-nome').value = '';
  atualizarModoFormulario(null);
  limparEstadoImagem();
  aviso(`"${nome}" publicado. Já está aparecendo no app dos alunos.`);
}

// ── Lista dos calcos publicados ──────────────────────────────────────────
function redesenharLista() {
  const alvo = el('calcos-lista');
  if (!alvo) return;
  alvo.textContent = '';

  const lista = [...linhas.values()].sort((a, b) => (a.ordem - b.ordem) || (a.criado_em < b.criado_em ? -1 : 1));
  if (lista.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'grade-sub';
    vazio.textContent = turmaAtual
      ? 'Nenhum calco publicado nesta turma ainda.'
      : 'Escolha uma turma para ver os calcos.';
    alvo.appendChild(vazio);
    return;
  }

  for (const linha of lista) {
    const ehImagem = linha.formato === 'jpg' || linha.formato === 'png';
    const card = document.createElement('div');
    card.className = 'calco-card';

    const topo = document.createElement('div');
    topo.className = 'calco-topo';

    const dot = document.createElement('span');
    dot.className = 'calco-dot';
    // Imagem não tem cor de traço — mesmo neutro usado em camadas.js.
    dot.style.background = ehImagem ? '#5a7a98' : linha.cor;

    const nome = document.createElement('span');
    nome.className = 'calco-nome';
    nome.textContent = linha.nome;      // nome vindo de arquivo: textContent

    const remover = document.createElement('button');
    remover.type = 'button';
    remover.className = 'calco-remover';
    remover.textContent = 'Remover';
    remover.addEventListener('click', () => removerDaLista(linha));

    topo.append(dot, nome, remover);
    card.appendChild(topo);

    const meta = document.createElement('div');
    meta.className = 'calco-meta';
    const partido = linha.partido_id ? partidos.find((p) => p.id === linha.partido_id) : null;
    meta.textContent = [
      ROTULO_CATEGORIA[linha.categoria] || linha.categoria,
      partido ? `só ${partido.nome}` : 'turma inteira',
      ehImagem ? 'imagem georreferenciada' : `${(linha.num_feicoes || 0).toLocaleString('pt-BR')} feições`,
      formatarBytes(linha.tamanho_bytes),
    ].join(' · ');
    card.appendChild(meta);

    // O controle de opacidade padrão para IMAGEM (Etapa 8b) não fica aqui, na
    // lista de já publicados: é ajustável do lado do aluno (camadas.js), e
    // republicar com outra opacidade padrão é a forma de o instrutor mudar a
    // sugestão. Editar aparência de um calco já publicado, sem republicar,
    // não é objetivo desta etapa (nunca foi, nem para cor de KML — ver
    // instrutor-calcos.js da Etapa 7: "Publicar remove o calco anterior? NÃO").

    alvo.appendChild(card);
  }
}

async function removerDaLista(linha) {
  if (!confirm(`Remover "${linha.nome}" do mapa de todos os alunos?\n\nO arquivo é apagado do servidor e não dá para desfazer — para voltar atrás, publique de novo.`)) return;
  const { erro } = await removerCalco({ id: linha.id, caminho: linha.caminho, usuarioId: meuUserId });
  if (erro) { aviso(`Não foi possível remover (${traduzirErro(erro)}).`, 'erro'); return; }
  linhas.delete(linha.id);
  redesenharLista();
  aviso(`"${linha.nome}" removido.`);
}

// ── Turma ────────────────────────────────────────────────────────────────
// Chamada por observarTurma() de instrutor-permissoes.js — o seletor de turma
// é um só na página, pela mesma razão registrada na Etapa 6b: dois seletores
// independentes fariam o instrutor configurar uma turma e publicar em outra.
export async function definirTurmaCalcos(turmaId) {
  turmaAtual = turmaId || null;
  linhas.clear();
  if (canal) { desassinarCalcos(canal); canal = null; }
  partidos = [];

  if (!turmaAtual) { redesenharLista(); atualizarPartidos(); return; }

  partidos = await buscarPartidosDaTurma(turmaAtual);
  atualizarPartidos();

  const lista = await buscarCalcosDaTurma(turmaAtual);
  if (lista === null) {
    aviso('Não foi possível ler os calcos desta turma.', 'erro');
  } else {
    lista.forEach((l) => linhas.set(l.id, l));
  }
  redesenharLista();

  canal = assinarCalcos(turmaAtual, {
    aoMudar: (linha) => { linhas.set(linha.id, linha); redesenharLista(); },
    aoSair: (id) => { linhas.delete(id); redesenharLista(); },
  });
}

// ── Ponto de entrada ─────────────────────────────────────────────────────
export function iniciarPainelCalcos({ userId }) {
  meuUserId = userId;
  montarFormulario();
  atualizarModoFormulario(null);

  el('calco-arquivo')?.addEventListener('change', (ev) => {
    const arquivo = ev.target.files?.[0];
    if (!arquivo) return;
    // Detecta o tipo pelo NOME (mesmo motivo de sempre: o MIME que o
    // navegador reporta para .kmz não é confiável — ver kml.js). KML/KMZ
    // primeiro, imagem depois; se nenhum dos dois reconhecer, avisa e não
    // tenta nada — validarArquivo()/validarArquivoImagem() não são chamadas
    // com um formato que elas próprias já rejeitariam duas vezes.
    if (formatoDoArquivo(arquivo.name)) { conferirArquivo(arquivo); return; }
    if (formatoDoArquivoImagem(arquivo.name)) { conferirImagem(arquivo); return; }
    preparado = null;
    el('calco-publicar').disabled = true;
    atualizarModoFormulario(null);
    aviso(`${arquivo.name}: formato não reconhecido. Aceita .kml, .kmz, .jpg ou .png.`, 'erro');
  });
  el('calco-publicar')?.addEventListener('click', publicar);
  el('calco-imagem-redesenhar')?.addEventListener('click', iniciarDesenhoImagem);
  el('calco-imagem-opacidade')?.addEventListener('input', (ev) => {
    const valor = Number(ev.target.value);
    const rotulo = el('calco-imagem-opacidade-valor');
    if (rotulo) rotulo.textContent = `${Math.round(valor * 100)}%`;
    if (overlayPreviewImagem) overlayPreviewImagem.setOpacity(valor);
  });

  window.addEventListener('beforeunload', () => {
    if (canal) desassinarCalcos(canal);
    pararDesenho();
  });
}
