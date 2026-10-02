// zip-simples.js — escreve um .zip sem compressão (método STORE).
//
// POR QUE EXISTE: o KMZ de exportação (exportar-kmz.js) é um zip com o
// `doc.kml` na frente e os ícones ao lado. Para LER zip o projeto já carrega o
// fflate sob demanda (kml-navegador.js, via esm.sh) — mas para ESCREVER um zip
// de dezenas de arquivos pequenos, trazer uma biblioteca da rede só para
// guardar bytes sem comprimir não se justifica, e exportar não pode depender de
// um CDN respondendo. STORE é zip válido; o Google Earth, o QGIS e qualquer
// descompactador abrem.
//
// O QUE NÃO FAZ: não comprime (o KML é texto e comprimiria bem; o ganho não
// compensa a segunda via de código), não faz zip64 (teto de 4 GB e 65 535
// entradas — um KMZ de marcações não chega perto) e não grava diretórios.
//
// PURO: sem DOM, sem rede. Testado em exportar-kmz.teste.mjs, inclusive contra
// um descompactador de verdade.

const codificador = new TextEncoder();

// Tabela do CRC-32 (polinômio 0xEDB88320), montada uma vez.
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Data/hora no formato do MS-DOS, que é o que o zip guarda. Antes de 1980 o
// formato não representa; o piso evita escrever lixo.
function dataDos(data) {
  const ano = Math.max(1980, data.getFullYear());
  const hora = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1);
  const dia = ((ano - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
  return { hora, dia };
}

function paraBytes(dados) {
  return typeof dados === 'string' ? codificador.encode(dados) : dados;
}

// `arquivos`: [{ nome: 'doc.kml', dados: string | Uint8Array }]. A ordem é
// preservada — KMZ exige o KML principal primeiro.
export function criarZip(arquivos, { data = new Date() } = {}) {
  const { hora, dia } = dataDos(data);
  const partes = [];
  const diretorio = [];
  let deslocamento = 0;

  for (const arq of arquivos) {
    const nome = codificador.encode(arq.nome);
    const dados = paraBytes(arq.dados);
    const crc = crc32(dados);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);       // bit 11: nome em UTF-8
    local.setUint16(8, 0, true);            // método 0 = STORE
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dados.length, true);
    local.setUint32(22, dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nome, dados);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, hora, true);
    central.setUint16(14, dia, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, dados.length, true);
    central.setUint32(24, dados.length, true);
    central.setUint16(28, nome.length, true);
    central.setUint32(42, deslocamento, true);
    diretorio.push(new Uint8Array(central.buffer), nome);

    deslocamento += 30 + nome.length + dados.length;
  }

  const tamanhoDiretorio = diretorio.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true);
  fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoDiretorio, true);
  fim.setUint32(16, deslocamento, true);

  const todas = [...partes, ...diretorio, new Uint8Array(fim.buffer)];
  const saida = new Uint8Array(todas.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of todas) { saida.set(p, pos); pos += p.length; }
  return saida;
}
