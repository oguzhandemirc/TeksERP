"""OcrResult + DonusumSonucu sözleşmesi — Teks-Erp/src/lib/gelen-belge/okuma-istemcisi.ts `OcrResultSchema` (Zod) ile BİREBİR.

Zod'da `corners` yalnız `.optional()` (null KABUL ETMEZ) → yanıt `exclude_none` ile yazılır.
Alan adı değişikliği iki uçta birden yapılır; `tests/test_sozlesme.py` iki şemayı karşılaştırır.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class OcrPoint(BaseModel):
    x: float
    y: float


class OcrRect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class OcrElement(BaseModel):
    text: str
    rect: OcrRect
    corners: Optional[list[OcrPoint]] = None
    confidence: Optional[float] = None
    angle: Optional[float] = None


class OcrLine(BaseModel):
    text: str
    rect: OcrRect
    corners: Optional[list[OcrPoint]] = None
    confidence: Optional[float] = None
    angle: Optional[float] = None
    elements: list[OcrElement] = Field(default_factory=list)


class OcrBlock(BaseModel):
    text: str
    rect: OcrRect
    corners: Optional[list[OcrPoint]] = None
    lines: list[OcrLine]


class OcrResult(BaseModel):
    text: str
    blocks: list[OcrBlock]
    imageWidth: int = Field(gt=0)
    imageHeight: int = Field(gt=0)
    durationMs: Optional[float] = None
    engine: Optional[str] = None
    # Sayfayı dikleştirmek için girdiye uygulanan saat yönü dönüş (0/90/270); rect/corners/imageWidth bu DİK çerçevededir.
    rotation: Optional[int] = None


class OcrIstegi(BaseModel):
    """`POST /ocr` gövdesi — istemci `{imageBase64, mimeType}` yollar."""

    imageBase64: str
    mimeType: Optional[str] = None


class DonusumIstegi(BaseModel):
    """`POST /donustur` gövdesi — istemci HEIC baytını `{imageBase64}` ile yollar."""

    imageBase64: str


class DonusumSonucu(BaseModel):
    """`POST /donustur` yanıtı — okuma-istemcisi.ts `ConvertResultSchema` (Zod) ile BİREBİR."""

    imageBase64: str
    mimeType: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class Saglik(BaseModel):
    status: str
    engine: str
    version: str
