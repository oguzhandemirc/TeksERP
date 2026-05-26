#!/usr/bin/env bash
# TeksERP - Postgres yedek al
# Çıktı: backups/tekserp_<tarih>.sql.gz
# Eski yedekler (7 günden eski) otomatik silinir.

set -e
cd "$(dirname "$0")"

if [ ! -f .env.docker ]; then
  echo "X .env.docker bulunamadı. Önce ./baslat.sh çalıştır."
  exit 1
fi

mkdir -p backups
TS=$(date +%Y%m%d_%H%M%S)
OUT="backups/tekserp_${TS}.sql.gz"

set -a
. ./.env.docker
set +a

echo "Yedek alınıyor: $OUT"
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$OUT"

# 7 günden eski yedekleri sil
find backups -name "tekserp_*.sql.gz" -type f -mtime +7 -delete 2>/dev/null || true

SIZE=$(du -h "$OUT" | awk '{print $1}')
echo "✓ Yedek tamam — $OUT ($SIZE)"
echo ""
echo "Geri yüklemek için:"
echo "  gunzip -c $OUT | docker compose exec -T postgres psql -U \$POSTGRES_USER -d \$POSTGRES_DB"
