# okuma/ — Yerel okuma servisi (gelen belge OCR)

Python 3.12 + FastAPI + RapidOCR (onnxruntime, PaddleOCR PP-OCRv5 ONNX: det mobile + latin rec mobile). Backend'in
okuma işi (`Teks-Erp/src/lib/gelen-belge/okuma-istemcisi.ts`) fotoğrafı `POST /ocr {imageBase64, mimeType}` ile yollar,
`OcrResult` alır; servis ERP verisine dokunmaz, deftere yazmaz. Karar: `TASARIM-KARARI-2026-10-28` §2–§3, dilim D6.

## Çalıştırma (geliştirici)
- `okuma/betikler/calistir.sh` → `.venv` (hash'li kurulum) + `betikler/modelleri-getir.py` + `python -m app` (http://127.0.0.1:8765).
- Backend: `Teks-Erp/.env` → `GELEN_BELGE_OKUMA_URL=http://127.0.0.1:8765`.
- Ayarlar (yalnız `app/config.py` okur): `OKUMA_HOST` (vars. 127.0.0.1) · `OKUMA_PORT` (8765) · `OKUMA_IC_AD_IZNI=1` (compose iç adı) ·
  `OKUMA_MODEL_DIZINI` · `OKUMA_MAX_KENAR` (2600) · `OKUMA_ZAMAN_ASIMI_S` (60).

## Test
`cd okuma && .venv/bin/pip install --require-hashes -r requirements-dev.txt && python betikler/modelleri-getir.py && .venv/bin/python -m pytest -q`
— sözleşme (Zod ↔ pydantic ↔ gerçek yanıt), bağlama, 413/400/415/503/504, ağsız açılış, log'da içerik yok. CI: `.github/workflows/okuma.yml` (yalnız okuma/ değişince).
Teks-Erp tarafı gerçek servise karşı: `OKUMA_GERCEK_URL=http://127.0.0.1:8765 npx tsx scripts/test_gelen_belge_okuma.ts` (§9).

## Sınırlar (değişmez)
- Yalnız döngü adresi dinler; compose iç servis adı yalnız açık izinle; 0.0.0.0 / :: / LAN IP REDDEDİLİR (`config.py` + middleware ikinci seddi).
- Çalışma anında model İNDİRİLMEZ: modeller `modeller/manifest.json` (SHA-256) ile kurulumda gelir; `indirme_kapisi.py` RapidOCR'ın indirme yolunu kapatır.
- Log'a fotoğraf baytı, base64, okunan metin, hata mesajı içeriği YAZILMAZ — yalnız boyut/süre/sayı/kod.
- 5 MB görüntü tavanı (backend `DOCUMENT_SCAN_MAX_BYTES` ile aynı); yalnız JPEG/PNG sihirli baytı.
- Yeni Python paketi = kullanıcı onayı; sürüm değişimi `betikler/requirements.in` + `betikler/hash-uret.py` ile (hash'siz satır yok).
- Paketleme (Windows hizmeti, compose, korumalı paket) bu dizinde YOK — ayrı dilim.
