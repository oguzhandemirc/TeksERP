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
# libpq, Prisma'ya özgü `schema=` URI parametresini tanımaz ve bağlanmayı reddeder.
PSQL_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')

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
  FAILED=$(psql "$PSQL_URL" -tAc \
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
    psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "$SQL"
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
# 2) İlk kurulum seed'i — YALNIZ şema boşsa VE SEED_ON_EMPTY=1 ise (fail-closed)
# =============================================================================
# Ölçüt DB'nin kendisidir, işaret dosyası değil: işaret `app_data` biriminde,
# veri `pg_data`da durur; işaret kaybolursa dolu DB'ye seed koşar ve silinmiş
# `admin` bilinen parolayla geri doğardı. "Boş" = `users` tablosunda hiç satır
# yok; sorgu düşer ya da sayı okunamazsa seed ATLANIR.
USERS_COUNT=$(psql "$PSQL_URL" -tAc "SELECT count(*) FROM users" 2>/dev/null | tr -d '[:space:]') || USERS_COUNT=""
case "$USERS_COUNT" in
  ''|*[!0-9]*) USERS_COUNT="" ;;
esac

if [ -z "$USERS_COUNT" ]; then
  echo "[2/3] Seed ATLANDI — kullanıcı sayısı okunamadı (şemanın boş olduğu kanıtlanamadı)."
elif [ "$USERS_COUNT" != "0" ]; then
  echo "[2/3] Seed ATLANDI — veritabanında $USERS_COUNT kullanıcı var (dolu kurulum)."
elif [ "${SEED_ON_EMPTY:-0}" != "1" ]; then
  echo "[2/3] Seed ATLANDI — şema boş ama SEED_ON_EMPTY=1 verilmedi."
  echo "      İlk kurulumsa: SEED_ON_EMPTY=1 docker compose up -d"
else
  echo ""
  echo "[2/3] Boş şema + SEED_ON_EMPTY=1 — ilk kurulum seed'i çalıştırılıyor..."
  if node dist/tools/seed.cjs; then
    echo "      ✓ Seed tamamlandı (yalnız admin kullanıcısı — ilk girişte parolayı değiştirin)"
  else
    echo "      ! Seed başarısız oldu."
    echo "      ! Tekrar denemek için konteyneri yeniden başlatın (şema hâlâ boşsa seed yeniden koşar)."
  fi
fi

# =============================================================================
# 3) Express sunucusunu başlat
# =============================================================================
echo ""
echo "[3/3] Express sunucusu başlatılıyor (port 4000)..."
echo "================================================================"
echo ""

exec node dist/server.js
