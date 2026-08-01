# Roteiro de teste em campo — Etapa 11 e pendências acumuladas (Etapas 3-7.1)

Este roteiro é a entrega mais valiosa da Etapa 11: várias coisas nunca puderam ser testadas de verdade porque exigiam HTTPS num domínio (não em `localhost`) e mais de um celular ao mesmo tempo. Agora dá para testar tudo isso de uma vez.

**Formato de cada item:** o que fazer → o que esperar → como saber que falhou. Quando algo falhar, anote o item e continue para o próximo — não vale a pena parar o teste inteiro por um item quebrado.

## 0. Antes de ir a campo

Sem isto pronto, nenhum item abaixo funciona:

1. **GitHub Pages habilitado** (Settings → Pages → Deploy from branch → `main` / `/ (root)`, no repositório). Anote a URL — algo como `https://joaopaulo1008.github.io/wartoolc2/`.
2. **Cadastro fechado no Supabase**: Authentication → Sign In / Providers → desligar "Allow new users to sign up". Confirme abrindo `.../frontend/login.html` num navegador anônimo: não deve haver mais aba de cadastro (já foi removida da tela), e a tela deve dizer para falar com o instrutor.
3. **Contas de teste criadas** via `backend/seed/criar_usuarios.mjs` (ver `backend/seed/README.md`). Para os itens de hostilidade relativa (item 2) você precisa de **pelo menos 4 contas de aluno + 1 instrutor**:
   - 2 contas no partido Azul
   - 2 contas no partido Vermelho (uma delas, "Vermelho-2", só é usada no item 8 — pode ser a mesma conta do item 2)
   - 1 conta instrutor
4. **Migrations pendentes aplicadas** no SQL Editor do Supabase, na ordem, se ainda não estiverem: `0004_perfis_realtime.sql`, `0005_rastro_historico.sql`, `0006_calcos.sql`. (`0001`-`0003` já deveriam estar aplicadas desde etapas anteriores.)
5. **Forças distribuídas**: no painel do instrutor (aba "Permissões e forças"), coloque as 4 contas de aluno em Azul/Vermelho conforme o item 3. Lembre: partido nulo é restritivo — um aluno sem força não vê ninguém, nem é visto.
6. **Celulares**: pelo menos 2, idealmente 3-4 (dá para revezar contas entre 2 aparelhos se faltar celular, só um pouco mais lento).
7. Tenha o **painel do instrutor aberto num notebook/tablet** à parte — vários itens abaixo pedem uma ação do instrutor enquanto se observa o celular do aluno.

## 1. O site abre e o BDGEx desenha (fecha a pendência da 7.1)

**Fazer:** abrir a URL do GitHub Pages num celular (dados móveis, não Wi-Fi da mesma rede do notebook — é o teste que a Etapa 3 nunca conseguiu fazer). Fazer login com uma conta de aluno. Com o mapa base em BDGEx (é o padrão), afastar e aproximar o zoom algumas vezes.

**Esperar:** a tela de login abre em HTTPS (cadeado no navegador), login funciona, o mapa aparece com a carta topográfica do Exército (tons de bege/verde, curvas de nível, estradas) — não um mapa em branco. Ao mudar o zoom, o nível de detalhe muda (a `ctmmultiescalas_mercator` troca de escala).

**Como saber que falhou:**
- Mapa branco/cinza no lugar do BDGEx → o `bdgex.eb.mil.br/mapcache` não respondeu em https. Abra o DevTools remoto do celular (ou teste o mesmo mapa base num desktop) e veja se a requisição do tile deu erro de certificado/CORS/timeout. Se for isso, o caminho é um proxy reverso próprio (não existe "voltar para http" numa página https) — não é algo para resolver no celular, é infraestrutura nova.
- Zoom não muda nada visualmente → confirme que está de fato no BDGEx (não trocou sem querer para outro mapa base) antes de concluir que é bug.

## 2. Dois celulares vendo a posição um do outro (Etapas 3 e 4)

**Fazer:** dois celulares, duas contas de aluno do MESMO partido, ao ar livre (GPS de smartphone não funciona bem indoor), a uma distância que dê para conferir a olho nu (ex.: nas duas pontas de um estacionamento). Logar nos dois, deixar o app aberto uns 30-60s.

**Esperar:** cada celular mostra o próprio avatar (símbolo AMIGO com o SIDC do perfil) e o avatar do colega aparecendo na posição real dele, com nome de guerra. Andando, os dois avatares se movem em tempo real (sem precisar recarregar).

**Como saber que falhou:** um dos dois não aparece no aparelho do outro → confira primeiro se os dois estão na mesma turma e com partido atribuído (partido nulo é invisível para todo mundo, por design — não é bug). Se os dois têm partido e turma certos e mesmo assim não aparecem, é a pendência real desde a Etapa 4: confira o console do navegador (erro de subscribe no canal Realtime).

## 3. Hostilidade relativa nas marcações (Etapas 4.5 e 5)

Dois testes distintos — fazer os dois, são complementares:

**3a. Mesmo partido (o teste que prova a hostilidade relativa):** duas contas do mesmo partido (ex.: Azul-1 e Azul-2). Na conta Azul-1, marque um elemento no mapa escolhendo partido "Azul" (o próprio). Na mesma conta, marque outro elemento escolhendo partido "Vermelho".

**Esperar:** na tela de Azul-2 (que enxerga as marcações de Azul-1, mesmo partido), o primeiro elemento aparece com símbolo AMIGO (azul) e o segundo com símbolo HOSTIL (vermelho) — a MESMA lógica de hostilidade relativa que já era válida no COP legado, agora provada com duas contas reais.

**Como saber que falhou:** os dois elementos aparecem com a mesma cor/hostilidade, ou nenhum aparece → primeiro confirme que Azul-2 realmente está vendo Azul-1 (RLS é amarrada ao autor via `fn_usuarios_visiveis()`); se a visibilidade estiver ok e a cor não mudar, o problema é em `hostilidadeRelativa()`/`sidcParaObservador()`.

**3b. Partidos diferentes (prova que a marcação NÃO vaza — comportamento esperado, não bug):** na conta Azul-1, marque um elemento qualquer. Na conta Vermelho-1, olhe o mapa.

**Esperar:** Vermelho-1 **não vê** a marcação feita por Azul-1. Isso é o comportamento correto e documentado (a visibilidade de `elementos_marcados` é amarrada ao autor, não ao partido do elemento marcado) — **não confundir com falha**.

**Como saber que é falha de verdade:** se Vermelho-1 estivesse vendo a marcação de Azul-1, aí sim seria um vazamento de RLS — o oposto do que este item testa.

## 4. Instrutor desliga `enviar_posicao_gps` sem F5

**Fazer:** com um aluno logado e enviando posição, o instrutor, no painel (aba Permissões), desliga a chave `enviar_posicao_gps` para aquele aluno (ou para a turma toda).

**Esperar:** o `#gps-status` no topo da tela do aluno muda para refletir que o envio foi desligado, **sem precisar recarregar a página**. O avatar do aluno para de se mover no mapa dos colegas (mas o aluno continua vendo a própria posição local, se `ver_propria_posicao` estiver ligada — são duas chaves separadas).

**Como saber que falhou:** o status não muda até um F5 manual → confira se o painel realmente gravou a mudança (releitura de `vw_permissoes_efetivas` no instrutor) e se o canal Realtime de `permissoes_turma`/`permissoes_usuario` está assinado no aluno (console do navegador).

## 5. "Voltar ao padrão da turma" — o caso mais incerto de todos

Por que é o mais incerto: o Realtime não aplica RLS a eventos `DELETE`, só o filtro de coluna — a assinatura depende do `REPLICA IDENTITY FULL` trazer o `usuario_id` da linha apagada para o filtro casar. Se algo não propagar, é aqui.

**Fazer:** dê um override individual a um aluno numa chave qualquer (ex.: desligue `ver_posicao_outros` só para ele, via painel). Confirme que o efeito aparece no aparelho dele. Depois, no painel, clique **"Voltar ao padrão da turma"** para aquela chave/aluno.

**Esperar:** o aparelho do aluno reage **sem F5** — a chave volta ao valor herdado da turma (ou do catálogo).

**Como saber que falhou:** o aparelho do aluno só reflete a mudança depois de um F5 manual. Este é o item mais provável de expor um problema real — se falhar, é o primeiro a reportar em detalhe (qual chave, qual navegador, tinha console aberto ou não).

## 6. Instrutor troca a força de um aluno → recarrega sozinho

**Fazer:** com o `0004` aplicada e um aluno com o app aberto, o instrutor troca o partido dele (ex.: de Azul para Vermelho) no painel.

**Esperar:** o app do aluno mostra um aviso por ~3s e recarrega sozinho (`location.reload()`, deliberado — ver CLAUDE.md, Etapa 6a). Depois de recarregar, ele enxerga o mapa como o novo partido (hostilidade invertida em relação a antes).

**Como saber que falhou:** nada acontece no aparelho do aluno → confira se `0004_perfis_realtime.sql` foi de fato aplicada (`perfis` publicada no Realtime) e se `perfil-ao-vivo.js` está assinando a própria linha.

## 7. Debriefing — histórico/replay (Etapa 6b, migration 0005)

**7a. `security invoker`, no SQL Editor do Supabase:**
```sql
select prosecdef from pg_proc where proname = 'fn_rastro_historico';
```
**Esperar:** `false`. Se vier `true`, alguém trocou a função para `definer` e a RLS do histórico deixou de valer — corrigir antes de qualquer outra coisa desta seção.

**7b. Índice usado, no SQL Editor:**
```sql
explain analyze select * from fn_rastro_historico(
  array['<uuid-de-um-aluno>']::uuid[], now() - interval '1 hour', now(), 30
);
```
**Esperar:** o plano usa `idx_hist_usuario_tempo`. Se aparecer um *sequential scan* na tabela inteira, o índice não está sendo usado — problema de performance a investigar antes de um exercício de verdade com volume.

**7c. Isolamento entre alunos — o teste de segurança da etapa.** Pegue o **token de acesso de um aluno** (DevTools → Application → Local Storage → chave do supabase, ou log de `session.access_token` no console) e chame a RPC via `curl`/Postman com esse token, passando o **UUID de outro aluno**:
```
POST https://xfqiwlnzvqoaxabpkgss.supabase.co/rest/v1/rpc/fn_rastro_historico
apikey: <a publishable key, de frontend/config.js>
Authorization: Bearer <token do aluno>
Content-Type: application/json

{"p_usuarios": ["<uuid-do-COLEGA>"], "p_desde": "...", "p_ate": "...", "p_intervalo_segundos": 30}
```
**Esperar:** a resposta volta **vazia** (ou só com o próprio rastro, se `p_usuarios` misturar o próprio UUID com o do colega) — nunca o rastro do colega.

**Como saber que falhou:** a resposta traz o rastro do colega → a policy `historico_ler` não está sendo respeitada dentro da função (contradiz o item 7a — revisar os dois juntos).

**7d. Legibilidade do replay:** com pelo menos um aluno tendo se movido de verdade (item 2), abra o Debriefing, selecione-o, busque a última hora e reproduza. **Esperar:** o replay anda de forma legível (cadência de ~30s suavizada por interpolação, sem "teleporte"). Se o celular ficou parado tempo suficiente para simular perda de sinal (>60-120s sem atualizar), o replay deve **parar e esmaecer** no último ponto, não desenhar uma linha reta até o próximo.

## 8. Calcos KML/KMZ (Etapa 7, migration 0006)

**8a. Bucket privado, no SQL Editor:**
```sql
select public from storage.buckets where id = 'calcos';
```
**Esperar:** `false`. Se vier `true`, o bucket é público — qualquer um baixa qualquer calco por URL adivinhável, sem passar pela RLS, e isso anula o item 8c abaixo.

**8b. Publicação em tempo real:** instrutor publica um calco (categoria "Manobra", por exemplo) com o app de um aluno aberto e na tela.

**Esperar:** o calco aparece no mapa do aluno **sem F5**. Remover o calco no painel também some da tela do aluno sem F5.

**8c. O teste mais importante desta seção — isolamento do objeto no Storage.** Publique um calco visível **só para o Azul** (`partido_id` do calco = Azul). Pegue o caminho do objeto no Storage (o painel do instrutor mostra, ou consulte `select caminho_objeto from calcos order by criado_em desc limit 1;`). Com o **token de uma conta do Vermelho**, tente baixar esse objeto direto:
```
GET https://xfqiwlnzvqoaxabpkgss.supabase.co/storage/v1/object/calcos/<caminho_objeto>
apikey: <publishable key>
Authorization: Bearer <token do aluno Vermelho>
```
**Esperar:** erro (403/404), não o arquivo.

**Como saber que falhou:** o arquivo é baixado normalmente → a policy `calcos_objeto_ler` não está funcionando como esperado (ela depende de um comportamento do Postgres — tabela referenciada dentro de policy tem as policies dela aplicadas — cujo modo de falha é **aberto**, não fechado; ver CLAUDE.md, Etapa 7). Reportar com prioridade alta.

**8d. `carregar_kml` desligada por padrão:** com um aluno cuja chave `carregar_kml` esteja no padrão (`false`), confira que o botão de carregar arquivo local aparece **desabilitado, com explicação** (não escondido). Ligue a chave no painel — o botão libera sem F5.

## 9. Checklist de saída

Depois do teste, reúna:
- [ ] Item 1: BDGEx desenhou? Se não, qual erro (certificado, CORS, timeout, tile branco)?
- [ ] Item 2: os dois celulares se viram?
- [ ] Item 3a/3b: hostilidade relativa correta, marcação não vazou entre partidos?
- [ ] Item 4: status de GPS mudou sem F5?
- [ ] Item 5: "Voltar ao padrão" propagou sem F5? **(o item mais provável de falhar)**
- [ ] Item 6: troca de força recarregou sozinho?
- [ ] Item 7a-c: `prosecdef = false`, índice usado, isolamento do histórico confirmado?
- [ ] Item 7d: replay legível, com pausa em perda de sinal?
- [ ] Item 8a: bucket privado?
- [ ] Item 8b: calco em tempo real?
- [ ] Item 8c: isolamento do objeto confirmado? **(o outro item de segurança crítico)**
- [ ] Item 8d: `carregar_kml` desligada mostra explicação, liga sem F5?

Qualquer item marcado como falha vira a prioridade do próximo chat — cole este checklist preenchido para retomar com contexto completo.
