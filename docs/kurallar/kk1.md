# KK1 · İdempotency · Çevrimdışı kuyruk
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/kk1.md`.

> Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** "KK1'in işi olan top" kümesi TEK sabittir: backend `constants/kk1-entry-sources.ts` `KK1_ENTRY_SOURCES` ↔ mobil `KK1_LIST_ENTRY_SOURCES` birebir; karne/liste SQL'i kaynak listesini elle yazmaz (`Prisma.join`).
- **[ÇEKİRDEK]** Kayıt-yaratan uç istemci `clientToken`'ı taşır (`String? @unique @db.Uuid`); kapsam 15 model: Roll, Order, WorkOrder, SubcontractorReceipt, SwatchStockReduction, Sack, Shipment, ImportRun, WarehouseTransfer, GoodsReceipt, Invoice, Payment, CashTransaction, Cheque, PurchaseOrder.
- **[ÇEKİRDEK]** Token'ı MANTIKSAL DENEME başına BİR KEZ üret, tekrar denemede AYNI token'ı gönder; mutate çağrısı başına yeni token üretme.
- **[ÇEKİRDEK]** Token'ı tek yardımcıdan al (panel `Electron/src/lib/attemptToken.ts` ↔ tablet `mobil/src/offline/attemptToken.ts`, özdeş); gönderim anında üretim (`clientToken: üret()`, `mutationFn` içi) yasak; sonucu `onFailure`/`onSuccess`e ver; `renew` yalnız açılışta.
- **[ÇEKİRDEK]** Token yalnız BELİRSİZ hatada YAPIŞIR (ağ / zaman aşımı / 5xx); kesin 4xx'te YAPIŞMAZ (yenilenir) — yoksa sonsuz 'Tekrar Dene' döngüsü.
- **[ÇEKİRDEK]** KK1 mükerrer tuzağı tx İÇİNDE koşar; tx'in İLK ifadesi `pg_advisory_xact_lock(8021, hashtext(anahtar))`; kilit `findFirst`'ten ve `generateRollBarcode`'dan ÖNCE (TOCTOU / ABBA).
- **[ÇEKİRDEK]** Advisory kilit uzaylarını AYRI tut: 8021 = KK1 mükerrer tuzağı, 8022 = parti no üreteci; yeni uzay alırken envantere bak.
- **[ÇEKİRDEK]** Token ön-okumasıyla insert arasında kazananın yazdığını okuyan iş kuralı varsa token okumasını `lockClientTokenTx` (8036, `hashtext(token)`) altında yap; 8036 tx'in İLK ifadesidir; K′ yolları 8036 ALMAZ, token okumasını mevcut kilidin arkasına koyar.
- **[ÇEKİRDEK]** Token replay'li yolda kaybeden denemenin cevabı token'dan gelir: ya 8036 ilk ifade (K) ya token her iş kuralından önce okunur ve tx hatasında yeniden okunur (R); farklı kimlik alanlı gövde 409 `CLIENT_TOKEN_COLLISION`; bekçi zorlanmış sırayla ölçer (`scripts/lib/zorlanmis-sira.ts`).
- **[ÇEKİRDEK]** Token replay tek boğazdan geçer (`tokenReplay`, `helpers/token-replay.helper.ts`; politika find·alive·identity·collision·respond; kip `run` R · `inTx` K · `behindLock` K′); boğaz önceki kaydı HAM döndürmez.
- **[ÇEKİRDEK]** Token yazan/okuyan her birim `scripts/lib/token-replay-beyan.ts`te beyanlı (boğaz · helper · borç · kapalı muaf); borç yalnız düşer; token'sız kayıt-yaratan uç `TOKENSIZ_UCLAR`ta kapalı sınıfla.
- **[ÇEKİRDEK]** Mükerrer penceresini operatörün bastığı anla (`Roll.clientEnteredAt`) ve İKİ YÖNLÜ (since/until) kur; damgasız eski kayıt `createdAt`'e düşer; tek yönlü `gte` yasak.

### Reçeteler

- **[ÇEKİRDEK]** Yeni tarihli notu kök CLAUDE.md'ye YAZMA: tam metin `docs/history/arsiv/<YYYY-MM>.md`'ye, köke yalnız `[ÇEKİRDEK]`/`[PROFİL]` etiketiyle başlayan özet satırı; alana dokunmadan önce arşivdeki TAM notu oku.

## Backend

### Değişmezler

- **[ÇEKİRDEK]** Sayaç bazlı kartela düşümünün idempotency'si `SwatchStockReduction` olay modelindedir; `KartelaDispatch`'te token BİLİNÇLİ olarak YOKTUR.
- **[ÇEKİRDEK]** SystemLog arşivi OTOMATİK (`jobs/archive-scheduler.ts`: start +60 sn, 24 saatte kontrol, 30 günde bir 6 aydan eskiyi taşır); manuel `POST /api/admin/system-logs/archive {monthsToKeep:6}` yalnız acil disk baskısında.
- **[ÇEKİRDEK]** Rol şablonu kataloğu: tek kaynak `constants/role-template-catalog.ts` + boot uzlaştırması (izin uzlaştırmasından SONRA) + bekçi; rol SAYISINI koda/nota sabitleme.
- **[ÇEKİRDEK]** İlk girişte kalite ÇİFT kolon birlikte dolar/boşalır: `qualityGrade` + `qualityGradeId` (`resolveQualityGradeIdStrict`); yok/""/whitespace → NULL/NULL ("1.KALITE" varsayılanı yazılmaz); bilinmeyen/PASİF kod 400, top doğmaz; panel boş seçimi düşürür (`"" → undefined`).
- **[ÇEKİRDEK]** Top barkodunu (`generateRollBarcodeTx` · `reserveRollBarcodes*Tx`) yazma tx'i AÇILMADAN ÖNCE havuz client'ıyla al; başarısız tx'in yaktığı numara boşluk sayılır.
- **[ÇEKİRDEK]** KK1 doğuş gövdesi (`dokuma.rollBirth` KK1_*): `machineCode` XOR `weavingOrderId`; `warpBeamId`/`productionLineNo` yalnız `machineCode` ile; hiçbiri `doffEventId`/`semiFinished` ile değil (zod `superRefine`, şema strict değil → alan listede olmalı).
- **[ÇEKİRDEK]** KK1 doğuş replay kimliğine `machineCode` ve `weavingOrderId` (`Roll.weavingOrderId ?? doff.machineRun.weavingOrderId`) girer, farklı → 409 `CLIENT_TOKEN_COLLISION`; `data.doffEvent {id, code}` yalnız bu yolda, alansız gövdede yanıt bayt bayt eski.
- **[ÇEKİRDEK]** KK1 doğuşunda muayene topla aynı tx'te yazılır; modül/izin yok ya da istasyon muayene yeteneği kapalıysa top doğar, muayene yazılmaz, uyarı `STATION_NO_QUALITY`; 400 yalnız bozuk muayene verisine.

### Tuzaklar

- **[ÇEKİRDEK]** Script çıkışında `$disconnect()` tek başına YETMEZ (havuz `idleTimeoutMillis: 600_000`); `process.exit(fail>0?1:0)` ya da `$disconnect()` + `pool.end()` kullan.

### Reçeteler

- **[ÇEKİRDEK]** Uzun rapor basan scriptte `pool.end()` tercih et — `process.exit` stdout'u kırpabilir.
- **[ÇEKİRDEK]** Master Data CRUD için yeni kod yazma — `BaseController` + `BaseService` (`searchFields` config'i).

### Kararlar

- **[PROFİL]** `kk1.duplicateGuardEnabled` varsayılan KAPALI; ENGELLEME değil ONAYLATMA: 409 `POSSIBLE_DUPLICATE` → `confirmDuplicate:true`; `createInitialEntry`'de `opts.duplicateGuard` ile OPT-IN (F221).

## Tablet (mobil)

### Değişmezler

- **[ÇEKİRDEK]** Retry formu/makineyi YENİDEN OKUMAZ; düşen payload'ı birebir gönderir.
- **[ÇEKİRDEK]** Çevrimdışı sebebi `'link'` ise uçuş kimliğini BIRAK, `'server'` ise KORU; ayrım SAF katmanda (`shouldReleaseInFlight`), ekrandaki `if`'te değil.
- **[ÇEKİRDEK]** Çakışma 409'u (`POSSIBLE_DUPLICATE`/`CLIENT_TOKEN_COLLISION`) ekran varken toast basmaz (tek yüzey modal); EKRANSIZ replay'de DUYURULUR; belirsizlikte DUYUR.
- **[ÇEKİRDEK]** Toast metni 'kayıt oluşmadı' DİYEMEZ; önce doğrulatır: '… Listede yoksa tekrar girin.'
- **[ÇEKİRDEK]** `useNativeKeyboard` sistem decimal-pad'ini açar VE virgül→nokta normalizasyonunu korur ('40,5' → 40.5).
- **[ÇEKİRDEK]** Çok top okutan YÜZEY `trigger="tap"`, tek okuyup kapanan yüzey `auto`; ölçüt ekran adı değil yüzey (KK1 etiket-doğrulama tarayıcısı tap).
- **[ÇEKİRDEK]** Metraj kaynağı CİHAZ ayarıdır (`kk1ManualEntry` + `tamburCutMode`, ömür cihaz); bozuk disk değeri güvenli varsayılana düşer; setter ÖNCE state SONRA disk.
- **[PROFİL]** KK1_* doğuş modunda KK1 tezgah etiketini okutur (`loomBirth.ts`); okutma 4xx → RED, ağ/5xx → kabul + bağlanınca doğrula; kuyruk gövdesi `machineCode`/`weavingOrderId`/`warpBeamId`'i SÜZMEZ.
- **[ÇEKİRDEK]** Vekil 5xx'i (502/504/520–530 ya da `success` zarfsız 5xx) ulaşılamazlık, 429 ve backend 503 geçicidir: kuyruk kaydı DÜŞMEZ, Retry-After'a uyar; sınıflama tek kaynak `mobil/src/offline/transientHttp.ts`; istasyon mutationFn'leri ortak FIFO sınırlayıcıdan (≤3).

### Yasaklar

- **[ÇEKİRDEK]** `onMutate`'te yeşil 'kaydedildi' basma; online'da nötr 'Kaydediliyor…', yeşil yalnız `onSuccess`te.
- **[PROFİL]** Kalıcı düşen istasyon kaydını ANLIK TOAST ile duyur (`announceFailure`), kalıcı kuyruğa/kutuya yazma; ölü mektup kutusunu (`failedOps` + `OutboxModal` + `retryFailedOp`) geri getirme.
- **[ÇEKİRDEK]** Kalıcı düşüş köprüsü `MutationCache.onError`'da kalır; `setMutationDefaults`'a TAŞIMA.
- **[ÇEKİRDEK]** `NumpadHost` `autoActivate`'i aynı ekranda yalnız TEK alana ver.

### Tuzaklar

- **[ÇEKİRDEK]** 5xx 'ulaşılamadı' DEĞİLDİR; çevrimdışı hükmü yalnız YANITSIZ düşen istekle (link AND erişilebilirlik).
- **[ÇEKİRDEK]** Sunucu yoklama adresini HER çağrıda canlı oku (`getCurrentBaseUrl`); elle 'Şimdi dene' (`revalidateServer`) ve adres değişince otomatik yeniden değerlendirme bırak.
- **[ÇEKİRDEK]** Modalda sayı girişi `NumpadInput` + `useNativeKeyboard`; FAIL-SOFT yalnız Provider HİÇ yokken (`nativeMode = useNativeKeyboard || numpad === null`) — bayrak hâlâ zorunlu.

### Reçeteler

- **[ÇEKİRDEK]** Uçuş penceresi `INFLIGHT_REUSE_WINDOW_MS = 90_000` (backend ile BİLEREK aynı): AYNI yükte uçuştaki kimliği (token + damga) yeniden kullan, FARKLI yükte yeni top say; körü körüne collapse etme.
- **[ÇEKİRDEK]** Picker'da ekleme tetiği listenin İLK hücresindeki `leadingAction` kartıdır (`colors.action`); basılınca picker KAPANMAZ, form `quickAddSlot`'ta açılır; listenin üstüne ayrı outlined buton KOYMA.
- **[ÇEKİRDEK]** Ölçüm aleti varsa okuma TEK DOKUNUŞ: ⚖ → oku → DOĞRUDAN kaydet → kartta göster; araya input modalı KOYMA.

### Kararlar

- **[PROFİL]** Yazıcı kuyruğu (`printQueue`) kalır; kayıt kuyruğuyla aynı kefeye koyma.
- **[PROFİL]** Cihaz ayarı varsayılanları: KK1 manuel giriş KAPALI, Tambur kesim modu MANUEL.

## Geçersiz kılınan kurallar — bunlara UYMA

- Mükerrer ikiz sorgusu tx dışında/kilitsiz ve sunucu saatiyle pencere → GEÇERSİZ (yukarıdaki 8021 + `clientEnteredAt` kuralı).
- Ölü mektup kutusu (`failedOps`/`OutboxModal`/`retryFailedOp`) → GEÇERSİZ; köprü `MutationCache.onError` duruyor.
- "Çakışma 409'u hiç toast basmaz" mutlak hâli → GEÇERSİZ; ekransız replay'de duyurulur.
- "clientToken yalnız Roll/Order/WorkOrder", "~78 model/~35 enum" → GEÇERSİZ (15 model).
- "KK1 tarayıcısı `auto` kalır" → GEÇERSİZ; ölçüt yüzey.
- "Modalda tuşlar her zaman görünmez" → DARALDI; Provider yoksa fail-soft, bayrak yine zorunlu.

## Açık sorular

- `NumpadModalHost` (NumpadProvider.tsx) çağıransız: ölü mü planlı mı belirsiz.
- Kök CLAUDE.md'deki mükerrer "Süperadmin doğuşu P8" satırları — süperadmin kümesinin kararı.
- Ekransız çakışma dalında `failureToastText` güncel metni doğrulanmadı.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_barcode_reservation`, `test_perf_sayac_tx_disi`, `test_initial_entry_quality`, `test_istemci_token_uretimi`, `test_kk1_entry_sources`, `test_depo_roll_cancel_permission`⚠️, `test_duplicate_rolls`, `test_e2e_full_flow`, `test_item_quick_create`, `test_kk1_duplicate_guard`, `test_kk1_weight_flag`, `test_master_data_merge_race`, `test_perf_replay_erken`, `test_p1b_barcode_collision`⚠️, `test_roll_barcode`, `test_roll_entry_station`, `test_semi_finished_entry`, `test_tambur_manual_produce`, `test_token_replay_bogaz`, `test_token_replay_cancelled`, `test_token_replay_d3_yollari`, `test_token_replay_d5_yollari`, `test_token_replay_kimlik_tablosu`, `test_token_replay_zorlanmis_sira`, `test_work_session_stamping`, `test_kk1_roll_birth`, `test_kk1_muayene_dogum`, `test_role_template_catalog`, `test_feature_flag_contract`, `test_cek_bordro_taslak_token`

İstemci: `attemptToken.test.ts`, `fason-receive-attempt.test.ts`, `BarcodeScannerView.test.tsx`, `PickerModal.test.tsx`, `SyncStatusChip.test.tsx`, `rollHistoryFilter.test.ts`, `duplicateEntryChoice.test.ts`, `useReasonPresets.test.tsx`, `announceFailure.test.ts`, `announceWire.test.ts`, `backoff.test.ts`, `barcode.test.ts`, `deadline.test.ts`, `entryAttempt.test.ts`, `flushThenLogout.test.ts`, `mutations.test.ts`, `persistPolicy.test.ts`, `printQueue.test.ts`, `serverReachability.test.ts`, `sessionSwitch.test.ts`, `receiveAttempt.test.ts`, `EntryConflictModal.test.tsx`, `appUpdate.service.test.ts`, `sessionEntriesStore.test.ts`, `queryState.test.ts`, `loomBirth.test`, `kuyrukDayaniklilik.test.ts`, `api.transient.test.ts`, `deviceSettingsStore.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-05 — KK1 mükerrer top koruması — `CLAUDE-NOT-ARSIVI.md:151-162`
- 2026-08-12 — Kayıt kuyruğu kaldırıldı — `CLAUDE-NOT-ARSIVI.md:214-225`
