# Sentetik OCR fikstürleri (D3a, 2026-10-28)

Kaynak: ocr-test prototipi `assets/samples/ocr-fixtures/*.ocr.json` (üretici `tools/samples/generate.py`, sahte firma/ürün verisi; gerçek fotoğraf DEĞİL).
63 örneğin tamamı (3 şablon × 21 varyant: clean/noise/blur/rotate/lowcontrast/jpeg/dotmatrix…); prototipin `*.ocr-noisy.json` türevleri alınmadı. `ground-truth.json` beklenen alan değerleri.
`sablon/` altındaki üç şablon yalnız bu ölçüm içindir; üretim şablonları `../../../templates/`.
Bekçi: `scripts/test_gelen_belge_motor.ts` — alan doğruluğu ≥ %93 (TASARIM-KARARI §6 D3a).
