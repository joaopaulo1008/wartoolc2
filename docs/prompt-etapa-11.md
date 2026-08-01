# Prompt para abrir a Etapa 11 — Deploy e domínio

**Modelo sugerido: leve a intermediário.** O trabalho de código é pequeno, mas há duas
decisões que não são mecânicas — como a configuração do Supabase chega ao site publicado, e o
que fazer com o cadastro aberto no momento em que a URL vira pública. As duas erram em
silêncio.

**Boa parte desta etapa acontece FORA do editor** (criar conta no host, apontar domínio,
mexer no painel do Supabase). Espere que o assistente peça para você executar passos, e não
que ele os execute sozinho.

---

Lê o CLAUDE.md e o docs/ROADMAP.md do projeto WartoolC2 (pasta `wartoolc2/`), e também
`frontend/config.example.js` e `frontend/auth.js` (as primeiras 40 linhas — é lá que o
`import './config.js'` acontece e é ele que decide se o site sobe ou não),
`frontend/login.html` (o cadastro aberto da Etapa 2b), `backend/supabase/0002_rls.sql` (a RPC
`entrar_na_turma` e as policies de `perfis`), `backend/seed/` (o que já existe da Etapa 2c,
adiada) e `frontend/basemaps.js` (o BDGEx e o comentário sobre protocolo herdado), antes de
começar.

Vamos fazer a **Etapa 11: publicar o frontend com HTTPS e domínio.**

**Por que ela foi antecipada** (passou na frente da 8a e da 9): não é pressa de publicar, é
que HTTPS destrava três coisas paradas.
1. A Etapa 8a (mapa offline) depende de **Service Worker**, que só roda em contexto seguro.
2. O **teste de GPS com vários celulares está pendente desde a Etapa 3** pelo mesmo motivo —
   geolocalização exige contexto seguro, e celular acessando por IP de rede local
   (`http://192.168.x.x`) **não** conta como `localhost`. Sem deploy, o projeto nunca foi
   testado em campo de verdade.
3. Responde a pendência da 7.1 sobre o **BDGEx atender ou não em https**.

O objetivo prático, dito por quem usa: **conseguir testar em campo com vários celulares desde
já.**

**Decida e justifique, antes de mexer em qualquer coisa:**

1. **COMO A CONFIGURAÇÃO DO SUPABASE CHEGA AO SITE. Este é o bloqueador imediato:**
   `frontend/config.js` está no `.gitignore` e `frontend/auth.js` faz `import` dele.
   Publicando o repositório como está, **o módulo falha e nenhuma tela carrega — nem o
   login**. Três saídas defensáveis:
   (a) **commitar o `config.js`** — a *anon key* é pública por design (o próprio
       `config.example.js` explica: quem decide o que ela pode ler ou escrever é a RLS, não a
       chave). É a opção que funciona em qualquer host, inclusive sem build;
   (b) **gerar o arquivo no build**, a partir de variável de ambiente do host — exige um host
       com etapa de build, e some quando alguém clonar o repo para rodar local;
   (c) **buscar a configuração de um endpoint** em tempo de execução — mais partes móveis
       para o mesmo resultado.
   Pese contra o host escolhido no item 3 e diga qual escolheu. **Se escolher (a), diga
   explicitamente por que isso NÃO é vazamento de segredo** — é a dúvida que qualquer pessoa
   vai ter ao ver a chave num repositório público.

2. **O QUE FAZER COM O CADASTRO ABERTO. Este é o maior risco da etapa, e não é técnico.**
   Hoje (decisão da Etapa 2b, com a 2c adiada) qualquer um cria a própria conta em
   `login.html` e entra na turma `TESTE` digitando o código. Em `localhost` isso é
   conveniência; **numa URL pública é qualquer pessoa que ache o link criando conta e entrando
   no exercício** — e, no instante em que o instrutor distribuir um partido para ela, vendo
   posição de gente real e escrevendo marcação no mapa da turma. Note que a RLS está correta;
   o problema não é a RLS, é que a porta de entrada é aberta por decisão. Opções:
   antecipar a parte da Etapa 2c que fecha o cadastro; desligar o *signup* no painel do
   Supabase e criar contas por Admin API; trocar o código da turma por algo não adivinhável;
   exigir o código da turma já no cadastro. Escolha, justifique, e implemente **antes** de
   publicar — não depois.

3. **ONDE PUBLICAR.** O orçamento alvo do projeto é até R$ 200/mês e o repositório já está no
   GitHub. Pese ao menos GitHub Pages (grátis, HTTPS automático, sem etapa de build — o que
   conversa com a opção (a) do item 1), Vercel/Netlify (build, variáveis de ambiente,
   *previews* por branch) e Cloudflare Pages. Considere também que a Etapa 8a vai precisar
   servir um Service Worker do escopo certo, e que `index.html` não pode ficar com cache
   agressivo — um app que não atualiza depois de um deploy é o tipo de problema que aparece
   no pior momento.

4. **DOMÍNIO.** Decidir entre o subdomínio do host e um domínio próprio, com custo. Se o
   projeto for institucional, vale considerar se o nome deve deixar isso claro.

**O que eu preciso:**

1. O site publicado em **HTTPS**, com login funcionando, acessível de celular.
2. O cadastro **fechado ou controlado**, conforme a decisão do item 2.
3. Confirmar, na página publicada, se o **BDGEx desenha** — é o teste que fecha a pendência da
   7.1. Se não desenhar, dizer qual é o caminho (proxy reverso, ou os endpoints `/teogc/`).
4. Revisar os custos reais contra o `docs/Plano_WartoolC2.docx` e registrar o que mudou.
5. **Um roteiro de teste em campo**, em `docs/`, para eu levar com os celulares na mão. Esta
   é a entrega mais valiosa da etapa: há pendências acumuladas desde a Etapa 3 que nunca
   puderam ser testadas, e agora podem. O roteiro deve dizer o que fazer, o que esperar e
   **como saber que falhou** — e cobrir pelo menos:
   - dois celulares vendo a posição um do outro (Etapas 3 e 4);
   - duas contas do **mesmo** partido conferindo a hostilidade relativa das marcações — com
     partidos diferentes a marcação não vaza, que é outro teste (Etapas 4.5 e 5);
   - o instrutor desabilitando `enviar_posicao_gps` e o app do aluno reagindo **sem F5**;
   - o instrutor clicando **"Voltar ao padrão da turma"** — o caso mais incerto de todos,
     porque depende do evento `DELETE` casar com o filtro do canal;
   - o instrutor trocando a **força** de um aluno e o app dele recarregando sozinho (exige a
     `0004` aplicada);
   - da 6b: aplicar a `0005`, conferir `prosecdef = false`, o `explain analyze` da RPC usando
     `idx_hist_usuario_tempo`, e chamar a RPC com **token de aluno** passando o UUID de um
     colega (tem que voltar só o rastro próprio);
   - da 7: aplicar a `0006`, conferir que o bucket `calcos` nasceu **privado**, publicar um
     calco com a turma toda com o app aberto (tem que aparecer sem F5), e — **o mais
     importante** — com token de aluno do **Vermelho**, tentar baixar pelo caminho direto o
     objeto de um calco publicado só para o **Azul**: tem que dar erro. A policy de storage se
     apoia em `calcos_ler`, e o modo de falha dessa dependência seria **aberto**;
   - da 7.1: o BDGEx desenhando e trocando de escala com o zoom.
6. Se algo do código precisar mudar para o site publicado funcionar, mude — mas **diga o que
   mudou e por quê**. Um candidato conhecido: `EXTRA_LAYERS` e o COP legado buscam de
   `raw.githubusercontent.com` (constante `REPO_RAW` em `index.html`), o que funciona mas
   depende de o repositório ser público e de uma dependência externa desnecessária, já que os
   arquivos de `data/` passam a ser servidos pelo próprio site.

**NÃO implemente:** a Etapa 8a (mapa offline — mas deixe o caminho livre para o Service Worker
dela), a 8b (imagem do instrutor), a Etapa 6.5 (ORBAT), a Etapa 9 (SPA com bundler — as
pontes `window.WartoolCamadas` e `window.WartoolSimbolos` continuam existindo), nem a
interface de `preferencias_visualizacao`.

**Verificação:** `node --check` nos arquivos novos/alterados (inclusive os blocos `<script>`
embutidos no HTML — atenção que o `index.html` tem a palavra `<script>` dentro de um
comentário HTML e ela atrapalha extração por regex ingênua) e os testes existentes
continuando verdes: `frontend/simbolos.teste.mjs` (20), `frontend/marcacoes.teste.mjs` (40),
`frontend/rastro.teste.mjs` (64), `frontend/kml.teste.mjs` (116) e
`frontend/basemaps.teste.mjs` (24). Se houver migration nova, valide com
`backend/testes/valida_sql.py`. E, ao contrário de todas as etapas anteriores, aqui a
verificação de verdade é **abrir o site publicado no celular** — o que não passar nisso não
está pronto.
