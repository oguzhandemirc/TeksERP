"""Model dosyalarını manifestten indirir ve SHA-256 doğrular — YALNIZ kurulum/geliştirme/CI anında, servis değil.

Kullanım: python betikler/modelleri-getir.py [--hedef okuma/modeller] [--kaynak <yerel dizin>]
`--kaynak` verilirse ağa çıkmadan oradan kopyalar (çevrimdışı hazırlık). Özet tutmayan dosya yazılmaz.
Yalnız standart kitaplık (yeni paket yok).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent


def sha256(yol: Path) -> str:
    h = hashlib.sha256()
    with yol.open("rb") as f:
        for p in iter(lambda: f.read(1 << 20), b""):
            h.update(p)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hedef", default=str(KOK / "modeller"))
    ap.add_argument("--kaynak", default=None)
    a = ap.parse_args()
    hedef = Path(a.hedef)
    hedef.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((KOK / "modeller" / "manifest.json").read_text("utf-8"))
    hata = 0
    for rol, m in manifest["modeller"].items():
        son = hedef / m["dosya"]
        if son.is_file() and sha256(son) == m["sha256"]:
            print(f"[{rol}] mevcut, özet tutuyor: {m['dosya']}")
            continue
        with tempfile.NamedTemporaryFile(dir=hedef, delete=False, suffix=".part") as tmp:
            gecici = Path(tmp.name)
        try:
            if a.kaynak:
                shutil.copyfile(Path(a.kaynak) / m["dosya"], gecici)
            else:
                if not m["url"].startswith("https://"):
                    raise ValueError("yalnız https kaynak")
                with urllib.request.urlopen(m["url"], timeout=120) as yanit, gecici.open("wb") as f:  # noqa: S310
                    shutil.copyfileobj(yanit, f)
            ozet = sha256(gecici)
            if ozet != m["sha256"]:
                print(f"[{rol}] ÖZET TUTMADI: {ozet} != {m['sha256']}", file=sys.stderr)
                hata += 1
                continue
            gecici.replace(son)
            print(f"[{rol}] indirildi ve doğrulandı: {m['dosya']} ({son.stat().st_size} bayt)")
        finally:
            if gecici.exists():
                gecici.unlink()
    return 1 if hata else 0


if __name__ == "__main__":
    sys.exit(main())
