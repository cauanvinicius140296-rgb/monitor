#!/usr/bin/env bash
# Restaura um backup gerado por scripts/backup.sh em um banco de destino.
#
# Uso (sempre em um banco NOVO ou de teste, primeiro):
#   TARGET_DATABASE_URL="postgresql://...?sslmode=require" \
#   RESTAURAR_CONFIRMAR=sim ./scripts/restore.sh backups/radar-XXXX.dump
#
# ATENÇÃO: a restauração usa --clean --if-exists, ou seja, substitui tabelas existentes
# no destino. Por isso exige RESTAURAR_CONFIRMAR=sim. Em Neon, prefira criar um branch
# novo, restaurar nele, conferir os dados e só então trocar a DATABASE_URL da aplicação.
set -euo pipefail

arquivo="${1:-}"
if [ -z "$arquivo" ] || [ ! -f "$arquivo" ]; then
  echo "Informe o caminho de um arquivo .dump existente." >&2
  exit 1
fi
if [ -z "${TARGET_DATABASE_URL:-}" ]; then
  echo "Defina TARGET_DATABASE_URL (banco de destino)." >&2
  exit 1
fi
if [ "${RESTAURAR_CONFIRMAR:-}" != "sim" ]; then
  echo "Restauração cancelada. Para confirmar, defina RESTAURAR_CONFIRMAR=sim." >&2
  exit 1
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore não encontrado. Instale o cliente PostgreSQL (versão compatível com o servidor)." >&2
  exit 1
fi

pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$TARGET_DATABASE_URL" "$arquivo"
echo "Restauração concluída em: destino informado em TARGET_DATABASE_URL."
echo "Confira depois: npm run db:migrate (idempotente) e acesse /api/health."
