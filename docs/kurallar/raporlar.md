# Raporlar · Karneler

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 6 üye: 1 kök notu (2026-08-09 rapor temeli, arşiv tam metniyle) + 5 alt-CLAUDE notu (katman haritası ×2, script çıkışı, fabrika günü, tsc çıktısı). Hepsi CANLI — kodda doğrulandı (trigger roll_stamp_production_timestamps, reports/_shipped.ts 3 tüketicili, factoryDaySql 8 raporda, typecheck:plain, idleTimeoutMillis 600_000). Bayat olan tek şey ölçümler: '20→13 rapor menüsü' artık yanlış (o günden sonra finance-*/plan-deviation/customer-scorecard/demand-analysis servisleri eklendi). Çelişki YOK; tek ezilme kısmi: 2026-07-30 'Buraya geliş ≠ oluşturma' notunun 'FIFO için ayrı kolon GEREKİR' cümlesi 2026-08-09'da karşılandı (statusChangedAt) ama kök satır hâlâ gelecek zamanda duruyor. En riskli açık: backfill script'inin sahada koşup koşmadığı ölçülemedi.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Roll.finalizedAt/statusChangedAt damgalarını DB TRIGGER'ı yazar (roll_stamp_production_timestamps, BEFORE INSERT OR UPDATE) — uygulama koduna güvenilmez: Roll.status'e yazan 40+ nokta var, biri atlanırsa rapor SESSİZCE eksilir (hata yok, log yok). Damgayı elle yazma. · bekçi: `scripts/test_db_invariants.ts §6 + scripts/test_quality_scorecard.ts` <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** finalizedAt WRITE-ONCE DEĞİLDİR, üzerine yazılır: depo topu yeni iş emrine girip tekrar finalize olursa tazelenir. Invariant: finalizedAt DAİMA mevcut qualityGradeId ile AYNI olaydan gelir; sabitlenirse top ESKİ tarihle YENİ kaliteyi taşır. <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** 'Dönemde sevk edilen metraj' TEK tanım reports/_shipped.ts (brüt: canlı sevk + RollReturn geri-eklemesi + DirectShipment). İkinci tanım yazma — biri doğrudan sevkleri, diğeri iade geri-eklemesini unutur. Bugün 3 tüketici; beşincisinde sınıf yeniden açılır. · bekçi: `yok (kök Ortak Konvansiyonlar 'Tek kaynak satır kuralı'nın emsali)` <sub>(CLAUDE.md:69)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Damganın KAYNAK STATÜ LİSTESİ load-bearing: yalnız IN_PRODUCTION|STOCK|AT_SUBCONTRACTOR|RETURNED_FROM_SUBCONTRACTOR → WAREHOUSE|A1_STOCK|SCRAP geçişi finalizedAt yazar. SHIPPED/CANCELLED BİLEREK dışarıda: storno aylar önceki topu bugünün karnesine sokar. · bekçi: `scripts/test_quality_scorecard.ts (trigger'a SHIPPED eklenince 1 kontrol kırmızı` <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** Fabrika günü = Europe/Istanbul takvim günü, TEK KAYNAK src/constants/time.ts: literali hiçbir yere kopyalama — FACTORY_TIMEZONE + factoryDaySql/factoryDayStart/factoryDayKeyUtcMidnight/factoryYmd kullan. Çıplak DATE_TRUNC günü OTURUM (UTC) diliminde keser. · bekçi: `scripts/test_report_day_boundary.ts (4. cephe: src/ içinde elle DATE_TRUNC('day'` <sub>(CLAUDE.md:301)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Parti numarası BENZERSİZ DEĞİLDİR (P01…P99 döner) → parti araması DAİMA aday listesi döndürür ve izleme batchId ile yapılır; tek sonuç varsaymak aynı numaralı BAŞKA partinin müşterilerini göstermek olur. · bekçi: `scripts/test_batch_trace.ts (15 kontrol)` <sub>(CLAUDE.md:69)</sub>

### Kararlar

- **[ÇEKİRDEK]** İKİ SORUYU AYIR: TAKVİM GÜNÜ (günlük sayaç/grafik, GGAAYY) saat dilimine BAĞLIDIR → açık yaz; MUTLAK PENCERE (son 72 saat, yaşlandırma, termin, daysOpen/daysLate) iki an farkıdır, dilimden BAĞIMSIZ → dokunma, yalnız '-- tz-ok:' ile belirt. · bekçi: `scripts/test_report_day_boundary.ts` <sub>(CLAUDE.md:301)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Fason atfı ÜÇ KOVALIDIR (fabrika içi · firma bilinen fason · firma belirsiz fason): yalnız parentReceiptId JOIN'ine bakmak EKSİK VERİ değil YANLIŞ ATIF üretir (ölçüm: 21 fason dönüşü topun yalnız 6'sında parentReceiptId dolu); entrySource='SUBCONTRACTOR_RETURN' sorguda load-bearing. · bekçi: `test_quality_scorecard.ts (fason kovası kalkınca 3 kontrol kırmızı)` <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** Parti izlemede İADE EDİLMİŞ TOP müşteri listesinden DÜŞMEZ (iade shipmentId'yi NULL'lar; RollReturn.fromShipmentId ile geri eklenir) — iade eden müşteri şikâyette en çok arananıdır. Kesim çocuğu batchId'yi miras alır → tek batchId sorgusu yeter. · bekçi: `scripts/test_batch_trace.ts` <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** Kalite Karnesi'nin ÖLÇÜSÜ METREDİR, adet değil (1000 m 1. kalite ile 5 m 2. kaliteyi 1'e 1 saymak oranı anlamsız yapar); kapsam K18_DEAD_STATUSES'i dışlar (tüketilmiş ebeveyn + çocuk = aynı kumaşı iki kez saymak) ama SCRAP'i DIŞLAMAZ — fire gerçek bir üretim sonucudur. · bekçi: `test_quality_scorecard.ts (metraj yerine adet sayılınca 12 kontrol kırmızı)` <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** İade Karnesi'nin PAYDASI BRÜT'tür (brüt kuralının 5. tüketicisi): net paydayla oran şişer, en çok da iadenin yoğun olduğu dönemde. Sebep ÜÇ DURUMLU (katalog/serbest metin/boş), serbest metinler TEK kovada; oran KOHORT DEĞİL ve bu ekranda yazılı. <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** Fason Karnesi'nde FİRE yalnız KAPANMIŞ kalemlerden hesaplanır (açık kalem paydada olsaydı dün sevk edilen parti %100 fire görünürdü; bekçide %4↔%68); dönen metraj TÜM kabul satırlarının toplamıdır (DISTINCT ON 52 m sahte fire yazar). <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** OTIF'te TERMİNSİZ SİPARİŞ ORANA GİRMEZ AMA GİZLENMEZ: 'zamanında' saymak oranı sahte yükseltir, 'geç' saymak haksız düşürür → paydadan çıkarılır ve sayısı ayrıca basılır (bekçide %66,7 ↔ %50). 'Şu an termini geçmiş ve hâlâ açık' metriği DÖNEMDEN BAĞIMSIZ anlık sayıdır. <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** WIP ekranında İKİ ZAMAN ANLAYIŞI: BEKLEYEN anlık snapshot'tır (tarih filtresi ETKİLEMEZ), GEÇEN dönemseldir; istasyon listesi iki kümenin BİRLEŞİMİ; ortalama bekleme TOP AĞIRLIKLI. qtyIn/qtyOut fark kolonu basılmaz (qtyOut=qtyIn tasarım gereği). · bekçi: `scripts/test_wip_scorecard.ts (19 kontrol)` <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** Stok & Ölü Stok yaş çıpası Roll.statusChangedAt; ÇIPASIZ top yaş kovalarına DAĞITILMAZ ama metrajı toplama girer ve sayısı ayrıca basılır ('yaşı bilinmiyor' ≠ 'yeni'). [status,statusChangedAt] index BİLİNÇLİ yok; tetikleyici dosya başlığında. · bekçi: `scripts/test_stock_scorecard.ts` <sub>(CLAUDE.md:69)</sub>

### Yasaklar

- **[ÇEKİRDEK]** resolveDateRange sınırı İSTEMCİNİNDİR: Electron filtresi seçilen günün YEREL 00:00 / 23:59:59.999 anını gönderir (useReportDateRange.ts); backend ekstra gün yuvarlaması YAPMAZ — yaparsa istemcinin niyeti iki kez yorumlanır. Gruplama ayrı sorudur ve fabrika gününe göre kesilir. <sub>(CLAUDE.md:301)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** _shipped.ts'teki status='DISPATCHED' süzgecini SİLME: kaybını hiçbir bekçi göremez (ölçüldü, yeşil kalıyor) çünkü storno dispatchedAt'i NULL'lar ve aralık süzgeci PLANNED'ı zaten eler. Süzgeç o invariant'a GÜVENMEMEK için duruyor. · bekçi: `yok (bilinçli olarak bekçisiz — arşiv bunu açıkça yazar)` <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** Fire Karnesi'nde İKİ ÇIPA İKİ BİRİM: hurda finalizedAt + METRE, hata tespiti RollError.detectedAt + ADET — toplanmaması gereken iki sayı aynı birimde basılmaz. Hata bağı LEFT JOIN LATERAL … LIMIT 1 olmak zorunda: düz JOIN iki hatalı 100 m'lik topu 200 m hurda gösterir. <sub>(CLAUDE.md:69)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Dönem karşılaştırması ORTAK KATMANDA (_shared.resolveCompareRange): prev = aynı uzunlukta önceki pencere (takvim ayı DEĞİL) · prevYear = TAKVİM yılı kaydırması · custom. prev'in bitişi ana dönemin 1 ms öncesi; karşılaştırma yoksa 2. sorgu koşmaz. <sub>(CLAUDE.md:69)</sub>
- **[ÇEKİRDEK]** Backend katman haritası: services/ (+ helpers/ + reports/) iş mantığı · transaction · AuditService.log() taşır; routes/ (+ routes/reports/) Swagger JSDoc + verifyToken + requirePermission taşır. Yeni rapor = servis reports/ altına, uç routes/reports/ altına. <sub>(CLAUDE.md:145, CLAUDE.md:146)</sub>

### Kararlar

- **[ÇEKİRDEK]** 'Kesim kaybı' metriği BİLİNÇLİ OLARAK YOK: tüketilen ebeveynin currentQty'si sıfırlandığı için naif Σ(initial−current) 2522 m'lik HAYALİ kayıp raporluyordu; kesim-olayı kaydı doğana kadar yazılmayacak. <sub>(CLAUDE.md:69)</sub>

## Panel (Electron)


### Değişmezler

- **[ÇEKİRDEK]** Rapor dışa aktarımı TEK SPEC → ÜÇ ÇIKTI: Excel·PDF·Yazdır aynı ReportExportSpec'ten türer; ayrı yazmak 'aynı başlık altında farklı rakam' demektir. Rapor PDF'i document-render/ dünyasına GİRMEZ (orası donmuş/sürümlü resmi belgelerin alanı). · bekçi: `Electron reportExport.test.ts (kolon kümesi eşitliğini mekanik doğrular)` <sub>(CLAUDE.md:69)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-07-30__buraya-gelis-degil-olusturma (kök CLAUDE.md:125, Domain Kuralları)` → `R:2026-08-09__2026-08-09-rapor-temeli-finalizedat`: 'Gerçek stok yaşlandırma / FIFO istenirse yalnız statü geçişlerinde damgalanan AYRI BİR KOLON GEREKİR' talebi karşılandı: 2026-08-09'da Roll.statusChangedAt eklendi (migration 20260809090000, trigger yazar) ve bugün hem Stok & Ölü Stok karnesinin yaş çıpası hem de sevk çuval seçiminin FIFO sırası odur. Kök satır hâlâ 'gerekir' (gelecek zaman) diyor — güncellenmeli: kolon VAR. ✅ çürütmeden geçti

## Açık sorular

- backfill_roll_production_timestamps.ts sahada (canlı kurulumda) koşuldu mu — DB'ye bakılamadı; koşulmadıysa Kalite/Fire/Stok karneleri geçmişsiz başlar (ekranda uyarı bandı var, sessiz değil).
- Arşivdeki 'rapor menüsü 20 → 13' ölçümü BAYAT: o günden sonra finance-aging/finance-vat/finance-fx-diff/cash-book/customer-scorecard/demand-analysis/open-order-coverage/plan-deviation servisleri eklendi (ls). Sayı arşivde tarihsel ölçüm olarak kalmalı, kural olarak alıntılanmamalı.
- 'Denetim ikilisi Sistem'e taşınacak (ayrı iş)' açık kalemi — audit.report.service.ts hâlâ reports/ altında; taşınıp taşınmadığı bu kümeden ölçülemedi.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** Üretilen metraj kovası (`loadProducedBuckets`) katalogdan çözülürken `isActive` süzgeci UYGULANMAZ ve `notIn: []` yazılmaz — pasifleştirilen kalite sınıfının topları üretilen metrajdan düşmez. · bekçi: `test_produced_buckets` <sub>(arşiv 2026-08-21 akşam)</sub>

## Bekçiler — bu alana dokununca koş (37 backend · 13 istemci)

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_accounting_direct_ship`, `test_accounting_export`, `test_batch_trace`, `test_boss_overview`, `test_customer_scorecard`, `test_dashboard`, `test_demand_analysis`, `test_dispatch_report`, `test_dispatch_report_gross`, `test_fason_partial_receive`, `test_fason_visibility`⚠️, `test_filter_multi_select`, `test_finance_opening`, `test_finance_reports`, `test_finance_vat`, `test_fx_diff_report`, `test_open_order_coverage`, `test_order_cancel_reason`, `test_order_cancellation`, `test_order_intake`, `test_order_leadtime`, `test_order_stats`, `test_plan_deviation_scorecard`, `test_produced_buckets`, `test_quality_scorecard`, `test_recent_output_filters`, `test_report_day_boundary`, `test_reports`, `test_return_scorecard`, `test_scrap_scorecard`, `test_semi_finished_surfaces`, `test_shipment_detail_gross`, `test_shipment_list_gross`, `test_shipment_scorecard`, `test_stock_scorecard`, `test_subcontract_scorecard`, `test_wip_scorecard`

İstemci: `AuditDataBlock.test.tsx`⚠️, `audit-labels.test.ts`⚠️, `audit-labels.trade.test.ts`⚠️, `list-export.test.ts`⚠️, `chequeExport.test.ts`, `accounting-export.test.ts`, `service.test.ts`, `dumpSheets.test.ts`, `chequeDueExport.test.ts`, `fxDiffExport.test.ts`, `statementExport.test.ts`, `reportExport.test.ts`, `movements.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-09 · 2026-08-09 — RAPOR TEMELİ: topun ÜRETİM ZAMANI artık şemada; Kalite Karnesi — `CLAUDE-NOT-ARSIVI.md:333-360`