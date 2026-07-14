# TeksERP — Veritabanı Mimari Denetim Raporu

> **Tarih:** 2026-07-08 · **Kapsam:** `Teks-Erp/` backend — PostgreSQL 18 (dev) / 16 (üretim) + Prisma 7 + Express 5
> **Yöntem:** 8 boyutlu çok-ajanlı tarama + kuşkucu çapraz doğrulama + elle teyit
> **Genel sonuç:** Mimari olgun ve disiplinli. **Kritik bulgu yok.** 5 yüksek, 22 orta, 22 düşük, 11 bilgi düzeyinde bulgu. En acil iki başlık: **(1)** yedeklerin makine dışına çıkmaması (felaket kurtarma), **(2)** üretimin C locale'inde Türkçe aramanın sessizce eksik sonuç dönmesi.

---

## 0. Uygulama Durumu (2026-07-08 · `fix/db-installer-audit`)

Denetim sonrası düzeltmeler bir git branch'inde (**5 commit**) uygulandı; her migration önce `pg_dump` klonunda, sonra dev DB'de doğrulandı — **tracked-drift sıfır** (`prisma migrate diff` ile teyit), üstelik önceden var olan bir drift de (`subcontractor_dispatches.dyehouseNote`) temizlendi. App-code bulguları paralel bir **backend track'ine** devredildi; **ürün-kararı** bulguları beklemede.

| Faz / Commit | Düzeltilen bulgular | Durum |
|---|---|---|
| **Faz 1** `da48b0d` — installer | Y-4, O-15, O-16, O-17 | offsite yedek + bütünlük + bellek tuning + PG18 paritesi & major-guard |
| **Faz 4** `d90947f` — migration `…120000` | O-5, O-7, D-12, D-10, O-22 | 8 CHECK + partial-unique + unique + FK Restrict + composite FK; **dev'e uygulandı + resolve** |
| **Faz 5** `b43fdba` — migration `…130000` | O-13, O-14, D-5, D-6, D-7 | 9 index drop + 2 composite + partial; **dev'e uygulandı + resolve** |
| **Faz 6** `49ecb71` — migration `…140000` | O-9, O-10, O-11, D-9, D-14, D-16, B-11 | dyehouseNote/updatedAt/uuid + `consistency-check.sql` + doc; **dev'e uygulandı + resolve** |
| **Faz 7** `c550ac4` — migration `…150000` | ~~Y-1~~, O-19 | Shipment/Sack operatör izi (O-19) — **app-code'ta yazılıyor** (backend `ac81c04`). GoodsReceipt (Y-1) kuruldu ama **Faz 9'da iptal** (aşağı bak) |
| **Faz 9** `4925620` — migration `…170000` | **Y-1 İPTAL** | Domain doğrulaması: ham kumaş satın alınmıyor (fabrika-içi kayıtsız) → tedarikçi/lot kavramı yok. goods_receipts + Roll.goodsReceiptId/supplierLotNo DROP (veri=0, app-code ref=0). O-19 + CompanyType KORUNDU |
| **Faz 8** `6a26075` — migration `…160000` | **F103** (backend denetimi, çapraz-koordinasyon) | shipment_orders.isActive + partial unique `(orderId) WHERE isActive` → "bir sipariş tek aktif sevkiyatta" DB seddi; backend'in serileştirme kilidinin yerini alır (bakım app-code'da); dev'e uygulandı + resolve |
| **Backend track** (ayrı oturum) | Y-2, Y-3, O-1, O-2, O-3, O-4, O-6, O-18, O-21, O-23, D-13, D-15, B-1 + **Y-1/O-19 app-code** | app-code (`services`/`controllers`/`lib`) — devredildi (kod-durumu için §0.1) |
| **Ürün kararı** (ileriye) | O-20, D-3 | çuval dara/net + vardiya-maliyet (bugünün ihtiyacı değil) |
| **Bilgi — aksiyon yok** | B-2…B-10, D-2 vb. | bilinçli tasarım tespitleri (belge amaçlı) |

> **⚠️ Üretim deploy notu:** Faz 4/5/6 DDL'i (özellikle Faz 5 `roll_operations` yeni index'leri) dolu üretim tablosunda yazma kilidi alır → **vardiya dışı** `prisma migrate deploy` (CLAUDE.md kural 14; her migration başında `SET statement_timeout = 0` var). Dev DB'de 3 migration resolve'lu; üretimde `migrate deploy` uygular. **Koordinasyon:** dev DB'de bu 3 migration kayıtlı ama paralel backend branch'inde dosyaları yok — o oturum `prisma migrate deploy/status` çalıştırmamalı (merge'de uzlaşır).
>
> Not: Faz 4-9 migration'ları main'e girdi ve dizin adlarını aldı — `20260708120000_faz4_db_constraint_hardening`, `…130000_faz5_index_cleanup`, `…140000_faz6_schema_hygiene`, `…150000_faz7_goods_receipt_operator_trace`, `…160000_faz8_shipment_order_active_unique`, `…170000_faz9_drop_goods_receipt` (kanonik: `prisma/migrations/`).

### 0.1 Post-denetim kapanışları (2026-07-09…14 — koda karşı doğrulandı)

Bu raporun bulguları **2026-07-08 anına aittir.** Sonraki hafta gelen dört büyük redesign (çuval-depo `07-12`, "her rota final üretir" `07-13`, parti modeli `07-13`, "kart iş emriyle doğar" `07-14`) + idempotency turu `07-14` + Backend-track'in inmesi, **açık/devredilen bulguların çoğunu kapattı.** Aşağıdaki kapanışlar mevcut `schema.prisma`/servis koduna karşı teyit edildi (bölüm gövdeleri denetim-anı gözlemi olarak korunur — güncel durum burada):

| Bulgu | Durum | Kod kanıtı |
|---|---|---|
| **O-3** tx timeout yok | **KAPANDI** — global `transactionOptions { maxWait:5000, timeout:20000 }` | `src/lib/prisma.ts:48-51` (O3-1) |
| **O-4** parti/manifest no taşması | **KAPANDI** — `workOrderNumber` + `manifestNo` üreticileri `gte+startsWith` + `Number.isFinite` guard'a geçti | `workorder.service.ts:283-296, 4347-4354` |
| **O-7** `Sack.manualCode` unique invariantı | **GEÇERSİZ (moot)** — kolon tümüyle DROP edildi (mühür-yok çuval-depo modeli) | migration `20260712120000_drop_sack_manual_code`; şemada `manualCode` yok |
| **O-9** `WorkOrder.dyehouseNote` drift | **KAPANDI** — kolon kaldırıldı (fason talimatı tek kaynak) | `schema.prisma:1261` (yorum) |
| **O-13/O-14** roll_operations ölü/eksik index | **KAPANDI** (Faz 5) — `[rollId]`+`[operationType]` DROP, `[operationType,createdAt]` eklendi | `schema.prisma` RollOperation `@@index` |
| **O-19** sevkiyat/tartı operatör izi | **KAPANDI** — `Sack.weighedById/weighedAt` + `Shipment.dispatchedById` birinci-sınıf kolon | Sack/Shipment modelleri |
| **O-22** Roll↔Sack↔Shipment invariantı | **UYGULANDI** — `sacks @@unique([id, shipmentId])` + rolls/swatches composite FK (raw-SQL, DEFERRABLE) | Sack modeli `@@unique([id, shipmentId])` + O-22 yorumu |
| **O-23** pg Pool `error` + çift shutdown | **KAPANDI** — `pool.on("error")` eklendi (süreç düşmez), shutdown tek noktada | `src/lib/prisma.ts:38` (O3-2) |
| **B-1** `prisma.ts` yorumu `30s` diyor | **KAPANDI** — yorum `50s`'e düzeltildi | `src/lib/prisma.ts:26` |
| **D-1** TravelerCardScan idempotency | **KISMİ** — DB idempotency çapası (clientScanId) yerine 10 sn çift-okutma dedup penceresi eklendi (UX guard, önerilen P2002-idempotent değil) | `traveler-card.service.ts:337-344` |
| **D-14** 4 `text` UUID kolon | **KAPANDI** — `batchSplitId` parti redesign'ıyla tümüyle kalktı; `sourceId`/`prevSackId`/`prevQualityGradeId` `@db.Uuid`'a çevrildi | `schema.prisma:2294, 2512, 2514` |

**Backend-track (atomik claim + prefix üreticiler) da indi (kod-teyitli):** **O-2** WO oto-tamamlama artık `touchWorkOrderTx` çağırıyor (`kursun-qc.service.ts:670`, `tambur.service.ts:693`); **O-21** 8 numara/barkod üreticisi `gte+startsWith`'e geçti (`subcontractor:84,90`, `kartela:92,98,115`, `traveler-card`). O-1/O-6 (hardDelete / OrderLine silme atomik claim) aynı track'te; tam kapanış için servis diffine bakılabilir.

**Not — `PRODUCED` enum'u kaldırıldı:** "her rota final üretir" redesign'ında `RollStatus.PRODUCED` limbosu enum'dan düştü (migration `20260713092000_drop_produced_roll_status`). Aşağıda O-18'de "PRODUCED'a düşer" ifadesi artık geçersiz — son adım toplarını `finalizeRollsAtLastStep` → `WAREHOUSE` çeker; O-18'in **çekirdek endişesi (Tambur'suz rotada açık-hata guard'ı) hâlâ açık** (aşağıda güncellendi).

**Hâlâ açık (kod-teyitli):** Y-2/Y-3 (collation — 34 elle-arama sahası), Y-4 (offsite yedek + PITR yok), Y-5 (geçmiş DDL'de `statement_timeout=0` eksik), O-15/O-16/O-17 (installer bellek/sürüm/restore), O-18 (Tambur'suz açık-hata guard'ı), D-9 (`consistency-check.sql`) vb. — bunlar operasyonel/collation eksenli, redesign'lar dokunmadı.

---

## 1. Yönetici Özeti

Bu, "veritabanını mimari olarak nasıl değerlendirirdim" sorusundan yola çıkıp önce bir **değerlendirme çerçevesi** kurup (Bölüm 3), sonra bu çerçeveyi TeksERP'e uygulayan bir denetimdir. Tekstil fabrikası bağlamı boyunca merkeze alındı: fabrikanın **tüm** üretim/QK/sevkiyat kaydı tek bir yerel PostgreSQL sunucusunda yaşayacak, yüz binlerce satır birikecek ve sistem yıllarca (10+ yıl hedefiyle) çalışacak.

**Genel değerlendirme olumlu.** Kod tabanı, çoğu ERP'de görmediğimiz bir olgunluk sergiliyor:

- **Sorgu performansı örnek düzeyde (9/10):** sıcak yollarda N+1 yok, liste uçları `select` + cursor pagination kullanıyor, tüm ham SQL parametrize (injection yüzeyi yok), raporlar tek-geçiş aggregate.
- **Index mimarisi sağlam (8/10):** taranan 167 FK kolonunun tamamı kapsanmış, 48 composite index'in tümü doğru kolon sırasında (eşitlik önce, range sonra), her index'in gerekçesi şemada yorumlanmış.
- **Eşzamanlılık disiplini yüksek (8/10):** durum geçişleri belgeli "atomik claim" desenini kullanıyor, barkod üretimi retry'lı, transaction'larda harici I/O yok.

Bulguların hiçbiri "şu an veriyi bozan aktif bir hata" değil — çoğu, **yıllar içinde veya belirli koşullarda tetiklenecek** sertleştirme boşlukları. Yine de iki tanesi bugün ciddiye alınmalı:

1. **Felaket kurtarma açığı (Bulgu Y-4):** Gece yedeği DB verisiyle **aynı diskte** (`C:\ProgramData\TeksERP`). Tek disk arızası, ransomware veya yangın hem veritabanını hem yedekleri aynı anda yok eder. WAL/PITR yok — en iyi ihtimalle son 03:00 yedeğine dönülür (24 saate kadar kayıp).
2. **Üretimde Türkçe arama sessizce bozuk (Bulgu Y-2, Y-3):** Üretim `C` locale ile kuruluyor; 34 elle yazılmış arama sahasında küçük harf Türkçe terim ("çözgü", "şahin") BÜYÜK saklanan müşteri/ürün adlarını **bulamıyor**, hata vermeden eksik sonuç dönüyor. Dev ortamı ICU/en-US kullandığı için bu testte **hiç görünmüyor**.

Aşağıdaki skor kartı ve bulgu listesi, önem sırasına göre eyleme dönüştürülebilir öneriler içerir. Kayıtlı çalışma prensibi gereği ("önce anlat, onaysız büyük değişiklik yok") bu rapor **hiçbir kod değişikliği uygulamaz** — her bulgu somut düzeltme önerisiyle sunulur, hangisini uygulayacağınıza siz karar verirsiniz.

---

## 2. Skor Kartı

| # | Boyut | Skor | Özet |
|---|---|:---:|---|
| 1 | Şema ve Veri Modelleme | **8** / 10 | Disiplinli; `dyehouseNote` migration ping-pong'u + DB'de hiç CHECK constraint yok |
| 2 | Index Mimarisi | **8** / 10 | FK kapsamı tam, composite sıraları doğru; birkaç ölü/redundant index yazma maliyeti |
| 3 | Sorgu Performansı | **9** / 10 | N+1 yok, cursor pagination, parametrize ham SQL; birkaç çevresel iyileştirme |
| 4 | Veri Bütünlüğü ve Kısıtlar | **7.5** / 10 | Unique kapsamı güçlü; DB-seviyesi son savunma (CHECK) ve mutabakat görünürlüğü eksik |
| 5 | Transaction ve Eşzamanlılık | **8** / 10 | Atomik claim yaygın; tx timeout ayarsız, 2 sayaç yolu serileştirilmemiş |
| 6 | Ölçeklenebilirlik ve Yaşam Döngüsü | **7.5** / 10 | Arşivleme otomatik; üretim bellek tuning yok, non-SystemLog purge stratejisi yok |
| 7 | Operasyonel Dayanıklılık | **6** / 10 | Yedek/restore iskeleti var ama offsite yok, DDL kural ihlali, dev↔üretim sürüm farkı |
| 8 | Tekstil Domain Uygunluğu | **7** / 10 | İzlenebilirlik güçlü; tedarikçi/lot kökü kopuk, Tambur'suz rotada hata guard'ı yok |

**Ağırlıklı genel: ~7.6 / 10** — "üretime hazır, ama felaket-kurtarma ve dev/üretim paritesi sertleştirilmeli" seviyesi.

---

## 3. Değerlendirme Çerçevesi (Denetim Planı)

Bir veritabanını mimari olarak değerlendirirken baktığım sekiz boyut. Her boyutun tekstil-ERP bağlamındaki karşılığı ve neyi aradığı:

1. **Şema ve Veri Modelleme** — Normalizasyon, ilişki kardinaliteleri, nullability tutarlılığı, enum vs serbest string durum alanları, veri tipleri (Decimal precision, timestamp/timestamptz), JSON kolonların maliyeti, soft-delete deseninin tutarlılığı, `createdAt/updatedAt` konvansiyonu. *Tekstil:* Roll yaşam döngüsü, split (`parentRollId`), fason dönüş (`parentReceiptId`), parti (`batchSplitId`) modellemesi sağlıklı mı?

2. **Index Mimarisi (perf)** — Her FK'ya index var mı, composite kolon sırası doğru mu (eşitlik→range), redundant/ölü index var mı, partial index'ler DB'ye yansımış mı (şema-DB drift), yüksek hacim tabloların index'i gerçek sorgu kalıplarıyla örtüşüyor mu, yazma tarafı maliyeti (over-indexing).

3. **Sorgu Performansı (perf)** — Döngü içi sorgu (N+1), `select` vs `include` over-fetch, offset vs cursor pagination, groupBy/aggregate round-trip'leri, ham SQL parametrizasyonu ve injection yüzeyi, transaction içinde ağır iş. *Temsili kritik sorgularda plan şekli (EXPLAIN).*

4. **Veri Bütünlüğü ve Kısıtlar** — Doğal anahtar `@unique` kapsamı, CHECK constraint'ler (negatif miktar, tarih sırası), `onDelete` davranışları (Cascade/Restrict/SetNull), denormalize alanların senkron garantisi, durum makinesi guard'larının DB vs uygulama seviyesi, audit kapsamı, soft-delete kaçakları.

5. **Transaction ve Eşzamanlılık** — Check-then-act kalıntıları (atomik claim ihlali), barkod/numara üretiminde retry ve sequence okuma yeri, tx içinde harici I/O, `tx.*` + `Promise.all` kaçağı, idempotency, uzun transaction'lar, deadlock riski, connection pool konfigürasyonu.

6. **Ölçeklenebilirlik ve Veri Yaşam Döngüsü** — Satır sayısı projeksiyonu (1/5 yıl), arşivleme/purge stratejisi, partitioning eşiği, JSON snapshot büyümesi (TOAST), autovacuum ayarları, `statement_timeout`-rapor etkileşimi, connection pool ve tek-sunucu dikey sınırları, index yazma maliyeti.

7. **Operasyonel Dayanıklılık** — Migration hijyeni ve drift, **yedekleme stratejisi + PITR + offsite**, restore tatbikatı, DDL/`statement_timeout` tuzağı, izleme (slow query log, sağlık kontrolleri), dev↔üretim sürüm/konfig paritesi, DB kullanıcı yetkileri.

8. **Tekstil Domain Uygunluğu** — Uçtan uca izlenebilirlik (sevk edilen çuvaldan ham kumaşa kadar), geri çağırma (recall) senaryosu, `RollError` yaşam döngüsü guard'ları, ölçüm hassasiyeti (Decimal scale), çuval/tartı modeli, operatör izi (kim-hangi-makinede-hangi-topa), gelecek ihtiyaçlara esneklik (maliyet/muhasebe, OEE/vardiya).

> **Performans, planın merkezinde:** 2. (index), 3. (sorgu) ve 6. (ölçek) boyutların üçü de doğrudan performans; ayrıca Bölüm 9'da ayrı bir performans sentezi bölümü var.

---

## 4. Yöntem ve Güven Notu

- **Çok-ajanlı tarama:** 8 boyut, her biri bağımsız bir denetçi ajanla paralel tarandı; bulgular birleştirildi (dedup), sonra **kuşkucu çapraz doğrulamadan** geçirildi — kritik/yüksek bulgulara 2 bağımsız "çürütmeye çalışan" doğrulayıcı atandı. Bir tamlık eleştirmeni "ne eksik kaldı" diye hedefli ek sondalar üretti (collation ayrışması bu şekilde yakalandı).
- **Doğrulama katmanı çalıştı:** 62 ham bulgudan 3'ü doğrulama sırasında **çürütüldü** (yanlış pozitifler — Bölüm 10). Kalan **58** somut kanıtla ayakta; bunlara **elle araştırmamla eklediğim 2 bulgu** (O-23 pg pool/SIGTERM, D-23 migration checksum) katılınca toplam **60**.
- **Elle teyit:** 5 yüksek bulgunun ve seçili orta bulguların (parti no taşması, ölü index, tx timeout, pg pool hata dayanıklılığı, migration checksum, collation) kanıtlarını dosya:satır ve `psql` ile bizzat açıp doğruladım. Hepsi ayakta kaldı. Workflow'un oturum limitine takılıp tamamlayamadığı 2 sondayı (pg pool hata dayanıklılığı, migration checksum bütünlüğü) yeni bir tarama turu yerine kendim araştırdım — O-23 ve D-23 bunların sonucu.
- **⚠️ Ölçek uyarısı:** Dev DB'de yalnız **minik test verisi** var (18 MB, en büyük tablo 191 satir). Bu yüzden performans değerlendirmesi **yapısal** yapıldı (index tasarımı, sorgu kalıbı, plan şekli) — boş-tabloda EXPLAIN timing'i veya kullanım istatistikleri anlamsız olurdu. Satır projeksiyonları şema + servis kodundan türetildi.
- **Collation uyarısı:** Dev ICU/en-US, üretim `C` locale kullanıyor. Bu yüzden **dev'de yapılan EXPLAIN doğrulamaları üretimi bire bir temsil etmez** (özellikle `LIKE`-prefix index kullanımı iki yönde ayrışır — Bölüm 9).

---

## 5. Yüksek Öncelikli Bulgular

### Y-1 — İzlenebilirlik zincirinin kökü kopuk: ham kumaş girişinde tedarikçi/lot kaydı yok
> **[İPTAL — §0 Faz 9 `4925620` / §0.1]:** Bu bulgunun önerisi (**GoodsReceipt** + `supplierId`/`supplierLotNo`) domain doğrulamasıyla **reddedildi** — fabrika ham kumaş satın almıyor (fabrika-içi kayıtsız gelir), tedarikçi/lot kavramı yok. Faz 7'de kurulan `goods_receipts` + `Roll.goodsReceiptId`/`supplierLotNo`, migration `20260708170000_faz9_drop_goods_receipt` ile DROP edildi (kod-teyitli: şemada bu alanlar/model yok). Aşağıdaki "Not"un öngördüğü gibi "izlenebilirlik kökü = KK1 girişi" **bilinçli kapsam kararı** oldu. Aşağıki gövde denetim-anı gözlemidir.
- **Boyut:** Domain · **Konum:** `prisma/schema.prisma:823-982` (Roll) + `src/services/inventory.service.ts:418-454`
- **Kanıt:** Roll modelinde tedarikçi FK'sı veya lot alanı yok; tek köken bilgisi enum: `entrySource RollEntrySource @default(SUPPLIER_RECEIPT)`. Giriş kaydı (438-454) yalnız `entrySource` yazar; tedarikçi/lot/irsaliye alanı hiç yok. Şemada `CompanyType.SUPPLIER` tanımlı ama Roll'a bağlanan tek kullanım yok. Canlı DB'de koşulan geri-iz recursive CTE'si zinciri `SUPPLIER_RECEIPT` toplarında sonlandırıyor.
- **Etki:** Fabrika çözgü/dokuma yapmıyor, kumaş hazır geliyor — kusurun en olası kökü tedarikçi lotu. "X tedarikçi lotundan gelen toplar hangi müşterilere sevk edildi" sorusu modelce **yanıtsız**. Yüz binlerce top biriktiğinde tarih-bazlı tahmin, pratikte tüm dönem stoğunu geri çağırmaya eşdeğer olur.
- **Öneri:** Roll'a `supplierId` (Customer type=SUPPLIER'a FK veya ayrı Supplier master) + `supplierLotNo String?` ekleyin; ideali KK1 girişini bir **GoodsReceipt** (mal kabul: tedarikçi + irsaliye no + tarih) altında toplayıp Roll'a `goodsReceiptId` FK vermek. `@@index([supplierId])` + partial `@@index([supplierLotNo])` ile.
- **Not:** Eğer tedarikçi-lot geri çağırma bir iş gereksinimi değilse bu bilinçli bir kapsam kararıdır — o hâlde ARCHITECTURE.md'ye "izlenebilirlik kökü = KK1 girişi" olarak yazılıp bilinçli istisna statüsü kazanmalı.

### Y-2 — Üretim `C` locale'de ILIKE Türkçe katlamıyor: 34 arama sahasında sessiz eksik sonuç
- **Boyut:** Collation (ek sonda) · **Konum:** `installer/windows/scripts/manage.ps1:295` + `order/tambur/shipping/subcontractor/inventory/kartela/sack-search/traveler-card.service.ts` (34 saha)
- **Kanıt:** `manage.ps1:295` → `initdb.exe ... -E UTF8 --locale=C`. Dev DB kanıt sorguları: `'ŞİŞLİ ÇÖZGÜ' COLLATE "C" ILIKE '%çözgü%'` = **false** (ICU default: true); yalnız ASCII katlanıyor. Kodda 34 adet `mode:'insensitive'` → Prisma ILIKE üretir; dokunduğu alanlar: `customer.name`, `item.name/code`, `color.name`, `customerItemName`, `batchNumber`, `shipmentNo/sackNo/manualCode`.
- **Etki:** Üretimde (Windows, C locale) sipariş/sevkiyat/tambur/fason/kartela/envanter aramalarında küçük harf Türkçe terim, BÜYÜK saklanan adları **bulamaz** — sonuç sessizce eksik döner, hata yok. Operatör "kayıt yok" sanıp mükerrer müşteri/sipariş açabilir. **Dev'de (ICU en-US) sorun testte hiç görünmez.** Numara/barkod alanları ASCII olduğundan etkilenmez.
- **Öneri:** İki katman. **(1) Kısa vade (kod):** `query-parser.ts:152-165`'teki tr-upper varyant yaklaşımını ortak bir helper'a çıkar (`buildTurkishSearch(fields, term)`) ve 34 sahada kullan; tetikleyiciyi `/[ıi]/` yerine `search !== trUpper` yap ki C locale'de katlanmayan ğüşöç de kapsansın. **(2) Orta vade (DB):** installer `initdb`'yi `--locale-provider=icu --icu-locale=tr-TR` yap (EDB Windows PG ICU'lu gelir) — yeni kurulumlar Türkçe katlar + doğru sıralar; mevcut kurulumlar dump/restore ister. *citext tuzağı:* o da LC_CTYPE'a göre katlar, C altında çözüm değildir.

### Y-3 — İ/i katlaması HER ortamda kırık; tr-upper workaround yalnız generic yolda, 34 sahada yok
- **Boyut:** Collation (ek sonda) · **Konum:** `src/utils/query-parser.ts:152-165`
- **Kanıt:** Dev DB (ICU en-US): `'İSTANBUL' ILIKE 'istanbul'` = **false**, `'MAVİ' ILIKE 'mavi'` = **false** — `lower('İ')` = `'i̇'` (i + U+0307 combining dot) olduğundan 'i' ile asla eşleşmez; üretim C'de de aynen kırık. `query-parser.ts:154-165` bunu biliyor ve `/[ıi]/` içeren aramalara `toLocaleUpperCase('tr-TR')` varyantı ekliyor — ama bu koruma **sadece** BaseService/searchFields generic yolunda. Elle yazılmış 34 OR bloğunda yok (`order:478-481`, `shipping:1932`, `tambur` 10 satır, `subcontractor:2333`, `inventory:548`, `kartela` 5 satır, `sack-search:63`, `traveler-card:553`).
- **Etki:** Üretim-dev ayrışmasından **bağımsız**, bugün dev'de de üretilebilir bir kusur: "istanbul" araması "İSTANBUL TEKSTİL" müşterisini bulamaz. Türkçede i/İ en sık harflerden. Koruma kapsamının tutarsızlığı yeni ekranlarda da aynı hatanın kopyalanmasına yol açıyor.
- **Öneri:** Y-2'deki ortak helper'ı tek doğruluk kaynağı yap ve tüm elle yazılmış `mode:'insensitive'` bloklarını bundan geçir. İlişkili-alan (nested) aramaları destekle. `scripts/test_*.ts` sözleşmesiyle regresyon kilidi ekle: BÜYÜK saklanan `İĞÜŞÖÇ`'lü fixture'lara küçük harf aramalar.

### Y-4 — Yedeklerin tamamı DB ile aynı disk/makinede; makine dışı kopya ve PITR yok
- **Boyut:** Operasyonel · **Konum:** `installer/windows/scripts/manage.ps1:46-49`
- **Kanıt:** `$DataRoot = "C:\ProgramData\TeksERP"`, `$PgData = $DataRoot\pgdata`, `$BackupDir = $DataRoot\backups` — DB verisi ve tüm yedekler aynı volume'de. Gece 03:00 görevi (245-255) ve 14 dosyalık saklama (741) yalnız bu klasöre yazar. `postgresql.conf`'ta `archive_mode`/WAL arşiv ayarı yok; dev DB'de `SHOW archive_mode` → off. Runbook'larda offsite/NAS/USB kopyası geçmiyor.
- **Etki:** Fabrikanın **tüm** üretim/sevkiyat kaydı tek sunucuda. Disk arızası, ransomware, hırsızlık veya yangında veritabanı **ve** bütün yedekler aynı anda yok olur — yıllarca birikmiş kayıt geri getirilemez. WAL arşivi olmadığından en iyi senaryoda kurtarma noktası son 03:00 yedeği: **24 saate kadar** o günkü tüm KK/tambur/sevkiyat işlemi kaybolur.
- **Öneri:** Gece yedek görevinin sonuna ikinci ortama otomatik kopya ekle (`robocopy` ile NAS/ağ paylaşımı/USB — `Do-Backup`'a ~5 satır). Runbook'a haftalık "yedek klasörünü başka makineye kopyala" adımı. RPO'yu dakikalara indirmek için `archive_command` / `pg_receivewal` ile LAN içi ikinci makineye WAL arşivi — dışa açılım gerekmez (LAN-only duruşla uyumlu).
- **Bu raporun en öncelikli tek maddesi.**

### Y-5 — `statement_timeout` DDL kuralı, kural konduktan SONRAKİ migration'larda ihlal edilmiş
- **Boyut:** Operasyonel · **Konum:** `prisma/migrations/20260611084953_native_uuid_pk_fk/migration.sql`
- **Kanıt:** Kural commit `f8f98c5` (2026-06-07) ile CLAUDE.md'ye girdi. Sonraki `20260611084953` migration'ı **140 CREATE** ifadesi içeriyor (`rolls` dahil tüm tabloların PK/FK yeniden kurulumu), dosyada `SET statement_timeout = 0` **yok** (elle teyit edildi). Diğer ihlaller: `20260612120000`, `20260623100000` (yüksek hacimli `roll_errors` üstünde DROP+CREATE UNIQUE INDEX). Üretimde timeout hem `postgresql.conf` (50s) hem per-DB (`ALTER DATABASE`) aktif ve `migrate deploy` bağlantısına uygulanır.
- **Etki:** Veri birikmiş bir üretim sunucusuna güncelleme geldiğinde bu migration'lar **50 saniyede iptal** olur (`canceling statement due to statement timeout`). Migration failed durumda kalır, güncelleme yarıda kesilir.
- **Elle teyit / kalibrasyon:** Bu pratik şiddeti **senaryoya bağlı**. **Yeni/boş kuruluma zararsız** — `migrate deploy` tüm migration'ları boş DB'de sırayla koşar, timeout riski yok. Risk yalnız **zaten veri dolu** bir üretim DB'sine bu migration'ın **ilk kez** uygulanması durumunda gerçekleşir. Yani gerçek bir kural ihlali ama "bugün patlayan" değil, "gelecekteki bir güncelleme yolunu tıkayan" latent risk.
- **Öneri:** Yüksek hacimli tabloya dokunan geçmiş migration'ların başına `SET statement_timeout = 0;` ekle (uygulanmış DB'lerde etkisiz, henüz almamış kurulumları kurtarır). Geleceğe dönük: `scripts/` altına basit lint (migration'da `CREATE INDEX`/`ALTER COLUMN TYPE` var ama `statement_timeout=0` yok → hata) yazıp test runner'a ekle.

---

## 6. Orta Öncelikli Bulgular

### Eşzamanlılık / Transaction

**O-1 — Top arşivleme (hardDelete) STOCK→CANCELLED geçişi check-then-act — atomik claim ihlali**
`src/services/inventory.service.ts:1767-1799`. `findUnique` + durum ön-kontrolü + koşulsuz `update` (tx yok). Aynı dosyadaki `cancelRoll` (1711-1724) doğru deseni gösteriyor: `updateMany WHERE {id, status} + count===0→409`. Pencere içinde `attachRolls` veya fason sevki topu sahiplenirse, arşivleme yine koşulsuz CANCELLED yazar → WO malzeme muhasebesi ve adım sayaçları bozulur. **Öneri:** `cancelRoll` desenine geçir; audit `oldData`'yı claim koşulundaki statüyle yaz.

**O-2 — WO oto-tamamlama sayacı Kurşun-QC2 ve Tambur yollarında serileştirilmemiş — write-skew**
`src/services/kursun-qc.service.ts:691-707` ve `tambur.service.ts:1019-1034`. İki sitede de `tx.workOrderStep.count(...)` → `remaining===0` ise WO'yu COMPLETED yapıyor, ama `touchWorkOrderTx` (WO satır kilidi) **çağrılmıyor** — oysa fason yollarının 6 tx'i çağırıyor. `workorder-locks.helper.ts` docstring'i tehlikeyi açıkça belgeliyor (READ COMMITTED altında sayım eşzamanlı commit'i görmez). Aynı WO'nun son iki adımı eş anlı tamamlanırsa **ikisi de WO'yu tamamlamaz**: tüm adımlar COMPLETED ama WO sonsuza dek IN_PROGRESS, refakat kartı ACTIVE kalır. **Öneri:** İki tx'e `await touchWorkOrderTx(tx, workOrderId)` ekle; `inventory.service`'teki kardeş WO-tamamlama yollarını da tara.

**O-3 — 86 `$transaction` çağrısının hiçbirinde timeout/maxWait yok** — **[KAPANDI, §0.1: global `transactionOptions` eklendi]**
`src/lib/prisma.ts:35` (yalnız `{ adapter }`) + 86 çağrı. Prisma default'ları maxWait=2s / timeout=5s. Elle teyit: servis katmanında `maxWait|timeout|isolationLevel` sıfır sonuç. Yüz binlerce satırlı tablolarda ve 30-bağlantılık havuz doygunluğunda ağır tx'ler (tambur finalize, fason kabul) 5s'yi aşıp iptal olabilir → operatör 500 görür (atomik claim'ler güvenle geri sarar ama iş tekrarlanır). `statement_timeout=50s` tek sorguya izin verirken tx tavanının 5s'te kalması **tutarsız bir boğaz**. **Öneri:** Client kurulumuna global `transactionOptions: { maxWait: 5_000, timeout: 20_000 }` (50s'nin altında) ekle; en ağır akışlara per-çağrı daha yüksek değer.

**O-4 — Parti/manifest numarası üreticisinde lexicographic sıra taşması (999 sonrası + NaN zehirlenmesi)** — **[KAPANDI, §0.1: her iki üretici de `gte+startsWith`+`Number.isFinite` guard'a geçti]**
`src/services/workorder.service.ts` iş-emri-no üreticisi (denetimde `batchNumber`, parti redesign'ıyla alan artık `workOrderNumber`) ve `manifestNo`. Denetim anındaki kalıp: `orderBy: { <no>: 'desc' }` + `parseInt(...pop()) + 1` + `padStart(3)`. `'P-YYMMDD-1000'` string sıralamada `'...-999'`dan **küçük** kaldığından, 1000. kayıttan sonra desc hep '999'u döner → aday hep '1000' → exists → 5 deneme → "Parti numarası üretilemedi". **Elle teyit:** Manuel parti kodu serbest olduğundan (`P-260707-A5` gibi), prefix'e uyan sayısal-olmayan kuyruklu bir kod desc'te en üste çıkar → `parseInt`=NaN → `'P-260707-NaN'` kaydı → o günün otomatik üretimi zehirlenir. Bu bug proje tarafından **zaten biliniyor**: `shipping.service.ts:91-92` ve `order.service.ts:1094-1098` bunu `createdAt desc` + numeric-tail-max ile çözmüş — ders bu iki siteye taşınmamış. **Öneri:** Kanıtlanmış desenlerden birine geçir; parse edilemeyen kuyruğu atla.

### Veri Bütünlüğü

**O-5 — DB'de tek bir CHECK constraint yok — negatif miktar/kg ve tarih sırası tamamen uygulamaya emanet**
Canlı DB `pg_constraint WHERE contype='c'` **boş**. `rolls.currentQty/initialQty/weightKg`, `order_lines.quantity/shippedQty`, `shipment_allocations.qty`, `sacks.weightKg`, `work_order_steps.startedAt/completedAt` — hiçbirinde DB seddi yok. Uygulama tarafı disiplinli (gte-guard'lı atomik decrement) ama **tek savunma hattı**. Tek bir bug, yarım kalmış manuel psql düzeltmesi veya yeni endpoint'te unutulan guard, negatif stok veya `dispatchedAt<readyAt` gibi değeri sessizce kalıcılaştırır ve bu irsaliye/MRP hesaplarına yayılır. **Öneri:** Tek raw migration ile kritik kolonlara CHECK ekle (`currentQty>=0`, `quantity>0`, `completedAt IS NULL OR completedAt>=startedAt` ...); başına `SET statement_timeout=0`, önce mevcut veriyi SELECT ile doğrula.

**O-6 — Sipariş kalem silme: tx-dışı check-then-act + CASCADE, yarışta WO bağını sessizce koparır**
`src/services/order.service.ts:1398` (guard 1361-1368, load 1239). `current` tx **dışında** yükleniyor, guard bu bayat snapshot'a bakıyor, silme tx içinde re-check olmadan. `work_order_to_order_lines.orderLineId` FK'sı **ON DELETE CASCADE** (psql doğrulandı) → yarış penceresinde bağlanan WO-satır bağı (`allocatedQty` muhasebesi) sessizce yok olur. **Öneri:** Guard'ı tx içine taşı (`tx.workOrderToOrderLine.count(...)`); istenirse FK'yı Restrict yap.

**O-7 — `Sack.manualCode`'un "sevkiyat-içi benzersiz" invariantı hiçbir katmanda enforce edilmiyor** — **[GEÇERSİZ, §0.1: `manualCode` kolonu DROP edildi]**
Şema (`2197`) invariantı ilan ediyor ama servis iki yazma noktasında da "benzersizlik aranmaz" diyor; `markReady` yalnız BOŞ kontrolü yapıyor. DB'deki tek unique global AMB-pattern partial'ı — serbest kodları kapsamıyor. Aynı sevkiyatta iki çuval aynı kodu taşıyabilir → tabancayla okutma ve irsaliye dökümü yanlış çuvalı gösterir, yanlış çuval yüklenir. **Öneri:** `markReady`'ye sevkiyat-içi duplicate kontrolü + kalıcı çözüm için `UNIQUE (shipmentId, manualCode) WHERE manualCode IS NOT NULL` partial (drift-free desenle).

**O-8 — İstasyon kalıcı silme, makine kalıcı silmenin guard'larını atlıyor**
`src/services/helpers/guarded-hard-remove.ts:141-144`. `stationHardRemove` makineleri doğrudan `deleteMany` ediyor; oysa `machineHardRemove` ek guard koyuyor (`rollOperationCount`, `rollCreatedCount` → "Bu makinede N top girişi yapılmış"). FK'lar `SET NULL` → istasyon-silme yolundan geçen makinenin KK1/KK2/Tambur işlem atfı **geri dönüşsüz NULL**'lanır. **Öneri:** `stationHardRemove` guard listesine üç istasyon-kapsamlı guard ekle; hata mesajları tutarlı 409 olur.

### Şema / Modelleme

**O-9 — `WorkOrder.dyehouseNote`: bilinçli silinen kolon drift-fix ile geri geldi** — **[KAPANDI, §0.1 + Faz 6: kolon kaldırıldı]**
`schema.prisma:1196` + `migrations/20260629150000_fix_schema_drift`. Migration zinciri: eklenir → "per-adım tek kaynak" diye DROP edilir → bir drift-fix onu yanlışlıkla **geri ekler**. Kod hiç kullanmıyor (yalnız yorumlar). Canlı dev DB'de ayrıca `subcontractor_dispatches`'te hem `instruction` hem şema-dışı `dyehouseNote` kolonu var (psql doğrulandı → **dev DB drift'li**). Yanıltıcı yorum yeni geliştiriciyi ölü kolona yazmaya yönlendirebilir; sonraki `migrate dev` drift/RESET tuzağı üretir. **Öneri:** Yeni migration ile tekrar DROP + şemadan alanı/yorumu sil; dev DB'deki artık kolonu manuel ALTER ile temizle.

**O-10 — `createdAt/updatedAt` konvansiyon ihlali**
Session/RollMovement/RollReturn mutasyona uğruyor ama `updatedAt` yok (`revokedAt`, `qtyOut`/`exitedAt`, `cancelledAt` sonradan yazılıyor); tersine gerçek append-only SystemLog gereksiz `updatedAt` taşıyor ve arşive de kopyalıyor. En hızlı büyüyen tabloda satır başına gereksiz 8 byte. **Öneri:** Üçüne `@updatedAt` ekle; SystemLog'dan düşürmeyi değerlendir (en azından yeni log tablolarında ekleme).

**O-11 — timestamp / timestamptz karışımı**
Yalnız 3 `deletedAt` kolonu `@db.Timestamptz`, diğer tüm DateTime'lar `timestamp` (psql doğrulandı). Prisma UTC yazdığı için bugün işlevsel hata yok; risk raporlama/bakım scriptlerinde `now()` ile karşılaştırmada Europe/Istanbul'da 3 saatlik sessiz kayma. **Öneri:** Konvansiyon yaz (yeni kolonlar `@db.Timestamptz`); mevcutlara dokunma; bakım SQL'lerine `now() AT TIME ZONE 'UTC'` notu.

**O-12 — CHECK constraint yokluğu** → O-5 ile birleştirildi (aynı kök).

### Index

**O-13 — `roll_operations`'ta iki ölü index: `[rollId]` (unique sol-prefix'i) + `[operationType]` (hiç sürücü değil)** — **[KAPANDI, Faz 5 / §0.1: ikisi de DROP edildi]**
`schema.prisma:1473-1474`. `@@unique([rollId, workOrderStepId, operationType])` varken `[rollId]` gereksiz; `[operationType]` 5-değerli düşük-seçicilikli enum, tüm where'ler `rollId`/`workOrderStepId` eşliğinde. `roll_operations` en yüksek hacimli append-only tablolardan — her insert'te 2 gereksiz index bakımı = kalıcı yazma amplifikasyonu. **Öneri:** İkisini de DROP; rollId sorguları unique'ten, adım sorguları `[workOrderStepId, createdAt]`'ten çalışır.

**O-14 — `[operationType, createdAt]` composite eksik — rapor sorguları iki ayrı index'e bölünüyor** — **[KAPANDI, Faz 5 / §0.1: composite eklendi]**
`reports/quality.report.service.ts:148-206`: `operationType = ... AND createdAt aralığı`. psql: yalnız ayrı `operationType_idx` + `createdAt_idx` var. Planner ya büyük createdAt-range'i heap'te süzer ya da bitmap-AND'e düşer. **Öneri:** `@@index([operationType, createdAt])` ekle; tek kolonlu `[operationType]` prefix'i olarak kaldırılabilir. (O-13 ile birlikte planlanabilir.)

### Ölçek / Operasyonel

**O-15 — Üretim installer PostgreSQL bellek tuning'i yapmıyor (128MB shared_buffers default)**
`manage.ps1:315-328` yalnız listen/port/timezone/statement_timeout/log yazıyor — **bellek parametresi yok**. Default: `shared_buffers=128MB`, `work_mem=4MB`. 5 yılda `roll_movements ~1M`, `system_logs+arşiv ~4-5M` satıra ulaşınca 4MB work_mem ile rapor aggregate'leri diske taşar, 128MB ile working set cache'lenemez; `statement_timeout=50s` ile birleşince yıllık raporlar iptal olmaya başlar. **Öneri:** conf bloğuna ekle: `shared_buffers` ≈ RAM %25, `effective_cache_size` ≈ RAM %50-75, `work_mem` 16-32MB, `maintenance_work_mem` 256MB.

**O-16 — Dev PostgreSQL 18.4 ↔ üretim PostgreSQL 16.6 — iki majör sürüm fark**
`build.ps1:35` → `$PgVersion="16.6-1"`; dev `version()` → 18.4. Tüm migration/raw SQL/planner davranışı yalnız 18'de test ediliyor. 18'e özgü fark üretim 16'da migration patlayana kadar görünmez; dev pg_dump 18 → üretim pg_restore 16 açamayabilir (dump format geriye uyumsuz). **Öneri:** Installer'ı PG 18.x'e yükselt **veya** dev'i 16'ya sabitle — ikisi aynı majörde olsun; kısa vadede en azından 16'nın güncel minor'una çık.

**O-17 — Restore tatbikatı yok, yedek bütünlüğü doğrulanmıyor, secret.json yedeği otomatize değil**
`manage.ps1:722-748`. `Do-Backup` yalnız pg_dump exit code'una bakar — üretilen `.dump`'ın açılabilirliği hiç test edilmez (`pg_restore --list` bile yok). Bozuk/yarım bir dump 14 dosyalık rotasyonla sağlam yedeklerin yerini alır ve felakete kadar fark edilmez. **Öneri:** `Do-Backup` sonuna `pg_restore --list $out` (bütünlük kontrolü) + `secret.json` kopyası; runbook'a 6 aylık test-restore tatbikatı (`-Action verify-restore` ideali).

**O-18 — Açık hatalı top Tambur'suz rotada karar verilmeden depoya/sevke ilerleyebiliyor**
`src/services/kursun-qc.service.ts` finishStep (`else` dalı, `finalizeRollsAtLastStep` çağrısı). KK2 finishStep'te sonraki adım yoksa toplar hata kontrolü **olmadan** finalize edilir (`finalizeRollsAtLastStep` → kaliteye göre `WAREHOUSE`; *not: eski* `PRODUCED` *limbosu kaldırıldı, §0.1*) — `RollError.isProcessed` hiç sorgulanmıyor (kod-teyitli: finalize dalında açık-hata guard'ı yok). `inventory.computeStatusBlockReasons` ve `shipping` scan-in de açık hatayı kontrol etmiyor. Rota PROCESS_QC ile bitebiliyor. CLAUDE.md kuralı "RollError Tambur kararıyla kapanır" Tambur'suz rotada **yapısal olarak ihlal**: "60. metrede hata" girilen top, kusur kararı verilmeden sevk edilebilir; hatalar sonsuza dek `isProcessed=false` kalıp dashboard/rapor sayaçlarını kirletir. **Öneri:** İki savunma: (1) finishStep'te nextStep yoksa açık hata varsa 400 veya idari NO_CUT zorunlu; (2) `computeStatusBlockReasons` ve scan-in claim'ine açık-hata kontrolü (`[rollId, isProcessed]` index'i zaten var).

### Domain

**O-19 — Sevkiyat/tartı/paketleme operasyonlarında birinci-sınıf operatör izi yok** — **[KAPANDI, §0.1: `Sack.weighedById/weighedAt` + `Shipment.dispatchedById` eklendi]**
`schema.prisma:2220-2256` (Shipment), `2192-2214` (Sack). Shipment'ta kullanıcı FK'sı yok, Sack'ta `weighedBy/weighedAt` yok — iz yalnız best-effort SystemLog'da (yazım hatası isteği düşürmez → sessizce kaybolabilir; 6 ayda arşive taşınır). Karşıtlık: fason tarafında `SubcontractorDispatch.dispatchedById` birinci-sınıf kolon. "Bu çuvalı kim tarttı/paketledi, sevki kim onayladı" müşteri şikayetinde cevaplanamayabilir. **Öneri:** Shipment'a `readyById/dispatchedById`, Sack'a `weighedById/weighedAt` (düşük-trafik audit FK istisnası — index şart değil).

**O-20 — Çuval tartısında dara/net modeli yok — yalnız brüt kg**
`schema.prisma:2198` → `weightKg // Brüt tartı (kumaş+dara)`. Kodda dara/tare kavramı hiç yok. Çeki listesi brüt değerleri basıyor. İhracatta (tartı zorunluluğu yalnız EXPORT'ta) gümrük/fatura **net kg**'ı bugünkü modelden hesaplanamaz. **Öneri:** `Sack.tareKg Decimal?` (veya çuval tipi başına sabit dara) + çeki listesine BRÜT/DARA/NET; net hesabı `Prisma.Decimal` ile (float yasağı).

**O-21 — 8 numara/barkod üreticisi belgeli `gte+startsWith` yerine salt `startsWith` kullanıyor**
`workorder:277,4560`; `subcontractor:95,102,109,116`; `kartela:105,112,133`; `traveler-card:113`. `order.service.ts:1063` ve `shipping.service.ts:84` bu kalıbı uzun yorumlarla bilinçli uygulamış ("en_US.UTF-8 collation'da LIKE-prefix unique btree'yi kullanamaz"); proje hafızasında da kural. Bugünkü üretim C locale'de `LIKE→range` ile index kullanır — **güncel bir perf hatası değil**; risk (a) belgeli kalıbın ihlali/kopyalanması, (b) taşınabilirlik sigortasının yokluğu — ICU tr-TR geçişi (Y-2) yapılırsa bu 8 üretici her belge/barkodda **tam taramaya** döner (`subcontractor:116` yüksek-hacim `rolls.barcode`'a dokunuyor). **Öneri:** Sekiz sahaya `{ gte: prefix, startsWith: prefix }` uygula (davranışsal nötr; ICU geçişinin ön koşulu).

**O-22 — Roll↔Sack↔Shipment tutarlılık invariantı yalnız servis katmanında — DB düzeyinde zorlanmıyor** — **[UYGULANDI, §0.1: `sacks @@unique([id, shipmentId])` + rolls/swatches composite FK kuruldu]**
`prisma/schema.prisma:895-899` (Roll.sackId yorumu) + `2192-2215` (Sack). Şema yorumu invariantı açıkça tanımlıyor: `sack.shipmentId == roll.shipmentId` (898). Ancak `rolls.sackId → sacks(id)` ve `rolls.shipmentId → shipments(id)` **iki bağımsız FK**; composite FK, CHECK veya trigger yok (psql: 0 trigger, 0 check doğrulandı). Proje başka invariantlar için DB seddi kurmuş (partial unique'ler) — bu korumasız kalmış. Çuval taşıma/geri çekme uçlarından geçen tek bir servis bug'ı, topu A sevkiyatına bağlıyken B'nin çuvalına yazabilir → **irsaliye/çeki listesi yanlış müşteri içeriği basar (yasal belge)**, sessiz bozulma ancak fiziksel sayımda fark edilir. **Öneri:** Raw migration ile `sacks` üzerinde `UNIQUE (id, "shipmentId")` + `rolls`'a (ve `swatches`'a) composite FK `("sackId","shipmentId") REFERENCES sacks(id,"shipmentId")` — çuvala bağlı topun shipmentId'si çuvalınkiyle zorunlu eşleşir. Şema yorumuna belgele (Prisma karşılığı yok).

**O-23 — pg Pool `error` handler'ı yok + çift SIGTERM/SIGINT kaydı (bu iki bulgu benim elle araştırmamdan)** — **[KAPANDI, §0.1: `pool.on("error")` eklendi + shutdown tek noktada]**
`src/lib/prisma.ts:27-46` + `src/server.ts:104-134`. **(a)** `pool.on('error', ...)` **yok** (elle teyit: `grep pool.on` src'de yalnız `backup.service` child process). `pg` Pool, idle bir bağlantı backend hatası aldığında (PostgreSQL yeniden başlaması, gece yedeği sırasındaki kesinti, Windows update) `'error'` yayınlar; dinleyici yoksa bu `uncaughtException`'a düşer — ki `server.ts:127` handler'ı onu **süreç kapatarak** karşılıyor (NSSM yeniden başlatır). Net etki: **kısa bir DB kesintisi, havuz şeffaf reconnect yerine tüm backend'i restart ettirir**, tüm uçuştaki istekleri düşürür. **(b)** SIGTERM/SIGINT **iki yerde** kayıtlı: `server.ts:104-105` (graceful drain) **ve** `prisma.ts:45-46` (`prisma.$disconnect` + `pool.end` + **`process.exit(0)`**). İki handler yarışır; `prisma.ts`'in `process.exit(0)`'ı `server.ts`'in HTTP drain'ini yarıda kesebilir. **Öneri:** `prisma.ts`'e `pool.on('error', (e)=>logla)` ekle (süreç ayakta kalır, havuz bozuk bağlantıyı atar); shutdown'ı tek noktaya topla — `prisma.ts`'ten `process.exit`'i kaldır, `server.ts`'in `gracefulShutdown`'ı `prisma.$disconnect()`+`pool.end()`'i sırayla çağırsın.

---

## 7. Düşük Öncelikli Bulgular (özet)

| # | Boyut | Bulgu | Konum | Öneri (özet) |
|---|---|---|---|---|
| D-1 | conc | **[KISMİ, §0.1]** TravelerCardScan idempotency çapası yok + kart-durumu check-then-act | `traveler-card.service.ts:337-344` (10 sn dedup penceresi eklendi) | Önerilen `clientScanId`→P2002 çapası YOK; yerine 10 sn çift-okutma dedup'u (UX guard) |
| D-2 | domain | Fason dönüşünde iz **receipt (parti) seviyesinde** — top-seviyesi atıf kayboluyor, recall tüm kabule genişler | `schema:870` + receipt_items | Bilinçliyse belgele; ya da opsiyonel `sourceRollId` |
| D-3 | domain | **Vardiya/duruş modeli yok** — OEE'nin kullanılabilirlik bileşeni yazılamaz; fason maliyeti tabloya bağlanamaz | `schema:462-483` | Shift master + `unitCost` alanları (ileriye dönük) |
| D-4 | domain | `TravelerCardScan.deviceId` serbest metin — Device/Machine FK'sı yok | `schema:1553` | `devices.id` FK'sına çevir + opsiyonel machineId |
| D-5 | index | **`RollError.detectedByUserId` indexsiz** ama sorgu yolu doğmuş (belgeli kuralın ihlali) | `schema:1409` + `work-session-activity:287` | `@@index([detectedByUserId, detectedAt])` (processedBy emsali) |
| D-6 | index | 6 tabloda **sol-prefix redundant tekil index** (composite/unique'in ilk kolonu) | `schema:1131,383,1817,2073,2511,2540,2208` | Batch temizlik migration; öncelik `order_lines`, receipt_items |
| D-7 | index | `roll_errors.isProcessed` **tam boolean index** — %95+ true satır, projenin kendi partial emsaline aykırı | `schema:1428` + `dashboard:43` | Partial'a çevir (`WHERE isProcessed=false`), drift-free desenle |
| D-8 | scale | `rolls`'ta **18 index** + her adım geçişinde indexli kolon update → sıcak tabloda yazma amplifikasyonu | `rolls` (DB) | Silme değil izle: 6. aydan `index-health.sql`, `idx_scan=0` buda |
| D-9 | integ | `OrderLine.shippedQty` **artık iki yazarlı** (sevkiyat + fason direkt sevk), şema yorumu bayat, mutabakat scripti yok | `schema:1098` + `subcontractor:4232` | `scripts/consistency-check.sql` + yorum düzelt |
| D-10 | integ | Muhasebe taşıyan tablolarda **Cascade**: shipment fiziksel silinirse allocations yok olur ama shippedQty geri alınmaz | `shipment_allocations`, `order_lines` FK | Restrict'e çevir (kod kendi silmesini zaten tx'te yapıyor) |
| D-11 | integ | Fason geri-alma append-only iz tablolarını (**RollOperation/RollMovement fiziksel siliyor**) — CLAUDE.md istisna listesinde yok | `subcontractor:3448-3458` | İstisnayı belgele + audit oldData'ya silinen satır özetini göm |
| D-12 | integ | `WorkOrderStep(workOrderId, stepSequence)` **unique değil** — adım sırası çakışmasına DB seddi yok | `schema:1285` | `@@unique([workOrderId, stepSequence])` (index yerine) |
| D-13 | model | **`foldType` serbest string**: uçlar arası tutarsız validasyon; küçük/büyük varyant HC-06 kanal eşleşmesini tehdit ediyor | `schema:1191,750,542` | Prisma enum'a çevir veya tek Zod sözlüğü tüm uçlarda |
| D-14 | model | **[KAPANDI, §0.1]** 4 UUID kolon `text` tipinde (`batchSplitId` parti redesign'ıyla tümüyle kalktı; `sourceId`, `prevSackId/prevQualityGradeId` `@db.Uuid`'a çevrildi) | `schema.prisma` (`sourceId`, `prevSackId`, `prevQualityGradeId` artık `@db.Uuid`) | ~~`@db.Uuid`'a çevir~~ (uygulandı) |
| D-15 | model | Katalog alanları serbest string (`Device.kind`, `Station.department`, `Permission.module`) + sınırsız String tutarsızlığı | `schema:500,430,346` | `Device.kind` enum'a; department/module katalog veya VarChar limit |
| D-16 | ops | **Dev DB'de slow-query log kapalı** (`log_min_duration_statement=-1`), CLAUDE.md "aktif" diyor | CLAUDE.md Op.Bakım | `ALTER DATABASE ... SET log_min_duration_statement=500` veya doc netleştir |
| D-17 | query | **`verifyToken` her istekte 2 seri DB round-trip** yapıyor (en sıcak yol) | `auth.middleware.ts:74-91` | Tek sorguya birleştir (Session→User join) |
| D-18 | query | `getKursunApplication` **aynı aralığı iki kez tarıyor** — totals daily'den türetilebilir | `quality.report.service.ts:181-206` | totalsRow'u sil, `dailyRows.reduce` ile hesapla |
| D-19 | query | Sipariş picker'ı **500 kayıt full-include + bellek-içi sayfalama** her sayfada yeniden çekiyor | `order.service.ts:501-542` | `include`→dar `select`; Açık>0 süzgecini SQL'e indir |
| D-20 | query | **MAX_OFFSET guard'ı work-session listesinde bypass** — sınırsız page ile derin offset | `work-session.service.ts:453` | `page` cap'i ekle veya `buildPagination()` çağır |
| D-21 | scale | **SystemLog dışı append-only tablolar için purge stratejisi yok**; `system_log_archives`'in kendisi de sınırsız | `audit.service.ts:164` + tablolar | Yaşam döngüsü kararı belgele (retention + purge veya "purge edilmez") |
| D-23 | ops | **43/88 migration `applied_steps_count=0`** (oran denetim anına ait; toplam bugün ~114 — kanonik: `prisma/migrations/`) — elle `migrate resolve --applied` akışı SQL'in gerçekten koştuğunu doğrulamıyor (elle araştırmam) | `_prisma_migrations` (psql) | Y-5 ile birleşik: timeout'la yarıda kesilen DDL sessizce "uygulandı" işaretlenebilir. Üretim `migrate deploy` yolu daha güvenli (hata → durur) |

---

## 8. Bilgi Düzeyi Tespitler (bilinçli tasarım / doc-drift / güçlü yönler)

- **B-1 — `prisma.ts:26` yorumu bayat:** `statement_timeout '30s'` yazıyor, gerçek 50s (psql doğrulandı). Tuning kararlarını yanıltabilir. → Yorumu düzelt. **[KAPANDI, §0.1: yorum 50s'e düzeltildi]**
- **B-2 — Gevşek modelin izlenebilirlik maliyeti:** Geri çağırma müşteri+çuval düzeyinde **tam** çalışıyor (CTE ile doğrulandı); "sipariş → top" yönü bilinçli olarak yok (`SEVKIYAT-LOOSE-TASARIM.md`). Bulgu değil, tasarımın maliyet tespiti. → İstenirse "sipariş→aday sevkiyat→çuval" hazır raporu.
- **B-3 — Durum makineleri:** 3 partial-unique DB seddi (tek açık hareket/hata/refakat kartı) + atomik claim'ler; geçiş guard'ları uygulama katmanında. Prisma stack'i için doğru; risk yalnız claim'i atlayan yeni kodda.
- **B-4 — JSON kolon envanteri (16 kolon):** Çoğu bilinçli snapshot (donmuş belgeler). Riskli olan `RollOperation.metadata` — Tambur'un **gerçek kat sayısı ve kesim noktaları yalnız burada**. Rapor ihtiyacı doğunca GIN index + şema çıkarımı gerekecek. → `metadata` için TS tip sözleşmesi; kritik skaleri kolona terfi et.
- **B-5 — Kartela modeli fason'un yapısal kopyası:** Alan grubu tekrarı; ayrı domain kararı bilinçli. Bakım maliyeti — sevk/iptal düzeltmeleri iki sette ayrı uygulanmalı. → Servis katmanında ortak helper.
- **B-6 — DB yetki duruşu:** Üretimde dedicated `tekserp` rolü (superuser değil) — **güçlü yön**. Dev'de superuser bağlantısı (test verisi, düşük risk).
- **B-7 — `TravelerCard` listesi yalnız offset** (cursor yok) — MAX_OFFSET guard'lı, tehlike yok; tutarlılık notu.
- **B-8 — İlişki-alanlı `contains` aramaları index kullanamaz** — orta hacim tablolarda büyüme riski; sıcak yol (roll barcode) zaten `equals`'e optimize (ölçülü yorum). → Gerekirse `pg_trgm` GIN.
- **B-9 — JSON snapshot büyümesi kontrollü** (avg ~1.5KB, TOAST riski yok — pg_column_size ile ölçüldü). Liste sorguları snapshot çekmiyor. → 6. ayda üretimde yeniden ölç.
- **B-10 — Zaman bazlı partitioning şu an gereksiz** (5 yıl: en büyük ~4-5M satır, DB ~3-6GB). Erken partitioning ters maliyet (Prisma declarative desteklemez). → Eşik belgele (10M+ satır veya aylık purge ihtiyacı).
- **B-11 — Rapor sorguları `statement_timeout`'a karşı yapısal korumalı** (`reports/_shared.ts` zorunlu ≤366 gün + indexli kolon); arşiv otomasyonu (`archive-scheduler`) CLAUDE.md'deki manuel talimatın önüne geçmiş (doc-drift). → CLAUDE.md'yi "arşivleme otomatik" diye güncelle.

---

## 9. Performans Değerlendirmesi (sentez)

Talep gereği ayrı bir performans bölümü. Performans üç boyuta yayılıyor (index, sorgu, ölçek) ve genel tablo **çok olumlu** — mimari performans için tasarlanmış.

### 9.1 Güçlü yönler (korunmalı)
- **N+1 yok.** Sıcak yollardaki döngü-içi `await`'ler ya belgeli barkod-retry, ya derinliği ≤3 sınırlı BFS, ya satır-başına farklı veri yazan tx güncellemeleri — hiçbiri klasik N+1 değil.
- **Cursor pagination** yüksek hacim listelerde (roll, workOrder, shipment, return, systemLog) + `MAX_OFFSET=10000` guard.
- **Lean `select`** liste uçlarında; **snapshot JSON'ları liste sorgusundan dışlanmış** (kural 13 — printed-document ve shipment listeleri doğrulandı).
- **Tüm ham SQL parametrize** (tagged template / `Prisma.sql`); `queryRawUnsafe` **hiç yok** — injection yüzeyi bulunamadı.
- **Raporlar tek-geçiş aggregate** (`$queryRaw` GROUP BY); depo groupBy ve roll istatistikleri tek taramaya indirilmiş; Excel export `MAX_SHIPMENTS` ön-count guard'lı.
- **Index kapsamı tam:** 167 FK kolonu, 48 composite'in tümü doğru sırada, her index gerekçesi yorumlu.
- **EXPLAIN (plan şekli):** Roll listesi, depo groupBy ve dashboard açık-hareket alt sorgusu mevcut indekslerle (partial unique dahil) taşınıyor.

### 9.2 Yazma tarafı maliyeti (yüz binlerce satırda birikir)
- **`rolls` = 18 index** ve her adım geçişinde indexli kolon (`status`, `currentStepId`) update → HOT update imkânsız, her geçiş 18 index'e yeni tuple (D-8). ~300 top/gün × 5-10 update × 18 ≈ günde 30-50K index tuple sadece rolls için → bloat erken doğar, REINDEX ihtiyacı gelir.
- **`roll_operations` ölü index'leri** (O-13) ve **eksik composite** (O-14): en yüksek hacimli append-only tabloda hem gereksiz yazma hem rapor tarama verimsizliği.
- **6 tabloda sol-prefix redundant index** (D-6) + `roll_errors.isProcessed` tam boolean index (D-7): küçük ama sabit yazma vergisi.

### 9.3 Üretim ortamı performans açıkları (bugün görünmez, ölçekte patlar)
- **PostgreSQL bellek tuning yok** (O-15): `shared_buffers=128MB`, `work_mem=4MB` default. Milyon satırda rapor aggregate'leri diske taşar; `statement_timeout=50s` ile birleşince yıllık raporlar iptal olur. **Kurulum anında bedava çözülür, sahada tanısı zor şikâyete dönüşür.**
- **Collation → EXPLAIN geçersizliği:** Dev ICU/en-US'de `LIKE 'prefix%'` **hiçbir zaman** Index Cond olamaz (EXPLAIN ile kanıtlandı); üretim `C` locale'de olabilir. Yani **dev'de yapılan her EXPLAIN doğrulaması üretimi temsil etmez** ve tersi. CLAUDE.md'nin "EXPLAIN ile doğrula" kuralı bu ayrışma bilinmeden güvenilmez zemindedir. Bu, index-tarafı bir performans **ve** doğruluk (Y-2/Y-3) sorununu birleştiren en sinsi konu.

### 9.4 Sorgu düzeyi iyileştirmeler
- `verifyToken` **her istekte 2 seri round-trip** (D-17) — en sıcak yol, tek join'e inebilir.
- Kalite raporu **aynı aralığı iki kez tarıyor** (D-18).
- Sipariş picker **500 kayıt over-fetch + bellek-içi sayfalama** (D-19).
- work-session listesi **MAX_OFFSET bypass** (D-20).

### 9.5 Ölçek projeksiyonu (200 top/gün orta senaryo, 5 yıl)
| Tablo | ~5 yıl satır | Not |
|---|---|---|
| `system_logs` + arşiv | ~4-5M | Arşivleme otomatik (6 ay saklama) → sıcak tablo ~350-500K'da sabitlenir |
| `roll_operations` | ~1.2M | En yüksek hacim; ölü index'ler burada acıtır |
| `roll_movements` | ~1.05M | createdAt/enteredAt indexli, tarih-aralıklı sorgular |
| `traveler_card_scans` | onbinlerce-yüzbinlerce | Idempotency çapası yok (D-1) |
| Toplam DB | ~3-6 GB | **Partitioning gerekmiyor** — B-tree + arşiv + cursor yeterli |

**Sonuç:** Bu hacimde yapısal olarak sağlam. Yapılması gerekenler: (1) üretim bellek tuning (O-15), (2) `roll_operations` index temizliği + composite (O-13, O-14), (3) collation'ı çözüp EXPLAIN'i güvenilir kılmak (Y-2/Y-3), (4) partitioning eşiğini belgele (B-10). Partitioning bugün **erken** olur.

---

## 10. Çürütülen Bulgular (şeffaflık)

Doğrulama katmanı 3 ham bulguyu yanlış pozitif olarak çürüttü — kayda değer, çünkü kod bu konularda **iddiadan daha iyi**:

1. **"Canlı dev DB'de repoda olmayan migration — drift"** → Çürütüldü: `prisma/migrations` (denetim anında 88 dizin; bugün ~114) `_prisma_migrations`'la birebir uyumlu; drift yok.
2. **"Periyodik bakım (log arşivi) insan hafızasına emanet"** → Çürütüldü: `src/jobs/archive-scheduler.ts` + `server.ts:63` — arşivleme **otomatik** (server start +60sn, 24 saatte bir kontrol, 30 günde bir çalışır).
3. **"`yedekle.sh` eski Docker kurulumuna göre yazılmış, çalışmaz"** → Çürütüldü: repo kökünde `docker-compose.yml` (postgres servisi + `./backups` mount) mevcut; script bağlamında geçerli.

---

## 11. Önerilen Yol Haritası

Önem × maliyet ekseninde sıralı. Hiçbiri henüz uygulanmadı — onayınızla ele alınır.

### Hemen (bu hafta) — düşük maliyet, yüksek etki
1. **Y-4 — Offsite yedek:** `Do-Backup`'a NAS/USB kopyası (~5 satır) + runbook adımı. *Felaket kurtarma — tek en önemli madde.*
2. **Y-2/Y-3 — Türkçe arama helper'ı:** Ortak `buildTurkishSearch` + 34 sahada kullan + regresyon testi. *Sessiz üretim bug'ı.*
3. **O-17 — Yedek bütünlük kontrolü:** `pg_restore --list` + `secret.json` kopyası.
4. **O-15 — Üretim bellek tuning:** `manage.ps1` conf bloğuna 4 parametre.

### Kısa vade (bu ay) — sertleştirme
5. **O-5 — CHECK constraint'ler** (negatif miktar/tarih sırası) — tek raw migration, `SET statement_timeout=0` başlıklı.
6. **O-3 — Global `transactionOptions`** (maxWait/timeout).
7. **O-1, O-2, O-6 — Atomik claim tamamlama** (hardDelete, WO oto-tamamlama, OrderLine silme).
8. **O-4 — Parti/manifest no üretici** düzeltmesi (kanıtlanmış desene geçiş).
9. **Y-5 / D-23 — Geçmiş DDL migration'larına `SET statement_timeout=0`** + migration lint.
10. **O-13/O-14, D-6, D-7 — Index temizliği** (ölü/redundant DROP + composite + partial), vardiya dışı deploy.
11. **O-23 — pg Pool dayanıklılığı:** `pool.on('error')` ekle + shutdown'ı tek noktaya topla. *DB kesintisinde tüm backend'in restart olmasını önler.*

### Orta vade — planlı
12. **O-16 — dev/üretim PG sürüm paritesi** (18'e yükselt veya 16'ya sabitle).
13. **Y-2 kalıcı — ICU tr-TR locale'e geçiş** (yeni kurulumlar; O-21 bunun ön koşulu).
14. **O-18 — Tambur'suz rotada açık-hata guard'ı.**
15. **D-9/D-10 — `consistency-check.sql`** + muhasebe FK'larını Restrict.
16. **O-19/O-20 — Sevkiyat operatör izi + çuval dara/net** (domain zenginleştirme).
17. **D-21, B-10 — Yaşam döngüsü ve partitioning eşiği kararlarını belgele.**

### Değerlendirilecek (ürün kararı)
18. **Y-1 — Tedarikçi/lot modeli** — **KAPANDI (Faz 9):** ham kumaş satın alınmadığı doğrulandı → bilinçli istisna olarak kapatıldı, `goods_receipts` DROP.
19. **D-3 — Vardiya/maliyet modeli** (OEE/muhasebe yol haritasıysa).

---

## 12. Kapanış Notu

TeksERP'in veritabanı katmanı, tek geliştiricili bir projede nadiren görülen bir mühendislik disiplini taşıyor: atomik claim deseni, partial-unique "DB sedleri", belgeli index gerekçeleri, ölçülü sorgu optimizasyonları (barcode `equals` yorumu gibi) ve otomatik arşivleme. **Kritik bulgu çıkmaması bir tesadüf değil — kod tabanının olgunluğunun sonucu.**

Bulguların ağırlık merkezi iki yerde: **(1)** kod içi mimarinin ötesindeki **operasyonel dayanıklılık** (yedek, dev/üretim paritesi) ve **(2)** yalnız üretim ortamında yüzeye çıkan **collation ayrışması**. İkisi de "kod kötü" değil, "üretim gerçeği dev'de görünmüyor" kategorisinde — ve tam da bu yüzden bir denetim olmadan yakalanmaları zor.

Rapordaki her `dosya:satır` referansı ve her `psql` kanıtı denetim sırasında doğrulandı; 5 yüksek ve seçili orta bulgu ayrıca elle teyit edildi. Hangi maddelerden başlamamı istediğinizi söylerseniz, ilgili düzeltmeleri (önce anlatıp, seçenekleriyle) uygulamaya geçebilirim.
