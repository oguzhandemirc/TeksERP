"""KABUL (5) — log'a fotoğraf baytı, base64 ya da okunan metin YAZILMAZ (başarı ve hata yollarında).

Tüm logger'lar DEBUG'da yakalanır (rapidocr/uvicorn dahil) + süreç stdout/stderr'i.
"""
from __future__ import annotations

import base64
import logging

from conftest import SENTETIK, ocr_govdesi

GIZLI = ("987654", "4711-2026", "26209936", "IRSALIYE")


def test_logda_icerik_yok(sunucu, caplog, capfd):
    caplog.set_level(logging.DEBUG)
    veri = SENTETIK.read_bytes()
    durum, govde, _ = sunucu.istek("/ocr", ocr_govdesi(veri))
    assert durum == 200 and "987654" in govde["text"], "metin okunmadıysa test anlamsız"
    sunucu.istek("/ocr", ocr_govdesi(b"\xff\xd8\xff\xe0" + b"987654 GIZLI" * 30, "image/jpeg"))
    sunucu.istek("/ocr", b'{"imageBase64": "987654"')
    out, err = capfd.readouterr()
    tum = "\n".join(r.getMessage() for r in caplog.records) + out + err
    assert any("/ocr 200" in r.getMessage() for r in caplog.records), "servis log satırı hiç yakalanmadı (yakalama kurgusu bozuk)"
    for s in GIZLI:
        assert s not in tum, f"log içerik sızdırıyor: {s}"
    assert base64.b64encode(veri)[:40].decode() not in tum
