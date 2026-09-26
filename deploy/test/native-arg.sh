#!/bin/bash
# ilk-kurulum.ps1 `NativeArg`: SQL argumani Standard ve Legacy (5.1) kipte bozulmadan variyor mu.
#   deploy/test/native-arg.sh [betik]      (varsayilan deploy/ilk-kurulum.ps1; pwsh 7.3+ gerekir)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${1:-$HERE/../ilk-kurulum.ps1}"
TMP="$(mktemp -d)"
printf '#!/bin/bash\nprintf "%%s" "$1"\n' > "$TMP/arg-yaz"
chmod +x "$TMP/arg-yaz"
"${PWSH:-pwsh}" -NoProfile -File "$HERE/native-arg.harness.ps1" -Script "$SCRIPT" -Exe "$TMP/arg-yaz"
KOD=$?
rm -rf "$TMP"
exit $KOD
