// logica.teste.mjs — testa a Edge Function `importar-turma` SEM Supabase.
//
// Rodar:  node backend/supabase/functions/importar-turma/logica.teste.mjs
//
// O QUE ESTE TESTE PROVA E O QUE NÃO PROVA
// ----------------------------------------
// Prova a regra: quem pode chamar, o que é recusado, o que acontece quando
// parte das contas falha, que a senha não vaza na resposta, e a ORDEM das
// operações. NÃO prova a conversa com o Supabase de verdade: o cliente aqui é
// um dublê em memória escrito para este teste, então "o Auth Admin API aceita
// esta chamada" e "a service_role passa pela trigger de perfis" continuam sendo
// afirmações, até a função ser publicada e rodada uma vez contra o projeto.

import { importarTurma, validarPedido, ErroDePedido } from './logica.js';

let passou = 0;
const falhas = [];
function ok(nome, obtido, esperado) {
  const bom = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bom) passou += 1;
  else { falhas.push(nome); console.log(`  ** FALHOU **  ${nome}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(obtido)}`); }
}
async function lanca(nome, fn, status) {
  try { await fn(); falhas.push(nome); console.log(`  ** FALHOU **  ${nome} (não lançou)`); }
  catch (e) {
    const bom = e instanceof ErroDePedido && (status == null || e.status === status);
    if (bom) passou += 1; else { falhas.push(nome); console.log(`  ** FALHOU **  ${nome}: ${e?.status} ${e?.message}`); }
  }
}

// ── Dublê do cliente admin ──────────────────────────────────────────────────
function criarAdmin({ papelDoChamador = 'instrutor', contasExistentes = [], falhaPerfilPara = [], falhaCriarPara = [], semPartidos = false, falhaTurma = null } = {}) {
  const bd = {
    perfis: new Map([['chamador-1', { papel: papelDoChamador }]]),
    turmas: [],
    partidos: [],
    usuarios: new Map(contasExistentes.map((u, i) => [u, `pre-${i}`])),
    chamadas: [],
  };
  let seq = 0;
  const tabela = (nome) => {
    const filtros = [];
    let operacao = null;
    let dados = null;
    const api = {
      select() { operacao = operacao || 'select'; return api; },
      insert(linha) { operacao = 'insert'; dados = linha; return api; },
      update(linha) { operacao = 'update'; dados = linha; return api; },
      delete() { operacao = 'delete'; return api; },
      eq(col, val) { filtros.push([col, val]); return api; },
      async maybeSingle() { return executar(true); },
      async single() { return executar(true); },
      then(res, rej) { return executar(false).then(res, rej); },
    };
    async function executar(unico) {
      bd.chamadas.push(`${operacao}:${nome}`);
      const casa = (l) => filtros.every(([c, v]) => l[c] === v);
      if (nome === 'perfis') {
        if (operacao === 'select') {
          const l = bd.perfis.get(filtros.find(([c]) => c === 'id')?.[1]);
          return { data: unico ? (l ?? null) : (l ? [l] : []), error: null };
        }
        if (operacao === 'update') {
          const id = filtros.find(([c]) => c === 'id')[1];
          if (falhaPerfilPara.includes(id)) return { data: null, error: { message: 'perfil quebrou' } };
          bd.perfis.set(id, { ...(bd.perfis.get(id) || {}), ...dados });
          return { data: null, error: null };
        }
      }
      if (nome === 'turmas') {
        if (operacao === 'select') {
          const achou = bd.turmas.find(casa);
          return { data: unico ? (achou ?? null) : bd.turmas.filter(casa), error: null };
        }
        if (operacao === 'insert') {
          if (falhaTurma) return { data: null, error: falhaTurma };
          const t = { id: `turma-${bd.turmas.length + 1}`, ...dados };
          bd.turmas.push(t);
          if (!semPartidos) {
            bd.partidos.push({ id: `${t.id}-azul`, turma_id: t.id, nome: 'Azul' }, { id: `${t.id}-verm`, turma_id: t.id, nome: 'Vermelho' });
          }
          return { data: { id: t.id, nome: t.nome, codigo_acesso: t.codigo_acesso }, error: null };
        }
        if (operacao === 'delete') {
          bd.turmas = bd.turmas.filter((t) => !casa(t));
          bd.partidos = bd.partidos.filter((p) => bd.turmas.some((t) => t.id === p.turma_id));
          return { data: null, error: null };
        }
      }
      if (nome === 'partidos' && operacao === 'select') {
        return { data: bd.partidos.filter(casa), error: null };
      }
      throw new Error(`dublê: operação não prevista ${operacao}:${nome}`);
    }
    return api;
  }
  return {
    bd,
    from: tabela,
    auth: { admin: {
      async createUser({ email, password, user_metadata }) {
        bd.chamadas.push(`createUser:${email}`);
        const usuario = email.split('@')[0];
        if (falhaCriarPara.includes(usuario)) return { data: null, error: { message: 'Database error creating new user' } };
        if (bd.usuarios.has(usuario)) return { data: null, error: { message: 'A user with this email address has already been registered' } };
        const id = `novo-${++seq}`;
        bd.usuarios.set(usuario, id);
        bd.perfis.set(id, { papel: user_metadata?.papel ?? 'usuario', senhaVista: password });
        return { data: { user: { id } }, error: null };
      },
    } },
  };
}

const pessoa = (usuario, extra = {}) => ({
  usuario, senha: 'senha-forte-1', nome_completo: `Nome ${usuario}`, nome_guerra: usuario.toUpperCase(),
  posto_graduacao: 'Cap', papel: 'usuario', partido: 'Azul', sidc: '10031000140000000000', ...extra,
});
const pedidoBase = (pessoas, turma = {}) => ({
  turma: { nome: 'Exercício Arandu', codigo_acesso: 'ARANDU-26', modo_posicao: 'manual', descricao: null, ...turma },
  pessoas,
});

// ── A: autorização ──────────────────────────────────────────────────────────
console.log('A autorização');
await lanca('A1 aluno não importa turma', () => importarTurma({ admin: criarAdmin({ papelDoChamador: 'usuario' }), chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01')]) }), 403);
await lanca('A2 chamador sem perfil é recusado', () => importarTurma({ admin: criarAdmin(), chamadorId: 'fantasma', pedido: pedidoBase([pessoa('aluno01')]) }), 403);
{
  const admin = criarAdmin({ papelDoChamador: 'usuario' });
  try { await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01')]) }); } catch { /* esperado */ }
  ok('A3 recusado ANTES de criar qualquer coisa', admin.bd.chamadas.filter((c) => !c.startsWith('select:perfis')), []);
}

// ── B: revalidação do pedido (o cliente pode ter sido contornado) ───────────
console.log('B revalidação');
const recusa = (nome, pedido) => lanca(nome, () => importarTurma({ admin: criarAdmin(), chamadorId: 'chamador-1', pedido }), 400);
await recusa('B1 sem turma', { pessoas: [pessoa('aluno01')] });
await recusa('B2 sem pessoas', pedidoBase([]));
await recusa('B3 código curto', pedidoBase([pessoa('aluno01')], { codigo_acesso: 'abc' }));
await recusa('B4 modo externa não é aceito na criação', pedidoBase([pessoa('aluno01')], { modo_posicao: 'externa' }));
await recusa('B5 usuário com @', pedidoBase([pessoa('a@b.com')]));
await recusa('B6 senha curta', pedidoBase([pessoa('aluno01', { senha: '123' })]));
await recusa('B7 senha longa demais', pedidoBase([pessoa('aluno01', { senha: 'x'.repeat(73) })]));
await recusa('B8 papel inventado', pedidoBase([pessoa('aluno01', { papel: 'admin' })]));
await recusa('B9 SIDC malformado', pedidoBase([pessoa('aluno01', { sidc: '123' })]));
await recusa('B10 aluno sem partido', pedidoBase([pessoa('aluno01', { partido: null })]));
await recusa('B11 usuário repetido', pedidoBase([pessoa('aluno01'), pessoa('ALUNO01')]));
await recusa('B12 mais de 300', pedidoBase(Array.from({ length: 301 }, (_, i) => pessoa(`aluno${String(i).padStart(3, '0')}`))));
ok('B13 instrutor sem partido é aceito', validarPedido(pedidoBase([pessoa('prof01', { papel: 'instrutor', partido: null })])).pessoas[0].partido, null);
ok('B14 usuário vira minúsculo', validarPedido(pedidoBase([pessoa('Aluno01')])).pessoas[0].usuario, 'aluno01');
{
  const admin = criarAdmin();
  try { await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('a@b.com')]) }); } catch { /* esperado */ }
  ok('B15 pedido inválido não cria turma nem conta', admin.bd.chamadas.filter((c) => !c.startsWith('select:perfis')), []);
}

// ── C: caminho feliz ────────────────────────────────────────────────────────
console.log('C caminho feliz');
{
  const admin = criarAdmin();
  const r = await importarTurma({
    admin, chamadorId: 'chamador-1',
    pedido: pedidoBase([
      pessoa('prof01', { papel: 'instrutor', partido: null }),
      pessoa('aluno01'),
      pessoa('aluno02', { partido: 'vermelho' }),
    ]),
  });
  ok('C1 turma criada', r.turma?.codigo_acesso, 'ARANDU-26');
  ok('C2 três contas', r.criados, ['prof01', 'aluno01', 'aluno02']);
  ok('C3 sem erros nem repetidas', [r.erros.length, r.jaExistiam.length, r.desfeita], [0, 0, false]);
  ok('C4 o chamador é o responsável da turma', admin.bd.turmas[0].instrutor_id, 'chamador-1');
  ok('C5 modo manual gravado', admin.bd.turmas[0].modo_posicao, 'manual');
  const perfil = (u) => admin.bd.perfis.get(admin.bd.usuarios.get(u));
  ok('C6 instrutor recebe o papel pelo UPDATE', perfil('prof01').papel, 'instrutor');
  ok('C7 aluno fica na turma nova', perfil('aluno01').turma_id, admin.bd.turmas[0].id);
  ok('C8 partido "Azul" resolvido', perfil('aluno01').partido_id, `${admin.bd.turmas[0].id}-azul`);
  ok('C9 partido sem diferenciar maiúsculas', perfil('aluno02').partido_id, `${admin.bd.turmas[0].id}-verm`);
  ok('C10 instrutor sem partido fica sem partido', perfil('prof01').partido_id, null);
  ok('C11 SIDC e nome de guerra gravados', [perfil('aluno01').sidc, perfil('aluno01').nome_guerra], ['10031000140000000000', 'ALUNO01']);
  ok('C12 a resposta não carrega a senha', JSON.stringify(r).includes('senha-forte-1'), false);
  ok('C13 a turma é criada ANTES das contas', admin.bd.chamadas.findIndex((c) => c === 'insert:turmas') < admin.bd.chamadas.findIndex((c) => c.startsWith('createUser')), true);
}
{
  const admin = criarAdmin();
  await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01')], { modo_posicao: 'gps' }) });
  ok('C14 modo gps não manda a coluna (banco sem a 0016 continua servindo)', 'modo_posicao' in admin.bd.turmas[0], false);
}
{
  const admin = criarAdmin();
  await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('prof01', { papel: 'instrutor', partido: null })]) });
  const metadados = admin.bd.perfis.get('novo-1');
  ok('C15 papel NÃO é pedido por metadados (o UPDATE é a fonte)', metadados.senhaVista !== undefined && metadados.papel, 'instrutor');
}

// ── D: falhas parciais ──────────────────────────────────────────────────────
console.log('D falhas');
{
  const admin = criarAdmin({ contasExistentes: ['aluno01'] });
  const r = await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01'), pessoa('aluno02')]) });
  ok('D1 conta existente é reportada, não movida', [r.jaExistiam, r.criados], [['aluno01'], ['aluno02']]);
  ok('D2 a conta existente não foi tocada', admin.bd.perfis.has('pre-0'), false);
}
{
  const admin = criarAdmin({ falhaCriarPara: ['aluno02'] });
  const r = await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01'), pessoa('aluno02'), pessoa('aluno03')]) });
  ok('D3 falha de uma não derruba as outras', r.criados, ['aluno01', 'aluno03']);
  ok('D4 o erro diz qual', [r.erros[0].usuario, r.erros[0].ordem], ['aluno02', 2]);
  ok('D5 a turma fica quando alguém foi criado', [r.desfeita, admin.bd.turmas.length], [false, 1]);
}
{
  const admin = criarAdmin({ falhaCriarPara: ['aluno01', 'aluno02'] });
  const r = await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01'), pessoa('aluno02')]) });
  ok('D6 ninguém criado → turma apagada de volta', [r.desfeita, r.turma, admin.bd.turmas.length], [true, null, 0]);
}
{
  const admin = criarAdmin({ falhaPerfilPara: ['novo-1'] });
  const r = await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01'), pessoa('aluno02')]) });
  ok('D7 perfil que falha é reportado como tal', [r.criados, /perfil falhou/.test(r.erros[0].motivo)], [['aluno02'], true]);
}
{
  const admin = criarAdmin();
  const r = await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01', { partido: 'Verde' })]) });
  ok('D8 partido que a turma não tem → erro da linha, sem conta criada', [r.criados.length, r.erros[0].motivo.includes('Verde'), admin.bd.chamadas.some((c) => c.startsWith('createUser'))], [0, true, false]);
}
await lanca('D9 código já usado → 409, nada criado', async () => {
  const admin = criarAdmin();
  await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01')]) });
  const antes = admin.bd.chamadas.length;
  try { await importarTurma({ admin, chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno09')]) }); }
  finally { ok('D9b não chamou createUser na segunda vez', admin.bd.chamadas.slice(antes).some((c) => c.startsWith('createUser')), false); }
}, 409);
await lanca('D10 banco sem a migration 0016 → mensagem clara', () => importarTurma({
  admin: criarAdmin({ falhaTurma: { code: '42703', message: 'column "modo_posicao" does not exist' } }),
  chamadorId: 'chamador-1', pedido: pedidoBase([pessoa('aluno01')]),
}), 409);

const total = passou + falhas.length;
console.log(`\n${passou} passaram, ${falhas.length} falharam, ${total} total`);
process.exit(falhas.length ? 1 : 0);
