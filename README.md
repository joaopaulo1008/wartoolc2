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

O `frontend/index.html` é estático — basta abrir no navegador ou servir com qualquer servidor HTTP simples:

```
cd frontend
python3 -m http.server 8000
```

Acesse `http://localhost:8000`.
