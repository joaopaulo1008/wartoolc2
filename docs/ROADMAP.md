# Roadmap do WartoolC2 — uma etapa por chat

Cada etapa abaixo cabe numa conversa própria. Ao abrir um chat novo dentro do projeto, comece pedindo para ler `CLAUDE.md` e este arquivo — isso reconstrói o contexto sem precisar colar histórico de conversas antigas, o que economiza tokens.

Sugestão de modelo por etapa: tarefas mecânicas/config → **modelo mais leve**; features com lógica de estado/tempo real → **modelo intermediário**; decisões de arquitetura ou refatoração grande → **modelo mais forte**. Ajuste conforme sua percepção de dificuldade real na hora.

## Feito

- [x] **Etapa 0 — Organização do projeto**: estrutura de pastas (`frontend/`, `data/`, `legacy-qgis/`, `backend/`, `docs/`), `CLAUDE.md`, plano de viabilidade, publicação no GitHub (`wartoolc2`).

- [x] **Etapa 1 — Schema do backend (Supabase)**
  Migrations `backend/supabase/0001_schema_inicial.sql` (tabelas `turmas`, `perfis`, `posicoes_atuais`, `posicoes_historico`, `marcacoes_inimigas`, `catalogo_permissoes`, `permissoes_turma`, `permissoes_usuario`, view `vw_permissoes_efetivas`) e `0002_rls.sql` (RLS completa + RPC `entrar_na_turma`). Documentado em `backend/README.md`. Validado contra um Postgres real com massa de teste cobrindo aluno, instrutor e usuário de outra turma.

- [x] **Etapa 3 — GPS próprio no mapa**
  `frontend/gps.js` (módulo novo): `watchPosition` contínuo, throttling (intervalo mínimo de 5s + distância mínima de 10m + heartbeat de 30s — ver comentários no arquivo), `upsert` só em `posicoes_atuais` (histórico fica por conta do trigger do banco), avatar com símbolo NATO via milsymbol usando `perfis.sidc` direto (sem montar SIDC na mão), mensagens de erro em PT-BR (permissão negada, sem suporte, sinal indisponível, perda de sinal em sessão). `frontend/index.html` ganhou o elemento `#gps-status` na topbar e chama `iniciarRastreamentoProprio()` depois do guard de sessão. `frontend/auth.js`: `buscarPerfil()` passou a selecionar também `sidc`. Testado localmente com `python3 -m http.server` (contexto seguro em `localhost`) e simulação de movimento via DevTools.

- [x] **Etapa 4 — Ver os outros usuários em tempo real**
  `frontend/colegas.js` (módulo novo): select inicial em `posicoes_atuais` filtrado pela turma (o Realtime não faz backfill do que já existia) seguido de assinatura de um canal `postgres_changes` (INSERT/UPDATE/DELETE) filtrado por `turma_id`, excluindo sempre o próprio `usuario_id` (o próprio avatar já é de gps.js). Cache de perfis (`id, nome_guerra, sidc`) da turma inteira buscado de uma vez no início (`buscarPerfisDaTurma`, novo em `auth.js`), com fallback sob demanda (`buscarPerfilBasico`) para quem entrar na turma depois do carregamento. Vigia de ausência local (`setInterval`) esmaece e depois remove o avatar de quem parou de mandar posição (fechou o app), usando `atualizado_em` (relógio do servidor, não do celular do colega) para medir a inatividade — sem isso, o avatar ficaria como um fantasma parado para sempre. `DELETE` do instrutor em `posicoes_atuais` também remove o avatar na hora. `frontend/index.html` ganhou `#colegas-status` na topbar e chama `iniciarColegas()` depois de `iniciarRastreamentoProprio()`. Verificado com `node --check` (sintaxe) e revisão manual da lógica; teste de ponta a ponta contra um projeto Supabase real (dois usuários simultâneos) ainda não foi feito nesta sessão — fica para o próximo teste em campo/dois celulares, junto com o que já estava pendente da Etapa 3.

- [x] **Etapa 4.5 — Partidos e hostilidade relativa**
  Migration `backend/supabase/0003_partidos.sql` (incremental sobre 0001/0002, que não foram reescritas): tabela `partidos` por turma (Azul e Vermelho como seed, criados também por trigger em toda turma nova), `perfis.partido_id`, `perfis.preferencias_visualizacao` (jsonb), e `marcacoes_inimigas` renomeada para **`elementos_marcados`** — a coluna `hostilidade` (absoluta) deu lugar a `partido_id` (o partido do elemento observado). `fn_usuarios_visiveis()` virou o **ponto único** de "quem eu enxergo": as policies de `posicoes_atuais`, `posicoes_historico` e `elementos_marcados` chamam a função em vez de inlinar `turma_id = fn_minha_turma()` — a Etapa 6.5 troca só o corpo dela. A derivação da hostilidade mora em `frontend/simbolos.js` (novo), que passou a ser a fonte única das tabelas APP-6D antes espalhadas em `index.html`. Validado contra um Postgres+PostGIS real com 0001+0002+0003 aplicadas em sequência e massa com dois partidos: **43/43** no teste de RLS (`backend/testes/01_teste_partidos.sql`) e **20/20** no teste da derivação (`frontend/simbolos.teste.mjs`).

  **Partido nulo é restritivo, por decisão:** quem ainda não foi distribuído numa força não enxerga ninguém além de si — e não é enxergado. O instrutor continua vendo a turma inteira, os dois partidos. Consequência prática: **num banco recém-migrado o mapa fica vazio até o instrutor distribuir as forças** (o `update` está em `backend/README.md`, seção "Depois de aplicar a 0003").

- [x] **Etapa 5 — Marcação de elemento no mapa**
  Nenhuma migration nova: `elementos_marcados` e a RLS dela já vinham prontas da Etapa 4.5. `frontend/marcacoes.js` (módulo novo, mesmo padrão de gps.js/colegas.js): toque no mapa abre um formulário fixo na tela pedindo tipo/natureza, dimensão, escalão e **o partido do elemento observado** (dropdown com "Não identificado" = `partido_id` nulo primeiro) — hostilidade nunca é perguntada. Ao salvar, monta o SIDC via `getSIDC()` (dígito de hostilidade sai como placeholder `01`) e grava em `elementos_marcados`; ao editar, `decomporSidc()` (novo em `simbolos.js`, o inverso de `getSIDC()`) pré-preenche o formulário a partir do SIDC gravado. Todas as marcações que a RLS deixa o usuário ver são desenhadas via `sidcParaObservador()` — nunca o SIDC cru — no mesmo padrão de canal Realtime (select inicial + `subscribe`) que `colegas.js` já usa, filtrado por `turma_id` e confiando na RLS (`autor_id in fn_usuarios_visiveis()`) para restringir mais. Exclusão é lógica (`removida_em`/`removida_por`, nunca `DELETE`): autor edita/remove a própria marcação, instrutor edita/remove qualquer uma da turma (popup com botões Editar/Remover, condicionados no cliente por conveniência de UI — a RLS é a barreira de verdade).

  **Extração do helper de ícone**, prevista desde o comentário de `colegas.js`: `frontend/icones.js` (novo) reúne `sidcParaObservador()` + montagem do `L.divIcon` via milsymbol (com fallback), consumido agora pelos três desenhistas de símbolo (`gps.js`, `colegas.js`, `marcacoes.js`) — acabou a duplicação.

  **Tabela `NATUREZA` reduzida**, nova em `simbolos.js` (mesma fonte — `legacy-qgis/cop_tatico_v7.py` — que já alimentava as demais tabelas manuais), para o `<select>` de tipo/natureza do formulário. Assim como as outras, é candidata a virar as tabelas oficiais do `stanag-app6` na Etapa 9.

  Verificado com `node --check` em todos os arquivos novos/alterados, `frontend/simbolos.teste.mjs` (ainda 20/20 — a tabela nova não quebrou nada) e um teste novo, `frontend/marcacoes.teste.mjs` (40/40), provando o par `getSIDC()`/`decomporSidc()` para todas as chaves reais de `DIMENSAO`, `ESCALAO` e `NATUREZA`, e que o dígito de hostilidade sempre sai como placeholder (nunca é pedido no formulário).

  **Teste de ponta a ponta com dois usuários reais não foi feito nesta sessão** (sem ambiente Supabase ao vivo disponível aqui) — fica para o próximo teste em campo, junto com o que já estava pendente das Etapas 3 e 4. Um detalhe importante para esse teste, descoberto ao raciocinar sobre a RLS existente: a visibilidade de `elementos_marcados` é amarrada ao **autor** (`autor_id in fn_usuarios_visiveis()`), não ao partido do elemento marcado — então **duas contas de partidos DIFERENTES nunca vêem a mesma marcação uma da outra** (mesmo comportamento, por design, de `posicoes_atuais` desde a 4.5). A forma certa de confirmar ao vivo que a hostilidade é relativa é com **duas contas do MESMO partido**: uma marca um elemento como do PRÓPRIO partido (deve aparecer AMIGO) e outra como do partido adversário (deve aparecer HOSTIL) — ambas visíveis uma para a outra, com símbolos diferentes. Ver também `frontend/simbolos.teste.mjs`/`marcacoes.teste.mjs` para a prova de que a mesma linha renderiza diferente por observador, no nível da função.

- [x] **Etapa 6a — Painel do instrutor: permissões, camadas e forças por usuário**
  As três tabelas de permissão, a `vw_permissoes_efetivas` e a RLS delas estão prontas desde a `0001`/`0002`, e `permissoes_turma`/`permissoes_usuario` já eram publicadas no Realtime desde a `0001` — esta etapa foi a primeira a usar tudo isso. A única migration nova é a `0004_perfis_realtime.sql`, que **não cria nem altera regra nenhuma**: só publica `perfis` no Realtime (ver o parágrafo sobre a troca de força, mais abaixo).

  `frontend/permissoes.js` (módulo novo) é a **fonte única de permissão no cliente**, compartilhado pelas duas telas: concentra as leituras (sempre de `vw_permissoes_efetivas`, nunca das tabelas cruas), as escritas nas duas camadas (`permissoes_turma` e `permissoes_usuario`, esta com `definida_por = auth.uid()` obrigatório pela policy) e o estado reativo do aluno — `observarPermissao(chave, cb)` chama o callback na hora e a cada mudança, e `pode(chave)` responde a pergunta pontual sem ninguém guardar cópia local do valor.

  `frontend/instrutor.html` deixou de ser esqueleto: lista dos usuários da turma (nome de guerra, papel, partido, com contagem de restrições e de ajustes individuais) à esquerda, grade de permissões à direita, em `frontend/instrutor-permissoes.js` (módulo novo). Cada linha mostra o valor efetivo, um interruptor e a **origem** vinda da view — "herdado da turma" vs. "ajustado para este aluno" vs. "padrão do sistema" —, com o botão de voltar à camada de baixo quando faz sentido. Uma entrada separada no topo da lista edita o **padrão da turma inteira**; é a única leitura que não passa pela view, porque a view é por usuário e não sabe dizer se uma chave está definida no nível da turma ou caindo no padrão do catálogo.

  No app do aluno, `gps.js` (`enviar_posicao_gps`, `ver_propria_posicao`), `colegas.js` (`ver_posicao_outros`) e `marcacoes.js` (`criar_marcacao_inimiga`, `editar_marcacao_propria`, `ver_marcacoes_outros`) passaram a checar de fato — a lacuna registrada desde a Etapa 3 fechou —, e `index.html` aplica as chaves de camada (`camada_manobra`, `camada_inimigo`, `camada_bdgex`, `trocar_mapa_base`, `ver_mapa`) através de uma ponte nova, `window.WartoolCamadas`, no mesmo padrão de `window.WartoolSimbolos` (e com o mesmo prazo: some na Etapa 9). Tudo reage em tempo real via assinatura de `permissoes_turma`/`permissoes_usuario`, com releitura da view a cada evento — o payload do Realtime diz o que mudou numa camada, não qual virou o valor efetivo depois da precedência.

  `camada_logistica`, `camada_obstaculos`, `carregar_kml`, `carregar_imagem_geo` e `ver_historico_rastro` **continuam sem efeito**, por não existir interface correspondente ainda; `CHAVES_APLICADAS` em `permissoes.js` é a lista única do que surte efeito, e o painel marca as demais com "sem efeito ainda" em vez de prometer o que não existe.

  **O painel também distribui as forças** (`perfis.partido_id`), que não é permissão — é coluna de `perfis` — mas era a outra coisa que o instrutor precisava ajustar por aluno e que só existia como `UPDATE` no SQL Editor. Nenhuma regra nova foi necessária: `perfis_editar_instrutor` (0002) e os dois triggers da 0003 já cobriam. A reação do lado do aluno é diferente da das permissões: `frontend/perfil-ao-vivo.js` (módulo novo) assina a **própria** linha de `perfis` e **recarrega a página** com um aviso de 3s. É deliberado — o partido de quem olha decide a hostilidade de cada símbolo já desenhado *e* quem a RLS deixa ele ver; remendar isso incrementalmente seriam cinco caminhos de estado novos em três módulos já testados, para algo que acontece uma ou duas vezes por exercício. Se um dia virar rotina, troca-se o corpo de `aoMudarPartido()` e nada mais.

  **Aviso que vale carregar para as próximas etapas:** estas checagens são de interface, não de segurança. Rodam no navegador do aluno e a RLS **não** conhece o catálogo de permissões (ela restringe por turma e por partido). Desligar `ver_posicao_outros` tira os colegas da tela, não do alcance da API.

  Verificado com `node --check` em todos os arquivos novos/alterados (incluindo os blocos `<script>` embutidos de `index.html` e `instrutor.html`, extraídos e checados à parte) e com os testes existentes, que continuam 20/20 (`simbolos.teste.mjs`) e 40/40 (`marcacoes.teste.mjs`). **A `0004` não foi executada contra um Postgres** (não havia ambiente na sessão) — são 10 linhas de DDL no mesmo padrão idempotente da seção 8 da `0003`, mas isso é leitura, não execução.

  **Pendente de teste ao vivo**, junto com o que já se acumula das Etapas 3, 4 e 5:
  1. instrutor desabilita `enviar_posicao_gps` → o `#gps-status` do aluno muda **sem recarregar**;
  2. instrutor clica **"Voltar ao padrão da turma"** → o aluno reage. Este é o caso a olhar com atenção: o Realtime não aplica RLS a eventos `DELETE`, só o filtro de coluna, e a assinatura depende do `REPLICA IDENTITY FULL` trazer o `usuario_id` da linha apagada para o filtro casar. Se algo não propagar, é aqui;
  3. instrutor troca a **força** de um aluno → o app dele avisa e recarrega sozinho (exige a `0004` aplicada).

- [x] **Etapa 6b — Histórico/replay de posições (debriefing)**
  Nenhum dado novo: o rastro é gravado desde a Etapa 3 (o cliente escreve só em `posicoes_atuais`, o trigger `trg_arquivar_posicao` copia para `posicoes_historico`) e a RLS já deixava o instrutor lê-lo. A única migration é a **`0005_rastro_historico.sql`**, que não cria nem altera regra nenhuma: acrescenta `fn_rastro_historico()`, uma função de **leitura**.

  `frontend/instrutor.html` ganhou **abas** — "Permissões e forças" (a 6a) e "Debriefing — rastro" — e, com a segunda, Leaflet + milsymbol via CDN (mesmas versões de `index.html`). O símbolo de cada aluno no replay sai de `criarIconeSimbolo()` em `frontend/icones.js`, o mesmo caminho de `gps.js`/`colegas.js`/`marcacoes.js` desde a Etapa 5 — nada de símbolo redefinido à mão.

  A tela é dois módulos, pela separação de sempre (regra vs. interface): **`frontend/rastro.js`** é a matemática pura — amostragem, segmentação por perda de sinal, busca binária do ponto vigente, interpolação e distância — sem DOM, sem Leaflet, sem Supabase, e por isso testável em Node; **`frontend/debriefing.js`** é a tela: escolher alunos e intervalo, buscar, desenhar as trilhas e andar no tempo (play/pause, velocidade de 1× a 120×, barra de tempo arrastável).

  **Volume foi o problema central da etapa**, não permissão: 60 alunos × heartbeat de 30s × 4 horas chega perto de 170 mil linhas, e o PostgREST do Supabase corta a resposta em 1000. Três defesas em camadas, e a justificativa completa está no cabeçalho da `0005`:
  1. **janela de tempo obrigatória** — não existe "buscar tudo"; a consulta é montada no formato de `idx_hist_usuario_tempo (usuario_id, medido_em desc)`;
  2. **amostragem no servidor** — um ponto por aluno por balde de N segundos, com N calculado a partir da janela e de quantos alunos foram escolhidos. As 170 mil linhas viram ~7 mil pontos, e a redução acontece **antes** da rede;
  3. **busca em lotes de ALUNOS, não paginação por deslocamento** — paginar uma RPC por offset faz o PostgREST reexecutar a função inteira a cada página (12 páginas = 12 varreduras). Como a resolução automática garante que nenhum aluno passa de 1000 pontos, cada requisição leva o maior lote de alunos que cabe numa página e a soma custa **uma** varredura.

  A tela mostra o balde escolhido **antes** de consultar, informa quantas leituras reais cada ponto representa e **avisa quando o resultado foi cortado** — um rastro incompleto com cara de completo é o pior modo de falha possível num debriefing.

  **`ver_historico_rastro` saiu de "sem efeito ainda"**: entrou em `CHAVES_APLICADAS` (`permissoes.js`) e é observada por `debriefing.js` via `observarPermissao`. Para isso o painel precisou passar a **consumir** permissão, não só editá-la: `instrutor.html` agora chama `iniciarPermissoes()`. Sem isso o observador cairia no padrão do catálogo — que para esta chave é `false` — e a aba abriria bloqueada para o próprio instrutor.

  **A `0005` é `security invoker`, e isso é o ponto de segurança da etapa.** Quase toda função do projeto é `definer`, mas por serem chamadas de dentro de policies; esta é chamada de fora e lê uma tabela protegida. `definer` aqui faria a função passar por cima de `historico_ler` e qualquer aluno leria o rastro de qualquer pessoa com o UUID. Sendo invoker, a policy vale dentro da função — e é ela, não a checagem no navegador, que sustenta a permissão.

  Verificado com `node --check` em todos os arquivos novos/alterados (incluindo os blocos `<script>` embutidos, extraídos e checados à parte), com os testes existentes ainda verdes — 20/20 (`simbolos.teste.mjs`) e 40/40 (`marcacoes.teste.mjs`) — e com um teste novo, **`frontend/rastro.teste.mjs` (64/64)**, que trava as três afirmações que um erro silencioso quebraria: a interpolação suaviza entre leituras próximas mas **nunca** atravessa uma perda de sinal; a trilha e a distância percorrida não ligam em linha reta dois trechos separados por silêncio; e a busca binária devolve o ponto vigente nas bordas. Também prova a invariante de que a busca em lotes depende (nenhum aluno passa de 1000 pontos na resolução automática) — e apanhou um bug real durante o desenvolvimento: `Number(null)` é `0`, então uma coordenada nula virava um ponto legítimo no golfo da Guiné no meio da trilha.

  **A `0005` não foi executada contra um Postgres** (não havia ambiente na sessão, como na `0004`). O que foi feito: o arquivo inteiro — incluindo o corpo da função, que para o parser externo é só uma string — foi validado com o **parser oficial do PostgreSQL** (`libpg_query`, via `pglast`), junto com as migrations `0001`–`0004`; e a semântica da amostragem por balde foi reproduzida e verificada à parte, provando que devolve exatamente um ponto por aluno por balde, que é sempre o mais antigo do balde, que nenhum balde ocupado se perde e que a soma de `leituras_no_balde` reconstrói o total bruto. Isso é bastante, mas **não substitui** rodar a migration e conferir o plano de execução no banco real.

  **Pendente de teste ao vivo**, somando ao que já se acumula das Etapas 3 a 6a:
  1. aplicar a `0005` e conferir `prosecdef = false` (se vier `true`, alguém trocou para `definer` e a RLS do histórico deixou de valer);
  2. `explain analyze` da RPC para confirmar que usa `idx_hist_usuario_tempo` e não varre a tabela;
  3. chamar a RPC com o **token de um aluno**, passando o UUID de um colega, e confirmar que volta só o rastro próprio — é a prova de que o `security invoker` está fazendo o que promete;
  4. um exercício de verdade com movimento, para ver se a cadência de 30s e a interpolação dão um replay legível.

- [x] **Etapa 6c — Situação atual: o mapa ao vivo do instrutor** *(lacuna encontrada depois da 6b, não estava no plano original)*
  Nenhuma migration nova: as quatro policies usadas aqui (`posicoes_ler`, `posicoes_remover_instrutor`, `elementos_criar`, `elementos_editar_instrutor`, `elementos_remover`) e as duas publicações no Realtime já existiam desde 0002/0003 — faltava só a tela. O dado sempre esteve liberado: `posicoes_ler` tem o ramo `fn_sou_instrutor_da_turma(turma_id)`, que entrega a turma inteira, os dois partidos.

  `frontend/instrutor.html` ganhou uma terceira aba, "Situação atual" (entre Permissões e Debriefing), com sua PRÓPRIA instância de Leaflet — deliberado, não economia perdida: compartilhar uma única instância com a de `debriefing.js` (que desenha um passado fechado, não o presente) exigiria limpar e reconstruir o estado inteiro a cada troca de aba, um lugar fácil para um marcador do replay vazar para o mapa ao vivo ou vice-versa. Mesmo cuidado da 6b quanto a Leaflet em aba escondida: o mapa só é montado na primeira vez que a aba abre.

  **`frontend/situacao.js` (módulo novo) é a tela.** Select inicial + canal Realtime + vigia de ausência em `posicoes_atuais`, sem excluir ninguém (o instrutor enxerga os dois partidos, e a tela nunca envia a própria posição dele — nenhum `import` de `gps.js` aqui). A lista da turma ao lado do mapa mostra, por aluno, "ao vivo" / "parado há Xm" / "sem sinal há Xm" / "sem posição", com botões para centralizar o mapa nele, apagar sua posição se ficou fantasma (`DELETE` em `posicoes_atuais`, com confirmação — destrutivo e sem desfazer) e pular direto para o rastro dele no Debriefing.

  **Decisão de reuso — módulo novo para posições, mas `frontend/marcacoes.js` reaproveitado (não copiado) para as marcações.** `colegas.js` foi descartado como base a generalizar: ele exclui sempre o próprio `usuario_id` (aqui não existe "próprio avatar"), liga/desliga o módulo inteiro pela permissão `ver_posicao_outros` do aluno (o instrutor não tem essa amarra) e escreve status num `#colegas-status` que não existe neste painel — parametrizar os três pontos para um único outro consumidor não valeria a duplicação evitada. Já `marcacoes.js` foi reaproveitado tal como está: `meuPapel === 'instrutor'` já fazia `deveMostrar()`/`podeMexer` valerem "vê e mexe em tudo" sem lógica nova. Ganhou só dois acréscimos ADITIVOS, que não mudam nada do app do aluno: `avaliarCriacaoExtra` (hook opcional para a pegadinha de lotação, ver abaixo) e `pararMarcacoes()` (teardown limpo, para a aba trocar de turma sem sobrepor marcações de duas turmas na mesma tela).

  **A vigia de ausência saiu para `frontend/vigia-ausencia.js` (novo)**, e `colegas.js` foi ajustado para consumir os limiares (60s esmaece, 120s some) e o cálculo de idade de lá. Com dois consumidores reais dos MESMOS números, copiá-los seria exatamente o risco que o projeto já evita desde `icones.js` (Etapa 5): duas cópias livres para divergir em silêncio se um dia alguém ajustar um limiar só de um lado.

  **A pegadinha de `elementos_criar`** (exige `turma_id = fn_minha_turma()` — estar LOTADO na turma — e não `fn_sou_instrutor_da_turma()`, que cobre lotado OU responsável) ganhou aviso próprio nesta aba, no mesmo padrão de `avaliarPermissaoDeEscrita()` em `instrutor-permissoes.js`: um banner com o `update` de correção pronto quando o instrutor só RESPONDE pela turma sem estar lotado nela, e o clique no mapa mostra um status curto em vez do erro cru do PostgREST.

  **Símbolo NATO sempre via `criarIconeSimbolo()`, nunca redefinido.** O observador aqui é o instrutor, que normalmente não tem partido — `hostilidadeRelativa()` (`simbolos.js`) devolve `null` de propósito nesse caso e o SIDC gravado passa intacto; o código comenta isso explicitamente em vez de deixar parecer descuido, e é o mesmo comportamento que o replay de `debriefing.js` já tinha para o mesmo observador.

  **"Ver rastro" pula para o Debriefing com a janela já preenchida:** `debriefing.js` ganhou `abrirRastroDoAluno(usuarioId)` (aditivo — não muda o fluxo normal da aba), que garante mapa e lista de alunos carregados, seleciona só aquele aluno e busca. `instrutor.html` é quem troca a aba visível antes de chamar (para o Leaflet de lá não nascer 0×0) — `situacao.js` não sabe nada sobre abas, de propósito.

  Nenhuma chave nova em `CHAVES_APLICADAS`: o instrutor recebe tudo habilitado pelo papel, então nada aqui precisava de um novo item no catálogo de permissões.

  Verificado com `node --check` em todos os arquivos novos/alterados (incluindo o bloco `<script>` embutido de `instrutor.html`) e com os testes existentes ainda verdes — 20/20 (`simbolos`), 40/40 (`marcacoes`), 64/64 (`rastro`). Nenhum teste novo: `situacao.js` é DOM/Leaflet/Supabase de ponta a ponta, sem lógica pura isolável — mesmo critério que já valia para `colegas.js` desde a Etapa 4.

  **Pendente de teste ao vivo**, somando ao que já se acumula: instrutor abre "Situação atual" e vê os dois partidos se movendo ao mesmo tempo; apagar a posição de um fantasma remove o avatar no app do aluno **sem F5** (mesmo evento `DELETE` que já é pendência desde a 6a); um instrutor só responsável (não lotado) tenta criar marcação nesta aba e vê o aviso com o `update` pronto, não o erro cru do PostgREST; clicar "Ver rastro" troca de aba e já mostra a última hora com o aluno certo pré-selecionado.

  ~~**Ponta solta herdada da Etapa 7:** o mapa da Situação atual não mostra os calcos publicados.~~ **FECHADA** ainda na Etapa 7, e do jeito previsto aqui: `iniciarCamadas()` passou a receber o **contêiner do painel por parâmetro** (`#situacao-lateral` nesta aba, `#side-panel` no app do aluno) e ganhou `definirTurmaCamadas()`, chamada por `definirTurmaSituacao()` para os calcos acompanharem o seletor de turma do topo. As camadas entram em `aoAbrirSituacao()`, junto com o mapa e pelo mesmo motivo: o painel precisa de um contêiner visível, e não faz sentido baixar calco para uma aba que talvez não seja aberta. A permissão por categoria se resolveu sozinha — o instrutor recebe todas as chaves habilitadas pelo papel.

- [x] **Etapa 7 — Upload de KML/KMZ com opacidade**
  Migration **`0006_calcos.sql`**: tabela `calcos`, bucket privado de Storage e a RLS dos dois.

  **A etapa tem DOIS caminhos, e a decisão de os manter separados é o eixo dela.** (1) O **arquivo do aluno**: ele escolhe um `.kml`/`.kmz` do próprio aparelho, a camada aparece só para ele e some no F5 — não sobe nada, não grava nada. (2) O **calco do instrutor**: publicado pelo painel, guardado no Storage, baixado por quem tem direito de ver, e aparecendo no app dos alunos **em tempo real**, sem ninguém recarregar. O motivo de não misturar é concreto: se o aluno pudesse classificar o próprio arquivo numa categoria de camada, ele carregaria qualquer coisa, chamaria de "manobra" e recuperaria uma camada que o instrutor tinha desligado.

  **Três chaves saíram de "sem efeito ainda"** (`CHAVES_APLICADAS` em `permissoes.js`):
  - **`carregar_kml`** governa o arquivo local do aluno. Como o padrão dela no catálogo é `false`, o aluno **nasce sem a função** — então o botão continua na tela, desabilitado, dizendo que vem desligado por padrão e que o instrutor pode liberar. Sumir pareceria app quebrado; sumir sem explicação seria pior, porque ele nem saberia que a função existe para pedir.
  - **`camada_logistica`** e **`camada_obstaculos`** passaram a valer porque passou a existir camada correspondente: `calcos.categoria` é uma FK para `catalogo_permissoes` restrita às quatro chaves de camada, e é o **instrutor** quem classifica ao publicar. Não existe "camada fixa de logística" no código — existe *o calco de logística que alguém publicou*. Uma chave vale nos dois caminhos ao mesmo tempo: desligar `camada_manobra` esconde tanto o GeoJSON commitado (`EXTRA_LAYERS`) quanto os calcos de manobra publicados.

  **Quatro decisões de backend que valem carregar adiante:**
  1. **Quem publica calco é só o instrutor da turma.** Um calco é HTML de terceiro desenhado na tela de 60 pessoas; aluno publicando transformaria um `<description>` malicioso num ataque de aluno contra a turma.
  2. **A visibilidade do calco NÃO passa por `fn_usuarios_visiveis()`**, e é proposital: aquela função é amarrada ao AUTOR, e aqui o autor é sempre o instrutor — que os dois partidos enxergam —, então usá-la faria todo calco vazar. A pergunta certa é sobre o destinatário: `partido_id` nulo = turma inteira, setado = só aquele partido. **Consequência para a 6.5:** trocar o corpo daquela função não muda nada aqui.
  3. **O caminho do objeto é imposto por trigger** (`<turma_id>/<id>.<formato>`), nunca escolhido pelo cliente — senão um instrutor cadastraria uma linha apontando para o objeto de outra turma e autorizaria a própria turma a baixá-lo.
  4. **Exclusão é lógica na linha e definitiva nos bytes.** A linha fica para auditoria; o objeto sai do Storage porque cota custa dinheiro. Não existe desfazer — republica-se.

  **Volume, com os números justificados** (mesma disciplina da 6b):
  - **2 MB por calco compartilhado**, contra 8 MB do arquivo local. A diferença é a rede: 2 MB × 60 alunos × 3 calcos × ~5 recargas ≈ **1,8 GB**, mais de um terço dos 5 GB/mês de egress do plano Free, num só exercício. Enforced em três lugares que falham em momentos diferentes (navegador, `file_size_limit` do bucket, `check` da tabela).
  - **Zip bomb barrado antes de inflar**: um `.kmz` de 2 MB pode conter 200 MB de KML, então o filtro do `fflate` decide o que descomprimir olhando o `originalSize` do diretório do zip.
  - **5.000 feições** é o teto (cada feição é um nó de SVG reposicionado a cada pan/zoom; acima disso o celular trava com o dedo na tela) — arquivo maior é recusado, não aceito e travado depois.
  - **Acima de 40.000 vértices, simplifica** com Douglas-Peucker, na menor tolerância que resolva, de `[1, 2, 5, 10, 25] m`. **O teto de 25 m é a carta**: na BDGEx 1:50.000, 0,5 mm de papel valem 25 m, então simplificar mais deslocaria a linha mais do que a carta consegue representar. Não bastou? Recusa e manda simplificar no QGIS. E a tela **diz** que simplificou e quanto — simplificar é mexer no dado, e nunca em silêncio.

  **XSS foi tratado por construção, não por escape.** Os popups de `camadas.js` são montados com `createElement` + `textContent`, nunca `innerHTML`: não existe caminho pelo qual o `<description>` do arquivo vire marcação. `textoSimples()` em `kml.js` tira as tags só por legibilidade — se errar, o resultado é texto feio, jamais HTML executado. A mesma desconfiança vale para cor (`#rrggbb` ou nada), espessura de traço (limitada) e **ícone declarado no KML, que NÃO é honrado**: um `<IconStyle>` aponta para URL remota, e buscá-la entregaria o IP de cada aluno a quem hospeda o arquivo — um pixel de rastreamento embutido num calco funcionaria perfeitamente. De quebra, o `bindPopup(\`<b>${nome}</b>\`)` de `carregarExtraLayers()` em `index.html`, que interpolava sem escapar desde o protótipo, foi corrigido.

  **Opacidade e ordenação valem para TODAS as camadas de arquivo, não só as carregadas** — era o que faltava em todas elas. Um mecanismo só: cada camada ganha um `pane` do Leaflet, opacidade é a opacidade CSS do pane e ordem é o z-index. Serve para vetor, vai servir para o GeoTIFF da Etapa 8 sem mudança, e não sobrescreve a cor que veio do próprio KML. Faixas: 410 repositório, 440 calcos, 470 arquivo do aluno, teto em 500 — **abaixo do `markerPane` (600), de modo que nenhum calco consegue tapar um símbolo militar**.

  **O arquivo do aluno não some no F5.** Fica guardado no **IndexedDB** (`frontend/armazem-camadas.js`), junto com a opacidade, a ordem e a caixa marcada — senão "não some" seria meia verdade. O que se guarda são os **bytes originais**, não o GeoJSON convertido: o KMZ comprimido ocupa uma fração, e reprocessar na abertura faz uma melhoria futura nos limites valer para o arquivo guardado semana passada. Três consequências tratadas: (a) se os limites ficarem mais estritos, um arquivo aceito antes é recusado na restauração, sai do aparelho e o aluno é avisado; (b) o teto é de **24 MB e 8 arquivos**, e não vem da cota do navegador (generosa) e sim do tempo de abertura — oito arquivos de 8 MB seriam ~64 MB de KML para parsear antes de o mapa aparecer, num celular; (c) quando não cabe, **recusa e diz o que fazer**, em vez de descartar o mais antigo em silêncio — mesma postura da 6b, porque o aluno que não encontra hoje o calco de ontem vai achar que o app perdeu o arquivo dele, não que o descartou. Falha de armazenamento (navegação privada, cota negada) nunca derruba a camada: ela continua no mapa e a tela diz só o que se perdeu.

  **Escopo por usuário, sem apagar no logout.** O celular é pessoal de cada aluno, então limpar no `sair()` só faria ele perder o calco a cada sessão sem proteger ninguém. Mas cada registro carrega o `usuario_id` e toda leitura filtra por ele — cobre o aparelho emprestado e o instrutor que entra na conta dele no celular de um aluno. Sem essa chave, num exercício com Azul e Vermelho, o calco de um partido apareceria para quem entrasse depois.

  **Seis arquivos novos, na separação de sempre:** `kml.js` (lógica pura e testável — limites, contagem, simplificação, poda de texto, decisão de guardar; sem DOM, Leaflet ou Supabase, no padrão de `rastro.js`), `armazem-camadas.js` (o IndexedDB), `kml-navegador.js` (a costura que só existe no navegador: DOMParser + zip, com as bibliotecas `@tmcw/togeojson` e `fflate` importadas de CDN **sob demanda**, porque `carregar_kml` nasce `false` e não faz sentido 60 celulares baixarem 120 kB por um recurso que quase ninguém usa), `calcos.js` (banco e Storage, compartilhado pelas duas telas, no padrão de `permissoes.js`), `camadas.js` (o painel de camadas, servindo tanto o app do aluno quanto a aba "Situação atual" — o contêiner vai por parâmetro) e `instrutor-calcos.js` (aba de publicação).

  Verificado com `node --check` em todos os arquivos novos/alterados, **incluindo os blocos `<script>` embutidos** de `index.html`/`instrutor.html`/`login.html` (extraídos com um script que remove os comentários HTML antes de procurar — `index.html` tem a palavra `<script>` dentro de um comentário e uma regex ingênua a apanharia), com os testes existentes ainda verdes — **20/20** (`simbolos`), **40/40** (`marcacoes`), **64/64** (`rastro`) — e com um teste novo, **`frontend/kml.teste.mjs` (116/116)**. Ele trava o que um erro silencioso quebraria: os limites recusam ANTES de fazer estrago (tamanho antes de ler, zip bomb antes de inflar, feições antes de o Leaflet montar um nó por feição); guardar no aparelho recusa em vez de descartar o mais antigo em silêncio, e a mensagem sempre diz o que fazer e que a camada continua no mapa agora; a simplificação preserva o primeiro e o último ponto, mantém a ordem, mantém o anel fechado e não degenera um triângulo; nada vindo do arquivo sai como HTML; e as faixas de pane não se sobrepõem nem alcançam o `markerPane`. **Apanhou uma propriedade real durante o desenvolvimento:** Douglas-Peucker é idempotente em linha aberta, mas **não** em anel fechado — num anel o primeiro e o último ponto são o mesmo, a reta de referência é degenerada e a segunda passagem pode remover mais um ponto. Não afeta o app (a simplificação sempre parte do GeoJSON original, nunca do resultado da tentativa anterior) e ficou registrado no teste em vez de escondido.

  **`backend/testes/valida_sql.py` é novo** e vale para as próximas migrations: valida em três níveis, porque para o parser externo o corpo de uma função é só uma string — o arquivo comando a comando, o corpo de cada função (SQL e plpgsql) e o SQL embutido nos `EXECUTE` dentro dos blocos `DO`. As seis migrations passam nos três. Traz documentada uma limitação **da ferramenta, não do SQL**: `parse_plpgsql()` desta versão do `pglast` quebra em qualquer função `returns trigger` — reproduzível com um `begin return new; end` vazio, e idêntico nas funções da 0003 que já rodam em produção.

  **A `0006` não foi executada contra um Postgres** (sem ambiente na sessão, como a 0004 e a 0005).

  **Pendente de teste ao vivo**, somando ao que se acumula das Etapas 3 a 6b:
  1. **O mais importante desta etapa:** com token de um aluno do Vermelho, tentar baixar pelo caminho direto o objeto de um calco publicado só para o Azul — tem que dar erro. A policy `calcos_objeto_ler` não repete a regra de visibilidade: ela pergunta "existe uma linha de `calcos` com este caminho que eu consiga ler?" e deixa `calcos_ler` responder. Isso se apoia num comportamento documentado do PostgreSQL (tabela referenciada dentro de policy tem as policies dela aplicadas), **mas se algum dia deixasse de valer o modo de falha seria ABERTO, não fechado**;
  2. aplicar a `0006` e conferir que o bucket `calcos` nasceu **privado** — bucket público é servido por URL adivinhável, sem passar por RLS nenhuma, e anularia o item 1;
  3. instrutor publica um calco com a turma toda com o app aberto → a camada aparece nos aparelhos **sem F5**, e remover tira de todos na hora;
  4. aluno com `carregar_kml` desligada vê o botão desabilitado **com a explicação**, e ao instrutor ligar a chave o botão libera sem recarregar;
  5. um KMZ de verdade, exportado do QGIS ou do Google Earth, num celular — é o que diz se os limites de 5.000 feições e 40.000 vértices estão no lugar certo na prática.

- [x] **Etapa 7.1 — Ajustes de interface depois de ver a 7 funcionando**
  Sem migration e sem regra de acesso nova. Três pedidos de quem usa, e dois bugs que eles expuseram.

  **1. O painel parou de tomar a tela.** `frontend/painel-lateral.js` (módulo novo): cada cartão recolhe pelo título e o painel inteiro recolhe num botão, que **nasce fechado em tela estreita** — no celular o mapa aparece inteiro e o painel vira uma decisão, não uma imposição. "Mapa Base" nasce recolhido mesmo no monitor: é o maior cartão e o menos usado, porque depois de escolher a carta ninguém volta nele. A largura é medida **uma vez**, na montagem, e não por listener de `resize`: girar o celular no meio do exercício não pode fechar o painel que a pessoa acabou de abrir.

  **2. Onze mapas base viraram seis**, na ordem de importância para a instrução: **BDGEx** (primeiro, e agora o padrão do app — é a carta do Exército), OpenTopoMap, Google satélite, Google híbrido, Híbrido (Sat+Labels) e Claro.

  Isso obrigou a **antecipar `frontend/basemaps.js`, que estava adiado para a Etapa 9**. A tabela estava copiada em **quatro** lugares e aplicar a redução à mão em todos era garantir que um divergisse — o erro que a 4.5 corrigiu no SIDC. Agora são **duas** cópias (a fonte e o `<script>` clássico de `index.html`, que não pode importar), e a que sobrou tem guarda automática. **De quebra, as duas telas do instrutor ganharam o BDGEx**, que não estava em nenhuma delas — faltava justamente para quem conduz a instrução.

  **Dois bugs reais que a redução expôs**, e que estariam calados:
  - **O fallback de `camada_bdgex` apontava para o `osm`**, que saiu da lista. Desligar a permissão com o aluno no BDGEx o deixaria com **mapa vazio, sem erro nenhum**. Virou `BASEMAP_FALLBACK`, com teste exigindo que a chave exista na lista.
  - **O BDGEx estava fixo em `http://`.** Numa página https isso é conteúdo misto e o navegador bloqueia: no deploy da Etapa 11, a carta mais importante do projeto não desenharia. Passou a herdar `location.protocol`.

  **3. Cor por camada, em três opções fixas** (azul, preta, vermelha) no lugar da opacidade como controle principal. Não é seletor livre porque calco militar tem convenção de cor. **Azul e vermelho são os mesmos tons da legenda de forças** (Amigo e Hostil) logo acima no painel — a mesma cor querendo dizer a mesma coisa na mesma tela, com teste travando isso. O estilo que vem dentro do KML manda **até** o usuário escolher uma cor à mão; a partir daí a escolha dele vale sobre tudo (`corForcada`), e isso também impede que o instrutor renomear um calco desfaça a cor que o aluno já ajustou. A opacidade continua existindo, atrás de um botão de detalhe.

  Verificado com `node --check` em 28 arquivos e nos 4 blocos `<script>` embutidos, testes existentes verdes (**20**, **40**, **64**, **116**) e um teste novo, **`frontend/basemaps.teste.mjs` (24)** — de um tipo que o projeto ainda não tinha: ele **lê o `index.html`** e falha se as cópias divergirem (chaves de `BASEMAPS`, rádios do seletor, rádio marcado, constante de fallback, protocolo do BDGEx e as três cores). É o que torna aceitável manter uma cópia até a Etapa 9.

  **Ainda na 7.1, ao ler a documentação do BDGEx: a carta estava configurada errada de duas formas, e as duas falhavam em silêncio.**
  - **`ctm50` cobre só parte do território** (RS, SC, PR, SP, RJ, ES e pedaços de MG, BA, AM, PA, AP, AL, RN, MA). **Num exercício fora dessa área, o aluno abria o app e via mapa branco**, sem pista do motivo. Passou a usar **`ctmmultiescalas_mercator`**, que empilha 1:25.000 → 1:250.000 e escolhe pelo zoom: ~90% do território, e 1:25.000 onde houver. Uma opção só no seletor, mais carta do que antes.
  - **O `crs: L.CRS.EPSG4326` forçado saiu.** O sufixo `_mercator` é literal: a camada é publicada em EPSG:3857, que já é o padrão do Leaflet. E `mapcache` não é WMS completo — serve só as grades que tem em cache, então grade errada devolve **tile em branco, sem erro**. Era candidato forte a explicar o BDGEx parecer instável.

  Os dois erros ficaram travados em `basemaps.teste.mjs`, nas duas cópias — e a checagem roda sobre o código **sem comentários**, porque a primeira versão dela falhou ao encontrar `ctm50` e `EPSG4326` dentro do próprio comentário que os proíbe (a mesma pegadinha do `<script>` dentro de comentário no `index.html`). Plano B, se o `mapcache` der problema: endpoints por escala em https (`/teogc/25/`, `/50/`, `/100/`, `/250/`, camada `ctm`).

  **Pendente de teste ao vivo:**
  1. **abrir o app e conferir se a carta desenha** com a camada e o CRS novos — não deu para testar daqui, o BDGEx não responde a requisição de fora do Brasil;
  2. confirmar que `bdgex.eb.mil.br/mapcache` atende em **https**. A documentação lista `https://bdgex.eb.mil.br/teogc/...` e o app oficial roda em https, então o host atende — falta o caminho `/mapcache`. Se não atender, a saída é um proxy reverso próprio: não existe "voltar para http" numa página https.

- [x] **Etapa 11 — Deploy e domínio** *(ANTECIPADA em 2026-07-31: passou na frente da 8a e da 9)*

  Sem migration. Publicado no **GitHub Pages**, a partir da raiz do repositório — grátis, HTTPS automático, sem etapa de build. Domínio, por ora, o subdomínio do próprio Pages (`https://joaopaulo1008.github.io/wartoolc2/`); domínio próprio fica em aberto, não bloqueador. Ver a seção "Decisões da Etapa 11" em `CLAUDE.md` para o raciocínio completo de cada uma das quatro decisões pedidas em `docs/prompt-etapa-11.md`; resumo:

  1. **`frontend/config.js` passou a ser commitado** (saiu do `.gitignore`) — a `SUPABASE_ANON_KEY` é a *publishable key* do projeto, pública por design (quem barra é a RLS, não a chave). Sem isso o `import` em `auth.js` falha e nenhuma tela carrega.
  2. **Cadastro aberto, mas exigindo o código da turma no cadastro** (decisão revisada depois da entrega inicial da etapa — a primeira versão tinha fechado o cadastro por completo). `backend/supabase/0007_codigo_turma_valido.sql` (nova) dá uma função pública (`anon`) que só confere se o código existe, sem sessão; `frontend/auth.js`/`login.html` chamam ela antes do `signUp()`. O código passa a valer como "senha do exercício" — sem ele a conta não entra em turma nenhuma e não vê ninguém, mesma regra de partido nulo desde a 4.5. `backend/seed/criar_usuarios.mjs` (novo) continua existindo, para a conta do instrutor (que o cadastro aberto não cria) ou para quem preferir não depender de autocadastro.
  3. **`REPO_RAW` deixou de apontar para `raw.githubusercontent.com`** — vira caminho relativo (`../`), já que o próprio site agora serve `data/`. Isso mudou a instrução de "Rodando localmente" em `README.md` (servir da raiz do repo, não de dentro de `frontend/`).
  4. **`/index.html` (redirect) e `/.nojekyll` novos na raiz** — GitHub Pages só serve raiz ou `/docs` (que já é documentação de verdade), nunca `/frontend` como subpasta arbitrária.

  Verificado com `node --check` em todos os arquivos alterados/novos (incluindo os blocos `<script>` embutidos) e com os cinco testes existentes ainda verdes — **25** (`simbolos` — eram 20; ganhou 5 casos na correção abaixo), **40** (`marcacoes`), **64** (`rastro`), **116** (`kml`), **24** (`basemaps`). `backend/testes/valida_sql.py` validou a `0007` (a única migration desta etapa).

  **Correção pós-entrega, achada no teste em campo: "o instrutor vê os dois partidos como azul".** `hostilidadeRelativa()` (`simbolos.js`) tratava qualquer observador sem partido como "preserva o SIDC gravado" — e como o SIDC gravado tem sempre o placeholder AMIGO (`03`), o instrutor (que nunca tem partido) via os dois lados idênticos em `frontend/situacao.js`. Corrigido para usar uma referência fixa (partido de menor `ordem` = "amigo"/azul, os demais = "hostil"/vermelho) só quando o observador não tem partido mas o elemento tem um conhecido — o caso do próprio avatar (observador E elemento nulos) continua preservando o SIDC, sem mudança. Detalhe completo na seção "Decisões da Etapa 11" de `CLAUDE.md`. `backend/scripts/aplicar_migrations.sh` (novo) também saiu desta rodada — um comando (`psql`) para aplicar `0001`-`0007` de uma vez, documentado como "Opção C" em `backend/README.md`.

  **Segunda correção pós-entrega, achada no teste em campo: avatares empilhados quando duas ou mais pessoas ficam fisicamente próximas.** O círculo de precisão do GPS (5-15m) faz coordenadas de pessoas próximas ficarem quase idênticas, e nenhum zoom separa dois pontos que são o mesmo lugar. `frontend/dispersar-avatares.js` (novo, puro/testável, 14 casos) agrupa pontos mais próximos que `raioColisaoM` por proximidade transitiva e os redistribui num círculo determinístico (ordenado por `id`, não por ordem de chegada dos eventos) ao redor do centro do grupo. Integrado em `colegas.js` e `situacao.js`, que passaram a guardar a posição CRUA de cada avatar e recalcular o arranjo a cada mudança. Limitação conhecida: o próprio avatar (`gps.js`) e o replay do `debriefing.js` não entram na dispersão — ver detalhe na seção "Decisões da Etapa 11" de `CLAUDE.md`.

  **Terceira correção pós-entrega, achada no teste em campo: no celular, a topbar cobria o painel de opções do mapa e ocupava boa parte da tela.** Causa: `#side-panel`/`#pl-botao` usavam `position:absolute; top:58px` medido a partir do topo da TELA (não havia ancestral posicionado entre eles e `<body>`) — um valor que só fazia sentido com a topbar numa linha só. No celular, `#status-bar` quebrava em várias linhas (`flex-wrap`) e a topbar real passava fácil de 58px, enterrando o painel/botão por baixo dela. Corrigido estruturalmente: `#side-panel` virou filho de `#mapa-wrap` (que já tem `position:relative` e só começa depois da topbar, de qualquer altura), então `top:10px` vale sempre a partir do fim real dela. A topbar também ganhou colapso próprio: os itens de diagnóstico (contadores + 5 status) viraram `#status-detalhes`, oculto por padrão abaixo de `LARGURA_PAINEL_ABERTO` (mesmo critério do painel, reaproveitado de `painel-lateral.js`), com um botão (`#status-toggle`) para abrir — `#user-bar` (turma/nome/Sair) ficou de fora do grupo colapsável de propósito. Detalhe completo na seção "Decisões da Etapa 11" de `CLAUDE.md`.

  **Pendente de teste ao vivo — e aqui, ao contrário de todas as etapas anteriores, é a verificação que fecha a etapa, não um adendo**: habilitar o GitHub Pages no repositório (passo manual), aplicar a `0007`, trocar `codigo_acesso` da turma de teste para algo não adivinhável (passo manual — deixar `'TESTE'` derrota o propósito do item 2), rodar `criar_usuarios.mjs` para a conta do instrutor, e então **abrir o site publicado no celular** — cadastro com código funcionando, BDGEx desenhando (fecha a pendência da 7.1), avatares próximos se separando, topbar colapsada/painel acessível, e todo o roteiro acumulado desde a Etapa 3 em `docs/roteiro-teste-campo.md` (novo).

## A fazer, em ordem

- [ ] **Etapa 2 — Autenticação e papéis** *(em andamento — dividida em 2a e 2b)*

  - [x] **2a.1 — Projeto Supabase no ar.** Projeto criado (região sa-east-1), extensões `postgis` e `pgcrypto` habilitadas, migrations `0001` e `0002` aplicadas pelo SQL Editor e verificadas: 8 tabelas, 8 com RLS, 22 políticas, 16 permissões no catálogo. Confirmação de e-mail desligada, para permitir e-mails fictícios em campo.
  - [x] **2b — Tela de login e roteamento por papel.** `frontend/login.html` com cadastro e login por *usuário* + senha (o domínio `@wartool.local` é acrescentado pelo código em `frontend/auth.js`; o usuário nunca digita e-mail nem vê a palavra "e-mail"). Cadastro pede também o nome de guerra (grava em `perfis.nome_guerra`) e entra automaticamente na turma `TESTE` via RPC `entrar_na_turma` de verdade. Sessão persiste ao recarregar (supabase-js guarda o token no navegador), papel é lido de `perfis.papel` e direciona para `frontend/index.html` (aluno) ou `frontend/instrutor.html` (esqueleto do painel, completo na Etapa 6). Logout, sessão expirada, usuário sem turma e usuário/senha inválidos tratados com mensagens em PT-BR. `frontend/config.js` (gitignored) + `config.example.js` (modelo) para a Project URL/anon key.
  - [ ] **2c — Seed dos usuários do exercício** *(adiada por decisão de escopo — só antes do exercício real)*. Script que lê `backend/seed/usuarios_exercicio.csv` e cria as contas via Admin API, já com papel, turma, nome de guerra e SIDC. O CSV modelo e a documentação já existem em `backend/seed/`. Enquanto isso, o cadastro é aberto e o símbolo de cada um fica no padrão do schema.

  Complexidade: média. Modelo sugerido: intermediário.

- [ ] **Etapa 6.5 — Hierarquia ORBAT e escopo por unidade** *(adiada por decisão de escopo; a Etapa 4.5 já deixou a porta aberta)*

  Comandantes em níveis diferentes verem recortes diferentes do exercício, sem poluir a tela: Cmt de Bda vê a Bda inteira, Cmt de Pel vê só o Pel.

  - **`unidades` como árvore** (`unidade_pai_id`, escalão, partido), `perfis.unidade_id`, e escopo padrão "própria unidade + subordinadas" com override do instrutor — mesma lógica de precedência de `vw_permissoes_efetivas`.
  - **Só muda o corpo de `fn_usuarios_visiveis()`**, criada na Etapa 4.5 (`backend/supabase/0003_partidos.sql`, seção 5 — o comentário lá lista as três invariantes que o corpo novo precisa manter). As policies não são reescritas. Depois de trocar o corpo, rodar `backend/testes/01_teste_partidos.sql`: é ele que diz se as policies continuam valendo o que valiam.
  - **Ponto de atenção de desempenho:** essa consulta roda dentro de policy de RLS, ou seja, em toda leitura de posição. Com 60 usuários mandando GPS a cada poucos segundos, recursão linha a linha vira gargalo. Materializar o caminho de cada unidade (`ltree` ou coluna de path) em vez de recursar.
  - **Importação via [ORBAT Mapper](https://orbat-mapper.app/text-to-orbat)**: usa a mesma `milsymbol` e o mesmo APP-6D de 20 dígitos do projeto, e exporta GeoJSON/KML/XLSX/CSV. Montar a hierarquia em texto indentado lá e importar é melhor do que digitar SQL.

  Complexidade: alta. Modelo sugerido: mais forte.

- [x] **Etapa 6 — Painel do instrutor** *(6a, 6b e 6c concluídas — ver a seção "Feito", acima)*

- [x] **Etapa 7 — Upload de KML/KMZ com opacidade** *(concluída — ver a seção "Feito", acima)*

- [ ] **Etapa 8a — Mapa offline: salvar uma área para quando a rede oscilar** *(redefinida em 2026-07-31 — ver abaixo)*

  **A Etapa 8 era "upload de imagem georreferenciada" e foi trocada, a pedido, por CACHE OFFLINE.** O motivo é o uso real: o projeto sempre assumiu "campo com rede de dados disponível", e a rede de campo não cai — ela **oscila**. Um app que fica sem carta no meio do exercício por trinta segundos é pior do que um app que nunca teve foto aérea. O upload de imagem não sumiu; virou a 8b, menor e só para o instrutor.

  **A ideia:** o usuário desenha um retângulo no mapa, escolhe até que zoom, vê **quantos tiles e quantos MB** aquilo dá **antes** de baixar, e confirma. Dali em diante aquela área abre sem rede.

  **Decisões que a etapa precisa tomar, e que são o trabalho de verdade:**
  - **Service Worker + Cache API, e não `fetch` + IndexedDB.** O Leaflet pede tile como `<img src>`; para servir offline é preciso interceptar. A diferença decisiva é CORS: com `fetch()` cross-origin sem CORS a resposta é *opaque* e não dá para ler os bytes — e não há como saber se o BDGEx manda `Access-Control-Allow-Origin`. Um Service Worker guarda a resposta opaca no Cache API e devolve ao `<img>` sem precisar lê-la. **Custo:** o Chrome infla a cota de resposta opaca (padding), então a estimativa de MB na tela vai ser otimista — dizer isso ao usuário faz parte.
  - **Isso exige HTTPS.** Service Worker só roda em contexto seguro (`localhost` é a exceção). É a mesma restrição já documentada para o GPS desde a Etapa 3 — **e é o motivo de a Etapa 11 (deploy) ter sido antecipada para antes desta, e já está concluída**: com o site em https no GitHub Pages, esta etapa passa a ser testável de verdade no celular.
  - **Só o BDGEx, provavelmente.** Baixar tile em massa viola os termos de uso da maioria dos serviços — o Google **proíbe explicitamente** cache e pré-carga, e o OpenTopoMap desencoraja download em bloco. O BDGEx é serviço do próprio Exército e é a carta que importa. Decidir se as outras opções ficam de fora, e dizer na tela por quê.
  - **Ser educado com o servidor.** Uma área média em vários zooms são milhares de tiles; 60 celulares fazendo isso ao mesmo tempo é um ataque involuntário à Diretoria de Serviço Geográfico. Limite de concorrência, pausa entre lotes, e um teto de tiles que o usuário não consegue passar.
  - **A matemática é pura e testável** (padrão de `rastro.js`/`kml.js`): contagem de tiles de um bbox por nível de zoom (cresce 4× por nível — é a conta que impede alguém pedir o Brasil inteiro em z16), estimativa de bytes, e o corte de zoom máximo.

  Complexidade: média-alta. Modelo sugerido: intermediário a forte.

- [ ] **Etapa 8b — Foto aérea / carta atualizada, publicada pelo instrutor** *(o que sobrou da Etapa 8 original)*

  Só o instrutor publica, como já é com os calcos KML/KMZ. Herda quase tudo da Etapa 7:
  - **Opacidade e ordenação já funcionam** por `pane` do Leaflet (`FAIXAS_PANE` em `frontend/kml.js`) — o mecanismo foi escolhido na 7 justamente por servir raster igual a vetor: um `L.imageOverlay` num pane herda opacidade e z-index sem código novo.
  - **A tabela `calcos` e o bucket já são "arquivo publicado pelo instrutor", não "KML"**: `formato` é um `check` de texto, e acrescentar um valor é uma linha.
  - **Duas decisões pendentes:** (a) como georreferenciar — GeoTIFF exige biblioteca pesada no navegador; imagem + *world file*, ou o instrutor arrastando os cantos no mapa, são bem mais baratos; (b) o **tamanho**, que é o problema real — a conta de egress da `0006` (2 MB × 60 alunos) não sobrevive a uma ortofoto, então ou entra tiling, ou muda o plano do Supabase, ou a imagem é distribuída pelo cache da 8a em vez de baixada por todo mundo.
  - **`carregar_imagem_geo` é a última chave "sem efeito ainda"** do catálogo, e é esta etapa que a liga.

  Complexidade: média. Modelo sugerido: intermediário.

- [ ] **Etapa 9 — Migração para SPA com bundler + stanag-app6**
  Trocar o HTML estático por uma aplicação com Vite/webpack, e substituir as tabelas manuais de hostilidade/dimensão/natureza pelas tabelas oficiais do `stanag-app6`. Mudança estrutural, mexe em tudo. Melhor fazer depois que as etapas 1-8 já estiverem estáveis. Complexidade: alta. Modelo sugerido: mais forte.

- [ ] **Etapa 10 — Teste de carga (60+ usuários) e ajuste de plano**
  Simular múltiplos usuários simultâneos, medir, decidir se precisa migrar do Supabase Free para o Pro. Complexidade: média (mais QA que desenvolvimento). Modelo sugerido: leve a intermediário.


- [ ] **Etapa 12 — Controle de início/fim do exercício (STARTEX/ENDEX)**
  *Nova, proposta e aprovada em 2026-07-31 (brainstorm de capacidades do instrutor ainda não previstas).*

  Hoje o instrutor tem que lembrar/adivinhar a janela de tempo na aba de Debriefing (6b) toda vez que quer analisar "o exercício de hoje". Um botão de início/fim carimba isso uma vez e a tela de debriefing passa a oferecer "este exercício" como preset, em vez de só "última hora"/"últimas 3 horas".

  - **Decisão a tomar na etapa: turma ≠ exercício.** Uma turma (`turmas`, ex.: `TESTE`) pode rodar vários exercícios ao longo do tempo — carimbar `iniciado_em`/`encerrado_em` direto em `turmas` perderia o histórico do exercício anterior a cada novo STARTEX. O caminho mais correto é uma tabela nova `exercicios` (`turma_id`, `iniciado_em`, `encerrado_em` nulo enquanto em andamento, `iniciado_por`), no mesmo padrão de auditoria de `elementos_marcados`/`permissoes_*` (quem fez, quando). `debriefing.js` ganharia um seletor "qual exercício" além do preset de horas.
  - RLS: escrita só pelo instrutor da turma (`fn_sou_instrutor_da_turma`, mesmo padrão de `elementos_editar_instrutor`); leitura para quem já lê a turma.
  - Não precisa travar nada tecnicamente enquanto o exercício está "parado" (fora do escopo desta etapa impedir GPS/marcação fora da janela) — é só um carimbo para orientar a análise depois, não uma trava de acesso.

  Complexidade: baixa-média. Modelo sugerido: leve.

- [ ] **Etapa 13 — Marcar baixa/status de combate (KIA/WIA)**
  *Nova, proposta e aprovada em 2026-07-31.*

  Complementa a Etapa 6c: hoje o instrutor só pode apagar a posição de um aluno (fantasma) — não existe meio-termo para "ele continua no exercício, mas está fora de combate". Uma coluna nova em `perfis` (`status_combate`, provavelmente enum `ativo`/`ferido`/`baixa`, padrão `ativo`), editável pelo instrutor pela mesma policy que já cobre `partido_id` (`perfis_editar_instrutor`, 0002, com `fn_proteger_campos_do_perfil` estendida).

  - **Decisão a tomar na etapa: como isso aparece no símbolo.** O SIDC de 20 dígitos já está com todos os campos ocupados (hostilidade/dimensão/situação/hqtf/escalão/natureza) — não sobra dígito livre para o "Operational Condition Amplifier" do APP-6D (danificado/destruído) sem redesenhar o formato do `check` em `perfis`/`elementos_marcados`. Duas saídas possíveis: (a) reaproveitar o dígito de "situação" (hoje só usado para confirmada/estimada) para também significar dano, ou (b) um overlay visual próprio no ícone (ex.: um X vermelho desenhado por cima em `criarIconeSimbolo()`, sem mexer no SIDC). A opção (b) é mais simples e não arrisca a `check` constraint existente nem o par `getSIDC()`/`decomporSidc()` — decidir com calma no início da etapa, não no meio.
  - Efeito esperado: ícone visualmente diferente em `situacao.js`/`colegas.js`, e provavelmente suspensão automática de `enviar_posicao_gps`/`criar_marcacao_inimiga` para quem está "baixa" (a discutir se é automático ou manual).

  Complexidade: média. Modelo sugerido: intermediário.

- [ ] **Etapa 14 — Injetos de exercício (eventos simulados pelo instrutor)**
  *Nova, proposta e aprovada em 2026-07-31.*

  O equivalente digital do injeto verbal do observador-controlador: o instrutor dispara um evento cenográfico ("contato inimigo", "ataque químico simulado", "MEDEVAC solicitado") que chega ao(s) aluno(s) certo(s) em tempo real.

  - Tabela nova `eventos_exercicio` (`turma_id`, `partido_id` nulo = turma inteira, `tipo`, `mensagem`, `latitude`/`longitude` nulos se não for geolocalizado, `criado_por`, `criado_em`). Publicada no Realtime, mesmo padrão de `elementos_marcados`.
  - RLS de leitura: turma inteira quando `partido_id` é nulo, ou só quem está naquele partido — mais simples que `fn_usuarios_visiveis()` (que é amarrada a autor, não a destinatário; o precedente correto aqui é `calcos_ler`/`calcos.partido_id`, da Etapa 7, que já resolve exatamente esse formato de "para quem é isto"). Escrita só pelo instrutor da turma.
  - Frontend: painel de disparo na aba "Situação atual" (`situacao.js`) ou aba própria; no app do aluno, um toast/banner (novo — não existe hoje um canal de notificação "empurrada" que não seja mudança de estado de dado).
  - Dá a base de dados para a Etapa 15 (log) e a Etapa 18 (geocerca) usarem o mesmo mecanismo de "avisar alguém de algo que aconteceu".

  Complexidade: média. Modelo sugerido: intermediário.

- [ ] **Etapa 15 — Log de eventos do exercício (para debriefing/AAR)**
  *Nova, proposta e aprovada em 2026-07-31.*

  Diferente do replay geoespacial da Etapa 6b, isto é uma linha do tempo TEXTUAL do que aconteceu: entradas na turma, trocas de força, marcações criadas/removidas, permissões alteradas, injetos (Etapa 14). Boa parte do dado já existe (`removida_por`/`removida_em` em `elementos_marcados`, `definida_por`/`atualizado_em` em `permissoes_*`) e nunca é mostrado numa tela — só usado para auditoria manual via SQL.

  - Melhor como uma `view` que une essas fontes por `turma_id` e ordena por timestamp, no espírito de `vw_permissoes_efetivas` (a lógica de juntar fica no banco, não replicada em JavaScript). Leitura só pelo instrutor da turma.
  - Interface simples: lista rolável, provavelmente dentro da aba de Debriefing (6b) ou uma aba nova pequena — não precisa de mapa.
  - Mais valiosa depois da Etapa 14 existir (dá o que logar de "aconteceu algo"), mas não depende dela para começar — os dados de permissão/marcação já sustentam uma primeira versão.

  Complexidade: média (SQL de junção + lista simples). Modelo sugerido: intermediário.

- [ ] **Etapa 16 — Múltiplos instrutores/observadores com escopo parcial por turma**
  *Nova, proposta e aprovada em 2026-07-31.*

  Hoje `instrutor` é um papel monolítico: quem tem esse papel numa turma vê a turma inteira, os dois partidos. Num exercício maior faz sentido ter vários observadores-controladores, cada um só acompanhando um setor/unidade (ex.: um O/C por Pelotão).

  - **Decisão a tomar: isto é essencialmente a mesma pergunta da Etapa 6.5 (hierarquia ORBAT), só aplicada ao papel de instrutor em vez de ao aluno.** Não faz sentido desenhar escopo por unidade duas vezes com regras diferentes — o correto é decidir esta etapa JUNTO com a 6.5, ou logo depois dela, reaproveitando `unidades`/`perfis.unidade_id` e o mesmo `fn_usuarios_visiveis()` (ou uma variante para instrutor com escopo, `fn_usuarios_visiveis_instrutor()`) em vez de inventar uma segunda árvore de permissão.
  - Sem a 6.5 aplicada, a única forma de fazer isso hoje seria gambiarra (múltiplas turmas fingindo ser unidades) — não vale o risco.

  Complexidade: alta (desenho de RLS por hierarquia). Modelo sugerido: mais forte. **Depende da Etapa 6.5.**

- [ ] **Etapa 17 — Exportar relatório do exercício**
  *Nova, proposta e aprovada em 2026-07-31.*

  PDF ou CSV pós-exercício: participantes, distância percorrida por aluno (`distanciaTrilhaM()` já existe em `frontend/rastro.js`), marcações feitas, timeline de permissões (Etapa 15, se já existir).

  - Provavelmente geração no NAVEGADOR (sem backend novo), reaproveitando `fn_rastro_historico` (0005) e as consultas que `debriefing.js`/instrutor-permissoes.js já fazem — é montar o documento a partir de dado que já chega ao cliente, não uma nova fonte de dado.
  - Mais rico se a Etapa 15 (log) já existir, mas o relatório básico (rastro + marcações) não depende dela.

  Complexidade: média. Modelo sugerido: intermediário.

- [ ] **Etapa 18 — Geocerca com alerta**
  *Nova, proposta e aprovada em 2026-07-31.*

  Fecha uma promessa em aberto desde a Etapa 1: a coluna `geom geography(Point,4326)` em `posicoes_atuais` foi reservada "para consultas espaciais futuras (geocerca, proximidade)" e nunca foi usada. O instrutor desenha um limite de área no mapa (Etapa 6c, `situacao.js`) e é avisado quando alguém cruza.

  - Tabela nova `geocercas` (`turma_id`, `nome`, `poligono geography(Polygon,4326)`, `ativo`), mesma RLS de escrita restrita ao instrutor da turma que as demais tabelas de configuração.
  - **Decisão a tomar: checagem no banco ou no cliente.** Checar no Postgres (`ST_Contains`/`ST_Within` num trigger de `posicoes_atuais`, ou numa função chamada periodicamente) é mais robusto mas mais trabalho; checar no navegador com `turf.js` sobre o que `situacao.js` já recebe pelo Realtime é mais simples e provavelmente suficiente para uso de instrução (mesmo espírito da "permissão não é barreira de segurança" já registrado no projeto — aqui o alerta é operacional, não uma trava).
  - O alerta em si pode reaproveitar a Etapa 14 (`eventos_exercicio`) em vez de inventar um canal de notificação novo.

  Complexidade: alta (geometria + decisão de onde checar). Modelo sugerido: mais forte. **Aproveita bem se vier depois da Etapa 14.**

## Como abrir cada etapa

No início do chat, algo como:

> Lê o CLAUDE.md e o docs/ROADMAP.md do projeto. Vamos trabalhar na Etapa 3.

Ao terminar uma etapa, marque o checkbox aqui no ROADMAP.md (ou peça para eu marcar) e, se algo relevante mudou de arquitetura/decisão, atualize também o CLAUDE.md — é isso que mantém o próximo chat com o contexto certo sem precisar reler tudo.
