// calcos.js — Etapa 7 do roadmap: acesso aos calcos publicados pelo instrutor.
//
// Este arquivo é para os calcos o que permissoes.js é para as permissões: a
// FONTE ÚNICA do que fala com o banco e com o Storage. Dois consumidores bem
// diferentes usam o mesmo módulo:
//
//   - app do ALUNO (camadas.js): lista os calcos vigentes, baixa os bytes e
//     assina o canal para o calco novo aparecer no meio do exercício.
//   - painel do INSTRUTOR (instrutor-calcos.js): publica, edita aparência e
//     remove.
//
// Sem DOM, sem Leaflet — só Supabase. A matemática de "isto cabe no mapa?"
// não mora aqui, mora em kml.js; o desenho mora em camadas.js.
//
// A tabela `calcos`, o bucket e a RLS dos dois vêm da migration
// backend/supabase/0006_calcos.sql. Ler o cabeçalho de lá antes de mexer em
// qualquer coisa deste arquivo: as decisões que explicam o formato do caminho,
// o limite de 2 MB e quem enxerga o quê estão todas naquele comentário.
//
// Etapa 8b: `calcos` passou a servir também imagem georreferenciada (foto
// aérea/carta atualizada), formato 'jpg'/'png', com quatro colunas de bounds
// — ver backend/supabase/0008_imagem_geo.sql para o porquê de reaproveitar
// esta tabela em vez de criar uma nova. Este arquivo não precisou de nenhuma
// regra nova: `buscarCalcosDaTurma` passou a trazer as colunas de bounds (são
// nulas para linhas de kml/kmz, e o cliente já sabe disso) e `publicarCalco`
// passou a aceitar os quatro campos, sempre opcionais — quem decide se são
// obrigatórios é o `check` da 0008, não este módulo.

import { supabase } from './auth.js';

// Nome do bucket. Tem cópia na migration (seções 4 e 5) e nas policies de
// storage.objects — é o identificador do bucket, não uma configuração.
export const BUCKET = 'calcos';

// As quatro chaves de permissão que um calco pode vestir. Cópia deliberada do
// `check` de `calcos.categoria` na 0006: o banco é quem manda (um insert com
// outra coisa é rejeitado lá), aqui é só para montar o <select> do painel sem
// uma consulta a mais. Se divergirem, quem ganha é o banco — o sintoma seria
// um erro de constraint ao publicar, não um calco fora da regra.
export const CATEGORIAS = [
  { chave: 'camada_manobra',    rotulo: 'Manobra (calcos e medidas de coordenação)' },
  { chave: 'camada_inimigo',    rotulo: 'Dispositivo inimigo' },
  { chave: 'camada_logistica',  rotulo: 'Logística' },
  { chave: 'camada_obstaculos', rotulo: 'Obstáculos e barreiras' },
];

export const ROTULO_CATEGORIA = Object.fromEntries(
  CATEGORIAS.map((c) => [c.chave, c.rotulo])
);

// ── Leitura ──────────────────────────────────────────────────────────────

// Calcos vigentes da turma. O filtro de `removido_em` é do CLIENTE, não da
// policy — mesmo critério de `elementos_marcados` desde a Etapa 5: a exclusão
// é lógica para o instrutor poder auditar depois, então a linha continua
// legível e é a consulta que decide o que está valendo.
//
// Quem a RLS deixa ver já está resolvido em `calcos_ler` (0006): instrutor da
// turma vê tudo; aluno vê o que é da turma inteira mais o do próprio partido.
// Esta consulta NÃO repete essa regra — repetir seria criar uma segunda cópia
// dela, livre para divergir.
export async function buscarCalcosDaTurma(turmaId) {
  if (!turmaId) return [];
  const { data, error } = await supabase
    .from('calcos')
    .select('id, nome, categoria, partido_id, caminho, formato, tamanho_bytes, num_feicoes, cor, opacidade, ordem, autor_id, criado_em, bounds_norte, bounds_sul, bounds_leste, bounds_oeste')
    .eq('turma_id', turmaId)
    .is('removido_em', null)
    .order('ordem', { ascending: true })
    .order('criado_em', { ascending: true });
  if (error) {
    console.error('buscarCalcosDaTurma falhou:', error);
    return null; // null = "não deu para saber", diferente de [] = "não há nenhum"
  }
  return data || [];
}

// Baixa os bytes do calco. `download()` leva o JWT do usuário, então quem não
// passa por `calcos_objeto_ler` (0006, seção 5) recebe erro — o bucket é
// privado justamente para não existir URL adivinhável contornando isso.
//
// Devolve ArrayBuffer porque é o que serve aos dois caminhos de kml.js: texto
// (TextDecoder) para .kml e bytes (Uint8Array) para o zip do .kmz.
export async function baixarCalco(caminho) {
  const { data, error } = await supabase.storage.from(BUCKET).download(caminho);
  if (error) return { erro: error, bytes: null };
  return { erro: null, bytes: await data.arrayBuffer() };
}

// ── Escrita (só o instrutor da turma passa pela RLS) ─────────────────────

// Publicar é uma operação de DOIS passos que precisa parecer um só.
//
// O `id` é gerado AQUI, no cliente, e não pelo default da tabela. Não é
// capricho: o caminho do objeto é `<turma_id>/<id>.<formato>` (trigger
// `fn_normalizar_calco`, 0006) e o upload precisa acontecer ANTES do insert —
// senão existiria, por um instante, uma linha de calco apontando para um
// objeto que ainda não subiu, e o aluno que recebesse o evento de Realtime
// nesse intervalo tentaria baixar o que não está lá. Gerando o id antes, o
// caminho é conhecido dos dois lados e a ordem certa fica possível.
//
// Se o insert falhar depois do upload, o objeto é apagado: sem a linha, ele
// seria ilegível para todo mundo (a policy de leitura procura a linha) e
// invisível no painel — lixo ocupando cota, que é exatamente o que a nota de
// manutenção da 0006 pede para evitar.
export async function publicarCalco({
  turmaId, autorId, nome, categoria, partidoId,
  formato, arquivo, numFeicoes, cor, opacidade, ordem,
  // Etapa 8b: só usados quando formato é 'jpg'/'png' — kml/kmz continuam
  // mandando `undefined` nos quatro, que vira `null` no insert, que é
  // exatamente o que a 0008 exige para vetor (bounds tem que ser as quatro
  // ou nenhuma; ver calcos_bounds_coerentes). Quem valida a COERÊNCIA dos
  // quatro números antes de chegar aqui é validarBounds() (imagem-geo.js) —
  // este módulo só encaminha o que já foi validado.
  boundsNorte, boundsSul, boundsLeste, boundsOeste,
}) {
  const id = crypto.randomUUID();
  const caminho = `${turmaId}/${id}.${formato}`;

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    // contentType do próprio arquivo quando o navegador souber dizer (jpg/png
    // quase sempre trazem `arquivo.type` certo); cai para octet-stream no
    // mesmo caso de sempre (kml/kmz, cujo MIME o navegador não reporta de
    // forma confiável — ver a nota sobre allowed_mime_types na 0006).
    .upload(caminho, arquivo, { contentType: arquivo.type || 'application/octet-stream', upsert: false });
  if (erroUpload) return { erro: erroUpload, calco: null };

  const { data, error } = await supabase
    .from('calcos')
    .insert({
      id,
      turma_id: turmaId,
      autor_id: autorId,
      nome,
      categoria,
      partido_id: partidoId || null,
      caminho,
      formato,
      tamanho_bytes: arquivo.size,
      num_feicoes: numFeicoes || 0,
      cor: cor || '#f5c842',
      opacidade: opacidade ?? 1,
      ordem: ordem ?? 0,
      bounds_norte: boundsNorte ?? null,
      bounds_sul: boundsSul ?? null,
      bounds_leste: boundsLeste ?? null,
      bounds_oeste: boundsOeste ?? null,
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([caminho]).catch(() => {});
    return { erro: error, calco: null };
  }
  return { erro: null, calco: data };
}

// Aparência padrão sugerida pelo instrutor. Não mexe nos bytes.
export async function atualizarCalco(id, campos) {
  const { error } = await supabase.from('calcos').update(campos).eq('id', id);
  return { erro: error };
}

// Remover é lógico na LINHA e definitivo nos BYTES — ver o cabeçalho da 0006.
// A linha fica para auditoria (custa bytes desprezíveis); o objeto sai porque
// cota custa dinheiro. Consequência registrada lá e repetida aqui para quem
// só ler este arquivo: NÃO existe desfazer. Republica-se.
//
// A ordem importa: primeiro a linha, depois o objeto. Invertido, uma falha no
// update deixaria uma linha vigente apontando para um objeto que já não
// existe — e o aluno veria a camada na lista e um erro ao ligar.
export async function removerCalco({ id, caminho, usuarioId }) {
  const { error } = await supabase
    .from('calcos')
    .update({ removido_em: new Date().toISOString(), removido_por: usuarioId })
    .eq('id', id);
  if (error) return { erro: error };

  const { error: erroObjeto } = await supabase.storage.from(BUCKET).remove([caminho]);
  if (erroObjeto) {
    // A camada já sumiu da tela de todo mundo (é a linha que manda). Sobrou um
    // objeto órfão ocupando cota — vale registrar, não vale falhar a operação
    // na cara do instrutor no meio do exercício.
    console.warn('Calco removido, mas o arquivo ficou no Storage:', erroObjeto);
  }
  return { erro: null };
}

// ── Realtime ─────────────────────────────────────────────────────────────
// É o que faz o "publicar na hora" da etapa ser verdade. Mesmo padrão de
// colegas.js/marcacoes.js: o select inicial monta o que já existe (o Realtime
// não faz backfill) e o canal cuida do que muda a partir daí.
//
// Filtro por `turma_id` no servidor é só economia de rede; quem restringe de
// verdade é `calcos_ler` — o Realtime aplica a policy de SELECT antes de
// entregar o evento, então o aluno do Vermelho não recebe o calco do Azul.
//
// Remoção chega como UPDATE (exclusão lógica), não como DELETE — igual às
// marcações. O ramo de DELETE fica por robustez, para o caso de alguém apagar
// pelo SQL Editor.
export function desassinarCalcos(canal) {
  if (canal) supabase.removeChannel(canal);
}

export function assinarCalcos(turmaId, { aoMudar, aoSair }) {
  return supabase
    .channel(`calcos-turma-${turmaId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'calcos', filter: `turma_id=eq.${turmaId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          if (payload.old?.id) aoSair(payload.old.id);
          return;
        }
        const linha = payload.new;
        if (!linha) return;
        if (linha.removido_em) aoSair(linha.id);
        else aoMudar(linha);
      }
    )
    .subscribe();
}
