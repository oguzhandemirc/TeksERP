# Raporlar · Karneler
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/raporlar.md`.

> Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Rapor görünürlüğü TEK liste: `SystemSetting` `reports.closedKeys` (JSON `string[]`, KAPALI olanlar; satır yok ⇒ hepsi açık); rapor başına modül anahtarı açma; yeni rapor AÇIK doğar.
- **[ÇEKİRDEK]** Her rapor ucu `requireReportOpen("<key>")` taşır; sıra `verifyToken` → modül kapısı → RAPOR KAPISI → izin guard'ı; kapalı → 403 `details.code:"REPORT_DISABLED"`; menü gizleme kapı değildir.
- **[ÇEKİRDEK]** Panel rapor kapısı karo · route (`ProtectedRoute`, izin/modülden SONRA, → `/forbidden`) · palet (`visibleWhen`); karar tek yer `isReportOpen(key)` (`lib/report-gate.ts`); FAIL-CLOSED: liste yok ⇒ hiçbiri açık, katalog dışı anahtar kapalı, tümü kapalı kategori karosu çizilmez.
- **[ÇEKİRDEK]** Yazma yüzeyi Sistem → Modüller "Raporlar" (`ReportVisibilitySection`, `canWrite = isSuperadminGateOpen(...)`); modülü kapalı raporun satırı kilitli; toggle `reportsClosedKeys`i sıralı KÜME olarak bütün yazar, `null` göndermez; okunamazsa satır çizilmez, uyarı + "listeyi sıfırla".
- **[ÇEKİRDEK]** Kapı üç sonuçlu (açık · kapalı · ÖLÇÜLEMEDİ): liste okunamazsa 403 `REPORT_GATE_UNAVAILABLE`; okuma ÖNBELLEKSİZ.
- **[ÇEKİRDEK]** Listeyi yalnız sistem hesabı yazar (`PATCH /api/feature-flags` → `reportsClosedKeys`, `SUPERADMIN_ONLY_FLAG_KEYS`); ham ayar ucu 400 `MODULE_KEY_RESERVED`; tanınmayan anahtar yazmada 400 `REPORT_KEY_UNKNOWN`, okumada yok sayılır + boot'ta tek uyarı.
- **[ÇEKİRDEK]** Açık kümeli her süzgeç ekseni `meta.secenekler`de seçici kaynağı taşır (kapalı enum taşımaz); kod tabanlı eksende (`sebep`·`belgeTipi`·`oran`) `code` sorgu parametresinin birebir biçimi, `ad` yalnız gösterim; sayısal eksen sayısal sıralanır.
- **[ÇEKİRDEK]** `meta.secenekler` SÜZGEÇTEN BAĞIMSIZ: süzgeç WHERE'e iniyorsa toplayıcı bir kez süzgeçsiz koşar (yalnız dökümde ise gerekmez); enum eksende backend HAM KOD döner, ikinci etiket tablosu tutmaz.
- **[ÇEKİRDEK]** Cari ekseni `_filters.ts` `cariEkseni` ile LİSTE (`cariId`, CSV/tekrarlı, ≤50); tek istisna `finance/statement` (tek cari, beyanlı).
- **[ÇEKİRDEK]** Süzgeç beyanı CEVABIN KÖKÜNDE (`reportEnvelope` 4. argüman, `SuzgecEcho`), yalnız VERİLEN anahtarlar; `null` yer tutucu yok; `data` içine ikinci adres yok.
- **[ÇEKİRDEK]** Rapor süzgeci SUNUCUDA, şema `.strict()` (tanınmayan eksen 400); kap `suzgec`/`meta.suzgec` yalnız süzgeçliyken, `dusenSatir` ZORUNLU.
- **[ÇEKİRDEK]** YÜRÜYEN BAKİYELİ raporda (kasa defteri · cari ekstre) süzgeç yalnız dökümü daraltır; devir/bakiye/toplam süzgeçten etkilenmez, beyan `@suzgec-ozet-degismez`.
- **[ÇEKİRDEK]** Rapor kimliğinin tek kaynağı `Teks-Erp/src/constants/report-catalog.ts` (`REPORT_CATALOG`, `"<kategori>/<rapor>"`); Electron aynası `Electron/src/lib/report-catalog.ts` birebir; yeni rapor: katalog → ayna → bekçi.
- **[ÇEKİRDEK]** Tarih sözleşmesi katalogda (`tarih`: `aralik-iso`·`aralik-gun`·`tek-gun`·`kesit`·`ileri-pencere`·`yok`); panel parametre adını oradan üretir, backend adları değişmez.
- **[ÇEKİRDEK]** Varsayılan pencere günü katalogdaki `varsayilanGun`; yaprakta tekrar yazma; günsüz sözleşmede `null` ZORUNLU, pencere sözleşmesinde YASAK; istisna beyanlı ve kanıtı ölçülür.
- **[ÇEKİRDEK]** Rapor tarih girdisini yalnız `ReportDateFilter` çizer (`pages/Reports/**`'ta ham `type="date"` yok); parametre adı `_lib/report-date`; URL durumu `useReportDateRange` (`factoryDay`/`asOf`, `dueFrom`/`dueTo`).
- **[ÇEKİRDEK]** `Roll.finalizedAt`/`statusChangedAt`ı DB trigger'ı `roll_stamp_production_timestamps` yazar; damgayı elle yazma.
- **[ÇEKİRDEK]** `finalizedAt` write-once DEĞİL (tekrar finalize'da tazelenir); daima mevcut `qualityGradeId` ile aynı olaydan gelir, sabitleme.
- **[ÇEKİRDEK]** 'Dönemde sevk edilen metraj' TEK tanım `reports/_shipped.ts` (brüt: canlı sevk + RollReturn geri-eklemesi + DirectShipment); ikinci tanım yazma.
- **[ÇEKİRDEK]** Yön ekseni `reports/_destination.ts`te: sevk raporu `Shipment.destination` (donmuş; doğrudan sevk hiçbir kümede), sipariş raporu `Order.destination` (açılışta donmuş; NULL kümesiz); canlı cari kartı okunmaz; sevk kg'ı `collectShippedWeight`ten.
- **[ÇEKİRDEK]** Toplam/özet listeyi sınırlayan tavandan ÖNCE tam kümeden hesaplanır; tavan yalnız satırlara; tanınmayan imleç 400.
- **[ÇEKİRDEK]** Katalogla büyüyen kırılım listesi `capReportLists` (`REPORT_MAX_ROWS`) tavanından geçer, kesme `warnings`le söylenir; yeni dizi alanı liste beyanına ya da bekçi muafına yazılır.
- **[ÇEKİRDEK]** Rapor yorum cümlesini yalnız `services/reports/anlati/` üretir; ekran/PDF/Excel/patron aynı `anlati[]`yı basar; formül dili (Σ, P90, ABC/RFM…) cümleye girmez.
- **[ÇEKİRDEK]** Her v1 satırı `yeniHali` taşır (`birlesti → <v2>`·`uzman`·`tasindi → <yol>`); v2 satırı panel yüzeyi inene dek `hazir:false`, hiçbir yüzeyde çizilmez; tek süzgeç `isReportSurfaced`; "uzman" `sinif` değil `yeniHali`dir.
- **[ÇEKİRDEK]** Ölçü adı ve günlük dil açıklaması yalnız `services/reports/semantik/tanimlar.ts`te; "fire", "iptal oranı", "zamanında teslim" tek tanımlı; açıklama formül içermez.
- **[ÇEKİRDEK]** Temel rapor sayısı mevcut rapor servisinden okunur; temel serviste yeni SQL yazma, eksik alanı kaynağa EK alan ekle; kıyas varsayılanı sunucuda (`temel/_common.resolveCoreCompare`).
- **[ÇEKİRDEK]** Fire tek tanımlı; kaynak oranları kendi paydasıyla, toplam fire oranı basılmaz; temel raporun her sayısı kaynak karnenin alanından.
- **[ÇEKİRDEK]** Paylaşım veri yetkisi vermez: kayıtlı raporun bloğu koşanın izniyle çalışır, izinsiz blok "yetkisiz" döner.
- **[ÇEKİRDEK]** Rapor tanımı gövdesini yalnız `services/reports/semantik/rapor-tanimi.schema.ts` doğrular; istemci şemayı kopyalamaz, `dogrula`/`onizle` uçlarını çağırır.

### Yasaklar

- **[ÇEKİRDEK]** `finalizedAt`ı yalnız IN_PRODUCTION|STOCK|AT_SUBCONTRACTOR|RETURNED_FROM_SUBCONTRACTOR → WAREHOUSE|A1_STOCK|SCRAP geçişi yazar; SHIPPED/CANCELLED kaynak listesine EKLEME.
- **[ÇEKİRDEK]** Fabrika günü kaydın anındaki dilimden ([PROFİL] `factory_timezone_periods`, yoksa Europe/Istanbul); tek kaynak `src/constants/time.ts` (`factoryTimezoneAt`, `factoryDaySql`, `factoryDayStart`, `factoryDayKeyUtcMidnight`, `factoryYmd`).
- **[ÇEKİRDEK]** Dilim literal'i, ham `AT TIME ZONE`, çıplak `DATE_TRUNC`/`CURRENT_DATE` yazma (oturum UTC'de keser).
- **[ÇEKİRDEK]** Dilim değişikliği geçmişi değiştirmez: yeni dönem ertesi gün başından yalnız önizlemeli `PUT /api/feature-flags/factory-timezone` (admin:settings + ayar şifresi, 8037 + `expectedCurrent`, bekleyen varken 409, audit).
- **[ÇEKİRDEK]** Bekleyen dilim değişikliğini yalnız `POST …/factory-timezone/cancel` ters kayıtla iptal eder; ham ayar ucu ve `PATCH /api/feature-flags` dilim yazamaz.
- **[ÇEKİRDEK]** İstemcide tarih/saati yalnız bayt-eşit `src/lib/factory-time.ts` (+ `factory-time-zone.ts`) basar, dönemler sunucudan (`applyServerFactoryTimezone`); ham `toLocale*String`, `Intl.DateTimeFormat`, date-fns/dayjs biçimi yasak; "bugün" `factoryDayKey()`.
- **[ÇEKİRDEK]** Kayıtlı dilim geçersizse sunucuyu durdurma: varsayılanla yorumla, `FACTORY_TIMEZONE_INVALID_STORED` uyarısını sağlık ucunda (`factoryTimezone.warning`) ve ayar yanıtında (`factoryTimezoneWarning`) göster; düzeltme yeni dönemdir.
- **[ÇEKİRDEK]** Takvim günü alanını (vade · termin · planlanan · kur günü) takvim biçimleyicisiyle bas: istemci `formatCalendarDay`/`calendarLocaleDateString`/`calendarDaysFromToday`, belge `fmtCalendarDate`.

### Tuzaklar

- **[ÇEKİRDEK]** Parti numarası benzersiz değil (P01…P99): parti araması aday listesi döndürür, izleme `batchId` ile.
- **[ÇEKİRDEK]** Kalite karnesi hücre sorgusu/kumaş kırılımı `helpers/quality-first-share.helper.ts` (`collectPeriod`·`qualityByItem`), fason açık kalem yüklemi `subcontract-scorecard-query.helper.ts` `openDispatchItemsSql`; bildirim koşulu aynı fonksiyonu çağırır.

### Kararlar

- **[ÇEKİRDEK]** TAKVİM GÜNÜ (günlük sayaç/grafik) dilime bağlı → açık yaz; MUTLAK PENCERE (son 72 saat, yaşlandırma, termin, daysOpen/daysLate) dilimden bağımsız → dokunma, '-- tz-ok:' ile belirt.
- **[ÇEKİRDEK]** Varyant ≤6, dönem ≤12 değer; hücre ucun kendi süzgeciyle süzülmüş ana koşudur; kaynağın süzemediği boyut 400; varyant/dönem anahtarı buluta gitmez.
- **[ÇEKİRDEK]** Özel rapor `duzen`i yalnız SUNUM: sorguya ulaşmaz, `bloklar`a dokunmaz, kayıt yeni sürüm açar; PDF ve Excel aynı tablo spec'inden.
- **[ÇEKİRDEK]** Oluşturucu süzgecini istemcide SQL'e çevirme: yalnız `sorgu` JSON'u (`{combinator, rules[{field, operator, value}]}`) kurulur, sunucuda derlenir; veri ağacına yalnız katalog ucunun alanları; istemcide izin/modül süzmesi yok.
- **[ÇEKİRDEK]** Süzgeç ağacı kök "ve"/"veya" + BİR iç grup, her grup SQL'de parantezli; "arasında" yalnız `ordered` boyutta; bellek-içi ölçüde "veya" 400; "Tümü" kalan koşul "veya" grubunu bütünüyle düşürür.
- **[ÇEKİRDEK]** "Ne görüyoruz?" cümlesini SUNUCUDA anlatı motoru, yalnız aynı raporun `tamam` bloklarından kurar; istemci `anlati`yı aynen basar; "Diğer" kovalı kırılımdan pay cümlesi kurma.
- **[ÇEKİRDEK]** Kod modu şemayı kopyalamaz, şema hatası yalnız `dogrula`dan; istemci yalnız JSON sözdizimi denetler, hata yolunu satır/sütuna eşler, tamamlama katalog kimliklerinden; taze+temiz hüküm yokken görsele dönüş kilitli.

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Fason atfı ÜÇ KOVALI (fabrika içi · firma bilinen · firma belirsiz fason); yalnız `parentReceiptId` JOIN'i yanlış atıftır; `entrySource='SUBCONTRACTOR_RETURN'` load-bearing.
- **[ÇEKİRDEK]** Parti izlemede iade edilmiş top müşteri listesinden düşmez (`RollReturn.fromShipmentId` ile geri eklenir); kesim çocuğu `batchId` miras alır.
- **[ÇEKİRDEK]** Kalite Karnesi ölçüsü METRE; kapsam `K18_DEAD_STATUSES`i dışlar, SCRAP'i dışlamaz.
- **[ÇEKİRDEK]** İade Karnesi paydası BRÜT; sebep üç durumlu (katalog/serbest/boş), serbest metin tek kova; oran kohort değil, ekranda yazılı.
- **[ÇEKİRDEK]** Fason Karnesi'nde fire yalnız KAPANMIŞ kalemlerden; dönen metraj tüm kabul satırlarının toplamı (DISTINCT ON yok); fasondan müşteriye giden metre fire değil, paydadan düşülmez.
- **[ÇEKİRDEK]** OTIF'te terminsiz sipariş paydadan çıkar, sayısı ayrıca basılır; 'termini geçmiş ve açık' dönemden bağımsız anlık sayı.
- **[ÇEKİRDEK]** WIP: BEKLEYEN anlık (tarih filtresi etkilemez), GEÇEN dönemsel; istasyon listesi birleşim; ortalama bekleme top ağırlıklı; qtyIn/qtyOut fark kolonu basılmaz.
- **[ÇEKİRDEK]** Stok & Ölü Stok yaş çıpası `Roll.statusChangedAt`; çıpasız top yaş kovasına dağıtılmaz ama metrajı toplama girer, sayısı ayrıca basılır; `[status,statusChangedAt]` index bilinçli yok.
- **[ÇEKİRDEK]** `ReportDefinitionVersion` değişmez; düzenleme/geri alma YENİ SÜRÜM; `ReportDefinition.activeVersionId` atomik claim ile değişir (`report_presets_one_default_uq`, sınıf `defter-beyan.ts` DURUM).
- **[ÇEKİRDEK]** Hata grubu kümesi (`DefectType.defectGroup`, duruş sebebi → grup) yalnız `Teks-Erp/src/constants/hata-gruplari.ts`te; DB CHECK koyma, panel aynası bayt-eşit, yeni duruş kodunun grubu aynı commit'te.
- **[ÇEKİRDEK]** `production/makine-duruslari` `MachineStopEvent` span defterinden: kapsam `machineStopScopeWhere(machineStopRegime())`, geri alınan hariç, açık duruş "sürüyor", süre fabrika günü sınırında `constants/time` ile bölünür.
- **[ÇEKİRDEK]** `finance/masraf-ozeti` sayısı yalnız `expense-summary.helper`dan; ekran/Excel/PDF/patron aynı zarf, bulut toplama yapmaz.

### Yasaklar

- **[ÇEKİRDEK]** `resolveDateRange` sınırı istemcinindir (`useReportDateRange.ts` yerel 00:00/23:59:59.999); backend ekstra gün yuvarlaması YAPMAZ; gruplama fabrika gününe göre.

### Tuzaklar

- **[ÇEKİRDEK]** `_shipped.ts`teki `status='DISPATCHED'` süzgecini SİLME.
- **[ÇEKİRDEK]** Fire Karnesi: hurda `finalizedAt` + METRE, hata `RollError.detectedAt` + ADET, toplanmaz; hata bağı `LEFT JOIN LATERAL … LIMIT 1` zorunlu.

### Reçeteler

- **[ÇEKİRDEK]** Dönem kıyası ortak katmanda `_shared.resolveCompareRange`: prev = aynı uzunlukta önceki pencere, prevYear = takvim yılı, custom; prev bitişi ana dönemden 1 ms önce; kıyas yoksa 2. sorgu koşmaz.
- **[ÇEKİRDEK]** Katman: services/ (+ helpers/ + reports/) iş mantığı · tx · `AuditService.log()`; routes/ (+ routes/reports/) Swagger + `verifyToken` + `requirePermission`; yeni rapor servisi reports/, ucu routes/reports/.

### Kararlar

- **[ÇEKİRDEK]** 'Kesim kaybı' metriği YOK; kesim-olayı kaydı doğana kadar yazılmaz.
- **[ÇEKİRDEK]** Semantik sorguda değer yalnız parametre; SQL'i yalnız `services/reports/semantik/derleyici.ts` üretir; bilinmeyen küp/ölçü/boyut/işleç 400; izin küp + ölçü başına.
- **[ÇEKİRDEK]** Vardiya boyutu yalnız `services/helpers/vardiya-takvimi.helper.ts`; gece yarısını aşan vardiya başladığı fabrika gününe yazılır.
- **[ÇEKİRDEK]** Semantik koşu sınırı: kullanıcı 2 / kurulum 4 eşzamanlı (fazlası 429 `RAPOR_SIRADA`); READ ONLY tx + `statement_timeout` (`reports.statementTimeoutSec` 5..45) → 503 `RAPOR_ZAMAN_ASIMI`.
- **[ÇEKİRDEK]** Sayım ölçüsü maruziyetle oranlanmadan analize girmez; n < 30 ya da beklenen hücre < 5'te kanıt cümlesi yok; her analiz cümlesi "İlişki, nedeni göstermez." ile biter (`services/reports/semantik/analiz.ts`).
- **[ÇEKİRDEK]** `ReportRun` 90 günde; `ReportSnapshot`tan yalnız süresi dolmuş `ZAMANLANMIS` budanır (tek budayıcı `services/report-prune.service.ts`); `KULLANICI` budanmaz.
- **[ÇEKİRDEK]** Geçmiş kesit defterden kurulamıyorsa `olculemedi` döndür; kurulabiliyorsa kaynak servisi `asOf` = `factoryPreviousMonthEnd` (`reports/temel/_day-range.ts`) ile çağır, sapmayı uyarıda beyan et.
- **[ÇEKİRDEK]** Demo/analiz fikstürünü yalnız `tekserp_<ad>_test`e yaz (`scripts/lib/demo-db-gate.ts` Prisma'dan önce); sistem şablonu `semantik/sistem-sablonlari.ts`te, SISTEM satırı olarak uzlaşır, kopyası OZEL tanımın ilk sürümü.

## Panel (Electron)

- **[ÇEKİRDEK]** Kasa & Banka "farklı para birimli hesaplar — genel toplam basılmadı" notunu yalnız sunucunun `multiCurrency` bayrağıyla çiz; `totals === null`dan türetme, istemcide para birimi sayma.

### Değişmezler

- **[ÇEKİRDEK]** Yaprak rapor önce cevabı gösterir: katalog `REPORT_CATALOG.soru` (`ReportPageLayout` tek yerden) + tablodan önce özet şeridi (`MetricCard`); hub karoları `sinif`e göre bölümlenir, gizlenmez.
- **[ÇEKİRDEK]** Yaprak rapor `ReportExportBar` (Excel · PDF · Yazdır) taşır; çıktı ekranın aynası: kaynak kolonu ve "ölçülemedi" kâğıda geçer, sayıya çökertilmez.
- **[ÇEKİRDEK]** Excel'de görünen metin PDF'inki: sayı biçimi `lib/number-format`ten (`reportExcelNumFmt`, `upTo3ExcelNumFmt`); başlık + dönem + meta her sayfanın üstünde; rapor spec'i yalnız `REPORT_NUM_FMTS`.
- **[ÇEKİRDEK]** TEK SPEC → ÜÇ ÇIKTI (`ReportExportSpec`); rapor PDF'i `document-render/`a girmez.
- **[ÇEKİRDEK]** Rapor/liste/döküm PDF'i `PDF_MAX_ROWS` (`@shared/pdf-limits`) kapısından geçer: tavan üstünde HTML kurulmaz, kullanıcı Excel'e yönlenir; ana süreç hatası toast'a basılır.
- **[ÇEKİRDEK]** Ucu ek modül kapısı taşıyan karo (levent: `requireDokumaEnabled` + `requireDevereEnabled`) modül kapalıyken çizilmez (`Dokuma/tile-config.ts` `visibleDokumaTiles`).
- **[ÇEKİRDEK]** Rapor grafiği yalnız `_v2/grafik` ECharts sarmalı; PDF'e SVG, Excel'e veri tablosu; yeni Recharts import'u yasak.
- **[ÇEKİRDEK]** v2 ekranı yalnız `RaporSunumu` çizer; anlatı ve kıyas varsayılanını istemci kurmaz, çip `parametreler[]`den; `_v2/sunum.ts` = `sunum.types.ts` bayt-eşit.
- **[ÇEKİRDEK]** Eski rapordan otomatik yönlendirme yok; "yeni hâli" bandını yalnız `ReportPageLayout` (`LegacyReportBanner`) çizer; hedef çizilmiyorsa band yok.
- **[ÇEKİRDEK]** Analiz kartı cümlesi sunucudan; istemci kanıt dili/olasılık üretmez; her kartta "İlişki, nedeni göstermez." notu.

## Geçersiz kılınan kurallar — bunlara UYMA

- "FIFO/yaşlandırma için ayrı kolon GEREKİR" → karşılandı: `Roll.statusChangedAt` VAR (yaş çıpası + sevk FIFO).

## Açık sorular

- `backfill_roll_production_timestamps.ts` sahada koşuldu mu ölçülemedi.
- 'Rapor menüsü 20 → 13' ölçümü bayat; kural olarak alıntılama.
- `audit.report.service.ts` Sistem'e taşındı mı ölçülemedi.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** `loadProducedBuckets` katalog çözümünde `isActive` süzgeci uygulanmaz, `notIn: []` yazılmaz.
- **[ÇEKİRDEK]** `routes/reports/**` altındaki her `router.get` sorgusu `.strict()` Zod'dan geçer (parametresiz `emptyQuerySchema`); elle `req.query.x` ve sessiz varsayılan (`.catch(50)`) yok; şemalar bekçi için dışa açık.
- **[ÇEKİRDEK]** v2 sorgu anahtarları Türkçe (`kiyas`; `compare` geçersiz); tarih+kıyas şeması yalnız `temel/_common.ts` `coreRangeQuerySchema`dan.
- **[ÇEKİRDEK]** Levent/lot ekseni (dokuma üçlüsü + kalite/fire): `warpBeamId`/`lotNo` süzgeci; bağ DEFTERDEN (`WarpBeamEvent.CONSUMED`, `YarnMovement.WARP_ISSUE`, `beamsMountedDuring` ∩ vardiya); tek helper `helpers/warp-beam-roll-filter.helper`; rota prisma import etmez.
- **[ÇEKİRDEK]** Levent/lot: süzgeçsiz sorgu bayt bayt eski; süzgeçliyse kökte `suzgec {warpBeamId?, lotNo?, levent, dusenSatir}`; bilinmeyen levent/lot BOŞ rapor (404 değil), ikisi KESİŞİM; `meta.leventler` (≤200, süzgeçten bağımsız) yalnız dokumada.
- **[ÇEKİRDEK]** Satış/müşteri/fason ekseni: `customerId`·`itemId`·`colorId`·`subcontractorId` (≤50) · `destination` (= `Customer.defaultDestination`) · `reasonCode` (yalnız paya); tek sözleşme `services/reports/_filters.ts` + boğaz-ikizleri (`orderScopeWhere`↔`orderScopeSql`…) + `filterEcho`.
- **[ÇEKİRDEK]** Satış ekseni: süzgeçsizde parça boş (bayt bayt eski); kökte `suzgec` + `dusenSatir`; tanınmayan kimlik boş sonuç; kıyas/seri/payda aynı koşulla; beyanlı kapsam dışı: açık karşılanmada müşteri, fason karnesinde işlem türü.
- **[ÇEKİRDEK]** Satış ekseni `meta.secenekler` (≤200/eksen, `tr` sıralı, pencerede geçen, süzgeçten bağımsız; süzgeçli istekte toplayıcı ×2); liste uçlarından seçenek alma (403 riski).
- **[ÇEKİRDEK]** Panel ekseni: seçim URL'de CSV; "Tümü" seçimin YOKLUĞU (anahtar düşer); seçenek raporun `meta.secenekler`inden; ayrıştırma tek yer `_hooks/reportAxisFilters.ts`; seçeneksiz şerit pasif + sebep.
- **[ÇEKİRDEK]** Panel ekseni: niteleyici etikette ve çıktıda (`destination` "Müşteri varsayılanı", `reasonCode` yalnız pay; `SÜZGEÇ — …` meta satırı; `dusenSatir` cümlesi); şerit/şerh sözlükten (`ReportAxisBar`, `AXIS_LABELS`/`AXIS_CAVEATS`); rapor↔eksen beyanı iki yönlü ölçülür.
- **[ÇEKİRDEK]** Panel levent/lot: levent seçicisi raporun `meta.leventler`inden (ayrı `warpbeam:read` yok); kaynaksız seçici çizilmez; lot serbest metin, ENTER/odak kaybında süzer; ekran+çıktıda üç cümle; `dusenSatir` yokluğu "bilinmiyor".
- **[ÇEKİRDEK]** Finans paneli: cari seçicisi `meta.secenekler.cariId`den (`/api/finance/cari` kullanılmaz); yaşlandırmada seçici raporu, arama ekranı daraltır; kasa/ekstrede döküm eksenleri yalnız dökümü daraltır (şerh yazılı); KDV'de cari ekseni YOK; ekstrede `cariId` tekil.
- **[ÇEKİRDEK]** Dokuma/finans temel uçları kaynak raporun modül kapısını taşır (`requireDokumaEnabled`, levent + `requireDevereEnabled`, alacak `requireFinanceEnabled`; rapor kapısından önce); gün aralıklı v2 teli `temel/_day-range.ts` `coreDayRangeQuerySchema`.
- **[ÇEKİRDEK]** Her semantik ölçüyü mevcut rapora sayı eşitliğiyle bağla (`parity: { report, field }`) ya da gerekçeli `muaf`; temel raporun ana sayısı bir küp ölçüsü; boş paydada küp `null`.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_makine_durus_raporu`, `test_masraf_ozeti`, `test_semantik_derleyici`, `test_semantik_sayi_esitligi`, `test_rapor_calistirma_siniri`, `test_vardiya_takvimi`, `test_rapor_anlati`, `test_rapor_istatistik`, `test_rapor_analiz_uctan_uca`, `test_temel_rapor_esitlik`, `test_rapor_varyant`, `test_rapor_duzen`, `test_accounting_direct_ship`, `test_rapor_yon_ekseni`, `test_destination_mix`, `test_accounting_export`, `test_batch_trace`, `test_bulut_ozet_mutabakat`, `test_rapor_strict`, `test_customer_scorecard`, `test_dashboard`, `test_demand_analysis`, `test_dispatch_report`, `test_dispatch_report_gross`, `test_fason_partial_receive`, `test_fason_visibility`, `test_filter_multi_select`, `test_finance_opening`, `test_finance_reports`, `test_finance_vat`, `test_fx_diff_report`, `test_open_order_coverage`, `test_order_cancel_reason`, `test_order_cancellation`, `test_order_intake`, `test_order_leadtime`, `test_order_stats`, `test_plan_deviation_scorecard`, `test_produced_buckets`, `test_quality_scorecard`, `test_recent_output_filters`, `test_report_day_boundary`, `test_reports`, `test_return_scorecard`, `test_scrap_scorecard`, `test_semi_finished_surfaces`, `test_shipment_detail_gross`, `test_shipment_list_gross`, `test_shipment_scorecard`, `test_shipped_status_filter`, `test_stock_scorecard`, `test_subcontract_scorecard`, `test_wip_scorecard`, `test_rapor_katalogu`, `test_rapor_tanimi`, `test_rapor_levent_ekseni`, `test_rapor_kapisi`, `test_finans_rapor_eksenleri`, `test_rapor_sunum_aynasi`, `test_db_invariants`, `test_hata_gruplari`, `test_bakim_isleri`, `test_telemetri_defter_degil`, `test_saat_dilimi_donemleri`, `test_fabrika_saat_dilimi`, `test_istemci_saat_dilimi`, `test_doc_fmt_date`, `test_rapor_satis_ekseni`, `test_rapor_satir_tavani`, `test_dokuma_karne_tam_kume`, `test_bildirim_kosul_is`, `test_dokuma_regime_gate`

İstemci: `dataPanel.test.tsx`, `codeMode.test.tsx`, `eskiRaporBandi.test.tsx`, `number-format.test.ts`, `reportNumFmt.guard.test.ts`, `AuditDataBlock.test.tsx`⚠️, `audit-labels.test.ts`⚠️, `audit-labels.trade.test.ts`⚠️, `list-export.test.ts`⚠️, `chequeExport.test.ts`, `accounting-export.test.ts`, `service.test.ts`, `dumpSheets.test.ts`, `chequeDueExport.test.ts`, `fxDiffExport.test.ts`, `statementExport.test.ts`, `reportExport.test.ts`, `movements.test.ts`, `reportAxisFilters.test.ts`, `ReportMultiSelect.test.tsx`, `reportAxisCoverage.test.ts`, `LotInput.test.tsx`, `ReportExportBar.pdfGate.test.tsx`, `reportExport.golden.test.ts`, `raporGrafik.test.tsx`, `recharts-cirit.test.ts`, `reportV2.test.tsx`, `analysisCard.test.tsx`, `report-gate.test.ts`, `ProtectedRoute.report.test.tsx`, `ReportsHub.gate.test.tsx`, `ModuleProfilePage.reports.test.tsx`, `ReportDateFilter.test.tsx`, `ham-tarih-girdisi.test.ts`, `reportSummaryCoverage.test.ts`, `reportHubSections.test.ts`, `reportExportCoverage.test.ts`, `dokumaExport.test.ts`, `leventRaporlari.test.tsx`, `layoutEditor.test.tsx`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-09 — Rapor temeli: topun üretim zamanı şemada — `CLAUDE-NOT-ARSIVI.md:333-360`
