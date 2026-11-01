"""FastAPI uygulaması — `GET /health`, `POST /ocr` (gövde `{imageBase64, mimeType}` → OcrResult),
`POST /donustur` (gövde `{imageBase64}` HEIC/HEIF → DonusumSonucu, JPEG).

Sözleşme: Teks-Erp/src/lib/gelen-belge/okuma-istemcisi.ts (readerHealth / readerOcr). Hata gövdesi
`{"code", "message"}`; 4xx kalıcı, 5xx/504 istemcide "yeniden dene" sayılır.
LOG KURALI: fotoğraf baytı, base64, okunan metin ve hata mesajı içeriği log'a YAZILMAZ — yalnız boyut, süre, sayı, kod.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import __version__
from .config import MAX_GOVDE_BAYT, Ayarlar, ayarlari_oku, baglanti_adresi_izinli
from .contract import DonusumIstegi, DonusumSonucu, OcrIstegi, Saglik
from .donustur import heic_jpeg
from .goruntu import GoruntuHatasi, coz, hazirla
from .motor import MOTOR_ADI, Motor, MotorYok

log = logging.getLogger("okuma.sunucu")


def _hata(durum: int, kod: str, mesaj: str) -> JSONResponse:
    return JSONResponse({"code": kod, "message": mesaj}, status_code=durum)


async def _govde_oku(request: Request, model, mesaj: str) -> bytes | JSONResponse:
    """JSON gövdesini akışla (5 MB seddiyle) okur, `imageBase64`ü çözer; hata → hazır JSONResponse."""
    govde = bytearray()
    async for parca in request.stream():
        govde.extend(parca)
        if len(govde) > MAX_GOVDE_BAYT:
            return _hata(413, "IMAGE_TOO_LARGE", "Görüntü 5 MB sınırını aşıyor.")
    try:
        istek = model.model_validate(json.loads(govde))
    except (ValueError, TypeError):
        return _hata(400, "INVALID_BODY", mesaj)
    b64 = istek.imageBase64
    if b64.startswith("data:") and "," in b64:
        b64 = b64.split(",", 1)[1]
    try:
        return base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        return _hata(400, "INVALID_BASE64", "imageBase64 çözülemedi.")


def uygulama_kur(ayarlar: Ayarlar | None = None, motor: Motor | None = None) -> FastAPI:
    ay = ayarlar or ayarlari_oku()
    mt = motor or Motor(ay.model_dizini)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await run_in_threadpool(mt.yukle)
        yield

    app = FastAPI(title="TeksERP okuma servisi", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.ayarlar = ay
    app.state.motor = mt

    @app.middleware("http")
    async def kapilar(request: Request, call_next):
        # İkinci sed: elle `uvicorn --host 0.0.0.0` açılsa da döngü dışı yerel adrese gelen bağlantı reddedilir.
        yerel = (request.scope.get("server") or ("", 0))[0]
        if not baglanti_adresi_izinli(str(yerel), ay.ic_ad_izni):
            log.warning("reddedildi: izinsiz dinleme adresi")
            return _hata(403, "BIND_NOT_ALLOWED", "Servis yalnız döngü adresinde hizmet verir.")
        uzunluk = request.headers.get("content-length")
        if uzunluk is not None and (not uzunluk.isdigit() or int(uzunluk) > MAX_GOVDE_BAYT):
            return _hata(413, "IMAGE_TOO_LARGE", "Görüntü 5 MB sınırını aşıyor.")
        return await call_next(request)

    @app.get("/health")
    async def saglik() -> JSONResponse:
        if not mt.hazir:
            return JSONResponse({"status": "unavailable", "engine": MOTOR_ADI, "version": __version__, "code": mt.hata or "ENGINE_NOT_READY"}, status_code=503)
        return JSONResponse(Saglik(status="ok", engine=MOTOR_ADI, version=__version__).model_dump())

    @app.post("/ocr")
    async def ocr(request: Request) -> JSONResponse:
        t0 = time.perf_counter()
        veri = await _govde_oku(request, OcrIstegi, "Gövde {imageBase64, mimeType} JSON'u olmalı.")
        if isinstance(veri, JSONResponse):
            return veri
        try:
            img = hazirla(coz(veri), ay.max_kenar)
        except GoruntuHatasi as exc:
            log.info("/ocr %d %s boyut=%d", exc.durum, exc.kod, len(veri))
            return _hata(exc.durum, exc.kod, exc.mesaj)
        if not mt.hazir:
            return _hata(503, "ENGINE_UNAVAILABLE", "Okuma motoru hazır değil.")

        def _calis():
            # Tek sayfa kilidi; sıra beklerken zaman aşımı dolarsa iş hiç başlamaz.
            if not mt.kilit.acquire(timeout=ay.zaman_asimi_s):
                raise TimeoutError
            try:
                return mt.oku(img)
            finally:
                mt.kilit.release()

        try:
            sonuc = await asyncio.wait_for(run_in_threadpool(_calis), timeout=ay.zaman_asimi_s)
        except (TimeoutError, asyncio.TimeoutError):
            log.warning("/ocr 504 zaman aşımı %.0f s", ay.zaman_asimi_s)
            return _hata(504, "OCR_TIMEOUT", "Okuma zaman aşımına uğradı.")
        except MotorYok:
            return _hata(503, "ENGINE_UNAVAILABLE", "Okuma motoru hazır değil.")
        except Exception as exc:  # noqa: BLE001 — mesaj içerik taşıyabilir; yalnız sınıf adı
            log.error("/ocr 500 %s", type(exc).__name__)
            return _hata(500, "OCR_FAILED", "Okuma başarısız.")
        log.info("/ocr 200 boyut=%d %dx%d satir=%d motor_ms=%.0f toplam_ms=%.0f", len(veri), sonuc.imageWidth, sonuc.imageHeight,
                 len(sonuc.blocks), sonuc.durationMs or 0, (time.perf_counter() - t0) * 1000)
        return JSONResponse(sonuc.model_dump(exclude_none=True), headers={"x-okuma-version": __version__})

    @app.post("/donustur")
    async def donustur(request: Request) -> JSONResponse:
        # OCR motoruna ve tek sayfa kilidine girmez: motor hazır olmasa da dönüşüm çalışır.
        t0 = time.perf_counter()
        veri = await _govde_oku(request, DonusumIstegi, "Gövde {imageBase64} JSON'u olmalı.")
        if isinstance(veri, JSONResponse):
            return veri
        try:
            jpeg, w, h = await asyncio.wait_for(run_in_threadpool(heic_jpeg, veri, ay.max_kenar), timeout=ay.zaman_asimi_s)
        except GoruntuHatasi as exc:
            log.info("/donustur %d %s boyut=%d", exc.durum, exc.kod, len(veri))
            return _hata(exc.durum, exc.kod, exc.mesaj)
        except (TimeoutError, asyncio.TimeoutError):
            log.warning("/donustur 504 zaman aşımı %.0f s", ay.zaman_asimi_s)
            return _hata(504, "CONVERT_TIMEOUT", "Dönüşüm zaman aşımına uğradı.")
        except Exception as exc:  # noqa: BLE001 — mesaj içerik taşıyabilir; yalnız sınıf adı
            log.error("/donustur 500 %s", type(exc).__name__)
            return _hata(500, "CONVERT_FAILED", "Dönüşüm başarısız.")
        sonuc = DonusumSonucu(imageBase64=base64.b64encode(jpeg).decode("ascii"), mimeType="image/jpeg", width=w, height=h)
        log.info("/donustur 200 boyut=%d cikti=%d %dx%d toplam_ms=%.0f", len(veri), len(jpeg), w, h, (time.perf_counter() - t0) * 1000)
        return JSONResponse(sonuc.model_dump(), headers={"x-okuma-version": __version__})

    return app
