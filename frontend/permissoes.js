// permissoes.js — Etapa 6a do roadmap: permissões efetivas no cliente.
//
// Este arquivo é a FONTE ÚNICA de tudo que toca as três camadas de permissão
// (catalogo_permissoes -> permissoes_turma -> permissoes_usuario). Dois
// consumidores bem diferentes usam o mesmo módulo:
//
//   - app do ALUNO (index.html + gps.js/colegas.js/marcacoes.js): chama
//     iniciarPermissoes() uma vez e depois observarPermissao('chave', cb)
//     para cada função que precisa ligar/desligar. O cb é chamado na hora com
//     o valor atual e DE NOVO sempre que o instrutor mudar algo — é isso que
//     faz o painel surtir efeito sem recarregar a página.
//   - painel do INSTRUTOR (instrutor-permissoes.js): usa as funções de leitura
//     em lote (buscarEfetivasDaTurma, buscarPermissoesTurma) e as de escrita
//     (definirPermissao*/limparPermissao*).
//
// Duas regras que valem para sempre neste arquivo:
//
//   1. LER SEMPRE DA VIEW `vw_permissoes_efetivas`, nunca das tabelas cruas.
//      A precedência (instrutor > override do usuário > padrão da turma >
//      padrão do catálogo) está resolvida lá dentro, junto com a coluna
//      `origem`, que diz qual camada decidiu. Reimplementar isso em
//      JavaScript seria uma segunda cópia da regra, livre para divergir em
//      silêncio da primeira — o mesmo erro que a Etapa 4.5 corrigiu no SIDC.
//      A única exceção legítima é o painel de PADRÃO DA TURMA, que edita a
//      camada `permissoes_turma` em si: a view é por usuário e não tem como
//      responder "o que está definido para a turma" (ver
//      buscarPermissoesTurma abaixo).
//
//   2. ESCREVER SEMPRE NA TABELA DA CAMADA CERTA. Padrão da turma vai em
//      `permissoes_turma` (chave turma_id+chave); ajuste individual vai em
//      `permissoes_usuario` (chave usuario_id+chave) e é obrigado pela RLS a
//      carimbar `definida_por = auth.uid()` (policy perm_usuario_escrever em
//      backend/supabase/0002_rls.sql).
//
// ATENÇÃO — isto NÃO é uma barreira de segurança. Estas checagens acontecem
// no navegador do aluno e servem para a interface obedecer o instrutor, não
// para impedir um aluno mal-intencionado: quem abrir o console consegue
// contornar qualquer uma delas. A barreira de verdade é a RLS do Postgres, e
// ela NÃO conhece o catálogo de permissões — hoje ela restringe por turma e
// por partido (fn_usuarios_visiveis). Ou seja: desligar 'ver_posicao_outros'
// tira os colegas da TELA, não do alcance da API. Isso é aceitável para uso
// de instrução (o adversário aqui é a distração, não a espionagem), mas
// precisa estar escrito para ninguém confundir as duas coisas depois.

import { supabase } from './auth.js';

// ── Quais chaves o app de fato aplica hoje ───────────────────────────────
// O catálogo tem 16 chaves, mas nem todas têm uma função correspondente na
// interface ainda (imagem georreferenciada é a Etapa 8).
// Esta lista é o que o painel do instrutor usa para avisar "esta chave ainda
// não faz nada" em vez de prometer um efeito que não existe. Quando a etapa
// correspondente criar a função, basta acrescentar a chave aqui.
export const CHAVES_APLICADAS = new Set([
  'ver_mapa',
  'ver_propria_posicao',
  'ver_posicao_outros',
  'enviar_posicao_gps',
  'criar_marcacao_inimiga',
  'editar_marcacao_propria',
  'ver_marcacoes_outros',
  'trocar_mapa_base',
  // Etapa 6b: a tela de debriefing (frontend/debriefing.js) observa esta
  // chave. Hoje ela só existe no painel do instrutor, que recebe tudo
  // habilitado pelo papel — então, na prática, o interruptor nunca desliga
  // nada ainda. Está na lista assim mesmo porque o efeito EXISTE: a tela
  // obedece de verdade, e no dia em que o rastro for oferecido ao aluno (que
  // por `padrao = false` no catálogo nasce sem ele) o interruptor já vale sem
  // código novo. Marcá-la como "sem efeito ainda" é que seria mentira agora.
  'ver_historico_rastro',
  // Etapa 7: `carregar_kml` governa o arquivo que o ALUNO abre no próprio
  // aparelho (frontend/camadas.js). Diferente da maioria das chaves desta
  // lista, o padrão dela no catálogo é `false` — ou seja, o estado NORMAL de
  // um aluno recém-cadastrado é sem a função, e o painel de camadas explica
  // isso na tela em vez de simplesmente não mostrar o botão. Ver
  // aplicarPermissaoLocal() em camadas.js.
  'carregar_kml',
  'camada_manobra',
  'camada_inimigo',
  'camada_bdgex',
  // Etapa 7: as duas passaram a ter efeito porque passou a existir camada
  // correspondente — o calco que o instrutor publica é classificado numa
  // destas categorias ao ser publicado (backend/supabase/0006_calcos.sql,
  // coluna `calcos.categoria`), e é a chave da categoria que decide se o
  // aluno vê aquela camada.
  //
  // Note que quem classifica é o INSTRUTOR, na publicação, e não quem carrega.
  // Se o aluno pudesse classificar o próprio arquivo, ele carregaria qualquer
  // coisa, chamaria de "manobra" e recuperaria uma camada que o instrutor
  // tinha desligado — lavagem de permissão. Por isso o arquivo local dele não
  // tem categoria nenhuma e responde só a `carregar_kml`.
  'camada_logistica',
  'camada_obstaculos',
]);

// ── `carregar_imagem_geo`: DELIBERADAMENTE fora da lista acima (Etapa 8b) ──
//
// Não é um esquecimento — é a decisão 1 da Etapa 8b, escrita aqui para quem
// olhar só este arquivo e perguntar "por que esta é a única chave que
// sobrou?". O raciocínio completo está em CLAUDE.md ("Decisões da Etapa
// 8b") e em frontend/imagem-geo.js; resumo:
//
// O catálogo (0001_schema_inicial.sql) descreve `carregar_imagem_geo` como
// "Carregar imagem georreferenciada PRÓPRIA" — a mesma redação de
// `carregar_kml`, que governa o arquivo LOCAL do aluno (sem rede, sem banco,
// governado só pela permissão, tratado em frontend/camadas.js). Por essa
// convenção, `carregar_imagem_geo` deveria abrir o mesmo tipo de caminho: o
// aluno escolhe uma imagem já georreferenciada no próprio aparelho.
//
// A Etapa 8b implementou só o caminho do INSTRUTOR — foto aérea/carta
// atualizada publicada pelo painel, com bounds desenhados no mapa, a mesma
// tabela `calcos` dos calcos KML e as mesmas chaves `camada_*` que já
// existem (não uma chave nova). Não abriu o caminho local porque, ao
// contrário do KML (que pode vir de um planejamento feito no QGIS antes do
// exercício, algo plausível de o aluno já ter no aparelho), uma imagem
// georreferenciada de verdade raramente é algo que um aluno carrega pronto
// — quem tem a imagem atualizada e o contexto de por que ela importa é o
// instrutor. Abrir os dois caminhos (como a Etapa 7 fez para KML) dobraria a
// superfície da etapa para um caminho local de valor prático baixo.
//
// `carregar_imagem_geo` continua no catálogo, com padrão `false`, RESERVADA
// para esse caminho local se um dia ele fizer sentido de verdade — não foi
// removida nem redefinida para outra coisa. Enquanto não tiver interface
// correspondente, o painel do instrutor (instrutor-permissoes.js) mostra
// esta chave como "sem efeito ainda", igual às outras que não têm função
// correspondente — porque, de fato, não tem: ligar ou desligar esta chave
// hoje não muda nada na tela de ninguém.

// Rótulos em PT-BR para a coluna `origem` da view — é o que responde, na
// tela do instrutor, "por que este aluno está assim?".
export const ROTULO_ORIGEM = {
  papel_instrutor:  'papel de instrutor',
  override_usuario: 'ajustado para este aluno',
  padrao_turma:     'herdado da turma',
  padrao_catalogo:  'padrão do sistema',
};

// ── Estado do módulo (lado do ALUNO) ─────────────────────────────────────
// Só existe um "usuário logado" por página carregada, então o estado pode
// morar no módulo — mesmo padrão de gps.js/colegas.js.
let meuUserId = null;
let minhaTurmaId = null;

// chave -> { habilitada, origem, categoria }
const efetivas = new Map();
// chave -> padrão global do catálogo (usado como rede de segurança)
const padroesCatalogo = new Map();

// chave -> Set de callbacks registrados por observarPermissao().
const observadoresPorChave = new Map();

let canalTurma = null;
let canalUsuario = null;
let carregado = false;
let recarregarAgendado = null;

// ── UI: status ───────────────────────────────────────────────────────────
function status(texto, cor) {
  const el = document.getElementById('permissoes-status');
  if (!el) return;
  el.textContent = `Permissões: ${texto}`;
  el.style.color = cor || '#7a9ab8';
}

// ── Leitura ──────────────────────────────────────────────────────────────

// Catálogo completo, com descrição e categoria — usado pelo painel do
// instrutor para montar a grade e pelo aluno como rede de segurança se a
// view falhar.
export async function buscarCatalogo() {
  const { data, error } = await supabase
    .from('catalogo_permissoes')
    .select('chave, descricao, categoria, padrao')
    .order('categoria', { ascending: true })
    .order('chave', { ascending: true });
  if (error) {
    console.error('buscarCatalogo falhou:', error);
    return [];
  }
  return data || [];
}

// Permissões efetivas de UM usuário (o próprio, no app do aluno).
export async function buscarEfetivasDoUsuario(usuarioId) {
  const { data, error } = await supabase
    .from('vw_permissoes_efetivas')
    .select('chave, categoria, habilitada, origem')
    .eq('usuario_id', usuarioId);
  if (error) {
    console.error('buscarEfetivasDoUsuario falhou:', error);
    return null; // null = "não deu para saber", diferente de [] = "não tem nenhuma"
  }
  return data || [];
}

// Permissões efetivas de TODOS os usuários de uma turma, num round-trip só —
// o painel do instrutor precisa disso para montar a lista inteira sem uma
// consulta por aluno. A RLS da view (security_invoker) já garante que só o
// instrutor daquela turma recebe as linhas dos alunos dela.
export async function buscarEfetivasDaTurma(turmaId) {
  const { data, error } = await supabase
    .from('vw_permissoes_efetivas')
    .select('usuario_id, chave, categoria, habilitada, origem')
    .eq('turma_id', turmaId);
  if (error) {
    console.error('buscarEfetivasDaTurma falhou:', error);
    return [];
  }
  return data || [];
}

// Linhas cruas de `permissoes_turma`. É a ÚNICA leitura que não passa pela
// view, e de propósito: a view resolve a permissão de um USUÁRIO, então ela
// não sabe dizer "esta chave está definida no nível da turma ou está caindo
// no padrão do catálogo?" — e essa diferença é justamente o que o painel de
// padrão da turma precisa mostrar (e o botão "limpar" precisa apagar).
export async function buscarPermissoesTurma(turmaId) {
  const { data, error } = await supabase
    .from('permissoes_turma')
    .select('chave, habilitada, definida_por, atualizado_em')
    .eq('turma_id', turmaId);
  if (error) {
    console.error('buscarPermissoesTurma falhou:', error);
    return [];
  }
  return data || [];
}

// ── Escrita (só o instrutor da turma passa pela RLS) ─────────────────────

async function idDoUsuarioLogado(definidaPor) {
  if (definidaPor) return definidaPor;
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
}

// Padrão da turma inteira. `definida_por` aqui é só auditoria (a policy
// perm_turma_escrever não exige), mas gravamos assim mesmo para o histórico
// ficar completo.
export async function definirPermissaoTurma({ turmaId, chave, habilitada, definidaPor }) {
  const autor = await idDoUsuarioLogado(definidaPor);
  const { error } = await supabase.from('permissoes_turma').upsert(
    { turma_id: turmaId, chave, habilitada, definida_por: autor },
    { onConflict: 'turma_id,chave' }
  );
  return { error };
}

// Apagar a linha faz a turma voltar a cair no padrão do catálogo.
export async function limparPermissaoTurma({ turmaId, chave }) {
  const { error } = await supabase
    .from('permissoes_turma')
    .delete()
    .eq('turma_id', turmaId)
    .eq('chave', chave);
  return { error };
}

// Override individual. Aqui `definida_por = auth.uid()` NÃO é opcional: a
// policy perm_usuario_escrever tem isso no WITH CHECK, então um upsert sem
// esse campo (ou com o id de outra pessoa) é rejeitado pelo banco.
export async function definirPermissaoUsuario({ usuarioId, chave, habilitada, definidaPor }) {
  const autor = await idDoUsuarioLogado(definidaPor);
  if (!autor) return { error: { message: 'Sessão não encontrada para carimbar definida_por.' } };
  const { error } = await supabase.from('permissoes_usuario').upsert(
    { usuario_id: usuarioId, chave, habilitada, definida_por: autor },
    { onConflict: 'usuario_id,chave' }
  );
  return { error };
}

// Apagar o override faz o aluno voltar a herdar o padrão da turma.
export async function limparPermissaoUsuario({ usuarioId, chave }) {
  const { error } = await supabase
    .from('permissoes_usuario')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('chave', chave);
  return { error };
}

// ── Lado do aluno: estado reativo ────────────────────────────────────────

// Valor atual de uma chave. Antes do primeiro carregamento (ou se ele
// falhar), cai no padrão do catálogo e, se nem isso estiver disponível,
// devolve `true`.
//
// Por que o fallback é PERMISSIVO: estas checagens são de interface, não de
// segurança (ver o aviso no topo do arquivo). Falhar fechado transformaria
// uma queda de rede momentânea num aluno sem mapa, sem GPS e sem marcação no
// meio do exercício — muito pior, na prática, do que um aluno vendo uma
// camada a mais por alguns segundos.
export function pode(chave) {
  const atual = efetivas.get(chave);
  if (atual) return atual.habilitada;
  if (padroesCatalogo.has(chave)) return padroesCatalogo.get(chave);
  return true;
}

// Registra um observador para UMA chave. O callback é chamado:
//   - imediatamente, com o valor atual (assim quem chama não precisa
//     duplicar "e o estado inicial?" na mão);
//   - de novo, toda vez que AQUELA chave mudar de valor.
// Devolve uma função para cancelar a observação.
//
// Quem só precisa saber "posso agora?" num evento pontual (o clique no mapa,
// por exemplo) deve chamar pode() na hora, e não guardar o valor numa
// variável própria: uma cópia local do valor é uma segunda fonte de verdade
// esperando para ficar desatualizada. O observador é para REAGIR à mudança
// (desenhar, apagar, fechar um formulário), não para armazenar.
export function observarPermissao(chave, callback) {
  if (!observadoresPorChave.has(chave)) observadoresPorChave.set(chave, new Set());
  observadoresPorChave.get(chave).add(callback);
  try {
    callback(pode(chave));
  } catch (e) {
    console.error(`Observador de permissão '${chave}' falhou na chamada inicial:`, e);
  }
  return () => observadoresPorChave.get(chave)?.delete(callback);
}

function notificar(chavesMudadas) {
  for (const chave of chavesMudadas) {
    const observadores = observadoresPorChave.get(chave);
    if (!observadores) continue;
    for (const cb of observadores) {
      try {
        cb(pode(chave));
      } catch (e) {
        console.error(`Observador de permissão '${chave}' falhou:`, e);
      }
    }
  }
}

// Relê a view inteira e avisa só quem mudou.
//
// Por que reler a view em vez de aplicar o payload do Realtime direto: o
// evento diz "permissoes_turma.camada_bdgex virou false", mas NÃO diz qual é
// o valor efetivo depois disso — se aquele aluno tiver um override
// individual, o padrão da turma não muda nada para ele. Quem sabe resolver a
// precedência é a view. Um round-trip a cada mudança é barato: mudança de
// permissão é o instrutor clicando, não o GPS disparando.
async function recarregar({ silencioso = false } = {}) {
  const linhas = await buscarEfetivasDoUsuario(meuUserId);
  if (linhas === null) {
    if (!silencioso) status('não foi possível ler (usando padrões)', '#f5c842');
    return;
  }

  const mudadas = [];
  const vistas = new Set();
  for (const linha of linhas) {
    vistas.add(linha.chave);
    const anterior = efetivas.get(linha.chave);
    efetivas.set(linha.chave, {
      habilitada: linha.habilitada,
      origem: linha.origem,
      categoria: linha.categoria,
    });
    if (!anterior || anterior.habilitada !== linha.habilitada) mudadas.push(linha.chave);
  }
  // Chave que sumiu da view (catálogo encolheu): volta ao padrão conhecido.
  for (const chave of [...efetivas.keys()]) {
    if (!vistas.has(chave)) {
      efetivas.delete(chave);
      mudadas.push(chave);
    }
  }

  carregado = true;
  const desabilitadas = linhas.filter((l) => !l.habilitada).length;
  status(
    desabilitadas === 0
      ? 'todas liberadas'
      : `${desabilitadas} restrição${desabilitadas === 1 ? '' : 'ões'} do instrutor`,
    desabilitadas === 0 ? '#7af57a' : '#f5c842'
  );

  if (mudadas.length) notificar(mudadas);
}

// Vários toggles seguidos no painel do instrutor viram vários eventos de
// Realtime em poucos milissegundos. Sem esperar, cada um dispararia uma
// releitura da view. 200ms junta a rajada num pedido só e continua
// imperceptível para quem está olhando a tela.
function agendarRecarga() {
  if (recarregarAgendado) clearTimeout(recarregarAgendado);
  recarregarAgendado = setTimeout(() => {
    recarregarAgendado = null;
    recarregar({ silencioso: true });
  }, 200);
}

// Duas assinaturas, uma por camada que o instrutor pode mexer. Ambas as
// tabelas estão publicadas no Realtime desde a 0001 (com REPLICA IDENTITY
// FULL) — é exatamente para isto que elas foram publicadas.
// O filtro é feito no servidor: só as linhas da minha turma e as do meu
// próprio override chegam ao navegador.
function assinarCanais() {
  canalTurma = supabase
    .channel(`permissoes-turma-${minhaTurmaId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'permissoes_turma',
        filter: `turma_id=eq.${minhaTurmaId}`,
      },
      agendarRecarga
    )
    .subscribe();

  canalUsuario = supabase
    .channel(`permissoes-usuario-${meuUserId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'permissoes_usuario',
        filter: `usuario_id=eq.${meuUserId}`,
      },
      agendarRecarga
    )
    .subscribe((estadoCanal) => {
      if (estadoCanal === 'CHANNEL_ERROR' || estadoCanal === 'TIMED_OUT') {
        status('sem conexão ao vivo — recarregue a página', '#e05252');
      }
    });
}

// ── Ponto de entrada (app do aluno) ──────────────────────────────────────
// Deve ser AGUARDADO antes de iniciar gps.js/colegas.js/marcacoes.js: assim
// o primeiro observarPermissao() de cada módulo já recebe o valor real, e não
// o padrão otimista.
export async function iniciarPermissoes({ userId, turmaId }) {
  meuUserId = userId;
  minhaTurmaId = turmaId || null;

  status('carregando…');

  // O catálogo entra primeiro e serve de rede de segurança: se a view falhar
  // (rede caindo, RLS mudando), pode() ainda responde com o padrão global em
  // vez de um `true` cego.
  const catalogo = await buscarCatalogo();
  catalogo.forEach((c) => padroesCatalogo.set(c.chave, c.padrao));

  await recarregar();

  if (minhaTurmaId) {
    assinarCanais();
  } else {
    // Sem turma não há padrão de turma para assinar; o override individual
    // também não faria sentido antes de o aluno entrar em alguma. Mesma
    // postura de gps.js/colegas.js: não assina canal à toa.
    status('aguardando você entrar em uma turma', '#f5c842');
  }

  window.addEventListener('beforeunload', pararPermissoes);
}

export function pararPermissoes() {
  if (canalTurma) { supabase.removeChannel(canalTurma); canalTurma = null; }
  if (canalUsuario) { supabase.removeChannel(canalUsuario); canalUsuario = null; }
  if (recarregarAgendado) { clearTimeout(recarregarAgendado); recarregarAgendado = null; }
}
