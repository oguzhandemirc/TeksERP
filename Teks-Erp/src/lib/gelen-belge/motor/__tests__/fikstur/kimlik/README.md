# Kimlik gücü fikstürleri — ANONİM (2026-11-10)

Demo kurulumunda okunan üç gerçek tablet taraması (ML Kit `OcrResult`), `../gercek/README.md` anonimlik kuralıyla:
firma/müşteri adı, adres, telefon, belge/iş emri/parti/top numaraları ve ürün tanımı değiştirildi; alan etiketleri,
kg/m değerleri, kutu geometrisi ve güven DOKUNULMADI. Bekçi: `scripts/test_gelen_belge_kimlik_gucu.ts`.

| Dosya | Belge | Kabul |
|---|---|---|
| `urun-sevk-fisi-genel-etiketli.json` | ürün sevk fişi; yalnız GENEL etiketleri (Sevk Tarih, Cinsi, Mamul En, Açıklama) çeki listesi şablonuyla ortak | çeki listesi şablonuna EŞLEŞMEZ (skor ≥ eşik ama güçlü yazı yok); "Ürün Sevk Fişi" başlıklı şablona eşleşir |
| `cikis-ceki-listesi.json` | çıkış çeki listesi | kendi şablonuna eşleşir (güçlü yazı: başlık) |
| `kumas-ceki-listesi.json` | kumaş çeki listesi, 2 bölüm | kendi şablonuna eşleşir |
