// imagem-geo.js — Etapa 8b do roadmap: a PARTE PURA de publicar uma imagem
// georreferenciada (foto aérea/carta atualizada) como calco do instrutor.
//
// Mesma separação de sempre entre regra e tela (rastro.js/kml.js/
// carta-offline.js): nenhum DOM, nenhum Leaflet, nenhum Supabase aqui — só o
// que dá para testar em Node (frontend/imagem-geo.teste.mjs). O upload em si,
// o desenho do retângulo no mapa e a montagem do `L.imageOverlay` moram em
// frontend/instrutor-calcos.js (publicar) e frontend/camadas.js (desenhar).
//
// ============================================================================
// AS CINCO DECISÕES DESTA ETAPA (pedidas no prompt de abertura, resolvidas
// ANTES de codar — o raciocínio completo, com a mesma profundidade, está em
// CLAUDE.md, seção "Decisões da Etapa 8b"; aqui vai o resumo que importa para
// quem só lê este arquivo)
// ============================================================================
//
// 1. UM CAMINHO SÓ — o do instrutor — e `carregar_imagem_geo` fica
//    DELIBERADAMENTE sem interface. O catálogo (0001) descreve essa chave
//    como "própria" — mesma redação de `carregar_kml` — ou seja, por
//    convenção ela deveria governar um caminho LOCAL (o aluno carrega a
//    própria imagem, sem rede, sem banco), não o publicado. Só que uma foto
//    aérea/carta atualizada de verdade não é algo que um aluno normalmente
//    carrega no próprio aparelho já georreferenciada — ao contrário do KML
//    (que pode vir de um planejamento feito no QGIS antes do exercício), a
//    imagem tem MUITO mais valor vindo do instrutor, que é quem tem acesso à
//    imagem atualizada e ao contexto de "por que isto importa agora". Abrir
//    os dois caminhos (como a Etapa 7 fez para KML) dobraria a superfície —
//    duas UIs, dois fluxos de bounds — para um caminho local de valor prático
//    baixo. `carregar_imagem_geo` continua no catálogo, com padrão `false`,
//    reservada para esse caminho local se um dia fizer sentido construí-lo; o
//    calco de imagem do instrutor usa as mesmas chaves `camada_*` que os
//    calcos KML já usam — mesmo padrão de "uma chave, vários mecanismos" que
//    a Etapa 7 estabeleceu (uma categoria pode governar o GeoJSON do
//    repositório, um calco KML E agora uma imagem, ao mesmo tempo). Ver o
//    comentário de `CHAVES_APLICADAS` em frontend/permissoes.js.
//
// 2. GEORREFERENCIAMENTO POR DOIS CLIQUES NO MAPA — o instrutor marca o canto
//    NOROESTE e o canto SUDESTE da imagem sobre o próprio mapa (mesma
//    interação de `iniciarDesenhoRetangulo()` em frontend/offline-tela.js:
//    clique, prévia até o segundo clique, Esc cancela — sem plugin). GeoTIFF
//    (opção a do prompt) exigiria biblioteca de parsing binário no navegador
//    pesada para um recurso raro; world file (opção b) exigiria o instrutor
//    já ter o par de arquivos pronto, o que "raramente é o caso em campo"
//    (nota do próprio prompt de abertura). `L.imageOverlay` do Leaflet aceita
//    bounds RETANGULARES nativamente (2 cantos); um georreferenciamento com
//    rotação/distorção livre exigiria `L.ImageOverlay.Rotated`, plugin que o
//    projeto não usa hoje — e uma ortofoto de área pequena raramente precisa
//    de rotação fina. `validarBounds()` abaixo é o que garante que os dois
//    cantos formam um retângulo coerente antes de deixar publicar.
//
// 3. TETO DE 3 MB, MAIOR QUE O DO KML (2 MB), COM A CONTA NA TELA ANTES DO
//    UPLOAD — não reaproveita o tiling da Etapa 8a (o prompt de abertura
//    pede explicitamente para não reabrir aquela arquitetura além do
//    estritamente necessário). Fatiar a imagem em tiles e servir via Service
//    Worker resolveria o problema de egress de verdade, mas exigiria: gerar
//    os tiles no navegador do instrutor (ou um pipeline novo), estender
//    sw-bdgex.js para reconhecer um host/padrão de URL que hoje não existe, e
//    uma segunda forma de "área salva" que não é sobre BDGEx. É trabalho de
//    etapa própria, não um acréscimo pequeno a esta. A saída adotada é a
//    combinação (a)+(c) do prompt: teto agressivo (3 MB — 1,5× o do KML
//    compartilhado, mas ainda uma fração do que uma ortofoto crua pesa) e
//    aceitar que a função é RARA (o instrutor publica uma foto aérea ocasional,
//    não uma por aula, ao contrário dos calcos táticos). `estimarEgress()`
//    calcula o custo REAL do arquivo escolhido (não uma tabela fixa) para a
//    tela mostrar antes do upload — o instrutor decide consciente, com o
//    número na frente, exatamente como o prompt pediu ("como toda etapa
//    anterior fez para o recurso equivalente dela").
//
// 4. REAPROVEITA A TABELA `calcos` (não cria tabela nova) — ver o cabeçalho
//    de backend/supabase/0008_imagem_geo.sql para a justificativa completa.
//    Resumo: a RLS/trigger/policies de Storage da 0006 já servem raster sem
//    mudar uma linha, e duplicá-las numa tabela nova arriscaria as duas
//    cópias divergirem — o erro que o projeto evita desde a correção do SIDC
//    na Etapa 4.5. O custo aceito são quatro colunas nuláveis
//    (bounds_norte/sul/leste/oeste) e dois formatos novos no `check` de
//    `calcos.formato` ('jpg', 'png' — não um 'imagem' genérico, para o
//    caminho do objeto no Storage continuar tendo uma extensão real).
//
// 5. OPACIDADE VOLTA — SÓ PARA IMAGEM. A Etapa 8a tirou o controle de
//    opacidade das camadas de ARQUIVO (KML/KMZ) porque "não fazia sentido
//    para calco/traçado tático" — o que importa lá é cor + liga/desliga. Uma
//    foto aérea é o caso oposto: o valor dela está justamente em comparar
//    contra o mapa base por baixo (uma obra nova, uma trilha que mudou), e
//    isso pede opacidade ajustável — sem ela a imagem simplesmente TAPA o
//    mapa base, e não há "cor" que resolva isso (raster não tem estilo por
//    feição). Por isso a imagem reintroduz opacidade — sugestão do
//    instrutor ao publicar, ajuste do aluno na própria tela, sem persistir
//    (mesma distinção de preferência-x-permissão de sempre) — e o KML/KMZ
//    continua exatamente como a 8a deixou, sem uma linha tocada.
// ============================================================================

import { formatarBytes } from './kml.js';

// ── Tamanho ──────────────────────────────────────────────────────────────
//
// 3 MB, contra os 2 MB do KML compartilhado (kml.js, LIMITE_BYTES_COMPARTILHADO).
// A diferença reflete que uma imagem comprimida para a web ainda pesa mais
// que um KML/KMZ equivalente em área de cobertura, mas o número continua
// LONGE do que uma ortofoto crua pesa (10-20 MB, ver o prompt de abertura) —
// de propósito: até 3 MB é o instrutor quem decide comprimir o bastante
// (reduzir resolução/qualidade do JPG) antes de publicar; acima disso, a
// função existe mas o custo de rede fica visível ANTES de gastar o upload
// (ver estimarEgress abaixo), e cabe ao instrutor decidir se vale a pena.
export const LIMITE_BYTES_IMAGEM = 3 * 1024 * 1024;

export const EXTENSOES_IMAGEM = ['jpg', 'jpeg', 'png'];

// Devolve 'jpg', 'png' ou null. '.jpeg' normaliza para 'jpg' — é o mesmo
// formato, e o `check` de calcos.formato (0008) só conhece 'jpg'/'png': ter
// um terceiro valor 'jpeg' faria a mesma imagem poder cair em duas gavetas
// por causa só da extensão que o instrutor digitou no nome do arquivo.
export function formatoDoArquivoImagem(nomeArquivo) {
  const nome = String(nomeArquivo || '').toLowerCase();
  if (nome.endsWith('.jpg') || nome.endsWith('.jpeg')) return 'jpg';
  if (nome.endsWith('.png')) return 'png';
  return null;
}

// Mesmo formato de retorno de validarArquivo() em kml.js: { ok, motivo } ou
// { ok, formato }. Mantido separado de validarArquivo() (não uma opção a
// mais nela) porque as regras não têm nada em comum além do formato de
// retorno — imagem não tem o segundo teto (local x compartilhado) que KML
// tem, porque não existe caminho local de imagem nesta etapa (decisão 1).
export function validarArquivoImagem({ nome, tamanho }) {
  const formato = formatoDoArquivoImagem(nome);
  if (!formato) {
    return { ok: false, motivo: 'Só aceita imagem .jpg ou .png.' };
  }
  if (!(Number(tamanho) > 0)) {
    return { ok: false, motivo: 'O arquivo está vazio.' };
  }
  if (tamanho > LIMITE_BYTES_IMAGEM) {
    return {
      ok: false,
      motivo: `O arquivo tem ${formatarBytes(tamanho)} e o limite é ${formatarBytes(LIMITE_BYTES_IMAGEM)}. `
            + `Reduza a resolução ou a qualidade do JPG antes de publicar — cada um dos alunos da turma `
            + `baixa a própria cópia pela rede do campo.`,
    };
  }
  return { ok: true, formato };
}

// ── Bounds ───────────────────────────────────────────────────────────────
//
// Grau de latitude em metros — mesma constante (e mesmo motivo de existir)
// de kml.js: não é geodésia de precisão, só serve para a checagem de "área
// grande o bastante para não ser um retângulo degenerado" abaixo.
const METROS_POR_GRAU = 111_320;

// Um retângulo desenhado por engano quase no mesmo ponto (os dois cliques
// muito próximos) publicaria uma imagem que no mapa do aluno aparece como um
// pixel — pior que não ter imagem, porque a lista diria "publicado" e ele não
// acharia nada onde olhar. 5 m é pequeno o bastante para não atrapalhar um
// uso legítimo (uma imagem de detalhe) e grande o bastante para pegar o
// clique duplo por acidente.
const LADO_MINIMO_M = 5;

// { norte, sul, leste, oeste } vêm de latlng do Leaflet (graus decimais).
// Devolve { ok, bounds } ou { ok: false, motivo }. `bounds` já sai com os
// quatro números normalizados (Number), prontos para publicarCalco().
//
// A ORDEM DAS CHECAGENS IMPORTA: primeiro "os quatro existem e são número"
// (cobre "o instrutor ainda não terminou de desenhar"), depois a relação
// norte>sul/leste>oeste (cobre "desenhou de trás para frente" — mesmo
// raciocínio de normalizarBBox() em carta-offline.js, mas aqui o retângulo
// pode nascer em qualquer ordem de clique e por isso o chamador já entrega
// os quatro valores possivelmente fora de ordem; normalizar é
// responsabilidade de quem desenha, não desta função — ela SÓ valida), depois
// os limites do globo, e por último a área mínima.
export function validarBounds({ norte, sul, leste, oeste }) {
  const n = Number(norte);
  const s = Number(sul);
  const l = Number(leste);
  const o = Number(oeste);

  if (![n, s, l, o].every(Number.isFinite)) {
    return { ok: false, motivo: 'Marque os dois cantos da imagem no mapa antes de publicar.' };
  }
  if (n <= s) {
    return { ok: false, motivo: 'O canto norte precisa estar acima do canto sul.' };
  }
  if (l <= o) {
    return { ok: false, motivo: 'O canto leste precisa estar à direita do canto oeste.' };
  }
  if (n > 90 || s < -90 || l > 180 || o < -180) {
    return { ok: false, motivo: 'Os cantos precisam estar dentro dos limites do mapa.' };
  }

  const alturaM = (n - s) * METROS_POR_GRAU;
  const larguraM = (l - o) * Math.cos((n + s) / 2 * Math.PI / 180) * METROS_POR_GRAU;
  if (alturaM < LADO_MINIMO_M || larguraM < LADO_MINIMO_M) {
    return { ok: false, motivo: 'A área desenhada é pequena demais — desenhe um retângulo maior sobre a imagem.' };
  }

  return { ok: true, bounds: { norte: n, sul: s, leste: l, oeste: o } };
}

// ── Egress ───────────────────────────────────────────────────────────────
//
// Mesma premissa da conta no cabeçalho de backend/supabase/0006_calcos.sql
// (turma de 60, ~5 recargas por exercício) — repetida aqui como CONSTANTE,
// não reescrita, para as duas contas (KML e imagem) partirem da mesma
// suposição sobre o tamanho da turma e não divergirem se um dia alguém
// ajustar só um lado.
export const ALUNOS_TIPICOS = 60;
export const RECARGAS_TIPICAS = 5;
// 5 GB/mês — o mesmo número do plano Free do Supabase citado na 0006.
export const EGRESS_MENSAL_PLANO_FREE_BYTES = 5 * 1024 * 1024 * 1024;

// Custo estimado de publicar UM arquivo deste tamanho, calculado sobre o
// tamanho REAL escolhido (não uma tabela fixa) — é isso que permite a tela
// mostrar "este arquivo específico custa X" antes do upload, em vez de um
// aviso genérico que o instrutor aprende a ignorar.
export function estimarEgress(tamanhoBytes, { alunos = ALUNOS_TIPICOS, recargas = RECARGAS_TIPICAS } = {}) {
  const tamanho = Number(tamanhoBytes) || 0;
  const porCarga = tamanho * alunos;
  const porExercicio = porCarga * recargas;
  const percentualMensal = (porExercicio / EGRESS_MENSAL_PLANO_FREE_BYTES) * 100;
  return { porCarga, porExercicio, percentualMensal };
}

// Frase pronta para a tela — a "conta visível antes do upload" pedida no
// item 3 do prompt de abertura, no mesmo espírito de offline-tela.js
// mostrar quantos tiles/MB antes de confirmar um download.
export function textoEgress(tamanhoBytes) {
  const { porCarga, porExercicio, percentualMensal } = estimarEgress(tamanhoBytes);
  return `Esta imagem (${formatarBytes(tamanhoBytes)}) custa cerca de ${formatarBytes(porCarga)} de tráfego `
       + `toda vez que a turma inteira (${ALUNOS_TIPICOS} alunos) carrega a página — perto de `
       + `${formatarBytes(porExercicio)} num exercício típico (${RECARGAS_TIPICAS} recargas), ou seja, `
       + `~${percentualMensal < 1 ? percentualMensal.toFixed(1) : percentualMensal.toFixed(0)}% do orçamento `
       + `mensal de egress do plano gratuito do Supabase (5 GB). Publique quando valer a pena — imagem não é `
       + `algo para toda aula, ao contrário dos calcos de manobra.`;
}
