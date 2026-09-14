// vite.config.js — Etapa 9a: migração para bundler.
//
// Por que este arquivo existe
// ----------------------------
// Até aqui o projeto rodava sem build nenhum: GitHub Pages servia o
// repositório cru, Leaflet/milsymbol vinham de CDN via <script> clássico, e
// dois arquivos (window.WartoolSimbolos, window.WartoolCamadas) existiam só
// para um <script> não-module conseguir "ver" o que um module publicava —
// limitação que só existe PORQUE não havia bundler. Este arquivo introduz o
// Vite e fecha essa lacuna: com bundler, tudo pode ser `import` de verdade.
//
// `root: '.'` (a raiz do repositório, não `frontend/`), de propósito: os
// caminhos relativos usados hoje (`../data/...` em frontend/index.html, o
// redirect em `/index.html`) todos assumem que o site é servido a partir da
// raiz do repositório — mesma premissa de sempre (GitHub Pages só serve raiz
// ou `/docs`, nunca uma subpasta arbitrária). Mudar `root` quebraria essa
// premissa para reabrir de novo com um número diferente; manter a raiz do
// jeito que já está deixa a estrutura de pastas (frontend/, data/, docs/)
// idêntica ao que já existe, só que com um passo de build no meio.
//
// `base: '/wartoolc2/'` é o detalhe mais fácil de esquecer e o mais caro de
// esquecer: o site é servido em `https://joaopaulo1008.github.io/wartoolc2/`
// (subpasta do domínio do GitHub Pages, não a raiz dele) — sem isso, todo
// asset com hash que o Vite gera (`/assets/index-xxxx.js`) apontaria para a
// raiz ERRADA em produção e o site abriria em branco, sem erro óbvio no
// console além de uma cascata de 404. Em desenvolvimento local (`vite dev`)
// isso não aparece — é só em produção que o `base` importa, o que o torna um
// erro fácil de não notar até depois do deploy.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// `import.meta.dirname` (Node 20.11+) no lugar de `__dirname`: este arquivo é
// ESM de verdade (`"type": "module"` em package.json), então `__dirname` não
// existe nativamente aqui — funcionava só porque o carregador de config atual
// do Vite ainda faz um shim dele, e o próprio Vite avisa que isso muda quando
// `configLoader: 'native'` virar padrão.
const aqui = import.meta.dirname;

// ── Carimbo de versão (2026-09-14) ────────────────────────────────────────
// Três vezes seguidas uma correção entregue foi relatada como "continua
// igual", e nas duas primeiras a causa foi o navegador servindo a versão
// anterior. Não dá para consertar isso pelo cache: GitHub Pages não permite
// configurar header por arquivo (registrado como ponto de atenção desde a
// Etapa 11), e o `index.html` — que é quem aponta para os assets com hash —
// fica atrás da CDN do Pages com validação por ETag.
//
// O que DÁ para fazer é parar de adivinhar. Este carimbo aparece no rodapé das
// duas telas: quem está em campo lê um número, e a pergunta "você está vendo a
// versão nova?" vira um fato conferível em vez de uma suposição de quem está
// do outro lado. Não conserta o cache — torna o cache VISÍVEL, que é a parte
// que faltava para não gastar uma sessão inteira consertando o que já estava
// consertado.
//
// A data/hora é a do BUILD (UTC, minuto), não a do commit: é ela que responde
// "o que está no ar agora". O SHA do commit vem junto quando o build roda no
// GitHub Actions (`GITHUB_SHA`), e fica vazio num build local — onde o
// relógio já basta.
const carimboData = new Date().toISOString().slice(0, 16).replace('T', ' ');
const carimboSha = (process.env.GITHUB_SHA || '').slice(0, 7);
const CARIMBO_VERSAO = carimboSha ? `${carimboData} · ${carimboSha}` : carimboData;

export default defineConfig({
  root: '.',
  base: '/wartoolc2/',

  // Substituição em tempo de build. `__VERSAO_BUILD__` não existe em tempo de
  // execução — o Vite troca o identificador pelo literal antes de empacotar —,
  // por isso o valor precisa ser JSON.stringify'ado: o que é injetado é código
  // fonte, não um valor.
  define: {
    __VERSAO_BUILD__: JSON.stringify(CARIMBO_VERSAO),
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Multi-page: as quatro páginas HTML do projeto. `index.html` na raiz é
    // só o redirect (Etapa 11) — entra aqui para o Vite copiá-lo para dentro
    // de `dist/` no mesmo lugar relativo, não porque tenha algo para
    // empacotar (ele nem carrega Leaflet/Supabase, de propósito, para
    // continuar funcionando mesmo se o resto do site quebrar).
    rollupOptions: {
      input: {
        raiz: resolve(aqui, 'index.html'),
        login: resolve(aqui, 'frontend/login.html'),
        app: resolve(aqui, 'frontend/index.html'),
        instrutor: resolve(aqui, 'frontend/instrutor.html'),
      },
    },
  },
});
