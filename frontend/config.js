// Configuração REAL do projeto Supabase — desde a Etapa 11 este arquivo É
// COMMITADO (não está mais no .gitignore; veja config.example.js para o
// modelo que continua existindo à parte, para quem clona o repo do zero).
//
// Por que commitar uma chave num repositório público não é vazamento de
// segredo: SUPABASE_ANON_KEY abaixo é a "publishable key" do projeto (prefixo
// sb_publishable_, o nome novo do Supabase para o que era chamado de "anon
// key") — ela é PÚBLICA POR DESIGN. Quem decide o que ela pode ler ou
// escrever é a Row Level Security (RLS) do banco (backend/supabase/0002_rls.sql
// e seguintes), não a chave em si — a chave só identifica o PROJETO, não
// autoriza nada sozinha. O segredo de verdade do projeto é a "service_role
// key" (Admin API, usada só em backend/seed/criar_usuarios.mjs, fora do
// navegador, por variável de ambiente) — essa sim nunca pode ir para cá.
//
// Publicar o repositório sem este arquivo faz o `import` em auth.js falhar e
// NENHUMA tela do site carrega, nem o login — por isso ele precisa estar
// versionado para o deploy funcionar sem uma etapa de build (Etapa 11).
//
// Onde encontrar/trocar estes valores, no dashboard do Supabase
// (supabase.com/dashboard): Project Settings (engrenagem) -> Data API ->
// "Project URL" e "Project API keys" (chave "publishable"/"anon", não a
// "service_role").

export const SUPABASE_URL = 'https://xfqiwlnzvqoaxabpkgss.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_hPIMgJVI3Xr0MqdXPvvNEg_MBjgfX2S';
