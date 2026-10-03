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
// ── `base` é RELATIVO desde 2026-10-03, e era '/wartoolc2/' ───────────────
// `base` decide o prefixo de todo asset com hash que o Vite gera. Errado, o
// site abre em branco em produção: uma cascata de 404 e nada de óbvio no
// console. Em `vite dev` isso nunca aparece — é erro que só existe depois do
// deploy, o que o torna fácil de não notar.
//
// Era `'/wartoolc2/'` porque o único destino era
// `https://<usuario>.github.io/wartoolc2/`, uma SUBPASTA do domínio do Pages.
// O motivo de mudar não é técnico, é de endereço: o endereço curto
// (5bdacbldc2.pages.dev) era um 302 para o github.io, então o nome de usuário
// acabava na barra de endereços do aluno. Servindo direto no Cloudflare Pages
// o site mora na RAIZ do domínio — e aí um `base` de subpasta quebraria tudo.
//
// `'./'` serve aos dois: os caminhos saem relativos ao documento, então o
// MESMO `dist/` funciona montado na raiz e montado em `/wartoolc2/`. É o que
// permite trocar de hospedagem sem build diferente, e manter o GitHub Pages
// como reserva enquanto a troca não se confirma em campo.
//
// Isto é verificado, não suposto: o mesmo `dist/` foi servido em dois montes
// ISOLADOS (um na raiz, outro só em /wartoolc2/) e carregado no Chromium
// anotando todo 404 — zero nos dois. Conferido por mutação: voltando para
// `'/wartoolc2/'`, o monte da raiz acusa 15 arquivos faltando. A primeira
// versão desse teste servia os dois caminhos da MESMA pasta e aprovava o
// `base` absoluto por engano; se for refazer, mantenha os montes separados.
//
// O que já era relativo e por isso não precisou mudar: o registro do service
// worker (`./sw-bdgex.js`), o `start_url`/`scope`/`icons` do
// manifest.webmanifest e os `<link>` de `marca.css`. Os `<link rel=icon>` e o
// `<link rel=manifest>` das três páginas são escritos com `/` na frente e o
// próprio Vite os reescreve conforme o `base` — não os transforme à mão.
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
  base: './',

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
