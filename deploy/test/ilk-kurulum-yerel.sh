#!/bin/bash
# =============================================================================
# ilk-kurulum.ps1 YEREL KURU PROVA - macOS/Linux, pwsh 7.3+ ve docker'da bir PostgreSQL 16
# =============================================================================
#   KONTEYNER=<pg-konteyneri> deploy/test/ilk-kurulum-yerel.sh <senaryo> <Legacy|Standard> [ilk-kurulum parametreleri]
#   ornek:
#     docker run -d --name tekserp-kurulum-prova-pg -e POSTGRES_PASSWORD=<x> postgres:16-alpine
#     KONTEYNER=tekserp-kurulum-prova-pg deploy/test/ilk-kurulum-yerel.sh s1 Legacy \
#       -DbAdi tekserp_s1_test -DbParolaDosyasi /tmp/db.txt -PostgresParola KONTEYNER_PAROLA \
#       -Dump /tmp/kaynak.dump -DumpAmaci Kopya -PgAyarla
# PG araclari (psql/pg_dump/pg_restore.exe) sahte: konteynere `docker exec` ile gider.
# `KONTEYNER_PAROLA` argumani konteynerin POSTGRES_PASSWORD'u ile degistirilir.
# `Legacy` = Windows PowerShell 5.1'in native arguman gecirme kipi (tirnak kacisi olculur).
# Olcmedikleri (Windows'a ozgu): mklink, icacls/Get-Acl, Gorev Zamanlayici, guvenlik
# duvari, RAM - betik bunlari "YAPILMADAN KALANLAR"a yazar; Windows'ta ayrica dogrulanir.
# KAPILAR: paylasilan gelistirme kumesinde (tekserp-local-db) yalniz `_test` DB ve
# -PgAyarla YOK (ALTER SYSTEM kumenin TUM veritabanlarini etkiler); `tekserp_fabrika_*` hic.
# Kok dizinleri: ${YEREL_KOK:-$TMPDIR/tekserp-ilk-kurulum-yerel}/<senaryo>/kok (ikinci kosum icin kalir).
# =============================================================================
set -u
AD="${1:?senaryo adi}"; KIP="${2:?Legacy|Standard}"; shift 2
export KONTEYNER="${KONTEYNER:-tekserp-local-db}"
DB=""; PGAYARLA=0; prev=""
for x in "$@"; do
  [ "$prev" = "-DbAdi" ] && DB="$x"
  [ "$x" = "-PgAyarla" ] && PGAYARLA=1
  prev="$x"
done
case "$DB" in tekserp_fabrika_*) echo "X fabrika verisi adi: $DB - kosulmaz"; exit 2;; esac
if [ "$KONTEYNER" = "tekserp-local-db" ]; then
  case "$DB" in *_test) ;; *) echo "X paylasilan kumede DbAdi _test ile bitmeli (verilen: '${DB:-yok}')"; exit 2;; esac
  [ "$PGAYARLA" = "1" ] && { echo "X paylasilan kumede -PgAyarla YOK (ALTER SYSTEM tum DB'leri etkiler) - tek kullanimlik konteyner kullan"; exit 2; }
fi
S="${YEREL_KOK:-${TMPDIR:-/tmp}/tekserp-ilk-kurulum-yerel}"
KOK="$S/$AD/kok"
BIN="$KOK/pgsql/bin"
mkdir -p "$BIN" "$KOK/pm2/node_modules/.bin"
touch "$KOK/pm2/node_modules/.bin/pm2.cmd"
cat > "$BIN/psql.exe" <<'EOF'
#!/bin/bash
a=(); while [ $# -gt 0 ]; do case "$1" in -h|-p) shift 2;; *) a+=("$1"); shift;; esac; done
exec docker exec -i -e PGPASSWORD="${PGPASSWORD:-}" "$KONTEYNER" psql -h localhost -p 5432 "${a[@]}"
EOF
cat > "$BIN/pg_restore.exe" <<'EOF'
#!/bin/bash
a=(); f=""; while [ $# -gt 0 ]; do case "$1" in -h|-p) shift 2;; -*) a+=("$1"); shift;; *) if [ -f "$1" ]; then f="$1"; else a+=("$1"); fi; shift;; esac; done
if [ -n "$f" ]; then exec docker exec -i -e PGPASSWORD="${PGPASSWORD:-}" "$KONTEYNER" pg_restore -h localhost -p 5432 "${a[@]}" < "$f"; fi
exec docker exec -i -e PGPASSWORD="${PGPASSWORD:-}" "$KONTEYNER" pg_restore -h localhost -p 5432 "${a[@]}"
EOF
cat > "$BIN/pg_dump.exe" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "--version" ]; then echo "pg_dump (PostgreSQL) 16"; exit 0; fi
a=(); o=""; while [ $# -gt 0 ]; do case "$1" in -h|-p) shift 2;; -f) o="$2"; shift 2;; *) a+=("$1"); shift;; esac; done
docker exec -i -e PGPASSWORD="${PGPASSWORD:-}" "$KONTEYNER" pg_dump -h localhost -p 5432 "${a[@]}" > "$o"
EOF
chmod +x "$BIN"/*.exe
HERE="$(cd "$(dirname "$0")" && pwd)"
KP="$(docker exec "$KONTEYNER" printenv POSTGRES_PASSWORD)"
ARGS=(); for x in "$@"; do if [ "$x" = "KONTEYNER_PAROLA" ]; then ARGS+=("$KP"); else ARGS+=("$x"); fi; done
"${PWSH:-pwsh}" -NoProfile -File "$HERE/yerel-sar.ps1" -Kip "$KIP" -Betik "$HERE/../ilk-kurulum.ps1" -Kok "$KOK" -PgBin "$BIN" "${ARGS[@]}"
