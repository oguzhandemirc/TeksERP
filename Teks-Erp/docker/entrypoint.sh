#!/bin/sh
set -e

# =============================================================================
# İki kip:
#   açılış (varsayılan)  göç(*) → seed kapısı → sunucu
#   goc                  yalnız göç + şema denetimi, sunucu AÇILMAZ — `entrypoint.sh goc` ya da imajdaki
#                        `goc` bağı (`docker compose run --rm --no-deps backend goc`, güncelleyicinin GOC adımı)
# (*) TEKSERP_GOC_ACILISTA: yok/boş/"1" = açılışta göç (bugünkü davranış) · "0" = açılışta göç YOK, yalnız
#     şema denetimi (göçü güncelleyici koşar; "0"ı yalnız güncelleyicili compose yazar) · başka değer = çık.
# Çıkış kodları TEK tabloda: docker/korumali/acilis-kodlari.json (test_docker_hijyeni §7 iki yönlü ölçer).
# =============================================================================
KOD_KIP_GECERSIZ=40
KOD_GOC_TANISIZ=41
KOD_GOC_SQL_YOK=42
KOD_GOC_BASARISIZ=43
KOD_GOC_ELLE_BASARISIZ=44
KOD_GOC_DENEME_TUKENDI=45
KOD_SEMA_OLCULEMEDI=46
KOD_GOC_BEKLIYOR=47
KOD_GOC_YARIM=48
KOD_SEMA_ILERIDE=49

KIP=acilis
if [ "$(basename "$0")" = "goc" ] || [ "${1:-}" = "goc" ]; then
  KIP=goc
fi

echo ""
echo "================================================================"
if [ "$KIP" = "goc" ]; then
  echo "  TeksERP — göç aracı (sunucu açılmaz)"
else
  echo "  TeksERP Backend — Container açılıyor"
fi
echo "================================================================"

# libpq, Prisma'ya özgü `schema=` URI parametresini tanımaz ve bağlanmayı reddeder.
PSQL_URL=$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')
# Korumalı imajda npm/npx YOK (yalnız paketin node ikilisi): Dockerfile PRISMA_BIN'i CLI'ın
# kendisine çevirir; tanımsızsa bugünkü davranış (npx prisma).
PRISMA_BIN="${PRISMA_BIN:-npx prisma}"

# =============================================================================
# Göç (concurrent index'ler dahil) — `CONCURRENTLY` kuralının TEK yeri
# =============================================================================
# `CREATE INDEX CONCURRENTLY` Postgres tarafından transaction içinde
# çalıştırılamaz, ama `prisma migrate deploy` her migration'ı tx'e sarar.
# Çözüm: deploy bir concurrent migration'a takıldığında SQL'i psql ile manuel
# çalıştır, prisma'ya "uygulandı" işaretle, deploy'u tekrar dene.
goc_uygula() {
  MAX_RETRIES=20
  TAMAM=0
  for i in $(seq 1 $MAX_RETRIES); do
    if $PRISMA_BIN migrate deploy > /tmp/migrate.out 2>&1; then
      cat /tmp/migrate.out
      TAMAM=1
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
      exit $KOD_GOC_TANISIZ
    fi

    SQL="prisma/migrations/$FAILED/migration.sql"
    if [ ! -f "$SQL" ]; then
      echo "X $FAILED için SQL dosyası bulunamadı: $SQL"
      exit $KOD_GOC_SQL_YOK
    fi

    if grep -qi "CONCURRENTLY" "$SQL"; then
      echo ""
      echo "      → $FAILED 'CREATE INDEX CONCURRENTLY' içeriyor"
      echo "      → psql ile manuel uygulanıyor (transaction'sız)..."
      psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "$SQL" || { echo "X $FAILED elle uygulanamadı (psql)."; exit $KOD_GOC_ELLE_BASARISIZ; }
      $PRISMA_BIN migrate resolve --applied "$FAILED" || { echo "X $FAILED uygulandı işaretlenemedi (migrate resolve)."; exit $KOD_GOC_ELLE_BASARISIZ; }
      echo "      ✓ $FAILED uygulandı, migrate deploy yeniden deneniyor..."
      echo ""
    else
      echo "X $FAILED CONCURRENTLY içermiyor ama yine de başarısız. Manuel inceleme gerek:"
      echo "   docker compose logs backend"
      exit $KOD_GOC_BASARISIZ
    fi
  done
  if [ "$TAMAM" != "1" ]; then
    echo "X migrate deploy $MAX_RETRIES denemede bitmedi."
    exit $KOD_GOC_DENEME_TUKENDI
  fi
}

# =============================================================================
# Şema denetimi — imajdaki göç kümesi = DB'de bitmiş göç kümesi mi (fail-closed)
# =============================================================================
# Bekleyen göç (DB geride), yarım göç ya da imajın tanımadığı göç (DB ileride: eski imaj yeni şemada)
# varsa sunucu AÇILMAZ; ölçülemezse de açılmaz.
sema_denetle() {
  YEREL=/tmp/goc-yerel.txt
  DBDE=/tmp/goc-db.txt
  : > "$YEREL"
  for d in prisma/migrations/*/; do
    if [ -f "${d}migration.sql" ]; then basename "$d" >> "$YEREL"; fi
  done
  LC_ALL=C sort -u -o "$YEREL" "$YEREL"
  if [ ! -s "$YEREL" ]; then
    echo "X Şema denetimi: imajda göç bulunamadı (prisma/migrations)."
    exit $KOD_SEMA_OLCULEMEDI
  fi

  TABLO=$(psql "$PSQL_URL" -tAc "SELECT to_regclass('public._prisma_migrations') IS NOT NULL" 2>/dev/null) || TABLO=""
  TABLO=$(printf '%s' "$TABLO" | tr -d '[:space:]')
  case "$TABLO" in
    t)
      YARIM=$(psql "$PSQL_URL" -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL" 2>/dev/null) || YARIM=""
      YARIM=$(printf '%s' "$YARIM" | tr -d '[:space:]')
      case "$YARIM" in ''|*[!0-9]*) echo "X Şema denetimi: yarım göç sayısı okunamadı."; exit $KOD_SEMA_OLCULEMEDI ;; esac
      if [ "$YARIM" != "0" ]; then
        echo "X Şema denetimi: $YARIM yarım kalmış göç var (finished_at boş)."
        exit $KOD_GOC_YARIM
      fi
      psql "$PSQL_URL" -tAc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" > "$DBDE" 2>/dev/null \
        || { echo "X Şema denetimi: bitmiş göçler okunamadı."; exit $KOD_SEMA_OLCULEMEDI; }
      ;;
    f) : > "$DBDE" ;;
    *) echo "X Şema denetimi: veritabanına ulaşılamadı."; exit $KOD_SEMA_OLCULEMEDI ;;
  esac
  sed -e 's/[[:space:]]//g' -e '/^$/d' "$DBDE" | LC_ALL=C sort -u > "$DBDE.s"

  BEKLEYEN=$(LC_ALL=C comm -23 "$YEREL" "$DBDE.s" | wc -l | tr -d '[:space:]')
  ILERIDE=$(LC_ALL=C comm -13 "$YEREL" "$DBDE.s" | wc -l | tr -d '[:space:]')
  TOPLAM=$(wc -l < "$YEREL" | tr -d '[:space:]')
  if [ "$BEKLEYEN" != "0" ]; then
    echo "X Şema denetimi: $BEKLEYEN göç uygulanmamış (ilk: $(LC_ALL=C comm -23 "$YEREL" "$DBDE.s" | head -1))."
    exit $KOD_GOC_BEKLIYOR
  fi
  if [ "$ILERIDE" != "0" ]; then
    echo "X Şema denetimi: veritabanında bu imajın tanımadığı $ILERIDE göç var (ilk: $(LC_ALL=C comm -13 "$YEREL" "$DBDE.s" | head -1))."
    exit $KOD_SEMA_ILERIDE
  fi
  echo "      ✓ Şema denetimi: $TOPLAM göç, imaj = veritabanı."
}

if [ "$KIP" = "goc" ]; then
  echo "[1/2] Prisma migration'ları uygulanıyor..."
  goc_uygula
  echo "[2/2] Şema denetleniyor..."
  sema_denetle
  echo "GOC_TAMAM"
  exit 0
fi

case "${TEKSERP_GOC_ACILISTA:-}" in
  ''|1)
    echo "[1/3] Prisma migration'ları uygulanıyor..."
    goc_uygula
    ;;
  0)
    echo "[1/3] Açılışta göç KAPALI (TEKSERP_GOC_ACILISTA=0) — şema denetleniyor..."
    sema_denetle
    ;;
  *)
    echo "X TEKSERP_GOC_ACILISTA tanınmıyor (yalnız boş, 0 ya da 1)."
    exit $KOD_KIP_GECERSIZ
    ;;
esac

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
    echo "      ✓ Seed tamamlandı (yalnız admin — parola yukarıda bir kez basıldı ya da ILK_YONETICI_PAROLASI;"
    echo "        ilk girişte yeni parola zorunlu)"
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
