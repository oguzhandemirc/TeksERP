#!/bin/bash
# deploy/*.ps1 sozdizimi denetimi (macOS/Linux, pwsh gerekir). Windows'ta:
#   powershell -ExecutionPolicy Bypass -File deploy\test\sozdizimi.ps1
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$#" -gt 0 ]; then
  LISTE="$(IFS=,; echo "$*")"
  exec "${PWSH:-pwsh}" -NoProfile -File "$HERE/sozdizimi.ps1" -Dosyalar "$LISTE"
fi
exec "${PWSH:-pwsh}" -NoProfile -File "$HERE/sozdizimi.ps1"
