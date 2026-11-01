"""HEIC/HEIF → JPEG dönüşümü (`POST /donustur`) — iPhone fotoğrafı sistemde JPEG olarak saklansın diye.

pi-heif (libheif + libde265, YALNIZ çözücü; kodlayıcı/x265 yok) Pillow'a "HEIF" biçimi olarak kaydolur; açılış
yalnız bu biçimle sınırlıdır (başka tür bu uçtan geçmez). Yön: libheif irot/imir'i uygular ve EXIF yönünü 1'e çeker;
kalan EXIF yönü `exif_transpose` ile uygulanır. Çıktı EXIF'siz, uzun kenar ≤ max_kenar (OCR ölçeği), JPEG q85.
Hata mesajları içerik TAŞIMAZ — yalnız kod.
"""
from __future__ import annotations

import io
import warnings

import pi_heif
from PIL import Image, ImageOps

from .config import MAX_GORUNTU_BAYT
from .goruntu import GoruntuHatasi

pi_heif.register_heif_opener()

JPEG_KALITE = 85
# Sıkıştırma bombası seddi — `goruntu.py` OPENCV_IO_MAX_IMAGE_PIXELS ile aynı tavan (64 MP).
MAX_PIKSEL = 64 * 1024 * 1024
# ISO-BMFF `ftyp` ana markası: HEIC/HEIF görüntü ve dizi markaları (AVIF bilerek YOK — çözücüsü kurulu değil).
HEIF_MARKALARI = frozenset({b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs", b"mif1", b"msf1"})


def heif_mi(veri: bytes) -> bool:
    return len(veri) >= 12 and veri[4:8] == b"ftyp" and veri[8:12] in HEIF_MARKALARI


def heic_jpeg(veri: bytes, max_kenar: int) -> tuple[bytes, int, int]:
    """HEIC baytı → (JPEG baytı, genişlik, yükseklik). Boş 400 · 5 MB üstü 413 · HEIF değil 415 · çözülemeyen 400."""
    if not veri:
        raise GoruntuHatasi(400, "EMPTY_IMAGE", "Görüntü boş.")
    if len(veri) > MAX_GORUNTU_BAYT:
        raise GoruntuHatasi(413, "IMAGE_TOO_LARGE", "Görüntü 5 MB sınırını aşıyor.")
    if not heif_mi(veri):
        raise GoruntuHatasi(415, "UNSUPPORTED_IMAGE", "Yalnız HEIC/HEIF dönüştürülür.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(veri), formats=["HEIF"])
            if img.width * img.height > MAX_PIKSEL:
                raise GoruntuHatasi(413, "IMAGE_TOO_LARGE", "Görüntü piksel sınırını aşıyor.")
            img = ImageOps.exif_transpose(img).convert("RGB")
    except GoruntuHatasi:
        raise
    except Exception as exc:  # noqa: BLE001 — libheif/Pillow hata metni içerik taşıyabilir; yalnız kod döner
        raise GoruntuHatasi(400, "IMAGE_DECODE_FAILED", "HEIC dosyası çözülemedi (bozuk dosya).") from exc
    uzun = max(img.width, img.height)
    if uzun > max_kenar:
        s = max_kenar / uzun
        img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.Resampling.LANCZOS)
    cikti = io.BytesIO()
    img.save(cikti, format="JPEG", quality=JPEG_KALITE)
    return cikti.getvalue(), img.width, img.height
