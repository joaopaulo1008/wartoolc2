// logica.js — o que a Edge Function `importar-turma` faz, sem nada de Deno.
//
// Separado de index.ts para poder ser TESTADO em Node com um cliente de mentira
// (logica.teste.mjs). index.ts só cuida do que é do ambiente: ler o JWT, montar
// o cliente com a service_role e responder HTTP.
//
// POR QUE ISTO RODA NO SERVIDOR
// -----------------------------
// Criar uma conta e dar a ela papel de instrutor exige a service_role key, que
// ignora toda a RLS e NUNCA pode ir para o navegador (regra dura 1 do
// CLAUDE.md). Então o navegador manda o pedido, e quem tem a chave — uma função
// no servidor do Supabase — confere QUEM pediu e executa.
//
// A REGRA DE AUTORIZAÇÃO
// ----------------------
// Só uma conta com perfis.papel = 'instrutor' pode chamar. A turma criada fica
// com `instrutor_id` = quem chamou (como a policy `turmas_criar` já exigiria se
// o instrutor a criasse pelo próprio navegador). Ninguém cria turma "em nome
// de" outro instrutor, e esta função não toca em turma que já existe.
//
// O QUE ELA NÃO FAZ (de propósito)
// --------------------------------
// - Não move conta que já existe para a turma nova: reporta "já existia" e
//   segue. Mudar a turma de quem está treinando é decisão consciente, não efeito
//   colateral de subir uma planilha.
// - Não redefine senha de ninguém.
// - Nunca devolve nem registra senha.
//
// ATOMICIDADE: não há transação (o Auth Admin API é HTTP, não SQL). Se NENHUMA
// conta puder ser criada, a turma é apagada de volta; se algumas falharem, a
// turma fica e o relatório diz quais — o instrutor corrige essas linhas e as
// cria à mão ou em nova importação com outro código.

// Estas constantes têm que ser IGUAIS às de frontend/importar-turma.js — um
// teste (importar-turma.teste.mjs) lê os dois e compara.
export const REGEX_USUARIO = /^[a-zA-Z0-9._-]{3,20}$/;
export const SENHA_MINIMA = 6;
export const SENHA_MAXIMA = 72;
export const REGEX_CODIGO_TURMA = /^[A-Za-z0-9._-]{4,30}$/;
export const MAX_PESSOAS = 300;
export const DOMINIO_EMAIL = '@wartool.local';   // o mesmo de frontend/auth.js
export const MODOS_NA_CRIACAO = ['gps', 'manual'];

const PAPEIS = ['instrutor', 'usuario'];

export class ErroDePedido extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// Revalida o pedido inteiro. Devolve o pedido normalizado ou lança ErroDePedido(400).
export function validarPedido(pedido) {
  if (!pedido || typeof pedido !== 'object') throw new ErroDePedido(400, 'Pedido vazio ou inválido.');
  const t = pedido.turma;
  if (!t || typeof t !== 'object') throw new ErroDePedido(400, 'Faltam os dados da turma.');

  const turma = {
    nome: texto(t.nome),
    codigo_acesso: texto(t.codigo_acesso),
    modo_posicao: t.modo_posicao ?? 'gps',
    descricao: texto(t.descricao) || null,
  };
  if (turma.nome.length < 3 || turma.nome.length > 80) throw new ErroDePedido(400, 'Nome da turma inválido (3 a 80 caracteres).');
  if (!REGEX_CODIGO_TURMA.test(turma.codigo_acesso)) throw new ErroDePedido(400, 'Código de acesso inválido (4 a 30 caracteres: letras, números, ponto, hífen, sublinhado).');
  if (!MODOS_NA_CRIACAO.includes(turma.modo_posicao)) throw new ErroDePedido(400, 'Modo de posição inválido.');

  if (!Array.isArray(pedido.pessoas) || pedido.pessoas.length === 0) throw new ErroDePedido(400, 'Nenhuma pessoa no pedido.');
  if (pedido.pessoas.length > MAX_PESSOAS) throw new ErroDePedido(400, `Mais de ${MAX_PESSOAS} pessoas num pedido.`);

  const vistos = new Set();
  const pessoas = pedido.pessoas.map((p, i) => {
    const onde = `Pessoa ${i + 1}`;
    if (!p || typeof p !== 'object') throw new ErroDePedido(400, `${onde}: formato inválido.`);
    const usuario = texto(p.usuario).toLowerCase();
    if (!REGEX_USUARIO.test(usuario)) throw new ErroDePedido(400, `${onde}: usuário inválido.`);
    if (vistos.has(usuario)) throw new ErroDePedido(400, `${onde}: usuário "${usuario}" repetido.`);
    vistos.add(usuario);
    const senha = typeof p.senha === 'string' ? p.senha : '';
    if (senha.length < SENHA_MINIMA || senha.length > SENHA_MAXIMA) throw new ErroDePedido(400, `${onde} (${usuario}): senha fora do tamanho permitido.`);
    if (!PAPEIS.includes(p.papel)) throw new ErroDePedido(400, `${onde} (${usuario}): papel inválido.`);
    const nomeGuerra = texto(p.nome_guerra);
    if (!nomeGuerra || nomeGuerra.length > 30) throw new ErroDePedido(400, `${onde} (${usuario}): nome de guerra inválido.`);
    if (typeof p.sidc !== 'string' || !/^[0-9]{20}$/.test(p.sidc)) throw new ErroDePedido(400, `${onde} (${usuario}): SIDC inválido.`);
    const partido = texto(p.partido) || null;
    if (p.papel === 'usuario' && !partido) throw new ErroDePedido(400, `${onde} (${usuario}): aluno precisa de partido.`);
    return {
      usuario,
      senha,
      nome_completo: texto(p.nome_completo) || nomeGuerra,
      nome_guerra: nomeGuerra,
      posto_graduacao: texto(p.posto_graduacao) || null,
      papel: p.papel,
      partido,
      sidc: p.sidc,
    };
  });
  return { turma, pessoas };
}

const jaExiste = (msg) => /already (been )?registered|already exists|duplicate/i.test(msg || '');

/**
 * @param {object} args
 * @param {object} args.admin       cliente supabase-js com service_role
 * @param {string} args.chamadorId  id de quem chamou (já autenticado pelo JWT)
 * @param {object} args.pedido      corpo do pedido (será revalidado)
 */
export async function importarTurma({ admin, chamadorId, pedido }) {
  // 1) Quem chamou é instrutor? (a service_role ignora RLS, então a checagem é nossa.)
  const { data: chamador, error: erroChamador } = await admin
    .from('perfis').select('papel').eq('id', chamadorId).maybeSingle();
  if (erroChamador) throw new ErroDePedido(500, 'Não foi possível conferir o papel de quem chamou.');
  if (!chamador || chamador.papel !== 'instrutor') throw new ErroDePedido(403, 'Só instrutor pode importar uma turma.');

  // 2) Revalida tudo, porque o navegador pode ter sido contornado.
  const { turma, pessoas } = validarPedido(pedido);

  // 3) O código de acesso já existe?
  const { data: existente, error: erroCodigo } = await admin
    .from('turmas').select('id').eq('codigo_acesso', turma.codigo_acesso).maybeSingle();
  if (erroCodigo) throw new ErroDePedido(500, 'Não foi possível conferir o código de acesso.');
  if (existente) throw new ErroDePedido(409, `Já existe uma turma com o código "${turma.codigo_acesso}". Escolha outro.`);

  // 4) Cria a turma. A trigger da migration 0003 cria Azul e Vermelho.
  const linhaTurma = {
    nome: turma.nome,
    descricao: turma.descricao,
    codigo_acesso: turma.codigo_acesso,
    instrutor_id: chamadorId,
    ativa: true,
  };
  // 'gps' é o padrão da coluna; só manda o modo quando há o que mandar, para a
  // importação continuar funcionando num banco onde a 0016 ainda não rodou.
  if (turma.modo_posicao !== 'gps') linhaTurma.modo_posicao = turma.modo_posicao;
  const { data: nova, error: erroTurma } = await admin
    .from('turmas').insert(linhaTurma).select('id, nome, codigo_acesso').single();
  if (erroTurma) {
    if (erroTurma.code === '42703') throw new ErroDePedido(409, 'O banco ainda não tem o modo de posição (migration 0016). Use o modo GPS ou aplique a migration.');
    throw new ErroDePedido(500, `Não foi possível criar a turma: ${erroTurma.message}`);
  }

  // 5) Partidos da turma recém-criada.
  const { data: partidos, error: erroPartidos } = await admin
    .from('partidos').select('id, nome').eq('turma_id', nova.id);
  if (erroPartidos) {
    await admin.from('turmas').delete().eq('id', nova.id);
    throw new ErroDePedido(500, 'Não foi possível ler os partidos da turma nova.');
  }
  const partidoPorNome = new Map((partidos ?? []).map((p) => [p.nome.trim().toLowerCase(), p.id]));

  // 6) Contas, uma a uma. Falha de uma não derruba as outras.
  const criados = [];
  const jaExistiam = [];
  const erros = [];
  for (const [i, p] of pessoas.entries()) {
    const ordem = i + 1;
    const partidoId = p.partido ? partidoPorNome.get(p.partido.toLowerCase()) : null;
    if (p.partido && !partidoId) {
      erros.push({ ordem, usuario: p.usuario, motivo: `partido "${p.partido}" não existe nesta turma` });
      continue;
    }

    // O papel NÃO vai nos metadados do createUser: a trigger de perfil leria dali,
    // e a fonte da verdade do papel é o UPDATE abaixo, feito por esta função.
    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email: `${p.usuario}${DOMINIO_EMAIL}`,
      password: p.senha,
      email_confirm: true,
      user_metadata: { nome_completo: p.nome_completo },
    });
    if (erroCriar) {
      if (jaExiste(erroCriar.message)) jaExistiam.push(p.usuario);
      else erros.push({ ordem, usuario: p.usuario, motivo: erroCriar.message });
      continue;
    }

    // service_role não tem auth.uid(): fn_proteger_campos_do_perfil deixa passar
    // a troca de papel e de turma (0002), sem precisar de entrar_na_turma().
    const { error: erroPerfil } = await admin.from('perfis').update({
      papel: p.papel,
      turma_id: nova.id,
      nome_completo: p.nome_completo,
      nome_guerra: p.nome_guerra,
      posto_graduacao: p.posto_graduacao,
      partido_id: partidoId ?? null,
      sidc: p.sidc,
    }).eq('id', criado.user.id);
    if (erroPerfil) {
      erros.push({ ordem, usuario: p.usuario, motivo: `conta criada, mas o perfil falhou: ${erroPerfil.message}` });
      continue;
    }
    criados.push(p.usuario);
  }

  // 7) Turma sem ninguém não serve a ninguém: desfaz.
  if (criados.length === 0) {
    await admin.from('turmas').delete().eq('id', nova.id);
    return { turma: null, criados, jaExistiam, erros, desfeita: true };
  }
  return { turma: nova, criados, jaExistiam, erros, desfeita: false };
}
