// perfil-ao-vivo.js — Etapa 6a: reagir à troca de força feita pelo instrutor.
//
// O QUE ESTE MÓDULO FAZ
// ---------------------
// Assina a PRÓPRIA linha de `perfis` e, quando o instrutor move o aluno de
// força (`partido_id`), avisa e recarrega a página.
//
// POR QUE RECARREGAR, E NÃO REDESENHAR
// ------------------------------------
// Recarregar é grosseiro de propósito. O partido de quem olha não é um dado
// a mais na tela: é a metade do par que decide a HOSTILIDADE de cada símbolo
// já desenhado (ver hostilidadeRelativa em simbolos.js) e, ao mesmo tempo,
// entra em fn_usuarios_visiveis(), que é o que as policies de
// posicoes_atuais, posicoes_historico e elementos_marcados consultam para
// decidir QUEM esta pessoa enxerga.
//
// Reagir "direito" significaria, tudo junto: trocar `meuPartido` em
// colegas.js e em marcacoes.js, recriar o ícone de cada avatar e de cada
// marcação já no mapa, descartar quem saiu do alcance da RLS, refazer os dois
// selects iniciais para trazer quem entrou, e reassinar os canais. Cada um
// desses passos é um caminho de estado novo em três módulos que já estão
// testados — e tudo isso para uma operação que acontece uma ou duas vezes por
// exercício, na montagem. `location.reload()` chega ao mesmo lugar, por um
// caminho que já é exercitado toda vez que alguém abre o app.
//
// Se um dia a troca de partido virar rotina (ex.: exercício em que as forças
// se reorganizam a toda hora), aí vale pagar o preço do redesenho — e o lugar
// de fazer isso é aqui, trocando o corpo de `aoMudarPartido`, sem mexer no
// resto.
//
// PRÉ-REQUISITO: `perfis` precisa estar publicada no Realtime — é o que a
// migration backend/supabase/0004_perfis_realtime.sql faz. Sem ela, este
// módulo simplesmente nunca recebe evento (não quebra nada; a troca de força
// só passa a valer no próximo F5, como era antes).

import { supabase } from './auth.js';

let canal = null;
let partidoConhecido = null;   // o partido com que ESTA página foi montada
let recarregando = false;

// Um aviso curto antes do reload, em vez da tela sumir do nada no meio de
// alguém desenhando uma marcação. 3s é o suficiente para ler e curto o
// bastante para não parecer travamento.
const ESPERA_ANTES_DO_RELOAD_MS = 3_000;

function mostrarAviso(texto) {
  let el = document.getElementById('aviso-partido');
  if (!el) {
    el = document.createElement('div');
    el.id = 'aviso-partido';
    el.style.cssText = `
      position:fixed; top:0; left:0; right:0; z-index:3000;
      background:#8c6a2a; color:#fff8e0; padding:10px 16px;
      font-family:'Segoe UI',Arial,sans-serif; font-size:13px; text-align:center;
      box-shadow:0 2px 12px rgba(0,0,0,.4);
    `;
    document.body.appendChild(el);
  }
  el.textContent = texto;
}

function aoMudarPartido(nomeDaForca) {
  if (recarregando) return;
  recarregando = true;
  mostrarAviso(
    nomeDaForca
      ? `O instrutor moveu você para a força ${nomeDaForca}. Recarregando o mapa…`
      : 'O instrutor retirou você da força. Recarregando o mapa…'
  );
  setTimeout(() => window.location.reload(), ESPERA_ANTES_DO_RELOAD_MS);
}

// Busca o nome da força só para a mensagem ficar legível. Se falhar, o aviso
// sai sem o nome — não vale bloquear o reload por causa de um rótulo.
async function nomeDoPartido(partidoId) {
  if (!partidoId) return null;
  const { data } = await supabase
    .from('partidos')
    .select('nome')
    .eq('id', partidoId)
    .maybeSingle();
  return data?.nome || null;
}

// userId: session.user.id (igual perfis.id).
// partidoAtual: perfil.partido_id no momento em que a página montou — é o
//   valor de referência da comparação. Passado por parâmetro (e não relido
//   aqui) porque é exatamente o valor que os outros módulos usaram para
//   desenhar; comparar contra qualquer outra coisa deixaria de responder
//   "o que está na tela ficou velho?".
export function iniciarPerfilAoVivo({ userId, partidoAtual }) {
  partidoConhecido = partidoAtual || null;

  canal = supabase
    .channel(`perfil-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'perfis',
        filter: `id=eq.${userId}`,
      },
      async (payload) => {
        const novo = payload.new?.partido_id || null;
        // Só interessa a troca de FORÇA. A mesma linha muda por outros
        // motivos (nome de guerra, sidc, atualizado_em do trigger) e nenhum
        // deles justifica derrubar a sessão de mapa de alguém.
        if (novo === partidoConhecido) return;
        partidoConhecido = novo;
        aoMudarPartido(await nomeDoPartido(novo));
      }
    )
    .subscribe();

  window.addEventListener('beforeunload', pararPerfilAoVivo);
}

export function pararPerfilAoVivo() {
  if (canal) {
    supabase.removeChannel(canal);
    canal = null;
  }
}
