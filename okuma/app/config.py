"""Yapılandırma — TEK çözüm yeri. Ortam değişkenleri yalnız burada okunur.

Bağlama kuralı (FAIL-CLOSED): varsayılan 127.0.0.1; döngü adresleri (127.0.0.0/8, ::1, localhost) serbest;
Linux compose iç servis adı (noktasız, IP olmayan ad, ör. `okuma`) YALNIZ `OKUMA_IC_AD_IZNI=1` ile;
0.0.0.0 / :: / döngü dışı her IP / noktalı ad REDDEDİLİR.
"""
from __future__ import annotations

import ipaddress
import os
import re
from dataclasses import dataclass
from pathlib import Path

OKUMA_KOK = Path(__file__).resolve().parent.parent
VARSAYILAN_MODEL_DIZINI = OKUMA_KOK / "modeller"

# Gelen belge yükleme sınırıyla aynı (Teks-Erp DOCUMENT_SCAN_MAX_BYTES = 5 MB).
MAX_GORUNTU_BAYT = 5 * 1024 * 1024
# JSON gövdesi base64 taşır: 4/3 büyür + mimeType/ayraç payı.
MAX_GOVDE_BAYT = (MAX_GORUNTU_BAYT * 4) // 3 + 4096
# Prototipte ölçülen ölçek: uzun kenar 2600 px (rect'ler küçültülmüş uzayda döner).
VARSAYILAN_MAX_KENAR = 2600
# Backend istemcisi 90 s bekler; servis daha önce vazgeçip 504 döner (iş yeniden dener).
VARSAYILAN_ZAMAN_ASIMI_S = 60.0

_SERVIS_ADI = re.compile(r"^[a-z][a-z0-9-]{0,62}$")


class BaglamaHatasi(ValueError):
    """İzin verilmeyen dinleme adresi."""


def _dongu_mu(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def dinleme_adresi_dogrula(host: str, ic_ad_izni: bool) -> str:
    """İzinli adresi döner; değilse BaglamaHatasi fırlatır."""
    h = (host or "").strip().strip("[]").lower()
    if not h:
        raise BaglamaHatasi("dinleme adresi boş")
    if _dongu_mu(h):
        return h
    try:
        ipaddress.ip_address(h)
        raise BaglamaHatasi(f"döngü dışı IP ile dinleme yasak: {h} (0.0.0.0 / :: dahil)")
    except ValueError as exc:
        if isinstance(exc, BaglamaHatasi):
            raise
    if not ic_ad_izni:
        raise BaglamaHatasi(f"servis adı ile dinleme yalnız OKUMA_IC_AD_IZNI=1 ile: {h}")
    if not _SERVIS_ADI.match(h):
        raise BaglamaHatasi(f"geçersiz iç servis adı (noktasız küçük harf ad beklenir): {h}")
    return h


def baglanti_adresi_izinli(adres: str, ic_ad_izni: bool) -> bool:
    """Gelen bağlantının YEREL soket adresi (ASGI scope["server"]) izinli mi — uvicorn'u elle 0.0.0.0'da açana karşı ikinci sed.

    Döngü her zaman; iç ad izni varsa compose ağı özel adresi (RFC1918/ULA) da kabul edilir.
    """
    try:
        ip = ipaddress.ip_address(adres)
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    return ic_ad_izni and ip.is_private and not ip.is_unspecified


def _sayi(ad: str, varsayilan: float) -> float:
    ham = os.environ.get(ad, "").strip()
    if not ham:
        return varsayilan
    deger = float(ham)
    if deger <= 0:
        raise ValueError(f"{ad} pozitif olmalı")
    return deger


@dataclass(frozen=True)
class Ayarlar:
    host: str
    port: int
    ic_ad_izni: bool
    model_dizini: Path
    max_kenar: int
    zaman_asimi_s: float


def ayarlari_oku() -> Ayarlar:
    ic_ad_izni = os.environ.get("OKUMA_IC_AD_IZNI", "") == "1"
    host = dinleme_adresi_dogrula(os.environ.get("OKUMA_HOST", "127.0.0.1"), ic_ad_izni)
    return Ayarlar(
        host=host,
        port=int(_sayi("OKUMA_PORT", 8765)),
        ic_ad_izni=ic_ad_izni,
        model_dizini=Path(os.environ.get("OKUMA_MODEL_DIZINI", str(VARSAYILAN_MODEL_DIZINI))),
        max_kenar=int(_sayi("OKUMA_MAX_KENAR", VARSAYILAN_MAX_KENAR)),
        zaman_asimi_s=_sayi("OKUMA_ZAMAN_ASIMI_S", VARSAYILAN_ZAMAN_ASIMI_S),
    )
