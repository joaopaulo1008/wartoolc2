# Seed — lista de usuários do exercício

Como o WartoolC2 é usado em exercícios com efetivo e funções definidos de antemão, as contas não são criadas por auto-cadastro: você monta a lista antes e um script cria tudo de uma vez, já com a turma e o símbolo militar de cada um.

## O arquivo

Copie `usuarios_exercicio.exemplo.csv` para `usuarios_exercicio.csv` e preencha com o efetivo real. O arquivo com dados reais **não vai para o repositório** (está no `.gitignore`) — ele contém senhas.

```
cp usuarios_exercicio.exemplo.csv usuarios_exercicio.csv
```

## As colunas

| Coluna | O que é |
|---|---|
| `email` | Identificador de login. **Não precisa ser um e-mail que existe** — a confirmação por e-mail fica desligada, então `aluno01@wartool.local` funciona. Vantagem em campo: ninguém depende de abrir caixa de entrada |
| `senha` | Mínimo 6 caracteres (exigência do Supabase). Prefira uma senha diferente por pessoa a uma senha única para todos |
| `nome_completo` | Nome para registro |
| `nome_guerra` | O que aparece ao lado do símbolo no mapa — mantenha curto |
| `posto_graduacao` | Ex.: `Cap`, `1 Ten`, `2 Sgt`, `Cb`, `Sd` |
| `papel` | `instrutor` ou `usuario` |
| `codigo_turma` | O `codigo_acesso` da turma. Todos com o mesmo código caem na mesma turma |
| `hostilidade` | `AMIGO`, `PRESUMIDO`, `NEUTRO`, `SUSPEITO`, `HOSTIL`, `DESCONHECIDO` — para o efetivo próprio, `AMIGO` |
| `dimensao` | `UNIDADE`, `EQUIPAMENTO`, `INSTALACAO`, `AEREO`, `INDIVIDUO` |
| `escalao` | `NONE`, `SQD`, `SEC`, `PEL`, `CIA`, `BIA`, `ESC`, `BN`, `GRU`, `BDA`, `DIV`, `CRP`, `EX` |
| `natureza_code` | Código de natureza APP-6D (10 dígitos). Pode deixar **vazio** — vira símbolo genérico, que já é legível no mapa |

As três últimas colunas existem para você não ter que escrever o SIDC de 20 dígitos na mão: o script monta o código usando exatamente as mesmas tabelas de conversão que o `getSIDC()` em `frontend/index.html` já usa. Os valores permitidos são os das constantes `HOSTILIDADE`, `DIMENSAO` e `ESCALAO` daquele arquivo.

## Como rodar

O script é `criar_usuarios.mjs` (Etapa 11 — é a parte da Etapa 2c que não dava
mais para adiar depois do deploy, porque o cadastro aberto de `login.html`
virou um risco numa URL pública). Instruções completas no cabeçalho do
próprio arquivo; resumo:

```
cp usuarios_exercicio.exemplo.csv usuarios_exercicio.csv   # preencha com o efetivo real
# crie backend/seed/.env.seed (gitignored) com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
node --env-file=backend/seed/.env.seed backend/seed/criar_usuarios.mjs
```

O script precisa da **`service_role` key** do projeto Supabase, não da
`anon`/`publishable`. Essa chave ignora todas as regras de RLS e dá controle
total do banco:

- nunca a coloque em arquivo do frontend (`frontend/config.js` só tem a
  publishable key, que é pública por design — ver o cabeçalho desse arquivo);
- nunca a comite (`backend/seed/.env.seed` está no `.gitignore`);
- passe por variável de ambiente na hora de rodar o seed, nunca colada no chat.

O script não cria a turma citada em `codigo_turma` — crie-a antes (SQL
Editor) se ainda não existir. E não atualiza conta já existente: e-mail
repetido é reportado e pulado, para nenhum script batch resetar senha de
quem já está treinando.

## Aviso

Senhas padronizadas e e-mails fictícios são adequados para um exercício de instrução controlado. Não leve esse esquema para nada que trate informação real ou sensível.
