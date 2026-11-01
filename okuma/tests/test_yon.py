"""Sayfa yönü: yan dönük sayfa dikleştirilir (koordinatlar DİK çerçevede); dik sayfa TEK geçişte okunur."""
from __future__ import annotations

import cv2
import numpy as np
import pytest

from conftest import SENTETIK

from app.config import VARSAYILAN_MODEL_DIZINI
from app.motor import Motor


@pytest.fixture(scope="module")
def motor():
    m = Motor(VARSAYILAN_MODEL_DIZINI)
    m.yukle()
    assert m.hazir, m.hata
    gercek = m._ocr
    m.cagri = 0

    def sayan(*a, **k):
        m.cagri += 1
        return gercek(*a, **k)

    m._ocr = sayan
    return m


def _dik() -> np.ndarray:
    return cv2.imdecode(np.frombuffer(SENTETIK.read_bytes(), np.uint8), cv2.IMREAD_COLOR)


def test_dik_sayfa_tek_gecis(motor):
    motor.cagri = 0
    r = motor.oku(_dik())
    assert motor.cagri == 1
    assert r.rotation == 0
    assert "BELGE NO 4711-2026" in r.text


@pytest.mark.parametrize("k,beklenen", [(1, 90), (-1, 270)])
def test_yan_donuk_sayfa_diklesir(motor, k, beklenen):
    dik = _dik()
    yan = np.ascontiguousarray(np.rot90(dik, k))  # k=1: saat yönü TERSİNE 90° → düzeltme saat yönünde 90°
    r = motor.oku(yan)
    assert r.rotation == beklenen
    assert "BELGE NO 4711-2026" in r.text
    assert (r.imageWidth, r.imageHeight) == (dik.shape[1], dik.shape[0])
    satir = next(b.lines[0] for b in r.blocks if "4711" in b.text)
    assert satir.rect.width > satir.rect.height * 3  # yatay satır: dik çerçeve
    assert satir.rect.x + satir.rect.width <= r.imageWidth + 1 and satir.rect.y + satir.rect.height <= r.imageHeight + 1
