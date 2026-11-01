"""KABUL (6) — HEIC/HEIF → JPEG (`POST /donustur`, pi-heif): JPEG baytı + boy, yön uygulanır, uzun kenar tavanı,
yalnız HEIF markası (JPEG/AVIF 415), bozuk 400, 5 MB+ 413, Zod ↔ pydantic birebir, log'da içerik yok.

Fikstürler macOS `sips -s format heic -s formatOptions 50 x.jpg --out x.heic` ile üretildi (240×120 sentetik görüntü;
sol 60 px kırmızı şerit). `belge-yan.heic` EXIF yönü 6 taşıyan JPEG'den üretildi → dik çıktı 120×240, şerit üstte.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re

from PIL import Image

from conftest import OKUMA, REPO, Sunucu, ayarlar

from app.config import MAX_GORUNTU_BAYT
from app.contract import DonusumSonucu
from app.main import uygulama_kur

DUZ = OKUMA / "tests" / "fikstur" / "belge-duz.heic"
YAN = OKUMA / "tests" / "fikstur" / "belge-yan.heic"
ISTEMCI = REPO / "Teks-Erp" / "src" / "lib" / "gelen-belge" / "okuma-istemcisi.ts"


def govde(veri: bytes) -> bytes:
    return json.dumps({"imageBase64": base64.b64encode(veri).decode("ascii")}).encode()


def jpeg_ac(g: dict) -> Image.Image:
    ham = base64.b64decode(g["imageBase64"])
    assert ham[:3] == b"\xff\xd8\xff", "çıktı JPEG değil"
    return Image.open(io.BytesIO(ham))


def kirmizi(p) -> bool:
    return p[0] > 150 and p[1] < 80 and p[2] < 80


def test_heic_jpeg_doner(sunucu):
    durum, g, baslik = sunucu.istek("/donustur", govde(DUZ.read_bytes()))
    assert durum == 200, g
    assert (g["mimeType"], g["width"], g["height"]) == ("image/jpeg", 240, 120)
    im = jpeg_ac(g)
    assert im.format == "JPEG" and im.size == (240, 120)
    assert kirmizi(im.getpixel((10, 60))) and not kirmizi(im.getpixel((200, 60)))
    assert baslik.get("x-okuma-version")


def test_belirlenimli(sunucu):
    """Aynı HEIC iki kez → bayt-aynı JPEG (backend sha256 tekilliği buna dayanır)."""
    a = sunucu.istek("/donustur", govde(DUZ.read_bytes()))[1]["imageBase64"]
    b = sunucu.istek("/donustur", govde(DUZ.read_bytes()))[1]["imageBase64"]
    assert a == b


def test_yon_uygulanir(sunucu):
    durum, g, _ = sunucu.istek("/donustur", govde(YAN.read_bytes()))
    assert durum == 200, g
    im = jpeg_ac(g)
    assert im.size == (120, 240), "yan fotoğraf dikleşmedi"
    assert kirmizi(im.getpixel((60, 10))) and not kirmizi(im.getpixel((60, 230))), "şerit üstte olmalı (saat yönü 90°)"
    assert im.getexif().get(0x0112) in (None, 1), "çıktıda yön etiketi kalmamalı (çift dönüş riski)"


def test_uzun_kenar_tavani():
    with Sunucu(uygulama_kur(ayarlar(max_kenar=100))) as s:
        durum, g, _ = s.istek("/donustur", govde(DUZ.read_bytes()))
    assert durum == 200 and (g["width"], g["height"]) == (100, 50)


def test_jpeg_ve_avif_415(sunucu):
    jpeg = b"\xff\xd8\xff\xe0" + b"\0" * 64
    avif = b"\x00\x00\x00\x1cftypavif" + b"\0" * 64
    for veri in (jpeg, avif):
        durum, g, _ = sunucu.istek("/donustur", govde(veri))
        assert (durum, g["code"]) == (415, "UNSUPPORTED_IMAGE")


def test_bozuk_heic_400(sunucu):
    veri = DUZ.read_bytes()[:40] + b"\0" * 200
    durum, g, _ = sunucu.istek("/donustur", govde(veri))
    assert (durum, g["code"]) == (400, "IMAGE_DECODE_FAILED")


def test_bos_ve_bozuk_govde(sunucu):
    assert sunucu.istek("/donustur", govde(b""))[1]["code"] == "EMPTY_IMAGE"
    assert sunucu.istek("/donustur", b'{"imageBase64": "%%%"}')[1]["code"] == "INVALID_BASE64"
    assert sunucu.istek("/donustur", b'{"x": 1}')[1]["code"] == "INVALID_BODY"


def test_5mb_arti_bir_413(sunucu):
    veri = DUZ.read_bytes() + b"\0" * (MAX_GORUNTU_BAYT + 1 - DUZ.stat().st_size)
    durum, g, _ = sunucu.istek("/donustur", govde(veri))
    assert (durum, g["code"]) == (413, "IMAGE_TOO_LARGE")


def test_zod_alanlari_pydantic_ile_birebir():
    m = re.search(r"const ConvertResultSchema = z\.object\(\{(.*?)\}\)", ISTEMCI.read_text("utf-8"), flags=re.S)
    assert m, "okuma-istemcisi.ts ConvertResultSchema bulunamadı"
    zod = set(re.findall(r"(\w+):\s*z\.", m.group(1)))
    assert zod == set(DonusumSonucu.model_fields), f"Zod {sorted(zod)} ≠ pydantic {sorted(DonusumSonucu.model_fields)}"


def test_logda_icerik_yok(sunucu, caplog, capfd):
    caplog.set_level(logging.DEBUG)
    veri = DUZ.read_bytes()
    durum, g, _ = sunucu.istek("/donustur", govde(veri))
    assert durum == 200
    sunucu.istek("/donustur", govde(veri[:40] + b"GIZLI-987654" * 20))
    out, err = capfd.readouterr()
    tum = "\n".join(r.getMessage() for r in caplog.records) + out + err
    assert any("/donustur 200" in r.getMessage() for r in caplog.records), "log satırı yakalanmadı"
    assert "987654" not in tum
    assert base64.b64encode(veri)[16:56].decode() not in tum
    assert g["imageBase64"][16:56] not in tum
