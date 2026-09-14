// versao.js — o carimbo de build que aparece no rodapé (2026-09-14).
//
// Por que isto existe
// -------------------
// Três correções seguidas foram relatadas em campo como "continua igual", e
// nas duas primeiras a causa foi o navegador servindo a versão anterior — não
// o código. Cada uma dessas rodadas custou uma sessão inteira reconferindo o
// que já estava certo, porque de fora NÃO HÁ COMO SABER qual versão está na
// mão da pessoa.
//
// Este módulo não conserta o cache. Consertar o cache não está ao nosso
// alcance: GitHub Pages não deixa configurar header por arquivo (registrado
// como ponto de atenção desde a Etapa 11) e o `index.html`, que é quem aponta
// para os assets com hash, fica atrás da CDN do Pages com validação por ETag.
// O que ele faz é tornar o cache VISÍVEL: um número no rodapé que qualquer um
// lê em campo e diz por telefone. "Você está vendo a versão nova?" deixa de
// ser suposição.
//
// `__VERSAO_BUILD__` é substituído em tempo de BUILD pelo Vite (`define`, em
// vite.config.js) — não existe em tempo de execução, e por isso o
// `typeof` abaixo não é zelo: em `vite dev` a substituição também acontece,
// mas se um dia alguém abrir um arquivo destes fora do bundler (o que já
// aconteceu com testes em Node), o identificador solto seria um
// ReferenceError que derruba a tela inteira por causa de um rodapé.
const VERSAO = typeof __VERSAO_BUILD__ === 'string' ? __VERSAO_BUILD__ : 'dev';

export function versaoDoBuild() {
  return VERSAO;
}

// Escreve no `<span id="versao-build">` do rodapé, se ele existir. Silencioso
// quando não existe: a tela de login não tem rodapé e não precisa de um.
export function mostrarVersao() {
  if (typeof document === 'undefined') return;
  const alvo = document.getElementById('versao-build');
  if (alvo) alvo.textContent = VERSAO;
}
