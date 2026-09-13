# Dokuma · Dokuma işi · Doff

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Hikâye, ölçüm ve gerekçe tasarım belgelerinde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> ⚠️ **BU ALAN KISMEN KÂĞITTADIR — şema PARÇA PARÇA iniyor.** Ölçüldü 2026-09-13: **`WeavingOrder` İNDİ** (P1, `77b69da9`) · **`MachineRun` İNDİ** (P2, `c07396e6`) · **`MachineSpec` + `LoomShedType` + `MachineMonitoringState` İNDİ** (P4, migration `20260913230000`). **`MachineStopEvent` + `MachineStopReclass` + `ShiftDefinition` + `ShiftInstance` + `MachineCollector` + `MachineCollectorLink` + 4 enum İNDİ** (P2b-1, migration `20260913240000`). **Hâlâ YOK:** `Machine.warpBeamSlots` (LEVENT belgesinin tek parçalı sürümüne ait) · `ReasonPresetKind.MACHINE_STOP` + `ReasonPreset.stopLossClass` + CHECK + katalog (P2b-2) · `DoffEvent` + `RollEntrySource.WEAVING` (P3). Sıra: **P1 ✅ → P2 ✅ → P4 ✅ → P4b ✅ → P2b-1 ✅ → P2b-2 → P3.**
>
> ✅ **P4b İNDİ:** `Machine.productionLineCount` (`@default(1)`, CHECK `>= 1`) + `assertProductionLineValid` yüklemi. ⚠️ **Yüklem BUGÜN HİÇBİR YERDEN ÇAĞRILMIYOR** — ilk çağrı yeri P2b'nin koşum açma ucudur ve o gün bekçiye "çağrıldığı YOL" ayağı eklenir. Borç kapanma koşuluyla yazılıdır.
> 📌 Bir **guard** bir YOLU korur (yol yoksa erişilemez dal); bir **yüklem** bir SORUYU cevaplar ve çağrısız da doğru ya da yanlıştır ⇒ yazma yüzeyinden önce inebilir, ama bekçisi **davranışını** ölçmek zorundadır, varlığını değil.

---

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Dokuma topun rotasında bir ADIM DEĞİLDİR; kendi kimliği, kendi yaşam döngüsü ve kendi defteri olan ayrı bir VARLIKTIR — `MachineRun` bir `WorkOrderStep`e bağlanmaz, `WeavingOrder`a bağlanır. <sub>(DOKUMA-IS-EMRI §1)</sub>
- **[ÇEKİRDEK]** Bir top ya fabrikanın DIŞINDAN gelir ya iş emri içinde BAŞKA BİR TOPTAN doğar (ana top tüketilir, metre korunur); dokuma bu ikisine ait olmayan ÜÇÜNCÜ sınıftır — iplikten metre YARATIR ve korunacak ana topu yoktur. <sub>(DOKUMA-IS-EMRI §1.1)</sub>
- **[ÇEKİRDEK]** Doff bir olay yazar, TOP DOĞURMAZ: dokunan kumaş `Roll` olarak KK1'de doğar (`entrySource = WEAVING`) ve oradan mevcut rotaya girer — ikinci bir giriş motoru yazılmaz, yol `createInitialEntry`den geçer. · <sub>(DOKUMA-IS-EMRI §3.5; `goods-receipt.service.ts:8`)</sub>
- **[ÇEKİRDEK]** Tezgahtan türetilen metre (`pickDelta ÷ unitsPerCm`) HİÇBİR YERDE stok yazmaz; tek miktar gerçeği `Roll` ölçümüdür. <sub>(DOKUMA-TEZGAH §5.6)</sub>
- **[ÇEKİRDEK]** İlerleme İKİ SAYIDIR ve toplanmaz: ÜRETİLEN (doff edilen topların ölçülen metresi — stok yazar, rapora girer) ve TEZGAHTA (türetilen — yalnız canlı ekran); `plannedM − ÜRETİLEN` kalanı verir, TEZGAHTA bu çıkarmaya girmez. <sub>(DOKUMA-IS-EMRI §2.4)</sub>
- **[ÇEKİRDEK]** Levent bitince koşum BİTMEZ — koşumu bitiren üçtür: desen/renk değişti · hedef devir değişti · iş bitti; levent değişimi `WarpBeamEvent`e yazılır ve koşum sürer. <sub>(DOKUMA-IS-EMRI §2.3)</sub>
- **[ÇEKİRDEK]** Talep metre, icra levent, çıktı toptur — üç ayrı eksen tek sayıya bindirilmez; metre↔levent çevrimi take-up ister ve take-up bugün YOKTUR, yani "bu iş kaç levent eder" HESAPLANMAZ. <sub>(DOKUMA-IS-EMRI §2.1)</sub>
- **[ÇEKİRDEK]** `MachineDataSource` alanları `@default` ALMAZ — sayaç/ölçüm değerini yazan her yol kaynağını AÇIKÇA beyan eder, `SIMULATED` dahil; kararı backend verir. <sub>(DOKUMA-IS-EMRI §3.8)</sub>
- **[ÇEKİRDEK]** Açık koşum tekilliği MAKİNE değil **ÜRETİM HATTI** başınadır (`machine_runs_one_open_per_prod_line_uq`) — çift enli tezgah yan yana iki ayrı kumaş koşar; yalnız makineye kilitlemek bunu yapısal olarak imkânsız kılar. Tek hatlı makinede `productionLineNo` sabit 1'dir ⇒ reddedilen küme değişmez. <sub>(DOKUMA-TEZGAH §2.8, §10/#23b)</sub>
- **[ÇEKİRDEK]** İzleme hâli TEK kolondur (`MachineSpec.monitoringState`, `OFF` doğar) — `isMonitored` gibi ikinci bir boolean AÇILMAZ: iki kolon "çift yüklem" sınıfıdır ve tek boolean, kanal kabul testinden bağımsız açılabildiği için ters bağlı bir röleyi %100 randımanla MÜHÜRLETİRDİ. Gölge mod bir reçete cümlesi değil bir DURUMDUR. <sub>(DOKUMA-TEZGAH §2.3)</sub>
- **[ÇEKİRDEK]** `MachineSpec` satırının VARLIĞI *"bu makine izleniyor"* demektir, *"bu makine bir dokuma tezgahıdır"* DEĞİL; ne olduğu ayrı bir etiketten okunur ve o etiket zorunlu bile değildir (`shedType IS NULL` zaten "bu makine o sınıftan değil" der). `Machine.kind` enum'u AÇILMAZ. <sub>(DOKUMA-TEZGAH §2.3)</sub>
- **[ÇEKİRDEK]** Duruşun kimliği SAAT DEĞİL TOKEN'DIR (`stopKey`, ajan üretimi UUID): açılış, kapanış ve yeniden gönderim AYNI anahtarla gelir. Kimliği `(makine, başlangıç, kaynak)` üçlüsünden kurup saniyeye yuvarlamak bir kimlik çözümü değil semptom bastırıcısıdır — 1 sn kayan tekrar gönderim yine ikinci satır açar. <sub>(DOKUMA-TEZGAH §2.7)</sub>
- **[ÇEKİRDEK]** `machine_stop_events`in iki seddi de (`one_open_per_machine` · `key_uq`) `revokedAt IS NULL` yüklemi taşır — geri alınmış duruş yer işgal etmez, yoksa yeni duruş açılamaz ve yeniden gönderim sonsuza dek reddedilir. <sub>(DOKUMA-TEZGAH §2.7)</sub>
- **[ÇEKİRDEK]** `MachineStopLossClass.MINOR` bir SÜRE sınıfıdır, SEBEP sınıfı DEĞİL: yalnız mikro-duruş eşiğinin altından TÜRER ve `ReasonPreset.stopLossClass`a ASLA yazılmaz. Denetim ekranında da ayrı Türkçe taşır (`MACHINE_STOP_EVENT.lossClass` override'ı) — global "Küçük" `DefectSeverity` dilindedir. <sub>(DOKUMA-TEZGAH §2.7, §10/#7)</sub>
- **[ÇEKİRDEK]** Bir sırrı taşıyan kolon, onu koruyan KURALLARLA aynı dilimde iner; tablo daha erken inebilir, sır inemez. `MachineCollector`ın token kolonları bu yüzden P2b-1'de YOK ve yokluğu şemada BEYAN EDİLİR — yazma yüzeyi olmadan güvenli görünen bir sır kolonu, kurallarından önce var olur ve ilk yazan kişi kuralları arayıp bulamaz. <sub>(1e hükmü 2026-09-13)</sub>
- **[ÇEKİRDEK]** `machine_runs`ın iki sedi `revokedAt IS NULL` yüklemini ŞART koşar (geri alınmış koşum yer işgal etmez), silme guard'ı ise `revokedAt`i BİLEREK SÜZMEZ (geri alınmış koşum da o makinede üretim yapıldığının kanıtıdır) — **iki ters yön, iki ayrı soru**; gerekçeleri `guarded-hard-remove.ts` → `machineRunCount`ta yan yana yazılıdır ve biri ötekine bakılarak "tutarlı" yapılmaz. <sub>(DOKUMA-TEZGAH §2.8)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `Roll.doffEventId` ve `MachineRun.weavingOrderId` ASLA `null`'lanmaz — ileri damgayı `null`'lamak ters kayıt DEĞİLDİR (`dispatchedAt` · `weighedAt` · `invoicedAt` ailesi). <sub>(kök `CLAUDE.md` § Veri ve defter)</sub>
- **[ÇEKİRDEK]** `plannedM`e ulaşmak dokuma işini KAPATMAZ: o sayı geç gelen bir ölçüme (KK1 top metresi) dayanır ve otomatik kapanış tezgah koşarken işi kapatır — eşik bir BİLDİRİMDİR, bir karar değil. <sub>(DOKUMA-IS-EMRI §2.2a)</sub>
- **[ÇEKİRDEK]** Dokuma işine sipariş bağı açılmaz: karşılama `SackAllocation` ile sevk anında yazılır ve istenen şey aslında REZERVASYONDUR — rezervasyon bu üründe yoktur (profil kararı). <sub>(DOKUMA-IS-EMRI §2.2c; `MODUL-BAYRAK-TASARIM.md` #6)</sub>
- **[ÇEKİRDEK]** Kopuş/duruş sayaçları ÇOĞULLAŞTIRILMAZ (`warpStopCount1/2` yazılmaz); levent kırılımı deftere yazılır (`MachineStopEvent.beamSlot`) ve sayaçlar aynı `kind`ın TÜM slotlarını toplar. <sub>(DOKUMA-TEZGAH §5.4)</sub>

### Kararlar

- **[ÇEKİRDEK]** Dokuma işinin kapanışı AÇIK BİR KARARDIR (operatör kapatır), türetilmez; açık koşum varken kapanmaz ve 409 koşumları ADIYLA söyler (`{code, machines[], runIds[]}`). <sub>(DOKUMA-IS-EMRI §2.2a)</sub>
- **[ÇEKİRDEK]** Dokuma işinin iptali yalnız kendi üstünde bir DURUM GEÇİŞİDİR: kapanmış koşum, duruş, doff ve doğmuş top DOKUNULMAZ — "bunu şu iş için dokuduk, sonra iş iptal edildi" doğru bir cümledir. <sub>(DOKUMA-IS-EMRI §2.2b)</sub>
- **[ÇEKİRDEK]** `DOFF_CANCEL` yalnız o doff'a bağlı HİÇBİR top yokken açıktır (`NOT EXISTS (rolls WHERE doffEventId = :id)`); statüye BAKILMAZ — iptal/fire edilmiş top da sayılır, çünkü ölçüt "top var mı" değil "doff ileri sonuç yazdı mı"dır. <sub>(DOKUMA-IS-EMRI §3.8)</sub>
- **[ÇEKİRDEK]** Koşumsuz doff MEŞRUDUR (`machineRunId` nullable) — fiziksel olarak olmuş bir olayı kaydetmeyi reddetmek, onu atıfsız kaydetmekten kötüdür; koşum yoksa `ApiResponse.warnings`, 400 değil. <sub>(DOKUMA-IS-EMRI §3.8; kurşun `machineId=null` emsali)</sub>
- **[ÇEKİRDEK]** Koşumsuz doff kendi kovasını alır ve ana sayıya KARIŞMAZ: rapor üç sayı basar (iş emrine bağlı doff metresi · koşumsuz doff · doff'suz top) ve `warnings` metni KAYBI söyler — "koşum açılmadığı için bu indirme iş emri metresine girmiyor". <sub>(DOKUMA-IS-EMRI §3.8)</sub>
- **[ÇEKİRDEK]** `MachineRun.weavingOrderId` koşumda tutulur ama `DoffEvent`te TUTULMAZ — doff'un iş emri koşumdan türetilir, çünkü ikinci bir FK ikinci bir kaynak olur. <sub>(DOKUMA-IS-EMRI §3.8; `MachineRun.warpBeamId` emsali)</sub>
- **[ÇEKİRDEK]** Üretim hattı numarası kolonu `productionLineNo` adını taşır (`lineNo` DEĞİL) — `lineNo` şemada `InvoiceLine`/`PurchaseOrderLine`ta belge satır numarası anlamında yaşıyor ve iki anlam çarpıştığında geri adım atan YENİ olandır. <sub>(DOKUMA-IS-EMRI §1.6)</sub>
- **[PROFİL]** `dokuma.enabled` `tezgah.enabled`in KARDEŞİDİR, çocuğu değil (ön koşul `production.enabled`); fasona dokutan firmada dokuma vardır tezgah yoktur, yalnız devere makinelerini izleyen firmada tersi. Varsayılan `false` = bugünkü davranış (ölçüldü: fabrikada 0 İPLİK kalemi, 0 çözgü kartı). <sub>(DOKUMA-IS-EMRI §2.5)</sub>

## Tablet (mobil)

### Değişmezler

- **[ÇEKİRDEK]** Dokuma ekranı bir KUYRUK değil bir TEZGAH gösterir: önünde bekleyen iş listesi yoktur, bir (ya da `productionLineCount` kadar) tezgah vardır ve o ya koşuyordur ya durmuştur. <sub>(DOKUMA-IS-EMRI §3.2)</sub>
- **[ÇEKİRDEK]** Koşum · duruş · levent değişimi · doff dördü de çevrimdışı kuyruğa girer (`STATION_MUT` + `OFFLINE_AWARE`) — tezgah başında ağ en zayıf yerdir ve duruş gecikirse randımanın PAYDASI bozulur. <sub>(DOKUMA-IS-EMRI §3.6)</sub>
- **[ÇEKİRDEK]** `ReasonPresetKind.LOOM_STOP` için APK'ya gömülü zemin ZORUNLUDUR — zeminsiz kalırsa sunucusuz katalog boş döner, sebep zorunlu olan duruş kaydedilemez ve tezgah ekranda kilitlenir. · bekçi: `Teks-Erp/scripts/test_reason_preset_kind_parity.ts` (on iki aynayı Prisma enum'una karşı iki yönlü ölçer) <sub>(DOKUMA-IS-EMRI §3.4)</sub>
- **[ÇEKİRDEK]** `warpBeamSlots > 1` olan tezgahta duruş HANGİ YUVA sorar; bilinmiyorsa NULL kalır ve Pareto'da "atanmamış" kovasında AYRI gösterilir — tahminle bir levende yazılmaz. `<= 1` ise alan hiç çizilmez. <sub>(DOKUMA-TEZGAH §2.7)</sub>
- **[ÇEKİRDEK]** Ham/dokuma ayrımı KK1'de ÇIKARILMAZ, SORULUR: `dokuma.enabled` açık fabrikada gelen top ya dokunmuş ya satın alınmıştır ve ikisi aynı gün olur; bayrak kapalıyken KK1 bugünküyle birebir aynıdır. <sub>(DOKUMA-IS-EMRI §3.5)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** `source:'SIMULATED'` beyanı bugün YALNIZ kantar (SCALE) yolunda vardır, metre (METER) yolunda YOKTUR — doff sayacı bir ölçüm cihazıdır ve beyanı baştan taşımalıdır, yoksa aynı boşluk yeni bir yerde kurulur. <sub>(DOKUMA-IS-EMRI §3.7)</sub>
- **[ÇEKİRDEK]** Doff anında sayaç değeri (`counterAtDoff`) kaydedilmezse operatörün sayacı sıfırlaması ile 16-bit sarma AYIRT EDİLEMEZ; değeri kaydetmek belirsizliği kaynağında kapatır ve sıfırlamayı beyan edilmiş bir olaya çevirir. <sub>(DOKUMA-TEZGAH § sayaç kalitesi; DOKUMA-IS-EMRI §3.8)</sub>
- **[ÇEKİRDEK]** Beş dev ekran (Tambur · FasonKabul · KK1 · KursunQc · FasonSevk) `max-lines` MUAFIDIR ve emsal ALINMAZ — muafiyet bir borçtur, bir kalıp değil; yeni ekranın emsali `screens/Modules/HizliIsEmri/`dir. <sub>(`docs/standart/MOBIL.md` [MO-03])</sub>

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>`

Backend: `test_devere_regime_gate`, `test_audit_labels`, `test_reason_preset_kind_parity`, `test_db_invariants`, `test_timestamptz_contract`, `test_machine_run`, `test_hard_delete_guard_coverage`, `test_master_data_merge_fk_coverage`, `test_production_line`, `test_machine_stop`

> ⚠️ **Yukarıdaki `Backend:` satırı KAPININ okuduğu biçimdir, süs değil.** `test_identity_ledger.ts:158` alan koşum listesini yalnız `## Bekçiler` başlığından sonraki `Backend:` satırından ayrıştırır (`` `ad` `` aralarında). Aşağıdaki madde imli açıklamalar **insan içindir ve kapı onları GÖRMEZ**: bu dosya 2026-09-13'te madde imli listeyi taşıyordu ve `test_machine_run` tarif edilmiş olduğu hâlde kapı onu **B-d (KAPSAM eksiği)** saydı. ⇒ *Bir belge bölümünü doldurmak, o bölümü okuyan kapıyı beslemek değildir — kapı bölümü değil BİÇİMİ okur.* Yeni bekçi **iki yere birden** yazılır: `Backend:` satırına (bağ) ve aşağıya (tarif).

**Bugün VAR olanlar:**
- `test_devere_regime_gate` — devere kapısının üç halkayı (ticaret → iplik → devere) ELLE ölçtüğü; dokuma inince kardeş zincir aynı biçimde ölçülür.
- `test_audit_labels` — şemadaki her enum değerinin Electron karşılığı (yeni dokuma enum'ları beyan edilmeden geçemez).
- `test_reason_preset_kind_parity` — `LOOM_STOP` aynalarının iki yönlü eşitliği.
- `test_db_invariants` — yeni CHECK/partial index/trigger envantere yazılmadan geçmez.
- `test_timestamptz_contract` — yeni `DateTime` alanları.
- **`test_machine_run`** (2026-09-13, P2 ile doğdu) — `machine_runs`ın iki sedi (hat başına tek açık koşum · doğal anahtar), `revokedAt`in sedde ŞART / guard'da SÜZÜLMEZ ters yönü, `productionLineNo >= 1` CHECK'i, eşzamanlı açılış ve silme guard'ı. ⚠️ §5 **SED ölçümüdür, TOCTOU penceresi ölçümü DEĞİL** — koşum açan servis P2b'de doğunca o bölüm yeniden yazılır (başlıkta yazılı).
- `test_hard_delete_guard_coverage` — `Machine`e gelen her FK ya guard'da sayılıyor ya gerekçeli muaf. ⚠️ Guard'ları **REGEX** okur: sayaç `prisma.<model>.count({ where: { <kolon>:` biçiminde **DÜZ** yazılmalı, helper'a sarmalanırsa bekçi "guard yok" sayar (ölçüldü 2026-09-13, negatif sonda).
- `test_master_data_merge_fk_coverage` — şemadan türer: birleştirilebilir varlığa (`item`·`color`·`customer`·`subcontractor`) giden her yeni FK `MERGE_MAP`e satır ister.

**HENÜZ YOK (şema inerken yazılacak, ne ölçeceği yazılı):**
- `test_machine_doff_source` — ⚠️ adı `DOKUMA-TEZGAH-IZLEME-TASARIMI.md:1874`te geçiyor ama **dosya yoktur**. Üç şey ölçecek: ① `WEAVING` ile doğan topun kaynağı ve `DoffEvent` bağı · ② türetilen metrenin stok yazmadığı (AST: `producedM` ile `Roll` miktar yazan yol aynı ifadede geçemez) · ③ `DOFF_CANCEL` yüklemi, **negatif sondayla** (`NOT EXISTS` düşürülünce kırmızı vermeli).
- `test_weaving_order` — kapanış kapısı (açık koşumla 409 + koşum adları), iptalin defter satırlarına dokunmadığı, `plannedM`in kapanış tetiklemediği.

## Raporların sözleşmesi — üç soru cümlesi

> **Bir rapor bir ÖLÇÜM TANIMIDIR.** Yanlış tanımlanmış bir rapor yanlış bir bekçiden
> pahalıdır: kimse onu sorgulamaz, **karar ondan verilir.** Bu yüzden her cümle
> **yanlışlanabilir** yazılır ve yanlışlanma koşulu yanına konur.

**① RANDIMAN**
> *"Şu tezgah, şu vardiyada, planlı süresinin %A'sında çalıştı (KULLANILABİLİRLİK); çalıştığı sürede hedef devrin %P'sini tutturdu (PERFORMANS) — ve bu iki sayı **ÇARPILMAZ, ayrı sunulur**."*
> **Yanlışlanır:** kova toplamı planlı süreyi aşarsa · `targetPicksPerMin` NULL iken bir performans sayısı basılırsa.

⚠️ **PAYDA TEK DEĞİL ÜÇ** ve hangisinin hangi orana girdiğini **kova** belirler (ISO 22400-2 + SEMI E10 + Nakajima; `MachineStopLossClass`):
`NON_SCHEDULED` → **hiçbir paydada yok** · `PLANNED` → planlı süreden düşülür · `UNPLANNED`/`SETUP` → KULLANILABİLİRLİK kaybı · `MINOR` → **PERFORMANS** kaybı, kullanılabilirlik DEĞİL.
⇒ *"Randıman"* tek bir sayı değildir; tek yüzdeye çökertilirse üç farklı büyüklük aynı adla anılır.
⚠️ **DÖRDÜNCÜ DURUM: "ölçülemedi".** `MachineRun.targetPicksPerMin` NULL → `MachineSpec.nominalPicksPerMin` yedeği → o da NULL ise **performans HESAPLANMAZ**, rapor *"P: ölçülemedi"* der. Boş hücre değil **beyandır**. (`picksPerRev` yalnız TAVANA girer, paydaya ASLA.)

**② DURUŞ PARETO**
> *"Şu tezgahta şu aralıkta en çok süreyi yiyen duruş SEBEBİ şudur (N olay, T dakika), ve bu sebep şu KOVAYA düşer."*
> **Yanlışlanır:** `NON_SCHEDULED` bir paydaya girerse · `MINOR` bir SEBEP gibi listelenirse · serbest metin bir satır üretirse.

⚠️ **İKİ EKSEN, KARIŞTIRILMAZ:** `ReasonPreset.code` = **SEBEP** (sıralama ekseni) · `MachineStopLossClass` = **SÜRE SINIFI** (gruplama ekseni). Tasarımın şerhi: *"`MINOR` bir SEBEP SINIFI DEĞİL, bir SÜRE SINIFIDIR"* — yalnız `tezgah.stopEventMinSeconds` altındaki duruşlardan türer ve `ReasonPreset.stopLossClass`a ASLA yazılamaz.
⇒ Tek eksende sunulursa *"mikro duruşlar"* bir sebep gibi görünür ve **operatöre yanlış iş verir** — raporun yanlış olmasının en pahalı biçimi.
⚠️ Sebep **serbest metin DEĞİL**: `reasonCode` → `ReasonPreset.code` (FK'SIZ, `Roll.cancelReasonCode` emsali) ve etiket **kopyalanıp DONAR** — katalog değişse geçmiş rapor değişmez.

**③ VARDİYA KARNESİ**
> *"A vardiyası (fabrika günü X, 08:00+8s) şu tezgahlarda şu üretimi yaptı; satırların K'sı ÖLÇÜLDÜ, L'si ELLE girildi, M'si ölçülemedi."*
> **Yanlışlanır:** gün sınırı `src/constants/time.ts` dışından gelirse · `source` kırılımı toplamda erirse · mühürlenmiş karne sonradan değişirse.

## Raporların İKİ DEĞİŞMEZİ

**① ELLE GİRİŞ BİRİNCİ SINIFTIR ve toplamda ERİMEZ.**
Veri çekilemeyen tezgahlar için elle giriş olacak ⇒ raporun **her toplam satırı** `MachineShiftStat.source` kırılımını taşır. **Tek yüzdeye çökertme YASAK:** *"%78"* denmez, *"%78 (ölçülen 62, elle 16)"* denir.
⚠️ `SIMULATED` `OPERATOR`dan **AYRI** durur — farklı güven sınıfı; kök `CLAUDE.md` *"uydurulmuş değer `source:'SIMULATED'` beyanıyla gider"* diyor ve birleştirmek o beyanı **yok eder**.
**Bekçisi:** toplam satırı kırılım toplamına eşit mi **ve** kırılım basılıyor mu. (Şema gerektirmez.)

**② UFUK YAZILIR — ve HER UFKUN TEK KAYNAĞI, AYRI ADI VAR.**
Rapor *"her şey tutuyor"* demez, *"şu tarihten sonrası ölçülü"* der.
⚠️ **Dokuma ufku ≠ defter ufku.** Ölçüldü 2026-09-13: `DEFTER_UFKU` **bekçi tarafında** yaşıyor (`scripts/test_consistency.ts:121`), ürün tarafında karşılığı **yok** ve bugün değeri **`null`**. İkisi farklı sorulara cevap verir — *defter ufku* = depoya yazan son kapısız yolun kapandığı gün; *dokuma ufku* = tezgah verisinin toplanmaya başladığı gün. ⇒ Dokuma raporu `DEFTER_UFKU`yu **OKUMAZ**; kendi ufkunu `src/constants/` altında **ayrı adla** ilan eder.
📌 Birleştirmek, iki farklı güvenilirlik sınırını tek sayıya çökertmek olurdu — ①'de `source` için reddedilen şeyin aynısı.

⚠️ **Beş tablonun beşi de bugün ŞEMADA YOK** (`ShiftDefinition` · `MachineShiftStat` · `MachineStopEvent` · `MachineRun` · `MachineSpec`) — bu bölüm raporların SÖZLEŞMESİDİR, uygulama değil.

## Açık sorular

- **Koşumsuz doff oranı ölçülmedi.** Sık çıkıyorsa bu bir veri modeli kararı değil bir ARAYÜZ kusurudur (tablet koşumu kendisi açmalı) — karne bu oranı basmalı ve sayı görülmeden karar verilmemeli.
- **`unitsPerCm`in kalıcı evi belirsiz** (kaynak: `WarpSpec` ailesi; **sert bağımlılık eklenmez**). Faz 1–2'de elle girilir ve donar. <sub>(DOKUMA-TEZGAH §10/#9)</sub>
- **Fason dokuma bloke:** `SubcontractorDispatchItem.rollId` **NOT NULL** ⇒ fasona yapısal olarak yalnız TOP gidebilir, iplik/levent gidemez. Ayrı dilim; dokuma kararından bağımsız ve Faz 1'i bloklamıyor.
- ~~**Advisory uzay numarası kesinleşmedi**~~ **KAPANDI 2026-09-13** — ölçüldü: `WEAVING_ORDER_LOCK_NS = 8032` indi (`helpers/weaving-order.helper.ts:24`, envanter `period-guard.helper.ts:57`). ⚠️ Önerilen `8034` **kullanılmadı** ve bu satır bir gün boyunca bayat kaldı. ⇒ *Numara çakışması sessizdir* uyarısı doğruydu ama **eksikti: bayat REZERVASYON da sessizdir.** Sonraki uzay için numara buradan değil, **`period-guard.helper.ts` başlığından** okunur.
  ⚠️ **`MachineRun` advisory uzayı ALMADI ve almayacak** (2026-09-13, P2): koşum tekilliği DB seddiyle kurulur (iki partial unique), yarışın kaybedeni P2002 alır ve servis 409'a çevirir — `work_sessions` emsali. *Her tekillik sorusu bir kilit istemez; sed yeten yerde kilit ikinci bir yazar yolu açar.*
