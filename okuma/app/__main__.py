"""Giriş noktası: `python -m app` — adres önce doğrulanır (0.0.0.0 yasak), sonra uvicorn tek süreçle açılır."""
from __future__ import annotations

import logging
import sys

from .config import BaglamaHatasi, ayarlari_oku


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        ay = ayarlari_oku()
    except (BaglamaHatasi, ValueError) as exc:
        print(f"okuma: başlatılamadı — {exc}", file=sys.stderr)
        return 2
    import uvicorn

    from .main import uygulama_kur

    # access_log kapalı: yol/istemci zaten kendi satırımızda; gövde hiçbir yerde loglanmaz.
    uvicorn.run(uygulama_kur(ay), host=ay.host, port=ay.port, workers=1, access_log=False, timeout_keep_alive=120, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
