# Tambur · Finalize · Kesim · Geri alma

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 24 üye: 12 kök, 4 arşiv, 8 mobil. Çekirdek finalize/WO/undo/plan-kapısı notları (N7,N8,N16,N18,N21) kodla CANLI. Bayat 4 yer: (1) 'Roll split SADECE Tambur'da' — fason kısmi sevk 2026-07-15'ten beri Tambur dışı split yaratıyor (createFasonShipChild); 'çocuk Tambur adımını damgalar' Top Kesme/fason çocuğunda yanlış (null). En riskli çelişki; kök notu yeniden yazılmalı. (2) N10/N11 'sebep manualReasons.ts'ten' → 2026-08-19 DB'ye taşındı. (3) N19 alt paragrafı 'bayrak+eşik cihazda' başlıkla ezildi. (4) N12 'KK1 auto kalır' — KK1 etiket-doğrulama artık tap. N21 aşım koruması N16'yı kısmen genişletti; N22 bayrağı N10'un 'hiç parti→null'unu PROFİL'e çevirdi. Mobil 8 not kök satırı gerektirmez (mobil/CLAUDE.md'de kalır); N13/N14/N20 kendi kümelerinin satırıyla temsil edilir.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** `RollOperation` izi geri alınırken SİLİNMEZ, `revokedAt`/`revokedById`/`revokeReason` ile damgalanır (tambur-undo · fason iptal · manuel taşıma QC void — yedi yol). Okuyan her yol — ilişki okumaları ve üçlü anahtarlı `upsert` DAHİL — `ACTIVE_OPERATION` tek kaynağından süzer; istisnalar (yedek etki ölçümü · iki silme guard'ı · rota düzenleme adım geçmişi · bölmede iz taşıma) gerekçesiyle koda yazılıdır. · bekçi: `test_roll_operation_revoke.ts` <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** `RollMovement` satırı geri alınırken SİLİNMEZ, damgalanır (kurşun yeniden açma · fason kabul iptali · fason aktarım geri alma · manuel taşıma); adım durumu yalnız AKTİF hareketlerden sayılır ve geri alınmış satır ne kapatılır ne yeniden açılır. · bekçi: `test_roll_movement_revoke.ts` <sub>(arşiv:2026-09-11 B-4b)</sub>
- **[ÇEKİRDEK]** Her rotanın SON adımı topu finalize eder (`finalizeRollsAtLastStep`) — Tambur özel değil; top⟺Tambur, açık kumaş⟺diğer istasyonlar; `Roll.form` otomatik; `qualityGrade` NULLABLE (yalnız kalite istasyonları belirler, `finalizedAt` kaliteyle aynı olaydan). · bekçi: `scripts/test_finalize_last_step.ts` <sub>(CLAUDE.md:113, arşiv:333)</sub>
- **[ÇEKİRDEK]** Finalize, iş emrini topun `currentStep`'inden çözer — köken `producedInStep`'ten DEĞİL (Top Kesme çocuğu `producedInStepId=null` doğar). · bekçi: `scripts/test_tambur_finalize_wo_guard.ts §4` <sub>(CLAUDE.md:180)</sub>
- **[ÇEKİRDEK]** İş emri kapaması YALNIZ terminal-guard'lı `completeWorkOrderIfStepsDone` ile (COMPLETED/CANCELLED/SUPERSEDED notIn); CANCELLED/SUPERSEDED asla COMPLETED'a dirilmez; iptal/devredilmiş WO adımındaki topun finalize/kesimi reddedilir (pre-tx + kilit altı taze guard). · bekçi: `scripts/test_wo_terminal_guard.ts + test_tambur_finalize_wo_guard.ts §1` <sub>(CLAUDE.md:180)</sub>
- **[ÇEKİRDEK]** Movement kapanışında `qtyOut = qtyIn` (istasyona giren işlenmiş metraj); finalize öncesi kesimler hacimden düşmez; WIP raporu qtyIn/qtyOut farkını 'kayıp' diye BASMAZ. · bekçi: `yok (wip-scorecard.report.service.ts:6 yorumu; test_wip_scorecard dolaylı)` <sub>(CLAUDE.md:180, arşiv:333)</sub>
- **[ÇEKİRDEK]** İş emri depo topunu da tüketebilir: `attachRolls`/`quickStart` STOCK/WAREHOUSE/A1_STOCK kabul eder (`acceptedRollStatuses`); atomik `updateManyAndReturn` claim ile. · bekçi: `yok (2026-08-25 rework notunun bekçileri ayrı kümede)` <sub>(CLAUDE.md:113)</sub>
- **[ÇEKİRDEK]** Split çocuğu `parentRollId` + YENİ barkod + `entrySource=TAMBUR_SPLIT`; parti/depo parent'tan MİRAS, giriş istasyonu/kat/`producedInStepId` MİRAS DEĞİL. Beş yol: Tambur finalize · cutOpenFabric · finalizeOpenFabric · Top Kesme (cutWarehouseRoll/finalizeWarehouseCut) · fason kısmi sevk. · bekçi: `scripts/test_tambur_finalize_wo_guard.ts §3 + test_tambur_cut_idempotency.ts` <sub>(CLAUDE.md:179, CLAUDE.md:180, arşiv:80)</sub>
- **[ÇEKİRDEK]** `producedInStepId` damgası: adıma bağlı kesimlerde (finalize · cutOpenFabric · finalizeOpenFabric) işlemin YAPILDIĞI Tambur adımı (parent kalıtımı değil); depo topu kesimi (Top Kesme) ve fason kısmi sevk çocuğunda NULL — o yüzden WO çözümü currentStep'ten. · bekçi: `scripts/test_tambur_finalize_wo_guard.ts §3-§4` <sub>(CLAUDE.md:179, CLAUDE.md:180)</sub>
- **[ÇEKİRDEK]** `RollError` PROCESS_QC'de (kursun-qc + kurşun bypass `kursunFinish`) ve Tambur'da açılır; Tambur kararıyla kapanır (`isProcessed=true`, `actionTaken=CUT|NO_CUT`); Tambur dışı `NO_CUT` idari kapanış olabilir. Kapanış semantiği ÇEKİRDEK, hangi istasyonda açıldığı PROFİL (Faz B). <sub>(CLAUDE.md:176, CLAUDE.md:58)</sub>
- **[ÇEKİRDEK]** Fason adımına manuel taşıma `AT_SUBCONTRACTOR` YAPMAZ — mal içeride bekler, çıkış Fason Sevk ile; fason dönüşü top (`entrySource=SUBCONTRACTOR_RETURN`) geri boyahaneye alınıp yeniden sevk+kabul edilebilir, ek engel konmaz. · bekçi: `scripts/test_manual_move.ts (AT_SUBCONTRACTOR dalı :164)` <sub>(CLAUDE.md:127)</sub>
- **[ÇEKİRDEK]** Kat `Roll.foldType` KALICI kolondur (JSON'da değil); MİRAS ALINMAZ — kesimde SEÇİLEN yazılır; alan hiç gönderilmezse parent→plan fallback'i sözleşme boşluğudur, miras DEĞİL; kanoniklik ZORUNLU (`resolveFoldTypeForWrite`/`normalizeFoldType` — ham değer filtrede sessiz 0 satır). · bekçi: `scripts/test_roll_fold_and_reason.ts + test_fold_edit_and_label.ts` <sub>(CLAUDE.md:49, arşiv:80, arşiv:192)</sub>
- **[ÇEKİRDEK]** Giriş sebebi `Roll.entryReason` KOLONUNDAN okunur — audit tek kaynak olamaz (`archive-scheduler` 6 ayda arşive taşır); audit yazımı kalır, kolon boşsa eski kayıt için audit'e düşülür; geri doldurma script'i dry-run varsayılan. · bekçi: `scripts/test_roll_fold_and_reason.ts` <sub>(CLAUDE.md:49, arşiv:80)</sub>
- **[ÇEKİRDEK]** Elle eklenen top PARTİSİZ doğmaz: tek açık parti → sormadan bağla · birden çok → 400 `BATCH_REQUIRED` + liste (reddeden taraftan) · hiç yok → NULL, `batch.autoCreateEnabled` AÇIKSA sunucu partiyi FAZ 2 tx'inde açar; 'açık' VERİYE dayanır (K18); karar yanıtta + audit `batchSource`. · bekçi: `scripts/test_tambur_manual_batch.ts + test_quality_batch_flags.ts` <sub>(CLAUDE.md:49, arşiv:80, arşiv:2185)</sub>
- **[ÇEKİRDEK]** Metraj geri koyma İKİ DALDA FARKLI: üretim akışı (cutOpenFabric) yalnız `currentQty` + AŞIM KORUMASI (restore > initialQty ise initialQty yukarı + deftere OVERAGE/TAMBUR_UNDO_RESTORE); depo kesimi currentQty ve initialQty BİRLİKTE — tek taraf yazılırsa sahte aşım/sessiz sapma. · bekçi: `scripts/test_tambur_undo.ts §5 + §11` <sub>(CLAUDE.md:58, CLAUDE.md:81)</sub>
- **[ÇEKİRDEK]** SENKRON SÖZLEŞMESİ: restore-toplamına giren HER kaynak `applyFull` 5b terslemesine de eklenir (yoksa metraj geri konur, sapma satırı canlı kalır, dönem raporu aynı metrajı İKİ KEZ görür); `computeRestoredQty` çocuk-kapsamlı `TAMBUR_UNDO_SINGLE` düzeltmelerini de sayar. · bekçi: `scripts/test_tambur_undo.ts` <sub>(CLAUDE.md:58)</sub>
- **[ÇEKİRDEK]** Renk/en hedeften sapan top depoya ONAYLA iner: 409 `PLAN_MISMATCH` → `confirmMismatch`; top başına BİR soru; audit + `RollPlanDeviation` çağıran tx'inde; üç yol TEK helper `tambur-plan-gate.helper`; eşik ±10 cm (PROFİL); scrap/discard + renk-hedefsiz WO kapı DIŞI; fason onayı tekrar SORULMAZ. · bekçi: `scripts/test_tambur_plan_gate.ts` <sub>(CLAUDE.md:71, CLAUDE.md:74)</sub>
- **[ÇEKİRDEK]** Hedef renk değişikliği (Düzenle + Rengi Değiştir) TEK bekçi `assertTargetColorChange`; kilit ADIMA değil MALA bakar (COLOR_PARTIAL_CONFIRM / COLOR_DYED_BLOCKED); rota kapsaması UYARIR (`ApiResponse.warnings`); 'renk veren adım' tek yüklem `stepCanApplyColor`. · bekçi: `scripts/test_wo_target_color_guard.ts (59) — rota-renk kümesi` <sub>(CLAUDE.md:74)</sub>
- **[ÇEKİRDEK]** Kurşun dağıtımı ön koşul DEĞİL: Tambur okutması dağıtılmamış kurşunu da kapatır (bayrak AÇIK **ve** adım bypass'a uygun — `assertKursunTabletMayWrite` ile AYNI kaynak); makine atfı UYDURULMAZ (`machineId=null` + amber bant); marker `KURSUN_BYPASS_FINISHED:UNASSIGNED:` BASE ön ekiyle. · bekçi: `scripts/test_kursun_unassigned_close.ts` <sub>(CLAUDE.md:52)</sub>
- **[ÇEKİRDEK]** Rapor çıpası `Roll.finalizedAt` (üretim çıkışı) ve `statusChangedAt` (yaşlandırma) — TRIGGER yazar (40+ çağrı noktası, uygulama koduna güvenilmez); kaynak statü listesinde SHIPPED/CANCELLED BİLEREK YOK (storno bugünün karnesine sokar); damga üzerine yazılır (kaliteyle aynı olay). · bekçi: `scripts/test_quality_scorecard.ts (30) + test_db_invariants.ts §6` <sub>(arşiv:333)</sub>
- **[PROFİL]** `quality.gradeRequiredEnabled` DAR kapsam (KK1 · Tambur kalan-kuyruk · depo kesimi · WO kapanışının satılabilir dalları); fason kabulü · son-adım finalize · `cutOpenFabric` · `attachRolls` DIŞARIDA (negatif sondayla çivili) — genişletmek 'sıfır fark' ihlali, bayrak AÇILDIĞI gün patlar. · bekçi: `scripts/test_quality_batch_flags.ts` <sub>(arşiv:2185)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Ölü top kümesi TEK kaynak `K18_DEAD_STATUSES` (SUBCONTRACTOR_CONSUMED, TAMBUR_CONSUMED, KARTELA_CONSUMED, CANCELLED); `SCRAP` BİLEREK YOK — fire gerçek karardır, partiyi KAPATMAZ ve karneden düşmez; liste/lane/rapor filtresinde elle statü listesi kopyalanmaz. · bekçi: `scripts/test_tambur_manual_batch.ts (K18↔SCRAP ayrımı); test_quality_scorecard.t` <sub>(CLAUDE.md:180, CLAUDE.md:49, arşiv:80)</sub>
- **[ÇEKİRDEK]** CANCELLED/SUPERSEDED iş emrinde manuel taşıma REDDEDİLİR (409 + önizlemede `woBlocked`); tek kaynak `workorder-manual-move.service.manualMoveWoBlockReason` (Tambur manual da onu import eder); doğru yol topu yeni iş emrine bağlamak. · bekçi: `scripts/test_manual_move_field_continuity.ts` <sub>(CLAUDE.md:127)</sub>
- **[ÇEKİRDEK]** Aşım kesimi 0'da tıkanmaz: aşım dallarının claim WHERE'ine `currentQty > 0` KONMAZ (cutOpenFabric + cutWarehouseRoll — çifte-harcama koruması 0'ın altında anlamsız); normal dal `gte` durur; her sıfır-üstü kesim çocuk + sapma satırı üretir. · bekçi: `scripts/test_tambur_over_quantity.ts (13)` <sub>(CLAUDE.md:56)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Etikete katalog KODU basılır (ad değil); kat girilmemiş topta `present:false` → şablonda dursa da atlanır; ÇUVAL etiketinde kat YOK; PPLB beklentisi emitter'ın kendi dönüşümüyle (`cleanCtlCp1254`) kurulur; 'katalogda yok' sondası kataloğa eklenebilecek GERÇEK kod kullanamaz. · bekçi: `scripts/test_fold_edit_and_label.ts (16)` <sub>(arşiv:192)</sub>
- **[PROFİL]** Elle top ekleme sebebi hazır katalogdan seçilir (artık DB `ReasonPreset`; `manualReasons.ts` yalnız APK zemini); serbest metin 'Diğer'/üstte kalır; sahada sürekli 'Diğer' seçiliyorsa katalog yanlıştır, liste büyütülmez. · bekçi: `scripts/test_reason_presets.ts (sebep kümesi)` <sub>(CLAUDE.md:49, arşiv:80)</sub>

### Kararlar

- **[ÇEKİRDEK]** 'Durum Düzelt' / `recover-to-production` KALDIRILDI; IN_PRODUCTION'da takılı top için tek yol 'Kurtar' (`rescueStuckRoll`, `roll:manual-adjust`) — WAREHOUSE'a çeker. <sub>(CLAUDE.md:113)</sub>
- **[ÇEKİRDEK]** Mutabakat kırmızısı ÜÇE ayrılır (kod hatası · iş kararı bekleyen veri · sorgunun kör noktası); `test_consistency` salt-okunur ve CANLI DB'ye karşı koşulur; eski sapma satırları toplu UPDATE ile düzeltilmez, §13 DARALTILMAZ; adım durumu tarihsel olgudur (§20), veriye dokunulmaz. · bekçi: `scripts/test_consistency.ts (salt-okunur kapı)` <sub>(CLAUDE.md:81)</sub>
- **[ÇEKİRDEK]** Tambur 'Sipariş Bağla' `workorder:write`; uyumsuz satır yalnız süpervizörde `order-links/override` zinciri (workorder:write AND roll:manual-adjust; plan+toplar+bağ); kumaş (cins) farkı HER ZAMAN red; zincir tek tx DEĞİL — bilinçli. · bekçi: `yok (is-emri-siparis-bag kümesinde)` <sub>(CLAUDE.md:71)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** `SINGLE_RESTORE` ('İş Emrine Geri Al') tek topun metrajıyla dirilme: çocuk iptal, kaynak adıma dirilir, kapalı WO+kart yeniden açılır; KARDEŞLERE dokunulmaz; kapanış sapmaları TERSLENMEZ; `RollError` yeniden açılmaz; ek izin/sebep istemez; arşivli kaynakta ön seçim yok. · bekçi: `scripts/test_tambur_undo.ts` <sub>(CLAUDE.md:58)</sub>

### Yasaklar

- **[ÇEKİRDEK]** İş emri ÜRETİM ÇIKTISI kümesi tek kaynak `workorder.service.producedOutputWhere` (Tambur birinci-nesil çocukları + çocuğa bölünmeden final statüye ulaşan finalize çıktıları); liste ÇIKAN metriği ve detay `producedRolls` aynı kümeyi kullanır. · bekçi: `scripts/test_produced_buckets.ts + test_consistency_derived.ts` <sub>(CLAUDE.md:180)</sub>

### Reçeteler

- **[ÇEKİRDEK]** 'Konumu Düzelt' topu IN_PRODUCTION + `currentStepId=hedef` bırakır, hedef adım ACTIVE, COMPLETED WO IN_PROGRESS'e dirilir ve kart yeniden aktifleşir; geri taşımada hedef-sonrası kalite/kurşun kararları VOID (grade→Belirsiz), hedef-sonrası hareketler geri alınır (silinmez, `revokedAt` damgası), SKIPPED→PENDING. · bekçi: `scripts/test_manual_move_field_continuity.ts` <sub>(CLAUDE.md:127)</sub>
- **[ÇEKİRDEK]** Kesim çocukları `createdMachineId` damgası alır (dört TAMBUR_SPLIT doğum yolu; controller `stamp?.machineId ?? req.device?.machineId`); eski kesimler geriye doldurulmadı (entryStationId emsali) — süzgeçte görünmezler, dürüst. · bekçi: `scripts/test_tambur_cut_idempotency.ts (+1 damga)` <sub>(CLAUDE.md:56)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Mobil filtre şeridi sözleşmesi: `last7` BUGÜNÜ içerir; özel aralık kısa yolu EZER; query anahtarı `itemLabel`/`now`dan bağımsız; gün sınırı cihazın yerel günü; filtre yoksa tek parametre üretilmez; Tambur'da modal kapanınca filtre sıfırlanır; tarih seçici PAKETİ EKLENMEZ. · bekçi: `mobil/src/components/filters/rollHistoryFilter.test.ts (16)` <sub>(CLAUDE.md:56)</sub>
- **[ÇEKİRDEK]** Responsive: tablet yatayda iki sütun/split view, telefon dikeyde tek sütun; yön kilidi YOK (`orientation: default`), her ekran iki yönde çalışmalı. <sub>(CLAUDE.md:280)</sub>
- **[ÇEKİRDEK]** Tambur ana kesim ve 'Top Kesme' modalı TEK tercihi paylaşır (`recutMode = cutMode`, aynı metre makinesi); yan etki BİLİNÇLİ: modalda mod değişince ana kesim de değişir. Varsayılanlar: KK1 manuel KAPALI, Tambur MANUEL [PROFİL]; bozuk disk değeri güvenli varsayılana; setter önce state sonra disk. · bekçi: `mobil/src/store/deviceSettingsStore.test.ts (recutMode için yok)` <sub>(CLAUDE.md:375, CLAUDE.md:379)</sub>
- **[ÇEKİRDEK]** Çok top okutan her ekran `trigger="tap"` (kamera kendiliğinden okumaz — sorun 'istenmeden okuma', onay değil taramayı KAPATARAK çözülür): Hızlı İş Emri, Fason Sevk, KK1 etiket-doğrulama. Tek okuyup kapananlar (Tambur, Kartela, refakat kartı) `auto`. · bekçi: `mobil/src/components/BarcodeScannerView.test.tsx` <sub>(CLAUDE.md:415)</sub>
- **[PROFİL]** Kısa kesim → A1: bayrak+eşik FABRİKA ayarı; cihazda 3 durumlu `tamburShortCutA1Override` (server|on|off, bilinmeyen→server); birleştirme TEK yer `resolveShortCutConfig`; 'on'da eşik cihazınki, fabrika eşiğine SIZMAZ; override yalnız süpervizöre (`roll:manual-adjust || mobile:tambur-duzelt`). · bekçi: `mobil/src/screens/Modules/Tambur/resolveShortCutConfig.test.ts` <sub>(CLAUDE.md:335)</sub>
- **[ÇEKİRDEK]** Kısa kesim kuralının TAMAMI `Tambur/shortCutQuality.ts`te — üç yol (elle yazım · makine ölçümü · 'kalanı kes') aynı fonksiyon; yalnız VARSAYILAN kaliteyle ateşler (seçilmiş A1/FIRE'a dokunmaz); eşik üstüne çıkınca yalnız OTOMATİK A1 geri döner (`shortCutRevert`); A1 katalogdan, yoksa fail-closed. · bekçi: `mobil/src/screens/Modules/Tambur/shortCutQuality.test.ts (12)` <sub>(CLAUDE.md:335)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `NumpadHost` `autoActivate` aynı ekranda yalnız TEK alana verilir — ikisine verilirse kazananı MOUNT SIRASI belirler ve tuşlar sessizce yanlış alanı değiştirir; hedef boşalırsa manuel modda metraja dönen effect korunur. <sub>(CLAUDE.md:56)</sub>
- **[ÇEKİRDEK]** Tüm istasyonlar (Tambur, KK1) okuma için HAL'i kullanır; eski `hardware.service.ts` mock'u KALDIRILDI, geri getirilmez; simülasyon per-cihaz veri bayrağı (`simulate`), donanım yoksa NET HATA. <sub>(CLAUDE.md:223)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Modal içinde sayı girişi `NumpadInput` + `useNativeKeyboard` — büyük özel numpad bir `NumpadHost` ister, modalda host YOK, tuşlar görünmez kalır; `useNativeKeyboard` sistem decimal-pad'ini açar ve virgül→nokta normalizasyonunu korur. <sub>(CLAUDE.md:332)</sub>

### Reçeteler

- **[ÇEKİRDEK]** `AppModal` içinde ÖN-DOLU açılan metin kutusu `components/ModalTextInput.tsx` kullanır (taslak portalın içinde, dış state yankı); `SimplePortal` mikrotask ertelemesi KALDIRILAMAZ (SM-X230); eşitleme koşulu `value` PROP'UNUN değişmesi, 'taslaktan farklı' DEĞİL; boş açılan kutular etkilenmez. · bekçi: `mobil/src/components/ModalTextInput.test.tsx` <sub>(CLAUDE.md:292)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:undated__roll-split` → `KOD: subcontractor.service.createFasonShipChild (commit 0f759e54, 2026-07-15); kümede notu yok, A:2026-08-10 arşiv:326 'fason kısmi sevk çocuğu' anar`: 'Roll split SADECE Tambur'da (CUT kararı)' artık eksik: fason doğrudan sevkte kısmi metraj için çocuk top doğar (parentRollId + entrySource TAMBUR_SPLIT + AT_SUBCONTRACTOR). Split yolları: Tambur finalize/cutOpenFabric/finalizeOpenFabric + Top Kesme (cutWarehouseRoll/finalizeWarehouseCut) + fason kısmi sevk. ✅ çürütmeden geçti
- **KISMI** `R:undated__roll-split` → `R:2026-07-27__tambur-finalize-wo-disiplini-2026-07`: 'Çocuklar işlemin yapıldığı Tambur adımını damgalar (producedInStepId = Tambur step)' yalnız ADIMA BAĞLI üç yol için doğru; depo topu kesimi (Top Kesme) çocuğu producedInStepId=null doğar ve finalize bu yüzden WO'yu currentStep'ten çözer. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-04__2026-08-04-roll-foldtype-entryreason` → `R:2026-08-19 Hazır sebep katalogları koddan DB'ye (kök CLAUDE.md:73; bu kümede değil)`: Elle top ekleme sebebi artık `mobil/src/constants/manualReasons.ts` kataloğundan değil DB'deki `ReasonPreset`'ten gelir; manualReasons.ts yalnız üçüncü kademe APK zemini (sunucu → disk → gömülü). 'Sürekli Diğer seçiliyorsa katalog yanlış' gerekçesi duruyor. ✅ çürütmeden geçti
- **KISMI** `M:2026-08-19__tambur-kisa-kesim-otomatik-a1-2026 (alt paragraf: 'ikisi de cihazda, varsayılan KAPALI')` → `M:2026-08-19__tambur-kisa-kesim-otomatik-a1-2026 (başlık: 2026-08-19 ikinci paket) + R:2026-08-19 (2. paket) kök CLAUDE.md:70`: Bayrak + eşik cihaz ayarı olmaktan çıktı → FABRİKA ayarı (feature-flags); cihazda yalnız üç durumlu `tamburShortCutA1Override` (server|on|off) + cihaz eşiği; birleştirme tek yer `resolveShortCutConfig`. Ateşleme/geri dönüş kuralı DEĞİŞMEDİ. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-12__2026-08-12-gece-single-restore` → `R:2026-08-22__2026-08-22-mutabakat-kapisinin-kirmizisi`: 'Metraj geri koyma: üretim dalı yalnız currentQty' kuralına AŞIM KORUMASI eklendi: tekil geri almanın cutOpenFabric dalında restore sonrası currentQty > initialQty ise initialQty yukarı çekilir ve deftere OVERAGE (source TAMBUR_UNDO_RESTORE) yazılır — arşiv ikizi/applyFull ile ayna. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-19__2026-08-19-tambur-plan-sapma` → `R:2026-08-21__2026-08-21-uretim-rengi-tek`: 'Top başına BİR soru' kapısına muafiyet: fason kabulünde `planColorAction=ROLLS_ONLY` ile onaylanmış renk sapması (`RollPlanDeviation source=fason-receipt`, aynı rollValue/planValue) Tambur plan kapısında TEKRAR SORULMAZ. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-04__2026-08-04-roll-foldtype-entryreason` → `A:2026-09-03__2026-09-03-dilim-2-davranis`: 'Hiç açık parti yok → NULL meşru' artık bayrağa bağlı: `batch.autoCreateEnabled` AÇIKKEN sunucu partiyi FAZ 2 tx'inde kendisi açar (boş parti sayacı yakmasın); KAPALIYKEN (varsayılan) davranış bayt-bayt eski. Ad 'requiredEnabled' değil 'autoCreateEnabled' (çıkışsız kapı olmasın). ✅ çürütmeden geçti
- **KISMI** `M:2026-08-05__cok-top-okutan-her-ekran (parantez: 'KK1 … auto kalır')` → `KOD: mobil KK1Screen.tsx:2331-2347 trigger="tap" (etiket doğrulama scan-back yüzeyi)`: Tek okuyup kapanan ekran listesindeki KK1 artık kısmen yanlış: KK1'in etiket-doğrulama tarayıcısı çok-okutmalı yüzey sözleşmesiyle tap. Tambur'un BarcodeScannerModal çağrıları trigger prop'u geçirmiyor → auto (kural korunuyor). ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `R:undated__roll-split` ↔ `KOD: Teks-Erp/src/services/subcontractor.service.ts:504 createFasonShipChild (fason kısmi sevk)`: Kod kazanır: split beş yoldan doğar (Tambur finalize · cutOpenFabric · finalizeOpenFabric · Top Kesme cutWarehouseRoll/finalizeWarehouseCut · fason kısmi sevk). Kök notu 'CUT kararı' değil 'kesim/kısmi sevk' diye yeniden yazılmalı; entrySource TAMBUR_SPLIT hepsinde ortak.
- `R:undated__roll-split` ↔ `R:2026-07-27__tambur-finalize-wo-disiplini-2026-07`: İkisi farklı yolları anlatıyor: adıma bağlı üç kesimde damga = işlemin adımı (miras değil); depo topu kesimi (Top Kesme) ve fason kısmi sevk çocuğunda null. N1 'her çocuk' gibi okunuyor → nitelenmeli.
- `R:2026-08-04__2026-08-04-roll-foldtype-entryreason` ↔ `A:2026-08-13__2026-08-13-kesimde-kat-sessizce`: Davranış aynı, terim çatışıyor: kod 'alan gönderilmezse fallback' uygular. N10/N11'in dili bağlayıcı — buna 'miras' denmez (miras = gönderilen değeri ezmek). N17'nin cümlesi 'fallback' diye okunmalı.
- `M:2026-08-05__cok-top-okutan-her-ekran` ↔ `KOD: mobil/src/screens/Modules/KK1/KK1Screen.tsx:2347`: Kural 'çok top okutan yüzey → tap' geçerli; KK1'in etiket-doğrulama tarayıcısı çok-okutmalı olduğu için tap. Parantezdeki örnek listesi KK1 için düzeltilmeli; Tambur/Kartela/refakat kartı auto.

## Açık sorular

- N0 'RollError PROCESS_QC'de açılır' varsayımının Faz B (kalite = istasyon yeteneği) sonrası hâli BELİRSİZ: bugün üç açılış noktası (kursun-qc:643, inventory kursunFinish:5264, tambur:1870) PROCESS_QC/Tambur ile örtüşüyor; çok-istasyonlulukta partial unique 409 riski (R5) henüz tasarlanmadı.
- N1 kök notunun yeniden yazımı: 'Sadece Tambur'da (CUT kararı)' cümlesi kod tarafından ezildi (fason kısmi sevk split'i 2026-07-15); bu kümede ezen NOT yok — arşiv A:2026-08-10 satır 326 yalnız 'fason kısmi sevk çocuğu' diye anıyor. Kararı kök dizin satırına taşımak için kullanıcı onayı gerekir.
- N22 `quality.gradeRequiredEnabled` kapsam bekçisinin adı notta yazılı değil; `git grep gradeRequired` → scripts/test_quality_batch_flags.ts (adı çıkarım, içeriği okunmadı).

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_client_token_collision`, `test_denetim_s2_paketi`, `test_e2e_full_flow`, `test_fold_catalog`, `test_fold_edit_and_label`, `test_kursun_bypass`, `test_kursun_unassigned_close`, `test_manual_attributes_reason`, `test_manual_move_field_continuity`, `test_manual_move_qc_reversal`, `test_manual_props_claim_pin`, `test_manual_roll_undo`, `test_masterdata_guards`, `test_p2_inventory`, `test_p2_kk2reopen`, `test_phase1_uretim_hardening`, `test_phase3_stok_hardening`, `test_phase6_reporterror_concurrency`, `test_plan_deviation_scorecard`, `test_property_value_selection`, `test_raw_tambur_cut`, `test_reason_presets`, `test_recent_output_filters`, `test_rescue_stuck`, `test_roll_edit_unified`, `test_roll_label_cut_seed_snapshot`, `test_roll_movement_revoke`, `test_roll_qty_adjust`, `test_roll_relabel`, `test_roll_relabel_context`, `test_roll_variance`, `test_roll_warehouse_stamp`, `test_sack_status_invariant`, `test_scan_code_case`, `test_tambur_branch_info`, `test_tambur_cut_barcoded`, `test_tambur_cut_concurrency`, `test_tambur_cut_idempotency`, `test_tambur_finalize_wo_guard`, `test_tambur_manual_batch`, `test_tambur_manual_field`, `test_tambur_manual_produce`, `test_tambur_manual_roll`, `test_tambur_over_quantity`, `test_tambur_plan_gate`, `test_tambur_recent_output_filter`, `test_tambur_send_to_dye`, `test_tambur_undo`, `test_warehouse_ledger`, `test_wo_terminal_race`, `test_work_session_stamping`

İstemci: `RelabelStation.test.tsx`, `BulkCancelRollsDialog.test.tsx`, `ReworkRollsDialog.test.tsx`, `qtyAdjust.test.ts`, `service.test.ts`, `tabs-regime.test.ts`, `WorkOrderCompleteDialog.test.tsx`, `cancelDecisions.test.ts`, `activity-utils.test.ts`, `ModalTextInput.test.tsx`, `RollCancelModal.test.tsx`, `rollHistoryFilter.test.ts`, `varianceReasons.test.ts`⚠️, `useFoldValues.test.tsx`, `LabelNamePreview.logic.test.ts`, `resolveShortCutConfig.test.ts`, `shortCutQuality.test.ts`, `tambur.service.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-04 · 2026-08-04 — topun KALICI alanları: kat + giriş sebebi; ve elle eklenen top artık PARTİLİ — `CLAUDE-NOT-ARSIVI.md:80-91`
- 2026-08-12 · 2026-08-12 — TOP LİSTESİ FİLTRESİ: zaman + kumaş, KK1 ile Tambur ORTAK — `CLAUDE-NOT-ARSIVI.md:176-191`
- 2026-08-13 · 2026-08-13 — KESİMDE KAT SESSİZCE DÜŞÜYORDU: mutationFn gövdesi alanı geçirmiyordu — `CLAUDE-NOT-ARSIVI.md:192-202`
- 2026-09-03 · 2026-09-03 — Dilim 2 davranış bayrakları: varsayılan = BUGÜN, ve "çıkışsız kapı" bir tasarım hatasıdır — `CLAUDE-NOT-ARSIVI.md:2185-2203`