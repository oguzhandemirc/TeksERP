"""KABUL (K28) — saklanan belge fotoğrafını küçültme (`POST /kucult`, Pillow): uzun kenar tavanı, JPEG çıktı, PNG kabul,
yön uygulanır, belirlenimli, HEIF/bozuk/sınır dışı reddedilir, log'da içerik yok.
"""
from __future__ import annotations

import base64
import io
import json
import logging

from PIL import Image

from conftest import SENTETIK


def govde(veri: bytes, max_kenar: int = 1600, kalite: int = 70) -> bytes:
    return json.dumps({"imageBase64": base64.b64encode(veri).decode("ascii"), "maxKenar": max_kenar, "kalite": kalite}).encode()


def buyuk_jpeg(w: int = 3000, h: int = 2000, exif_yon: int | None = None) -> bytes:
    im = Image.new("RGB", (w, h), (255, 255, 255))
    for x in range(0, w, 40):
        for y in range(0, h, 40):
            im.putpixel((x, y), (x % 256, y % 256, 0))
    im.paste((200, 0, 0), (0, 0, w // 10, h))
    out = io.BytesIO()
    if exif_yon:
        exif = Image.Exif()
        exif[0x0112] = exif_yon
        im.save(out, format="JPEG", quality=95, exif=exif)
    else:
        im.save(out, format="JPEG", quality=95)
    return out.getvalue()


def ac(g: dict) -> Image.Image:
    ham = base64.b64decode(g["imageBase64"])
    assert ham[:3] == b"\xff\xd8\xff", "çıktı JPEG değil"
    return Image.open(io.BytesIO(ham))


def test_uzun_kenar_ve_boy(sunucu):
    veri = buyuk_jpeg()
    durum, g, baslik = sunucu.istek("/kucult", govde(veri))
    assert durum == 200, g
    assert (g["mimeType"], g["width"], g["height"]) == ("image/jpeg", 1600, 1067)
    assert len(base64.b64decode(g["imageBase64"])) < len(veri)
    assert ac(g).size == (1600, 1067)
    assert baslik.get("x-okuma-version")


def test_kucuk_goruntu_buyutulmez_png_kabul(sunucu):
    durum, g, _ = sunucu.istek("/kucult", govde(SENTETIK.read_bytes()))
    assert durum == 200, g
    with Image.open(SENTETIK) as im:
        assert (g["width"], g["height"]) == im.size if max(im.size) <= 1600 else max(g["width"], g["height"]) == 1600


def test_yon_uygulanir(sunucu):
    durum, g, _ = sunucu.istek("/kucult", govde(buyuk_jpeg(3000, 2000, exif_yon=6)))
    assert durum == 200, g
    assert (g["width"], g["height"]) == (1067, 1600), "yan fotoğraf dikleşmedi"
    assert ac(g).getexif().get(0x0112) in (None, 1)


def test_belirlenimli(sunucu):
    veri = buyuk_jpeg()
    a = sunucu.istek("/kucult", govde(veri))[1]["imageBase64"]
    b = sunucu.istek("/kucult", govde(veri))[1]["imageBase64"]
    assert a == b


def test_reddedilenler(sunucu):
    heif = b"\x00\x00\x00\x18ftypheic" + b"\0" * 64
    assert sunucu.istek("/kucult", govde(heif))[:2][0] == 415
    bozuk = b"\xff\xd8\xff\xe0" + b"\0" * 64
    durum, g, _ = sunucu.istek("/kucult", govde(bozuk))
    assert (durum, g["code"]) == (400, "IMAGE_DECODE_FAILED")
    assert sunucu.istek("/kucult", govde(b""))[1]["code"] == "EMPTY_IMAGE"
    assert sunucu.istek("/kucult", govde(buyuk_jpeg(), max_kenar=10))[1]["code"] == "INVALID_SHRINK_OPTIONS"
    assert sunucu.istek("/kucult", govde(buyuk_jpeg(), kalite=100))[1]["code"] == "INVALID_SHRINK_OPTIONS"
    assert sunucu.istek("/kucult", b'{"x": 1}')[1]["code"] == "INVALID_BODY"


def test_logda_icerik_yok(sunucu, caplog, capfd):
    caplog.set_level(logging.DEBUG)
    veri = buyuk_jpeg()
    durum, g, _ = sunucu.istek("/kucult", govde(veri))
    assert durum == 200
    out, err = capfd.readouterr()
    tum = "\n".join(r.getMessage() for r in caplog.records) + out + err
    assert any("/kucult 200" in r.getMessage() for r in caplog.records), "log satırı yakalanmadı"
    assert base64.b64encode(veri)[16:56].decode() not in tum
    assert g["imageBase64"][16:56] not in tum
