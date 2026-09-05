#!/usr/bin/env bash
# SALT-OKUNUR psql — DEV DB (tekserp_saha_0825). Oturum default_transaction_read_only=on ile açılır;
# INSERT/UPDATE/DELETE/DDL sunucu tarafında reddedilir. Kullanım:
#   audit/tools/sql-dev.sh -c "SELECT count(*) FROM rolls"
#   audit/tools/sql-dev.sh -f audit/data/sorgu.sql
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URL="$(grep -E '^DATABASE_URL' "$ROOT/Teks-Erp/.env" | cut -d= -f2- | tr -d '"' | sed -E 's/\?.*$//')"
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=120000'
URL="${URL%/*}/tekserp_saha_0825"
exec psql "$URL" -v ON_ERROR_STOP=1 -X "$@"
