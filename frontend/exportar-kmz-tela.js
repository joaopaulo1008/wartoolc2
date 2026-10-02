// exportar-kmz-tela.js — o botão "Baixar KMZ das marcações" do painel do
// instrutor: busca, desenha os ícones, empacota e baixa.
//
// Trio do projeto: exportar-kmz.js (KML, puro), zip-simples.js (zip, puro) e
// este módulo, que é o único que toca em banco, canvas e DOM.
//
// QUEM PODE: só o instrutor, e isso é decisão de INTERFACE — o botão só existe
// em instrutor.html. A barreira de verdade é a RLS: o select abaixo devolve ao
// instrutor tudo da turma (`elementos_ler` e `calcos_ler` liberam o instrutor),
// e a um aluno que chamasse esta função pelo console devolveria só o que ele já
// enxerga. Não existe chave nova em `catalogo_permissoes` — pela regra dura 3,
// ela seria só um toggle de tela.
//
// POR QUE LER DO BANCO, e não do que o mapa tem em memória: o mapa só guarda o
// que o Realtime e o select inicial trouxeram, e marcacoes.js não exporta suas
// linhas. Uma exportação tem de sair do estado do banco no momento do clique,
// e uma leitura nova é o que garante isso.
//
// DOIS FORMATOS DE ÍCONE. O KML referencia o ícone por arquivo, e quem abre
// tem preferências opostas:
//   - PNG: o Google Earth e o Maps NÃO desenham SVG como ícone de marcador.
//   - SVG: vetorial, é o que o QGIS usa bem como "Marcador SVG". NÃO foi
//     testado em QGIS (não há QGIS neste ambiente) — o que foi testado é o
//     arquivo: XML bem formado, zip válido, ícones íntegros.
// No modo SVG o KMZ leva também um LEIA-ME.txt, ignorado pelo Earth.

import ms from 'milsymbol';
import { supabase, buscarUsuariosDaTurma, buscarPartidosDaTurma } from './auth.js';
import { montarKml, sidcsParaIcones, nomeDoArquivo } from './exportar-kmz.js';
import { criarZip } from './zip-simples.js';

const TAMANHO_ICONE = 40;
const RAZAO_PNG = 2;      // resolução dobrada; compensada por `escala` no KML
const PASSO = 1000;       // teto padrão de linhas por resposta do PostgREST

const COLUNAS_ELEMENTOS = 'id, autor_id, partido_id, sidc, titulo, latitude, longitude, '
  + 'altitude_m, altitude_fonte, frente_m, profundidade_m, criada_em, editada_em';
const COLUNAS_ANOTACOES = 'id, autor_id, partido_id, texto, latitude, longitude, cor, criada_em';

// Paginado de propósito: o PostgREST corta em 1000 linhas sem avisar, e um
// arquivo "completo" que perdeu a marcação 1001 é pior do que um que falha.
async function buscarTudo(tabela, colunas, turmaId) {
  const linhas = [];
  for (let de = 0; ; de += PASSO) {
    const { data, error } = await supabase
      .from(tabela).select(colunas)
      .eq('turma_id', turmaId).is('removida_em', null)
      .order('criada_em').order('id')
      .range(de, de + PASSO - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data || []));
    if (!data || data.length < PASSO) break;
  }
  return linhas;
}

async function desenharPng(sym) {
  const canvas = sym.asCanvas(RAZAO_PNG);
  const blob = await new Promise((ok) => { canvas.toBlob(ok, 'image/png'); });
  if (!blob) throw new Error('o navegador não gerou o PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

// Um ícone por SIDC. Um SIDC que a milsymbol não desenha não derruba a
// exportação: a marcação sai sem estilo (alfinete padrão) e é contada.
async function desenharIcones(sidcs, formato) {
  const icones = new Map();
  const arquivos = [];
  let falhas = 0;
  for (const sidc of sidcs) {
    try {
      const sym = new ms.Symbol(sidc, { size: TAMANHO_ICONE });
      const tam = sym.getSize();
      const ancora = sym.getAnchor();
      const href = `icones/${sidc}.${formato}`;
      const dados = formato === 'svg' ? sym.asSVG() : await desenharPng(sym);
      arquivos.push({ nome: href, dados });
      icones.set(sidc, {
        href, largura: tam.width, altura: tam.height, ancora: { x: ancora.x, y: ancora.y },
        escala: formato === 'png' ? 1 / RAZAO_PNG : 1,
      });
    } catch (e) {
      falhas += 1;
      console.warn('Ícone não gerado para o SIDC', sidc, e);
    }
  }
  return { icones, arquivos, falhas };
}

const LEIA_ME_SVG = `WartoolC2 — marcações exportadas (ícones SVG)

Este arquivo é um zip: o KML está em doc.kml e os símbolos militares, em icones/.

Google Earth / Google Maps: não desenham SVG como ícone. Para eles, exporte de novo
escolhendo "Ícones PNG".

QGIS: carregue doc.kml como camada vetorial. Cada ponto traz o atributo "icone"
(por exemplo, icones/10061000001211000000.svg), além de força, categoria, altitude,
dimensões, autor e datas. Para desenhar os símbolos, extraia este zip numa pasta,
use o estilo "Marcador SVG" e, em Caminho do arquivo SVG, defina por dados:
  '<pasta onde extraiu>/' || "icone"

Cores fixas: azul = força de referência (amigo), vermelho = demais beligerantes
(hostil), verde = neutro, amarelo = sem força definida.
`;

function baixar(bytes, nome) {
  const blob = new Blob([bytes], { type: 'application/vnd.google-earth.kmz' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // O download já foi entregue ao navegador; revogar logo cortaria alguns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// `obterTurma` devolve a linha da turma selecionada ({ id, nome }) — a mesma
// que o resto do painel usa; ler no clique, e não guardar, é o que acompanha a
// troca de turma no seletor do topo.
export function iniciarExportacaoKmz({ obterTurma } = {}) {
  const botao = document.getElementById('exportar-kmz-botao');
  const seletor = document.getElementById('exportar-kmz-formato');
  const status = document.getElementById('exportar-kmz-status');
  if (!botao || !seletor || !status) return;

  const dizer = (texto, cor = '#7a9ab8') => { status.textContent = texto; status.style.color = cor; };

  botao.addEventListener('click', async () => {
    const turma = obterTurma?.();
    if (!turma?.id) { dizer('selecione uma turma', '#e05252'); return; }
    const formato = seletor.value === 'svg' ? 'svg' : 'png';

    botao.disabled = true;
    dizer('buscando marcações…');
    try {
      const [elementos, anotacoes, partidos, autores] = await Promise.all([
        buscarTudo('elementos_marcados', COLUNAS_ELEMENTOS, turma.id),
        buscarTudo('anotacoes', COLUNAS_ANOTACOES, turma.id),
        buscarPartidosDaTurma(turma.id),
        buscarUsuariosDaTurma(turma.id),
      ]);
      if (!elementos.length && !anotacoes.length) { dizer('nada marcado nesta turma ainda'); return; }

      dizer(`desenhando ${formato.toUpperCase()}…`);
      const { icones, arquivos, falhas } = await desenharIcones(sidcsParaIcones(elementos, partidos), formato);

      const agora = new Date();
      const { kml, contagem } = montarKml({
        elementos, anotacoes, partidos, autores, icones,
        turmaNome: turma.nome || '', geradoEm: agora,
      });
      const entradas = [{ nome: 'doc.kml', dados: kml }, ...arquivos];
      if (formato === 'svg') entradas.push({ nome: 'LEIA-ME.txt', dados: LEIA_ME_SVG });

      baixar(criarZip(entradas, { data: agora }), nomeDoArquivo(turma.nome, agora));

      const partes = [`${contagem.elementos} marcações`];
      if (contagem.anotacoes) partes.push(`${contagem.anotacoes} anotações`);
      let msg = `exportado: ${partes.join(' e ')}`;
      if (contagem.ignorados) msg += ` — ${contagem.ignorados} ignoradas (coordenada ou símbolo inválido)`;
      if (falhas) msg += ` — ${falhas} símbolo(s) sem desenho, saíram com o ícone padrão`;
      dizer(msg, contagem.ignorados || falhas ? '#c0a060' : '#5fb878');
    } catch (e) {
      console.error('Exportação de KMZ falhou:', e);
      dizer(`falhou: ${e.message}`, '#e05252');
    } finally {
      botao.disabled = false;
    }
  });
}
