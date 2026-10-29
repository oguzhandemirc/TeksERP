"""Ağsız koşucu (test_agsiz.py çağırır): TAZE yorumlayıcıda, HİÇBİR import'tan önce döngü dışı soketi engeller,
servisi açar, sentetik görüntüyü okur ve sonucu JSON olarak basar. Engellenen her girişim kaydedilir."""
from __future__ import annotations

import ipaddress
import json
import socket
import sys

GIRISIMLER: list[str] = []
_asil_connect = socket.socket.connect
_asil_connect_ex = socket.socket.connect_ex
_asil_getaddrinfo = socket.getaddrinfo


def _dongu(host) -> bool:
    if host in ("localhost",):
        return True
    try:
        return ipaddress.ip_address(str(host).strip("[]")).is_loopback
    except ValueError:
        return False


def _connect(self, adres):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _dongu(adres[0]):
        GIRISIMLER.append(f"connect:{adres[0]}")
        raise OSError("ağ engelli (test)")
    return _asil_connect(self, adres)


def _connect_ex(self, adres):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _dongu(adres[0]):
        GIRISIMLER.append(f"connect_ex:{adres[0]}")
        return 101
    return _asil_connect_ex(self, adres)


def _getaddrinfo(host, *a, **k):
    if host is not None and not _dongu(host):
        GIRISIMLER.append(f"dns:{host}")
        raise socket.gaierror("ağ engelli (test)")
    return _asil_getaddrinfo(host, *a, **k)


socket.socket.connect = _connect
socket.socket.connect_ex = _connect_ex
socket.getaddrinfo = _getaddrinfo

sys.path.insert(0, sys.argv[1])  # okuma/
sys.path.insert(0, sys.argv[1] + "/tests")
from conftest import SENTETIK, Sunucu, ayarlar, ocr_govdesi  # noqa: E402

from app.indirme_kapisi import kapali_mi  # noqa: E402
from app.main import uygulama_kur  # noqa: E402

with Sunucu(uygulama_kur(ayarlar())) as s:
    saglik = s.istek("/health")
    okuma = s.istek("/ocr", ocr_govdesi(SENTETIK.read_bytes()))
print(json.dumps({"saglik": saglik[0], "ocr": okuma[0], "metin": okuma[1].get("text", ""), "girisimler": GIRISIMLER, "indirme_kapali": kapali_mi()}))
