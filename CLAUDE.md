# CLAUDE.md — ELITE C2 (antes WartoolC2)

Manual de operação para qualquer sessão (Claude ou humano) trabalhando neste
projeto. **Curto de propósito.** Até 2026-09-19 este arquivo tinha 1820 linhas
porque acumulava o registro cronológico de cada entrega; esse registro foi
inteiro para **[docs/historico-de-decisoes.md](./docs/historico-de-decisoes.md)**,
íntegro, com sumário. O que ficou aqui é o que uma sessão precisa **sempre**.

## Por onde começar

1. **Este arquivo**, inteiro. São poucos minutos.
2. **[docs/ROADMAP.md](./docs/ROADMAP.md)** — só quando for iniciar uma etapa
   nova; é ele que diz o que já foi feito e o que vem a seguir.
3. **[docs/roteiro-teste-campo.md](./docs/roteiro-teste-campo.md)** — só quando
   a tarefa for testar em campo. Abre com o estado e a ordem de prioridade.
4. **[docs/historico-de-decisoes.md](./docs/historico-de-decisoes.md)** — nunca
   inteiro. Só a seção da área que você vai mexer, quando não conhecer a
   decisão que a produziu.

Ler ROADMAP e roteiro por precaução custa ~40 mil tokens e não responde
pergunta nenhuma. Abra quando a tarefa pedir.

---

## O que é o projeto

**ELITE C2** (nome técnico `wartoolc2`: repositório, URL e identificadores) — portal
WebGIS militar de instrução e C2, para uso em campo com rede de dados disponível.

- Camada de fundo trocável (mapa online ou imagem georreferenciada local).
- KML/KMZ com controle de visibilidade e opacidade.
- O instrutor **baixa as marcações da turma como KMZ** (pastas por força e
  categoria, símbolos militares como ícone, descrição em cada ponto).
- Avatar do usuário como símbolo militar padrão OTAN (APP-6D), posicionado pelo
  GPS do celular em tempo real.
- Duas interfaces: **instrutor** (habilita funções e visualizações por usuário)
  e **usuário/aluno**.
- O aluno marca posições inimigas no mapa.
- Futuro: ingestão de posição GPS de rádios militares (protocolo não definido).

Orçamento alvo: até R$ 200/mês. Repositório:
`github.com/joaopaulo1008/wartoolc2`, branch `main`.
Site: **https://5bdacbldc2.pages.dev** (redireciona para
`joaopaulo1008.github.io/wartoolc2/`).

O trabalho é dividido em etapas, uma por chat, para economizar tokens e
escolher o modelo certo para cada complexidade.

## Identidade visual: ELITE C2

Rebrand de 2026-10-02 (antes WartoolC2). Mudou o que o usuário **vê**; o que o
código **chama** continua com o nome antigo, de propósito.

- **Fonte única do logotipo e dos tokens de cor: `frontend/marca.css`.** O "I" de
  ELITE é o eixo vertical de uma mira de tiro; o "C2" vai numa placa dourada.
- **Ícones e manifest em `public/`** (o Vite copia para a raiz do `dist/`):
  `icon.svg` (blindado no retículo) para app/login, `favicon.svg` (retículo
  grosso) para a aba, PNGs 192/512/maskable/apple-touch e `manifest.webmanifest`.
- **Paleta: verde-oliva + dourado + creme.** Sem azul nem vermelho na interface:
  são as forças amiga e inimiga no mapa, e a cor da tela não pode parecer uma
  força. Por isso `corFallback` (gps/icones/situacao), a opção "Azul" do KML, a
  paleta de séries do debriefing e as miniaturas de mapa base **continuam
  azuis**: ali a cor tem significado, não é decoração.
- **Não renomear** `wartoolc2` (repo, `base` do Vite, URL), `wartool-bdgex-tiles`
  (cache), `wartool-camadas` e `wartool-offline` (IndexedDB): renomear os três
  últimos faz cada celular perder o que já baixou para uso offline.

## Arquitetura, em uma página

**Frontend** Leaflet + milsymbol, empacotado com **Vite** desde a Etapa 9a
(`vite.config.js` na raiz), publicado no GitHub Pages por GitHub Actions
(`.github/workflows/deploy.yml`).

**Backend** Supabase — Postgres + PostGIS + Realtime + Auth. Substituiu o
pipeline original "Sheets → QGIS → GitHub", que sobrevive em `legacy-qgis/`
como importador opcional e como proveniência documentada, **sem ser consumido
por nada**.

**A RLS é a arquitetura.** Quase toda decisão de "quem vê o quê" está em
policy, não em JavaScript. As quatro formas que se repetem:

| Política | Alcance |
|---|---|
| `perfis_ler` | a turma INTEIRA, as duas forças |
| `posicoes_ler` | a própria força + instrutor |
| `elementos_ler` | só autores da mesma força (o instrutor não tem partido, então as marcações dele são invisíveis para o aluno) |
| `calcos_ler` | instrutor, ou mesma turma com partido nulo ou igual ao seu |

`anotacoes` copia `calcos_ler`; `situacoes` e `pedidos_apoio` copiam
`posicoes_ler`. Ao criar tabela nova, **copie a forma da política vizinha em vez
de inventar uma** — e diga qual copiou.

## Simbologia: quem desenha e quem diz o que existe

Duas coisas diferentes, fáceis de confundir:

- **Quem DESENHA: milsymbol** (dependência npm). Recebe um SIDC e devolve o
  SVG. Não sabe o que existe — qualquer SIDC bem formado ela desenha.
- **Quem diz O QUE EXISTE: o Portal de Simbologia Militar do MD/EB**
  (Etapa 9b). 12 categorias, 434 ícones com rótulo oficial em português,
  488 modificadores, base MD33-M-02 / MD33-C-01. Capturado uma vez e
  versionado em `data/simbologia-eb/` (procedência com URL, SHA-256 e data em
  `PROCEDENCIA.md`); módulo **gerado** em `frontend/simbolos-catalogo.js` por
  `scripts/gerar-catalogo-simbologia.mjs` — **não editar à mão**.
  **Em campo o app não fala com o portal.**

**`stanag-app6` não é dependência e não deve ser adicionada.** A hipótese foi
verificada e descartada na Etapa 9b: não é catálogo utilizável, e seria
taxonomia da OTAN em inglês, não a brasileira.

**SIDC APP-6D, 20 dígitos:**
`10 | hostilidade(2) | symbolSet(2) | situação(1) | hqtf(1) | escalão(2) |
entidade(6) | mod1(2) | mod2(2)`. `getSIDC({})` devolve
`'10011000000000000000'` — "Comando Nomeado", moldura vazia. **Esse default já
causou três diagnósticos errados**; ver a seção "A CAUSA DE VERDADE do símbolo
genérico" no histórico antes de mexer em geração de SIDC.

A hostilidade guardada é marcador; a de verdade é derivada na renderização por
`sidcParaObservador()`. **Não existe desenho neutro do SIDC.**

---

## Regras duras

Não são preferências. Quebrar qualquer uma destas causa dano real.

1. **A chave `service_role` NUNCA vai para o frontend.** Ela existe só em
   `backend/seed/criar_usuarios.mjs`, por variável de ambiente. `.env.seed` é
   gitignored. `frontend/config.js` tem apenas a chave anon publicável — a RLS
   é a barreira, e por isso ela pode ser commitada.
2. **`backend/testes/*.sql` NUNCA roda contra o Supabase de produção.** Cada
   suíte espera um **banco LIMPO** e cria massa de teste. Rodar duas vezes no
   mesmo banco contamina a massa e produz falhas que não existem.
3. **As chaves de `catalogo_permissoes` são interface, não controle de
   acesso.** Valem para a tela obedecer o instrutor. A RLS não as conhece. Um
   aluno com o console aberto contorna qualquer toggle; não contorna a RLS. Se
   uma chave precisar valer de verdade, o lugar é uma policy — não o
   JavaScript.
4. **`fn_rastro_historico` tem que continuar `security invoker`.** Marcar como
   `security definer` derruba a RLS do histórico.
5. **Migration nunca é editada depois de aplicada.** Correção é migration nova.

## Como trabalhar aqui

- **Propor antes de executar.** O João decide o escopo; apresente as opções com
  os custos antes de escrever código.
- **Português**, inclusive em nome de função, variável e comentário. O código
  deste projeto é escrito em português e isso é deliberado.
- **Separar o que foi testado do que foi afirmado.** "A bateria passou" e "isso
  funciona em campo" são frases diferentes. Uma lacuna declarada é informação;
  uma lacuna silenciosa é uma afirmação errada.
- **Não inventar número de teste.** Rode a bateria e relate o que ela deu.
- **Comentário explica POR QUE, não O QUE.** O padrão do projeto é comentário
  longo em decisão não óbvia. Mantenha.
- **Módulo puro e testável, separado da tela.** O padrão é trio: módulo puro
  (`rastro.js`, `visada.js`, `coordenadas.js`, `paleta.js`,
  `situacao-usuario.js`, `enquadrar-mapa.js`, `toque-longo.js`, `grade.js`),
  módulo de banco, módulo de tela.
- **Extrair na SEGUNDA vez**, não na primeira. Foi assim que nasceram
  `catalogo-form.js`, `basemaps.js`, `vigia-ausencia.js`, `toque-longo.js`.
- **Remoção é lógica**, nunca `DELETE`. `removida_em` / `removida_por`.
- **FONTE ÚNICA.** Quando algo tem dono declarado, use o dono: `simbolos.js`
  para SIDC e hostilidade, `permissoes.js` para permissão no cliente,
  `preferencias.js` para formato de coordenada, `basemaps.js` para mapas base,
  `vigia-ausencia.js` para limiares de ausência, `catalogo-form.js` para os
  `<option>` do catálogo, `toque-longo.js` para o gesto de manter o dedo
  (intervalo e tolerância de movimento), `grade.js` para o passo e os rótulos
  da quadrícula, `exportar-kmz.js` para a estrutura e a **cor fixa** do KMZ
  exportado. `preferencias.js` virou um REGISTRO de chaves em 2026-10-02 —
  chave nova entra lá, com padrão e validador, não numa variável solta.

## Lições que custaram caro

Em forma de regra. O raciocínio está no histórico.

- **Seguir o dado, não explicar o sintoma.** Quando a explicação for plausível
  mas não medida, ela está errada com frequência suficiente para não valer.
  → "A CAUSA DE VERDADE do símbolo genérico"
- **Em RLS, medir contra Postgres de verdade.** Na 0012 a barreira de um
  `UPDATE` era a política de **leitura** (`perfis_ler`), não a de escrita —
  descoberto com dois experimentos isolados, depois de uma hipótese confiante e
  errada. → "Símbolo do aluno e saída da turma (0012)"
- **`USING` filtra em silêncio; só `WITH CHECK` levanta erro.** Todo teste de
  RLS precisa distinguir `erro` de `zero linhas` — senão um teste de segurança
  **passa por engano**. Três falhas desta família já aconteceram aqui.
- **Alvo mal escolhido num teste aprova por engano.** Antes de acreditar numa
  falha, verifique se o alvo do teste é o que você pensa.
- **Cache do GitHub Pages não se conserta, se torna visível.** Daí o carimbo de
  build no rodapé (`versao.js` + `__VERSAO_BUILD__`). "Continua igual" virou um
  fato conferível em vez de suposição — três correções já foram relatadas como
  não entregues quando o problema era o navegador.

## Comandos

```bash
npm install
npm run dev      # Vite local
npm run build    # gera dist/ (o deploy é por Actions no push)
```

**Não existe `npm test`.** Os scripts do `package.json` são só `dev`, `build` e
`preview`. As 21 suítes de frontend são arquivos `frontend/*.teste.mjs` rodados
direto no Node, um por vez:

```bash
node frontend/rastro.teste.mjs
for f in frontend/*.teste.mjs; do node "$f"; done    # todas
```

Cada suíte imprime a própria linha de resumo, em **dois formatos diferentes**
("N passaram, 0 falharam de N" e "N passou, 0 falhou, N total") — quem for
somar precisa aceitar os dois. Estado atual: **1282 casos, 0 falhas, 21
suítes** (medido em 2026-10-03).

**Uma correção de número, porque este arquivo manda não inventar um.** Até
2026-09-19 aqui se lia "895 casos em 14 suítes". Rodando as catorze suítes do
estado publicado, sem tocar em nenhuma delas, a soma dá **885** — dez a menos.
Não se sabe de onde veio a diferença (número somado à mão em algum fechamento,
provavelmente). Os 922 acima são a soma das quinze linhas de resumo impressas
por uma execução de verdade.

```bash
python3 backend/testes/valida_sql.py    # valida as migrations sem banco
```

Testes de SQL de verdade precisam de Postgres 16 + PostGIS **num banco limpo**,
uma suíte por banco (ver regra dura 2).

---

## Estrutura de pastas

```
frontend/       o app. Puro/testável: rastro, visada, coordenadas, paleta,
                kml, situacao-usuario, enquadrar-mapa, anotacoes,
                vigia-ausencia, toque-longo, grade, exportar-kmz, zip-simples. Telas:
                login, index (aluno), instrutor, debriefing, situacao,
                menu-contexto, grade-tela, barra-coordenada,
                preferencias-tela, exportar-kmz-tela. Fontes únicas: simbolos,
                permissoes, preferencias, basemaps, catalogo-form,
                toque-longo, grade.
                GERADO, não editar: simbolos-catalogo.js
data/           só simbologia-eb/ (extrato do MD/EB + PROCEDENCIA.md)
scripts/        utilitários de build/manutenção
backend/        migrations SQL + RLS — ver backend/README.md
backend/testes/ suítes de RLS para Postgres cru. NUNCA em produção; banco limpo
legacy-qgis/    pipeline original. Não é consumido por nada; sobrevive como
                proveniência documentada
docs/           ROADMAP, roteiro de teste de campo, histórico de decisões, plano
```

O mapa detalhado de qual módulo faz o quê, arquivo por arquivo, está no
histórico — a estrutura acima basta para se localizar.

## Estado atual

**Exportação das marcações em KMZ (2026-10-03), sem migration e sem chave de
permissão nova.** Botão **"Baixar KMZ das marcações"** na aba "Situação atual"
do painel do instrutor, com escolha de ícone **PNG** (Google Earth, que não
desenha SVG como ícone) ou **SVG** (QGIS). O KMZ traz pasta por força, subpasta
por categoria de símbolo, e as anotações do instrutor numa pasta própria.
Regras que valem daqui em diante:

- **A cor do ícone exportado é FIXA, não relativa.** Um arquivo não tem
  observador. Partido de menor `ordem` = amigo (azul), demais beligerantes =
  hostil (vermelho), neutro = verde, **sem força = desconhecido (amarelo)**. A
  regra mora em `exportar-kmz.js` e reaproveita `hostilidadeRelativa()` com
  observador nulo — não reimplementar. Partido sem `ordem` sai com o SIDC cru
  (placeholder), nunca com uma cor chutada.
- **Lê do banco no clique, paginado de 1000 em 1000**, não do estado do mapa
  (`marcacoes.js` não exporta suas linhas). O PostgREST corta em 1000 sem
  avisar; um arquivo "completo" que perdeu a marcação 1001 é pior que um que
  falha.
- **O zip é escrito por `zip-simples.js`** (método STORE, sem dependência e sem
  CDN). Exportar não pode depender de um servidor externo responder.
- **"Só o instrutor" é decisão de interface** (o botão só existe em
  `instrutor.html`); a barreira real é a RLS. Não criar chave em
  `catalogo_permissoes` para isto (regra dura 3).
- **Fora do arquivo, de propósito:** pedidos de apoio e situações (estado
  volátil que o arquivo congelaria como se fosse o atual).
- **Limite conhecido:** marcação de partido **desativado** cai em "Sem força
  definida", porque `buscarPartidosDaTurma` só devolve partidos ativos.

**Medido:** suíte `exportar-kmz.teste.mjs`, 29 casos, inclusive o zip aberto por
um descompactador de verdade e o KML por um parser XML de verdade — foi o parser
que pegou um caractere de controle vazando para dentro do CDATA. Os ícones
foram gerados com a `milsymbol` real e os SVG conferidos como XML.
**NÃO testado:** o desenho dos símbolos no **QGIS** (a instrução do `LEIA-ME.txt`
do modo SVG é hipótese), o desenho em PNG por `canvas` e o download no
navegador. Roteiro: bloco 21 de `docs/roteiro-teste-campo.md`. O porquê das
decisões: `docs/historico-de-decisoes.md`, seção 35.

**2026-10-03 — migrations `0016`–`0019` aplicadas em produção** (0017, 0018 e
0019 conferidas por consulta de leitura). Isolar exercícios = **uma turma nova
por exercício**, criada pela aba "Nova turma (CSV)" (Edge Function
`importar-turma`, `service_role` só no servidor). Regras novas que valem daqui
em diante:

- **O papel de uma conta nova é sempre `usuario`** (0017). Nunca ler papel de
  `raw_user_meta_data`; papel só muda por UPDATE de quem tem `service_role` ou
  pelo instrutor.
- **Designação do calunga** (0018): `perfis.numero_esq`, `numero_dir`,
  `nome_fracao`; só o instrutor define (trigger `fn_proteger_campos_do_perfil`).
  Sem número, o símbolo escreve o nome de guerra; com número, os números
  assumem. Os clientes **toleram banco sem a coluna** (42703).
- **Administrador** (0019): `perfis.administrador` + `fn_sou_admin()`. Comanda
  todas as turmas, **menos apagar turma**. Só o SQL Editor/`service_role`
  concede; a trigger recusa o resto. Quem escrever uma policy nova de turma deve
  passar por `fn_sou_instrutor_da_turma` (já aceita o administrador); policy que
  compare `turmas.instrutor_id = auth.uid()` direto **não** enxerga o
  administrador.
- **Cadastro público** continua aberto, protegido só pelo código da turma:
  trocar o `codigo_acesso` por algo difícil de adivinhar.
- Testes SQL: **um banco limpo por suíte**; distinguir `erro` de `zero linhas`.
  Suítes novas: 07 (modo de posição), 08 (papel no cadastro), 09 (designação),
  10 (administrador).

Detalhe, decisões e limites conhecidos: `docs/historico-de-decisoes.md`,
seção 33. Pendente de teste ao vivo: importar uma turma descartável.

**2026-09-19.** `0001`–`0015` aplicadas em produção, nenhuma pendente. As
catorze entregas de setembro confirmadas funcionando no uso normal.

**Há trabalho NÃO EMPURRADO na cópia local** (era "todo o código publicado e
empurrado" até 2026-09-19). Duas coisas distintas:

1. **Menu de toque longo no mapa** — entrega de UX de 2026-09-19, descrita
   abaixo. Escrita, testada e construída; falta commitar e empurrar.
2. **Mudanças que já estavam na árvore antes dela**, não commitadas: a mudança
   de `.nojekyll`, uma migration de `backend/supabase/migrations/`, e a
   reorganização da documentação (`CLAUDE.md` + `docs/historico-de-decisoes.md`)
   que este arquivo descreve no topo como se já estivesse no repositório. Um
   `git clone` **não** traz nada disso.

**Estado inicial de interface se declara no HTML, não em JavaScript
(2026-10-03).** Relato recorrente: *"sempre que se faz o login, os cards
começam todos abertos e se fecham depois de alguns segundos"*. Não era
lentidão, era ordem: `tornarRecolhivel()` monta o cartão em JS (injeta CSS,
cria o `.pl-corpo`, põe `pl-recolhido`), e **antes dele rodar a regra que
recolhe não casa com nada** — o navegador pinta o cartão aberto, porque é o que
o HTML diz. No `index.html` essa janela durava seis `await` ao Supabase. Os
cartões passaram a nascer `class="panel-card pl-nasce-recolhido"`, com a regra
no `<style>` da página; `painel-lateral.js` é dono do **nome**
(`CLASSE_NASCE_RECOLHIDO`) e a remove ao montar o cartão, senão ele ficaria
preso fechado. **A regra não pode morar no módulo**: tudo que ele injeta chega
junto com o JavaScript, que é tarde demais — é a exceção consciente a FONTE
ÚNICA, e está justificada na seção **36** do histórico. O painel inteiro, esse
foi só **reordenado** (sobe para antes de o `body` aparecer), porque declará-lo
em CSS exigiria repetir os 820px de `LARGURA_PAINEL_ABERTO`. **A segunda regra
(`> h3 { margin-bottom: 0 }`) foi achada medindo:** sem ela o cartão nasce 42px
e encolhe para 34px quando o JS chega. Bloco 23 do roteiro.

**Grade, quadrículas e coordenada nas TRÊS telas (2026-10-03).** A grade e a
barra existiam só no app do aluno; o relato foi "ficou faltando no mapa do
instrutor". Entraram na aba "Situação atual" e no **debriefing** — rever um
exercício é justamente quando se quer quadrícula. O painel do instrutor não
tinha nenhum controle de coordenada, então ganhou os dois, em `<select>`, que é
o idioma daquela coluna (o do aluno usa rádios). Daí a extração de
`preferencias-tela.js`, que aceita os dois idiomas: o instrutor era o SEGUNDO
consumidor dos seletores, que viviam soltos dentro do `index.html`. O
debriefing **não** ganhou controle próprio — a preferência é de quem olha, não
da tela, e vale nas três de uma vez.

**O raciocínio das quatro entregas de UX** (toque longo, grade, coordenada e o
fim do toque curto, de 2026-09-19 a 2026-10-03) está em
`docs/historico-de-decisoes.md`, **seção 34** — por que o gesto virou módulo
puro, por que a grade UTM exigiu o UTM inverso, por que a pane fica abaixo dos
calcos, e os dois defeitos que só o navegador pegou. As regras destiladas delas
já estão acima, em forma imperativa; a seção guarda o porquê.

**O toque curto deixou de criar marcação (2026-10-02).** Tocar na tela para
apontar algo, ou para começar um arrasto, abria formulário sozinho. Criar
marcação é só pelo menu do toque longo agora — o gesto que não dispara por
acidente. **Obrigou ligar o menu em `situacao.js`**, senão o instrutor fica sem
como marcar; feito no mesmo commit. `suspenderClique()` e companhia continuam,
agora servindo ao menu. Ver o bloco 18 do roteiro de campo. **Reversível:** se
em campo o meio segundo a mais por marcação não compensar, volta.

**Grade de quadrículas e barra de coordenada (2026-10-02), sem migration e
sem chave de permissão nova.** `coordenadas.js` ganhou o **UTM INVERSO**
(`deUtm`, Snyder §8, erro de 5e-10 grau contra o PROJ) e a **zona forçada** em
`paraUtm` — sem os dois não existe grade UTM, só uma grade geográfica fingindo
ser UTM. `grade.js` (puro, 56 casos) decide passo, teto e rótulo: o **piso de
1 km** é estrutural, não uma checagem; o teto **sobe o passo** em vez de
cortar linhas; a linha UTM tem 5 vértices porque é inclinada pela convergência
meridiana, a geográfica tem 2 porque é reta. `grade-tela.js` desenha em pane
`zIndex 350` — abaixo dos calcos e dos símbolos, porque a quadrícula é parte
da CARTA. `barra-coordenada.js` segue o cursor no monitor e usa cruz no centro
em tela de toque. `preferencias.js` deixou de ser de chave única e virou
registro. **Dois defeitos só o navegador pegou:** `L.layerGroup({pane})` não
propaga a pane para os filhos (as linhas iam para a overlayPane, acima dos
calcos — o contrário do que o comentário do arquivo dizia), e a legenda
montava sobre a atribuição do Leaflet.

**Toque longo no mapa (2026-09-19), sem migration e sem chave de permissão
nova.** `toque-longo.js` (puro, com suíte própria) é o gesto — cronômetro,
tolerância de movimento, supressão do menu nativo, e o clique que vem no rabo
do toque longo; `menu-contexto.js` é o menu no mapa, com "Marcar elemento
aqui", a coordenada do ponto e a visada do posto até ele, as duas últimas já
lidas na própria linha. O gesto nasceu em `paleta-tela.js` e foi extraído
porque ganhou um segundo consumidor; `paleta-tela.js` ficou com dezessete
linhas no lugar de trinta e **ganhou a tolerância de movimento que não tinha**,
que é a metade do item `15j` do roteiro ("disparar sozinho ao rolar"). Em
`marcacoes.js`, `suspenderClique()`/`retomarClique()` viraram **contador**: com
booleano, o segundo consumidor a soltar desligava a suspensão do primeiro.

**Bateria sobre o estado com essa entrega:** 922 casos de frontend em quinze
suítes, 0 falhas; `npm run build` verde (181 módulos), conferido que os dois
módulos novos entram no bundle. As 168 asserções de SQL **não foram rodadas de
novo** — a entrega não toca em SQL nenhum, e o número acima é o do fechamento
de setembro.

**Uma coisa que a bateria pegou e um celular não pegaria:** a primeira versão
da máquina de estado CONTAVA dedos na tela. Quando o navegador não entrega o
`pointerup` (o dedo sai durante uma rolagem), o contador travava e o gesto
morria **para sempre**, em silêncio. O teste derrubou; passou a guardar o
identificador de cada dedo.

**A distinção que este arquivo insiste em manter:** bateria verde prova que o
código faz o que o teste diz, e "funcionando no uso normal" prova que a tela
responde. Nenhuma das duas prova o comportamento com **duas forças, dois
celulares e sinal ruim** — que é onde moram os modos de falha que interessam.

Em aberto, por ordem de consequência:

1. **Vazamento entre forças** — `15bt` (anotação), `15ce` (recado de situação),
   `15cs` (pedido de apoio). Um vazamento aqui não parece defeito: parece
   informação, e é assim que passa despercebido.
2. **`15cl`** — acionar o pedido de apoio **sem GPS**. É o caso que a coluna
   nulável da 0014 existe para permitir.
3. **`15dn`** — cartão fechado e o instrutor responde: tem que abrir sozinho.
4. **`15r`–`15t`** — publicar calco pelo painel, corrigido em 2026-09-14 depois
   de nunca ter funcionado desde a Etapa 7.
5. **Item 6** — "Voltar ao padrão da turma", o mais provável de expor problema
   real de Realtime.
6. **`15bp`** — o teto de 60 rótulos num calco grande de verdade.

**Três dependências fora do código**, que nenhum teste daqui resolve: a
**declinação magnética** (o app mostra lançamento de quadrícula; se o
observador usa bússola, a diferença é real — item 14c); a **fonte de MDE** para
altitude automática (mandar coordenada de alvo para serviço público de terceiro
é decisão de emprego, não detalhe de implementação); e a decisão de escopo
sobre **proteger `perfis.sidc` contra o próprio dono** — medido na suíte 04:
pela API, um aluno consegue trocar o próprio símbolo, e a decisão da 9b vale
para a interface, não para o banco.

**Pendência operacional, não código:** `turmas.codigo_acesso` da turma de teste
ainda é `TESTE`. Trocar antes de divulgar a URL — o cadastro é aberto, e esse
código é a única barreira de entrada. Ganhou urgência desde que existe um
endereço curto e fácil de repassar.

## Pontos de atenção conhecidos

- **`100vh` não é a altura visível no celular** — é a altura com a barra de
  endereço recolhida. O `body` das duas telas usa `height:100vh` seguido de
  `height:100dvh` (2026-10-03); quem mexer ali tem que manter as duas linhas, e
  a segunda por último. Com só `100vh`, **o rodapé fica fora da tela no
  celular** — e com ele o carimbo de build, que existe justamente para ser lido
  em campo, pelo telefone. Custou um relato de "a coordenada não aparece" para
  descobrir, e a coordenada era o menor dos problemas.

- **Termos de uso de mapas:** o Google Maps proíbe uso militar/defesa nos
  termos padrão. Os basemaps `google_sat`/`google_hybrid` presentes no código
  devem ser tratados como opcionais/risco, não como padrão. OSM e Esri são
  mais seguros.
- **Precisão de GPS de smartphone:** 5–15 m ao ar livre, pior em área fechada.
  Adequado para instrução; não é GPS de grau militar.
- **milsymbol** é implementação de código aberto do padrão, não homologada por
  força armada — ok para instrução.
- **O arquivo que o aluno abre fica no aparelho, e o limite prático não é a
  cota.** Cada arquivo no IndexedDB é **reprocessado na abertura da página**
  (guardamos os bytes originais, não o GeoJSON pronto). Daí os tetos de 24 MB
  e 8 arquivos: acima disso o app demora a abrir num celular, muito antes de o
  navegador reclamar. Se incomodarem, o conserto certo é cachear o GeoJSON
  convertido — e assumir que a melhoria não vale retroativamente.
- **Rádios militares:** integração futura, protocolo não definido. A
  arquitetura comporta a extensão sem redesenho — é só mais uma origem de
  "posição".

## Próximos passos

`docs/ROADMAP.md` tem a lista de etapas com complexidade e modelo sugerido
para cada uma. `docs/Plano_WartoolC2.docx` tem custos e viabilidade.
