// auth.js — módulo central de autenticação do WartoolC2 (Etapa 2b).
//
// Reunido aqui para não repetir a mesma lógica em login.html, index.html e
// instrutor.html. É um "módulo ES" (ES module): um arquivo JavaScript que usa
// `import`/`export` e só funciona quando carregado com <script type="module">
// a partir de um servidor HTTP (http://...), nunca abrindo o HTML direto pelo
// Explorer (file://) — o navegador bloqueia `import` nesse caso por segurança.
//
// "RPC" (Remote Procedure Call) = chamar uma função que já existe dentro do
// banco Postgres, em vez de fazer select/insert direto numa tabela. Aqui usamos
// a RPC entrar_na_turma(codigo), que já existe em backend/supabase/0002_rls.sql.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.111.0';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DOMINIO_EMAIL = '@wartool.local';
const REGEX_USUARIO = /^[a-zA-Z0-9._-]{3,20}$/;

// ── Utilitários de usuário/e-mail ───────────────────────────────────────────

// O formulário nunca mostra "e-mail" ao usuário: ele digita só um nome curto
// ("joao") e este código completa por baixo dos panos para "joao@wartool.local".
// Isso é só um truque para reaproveitar o Supabase Auth (que exige e-mail),
// sem que ninguém em campo precise ter ou lembrar de um e-mail de verdade.
export function usuarioParaEmail(usuario) {
  return `${usuario}${DOMINIO_EMAIL}`;
}

export function validarUsuario(usuario) {
  return REGEX_USUARIO.test(usuario || '');
}

// ── Tradução de erros do Supabase para mensagens legíveis em PT-BR ─────────
export function traduzirErro(error) {
  if (!error) return 'Erro desconhecido.';
  const msg = (error.message || '').toLowerCase();

  if (msg.includes('already registered') || msg.includes('already exists')) {
    return 'Esse usuário já está cadastrado. Tente entrar em vez de cadastrar.';
  }
  if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
    return 'Usuário ou senha incorretos.';
  }
  if (msg.includes('password should be at least') || msg.includes('password is too short')) {
    return 'A senha precisa ter pelo menos 6 caracteres.';
  }
  if (msg.includes('email not confirmed')) {
    return 'Conta ainda não confirmada. Fale com o instrutor.';
  }
  if (msg.includes('código de turma inválido') || msg.includes('turma inativa')) {
    // Essa já vem em português direto do banco (backend/supabase/0002_rls.sql).
    return error.message;
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
    return 'Não foi possível conectar ao servidor. Verifique sua internet e o arquivo frontend/config.js.';
  }
  return `Não foi possível completar a operação (${error.message}).`;
}

// ── Cadastro ─────────────────────────────────────────────────────────────
// Fluxo: valida campos -> signUp -> grava nome_guerra -> entra na turma TESTE
// via RPC de verdade (não é atalho: é o mesmo caminho que qualquer aluno usa
// depois, com qualquer código de turma).
export async function cadastrar({ usuario, senha, nomeGuerra }) {
  const usuarioLimpo = (usuario || '').trim().toLowerCase();
  const nomeGuerraLimpo = (nomeGuerra || '').trim();

  if (!validarUsuario(usuarioLimpo)) {
    return { erro: 'Usuário deve ter de 3 a 20 caracteres: letras, números, ponto, hífen ou underscore (sem espaços, sem @).' };
  }
  if (!nomeGuerraLimpo) {
    return { erro: 'Informe o nome de guerra — é o que aparece no mapa.' };
  }
  if (!senha || senha.length < 6) {
    return { erro: 'A senha precisa ter pelo menos 6 caracteres.' };
  }

  const email = usuarioParaEmail(usuarioLimpo);

  // A trigger fn_criar_perfil_para_novo_usuario (0001_schema_inicial.sql) só lê
  // nome_completo e papel dos metadados — não existe campo "nome de guerra" no
  // signUp, então mandamos o próprio nome de guerra como nome_completo (o
  // cadastro é aberto e simples nesta etapa, sem pedir nome completo à parte).
  const { data, error } = await supabase.auth.signUp({
    email,
    password: senha,
    options: { data: { nome_completo: nomeGuerraLimpo } },
  });

  if (error) return { erro: traduzirErro(error) };

  let session = data.session;
  if (!session) {
    // Não deveria acontecer com a confirmação de e-mail desligada, mas cobre
    // o caso de sobrar sem sessão por qualquer motivo.
    const { data: loginData, error: erroLogin } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (erroLogin) return { erro: traduzirErro(erroLogin) };
    session = loginData.session;
  }

  const userId = session.user.id;

  // A trigger não grava nome_guerra (só nome_completo/papel), então gravamos
  // aqui. É uma atualização do PRÓPRIO perfil, permitida pela policy
  // perfis_editar_proprio desde que o papel não mude — e aqui não muda.
  const { error: erroPerfil } = await supabase
    .from('perfis')
    .update({ nome_guerra: nomeGuerraLimpo })
    .eq('id', userId);
  if (erroPerfil) {
    console.warn('Falha ao gravar nome de guerra:', erroPerfil.message);
  }

  // Entrada na turma de teste — caminho real via RPC (não é atalho).
  // Se falhar (ex.: a turma TESTE ainda não foi criada no SQL Editor), o
  // cadastro continua válido; a tela seguinte mostra um aviso e permite tentar
  // de novo com um código manual.
  let avisoTurma = null;
  const { error: erroTurma } = await supabase.rpc('entrar_na_turma', { p_codigo: 'TESTE' });
  if (erroTurma) {
    avisoTurma = `Cadastro criado, mas não foi possível entrar na turma de teste automaticamente: ${traduzirErro(erroTurma)}`;
  }

  return { ok: true, avisoTurma };
}

// ── Login ────────────────────────────────────────────────────────────────
export async function entrar({ usuario, senha }) {
  const usuarioLimpo = (usuario || '').trim().toLowerCase();
  if (!usuarioLimpo || !senha) {
    return { erro: 'Preencha usuário e senha.' };
  }

  const email = usuarioParaEmail(usuarioLimpo);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) return { erro: traduzirErro(error) };

  return { ok: true, session: data.session };
}

// ── Logout ───────────────────────────────────────────────────────────────
export async function sair() {
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}

// ── Perfil ───────────────────────────────────────────────────────────────
// Traz papel, nome_guerra, turma_id e (se houver turma) nome/código da turma,
// num só round-trip usando o embed de relação do PostgREST.
//
// Existem DOIS caminhos de FK entre perfis e turmas: perfis.turma_id -> turmas.id
// (o que queremos aqui) e turmas.instrutor_id -> perfis.id (o instrutor
// responsável pela turma). Sem dizer qual usar, o PostgREST não consegue
// decidir sozinho e devolve erro PGRST201 ("more than one relationship was
// found") em vez do dado — por isso o `!perfis_turma_id_fkey` explícito abaixo,
// apontando a constraint certa (nome que o próprio erro sugeriu no `hint`).
export async function buscarPerfil(userId) {
  // `sidc` entrou aqui na Etapa 3 (frontend/gps.js precisa dele para desenhar
  // o avatar próprio no mapa) — antes só era lido direto do banco pelo QGIS.
  //
  // `partido_id` + o embed `partido` entraram na Etapa 4.5: é o partido de
  // QUEM ESTÁ OLHANDO que define a hostilidade com que todo o resto aparece
  // na tela (ver hostilidadeRelativa em simbolos.js). O `tipo` vem junto
  // porque é ele — e não o nome do partido — que diz se a força é neutra.
  // Só existe um caminho de FK entre perfis e partidos, então este embed não
  // precisa do hint de constraint que o de `turmas` precisa (ver acima).
  //
  // `preferencias_visualizacao` é o jsonb de FILTROS do próprio usuário
  // (o que ele escolhe ver). Não confundir com permissão, que é o que o
  // instrutor deixa ver e mora na RLS. A interface de filtros em si é etapa
  // posterior; aqui só garantimos que o dado chega junto do perfil.
  const { data, error } = await supabase
    .from('perfis')
    .select(
      'papel, nome_guerra, turma_id, sidc, partido_id, preferencias_visualizacao,' +
      ' turma:turmas!perfis_turma_id_fkey(nome, codigo_acesso),' +
      ' partido:partidos(id, nome, tipo, cor)'
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    // Antes isso era engolido em silêncio — agora fica no console (F12) pra
    // dar pra diagnosticar (RLS, coluna errada, sem linha em perfis etc.).
    console.error('buscarPerfil falhou:', error);
    return null;
  }
  if (!data) {
    console.warn('buscarPerfil: nenhuma linha em public.perfis para o id', userId);
    return null;
  }
  return data;
}

// Busca em lote os perfis (id, nome_guerra, sidc) de todo mundo de uma turma
// — usada pela Etapa 4 (frontend/colegas.js) para montar, de uma vez só, o
// "quem é quem" antes de desenhar os avatares dos colegas. Deliberadamente
// mais enxuta que buscarPerfil(): não faz embed de turma, porque aqui só
// interessam os 3 campos que o avatar do colega precisa.
// `excluirId` tira o próprio usuário da lista (ele já é desenhado por
// gps.js, não precisa de novo aqui).
// `partido:partidos(id, tipo)` entrou na Etapa 4.5: colegas.js precisa do
// partido do COLEGA (e do próprio, que vem de buscarPerfil) para derivar a
// hostilidade com que desenha o avatar. Vem embutido no mesmo round-trip em
// vez de virar uma segunda consulta por partido.
export async function buscarPerfisDaTurma(turmaId, { excluirId } = {}) {
  let query = supabase
    .from('perfis')
    .select('id, nome_guerra, sidc, partido_id, partido:partidos(id, tipo)')
    .eq('turma_id', turmaId);
  if (excluirId) query = query.neq('id', excluirId);

  const { data, error } = await query;
  if (error) {
    console.error('buscarPerfisDaTurma falhou:', error);
    return [];
  }
  return data || [];
}

// Busca o perfil básico (id, nome_guerra, sidc) de UM usuário só. Usada como
// caminho de reserva por colegas.js: se chegar uma posição de alguém que não
// estava na turma no momento do carregamento inicial (ex.: colega se
// cadastrou e entrou na turma depois que esta página já estava aberta), a
// lista em lote de buscarPerfisDaTurma() não o conhece ainda — este fallback
// busca só aquele perfil, uma vez, e quem chamar deve guardar o resultado
// para não repetir a consulta a cada posição nova da mesma pessoa.
export async function buscarPerfilBasico(usuarioId) {
  const { data, error } = await supabase
    .from('perfis')
    .select('id, nome_guerra, sidc, partido_id, partido:partidos(id, tipo)')
    .eq('id', usuarioId)
    .maybeSingle();
  if (error) {
    console.error('buscarPerfilBasico falhou:', error);
    return null;
  }
  return data;
}

// Lista os usuários de uma turma com os campos que o PAINEL DO INSTRUTOR
// (Etapa 6a) precisa mostrar: nome de guerra, papel e partido. Deliberadamente
// separada de buscarPerfisDaTurma(), que é a versão enxuta usada por
// colegas.js para desenhar avatares (lá `papel` e `posto_graduacao` não
// interessam, e trazer coluna à toa numa consulta que roda no caminho crítico
// do mapa seria desperdício).
// A ordenação final (instrutor primeiro, depois por nome de guerra) é feita
// aqui em JavaScript e não no `order` do PostgREST: `papel` é um enum do
// Postgres e ordenar por ele dependeria da ordem em que os valores foram
// declarados no `create type` — um detalhe do banco que não deve decidir o
// layout de uma tela.
// `sidc` entrou na Etapa 6b: a tela de debriefing (frontend/debriefing.js)
// desenha o símbolo NATO de cada aluno no replay e precisa do SIDC dele. Foi
// acrescentado AQUI em vez de virar uma segunda consulta porque as duas telas
// do instrutor pedem a mesma lista de gente da mesma turma — e a segunda cópia
// de uma consulta é a que diverge em silêncio quando alguém acrescenta uma
// coluna só de um lado (mesmo critério que criou icones.js na Etapa 5). O
// painel de permissões não usa a coluna e não é prejudicado por ela; o que
// continua valendo é não engordar buscarPerfisDaTurma(), essa sim no caminho
// crítico do mapa do aluno.
export async function buscarUsuariosDaTurma(turmaId) {
  const { data, error } = await supabase
    .from('perfis')
    .select('id, nome_guerra, nome_completo, papel, posto_graduacao, ativo, sidc, partido:partidos(id, nome, cor, tipo)')
    .eq('turma_id', turmaId);
  if (error) {
    console.error('buscarUsuariosDaTurma falhou:', error);
    return [];
  }
  const lista = data || [];
  return lista.sort((a, b) => {
    if (a.papel !== b.papel) return a.papel === 'instrutor' ? -1 : 1;
    return (a.nome_guerra || a.nome_completo || '').localeCompare(
      b.nome_guerra || b.nome_completo || '', 'pt-BR'
    );
  });
}

// Partidos (forças) ativos de uma turma, na ordem de exibição.
// Nasceu privada dentro de marcacoes.js na Etapa 5; virou compartilhada na
// Etapa 6a, quando o painel do instrutor passou a precisar da mesma lista
// para o seletor de força de cada aluno. Extraída em vez de copiada pelo
// mesmo critério que criou icones.js: a segunda cópia de uma consulta é a que
// diverge em silêncio quando alguém acrescenta uma coluna só em um dos lados.
// A policy `partidos_ler` (0003) libera a leitura para qualquer autenticado
// da turma.
export async function buscarPartidosDaTurma(turmaId) {
  const { data, error } = await supabase
    .from('partidos')
    .select('id, nome, tipo, cor, ordem')
    .eq('turma_id', turmaId)
    .eq('ativo', true)
    .order('ordem', { ascending: true });
  if (error) {
    console.error('buscarPartidosDaTurma falhou:', error);
    return [];
  }
  return data || [];
}

// Move um aluno para uma força (ou tira dele, com partidoId = null).
//
// Três guardas do banco valem para esta chamada, e nenhuma delas está aqui:
//   - `perfis_editar_instrutor` (0002) só deixa o instrutor da turma escrever;
//   - `fn_proteger_campos_do_perfil` (0003) rejeita a troca se quem chamou não
//     for instrutor — é o que impede o aluno de virar do outro lado sozinho;
//   - `fn_normalizar_partido_do_perfil` (0003) rejeita partido que não seja da
//     turma daquele perfil.
// O cliente não repete nenhuma delas: só traduz o erro que voltar.
export async function definirPartidoDoUsuario(usuarioId, partidoId) {
  const { error } = await supabase
    .from('perfis')
    .update({ partido_id: partidoId || null })
    .eq('id', usuarioId);
  return { error };
}

// Turmas que ESTE instrutor pode administrar. A policy `turmas_ler` (0002)
// devolve tanto a turma em que ele está lotado (perfis.turma_id) quanto as
// que ele responde (turmas.instrutor_id) — que é exatamente o mesmo par de
// condições de fn_sou_instrutor_da_turma(), a função que autoriza a ESCRITA
// nas tabelas de permissão. Ou seja: o que volta aqui é o que ele consegue
// de fato configurar.
export async function buscarTurmasDoInstrutor() {
  const { data, error } = await supabase
    .from('turmas')
    .select('id, nome, codigo_acesso, ativa, instrutor_id')
    .order('nome', { ascending: true });
  if (error) {
    console.error('buscarTurmasDoInstrutor falhou:', error);
    return [];
  }
  return data || [];
}

// Entrar numa turma pelo código, fora do fluxo de cadastro (ex.: quando o
// cadastro automático na turma TESTE falhou, ou para trocar de turma depois).
export async function entrarNaTurmaComCodigo(codigo) {
  const codigoLimpo = (codigo || '').trim();
  if (!codigoLimpo) return { erro: 'Informe o código de acesso da turma.' };

  const { error } = await supabase.rpc('entrar_na_turma', { p_codigo: codigoLimpo });
  if (error) return { erro: traduzirErro(error) };
  return { ok: true };
}

// ── Guard de sessão (usado no topo de index.html e instrutor.html) ─────────
// "Sessão" = o estado de estar logado, guardado pelo supabase-js (token JWT)
// no localStorage do navegador; é o que permite recarregar a página sem
// precisar logar de novo. "JWT" = o token assinado que prova, para o banco,
// quem é o usuário — é dele que vem o auth.uid() usado nas políticas de RLS.
//
// papelEsperado: 'usuario' | 'instrutor' | undefined (undefined = qualquer um).
// Retorna { session, perfil } se tudo certo, ou null (e já redireciona).
export async function exigirSessao(papelEsperado) {
  const { data: { session }, error: erroSessao } = await supabase.auth.getSession();
  if (erroSessao || !session) {
    redirecionarParaLogin('sessao_expirada');
    return null;
  }

  const perfil = await buscarPerfil(session.user.id);
  if (!perfil) {
    // Sessão válida mas sem perfil legível (ex.: token velho de uma conta
    // apagada) — trata como sessão expirada, é a mensagem mais clara para
    // quem não é técnico.
    redirecionarParaLogin('sessao_expirada');
    return null;
  }

  if (papelEsperado && perfil.papel !== papelEsperado) {
    window.location.replace(perfil.papel === 'instrutor' ? 'instrutor.html' : 'index.html');
    return null;
  }

  return { session, perfil };
}

function redirecionarParaLogin(motivo) {
  window.location.replace(`login.html?msg=${motivo}`);
}

// Se a sessão cair no meio do uso (ex.: token revogado em outra aba), manda
// de volta pro login em vez de deixar a tela quebrada em silêncio.
supabase.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') {
    redirecionarParaLogin('deslogado');
  }
});
