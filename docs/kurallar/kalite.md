# Kalite · İstasyon yeteneği

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 24 üye; çekirdek 11 not (kalite=istasyon yeteneği, renk/özellik kısıtı, rota hedefi, hata döngüsü, finalize, koşullu etiket, fason dönüş), 13'ü teğet ya da yanlış bağlanmış (WO kapatma, top düzeltme, sayfalama, tip kontrolü, KK1 mükerrer, yarı mamul, filtreler — sonuncusu arşivdeki kayık 'PROFİL GERÇEĞİ' şerhi yüzünden primary sayılmış). Bayat: 2 kök satır (2026-08-06 'hasDefaultCategory DE aranır'; 2026-08-02 'kilit requiredCategory.appliesColor' + 'StationColor okuyan kod yok') — hepsi 2026-08-10 tek yüklemiyle KODDA kapanmış, metin düzeltilmeli. En riskli çelişki: Faz A 'ikinci KK istasyonu tanımlanabilir' satış cümlesi ↔ kursun-bypass-eligibility.helper.ts:178 'sonraki adım TAMBUR' TÜR şartı — Kurşun→KK→Tambur rotası bypass'ı sessizce kapatır, kısıt yalnız panel yorumunda, bekçisiz. Faz B (R1/R3/R4/R5/R6/R9/R10) açık ve kod bunu doğruluyor (assertWoAtStepKind, stationScreens kind eşlemesi, RollError partial unique). [doğrulandı: 24 üye, 3 kanıt kontrolü, 1 düzeltme]


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** 'Bu adım kalite kontrol yürütür mü' sorusunun TEK kaynağı `services/helpers/quality-station.helper.ts`; boğaz İKİZ — bellek-içi `stepCanApplyQuality(station)` + Prisma parçası `QUALITY_STATION_WHERE` AYNI kuralı söyler ve BİRLİKTE değişir. Yeni `kind === PROCESS_QC` karşılaştırması YAZILMAZ. · bekçi: `test_station_quality_capability §3 (ikiz eşdeğerliği, canlı DB) + §4 (kind===PRO` <sub>(CLAUDE.md:100, CLAUDE.md:174)</sub>
- **[ÇEKİRDEK]** İstasyon yeteneği istasyonun KENDİ alanıdır: `Station.appliesColor` (default false) / `appliesProperty` (default true) / `appliesQuality` (default false); ortak yüklemler `stepCanApplyColor/Property(station, requiredCategory)` ve tek argümanlı `stepCanApplyQuality` — kategoride kalite karşılığı YOK (fason firma kalite notu yazmaz). · bekçi: `test_route_step_targets · test_station_capability · test_station_quality_capabil` <sub>(CLAUDE.md:68, CLAUDE.md:100)</sub>
- **[ÇEKİRDEK]** Yetenek bayrağı PLANLAMA sorusunu yanıtlar ('bu adım verebilir mi'); fason KABULDE rengin/özelliğin FİİLEN uygulandığı hâlâ o sevkin `requiredCategory` bayrağından okunur (`subcontractor.service`). İkisi BİRLEŞTİRİLMEZ: istasyon bayrağı 'yapabilir', kategori bayrağı 'yaptı' der. · bekçi: `arşiv:319 'bekçi ayrımı kaynak taramasıyla kilitler' — bekçi adı/bölümü BELİRSİZ` <sub>(CLAUDE.md:68)</sub>
- **[PROFİL]** 'Kurşun ile KK2 aynı istasyonda' (`StationKind.PROCESS_QC`, tek `WorkOrderStep`) adnansahin'in TOPOLOJİSİDİR — sektörde KK ayrı istasyonda ya da başka istasyonla birlikte olabilir (tasarım karar #11, §5.1); yeni yüzey bu birlikteliğe yaslanmaz. <sub>(CLAUDE.md:174)</sub>
- **[ÇEKİRDEK]** Per-roll iz `RollOperation` ile `KURSUN_APPLIED` / `QC2_COMPLETED` olarak tutulur — her top kurşun görmez; kurşun bypass'ta bu satırlar YAZILMAZ ve RollError açılmaz (dijital iş ile kâğıt akışının farkı budur). · bekçi: `test_kursun_bypass / test_qc2_idempotency (bölüm no BELİRSİZ)` <sub>(CLAUDE.md:174)</sub>
- **[ÇEKİRDEK]** `RollError` Tambur kararıyla kapanır: `isProcessed = true` + `actionTaken = CUT|NO_CUT`; redye/parti ayırmada Tambur DIŞINDA `NO_CUT` ile idari kapanış olabilir. Kapanma semantiği ÇEKİRDEK'tir. <sub>(CLAUDE.md:176)</sub>
- **[ÇEKİRDEK]** Her rotanın SON adımı topu finalize eder (`finalizeRollsAtLastStep`) — Tambur özel DEĞİL: `currentStepId=null`, `form=ACIK` (Tambur çocukları TOP), barkodsuz açık kumaşa barkod (satılabilir 'F' / 'H'); `qualityGrade` NULLABLE, yalnız kalite istasyonları belirler; `PRODUCED` limbosu YOK (enum'da da yok); WO depo topunu (WAREHOUSE/A1_STOCK) da tüketir. · bekçi: `test_finalize_last_step` <sub>(CLAUDE.md:17, CLAUDE.md:113)</sub>
- **[ÇEKİRDEK]** Tambur = kesim/bölme + kalite kararı istasyonu, 'final ürün kapısı' DEĞİL; depo bir istasyon değil tartı/paket öncesi bekleme statüsü (`RollStatus.WAREHOUSE`); ham (renksiz) top kesiminde operatör parçayı `STOCK` (üretime devam) da seçebilir. <sub>(CLAUDE.md:17)</sub>
- **[PROFİL]** Kök 'Üretim Akışı' bloğu adnansahin'in ROTASIDIR (KK1→[fason]→Kurşun+KK2→Tambur→Depo→Çuval→Sevk), sistemin zorunlu akışı değil — her adım istasyon kataloğu + rota şablonundan kurulur; 'kumaş hazır gelir' bu fabrikanın cümlesi. Devere/çözgü/haşıl YENİ MİMARİ İSTEMEZ; dokuma diliminin tek tasarım işi 'top TEZGAHTAN doğar' damgası. <sub>(CLAUDE.md:17)</sub>
- **[ÇEKİRDEK]** Renk istasyon KISITI DEĞİL (reçetedir): rota adımının renk seçicisi TÜM aktif renk kataloğunu gösterir; `StationColor` deprecated — FİLTRE olarak okunmaz (DTO geriye-uyumu için station-capability.service hâlâ okur/yazar); 'renk veren adım var mı' tek yüklem `stepCanApplyColor` — ikinci renk filtresi EKLENMEZ. · bekçi: `test_helpers (kilit) + test_station_capability 8b` <sub>(CLAUDE.md:128, CLAUDE.md:68)</sub>
- **[ÇEKİRDEK]** `StationProperty` gerçek proses kısıtıdır ve İKİ İŞ yapar (planlama filtresi + `copyStationCapabilitiesToRoll` otomatik uygulama); yeni `FabricProperty` `stationIds` ZORUNLU ve bağ AYNI insert'te (`nestedCreateFields`); update'te `stationIds` verilmezse bağa DOKUNULMAZ, boş dizi iki yolda da 400; create/replace kapsaması simetrik; 'özellik veren adım' ile 'ŞU özelliği veren adım' ayrı sorular. · bekçi: `test_property_station_binding` <sub>(CLAUDE.md:129)</sub>
- **[ÇEKİRDEK]** Rota şablonu HEDEF saklar (`RouteStep.plannedColorId` + `RouteStepProperty`) ve hedef ÖNERİDİR, kilit değil; rotadan WO'ya: SON renk veren adım kazanır, özellikler BİRLEŞİR; renk yeteneği sorgusunda adımın KENDİ kategorisi de okunur (yoksa istasyonun varsayılan kategorisi); istemci sözleşmesi DÜZ ID dizisi; istasyon değişince hedef SIFIRLANIR. · bekçi: `test_route_step_targets` <sub>(CLAUDE.md:50)</sub>
- **[ÇEKİRDEK]** Koşullu etiket elemanı (`showIf`): koşul ELEMANDA yaşar, değer `QualityGrade.code` (ad DEĞİL); kalitesiz topta koşullu eleman BASILMAZ (fail-closed); tek uygulama noktası `prepareElements` — yeni emitter `expandMultilineText`'i doğrudan ÇAĞIRMAZ; koşullu alan bağlam kimliği sayılmaz. · bekçi: `test_label_element_condition` <sub>(CLAUDE.md:44)</sub>
- **[ÇEKİRDEK]** Fason dönüş: kabulde orijinal toplar `SUBCONTRACTOR_CONSUMED`; makbuzdan `parentReceiptId`'li YENİ açık-kumaş Roll doğar (`entrySource=SUBCONTRACTOR_RETURN`, barcode null); metraj ZORUNLU, ağırlık opsiyonel; kesin ölçüm sonraki istasyonun FINISH'inde damgalanır. · bekçi: `test_fason_partial_receive (bölüm BELİRSİZ)` <sub>(CLAUDE.md:178)</sub>

### Yasaklar

- **[ÇEKİRDEK]** İkinci KK istasyonu TANIMLANABİLİR (Faz A) ama Kurşun→KK→Tambur üçlü rota KURULMAZ: kurşun bypass uygunluğu hâlâ 'sonraki adım Tambur' TÜRÜNE bakar ve sessizce kapanır (Faz B R3'e kadar). · bekçi: `yok (yalnız panel yorumu)` <sub>(CLAUDE.md:100, arşiv:121)</sub>

### Tuzaklar

- **[PROFİL]** Hatanın hangi istasyonda AÇILDIĞI profildir: bugün üç yazar (kursun-qc addError :643, tambur :1870, kursunFinish :5264) hep PROCESS_QC/TAMBUR bağlamı; `roll_errors_roll_meter_defect_uq` partial unique çok-istasyonda 409 riski taşır (Faz B R5) — açıldığı istasyona yaslanan yeni yüzey yazmadan önce Faz B listesine bak. <sub>(CLAUDE.md:176)</sub>

### Kararlar

- **[ÇEKİRDEK]** Faz B AÇIK — türe bağlı kalan yerler: `assertWoAtStepKind(PROCESS_QC)` (R1), bypass 'sonraki adım TAMBUR' şartı (R3), mobil ekran seçimi kind→ekran (R4, APK), RollError açılış yeri (R5, partial unique 409), dashboard ham SQL (R6), `QC2_COMPLETED` semantiği (R9), roll-finalize son-adım dalı (R10). İlk farklı-topolojili müşteride; canlı fabrikada talepsiz değiştirilmez. · bekçi: `yok (plan dokümanı; regresyon yüzeyi: test_e2e_full_flow, test_kursun_bypass, te` <sub>(CLAUDE.md:100, CLAUDE.md:174, CLAUDE.md:176)</sub>
- **[PROFİL]** Seed kalite hedefleri: 1.KALİTE ve A1 → WAREHOUSE (ikisi de SATILABİLİR), FİRE → SCRAP (2026-08-20 'fire çöpe gider', migration 20260820030000). Kalite kodu koda GÖMÜLMEZ (`code === 'FIRE'` reddedildi) — kova `targetStatus`/katalogdan çözülür. <sub>(CLAUDE.md:17)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Final statü kaliteden çözülür: `resolveFinalStatus(code, statusByCode)` → `QualityGrade.targetStatus`; kod yok ya da katalogda yoksa WAREHOUSE. ⚠️ Kolon default'u `targetStatus @default(SCRAP)` (yıkıcı, bilinçli) — create ucunda ZORUNLU olduğu için (F212) hiç uygulanmaz; 'varsayılan WAREHOUSE' finalize kuralıdır, kolon default'u değil. · bekçi: `test_finalize_last_step (kalite-null→WAREHOUSE ölçümü — bölüm BELİRSİZ)` <sub>(CLAUDE.md:17)</sub>
- **[ÇEKİRDEK]** `StationProperty.mode` AUTO|OPTIONAL|REQUIRED çalışma-zamanı davranışıdır (varsayılan OPTIONAL); kurşun bypass ataması AUTO arar — satırın varlığı yetmez; TAMBUR kat modu OPTIONAL (REQUIRED yalancı beyandı — Tambur akışı capability kapısını çağırmaz). · bekçi: `test_property_targetable / test_property_value_selection (bölüm BELİRSİZ)` <sub>(CLAUDE.md:68)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `assertWoAtStepKind(PROCESS_QC)` (kursun-qc.service.ts:254) DOKUNULMAZ: `roll-step.helper` Tambur ile paylaşılıyor (tambur.service:454/:3746); imzayı yetenekleştirmek Tambur kart-okutma yolunu da değiştirir. Bekçide gerekçeli MUAF (KIND_MUAF, sayı 1) — Faz B R1. · bekçi: `test_station_quality_capability §4 KIND_MUAF (iki yönlü: ölü muaf da kırmızı)` <sub>(CLAUDE.md:100, CLAUDE.md:174)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Faz A köprüsü: yüklem `kind === PROCESS_QC || appliesQuality` okur ve backfill'e GÜVENMEZ; seed'e açıkça `appliesQuality: true` yazılır (seed migration'dan SONRA boş tabloda koşar — 2026-08-10 appliesColor tuzağı). Faz B'de dal düşmeden seed + prod ölçümü ŞART. · bekçi: `test_station_quality_capability §2 + §7` <sub>(CLAUDE.md:100)</sub>
- **[ÇEKİRDEK]** Seed ham prisma kullanır, `StationService`in 'kategoriden tohumla' adımı KOŞMAZ → yetenek bayrakları (appliesColor/appliesProperty/appliesQuality) seed'de AÇIKÇA yazılır; kolon varsayılanına güvenen seed taze kurulumda boyahaneyi renksiz, KK istasyonunu kalitesiz doğurur. · bekçi: `test_station_quality_capability §7 (canlı DB seed/backfill ölçümü)` <sub>(CLAUDE.md:68, CLAUDE.md:100)</sub>

## Panel (Electron)


### Kararlar

- **[ÇEKİRDEK]** Panelde 'Kalite kontrol uygular' kutusu HER istasyon türünde görünür — gizli kural icat edilmez (KK1/Sevkiyat WO adımı olmadığı için orada etkisiz). 'KK1 WO adımı olamaz' bir İSTEMCİ sözleşmesidir (`allowAsWorkOrderStep` filtresi Electron seçicilerinde); backend onu okumaz, guard eklemek davranış değişikliği olur. <sub>(CLAUDE.md:100)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Mobil oturumlu ekran seçimi istasyon TÜRÜNDEN: `SCREEN_BY_STATION_KIND` (RAW_QC→KK1, PROCESS_QC→KursunQc, TAMBUR→Tambur, SHIPPING→TartiPaket) backend `SESSIONABLE_STATION_KINDS`'ın aynasıdır, bijektif; yeteneğe geçiş Faz B R4 (APK işi, bijektiflik bozulur) — bu tabloya yetenek sokma. · bekçi: `mobil/src/constants/stationScreens.test.ts` <sub>(CLAUDE.md:220, CLAUDE.md:100)</sub>
- **[ÇEKİRDEK]** Tambur 'Boyahaneye Geri Gönder': hedef adımı SUNUCU çözer (`/tambur/manual/send-to-dye-preview`, KANONİK `stepCanApplyColor` — tablette rota yok, 'hangi adım boya veriyor' yüklemi ikinci kez yazılmaz); önizlemesiz uygulama YOK, sebep ≥3; fason adımına taşıma AT_SUBCONTRACTOR YAPMAZ, çıkış Fason Sevk'ten. <sub>(CLAUDE.md:181)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Mobil okuma yolu TEK: HAL (`src/services/hal/`); eski `hardware.service.ts` mock'u KALDIRILDI, geri getirilmez. <sub>(CLAUDE.md:223)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-08-06__2026-08-06-rota-sablonu-hedef` → `R:2026-08-10__2026-08-10-11-uretim-karakteristigi`: Rota adımının renk yeteneği bileşik `hasDefaultCategory && canApplyColor` koşulundan tek yüklem `stepCanApplyColor(station, stepCat)`'a indi; 'yoksa Tambur adımına renk yazılır' fallback'i o bileşiğin ürünüydü, kalktı. Notun diğer kuralları (öneri≠kilit, son renk veren adım kazanır, düz ID dizisi, istasyon değişince sıfırlama) canlı. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-02__renk-istasyon-bazli-kisit-degil-2026` → `R:2026-08-10__2026-08-10-11-uretim-karakteristigi`: Renk kilidinin kaynağı yalnız `requiredCategory.appliesColor` değil artık `stepCanApplyColor(station, requiredCategory)` = istasyonun KENDİ bayrağı VEYA adımdaki fason hizmeti. 'Kaynak StationColor değil, appliesColor' ilkesi duruyor; bayrak artık iki modelde (Station + SubcontractorCategory) yaşıyor. ✅ çürütmeden geçti
- **KISMI** `R:undated__kursun-qc2-tek-fiziksel-istasyon` → `R:2026-09-03__2026-09-03-kalite-istasyon-yetenegi`: 'Bu adım KK yürütür mü' cevabı `kind === PROCESS_QC` tür karşılaştırmasından ikiz boğaza (stepCanApplyQuality ⟷ QUALITY_STATION_WHERE) taşındı. Tek WorkOrderStep modeli + RollOperation izi canlı; PROCESS_QC türü yalnız Faz A köprüsünde ve Faz B'ye bırakılan assertWoAtStepKind'da okunur. Kök not kendi ekiyle bunu zaten söylüyor. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:2026-08-06__2026-08-06-rota-sablonu-hedef` ↔ `R:2026-08-10__2026-08-10-11-uretim-karakteristigi`: Kod 2026-08-10'u uygular: rota adımı, WO guard'ı ve renk kilidi `stepCanApplyColor(station, stepCat)` ile karar verir (adımda kategori yoksa istasyonun varsayılan kategorisi). `hasDefaultCategory` DTO'da yalnız panel ipucu metni için duruyor (station-capability.service.ts:129). Kök dizindeki 2026-08-06 satırı bayat ifadeyi taşıyor; satır yeniden yazılmalı.
- `R:2026-08-02__renk-istasyon-bazli-kisit-degil-2026` ↔ `R:2026-08-10__2026-08-10-11-uretim-karakteristigi`: Kod 2026-08-10'u uygular: kilit = istasyon bayrağı ∨ adımdaki fason hizmeti. 2026-08-02 cümlesi 'StationColor değil' anlamında doğru, 'yalnız kategori' anlamında bayat. Ayrıca 'StationColor … okuyan kod yok' yanlış: station-capability.service.ts:185/:368 okur, :386-390 yazar — filtre olarak DEĞİL, DTO geriye-uyum (:7-10).
- `R:2026-09-03__2026-09-03-kalite-istasyon-yetenegi` ↔ `A:2026-08-06__2026-08-06-dagitim-artik-isin`: Kod türe bakmaya devam ediyor: ikinci KK istasyonu TANIMLANABİLİR (Faz A) ama Kurşun→KK→Tambur rotası kurulursa kurşun bypass uygunluğu sessizce kapanır. Kısıt yalnız panel yorumunda, bekçisi yok; yasak olarak kural kitabına yazılmalı (Faz B R3'e kadar).

## Açık sorular

- Arşiv yerleşimi: CLAUDE-NOT-ARSIVI.md:305'teki 'PROFİL GERÇEĞİ' şerhi 2026-08-06 FİLTRE notunun (:296-304) altında duruyor ama içeriği ('KAPSAM DIŞI maddesi' :320, 'appliesColor=false göçü' :317, '§5.1 öncülü') 2026-08-10 notuna (:307+) aittir; bundle bu yüzden A:2026-08-06 filtreler notunu bu kümeye 'primary' saydı. Şerh 2026-08-10 notunun altına taşınmalı.
- Sayım drift'i (kural değil, dizin satırı sayı taşımamalı): kök dizin 'stepCanApplyQuality 11 nokta / QUALITY_STATION_WHERE 13 nokta'; quality-station.helper.ts:11-12 '7 / 12 nokta'; helper:5 '19 karar noktası'; schema.prisma:830 '28 karar noktası'; git grep -c bugün 7 dosya / 6 dosya.
- Bayat yorum/satır atıfları (kod doğru, metin düzeltmesi): quality-station.helper.ts:28 'kursun-qc:245' → gerçek :254-256; kök 2026-09-03 satırı 'schema.prisma:843' → :844; workorder-locks.helper.ts:17-18 başlığı hâlâ 'requiredCategory.appliesColor=true' der, kod :165 stepCanApplyColor(station, requiredCategory).
- 2026-08-02 renk notu 'StationColor … okuyan kod yok' der; station-capability.service.ts:185/:368 findMany + :386-390 replace hâlâ var (DTO geriye-uyum, filtre değil — :7-10). Cümle 'filtre olarak okuyan kod yok' diye daraltılmalı; Electron StationCard.tsx:59 iddiası (fazA) bu turda doğrulanmadı → BELİRSİZ.
- Faz A'nın 'ikinci KK noktası' vaadi (Electron/src/data/surum-notlari.json:337) ile bypass R3 üçlü-rota kısıtı (kursun-bypass-eligibility.helper.ts:178) yan yana yaşıyor; kısıt yalnız StationFormDialog.tsx:135-139 yorumunda, bekçisi yok — hangi belgeye (kural kitabı mı, sürüm notu mu) yazılacağı kullanıcı kararı ister.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_finalize_last_step`⚠️, `test_helpers`, `test_iade_enhancements`, `test_label_element_condition`, `test_manual_move_backflush`, `test_manual_move_qc_reversal`, `test_null_quality_visibility`, `test_p2_kk2reopen`, `test_phase1_uretim_hardening`, `test_phase3_stok_hardening`, `test_phase6_reporterror_concurrency`, `test_produced_buckets`, `test_qc2_idempotency`⚠️, `test_quality_batch_flags`, `test_quality_code_literal`, `test_quality_scorecard`, `test_scrap_grade_label`, `test_scrap_scorecard`, `test_station_quality_capability`, `test_wo_manual_complete`

İstemci: `WorkOrderCompleteDialog.test.tsx`, `shortCutQuality.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-02 · 2026-08-02 — koşullu etiket elemanı, `showIf` — `CLAUDE-NOT-ARSIVI.md:36-44`
- 2026-08-06 · 2026-08-06 — FİLTRELERDE ÇOKLU SEÇİM: "CSV de bir string'dir" ve üç ayrı arıza modu — `CLAUDE-NOT-ARSIVI.md:296-306`
- 2026-09-03 · 2026-09-03 — Kalite = istasyon YETENEĞİ (P4 Faz A): boğaz TEK DEĞİL İKİZ — `CLAUDE-NOT-ARSIVI.md:2116-2133`