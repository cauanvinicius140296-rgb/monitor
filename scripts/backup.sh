#!/usr/bin/env bash
# Gera um backup do banco do Radar de Preços em formato custom do pg_dump.
#
# Uso:
#   DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" ./scripts/backup.sh [pasta_destino]
#
# Requisitos: cliente pg_dump com versão igual ou superior à do servidor (Neon usa PostgreSQL 17).
# O arquivo gerado contém todos os dados (inclusive hashes de senha e histórico de preços):
# guarde-o em local privado e nunca o publique em repositórios ou artefatos públicos.
# Nenhum dado é enviado a terceiros por este script.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Defina DATABASE_URL antes de rodar o backup." >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump não encontrado. Instale o cliente PostgreSQL (versão compatível com o servidor)." >&2
  exit 1
fi

destino="${1:-backups}"
mkdir -p "$destino"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
arquivo="$destino/radar-$stamp.dump"

pg_dump --format=custom --no-owner --no-privileges --file "$arquivo" "$DATABASE_URL"

# Verifica o índice do arquivo gerado (falha aqui se o dump estiver corrompido).
pg_restore --list "$arquivo" >/dev/null
echo "Backup criado e verificado: $arquivo"
