#!/bin/bash
# yedekle.ps1 YEREL KURU PROVA - ilk-kurulum-yerel.sh'in kurdugu kokte (sahte PG araclari).
#   KONTEYNER=<pg-konteyneri> deploy/test/yedekle-yerel.sh <senaryo> [yedekle parametreleri]
#   LIST_BOZ=1 ...   -> pg_restore --list bozuk doner (dogrulama dali: .part silinir, saklama KOSMAZ)
set -u
AD="${1:?senaryo adi}"; shift
S="${YEREL_KOK:-${TMPDIR:-/tmp}/tekserp-ilk-kurulum-yerel}"
KOK="$S/$AD/kok"
[ -d "$KOK/pgsql/bin" ] || { echo "X once ilk-kurulum-yerel.sh $AD ... kos"; exit 2; }
export KONTEYNER="${KONTEYNER:-tekserp-local-db}"
if [ "${LIST_BOZ:-0}" = "1" ]; then
  cp "$KOK/pgsql/bin/pg_restore.exe" "$KOK/pgsql/bin/pg_restore.exe.asil"
  printf '#!/bin/bash\necho "pg_restore: error: input file does not appear to be a valid archive" >&2\nexit 1\n' > "$KOK/pgsql/bin/pg_restore.exe"
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
"${PWSH:-pwsh}" -NoProfile -File "$HERE/../yedekle.ps1" -Kok "$KOK" "$@"
KOD=$?
[ -f "$KOK/pgsql/bin/pg_restore.exe.asil" ] && mv "$KOK/pgsql/bin/pg_restore.exe.asil" "$KOK/pgsql/bin/pg_restore.exe"
echo "cikis=$KOD"
exit $KOD
