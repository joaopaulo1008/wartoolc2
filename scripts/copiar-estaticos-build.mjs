// scripts/copiar-estaticos-build.mjs — Etapa 9a: o que o Vite NÃO empacota
// sozinho, depois de `vite build`.
//
// Duas coisas, e por que cada uma precisa de cópia manual em vez de o Vite
// achar sozinho:
//
// (Eram três até a Etapa 11. A que saiu era `data/*.geojson`, carregada por
// `fetch()` em tempo de execução — EXTRA_LAYERS e o polling do COP tático de
// junho, ambos removidos de frontend/index.html naquela etapa junto com os
// dois arquivos. `data/` hoje só tem `simbologia-eb/`, que é FONTE e nunca
// foi copiada: ver o comentário no lugar onde a cópia ficava, mais abaixo.)
//
// 1. `frontend/sw-bdgex.js` — é um Service Worker, registrado por
//    `navigator.serviceWorker.register('./sw-bdgex.js')` (offline-tela.js),
//    também uma STRING, não um import. Tem uma exigência a mais: o nome do
//    arquivo tem que ser ESTÁVEL (sem hash de conteúdo), porque o navegador
//    verifica o Service Worker pedindo essa MESMA URL exata a cada visita —
//    se o Vite processasse este arquivo como um asset comum, o hash mudaria
//    a cada build e o registro pararia de bater.
//
// 2. `.nojekyll` dentro de `dist/` — o que hoje existe na raiz do repositório
//    evita o processador Jekyll do GitHub Pages mexer em pastas começando
//    com "_" (nenhuma aqui, mas é a convenção). Com o build, o que é
//    PUBLICADO é `dist/`, não a raiz do repo — o marcador precisa estar
//    dentro de `dist/`, senão o arquivo na raiz do repo não protege nada.
//
// Roda depois de `vite build` (ver o script "build" em package.json).
// `fs.cpSync` (Node 16.7+) copia recursivamente sem dependência nova — o
// projeto já evita adicionar pacote por conveniência quando algumas linhas
// de Node puro resolvem (mesmo critério de offline-tela.js não usar
// leaflet-draw).
import { cpSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(raiz, 'dist');

if (!existsSync(dist)) {
  console.error('dist/ não existe — rode "vite build" antes deste script.');
  process.exit(1);
}

// `data/` NÃO é copiada, e desde a Etapa 11 a pasta inteira ficou de fora.
// O único diretório que sobrou lá dentro é `data/simbologia-eb/`, que é
// FONTE, não recurso de tempo de execução: o catálogo do MD/EB chega ao
// navegador como módulo empacotado (`frontend/simbolos-catalogo.js`, gerado
// por scripts/gerar-catalogo-simbologia.mjs), justamente para não depender de
// um `fetch()` em campo. Publicar os JSON junto seriam ~63 kB que ninguém
// baixa. Se um dia voltar a existir arquivo de dados servido por `fetch()`,
// é aqui que a cópia volta.
cpSync(join(raiz, 'frontend', 'sw-bdgex.js'), join(dist, 'frontend', 'sw-bdgex.js'));
writeFileSync(join(dist, '.nojekyll'), '');

console.log('Copiados para dist/: frontend/sw-bdgex.js, .nojekyll');
