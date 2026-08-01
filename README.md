# WartoolC2 — Portal WebGIS de Instrução

Common Operational Picture tático para instrução/simulação, com simbologia militar padrão (APP-6B/APP-6D) sobre mapas web.

## Status

Protótipo funcional (visualização) + em evolução para plataforma com GPS ao vivo, papéis de instrutor/usuário e marcação de posições em campo. Veja [CLAUDE.md](./CLAUDE.md) para o contexto completo do projeto e [docs/](./docs) para o plano de viabilidade.

## Simbologia

- **[milsymbol](https://github.com/spatialillusions/milsymbol)** — renderiza o SVG do símbolo militar a partir de um código SIDC.
- **[stanag-app6](https://github.com/spatialillusions/stanag-app6)** — tabelas oficiais APP-6B/APP-6D (hostilidade, dimensão, natureza, escalão etc.) em JSON, usadas para montar o SIDC corretamente e alimentar os seletores da interface, no lugar das tabelas reduzidas escritas à mão no protótipo original.

As duas bibliotecas são do mesmo autor (spatialillusions) e foram feitas para trabalhar juntas: stanag-app6 fornece os dados/códigos do padrão, milsymbol desenha o símbolo.

## Estrutura

```
frontend/       app web (Leaflet + milsymbol + stanag-app6) — o mapa que todo mundo abre no navegador
data/           GeoJSON publicados (saída do pipeline atual ou do futuro backend)
legacy-qgis/    pipeline original: QGIS + Google Sheets -> GeoJSON -> GitHub
backend/        (em construção) backend em tempo real — GPS, papéis, marcações
docs/           plano de viabilidade, decisões de arquitetura
```

## Rodando localmente

O frontend é estático — basta servir com qualquer servidor HTTP simples. Desde
a Etapa 11, sirva a partir da **raiz do repositório** (não de dentro de
`frontend/`): o app passou a buscar `data/*.geojson` por caminho relativo
(`frontend/index.html` -> `../data/...`), no mesmo esquema que o GitHub Pages
usa em produção — servir só `frontend/` localmente faria esse fetch falhar.

```
python3 -m http.server 8000
```

Acesse `http://localhost:8000/frontend/login.html` (a raiz `http://localhost:8000/`
também funciona e redireciona para lá).

## Publicado em

GitHub Pages, a partir da raiz deste repositório (branch `main`) — grátis,
HTTPS automático, sem etapa de build. Detalhes da decisão e como reconfigurar
em `docs/prompt-etapa-11.md` e na seção "Decisões da Etapa 11" de
[CLAUDE.md](./CLAUDE.md).
