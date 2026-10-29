#!/usr/bin/env bash
# Geliştirici çalıştırma betiği (paketleme DEĞİL): .venv yoksa kurar (hash'li), modelleri getirir, servisi 127.0.0.1'de açar.
#   okuma/betikler/calistir.sh                 # http://127.0.0.1:8765
#   OKUMA_PORT=8766 okuma/betikler/calistir.sh
# Backend'e bağlamak: Teks-Erp/.env → GELEN_BELGE_OKUMA_URL=http://127.0.0.1:8765
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${OKUMA_PY:-python3.12}"
if [ ! -x .venv/bin/python ]; then
  "$PY" -m venv .venv
  .venv/bin/python -m pip install --require-hashes --no-deps -r requirements.txt
fi
.venv/bin/python betikler/modelleri-getir.py
exec .venv/bin/python -m app
