# Gerçek fotoğraf fikstürleri — ANONİM (D3a, 2026-10-28)

Dört gerçek belge fotoğrafının (IMG_0243..0246, 2600 px, PaddleOCR mobile) OcrResult çıktısı. Repo PUBLIC olduğundan
anonimleştirme kapsamı: firma/kişi adları, adres, telefon, fiyat/tutar ("ÖRNEK TEKSTİL A/B/C", "MA", "ÖRN", 11/1111…) VE
karşı tarafın belge kimlikleri — top no (8 hane, 2620xxxx → 9920xxxx), iş emri (26K-… → 99K-…, ISM1… → ISM9…), ham parti
(P261… → P991…), fiş/sipariş/sevk/evrak/sıra numaraları (ilk hane → 9), ürün tanımı ("9999-99 ÖRNEK KUMAŞ"), logo kalıntısı.
Eşleme deterministik, uzunluk/biçim korunur; kg/m/adet değerleri ve kutu geometrisi, açı, güven DOKUNULMAMIŞTIR (Σ sağlaması
gerçek). Fotoğraf ve ham çıktı repoda YOKTUR (`TASARIM-KARARI` §8 fikstür hijyeni).

| Dosya | Belge | Kabul (D3a) |
|---|---|---|
| `0245-ceki-listesi-a.json` | kumaş çeki listesi, 2 blok | 21/21 satır; beyan 5/141,70/586,00 ve 16/819,20/3.935,00 = Σ |
| `0246-iki-belge.json` | tek fotoğrafta çıkış çeki listesi + ürün sevk fişi | 2 bölge, her birinde başlık alanları |
| `0244-kumas-irsaliyesi.json` | el yazısı ızgara (5 sütun) | ≥15 hücre rect + TOTAL_UNVERIFIED |
| `0243-kesim-takip-formu.json` | el yazısı ızgara (3 sütun) | başlık 3 alan: tarih, evrak no, giriş mt |
