#!/bin/sh
set -e

echo ""
echo "================================================================"
echo "  TeksERP Backend — Container açılıyor"
echo "================================================================"

# =============================================================================
# 1) Prisma migration'ları (concurrent index'ler dahil)
# =============================================================================
# `CREATE INDEX CONCURRENTLY` Postgres tarafından transaction içinde
# çalıştırılamaz, ama `prisma migrate deploy` her migration'ı tx'e sarar.
# Çözüm: deploy bir concurrent migration'a takıldığında SQL'i psql ile manuel
# çalıştır, prisma'ya "uygulandı" işaretle, deploy'u tekrar dene.
# =============================================================================
echo "[1/3] Prisma migration'ları uygulanıyor..."

MAX_RETRIES=20
for i in $(seq 1 $MAX_RETRIES); do
  if npx prisma migrate deploy > /tmp/migrate.out 2>&1; then
    cat /tmp/migrate.out
    break
  fi

  cat /tmp/migrate.out

  # Hangi migration başarısız oldu? Önce _prisma_migrations tablosunu sor
  # (finished_at IS NULL = yarım kalmış migration). Tablo yoksa hata çıktısından
  # parse et.
  FAILED=$(psql "$DATABASE_URL" -tAc \
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1" \
    2>/dev/null | tr -d '[:space:]')
  if [ -z "$FAILED" ]; then
    FAILED=$(grep -oE "[0-9]{8,}_[a-zA-Z0-9_]+" /tmp/migrate.out | tail -1)
  fi

  if [ -z "$FAILED" ]; then
    echo "X Migration başarısız ama hangisi olduğu tespit edilemedi. Logları kontrol et."
    exit 1
  fi

  SQL="prisma/migrations/$FAILED/migration.sql"
  if [ ! -f "$SQL" ]; then
    echo "X $FAILED için SQL dosyası bulunamadı: $SQL"
    exit 1
  fi

  if grep -qi "CONCURRENTLY" "$SQL"; then
    echo ""
    echo "      → $FAILED 'CREATE INDEX CONCURRENTLY' içeriyor"
    echo "      → psql ile manuel uygulanıyor (transaction'sız)..."
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL"
    npx prisma migrate resolve --applied "$FAILED"
    echo "      ✓ $FAILED uygulandı, migrate deploy yeniden deneniyor..."
    echo ""
  else
    echo "X $FAILED CONCURRENTLY içermiyor ama yine de başarısız. Manuel inceleme gerek:"
    echo "   docker compose logs backend"
    exit 1
  fi
done

# =============================================================================
# 2) İlk kurulum: seed (users, permissions, quality grades, mobile templates,
#    label templates)
# =============================================================================
if [ ! -f /app/data/.seeded ]; then
  echo ""
  echo "[2/3] İlk kurulum tespit edildi — seed çalıştırılıyor..."

  if npm run seed; then
    echo "      ✓ Ana seed tamamlandı (admin / 123123 + 20 permission + 6 kullanıcı)"

    # Label template'leri seed.ts içermiyor, ayrı SQL ile yükle
    if [ -f scripts/seed-label-templates.sql ]; then
      echo "      → Default label template'leri (ROLL / SWATCH / SHIPMENT_DOCKET) yükleniyor..."
      if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-label-templates.sql >/dev/null; then
        echo "      ✓ Label template'leri yüklendi"
      else
        echo "      ! Label template seed başarısız (sunucu yine de açılacak)"
      fi
    fi

    touch /app/data/.seeded
  else
    echo "      ! Seed başarısız oldu."
    echo "      ! Manuel çalıştırma: docker compose exec backend npm run seed"
  fi
else
  echo "[2/3] Seed daha önce çalıştırılmış — atlanıyor."
fi

# =============================================================================
# 3) Express sunucusunu başlat
# =============================================================================
echo ""
echo "[3/3] Express sunucusu başlatılıyor (port 4000)..."
echo "================================================================"
echo ""

exec node dist/server.js
