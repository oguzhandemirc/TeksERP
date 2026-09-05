# Fabrika yedeği üzerinde ölçüm — 2026-09-06

Kaynak: `tekserp_yeni_20260905_030000.dump` (fabrika, 2026-09-05 03:00 UTC, 4,3 MB custom).
Yerel kopyalar: `tekserp_yeni_dev` (paket koştu) · `tekserp_saf_dev` (bozulmamış, salt ölçüm).
⚠️ Fabrika verisi yerelde kaldı; bu belgeye müşteri/kişi verisi YAZILMADI.

---

## 0 · Önce bir düzeltme: yedek `idx_scan` taşımaz

Tarama sayaçları (`pg_stat_user_indexes`) **çalışma zamanı istatistiğidir, dump'a girmez.**
Restore sonrası sıfırdan başlar (ölçüldü: restore biter bitmez 30 index / toplam 17 tarama —
hepsi kendi sorgularım). Yani "fabrikada hangi index kullanılıyor" sorusu yedekle
**doğrudan** cevaplanamaz. Yedeğin verdiği şey **gerçek veri hacmi**: 4.556 top (dev'in 5 katı),
382 sipariş, 18.101 sistem log satırı, 10 kullanıcı.

---

## 1 · Şema provası — reponun zorunlu ritüeli, ilk kez sonuna kadar koştu

Kural: *"şema provası en eski canlı dump'ta (restore → `migrate deploy` → bekçiler → profil boot)."*

| Adım | Sonuç |
|---|---|
| restore | hatasız (`pg_restore` rc=0, 0 error) |
| `migrate deploy` | **6 bekleyen migration, 1 saniyenin altında** — üç index migration'ı dahil |
| `seed:fixtures` | ❌ **DÜŞTÜ** → düzeltildi (§2) |
| bekçiler | **445/458** (326 sn) |

**`[DB-29b]` KAPANDI.** Açık soru "index migration'ı kurulum penceresini kaç saniye uzatır"dı.
Cevap: gerçek fabrika verisinde **ölçülebilir bir uzama yok** (<1 sn). Zaten migration'lar
uygulama DURMUŞKEN koşuyor (`kur.ps1` [4/9] pm2 stop → [7/9] migrate deploy).

## 2 · Provayı kıran hata: fixture adı fabrikanın gerçek müşterisiyle çarpıyordu

`seed:fixtures` fabrika verisinde `UniqueConstraintViolation (nameFold)` ile düştü.

- Fixture müşterisi: `MUS-002` / **"Moda Tekstil"** (adı DAMGASIZ)
- Fabrikanın gerçek müşterisi: `MUS1707260010` / **"MODA TEKSTİL"** (2026-07-17)
- `nameFold` seddi ikisini aynı ad sayıyor ve haklı olarak reddediyor.

Çakışma **öngörülebilirdi**: `src/services/helpers/name-normalize.helper.ts:73` zaten
*"ölçüldü: canlı veride 'Moda Tekstil' + 'MODA TEKSTİL'"* diye bir ölçüm taşıyor.

Bu, `[TD-16]`'nın ("fixture damgası ADI da kapsar") **seed'in kendisinde** ihlaliydi.
Düzeltme: fixture müşteri adları damgalandı (`FIXTURE Arda Tekstil` / `FIXTURE Moda Tekstil`).
Güvenli, çünkü 12 bekçi bu müşterileri **KODLA** çözüyor; adı hiçbir kod aramıyor
(yalnız 8 yorum satırında geçiyor). Doğrulandı: `test_similar_names` · `test_import_framework` ·
`test_master_data_name_dup` · 7 müşteri bekçisi — hepsi yeşil.

⚠️ Daha genel ders: damgasız her fixture adı, fabrikanın **yarın açacağı** bir kayıtla çarpabilir.

## 3 · En değerli bulgu: canlı defterde büyüyen boşluk

`test_consistency` **bozulmamış** fabrika kopyasında (hiç test artığı yok — ölçüldü: 0) 4 bölümde düştü.
Bu bekçinin kendi başlığı zaten *"bu dosyanın asıl değeri CANLI DB'ye karşı koşulmasıdır"* diyor.

| Bölüm | Bulgu | Durum |
|---|---|---|
| **§1d** | **42 sevkiyat · 11.384,7 m** çıkmış ama sipariş defterine yazılmamış (17 Ağu – 4 Eyl) | ⚠️ **BÜYÜYOR** — 2026-08-31 ölçümü 23 sevkiyat / 7.200,6 m'ydi |
| **§1c** | 5 sevkiyat sipariş beyan ediyor ama hiç tahsis satırı yok | açık |
| **§20** | 1 iş emri `COMPLETED` yazılı ama hiç adımı yok (0 açık / 0 kapalı / 0 bekleyen) | açık |
| **§13** | 2 top `currentQty > initialQty` | **bilinen ve bilerek bırakılmış** (2026-08-08/11; kök neden koda kapandı) |

**§1d ne demek:** mal çıktı, irsaliye basıldı, muhasebenin brüt raporu görüyor — görünmeyen tek şey
**sipariş defteri**. Sipariş "Açık" kaldığı için planlamacı aynı metrajı yeniden üretime verebilir.
Tipik kök neden bekçinin kendi notunda yazılı: `specMatch` — kaleme 55-BEYAZ istenmiş, çuvala aynı
kumaşın EKRU'su okutulmuş → tahsis yazılmıyor.

⚠️ **Onarım toplu UPDATE ile YAPILMAZ** — hangi kaleme yazılacağı bir İŞ KARARIDIR. Bekçi görünür tutar.

## 4 · `rolls` index kararı: HİÇBİRİ DÜŞMÜYOR

458 bekçi fabrika verisi üzerinde koşturuldu, sonra `idx_scan` okundu; ardından sıfır/az taramalı
her index kendi hedef sorgusuyla `EXPLAIN (ANALYZE, BUFFERS)` ile sınandı.

| Aday | Bekçi taraması | Kendi deseniyle EXPLAIN | Hüküm |
|---|---|---|---|
| `rolls_status_currentQty_idx` (440 kB) | **0** | ✅ `Index Scan Backward` — `status` süz + `currentQty DESC` sırala | **KALSIN** |
| `rolls_depo_updatedAt_idx` (104 kB) | **0** | ✅ `Index Only Scan`, 3 buffer / 0,056 ms | **KALSIN** |
| `rolls_uretim_updatedAt_idx` (56 kB) | 2 | ✅ `Index Scan`, 0,084 ms | **KALSIN** |
| `rolls_status_itemId_colorId_width_idx` (736 kB) | 21 | ✅ `Bitmap Index Scan` | **KALSIN** |
| `rolls_status_createdAt_idx` (264 kB) | 37 | ✅ `Index Scan Backward` | **KALSIN** |

**Ders: "0 tarama" ölü demek değil.** `rolls_status_currentQty_idx` bekçi koşumunda hiç
kullanılmadı, ama panelin top listesinde **"Metre" sütunu sıralanabilir**
(`Electron/src/pages/Operations/Rolls/columns.tsx:222` → `SortableHeader field="currentQty"`,
backend `ROLL_SORTABLE_FIELDS` beyaz listesinde) ve planlayıcı o sorguda index'i **seçiyor**.
Bekçi paketi bir **kod yolu envanteridir, kullanım profili değildir** — UI sıralamasını hiç denemiyor.

**Yazma maliyeti gerçek ama çaresi index silmek değil:** fabrika verisinde 2.339 güncellemede
**HOT oranı %0,5** (dev'de %0,8'di). Sebep yapısal — `updatedAt` **dört** index'te var ve *her*
güncellemede değişiyor, dolayısıyla HOT hiçbir `fillfactor` ayarıyla mümkün değil. Bedeli ölçüldü
ve küçük: tablo 4,7 MB, index'ler 2,2 MB, en yavaş uç 293 ms. **Aksiyon gerekmiyor.**

⚠️ Kalan tek belirsizlik: bunlar *bizim* sorgu envanterimiz. Fabrikanın gerçek kullanım profili için
sunucuda tek bir salt-okunur sorgu gerekir:
`SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname='rolls' ORDER BY idx_scan;`

## 5 · Fabrika verisinde kırmızı veren 13 bekçi

`tekserp_yeni_dev` üzerinde 445/458. Üç koşumun (temiz DB · işçi DB · fabrika verisi) kırmızı
kümeleri **farklı** — ortak olan yalnız üçü: `test_auto_draft_shipment` · `test_goods_receipt_invoice` ·
`test_roll_po_line_trace`.

Fabrika verisine özgü kırmızıların sınıfı (teşhis edildi, düzeltilmedi):
- **`npm run seed` koşulmadı** → `test_work_session`, `test_work_session_stamping` seed makine
  kodlarını (`TAMBUR-M1`/`KK1-M1`/`SEVK_1`) sabitliyor; fabrikanın kendi makineleri farklı.
- **Katalog varsayımı** → `test_recipe` `'TUP'` kat değerini bekliyor; fabrikada yalnız `2-KAT`, `4-KAT` var.
- **Altyapı** → `test_offsite_sweep` kendi geçici dump dosyasını bulamıyor (veri değil).
- Kalanı (`test_consistency`, `test_quickstart_dispatch`, `test_recent_output_filters`,
  `test_roll_warehouse_stamp`, `test_sack_label`, `test_traveler_card_a5_batches`) ayrı teşhis ister.

**Fabrika verisinde test artığı: 0** (customers/items/rolls/users) — çöp tamamen dev DB'ye özgü.
