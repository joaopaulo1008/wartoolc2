// importar-turma — Edge Function do Supabase (Deno).
//
// Cria uma turma e as contas das pessoas dela a partir de um pedido do painel
// do instrutor. Toda a regra está em ./logica.js (testada em Node); este
// arquivo só cuida do ambiente: CORS, ler o JWT de quem chamou e montar o
// cliente com a service_role.
//
// A service_role vem de variável de ambiente do PRÓPRIO Supabase
// (SUPABASE_SERVICE_ROLE_KEY, já injetada nas Edge Functions): não é digitada,
// não é commitada, nunca chega ao navegador.
//
// Como publicar (uma vez, e de novo a cada mudança neste diretório):
//   supabase functions deploy importar-turma
// Ver backend/supabase/functions/importar-turma/README.md.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { importarTurma, ErroDePedido } from './logica.js';

const CORS = {
  // O navegador chama de outra origem (GitHub Pages → supabase.co): sem estes
  // cabeçalhos ele recusa a resposta mesmo com a função funcionando.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder(405, { erro: 'Use POST.' });

  const url = Deno.env.get('SUPABASE_URL');
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !chave) return responder(500, { erro: 'Função sem configuração de ambiente.' });

  const admin = createClient(url, chave, { auth: { autoRefreshToken: false, persistSession: false } });

  // Quem chamou: o JWT do instrutor logado, validado pelo Auth (não decodificado
  // "na mão"). Sem token válido, nada acontece.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return responder(401, { erro: 'Faltou a sessão do usuário.' });
  const { data: sessao, error: erroSessao } = await admin.auth.getUser(token);
  if (erroSessao || !sessao?.user) return responder(401, { erro: 'Sessão inválida ou expirada. Entre de novo.' });

  let pedido: unknown;
  try {
    pedido = await req.json();
  } catch {
    return responder(400, { erro: 'O corpo do pedido não é JSON.' });
  }

  try {
    const resultado = await importarTurma({ admin, chamadorId: sessao.user.id, pedido });
    return responder(200, resultado);
  } catch (e) {
    if (e instanceof ErroDePedido) return responder(e.status, { erro: e.message });
    // Erro inesperado: o detalhe vai para o log da função, não para o navegador.
    console.error('importar-turma falhou:', e);
    return responder(500, { erro: 'Erro inesperado no servidor.' });
  }
});
