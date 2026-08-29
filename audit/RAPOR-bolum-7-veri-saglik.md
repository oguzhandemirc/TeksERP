# Bölüm 7 — VERİ SAĞLIK RAPORU

> Bu bölümdeki **her sayı çalıştırılarak** ölçülmüştür. Sorgular `audit/data/*.sql`,
> ham çıktılar `audit/data/*.txt`, ölçüm defterleri `audit/01-find/tur2-V-*.md` altındadır.
> Uydurulmuş tek bir rakam yoktur; ölçülemeyen her şey §1.3 ve §7'de adıyla listelidir.

---

## 1. ÖLÇÜM ORTAMI

### 1.1 Hangi veritabanı, hangi tarih, hangi migration seviyesi

| | **SAHA** (üretimin kopyası) | **DEV** (geliştirme) |
|---|---|---|
| DB adı | `tekserp_saha_0825` | `adnansahin_db` |
| Neyin kopyası | Üretimin **2026-08-25** yedeği | Geliştirme veritabanı |
| Migration seviyesi | **190 / 195** (son 5 migration YOK) | **195 / 195** |
| Erişim biçimi | `audit/tools/sql-saha.sh` — oturum `default_transaction_read_only=on` | `audit/tools/sql-dev.sh` — aynı |
| PostgreSQL | Yerel PG **18.6**'ya restore edildi (üretim gerçekte **16.9**, Windows) | PG 18.6 |
| Ölçüm tarihi | 2026-08-28 · dal `adnansahin` · HEAD `ce8681d1` | aynı |
| Veri yaşı | Sistem **2026-07-16**'da kuruldu → kesitte **40 günlük** veri var | test kalıntılı (549/762 iş emri test önekli) |

**Salt-okunurluk:** İki DB oturumu da `default_transaction_read_only=on` ile açıldı; sunucu
INSERT/UPDATE/DELETE/DDL'i reddeder. Kaynak ağaçta (`Teks-Erp/`, `Electron/`, `mobil/`) hiçbir
dosya değiştirilmedi.

> **Kayıt notu (tutarsızlık, gizlenmedi):** Denetçilerin dördü kopyayı **190/195 migration** diye
> raporladı (`00-map/KUNYE.md`; `01-find/tur2-V-1`, `-V-2`, `-V-3`, `-V-4` başlıkları), V-5 ise
> **189/194** yazdı (`01-find/tur2-V-5-veri-numara-zaman-audit-madenciligi.md:5`). Bir satırlık bu
> fark hiçbir bulguyu etkilemiyor (eksik migration kümesi ikisinde de aynı: `orders.cancelledAt`,
> `order_lines.cancelledAt`, `ReasonPresetKind.ORDER_CANCEL`, `orders_active_createdAt_idx`),
> ama sayım yöntemi bir dahaki turda tekleştirilmeli.

### 1.2 Kopyanın kirliliği — bütün tarih/aktör ölçümlerini etkileyen kesim noktası

Yedek geri yüklendikten sonra kopya üzerinde geliştirme koşulmuş. Kesim noktası `system_logs`
`action='STARTUP'` satırlarının `newData->>'env'` alanından **ölçüldü**
(`tur2-V-5…md` §0):

| env | satır | ilk | son |
|---|---|---|---|
| `production` | 33 | 2026-07-16 12:50 | **2026-08-24 18:23:57** |
| `development` | 26 | **2026-08-25 02:38:40** | 2026-08-25 13:49:50 |

→ **Üretim-gerçek pencere: `createdAt < 2026-08-25 02:38`.** Bu pencereden sonraki 63 audit
satırı, 13 ana veri birleştirmesi, 2 iş emri ve 2 fason sevki restore SONRASI doğmuş olabilir;
hangisinin üretimde de var olduğu bu kopyadan **ayırt edilemez**.

⚠️ İki denetçi iki farklı kesim eşiği kullandı: V-5 `< 02:38`, V-4 `< 13:00`
(`tur2-V-4…md` KAPSANMAYAN §2). Aradaki 10,5 saatlik pencereye düşen ölçümler
`[VARSAYIM]` etiketlidir.

Kopyaya sonradan uygulandığı `_prisma_migrations` damgasıyla kanıtlanan iki iz:
`20260825120000_color_name_unique_live` (**2026-08-25 13:21:56**) ve
`ReasonPresetKind.WORK_ORDER_REWORK` enum değeri (migration satırı YOK, enum'da değer VAR —
`00-map/ERISILEMEYEN.md:36`).

### 1.3 Neyin ölçülemediği

| Ölçülemeyen | Sebep | Sonuç |
|---|---|---|
| **Canlı üretim DB'si** (`tekserp`, SAHINSRV) | Erişim yok | Bütün K2 sayıları 2026-08-25 kesitinden; 08-25 → 08-28 arası 3 günün verisi hiç görülmedi |
| `orders.cancelledAt` · `order_lines.cancelledAt` · `cancelReason(Code)` · `ReasonPresetKind.ORDER_CANCEL` | Kopya 190/195 migration | "İptal edilmiş kalem sevk edilmiş mi", İptal Karnesi ve `ACTIVE_LINE` süzgeci **yalnız dev'de** ölçülebildi (orada 0 satır) |
| `teks.audit_guard` GUC'unun üretimdeki değeri | `ALTER DATABASE … SET` restore'da taşınmaz; kopyada boş | Audit tamper trigger'ı **mevcut ve etkin** (`tgenabled='O'`) ama üretimde kapının açık olup olmadığı bilinmiyor (`BULGU-T1-034`) |
| `statement_timeout`, `max_connections`, `pg_stat_*`, bloat, kilit istatistikleri | Kopya yerel PG 18.6'ya restore edildi | Performans/kilit ölçümleri kod ve telemetri tablosundan türetildi |
| Şube (branch) ekseni | `customer_branches` **0 satır** | `distributeSacksToLines`'ın `branchMatch` dalı sahada **hiç veri görmedi** — ilk şube açıldığında o kod ilk kez koşacak |
| Doğrudan (fason) sevk ekseni | `direct_shipments` 0, `subcontractor_direct_ship_allocations` 0 | `computeLineLedger`'ın ikinci kaynağı hiç kullanılmamış |
| Kartela (Swatch) akışı | 0 sevk, 0 swatch | Alanın tamamı sahada hiç çalışmamış |
| Plan-sapma defteri (`roll_plan_deviations`) | **0 satır** — kapı 2026-08-19'da geldi, deploy 08-24/25 | Defter boş; ölçüldü ki **sapma da olmamış** (2026-08-19 sonrası 507 Tambur kesiminin hiçbirinde renk/en sapması yok) |
| `A1_STOCK` (2. kalite) · `SEMI_FINISHED` (yarı mamul) | Sahada **0 kayıt** | Bu iki statünün canlı davranışı hiç görülmedi |
| `_prisma_migrations.checksum` ↔ dosya sha256 | Algoritma farkı (195 satırın 195'i farklı) | "Uygulandıktan sonra düzenlenmiş migration dosyası var mı" sorusu **yanıtsız** |

---

## 2. SAYILARLA ÖZET

### 2.1 Üretim kopyasında ne tarandı

| Alan | Tablo / kontrol birimi | Saha satır |
|---|---:|---:|
| **Top / metraj** | `rolls` | 2.431 |
| | `roll_movements` | 1.107 |
| | `roll_operations` | 1.586 |
| | `roll_variances` (sapma defteri) | 75 |
| | `roll_errors` | 3 |
| | `roll_plan_deviations` | 0 |
| | `roll_properties` | 2.256 |
| | `batches` (parti) | 198 |
| **Sipariş / sevkiyat** | `orders` / `order_lines` | 278 / 281 |
| | `shipments` / `shipment_orders` | 40 / 55 |
| | `sacks` / `sack_allocations` | 41 / 46 |
| | `roll_returns` (iade) | 5 |
| | `printed_documents` (donmuş belge) | 328 |
| | `customers` / `customer_branches` | 27 / **0** |
| **Fason / iş emri** | `work_orders` / `work_order_steps` | 213 / 635 |
| | `subcontractor_dispatches` / `_receipts` | 195 / 143 |
| | `subcontractor_receipt_properties` | 138 |
| | `traveler_cards` (refakat kartı) | 213 |
| | `work_order_to_order_line` | 140 |
| | Kurşun bypass ataması / kartela sevki | 2 / **0** |
| **Ana veri / yetki / audit** | `system_logs` | 10.485 |
| | `users` / `sessions` / `devices` | 9 / 214 / 28 |
| | `permissions` / `user_permissions` / `permission_templates` | 70 / 353 / 26 |
| | `system_settings` | 34 (katalogda 62 anahtar) |
| | `reason_presets` / `duplicate_reviews` | 29 / 13 |
| | `stations` / `machines` | 6 / 6 |
| | `endpoint_latency_daily` | 3.117 |
| | `customer_item_aliases` / `_color_aliases` | 54 / 2 |
| **TOPLAM (yukarıdaki satırların toplamı)** | | **≈ 24.900 kayıt** |

Bunlara ek olarak **kayıt sayılmayan** ama taranan yüzeyler:
`createdAt`/`updatedAt` taşıyan **91 tablonun tamamı** zaman-sıralaması için tarandı
(`T2-V5-04`, `T2-V5-12`); **18 kod kolonu** (`3.343` numaralı kayıt) mükerrer + boşluk için
ayrıştırıldı (`T2-V5-01`, `T2-V5-02`); dört DB kataloğu iki veritabanı arasında tam
karşılaştırıldı (**472 index · 27 CHECK/UNIQUE · 162 enum değeri · 1.066 kolon · 3 trigger**);
telemetri tablosunda **40 günde 175.242 istek** özetlendi.

### 2.2 Kaç ihlal sınıfı bulundu

Denetimin ayakta kalan **243 bulgusunun tamamında** `veride_ihlal` alanı doludur
(`audit/findings.json`) — yani her bulgu için "veride karşılığı var mı" sorusu **sorulmuş** ve
cevabı kayda geçmiştir.

| Kategori | Bulgu sayısı |
|---|---:|
| **Sahada ölçülen fiili ihlal (saha > 0)** | **91** |
| Yalnızca dev'de tezahür eden (saha 0/ölçülemez, dev > 0) | 12 |
| Arandı, sahada **0 bulundu** (mekanizma açık, henüz tetiklenmemiş) | 82 |
| Veride sayısal karşılığı olmayan (yapısal/kod düzeyi) | 70 |
| **Toplam ayakta kalan bulgu** | **243** |

Sahada fiili ihlali olan 91 bulgunun şiddet dağılımı:
**S1 = 7 · S2 = 21 · S3 = 43 · S4 = 20**.

Yalnız dev'de tezahür eden 12 bulgu (üretimde bugün karşılığı yok, ama mekanizma aynı kodda):
`BULGU-T1-008`, `-T1-015`, `-T1-030`, `-T1-031`, `-T1-045`, `-T1-055`, `-T1-057`, `-T1-070`,
`-T1-131`, `-T1-161`, `-T2-021`, `-T2-036`.

### 2.3 En ağır beş ihlal — fabrika diliyle

| # | Ne oldu | Rakam | Bulgu | Nerede görülür |
|---|---|---|---|---|
| **1** | **Mal müşteriye gitti, sipariş defterine hiç yazılmadı.** Sevk edilen 27.611,8 m'nin **7.152,6 m'si** hiçbir sipariş satırından düşülmedi. **5 sevkiyat (81 top · 3.040,2 m · 3 müşteri) tamamen defter dışı.** Etkilenen **7 sipariş kalemi bugün hâlâ "0 sevk / 3.700 m açık"** görünüyor — irsaliyede o siparişin numarası basılı olduğu hâlde. Kök: kalem `ALP·55-BEYAZ·330` ↔ sevk `ALP·EKRU·330` renk uyuşmazlığı; eşleşme tutmayınca defter satırı **sessizce** yazılmıyor | **7.200,6 m** fark · 5 sevkiyat · 7 kalem | `BULGU-T2-001` (**S1**) | Sipariş listesi "Açık" sütunu · Karşılanma raporu · müşteri mutabakatı |
| **2** | **İptal edilmiş top hâlâ "üretimde" sayılıyor.** Açık iş emirlerinde iptal edilmiş/kartelaya gitmiş **31 top · 1.506,9 m** üretim çıktısı kovasında duruyor (`IE0708260006` 698,9 m · `IE0808260001` 545,0 m · `IE0508260004` 263,0 m). Aynı kökün ikinci tezahürü: kapanmış 44 iş emrinde **5.148,0 m** — bu rakam yalnızca ekran süzgeci sayesinde görünmüyor | **1.506,9 m** (+5.148,0 m gizli) | `BULGU-T1-080` (S3) | Ürün Dengesi · iş emri "Çıkan" metrajı |
| **3** | **230 iptalin 134'ünde kim/ne zaman/neden yazmıyor.** İptal izi kolonları 2026-08-05'ten beri var; eksiklik **kesintisiz sürüyor**. Ayrıca **230 iptalin 230'unda** sebep kodu boş, **126'sında** iptal öncesi statü boş → "İptali Geri Al" o topları **yanlış rafa** döndürür (Ham Stok'a) | **134 / 230** izsiz | `BULGU-T1-033` (S3) | Denetim Raporu · top geçmişi · iptal geri alma |
| **4** | **Top statü değişimlerinin %22'si hiçbir denetim satırı bırakmıyor.** 2.392 statü değişiminin **535'i** için "bu topa ne oldu" sorusu Denetim Raporu'ndan cevaplanamıyor; en büyük kova fason tüketimi (335) | **535 / 2.392 (%22,4)** | `BULGU-T2-029` (S3) | Denetim Raporu · top yaşam döngüsü paneli |
| **5** | **İade defteri "depoya alındı" diyor ama mal ne stokta ne fire raporunda.** 5 iade kaydında (**261 m**) `appliedStatus=WAREHOUSE` yazıyor, ama topların statüsü `CANCELLED`. Mal fiziksel olarak nerede olduğu sistemden okunamıyor | **261 m** · 5 iade | `BULGU-T2-023` (S3) | İade raporu · Bitmiş Depo · Fire Karnesi |

**Yakın takip (altıncı ve yedinci):**
`BULGU-T2-016` — depo kesimi ebeveynin `initialQty`'sini yeniden yazdığı için **8 soyağacında
185,7 m** izini kaybediyor ve mutabakat sorgusu **2 sahte aşım alarmı** üretiyor.
`BULGU-T2-012` — SoD-kritik yetkiler `ops-sql` ile doğrudan veritabanına yazılmış
(**24 satırda `grantedById` boş**), `shipping:undo-dispatch` bu yolla **6 kullanıcıya** verilmiş.

---

## 3. İHLAL KATALOĞU

> Sütunlar: **Saha** = üretim kopyasında ölçülen; **Dev** = geliştirme DB'sinde ölçülen
> (`—` = ölçülmedi/uygulanamadı). **Örnek kayıt** doğrudan `findings.json` → `veride_ihlal.not`
> alanından; uydurulmuş kimlik yok.

### 3.1 Top / metraj / kesim

| Ölçülen ihlal | Saha | Dev | Örnek kayıt | Bulgu | Sorgu |
|---|---:|---:|---|---|---|
| Açık iş emirlerinde iptal/kartela topunun metrajı hâlâ "üretim çıktısı" | **1.506,9 m** (31 top) | 0 | `IE0708260006` 698,9 m · `IE0808260001` 545,0 m · `IE0508260004` 263,0 m; kapalı WO tarafında ayrıca 44 WO / 5.148,0 m | `BULGU-T1-080` | `findings.json` → T1-080 |
| İptal edilmiş topta iz kolonları boş | **134 / 230** `cancelledAt` NULL; **230/230** sebep kodu NULL; **134** `preCancelStatus` NULL | 56 / 1 | Gün kırılımı: 05.08 22/22 · 08.08 15/18 · 14.08 9/9 · 17.08 15/16 · 18.08 17/20 · 19.08 7/7 · 20.08 7/8 · 21.08 1/1 | `BULGU-T1-033` | T1-033 |
| Kesim çocuklarında iptal izi | **92 top / 4.327,2 m**'de damga yok | — | Tambur geri alma yolu, damgasızların ana kaynağı | `BULGU-T1-033` (V1-35) | `tur2-V-1…md` §1 |
| `currentQty > initialQty` (topun metrajı giriş metrajını aşıyor) | **2** | 0 | `95c15daf…` 492,0 → 698,9 (2026-08-11) · `92d0ef12…` 500,0 → 520,5 (2026-08-08); **ikisi de hâlâ `IN_PRODUCTION`** | `BULGU-T1-044`, `BULGU-T3-011` | T1-044 |
| `initialQty = 0` olan ebeveyn topun canlı çocuğu var | **8 soyağacı** | 2 | `T080826F0017/0019/0020`, `T160726F0001/0003`, `T030826F0003`, `T190826F0119/0120`; izsiz metraj **185,7 m** | `BULGU-T2-016`, `BULGU-T1-012` | T2-016 |
| Mutabakat sorgusunun **sahte** "defterlenmemiş aşım" alarmı | **2** | — | `T080826F0017` (20 m), `T080826F0020` (39 m) — gerçek aşım değil, `initialQty` yeniden yazımı | `BULGU-T2-016` | `tur2-V-1…md` V1-05 |
| Kesim aritmetiği tutmayan ebeveyn (`initialQty + aşım ≠ Σ çocuk + düşülen`) | **8 / 116** | 8 / 21 | Net 968,8 m; 185,7 m'si `initialQty` yeniden yazımından, gerisi iptal edilmiş çocuklardan | `BULGU-T2-016` | `tur2-V-1…md` V1-07 |
| Canlı statüde 0 metrajlı hayalet top | **2** | — | `T190826F0119` (WAREHOUSE 0/0, 19.08 14:55) · `T190826F0120` (19.08 15:02); çocukları `…F0125` (36,7 m) ve `…F0126` (40,0 m), ikisi de SHIPPED | `BULGU-T1-039` | T1-039 |
| Final statüde `finalizedAt` boş → hiçbir dönem karnesinde görünmüyor | **4 top / 359 m** | 4 | `bc74b77d…` SCRAP 300,0 m (barkodsuz) · `T080826F0018` 20 m · `T080826F0021` 33 m · `T080826F0022` 6 m | `BULGU-T2-017` | T2-017 |
| Fabrikanın **tek fire kaydı** karnede görünmüyor (`SCRAP` damgasız) | **1 / 1** | 2 / 2 | Fire ucu 2026-08-25'te açıldı; `WAREHOUSE → SCRAP` geçişi trigger'ın kaynak listesinde YOK | `BULGU-T1-032` | T1-032 |
| "Fire" iki farklı kriterle sayılıyor (statü ↔ kalite kodu) | **61,4 m** ayrışma | 2 | `WAREHOUSE\|FIRE` 4 top / 61,4 m (`T150826F0009`, `T150826F0011`, `T170826F0017`, `T190826F0035`) · `SCRAP\|(null)` 1 top / 300 m → **iki karnede de görünmez** | `BULGU-T1-082` | T1-082 |
| Kapanmış dönem geriye dönük değişiyor | **4 top / 698,0 m** | 0 | `T200726F0002/0003/0005/0006` — Temmuz'da finalize, Ağustos'ta ölü kümeye geçti; Temmuz karnesi sessizce düştü. Aynı ay içi: 87 top / 6.084,2 m | `BULGU-T2-018` | T2-018 |
| Topun metrajı audit defterinden yeniden kurulamıyor (depo kesimi ebeveyne satır yazmıyor) | **10** | 0 | 36,7 m'lik top defterde 36,7, ebeveynin satırında 0 | `BULGU-T2-015` | `T2-V5-11-metraj-defteri.sql` |
| Kayıt-düzeyi audit satırı bırakmayan statü değişimi | **535 / 2.392 (%22,4)** | 0 | En büyük kova `SUBCONTRACTOR_CONSUMED` 335 | `BULGU-T2-029` | T2-029 |
| Fiziksel etiket basıldıktan sonraki kayıt yolu ateşle-unut | **2.557** olay (başarısız denemenin **hiç izi yok**) | 0 | Kaç kez düştüğü **ölçülemez** — bulgunun kendisi bu | `BULGU-T1-062` | T1-062 |
| Baskı ile print-event arası düzeltme sessizce "etiket güncel" sayılıyor | **1.534** pencere | 0 | Sayı yalnız pencerenin genişliğini gösterir; ayırt edici sorgu yazılmadı (kayıt notu) | `BULGU-T1-063` | T1-063 |

### 3.2 Sipariş / sevkiyat / iade / çuval / belge

| Ölçülen ihlal | Saha | Dev | Örnek kayıt | Bulgu | Sorgu |
|---|---:|---:|---|---|---|
| **Sevk edilen mal hiçbir sipariş satırına yazılmadı** | **7.200,6 m** (23 sevkiyatta); **hiç tahsis almayan 5 sevkiyat = 81 top · 3.040,2 m** | 1 | `SVK1708260002`, `SVK1808260001`, `SVK1908260002`, `SVK2008260001`, `SVK2008260005`; etkilenen kalemler `SIP1008260002/3/12/27/28/48`, `SIP1408260015` (hâlâ 0 sevk / 3.700 m açık) | `BULGU-T2-001` (**S1**) | `data/BULGU-T2-001.sql` |
| Sevk defterine (`SackAllocation`) **hiç audit yazılmıyor** | 0 satır | — | "Bu mal neden siparişten düşmedi" sorusu geriye izlenemiyor | `BULGU-T2-003` | `TUR2-V2-b1.sql` |
| Mutabakat kapısı kusuru **tanım gereği göremiyor** (denormu defterin kendisine karşı ölçüyor) | — | — | `consistency-check.sql §1/§2` | `BULGU-T2-004` | `TUR2-V2-b1.sql` |
| İade defteri "depoya alındı" diyor, top `CANCELLED` | **5 iade / 261 m** | — | `appliedStatus=WAREHOUSE` ↔ `rolls.status=CANCELLED` | `BULGU-T2-023` | `TUR2-V2-b2.sql` |
| Sevkiyat iptali/stornosunun kim-ne zaman-neden izi yok (`Shipment`'ta iptal kolonu yok) | **55** | 0 | Yalnız best-effort audit | `BULGU-T1-103` | T1-103 |
| İptal edilmiş iş emrine bağlı sipariş **hiç iptal edilemiyor** | **2 sipariş** (3 WO satırı) | — | `SIP0108260012`, `SIP2408260016` — kilitli | `BULGU-T2-005` | `TUR2-V2-b3.sql` |
| Sipariş iptalinde iş emirleri sipariş tx'inden ÖNCE iptal ediliyor | **19** | 0 | Sipariş açık kalır, iş emirleri ölür | `BULGU-T1-036` | T1-036 |
| Parti İzleme geri-izlemesi sevkiyat statüsünü süzmüyor | **12 top / 441,3 m** | 0 | `PLANNED\|WAREHOUSE` 12 top (parti `P98`) "müşteriye gitti" görünüyor | `BULGU-T1-079` | T1-079 |
| Sevk edilen çuvalların tartısı yok | **39 / 40** | — | İrsaliye/çeki listesi kg'yi **0** basıyor | `BULGU-T2-035` | `TUR2-V2-b2.sql` |
| Çeki listesi çuval metrajını `float +=` ile topluyor (kardeş uç `Decimal _sum`) | **16 / 39** çuval ayrışıyor | 0 | — | `BULGU-T1-153` | T1-153 |
| Kalite Sertifikası ile Sevk İrsaliyesi **aynı belge numarasını** taşıyor; `documentNo` üzerinde tekillik yok | — | 378 farklı kaynakta tekrar | — | `BULGU-T2-021` | `TUR2-V2-b3.sql` |
| Donmuş belge defteri kaynağına FK ile bağlı değil, yetim temizliği yok | — | **12.626 / 12.690 (%99,5) yetim** | Dev'de ölçüldü; yapısal risk üretimde de aynı | `BULGU-T2-021` | `TUR2-V2-b3.sql` |
| İade irsaliyesi numarası standart dışı ve SIRASIZ | **4** | — | Biçim `IADE-GGAAYY-<uuid[0:6]>` → boşluk/mükerrer denetimi imkânsız | `BULGU-T2-019` | `TUR2-V2-b2.sql` |
| Tolerans nedeniyle COMPLETED olan siparişin açık kalemi tüm talep yüzeylerinden düşüyor | **2** | 0 | — | `BULGU-T1-167` | T1-167 |
| Sipariş kalemi replace'i iptal/devredilmiş WO'nun sipariş bağını cascade ile siliyor | **3** | 0 | — | `BULGU-T1-100` | T1-100 |

### 3.3 Fason / iş emri / adım / parti / refakat kartı

| Ölçülen ihlal | Saha | Dev | Örnek kayıt | Bulgu | Sorgu |
|---|---:|---:|---|---|---|
| **Kurşun dağıtımı sahada fiilen kullanılmıyor** | **115 / 117** bypass kapanışı makine atfı OLMADAN | — | Marker `KURSUN_BYPASS_TAMBUR_COMPLETE_UNASSIGNED` 109 olay; `Kurşun` istasyonunda `createdMachineId` **0** | `BULGU-T2-026` | `T2-V3-sweep.sql` V3-31/V3-33 |
| Parti numarası sarması artık **istisna değil kural** | **61 numara / 122 parti** aynı anda canlı (156 canlı partinin %78'i) | 0 | En yakın çift 7,80 gün, ortalama 9,75 gün; 10 numara iki AÇIK fason sevkinde | `BULGU-T2-027`, `BULGU-T1-150` | `T2-V3-sweep.sql` V3-30b |
| Fason kabulünde `clientToken` her gönderimde yeniden üretiliyor | **2 / 143** makbuzda token var | 0 / 52 | Kısmi kabulün tek replay koruması fiilen kapalı | `BULGU-T2-007`, `BULGU-T1-005` | `T2-V3-sweep.sql` V3-15 |
| Fason çekme sapması deftere hiç yazılmamış | **2 makbuz** (19.08 öncesi) | 40 | `roll_variances` `SUBCONTRACTOR_RETURN` sahada **hiç yok** → karne o kabullerde %0 fire basıyor | `BULGU-T2-037` | `T2-V3-sweep.sql` V3-19 |
| Fason (EXTERNAL) adımda firma da kategori de NULL → mal fasona **gitmez** | **1** | 53 (fixture) | `IE2508260001` | `BULGU-T2-006` | `T2-V3-sweep.sql` V3-34 |
| Fason kabul makbuzunun "donmuş" belgesi sonradan yeniden kurulmuş | **6 / 7** `reconstructed=true` | — | Gecikme **5 güne kadar** | `BULGU-T2-022` | `TUR2-V2-b3.sql` |
| Refakat kartı `printedAt` kart **doğuşunda** damgalanıyor | **42** kart hiç basılmadan "Basım tarihi" taşıyor | 91 | 25.08'de doğan 4 kartın **hepsi** böyle | `BULGU-T2-024` | `T2-V3-sweep.sql` V3-26b |
| Refakat kartı sürüm defteri eksik | **15** kartta defter satırı yok (sürüm 2 olan 17 kartın 15'i) | — | Ayrıca sürüm boşluğu (min `version=2`) 2 kart | `BULGU-T2-020` | `TUR2-V2-b3.sql` |
| Refakat kartı sahada **karşılıksız** — kart hiç okutulmuyor | **149 / 213** kart "bayat" işaretli | — | 343 okutmanın hepsi **tek istasyonda**; `contentDirty` bayrağını okuyan yüzey yok | `BULGU-T2-038` | `T2-V3-sweep2.sql` V3-44/45/57 |
| `test_consistency §20` canlıda **kalıcı kırmızı** | **1** | 0 | `IE0608260004` adım 2 — hareketi hiç olmayan `COMPLETED` adım; kök neden 2026-08-15'te kapandı, bozuk satır düzeltilmedi | `BULGU-T2-025` | `T2-V3-s20.sql` |
| İptal/devredilmiş WO'da adımlar `SKIPPED` değil | **3** (Temmuz, kural 08-05'te geldi) | 4 | `IE2207260003/4`, `IE2807260001` — **bilgi** | — | `T2-V3-sweep.sql` V3-04 |
| `dispatchWithoutColor` ("fasona renksiz git") sahada **hiç kullanılmamış** | **0 / 635 adım · 0 / 7 rota adımı** | 0 | 2026-08-25'te yedi katmanda düzeltilen özellik sahada **henüz test edilmedi** | — | `T2-V3-sweep.sql` V3-21 |

### 3.4 Ana veri / yetki / ayarlar / audit

| Ölçülen ihlal | Saha | Dev | Örnek kayıt | Bulgu | Sorgu |
|---|---:|---:|---|---|---|
| Yetkiler `ops-sql` ile doğrudan DB'ye yazılmış (`tokenVersion++` atlanmış) | **24 / 353** satırda `grantedById` boş | 0 | Hepsi 2026-08-05 iki koşumdan; **`shipping:undo-dispatch` 6 kullanıcıda** | `BULGU-T2-012` | T2-012 |
| Görevler ayrılığı atamada yok | **6 / 8** aktif kullanıcı "sevk et + sevki geri al + metraj düzelt" üçlüsünü birlikte taşıyor | — | `adm***`, `Ahm***`, `Ber***`, `Eda***`, `Ene***`, `Sam***`; 3'ünde ayrıca `admin:*` | `BULGU-T1-043` | T1-043 |
| Bir izin hiçbir kullanıcıda yok | **1** | 0 | `mobile:kk1-yari-mamul` — ekran yalnız `mobile:*` taşıyan tek hesaptan açılabiliyor | `BULGU-T2-040` | T2-040 |
| Mobil rol şablonu `web` kategorili izin taşıyor | **1** | 0 | Sahadaki Tambur operatöründe `label-template:write` | `BULGU-T1-054` | T1-054 |
| Harf-katlanmış mükerrer stok kodu (DB kısıtı harf-duyarlı) | **8 grup / 9 fazla kayıt** | 8 | 2026-08-15 ölçümüyle **birebir aynı — 13 günde azalmamış**; biri iki tarafı da AKTİF ve gerçek stok taşıyor | `BULGU-T2-028` | T2-028 |
| Katlanmış ad mükerreri (partial UNIQUE **sahada yok**) | **1 grup** (`items`, `v-1430`) | 1 (`colors`, `beyaz`) | 2026-07-17'de **34 sn arayla** iki kayıt; ikisi de bugün pasif. Sed 17 tablonun yalnız 3'ünde, `items`'ta **YOK** | `BULGU-T2-009`, `BULGU-T1-066`, `BULGU-T1-007` | `T2-V5-06-namefold.sql` |
| Ana veri pasife alınırken bağımlılık kontrolü yok | **3** | 0 | 1 açık sipariş kalemi (**1.500 m**) + 2 canlı top (100'er m) pasif kumaşa bağlı | `BULGU-T2-010` | T2-010 |
| Birleştirme mezar taşı diriltilebiliyor (`mergedIntoId` FK'sı SET NULL) | **9** | 0 | Tombstone: `items` 6, `colors` 4, `subcontractors` 3, `customers` 0; **3'ünün** `nameFold`'u survivor'dan farklı → diriltme yolu gerçek veride açık | `BULGU-T1-035`, `BULGU-T1-047` | T1-047 |
| Birleştirme audit'i **fiziksel** tablo adına yazılıyor (`items`), diğer her yol mantıksal ada (`ITEM`) | **13** | 0 | En yıkıcı işlem Denetim Raporu'nda kayboluyor; kapsam bekçisi de kör | `BULGU-T2-011` | T2-011 |
| `duplicate_reviews` kararlarında karar veren kayıtlı değil | **13 / 13** `decidedById` NULL | — | Hepsi `MERGED` | `BULGU-T2-011` (dahil) | `tur2-V-4…md` kontrol listesi |
| Oturum/kilit ayarları kod varsayılanının **tersine** kapalı | **6** anahtar | 0 | Panelde yazan 8 saatlik oturum ömrü **etkisiz**; **214 oturumun 214'ünde** `expiresAt − createdAt = 720 saat (30 gün)`, 186'sı yedek anında hâlâ canlı | `BULGU-T2-030`, `BULGU-T1-051` | `tur2-V-4…md` §0.2 |
| 6 haneli PIN tek başına kimlik | **8 / 9** kullanıcıda PIN dolu, **3'ü yönetici** | 0 | `auth.loginMethods = {enabled:["list","pin"], primary:"pin"}` | `BULGU-T1-014` | `data/BULGU-T1-014.sql` |
| Cihaz kapısı fiilen kapalı | **28 / 28** cihaz APPROVED, **28 / 28** `machineId=NULL` | — | `device.pairingRequired=false`; 8 cihaz 20+ gündür görülmemiş, pasifleştirilmemiş | `BULGU-T1-113` bağlamı | `tur2-V-4…md` kontrol listesi |
| Tipsiz `PUT /api/admin/settings/:key` yolu sahada **fiilen kullanılmış** | **2** ayar | 0 | `order.defaultDeadlineDays="365"` ve `workorder.defaultPlanDurationDays="365"` DB'de **metin** olarak duruyor | `BULGU-T2-039`, `BULGU-T1-050` | `tur2-V-4…md` §0.3 |
| Ayarların yarısı DB'de hiç yok, kod varsayılanıyla koşuyor | **34 satır / 62 anahtar** | — | Satırı olmayan **üç** anahtarın varsayılanı **AÇIK** (`tambur.overQuantityEnabled`, `batch.shortNumberEnabled`, `fason.shrinkWarnEnabled`) | `BULGU-T2-039` bağlamı | `tur2-V-4…md` §0 |
| Script yolundan yapılan ana veri yazımı **aktörsüz** | **36** | 0 | Damgalar küme hâlinde (2026-08-25 04:41 ve 13:22-13:25) — insan tıklaması değil toplu koşum imzası | `BULGU-T1-127` | T1-127 |
| Audit'te kişisel veri | **40** satır (`CUSTOMER` 33 · `SUBCONTRACTOR` 7) `taxNumber/email/contactPerson` taşıyor | — | **PIN/şifre/kart kodu sızıntısı 0** (ölçüldü) | `BULGU-T1-119` | `tur2-V-4…md` kontrol listesi |
| Audit değiştirilemezliği kâğıt üstünde | **1** | 1 | `system_logs_userId_fkey … ON DELETE SET NULL` (şema/migration "RESTRICT" diyor); `teks.audit_guard` kopyada boş | `BULGU-T1-034` | T1-034 |
| İş kuralı reddi (4xx/409) hiçbir sayaçta/defterde yok | 40 günde **175.242 istek · 15 hata satırı · 0 adet 409 izi** | 0 | 15 `ERROR` satırının **tamamı** tek bir 500 (`print-event` bind hatası, `ef49bbc3` ile kapandı) | `BULGU-T2-014`, `BULGU-T1-126` | `endpoint_latency_daily` |
| `consistency-check.sql §12` ops sorgusu muafiyet listesini taşımıyor | **15** yanlış-pozitif satır | 7 | Dosyayı elle koşan "15 satır" görür, mekanik ikizi 0 der | `BULGU-T1-097` | `T2-V3-consistency-saha.txt` |
| Bekçi fixture'ları prod anlık görüntüsü üzerinde koşmuş | **63** audit satırı kirlenme penceresinde | 0 | Canlıda hâlâ **AKTİF bir TEST makinesi** 4 topa damga vurmuş (`Test-Makine-1`) | `BULGU-T2-031` | `tur2-V-4…md` V-4-09 |
| Bekçilerin koştuğu dev DB'si ana veride sahayla ayrışıyor | 9 kullanıcı (saha) | **72** (46'sı test artığı, **8 admin** — sahada 3) | 3 kodsuz izin şablonu | `BULGU-T2-032` | `tur2-V-4…md` V-4-10 |

### 3.5 Numara / zaman

| Ölçülen ihlal | Saha | Dev | Örnek / not | Bulgu | Sorgu |
|---|---:|---:|---|---|---|
| `finalizedAt` topun `createdAt`'inden **ÖNCE** | **955 / 2.431** (maks 0,697 sn) | 61 / 296 | İki saat kaynağı: `createdAt` uygulamadan, `finalizedAt` DB'nin `now()`'ından (tx BAŞLANGICI) | `BULGU-T2-034` | `T2-V5-05-roll-zaman.sql` |
| `statusChangedAt < createdAt` | **409** (maks 0,148 sn) | 100 | Aynı mekanizma | `BULGU-T2-034` | `T2-V5-05` |
| `updatedAt < statusChangedAt` | **49** (maks 0,009 sn) | 32 | Aynı mekanizma | `BULGU-T2-034` | `T2-V5-05` |
| **Fabrika GÜNÜ ayrışan** ters damga | **0** | — | Bugün etkisi yok; sınıf gerçek (gün sınırında dönem kaymasına açık) | `BULGU-T2-034` | `T2-V5-05` |
| `statusChangedAt` NULL | **39** | — | Trigger öncesi (2026-08-09) kayıtlar — **bilgi** | — | `tur2-V-1…md` V1-18 |
| Belge tarihi/saati süreç saat diliminden üretiliyor (belge no fabrika gününden) | **12** nokta | 0 | Bekçi bu deseni taramıyor | `BULGU-T1-098` | T1-098 |
| Dönem raporlarının çıpasını yazan trigger'ın **gövdesi** hiçbir bekçide doğrulanmıyor | **1** | 0 | Üretim ↔ dev fonksiyon gövdeleri **bayt-bayt farklı** (CRLF): `tr_fold`, `audit_block_tamper`, `roll_stamp_production_timestamps` | `BULGU-T2-033` | `T2-V5-07-cr.sql` |
| `ADD VALUE` migration'larının 10'unda `IF NOT EXISTS` yok; üretim şemasında **defter dışı bir enum değeri** ölçüldü | **1** | 0 | `ReasonPresetKind.WORK_ORDER_REWORK` var, migration satırı yok | `BULGU-T1-065` | `tur2-V-4…md` sınır ötesi |
| `GET /api/rolls` her gün 5-10 sn'lik kuyruk üretiyor | **32** istek 5 sn üstü (3'ü 10 sn üstü, maks 10.439 ms) | — | 2.431 satırlık tabloda; telemetri sebebini söylemiyor | `BULGU-T1-056` | `endpoint_latency_daily` |
| Kimlikli her istekte iki bağımsız sorgu | **≈112.598** istek / 40 gün | — | ~336.000 ek indeks seek; **etkisi ölçülemedi çünkü telemetri yok** | `BULGU-T1-163` | `endpoint_latency_daily` |
| Rapor katmanının tarih ekseni `orders` üzerinde indekssiz | **278** sipariş | — | Yedi rapor sorgusu `orderDate`/`completedAt` ile filtreliyor | `BULGU-T1-120` | T1-120 |
| Korelasyon kimliği tek yönlü (`requestId` yalnız audit satırında) | **229** | 0 | Yanıtta, log satırında ve hata gövdesinde yok | `BULGU-T1-128` | T1-128 |

---

## 4. TEMİZ ÇIKAN KONTROLLER — "arandı, 0 bulundu"

> Bunlar da denetimin çıktısıdır. Aşağıdaki her satır **koşuldu** ve **0 ihlal** döndürdü.
> Kaynak: `tur2-V-1…md` §1 (36 kontrol) · `tur2-V-2…md` "ARANDI, 0" (35 kontrol) ·
> `tur2-V-3…md` §0 + §2 (60+ kontrol) · `tur2-V-4…md` kontrol listesi ·
> `tur2-V-5…md` §1-§3.

### 4.1 Top / stok değişmezleri — sağlam

| Kontrol | Saha | Kaynak |
|---|---:|---|
| `currentQty < 0` ∨ `initialQty < 0` (DB CHECK `rolls_currentQty_nonneg`) | **0** | V1-01 |
| `WAREHOUSE`/`A1_STOCK` ⇒ barkod dolu | **0** | V1-08 |
| `SHIPPED` ⇒ çuval + sevkiyat bağlı (689 topun hepsi) | **0** | V1-09 |
| `CANCELLED` ama açık hareket | **0** | V1-11 |
| `IN_PRODUCTION` ama `currentStepId` NULL | **0** | V1-12 |
| `AT_SUBCONTRACTOR` ama açık fason sevki yok (188 topun hepsi bağlı) | **0** | V1-13, §15 |
| `createdAt > updatedAt` (91 tablonun tamamı) | **0** | V1-14, `T2-V5-04` |
| `entrySource ⇔ parentRollId` / `⇔ parentReceiptId` (1.040 + 149 top) | **0** | V1-19 |
| Kapanmış harekette `qtyOut ≠ qtyIn` (muaf desenler uygulandıktan sonra) | **0** | V1-21, §12 |
| Aynı top+adımda >1 açık hareket · aynı top >1 adımda açık | **0 / 0** | V1-22 |
| `exitedAt < enteredAt` · `qtyOut > qtyIn` · hareket yetimi | **0 / 0 / 0** | V1-23 |
| Sapma defteri: `qty ≤ 0` · `sourceRefId` yetimi · terslenmiş satır | **0 / 0 / 0** | V1-24 |
| Aynı (top, adım, tip) için >1 `roll_operation` (1.586 operasyon) | **0** | V1-25 |
| Açık `RollError` ama topu ölü (3 hata kaydının 3'ü işlenmiş) | **0** | V1-26, §17 |
| `TAMBUR_CONSUMED` ⇒ `currentQty=0` ∧ adım yok ∧ ≥1 çocuk (116 ebeveyn) | **0** | V1-06 |
| Tombstone partide top · biçim dışı parti no | **0 / 0** | V1-30 |
| Parti WO ≠ topun adım WO'su (parti cerrahisi tutarlı) | **0 / 0** | V1-29, V3-55 |

### 4.2 Sipariş / sevkiyat — çekirdek defter tutarlı

| Kontrol | Saha | Kaynak |
|---|---:|---|
| `OrderLine.shippedQty` = Σ tahsis(DISPATCHED) + Σ doğrudan sevk | **0** | V2-Q01 |
| `Order.shippedQty` = Σ `OrderLine.shippedQty` | **0** | V2-Q02 |
| Sevk > istenen (aşım) · sevk + PLANNED tahsis > istenen | **0 / 0** | V2-Q03/Q04 |
| `Order.status` türetilmiş değerden sapıyor (tolerans dahil) | **0** (235 APPROVED · 27 PARTIAL_SHIPPED · 12 COMPLETED · 4 CANCELLED) | V2-Q05 |
| `ShipmentOrder.isActive` ⇔ sevkiyat PLANNED (55 satırın 55'i) | **0** | V2-Q07 |
| PLANNED sevkiyat ama toplar SHIPPED · SHIPPED top hiçbir DISPATCHED sevkiyatta değil | **0 / 0** | V2-Q09/Q10 |
| `Roll.shipmentId` ≠ çuvalın `shipmentId` (composite FK) | **0** | V2-Q11 |
| Çuvalda karışık top statüsü · çuval tahsisi > brüt içerik | **0 / 0** | V2-Q13/Q14 |
| Aktif iade ama top hâlâ SHIPPED · aynı topa >1 aktif iade · iade > giriş metrajı | **0 / 0 / 0** | V2-Q16/Q17/Q18 |
| DISPATCHED ama donmuş irsaliye yok · aynı kaynakta >1 ACTIVE belge | **0 / 0** | V2-Q21/Q23 |
| Belge `snapshot` NULL/boş (328 satır, 6 belge türü) | **0** | V2-Q25 |
| **Brüt kuralı**: irsaliye snapshot metrajı = canlı içerik + aktif iade | **39 / 39 tutuyor** | V2-Q35 |
| **Storno**: tek storno vakasında beş kural birden doğru | ✔ | V2-Q45 |
| İptal edilmiş sipariş hâlâ PLANNED/DISPATCHED sevkiyat kümesinde | **0** | V2-Q34 |
| Tombstone müşteri hâlâ referanslı (sahada 0/27 tombstone müşteri) | **0** | V2-Q32 |

### 4.3 Numara sayaçları — repodaki en temiz mekanizma

| Kontrol | Saha | Kaynak |
|---|---:|---|
| 11 kod serisinde **mükerrer** (IE 213 · SIP 278 · FS 195 · FK 143 · CV 41 · SVK 40 · MUS 27 · OZL 7 · barkod T…H 1.236 / T…F 1.047 · kart IE 213) | **0** | `T2-V5-01` |
| Aynı serilerde **günlük sayaç boşluğu** (`LEAD()` ile) | **0** | `T2-V5-02` |
| Gün başı ilk sıra ≠ 1 olan gün | **0** | V2-Q30 |
| Belge no'nun günü ≠ kaydın **İstanbul** günü (TZ kayması) | **1** — ve o da tasarım gereği (`T080826F0001`, fason dönüşü topu barkodsuz doğar) | `T2-V5-03` |
| Hiçbir kodun **UTC gününe** düşmesi | **0 / 3.343** | `T2-V5-03` |
| Barkod sayacı ↔ gerçek barkodlar: 38 sayaç satırı, `Σn = 2.283` = barkodlu top sayısı, FULL JOIN'de **tek satır bile ayrışmıyor** | **0** | `tur2-V-5…md` §1.2 |
| 4 hane (NNNN) tavanına yakınlık — en yoğun gün kapasitenin **%2,62**'si | risk yok | `tur2-V-5…md` §1.3 |
| `clientEnteredAt` kelepçesi (`[-36 saat, +5 dk]`) dışına çıkan damga | **0 / 1.097** (tablet saatleri sunucudan en fazla **5,47 sn** sapıyor) | `tur2-V-5…md` §2.3 |
| Gelecek tarihli `createdAt`/`updatedAt` (91 tablo) | **0 / 0** | `T2-V5-12` |

### 4.4 İş emri / adım / rota / fason — 30+ kontrol temiz

| Kontrol | Saha | Kaynak |
|---|---:|---|
| Hazır mutabakat kapıları `§1–§11`, `§14–§19` (`consistency-check.sql`) | **0** | `T2-V3-consistency-saha.txt` |
| Türetilmiş kapılar `§21`, `§22`, `§23`, `§24a/b`, `§25`, `§26b` | **0** | `T2-V3-derived-saha.txt` |
| WO tipi ↔ sipariş bağı aynası (`ORDER_PRODUCTION` bağsız / `STOCK` bağlı) | **0 / 0** | V3-01/02 |
| `COMPLETED` WO ama ACTIVE/PENDING adım · terminal WO adımında canlı top | **0 / 0** | V3-03/05 |
| Adımsız WO · adım sırası 1..n değil · `workOrderNumber` biçim dışı | **0 / 0 / 0** | V3-07/08/36 |
| Rota kapsaması: hedef rengi/özelliği olan canlı WO ama veren adım yok | **0 / 0** | V3-22/23 |
| WO `clientToken` mükerreri (213/213 tekil) | **0** | V3-37 |
| "Giriş noktası" kuralı — aşağıdan katılan top yukarı adımı bekletiyor mu | **0 sapma** | V3-38 |
| Fason: açık sevk kalemi ↔ top statüsü · kalem kapanışı ↔ top · `Σ receivedQty > dispatchedQty` | **0 / 0 / 0** | V3-10/11/12 |
| Fason: bir kaleme >1 aktif TAM makbuz · `remainderClosedAt` ↔ top statüsü | **0 / 0** | V3-13/16 |
| Fason: iptal edilmiş sevkin kalemi ↔ top · iptal makbuzdan doğan çocuk hâlâ canlı | **0 / 0** | V3-17/18 |
| Fason: sevkin partisi başka WO'ya ait · `sourceDispatchItemId` NULL kalem (0/638) | **0 / 0** | V3-20/52 |
| Pasif/tombstone fason firmaya açık sevk · makbuz adımı ≠ sevk adımı | **0 / 0** | V3-49/50 |
| WO başına kart sayısı ≠ 1 · kart durumu ≠ WO durumu · kart `snapshot` NULL | **0 / 0 / 0** | V3-24/25/27 |
| WO'suz parti · aynı WO'da aynı numaralı iki parti · kısa parti sayacı kopuk | **0 / 0 / 0** | V3-28/54/30 |
| Açık bypass ataması ama adım COMPLETED/SKIPPED · sahibi WO terminal | **0 / 0** | V3-53, §23 |
| Son 30 günde **pasif makineye** bağlı yeni top | **0** | V3-33b |

### 4.5 Ana veri / yetki / güvenlik — sağlam çıkanlar

| Kontrol | Saha | Kaynak |
|---|---:|---|
| **`nameFold` kolonları veriyle %100 tutarlı** — 17 tabloda `nameFold IS DISTINCT FROM tr_fold(name)` | **0** | `T2-V5-06` |
| Birleştirme zinciri / döngü / kendine-merge / aktif kalmış tombstone / canlı satırdan tombstone'a referans (13 birleştirme) | **0 / 0 / 0 / 0 / 0** | `tur2-V-4…md` |
| İzin kataloğu ↔ DB aynası | **70 / 70 birebir** | `tur2-V-4…md` |
| Rol şablonu kataloğu ↔ DB (izin kümeleri dahil) | **26 / 26 birebir** | `tur2-V-4…md` |
| Stok kodu sayaç boşluğu (`STK-000001…000019`) | **0** (19/19 boşluksuz) | `tur2-V-4…md` |
| Şifre saklama biçimi | **9 / 9** `$2b$10$` bcrypt; düz/zayıf hash **0** | `tur2-V-4…md` |
| Audit'te şifre/PIN/kart kodu sızıntısı | **0** | `tur2-V-4…md` |
| Pasif kullanıcının aktif oturumu | **0** | `tur2-V-4…md` |
| `user_permissions` / `sessions` yetim satır · bilinmeyen cihazlı oturum | **0 / 0 / 0** | `tur2-V-4…md` |
| Kalite kataloğu doğru (`1.KALITE`→WAREHOUSE · `A1`→WAREHOUSE · `FIRE`→**SCRAP** + `skipLabel`) | ihlal **0** | `tur2-V-4…md` |
| `reason_presets` kind başına kod tekilliği · son aktif satır gizlenmiş | **0 / 0** (29/29 sistem satırı aktif) | `tur2-V-4…md` |
| Bilinmeyen / katalog dışı ayar anahtarı | **0** | `tur2-V-4…md` §0 |
| Partial unique'lerin doğru kurulumu (`label_templates_one_default_per_kind`, `traveler_card_templates_isDefault_key`, `label_template_variants_one_primary`) | ihlal **0** | `tur2-V-4…md` |
| Kayıt üzerinde 5 sn içinde **iki farklı kullanıcı** yazması (kayıp-güncelleme izi) | **0** | `T2-V5-08` |
| Havuz zaman aşımı audit satırı · 503 izi (40 gün) | **0 / 0** | `endpoint_latency_daily` |
| CHECK/UNIQUE/EXCLUDE kısıt sayısı üretim ↔ dev | **27 = 27, fark 0** | `tur2-V-5…md` §3 |
| Trigger tanımı üretim ↔ dev (md5) | **3 = 3, fark 0** | `tur2-V-5…md` §3 |
| Metin kolonlarında CRLF sızıntısı (tüm text kolonlar tarandı) | **0** (yalnız `peripheral_devices.terminator` — meşru seri port sonlandırıcı) | `T2-V5-07` |

### 4.6 "Ölçüldü, ihlal değil" — yanlış alarma çevrilmemesi gerekenler

| Gözlem | Saha | Neden ihlal değil |
|---|---:|---|
| `currentQty > initialQty` 2 satır | 2 | CLAUDE.md 2026-08-22 kararı: **bilinçli bırakıldı** (toplu UPDATE kök nedeni gizler). Yine de bugün canlı listelerde yanlış rakam basıyor → `BULGU-T1-044` |
| `qualityGrade.targetStatus ≠ status` 4 satır | 4 | 2026-08-20 "fire çöpe gider" kararından **ÖNCEKİ** kayıtlar (`FIRE → WAREHOUSE`) |
| Mükerrer ham giriş adayı 26 çift | 26 | 1,4–4,3 sn aralıklı, aynı partiden eşit metrajlı toplar → tekstilde **meşru seri giriş**; tuzağın "engelleme değil onaylatma" tasarımını doğruluyor |
| Boş çuval 2 adet | 2 | `CV0308260001` / `CV1607260001` — içerik sevkten sonra iade edildi, brüt kural gereği çuval kabuğu kalır |
| `WorkOrderStep §20` sapması 1 satır | 1 | Adımın tek topu sonradan iptal edilince `COMPLETED` adım `PENDING` gibi görünür — **sorgunun kör noktası**, veri bozuk değil (ama satır bugün de duruyor: `BULGU-T2-025`) |
| `system_log_archives` 0 satır | 0 | Sistem 2026-07-16'da kuruldu → kesitte **40 günlük** veri var, arşiv eşiği **ay** cinsinden. Boş olması **beklenen**; `audit.lastArchiveAt=2026-08-16` işin koştuğunu ama taşıyacak satır bulamadığını gösteriyor |
| `LABEL_PRINT_EVENT` 35 birebir mükerreri | 35 | İstemci print-event'i iki kez ateşliyor; sonucu `labelPrintedAt`'in iki kez yazılması (zararsız) + "kaç etiket bastık" sayımının şişmesi |
| Aynı milisaniyede doğan 6 top | 6 | Tek fason kabul transaction'ının `createMany`'si — eşzamanlılık **değil** |

---

## 5. İHLALLERİN YAŞ DAĞILIMI VE BÜYÜME EĞİLİMİ

### 5.1 Ölçümün penceresi

Yaş analizi **40 günle sınırlıdır**: sistem 2026-07-16'da kuruldu (`rolls`, `orders`, `users`,
`system_logs` minimum tarihleri aynı gün), kopya 2026-08-25 kesitinde. Bundan uzun bir eğilim
çıkarılamaz. Audit defteri de aynı 40 günü kapsar (10.485 satır) ve arşivlenmemiştir.

### 5.2 Hâlâ üretilen ihlaller (ölçülmüş kanıtla)

| İhlal | Kanıt: hâlâ üretiliyor | Bulgu |
|---|---|---|
| **İptal izi eksikliği** | Gün kırılımı **kesintisiz**: 05.08 (22/22) → 08.08 (15/18) → 14.08 (9/9) → 17.08 (15/16) → 18.08 (17/20) → 19.08 (7/7) → 20.08 (7/8) → 21.08 (1/1). İz kolonları **2026-08-05'ten beri var** olduğu hâlde boş kalmaya devam ediyor | `BULGU-T1-033` |
| **Sevk ↔ sipariş defteri açığı** | Tahsis almayan 5 sevkiyatın **hepsi son 8 güne** ait: `SVK1708260002` (17.08), `SVK1808260001` (18.08), `SVK1908260002` (19.08), `SVK2008260001` + `SVK2008260005` (20.08). Kusur **hızlanıyor** | `BULGU-T2-001` |
| **Refakat kartı `printedAt` yalanı** | **25.08'de doğan 4 kartın 4'ü de** hiç basılmadan basım tarihi taşıyor — kesim gününe kadar sürüyor | `BULGU-T2-024` |
| **Harf-katlanmış mükerrer stok kodu** | 2026-08-15'te 8 grup ölçülmüştü; 2026-08-28'de **yine 8 grup** — 13 günde **ne azaldı ne arttı**, temizlenmedi | `BULGU-T2-028` |
| **Parti numarası çakışması** | Yapısal ve süreklidir: ~10 parti/gün doğuyor, `P01…P99` **~10 günde sarıyor**, partiler 2+ hafta canlı kalıyor → çakışan çift sayısı zamanla artar (ölçülen: 61 numara / 122 parti) | `BULGU-T2-027` |
| **Kurşun bypass makinesizliği** | 117 kapanışın 115'i; `Kurşun` istasyonunda `createdMachineId` **0 / 2.196** — özellik açıldığından beri **hiç** makine atfı yazılmadı | `BULGU-T2-026` |
| **Etiket kayıt yolu** | 2.557 `LABEL_PRINT_EVENT` olayı üretimin ana akışı; başarısız denemelerin izi olmadığı için **düşüş oranı ölçülemiyor** — ihlal görünmez ama akış canlı | `BULGU-T1-062` |

### 5.3 Kapanmış ya da tek seferlik olanlar

| İhlal | Yaş / durum | Bulgu |
|---|---|---|
| **`currentQty > initialQty`** | Kod **2026-08-10'da düzeltildi**. İki ihlal satırı 2026-08-08 ve **2026-08-11** — yani ikincisi düzeltmeden **1 gün SONRA**. Bulgu "kod hatalı" değil: **DB seddi ve alarm olmadığı için düzeltilmiş bir hata iki hafta daha canlıda ihlal üretti ve fark edilmedi**. İkisi de hâlâ `IN_PRODUCTION` | `BULGU-T1-044` |
| **Yetkilerin ops-sql ile yazılması** | 24 satırın hepsi **tek gün** (2026-08-05, iki koşum). Tekrarlanmadı — ama izi kalıcı: `grantedById` boş, `tokenVersion` artmamış | `BULGU-T2-012` |
| **Ad mükerreri (`items` `v-1430`)** | 2026-07-17'de **34 sn arayla** iki kayıt; guard o tarihte henüz yoktu. İkisi de bugün pasif — ama partial UNIQUE **hâlâ kurulamıyor** (yumuşak kapı atlıyor) | `BULGU-T2-009`, `BULGU-T1-066` |
| **`print-event` 500 hatası** | 15 `ERROR` satırının **tamamı**; 2026-08-05…08-06 arasında, `ef49bbc3` ile **kapandı**. 40 günün geri kalanında tek 5xx yok | — |
| **Damgasız final toplar** | 4'ü de **08.08** tarihli; onarım scripti (`backfill_roll_production_timestamps`) sahada **hiç koşmamış** → satırlar duruyor ama yeni üretilmiyor | `BULGU-T2-017` |
| **Kapanmış dönem değişimi** | `T200726F0002/0003/0005/0006` — Temmuz'da finalize, Ağustos'ta ölü kümeye geçti. Aynı-ay içi geçişler (87 top / 6.084,2 m) **sürüyor**; dönemler arası geçiş bugüne kadar 4 kez oldu | `BULGU-T2-018` |
| **Fason çekme defteri boşluğu** | 2 makbuz, **hepsi 19.08 öncesi** — sapma defteri kuralı 2026-08-19'da geldi. Sonrasında ihlal yok | `BULGU-T2-037` |
| **İptal/devredilmiş WO'da adım `SKIPPED` değil** | 3 satır, hepsi **Temmuz** (`IE2207260003/4`, `IE2807260001`); kural 2026-08-05'te geldi. Sonrasında 0 | — |

### 5.4 Henüz doğmamış ama mekanizması açık

| Ölçüm | Saha | Anlamı |
|---|---:|---|
| `roll_plan_deviations` | **0 satır** | Kapı 2026-08-19'da geldi; 507 kesimde sapma **olmamış** — defter boş çünkü sapma yok, çünkü kapı çalışmıyor değil |
| `dispatchWithoutColor` | **0 / 635 adım** | 2026-08-25'te yedi katmanda düzeltilen özellik sahada **hiç kullanılmadı** |
| `A1_STOCK` · `SEMI_FINISHED` · kartela · doğrudan sevk · şube | **0 / 0 / 0 / 0 / 0** | Beş akış üretimde **hiç çalışmadı** — ilk kullanımda o kod yolları **ilk kez** koşacak |
| `WAREHOUSE → SCRAP` (Fire ucu) | **0 geçiş** | Uç 2026-08-25'te açıldı; trigger'ın kaynak listesinde bu geçiş **yok** → ilk fire kaydında damga sessizce yazılmayacak (`BULGU-T1-032`) |
| `preTamburCloseStatus` kolonu | **0 / 116 dolu** | `finalizeWarehouseCut` yolu sahada **hiç** kullanılmamış |
| İptal edilmiş kaydın `clientToken`'ı ile replay | **227** iptal/fire top token taşıyor | Replay yüzeyi açık; ihlal henüz doğmadı (`BULGU-T1-006`) |

---

## 6. FABRİKANIN BUGÜN KOŞMASI GEREKEN SORGULAR

> **Nasıl koşulur:** `audit/tools/sql-saha.sh -c "<sorgu>"` kalıbıyla — oturum
> `default_transaction_read_only=on` ile açılır, hiçbir sorgu veri yazamaz.
> **Canlı üretimde** aynı disiplinle koşulmalı (`SET default_transaction_read_only=on;` önce).
> "Kopya" sütunu = 2026-08-25 kesitinde ölçülen değer; **canlıdaki sayı bundan büyükse ihlal
> büyümüş demektir.**

### K-1 · Hiç sipariş defteri yazılmamış sevkiyat — **en kritik**

```sql
SELECT sh."shipmentNo", sh."dispatchedAt",
       (SELECT COALESCE(sum(r."currentQty"),0) FROM rolls r
          JOIN sacks s2 ON s2.id = r."sackId" WHERE s2."shipmentId" = sh.id) AS icerik_m
FROM shipments sh
WHERE sh.status = 'DISPATCHED'
  AND NOT EXISTS (SELECT 1 FROM sack_allocations sa
                    JOIN sacks s3 ON s3.id = sa."sackId"
                   WHERE s3."shipmentId" = sh.id)
ORDER BY sh."dispatchedAt" DESC;
```
**Eşik: 0 satır.** Kopyada **5 satır** (81 top · 3.040,2 m). Çıkan her satır = müşteriye gitmiş
ama siparişten düşmemiş mal. → `BULGU-T2-001`

### K-2 · Sevk ↔ sipariş defteri toplam açığı

```sql
SELECT round(sum(icerik) - sum(tahsis), 3) AS defter_disi_metre
FROM (
  SELECT (SELECT COALESCE(sum(r."currentQty"),0) FROM rolls r
            JOIN sacks s2 ON s2.id = r."sackId" WHERE s2."shipmentId" = sh.id) AS icerik,
         (SELECT COALESCE(sum(sa.qty),0) FROM sack_allocations sa
            JOIN sacks s3 ON s3.id = sa."sackId" WHERE s3."shipmentId" = sh.id) AS tahsis
  FROM shipments sh WHERE sh.status = 'DISPATCHED'
) t;
```
**Eşik: 0 m.** Kopyada **7.152,6 m** (içerik 27.611,8 ↔ tahsis 20.459,2). → `BULGU-T2-001`

### K-3 · Metrajı giriş metrajını aşan top

```sql
SELECT id, barcode, "initialQty", "currentQty", status, "entrySource", "createdAt"::date
FROM rolls WHERE "currentQty" > "initialQty" ORDER BY "createdAt";
```
**Eşik: en fazla 2 satır** (kopyadaki iki bilinen kayıt: 2026-08-08 ve 2026-08-11, ikisi de
`IN_PRODUCTION`). **3. satır çıkarsa** kod düzeltmesi delinmiş demektir. → `BULGU-T1-044`, `BULGU-T3-011`

### K-4 · Giriş metrajı sıfırlanmış ebeveyn top (kesim aritmetiği bozulur)

```sql
SELECT p.barcode, p.status, p."initialQty", count(c.*) AS cocuk,
       round(sum(c."initialQty"),3) AS cocuk_toplam_m
FROM rolls p JOIN rolls c ON c."parentRollId" = p.id
WHERE p."initialQty" = 0
GROUP BY 1,2,3 ORDER BY 5 DESC;
```
**Eşik: en fazla 8 satır** (kopyadaki bilinen soyağaçları). Artarsa depo kesimi yeni izsiz metraj
üretiyor demektir. → `BULGU-T2-016`

### K-5 · Canlı statüde sıfır metrajlı hayalet top

```sql
SELECT id, barcode, status, "entrySource", "createdAt", "updatedAt"
FROM rolls WHERE status IN ('WAREHOUSE','A1_STOCK','STOCK') AND "currentQty" = 0;
```
**Eşik: 0 satır.** Kopyada **2** (`T190826F0119`, `T190826F0120`). Depoda görünen ama içi boş
raf kaydı. → `BULGU-T1-039`

### K-6 · Hiçbir dönem karnesine girmeyen final top

```sql
SELECT id, barcode, status, "currentQty", "createdAt"::date
FROM rolls
WHERE status IN ('WAREHOUSE','A1_STOCK','SCRAP') AND "finalizedAt" IS NULL
ORDER BY "createdAt";
```
**Eşik: 0 satır.** Kopyada **4 top / 359 m** (biri 300 m'lik tek fire kaydı). Çıkan her satır
Kalite ve Fire Karnesi'nde **görünmeyen** üretimdir. → `BULGU-T2-017`, `BULGU-T1-032`

### K-7 · İptal izi olmayan iptaller

```sql
SELECT count(*) AS iptal_toplam,
       count(*) FILTER (WHERE "cancelledAt"      IS NULL) AS tarihsiz,
       count(*) FILTER (WHERE "preCancelStatus"  IS NULL) AS onceki_rafi_bilinmeyen,
       count(*) FILTER (WHERE "cancelReasonCode" IS NULL) AS sebep_kodsuz
FROM rolls WHERE status = 'CANCELLED';
```
**Eşik: üç sayaç da 0.** Kopyada 230 iptalde **134 / 134 / 230**. `onceki_rafi_bilinmeyen`
sayısı doğrudan "İptali Geri Al" dediğinizde **yanlış rafa dönecek** top sayısıdır. → `BULGU-T1-033`

### K-8 · İade defteri ↔ topun gerçek durumu çelişkisi

```sql
SELECT rr.id, r.barcode, rr."appliedStatus", r.status, rr.qty, rr."createdAt"::date
FROM roll_returns rr JOIN rolls r ON r.id = rr."rollId"
WHERE rr."cancelledAt" IS NULL
  AND rr."appliedStatus" IS DISTINCT FROM r.status;
```
**Eşik: 0 satır.** Kopyada **5 iade / 261 m** — defter "depoya alındı" diyor, top `CANCELLED`.
Mal ne stokta ne fire raporunda. → `BULGU-T2-023`

### K-9 · Pasife alınmış kumaşa bağlı canlı kayıt

```sql
SELECT 'siparis_kalemi' AS tur, i.code, i.name, ol.quantity AS metre
FROM order_lines ol JOIN items i ON i.id = ol."itemId"
JOIN orders o ON o.id = ol."orderId"
WHERE NOT i."isActive" AND o.status IN ('PENDING','APPROVED','PARTIAL_SHIPPED')
UNION ALL
SELECT 'canli_top', i.code, i.name, r."currentQty"
FROM rolls r JOIN items i ON i.id = r."itemId"
WHERE NOT i."isActive"
  AND r.status IN ('STOCK','IN_PRODUCTION','WAREHOUSE','A1_STOCK','AT_SUBCONTRACTOR');
```
**Eşik: 0 satır.** Kopyada **3** (1 açık kalem **1.500 m** + 2 canlı top 100'er m). Pasif kumaş
seçicilerde çıkmaz → o siparişe yeni iş emri açılamaz. → `BULGU-T2-010`

### K-10 · Harf farkıyla mükerrer stok kodu

```sql
SELECT lower(code) AS katlanmis_kod, count(*), string_agg(code || ' / ' || name, ' | ')
FROM items WHERE "mergedIntoId" IS NULL
GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC;
```
**Eşik: 0 satır.** Kopyada **8 grup / 9 fazla kayıt** — 2026-08-15 ölçümüyle **birebir aynı,
13 günde temizlenmemiş**. Birinde iki taraf da AKTİF ve gerçek stok taşıyor. → `BULGU-T2-028`

### K-11 · Mükerrer katlanmış ad (DB seddi kurulamıyor)

```sql
SELECT "nameFold", count(*), string_agg(name || ' (' || CASE WHEN "isActive" THEN 'aktif' ELSE 'pasif' END || ')', ' | ')
FROM items WHERE "mergedIntoId" IS NULL AND "nameFold" IS NOT NULL
GROUP BY 1 HAVING count(*) > 1;
-- Sed kurulu mu:
SELECT to_regclass('items_nameFold_key') AS items_seddi;   -- NULL ise sed YOK
```
**Eşik: birinci sorgu 0 satır, ikinci sorgu NULL DÖNMEMELİ.** Kopyada 1 grup (`v-1430`) ve
`items_nameFold_key` **YOK** — yumuşak kapı mükerrer yüzünden index'i atlıyor. Grup temizlenince
aynı migration yeniden koşulup sed kurulmalı. → `BULGU-T2-009`, `BULGU-T1-066`

### K-12 · Panel dışından verilmiş yetki (ops-sql izi)

```sql
SELECT u.username, p.code AS izin, up."createdAt"
FROM user_permissions up
JOIN users u ON u.id = up."userId"
JOIN permissions p ON p.id = up."permissionId"
WHERE up."grantedById" IS NULL
ORDER BY up."createdAt" DESC;
```
**Eşik: kopyadaki 24 satırdan fazlası çıkmamalı.** Yeni satır = servis katmanı atlanarak
doğrudan DB'ye yazılmış yetki demektir; o kullanıcının `tokenVersion`'ı artmadığı için
**eski token'ı hâlâ geçerlidir**. Özellikle `shipping:undo-dispatch` satırlarına bakın
(kopyada 6 kullanıcıda). → `BULGU-T2-012`

---

## 7. BU BÖLÜMÜN KENDİ SINIRLARI

1. **Bütün sayılar 2026-08-25 kesitinden.** Canlı üretime erişim yoktu; 08-25 → 08-28 arası
   üç günün verisi hiç görülmedi (`00-map/ERISILEMEYEN.md:14-15`).
2. **Kopya saf değil.** 2026-08-25 02:38 sonrası yazımlar geliştirme kaynaklı olabilir; iki
   denetçi iki farklı kesim eşiği kullandı (§1.2).
3. **Son 5 migration'ın kolonları kopyada yok** → sipariş/kalem iptali eksenindeki üç kontrol
   yalnız dev'de (0 satır) yapılabildi. Canlıda bu kolonlar deploy edildiyse oradaki durum
   bilinmiyor.
4. **Beş akış hiç çalışmadı** (şube · doğrudan fason sevk · kartela · `A1_STOCK` · yarı mamul):
   o kod yolları hakkında yalnızca kod okuması var, veri kanıtı **yok**.
5. **`BULGU-T2-001`'in kesin mekanizması kanıtlanamadı.** Fiili ihlal tartışmasız (K2), beş
   karşı-hipotez ölçümle elendi; ama tahsis anındaki `shippedQty` ve çuval içeriği hiçbir yerde
   saklanmadığı ve `SackAllocation` audit'e hiç girmediği için "birebir eşleşen kaleme neden 0
   yazıldı" sorusunun tek satırlık cevabı bulunamadı (`tur2-V-2…md` KAPSANMAYAN §1).
6. **Dev DB'nin sayıları üretim ihlali olarak sayılmadı.** Dev ağır test kalıntılıdır
   (549/762 iş emri test önekli, 12.626 yetim belge, 72 kullanıcının 46'sı artık); dev rakamları
   yalnız **yapısal riski** göstermek için kullanıldı.
7. **`BULGU-T1-063`'ün 1.534 rakamı kanıt değildir** — `updatedAt` gerçek "hareket" demek
   değildir (CLAUDE.md 2026-07-30). Sayı yalnız pencerenin genişliğini gösterir; ayırt edici
   sorgu (`LABEL_PRINT_EVENT` ↔ `ROLL_MANUAL_OVERRIDE` eşleştirmesi) bu turda yazılmadı.
