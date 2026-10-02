// Teste de frontend/exportar-kmz.js e frontend/zip-simples.js.
//
//     node frontend/exportar-kmz.teste.mjs
//
// O que ele prova, e por que cada coisa está aqui:
//
//   1. A COR FIXA É A QUE O INSTRUTOR PEDIU: Azul amigo, Vermelho hostil. Um
//      erro aqui não quebra nada — exporta uma força inimiga em azul, e quem
//      abre o arquivo no QGIS confia na cor. Por isso cada forma de partido
//      (beligerante de ordem 1 e 2, neutro, ausente, sem `ordem`) tem seu caso.
//   2. A ORDEM DAS COORDENADAS. KML é lon,lat; o banco e o Leaflet são
//      lat,lon. Trocar não gera erro: leva o ponto para outro continente.
//   3. O ARQUIVO É XML BEM FORMADO, mesmo com texto digitado por gente. Título
//      com `<`, `&` e caractere de controle, que é o que um celular produz.
//      Conferido por um parser de verdade (python), não por regex.
//   4. O ZIP ABRE EM UM DESCOMPACTADOR DE VERDADE, na ordem certa (doc.kml
//      primeiro) e com o conteúdo idêntico. O CRC-32 é conferido contra o valor
//      de referência do padrão.
//   5. O QUE FICOU DE FORA fica declarado: linha inválida é contada em
//      `ignorados`, não engolida em silêncio.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  escaparXml, corKml, formatarData, nomeDoArquivo, hostilidadeDaExportacao,
  sidcDeExportacao, sidcsParaIcones, montarKml,
} from './exportar-kmz.js';
import { crc32, criarZip } from './zip-simples.js';

let passou = 0;
let falhou = 0;
const falhas = [];
function caso(nome, fn) {
  try { fn(); passou += 1; } catch (e) { falhou += 1; falhas.push(`${nome}: ${e.message}`); }
}
function igual(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
}
function verdade(v, msg = '') { if (!v) throw new Error(msg || 'esperado verdadeiro'); }

const AZUL = { id: 'p1', nome: 'Azul', tipo: 'beligerante', ordem: 1, cor: '#4a90d9' };
const VERMELHO = { id: 'p2', nome: 'Vermelho', tipo: 'beligerante', ordem: 2, cor: '#d94a4a' };
const VERDE = { id: 'p3', nome: 'Civis', tipo: 'neutro', ordem: 3, cor: '#4ad96a' };
const ANTIGO = { id: 'p4', nome: 'Antigo', tipo: 'beligerante', cor: '#999999' };   // sem `ordem`
const PARTIDOS = [VERMELHO, AZUL, VERDE];

// Infantaria (symbol set 10, unidade) e carro de combate — dois SIDCs válidos.
// Os dígitos 3-4 (hostilidade) são o PLACEHOLDER '01', como no banco.
const INF = '10011000001211000000';
const CC = '10011000001205000000';
const digitosHostilidade = (s) => s.slice(2, 4);

// ── 1. Cor fixa ────────────────────────────────────────────────────────────
caso('azul de ordem 1 é amigo', () => {
  igual(hostilidadeDaExportacao(AZUL), 'AMIGO');
  igual(digitosHostilidade(sidcDeExportacao(INF, AZUL)), '03');
});
caso('vermelho de ordem 2 é hostil', () => {
  igual(hostilidadeDaExportacao(VERMELHO), 'HOSTIL');
  igual(digitosHostilidade(sidcDeExportacao(INF, VERMELHO)), '06');
});
caso('partido neutro sai neutro', () => {
  igual(digitosHostilidade(sidcDeExportacao(INF, VERDE)), '04');
});
caso('sem partido sai desconhecido, não azul nem vermelho', () => {
  igual(hostilidadeDaExportacao(null), 'DESCONHECIDO');
  igual(digitosHostilidade(sidcDeExportacao(INF, null)), '01');
});
caso('partido sem ordem preserva o SIDC gravado em vez de chutar cor', () => {
  igual(hostilidadeDaExportacao(ANTIGO), null);
  igual(sidcDeExportacao(INF, ANTIGO), INF);
});
caso('só os dígitos 3-4 mudam', () => {
  const fim = sidcDeExportacao(INF, VERMELHO);
  igual(fim.slice(0, 2) + fim.slice(4), INF.slice(0, 2) + INF.slice(4));
});
caso('um ícone por SIDC final, não por marcação', () => {
  const els = [
    { sidc: INF, partido_id: 'p1' }, { sidc: INF, partido_id: 'p1' },
    { sidc: INF, partido_id: 'p2' }, { sidc: CC, partido_id: 'p1' },
    { sidc: 'lixo', partido_id: 'p1' },
  ];
  igual(sidcsParaIcones(els, PARTIDOS).length, 3);
});

// ── Texto ──────────────────────────────────────────────────────────────────
caso('escaparXml escapa e remove caractere de controle', () => {
  igual(escaparXml('a<b>&"\'\u0000\u0007c'), 'a&lt;b&gt;&amp;&quot;&apos;c');
});
caso('corKml inverte para aabbggrr', () => {
  igual(corKml('#f5c842'), 'ff42c8f5');
  igual(corKml('lixo'), 'ffffffff');
});
caso('data em horário de Brasília', () => {
  igual(formatarData('2026-10-02T17:05:00Z'), '02/10/2026 14:05');
  igual(formatarData('x'), '');
});
caso('nome do arquivo com turma sem acento e carimbo local', () => {
  igual(nomeDoArquivo('Turma Açaí — 2026', new Date('2026-10-02T17:05:00Z')),
    'wartoolc2-marcacoes-turma-acai-2026-20261002-1405.kmz');
  igual(nomeDoArquivo('', new Date('2026-10-02T03:00:00Z')),
    'wartoolc2-marcacoes-20261002-0000.kmz');
});

// ── 2/3. KML ───────────────────────────────────────────────────────────────
const ICONE = { href: 'icones/x.png', largura: 40, altura: 50, ancora: { x: 20, y: 40 } };
const icones = new Map([
  [sidcDeExportacao(INF, AZUL), { ...ICONE, href: `icones/${sidcDeExportacao(INF, AZUL)}.png` }],
]);
const elementos = [
  { id: 'e1', sidc: INF, partido_id: 'p1', titulo: '1º Pel <Alfa> & cia\u0000', latitude: -25.0954, longitude: -50.1617,
    altitude_m: 880.5, altitude_fonte: 'manual', frente_m: 300, profundidade_m: 150, autor_id: 'u1',
    criada_em: '2026-10-02T17:05:00Z', editada_em: null },
  { id: 'e2', sidc: CC, partido_id: 'p2', titulo: '', latitude: -25.1, longitude: -50.2, autor_id: 'u1',
    criada_em: '2026-10-02T17:10:00Z' },
  { id: 'e3', sidc: INF, partido_id: null, titulo: 'Contato', latitude: -25.2, longitude: -50.3,
    criada_em: '2026-10-02T17:12:00Z' },
  { id: 'e4', sidc: INF, partido_id: 'p1', titulo: 'sem coordenada', latitude: null, longitude: -50 },
  { id: 'e5', sidc: 'quebrado', partido_id: 'p1', titulo: 'sidc ruim', latitude: -25, longitude: -50 },
];
const anotacoes = [
  { id: 'a1', texto: 'Linha de controle <LC1>', latitude: -25.15, longitude: -50.25, cor: '#f5c842',
    partido_id: null, autor_id: 'u1', criada_em: '2026-10-02T17:20:00Z' },
];
const autores = [{ id: 'u1', nome_guerra: 'Silva', posto_graduacao: 'Cap' }];
const { kml, contagem } = montarKml({
  elementos, anotacoes, partidos: PARTIDOS, autores, icones, turmaNome: 'Turma A',
  geradoEm: new Date('2026-10-02T18:00:00Z'),
});

caso('contagem declara o que entrou e o que ficou de fora', () => {
  igual(contagem.elementos, 3);
  igual(contagem.anotacoes, 1);
  igual(contagem.ignorados, 2);
});
caso('coordenadas saem como lon,lat', () => {
  verdade(kml.includes('<coordinates>-50.1617000,-25.0954000,0</coordinates>'));
});
caso('pastas: Azul, Vermelho, sem força e Anotações, nessa ordem', () => {
  const ordem = ['Azul (1)', 'Vermelho (1)', 'Sem força definida (1)', 'Anotações (1)']
    .map((n) => kml.indexOf(`<name>${n}</name>`));
  verdade(ordem.every((i) => i > 0), `ausente: ${ordem}`);
  verdade(ordem.every((v, i) => i === 0 || v > ordem[i - 1]), `fora de ordem: ${ordem}`);
});
caso('subpasta por categoria dentro da força', () => {
  verdade(/<Folder><name>Azul \(1\)<\/name><Folder><name>[^<]+ \(1\)<\/name><Placemark>/.test(kml));
});
caso('título sem designação usa o nome do símbolo', () => {
  verdade(!kml.includes('<name></name>'));
});
caso('descrição traz altitude, dimensões, autor e data em CDATA', () => {
  verdade(kml.includes('880.5 m (informada pelo observador)'));
  verdade(kml.includes('300 m × 150 m'));
  verdade(kml.includes('Cap Silva'));
  verdade(kml.includes('02/10/2026 14:05'));
  verdade(kml.includes('<![CDATA['));
});
caso('texto do usuário não vira marcação', () => {
  verdade(!kml.includes('<Alfa>'));
  verdade(kml.includes('&lt;Alfa&gt; &amp; cia'));
  verdade(!kml.includes('\u0000'));
});
caso('estilo com hotSpot em fração, a partir do canto inferior', () => {
  verdade(kml.includes('<hotSpot x="0.5000" y="0.2000" xunits="fraction" yunits="fraction"/>'));
});
caso('escala do ícone entra no estilo (PNG em resolução dobrada)', () => {
  const r = montarKml({
    elementos: [elementos[0]], partidos: PARTIDOS,
    icones: new Map([[sidcDeExportacao(INF, AZUL), { ...ICONE, escala: 0.5 }]]),
  });
  verdade(r.kml.includes('<IconStyle><scale>0.5</scale>'));
});
caso('SIDC sem ícone sai sem styleUrl, mas sai', () => {
  const vermelho = kml.slice(kml.indexOf('<name>Vermelho (1)</name>'), kml.indexOf('<name>Sem força'));
  verdade(vermelho.includes('<Placemark>') && !vermelho.includes('styleUrl'));
});
caso('o SIDC exportado carrega a cor fixa, não o placeholder', () => {
  verdade(kml.includes(`<Data name="sidc"><value>${sidcDeExportacao(INF, AZUL)}</value></Data>`));
  verdade(kml.includes(`<Data name="sidc"><value>${sidcDeExportacao(CC, VERMELHO)}</value></Data>`));
});
caso('anotação: rótulo com a cor escolhida e marcador escondido', () => {
  verdade(kml.includes('<color>ff42c8f5</color>'));
  verdade(kml.includes('<scale>0</scale>'));
  verdade(kml.includes('Linha de controle &lt;LC1&gt;'));
});
caso('entrada vazia dá documento válido, sem pastas', () => {
  const r = montarKml({});
  verdade(r.kml.includes('<Document>') && !r.kml.includes('<Folder>'));
  igual(r.contagem.elementos, 0);
});

// ── 4. Zip ─────────────────────────────────────────────────────────────────
caso('crc32 bate com o valor de referência do padrão', () => {
  igual(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

const python = spawnSync('python3', ['-c', 'import zipfile, xml.dom.minidom']);
const temPython = python.status === 0;

if (temPython) {
  const dir = mkdtempSync(join(tmpdir(), 'kmz-teste-'));
  try {
    const binario = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 1, 2, 3]);
    const zip = criarZip([
      { nome: 'doc.kml', dados: kml },
      { nome: 'icones/ação.png', dados: binario },
      { nome: 'vazio.txt', dados: '' },
    ]);
    const arq = join(dir, 'x.kmz');
    writeFileSync(arq, zip);
    writeFileSync(join(dir, 'doc.kml'), kml);
    const saida = spawnSync('python3', ['-c', `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
print(json.dumps({"ruim": z.testzip(), "nomes": z.namelist(),
  "kml_igual": z.read("doc.kml").decode("utf-8") == open(sys.argv[2], encoding="utf-8").read(),
  "bin": list(z.read("icones/ação.png")), "vazio": len(z.read("vazio.txt"))}))
`, arq, join(dir, 'doc.kml')], { encoding: 'utf8' });

    caso('python abre o zip sem erro de CRC', () => {
      verdade(saida.status === 0, saida.stderr);
      igual(JSON.parse(saida.stdout).ruim, null);
    });
    caso('doc.kml vem primeiro e o conteúdo é idêntico', () => {
      const r = JSON.parse(saida.stdout);
      igual(r.nomes[0], 'doc.kml');
      igual(r.kml_igual, true);
    });
    caso('nome com acento e binário atravessam o zip intactos', () => {
      const r = JSON.parse(saida.stdout);
      verdade(r.nomes.includes('icones/ação.png'));
      igual(r.bin.join(','), '137,80,78,71,0,255,1,2,3');
      igual(r.vazio, 0);
    });
    caso('o KML é XML bem formado (parser de verdade)', () => {
      const p = spawnSync('python3', ['-c',
        'import sys, xml.dom.minidom as m; m.parse(sys.argv[1])', join(dir, 'doc.kml')],
      { encoding: 'utf8' });
      verdade(p.status === 0, p.stderr);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.log('AVISO: python3 ausente — os 4 casos de zip/XML contra descompactador real foram PULADOS.');
}

const total = passou + falhou;
for (const f of falhas) console.log(`FALHOU  ${f}`);
console.log(`${passou} passaram, ${falhou} falharam de ${total}`);
process.exit(falhou ? 1 : 0);
