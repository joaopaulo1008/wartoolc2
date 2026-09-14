// instrutor-permissoes.js — Etapa 6a do roadmap: painel do instrutor.
//
// Responsabilidade deste módulo: a INTERFACE do painel (lista de usuários da
// turma + grade de permissões + os botões que alternam). Toda a conversa com
// o banco — leitura da view, escrita nas duas tabelas — mora em
// frontend/permissoes.js, que é compartilhado com o app do aluno. A separação
// é a mesma de sempre no projeto: um módulo para o dado, outro para a tela.
//
// As duas camadas que o instrutor mexe aqui são deliberadamente SEPARADAS na
// interface, porque são coisas diferentes e confundi-las é o erro fácil:
//
//   "Padrão da turma"  -> escreve em permissoes_turma. Vale para todo aluno
//                         que NÃO tiver ajuste individual. É o botão que se
//                         usa antes do exercício começar.
//   <cada aluno>       -> escreve em permissoes_usuario. Vence sobre o padrão
//                         da turma, para aquele aluno só. É o botão que se usa
//                         no meio do exercício, para um caso específico.
//
// A grade de cada aluno é lida de `vw_permissoes_efetivas` (nunca das tabelas
// cruas) justamente para mostrar a coluna `origem`: sem ela, um toggle
// desligado não diferencia "o instrutor desligou para este aluno" de "a turma
// inteira está assim" — e é essa diferença que decide se o botão certo é
// "voltar ao padrão da turma" ou "mudar o padrão da turma".
//
// Além das permissões, o painel também define a FORÇA (partido) de cada
// aluno — que não é permissão, é uma coluna de `perfis`, mas é a outra coisa
// que o instrutor precisa ajustar por pessoa e que até a Etapa 6a só existia
// como UPDATE no SQL Editor. Ver blocoForca() mais abaixo.

import {
  supabase,
  buscarUsuariosDaTurma,
  buscarTurmasDoInstrutor,
  buscarPartidosDaTurma,
  definirPartidoDoUsuario,
  definirSidcDoUsuario,
  removerDaTurma,
} from './auth.js';
import {
  getSIDC, decomporSidc, descreverSidc, categoriaPorId, CATEGORIAS,
  validarSidcDePerfil,
} from './simbolos.js';
import { svgDoSimbolo } from './icones.js';
import {
  opcoesCategoria, opcoesItem, opcoesModificador, opcoesEscalao,
} from './catalogo-form.js';
import {
  buscarCatalogo,
  buscarEfetivasDaTurma,
  buscarPermissoesTurma,
  definirPermissaoTurma,
  limparPermissaoTurma,
  definirPermissaoUsuario,
  limparPermissaoUsuario,
  CHAVES_APLICADAS,
  ROTULO_ORIGEM,
} from './permissoes.js';

// ── Estado do módulo ─────────────────────────────────────────────────────
let meuUserId = null;
let minhaTurmaId = null;   // perfis.turma_id do próprio instrutor
let turmas = [];
let turmaAtual = null;
let podeEscrever = false;

let catalogo = [];
let usuarios = [];
let partidos = [];   // forças ativas da turma, para o seletor de cada aluno
// usuario_id -> Map(chave -> { habilitada, origem })
const efetivasPorUsuario = new Map();
// chave -> { habilitada } — só as chaves DEFINIDAS no nível da turma
const permissoesDaTurma = new Map();

// 'turma' (padrão da turma inteira) ou o uuid de um usuário.
let selecionado = 'turma';

// uuid do aluno cujo editor de símbolo está ABERTO, ou null. Mora no módulo,
// e não no DOM, porque toda gravação chama renderizar() e redesenha a grade
// inteira — um estado guardado só no HTML sumiria a cada salvamento.
let editandoSimbolo = null;

// Etapa 6b: quem quer saber em que turma o painel está trabalhando.
// O seletor de turma mora aqui (é este módulo que o desenha e que decide a
// turma inicial), e a tela de debriefing precisa seguir a MESMA escolha — dois
// seletores de turma na mesma página discordando entre si seria o tipo de
// interface que faz o instrutor configurar uma turma e analisar outra sem
// perceber. Mesmo formato de observarPermissao(): o callback é chamado na hora
// com o valor atual e de novo a cada troca, para quem chama não precisar
// duplicar "e o estado inicial?".
const observadoresDeTurma = new Set();

// O callback recebe a LINHA INTEIRA de `turmas`
// (`{ id, nome, codigo_acesso, ativa, instrutor_id }`) ou `null` — NÃO o uuid.
// Está escrito aqui em caixa alta porque a confusão já custou dois bugs
// idênticos: quem nomeia o parâmetro `turmaId` e o passa para
// `.eq('turma_id', ...)` recebe do Postgres
// `invalid input syntax for type uuid: "{"id":"...","nome":"..."}"`, e o
// sintoma só aparece na primeira gravação de verdade. Leia `turma?.id`.
export function observarTurma(callback) {
  observadoresDeTurma.add(callback);
  try {
    callback(turmaAtual);
  } catch (e) {
    console.error('Observador de turma falhou na chamada inicial:', e);
  }
  return () => observadoresDeTurma.delete(callback);
}

function notificarTurma() {
  for (const cb of observadoresDeTurma) {
    try {
      cb(turmaAtual);
    } catch (e) {
      console.error('Observador de turma falhou:', e);
    }
  }
}

let canalTurma = null;
let canalUsuario = null;
let recarregarAgendado = null;

// ── Helpers de tela ──────────────────────────────────────────────────────
function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function nomeDoUsuario(u) {
  const nome = u.nome_guerra || u.nome_completo || '(sem nome)';
  return u.posto_graduacao ? `${u.posto_graduacao} ${nome}` : nome;
}

function aviso(texto, tipo) {
  const el = document.getElementById('painel-aviso');
  if (!el) return;
  if (!texto) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = texto;
  el.className = `painel-aviso ${tipo || 'info'}`;
}

// ── Carregamento ─────────────────────────────────────────────────────────
async function recarregarDados() {
  if (!turmaAtual) return;

  const [listaUsuarios, efetivas, permTurma, listaPartidos] = await Promise.all([
    buscarUsuariosDaTurma(turmaAtual.id),
    buscarEfetivasDaTurma(turmaAtual.id),
    buscarPermissoesTurma(turmaAtual.id),
    buscarPartidosDaTurma(turmaAtual.id),
  ]);

  usuarios = listaUsuarios;
  partidos = listaPartidos;

  efetivasPorUsuario.clear();
  for (const linha of efetivas) {
    if (!efetivasPorUsuario.has(linha.usuario_id)) {
      efetivasPorUsuario.set(linha.usuario_id, new Map());
    }
    efetivasPorUsuario.get(linha.usuario_id).set(linha.chave, {
      habilitada: linha.habilitada,
      origem: linha.origem,
    });
  }

  permissoesDaTurma.clear();
  for (const linha of permTurma) {
    permissoesDaTurma.set(linha.chave, { habilitada: linha.habilitada });
  }

  // Se o aluno selecionado saiu da turma enquanto o painel estava aberto,
  // volta para a visão de turma em vez de renderizar uma grade órfã.
  if (selecionado !== 'turma' && !usuarios.some((u) => u.id === selecionado)) {
    selecionado = 'turma';
  }
}

// ── Lista da esquerda ────────────────────────────────────────────────────
function contarRestricoes(usuarioId) {
  const mapa = efetivasPorUsuario.get(usuarioId);
  if (!mapa) return { desabilitadas: 0, ajustes: 0 };
  let desabilitadas = 0;
  let ajustes = 0;
  for (const { habilitada, origem } of mapa.values()) {
    if (!habilitada) desabilitadas++;
    if (origem === 'override_usuario') ajustes++;
  }
  return { desabilitadas, ajustes };
}

function renderizarLista() {
  const lista = document.getElementById('lista-usuarios');
  if (!lista) return;

  const definidasNaTurma = permissoesDaTurma.size;
  const partes = [`
    <button type="button" class="item-usuario item-turma${selecionado === 'turma' ? ' ativo' : ''}"
            data-alvo="turma">
      <span class="item-nome">Padrão da turma</span>
      <span class="item-meta">${definidasNaTurma === 0
        ? 'nenhuma chave definida — tudo no padrão do sistema'
        : `${definidasNaTurma} chave${definidasNaTurma === 1 ? '' : 's'} definida${definidasNaTurma === 1 ? '' : 's'}`}</span>
    </button>
    <div class="lista-titulo">Usuários da turma (${usuarios.length})</div>
  `];

  if (usuarios.length === 0) {
    partes.push('<div class="lista-vazia">Ninguém entrou nesta turma ainda.</div>');
  }

  for (const u of usuarios) {
    const { desabilitadas, ajustes } = contarRestricoes(u.id);
    const partido = u.partido
      ? `<span class="tag-partido" style="border-color:${esc(u.partido.cor)};color:${esc(u.partido.cor)}">${esc(u.partido.nome)}</span>`
      : '<span class="tag-partido tag-sem">sem partido</span>';
    const papel = u.papel === 'instrutor'
      ? '<span class="tag-papel tag-instrutor">instrutor</span>'
      : '<span class="tag-papel">aluno</span>';

    const meta = u.papel === 'instrutor'
      ? 'tudo liberado pelo papel'
      : [
          desabilitadas ? `${desabilitadas} desabilitada${desabilitadas === 1 ? '' : 's'}` : 'tudo liberado',
          ajustes ? `${ajustes} ajuste${ajustes === 1 ? '' : 's'} individual${ajustes === 1 ? '' : 'is'}` : null,
        ].filter(Boolean).join(' · ');

    partes.push(`
      <button type="button" class="item-usuario${selecionado === u.id ? ' ativo' : ''}${u.ativo === false ? ' inativo' : ''}"
              data-alvo="${esc(u.id)}">
        <span class="item-nome">${esc(nomeDoUsuario(u))}</span>
        <span class="item-tags">${papel}${partido}</span>
        <span class="item-meta">${esc(meta)}</span>
      </button>
    `);
  }

  lista.innerHTML = partes.join('');
  lista.querySelectorAll('.item-usuario').forEach((botao) => {
    botao.addEventListener('click', () => {
      selecionado = botao.dataset.alvo;
      renderizar();
    });
  });
}

// ── Grade da direita ─────────────────────────────────────────────────────
function linhaHtml({ chave, descricao, habilitada, origem, mostrarLimpar, rotuloLimpar, bloqueado, extra }) {
  const semEfeito = CHAVES_APLICADAS.has(chave)
    ? ''
    : '<span class="tag-sem-efeito" title="O catálogo já tem a chave, mas nenhuma tela do app usa ela ainda">sem efeito ainda</span>';

  const badgeOrigem = origem
    ? `<span class="tag-origem tag-${esc(origem)}">${esc(ROTULO_ORIGEM[origem] || origem)}</span>`
    : '';

  const botaoLimpar = mostrarLimpar
    ? `<button type="button" class="btn-limpar" data-chave="${esc(chave)}">${esc(rotuloLimpar)}</button>`
    : '';

  return `
    <div class="perm-linha${habilitada ? '' : ' desligada'}">
      <div class="perm-info">
        <span class="perm-desc">${esc(descricao)}</span>
        <span class="perm-chave">${esc(chave)}${semEfeito}</span>
      </div>
      <div class="perm-estado">
        ${badgeOrigem}
        ${extra || ''}
        ${botaoLimpar}
        <label class="switch">
          <input type="checkbox" data-chave="${esc(chave)}" ${habilitada ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    </div>
  `;
}

function renderizarGradeTurma() {
  const usuariosComOverride = (chave) => {
    let n = 0;
    for (const [id, mapa] of efetivasPorUsuario) {
      const u = usuarios.find((x) => x.id === id);
      if (!u || u.papel === 'instrutor') continue;
      if (mapa.get(chave)?.origem === 'override_usuario') n++;
    }
    return n;
  };

  const linhas = (categoria) => catalogo
    .filter((c) => c.categoria === categoria)
    .map((c) => {
      const definida = permissoesDaTurma.get(c.chave);
      const habilitada = definida ? definida.habilitada : c.padrao;
      const n = usuariosComOverride(c.chave);
      const extra = n > 0
        ? `<span class="tag-override-conta" title="Estes alunos têm ajuste individual e NÃO seguem este padrão">${n} aluno${n === 1 ? '' : 's'} com ajuste</span>`
        : '';
      return linhaHtml({
        chave: c.chave,
        descricao: c.descricao,
        habilitada,
        origem: definida ? 'padrao_turma' : 'padrao_catalogo',
        mostrarLimpar: !!definida,
        rotuloLimpar: 'Voltar ao padrão do sistema',
        bloqueado: !podeEscrever,
        extra,
      });
    })
    .join('');

  return `
    <div class="grade-cabecalho">
      <h2>Padrão da turma</h2>
      <p class="grade-sub">
        Vale para <b>todos os alunos que não tiverem ajuste individual</b>. Quem
        já tem ajuste continua com o dele — o aviso na linha mostra quantos são.
        O instrutor não é afetado: pelo papel, recebe tudo habilitado.
      </p>
    </div>
    <h3 class="grade-secao">Funções</h3>
    ${linhas('funcao')}
    <h3 class="grade-secao">Camadas</h3>
    ${linhas('camada')}
  `;
}

// ── Força (partido) do aluno ─────────────────────────────────────────────
// Fica no cabeçalho do aluno selecionado, acima das permissões, e não é uma
// permissão: é um campo de `perfis`. Está aqui porque é a outra coisa que o
// instrutor precisa ajustar por aluno, e antes da Etapa 6a só existia como
// UPDATE no SQL Editor (o backend/README.md documentava esse UPDATE).
//
// A consequência de mexer aqui é maior que a de um toggle de permissão, e o
// texto ao lado diz isso: o partido decide (1) a hostilidade com que o aluno
// vê TODO o resto da tela e (2) quem ele enxerga, via fn_usuarios_visiveis().
// Por isso o app dele recarrega sozinho quando o valor muda — ver
// frontend/perfil-ao-vivo.js.
function blocoForca(usuario) {
  if (usuario.papel === 'instrutor') {
    return `
      <div class="forca-linha">
        <span class="forca-rotulo">Força</span>
        <span class="grade-sub">o instrutor enxerga a turma inteira, os dois lados — não precisa de força.</span>
      </div>`;
  }

  const opcoes = [
    `<option value=""${!usuario.partido ? ' selected' : ''}>— sem força —</option>`,
    ...partidos.map((p) =>
      `<option value="${esc(p.id)}"${usuario.partido?.id === p.id ? ' selected' : ''}>${esc(p.nome)}</option>`),
  ].join('');

  // "Partido nulo é restritivo" é decisão da Etapa 4.5, não um bug: quem não
  // foi distribuído não enxerga ninguém além de si e não é enxergado. Vale
  // avisar na tela, porque é exatamente o estado em que um aluno recém-
  // cadastrado cai — e o sintoma (mapa vazio) não sugere a causa.
  const nota = usuario.partido
    ? 'Muda a hostilidade com que ele vê todo o resto e quem ele enxerga. O app dele recarrega sozinho.'
    : 'Sem força ele enxerga só a si mesmo, e ninguém o vê — mapa vazio dos dois lados.';

  return `
    <div class="forca-linha${usuario.partido ? '' : ' forca-vazia'}">
      <label class="forca-rotulo" for="select-forca">Força</label>
      <select id="select-forca"${podeEscrever ? '' : ' disabled'}>${opcoes}</select>
      <span class="grade-sub">${esc(nota)}</span>
    </div>`;
}

// ── Símbolo (avatar) do aluno ────────────────────────────────────────────
// Vizinho de blocoForca() pelo mesmo motivo que ele existe: é um campo de
// `perfis`, não uma permissão, e é a outra coisa que o instrutor precisa
// ajustar por pessoa. Até 2026-09-14 só existia como UPDATE no SQL Editor —
// exatamente a situação em que a força estava antes da Etapa 6a.
//
// Os seletores são os MESMOS de catalogo-form.js que o aluno usa para marcar e
// que o instrutor usa para montar a paleta. Nenhuma lista montada aqui: a
// segunda cópia de uma regra de catálogo é a que oferece uma combinação que
// não existe e gera um SIDC que a milsymbol desenha como outra coisa.
//
// `somenteComDesenho` fica DESLIGADO aqui, ao contrário da paleta: o avatar
// sempre desenha o nome de guerra como uniqueDesignation (colegas.js, gps.js),
// então "Comando Nomeado" — a moldura com a sigla no centro — é justamente o
// caso em que aquele símbolo funciona. Ver validarSidcDePerfil() em simbolos.js.
function blocoSimbolo(usuario) {
  const sidcAtual = usuario.sidc || '';
  const previa = svgDoSimbolo(sidcAtual, { tamanho: 34, partidoElemento: usuario.partido || null });
  const nome = descreverSidc(sidcAtual) || 'símbolo não reconhecido';

  if (usuario.papel === 'instrutor') {
    return `
      <div class="simbolo-linha">
        <span class="forca-rotulo">Símbolo</span>
        <span class="simbolo-previa">${previa}</span>
        <span class="simbolo-nome">${esc(nome)}</span>
        <span class="grade-sub">o instrutor não manda posição, então este símbolo não aparece no mapa de ninguém.</span>
      </div>`;
  }

  const aberto = editandoSimbolo === usuario.id;
  const linha = `
    <div class="simbolo-linha">
      <span class="forca-rotulo">Símbolo</span>
      <span class="simbolo-previa">${previa}</span>
      <span class="simbolo-nome">${esc(nome)}</span>
      <button type="button" class="btn-simbolo" id="btn-simbolo"${podeEscrever ? '' : ' disabled'}>
        ${aberto ? 'Cancelar' : 'Alterar'}
      </button>
      <span class="grade-sub">É o avatar dele no mapa. O nome de guerra aparece escrito ao lado do símbolo.</span>
    </div>`;

  if (!aberto) return linha;

  // Pré-preenchido com o que ele TEM hoje, não com a primeira opção da lista:
  // o instrutor quase sempre vem corrigir um detalhe (o escalão, um
  // modificador), não montar do zero. Mesmo raciocínio do "Editar" da
  // marcação, que a Etapa 9b fez abrir preenchido.
  const d = decomporSidc(sidcAtual);
  const categoriaId = d.categoriaId || CATEGORIAS[0].id;
  const cat = categoriaPorId(categoriaId);

  const blocosMod = [];
  if (cat && cat.mod1.length) {
    blocosMod.push(`<div class="campo"><label for="sim-mod1">Modificador 1</label>
      <select id="sim-mod1">${opcoesModificador(cat.mod1, d.mod1)}</select></div>`);
  }
  if (cat && cat.mod2.length) {
    blocosMod.push(`<div class="campo"><label for="sim-mod2">Modificador 2</label>
      <select id="sim-mod2">${opcoesModificador(cat.mod2, d.mod2)}</select></div>`);
  }

  return `${linha}
    <div class="simbolo-editor">
      <div class="campo"><label for="sim-categoria">Categoria</label>
        <select id="sim-categoria">${opcoesCategoria(categoriaId)}</select></div>
      <div class="campo"><label for="sim-item">Tipo</label>
        <select id="sim-item">${opcoesItem(categoriaId, d.codigoEntidade)}</select></div>
      <div class="campo"><label for="sim-escalao">Escalão</label>
        <select id="sim-escalao">${opcoesEscalao(d.escalao || 'NONE')}</select></div>
      <div id="sim-mods">${blocosMod.join('')}</div>
      <div class="simbolo-previa-caixa">
        <span id="sim-previa"></span>
        <span class="grade-sub" id="sim-previa-nome"></span>
      </div>
      <div class="simbolo-acoes">
        <button type="button" class="btn-salvar-simbolo" id="btn-salvar-simbolo">Salvar símbolo</button>
      </div>
    </div>`;
}

// ── Tirar o aluno da turma ───────────────────────────────────────────────
// O rótulo diz "Remover da turma" e NÃO "Excluir" porque nada é excluído — e
// o texto ao lado repete isso, porque a palavra que a pessoa tem na cabeça ao
// procurar esse botão é "excluir". Ver removerDaTurma() em auth.js para por
// que a exclusão de verdade não está aqui (o cascade levaria o rastro e as
// marcações junto, e apagar conta do Auth exige a service_role).
//
// Não aparece para instrutor nem para a própria conta: tirar a si mesmo da
// turma derrubaria o acesso do painel à turma em que se está trabalhando.
function blocoRemover(usuario) {
  if (usuario.papel === 'instrutor' || usuario.id === meuUserId) return '';
  return `
    <div class="remover-linha">
      <button type="button" class="btn-remover-turma" id="btn-remover-turma"${podeEscrever ? '' : ' disabled'}>
        Remover da turma
      </button>
      <span class="grade-sub">
        Ele some do mapa e desta lista, junto com a última posição dele.
        <b>A conta, as marcações e o rastro ficam</b> — o debriefing não perde
        nada, e ele volta digitando o código da turma.
      </span>
    </div>`;
}

function renderizarGradeUsuario(usuario) {
  const mapa = efetivasPorUsuario.get(usuario.id) || new Map();
  const ehInstrutor = usuario.papel === 'instrutor';

  const linhas = (categoria) => catalogo
    .filter((c) => c.categoria === categoria)
    .map((c) => {
      const efetiva = mapa.get(c.chave) || { habilitada: c.padrao, origem: 'padrao_catalogo' };
      return linhaHtml({
        chave: c.chave,
        descricao: c.descricao,
        habilitada: efetiva.habilitada,
        origem: efetiva.origem,
        mostrarLimpar: efetiva.origem === 'override_usuario',
        rotuloLimpar: 'Voltar ao padrão da turma',
        bloqueado: !podeEscrever || ehInstrutor,
      });
    })
    .join('');

  const nota = ehInstrutor
    ? `<p class="grade-sub aviso-inline">
         Este usuário é <b>instrutor</b>: a view devolve tudo habilitado por
         causa do papel, e nenhum ajuste individual muda isso. Controles
         desativados de propósito.
       </p>`
    : `<p class="grade-sub">
         Mexer aqui cria um <b>ajuste individual</b> (permissoes_usuario), que
         vence sobre o padrão da turma só para esta pessoa. Para voltar a
         herdar, use “Voltar ao padrão da turma”.
       </p>`;

  return `
    <div class="grade-cabecalho">
      <h2>${esc(nomeDoUsuario(usuario))}</h2>
      ${blocoForca(usuario)}
      ${blocoSimbolo(usuario)}
      ${blocoRemover(usuario)}
      ${nota}
    </div>
    <h3 class="grade-secao">Funções</h3>
    ${linhas('funcao')}
    <h3 class="grade-secao">Camadas</h3>
    ${linhas('camada')}
  `;
}

function renderizarGrade() {
  const grade = document.getElementById('grade-permissoes');
  if (!grade) return;

  if (selecionado === 'turma') {
    grade.innerHTML = renderizarGradeTurma();
    ligarEventosGrade({ alvoTurma: true });
    return;
  }

  const usuario = usuarios.find((u) => u.id === selecionado);
  if (!usuario) {
    grade.innerHTML = '<p class="grade-sub">Selecione alguém na lista ao lado.</p>';
    return;
  }
  grade.innerHTML = renderizarGradeUsuario(usuario);
  ligarEventosGrade({ alvoTurma: false, usuarioId: usuario.id });
}

function ligarEventosGrade({ alvoTurma, usuarioId }) {
  const grade = document.getElementById('grade-permissoes');
  if (!grade) return;

  grade.querySelectorAll('input[type=checkbox][data-chave]').forEach((input) => {
    input.addEventListener('change', () => {
      const chave = input.dataset.chave;
      const novoValor = input.checked;
      if (alvoTurma) {
        gravar(() => definirPermissaoTurma({
          turmaId: turmaAtual.id, chave, habilitada: novoValor, definidaPor: meuUserId,
        }));
      } else {
        gravar(() => definirPermissaoUsuario({
          usuarioId, chave, habilitada: novoValor, definidaPor: meuUserId,
        }));
      }
    });
  });

  // Seletor de força — só existe na visão de um aluno, e escreve em `perfis`
  // (não nas tabelas de permissão), por isso fica fora do laço acima.
  const selectForca = grade.querySelector('#select-forca');
  if (selectForca && !alvoTurma) {
    selectForca.addEventListener('change', () => {
      gravar(() => definirPartidoDoUsuario(usuarioId, selectForca.value || null));
    });
  }

  if (!alvoTurma) ligarEventosPerfil(grade, usuarioId);

  grade.querySelectorAll('.btn-limpar').forEach((botao) => {
    botao.addEventListener('click', () => {
      const chave = botao.dataset.chave;
      if (alvoTurma) {
        gravar(() => limparPermissaoTurma({ turmaId: turmaAtual.id, chave }));
      } else {
        gravar(() => limparPermissaoUsuario({ usuarioId, chave }));
      }
    });
  });
}

// ── Símbolo e remoção: os dois controles que escrevem em `perfis` ────────
// Separados de ligarEventosGrade() porque não são permissão: não passam pelas
// tabelas de permissão nem pela view de precedência.
function sidcDoEditor() {
  const grade = document.getElementById('grade-permissoes');
  if (!grade) return '';
  const categoriaId = grade.querySelector('#sim-categoria')?.value || '';
  const codigo = grade.querySelector('#sim-item')?.value || '';
  if (!categoriaId || !codigo) return '';
  return getSIDC({
    dimensao: categoriaId,
    natureza_code: codigo,
    escalao: grade.querySelector('#sim-escalao')?.value || '',
    mod1: grade.querySelector('#sim-mod1')?.value || '',
    mod2: grade.querySelector('#sim-mod2')?.value || '',
  });
}

// A prévia é desenhada pelo MESMO caminho do mapa (svgDoSimbolo ->
// sidcParaObservador), com o partido do aluno decidindo a cor. É o que deixa
// um engano visível aqui, antes de o aluno aparecer errado para a turma toda.
function atualizarPreviaSimbolo(usuario) {
  const grade = document.getElementById('grade-permissoes');
  const alvo = grade?.querySelector('#sim-previa');
  const desc = grade?.querySelector('#sim-previa-nome');
  if (!alvo) return;
  const sidc = sidcDoEditor();
  if (!sidc) { alvo.innerHTML = ''; if (desc) desc.textContent = ''; return; }
  alvo.innerHTML = svgDoSimbolo(sidc, { tamanho: 44, partidoElemento: usuario?.partido || null }) || '';
  if (desc) desc.textContent = descreverSidc(sidc) || '';
}

function ligarEventosPerfil(grade, usuarioId) {
  const usuario = usuarios.find((u) => u.id === usuarioId) || null;

  const btnSimbolo = grade.querySelector('#btn-simbolo');
  if (btnSimbolo) {
    btnSimbolo.addEventListener('click', () => {
      editandoSimbolo = editandoSimbolo === usuarioId ? null : usuarioId;
      renderizar();
    });
  }

  const editor = grade.querySelector('.simbolo-editor');
  if (editor) {
    atualizarPreviaSimbolo(usuario);

    // Trocar de categoria troca a lista inteira de tipos E de modificadores —
    // os modificadores são POR CATEGORIA no catálogo oficial, então manter os
    // antigos produziria um SIDC que significa outra coisa.
    grade.querySelector('#sim-categoria')?.addEventListener('change', (ev) => {
      const categoriaId = ev.target.value;
      const item = grade.querySelector('#sim-item');
      if (item) item.innerHTML = opcoesItem(categoriaId, '');
      const cat = categoriaPorId(categoriaId);
      const mods = grade.querySelector('#sim-mods');
      if (mods) {
        const blocos = [];
        if (cat && cat.mod1.length) {
          blocos.push(`<div class="campo"><label for="sim-mod1">Modificador 1</label>
            <select id="sim-mod1">${opcoesModificador(cat.mod1, '')}</select></div>`);
        }
        if (cat && cat.mod2.length) {
          blocos.push(`<div class="campo"><label for="sim-mod2">Modificador 2</label>
            <select id="sim-mod2">${opcoesModificador(cat.mod2, '')}</select></div>`);
        }
        mods.innerHTML = blocos.join('');
        mods.querySelectorAll('select').forEach((s) =>
          s.addEventListener('change', () => atualizarPreviaSimbolo(usuario)));
      }
      atualizarPreviaSimbolo(usuario);
    });

    ['#sim-item', '#sim-escalao', '#sim-mod1', '#sim-mod2'].forEach((sel) => {
      grade.querySelector(sel)?.addEventListener('change', () => atualizarPreviaSimbolo(usuario));
    });

    grade.querySelector('#btn-salvar-simbolo')?.addEventListener('click', () => {
      const v = validarSidcDePerfil(sidcDoEditor());
      if (!v.ok) { aviso(v.erro, 'erro'); return; }
      editandoSimbolo = null;
      gravar(() => definirSidcDoUsuario(usuarioId, v.valor));
    });
  }

  const btnRemover = grade.querySelector('#btn-remover-turma');
  if (btnRemover) {
    btnRemover.addEventListener('click', () => {
      const nome = usuario ? nomeDoUsuario(usuario) : 'este aluno';
      if (!confirm(
        `Remover ${nome} da turma?\n\n` +
        'Ele some do mapa e do painel na hora, inclusive a última posição dele ' +
        'no seu mapa.\n\n' +
        'A conta, as marcações que ele fez e o rastro inteiro do exercício ' +
        'CONTINUAM guardados — o debriefing não perde nada.\n\n' +
        'Para voltar, ele digita o código da turma no app.'
      )) return;
      if (editandoSimbolo === usuarioId) editandoSimbolo = null;
      gravar(() => removerDaTurma(usuarioId), { aoFalhar: erroDeRemocao });
    });
  }
}

// `fn_remover_da_turma` (0012) já levanta mensagens em português explicando
// cada recusa ("Somente o instrutor da turma pode remover alguém dela.").
// O que falta é o caso em que a própria FUNÇÃO não existe: o painel novo
// rodando contra um banco onde a 0012 ainda não foi aplicada. O sintoma cru
// ("Could not find the function public.fn_remover_da_turma") não diz o que
// fazer, e é o erro mais provável logo depois de um deploy.
function erroDeRemocao(error) {
  const msg = error.message || '';
  if (/fn_remover_da_turma/.test(msg) && /function|schema cache|not find/i.test(msg)) {
    return 'Este botão depende da migration 0012, que ainda não foi aplicada neste '
      + 'banco. Rode backend/supabase/0012_remover_da_turma.sql no SQL Editor do '
      + 'Supabase (é idempotente) e tente de novo.';
  }
  return null;
}

// Toda escrita passa por aqui: desabilita a grade enquanto grava (para dois
// cliques rápidos não gerarem duas escritas concorrentes com o mesmo estado
// de partida), relê e redesenha. A releitura é obrigatória, não cosmética: o
// valor efetivo depois da escrita depende da precedência, e quem resolve
// precedência é a view — não este arquivo.
let gravando = false;
async function gravar(operacao, { aoFalhar = null } = {}) {
  if (gravando) return;
  gravando = true;
  aviso('');
  const grade = document.getElementById('grade-permissoes');
  grade?.classList.add('gravando');

  const { error } = await operacao();
  if (error) {
    // A causa mais comum aqui é RLS: o instrutor não é o responsável pela
    // turma nem está lotado nela (ver fn_sou_instrutor_da_turma em 0002).
    const especifico = aoFalhar ? aoFalhar(error) : null;
    aviso(especifico || `Não foi possível salvar: ${error.message}`, 'erro');
  }

  await recarregarDados();
  gravando = false;
  grade?.classList.remove('gravando');
  renderizar();
}

function renderizar() {
  renderizarLista();
  renderizarGrade();
}

// ── Realtime ─────────────────────────────────────────────────────────────
// Mesmo par de tabelas que o app do aluno assina, e pelo mesmo motivo: o
// painel precisa refletir mudança feita em outro lugar (um segundo instrutor,
// ou um UPDATE pelo SQL Editor) sem depender de F5.
//
// `permissoes_usuario` é assinada SEM filtro de propósito: o filtro do
// Realtime é por coluna da própria tabela, e ali não existe `turma_id` para
// filtrar. Quem restringe é a RLS — a policy perm_usuario_ler só entrega ao
// instrutor as linhas de alunos da turma dele, então nada de outra turma
// chega neste canal mesmo sem filtro.
function assinarCanais() {
  canalTurma = supabase
    .channel(`painel-perm-turma-${turmaAtual.id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'permissoes_turma',
      filter: `turma_id=eq.${turmaAtual.id}`,
    }, agendarRecarga)
    .subscribe();

  canalUsuario = supabase
    .channel(`painel-perm-usuario-${turmaAtual.id}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'permissoes_usuario',
    }, agendarRecarga)
    .subscribe();
}

function agendarRecarga() {
  if (gravando) return; // a própria escrita já vai reler ao terminar
  if (recarregarAgendado) clearTimeout(recarregarAgendado);
  recarregarAgendado = setTimeout(async () => {
    recarregarAgendado = null;
    await recarregarDados();
    renderizar();
  }, 200);
}

// ── Seleção de turma ─────────────────────────────────────────────────────
// Um instrutor pode responder por mais de uma turma. Quando responde por
// várias, aparece um <select>; com uma só, nem mostra.
function renderizarSeletorTurma() {
  const el = document.getElementById('seletor-turma');
  if (!el) return;
  if (turmas.length <= 1) {
    el.innerHTML = turmaAtual
      ? `<span class="turma-atual">Turma: <b>${esc(turmaAtual.nome)}</b> (${esc(turmaAtual.codigo_acesso)})</span>`
      : '';
    return;
  }
  el.innerHTML = `
    <label class="turma-label">Turma
      <select id="turma-select">
        ${turmas.map((t) => `<option value="${esc(t.id)}"${t.id === turmaAtual.id ? ' selected' : ''}>${esc(t.nome)} (${esc(t.codigo_acesso)})</option>`).join('')}
      </select>
    </label>`;
  document.getElementById('turma-select').addEventListener('change', (ev) => {
    trocarTurma(turmas.find((t) => t.id === ev.target.value));
  });
}

async function trocarTurma(turma) {
  if (!turma) return;
  pararCanais();
  turmaAtual = turma;
  selecionado = 'turma';
  notificarTurma();
  avaliarPermissaoDeEscrita();
  await recarregarDados();
  renderizarSeletorTurma();
  renderizar();
  assinarCanais();
}

// Espelha no cliente a mesma condição de fn_sou_instrutor_da_turma() (0002):
// "está lotado nela OU é o responsável dela". Não é uma checagem de
// segurança — o banco decide de qualquer jeito — mas evita o instrutor
// clicar em tudo e só descobrir pelo erro do PostgREST que não tinha direito.
function avaliarPermissaoDeEscrita() {
  podeEscrever = !!turmaAtual && (
    turmaAtual.instrutor_id === meuUserId || turmaAtual.id === minhaTurmaId
  );
  if (!podeEscrever && turmaAtual) {
    aviso(
      `Você consegue ver esta turma, mas não é o instrutor responsável por ela ` +
      `nem está lotado nela — o banco vai recusar qualquer alteração. ` +
      `Corrija com: update public.turmas set instrutor_id = '${meuUserId}' where codigo_acesso = '${turmaAtual.codigo_acesso}';`,
      'erro'
    );
  }
}

function pararCanais() {
  if (canalTurma) { supabase.removeChannel(canalTurma); canalTurma = null; }
  if (canalUsuario) { supabase.removeChannel(canalUsuario); canalUsuario = null; }
  if (recarregarAgendado) { clearTimeout(recarregarAgendado); recarregarAgendado = null; }
}

// ── Ponto de entrada ─────────────────────────────────────────────────────
// session/perfil vêm de exigirSessao('instrutor') em instrutor.html.
export async function iniciarPainelPermissoes({ session, perfil }) {
  meuUserId = session.user.id;
  minhaTurmaId = perfil.turma_id || null;

  catalogo = await buscarCatalogo();
  if (catalogo.length === 0) {
    aviso('Não foi possível ler o catálogo de permissões. Verifique a conexão e recarregue.', 'erro');
    return;
  }

  const todas = await buscarTurmasDoInstrutor();
  // Só faz sentido administrar turma ativa; se a única for inativa, mostra
  // assim mesmo (melhor do que uma tela vazia sem explicação).
  turmas = todas.filter((t) => t.ativa).length ? todas.filter((t) => t.ativa) : todas;

  if (turmas.length === 0) {
    aviso(
      'Você não está vinculado a nenhuma turma. Entre em uma turma pelo código ' +
      'de acesso ou peça para ser definido como instrutor responsável.',
      'erro'
    );
    document.getElementById('grade-permissoes').innerHTML =
      '<p class="grade-sub">Nada para configurar ainda.</p>';
    return;
  }

  // Preferência: a turma em que o instrutor está lotado; senão, a primeira
  // que ele responde.
  turmaAtual = turmas.find((t) => t.id === minhaTurmaId) || turmas[0];
  notificarTurma();

  avaliarPermissaoDeEscrita();
  await recarregarDados();
  renderizarSeletorTurma();
  renderizar();
  assinarCanais();

  window.addEventListener('beforeunload', pararCanais);
}
