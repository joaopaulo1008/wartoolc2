# Validacao do SQL com o parser oficial do PostgreSQL (libpg_query, via pglast).
#
# Tres niveis, porque para o parser externo o corpo de uma funcao e so uma
# string — validar o arquivo inteiro NAO valida o que esta dentro dos $$ $$:
#   1. o arquivo, comando a comando;
#   2. o corpo de cada funcao (SQL puro e plpgsql);
#   3. o SQL embutido nos EXECUTE dentro dos blocos DO.
#
# LIMITACAO CONHECIDA DESTA FERRAMENTA, nao do SQL: parse_plpgsql() desta
# versao do pglast quebra em QUALQUER funcao `returns trigger` (erro de JSON,
# reproduzivel ate com um `begin return new; end` vazio, e igual na 0003 que
# ja esta aplicada em producao). Para essas, o cabecalho e trocado por
# `returns void` so na hora de parsear — o CORPO, que e o que interessa
# validar, vai inteiro e sem alteracao.
import re, sys, pglast

ARQUIVOS = sys.argv[1:]
falhas = []

def testar(rotulo, trecho, plpgsql=False):
    try:
        pglast.parse_plpgsql(trecho) if plpgsql else pglast.parse_sql(trecho)
        print(f'  OK    {rotulo}')
    except Exception as e:
        falhas.append(rotulo)
        print(f'  FALHA {rotulo}: {e}')

for arq in ARQUIVOS:
    sql = open(arq, encoding='utf-8').read()
    print(f'\n{arq}')
    testar(f'arquivo inteiro ({len(pglast.parse_sql(sql))} comandos)', sql)

    for m in re.finditer(
        r"create (?:or replace )?function\s+(\S+?)\s*\((.*?)\)(.*?)as \$\$(.*?)\$\$;",
        sql, re.S | re.I):
        nome, cabecalho, corpo = m.group(1), m.group(3), m.group(4)
        ehPl = 'plpgsql' in cabecalho.lower()
        if not ehPl:
            testar(f'corpo SQL de {nome}', corpo)
            continue
        ehTrigger = bool(re.search(r'returns\s+trigger', cabecalho, flags=re.I))
        cab = re.sub(r'returns\s+trigger', 'returns record', cabecalho, flags=re.I)
        corpoParseavel = corpo
        if ehTrigger:
            # `new`/`old` so existem no contexto de trigger; declara-as para o
            # parser sem tocar em uma linha do corpo original.
            decl = 'new record; old record; tg_op text;'
            if re.match(r'\s*declare\b', corpo, flags=re.I):
                corpoParseavel = re.sub(r'(\s*declare\b)', r'\1 ' + decl, corpo, count=1, flags=re.I)
            else:
                corpoParseavel = f'\ndeclare {decl}\n' + corpo
        testar(f'corpo plpgsql de {nome}',
               f"create function pg_temp.f()\n{cab}\nas $x${corpoParseavel}$x$;",
               plpgsql=True)

    for i, m in enumerate(re.finditer(r"do \$\$(.*?)\$\$;", sql, re.S), 1):
        testar(f'bloco DO #{i}',
               f"create function pg_temp.d{i}() returns void language plpgsql as $x${m.group(1)}$x$;",
               plpgsql=True)

    for i, m in enumerate(re.finditer(r"\$pol\$(.*?)\$pol\$", sql, re.S), 1):
        testar(f'SQL embutido em EXECUTE $pol$ #{i}', m.group(1).strip())
    for i, m in enumerate(re.finditer(r"execute '([^']+)'", sql), 1):
        testar(f"SQL embutido em EXECUTE '...' #{i}", m.group(1))

print()
print(f"{len(falhas)} falha(s)" + (': ' + ', '.join(falhas) if falhas else ''))
sys.exit(1 if falhas else 0)

