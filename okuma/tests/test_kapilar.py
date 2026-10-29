"""KABUL (3) — 5 MB+1 → 413 · bozuk görüntü → 400 · tür dışı → 415 · sağlık 200 · eksik model → 503."""
from __future__ import annotations

import json

from conftest import Sunucu, ayarlar, ocr_govdesi

from app.config import MAX_GORUNTU_BAYT
from app.main import uygulama_kur


def test_saglik_200(sunucu):
    durum, govde, _ = sunucu.istek("/health")
    assert durum == 200
    assert govde == {"status": "ok", "engine": "rapidocr-onnx", "version": govde["version"]}


def test_5mb_arti_bir_413(sunucu):
    veri = b"\xff\xd8\xff\xe0" + b"\0" * (MAX_GORUNTU_BAYT + 1 - 4)
    durum, govde, _ = sunucu.istek("/ocr", ocr_govdesi(veri, "image/jpeg"))
    assert (durum, govde["code"]) == (413, "IMAGE_TOO_LARGE")


def test_tam_5mb_gecer_boyut_kapisini(sunucu):
    veri = b"\xff\xd8\xff\xe0" + b"\0" * (MAX_GORUNTU_BAYT - 4)
    durum, govde, _ = sunucu.istek("/ocr", ocr_govdesi(veri, "image/jpeg"))
    assert (durum, govde["code"]) == (400, "IMAGE_DECODE_FAILED")


def test_govde_basligi_sinir_ustu_413(sunucu):
    """Content-Length sınır üstüyse gövde OKUNMADAN 413 (bellek seddi)."""
    import http.client

    c = http.client.HTTPConnection("127.0.0.1", sunucu.port, timeout=30)
    c.putrequest("POST", "/ocr")
    c.putheader("content-type", "application/json")
    c.putheader("content-length", str(8 * 1024 * 1024))
    c.endheaders()
    y = c.getresponse()
    assert (y.status, json.loads(y.read())["code"]) == (413, "IMAGE_TOO_LARGE")
    c.close()


def test_bozuk_jpeg_400(sunucu):
    durum, govde, _ = sunucu.istek("/ocr", ocr_govdesi(b"\xff\xd8\xff\xe0bozuk-veri" * 50, "image/jpeg"))
    assert (durum, govde["code"]) == (400, "IMAGE_DECODE_FAILED")


def test_bozuk_png_400(sunucu):
    durum, govde, _ = sunucu.istek("/ocr", ocr_govdesi(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64))
    assert (durum, govde["code"]) == (400, "IMAGE_DECODE_FAILED")


def test_tur_disi_415(sunucu):
    durum, govde, _ = sunucu.istek("/ocr", ocr_govdesi(b"GIF89a" + b"\x00" * 64, "image/gif"))
    assert (durum, govde["code"]) == (415, "UNSUPPORTED_IMAGE")


def test_gecersiz_govde_400(sunucu):
    assert sunucu.istek("/ocr", b"bu json degil")[1]["code"] == "INVALID_BODY"
    assert sunucu.istek("/ocr", json.dumps({"imageBase64": "%%%"}).encode())[1]["code"] == "INVALID_BASE64"
    assert sunucu.istek("/ocr", json.dumps({"x": 1}).encode())[0] == 400


def test_eksik_model_saglik_503(tmp_path):
    with Sunucu(uygulama_kur(ayarlar(model_dizini=tmp_path))) as s:
        durum, govde, _ = s.istek("/health")
        assert (durum, govde["status"], govde["code"]) == (503, "unavailable", "MODEL_MISSING:det")
        from conftest import SENTETIK

        durum, govde, _ = s.istek("/ocr", ocr_govdesi(SENTETIK.read_bytes()))
        assert (durum, govde["code"]) == (503, "ENGINE_UNAVAILABLE")


def test_bozuk_model_ozeti_503(tmp_path):
    (tmp_path / "ch_PP-OCRv5_det_mobile.onnx").write_bytes(b"sahte")
    with Sunucu(uygulama_kur(ayarlar(model_dizini=tmp_path))) as s:
        assert s.istek("/health")[1]["code"] == "MODEL_HASH_MISMATCH:det"


def test_zaman_asimi_504(monkeypatch):
    import time as _t

    from conftest import SENTETIK

    from app.motor import Motor

    app = uygulama_kur(ayarlar(zaman_asimi_s=0.5))
    mt: Motor = app.state.motor
    with Sunucu(app) as s:
        monkeypatch.setattr(mt, "oku", lambda img: _t.sleep(2))
        durum, govde, _ = s.istek("/ocr", ocr_govdesi(SENTETIK.read_bytes()))
        assert (durum, govde["code"]) == (504, "OCR_TIMEOUT")
