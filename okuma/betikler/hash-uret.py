"""Pinli paket listesinden `--require-hashes` requirements dosyası üretir (PyPI JSON; yalnız standart kitaplık).

Kullanım: python betikler/hash-uret.py girdi.txt > requirements.txt
Girdi satırı `ad==sürüm  # neden` biçimindedir; her sürümün PyPI'deki TÜM dağıtım dosyalarının (wheel + sdist)
sha256'sı yazılır — Linux/Windows/macOS aynı dosyayla kurulur. Sürüm yükseltme = girdiyi değiştir + yeniden üret.
"""
from __future__ import annotations

import json
import sys
import urllib.request


def main() -> int:
    for ham in open(sys.argv[1], encoding="utf-8"):
        satir = ham.strip()
        if not satir or satir.startswith("#"):
            print(satir)
            continue
        paket, _, yorum = satir.partition("#")
        ad, _, surum = paket.strip().partition("==")
        with urllib.request.urlopen(f"https://pypi.org/pypi/{ad}/{surum}/json", timeout=60) as y:  # noqa: S310
            veri = json.load(y)
        ozetler = sorted({f["digests"]["sha256"] for f in veri["urls"]})
        if not ozetler:
            print(f"{ad}=={surum}: PyPI'de dosya yok", file=sys.stderr)
            return 1
        print(f"{ad}=={surum}" + (f"  # {yorum.strip()}" if yorum.strip() else "") + " \\")
        print(" \\\n".join(f"    --hash=sha256:{h}" for h in ozetler))
    return 0


if __name__ == "__main__":
    sys.exit(main())
