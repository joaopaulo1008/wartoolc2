// instrutor-calcos.js — Etapa 7 do roadmap: aba de publicação de calcos.
//
// Mesma separação de sempre entre regra e tela: `calcos.js` é o que fala com
// o banco e com o Storage (e é compartilhado com o app do aluno), este
// arquivo é só a interface do instrutor — exatamente como `permissoes.js` e
// `instrutor-permissoes.js` na Etapa 6a.
//
// O que esta tela faz, e por que cada campo existe:
//
//   ARQUIVO      — o .kml/.kmz. É LIDO E CONFERIDO NO NAVEGADOR ANTES DE
//                  SUBIR: número de feições, vértices, e se cabe. Assim o
//                  instrutor descobre que o calco tem 40 mil feições sem
//                  gastar o upload, e sobretudo sem que 60 alunos baixem um
//                  arquivo que vai travar o aparelho deles. Conferir depois
//                  seria conferir tarde.
//   CATEGORIA    — a chave de permissão que vai mandar nesta camada. É por
//                  isso que `camada_logistica` e `camada_obstaculos` deixam de
//                  ser "sem efeito ainda": a camada de logística passa a ser
//                  o calco de logística que o instrutor publicou.
//   PARA QUEM    — turma inteira (partido nulo) ou só um partido. É o que
//                  impede o calco de manobra do Azul de aparecer para o
//                  Vermelho. A RLS (`calcos_ler`, migration 0006) é a barreira
//                  de verdade; este seletor é como ela é alimentada.
//   COR          — a cor de traço padrão para as feições que não trouxerem
//                  estilo próprio no arquivo.
//   OPACIDADE    — sugestão do instrutor. O aluno ajusta na tela dele e isso
//                  NÃO volta para cá: opacidade é preferência de quem olha,
//                  não permissão (a mesma distinção da Etapa 4.5 entre
//                  `preferencias_visualizacao` e as tabelas de permissão).
//
// Publicar remove o calco anterior? NÃO. Cada publicação é um calco novo. Se
// o instrutor quer trocar o arquivo, ele remove o antigo e publica outro —
// substituir bytes por baixo de uma linha existente faria o aluno que já
// baixou continuar com a versão velha até recarregar, sem saber disso.

import { traduzirErro, buscarPartidosDaTurma } from './auth.js';
import {
  CATEGORIAS, ROTULO_CATEGORIA,
  buscarCalcosDaTurma, publicarCalco, removerCalco, atualizarCalco,
  assinarCalcos, desassinarCalcos,
} from './calcos.js';
import {
  validarArquivo, nomeDeCamada, formatarBytes,
  CORES_CAMADA, COR_CAMADA_PADRAO,
} from './kml.js';
import { lerArquivoKml } from './kml-navegador.js';

// ── Estado ───────────────────────────────────────────────────────────────
let meuUserId = null;
let turmaAtual = null;
let canal = null;
let partidos = [];
const linhas = new Map();      // id -> row de calcos

// Arquivo já escolhido e já conferido, aguardando o clique em Publicar.
// Guardar o resultado da conferência (e não só o arquivo) é o que evita
// parsear duas vezes o mesmo KML de vários MB.
let preparado = null;

const el = (id) => document.getElementById(id);

// Mesmo esc() de instrutor-permissoes.js e debriefing.js, agora importado de
// kml.js — mas note que ele quase não é usado nesta tela: tudo que vem de
// arquivo ou de nome digitado é escrito com textContent. Ver a nota sobre isso
// no fim de kml.js.
function aviso(texto, tipo) {
  const alvo = el('calcos-aviso');
  if (!alvo) return;
  alvo.textContent = texto || '';   // pode trazer nome de arquivo: textContent
  alvo.className = `painel-aviso ${tipo === 'erro' ? 'erro' : 'info'}`;
  alvo.style.display = texto ? 'block' : 'none';
}

// ── Formulário ───────────────────────────────────────────────────────────
// Cor escolhida no formulário. Não fica num <input type=color> porque as
// opções são três e fixas — ver o comentário de CORES_CAMADA em kml.js.
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

// Conferência local, antes de qualquer byte subir. Os dois limites que atuam
// aqui são diferentes e os dois importam:
//   * validarArquivo(..., { compartilhado: true }) usa o teto de 2 MB, menor
//     que o do arquivo local do aluno, porque 60 alunos vão baixar este;
//   * lerArquivoKml() aplica os limites de feições/vértices e simplifica se
//     for o caso.
//
// Quando a geometria é simplificada, o que sobe é O ARQUIVO ORIGINAL, não o
// simplificado. É deliberado: simplificar é decisão de RENDERIZAÇÃO, e cada
// aluno a refaz ao abrir — assim o calco guardado continua sendo o que o
// instrutor produziu, e uma tolerância melhor no futuro não exige republicar.
async function conferirArquivo(arquivo) {
  preparado = null;
  el('calco-publicar').disabled = true;

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

async function publicar() {
  if (!preparado) return;
  if (!turmaAtual) { aviso('Escolha uma turma antes de publicar.', 'erro'); return; }

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
    numFeicoes: preparado.resultado.antes.feicoes,
    cor: corEscolhida,
    opacidade: Number(el('calco-opacidade').value) / 100,
    ordem: linhas.size,
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
    const card = document.createElement('div');
    card.className = 'calco-card';

    const topo = document.createElement('div');
    topo.className = 'calco-topo';

    const dot = document.createElement('span');
    dot.className = 'calco-dot';
    dot.style.background = linha.cor;

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
      `${(linha.num_feicoes || 0).toLocaleString('pt-BR')} feições`,
      formatarBytes(linha.tamanho_bytes),
    ].join(' · ');
    card.appendChild(meta);

    // Opacidade padrão editável direto na lista: é o ajuste que o instrutor
    // mais refaz depois de ver o resultado no mapa.
    const faixa = document.createElement('div');
    faixa.className = 'calco-opacidade';
    const rotulo = document.createElement('span');
    rotulo.textContent = 'Opacidade padrão';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0'; range.max = '100'; range.step = '5';
    range.value = String(Math.round((linha.opacidade ?? 1) * 100));
    const pct = document.createElement('span');
    pct.className = 'calco-pct';
    pct.textContent = `${range.value}%`;
    range.addEventListener('input', () => { pct.textContent = `${range.value}%`; });
    // Grava no `change` (soltar o controle), não no `input`: arrastar dispara
    // dezenas de eventos, e cada um seria um UPDATE que vira um evento de
    // Realtime para os 60 aparelhos da turma.
    range.addEventListener('change', async () => {
      const { erro } = await atualizarCalco(linha.id, { opacidade: Number(range.value) / 100 });
      if (erro) aviso(`Não foi possível salvar a opacidade (${traduzirErro(erro)}).`, 'erro');
    });
    faixa.append(rotulo, range, pct);
    card.appendChild(faixa);

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

  el('calco-arquivo')?.addEventListener('change', (ev) => {
    const arquivo = ev.target.files?.[0];
    if (arquivo) conferirArquivo(arquivo);
  });
  el('calco-publicar')?.addEventListener('click', publicar);

  const opacidade = el('calco-opacidade');
  opacidade?.addEventListener('input', () => {
    const pct = el('calco-opacidade-pct');
    if (pct) pct.textContent = `${opacidade.value}%`;
  });

  window.addEventListener('beforeunload', () => { if (canal) desassinarCalcos(canal); });
}
