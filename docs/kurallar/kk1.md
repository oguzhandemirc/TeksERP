# KK1 · İdempotency · Çevrimdışı kuyruk

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 20 üye (8 kök, 4 alt-backend, 8 alt-mobil). Çekirdek zincir sağlam ve kodla doğrulandı: clientToken → atomik mükerrer tuzağı (8021) → uçuş penceresi → düşüş duyurusu. Üç bayat nokta: ① kök:59'daki 'çakışma 409'ları toast BASMAZ' kuralı 2026-08-29'da (68486d3b) kodda delindi — ekransız replay'de duyuruluyor, not güncellenmedi (EN RİSKLİ: not okunup kod geri çevrilirse BULGU-T3-001 geri gelir, top sessizce kaybolur); ② clientToken 'Roll/Order/WorkOrder' listesi 3 değil 15 model; şema sayıları ~78/~35 değil 124/68; ③ mobil 'KK1 auto kalır' parantezi bayat. kök:105 ve kök:107 aynı süperadmin P8 notunu iki kez taşıyor (mükerrer, ayrı kümenin kararı). R:2026-07-13 (parti), R:2026-08-12 top-listesi ve R:2026-08-26 (yayın) kendi kümelerinde kalır.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** "KK1'in işi olan top" kümesi TEK sabittir: backend `constants/kk1-entry-sources.ts` `KK1_ENTRY_SOURCES` ↔ mobil `KK1_LIST_ENTRY_SOURCES` birebir; karne/liste SQL'i kaynak listesini elle yazmaz (`Prisma.join`). · bekçi: `scripts/test_kk1_entry_sources.ts (DB'siz; küme eşitliği + dashboard literal yok)`
- **[ÇEKİRDEK]** Kayıt-yaratan uçlar istemci `clientToken`'ı taşır; kolon `String? @unique @db.Uuid`. Kapsam ÜÇ MODEL DEĞİL 15: Roll/Order/WorkOrder + SubcontractorReceipt, SwatchStockReduction, Sack, Shipment, ImportRun, WarehouseTransfer, GoodsReceipt, Invoice, Payment, CashTransaction, Cheque, PurchaseOrder. <sub>(CLAUDE.md:171, CLAUDE.md:148)</sub>
- **[ÇEKİRDEK]** İstemci token'ı MANTIKSAL DENEME başına BİR KEZ üretir ve tekrar denemede AYNI token'ı gönderir; mutate çağrısı başına yeni token üretmek korumayı boşa düşürür. · bekçi: `mobil/src/offline/entryAttempt.test.ts` <sub>(CLAUDE.md:171)</sub>
- **[ÇEKİRDEK]** Token yalnız sonucu BELİRSİZ bırakan hatadan sonra YAPIŞIR (ağ hatası / zaman aşımı / 5xx — timeout 'yazılmadı' demek DEĞİLDİR). Kesin 4xx'te YAPIŞMAZ: yapışırsa aynı payload'ı sonsuza dek gönderen bir 'Tekrar Dene' döngüsü kurulur. · bekçi: `mobil/src/offline/entryAttempt.test.ts` <sub>(CLAUDE.md:171)</sub>
- **[ÇEKİRDEK]** KK1 mükerrer tuzağı tx İÇİNDE koşar ve tx'in İLK ifadesi `pg_advisory_xact_lock(8021, hashtext(anahtar))`'dır. SIRA LOAD-BEARING: kilit `findFirst`'ten ÖNCE (sonra alınan kilit hiçbir şey kazandırmaz — TOCTOU) ve `generateRollBarcode`'dan da ÖNCE (ters sıra ABBA deadlock). · bekçi: `Teks-Erp/scripts/test_kk1_duplicate_guard.ts` <sub>(CLAUDE.md:54)</sub>
- **[ÇEKİRDEK]** Advisory kilit uzayları AYRI tutulur: 8021 = KK1 mükerrer tuzağı, 8022 = parti no üreteci. Aynı uzayı paylaşan iki alt sistem birbirini sessizce serileştirir; yeni uzay alırken envantere bak. <sub>(CLAUDE.md:54, CLAUDE.md:161)</sub>
- **[ÇEKİRDEK]** Mükerrer penceresi SUNUCU saatiyle değil operatörün bastığı anla (`Roll.clientEnteredAt`) ölçülür ve İKİ YÖNLÜ kurulur (since/until); damgası olmayan eski kayıt `createdAt`'e düşer. Tek yönlü `gte`, saati ileri kaymış cihazın satırlarını sonsuza dek ikiz gösterir. · bekçi: `Teks-Erp/scripts/test_kk1_duplicate_guard.ts` <sub>(CLAUDE.md:54)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Yeni tarihli notu kök CLAUDE.md'ye YAZMA — tam metin `docs/history/CLAUDE-NOT-ARSIVI.md`'ye, köke yalnız `[ÇEKİRDEK]`/`[PROFİL]` etiketiyle BAŞLAYAN özet satırı. Bir alana dokunmadan önce arşivdeki TAM notu oku; kökteki satır 'dur ve arşive bak' tetiğidir. <sub>(CLAUDE.md:35)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Sayaç bazlı kartela düşümünün idempotency'si ayrı `SwatchStockReduction` olay modelindedir; token ondadır, `KartelaDispatch`'te BİLİNÇLİ olarak YOKTUR. <sub>(CLAUDE.md:171, CLAUDE.md:148)</sub>
- **[ÇEKİRDEK]** SystemLog arşivi OTOMATİK (`jobs/archive-scheduler.ts`): start +60 sn, 24 saatte bir kontrol, 30 günde bir 6 aydan eskiyi taşır. Manuel `POST /api/admin/system-logs/archive {monthsToKeep:6}` yalnız acil disk baskısında (idempotent). <sub>(CLAUDE.md:282)</sub>
- **[ÇEKİRDEK]** Rol (yetki şablonu) kataloğu üç parçalıdır: tek kaynak `constants/role-template-catalog.ts` + boot uzlaştırması (izin uzlaştırmasından SONRA, FK sırası) + mekanik bekçi. Rol SAYISINI koda/nota sabitleme — kanonik sayı dosyadadır. · bekçi: `Teks-Erp/scripts/test_role_template_catalog.ts` <sub>(CLAUDE.md:225)</sub>

- **[ÇEKİRDEK]** İlk girişte kalite ÇİFT kolondur ve birlikte dolar/boşalır: verilen kod `qualityGrade` + `qualityGradeId` (katalog id'si, `resolveQualityGradeIdStrict`) olarak KOPYALANIR; alan yok · "" · whitespace üçü de NULL/NULL kalır ("Belirsiz" — sabit "1.KALITE" varsayılanı yazılmaz); bilinmeyen ve PASİF kod 400 ve top DOĞMAZ. Panel "Manuel Top Ekle" boş seçimi payload'dan düşürür (`"" → undefined`). · bekçi: `test_initial_entry_quality` (§1–§4, iki sonda) <sub>(d9 C2 bulgusu, 0c ölçtü 2026-09-14: kusur yok)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Script çıkışında `$disconnect()` TEK BAŞINA YETMEZ: havuzun `idleTimeoutMillis: 600_000`'i event loop'u 10 dk açık tutar, script 'bitti ama çıkmadı'da kalır (koşucu 180 sn'de SIGTERM → ZAMAN AŞIMI). İki geçerli kapanış: `process.exit(fail>0?1:0)` ya da `$disconnect()` + `pool.end()`. <sub>(CLAUDE.md:382)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Uzun rapor basan scriptlerde `pool.end()` tercih edilir — `process.exit` boruya yazarken stdout'u kırpabilir. <sub>(CLAUDE.md:382)</sub>
- **[ÇEKİRDEK]** Master Data CRUD için yeni kod yazma — `BaseController` + `BaseService` kullan (`searchFields` config'i yeterli). <sub>(CLAUDE.md:148)</sub>

### Kararlar

- **[PROFİL]** `kk1.duplicateGuardEnabled` varsayılan KAPALI (satır yoksa false) ve ENGELLEME değil ONAYLATMA: 409 `POSSIBLE_DUPLICATE` → `confirmDuplicate:true` ile geçilir (eşit metrajlı ardışık toplar meşru). `createInitialEntry`'de `opts.duplicateGuard` ile OPT-IN (F221) — dahili çağıran etkilenmez. · bekçi: `Teks-Erp/scripts/test_feature_flag_contract.ts` <sub>(CLAUDE.md:171)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Retry, formu/makineyi YENİDEN OKUMAZ; düşen payload'ı birebir gönderir (otomatik modda yeniden ölçmek metrajı değiştirip gereksiz 409 üretir). <sub>(CLAUDE.md:171)</sub>
- **[ÇEKİRDEK]** Çevrimdışı sebebi `'link'` ise uçuş kimliğini BIRAK (operatör çevrimdışı olduğunu biliyor, basışlar ayrı toplardır), `'server'` ise KORU (panik basışı olabilir). Ayrım ekrandaki bir `if`'te değil SAF katmanda (`shouldReleaseInFlight`) yaşar. · bekçi: `mobil/src/offline/entryAttempt.test.ts` <sub>(CLAUDE.md:54)</sub>
- **[ÇEKİRDEK]** Çakışma 409'u (`POSSIBLE_DUPLICATE`/`CLIENT_TOKEN_COLLISION`) EKRAN VARKEN toast basmaz — tek yüzeyi ekranın modalıdır; ama EKRANSIZ replay'de (kuyruktan diriltilen kayıt) DUYURULUR, yoksa 409 hiçbir yerde görünmez ve fiziksel top sistemde doğmaz. Belirsizlikte DUYUR. · bekçi: `mobil/src/offline/announceWire.test.ts` <sub>(CLAUDE.md:59)</sub>
- **[ÇEKİRDEK]** Toast metni 'kayıt oluşmadı' DİYEMEZ — zaman aşımında sunucu COMMIT etmiş olabilir. Metin ÖNCE doğrulatır: '… Listede yoksa tekrar girin.' · bekçi: `mobil/src/offline/announceFailure.test.ts` <sub>(CLAUDE.md:59)</sub>
- **[ÇEKİRDEK]** `useNativeKeyboard` sistem decimal-pad'ini açar VE virgül→nokta normalizasyonunu korur ('40,5' → 40.5). <sub>(CLAUDE.md:332)</sub>
- **[ÇEKİRDEK]** Çok top okutan YÜZEY `trigger="tap"` kullanır (kamera kendiliğinden okumaz); tek okuyup kapanan yüzey `auto` kalır. Ölçüt EKRAN ADI DEĞİL YÜZEY — KK1'in etiket-doğrulama tarayıcısı da tap. Sorun 'yanlış okuma' değil 'İSTENMEDEN okuma'dır. · bekçi: `mobil/src/components/BarcodeScannerView.test.tsx` <sub>(CLAUDE.md:415)</sub>
- **[ÇEKİRDEK]** Metraj kaynağı (elle ↔ makineden oku) ekran state'i değil CİHAZ ayarı: `kk1ManualEntry` + `tamburCutMode`; ömür OTURUM değil CİHAZ (operatör değişse de kalır). Diskteki BOZUK değer güvenli varsayılana düşer; setter ÖNCE state'i SONRA diski yazar. · bekçi: `mobil/src/store/deviceSettingsStore.test.ts` <sub>(CLAUDE.md:365, CLAUDE.md:379)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `onMutate`'te yeşil 'kaydedildi' basma — operatörü tekrar basmaya davet eder. Online'da nötr 'Kaydediliyor…', yeşil yalnız operatörün BEKLEDİĞİ deneme onaylanınca (`onSuccess`). <sub>(CLAUDE.md:54)</sub>
- **[PROFİL]** Kalıcı düşen istasyon kaydı ANLIK TOAST ile duyurulur (`announceFailure`) ve HİÇBİR kalıcı kuyruğa/kutuya yazılmaz. Ölü mektup kutusunu (`failedOps` + `OutboxModal` + `retryFailedOp`) geri getirme — iki bambaşka olayı tek kırmızı başlıkta topluyordu. · bekçi: `mobil/src/offline/announceFailure.test.ts` <sub>(CLAUDE.md:59)</sub>
- **[ÇEKİRDEK]** Kalıcı düşüş köprüsü `MutationCache.onError`'da kalır; `setMutationDefaults`'a TAŞINAMAZ — component `onError` onu ezer (query-core option sırası) ve kayıt 'bazen' yakalanır. · bekçi: `mobil/src/offline/mutations.test.ts` <sub>(CLAUDE.md:59)</sub>
- **[ÇEKİRDEK]** `NumpadHost` `autoActivate`'i aynı ekranda yalnız TEK alana ver — ikisine birden verilirse kazananı MOUNT SIRASI belirler ve operatör metraj beklerken tuşlar sessizce En'i değiştirir. <sub>(CLAUDE.md:56)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** 5xx 'sunucuya ulaşılamadı' DEĞİLDİR — yanıt geldiyse sunucu cevap vermiştir. Çevrimdışı hükmü yalnız bir isteğin YANITSIZ düşmesiyle verilir (link AND erişilebilirlik); aksi hâlde tek hatalı uç tüm kuyruğu durdurur. · bekçi: `mobil/src/offline/serverReachability.test.ts` <sub>(CLAUDE.md:54)</sub>
- **[ÇEKİRDEK]** Sunucu yoklama adresi HER çağrıda canlı okunur (`getCurrentBaseUrl`), derleme zamanı sabitine bağlanmaz; ayrıca elle 'Şimdi dene' (`revalidateServer`) ve adres değişince otomatik yeniden değerlendirme bırakılır — yoksa uygulama asla çevrimiçiye dönmez. · bekçi: `mobil/src/offline/serverReachability.test.ts` <sub>(CLAUDE.md:59)</sub>
- **[ÇEKİRDEK]** Modal içinde sayı girişi `NumpadInput` + `useNativeKeyboard`: büyük numpad bir `NumpadHost` ister, modalda host yoktur, tuşlar görünmez kalır. FAIL-SOFT yalnız Provider HİÇ YOKKEN devreye girer (`nativeMode = useNativeKeyboard || numpad === null`) — bayrak hâlâ zorunlu. <sub>(CLAUDE.md:332)</sub>

### Reçeteler

- **[ÇEKİRDEK]** İstemci uçuş penceresi `INFLIGHT_REUSE_WINDOW_MS = 90_000` ve backend penceresiyle BİLEREK AYNIdır: uçuşta AYNI yük gelirse uçuştaki kimliği (token + damga) yeniden kullan, FARKLI yük gelirse yeni top say. Körü körüne collapse etmek sıradaki GERÇEK topu düşürür. · bekçi: `mobil/src/offline/entryAttempt.test.ts` <sub>(CLAUDE.md:54)</sub>
- **[ÇEKİRDEK]** Picker'dan seçenek eklenebiliyorsa tetik listenin İLK hücresindeki `leadingAction` kartıdır (diğer kartlarla aynı geometri, `colors.action` mor zemin — marka indigo'su 'seçili kart' vurgusudur); basılınca picker KAPANMAZ, asıl form `quickAddSlot`'ta açılır. Listenin üstüne ayrı outlined buton KOYMA. <sub>(CLAUDE.md:315)</sub>
- **[ÇEKİRDEK]** Ölçüm aleti varsa okuma TEK DOKUNUŞ olmalı: ⚖ → oku → DOĞRUDAN kaydet → kartta göster. Araya input modalı KOYMA (operatörün eli maldadır); yanlışsa tekrar basar, idempotent üzerine yazar. <sub>(CLAUDE.md:327)</sub>

### Kararlar

- **[PROFİL]** Yazıcı kuyruğu (`printQueue`) DURUYOR ve kaldırılmaz — 'top KAYITLI, etiketi çıkmadı' ayrı ve KALICI bir yüzeydir; kayıt kuyruğuyla aynı kefeye koyma. · bekçi: `mobil/src/offline/printQueue.test.ts` <sub>(CLAUDE.md:59)</sub>
- **[PROFİL]** Cihaz ayarı varsayılanları: KK1 manuel giriş KAPALI, Tambur kesim modu MANUEL. · bekçi: `mobil/src/store/deviceSettingsStore.test.ts` <sub>(CLAUDE.md:379)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:2026-07-14__idempotency-2026-07-14` → `R:2026-08-05__2026-08-05-kk1-mukerrer-korumasi`: Mükerrer tuzağının UYGULAMASI değişti: ikiz sorgusu tx DIŞINDA ve kilitsizdi (TOCTOU), pencere SUNUCU saatiyle ölçülüyordu. Artık guard tx İÇİNDE, tx'in İLK ifadesi pg_advisory_xact_lock(8021,hashtext(key)) ve pencere Roll.clientEnteredAt ile İKİ YÖNLÜ. Sözleşme (90 sn, aynı operatör/makine, onaylatma) aynı kaldı. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-05__2026-08-05-kk1-mukerrer-korumasi` → `R:2026-08-12__2026-08-12-kayit-kuyrugu-kaldirildi`: Kalıcı düşüşün VARIŞ NOKTASI değişti: 08-05'te MutationCache köprüsü kalıcı 'ölü mektup kutusuna' (failedOps + OutboxModal + retryFailedOp) yazıyordu; kutu SİLİNDİ, yerine anlık toast (announceFailure) geçti. Köprünün kendisi (MutationCache.onError) DURUYOR — setMutationDefaults'a taşınamaz kuralı da aynen geçerli. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-12__2026-08-12-kayit-kuyrugu-kaldirildi` → `KOD 68486d3b (2026-08-29) — mobil/src/offline/announceFailure.ts`: 'Çakışma 409'ları (POSSIBLE_DUPLICATE/CLIENT_TOKEN_COLLISION) toast BASMAZ — tek yüzey modal' kuralı DARALTILDI: modal yalnız kaydı yapan ekran ayaktayken çizilebilir; uygulama kapanıp açılınca kuyruktan replay edilen kaydın ekranı yoktur → çakışma da DUYURULUR (ekranYok). Belirsizlikte duyur. Kök CLAUDE.md:59 hâlâ eski mutlak hâli yazıyor. ✅ çürütmeden geçti
- **KISMI** `B:undated__78-model-35-enum-idempotency-katmani` → `KOD ÖLÇÜMÜ (2026-09-05) — Teks-Erp/prisma/schema.prisma`: Envanter rakamları ve idempotency kapsamı bayat: '~78 model, ~35 enum' → 124 model / 68 enum; 'clientToken (Roll/Order/WorkOrder)' → 15 model (Roll, Order, WorkOrder, SubcontractorReceipt, SwatchStockReduction, Sack, Shipment, ImportRun, WarehouseTransfer, GoodsReceipt, Invoice, Payment, CashTransaction, Cheque, PurchaseOrder). Kuralın kendisi (kolon @unique) geçerli. ✅ çürütmeden geçti
- **KISMI** `M:2026-08-05__cok-top-okutan-her-ekran` → `KOD (mobil/src/screens/Modules/KK1/KK1Screen.tsx:2347)`: Notun parantezi 'Tek okuyup kapanan ekranlar (KK1 / Tambur / Kartela / refakat kartı) auto kalır' KK1 için artık yanlış: KK1'in etiket-doğrulama (scan-back) tarayıcısı continuous + trigger="tap". Kuralın kendisi geçerli — ölçüt EKRAN ADI değil YÜZEY: çok-okutmalı yüzey tap, tek okuyup kapanan auto. ✅ çürütmeden geçti
- **KISMI** `M:undated__modal-icinde-sayi-girisi` → `KOD (mobil/src/components/NumpadInput.tsx:67-71)`: 'Modalda host yoktur, tuşlar görünmez kalır' artık TAM doğru değil: NumpadInput FAIL-SOFT — Provider hiç yoksa (numpad === null) sistem klavyesine düşer. Ama fail-soft yalnız PROVIDER yokken devreye girer; Provider var / Host çizilmemişse tuşlar yine görünmez → useNativeKeyboard bayrağı hâlâ zorunlu, 'tek savunma hattı' olmaktan çıktı. ✅ çürütmeden geçti

## Açık sorular

- NumpadModalHost (NumpadProvider.tsx:161) export edilmiş ama HİÇBİR çağıranı yok (git grep → yalnız tanım). Telefon-landscape numpad yolu ölü mü, planlı mı BELİRSİZ; 'modal içinde NumpadInput' kuralına etkisi ölçülemedi.
- kök CLAUDE.md:105 ve :107 aynı tarihli/aynı konulu iki 'Süperadmin doğuşu P8' satırı taşıyor (:107 :105'in alt kümesi). Hangisinin silineceği süperadmin kümesinin kararı — bu kümede çözülmedi.
- R:2026-08-12 kayıt kuyruğu notundaki 'toast metni kayıt oluşmadı DİYEMEZ' kuralının ekransız çakışma dalındaki güncel metni okunmadı (failureToastText'in ilk dalı kısaltılmış görüldü); metin sözleşmesinin bugünkü tam hâli doğrulanmadı.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_barcode_reservation`, `test_initial_entry_quality`, `test_kk1_entry_sources`, `test_depo_roll_cancel_permission`⚠️, `test_duplicate_rolls`, `test_e2e_full_flow`, `test_item_quick_create`, `test_kk1_duplicate_guard`, `test_kk1_weight_flag`, `test_master_data_merge_race`, `test_p1b_barcode_collision`⚠️, `test_roll_barcode`, `test_roll_entry_station`, `test_semi_finished_entry`, `test_tambur_manual_produce`, `test_token_replay_cancelled`, `test_work_session_stamping`

İstemci: `fason-receive-attempt.test.ts`, `BarcodeScannerView.test.tsx`, `PickerModal.test.tsx`, `SyncStatusChip.test.tsx`, `rollHistoryFilter.test.ts`, `duplicateEntryChoice.test.ts`, `useReasonPresets.test.tsx`, `announceFailure.test.ts`, `announceWire.test.ts`, `backoff.test.ts`, `barcode.test.ts`, `deadline.test.ts`, `entryAttempt.test.ts`, `flushThenLogout.test.ts`, `mutations.test.ts`, `persistPolicy.test.ts`, `printQueue.test.ts`, `serverReachability.test.ts`, `sessionSwitch.test.ts`, `receiveAttempt.test.ts`, `EntryConflictModal.test.tsx`, `appUpdate.service.test.ts`, `sessionEntriesStore.test.ts`, `queryState.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-05 · 2026-08-05 — KK1 mükerrer top koruması TAMAMLANDI: guard atomik + pencere OPERATÖRÜN saatiyle + "sunucu ölü" a — `CLAUDE-NOT-ARSIVI.md:151-162`
- 2026-08-12 · 2026-08-12 — KAYIT KUYRUĞU KALDIRILDI: kalıcı düşüş artık DUYURULUR, saklanmaz + KK1'de tek kırmızı yüzey — `CLAUDE-NOT-ARSIVI.md:214-225`