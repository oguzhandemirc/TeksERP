# Kurşun planlama · Bypass

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 6 üye: 2 birincil (2026-08-05 birleşik ekran + rejim anahtarı · 2026-08-06 milestone confirmation) ve 4 ikincil. İkisi de KODDA CANLI (kursun-bypass.service.ts, kursun-bypass-eligibility.helper.ts, KursunDagitim/, 5 bekçi script). Bayat tek yer: 2026-08-05'in 'karo hiçbir bayrağa bağlı değil' cümlesi — 2026-09-03 modül kapısı karoya `production.enabled` kilidini ekledi (kısmi ezilme, koddan çözüldü). En riskli çelişki: kursun-bypass.routes.ts:74-76 Swagger bloğu 2026-08-05'te ÖLDÜRÜLEN görünürlük kuralını hâlâ sözleşme gibi anlatıyor (uç canlı, istemcisi yok). İkincil üyelerden 2026-08-26 (Electron güncelleme) bu kümeye AİT DEĞİL — dizin satırı kendi kümesinde üretilmeli; 2026-08-10'dan yalnız 'bypass ataması AUTO arar' dilimi buraya girdi.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** Dağıtımsız kapanışın kapsamı 'her dağıtılmamış adım' DEĞİL: bayrak AÇIK **ve** adım bypass'a UYGUN. Tek kapı `resolveUnassignedTamburClosure`, `assertKursunTabletMayWrite` ile AYNI kaynaktan beslenir — ayrışırsa 'tablet yazamıyor, Tambur da kapatamıyor' çıkmazı döner. Bayrak koşulu load-bearing. · bekçi: `scripts/test_kursun_unassigned_close.ts (bayrak koşulu düşünce 4 kırmızı)` <sub>(CLAUDE.md:52)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Atıf UYDURULMAZ: dağıtımsız kapanışta `RollMovement.machineId` NULL kalır — varsayılan makineye yazmak makine bazlı hacim raporunu sistematik yanlışlar. Boşluk GÖRÜNÜR kılınır: `listDistribution.unassignedClosures` → amber bant ('son 7 günde N iş dağıtılmadan kapandı'). · bekçi: `scripts/test_kursun_unassigned_close.ts (atıf uydurulunca 1 kırmızı)` <sub>(CLAUDE.md:52)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** Bayrak YALNIZ yeni atama oluşturmayı kapılar: rejim ATAMA SATIRINDA kalıcıdır, ayarda değil — dağıtılmış iş emri bayrak sonradan kapansa da bypass ile biter. · bekçi: `scripts/test_kursun_bypass.ts` <sub>(CLAUDE.md:51)</sub>
- **[ÇEKİRDEK]** Sıralama İKİ kümede yaşar (bekleyen havuz · makine içi) ve ikisi de aynı alanı (`WorkOrderStep.priority`) aynı uçtan yazar; çakışma yok çünkü bir adım aynı anda ya bekleyendir ya bir makinededir ya tablet `open-cards`'ındadır — yeniden numaralama yalnız kendi kümesine dokunur. · bekçi: `Electron/src/pages/Operations/KursunDagitim/queue-reorder.test.ts` <sub>(CLAUDE.md:51)</sub>
- **[ÇEKİRDEK]** Kurşun tableti bayrak açıkken salt-okunurdur ama YALNIZ dağıtıma UYGUN adımda — kör bayrak kilidi Tambur'suz rotada çıkmaz üretir. Tek kapı `assertKursunTabletMayWrite`, beş tablet yazma yolunu da kapsar; guard UI'ya güvenmez (offline kuyruk bayrak çevrildikten sonra flush edilir). · bekçi: `scripts/test_kursun_regime_lock.ts (21; kilit 7 / kör kilit 2 / bant 2 negatif s` <sub>(CLAUDE.md:51)</sub>
- **[ÇEKİRDEK]** Uygunluk kuralı TEK KAYNAK: `resolveBypassBlockReason` + `loadBypassEligibilitySignals`. `listDistribution` toplu, tablet tekil çağırır; kopyalanırsa ekran 'Ata' derken tablet de yazabilir duruma düşer. · bekçi: `scripts/test_kursun_regime_lock.ts` <sub>(CLAUDE.md:51)</sub>
- **[ÇEKİRDEK]** Marker `KURSUN_BYPASS_FINISHED:UNASSIGNED:<uuid>` BASE ön ekinden TÜRETİLİR (`KURSUN_BYPASS_MARKER_PREFIX`), elle yazılmaz: tanıyıcılar `startsWith(BASE)` ile bakar, uyum koparsa çok partili işin İKİNCİ turu 'bypass dışı kapanmış hareket var' diye uygunluğunu yitirir. · bekçi: `scripts/test_kursun_unassigned_close.ts (ön ek uyumu kopunca 1 kırmızı)` <sub>(CLAUDE.md:52)</sub>
- **[ÇEKİRDEK]** Dağıtımsız kapanışta atama satırı yok, atomik claim de GEREKMEZ: yerini `closeBypassMovementsTx`'in `exitedAt IS NULL` guard'ı + kapsam paritesi tutar (N paralel okutma → 1 kapanış). İdempotent tekrarın izi marker'dır (`findCompletedUnassignedClosure`); o dal olmadan offline replay 404 alır. · bekçi: `scripts/test_kursun_unassigned_close.ts (EŞZ: 3 paralel okutma → 1 kapanış)` <sub>(CLAUDE.md:52)</sub>
- **[ÇEKİRDEK]** Kurşun bypass ataması istasyon özelliğinde MOD `AUTO` arar — `StationProperty` satırının varlığı YETMEZ (OPTIONAL/REQUIRED atlanır). <sub>(CLAUDE.md:68)</sub>
- **[ÇEKİRDEK]** Boot uzlaştırması yalnız EKLER: silmez, mevcut satırın `description`/`module` alanını EZMEZ ve hiçbir kullanıcıya izin ATAMAZ ('katalog koda, atama panele'). Kaldırma/yeniden adlandırma bilinçli veri migration'ı ister; sahada izin atanmasını unutmak hâlâ mümkündür. · bekçi: `scripts/test_permission_catalog.ts` <sub>(CLAUDE.md:191)</sub>
- **[ÇEKİRDEK]** RBAC modeli: `requirePermission(code)` → `req.user.permissions[]`; izinler DOĞRUDAN kullanıcıya bağlanır (`UserPermission`), ROL MODELİ YOKTUR — tekrar kullanım için `PermissionTemplate`. Kurşun dağıtımının izni `workorder:distribute`, mobil ikizi `mobile:kursun-dagitim`. · bekçi: `scripts/test_permission_catalog.ts` <sub>(CLAUDE.md:172)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `listOpenCards` filtresini uygunlukla GENİŞLETME: uç tablet tarafından 5 saniyede bir yoklanıyor (rota + üç iz sorgusu maliyeti) ve uygun OLMAYAN adımlar listede KALMALI — sebep kartın içindeki bilgi panelinde söylenir. <sub>(CLAUDE.md:51)</sub>
- **[ÇEKİRDEK]** İzin sayısını dokümana SABİTLEME — kanonik sayı `permission-catalog.ts`'tedir (2026-09-05 ölçümü 86). `20260801020000_kursun_bypass_permission_catalog` migration'ı duruyor (uygulanmış migration IMMUTABLE) ama EMSAL DEĞİL: yeni izin için benzerini yazma. <sub>(CLAUDE.md:191)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** Makine içi sıra `listDistribution` içinde JS ile kurulur (`sortByPlanOrder`), Prisma `orderBy` ile DEĞİL — kaynak `assignedAt asc` yüklenir, sıralama anahtarları adımdadır. Satır düşerse sürükleme DB'ye doğru yazar, ekran hiç değişmez: hata yok, log yok; tek belirti 'sürüklüyorum, geri zıplıyor'. · bekçi: `scripts/test_kursun_machine_order.ts (12 kontrol; satır kalkınca 4 kırmızı)` <sub>(CLAUDE.md:51)</sub>
- **[PROFİL]** `GET /kursun-bypass/visibility` TARİHSEL bir uçtur: hiçbir yeni istemci çağırmaz, yalnız sahadaki eski APK'lar için duruyor (silmek deploy penceresinde 404 üretir). Swagger'ındaki 2026-08-02 görünürlük kuralı BAYAT — yeni yüzey ondan beslenmez. <sub>(CLAUDE.md:51)</sub>

### Reçeteler

- **[PROFİL]** `scripts/sync-kursun-bypass-permissions.ts` TARİHSELDİR: katalog artık boot uzlaştırmasından gelir, script'in kalan işi admin'e ATAMA + veri ön koşul teşhisi (bayrak · istasyon yeteneği · fiziksel kurşun makineleri). Makineleri YARATMAZ — fabrikaya özgü veridir, yalnız raporlar. <sub>(CLAUDE.md:191, CLAUDE.md:51)</sub>

### Kararlar

- **[PROFİL]** Kuyruk sıralaması bir PLANLAMA kararıdır, kalite kararı değil: `PATCH /kursun-qc/queue/reorder` üç izni birden kabul eder — `quality:write` ∨ `workorder:distribute` ∨ `mobile:kursun-dagitim`. Daraltma dağıtımcıyı kendi ekranında kilitler. <sub>(CLAUDE.md:51)</sub>
- **[PROFİL]** Milestone confirmation: Tambur okutması dağıtılmamış kurşun adımını da kapatır — dağıtım MAKİNE ATFI için planlama kolaylığıdır, işin ilerlemesinin ön koşulu DEĞİL. Atama yoksa `findPendingForTambur` SANAL bekleyen üretir (`source:"UNASSIGNED"`), `completeUnassignedFromTambur` kapatır. · bekçi: `scripts/test_kursun_unassigned_close.ts (53 kontrol)` <sub>(CLAUDE.md:52)</sub>
- **[ÇEKİRDEK]** Alt CLAUDE'daki RBAC modül TABLOSU bayat: FINANCE modülü (6 kod, `finance:read/write/invoice/payment/cheque/close`) hiç yok ve MOBILE listesinde `mobile:siparis`, `mobile:kumas`, `mobile:tambur-duzelt`, `mobile:kk1-yari-mamul` eksik. Tabloyu güncelle ya da kaldır — kanonik liste dosyadadır. <sub>(CLAUDE.md:172)</sub>

## Panel (Electron)


### Değişmezler

- **[PROFİL]** `production.kursunBypassEnabled` REJİM anahtarıdır, görünürlük anahtarı DEĞİL: karo ona bağlanmaz. Karo izinle (`quality:write` ∨ `workorder:distribute`; mobilde `mobile:kursun-dagitim`) ve MODÜL kapısıyla (`production.enabled` → `isKursunPlanningVisible`, ikizi `requireProductionEnabled`) süzülür. · bekçi: `Electron/src/pages/Operations/production-regime.test.ts + tile-visibility.test.t` <sub>(CLAUDE.md:51)</sub>
- **[ÇEKİRDEK]** Her makine panelinin KENDİ `DndContext`'i vardır: satırın makineler arası sürüklenmesi yapısal olarak imkânsızdır — makine değiştirmek bir yeniden ATAMA'dır (kaldır → tekrar ata), kazara sürüklemeyle yapılmamalı. <sub>(CLAUDE.md:51)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Sekme şeridi MAKİNE listesinden doğar, dağıtılmış satırlardan DEĞİL: işi olmayan makinenin de sekmesi vardır (boş makine tam da iş verilecek yerdir) ve pasifleşmiş ama üstünde açık iş kalan makine `(pasif)` etiketiyle çizilir — yoksa o işlere ulaşılamaz. · bekçi: `Electron/src/pages/Operations/KursunDagitim/machine-tabs.test.ts` <sub>(CLAUDE.md:51)</sub>

### Kararlar

- **[PROFİL]** Kurşun sırası + kurşun dağıtımı TEK ekranda kalır (`/operations/kursun-dagitim`); eski `operations/kursun-queue` adresi oraya yönlendirilir, ikinci bir kurşun ekranı açılmaz. · bekçi: `Electron/src/pages/Operations/tile-visibility.test.ts:57 + components/layout/com` <sub>(CLAUDE.md:51)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Tablet salt-okunur kararını SUNUCU verir ve istemci yalnız uygular (`StepSummary.tabletReadOnly` + `bypassAssignment`); ekran kart açılınca yazma yüzeyini hiç çizmez. Backend + Electron + APK aynı pencerede gider — alanı görmeyen eski APK yazmaya çalışıp ham 409 yer. <sub>(CLAUDE.md:51)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **TAM** `A:2026-08-02 — kurşun ekranları 'işi kaldıysa görünür' kuralı (arşiv, küme dışı)` → `R:2026-08-05__2026-08-05-kursun-planlama-birlesik`: İki ekran (Kurşun Sırası + Kurşun Dağıtım) TEK ekranda birleşti; iki `visibleWhen` yüklemi, `KursunQueue/`, `KursunQueueRouteGate` ve `useKursunVisibility` SİLİNDİ; karo artık sayaç kuralına değil izne bakar. Sıralama izni de genişledi (quality:write | workorder:distribute | mobile:kursun-dagitim). ✅ çürütmeden geçti
- **KISMI** `R:2026-08-05__2026-08-05-kursun-planlama-birlesik` → `R:2026-09-02/03 — Modül anahtarları P1 + R:2026-09-03 Panel modül kapıları P5 (küme dışı)`: 'Karo bayraktan BAĞIMSIZ, yalnız izinle süzülür' artık yalnız REJİM bayrağı (`production.kursunBypassEnabled`) için doğru: karoya MODÜL kapısı eklendi (`visibleWhen: isKursunPlanningVisible` → `production.enabled`), backend ikizi `router.use(verifyToken, requireProductionEnabled)`. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-05__2026-08-05-kursun-planlama-birlesik` → `R:2026-08-06__2026-08-06-dagitim-on-kosul`: Rejim kilidi (tablet bayrak açıkken salt-okunur) KALDI ama fiilen ürettiği 'dağıtım yapılmadan iş ilerlemez' ön koşulu kalktı: Tambur okutması dağıtılmamış kurşun adımını da kapatır (`resolveUnassignedTamburClosure`), atama satırı gerekmez. ✅ çürütmeden geçti
- **TAM** `Pre-2026-08-01 izin ekleme pratiği (canlı DB'ye elle INSERT + izin başına veri migration'ı; emsal `20260801020000_kursun_bypass_permission_catalog`)` → `B:2026-08-01__yeni-izin-eklemek-tek-dosya-2026`: Yeni izin artık TEK dosyaya yazılır (`permission-catalog.ts`); boot uzlaştırması (`permission-catalog.job.ts`) eksikleri getirir, AST bekçisi (`test_permission_catalog.ts`) kaçağı düşürür. Migration duruyor ama EMSAL DEĞİL.

## Çözülmüş çelişkiler

- `R:2026-08-05__2026-08-05-kursun-planlama-birlesik` ↔ `Canlı Swagger bloğu — Teks-Erp/src/routes/kursun-bypass.routes.ts:74-76`: 2026-08-05 geçerli: kural ölü, uç yalnız eski APK'lar için duruyor. Swagger metni bayat — okuyanı yeniden o kurala götürür; uç emekliye ayrılana dek metne 'TARİHSEL, yeni istemci kullanmaz' şerhi düşülmeli.
- `B:2026-08-01__yeni-izin-eklemek-tek-dosya-2026` ↔ `B:undated__rbac-permission-kodlari (aynı alt-CLAUDE dosyası)`: Kural geçerli, metin kuralı kendi ihlal ediyor: sayı bugün doğru olsa da tabloya/metne yazılmamalı. Aynı tablo ayrıca bayat (FINANCE satırı yok; mobile:siparis/kumas/tambur-duzelt/kk1-yari-mamul eksik).

## Açık sorular

- `GET /kursun-bypass/visibility` ne zaman silinebilir: sahadaki en eski APK sürümü bu turda ÖLÇÜLMEDİ (yalnız 'yeni istemci çağırmıyor' doğrulandı).
- `sync-kursun-bypass-permissions.ts` hâlâ katalog upsert'i taşıyor (:67, 'emniyet ağı' beyanı) — 2026-08-01'in 'başka hiçbir yere kopyalama' kuralıyla gerilimde; kaldırma kararı verilmemiş.
- audit/00-map dosyaları bayrağı `kursun.bypassEnabled` diye anıyor; kanonik anahtar `production.kursunBypassEnabled` (system-setting.service.ts:484). Harita düzeltmesi bu kümenin dışında.

## Doğrulama turu ekleri (eski CLAUDE.md ↔ yeni yapı karşılaştırması, 2026-09-05)

- **[ÇEKİRDEK]** `repointPendingBypassAssignmentsTx`: kapanış dispozisyonu TRANSFER'de bekleyen bypass ataması yeni WO'ya taşınır, split'te void edilir; force-void'den ÖNCE koşar ve `workOrderId`+step birlikte eşlenir. · bekçi: `test_kursun_bypass_repoint` <sub>(arşiv 2026-08-21 akşam)</sub>

## Bekçiler — bu alana dokununca koş (16 backend · 5 istemci)

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_audit_followups`, `test_consistency_derived`, `test_e2e_full_flow`, `test_kursun_bulk`, `test_kursun_bypass`, `test_kursun_bypass_repoint`, `test_kursun_machine_order`, `test_kursun_regime_lock`, `test_kursun_unassigned_close`, `test_manual_move_field_continuity`, `test_manual_move_qc_reversal`, `test_p2_kk2reopen`, `test_property_value_selection`, `test_qc2_idempotency`⚠️, `test_station_property_mode`, `test_wo_target_color_guard`

İstemci: `machine-tabs.test.ts`, `queue-reorder.test.ts`, `selection.test.ts`, `production-regime.test.ts`, `tile-visibility.test.ts`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-05 · 2026-08-05 — KURŞUN PLANLAMA: iki ekran birleşti + bayrak artık REJİM anahtarı — `CLAUDE-NOT-ARSIVI.md:103-120`
- 2026-08-06 · 2026-08-06 — DAĞITIM ARTIK İŞİN ÖN KOŞULU DEĞİL: Tambur okutması kurşunu dağıtımsız da kapatır — `CLAUDE-NOT-ARSIVI.md:121-133`