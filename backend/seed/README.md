# Seed — lista de usuários do exercício

Desde a revisão da Etapa 11, o cadastro em `frontend/login.html` voltou a ser
aberto (protegido pelo código da turma — ver `backend/supabase/0007_codigo_turma_valido.sql`
e a seção "Decisões da Etapa 11" em `CLAUDE.md`), então este script **não é
mais o único caminho** para criar conta. Ele continua útil para dois casos
que o cadastro aberto não cobre:

- a **conta do instrutor** — o formulário de `login.html` sempre cria papel
  `usuario`, nunca `instrutor` (por design: papel não é escolhido pelo
  cliente);
- exercícios onde se prefere não depender de autocadastro e montar a lista
  inteira (efetivo, função, símbolo) de antemão, como no plano original da
  Etapa 2c.

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

As três últimas colunas existem para você não ter que escrever o SIDC de 20 dígitos na mão: o script monta o código com o **mesmo `getSIDC()`** que o app usa, importado de `frontend/simbolos.js` (era `frontend/index.html` até a Etapa 4.5). Os valores permitidos são as chaves das constantes `HOSTILIDADE`, `DIMENSAO` e `ESCALAO` daquele arquivo.

**Duas coisas mudaram na Etapa 9b, e nenhuma delas quebra um CSV já escrito:**

- `DIMENSAO` passou a ser derivada do catálogo oficial do MD/EB, com uma chave por categoria (`UNIDADES`, `EQUIPAMENTOS_VIATURAS`, `INSTALACOES`, `INDIVIDUOS_DESEMBARCADOS`, `AERONAVES`, …). As cinco chaves antigas continuam valendo como **aliases**, com exatamente os mesmos valores de antes — há teste garantindo que uma linha de CSV escrita antes da 9b produz o mesmo SIDC de sempre.
- **Cuidado com `AEREO`**: ele vale `05`, que no APP-6D é *espacial*, não aeronave. É um erro que veio da tabela manual antiga e foi **preservado de propósito**, para não reescrever o significado de dados já gravados. Para aeronave de verdade, use `AERONAVES` (`01`).

`natureza_code` aceita agora qualquer código de entidade do catálogo oficial — 434 opções, com o nome em português. Para descobrir o código de um tipo, procure o `NomeBR` em `frontend/simbolos-catalogo.js` (ou consulte `data/simbologia-eb/catalogo-extraido.json`).

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
