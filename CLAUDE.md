# CLAUDE.md — WartoolC2

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

**WartoolC2** — portal WebGIS militar de instrução e C2, para uso em campo com
rede de dados disponível.

- Camada de fundo trocável (mapa online ou imagem georreferenciada local).
- KML/KMZ com controle de visibilidade e opacidade.
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
  da quadrícula. `preferencias.js` virou um REGISTRO de chaves em 2026-10-02 —
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
`preview`. As 17 suítes de frontend são arquivos `frontend/*.teste.mjs` rodados
direto no Node, um por vez:

```bash
node frontend/rastro.teste.mjs
for f in frontend/*.teste.mjs; do node "$f"; done    # todas
```

Cada suíte imprime a própria linha de resumo, em **dois formatos diferentes**
("N passaram, 0 falharam de N" e "N passou, 0 falhou, N total") — quem for
somar precisa aceitar os dois. Estado atual: **1056 casos, 0 falhas, 17
suítes** (medido em 2026-10-02).

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
                vigia-ausencia, toque-longo, grade, exportar-kmz. Telas:
                login, index (aluno), instrutor, debriefing, situacao,
                menu-contexto, grade-tela, barra-coordenada,
                exportar-kmz-tela. Fontes únicas: simbolos, permissoes,
                preferencias, basemaps, catalogo-form, toque-longo, grade.
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
