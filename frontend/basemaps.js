// basemaps.js — Etapa 7.1: a lista de mapas base, num lugar só.
//
// Por que este arquivo existe agora, e não na Etapa 9
// ---------------------------------------------------
// A unificação dos mapas base estava adiada para a Etapa 9 desde a 6b, e a
// justificativa registrada lá era boa: mexer nisso encosta na ponte
// `window.WartoolCamadas`, que é onde a permissão `camada_bdgex` atua.
//
// O que mudou: a lista foi REDUZIDA de onze para seis, e a redução tinha que
// chegar às três telas. Fazer isso com a tabela copiada em quatro lugares
// (index.html, debriefing.js, situacao.js e — desde a 6c — mais uma vez) era
// pedir para as cópias divergirem, que é exatamente o erro que a Etapa 4.5
// corrigiu no SIDC. Além disso, as duas telas do instrutor não tinham o
// BDGEx: o mapa mais importante do projeto faltava justamente para quem
// conduz a instrução.
//
// ETAPA 9a: `index.html` deixou de ter a própria cópia — o `<script>`
// clássico que não podia `import` não existe mais, e `criarBasemaps()`
// passou a ser a ÚNICA fonte, nas três telas. `basemaps.teste.mjs` deixou de
// precisar ler o HTML com regex por causa disso (ver o próprio arquivo).
//
// Os metadados puros (OPCOES_BASEMAP/BASEMAP_PADRAO/BASEMAP_FALLBACK) moraram
// aqui até a Etapa 9a; agora vivem em basemaps-dados.js e são só
// reexportados daqui — ver o cabeçalho de lá para o porquê da separação
// física (resumo: `import * as L from 'leaflet'` executa na hora e quebra
// fora do navegador, então o que não precisa de L não pode ficar no mesmo
// arquivo que importa L).
//
// SOBRE O GOOGLE: os termos padrão do Google Maps proíbem uso militar/de
// defesa. As duas opções ficam na lista por escolha explícita de quem usa e
// continuam sendo risco jurídico, não padrão — é o BDGEx que abre o app. A
// decisão está registrada em CLAUDE.md desde a Etapa 0.
import * as L from 'leaflet';

export { OPCOES_BASEMAP, BASEMAP_PADRAO, BASEMAP_FALLBACK } from './basemaps-dados.js';
import { BASEMAP_PADRAO, OPCOES_BASEMAP } from './basemaps-dados.js';

// Instancia as camadas do Leaflet. Só funciona no navegador (depende do `L`
// importado acima e de `location`), por isso está separada dos metadados em
// basemaps-dados.js.
export function criarBasemaps() {
  return {
    // Protocolo herdado da página, e não fixo em http.
    //
    // O BDGEx é servido em http. Numa página https, conteúdo misto é
    // bloqueado pelo navegador — ou seja, com `http://` fixo a carta mais
    // importante do projeto simplesmente não desenharia depois do deploy
    // (Etapa 11), sem erro visível além do mapa vazio. Herdando o protocolo,
    // em `http://localhost` continua http (funciona como hoje) e em produção
    // vai https, que é a única forma que pode funcionar lá.
    //
    // PENDENTE DE TESTE AO VIVO: se bdgex.eb.mil.br não atender em https, a
    // saída é um proxy reverso próprio — não existe "voltar para http" numa
    // página https.
    // CAMADA: `ctmmultiescalas_mercator`, não `ctm50`.
    //
    // O protótipo pedia `ctm50` — só a Carta Topográfica Matricial 1:50.000. O
    // problema é a COBERTURA: a 1:50.000 existe em RS, SC, PR, SP, RJ, ES e
    // pedaços de MG, BA, AM, PA, AP, AL, RN e MA. Fora dessas áreas o BDGEx
    // devolve tile vazio, e o aluno vê um mapa em branco sem nenhuma pista do
    // motivo — o pior tipo de falha para quem está em campo.
    //
    // A `ctmmultiescalas_mercator` empilha 1:25.000 → 1:250.000 e escolhe pelo
    // zoom: cobre ~90% do território e ainda entrega 1:25.000 onde ela existe.
    // Uma opção só no seletor, mais carta do que antes.
    //
    // CRS: o `crs: L.CRS.EPSG4326` que estava aqui foi REMOVIDO de propósito.
    // O sufixo `_mercator` do nome da camada é literal: ela é publicada em Web
    // Mercator (EPSG:3857), que já é o padrão do Leaflet. E `mapcache` não é
    // um WMS completo — ele serve só as grades de tiles que tem em cache, então
    // pedir a grade errada não dá erro: devolve tile em branco. Era um
    // candidato forte a explicar o BDGEx parecer instável (confirmado em
    // campo na correção de 2026-08-01 — ver `bdgexFundo` abaixo).
    //
    // Se o `mapcache` der problema, o plano B são os endpoints por escala, que
    // a documentação do Exército publica em https e com o nome de camada
    // simplesmente `ctm`:
    //   https://bdgex.eb.mil.br/teogc/25/terraogcmed.cgi
    //   https://bdgex.eb.mil.br/teogc/50/terraogcmed.cgi   (e 100, 250)
    // Registrado como pendência própria no ROADMAP (troca completa, mexe
    // também no download offline).
    bdgex: L.tileLayer.wms(`${location.protocol}//bdgex.eb.mil.br/mapcache`, {
      layers: 'ctmmultiescalas_mercator',
      format: 'image/png',
      transparent: true,
      attribution: '© BDGEx / Exército Brasileiro',
      maxZoom: 18,
    }),
    // Mitigação mínima para o BDGEx "sumir" ao mudar de zoom (bug de campo,
    // 2026-08-01 — ver CLAUDE.md). Causa confirmada em campo (sem nenhuma
    // área offline baixada, então não é o Service Worker/cache da Etapa 8a):
    // bate com o candidato já registrado na 7.1 — `mapcache` não é um WMS
    // completo, só serve as grades de tile que já tem em cache, e devolve
    // tile em branco (não erro) quando falta a grade pedida. Como o BDGEx já
    // pede `transparent: true` acima, esse "branco" é um PNG TRANSPARENTE —
    // só não aparece preenchido porque hoje não existe nada por baixo dele
    // no mapa. `bdgexFundo` é uma instância PRÓPRIA do OpenTopoMap (não a
    // mesma de `otopo`, para os dois ciclos de vida não colidirem), plantada
    // por trocarBasemap() (abaixo) sempre que o BDGEx está selecionado.
    // NÃO é o conserto de verdade — esse é trocar `ctmmultiescalas_mercator`
    // (mapcache) pelos endpoints por escala do Exército (`/teogc/<escala>/`,
    // WMS de verdade, sem grade fixa), que fica para uma etapa própria
    // (mexe também no download offline — carta-offline.js/offline-tela.js
    // assumem uma única camada WMS por trás de getTileUrl()). Registrado no
    // ROADMAP. PENDENTE DE TESTE AO VIVO, como todo o resto do BDGEx aqui:
    // depende de o mapcache realmente devolver alpha=0 no buraco, o que não
    // foi possível confirmar a partir do ambiente de desenvolvimento.
    bdgexFundo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenTopoMap', maxZoom: 17,
    }),
    otopo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenTopoMap', maxZoom: 17,
    }),
    google_sat: L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      attribution: '© Google', maxZoom: 20,
    }),
    google_hybrid: L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      attribution: '© Google', maxZoom: 20,
    }),
    hybrid: L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri', maxZoom: 18,
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18, opacity: 0.8,
      }),
    ]),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© CartoDB', maxZoom: 19,
    }),
  };
}

// Troca o mapa base ativo, cuidando de BASEMAPS.bdgexFundo (ver comentário
// dela acima) entrar/sair sempre junto do BDGEx. Extraído para cá — em vez
// de deixar a mesma sequência (remover atual, achar o novo, adicionar) e
// mais o "se for bdgex, adiciona/remove o fundo também" copiada em
// situacao.js E debriefing.js, que são os dois consumidores deste factory —
// mesmo critério de sempre (icones.js, vigia-ausencia.js, painel-lateral.js).
// Desde a Etapa 9a, `index.html` também chama esta função (não tem mais
// cópia própria da lógica de troca).
//
// basemapAnterior: a camada hoje ativa (ou null, na primeira chamada).
// Devolve a nova camada ativa — quem chama é responsável por guardar isso na
// própria variável de estado (mesmo padrão de `basemapAtual` em cada tela).
export function trocarBasemap(map, basemaps, chave, basemapAnterior) {
  if (basemapAnterior) map.removeLayer(basemapAnterior);
  if (basemaps.bdgexFundo && map.hasLayer(basemaps.bdgexFundo)) map.removeLayer(basemaps.bdgexFundo);
  if (chave === 'bdgex' && basemaps.bdgexFundo) basemaps.bdgexFundo.addTo(map);
  const novo = basemaps[chave];
  novo.addTo(map);
  return novo;
}

// Preenche um <select> com as opções, na ordem. Usado pelas duas telas do
// instrutor, que têm seletor de uma linha em vez da lista de rádios do app do
// aluno.
export function preencherSeletorBasemap(select, selecionado = BASEMAP_PADRAO) {
  if (!select) return;
  select.textContent = '';
  for (const opcao of OPCOES_BASEMAP) {
    const item = document.createElement('option');
    item.value = opcao.chave;
    item.textContent = opcao.rotulo;
    if (opcao.chave === selecionado) item.selected = true;
    select.appendChild(item);
  }
}
