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

Desde a Etapa 9a, o projeto usa [Vite](https://vitejs.dev) como bundler
(Leaflet e milsymbol vêm de `npm`, não mais de CDN). Rode a partir da **raiz
do repositório**:

```
npm install
npm run dev
```

O Vite abre um servidor local (padrão `http://localhost:5173`) já servindo
`frontend/login.html`, `frontend/index.html` e `frontend/instrutor.html` com
hot-reload. `npm run build` gera o site publicável em `dist/` (inclui um
passo extra, `scripts/copiar-estaticos-build.mjs`, que copia `data/*.geojson`
e `frontend/sw-bdgex.js` — arquivos que o Vite não enxerga porque são
buscados por `fetch()`/Service Worker, não por `import`); `npm run preview`
serve esse `dist/` localmente para conferir antes de publicar.

## Publicado em

GitHub Pages, publicado por GitHub Actions (`.github/workflows/deploy.yml`):
a cada push em `main`, o workflow roda `npm run build` e publica `dist/`.
Antes da Etapa 9a, o Pages servia a raiz do repositório crua (sem build) —
mudar para um bundler exigiu trocar a origem do Pages de "Deploy from a
branch" para "GitHub Actions" em Settings -> Pages -> Source (passo manual,
feito uma vez só). Detalhes das decisões em `docs/prompt-etapa-11.md`
(hospedagem) e nas seções "Decisões da Etapa 11" e "Decisões da Etapa 9a" de
[CLAUDE.md](./CLAUDE.md).
