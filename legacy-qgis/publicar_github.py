# =============================================================================
# PUBLICADOR GITHUB — WartoolC2
# Exporta as camadas como GeoJSON e commita no repositório GitHub
# Chamado automaticamente pelo CopAtualizador após cada atualização
#
# Pré-requisitos:
#   1. git instalado (git version 2.54 confirmado)
#   2. Repositório clonado em CAMINHO_REPO
#   3. Autenticação git configurada (ver instruções abaixo)
#
# Configuração inicial (rodar UMA vez no Prompt de Comando):
#   cd C:\exercicio\wartoolc2
#   git config user.name "joaopaulo1008"
#   git config user.email "seu@email.com"
# =============================================================================

import os
import json
import subprocess
from datetime import datetime

from qgis.core import QgsProject, QgsJsonExporter, QgsCoordinateReferenceSystem

# =============================================================================
# CONFIGURAÇÃO
# =============================================================================

GITHUB_USUARIO  = 'joaopaulo1008'
GITHUB_REPO     = 'wartoolc2'
CAMINHO_REPO    = r'C:\exercicio\wartoolc2'   # pasta onde o repo está clonado
ARQUIVO_GEOJSON = 'data/cop_tatico.geojson'     # nome do arquivo no repo (movido para data/ na reorganização)

# Nomes das camadas no QGIS (devem bater com GRUPOS_HOSTILIDADE do cop_tatico.py)
NOMES_CAMADAS = [
    'COP — Amigo',
    'COP — Hostil',
    'COP — Neutro',
    'COP — Desconhecido',
]


# =============================================================================
# EXPORTAÇÃO DAS CAMADAS PARA GEOJSON
# =============================================================================

def exportar_geojson():
    """
    Junta todas as camadas COP num único GeoJSON e salva no repositório.
    Retorna o caminho do arquivo gerado ou None se falhar.
    """
    features = []

    for nome in NOMES_CAMADAS:
        camadas = QgsProject.instance().mapLayersByName(nome)
        if not camadas:
            continue
        camada = camadas[0]

        exporter = QgsJsonExporter(camada)
        exporter.setSourceCrs(QgsCoordinateReferenceSystem('EPSG:4326'))
        exporter.setDestinationCrs(QgsCoordinateReferenceSystem('EPSG:4326'))

        geojson_str = exporter.exportFeatures(list(camada.getFeatures()))
        try:
            geojson = json.loads(geojson_str)
            features.extend(geojson.get('features', []))
        except json.JSONDecodeError as e:
            print(f'  ⚠ Erro ao serializar {nome}: {e}')

    if not features:
        print('  ⚠ Nenhuma feição para exportar')
        return None

    # Monta FeatureCollection com metadados
    colecao = {
        'type': 'FeatureCollection',
        'generated': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total': len(features),
        'features': features,
    }

    caminho = os.path.join(CAMINHO_REPO, ARQUIVO_GEOJSON)
    with open(caminho, 'w', encoding='utf-8') as f:
        json.dump(colecao, f, ensure_ascii=False, indent=2)

    print(f'  ✓ GeoJSON: {len(features)} elementos → {ARQUIVO_GEOJSON}')
    return caminho


# =============================================================================
# COMMIT E PUSH NO GITHUB
# =============================================================================

def _git(args, cwd=CAMINHO_REPO):
    """Executa um comando git e retorna (sucesso, output)."""
    try:
        r = subprocess.run(
            ['git'] + args,
            cwd=cwd,
            capture_output=True,
            encoding='utf-8',
            errors='replace',
            timeout=30,
        )
        return r.returncode == 0, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return False, 'Timeout — verifique a conexão com o GitHub'
    except Exception as e:
        return False, str(e)


def publicar_no_github():
    """
    Exporta o GeoJSON, commita e faz push para o GitHub.
    Retorna True se publicou com sucesso.
    """
    if not os.path.isdir(CAMINHO_REPO):
        print(f'  ❌ Repositório não encontrado: {CAMINHO_REPO}')
        print(f'     Clone com: git clone https://github.com/{GITHUB_USUARIO}/{GITHUB_REPO}.git {CAMINHO_REPO}')
        return False

    # 1. Exporta GeoJSON
    caminho_geojson = exportar_geojson()
    if not caminho_geojson:
        return False

    # 2. Verifica se há mudança
    ok, status = _git(['status', '--porcelain'])
    if ok and not status:
        print('  · GitHub: sem mudanças, skip')
        return True

    # 3. Stage
    ok, out = _git(['add', ARQUIVO_GEOJSON])
    if not ok:
        print(f'  ⚠ git add falhou: {out}')
        return False

    # 4. Commit
    msg = f'COP update {datetime.now().strftime("%d/%m/%Y %H:%M")}'
    ok, out = _git(['commit', '-m', msg])
    if not ok:
        print(f'  ⚠ git commit falhou: {out}')
        return False

    # 5. Push
    ok, out = _git(['push'])
    if ok:
        print(f'  ✓ GitHub publicado — {msg}')
        print(f'    🌐 https://{GITHUB_USUARIO}.github.io/{GITHUB_REPO}')
        return True
    else:
        print(f'  ⚠ git push falhou: {out}')
        print('    Verifique a autenticação (ver instruções no topo do arquivo)')
        return False


# =============================================================================
# TESTE MANUAL
# Execute este arquivo diretamente para testar sem o CopAtualizador
# =============================================================================

if __name__ == '__main__' or 'iface' in dir():
    publicar_no_github()
