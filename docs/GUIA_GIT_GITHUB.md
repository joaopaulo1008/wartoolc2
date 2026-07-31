# Guia Git + GitHub para iniciantes — WartoolC2

Este guia assume que você nunca usou Git antes. Segue a ordem que você realmente vai usar no dia a dia.

## 1. Conceitos básicos (leia isso primeiro)

- **Git**: um programa instalado no seu PC que guarda o histórico de versões dos seus arquivos (como um "controle de alterações" avançado).
- **Repositório (repo)**: a pasta do projeto, com um histórico do Git dentro dela (uma subpasta oculta `.git`).
- **GitHub**: um site que hospeda uma cópia do seu repositório na nuvem. Git é a ferramenta; GitHub é o site.
- **Commit**: uma "foto" salva do estado dos arquivos, com uma mensagem explicando o que mudou. Fica guardada no histórico para sempre.
- **Remoto (remote/origin)**: o endereço do repositório no GitHub, associado ao seu repositório local.
- **Push**: enviar seus commits do seu PC para o GitHub.
- **Pull**: trazer para o seu PC os commits que estão no GitHub (feitos por você em outro PC, ou por outra pessoa).
- **Clone**: copiar um repositório do GitHub para o seu PC pela primeira vez.

Fluxo típico do dia a dia: você edita arquivos → `git add` (seleciona o que vai entrar na foto) → `git commit` (tira a foto, com uma mensagem) → `git push` (envia pro GitHub).

## 2. Instalar o Git no Windows

1. Baixe em [git-scm.com/download/win](https://git-scm.com/download/win) — o download começa sozinho.
2. Instale com as opções padrão (pode ir clicando "Next" em tudo).
3. Abra o **Git Bash** (foi instalado junto) ou o **PowerShell**/**Prompt de Comando** — qualquer um serve para os comandos abaixo.
4. Confirme que instalou:
   ```
   git --version
   ```

## 3. Configurar sua identidade (só precisa fazer uma vez)

O Git carimba cada commit com um nome e e-mail. Rode uma vez:
```
git config --global user.name "João Paulo"
git config --global user.email "joaopaulo1008@gmail.com"
```

## 4. Autenticação com o GitHub

O GitHub não aceita mais login com usuário+senha direto no terminal. Duas opções, escolha uma:

### Opção A — GitHub Desktop (mais fácil para quem está começando)
1. Baixe em [desktop.github.com](https://desktop.github.com).
2. Instale e faça login com sua conta do GitHub pela interface gráfica (ele cuida da autenticação sozinho).
3. Você pode clonar, ver mudanças, comitar e dar push tudo por botões, sem digitar comando nenhum.

### Opção B — Token de acesso pessoal (PAT), para usar no terminal
1. No site do GitHub: clique na sua foto (canto superior direito) → **Settings** → role até **Developer settings** (no menu da esquerda, bem embaixo) → **Personal access tokens** → **Tokens (classic)** → **Generate new token**.
2. Dê um nome (ex: "PC de casa"), marque a permissão **repo**, defina uma validade (ex: 90 dias ou "no expiration").
3. Clique em gerar e **copie o token na hora** — ele só aparece uma vez.
4. Na primeira vez que o terminal pedir usuário e senha (no `git push` ou `git clone` de um repo privado), digite:
   - **Username**: seu usuário do GitHub (`joaopaulo1008`)
   - **Password**: cole o token (não é a senha da sua conta)
5. O Windows costuma salvar isso no Gerenciador de Credenciais depois da primeira vez, então você não digita de novo.

## 5. Clonar o repositório (primeira vez, em um PC novo)

```
cd "pasta onde você guarda seus projetos"
git clone https://github.com/joaopaulo1008/wartoolc2.git
```
Isso cria uma pasta `wartoolc2` com todo o histórico do projeto.

> Nota: o repositório ainda está com o nome `cop-tatico` no GitHub até você renomear (passo 8). Enquanto isso, use `https://github.com/joaopaulo1008/cop-tatico.git` no lugar.

## 6. O fluxo do dia a dia (o que você vai repetir sempre)

Depois de editar/adicionar arquivos na pasta do projeto:

```
git status
```
Mostra o que mudou — bom hábito rodar antes de qualquer coisa, só para ver.

```
git add -A
```
Seleciona **todas** as mudanças (novos arquivos, editados, apagados) para entrar no próximo commit. Se quiser adicionar só um arquivo específico: `git add nome_do_arquivo.txt`.

```
git commit -m "descrição curta do que você mudou"
```
Tira a "foto". A mensagem deve dizer o que mudou, não é obrigatório ser formal — ex: `"ajusta cor dos símbolos hostis"`.

```
git push
```
Envia os commits para o GitHub. É aqui que pode pedir o token (ver seção 4).

## 7. Trazendo mudanças de volta (outro PC, ou depois de mexer pelo site do GitHub)

Sempre que for começar a trabalhar, principalmente se usa mais de um computador:
```
git pull
```
Isso baixa e já mistura no seu repositório local qualquer commit novo que esteja no GitHub e que você ainda não tem.

## 8. Renomear o repositório no GitHub (cop-tatico → wartoolc2)

1. Abra `https://github.com/joaopaulo1008/cop-tatico`.
2. Aba **Settings** (do repositório, não da sua conta).
3. Logo no topo, campo **Repository name** → troque para `wartoolc2` → **Rename**.
4. Pronto. O GitHub mantém o endereço antigo funcionando como redirecionamento, então nada quebra imediatamente — mas atualize seu clone local para apontar pro novo nome (opcional, mas recomendado):
   ```
   git remote set-url origin https://github.com/joaopaulo1008/wartoolc2.git
   ```
   Confirme com:
   ```
   git remote -v
   ```

## 9. Erros comuns

- **"Please tell me who you are"** → você pulou o passo 3 (configurar nome/e-mail). Rode os dois comandos de `git config --global` e tente de novo.
- **"Authentication failed" / "Support for password authentication was removed"** → você tentou usar a senha da conta em vez do token. Gere um token (seção 4, opção B) ou use o GitHub Desktop.
- **"failed to push some refs" / "Updates were rejected"** → o GitHub tem commits que você não tem localmente (por exemplo, editou algo pelo site). Rode `git pull` primeiro, depois `git push` de novo.
- **Arquivo grande demais para o GitHub** (limite de 100MB por arquivo) → não vai dar pra commitar. Avise que temos que pensar noutra forma de guardar esse arquivo (ex: Git LFS ou um serviço de armazenamento separado).

## 10. Glossário rápido

| Termo | O que é |
|---|---|
| repo | a pasta do projeto com histórico Git |
| commit | uma "foto" salva do projeto, com mensagem |
| branch | uma linha paralela de desenvolvimento (não usamos ainda — tudo direto na `main`) |
| origin | apelido padrão para o endereço do repositório no GitHub |
| clone | copiar o repo do GitHub pro seu PC pela primeira vez |
| push | enviar commits do seu PC pro GitHub |
| pull | trazer commits do GitHub pro seu PC |
| PAT | Personal Access Token — o "token" que substitui a senha |
