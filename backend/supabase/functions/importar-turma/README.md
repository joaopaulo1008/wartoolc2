# importar-turma — Edge Function

Cria uma **turma nova** e as **contas** das pessoas dela a partir do painel do
instrutor (aba "Nova turma (CSV)"). Existe porque criar conta e dar papel de
instrutor exige a `service_role`, que nunca pode ir para o navegador.

## Arquivos

- `index.ts` — ambiente (Deno): CORS, valida o JWT de quem chamou, monta o cliente.
- `logica.js` — toda a regra, sem Deno. Testada em Node.
- `logica.teste.mjs` — 51 casos com um cliente Supabase de mentira.

Do lado do navegador: `frontend/importar-turma.js` (CSV → validação),
`frontend/instrutor-importar.js` (tela). Modelo em Excel: `backend/seed/modelo-importacao-turma.xlsx`.

## Como publicar

Uma vez, e de novo a cada mudança neste diretório (precisa do Supabase CLI):

```
supabase login
supabase link --project-ref xfqiwlnzvqoaxabpkgss
supabase functions deploy importar-turma
```

A `service_role` é injetada pelo próprio Supabase (`SUPABASE_SERVICE_ROLE_KEY`);
não se digita nem se commita. Mantenha a verificação de JWT ligada (padrão).

Pré-requisito do modo "Simulação": migration `0016` aplicada.
Pré-requisito das colunas `numero_esq`, `numero_dir` e `nome_fracao` da planilha
(numeração do símbolo no mapa): migration `0018` aplicada. Sem ela, a importação
continua funcionando enquanto essas colunas ficam vazias; com valores, a conta é
criada mas o perfil falha com uma mensagem que cita a 0018.

## O que a função garante

- Só chama quem tem `perfis.papel = 'instrutor'` (conferido no servidor).
- Revalida o pedido inteiro (o navegador pode ser contornado).
- A turma fica com `instrutor_id` = quem chamou.
- Conta que já existe **não é movida** nem tem senha trocada.
- O papel é gravado por UPDATE da própria função, não por metadados.
- Se nenhuma conta for criada, a turma é apagada de volta.
- A resposta nunca contém senha.

## O que foi e o que NÃO foi testado

Testado: a regra (51 casos, dublê em memória); a função sob Deno 2.9 contra um
Supabase de mentira (15 verificações HTTP: CORS, 401, 403, 400, 409, caminho
feliz); a tela num Chromium (40 verificações, com a função simulada).

**Não testado:** a função publicada no Supabase de verdade. Em particular, que o
Auth Admin API aceita a chamada e que a trigger de perfis aceita o UPDATE feito
pela service_role. Faça a primeira importação com uma turma descartável de 2
contas e confira em Authentication e na tabela `perfis`.

## Achado corrigido junto: o papel do cadastro público (migration 0017)

A trigger `fn_criar_perfil_para_novo_usuario` (0001) lia `papel` de
`raw_user_meta_data`, que no `signUp` público vem do navegador: quem chamasse
`signUp` com `options.data = { papel: 'instrutor' }` nascia instrutor.
Reproduzido num Postgres (não no Supabase real) e corrigido pela migration
`0017_papel_nao_vem_do_cliente.sql`; teste em `backend/testes/08_teste_papel_no_cadastro.sql`
(6 de 14 asserções passam antes da 0017; 12 de 12 depois). Esta função nunca
dependeu disso: ela grava o papel por UPDATE.

**A 0017 não rebaixa ninguém.** Se alguém explorou isso antes de aplicar, a
conta continua instrutora: rode a consulta de auditoria que está no cabeçalho
da migration e rebaixe à mão o que não reconhecer.
