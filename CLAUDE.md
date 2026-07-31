# CLAUDE.md — WartoolC2

Contexto para qualquer sessão futura (Claude ou humano) trabalhando neste projeto.

## O que é o projeto

**WartoolC2** — portal WebGIS militar de instrução/C2, para uso em campo com rede de dados disponível. Objetivo final:

- Trocar camada de fundo (mapa online ou imagem georreferenciada local).
- Carregar KML/KMZ com controle de visibilidade e opacidade.
- Avatar do usuário como símbolo militar padrão NATO (APP-6B/APP-6D), posicionado pelo GPS do celular em tempo real.
- Duas interfaces: **instrutor** (habilita/desabilita funções e visualizações por usuário) e **usuário/aluno**.
- Usuário marca posições inimigas no mapa.
- Futuro: ingestão de posição GPS de rádios militares (protocolo ainda não definido).

Orçamento alvo: até R$ 200/mês para hospedagem/serviços.

Repositório GitHub original chamado `cop-tatico` — está sendo renomeado para **`wartoolc2`** para bater com o nome do produto. Ao renomear o repo nas configurações do GitHub, ele mantém redirecionamento automático da URL antiga.

## Simbologia militar — duas bibliotecas, papéis diferentes

Importante não confundir as duas:

- **[milsymbol](https://github.com/spatialillusions/milsymbol)** (já integrada no protótipo): é o **renderizador** — recebe um código SIDC e devolve o SVG do símbolo pronto para colocar no mapa.
- **[stanag-app6](https://github.com/spatialillusions/stanag-app6)**: **não é um renderizador**, é uma biblioteca de **tabelas/dados** do padrão APP-6B e APP-6D (hostilidade, dimensão de batalha, natureza/entidade, escalão etc.) em JSON, publicada via npm (`import { app6b, app6d } from "stanag-app6"`). Serve para: (a) montar o SIDC corretamente a partir de escolhas humanas ("Infantaria Mecanizada", "Hostil", "Batalhão" etc.), e (b) alimentar os seletores/dropdowns da interface com a lista oficial e completa de opções, no lugar das tabelas reduzidas e escritas à mão que existem hoje em `frontend/index.html` (`HOSTILIDADE`, `DIMENSAO`, `SITUACAO`, `ESCALAO`, `NATUREZA_MAP` em `legacy-qgis/cop_tatico_v7.py` também).

As duas bibliotecas são do mesmo autor (spatialillusions) e foram desenhadas para se complementarem — não uma substitui a outra. Ambas rodam no navegador; como `stanag-app6` só documenta uso via `import` (bundler), a integração efetiva dela na interface deve acontecer quando o frontend evoluir de HTML estático para uma SPA com bundler (Vite/webpack), prevista no roadmap abaixo.

## Estado atual (herdado do protótipo original)

Havia um protótipo funcional, porém **somente leitura** e sem GPS de celular:

- **Frontend** (`frontend/index.html`): Leaflet + `milsymbol` já renderiza símbolos a partir de um SIDC. Seletor de mapa base já com 10 opções (OSM, Esri topo/satélite, OpenTopoMap, Google sat/híbrido, **BDGEx 1:50.000 do Exército**, CartoDB claro/escuro). Suporta camadas extras via GeoJSON com toggle de visibilidade (não tem controle de opacidade nem upload pelo usuário ainda). As tabelas de hostilidade/dimensão/natureza são hoje escritas à mão — candidatas a serem substituídas pelas tabelas oficiais do `stanag-app6`.
- **Pipeline de dados** (`legacy-qgis/`): um operador digita posições (UTM 22S, grau decimal ou GMS) numa planilha Google Sheets → script Python (`cop_tatico_v7.py`) rodando **dentro do QGIS Desktop** lê a planilha, monta o código SIDC, gera camadas e exporta um GeoJSON único → `publicar_github.py` faz commit+push desse GeoJSON no repositório → `frontend/index.html` faz *polling* desse arquivo estático a cada 2 minutos via `raw.githubusercontent.com`.

Isso significa: **hoje não há escrita pelo navegador**. Ninguém marca nada direto no mapa, não há GPS de celular, não há login, não há papéis de instrutor/usuário. O "tempo real" é, na prática, um arquivo estático republicado manualmente/por polling de um PC com QGIS.

## Decisão de arquitetura

Reaproveitar o frontend (Leaflet + milsymbol + seletor de basemaps) quase integralmente — é o maior acerto do protótipo. Substituir o pipeline "Sheets → QGIS → GitHub" por um **backend em tempo real** (Supabase: Postgres + Realtime + Auth), que permite:

- O celular do usuário escrever sua própria posição de GPS periodicamente.
- O usuário criar marcações de posição inimiga direto no mapa.
- O instrutor controlar, por usuário, quais camadas/funções estão habilitadas — lido em tempo real pelo cliente.
- Autenticação com dois papéis (`instrutor`, `usuario`).

O pipeline QGIS/Sheets deixa de ser a fonte de verdade em produção, mas pode continuar existindo como forma de importar dados de planejamento pré-exercício (ex.: posições iniciais conhecidas) — por isso foi preservado em `legacy-qgis/`, não apagado.

## Estrutura de pastas

```
frontend/       app web (Leaflet + milsymbol + stanag-app6) — hoje estático, vai virar SPA com login/GPS/escrita
data/           GeoJSON publicados (saída do pipeline atual; pode servir de seed pro backend novo)
legacy-qgis/    pipeline original QGIS + Sheets — mantido como importador opcional, não é mais a fonte de verdade
backend/        (em construção) schema Supabase, funções de tempo real, regras de permissão
docs/           plano de viabilidade (Plano_WebGIS_Militar.docx) e decisões de arquitetura
```

## Pontos de atenção conhecidos

- **Termos de uso de mapas**: Google Maps proíbe uso militar/defesa em seus termos padrão — o basemap `google_sat`/`google_hybrid` já presente no index.html deve ser tratado como opcional/risco, não padrão. OSM e Esri são mais seguros.
- **Precisão de GPS de smartphone**: 5-15m ao ar livre, pior em áreas fechadas — adequado para instrução, não é GPS de grau militar.
- **`milsymbol`/`stanag-app6`** são implementações de código aberto do padrão, não homologadas por força armada — ok para instrução.
- Rádios militares: integração futura, protocolo/fabricante ainda não definido. A arquitetura com backend em tempo real já comporta essa extensão sem redesenho (é só mais uma origem de "posição").

## Próximos passos

1. Definir schema no Supabase: usuários/papéis, posições (GPS), marcações inimigas, permissões por usuário/turma.
2. Adicionar captura de GPS do navegador (`watchPosition`) e escrita periódica no backend.
3. Adicionar tela de login com dois papéis e painel do instrutor (permissões por usuário).
4. Adicionar criação de marcação inimiga por toque no mapa.
5. Portar upload de KML/KMZ com opacidade (ainda não existe) e upload de imagem georreferenciada local (ainda não existe).
6. Ao migrar o frontend para SPA com bundler, trocar as tabelas manuais de hostilidade/dimensão/natureza pelas tabelas oficiais do `stanag-app6`.
7. Testar carga com 60+ usuários simultâneos antes do uso real; ajustar plano do Supabase se necessário.
8. Renomear o repositório no GitHub de `cop-tatico` para `wartoolc2` (Settings → Repository name).

Ver `docs/Plano_WebGIS_Militar.docx` para custos e roadmap detalhados.
