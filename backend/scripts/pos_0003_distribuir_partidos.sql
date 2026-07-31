-- =============================================================================
-- Pós-aplicação da 0003 — conferir e distribuir os partidos
-- Etapa 4.5 do docs/ROADMAP.md
-- =============================================================================
-- Rode isto no SQL Editor do Supabase LOGO DEPOIS de aplicar
-- backend/supabase/0003_partidos.sql (e só depois dela).
--
-- É o mesmo passo a passo do backend/README.md ("Depois de aplicar a 0003"),
-- só que num arquivo só, para colar de uma vez. Tem DUAS partes editáveis
-- (2 e 4) — o script para com erro de propósito se você esquecer de editá-las,
-- em vez de rodar silenciosamente com os nomes de exemplo.
--
-- O SQL Editor roda como service_role e ignora a RLS — o que este script
-- confere é a ESTRUTURA (a migration pegou?) e o DADO (quem tem partido?).
-- NÃO prova isolamento entre partidos: isso só se vê pelo app, com duas contas
-- reais (ver o passo 5, no fim).
-- =============================================================================

-- =============================================================================
-- 1. A migration pegou?
-- =============================================================================
select
  to_regclass('public.marcacoes_inimigas') as tabela_antiga_deve_ser_null,
  to_regclass('public.elementos_marcados') as tabela_nova_deve_existir,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename in ('elementos_marcados', 'partidos'))  as publicadas_deve_ser_2,
  (select count(*) from public.partidos)                    as total_partidos,
  (select count(distinct turma_id) from public.partidos)    as turmas_com_partido;

-- Esperado: coluna 1 vazia; coluna 2 = elementos_marcados; publicadas_deve_ser_2 = 2;
-- total_partidos = 2 × turmas_com_partido (Azul e Vermelho em cada turma).
-- Se algo aqui destoar, PARE — não siga para os passos de distribuição sem
-- entender por quê (provavelmente a 0003 não rodou até o fim).

-- =============================================================================
-- 2. Quem está sem partido? — EDITE o código da turma abaixo se não for TESTE
-- =============================================================================
select p.nome_guerra, p.papel, t.codigo_acesso, pa.nome as partido_atual
from public.perfis p
left join public.turmas t    on t.id  = p.turma_id
left join public.partidos pa on pa.id = p.partido_id
where t.codigo_acesso = 'TESTE'  -- <<< EDITE: código da turma que você quer distribuir
order by pa.nome nulls first, p.nome_guerra;

-- Logo depois da 0003, TODO MUNDO aparece com partido_atual = null. É esse o
-- estado em que cada aluno só se enxerga a si mesmo no mapa (ver o
-- comentário sobre "partido nulo é restritivo" no CLAUDE.md e no README).
-- O instrutor pode continuar null sem problema — ele vê a turma inteira de
-- qualquer jeito, com ou sem partido.

-- =============================================================================
-- 3. Todo mundo da turma para o Azul, de saída
-- =============================================================================
update public.perfis p set partido_id = (
  select id from public.partidos
  where turma_id = p.turma_id and nome = 'Azul'
)
where p.papel = 'usuario'
  and p.turma_id = (select id from public.turmas where codigo_acesso = 'TESTE');  -- <<< EDITE aqui também

-- =============================================================================
-- 4. Move para o Vermelho quem for do outro lado — EDITE a lista de nomes
-- =============================================================================
-- Os nomes de exemplo abaixo ('fulano', 'beltrano') quase certamente não
-- existem na sua turma — o UPDATE roda mas afeta ZERO linhas até você trocar
-- pelos nomes de guerra reais dos alunos do Vermelho.
update public.perfis set partido_id = (
  select id from public.partidos
  where turma_id = (select id from public.turmas where codigo_acesso = 'TESTE')  -- <<< EDITE
    and nome = 'Vermelho'
)
where nome_guerra in ('fulano', 'beltrano');  -- <<< EDITE: nomes de guerra reais do Vermelho

-- =============================================================================
-- 5. Confira o resultado (repete a consulta do passo 2)
-- =============================================================================
select p.nome_guerra, p.papel, t.codigo_acesso, pa.nome as partido_atual
from public.perfis p
left join public.turmas t    on t.id  = p.turma_id
left join public.partidos pa on pa.id = p.partido_id
where t.codigo_acesso = 'TESTE'  -- <<< EDITE
order by pa.nome nulls first, p.nome_guerra;

-- Nenhuma linha com papel = 'usuario' pode sobrar com partido_atual = null.
-- Se sobrar, é aluno que os passos 3/4 não cobriram — ajuste e rode de novo
-- (o script inteiro é reaplicável sem risco: um UPDATE repetido não muda
-- nada além do que já mudou).

-- =============================================================================
-- 6. A prova de verdade não é aqui — é no app
-- =============================================================================
-- Este script roda como service_role e ignora RLS: um SELECT aqui sempre
-- mostra tudo, Azul e Vermelho juntos, e isso NÃO significa que os alunos
-- estejam vendo um ao outro no mapa.
--
-- Para verificar de verdade: abra duas janelas anônimas do navegador, logue
-- uma como aluno do Azul e outra como aluno do Vermelho, e olhe o contador
-- "Colegas: N visível(eis)" na topbar de cada uma — cada uma deve contar só
-- os do próprio lado. O instrutor, numa terceira janela, deve contar todo
-- mundo da turma.
