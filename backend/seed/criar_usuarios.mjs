// criar_usuarios.mjs — Etapa 11: a parte da Etapa 2c que fecha o cadastro.
//
// Por que este script existe agora, e por que não é a Etapa 2c inteira
// -----------------------------------------------------------------------
// A Etapa 11 (deploy) tornou o cadastro aberto de login.html um risco real:
// numa URL pública, qualquer um que ache o link cria a própria conta e entra
// na turma. A correção tem duas partes, e as duas são necessárias:
//   1. Desligar "Allow new users to sign up" no painel do Supabase
//      (Authentication -> Sign In / Providers) — passo manual, fora deste
//      script, documentado em backend/README.md.
//   2. Ter uma forma de CRIAR conta sem o autocadastro. É isso que este
//      script faz — é a parte da Etapa 2c ("contas pré-cadastradas") que não
//      dava para adiar mais, sem fazer a etapa inteira (esta versão não trata
//      hostilidade/dimensão como o modelo final fará quando 2c for retomada
//      com calma; usa exatamente as mesmas tabelas de simbolos.js, só isso).
//
// Como rodar
// -----------------------------------------------------------------------
//   1. cp backend/seed/usuarios_exercicio.exemplo.csv backend/seed/usuarios_exercicio.csv
//      e preencha com o efetivo real (ver as colunas em backend/seed/README.md).
//   2. Pegue a SERVICE ROLE KEY do projeto (dashboard -> Project Settings ->
//      Data API -> "service_role" — NUNCA a publishable/anon). Essa chave
//      ignora toda a RLS: não vai para o frontend, não é commitada, não passa
//      por chat. Bota num arquivo local `.env.seed` (já no .gitignore):
//        SUPABASE_URL=https://xxxx.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY=eyJ...
//   3. Rode (Node 20.6+, para o --env-file nativo):
//        node --env-file=backend/seed/.env.seed backend/seed/criar_usuarios.mjs
//      Ou exportando as variáveis você mesmo, se preferir:
//        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node backend/seed/criar_usuarios.mjs
//
// O que o script NÃO faz (de propósito, por escopo)
// -----------------------------------------------------------------------
// - Não cria a turma: se o `codigo_turma` de uma linha não existir em
//   `turmas`, a linha falha com uma mensagem dizendo para criar a turma
//   primeiro (SQL Editor ou uma tela futura). Criar turma é decisão do
//   instrutor, não algo para um script assumir.
// - Não faz upsert de conta já existente: se o e-mail já tem usuário no
//   Supabase Auth, a linha é reportada como "já existe" e pulada — trocar
//   senha ou papel de alguém que já existe é operação separada (dashboard,
//   ou um script de update futuro), para não haver risco de um script batch
//   resetar senha de gente que já estava treinando.

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Reaproveita a MESMA fonte de tabelas SIDC que o frontend usa — nunca uma
// segunda cópia de HOSTILIDADE/DIMENSAO/ESCALAO (é o erro que a Etapa 4.5
// corrigiu uma vez; simbolos.js é seguro de importar fora do navegador porque
// a ponte window.WartoolSimbolos, no fim do arquivo, é protegida por
// `typeof window !== 'undefined'`).
import { getSIDC } from '../../frontend/simbolos.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CSV_PATH = process.argv[2] || join(__dirname, 'usuarios_exercicio.csv');
const DOMINIO_EMAIL_PADRAO = '@wartool.local';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.\n' +
    'Ver o cabeçalho deste arquivo ("Como rodar") — nunca cole a service_role key direto no código.'
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── CSV mínimo, sem dependência nova ────────────────────────────────────
// O arquivo é simples (sem vírgulas dentro de campo, ver o .exemplo.csv), não
// justifica trazer uma lib de parsing só para isto.
function parseCsv(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  const cabecalho = linhas[0].split(',').map((c) => c.trim());
  return linhas.slice(1).map((linha) => {
    const valores = linha.split(',');
    const registro = {};
    cabecalho.forEach((chave, i) => { registro[chave] = (valores[i] || '').trim(); });
    return registro;
  });
}

async function main() {
  let texto;
  try {
    texto = await readFile(CSV_PATH, 'utf-8');
  } catch {
    console.error(
      `Não encontrei ${CSV_PATH}.\n` +
      'Copie backend/seed/usuarios_exercicio.exemplo.csv para usuarios_exercicio.csv e preencha antes de rodar.'
    );
    process.exit(1);
  }

  const linhas = parseCsv(texto);
  if (linhas.length === 0) {
    console.error('CSV vazio — nada para criar.');
    process.exit(1);
  }

  // Resolve todos os códigos de turma citados no CSV numa passagem só, em vez
  // de uma consulta por linha.
  const codigosTurma = [...new Set(linhas.map((l) => l.codigo_turma).filter(Boolean))];
  const { data: turmas, error: erroTurmas } = await admin
    .from('turmas')
    .select('id, codigo_acesso')
    .in('codigo_acesso', codigosTurma);
  if (erroTurmas) {
    console.error('Falha ao consultar turmas:', erroTurmas.message);
    process.exit(1);
  }
  const turmaPorCodigo = new Map(turmas.map((t) => [t.codigo_acesso, t.id]));

  const resultado = { criados: [], jaExistiam: [], erros: [] };

  for (const [i, linha] of linhas.entries()) {
    const numeroLinha = i + 2; // +1 pelo índice, +1 pelo cabeçalho
    const email = linha.email || (linha.usuario ? `${linha.usuario}${DOMINIO_EMAIL_PADRAO}` : '');

    if (!email || !linha.senha || !linha.nome_guerra) {
      resultado.erros.push(`Linha ${numeroLinha}: faltam email/senha/nome_guerra.`);
      continue;
    }
    if (linha.papel !== 'instrutor' && linha.papel !== 'usuario') {
      resultado.erros.push(`Linha ${numeroLinha} (${email}): papel "${linha.papel}" inválido (use "instrutor" ou "usuario").`);
      continue;
    }

    const turmaId = linha.codigo_turma ? turmaPorCodigo.get(linha.codigo_turma) : null;
    if (linha.codigo_turma && !turmaId) {
      resultado.erros.push(`Linha ${numeroLinha} (${email}): turma "${linha.codigo_turma}" não existe — crie-a antes (backend/README.md).`);
      continue;
    }

    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email,
      password: linha.senha,
      email_confirm: true, // confirmação por e-mail fica desligada no projeto; sem isto a conta nasceria não confirmada
      user_metadata: { nome_completo: linha.nome_completo || linha.nome_guerra, papel: linha.papel },
    });

    if (erroCriar) {
      const jaExiste = /already been registered|already registered|already exists/i.test(erroCriar.message);
      if (jaExiste) {
        resultado.jaExistiam.push(email);
      } else {
        resultado.erros.push(`Linha ${numeroLinha} (${email}): ${erroCriar.message}`);
      }
      continue;
    }

    const userId = criado.user.id;

    // A trigger fn_criar_perfil_para_novo_usuario só grava nome_completo e
    // papel (lidos dos metadados acima) — o resto é um update, igual ao que
    // cadastrar() em auth.js faz para nome_guerra, só que com service_role
    // (ignora a RLS, então pode gravar turma_id/sidc diretamente, sem passar
    // pela RPC entrar_na_turma nem pelo bloqueio de fn_proteger_campos_do_perfil,
    // que já libera a troca quando auth.uid() é nulo — é exatamente o caso do
    // service_role, sem JWT de usuário).
    const sidc = getSIDC({
      hostilidade: linha.hostilidade,
      dimensao: linha.dimensao,
      escalao: linha.escalao,
      natureza_code: linha.natureza_code,
    });

    const { error: erroPerfil } = await admin
      .from('perfis')
      .update({
        nome_guerra: linha.nome_guerra,
        posto_graduacao: linha.posto_graduacao || null,
        turma_id: turmaId || null,
        sidc,
      })
      .eq('id', userId);

    if (erroPerfil) {
      resultado.erros.push(`Linha ${numeroLinha} (${email}): usuário criado, mas falhou o update do perfil: ${erroPerfil.message}`);
      continue;
    }

    resultado.criados.push(email);
  }

  console.log(`\nCriados: ${resultado.criados.length}`);
  resultado.criados.forEach((e) => console.log(`  ✓ ${e}`));

  if (resultado.jaExistiam.length) {
    console.log(`\nJá existiam (puladas): ${resultado.jaExistiam.length}`);
    resultado.jaExistiam.forEach((e) => console.log(`  · ${e}`));
  }

  if (resultado.erros.length) {
    console.log(`\nErros: ${resultado.erros.length}`);
    resultado.erros.forEach((e) => console.log(`  ✗ ${e}`));
    process.exitCode = 1;
  }
}

main();
