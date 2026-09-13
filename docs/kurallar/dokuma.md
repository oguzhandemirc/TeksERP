# Dokuma · Dokuma işi · Doff

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Hikâye, ölçüm ve gerekçe tasarım belgelerinde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> ⚠️ **BU ALAN BUGÜN TAMAMEN KÂĞITTADIR.** Ölçüldü 2026-09-13: şemada `WeavingOrder` · `DoffEvent` · `MachineRun` · `MachineSpec` **yok**; `machine%` öneki altında yalnız `machines` var. Burada yazılı kurallar **tasarım hükümleridir** ve kodda karşılıkları henüz doğmadı — okuyan onları bugünün haritası sanmasın. Kural satırları şema inerken kodun sözleşmesi olur.
>
> **Kaynak belgeler:** `docs/design/DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md` (iş emri bağı · süreç takibi · tablet · `DoffEvent` · `WeavingOrder`) · `docs/design/DOKUMA-TEZGAH-IZLEME-TASARIMI.md` (koşum · duruş · randıman · mühür) · `docs/design/DEVERE-LEVENT-TARAMASI.md` (levent ve defteri).

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
- **[ÇEKİRDEK]** `WeavingOrder.weavingOrderId` koşumda tutulur ama `DoffEvent`te TUTULMAZ — doff'un iş emri koşumdan türetilir, çünkü ikinci bir FK ikinci bir kaynak olur. <sub>(DOKUMA-IS-EMRI §3.8; `MachineRun.warpBeamId` emsali)</sub>
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

**Bugün VAR olanlar:**
- `test_devere_regime_gate` — devere kapısının üç halkayı (ticaret → iplik → devere) ELLE ölçtüğü; dokuma inince kardeş zincir aynı biçimde ölçülür.
- `test_audit_labels` — şemadaki her enum değerinin Electron karşılığı (yeni dokuma enum'ları beyan edilmeden geçemez).
- `test_reason_preset_kind_parity` — `LOOM_STOP` aynalarının iki yönlü eşitliği.
- `test_db_invariants` — yeni CHECK/partial index/trigger envantere yazılmadan geçmez.
- `test_timestamptz_contract` — yeni `DateTime` alanları.

**HENÜZ YOK (şema inerken yazılacak, ne ölçeceği yazılı):**
- `test_machine_doff_source` — ⚠️ adı `DOKUMA-TEZGAH-IZLEME-TASARIMI.md:1874`te geçiyor ama **dosya yoktur**. Üç şey ölçecek: ① `WEAVING` ile doğan topun kaynağı ve `DoffEvent` bağı · ② türetilen metrenin stok yazmadığı (AST: `producedM` ile `Roll` miktar yazan yol aynı ifadede geçemez) · ③ `DOFF_CANCEL` yüklemi, **negatif sondayla** (`NOT EXISTS` düşürülünce kırmızı vermeli).
- `test_weaving_order` — kapanış kapısı (açık koşumla 409 + koşum adları), iptalin defter satırlarına dokunmadığı, `plannedM`in kapanış tetiklemediği.

## Açık sorular

- **Koşumsuz doff oranı ölçülmedi.** Sık çıkıyorsa bu bir veri modeli kararı değil bir ARAYÜZ kusurudur (tablet koşumu kendisi açmalı) — karne bu oranı basmalı ve sayı görülmeden karar verilmemeli.
- **`unitsPerCm`in kalıcı evi belirsiz** (kaynak: `WarpSpec` ailesi; **sert bağımlılık eklenmez**). Faz 1–2'de elle girilir ve donar. <sub>(DOKUMA-TEZGAH §10/#9)</sub>
- **Fason dokuma bloke:** `SubcontractorDispatchItem.rollId` **NOT NULL** ⇒ fasona yapısal olarak yalnız TOP gidebilir, iplik/levent gidemez. Ayrı dilim; dokuma kararından bağımsız ve Faz 1'i bloklamıyor.
- **Advisory uzay numarası kesinleşmedi:** envanter bugün `8031`de bitiyor, `8032` (tezgah vardiya mührü) ve `8033` (devere) yazılmamış tasarım rezervasyonudur. `WEAVING_ORDER_LOCK_NS` için `8034` önerildi ama **iniş anında `helpers/period-guard.helper.ts` başlığından yeniden ölçülür** — numara çakışması sessizdir.
