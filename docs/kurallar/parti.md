# Parti (Batch)

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 5 üye, ama bu kümenin SAHİBİ tek not: R:2026-07-13 (İş Emri No ≠ Parti). Diğer dördü başka kümelerde primary (2026-07-14 + 2026-08-05 → refakat-karti, 2026-08-14 → finans-saglamlik, E:undated print-merge → superadmin) — onların parti-dışı kuralları orada işlenir, burada tekrarlanmadı. Sahip not BAYAT DEĞİL ama İÇİNDE ezilme taşıyor: 2026-08-05 alt maddesi hem varsayılan biçimi (P+GGAAYY+SIRA → P01…P99) hem yarış korumasını (@unique → advisory 8022) değiştirdi; gövde cümlesi ⚠️ ile düzeltilmiş. En riskli nokta çelişki değil BAYAT ŞEMA YORUMU: schema.prisma:2537 hâlâ 'refakat kartı parti başına' diyor, oysa TravelerCard.workOrderId @unique (3467) ve 3459-3462 tersini söylüyor.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** `generateBatchNumberTx`'in İLK ifadesi `pg_advisory_xact_lock(8022, 1)` olmalı — okumalardan önce. Sonraya alınırsa TOCTOU açılır ve aynı gün doğan iki parti sessizce aynı kodu alır (hata yok, log yok). · bekçi: `scripts/test_batch_number_format.ts §2 ('Kilit: alınıyor mu ve İLK mi?', iki rej` <sub>(CLAUDE.md:161)</sub>
- **[ÇEKİRDEK]** Advisory uzay 8022 parti no üretecine aittir ve KK1 mükerrer guard'ının 8021'inden AYRI tutulur; iki alt sistem birbirini sessizce serileştirmemeli. Uzay envanteri `helpers/period-guard.helper.ts` başlığında. · bekçi: `scripts/test_batch_number_format.ts §2 (BATCH_NUMBER_LOCK_NS !== DUPLICATE_GUARD` <sub>(CLAUDE.md:161)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Partinin KİMLİĞİ yalnız `Batch.id`'dir — hiçbir yerde `batchNumber` ile lookup YAPMA (findUnique/findFirst dahil). Numara benzersiz değildir; aynı numarayı yıllar içinde onlarca parti alır. · bekçi: `yok (kimlik tarafı); kısıtın kalktığını scripts/test_batch_number_format.ts §6 c` <sub>(CLAUDE.md:161)</sub>
- **[ÇEKİRDEK]** `batches.batchNumber` üzerinde `@unique` YOKTUR ve GERİ KONMAZ (migration 20260805120000_batch_short_number). Kısıt geri gelirse sarma ilk tekrarda 500 verir ve üretim durur. · bekçi: `scripts/test_batch_number_format.ts §6 (pg_indexes taraması)` <sub>(CLAUDE.md:161)</sub>

### Kararlar

- **[PROFİL]** Parti no biçimi PROFİL kararıdır: `batch.shortNumberEnabled` AÇIK (varsayılan; kayıt yoksa true) → `P01…P99`, P99'dan sonra KÖRLEMESİNE `P01`'e sarar (numara canlı mı diye BAKILMAZ); KAPALI → `P+GGAAYY+günlük sıra`. · bekçi: `scripts/test_batch_number_format.ts §1/§3 (iki rejim + sarma aritmetiği)` <sub>(CLAUDE.md:161)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Sayaç SAKLANMAZ, veriden türetilir: en son doğan KISA parti (`createdAt DESC LIMIT 1`, destek index `batches_createdAt_idx`). Ayar değişimi mevcut numaraları yeniden hesaplamaz; bayrak kapatılıp açılınca sayaç kaldığı yerden devam eder. · bekçi: `scripts/test_batch_number_format.ts §6 (batches_createdAt_idx VAR)` <sub>(CLAUDE.md:161)</sub>
- **[ÇEKİRDEK]** `GET /api/batches/number-state`'in 'sıradaki' değeri ÖNİZLEMEDİR, rezervasyon DEĞİL — kilit dışında okunur, arada parti doğarsa gerçekleşen numara farklı olur. Yüzey bunu 'ayrılmış' diye sunmaz. <sub>(CLAUDE.md:161)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Sayaç sorgusunun regex'i `^P(0[1-9]|[1-9][0-9])$` LOAD-BEARING: gevşerse eski günlük kodlar sızar, parse null döner ve sayaç her seferinde P01'e düşer (canlı P01 dururken ikinci P01 doğar). · bekçi: `scripts/test_batch_number_format.ts §1 (SQL süzgeci gevşeyince 2 kırmızı — negat` <sub>(CLAUDE.md:161)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-07-13__is-emri-no-parti-2026-07 (2026-07-13 gövde)` → `R:2026-07-13__is-emri-no-parti-2026-07 (2026-08-05 alt maddesi)`: Varsayılan parti no biçimi değişti: eskiden tek biçim `P+GGAAYY+SIRA` idi, artık `batch.shortNumberEnabled` (varsayılan AÇIK) ile `P01…P99` kısa/dönen/benzersiz-DEĞİL biçim üretilir; günlük kalıp yalnız bayrak KAPALIYKEN koşar. Kod iki rejimi tek kapıda taşıyor. ✅ çürütmeden geçti
- **TAM** `R:2026-07-13__is-emri-no-parti-2026-07 (yarış koruması: `@unique` + withBarcodeRetry/P2002)` → `R:2026-07-13__is-emri-no-parti-2026-07 (2026-08-05: advisory kilit 8022)`: `batches.batchNumber` üzerindeki `@unique` migration 20260805120000_batch_short_number ile KALDIRILDI; eski yarış koruması (P2002 → tekrar dene) düştü, yerini `generateBatchNumberTx`'in İLK ifadesi `pg_advisory_xact_lock(8022,1)` aldı ve bu kilit HER İKİ rejimi de kapsıyor. ✅ çürütmeden geçti
- **KISMI** `R:2026-07-13__is-emri-no-parti-2026-07 (günlük parti no 4 hane dolgulu, 9999/gün tavanı)` → `R:2026-07-13__is-emri-no-parti-2026-07 (2026-08-05: dolgusuz, hane serbest)`: Bayrak kapalı rejimde parti no artık zero-pad taşımaz ve hane serbesttir (P0508261 → P05082619 → P050826123); 2026-08-05 öncesi dolgulu kayıtlar (P0508260019) OLDUĞU GİBİ durur, geriye dönük düzeltme yapılmaz. Diğer kodlar (SIP/İE/CV/RK/FS) 4 hane dolgulu KALIR. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:2026-07-13__is-emri-no-parti-2026-07 (2026-08-05 dolgusuzluk alt maddesi)` ↔ `R:2026-07-13__is-emri-no-parti-2026-07 (kısa biçim alt maddesi)`: Çelişki değil, REJİM AYRIMI — ama not bunu ancak dikkatli okunursa söyler. Kod açıkça ayırıyor: kısa biçim İKİ HANE DOLGULU (`buildShortBatchCode` → padStart(2), code-format.ts:234; yorum 222-231 'Dolgu BURADA bilinçli olarak VAR … sabit genişlik'), günlük biçim dolgusuz (batch.service.ts:141 padStart(1)). Dolgusuzluk kuralı YALNIZ bayrak kapalı rejime aittir.
- `R:2026-07-14__refakat-karti-traveler-card` ↔ `Batch model şema yorumu (Teks-Erp/prisma/schema.prisma:2537)`: Kod NOTU uyguluyor: TravelerCard.workOrderId @unique (schema.prisma:3467 'Bir iş emri = tek refakat kartı') + model başlığı 3459-3462 ('kart WO açılışında doğar, parti değil … Parti (Batch) veri modeli kalır ama kart üretmez'). schema.prisma:2537 satırı 2026-07-14 redesign'ından kalma BAYAT yorumdur; düzeltilmeli (kod değişikliği değil, yorum).

## Açık sorular

- schema.prisma:2537 'refakat kartı parti başına' BAYAT yorum (kod tersini uyguluyor: TravelerCard.workOrderId @unique) — düzeltme bu turun kapsamı dışında, sahibi refakat-karti kümesi.
- R:2026-07-14 / R:2026-08-05 / R:2026-08-14 / E:undated üyelerinin parti-dışı kuralları burada işlenmedi; sahipleri sırasıyla C2-refakat-karti, C2-finans-saglamlik, C2-superadmin kümeleri.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** İş Emri No ≠ Parti: `WorkOrder.workOrderNumber` (İE+GGAAYY+NNNN) üretim emridir; `Batch` üretime aynı anda giren top grubudur; bir WO N parti içerir; eski dal/`batchSplitId` kavramı kalktı. Tasarım: `docs/design/PARTI-MODELI-TASARIM.md`. <sub>(kök 2026-07-13)</sub>

## Bekçiler — bu alana dokununca koş (32 backend · 2 istemci)

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_batch_drop`, `test_batch_k15_merge`, `test_batch_k16_split_move`, `test_batch_k8_tools`, `test_batch_multibatch_dispatch`, `test_batch_number_format`, `test_batch_partial_dispatch_autosplit`, `test_batch_redye_three_paths`, `test_batch_split_new_wo_modes`, `test_batch_trace`, `test_branch_no_empty`, `test_bulk_dispatch_rollids`, `test_direct_ship_scenarios`, `test_dispatch_cross_wo_batch_guard`, `test_fason_parti_grouping`, `test_fason_partial_receive`, `test_fason_receive_crossstep_firm`, `test_fason_receive_idempotency_concurrency`, `test_k14_lock_edges`, `test_manual_move`, `test_order_filter_batch_check`⚠️, `test_quality_batch_flags`, `test_quick_start_wo`, `test_shipment_doc_batch_column`, `test_split_card_lineage`, `test_split_per_roll`, `test_tambur_branch_info`, `test_tambur_manual_batch`, `test_traveler_card_a5_batches`, `test_traveler_card_stale`, `test_wo_branch_redye`⚠️, `test_wo_branch_split`⚠️

İstemci: `batch-merge-confirm.test.ts`, `useTebdilWizard.test.tsx`

## Arşiv notları (tam metin, gerekçe ve ölçüm)
