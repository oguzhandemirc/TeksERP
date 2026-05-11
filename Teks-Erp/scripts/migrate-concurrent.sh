#!/usr/bin/env bash
# =============================================================================
# Concurrent index migration runner
# =============================================================================
# `CREATE INDEX CONCURRENTLY` Prisma'nın transaction sarmaladığı normal migrate
# komutuyla çalışmaz (Postgres CONCURRENTLY'yi tx içinde reddediyor). Bu script:
#   1. Migration SQL'ini doğrudan psql ile çalıştırır (transaction yok)
#   2. Prisma'ya "uygulandı" diye işaretletir
# Sonuç: canlı tabloda yazma kilidi alınmadan index oluşur — operatör mal
# kabulüne devam ederken arka planda index ekleniyor.
#
# Kullanım:
#   npm run migrate:concurrent <migration-name>
#
# Örnek:
#   npm run migrate:concurrent 20260507000100_ops_date_range_indexes
# =============================================================================

set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "HATA: migration adı gerekli." >&2
  echo "Kullanım: npm run migrate:concurrent <migration-name>" >&2
  exit 1
fi

# Repo kökü = bu script'in iki üst klasörü
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_PATH="$ROOT/prisma/migrations/$NAME/migration.sql"

if [[ ! -f "$SQL_PATH" ]]; then
  echo "HATA: migration bulunamadı: $SQL_PATH" >&2
  exit 1
fi

# Sanity check: bu script sadece CONCURRENTLY içeren migration'lar için.
# Aksi takdirde `prisma migrate deploy` kullanılmalı.
if ! grep -qi "CONCURRENTLY" "$SQL_PATH"; then
  echo "HATA: '$NAME' içinde CONCURRENTLY yok." >&2
  echo "Bu script sadece concurrent index migration'ları içindir." >&2
  echo "Normal migration için: npx prisma migrate deploy" >&2
  exit 1
fi

# DATABASE_URL .env'den oku (yoksa zaten ortamda olmalı).
if [[ -z "${DATABASE_URL:-}" && -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "HATA: DATABASE_URL set edilmemiş ve .env'de yok." >&2
  exit 1
fi

# Prisma'nın `?schema=public` parametresi psql tarafından tanınmıyor —
# parametreyi söker, schema'yı PGOPTIONS ile geçer.
PSQL_URL="${DATABASE_URL%%\?*}"
SCHEMA="$(printf '%s' "$DATABASE_URL" | sed -n 's/.*[?&]schema=\([^&]*\).*/\1/p')"
SCHEMA="${SCHEMA:-public}"

echo "→ SQL çalıştırılıyor: $SQL_PATH (schema=$SCHEMA)"
PGOPTIONS="--search_path=$SCHEMA" psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "$SQL_PATH"

echo "→ Prisma'ya 'uygulandı' işaretleniyor"
cd "$ROOT"
npx prisma migrate resolve --applied "$NAME"

echo "✓ '$NAME' uygulandı."
