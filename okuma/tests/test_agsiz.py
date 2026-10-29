"""KABUL (4) — ağ engelliyken (socket yamalı, taze süreç) servis açılır ve okur; tek bir dış bağlantı GİRİŞİMİ bile yok.

NEGATİF SONDA: motor.py'de `model_path` kaldırılıp `indirmeyi_kapat()` devre dışı bırakılınca RapidOCR modeli
internetten çekmeye çalışır → `girisimler` dolar / sağlık 503 → bu test KIRMIZI.
"""
from __future__ import annotations

import json
import subprocess
import sys

import pytest
from conftest import OKUMA


def test_agsiz_acilir_ve_okur():
    p = subprocess.run([sys.executable, str(OKUMA / "tests" / "agsiz_kosucu.py"), str(OKUMA)], cwd=OKUMA,
                       capture_output=True, text=True, timeout=300)
    assert p.returncode == 0, p.stderr[-2000:]
    sonuc = json.loads(p.stdout.strip().splitlines()[-1])
    assert sonuc["girisimler"] == [], sonuc["girisimler"]
    assert sonuc["saglik"] == 200
    assert sonuc["ocr"] == 200
    assert "4711-2026" in sonuc["metin"]
    assert sonuc["indirme_kapali"] is True


def test_indirme_cagrisi_patlar():
    from app.indirme_kapisi import ModelIndirmeYasak, indirmeyi_kapat

    indirmeyi_kapat()
    from rapidocr.utils.download_file import DownloadFile, DownloadFileInput

    with pytest.raises(ModelIndirmeYasak):
        DownloadFile.run(DownloadFileInput(file_url="https://example.invalid/m.onnx", sha256=None, save_path="/nonexistent/m.onnx", logger=None))
