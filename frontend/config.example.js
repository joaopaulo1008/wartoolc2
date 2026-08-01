// Configuração do cliente Supabase para o frontend do WartoolC2.
//
// 1. Copie este arquivo para "config.js" (mesma pasta).
// 2. Preencha SUPABASE_URL e SUPABASE_ANON_KEY com os valores do SEU projeto
//    (Project Settings -> Data API, no dashboard do Supabase).
//
// Desde a Etapa 11, "config.js" NÃO está mais no .gitignore e É commitado
// junto com o resto do frontend — é o que faz o site publicado (sem etapa de
// build) conseguir carregar. Isso só é seguro porque SUPABASE_ANON_KEY é a
// "publishable key" do projeto: pública por design, já que quem decide o que
// ela pode ler ou escrever é a Row Level Security (RLS) do banco, não a chave
// em si. Este arquivo (config.example.js) continua existindo à parte como
// modelo com placeholders, para quem clona o repo e ainda não tem projeto
// Supabase próprio.

export const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
export const SUPABASE_ANON_KEY = 'SUA-ANON-KEY-AQUI';
