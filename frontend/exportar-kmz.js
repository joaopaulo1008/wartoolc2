// exportar-kmz.js — monta o KML das marcações da turma (módulo PURO).
//
// O QUE FAZ: recebe linhas de `elementos_marcados` e `anotacoes`, os partidos
// e os autores, e devolve o texto do KML, com uma pasta por força e, dentro de
// cada uma, uma pasta por categoria de símbolo. Quem desenha os ícones e
// empacota o zip é exportar-kmz-tela.js; aqui não há DOM, canvas nem rede, e
// por isso a suíte roda no Node (exportar-kmz.teste.mjs).
//
// A COR DO ÍCONE É FIXA, NÃO RELATIVA. No mapa, a hostilidade é derivada de
// quem olha (Etapa 4.5) — mas um arquivo exportado não tem observador, e vai
// ser aberto por gente de qualquer força. Valeu a mesma referência que o
// painel do instrutor já usa para quem não tem partido (hostilidadeRelativa
// com observador nulo): o partido de menor `ordem` — Azul, por padrão — é
// amigo, qualquer outro beligerante é hostil, neutro é neutro. Marcação sem
// partido sai como DESCONHECIDO: é uma afirmação verdadeira ("não sei de quem
// é"), e não um azul ou vermelho chutado.
//
// PARTIDO SEM `ordem` (embed antigo): hostilidadeRelativa devolve null e o
// SIDC sai como está gravado, cujo dígito de hostilidade é PLACEHOLDER. É a
// mesma escolha de simbolos.js — melhor um ícone amarelo do que uma cor errada.
//
// O QUE NÃO ENTRA: pedidos de apoio e situações. São estado volátil do
// exercício (ficam vigentes, são encerrados, respondidos), com RLS própria
// copiada de `posicoes_ler`; um arquivo estático os congelaria num instante e
// pareceria o estado atual. Se for necessário, é uma segunda exportação, com
// o carimbo de hora em destaque.

import {
  hostilidadeRelativa, aplicarHostilidade, decomporSidc, descreverSidc, categoriaPorId,
} from './simbolos.js';
import { escaparHtml } from './kml.js';

const COMPARADOR = new Intl.Collator('pt-BR');
const SEM_FORCA = 'Sem força definida';
const SEM_CATEGORIA = 'Outros';
const FUSO = 'America/Sao_Paulo';

// ── Utilidades de texto ────────────────────────────────────────────────────

// XML 1.0 não admite a maioria dos caracteres de controle nem dentro de CDATA
// — e `titulo`/`texto` vêm de gente digitando, ou colando, num celular. Um
// único \u0000 deixaria o arquivo inteiro ilegível para o QGIS.
// eslint-disable-next-line no-control-regex
const CONTROLE_PROIBIDO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escaparXml(texto) {
  return String(texto ?? '')
    .replace(CONTROLE_PROIBIDO, '')
    .replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
    ));
}

// `]]>` termina um CDATA. O conteúdo que passa por aqui já saiu de
// escaparHtml (que troca `>`), então não deveria conter a sequência — a
// proteção existe para quem, um dia, passar texto cru.
//
// O controle proibido também precisa sair daqui: o CDATA não o aceita, e foi o
// parser que pegou — escaparHtml escapa `<` e `&`, mas deixa passar \u0000.
function cdata(html) {
  const limpo = String(html).replace(CONTROLE_PROIBIDO, '');
  return `<![CDATA[${limpo.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

// KML usa aabbggrr, ao contrário do `#rrggbb` do resto do projeto.
export function corKml(hex, alfa = 'ff') {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex || '');
  if (!m) return `${alfa}ffffff`;
  return `${alfa}${m[3]}${m[2]}${m[1]}`.toLowerCase();
}

export function formatarData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(',', '');
}

function semAcento(texto) {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Nome do arquivo baixado. Carimbo em horário de Brasília, não UTC — é o que a
// pessoa vê no relógio ao baixar, e o que ela procura na pasta depois.
export function nomeDoArquivo(turmaNome, quando = new Date(), extensao = 'kmz') {
  const slug = semAcento(turmaNome).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(quando).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  const hora = partes.hour === '24' ? '00' : partes.hour;
  const carimbo = `${partes.year}${partes.month}${partes.day}-${hora}${partes.minute}`;
  return `wartoolc2-marcacoes${slug ? `-${slug}` : ''}-${carimbo}.${extensao}`;
}

// ── Cor do símbolo ─────────────────────────────────────────────────────────

export function hostilidadeDaExportacao(partido) {
  if (!partido || !partido.id) return 'DESCONHECIDO';
  return hostilidadeRelativa(null, partido);   // null se o partido não traz `ordem`
}

export function sidcDeExportacao(sidc, partido) {
  const h = hostilidadeDaExportacao(partido);
  return h ? aplicarHostilidade(sidc, h) : sidc;
}

function indexarPartidos(partidos) {
  return new Map((partidos || []).map((p) => [p.id, p]));
}

// Os SIDCs finais que o chamador precisa desenhar — um ícone por SIDC, e não
// por marcação: quarenta marcações de "Carro de Combate" azul são um arquivo.
export function sidcsParaIcones(elementos, partidos) {
  const porId = indexarPartidos(partidos);
  const unicos = new Set();
  for (const e of elementos || []) {
    if (!/^[0-9]{20}$/.test(e.sidc || '')) continue;
    unicos.add(sidcDeExportacao(e.sidc, porId.get(e.partido_id)));
  }
  return [...unicos];
}

// ── Montagem ───────────────────────────────────────────────────────────────

function coordenadaValida(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function nomeDoAutor(autores, id) {
  const a = (autores || []).find((u) => u.id === id);
  if (!a) return '';
  const nome = a.nome_guerra || a.nome_completo || '';
  return a.posto_graduacao ? `${a.posto_graduacao} ${nome}`.trim() : nome;
}

function linha(rotulo, valor) {
  if (valor === '' || valor == null) return '';
  return `<tr><td><b>${escaparHtml(rotulo)}</b></td><td>${escaparHtml(valor)}</td></tr>`;
}

function dado(nome, valor) {
  if (valor === '' || valor == null) return '';
  return `<Data name="${escaparXml(nome)}"><value>${escaparXml(valor)}</value></Data>`;
}

function numero(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function estiloDoIcone(id, icone) {
  const { largura, altura, ancora } = icone;
  // hotSpot em FRAÇÃO da imagem, medida a partir do canto INFERIOR esquerdo —
  // por isso o `1 - y`. Em pixels o ponto estaria certo só para uma resolução
  // de PNG, e o ícone sairia deslocado se a escala de desenho mudasse.
  const x = largura ? (ancora.x / largura).toFixed(4) : '0.5';
  const y = altura ? (1 - ancora.y / altura).toFixed(4) : '0.5';
  // `escala` existe porque o PNG é desenhado em resolução dobrada (nítido ao dar
  // zoom na tela) e o KML mede o ícone em pixels da imagem: sem escala 0.5 ele
  // apareceria com o dobro do tamanho. SVG não tem esse problema.
  return `<Style id="${id}"><IconStyle><scale>${icone.escala ?? 1}</scale>`
    + `<Icon><href>${escaparXml(icone.href)}</href></Icon>`
    + `<hotSpot x="${x}" y="${y}" xunits="fraction" yunits="fraction"/>`
    + `</IconStyle><LabelStyle><scale>0.9</scale></LabelStyle></Style>`;
}

function placemarkDeElemento(e, { partido, autores, icones, estilos }) {
  const lat = numero(e.latitude);
  const lon = numero(e.longitude);
  const sidcFinal = sidcDeExportacao(e.sidc, partido);
  const tipo = descreverSidc(sidcFinal);
  const titulo = String(e.titulo || '').trim();
  const nome = titulo || tipo || 'Marcação';
  const forca = partido ? partido.nome : SEM_FORCA;
  const autor = nomeDoAutor(autores, e.autor_id);
  const alt = numero(e.altitude_m);
  const frente = numero(e.frente_m);
  const prof = numero(e.profundidade_m);
  const fonteAlt = e.altitude_fonte === 'mde' ? 'modelo digital de elevação' : 'informada pelo observador';
  const coordenadas = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

  const icone = icones && icones.get(sidcFinal);
  let estilo = '';
  if (icone) {
    const id = `i${sidcFinal}`;
    if (!estilos.has(id)) estilos.set(id, estiloDoIcone(id, icone));
    estilo = `<styleUrl>#${id}</styleUrl>`;
  }

  const tabela = [
    linha('Símbolo', tipo),
    linha('Designação', titulo && titulo !== tipo ? titulo : ''),
    linha('Força', forca),
    linha('Coordenadas', coordenadas),
    linha('Altitude', alt != null ? `${alt} m (${fonteAlt})` : ''),
    linha('Frente × profundidade', (frente != null || prof != null)
      ? `${frente != null ? `${frente} m` : '—'} × ${prof != null ? `${prof} m` : '—'}` : ''),
    linha('Marcado por', autor),
    linha('Marcado em', formatarData(e.criada_em)),
    linha('Editado em', e.editada_em ? formatarData(e.editada_em) : ''),
    linha('SIDC', sidcFinal),
  ].join('');

  const categoriaId = decomporSidc(e.sidc).categoriaId;
  const categoria = categoriaId ? (categoriaPorId(categoriaId)?.nome || SEM_CATEGORIA) : SEM_CATEGORIA;

  const extendida = [
    dado('designacao', titulo), dado('simbolo', tipo), dado('forca', forca),
    dado('categoria', categoria), dado('sidc', sidcFinal),
    dado('altitude_m', alt), dado('altitude_fonte', alt != null ? (e.altitude_fonte || 'manual') : ''),
    dado('frente_m', frente), dado('profundidade_m', prof),
    dado('autor', autor), dado('criada_em', e.criada_em || ''), dado('editada_em', e.editada_em || ''),
    // O nome do arquivo de ícone vira atributo: no QGIS é o que permite um
    // marcador SVG com caminho definido por dados (ver exportar-kmz-tela.js).
    dado('icone', icone ? icone.href : ''),
  ].join('');

  const xml = `<Placemark><name>${escaparXml(nome)}</name>`
    + `<description>${cdata(`<table>${tabela}</table>`)}</description>`
    + `${estilo}<ExtendedData>${extendida}</ExtendedData>`
    + `<Point><coordinates>${lon.toFixed(7)},${lat.toFixed(7)},0</coordinates></Point></Placemark>`;
  return { xml, categoria };
}

function placemarkDeAnotacao(a, { partidoDe, autores, estilos }) {
  const lat = numero(a.latitude);
  const lon = numero(a.longitude);
  const corHex = /^#[0-9a-fA-F]{6}$/.test(a.cor || '') ? a.cor : '#f5c842';
  const id = `a${corHex.slice(1).toLowerCase()}`;
  if (!estilos.has(id)) {
    // Anotação é TEXTO sobre o mapa, sem ícone: o marcador é escondido
    // (scale 0) e o rótulo carrega a cor que o instrutor escolheu.
    estilos.set(id, `<Style id="${id}"><IconStyle><scale>0</scale></IconStyle>`
      + `<LabelStyle><color>${corKml(corHex)}</color><scale>1.1</scale></LabelStyle></Style>`);
  }
  const partido = partidoDe(a.partido_id);
  const alcance = partido ? partido.nome : 'Turma inteira';
  const autor = nomeDoAutor(autores, a.autor_id);
  const tabela = [
    linha('Texto', a.texto),
    linha('Visível para', alcance),
    linha('Coordenadas', `${lat.toFixed(6)}, ${lon.toFixed(6)}`),
    linha('Escrito por', autor),
    linha('Escrito em', formatarData(a.criada_em)),
  ].join('');
  const extendida = [
    dado('texto', a.texto), dado('visivel_para', alcance),
    dado('autor', autor), dado('criada_em', a.criada_em || ''),
  ].join('');
  return `<Placemark><name>${escaparXml(a.texto)}</name>`
    + `<description>${cdata(`<table>${tabela}</table>`)}</description>`
    + `<styleUrl>#${id}</styleUrl><ExtendedData>${extendida}</ExtendedData>`
    + `<Point><coordinates>${lon.toFixed(7)},${lat.toFixed(7)},0</coordinates></Point></Placemark>`;
}

const porCriacao = (a, b) => String(a.criada_em || '').localeCompare(String(b.criada_em || ''));

// `icones`: Map(sidcFinal -> { href, largura, altura, ancora: {x, y}, escala? }). Sem
// entrada para um SIDC, a marcação sai sem estilo (o Earth põe o alfinete
// padrão) — o arquivo continua válido e a informação não se perde.
export function montarKml({
  elementos = [], anotacoes = [], partidos = [], autores = [], icones = null,
  turmaNome = '', geradoEm = new Date(),
} = {}) {
  const porId = indexarPartidos(partidos);
  const estilos = new Map();
  let ignorados = 0;

  // Agrupa: força -> categoria -> placemarks.
  const forcas = new Map();   // chave (id do partido | '') -> Map(categoria -> xml[])
  const contagemForca = new Map();
  let totalElementos = 0;

  const validos = (elementos || []).filter((e) => {
    const ok = coordenadaValida(numero(e.latitude), numero(e.longitude))
      && /^[0-9]{20}$/.test(e.sidc || '');
    if (!ok) ignorados += 1;
    return ok;
  }).sort(porCriacao);

  for (const e of validos) {
    const partido = porId.get(e.partido_id) || null;
    const chave = partido ? partido.id : '';
    const { xml, categoria } = placemarkDeElemento(e, { partido, autores, icones, estilos });
    if (!forcas.has(chave)) forcas.set(chave, new Map());
    const cats = forcas.get(chave);
    if (!cats.has(categoria)) cats.set(categoria, []);
    cats.get(categoria).push(xml);
    contagemForca.set(chave, (contagemForca.get(chave) || 0) + 1);
    totalElementos += 1;
  }

  const ordemPartidos = [...porId.values()].sort((a, b) => (
    (a.ordem ?? 999) - (b.ordem ?? 999) || COMPARADOR.compare(a.nome, b.nome)
  ));
  const chavesEmOrdem = [...ordemPartidos.map((p) => p.id), ''];

  const pastas = [];
  for (const chave of chavesEmOrdem) {
    const cats = forcas.get(chave);
    if (!cats) continue;
    const nome = chave ? porId.get(chave).nome : SEM_FORCA;
    const sub = [...cats.keys()].sort(COMPARADOR.compare).map((cat) => (
      `<Folder><name>${escaparXml(`${cat} (${cats.get(cat).length})`)}</name>${cats.get(cat).join('')}</Folder>`
    ));
    pastas.push(`<Folder><name>${escaparXml(`${nome} (${contagemForca.get(chave)})`)}</name>${sub.join('')}</Folder>`);
  }

  const anotacoesValidas = (anotacoes || []).filter((a) => {
    const ok = coordenadaValida(numero(a.latitude), numero(a.longitude)) && String(a.texto || '').trim();
    if (!ok) ignorados += 1;
    return ok;
  }).sort(porCriacao);
  if (anotacoesValidas.length) {
    const itens = anotacoesValidas.map((a) => placemarkDeAnotacao(a, {
      partidoDe: (id) => porId.get(id) || null, autores, estilos,
    }));
    pastas.push(`<Folder><name>${escaparXml(`Anotações (${anotacoesValidas.length})`)}</name>${itens.join('')}</Folder>`);
  }

  const titulo = turmaNome ? `WartoolC2 — ${turmaNome}` : 'WartoolC2';
  const legenda = `Gerado em ${formatarData(geradoEm.toISOString())} (horário de Brasília). `
    + 'Cores fixas: azul = força de referência (amigo), vermelho = demais forças beligerantes (hostil), '
    + 'verde = neutro, amarelo = marcação sem força definida.';

  const kml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
    + `<name>${escaparXml(titulo)}</name>`
    + `<description>${escaparXml(legenda)}</description>`
    + `${[...estilos.values()].join('')}${pastas.join('')}`
    + '</Document></kml>\n';

  return {
    kml,
    contagem: { elementos: totalElementos, anotacoes: anotacoesValidas.length, ignorados },
  };
}
