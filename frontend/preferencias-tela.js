// preferencias-tela.js — os controles de preferência de visualização.
//
// Por que este arquivo existe
// ----------------------------
// `ligarSeletorDeCoordenada()` e `ligarSeletorDeGrade()` nasceram soltos
// dentro do `<script type="module">` do `index.html`. O painel do instrutor é
// o SEGUNDO consumidor, e a regra do projeto é extrair na segunda vez — como
// `catalogo-form.js`, `basemaps.js`, `vigia-ausencia.js`, `toque-longo.js` e
// `grade.js`. Copiar as duas funções para `instrutor.html` seria a forma mais
// rápida de, daqui a um mês, a nota explicativa existir numa tela e não na
// outra.
//
// ── Duas telas, dois idiomas de formulário ───────────────────────────────
// O painel do aluno usa RÁDIOS (`<input type="radio" name="…">`), porque lá o
// cartão tem espaço e a escolha fica toda visível. O painel do instrutor usa
// `<select>` dentro de `.campo`, que é o idioma daquela coluna desde a Etapa
// 6c ("Mapa base" já é assim) — e ela é estreita, com a lista da turma
// disputando a altura.
//
// Então o módulo aceita OS DOIS e normaliza. A alternativa seria impor rádios
// ao instrutor, e aí o painel dele teria um bloco destoante de todo o resto;
// ou duas funções quase iguais, que é exatamente o que a extração evita.
//
// O que ele NÃO faz: decidir o que vale. Quem guarda a escolha é
// `preferencias.js` (que escreve no perfil e avisa os observadores), e quem
// sabe o que é um modo de grade válido é `grade.js`. Aqui só há tela.
import {
  definirFormatoCoordenada, observarFormatoCoordenada, formatarCoordenada,
  definirModoGrade, observarModoGrade,
} from './preferencias.js';

// Aceita Element, lista de Elements, seletor em string, ou nada (e aí procura
// pelos rádios do nome padrão). Devolve `null` quando não há controle na
// página — o que é normal: nem toda tela tem os dois.
function normalizar(alvo, nomePadrao) {
  if (typeof document === 'undefined') return null;
  let nos;
  if (!alvo) nos = [...document.querySelectorAll(`input[name="${nomePadrao}"]`)];
  else if (typeof alvo === 'string') nos = [...document.querySelectorAll(alvo)];
  else if (alvo instanceof Element) nos = [alvo];
  else nos = [...alvo];
  if (!nos.length) return null;

  const select = nos.find((n) => n.tagName === 'SELECT');
  if (select) {
    return {
      refletir: (valor) => { select.value = valor; },
      aoMudar: (cb) => {
        const h = () => cb(select.value);
        select.addEventListener('change', h);
        return () => select.removeEventListener('change', h);
      },
    };
  }

  const radios = nos.filter((n) => n.type === 'radio');
  if (!radios.length) return null;
  return {
    refletir: (valor) => radios.forEach((r) => { r.checked = (r.value === valor); }),
    aoMudar: (cb) => {
      const desligar = radios.map((r) => {
        const h = () => { if (r.checked) cb(r.value); };
        r.addEventListener('change', h);
        return () => r.removeEventListener('change', h);
      });
      return () => desligar.forEach((f) => f());
    },
  };
}

const no = (x) => (typeof x === 'string' ? document.getElementById(x) : (x || null));

// Só em UTM, porque só lá `E`/`N` significam outra coisa que não hemisfério.
// Em grau decimal e GMS, S e W SÃO hemisfério — explicar ali seria criar a
// dúvida em vez de tirá-la. Relatado em campo em 2026-08-02: "estamos a W e S,
// e está escrito E e N".
const NOTA_UTM =
  'mE / mN são metros nos eixos da quadrícula (leste e norte), não hemisfério. ' +
  'O hemisfério está na letra da zona.';

// A nota da grade existe por causa de uma pergunta que vai aparecer em campo:
// por que a quadrícula não fica menor que isso. A resposta é decisão de quem
// usa (piso de 1 km), não limitação — e dizer isso evita o relato "a grade não
// acompanha o zoom".
const NOTA_GRADE = {
  utm: 'O passo acompanha o zoom (1, 2, 5, 10 km…) e nunca fica menor que 1 km. ' +
       'Os dois dígitos na margem são os dígitos principais, como na carta; ' +
       'a zona e o passo estão na legenda do canto.',
  geo: 'Linhas de latitude e longitude, com o passo em minutos acompanhando o zoom.',
  off: '',
};

// alvo    (opcional) o controle: <select>, lista de rádios, seletor em string.
//         Sem ele, procura os rádios `name="formato-coordenada"`.
// exemplo (opcional) nó ou id onde escrever "Centro do mapa: …"
// nota    (opcional) nó ou id da nota do UTM
// map     (opcional) necessário só para o exemplo acompanhar o mapa
//
// Devolve a função que desliga tudo.
export function ligarSeletorDeCoordenada({ alvo, exemplo, nota, map } = {}) {
  const ctrl = normalizar(alvo, 'formato-coordenada');
  if (!ctrl) return () => {};
  const elExemplo = no(exemplo);
  const elNota = no(nota);

  function atualizarExemplo() {
    if (!elExemplo || !map) return;
    const centro = map.getCenter();
    elExemplo.textContent = `Centro do mapa: ${formatarCoordenada(centro.lat, centro.lng)}`;
  }

  const desligarControle = ctrl.aoMudar((valor) => definirFormatoCoordenada(valor));

  // Um observador, não uma atribuição direta: o valor pode mudar por outro
  // caminho que não este controle (a carga inicial do perfil; a outra tela,
  // agora que são duas), e o controle precisa acompanhar. Já é chamado na
  // hora com o valor atual — daí ele nascer no formato gravado.
  const desligarObs = observarFormatoCoordenada((formato) => {
    ctrl.refletir(formato);
    if (elNota) elNota.textContent = (formato === 'utm') ? NOTA_UTM : '';
    atualizarExemplo();
  });

  if (map) map.on('moveend', atualizarExemplo);
  atualizarExemplo();

  return () => {
    desligarControle();
    desligarObs();
    if (map) map.off('moveend', atualizarExemplo);
  };
}

// Espelha a função acima de propósito: mesma forma, mesmo observador, mesma
// razão para ser observador e não atribuição direta.
export function ligarSeletorDeGrade({ alvo, nota } = {}) {
  const ctrl = normalizar(alvo, 'modo-grade');
  if (!ctrl) return () => {};
  const elNota = no(nota);

  const desligarControle = ctrl.aoMudar((valor) => definirModoGrade(valor));
  const desligarObs = observarModoGrade((modo) => {
    ctrl.refletir(modo);
    if (elNota) elNota.textContent = NOTA_GRADE[modo] || '';
  });

  return () => { desligarControle(); desligarObs(); };
}
