#!/usr/bin/env bash
# =============================================================================
# TeksERP — tüm test takımı (3 proje) tek komutta. CI taslağı / lokal doğrulama.
# Kullanım: bash run-tests.sh  [--tsc]   (--tsc → ayrıca 3 projede tip kontrolü)
#
# Backend testleri YEREL PostgreSQL gerektirir (seed'li dev DB). Electron/mobil
# testleri DB'siz (jsdom / jest-expo). Sıralı koşar; ilk başarısızlıkta exit≠0.
# =============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
FAIL=0
WITH_TSC="${1:-}"

run() { # ad dizin komut
  echo ""
  echo "===================================================================="
  echo "▶ $1"
  echo "===================================================================="
  ( cd "$ROOT/$2" && eval "$3" ) || { echo "❌ $1 BAŞARISIZ"; FAIL=1; }
}

run "Backend — birim/entegrasyon (scripts/test_*.ts)" "Teks-Erp" "npm test"
run "Electron — Vitest" "Electron" "npm test"
run "mobil — jest-expo" "mobil" "npm test"

if [ "$WITH_TSC" = "--tsc" ]; then
  run "Backend tsc" "Teks-Erp" "npx tsc --noEmit"
  run "Electron tsc" "Electron" "npx tsc --noEmit"
  run "mobil tsc" "mobil" "npx tsc --noEmit"
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "✅ TÜM TEST TAKIMI YEŞİL"
else
  echo "❌ EN AZ BİR TAKIM BAŞARISIZ"
fi
exit $FAIL
