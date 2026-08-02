# Procedência do catálogo de simbologia (Etapa 9b)

**Fonte:** Portal de Simbologia Militar do Ministério da Defesa / Exército
Brasileiro — <https://simbologia.eb.mil.br/>, baseado no manual **MD33-M-02**
e no catálogo **MD33-C-01**.

**Data da captura:** 2026-08-01.

## O que foi capturado

O portal é uma SPA em Vue. Os dados do catálogo não vêm de uma API: são **12
*chunks* de webpack**, um por categoria, pré-carregados por `<link rel=prefetch>`
no `index.html` do portal. Cada arquivo tem a forma

```js
(window["webpackJsonp"] = window["webpackJsonp"] || []).push([["symbolSet-<id>-json"], {
  <n>: function (e) { e.exports = JSON.parse('…') }
}]);
```

e o JSON de dentro tem, dependendo da categoria, as chaves `Doutrina FS`,
`Entity`, `sector 1`, `sector 2`, `ExtEntity`, `ModificadoresEB` e
`icones_centrais`.

| Categoria | Arquivo no portal | Bytes | SHA-256 |
|---|---|---:|---|
| aeronaves | `js/symbolSet-aeronaves-json.ae26696d.js` | 2 441 450 | `7371e5eacadc10d2b53d89b4129f62f6ea7e52c393e218beaa139c2ce6dc7b0a` |
| atividades_eventos | `js/symbolSet-atividades_eventos-json.0b9d0936.js` | 1 436 055 | `39da5d1e5465f0800af00708aa1cd9b146c46a149d393f5b88e7672efeb7f425` |
| equipamentos_viaturas | `js/symbolSet-equipamentos_viaturas-json.ec0974ae.js` | 3 279 886 | `d323a88c099d54a72fb6dd1ccef6e1f24cd8ecf0664d50e2d08600d4aecfee8c` |
| espaciais | `js/symbolSet-espaciais-json.8cf7ff10.js` | 815 968 | `7b80bd64ddcf079ef7ce7eae9a05ae3666075de2cccf9353e9a1272814c51f5a` |
| guerra_minas | `js/symbolSet-guerra_minas-json.6f6cda6a.js` | 1 574 748 | `58abb37bd867b553e73e4ee09c79efcdcb9588fb909bfcd2baceb671dd348d37` |
| individuos_desembarcados | `js/symbolSet-individuos_desembarcados-json.7d595a8d.js` | 1 113 017 | `bded8b279f32198fd04857eb4a4ad728e379cbe186b45322cfb5b34e5336bc6a` |
| instalacoes | `js/symbolSet-instalacoes-json.faad5798.js` | 1 969 646 | `c24187505c4a29e2087869a2a308a257bedfa16d3ff8a8d5f4f486131d32e4e5` |
| maritimos_superficie | `js/symbolSet-maritimos_superficie-json.54bbec6c.js` | 3 169 189 | `e95c1b7a968d777c8c95c2041cb10d5f337c1ef797d187d368cc688de810af44` |
| misseis | `js/symbolSet-misseis-json.9bdb350d.js` | 217 290 | `d8e767dcc0f641a5881aac6741fa48a24065d6e9ec45b23b28aa5c2777cd694c` |
| organizacoes_civis | `js/symbolSet-organizacoes_civis-json.11acc4df.js` | 65 747 | `5d304f860129dc06b60af4bb3c4dccbd6440d7e7ab8fcf1acfdb63758cf380cd` |
| submarinos | `js/symbolSet-submarinos-json.0dc47034.js` | 1 369 202 | `6229e6e5c7bde8692c5c5edad2a9b8a92dec042f263900e071d6bbd7bd6d4726` |
| unidades | `js/symbolSet-unidades-json.e5864f3e.js` | 205 065 | `c579299496d577685033cd985000b349bd03f020c4192bda8b68b693f7c5a73c` |

**Total: ~17,6 MB.** O hash no nome do arquivo muda quando o portal publica
uma versão nova — é por isso que o SHA-256 acima existe: ele identifica o
conteúdo, não a URL.

## Por que este repositório NÃO guarda os 12 arquivos originais

Guardar 17,6 MB de *chunk* de webpack seria guardar sobretudo o que não
usamos. O peso está em **imagens PNG em base64** embutidas (`br_symbol` de
cada ícone, os desenhos prontos que o portal mostra na tela) e em campos de
layout da planilha de origem (`symbolWidth`, `symbolHeight`,
`sheetRowNumber`). O WartoolC2 não precisa de nenhum deles: quem **desenha** o
símbolo aqui é a `milsymbol`, a partir do SIDC — o portal é fonte de
**dados**, não de imagem (é a mesma distinção registrada em `CLAUDE.md`,
seção "Simbologia militar — duas bibliotecas, papéis diferentes").

O que está versionado aqui é o **extrato normalizado**, com procedência
verificável pelos SHA-256 acima:

- **`catalogo-extraido.json`** (~57 KB) — as 12 categorias, com o `symbolSet`
  de cada uma, os `icones_centrais` (código de 6 dígitos + `NomeBR` oficial)
  agrupados pelo campo `Entity`, e as tabelas `sector 1` / `sector 2` de
  modificadores.
- **`extensoes-br.json`** (~6 KB) — os 63 ícones de extensão nacional, que
  ficaram de fora do formulário (ver abaixo).

E daí `scripts/gerar-catalogo-simbologia.mjs` gera
`frontend/simbolos-catalogo.js`, que é o que o app importa.

## Por que baixado e versionado, e não buscado ao vivo

Decisão da Etapa 9b, item 2. Três razões, na ordem em que pesaram:

1. **Campo sem rede.** O app é usado em exercício, onde a rede oscila — é a
   premissa que já motivou o mapa offline (Etapa 8a) e que fez `REPO_RAW`
   deixar de apontar para `raw.githubusercontent.com` na Etapa 11. Depender de
   `simbologia.eb.mil.br` estar no ar para o aluno conseguir marcar um
   elemento seria criar um ponto de falha novo exatamente onde o projeto vinha
   removendo pontos de falha.
2. **CORS.** Os arquivos são servidos para o próprio portal; não há garantia
   nenhuma de `Access-Control-Allow-Origin` para outra origem.
3. **Estabilidade do formato.** Não é uma API versionada — é o *bundle* de uma
   SPA. O nome do arquivo tem um hash que muda a cada publicação, e a forma do
   conteúdo (chunk de webpack) pode mudar numa reconstrução do portal sem
   aviso nenhum. Buscar isso em tempo de execução é acoplar o app a um detalhe
   de build de terceiros.

O custo dessa decisão é conhecido e aceito: **o catálogo aqui é uma
fotografia**. Atualizar exige alguém com rede rodando a captura de novo (o
procedimento está logo abaixo) e revendo o diff.

## Como recapturar (quando o portal publicar uma versão nova)

O passo que depende da rede é manual e roda **no navegador**, porque os dados
não são JSON servido direto — precisam ser extraídos de dentro do chunk de
webpack.

1. Abra <https://simbologia.eb.mil.br/> e o console do navegador (F12).
2. Cole o trecho abaixo. Ele descobre os 12 arquivos pelos `<link>` da própria
   página, baixa cada um, confere o SHA-256, executa o chunk num `window`
   falso para recuperar o objeto exportado e monta o extrato normalizado:

```js
// 1. helper que "roda" um chunk de webpack e devolve o objeto exportado
const extrair = (texto) => {
  const cap = [];
  const fake = { webpackJsonp: { push: (arr) => {
    const mods = arr[1];
    for (const k in mods) { const m = {}; mods[k](m); cap.push(m.exports); }
  } } };
  new Function('window', texto)(fake);
  return cap[0];
};

// 2. baixa os 12, com hash
const arquivos = [...document.querySelectorAll('link')]
  .map((l) => l.href).filter((h) => h.includes('symbolSet'))
  .map((h) => ({ url: h, cat: h.match(/symbolSet-(.+?)-json\./)[1] }));
const cru = {};
for (const a of arquivos) {
  const buf = await (await fetch(a.url)).arrayBuffer();
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  cru[a.cat] = { url: a.url, bytes: buf.byteLength, sha256: sha,
                 dados: extrair(new TextDecoder().decode(buf)) };
}
console.table(Object.entries(cru).map(([k, v]) => ({ cat: k, bytes: v.bytes, sha256: v.sha256 })));

// 3. normaliza: só o que o app usa, e só o que tem SIDC de 20 dígitos
const mods = (arr, campo) => {
  if (!arr) return [];
  const out = [], vistos = new Set();
  for (const m of arr) {
    const cod = String(m.Code ?? '').replace(/\D/g, '');
    if (cod === '') continue;
    const c = cod.padStart(2, '0');
    if (c.length > 2 || c === '99' || vistos.has(c)) continue; // 99 = "Version Extension Flag", não é modificador
    vistos.add(c);
    const br = (m['Correspondência no Brasil'] || '').trim();
    out.push([c, c === '00' ? 'Não especificado' : (br || (m[campo] || '').trim())]);
  }
  return out;
};
const extrato = Object.entries(cru).map(([cat, v]) => {
  const itens = (v.dados['icones_centrais'] || [])
    .filter((e) => e.Extension == null && /^[0-9]{20}$/.test(String(e.sidcBR)));
  const g = [];
  for (const e of itens) {
    let grupo = g.find((x) => x.e === e.Entity);
    if (!grupo) { grupo = { e: e.Entity, i: [] }; g.push(grupo); }
    grupo.i.push([String(e.sidcBR).slice(10, 16), e.NomeBR]);
  }
  return { id: cat, ss: String(itens[0].sidcBR).slice(4, 6), g,
           m1: mods(v.dados['sector 1'], 'First Modifier'),
           m2: mods(v.dados['sector 2'], 'Second Modifier') };
}).sort((a, b) => a.id.localeCompare(b.id));

// 4. e as extensões nacionais, que ficam de fora do formulário
const ext = [];
for (const [cat, v] of Object.entries(cru))
  for (const e of (v.dados['icones_centrais'] || []))
    if (e.Extension != null) ext.push([cat, String(e.sidcBR), e.NomeBR]);

copy(JSON.stringify(extrato, null, 1));   // -> catalogo-extraido.json
// copy(JSON.stringify(ext, null, 1));    // -> extensoes-br.json (rode depois)
```

3. Salve o conteúdo copiado sobre `catalogo-extraido.json` (e, repetindo com a
   outra linha `copy(...)`, sobre `extensoes-br.json`).
4. Atualize a tabela de SHA-256 e a data desta página com o que o
   `console.table` mostrou.
5. Rode `node scripts/gerar-catalogo-simbologia.mjs` e depois as suítes
   (`node frontend/simbolos.teste.mjs`, `node frontend/marcacoes.teste.mjs`).
   O gerador **falha em vez de gerar** se aparecer uma categoria ou um grupo
   `Entity` sem rótulo em português — o rótulo novo tem que ser acrescentado à
   mão em `NOME_CATEGORIA`/`NOME_GRUPO` no próprio gerador. É de propósito:
   um catálogo novo com nome faltando deve parar a construção, não entrar no
   formulário com o rótulo em inglês.

## O que ficou de fora, e por quê

- **Os 63 ícones de extensão nacional** (`ExtEntity`/`Extension`) — SIDC de
  **30** dígitos, não 20. `perfis.sidc` e `elementos_marcados.sidc` têm
  `check (sidc ~ '^[0-9]{20}$')` desde a `0001`, e a `milsymbol` desenha
  APP-6D de 20 dígitos (o glifo brasileiro o portal serve como PNG pronto).
  Truncar para 20 seria pior do que omitir: vários rótulos diferentes
  ("Forças Especiais", "Precursores Paraquedistas") colapsariam no mesmo
  símbolo, e o aluno veria um nome escolhido virar outro desenho.
  Estão listados em `extensoes-br.json` e em `EXTENSOES_BR_NAO_SUPORTADAS`
  (`frontend/simbolos-catalogo.js`) para a etapa que resolver isso não
  precisar recapturar o portal.
- **`Doutrina FS`** — exemplos de emprego doutrinário, com as imagens
  prontas. É material de consulta, não tabela de montagem de SIDC.
- **`ModificadoresEB`** — presente em 4 das 12 categorias, com um formato
  irregular (colunas `__EMPTY_1`/`__EMPTY_3`, resquício da planilha de
  origem) e sem código de SIDC associado. Não dá para montar SIDC a partir
  dele sem inventar mapeamento; ficou de fora até haver um caso de uso
  concreto.
- **`symbolWidth` / `symbolHeight` / `sheetRowNumber` / `br_symbol`** —
  layout e imagem, não dado.
