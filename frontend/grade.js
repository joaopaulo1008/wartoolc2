// grade.js — quais linhas de quadrícula existem nesta tela, e como se chamam.
//
// O que este módulo é, e o que ele NÃO é
// --------------------------------------
// Ele responde "dados estes limites e esta largura de tela, quais linhas de
// grade existem, onde passam e que rótulo levam". Não desenha nada: não
// conhece Leaflet, DOM nem Supabase. Quem desenha é `grade-tela.js`.
//
// É o mesmo trio de sempre — `rastro.js`, `visada.js`, `coordenadas.js`,
// `toque-longo.js` — e pela mesma razão: as decisões que erram em silêncio
// aqui são aritméticas (passo escolhido, quantas linhas, onde a zona troca),
// e aritmética se testa em Node. O que sobra para a tela é posicionar pixel.
//
// ── Os dois modos não são a mesma coisa com números diferentes ─────────────
//
// **Geográfica** (lat/lon): no EPSG:3857 que o Leaflet usa, linhas de
// latitude e de longitude constantes são RETAS horizontais e verticais na
// tela. Dois vértices bastam por linha.
//
// **UTM**: linhas de este e de norte constantes NÃO são retas na tela. Elas
// se inclinam pela convergência meridiana — a mesma que `visada.js` calcula
// para corrigir o azimute, e que no Paraná chega a ~0,4°. Numa tela de 1000
// px isso é deslocamento de vários pixels entre o topo e a base: uma linha
// desenhada com dois vértices sairia visivelmente torta em relação à
// verdadeira. Daí `VERTICES_UTM`.
//
// Essa é a razão de a grade UTM ter exigido o UTM INVERSO (`deUtm`, em
// coordenadas.js): uma linha de grade é definida por um valor redondo de
// este, e o Leaflet só entende lat/lon.
//
// ── O piso de 1 km ────────────────────────────────────────────────────────
// Pedido de quem usa: a quadrícula se ajusta ao zoom, mas nunca fica menor
// que 1 km. O piso é ESTRUTURAL, não uma checagem à parte — `PASSOS_UTM_M`
// começa em 1000, e `passoUtm()` só escolhe de dentro dessa lista. Não há
// caminho no código que produza 500 m.
//
// ── O teto de linhas ──────────────────────────────────────────────────────
// Mesma disciplina do teto de 60 rótulos de calco: sem teto, um zoom afastado
// pede milhares de polilinhas e o celular trava. Aqui o teto age SUBINDO o
// passo até caber, em vez de cortar linhas pela metade — uma grade com metade
// das linhas é uma grade errada; uma grade de 10 km onde se pediu 1 km é uma
// grade de 10 km, e o rótulo diz qual é.
import { zonaUtm, bandaUtm, paraUtm, deUtm } from './coordenadas.js';

export const MODOS = ['off', 'utm', 'geo'];
export const MODO_PADRAO = 'off';

// Metros. O primeiro valor É o piso pedido (1 km) — ver o cabeçalho.
export const PASSOS_UTM_M = [1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000];
// Minutos de arco. 1' ≈ 1,85 km na latitude do Brasil, então o primeiro valor
// já respeita o mesmo espírito do piso de 1 km.
export const PASSOS_GEO_MIN = [1, 2, 5, 10, 15, 30, 60, 120];

export const TETO_LINHAS = 60;      // por eixo
export const VERTICES_UTM = 5;      // por linha de grade UTM — ver o cabeçalho

// Quantas linhas se QUER na largura da tela. Uma tela de celular com doze
// linhas é um rabisco; um monitor com quatro é uma grade inútil. Então o alvo
// sai da largura em pixels, não de um número fixo.
export function linhasAlvo(larguraPx) {
  if (!Number.isFinite(larguraPx) || larguraPx <= 0) return 6;
  return Math.max(4, Math.min(12, Math.round(larguraPx / 110)));
}

export function modoValido(modo) {
  return MODOS.includes(modo);
}

// Escolhe o menor passo da lista que não produza mais linhas que o alvo.
// Nunca devolve menos que o primeiro valor da lista — é assim que o piso de
// 1 km é garantido por construção.
function escolherPasso(lista, extensao, alvo) {
  if (!Number.isFinite(extensao) || extensao <= 0) return lista[0];
  const ideal = extensao / Math.max(1, alvo);
  for (const p of lista) if (p >= ideal) return p;
  return lista[lista.length - 1];
}

export function passoUtm(larguraM, alvo = 6) {
  return escolherPasso(PASSOS_UTM_M, larguraM, alvo);
}

export function passoGeo(larguraGraus, alvo = 6) {
  return escolherPasso(PASSOS_GEO_MIN, larguraGraus * 60, alvo);
}

// Os valores redondos de um eixo dentro de um intervalo.
function valoresNoIntervalo(min, max, passo) {
  const primeiro = Math.ceil(min / passo) * passo;
  const fora = [];
  for (let v = primeiro; v <= max; v += passo) fora.push(v);
  return fora;
}

// ── Rótulo de grade UTM: os DÍGITOS PRINCIPAIS ─────────────────────────────
// Em carta militar a linha de quadrícula não é rotulada com o valor inteiro
// (584000) — são os "dígitos principais", os dois algarismos do quilômetro
// que mudam dentro da folha: 584 km vira **84**. É o que se dita no rádio e o
// que se lê na margem da carta, e é por isso que o rótulo curto não é
// economia de espaço: é a convenção.
//
// O valor inteiro não desaparece — ele vai para a legenda do canto, junto com
// a zona, porque dois dígitos sem zona e sem a centena não localizam nada.
// Acima de 100 km de passo os dois dígitos deixam de identificar linha (todas
// acabariam em "00"), então aí o rótulo passa a ser o quilômetro cheio.
export function rotuloUtm(valorM, passoM) {
  if (!Number.isFinite(valorM)) return '';
  const km = Math.round(valorM / 1000);
  if (passoM >= 100000) return String(km);
  return String(((km % 100) + 100) % 100).padStart(2, '0');
}

// Rótulo de grade geográfica: grau e minuto, com a letra do hemisfério. O
// valor é sempre em graus decimais; o minuto só aparece quando não é zero,
// senão "25°00'S" polui uma grade de 1° inteira.
export function rotuloGeo(valorGraus, eixo) {
  if (!Number.isFinite(valorGraus)) return '';
  const letra = eixo === 'lat'
    ? (valorGraus < 0 ? 'S' : 'N')
    : (valorGraus < 0 ? 'W' : 'E');
  const abs = Math.abs(valorGraus);
  const grau = Math.floor(abs + 1e-9);
  const minuto = Math.round((abs - grau) * 60);
  if (minuto === 0) return `${grau}°${letra}`;
  if (minuto === 60) return `${grau + 1}°${letra}`;
  return `${grau}°${String(minuto).padStart(2, '0')}'${letra}`;
}

// ── O ponto de entrada ─────────────────────────────────────────────────────
// limites: { sul, oeste, norte, leste } em graus (o que o Leaflet chama de
//          bounds, mas sem depender da classe dele)
// larguraPx: largura do mapa em pixels, para escolher quantas linhas caber
//
// Devolve sempre um objeto do mesmo formato, inclusive no modo 'off' — quem
// desenha não precisa de dois caminhos.
export function grade({ modo, limites, larguraPx } = {}) {
  const vazia = {
    modo: 'off', linhas: [], zona: null, banda: '', cruzaZona: false,
    passoM: null, passoMin: null, rotuloPasso: '', truncada: false,
  };
  if (!modoValido(modo) || modo === 'off') return vazia;
  if (!limites) return vazia;

  const { sul, oeste, norte, leste } = limites;
  if (![sul, oeste, norte, leste].every(Number.isFinite)) return vazia;
  if (norte <= sul || leste <= oeste) return vazia;

  const alvo = linhasAlvo(larguraPx);
  const latCentro = (sul + norte) / 2;
  const lonCentro = (oeste + leste) / 2;

  if (modo === 'geo') return gradeGeo({ sul, oeste, norte, leste, alvo });
  return gradeUtm({ sul, oeste, norte, leste, alvo, latCentro, lonCentro });
}

function gradeGeo({ sul, oeste, norte, leste, alvo }) {
  const passoMin = passoGeo(leste - oeste, alvo);
  const passoGrau = passoMin / 60;

  const lons = valoresNoIntervalo(oeste, leste, passoGrau).slice(0, TETO_LINHAS);
  const lats = valoresNoIntervalo(sul, norte, passoGrau).slice(0, TETO_LINHAS);
  const truncada =
    valoresNoIntervalo(oeste, leste, passoGrau).length > TETO_LINHAS ||
    valoresNoIntervalo(sul, norte, passoGrau).length > TETO_LINHAS;

  const linhas = [];
  for (const lon of lons) {
    linhas.push({
      eixo: 'lon', valor: lon, rotulo: rotuloGeo(lon, 'lon'),
      pontos: [[sul, lon], [norte, lon]],
    });
  }
  for (const lat of lats) {
    linhas.push({
      eixo: 'lat', valor: lat, rotulo: rotuloGeo(lat, 'lat'),
      pontos: [[lat, oeste], [lat, leste]],
    });
  }

  return {
    modo: 'geo', linhas, zona: null, banda: '', cruzaZona: false,
    passoM: null, passoMin,
    rotuloPasso: passoMin >= 60 ? `${passoMin / 60}°` : `${passoMin}'`,
    truncada,
  };
}

function gradeUtm({ sul, oeste, norte, leste, alvo, latCentro, lonCentro }) {
  const zona = zonaUtm(latCentro, lonCentro);
  if (!zona) {
    return {
      modo: 'utm', linhas: [], zona: null, banda: '', cruzaZona: false,
      passoM: null, passoMin: null, rotuloPasso: '', truncada: false,
    };
  }
  const banda = bandaUtm(latCentro);

  // A tela cruza um fuso? Não é hipótese: Rosário do Sul/RS é 21J e Santa
  // Maria/RS é 22J, e a fronteira corre em 54° W, 88 km a leste de Rosário.
  // A grade continua sendo a da zona do CENTRO (extensão de zona, ver
  // `paraUtm`); este sinalizador existe para a tela poder dizer isso em vez
  // de deixar a pessoa ler um valor de este que não é da zona que ela pensa.
  const cruzaZona =
    zonaUtm(latCentro, oeste) !== zona || zonaUtm(latCentro, leste) !== zona;

  // Os quatro cantos, convertidos FORÇANDO a zona do centro. Sem forçar, um
  // canto do outro lado da fronteira voltaria com este ~500 km diferente e o
  // intervalo sairia absurdo.
  const cantos = [
    paraUtm(sul, oeste, zona), paraUtm(sul, leste, zona),
    paraUtm(norte, oeste, zona), paraUtm(norte, leste, zona),
  ].filter(Boolean);
  if (cantos.length < 4) {
    return {
      modo: 'utm', linhas: [], zona, banda, cruzaZona,
      passoM: null, passoMin: null, rotuloPasso: '', truncada: false,
    };
  }

  const estes = cantos.map((c) => c.este);
  const nortes = cantos.map((c) => c.norte);
  const minE = Math.min(...estes), maxE = Math.max(...estes);
  const minN = Math.min(...nortes), maxN = Math.max(...nortes);

  // Sobe o passo até caber no teto, em vez de cortar linhas — ver o cabeçalho.
  let passoM = passoUtm(maxE - minE, alvo);
  let truncada = false;
  const indice = PASSOS_UTM_M.indexOf(passoM);
  for (let i = Math.max(0, indice); i < PASSOS_UTM_M.length; i++) {
    passoM = PASSOS_UTM_M[i];
    const nE = valoresNoIntervalo(minE, maxE, passoM).length;
    const nN = valoresNoIntervalo(minN, maxN, passoM).length;
    if (nE <= TETO_LINHAS && nN <= TETO_LINHAS) break;
    truncada = true;  // o passo pedido pelo zoom não serviu; subiu
  }

  const hemisferio = latCentro < 0 ? 'S' : 'N';
  const linhas = [];

  // Linha de ESTE constante: varre o norte. Vários vértices, porque ela é
  // inclinada na tela (convergência meridiana).
  for (const este of valoresNoIntervalo(minE, maxE, passoM)) {
    const pontos = [];
    for (let i = 0; i < VERTICES_UTM; i++) {
      const n = minN + (maxN - minN) * (i / (VERTICES_UTM - 1));
      const p = deUtm({ zona, hemisferio, este, norte: n });
      if (p) pontos.push([p.lat, p.lon]);
    }
    if (pontos.length >= 2) {
      linhas.push({ eixo: 'E', valor: este, rotulo: rotuloUtm(este, passoM), pontos });
    }
  }

  // Linha de NORTE constante: varre o este.
  for (const norteV of valoresNoIntervalo(minN, maxN, passoM)) {
    const pontos = [];
    for (let i = 0; i < VERTICES_UTM; i++) {
      const e = minE + (maxE - minE) * (i / (VERTICES_UTM - 1));
      const p = deUtm({ zona, hemisferio, este: e, norte: norteV });
      if (p) pontos.push([p.lat, p.lon]);
    }
    if (pontos.length >= 2) {
      linhas.push({ eixo: 'N', valor: norteV, rotulo: rotuloUtm(norteV, passoM), pontos });
    }
  }

  return {
    modo: 'utm', linhas, zona, banda, cruzaZona,
    passoM, passoMin: null,
    rotuloPasso: passoM >= 1000 ? `${passoM / 1000} km` : `${passoM} m`,
    truncada,
  };
}
