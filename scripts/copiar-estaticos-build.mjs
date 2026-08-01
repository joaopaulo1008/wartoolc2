// scripts/copiar-estaticos-build.mjs — Etapa 9a: o que o Vite NÃO empacota
// sozinho, depois de `vite build`.
//
// Três coisas, e por que cada uma precisa de cópia manual em vez de o Vite
// achar sozinho:
//
// 1. `data/*.geojson` — são carregados por `fetch()` em tempo de execução
//    (EXTRA_LAYERS e o polling do COP tático legado em frontend/index.html),
//    nunca por `import`. O Vite só empacota o que consegue enxergar por
//    análise estática de import/require; uma string de URL passada a
//    `fetch()` é invisível para ele.
//
// 2. `frontend/sw-bdgex.js` — é um Service Worker, registrado por
//    `navigator.serviceWorker.register('./sw-bdgex.js')` (offline-tela.js),
//    também uma STRING, não um import. Tem uma exigência a mais: o nome do
//    arquivo tem que ser ESTÁVEL (sem hash de conteúdo), porque o navegador
//    verifica o Service Worker pedindo essa MESMA URL exata a cada visita —
//    se o Vite processasse este arquivo como um asset comum, o hash mudaria
//    a cada build e o registro pararia de bater.
//
// 3. `.nojekyll` dentro de `dist/` — o que hoje existe na raiz do repositório
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

cpSync(join(raiz, 'data'), join(dist, 'data'), { recursive: true });
cpSync(join(raiz, 'frontend', 'sw-bdgex.js'), join(dist, 'frontend', 'sw-bdgex.js'));
writeFileSync(join(dist, '.nojekyll'), '');

console.log('Copiados para dist/: data/, frontend/sw-bdgex.js, .nojekyll');
