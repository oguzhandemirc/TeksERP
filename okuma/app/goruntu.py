"""Görüntü kapısı + ön işleme (prototip `ocr-test/server/app/main.py` prepare_image'in OpenCV karşılığı).

Sıra: boyut (5 MB) → sihirli bayt (yalnız JPEG/PNG) → çözme (EXIF yönelimi uygulanır) → uzun kenar > max_kenar ise küçült.
Hata mesajları içerik TAŞIMAZ (bayt/metin yok) — yalnız kod.
"""
from __future__ import annotations

import os

# Sıkıştırma bombası seddi: 4284×5712 telefon fotoğrafı ≈ 24,5 MP; tavan 64 MP. cv2 import'undan ÖNCE okunur.
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(64 * 1024 * 1024))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from .config import MAX_GORUNTU_BAYT  # noqa: E402

JPEG_BASI = b"\xff\xd8\xff"
PNG_BASI = b"\x89PNG\r\n\x1a\n"


class GoruntuHatasi(Exception):
    def __init__(self, durum: int, kod: str, mesaj: str) -> None:
        super().__init__(kod)
        self.durum = durum
        self.kod = kod
        self.mesaj = mesaj


def tur_bul(veri: bytes) -> str:
    if veri.startswith(JPEG_BASI):
        return "image/jpeg"
    if veri.startswith(PNG_BASI):
        return "image/png"
    raise GoruntuHatasi(415, "UNSUPPORTED_IMAGE", "Yalnız JPEG ya da PNG kabul edilir.")


def coz(veri: bytes) -> np.ndarray:
    """Bayt → BGR dizi. 5 MB üstü 413, tür dışı 415, çözülemeyen 400."""
    if not veri:
        raise GoruntuHatasi(400, "EMPTY_IMAGE", "Görüntü boş.")
    if len(veri) > MAX_GORUNTU_BAYT:
        raise GoruntuHatasi(413, "IMAGE_TOO_LARGE", "Görüntü 5 MB sınırını aşıyor.")
    tur_bul(veri)
    try:
        # IMREAD_COLOR EXIF yönelimini uygular (IMREAD_IGNORE_ORIENTATION verilmedikçe).
        img = cv2.imdecode(np.frombuffer(veri, dtype=np.uint8), cv2.IMREAD_COLOR)
    except cv2.error:
        img = None
    if img is None or img.size == 0 or img.ndim != 3:
        raise GoruntuHatasi(400, "IMAGE_DECODE_FAILED", "Görüntü çözülemedi (bozuk dosya).")
    return img


def hazirla(img: np.ndarray, max_kenar: int) -> np.ndarray:
    """Uzun kenar > max_kenar ise orantılı küçült (LANCZOS, prototiple aynı); dönen rect'ler bu uzaydadır."""
    h, w = img.shape[:2]
    uzun = max(w, h)
    if uzun <= max_kenar:
        return img
    s = max_kenar / uzun
    return cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_LANCZOS4)
