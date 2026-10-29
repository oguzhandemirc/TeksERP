"""RapidOCR'ın çalışma anı indirme yolunu KAPATIR — modeller yalnız yerel dosyadan (manifest + SHA-256).

RapidOCR eksik model/sözlük/yazı tipini `DownloadFile.run` ile internetten çeker (det/rec/vis_res hepsi aynı
sınıfı kullanır); sınıfın kendi `run`u değiştirilir, böylece her import yolu kapanır. Kapı açık kalırsa
`tests/test_agsiz.py` kırmızıdır.
"""
from __future__ import annotations


class ModelIndirmeYasak(RuntimeError):
    """Çalışma anında model indirme girişimi."""


def _yasak(cls, *_a, **_k):  # noqa: ANN001, ANN202 — RapidOCR classmethod imzası
    raise ModelIndirmeYasak("çalışma anında model indirme yasak; modeller okuma/modeller altından yüklenir")


def indirmeyi_kapat() -> None:
    from rapidocr.utils import download_file

    download_file.DownloadFile.run = classmethod(_yasak)


def kapali_mi() -> bool:
    from rapidocr.utils import download_file

    return getattr(download_file.DownloadFile.run, "__func__", None) is _yasak
