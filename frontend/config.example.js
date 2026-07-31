// Configuração do cliente Supabase para o frontend do WartoolC2.
//
// 1. Copie este arquivo para "config.js" (mesma pasta).
// 2. Preencha SUPABASE_URL e SUPABASE_ANON_KEY com os valores do SEU projeto
//    (ver instruções de onde encontrá-los no chat / backend/README.md).
//
// "config.js" está no .gitignore — não vai para o repositório, porque tem a
// anon key do seu projeto. Este arquivo (config.example.js) é só o modelo,
// com placeholders, e fica versionado.
//
// anon key: em uma linha, é a chave "pública" do projeto — pode aparecer no
// código do navegador sem problema, porque quem decide o que ela pode ler ou
// escrever é a Row Level Security (RLS) do banco, não a chave em si.

export const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
export const SUPABASE_ANON_KEY = 'SUA-ANON-KEY-AQUI';
