"""RapidOCR (onnxruntime) sarmalayıcısı — prototip `ocr-test/server/app/engines/{base,rapid}.py` esas alındı.

Modeller manifestten (dosya + SHA-256) yüklenir; RapidOCR'a AÇIK `model_path` verilir ve indirme yolu kapatılır.
Tek sayfa kilidi: motor istek başına seri çalışır (CPU'ya bağlı; paralel istek kuyrukta bekler).
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import threading
import time
from pathlib import Path
from typing import Optional, Sequence

import numpy as np

from .contract import OcrBlock, OcrElement, OcrLine, OcrPoint, OcrRect, OcrResult
from .goruntu import cv2  # piksel tavanı ortamı cv2'den önce goruntu.py'de kurulur
from .indirme_kapisi import indirmeyi_kapat

log = logging.getLogger("okuma.motor")

MOTOR_ADI = "rapidocr-onnx"


class MotorYok(RuntimeError):
    """Model dosyası eksik/bozuk ya da motor yüklenemedi (kod içerir, içerik içermez)."""


def _sha256(yol: Path) -> str:
    h = hashlib.sha256()
    with yol.open("rb") as f:
        for parca in iter(lambda: f.read(1 << 20), b""):
            h.update(parca)
    return h.hexdigest()


def modelleri_dogrula(dizin: Path) -> dict[str, Path]:
    """Manifestteki her modeli dizinde bulur ve SHA-256'yı doğrular; eksik/uyumsuz → MotorYok."""
    manifest = json.loads((Path(__file__).resolve().parent.parent / "modeller" / "manifest.json").read_text("utf-8"))
    yollar: dict[str, Path] = {}
    for rol, m in manifest["modeller"].items():
        yol = dizin / m["dosya"]
        if not yol.is_file():
            raise MotorYok(f"MODEL_MISSING:{rol}")
        if _sha256(yol) != m["sha256"]:
            raise MotorYok(f"MODEL_HASH_MISMATCH:{rol}")
        yollar[rol] = yol
    return yollar


class Motor:
    def __init__(self, model_dizini: Path) -> None:
        self.model_dizini = model_dizini
        self.kilit = threading.Lock()
        self._ocr = None
        self.hata: Optional[str] = None

    @property
    def hazir(self) -> bool:
        return self._ocr is not None

    def yukle(self) -> None:
        """Modelleri doğrular ve RapidOCR'ı kurar. Hata kodu `self.hata`ya yazılır (sağlık ucu 503)."""
        if self._ocr is not None:
            return
        try:
            yollar = modelleri_dogrula(self.model_dizini)
            indirmeyi_kapat()
            from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR

            params = {
                "Det.engine_type": EngineType.ONNXRUNTIME,
                "Det.lang_type": LangDet.CH,
                "Det.ocr_version": OCRVersion.PPOCRV5,
                "Det.model_type": ModelType.MOBILE,
                "Det.model_path": str(yollar["det"]),
                "Rec.engine_type": EngineType.ONNXRUNTIME,
                "Rec.lang_type": LangRec.LATIN,
                "Rec.ocr_version": OCRVersion.PPOCRV5,
                "Rec.model_type": ModelType.MOBILE,
                "Rec.model_path": str(yollar["rec"]),
                "Global.use_cls": False,
                "Global.return_word_box": True,
                # 2600 px'lik girdi küçültülmesin; rect'ler giriş uzayında kalsın (prototip)
                "Global.max_side_len": 4000,
                "Global.log_level": "warning",
            }
            ocr = RapidOCR(params=params)
            # Det/rec tembel yüklenir; ilk istekten ÖNCE yüklensin ki eksik model hemen görünsün.
            ocr(np.full((64, 256, 3), 255, dtype=np.uint8), use_cls=False)
            self._ocr = ocr
            self.hata = None
            log.info("motor hazır: %s", MOTOR_ADI)
        except MotorYok as exc:
            self.hata = str(exc)
            log.error("motor yüklenemedi: %s", self.hata)
        except Exception as exc:  # noqa: BLE001 — sınıf adı yeter, mesaj dosya yolu taşıyabilir
            self.hata = f"ENGINE_LOAD_FAILED:{type(exc).__name__}"
            log.error("motor yüklenemedi: %s", self.hata)

    def oku(self, img: np.ndarray) -> OcrResult:
        """BGR dizi → OcrResult. Çağıran `self.kilit`i tutar.

        Yan dönük sayfa: ilk geçişte satırların çoğu dikeyse 90° ve 270° döndürülmüş hâller de okunur, en yüksek
        puanlı (Σ güven × uzunluk) seçilir; dik sayfada ek geçiş yok. Koordinatlar seçilen DİK çerçevededir.
        """
        if self._ocr is None:
            raise MotorYok(self.hata or "ENGINE_NOT_READY")
        t0 = time.perf_counter()
        lines = self._satirlar(img)
        donus, secilen = 0, img
        if yan_donuk_mu(lines):
            puan = sayfa_puani(lines)
            for derece, kod in ((90, cv2.ROTATE_90_CLOCKWISE), (270, cv2.ROTATE_90_COUNTERCLOCKWISE)):
                aday_img = cv2.rotate(img, kod)
                aday = self._satirlar(aday_img)
                if sayfa_puani(aday) > puan:
                    puan, lines, donus, secilen = sayfa_puani(aday), aday, derece, aday_img
        sonuc = lines_to_result(lines)
        sonuc.imageWidth = int(secilen.shape[1])
        sonuc.imageHeight = int(secilen.shape[0])
        sonuc.rotation = donus
        sonuc.durationMs = round((time.perf_counter() - t0) * 1000, 1)
        sonuc.engine = MOTOR_ADI
        return sonuc

    def _satirlar(self, img: np.ndarray) -> list[OcrLine]:
        res = self._ocr(np.ascontiguousarray(img), use_cls=False, return_word_box=True)
        lines: list[OcrLine] = []
        boxes = getattr(res, "boxes", None)
        txts = getattr(res, "txts", None)
        if boxes is not None and txts:
            scores = getattr(res, "scores", None) or [None] * len(txts)
            words = getattr(res, "word_results", None) or ()
            for i, text in enumerate(txts):
                if not text or not str(text).strip():
                    continue
                poly = np.asarray(boxes[i]).tolist()
                line = line_from_poly(str(text), poly, None if scores[i] is None else float(scores[i]))
                if i < len(words) and words[i]:
                    elems = _elements_from_word_results(words[i], str(text))
                    if elems:
                        line.elements = elems
                lines.append(line)
        return lines


def yan_donuk_mu(lines: list[OcrLine]) -> bool:
    """En az 3 karakterli satırların yarıdan fazlası dikey (yükseklik ≥ 1,5 × genişlik) ise sayfa yan yatmıştır.
    Hiç okunur satır yoksa da denenir: dedektör yan yatmış iri yazıyı hiç bulamayabilir (boş sayfanın bedeli 2 geçiş)."""
    uzun = [ln for ln in lines if len(ln.text.strip()) >= 3]
    if not uzun:
        return True
    dikey = sum(1 for ln in uzun if ln.rect.height >= 1.5 * ln.rect.width)
    return dikey * 2 > len(uzun)


def sayfa_puani(lines: list[OcrLine]) -> float:
    return sum((ln.confidence or 0.0) * len(ln.text.strip()) for ln in lines)


# ── Geometri (prototip base.py) ──────────────────────────────────────────────
Poly = Sequence[Sequence[float]]


def poly_to_rect(poly: Poly) -> OcrRect:
    xs = [float(p[0]) for p in poly]
    ys = [float(p[1]) for p in poly]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    return OcrRect(x=round(x0, 1), y=round(y0, 1), width=round(x1 - x0, 1), height=round(y1 - y0, 1))


def poly_to_corners(poly: Poly) -> list[OcrPoint]:
    return [OcrPoint(x=round(float(p[0]), 1), y=round(float(p[1]), 1)) for p in poly]


def poly_angle_deg(poly: Poly) -> float:
    """Üst kenarın yatayla açısı (derece, görüntü koordinatında saat yönü pozitif)."""
    if len(poly) < 2:
        return 0.0
    (x0, y0), (x1, y1) = poly[0][:2], poly[1][:2]
    dx, dy = float(x1) - float(x0), float(y1) - float(y0)
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return 0.0
    ang = math.degrees(math.atan2(dy, dx))
    if ang > 90:
        ang -= 180
    elif ang < -90:
        ang += 180
    return round(ang, 2)


def split_words_proportional(text: str, rect: OcrRect, confidence: Optional[float]) -> list[OcrElement]:
    """Kelime kutusu yoksa satır kutusunu kelime uzunluklarına orantılı dağıt (boşluk bir karakter pay alır)."""
    words = text.split()
    if not words:
        return []
    unit = rect.width / (sum(len(w) for w in words) + len(words) - 1)
    out: list[OcrElement] = []
    cursor = rect.x
    for w in words:
        ww = unit * len(w)
        out.append(OcrElement(text=w, rect=OcrRect(x=round(cursor, 1), y=rect.y, width=round(ww, 1), height=rect.height), confidence=confidence))
        cursor += ww + unit
    return out


def line_from_poly(text: str, poly: Poly, confidence: Optional[float]) -> OcrLine:
    rect = poly_to_rect(poly)
    conf = None if confidence is None else round(float(confidence), 4)
    return OcrLine(text=text, rect=rect, corners=poly_to_corners(poly), confidence=conf, angle=poly_angle_deg(poly),
                   elements=split_words_proportional(text, rect, conf))


def _elements_from_word_results(word_line, line_text: str) -> Optional[list[OcrElement]]:
    """RapidOCR word_results ((metin, güven, poligon), ...) satır metniyle tutarlıysa kelime kutusu olur."""
    try:
        items = [(str(t), float(s), np.asarray(b).tolist()) for (t, s, b) in word_line if b is not None]
    except Exception:  # noqa: BLE001
        return None
    if not items or "".join(t for t, _, _ in items).replace(" ", "") != line_text.replace(" ", ""):
        return None
    out = [OcrElement(text=t.strip(), rect=poly_to_rect(p), corners=poly_to_corners(p), confidence=round(s, 4))
           for t, s, p in items if t.strip()]
    return out or None


def sort_reading_order(lines: list[OcrLine], y_tolerance_ratio: float = 0.5) -> list[OcrLine]:
    """y-sonra-x: dikey merkezleri satır yüksekliğinin yarısı içinde olanlar aynı sıra."""
    items = sorted(lines, key=lambda ln: (ln.rect.y + ln.rect.height / 2, ln.rect.x))
    rows: list[list[OcrLine]] = []
    for ln in items:
        cy = ln.rect.y + ln.rect.height / 2
        if rows:
            ref = rows[-1][0]
            if abs(cy - (ref.rect.y + ref.rect.height / 2)) <= max(ref.rect.height, ln.rect.height) * y_tolerance_ratio:
                rows[-1].append(ln)
                continue
        rows.append([ln])
    out: list[OcrLine] = []
    for row in rows:
        out.extend(sorted(row, key=lambda ln: ln.rect.x))
    return out


def lines_to_result(lines: list[OcrLine]) -> OcrResult:
    """Her satır kendi bloğu (prototip); text = okuma sırasında satırlar '\\n' ile."""
    ordered = sort_reading_order(lines)
    blocks = [OcrBlock(text=ln.text, rect=ln.rect, corners=ln.corners, lines=[ln]) for ln in ordered]
    return OcrResult(text="\n".join(ln.text for ln in ordered), blocks=blocks, imageWidth=1, imageHeight=1, engine=MOTOR_ADI)
