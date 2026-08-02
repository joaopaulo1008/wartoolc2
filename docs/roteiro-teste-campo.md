# Roteiro de teste em campo — Etapa 11 e pendências acumuladas (Etapas 3-7.1)

Este roteiro é a entrega mais valiosa da Etapa 11: várias coisas nunca puderam ser testadas de verdade porque exigiam HTTPS num domínio (não em `localhost`) e mais de um celular ao mesmo tempo. Agora dá para testar tudo isso de uma vez.

**Formato de cada item:** o que fazer → o que esperar → como saber que falhou. Quando algo falhar, anote o item e continue para o próximo — não vale a pena parar o teste inteiro por um item quebrado.

## 0. Antes de ir a campo

Sem isto pronto, nenhum item abaixo funciona:

1. **GitHub Pages publicando via Actions.** ~~Deploy from branch → `main` / `/ (root)`~~ — **isto mudou na Etapa 9a**: com o Vite, o que precisa ser publicado é `dist/`, não a raiz do repo. Settings → Pages → Source = **"GitHub Actions"**. Confirmado funcionando em 2026-08-02 (o workflow roda em ~35 s por push). URL: `https://joaopaulo1008.github.io/wartoolc2/`.

   **Confira que o site no ar é o build atual antes de sair**: abra a URL, F12 → aba Network, e veja se os arquivos em `/wartoolc2/assets/` têm o mesmo hash do último `npm run build` local. Um push que falhou no Actions deixa o site anterior no ar, sem erro visível.
2. **Migrations aplicadas** no SQL Editor do Supabase: `0001`-`0003` (desde etapas anteriores), `0004_perfis_realtime.sql`, `0005_rastro_historico.sql`, `0006_calcos.sql`, `0007_codigo_turma_valido.sql`, `0008_imagem_geo.sql` e **`0009_auditoria_edicao_e_preferencias.sql`** (Etapa 9b).

   A `0009` é a única cujo efeito não aparece sozinho na tela — se ela faltar (ou se só parte dela for colada), o app funciona normalmente e apenas a linha "Corrigido por …" nunca aparece no popup, o que é indistinguível de "o instrutor não corrigiu nada". Vale confirmar, é uma consulta só:
   ```sql
   select
     (select count(*) from information_schema.columns
       where table_schema='public' and table_name='elementos_marcados'
         and column_name in ('editada_em','editada_por'))            as colunas,   -- esperado 2
     (select count(*) from pg_trigger
       where tgrelid='public.elementos_marcados'::regclass
         and tgname='trg_elementos_carimbar_edicao')                 as trigger_,  -- esperado 1
     (select count(*) from pg_constraint
       where conrelid='public.perfis'::regclass
         and conname='perfis_formato_coordenada_valido')             as constraint_; -- esperado 1
   ```
3. **`codigo_acesso` da turma de teste trocado para algo não adivinhável.** O cadastro continua aberto (qualquer um cria usuário/senha em `login.html`), mas exige esse código para entrar em turma — deixá-lo como `'TESTE'` (ou qualquer coisa óbvia) derrota o propósito. No SQL Editor:
   ```sql
   update public.turmas set codigo_acesso = 'algo-que-só-a-turma-sabe' where nome = '...';
   ```
   Esse código é o que você distribui verbalmente/por escrito para os participantes reais do teste — é a "senha do exercício".
4. **Conta do instrutor criada** via `backend/seed/criar_usuarios.mjs` (ver `backend/seed/README.md`) — o cadastro aberto de `login.html` só cria papel `usuario`, nunca `instrutor`.
5. **Contas de aluno**: pode ser pelo cadastro aberto mesmo (com o código do item 3), durante o próprio teste — é inclusive uma forma de validar o fluxo. Para os itens de hostilidade relativa (item 4 abaixo) você precisa de **pelo menos 4 contas de aluno**:
   - 2 contas no partido Azul
   - 2 contas no partido Vermelho (uma delas, "Vermelho-2", só é usada no item 9 — pode ser a mesma conta do item 4)
6. **Forças distribuídas**: no painel do instrutor (aba "Permissões e forças"), coloque as 4 contas de aluno em Azul/Vermelho conforme o item 5. Lembre: partido nulo é restritivo — um aluno sem força não vê ninguém, nem é visto.
7. **Celulares**: pelo menos 2, idealmente 3-4 (dá para revezar contas entre 2 aparelhos se faltar celular, só um pouco mais lento).
8. Tenha o **painel do instrutor aberto num notebook/tablet** à parte — vários itens abaixo pedem uma ação do instrutor enquanto se observa o celular do aluno.

### Duas coisas que vão parecer bug em campo e não são

Anote antes de sair, para não gastar tempo diagnosticando o que já é conhecido:

- **Aluno recém-cadastrado não vê ninguém e não é visto.** É o comportamento correto: partido nulo é restritivo por decisão da Etapa 4.5. Some assim que o instrutor o coloca numa força (item 6 acima). Se alguém chegar atrasado e se cadastrar no meio do exercício, **alguém tem que lembrar de distribuir a força dele** — não há aviso automático.
- **O BDGEx pode "sumir" ao mudar de zoom, com o OpenTopoMap aparecendo por baixo.** É a mitigação de 2026-08-01, não uma falha nova. A causa (o `mapcache` servir só as grades que tem em cache) só é resolvida na etapa própria já registrada no ROADMAP — que **não** foi feita de propósito antes deste teste, para não mexer na camada mais crítica do app às vésperas dele. Se acontecer, anote **em que zoom** e siga.

## 1. O cadastro exige o código certo (novo — fecha a revisão da decisão 2)

**Fazer:** num celular, abrir `login.html`, ir na aba Cadastrar, preencher usuário/nome/senha e digitar um código **errado** de propósito. Depois repetir com o código **certo** (o que você trocou no item 0.3).

**Esperar:** com o código errado, a tela mostra "Código de turma inválido..." **sem criar a conta** (é `fn_codigo_turma_valido()` barrando antes do `signUp()`). Com o código certo, a conta é criada e a pessoa já entra direto na turma — vai para `index.html`, mas sem ver colegas ainda (precisa de partido, item 0.6).

**Como saber que falhou:** o código errado deixa criar a conta mesmo assim → confira se a `0007` foi realmente aplicada e se `login.html`/`auth.js` estão na versão nova (o `cad-codigo` precisa existir no formulário).

## 2. O site abre e o BDGEx desenha (fecha a pendência da 7.1)

**Fazer:** abrir a URL do GitHub Pages num celular (dados móveis, não Wi-Fi da mesma rede do notebook — é o teste que a Etapa 3 nunca conseguiu fazer). Fazer login com uma conta de aluno. Com o mapa base em BDGEx (é o padrão), afastar e aproximar o zoom algumas vezes.

**Esperar:** a tela de login abre em HTTPS (cadeado no navegador), login funciona, o mapa aparece com a carta topográfica do Exército (tons de bege/verde, curvas de nível, estradas) — não um mapa em branco. Ao mudar o zoom, o nível de detalhe muda (a `ctmmultiescalas_mercator` troca de escala).

**Como saber que falhou:**
- Mapa branco/cinza no lugar do BDGEx → o `bdgex.eb.mil.br/mapcache` não respondeu em https. Abra o DevTools remoto do celular (ou teste o mesmo mapa base num desktop) e veja se a requisição do tile deu erro de certificado/CORS/timeout. Se for isso, o caminho é um proxy reverso próprio (não existe "voltar para http" numa página https) — não é algo para resolver no celular, é infraestrutura nova.
- Zoom não muda nada visualmente → confirme que está de fato no BDGEx (não trocou sem querer para outro mapa base) antes de concluir que é bug.

## 3. Dois celulares vendo a posição um do outro (Etapas 3 e 4)

**Fazer:** dois celulares, duas contas de aluno do MESMO partido, ao ar livre (GPS de smartphone não funciona bem indoor), a uma distância que dê para conferir a olho nu (ex.: nas duas pontas de um estacionamento). Logar nos dois, deixar o app aberto uns 30-60s.

**Esperar:** cada celular mostra o próprio avatar (símbolo AMIGO com o SIDC do perfil) e o avatar do colega aparecendo na posição real dele, com nome de guerra. Andando, os dois avatares se movem em tempo real (sem precisar recarregar).

**Como saber que falhou:** um dos dois não aparece no aparelho do outro → confira primeiro se os dois estão na mesma turma e com partido atribuído (partido nulo é invisível para todo mundo, por design — não é bug). Se os dois têm partido e turma certos e mesmo assim não aparecem, é a pendência real desde a Etapa 4: confira o console do navegador (erro de subscribe no canal Realtime).

## 4. Hostilidade relativa nas marcações e nos avatares (Etapas 4.5, 5 e correção da 11)

Três testes distintos — fazer os três, são complementares:

**4c. Instrutor vê as duas forças com cores diferentes (regressão corrigida na Etapa 11).** Com pelo menos um aluno do Azul e um do Vermelho enviando posição, abra "Situação atual" no painel do instrutor.

**Esperar:** o avatar do aluno Azul desenha AMIGO (azul) e o do Vermelho desenha HOSTIL (vermelho) — **cores diferentes entre os dois**. Antes da correção, os dois apareciam idênticos (ambos azuis), porque o instrutor nunca tem partido próprio e a função de hostilidade relativa não sabia o que fazer com isso.

**Como saber que falhou:** os dois avatares aparecem com o mesmo símbolo/cor → confira se `frontend/auth.js` está na versão com `ordem` no embed de `partido:partidos(...)` (`buscarUsuariosDaTurma`) e se `frontend/simbolos.js` tem o bloco "Observador sem partido, mas o ELEMENTO tem um conhecido" em `hostilidadeRelativa()`.

**4a. Mesmo partido (o teste que prova a hostilidade relativa):** duas contas do mesmo partido (ex.: Azul-1 e Azul-2). Na conta Azul-1, marque um elemento no mapa escolhendo partido "Azul" (o próprio). Na mesma conta, marque outro elemento escolhendo partido "Vermelho".

**Esperar:** na tela de Azul-2 (que enxerga as marcações de Azul-1, mesmo partido), o primeiro elemento aparece com símbolo AMIGO (azul) e o segundo com símbolo HOSTIL (vermelho) — a MESMA lógica de hostilidade relativa que já era válida no COP legado, agora provada com duas contas reais.

**Como saber que falhou:** os dois elementos aparecem com a mesma cor/hostilidade, ou nenhum aparece → primeiro confirme que Azul-2 realmente está vendo Azul-1 (RLS é amarrada ao autor via `fn_usuarios_visiveis()`); se a visibilidade estiver ok e a cor não mudar, o problema é em `hostilidadeRelativa()`/`sidcParaObservador()`.

**4b. Partidos diferentes (prova que a marcação NÃO vaza — comportamento esperado, não bug):** na conta Azul-1, marque um elemento qualquer. Na conta Vermelho-1, olhe o mapa.

**Esperar:** Vermelho-1 **não vê** a marcação feita por Azul-1. Isso é o comportamento correto e documentado (a visibilidade de `elementos_marcados` é amarrada ao autor, não ao partido do elemento marcado) — **não confundir com falha**.

**Como saber que é falha de verdade:** se Vermelho-1 estivesse vendo a marcação de Azul-1, aí sim seria um vazamento de RLS — o oposto do que este item testa.

## 5. Instrutor desliga `enviar_posicao_gps` sem F5

**Fazer:** com um aluno logado e enviando posição, o instrutor, no painel (aba Permissões), desliga a chave `enviar_posicao_gps` para aquele aluno (ou para a turma toda).

**Esperar:** o `#gps-status` no topo da tela do aluno muda para refletir que o envio foi desligado, **sem precisar recarregar a página**. O avatar do aluno para de se mover no mapa dos colegas (mas o aluno continua vendo a própria posição local, se `ver_propria_posicao` estiver ligada — são duas chaves separadas).

**Como saber que falhou:** o status não muda até um F5 manual → confira se o painel realmente gravou a mudança (releitura de `vw_permissoes_efetivas` no instrutor) e se o canal Realtime de `permissoes_turma`/`permissoes_usuario` está assinado no aluno (console do navegador).

## 6. "Voltar ao padrão da turma" — o caso mais incerto de todos

Por que é o mais incerto: o Realtime não aplica RLS a eventos `DELETE`, só o filtro de coluna — a assinatura depende do `REPLICA IDENTITY FULL` trazer o `usuario_id` da linha apagada para o filtro casar. Se algo não propagar, é aqui.

**Fazer:** dê um override individual a um aluno numa chave qualquer (ex.: desligue `ver_posicao_outros` só para ele, via painel). Confirme que o efeito aparece no aparelho dele. Depois, no painel, clique **"Voltar ao padrão da turma"** para aquela chave/aluno.

**Esperar:** o aparelho do aluno reage **sem F5** — a chave volta ao valor herdado da turma (ou do catálogo).

**Como saber que falhou:** o aparelho do aluno só reflete a mudança depois de um F5 manual. Este é o item mais provável de expor um problema real — se falhar, é o primeiro a reportar em detalhe (qual chave, qual navegador, tinha console aberto ou não).

## 7. Instrutor troca a força de um aluno → recarrega sozinho

**Fazer:** com o `0004` aplicada e um aluno com o app aberto, o instrutor troca o partido dele (ex.: de Azul para Vermelho) no painel.

**Esperar:** o app do aluno mostra um aviso por ~3s e recarrega sozinho (`location.reload()`, deliberado — ver CLAUDE.md, Etapa 6a). Depois de recarregar, ele enxerga o mapa como o novo partido (hostilidade invertida em relação a antes).

**Como saber que falhou:** nada acontece no aparelho do aluno → confira se `0004_perfis_realtime.sql` foi de fato aplicada (`perfis` publicada no Realtime) e se `perfil-ao-vivo.js` está assinando a própria linha.

## 8. Debriefing — histórico/replay (Etapa 6b, migration 0005)

**8a. `security invoker`, no SQL Editor do Supabase:**
```sql
select prosecdef from pg_proc where proname = 'fn_rastro_historico';
```
**Esperar:** `false`. Se vier `true`, alguém trocou a função para `definer` e a RLS do histórico deixou de valer — corrigir antes de qualquer outra coisa desta seção.

**8b. Índice usado, no SQL Editor:**
```sql
explain analyze select * from fn_rastro_historico(
  array['<uuid-de-um-aluno>']::uuid[], now() - interval '1 hour', now(), 30
);
```
**Esperar:** o plano usa `idx_hist_usuario_tempo`. Se aparecer um *sequential scan* na tabela inteira, o índice não está sendo usado — problema de performance a investigar antes de um exercício de verdade com volume.

**8c. Isolamento entre alunos — o teste de segurança da etapa.** Pegue o **token de acesso de um aluno** (DevTools → Application → Local Storage → chave do supabase, ou log de `session.access_token` no console) e chame a RPC via `curl`/Postman com esse token, passando o **UUID de outro aluno**:
```
POST https://xfqiwlnzvqoaxabpkgss.supabase.co/rest/v1/rpc/fn_rastro_historico
apikey: <a publishable key, de frontend/config.js>
Authorization: Bearer <token do aluno>
Content-Type: application/json

{"p_usuarios": ["<uuid-do-COLEGA>"], "p_desde": "...", "p_ate": "...", "p_intervalo_segundos": 30}
```
**Esperar:** a resposta volta **vazia** (ou só com o próprio rastro, se `p_usuarios` misturar o próprio UUID com o do colega) — nunca o rastro do colega.

**Como saber que falhou:** a resposta traz o rastro do colega → a policy `historico_ler` não está sendo respeitada dentro da função (contradiz o item 8a — revisar os dois juntos).

**8d. Legibilidade do replay:** com pelo menos um aluno tendo se movido de verdade (item 3), abra o Debriefing, selecione-o, busque a última hora e reproduza. **Esperar:** o replay anda de forma legível (cadência de ~30s suavizada por interpolação, sem "teleporte"). Se o celular ficou parado tempo suficiente para simular perda de sinal (>60-120s sem atualizar), o replay deve **parar e esmaecer** no último ponto, não desenhar uma linha reta até o próximo.

## 9. Calcos KML/KMZ (Etapa 7, migration 0006)

**9a. Bucket privado, no SQL Editor:**
```sql
select public from storage.buckets where id = 'calcos';
```
**Esperar:** `false`. Se vier `true`, o bucket é público — qualquer um baixa qualquer calco por URL adivinhável, sem passar pela RLS, e isso anula o item 9c abaixo.

**9b. Publicação em tempo real:** instrutor publica um calco (categoria "Manobra", por exemplo) com o app de um aluno aberto e na tela.

**Esperar:** o calco aparece no mapa do aluno **sem F5**. Remover o calco no painel também some da tela do aluno sem F5.

**9c. O teste mais importante desta seção — isolamento do objeto no Storage.** Publique um calco visível **só para o Azul** (`partido_id` do calco = Azul). Pegue o caminho do objeto no Storage (o painel do instrutor mostra, ou consulte `select caminho_objeto from calcos order by criado_em desc limit 1;`). Com o **token de uma conta do Vermelho**, tente baixar esse objeto direto:
```
GET https://xfqiwlnzvqoaxabpkgss.supabase.co/storage/v1/object/calcos/<caminho_objeto>
apikey: <publishable key>
Authorization: Bearer <token do aluno Vermelho>
```
**Esperar:** erro (403/404), não o arquivo.

**Como saber que falhou:** o arquivo é baixado normalmente → a policy `calcos_objeto_ler` não está funcionando como esperado (ela depende de um comportamento do Postgres — tabela referenciada dentro de policy tem as policies dela aplicadas — cujo modo de falha é **aberto**, não fechado; ver CLAUDE.md, Etapa 7). Reportar com prioridade alta.

**9d. `carregar_kml` desligada por padrão:** com um aluno cuja chave `carregar_kml` esteja no padrão (`false`), confira que o botão de carregar arquivo local aparece **desabilitado, com explicação** (não escondido). Ligue a chave no painel — o botão libera sem F5.

## 11. Formato de coordenada — os três, conferidos contra uma referência externa (Etapa 9b)

**Por que este é o item mais fácil de dar errado sem ninguém notar:** UTM depende de acertar a **zona** a partir da longitude. Se a zona sair errada, o par de números continua parecendo perfeitamente plausível — só aponta para umas centenas de quilômetros de distância. Diferente de uma coordenada malformada, isso não "quebra" nada na tela: só mente. O Brasil vai da zona 18 à 25, e boa parte da área de instrução fica **perto de uma fronteira de zona** (o meridiano de 48°W, por exemplo, separa a 22 da 23 e corta Goiás e São Paulo).

**11a. Os três formatos, no próprio avatar.** Com o GPS fixado, abra o cartão **"Coordenada"** no painel lateral e alterne entre **UTM (carta)**, **Grau decimal** e **Grau, minuto, segundo**.

**Esperar:** o popup do próprio avatar muda **na hora**, sem F5 e sem esperar a próxima leitura do GPS (que pode levar até 30s parado). O exemplo abaixo dos rádios ("Centro do mapa: …") muda junto.

**Como saber que falhou:** o popup continua no formato anterior até você se mexer → o observador de formato de `gps.js` não está sendo chamado. **Fique parado de propósito ao testar isto** — é exatamente o caso que o bug esconde.

**11b. UTM contra referência externa — o item que fecha a etapa.** No MESMO ponto, compare o UTM que o app mostra com **duas** fontes independentes:
1. um aplicativo de GPS do celular configurado para UTM/MGRS (a maioria tem essa opção nas configurações de formato de coordenada);
2. a **carta impressa** da área, se houver — é para ela que este formato existe.

**Esperar:** a **zona e a letra da faixa** batem exatamente (ex.: `23K`), e easting/northing batem dentro da precisão do GPS (5–15 m). Anote os valores das três fontes.

**Como saber que falhou:** a zona diverge (`22K` num, `23K` no outro) → **pare e reporte com prioridade alta**, é o modo de falha silencioso descrito acima. Diferença de dezenas de metros com a zona certa é precisão de GPS, não erro de conversão. Diferença de centenas de metros com a zona certa pode ser **datum**: o app usa WGS84 (que é o que o GPS entrega); cartas antigas do EB podem estar em SAD69 ou Córrego Alegre, e aí a diferença é real e esperada — anote qual datum está na legenda da carta.

**11c. Perto de uma fronteira de zona.** Se a área de instrução estiver a menos de ~50 km de um meridiano múltiplo de 6° (48°W, 54°W, 42°W…), ande de um lado para o outro dele e confira que a zona **muda** no app quando deve, e que o easting salta de ~800.000 para ~200.000 (ou o contrário) sem descontinuidade no northing.

**11d. GMS e decimal.** Confira que grau decimal bate dígito a dígito com o que o GPS do celular mostra nativamente, e que o GMS mostra **hemisfério S e W** (não sinal negativo).

**11e. `mE`/`mN` não são hemisfério — leia isto antes de reportar "coordenada errada".** Aconteceu em campo em 2026-08-02: o app mostrou `22J 584770 mE 7223614 mN` e a leitura foi "está errado, estamos a oeste e ao sul, e está escrito E e N".

Não estava errado. Em UTM, `E` e `N` são os nomes dos dois **eixos** da quadrícula — *easting* e *northing* — medidos em metros, e são E e N em qualquer lugar do planeta:

- o **easting** é positivo mesmo no hemisfério oeste porque a origem da zona fica 500 km a oeste do meridiano central (é para isso que existe o "falso este": ninguém tem coordenada negativa);
- o **northing** no hemisfério sul conta a partir de 10.000.000 no equador (o "falso norte"), então `7 223 614` significa `10 000 000 − 7 223 614 = 2 776 386` m **ao sul** do equador ≈ 25,1° S.

**O hemisfério está na letra da faixa.** `J` cobre de 32° S a 24° S. Se fosse norte, a letra seria N, P, Q…

Foi por isso que o app mostra `22J` e não `22 S`: a convenção "22 S" (zona 22, hemisfério sul) colide com a faixa MGRS `S`, que é do hemisfério **norte** — é exatamente o tipo de ambiguidade capaz de fazer alguém plotar do outro lado do mundo.

Para conferir de verdade, use o item 11b: compare com um GPS em UTM e com a carta, e olhe **zona + letra**, não as siglas dos eixos.

## 12. Instrutor corrige a simbologia de um aluno, em campo real (Etapa 9b)

Isto já era possível desde a Etapa 5, mas nunca foi testado ao vivo com o efeito no aparelho do aluno — e o formulário mudou nesta etapa.

**12a.** Com o aluno em campo, peça a ele para marcar um elemento **de propósito com a natureza errada** (ex.: marcar um "Carro de Combate" como "Infantaria"). Confirme que ele consegue navegar o formulário novo no celular: **Categoria → Tipo/natureza** (com os grupos), escalão, modificadores, partido.

**Esperar:** os nomes aparecem em **português oficial** (do Portal de Simbologia Militar), a lista de tipos fica curta porque a categoria já filtrou, e trocar de categoria troca a lista inteira.

**Como saber que falhou:** lista gigante com todos os tipos misturados, ou nomes em inglês → o catálogo não está sendo filtrado por categoria.

**12b.** No painel do instrutor, aba **"Situação atual"**, abra a marcação daquele aluno e clique em **Editar**.

**Esperar:** o formulário abre **já preenchido com o que o aluno escolheu** (categoria, tipo, escalão, modificadores) — não em branco. Corrigir só a natureza e salvar deve ser suficiente.

**Como saber que falhou:** o formulário abre vazio ou na primeira categoria → o pré-preenchimento (`decomporSidc`) não reconheceu o SIDC gravado. Anote o SIDC (aparece no console) para diagnóstico.

**12c.** Com o aparelho do aluno **na mão e sem tocar em nada**, salve a correção no painel.

**Esperar:** o símbolo no mapa do aluno muda **sozinho, em poucos segundos, sem F5**; abrindo o popup, aparece uma linha **"Corrigido por &lt;nome de guerra do instrutor&gt; às HH:MM"**, em amarelo.

**Como saber que falhou:** o símbolo muda mas a linha "Corrigido por" não aparece → o trigger `trg_elementos_carimbar_edicao` (migration `0009`) não foi aplicado, ou `editada_por` veio nulo (o que acontece se a alteração for feita pelo SQL Editor em vez de pela interface — nesse caso é o comportamento correto). Se o símbolo **não** muda, o problema é Realtime, não esta etapa (mesmo diagnóstico do item 5).

**12d.** Peça ao aluno para editar a marcação **dele mesmo**.

**Esperar:** funciona normalmente e **não** aparece "Corrigido por" (o carimbo só aparece quando quem editou é diferente do autor).

## 14. Vetor de observação — distância e azimute até o alvo (2026-08-02)

Novo, e o item com maior chance de gerar uma decisão de projeto a partir do campo. Se houver alguém no papel de **observador avançado / apoio de fogo**, este é o item para ele.

**14a.** Com o GPS fixado, abra o popup de um elemento marcado a alguns quilômetros. Deve aparecer a linha **"Do meu posto"**, no formato `5003 m · 798 mil (44,9°) vd`.

**Esperar:** distância em metro até 10 km e em quilômetro acima disso; azimute em milésimos (padrão OTAN, 6400 por volta) com o grau entre parênteses.

**Como saber que falhou:** a linha não aparece → ou o GPS ainda não fixou, ou o instrutor desligou `ver_propria_posicao` (nesse caso é o comportamento correto: sem posição própria não há de onde medir). No painel do instrutor a linha **nunca** aparece, também por design — ele não tem posto.

**14b. Confira contra o instrumento.** Meça o mesmo alvo com bússola/goniômetro e com telêmetro (ou contra a carta).

**Esperar:** a distância bate dentro da precisão do GPS (5–15 m em cada ponta, então até ~30 m de diferença é esperado).

**Como saber que falhou:** diferença de centenas de metros → reporte com o par de coordenadas.

**14c. O item que decide escopo: QUAL NORTE vocês querem.** O azimute que o app mostra é o **verdadeiro** (norte geográfico) — é o que o sufixo `vd` indica. Compare com o que o observador está acostumado a usar:

- se ele mede na **carta**, ele usa azimute da **quadrícula** — a diferença é a convergência meridiana, que no Brasil chega a **~1,5°, ou ~27 milésimos**, perto da borda de uma zona UTM;
- se ele mede com **bússola**, usa o **magnético** — a diferença é a declinação, que varia com o lugar e com o ano.

**Anote qual dos três ele quer ver na tela** (ou se quer os três). Essa resposta é o que define a próxima etapa do apoio de fogo — hoje o app rotula o norte em vez de converter, exatamente para não entregar um número sem referência.

**14d. Medidas de coordenação, sem código.** Antes do exercício, desenhe as medidas de apoio de fogo (LSA, LFAC, área de fogo livre) no Google Earth, exporte como KML e publique como calco **para o partido da artilharia** (aba de calcos do painel do instrutor). Isso já funciona hoje.

**Esperar:** as medidas aparecem no mapa só para aquele partido, com controle de opacidade.

**Por que este item importa mesmo funcionando:** se o KML resolver na prática, o editor de medidas de coordenação (parte (c) no ROADMAP, a mais cara das três) pode não precisar existir. Anote o que faltou.

## 13. Origem do SIDC quando a Etapa 2c for ativada (Etapa 9b, decisão 3)

**Fazer só quando a Etapa 2c (seed de usuários) sair do adiamento** — hoje não há o que conferir, porque todo mundo entra pelo cadastro aberto e nasce com o símbolo padrão do schema.

**13a.** Rode `backend/seed/criar_usuarios.mjs` com um CSV de teste e confira, para cada linha, que o símbolo que aparece no mapa é o que a planilha pedia (as colunas `dimensao`/`escalao`/`natureza_code`).

**Esperar:** bate. Os aliases legados de `DIMENSAO` (`UNIDADE`, `EQUIPAMENTO`, `INSTALACAO`, `INDIVIDUO`, `AEREO`) foram preservados na Etapa 9b exatamente para isto, e há teste em `marcacoes.teste.mjs` garantindo que produzem os mesmos SIDC de antes.

**Como saber que falhou:** o símbolo do seed difere do que a planilha pedia → conferir se o CSV está usando um valor de `dimensao` que não existe mais. **Atenção ao `AEREO`**: ele vale `05`, que no APP-6D é *espacial*, não aeronave — é um erro antigo, preservado de propósito para não reescrever dados já gravados. Para aeronave de verdade, o valor certo é `AERONAVES` (`01`).

**13b.** Confira que o aluno **não** consegue mudar o próprio símbolo por lugar nenhum da interface (é decisão da etapa: símbolo é atribuição, não preferência).

## 10. Checklist de saída

Depois do teste, reúna:
- [x] Item 1: código errado barrou o cadastro, código certo entrou na turma? **Confirmado em campo, 2026-08-01.**
- [x] Item 2: BDGEx desenhou? Se não, qual erro (certificado, CORS, timeout, tile branco)? **Confirmado em campo, 2026-08-01 — desenha, fecha a pendência que mais importava para abrir a Etapa 8a.**
- [x] Item 3: os dois celulares se viram? **Confirmado em campo, 2026-08-01.**
- [ ] Item 4a/4b: hostilidade relativa correta, marcação não vazou entre partidos?
- [ ] Item 4c: instrutor vê Azul e Vermelho com cores diferentes (não os dois azuis)?
- [ ] Avatares empilhados: com dois ou mais celulares fisicamente próximos (lado a lado), os avatares se separam visualmente no mapa (colegas.js e situacao.js), em vez de ficarem um em cima do outro?
- [ ] Topbar no celular: ao abrir o app numa tela estreita, a topbar mostra só o título + turma/nome/Sair (sem os status de diagnóstico, que ficam atrás do botão "ⓘ"), o botão do painel lateral (☰) aparece visível e clicável (não escondido atrás da topbar), e o painel de opções (Mapa Base/Forças/Camadas) nasce fechado?
- [ ] Item 5: status de GPS mudou sem F5?
- [ ] Item 6: "Voltar ao padrão" propagou sem F5? **(o item mais provável de falhar)**
- [ ] Item 7: troca de força recarregou sozinho?
- [ ] Item 8a-c: `prosecdef = false`, índice usado, isolamento do histórico confirmado?
- [ ] Item 8d: replay legível, com pausa em perda de sinal?
- [ ] Item 9a: bucket privado?
- [ ] Item 9b: calco em tempo real?
- [ ] Item 9c: isolamento do objeto confirmado? **(o outro item de segurança crítico)**
- [ ] Item 9d: `carregar_kml` desligada mostra explicação, liga sem F5?
- [ ] Item 11a: os três formatos trocam sem F5, inclusive **parado** (sem leitura nova de GPS)?
- [ ] Item 11b: **zona UTM** bate com o GPS do celular e com a carta? **(o item silencioso desta etapa)** — anote os três valores e o datum da carta
- [ ] Item 11c: perto de fronteira de zona, a zona muda quando deve?
- [ ] Item 11d: decimal bate com o GPS nativo; GMS mostra S/W em vez de sinal negativo?
- [x] Item 11e: `mE`/`mN` entendidos como eixos, não hemisfério. **Confundiu em campo em 2026-08-02; sufixo trocado de `E`/`N` para `mE`/`mN` e nota acrescentada ao cartão "Coordenada".**
- [ ] Item 12a: formulário novo é navegável no celular, nomes em português, lista filtrada pela categoria?
- [ ] Item 12b: Editar abre já preenchido com a escolha do aluno?
- [ ] Item 12c: correção do instrutor chega ao aluno **sem F5** e o popup mostra "Corrigido por …"?
- [ ] Item 12d: aluno editando a própria marcação NÃO gera "Corrigido por"?
- [ ] Item 13 (só quando a Etapa 2c for ativada): símbolo do seed bate com a planilha; aluno não muda o próprio símbolo?
- [ ] Item 14a: a linha "Do meu posto" aparece no popup da marcação, com distância e milésimos?
- [ ] Item 14b: distância bate com telêmetro/carta dentro de ~30 m?
- [ ] Item 14c: **qual norte o observador quer — verdadeiro, quadrícula ou magnético?** (define a próxima etapa do apoio de fogo)
- [ ] Item 14d: KML de medidas de coordenação publicado só para o partido da artilharia funcionou? O que faltou?

Qualquer item marcado como falha vira a prioridade do próximo chat — cole este checklist preenchido para retomar com contexto completo.
