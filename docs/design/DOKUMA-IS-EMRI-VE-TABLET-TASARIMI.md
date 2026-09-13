# Dokuma — iş emri bağı, süreç takibi ve tablet yüzeyi

> **Durum:** §1 HÜKME BAĞLANDI (2026-09-13, yönetici oturum). §2 ve §3 TASARIM — hükme bağlanmayı bekliyor.
>
> **Bu belgenin üç kararı şema inişini etkiler:** `MachineRun.workOrderStepId` kalkar (§1.4) · `lineNo` → `productionLineNo` (§1.6) · `DoffEvent` Faz 3'ten **Faz 1b'ye** çekilir (§3.1).
> **Kardeş belgeler:** `DOKUMA-TEZGAH-IZLEME-TASARIMI.md` (makine izleme: koşum, duruş, randıman, mühür) · `DEVERE-LEVENT-TARAMASI.md` (levent ve defteri) · `DOKUMA-DEVERE-SAHA-KAYNAGI.md` (saha kaynağı).
> **Bu belgenin sebebi:** iki kardeş belge de **makine izlemeyi** ve **leventi** tasarladı; ikisinde de *tablet için tek bölüm başlığı yok* ve *iş emri açmak için tek bölüm başlığı yok* (ölçüldü 2026-09-13). Oysa tezgah şemasının `MachineRun → WorkOrderStep` bağı, sınanmamış bir varsayıma oturuyordu. §1 o varsayımı ölçtü ve reddetti.

---

## §1 · Dokuma topun rotasında bir ADIM DEĞİLDİR — üçüncü doğum sınıfıdır

**HÜKÜM (2026-09-13, kullanıcı ölçütüyle):** Dokuma, topun rotasında bir adım değil, **kendi kimliği, kendi yaşam döngüsü ve kendi defteri olan ayrı bir VARLIKTIR.** `MachineRun.workOrderStepId` **kalkar.**

Ölçüt kaynağı kök `CLAUDE.md` (commit `4e63bc56`): *nesne topun rotasında bir **ADIM** mı, yoksa kendi kimliği ve defteri olan ayrı bir **VARLIK** mı? İlkinde istasyon/adım eklenir, ikincisinde yeni model meşrudur.*

### 1.1 · Ölçüm: bugün bir top nasıl doğuyor

Fabrika yedeğinden kurulu geliştirme veritabanı, 5.813 top (2026-09-13):

| `entrySource` | top | sınıf |
|---|---|---|
| `TAMBUR_SPLIT` | 3.254 | iş emri İÇİNDE, **ana toptan** (parent `TAMBUR_CONSUMED`) |
| `SUPPLIER_RECEIPT` | 2.205 | fabrika **DIŞINDAN** (iş emri yok) |
| `SUBCONTRACTOR_RETURN` | 332 | dışarıdan geri (parent `SUBCONTRACTOR_CONSUMED`) |
| `MANUAL_ENTRY` | 18 | dışarıdan, elle |
| `TAMBUR_MANUAL` | 3 | elle |
| `SEMI_FINISHED` | 1 | dışarıdan |
| **metre YARATAN sınıf** | **0** | — |

**Çıkan değişmez:**

> Bugün bir top ya fabrikanın **DIŞINDAN** gelir (iş emri yok), ya da iş emri içinde **BAŞKA BİR TOPTAN** doğar — ana top tüketilir, **metre korunur**. Üçüncü sınıf yoktur.

Kod da bunu söylüyor: adım tamamlanması top doğurmaz. Son adım **mevcut** topu `UPDATE` ile finalize eder (`roll-finalize.helper.ts:147-231`), ve `inventory.service.ts:5558`'in kendi yorumu birebir şöyle: **`PRODUCED YOK`**. İş emri içindeki her doğum bir **dönüşümdür** ve ayrı bir HTTP ucuyla, operatörün açık kararıyla tetiklenir — `StepStatus.COMPLETED`'a geçen hiçbir kod yolu `roll.create` çağırmaz.

**Dokuma bu sözlükte olmayan bir fiildir: iplikten metre YARATIR.** Ana topu yoktur, koruyacak metresi yoktur.

### 1.2 · Reddedilen şık: "dokuma bir rota adımı olsun"

Bu şık ciddi biçimde değerlendirildi — ucuzdu (rota şablonu, refakat kartı, izinler, listeler hazır) ve `Roll.producedInStepId` kolonu ilk bakışta *"top bu adımda doğdu"* diyor gibi görünüyordu. **Reddedildi, iki mekanik sebeple.**

#### (a) Adım durumu SALINIR ve iş emri tezgah koşarken kapanabilir

`roll-step.helper.ts:105-151` — adım durumu **topların hareketinden türetilir** (`openCount` · `closedCount` · `pendingRolls`). Dokuma adımı olsaydı:

| an | türetilen durum | gerçek |
|---|---|---|
| tezgah 2 gündür koşuyor, henüz top inmedi | `closedCount=0, pendingRolls=0` → **PENDING** | koşuyor |
| ilk top indi | `openCount≥1` → **ACTIVE** | ✅ |
| inen toplar KK1'e geçti | `openCount=0, closedCount>0, pendingRolls=0` → **COMPLETED** | ⚠️ **tezgah hâlâ koşuyor, 20 top daha gelecek** |
| sonraki top indi | → **ACTIVE** | geri döndü |

COMPLETED penceresinde `completeWorkOrderIfStepsDone` ateşlerse **iş emri tezgah koşarken kapanır.**

⚠️ **Sorun bir hata değil, türetmenin öncülünün yokluğudur:** bugünkü doğumların hepsi **partilidir** — kümeyi kapatan bir ana top vardır (Tambur'da parent tükenir, fasonda makbuz kapanır). Dokumada kümeyi kapatan hiçbir girdi topu yoktur, bu yüzden "hepsi geçti mi?" sorusu hiçbir zaman güvenilir biçimde cevaplanamaz.

Ve bu **sessizdir**: helper'ın kendi başlığı (`roll-step.helper.ts:95-99`) aynı salınımın daha önce ısırdığını ve *"kapanmış adım COMPLETED'tan ACTIVE'e GERİ DÖNÜYOR… `completeWorkOrderIfStepsDone` o iş emrini BİR DAHA ASLA kapatamıyordu — **hata da log da yok**"* diye kapandığını yazıyor. Sessiz bir kapanış, bir iş emrinin yanlış kapanmasıdır; fabrikada bunun adı **kaybolan üretimdir**.

#### (b) Bilinçle kapatılmış bir kapıyı yeniden açmayı gerektiriyordu

`POST /api/work-orders` ile açılan bir iş emrine bugün **hiçbir HTTP yolundan top eklenemez**: `GET /available-for-attach`, `PATCH /:id/attach-rolls`, `PATCH /:id/detach-rolls` 2026-06-12'de kaldırıldı (`workorder.routes.ts:58-61`; servis metotları yalnız `quick-start` ve seed için yaşıyor). Alan kuralı da bunu teyit ediyor (`docs/kurallar/is-emri.md:20`): *"Mevcut iş emrine top EKLEME YOK — rework ayrı emirdir."*

Dokumayı adım yapmak, bir tasarım kararını **başka bir modülün ihtiyacı için** iptal etmek olurdu. Ters yön: **yeni modül eski kararı bozmaz, kendi kabını getirir.**

### 1.3 · ⚠️ `producedInStepId` TUZAĞI — bu belgedeki en pahalı paragraf

Bu turda §1'in ilk taslağı **yanlış bir ölçümle** yazıldı ve reddedilen şıkkı savunuyordu. Hatanın anatomisi burada duruyor, çünkü **bir sonraki kişi aynı kolona bakıp aynı yanlış sonuca varacak.**

Yanlış ölçüm şuydu: *"5.813 topun 5.253'ü (%90) `producedInStepId` taşıyor ⇒ toplar zaten adımlarda doğuyor ⇒ dokuma da bir adım olabilir."*

**`producedInStepId` bir doğum izi DEĞİLDİR.** Kolonun yanında bunu söyleyen bir uyarı zaten yazılıydı (`roll-entry-station.helper.ts:33-39`):

> *"Doğum izi sanılır ama değildir: `attachRolls` onu iş emrinin İLK adımıyla **EZER**, `detachRolls` NULL'lar."*

Ölçülen büyüklük: **2.205 `SUPPLIER_RECEIPT` topun 1.678'i** sahte bir *"adımda doğdu"* izi taşıyor — bunlar fabrika dışından gelmiş, sonradan bir iş emrine bağlanmış toplar.

**Genelleştirilmiş kural:**

> **Dolu bir kolon, adının söylediği soruyu cevaplıyor olmayabilir. Kolon adı bir İDDİADIR, bir sözleşme değil.**
> `producedInStepId` *"hangi adımda doğdu"* der; gerçekte *"en son hangi iş emrine bağlandı"* tutar. Doğum sorusunun doğru aracı **`entrySource`**'tur.

İkinci kural, aynı vakadan:

> **Yazılı bir uyarı bir kapı değildir — ve bir kapı olmadığı için, onu okumak ÖLÇÜM sayılmaz; okumamak ise MAZERET değildir.**
> (Aynı sınıf bu hafta dört kez ısırdı: `check-migrations` `[ADVISORY] RESTRICT` uyarısı · `roll-entry-station.helper` başlığı · `roll-step.helper` salınım notu · bu vaka.)

### 1.4 · Kararın şemaya yansıması

| | |
|---|---|
| `MachineRun.workOrderStepId` | **KALKAR** (tasarım `DOKUMA-TEZGAH-IZLEME-TASARIMI.md:885`, `:942`, `:951`) |
| Yerine | dokuma işinin kendi kabı (§2) |
| `MachineRun.itemId` + `colorId` | **KALIR** — *"ne dokunuyor"* sorusu adıma ihtiyaç duymuyor |
| Doğan top | `entrySource = WEAVING` ile damgalanır, **KK1'den mevcut rotaya girer** |
| Rota mimarisi | **tek satır değişmez** |

⚠️ **Bugün taşınacak SIFIR satır var:** `machine_runs` tablosu henüz yok (ölçüldü — `machine%` öneki altında yalnız `machines` var). Bu bağı yarın düzeltmek veri taşımak demektir; **bugün bedava.**

Doğan topun KK1'den girmesi uydurma bir yol değil — `StationKind.RAW_QC`'nin şemadaki tanımı zaten şöyle (`schema.prisma:31`):

```
RAW_QC // KK1 — ham mal girişi / dokuma çıkışı
```

Sistem dokuma çıktısını baştan beri bekliyormuş.

### 1.5 · Üç firma, tek gövde, sıfır yeni bayrak

*Her seçeneği uygulayan firma gerçek* (kullanıcı doktrini). Üçü de destekleniyor:

| firma | model | bugünkü durum |
|---|---|---|
| **kendi tezgahında dokur** | dokuma işi + `MachineRun` | yeni (§2) |
| **dokumayı fasona verir** | aynı dokuma işi, `executionKind = SUBCONTRACTED`, `MachineRun` yok | ⚠️ **bağımsız engel** (aşağıda) |
| **hazır kumaş alır** (bugünkü `adnansahin`) | `GoodsReceipt` → `PURCHASE_RECEIPT` | **bugün çalışıyor, dokunulmuyor** |

Eksen, devere tasarımının `WarpBeamOrigin` için zaten seçtiği kalıbın aynısıdır (`IN_HOUSE` / dış taraf + XOR'lu taraf kolonu) — ikinci bir kalıp icat edilmiyor.

📌 **Fason dokuma ayrı dilimdir ve Faz 1'i bloklamaz:** `SubcontractorDispatchItem.rollId` **NOT NULL** (`schema.prisma:3887`) — fasona yapısal olarak yalnız TOP gidebilir, iplik ya da levent gidemez. Bu bir **fason sözleşmesi** sorusudur, dokuma sorusu değil; polimorfik sevk kalemi kendi diliminde çözülür.

📌 **Sipariş bağı Faz 1'de AÇILMAZ.** Kök kural: *"top↔sipariş satırı bağı YOKTUR, karşılama `SackAllocation` ile sevk anında."* Dokuma işi karşılama için sipariş bağına ihtiyaç duymuyor; `WorkOrderToOrderLine`'ın ikinci bir kopyası tam olarak *"aynı soruyu cevaplayan iki yol"* sınıfıdır.

### 1.6 · İniş önündeki iki kapı (bu belgenin dilimi değil, ama şema bunlara bağlı)

#### `ENUM_LABELS` — sessiz kapı ölümü, dokuma enum'ları inmeden ÖNCE kapanmalı

`test_audit_labels.ts:196` şemadaki her enum **değerinin** Electron karşılığını arar, ama `Electron/src/lib/audit-labels.ts`'teki `ENUM_LABELS` **düz `değer → Türkçe` haritasıdır ve ilk göreni tutar** (`enumValues` ilk kaydı korur). Tezgah enum'larıyla bugünkü çakışmalar:

| değer | haritadaki bugünkü Türkçe | tezgahtaki anlamı | sonuç |
|---|---|---|---|
| `MACHINE` | "Makine" (audit varlık türü) | `MachineDataSource` = makineden okundu | **yanlış kelime** |
| `PLANNED` | "Planlandı" (sevkiyat) | `MachineStopLossClass` = planlı duruş | **yanlış kelime** |
| `MINOR` | "Küçük" (kusur şiddeti) | `MachineStopLossClass` = kısa duruş | **yanlış kelime** |
| `OPEN` | "Açık (mal bekleniyor)" (alış siparişi) | `MachineSealState` = mühürsüz | **yanlış kelime** |

Dördü de audit ekranına yanlış Türkçe basar ve **kapı KIRMIZI VERMEZ.** Sınıf: *bekçi **VARLIĞI** ölçüyor, **ANLAMI** değil* — bekçinin yeşili doğruluğun değil **kapsamın** beyanıdır.

**Hüküm:** harita `değer` ile değil **`enum adı + değer`** ile anahtarlanır. Bugün çakışma 4; tezgah enum'ları inince artar ve **her yenisi sessizdir.** Sahibi: `test_audit_labels` + `audit-labels.ts` dilimi. ⚠️ Daha genel borç: **yeni enum getiren her modül bu haritaya görünmeyen bir borç yazıyor.**

#### `lineNo` → **`productionLineNo`** (ad değişir, geri adım atan YENİ olandır)

`lineNo` adı şemada zaten iki kez var ve **başka anlamda**: `InvoiceLine.lineNo` (`schema.prisma:6980`) ve `PurchaseOrderLine.lineNo` (`:8066`) = **belge satır numarası**, canlı veride ve dışa aktarımlarda yaşıyor.

**Kural: iki anlam çarpıştığında geri adım atan YENİ olandır.** Yeni ad **`productionLineNo`** — `Machine.productionLineCount`'un birebir aynası, yani *sayı* ile *numara* aynı sözlükten okunur. Ölçüt karşılanıyor: *bu adı ilk kez gören biri hangi soruyu cevapladığını tahmin edebilmeli.*

Etkilenen tanımlar — **kardeş belgeye uygulandı** (`DOKUMA-TEZGAH-IZLEME-TASARIMI.md`, 18 satır):
`MachineRun.productionLineNo` · `MachineInterval.productionLineNo` (PK'ya girer) · `MachineShiftStat.productionLineNo` (unique'e girer) · `PeripheralSignal.productionLineNo` (nullable, varsayılan YOK).

Kısıt adı kolona hizalanır (proje alışkanlığı: `machines_warp_beam_slots_nonneg` ↔ `warpBeamSlots`): `machine_runs_one_open_per_line_uq` → **`machine_runs_one_open_per_prod_line_uq`**.
⚠️ `machine_stops_one_open_per_machine_uq` **DEĞİŞMEZ** — o "bir makinede tek açık DURUŞ" der ve hat eksenine bölünmez (§5.4: duruş sayaçları çoğullaştırılmaz).

---

## §2 · Süreç takibi — hangi tezgahta ne var, ne kadar kaldı

### 2.1 · ÜÇ BİRİM, ÜÇ EKSEN — tek sayıya bindirilmez

*"Bir dokuma işi hangi birimde planlanır — metre mi, levent mi, top mu?"* sorusunun cevabı **üçü de**, ve bu bir kaçamak değil ölçülmüş bir ayrımdır:

| eksen | birim | kim belirler | nereye yazar |
|---|---|---|---|
| **TALEP** | metre | sipariş kalemi / stok kararı | `WeavingOrder.plannedM` |
| **İCRA** | levent | çözgü kartı + tezgah kapasitesi | `WarpBeamEvent` (MOUNT/DISMOUNT) |
| **ÇIKTI** | top | operatörün doff kararı | `Roll` (ölçülen metre) |

Üçü **bağımsızdır** ve aralarındaki çevrim **ölçülür, varsayılmaz**:
- metre → levent çevrimi **take-up** gerektirir; devere tasarımı take-up'ın kumaş teknik kartının işi olduğunu ve **bugün mevcut olmadığını** yazdı. Bu yüzden *"bu iş kaç levent eder"* **hesaplanmaz**, planlayan kişi bilir.
- levent → top çevrimi doff kararlarından doğar; kaç top çıkacağı **planlanamaz**.

⚠️ Bu, §1.2'nin aynı sınıfıdır (**birleştirilmiş eksen**): üç bağımsız gerçeği tek sayıya bindiren model, her uçta sessizce yanlış olur ve yalnız test edilen uçta doğru çalışır. Raşel/çift-enli ayrımında aynı hata bir kez yakalandı (`DOKUMA-TEZGAH-IZLEME-TASARIMI.md` §10/#23: *"ÜRETİLEN KUMAŞ SAYISI, TÜKETİLEN LEVENT SAYISINDAN BAĞIMSIZ BİR EKSENDİR"*).

### 2.2 · Dokuma işinin kabı — `WeavingOrder` (tam tasarım, **ŞEMAYA YAZILDI** — P1, `77b69da9`)

**Sınıfı: İŞ KABI** — `WorkOrder` emsali. Mutasyona uğrar ⇒ `createdAt` + `updatedAt` + künye (`DoffEvent`in DEFTER sınıfından farklı; o append-only'dir).

```prisma
/// DOKUMA İŞİ — "ne dokunacak, ne kadar, kim dokuyacak".
/// ⚠️ Bir `WorkOrder` DEĞİLDİR ve onun rotasını/adımlarını taşımaz (§1 hükmü):
/// dokuma topun rotasında bir adım değil, topu DOĞURAN ayrı bir varlıktır.
model WeavingOrder {
  id                 String   @id @default(uuid()) @db.Uuid
  weavingOrderNumber String   @unique @db.VarChar(64)
  clientToken        String?  @unique @db.Uuid

  /// Dokunacak kumaş — `ItemType.FABRIC` (servis 400).
  itemId      String  @db.Uuid
  /// Ham dokumada NULL MEŞRUDUR — renk sonraki adımlarda gelir.
  colorId     String? @db.Uuid
  /// Hangi çözgü kartı besliyor. Faz 1a'da doğan `WarpSpec`in ilk tüketicisi.
  warpSpecId  String? @db.Uuid

  /// TALEP ekseni (§2.1) — metre. NULL = açık uçlu iş (levent bitene kadar dok).
  /// ⚠️ HEDEFTİR, TETİK DEĞİLDİR: bu sayıya ulaşmak işi KAPATMAZ (§2.2a).
  plannedM    Decimal? @db.Decimal(12, 3)

  /// KİM DOKUYOR. `WarpBeamOrigin` kalıbının kardeşi — ikinci bir desen icat edilmez.
  executionKind    WeavingExecutionKind
  /// XOR: `SUBCONTRACTED` ise DOLU, `IN_HOUSE` ise NULL.
  /// ⚠️ CHECK `weaving_orders_party_ck` **HENÜZ YOK** — bu satır bir dönem var gibi
  /// yazıyordu. P1'in migration'ı onu bilerek ertelemişti: *kapısız bir CHECK,
  /// yazanı olmayan bir kısıttır* ⇒ yazma yüzeyiyle AYNI dilimde iner. Birincil
  /// doğrulama servis kapısındadır (`resolveSupplierParty` kalıbı).
  /// ⚠️ İKİNCİ HATTIR — birincil doğrulama `resolveSupplierParty` kalıbındaki tek kapıda.
  subcontractorId  String? @db.Uuid

  status      WeavingOrderStatus @default(PLANNED)
  plannedStartDate DateTime? @db.Timestamptz
  plannedEndDate   DateTime? @db.Timestamptz
  notes            String?   @db.VarChar(500)

  /// KAPANIŞ — açık karardır, türetilmez (§2.2a).
  closedAt     DateTime? @db.Timestamptz
  closedById   String?   @db.Uuid
  /// İPTAL — soft. ⚠️ Sebep **SERBEST METİNDİR** (`VarChar(300)`), sebep
  /// kataloğundan DEĞİL: bu satır bir dönem "kataloğundan" diyordu ve aşağıdaki
  /// alanla çelişiyordu. Kataloğa bağlamak yeni bir `ReasonPresetKind` değeri
  /// ister ve o GERİ ALINAMAZ (PG enum değeri düşürülemez).
  /// ⏳ BORÇ, kapanma koşuluyla: `ReasonPresetKind.MACHINE_STOP` dilimi (P2b-2)
  ///    indiğinde, dokuma işi iptalinin kendi `kind`ini hak edip etmediği
  ///    KULLANIM ÖLÇÜLEREK sorulur — bugün kullanım verisi sıfırdır.
  cancelledAt  DateTime? @db.Timestamptz
  cancelledById String?  @db.Uuid
  cancelReason String?   @db.VarChar(300)

  machineRuns MachineRun[]   // ⚠️ ad `runs` DEĞİL — şema `machineRuns` (P1'de indi)

  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt      @db.Timestamptz
  createdById String? @db.Uuid
  updatedById String? @db.Uuid

  // ⚠️ ŞEMADA BEŞ index var, burada iki yazılıydı — belge eksikti, şema değil.
  // Dördü domain FK'sı ([DB-12]), biri ekran sorgusu (eşitlik önce).
  @@index([status, plannedStartDate])
  @@index([itemId])
  @@index([colorId])
  @@index([warpSpecId])
  @@index([subcontractorId])
  @@map("weaving_orders")
}

enum WeavingExecutionKind { IN_HOUSE  SUBCONTRACTED }
enum WeavingOrderStatus   { PLANNED  IN_PROGRESS  COMPLETED  CANCELLED }
```

**Numara üreteci:** `workOrderNumber` emsali — sequence okuma **tx İÇİNDE**, `withBarcodeRetry`. Advisory uzay gerekir. ⚠️ **`WEAVING_ORDER_LOCK_NS = 8032` İNDİ** (`services/helpers/weaving-order.helper.ts:24`, envanter `period-guard.helper.ts:57`). Bu satır bir dönem *"8032 vardiya mührüne rezerve, dokuma işine 8034"* diyordu ve **YANLIŞTI** — iniş anında envanterden yeniden ölçüldü ve sıradaki boş numara 8032 çıktı; rezervasyonlar sırayla inmemişti. 📌 Aynı bayat numara bu belge ailesinde **ÜÇ kez** çıktı (`dokuma.md` bir kez d9 tarafından kapatıldı, bu belge taşımaya devam etti). ⇒ ***Bir bayat sayıyı bir belgede düzeltmek, onu taşıyan ötekini düzeltmez*** — ve ***bir rezervasyon SAYI tutarsa bayatlar; SORU ve ÖLÇÜM YERİ tutarsa bayatlamaz.*** Sonraki uzay buradan değil **envanterden** okunur.

#### (a) Kapanış ölçütü — AÇIK KARAR, türetilmez

Üç aday vardı; ikisi reddedildi:

| aday | karar | gerekçe |
|---|---|---|
| levent bitince | ❌ | §2.3 zaten *"levent bitince koşum bitmez"* diyor; iş emri evla |
| `plannedM`e ulaşınca | ❌ **reddedildi** | ⚠️ aşağıda |
| **operatör kapatır** | ✅ | |

⚠️ **`plannedM` neden tetik değil:** o sayı **ÜRETİLEN**e karşı ölçülür, yani KK1'de ölçülmüş top metresine — ve o sayı **geç gelir** (top doff'tan günler sonra ölçülür). Geciken bir sayıya bağlı otomatik kapanış, **tezgah hâlâ koşarken işi kapatır.** Bu, §1.2(a)'da dokumayı rota adımı yapmayı reddettiğimiz salınım kusurunun **yeni bir yerde kurulmuş hâlidir**; aynı hatayı ikinci kez yapmıyoruz.

⇒ `plannedM`e ulaşmak bir **rozet/uyarı** üretir (*"hedefe ulaşıldı"*), **durum değişikliği değil.**

**Kapanış kapısı:** açık koşum varken kapanmaz → **409**, ve koşumları **adıyla** söyler:
`{ code: "WEAVING_ORDER_HAS_OPEN_RUNS", machines: [...], runIds: [...] }`.

#### (b) Ters yol — iptal doff'u, koşumu, duruşu SİLMEZ

> Kök kural: *geri alma ileri kaydı NE SİLER NE DEĞİŞTİRİR.*

Koşum, duruş ve doff **olmuş olaylardır**; işin iptali onları olmamış yapmaz. İptal **yalnız `WeavingOrder` üstünde bir durum geçişidir** (atomik claim: `updateMany WHERE {id, status: <beklenen>}` + `count===0 → 409`).

| nesne | iptalde ne olur |
|---|---|
| `MachineRun` (kapanmış) | **dokunulmaz** — o koşum gerçekten koştu |
| `MachineRun` (açık) | **409, önce kapat** (yukarıdaki kapı) |
| `MachineStopEvent` | **dokunulmaz** |
| `DoffEvent` | **dokunulmaz** — kendi ters yolu var (`DOFF_CANCEL`, §3.8) ve ölçütü ayrıdır |
| doğmuş `Roll` | **dokunulmaz** — stokta kalır; `WorkOrder` iptalinde toplar `STOCK`'a düştüğü gibi |

⚠️ **`MachineRun.weavingOrderId`i `null`'lamak YASAKTIR** — ileri damgayı `null`'lamak ters kayıt değildir (`Roll.doffEventId` ile aynı aile). İptal edilmiş bir işe bağlı koşum, *"bunu şu iş için dokuduk, sonra iş iptal edildi"* der ve bu **doğru bir cümledir**.

#### (c) Sipariş bağı — Faz 1'de AÇILMIYOR, ve sebebi burada yazılı

> Bu paragraf, kararın altı ay sonra yeniden önerilmemesi için var.

1. **Karşılamaya gerek yok.** Kök kural: *"top↔sipariş satırı bağı YOKTUR — karşılama `SackAllocation` ile SEVK ANINDA yazılır."* Dokuma stoka üretir; hangi siparişe gideceği sevkte belli olur.
2. **İkinci kopya sınıfı.** `WeavingOrderToOrderLine` pivotu, `WorkOrderToOrderLine`'ın *aynı soruyu cevaplayan ikinci yolu* olurdu.
3. **Bedeli ölçülmüş.** Sipariş bağı açmak yanında şunları getirir: tip aynası (`WorkOrder.type` = *"bağın aynası"*, beş ayrı zorlama noktası), **iki bağ yolu iki sözleşme** (create/replace türetir, sonradan bağ MİRAS ALMAZ), uyumsuz-bağ override'ı ve süpervizör izni. Bunların hepsi `WorkOrder`da pahalıya öğrenildi.
4. **İstenen şey aslında REZERVASYON.** *"Bu dokuma şu müşteri için"* cümlesi bir rezervasyondur ve **rezervasyon bu üründe YOKTUR** — profil kararı (`MODUL-BAYRAK-TASARIM.md` #6).

**Ne zaman açılır:** bir fabrika *"dokunan malı sevkten önce siparişe kilitlemek"* isterse. O zaman açılacak şey sipariş bağı değil **rezervasyon mekanizmasıdır** ve kararı bu belge vermez.

#### (d) `MachineRun` tarafındaki tek kolon ve Faz 1'in sınırı

`MachineRun.workOrderStepId` **kalkar** (§1.4), yerine:

```prisma
/// HANGİ DOKUMA İŞİ. NULL MEŞRUDUR — tasarımın kendi cümlesi zaten böyleydi:
/// "Bağ OPSİYONEL: iş emirsiz koşum meşrudur (numune, deneme)." Cümle korunuyor,
/// yalnız işaret ettiği yer değişiyor. `onDelete: Restrict` (üç opsiyonel bağın hepsi).
weavingOrderId String? @db.Uuid
```

**Faz 1'de BİLEREK YOK:**
- ❌ **sipariş bağı** — (c)'de gerekçesi yazılı
- ❌ **`requiredBeamCount`** — take-up bugün yok, *"bu iş kaç levent eder"* hesaplanamaz (§2.1)
- ❌ **rota şablonu / adım** — §1 hükmü
- ❌ **refakat kartı** — kart iş emriyle doğar (`TravelerCard.workOrderId @unique`); dokuma bir iş emri değildir
- ❌ **otomatik kapanış** — (a)'da reddedildi

### 2.3 · Levent bitince koşum BİTMEZ

Bu iki olay bağımsızdır ve karıştırılırsa randımanın paydası bozulur:

| olay | ne demek | nereye yazar |
|---|---|---|
| **levent bitti** | fiziksel: çözgü tükendi | `WarpBeamEvent` DISMOUNT |
| **koşum bitti** | mantıksal: randımanın paydasını belirleyen koşullar değişti | `MachineRun.endedAt` |

Tezgah tasarımının kendi kuralı zaten koşumu paydayla tanımlıyor: *"HEDEF DEVİR… DEĞİŞİRSE KOŞUM KAPANIR, yenisi açılır; tek satırda iki devir tutmak paydayı belirsizleştirir."* Levent değişiminde desen ve hedef devir **değişmez** ⇒ **koşum sürer.**

Ve bu karar yeni bir mekanizma istemiyor: `beamsMountedDuring(machineId, from, to)` zaten bir **küme** döndürür, tek levent değil — yani çoklu levent baştan öngörülmüş. `MachineRun.warpBeamId` kolonunun silinmiş olmasının sebebi de buydu.

**Koşumu bitiren üç şey:** desen/renk değişti · hedef devir değişti · iş bitti (operatör kapattı). Levent değişimi **bu üçünde yok.**

### 2.4 · İlerleme — İKİ SAYI, asla toplanmaz

*"Makineden türetilen metre stok yazmaz — o hâlde ilerleme neye göre ölçülür?"* Cevap: **iki ayrı sayı, iki ayrı soru.**

| sayı | kaynak | cevapladığı soru | stok yazar mı | rapora girer mi |
|---|---|---|---|---|
| **ÜRETİLEN** | Σ doff edilen topların **ölçülen** metresi | *"kaç metre teslim edildi?"* | ✅ evet | ✅ evet |
| **TEZGAHTA** | `pickDelta ÷ unitsPerCm` (türetilen) | *"şu an tezgahta ne kadar var?"* | ❌ **asla** | ❌ yalnız canlı ekran |

Aradaki fark **gerçek ve anlamlıdır**: leventte dokunmuş ama henüz indirilmemiş kumaş. Bu bir tutarsızlık değil, **devam eden iştir**.

⚠️ İki sayı **hiçbir yüzeyde toplanmaz ve birbirinin yerine geçmez.** Tezgah tasarımının kuralı aynen korunuyor: *"TÜRETİLEN METRE ASLA STOK YAZMAZ — tek miktar gerçeği `Roll` ölçümüdür."* Türetilen sayı her gösterildiği yerde **türetilmiş olduğunu beyan eder** (`source` alanı; `SIMULATED` beyanının aynı sınıfı).

`plannedM` varsa kalan = `plannedM − ÜRETİLEN`. **`TEZGAHTA` bu çıkarmaya girmez** — girerse teslim edilmemiş mal teslim edilmiş sayılır.

### 2.5 · Bayrak: `dokuma.enabled` — `tezgah.enabled`in KARDEŞİ, çocuğu değil

Bugün iki bayrak var: `tezgah.enabled` ("Tezgah izleme", ön koşul `production`) ve `devere.enabled` ("Devere / levent", ön koşul `iplik`).

Dokuma işi **üçüncü bir yetenektir** ve ikisiyle de aynı şey değil:
- fasona dokutan firmanın **hiç makinesi yoktur** → dokuma işi var, tezgah izleme yok
- yalnız devere makinelerini izleyen firma → tezgah izleme var, dokuma işi yok (`MachineClass.WARPER`)

⇒ **`dokuma.enabled` yeni bayrak, ön koşulu `production.enabled`.** `tezgah.enabled` **değişmez** — ikisi kardeştir, biri diğerinin ön koşulu değildir.

**Varsayılan `false` = bugünkü davranış, ve bu cümle ÖLÇÜLDÜ:** fabrika yedeğinde 245 kalem / **0 İPLİK kalemi** / **0 çözgü kartı** — fabrika bugün dokumuyor, kumaş hazır geliyor. (Kök `CLAUDE.md`: *"[PROFİL] `adnansahin` bugün çözgü/dokuma yapmıyor"* — artık ölçümle de duruyor.)

## §3 · Tablet yüzeyi — dokumacının ekranı

> Kök kural: *"Bir yetenek 'VAR' sayılmak için üçü birden: motor + **en az bir çıkış yüzeyi** + izin ataması."* ⚠️ **Bu cümle DEVERE için BAYAT** (ölçüldü 2026-09-13): Çözgü Kartları ekranı indi (`Electron/src/pages/WarpSpecs/`, route `definitions/warp-specs`, uç `/api/warp-specs`) ⇒ devere artık yüzeysiz DEĞİL. **Tezgah** bugün de yüzeysizdir ⇒ kendi kuralımıza göre o modüller **yok** sayılır. Bu bölüm o yüzeyi kurar.

### 3.1 · ⚠️ FAZ SIRASI DÜZELTMESİ — `DoffEvent` Faz 3'ten Faz 1b'ye çekilir

Tezgah tasarımı `DoffEvent`i **Faz 3'e** koydu (`DOKUMA-TEZGAH-IZLEME-TASARIMI.md:1865`) ve modelini hiç yazmadı — yalnız adı geçiyor. Ama bekçisini baştan adlandırmış (`:1874`, `test_machine_doff_source.ts`).

**Bu sıra tutmuyor:** doff, dokumanın *top ürettiği* andır. Onsuz tablet ekranı koşum başlatıp duruş bildiren ama **hiçbir mal üretmeyen** bir ekrandır; yani yüzey var, çıktı yok. Bir modül çıktı üretmeden sahaya inmez; dokuma bir **üretim** modülüdür, izleme onun yan ürünü. `DoffEvent` **Faz 1b'ye çekilir** — bekçisi `test_machine_doff_source.ts` de aynı fazda okunur (adı tezgah belgesinde Faz 3 satırında geçiyor; **o satır bayattır**).

⚠️ **Tutarsızlığın kendisi bir sınıftır:** tasarım `DoffEvent`i Faz 3'e koymuş, **modelini hiç yazmamış**, ama **bekçisini baştan adlandırmış**.
> **Bir bekçinin ADININ yazılmış olması, ölçtüğü şeyin TASARLANMIŞ olduğunu göstermez.** Ad bir niyettir, model bir karardır — ve faz sırasını niyet belirlerse sıra yanlış çıkar.

### 3.2 · Ekranın şekli: bir TEZGAH, bir liste değil

Mevcut istasyon ekranları (KK1 · Kurşun · Tambur) **kuyruk** ekranıdır: önünde bekleyen işler vardır, operatör birini seçer. **Dokumacının önünde kuyruk yoktur — bir (ya da iki) tezgah vardır ve o tezgah ya koşuyordur ya durmuştur.**

```
┌──────────────────────────────────────────────────────┐
│  DOKUMA 04            [PlaceChip: Dokuma 04]    👤   │
├──────────────────────────────────────────────────────┤
│  ● KOŞUYOR            342 dev/dk      ⏱ 06:14        │
│  ‹çözgü kartı› · ‹desen› ‹renk›                       │
│  ───────────────────────────────────────────────     │
│  Levent   A: %38 kaldı      B: %41 kaldı             │
│  Bu koşumda: 1.240 m üretildi · ~86 m tezgahta       │
│  Vardiya: 4 duruş / 22 dk · 2 sebepsiz  ⚠            │
├──────────────────────────────────────────────────────┤
│   [ DURUŞ BİLDİR ]   [ TOP İNDİR ]   [ LEVENT ]      │
└──────────────────────────────────────────────────────┘
```

**Tek tezgah = tek ekran.** `Machine.productionLineCount > 1` ise (çift enli) gövde **iki kolona** bölünür ve her kolon kendi `productionLineNo`sunu taşır — §2.1'in ÇIKTI ekseni burada görünür hâle gelir. `productionLineCount = 1`'de ikinci kolon **hiç çizilmez** (bugünkü davranış, sıfır fark).

**Sebepsiz duruş rozeti** (`⚠ 2 sebepsiz`) ekranın tek "borç" göstergesidir ve dokunulabilir — sınıflandırma bekleyen duruşlara götürür.

### 3.3 · Oturum: yeni `StationKind.WEAVING`

Tablet **cihaz seçmez, YER seçer** (`PlaceConfirmView` drill-down: istasyon → makine). Dokuma makine düzeyindedir ⇒ oturum makineyle açılır ve `stationId` backend'de makineden **türetilip dondurulur**.

Gerekenler — hepsi mevcut kalıbın satırları, yeni mekanizma yok:

| yer | ek |
|---|---|
| `schema.prisma` `StationKind` | `WEAVING` değeri (**enum reçetesi 13 adım**) |
| `work-session.service.ts:33` | `SESSIONABLE_STATION_KINDS += WEAVING` |
| `work-session.service.ts:38` | `STATION_KIND_PERM += WEAVING → mobile:dokuma` |
| `mobil/src/constants/stationScreens.ts:16,24` | **İKİ harita** (kind↔ekran) |
| `mobil/src/types/permissions.ts` | union + `MOBILE_SCREENS` + `MobileScreenKey` |
| `mobil/src/theme/tokens.ts:156` | `moduleAccents` satırı (yoksa `tsc` düşer) |
| `MainNavigator.tsx:20` | `SCREEN_LOADERS` |
| backend `screen-catalog.ts` | 17. mobil ekran, `modul: "dokumaEnabled"` |

⚠️ `mobil/package.json`'da typecheck script'i **yok** ve Metro tip denetlemez — bu `Record`'lar elle `npx tsc --noEmit` ile doğrulanır.

**Yön:** tablet yatay (`useLandscapeLock`), KK1/Tambur emsali.

### 3.4 · Dört eylem

#### (1) Koşum başlat / bitir

`MachineRun` açar/kapatır. **Koşumu bitiren üç şey** (§2.3): desen/renk değişti · hedef devir değişti · iş bitti. **Levent değişimi bu üçünde YOK.**

Başlatırken sorulanlar: hangi dokuma işi (`WeavingOrder`, opsiyonel — numune koşumu meşru) · desen/renk (işten ön-dolu, **kilitli değil**) · hedef devir (`targetPicksPerMin`; boş bırakılabilir → `MachineSpec` yedeği → o da yoksa **performans HESAPLANMAZ**, "P: ölçülemedi").

#### (2) Duruş bildir

Yeni `ReasonPresetKind.LOOM_STOP` → **beş kapı** (Prisma + `ADD VALUE` migration · backend katalog · Electron `KIND_TABS` · mobil union+`KIND_STORES_TEXT`+`KIND_LABELS` · **mobil gömülü zemin**).

⚠️ **Gömülü zemin PAZARLIK DIŞI:** sunucuya erişilemezken katalog boş dönerse sebep zorunlu olan karar kaydedilemez ve **tezgah ekranda kilitlenir**. `constants/loomStopReasons.ts` + `useReasonPresets.ts:40` switch dalı + `:86` `BUILTIN` kaydı.

Sunum `ReasonPresetPicker` — **serbest metin ÜSTTE, chip'ler altında** (2026-08-19 kararının kendisi, tercih değil). Kod **uydurulmaz**: hiçbir chip seçilmediyse `code` `requiresText` satırınınkidir, o yoksa `null`.

`warpBeamSlots > 1` olan tezgahta duruş kaydı ayrıca **hangi yuva** sorar (`MachineStopEvent.beamSlot`); bilinmiyorsa **NULL kalır ve Pareto'da "atanmamış" kovasında ayrı gösterilir** — tahminle bir levende yazılmaz. `warpBeamSlots <= 1` ise alan **hiç çizilmez**.

#### (3) Levent değişimi

`WarpBeamEvent` MOUNT/DISMOUNT yazar. Koşum **sürer** (§2.3). Söküm kapısı **sıfır kolonla** türetilir (devere kararı):

```
sökümden sonra bağlı kalan aktif levent sayısı = n
  n == 0 ve açık koşum var       → 409  (koşum leventsiz süremez)
  0 < n < Machine.warpBeamSlots  → UYARI (ApiResponse.warnings), 400 DEĞİL
  n == warpBeamSlots             → sessiz
```

#### (4) TOP İNDİR (doff) — en kritik an

### 3.5 · DOFF ÇATALI: top tezgahta mı doğar, KK1'de mi?

İki şık ciddi biçimde değerlendirildi.

| | (a) top tezgahta doğar | (b) doff olay yazar, **top KK1'de doğar** |
|---|---|---|
| ölçüm | dokumacı kaliteyi ve metrajı tezgah başında girer | kumaş muayene masasına gider, orada ölçülür |
| motor | tabletten `createInitialEntry` | **KK1'in bugünkü motoru, aynen** |
| yeni rol | dokumacı **muayeneci** olur | rol değişmez |

**KARAR: (b).** Gerekçeler ölçülmüş:

1. **`StationKind.RAW_QC`'nin şemadaki tanımı zaten bunu söylüyor** (`schema.prisma:31`): *"KK1 — ham mal girişi **/ dokuma çıkışı**"*.
2. **"İKİNCİ BİR GİRİŞ MOTORU YAZILMAZ"** (`goods-receipt.service.ts:8`) — 12 mantıksal doğum yolunun tamamı `createInitialEntry`'den geçiyor. Doff da geçer: yeni motor değil, yeni `forcedEntrySource: WEAVING`.
3. KK1'de **zaten var**: HAL metre okuma · kantar · kalite çipleri · etiket basımı + scan-back doğrulama · çevrimdışı kuyruk · `clientToken` idempotency. Tezgah ekranında bunların **hepsini ikinci kez** kurmak gerekirdi.
4. Fiziksel gerçek: tezgahtan inen kumaş muayene masasına gider. Dokumacıya kalite yargısı yaptırmak **yeni bir rol** icat etmektir.

**Doff'un tablette yaptığı iş:**

```
DoffEvent
  machineId · productionLineNo · weavingOrderId? · machineRunId
  doffedAt (clientEnteredAt kalıbı) · pieceCount
  counterAtDoff        ← ⚠ aşağıya bak
  clientToken @unique  ← idempotency
  code                 ← fiziksel etikete yazılan kısa kod
```

⚠️ **`counterAtDoff` bir tasarım katkısıdır, süs değil.** Tezgah belgesi `:1359`: *"16-bit sarma ile operatörün doff'ta sayacı sıfırlaması **ayırt edilemeyebilir**"* ve bu yüzden negatif sıçrama sarma diye yorumlanmıyor, insana bırakılıyor. Doff anında sayaç değerini **kaydetmek o belirsizliği kaynağında kapatır**: sıfırlama artık beyan edilmiş bir olaydır, tahmin edilecek bir anomali değil.

**Zincirin kapanması — `Roll.doffEventId String?`:**

KK1'de top yaratılırken, `dokuma.enabled` açıksa ve açık doff olayı varsa ekran **sorar**: *"Bu top hangi indirmeden?"* (③ aksiyon anında seçim). Cevap yoksa **NULL kalır ve raporda "atanmamış" olarak AYRI gösterilir** — `beamSlot`un aynı kalıbı, tahminle yazılmaz.

⚠️ **Ham/dokuma ayrımı ÇIKARILMAZ, SORULUR.** `dokuma.enabled` açık bir fabrikada KK1'e gelen top ya dokunmuştur ya satın alınmıştır; ikisi de aynı gün olur. Kusur kataloğunun ⑤ ailesi (*"renk varsa mamuldür"* çıkarımı) tam bu sınıftır. ⇒ KK1 sorar, `entrySource` cevaptan doğar.
**`dokuma.enabled` kapalıyken KK1 bugünküyle BİREBİR aynıdır** — soru hiç çizilmez, `entrySource` bugünkü sezgisinden gelir.

### 3.6 · Çevrimdışı ve idempotency

Dört eylemin dördü de **kuyruğa girer** (`STATION_MUT` + `OFFLINE_AWARE`) — ⚠️ **GEÇERSİZ → 2026-09-14 (1e hükmü, DÖRT eylem için):** `kk1.md` "kayıt kuyruğu kaldırıldı, anlık toast"; tezgah ekranının dört eylemi de online-only + `announceFailure` anlık toast, `STATION_MUT` kuyruğuna GİRMEZ (§3.9 B ve J.5) — tezgah başında ağ en zayıf yerdir ve duruş bildirimi gecikirse **randımanın paydası bozulur**.

Üç dosya, üçü de zorunlu (`RECETELER.md:295`): `offline/mutations.ts:44` anahtar (`['station', …]` olmak ZORUNDA) · `:149` `setMutationDefaults` · `offline/stationLabels.ts:16` etiket (etiketsiz anahtarı bekçi düşürür).

`mutate(vars)` ile çağrılır — **payload closure'dan okunmaz** (persist yalnız `variables` saklar).

Doff idempotency `offline/entryAttempt.ts` kalıbını aynen kullanır: `{clientToken, clientEnteredAt}` birlikte doğar/tazelenir; token **yalnız belirsiz hatada yapışır** (ağ/zaman aşımı/5xx), kesin 4xx'te yapışmaz.

### 3.7 · Kusur kataloğu — 12 madde, ekranda karşılığı

Yeni ekran, ölçülmüş 10 mobil kusurun hiçbirini tekrarlamaz:

| # | kural | dokuma ekranında |
|---|---|---|
| 1 | katalog kodu/adı/regex literal değil | duruş sebebi katalogdan; hiçbir kod gömülü değil (gömülü **zemin** ayrı şey — `code` taşır, literal karşılaştırma yapmaz) |
| 2 | `[0]` / `find(name===)` / "son işlem" fallback yok | sebep seçilmezse **`null` kod**, uydurma yok; doff bağı bulunamazsa NULL |
| 3 | her çağrıda `session.station.id`, uyuşmazsa açma | koşum/duruş/doff üçü de oturumun `machineId`siyle gider |
| 4 | iş kimliği adım kimliği, kart/barkod değil | `machineRunId` (koşum kimliği) |
| 5 | yargı alanları kayıttan sonra sıfırlanır | doff'ta `pieceCount` sıfırlanır; miras değer **amber rozetle** işaretlenir |
| 6 | ölçüm alanı ön-doldurulmaz | `counterAtDoff` **cihazdan** okunur; okunamazsa elle ve *"ölçülmedi"* seçilebilir |
| 7 | hedef depo oturumdan ya da sorulur | doff depo yazmaz (top KK1'de doğar) — soru KK1'in |
| 8 | backend'in aldığı her alanı ekran sorar | `pieceCount` · `counterAtDoff` · duruş `beamSlot` — hiçbiri sessizce atlanmaz |
| 9 | istemci zorunluluğu backend'de de var, her blokun çıkışı var | söküm kapısı orta eşikte **uyarır**, engellemez (§3.4/3) |
| 10 | "bugün" sunucudan; eşikler ayar; donanımın yedeği var | vardiya sınırı sunucudan; sayaç okunamazsa elle giriş yolu **kapatılamaz** |
| 11 | statü kümeleri tek kaynak + ayna bekçisi; firma adı literal yok | `LOOM_STOP` zemini bekçiyle Prisma enum'una eşitlenir (`test_reason_preset_kind_parity`) |
| 12 | varsayılan = bugünkü davranış; yeni parametreler opsiyonel | `dokuma.enabled = false` ⇒ ekran çizilmez, KK1 bugünkü hâlinde |

**Emsal alınacak dosyalar** (⚠️ beş dev ekran — Tambur/FasonKabul/KK1/KursunQc/FasonSevk — `max-lines` muafındadır ve **emsal alınmaz**): iskelet `screens/Modules/HizliIsEmri/` (dört parça, kabuk 140 satır) · HAL okuma `hooks/useSackWeigh.ts` (tek dokunuş, fail-closed beş dal) · idempotency `offline/entryAttempt.ts` · sebep `ReasonPresetPicker`.

⚠️ **SIMULATED boşluğu tekrarlanmayacak:** `source:'SIMULATED'` beyanı bugün **yalnız SCALE/çuval tartısı yolunda** var; METER yolunda yok. Doff sayacı bir ölçüm cihazıdır ⇒ **beyanı baştan taşır** ve kararı backend verir.

### 3.8 · `DoffEvent` — model tasarımı (ŞEMAYA YAZILDI — dokuma P3, 2026-09-13; migration `20260913250000_doff_event` + `…251000_roll_entry_source_weaving`; yazan uç ve `DOFF_CANCEL` yolu HENÜZ YOK)

**Sınıfı: DEFTER** (`docs/standart/VERITABANI.md` §2) — *"ne oldu"* tutar, `updatedAt` almaz, kronolojisi `createdAt`tir, künye yerine AKTÖR taşır.

```prisma
/// TOP İNDİRME — tezgahtan kumaş indiği AN. Append-only: satır SİLİNMEZ,
/// GÜNCELLENMEZ (bu yüzden `updatedAt` yok); geri alma `revokedAt` damgasıdır.
/// ⚠️ TOP BURADA DOĞMAZ — bu olay yalnız "indi" der; `Roll` KK1'de doğar (§3.5).
model DoffEvent {
  id               String   @id @default(uuid()) @db.Uuid
  machineId        String   @db.Uuid
  productionLineNo Int      @default(1)

  /// KOŞUM BAĞI OPSİYONEL: operatör koşumu açmayı unutmuş olabilir. Fiziksel
  /// olarak OLMUŞ bir olayı kaydetmeyi reddetmek, onu atıfsız kaydetmekten
  /// kötüdür (kurşun `machineId=null` emsali: ATIF UYDURULMAZ). Koşum yoksa
  /// `ApiResponse.warnings` — 400 DEĞİL.
  machineRunId     String?  @db.Uuid

  /// ⚠️ `weavingOrderId` KOLON DEĞİLDİR — koşumdan türetilir. FK ikinci kaynak
  /// olurdu ("tek kaynak satır" sınıfı); `MachineRun.warpBeamId`in silinme
  /// gerekçesiyle aynı.

  /// Operatörün "İndir"e bastığı an (`clientEnteredAt` kalıbı; makul aralık
  /// dışındaysa sunucu saatine düşülür). Kronoloji yine `createdAt`tir.
  doffedAt         DateTime @db.Timestamptz
  /// Kaç parça indi. CHECK >= 1 — sıfır parçalı doff bir doff değildir.
  /// Gevşetme yolu tek ifadelidir; sıkmak veri temizliği ister.
  pieceCount       Int

  /// ⚠️ SAYACIN O ANDAKİ DEĞERİ — tasarımın belirsizlik kapatıcısı.
  /// Tezgah belgesi (§ sayaç kalitesi) "16-bit sarma ile operatörün doff'ta
  /// sayacı sıfırlaması AYIRT EDİLEMEYEBİLİR" deyip insana bırakmıştı. Değeri
  /// doff anında kaydetmek belirsizliği KAYNAĞINDA kapatır: sıfırlama artık
  /// beyan edilmiş bir olaydır, yorumlanacak bir anomali değil.
  /// NULL meşru = okunamadı (elle giriş yolu kapatılamaz).
  counterAtDoff    Decimal? @db.Decimal(18, 0)
  /// Sayaç nereden geldi. `@default` VERİLMEZ — her yazar açıkça beyan eder.
  /// ⚠️ `SIMULATED` beyanı BURADA doğar; bugün beyan yalnız SCALE yolunda var,
  /// METER yolunda yok — o boşluk tekrarlanmıyor. Kararı backend verir.
  counterSource    MachineDataSource

  /// Fiziksel etikete yazılan kısa kod (`buildDailyCode` emsali, kartela `KRT`).
  /// Elle yazılabilir olması yeter — tezgaha yazıcı ŞART DEĞİL.
  code             String   @unique @db.VarChar(32)
  notes            String?  @db.VarChar(300)

  /// Çevrimdışı kuyruk idempotency'si (`offline/entryAttempt.ts` kalıbı).
  clientToken      String?  @unique @db.Uuid

  /// GERİ ALMA — `MachineRun`/`MachineStopEvent` ile aynı kalıp; kısmi
  /// unique'ler `WHERE revokedAt IS NULL` taşır.
  revokedAt        DateTime? @db.Timestamptz
  revokedById      String?   @db.Uuid
  revokeReason     String?   @db.VarChar(300)

  createdAt        DateTime @default(now()) @db.Timestamptz
  createdById      String?  @db.Uuid

  machine     Machine     @relation(fields: [machineId], references: [id], onDelete: Restrict)
  machineRun  MachineRun? @relation(fields: [machineRunId], references: [id], onDelete: Restrict)
  rolls       Roll[]

  @@index([machineId, doffedAt])
  @@map("doff_events")
}
```

Ve `Roll` tarafında tek kolon:

```prisma
/// BU TOP HANGİ İNDİRMEDEN? NULL = atanmamış (bilinmiyor) — TAHMİN EDİLMEZ.
/// KK1 sorar (③ aksiyon anında seçim); cevap yoksa boş kalır ve raporda
/// "atanmamış" kovasında AYRI gösterilir (`beamSlot`un aynı kalıbı).
doffEventId String? @db.Uuid
```
+ `@@index([doffEventId])` (domain FK, [DB-12]) + FK `onDelete: Restrict`.

#### Ters yol — `DOFF_CANCEL` (aynı tasarımda, sonraya bırakılmaz)

> Kök kural: *deftere yazan her ileri kaynağın `*_CANCEL` ters yolu olmalı.* *"Sonra ekleriz"* ters yolu olmayan olay üretir.

**Ölçüt "bir top VAR mı" değil, "doff İLERİ SONUÇ YAZDI MI"dır** — ve bu ayrım kuralı basitleştirir:

```
DOFF_CANCEL açık  ⇔  NOT EXISTS (SELECT 1 FROM rolls WHERE "doffEventId" = :id)
```

**Statüye BAKILMAZ.** İptal edilmiş ya da fire yapılmış top da sayılır: bir kez top doğduysa doff **tarihsel bir olgudur** ve topun sonraki kaderi onu değiştirmez. Topun iptali kendi defter satırını yazar; doff kendi satırında kalır. İkisi de doğrudur, ikisi de durur — *geri alma ileri kaydı ne siler ne değiştirir.*

⇒ Tek yüklem, tek sorgu, tek satırlık bekçi. Üç dallı statü kontrolü yok.

⚠️ **`Roll.doffEventId`i `null`'lamak YASAKTIR** — kök kuralın *"ileri damgayı `null`'lamak ters kayıt DEĞİLDİR"* satırının tam kapsamında (`dispatchedAt` · `weighedAt` · `invoicedAt` ailesi). Bağ koparılmaz; doff geri alınamaz, top kendi iptal yolundan gider.

#### 409 TOPU ADIYLA SÖYLER — soyut sayı yetmez

Kök kural: *yıkıcı işlemde arayüz etkilenen HER kaydı listeler.* Bu yüzden 409 gövdesi:

```json
{ "details": { "code": "DOFF_HAS_ROLLS",
               "barcodes": ["F250913-0042", "F250913-0043"],
               "rollIds": ["…", "…"] } }
```

Operatör *"geri alamazsın"* değil, **"şu topu önce iptal et"** görür. Emsal: `ROLL_WAREHOUSE_MISSING` (`{code, barcodes[], rollIds[]}`).

#### ⚠️ (1)+(2) GERİLİMİ — koşumsuz doff iş emrinin metresini SESSİZCE eksiltir

İki karar tek tek doğru ama **birlikte bir boşluk açıyor** (1e'nin ölçümü, ilk taslakta kaçırdım):

- `weavingOrderId` kolon değil ⇒ iş emrine **koşum üzerinden** ulaşılıyor
- `machineRunId` nullable ⇒ **koşumsuz doff meşru**

⇒ Koşumsuz bir doff'un iş emrine ulaşan **hiçbir yolu yok.** O doff'tan doğan top gerçek, metre gerçek — ama *"bu dokuma iş emri kaç metre üretti"* sorusunun cevabına **girmiyor.** Ve kimse fark etmez, çünkü toplam **makul** görünür.

> **Sessiz atlama bir dayanıklılık özelliği değil, bir GÖRÜNMEZLİK özelliğidir.**

**Şart: rapor ÜÇ SAYI basar ve TOPLAMAZ.**

| kova | yüklem | ne anlatır |
|---|---|---|
| **iş emrine bağlı doff metresi** | `machineRunId` dolu → koşum → iş emri | ana sayı |
| **koşumsuz doff (atıfsız)** | `machineRunId IS NULL` | ⚠️ metre gerçek, iş emrine giremiyor |
| **doff'suz top** | `entrySource = WEAVING AND doffEventId IS NULL` | top gerçek, doff'a bağlanamadı |

İkinci ve üçüncü kova **adıyla** gösterilir; ana sayıya karışmaz, gizlenmez. Bu kolonların NULL kalmasının meşru olmasının tek sebebi budur.

**Ve `warnings` metni KAYBI söyler, yalnız durumu değil:**

> ❌ *"Açık koşum bulunamadı."*
> ✅ **"Koşum açılmadığı için bu indirme iş emri metresine GİRMİYOR."**

Operatör *"tamam, sonra açarım"* değil **"bunu şimdi düzeltmeliyim"** düşünmeli.

📌 **Ve oranı ÖLÇ:** karne *"koşumsuz doff oranı"*nı bassın. Sık çıkıyorsa bu bir veri modeli kararı değil **bir arayüz kusurudur** — tablet koşumu kendisi açmalı. Sayı olmadan bu bilinemez.

#### Bekçi

`test_machine_doff_source.ts` (adı tezgah belgesinde zaten var, **fazı Faz 1b olarak okunur**) üç şeyi ölçer:
1. `WEAVING` ile doğan topun kaynağı ve `DoffEvent` bağı,
2. **türetilen metrenin stok yazmadığı** — AST: `producedM` ile `Roll` miktar yazan yol **aynı ifadede geçemez**,
3. `DOFF_CANCEL` yüklemi — **negatif sonda**: yüklemden `NOT EXISTS` düşürülünce kırmızı vermeli.

### 3.8b · Doff akışı — uygulama sözleşmesi (KOD YOK; şema P3 ile indi, yazan uç bu sözleşmeyle doğar)

Yazıldı 2026-09-13, P3 (`DoffEvent` + `RollEntrySource.WEAVING`) origin'e indikten sonra. Emsaller ölçülerek seçildi: `openMachineRun` / `revokeMachineRun` (`machine-run.service.ts`), `createInitialEntry` (`inventory.service.ts:668`, `forcedEntrySource` :735/:961), `token-replay.helper.ts` (dört durum).

#### ① İki yazar, iki tx, tek bağ

```
TABLET (tezgah ekranı)                       KK1 (muayene masası)
  POST /api/machine-doffs                      POST /api/inventory/initial-entry (bugünkü uç)
  tx-A: DoffEvent INSERT                       tx-B: createInitialEntry(…, { forcedEntrySource: WEAVING,
        (koşum bağı opsiyonel)                        doffEventId })            ← yeni opsiyonel alan
```

**Doff tx'i (tx-A) top YAZMAZ, stok defterine DOKUNMAZ.** Tek satır doğar: `DoffEvent`. Top KK1'de, KK1'in bugünkü motoruyla, ikinci tx'te doğar (§3.5 kararı; *"ikinci giriş motoru yazılmaz"*). İki tx'i birbirine bağlayan tek şey `Roll.doffEventId`dir ve o bağ **KK1 anında** kurulur — doff anında değil, sonradan bir "eşle" ekranıyla da değil.

#### ② tx-A'nın sırası (openMachineRun kalıbı, adım adım)

1. **Replay — yaratmadan ÖNCE:** `clientToken` doluysa `findUnique({ clientToken })`; varsa **özgün sonuç döner** (`message: "İndirme zaten kayıtlı (yeniden gönderim)"`). Dördüncü durum: kayıt `revokedAt` doluysa `assertDoffReplayAlive` 409 `DOFF_REVOKED` — *"yazıldı ama sonradan iptal edildi"*, `assertMachineRunReplayAlive` (`token-replay.helper.ts:111`) ikizi.
2. **Bağlam çözümü (tx dışı, okuma):** makine aktif mi · `assertProductionLineValid(no, machine.productionLineCount)` (P4b yüklemi; ikinci çağıranı bu uç olur) · `machineRunId` verildiyse koşum aynı makinede ve `revokedAt IS NULL` mı (**atıf uydurulmaz**: verilmediyse aranmaz, `warnings` ile "Koşum açılmadığı için bu indirme iş emri metresine GİRMİYOR" — §3.8 gerilim şartı).
3. **Damga:** `doffedAt` = `resolveRunStamp(input.doffedAt, "indirme zamanı")` — makul aralık dışındaysa sunucu saatine düşer ve `warnings`e yazılır (`clientEnteredAt` kalıbı). Kronoloji yine `createdAt`.
4. **Kod:** `code` sunucuda `buildDailyCode` ailesiyle üretilir, `withBarcodeRetry` içinde (unique çarpışmasında yeniden dene; istemciden kod alınmaz — etiket koddan basılır, kod etiketten okunmaz).
5. **INSERT** — tek ifade; `pieceCount >= 1` ve `productionLineNo >= 1` CHECK'leri DB'de (`error.middleware` Türkçe mesajı hazır).
6. **P2002 dalı:** aynı token iki paralel istekte ikinci INSERT `doff_events_clientToken_key`e çarpar → `findUnique` ile replay (openMachineRun `isClientTokenP2002` dalı birebir).
7. **Audit** tx DIŞINDA, best-effort: `MACHINE_DOFF` (`newData: { doffEventId, machineRunId, pieceCount, counterSource }`).

⚠️ **Advisory kilit YOK — gerekçe ADIYLA:** kilit, DB seddinin koruyamadığı bir yarışı serileştirmek içindir (`ESZAMANLILIK.md` karar tablosu). Doff'ta o yarış yok: (i) **partial unique yok** — "tek açık doff" diye bir sed yoktur, bir hatta günde N doff meşru; (ii) **doğal anahtar yok** — `code` sunucuda üretilir ve `withBarcodeRetry` çarpışmayı kendi çözer; (iii) **tek yazar** — tx-A'nın tek INSERT'i var, başka satır okuyup karar vermiyor (TOCTOU yüzeyi yok). Kalan tek unique `doff_events_clientToken_key` idempotency içindir ve P2002 dalı (adım 6) onu taşır. Koşum tarafındaki 8032 uzayı iş numarası içindir, doff'a genişletilmez (envanter `period-guard.helper.ts` değişmez; `test_advisory_lock_namespaces` bunu ölçer).

#### ③ tx-B — KK1'de bağ kurulur (createInitialEntry'ye iki opsiyonel alan)

`opts.forcedEntrySource: WEAVING` + `opts.doffEventId`. Sıra tx İÇİNDE ve **satır kilidiyle**, düz okuma DEĞİL:

```sql
SELECT id, "machineId" FROM doff_events WHERE id = $1 AND "revokedAt" IS NULL FOR UPDATE   -- tx-B, Roll INSERT'ten ÖNCE
```

Neden `FOR UPDATE` (emsal `cash-balance-guard.helper.ts:30-36`): tx-B düz `findUnique` ile okusa, `DOFF_CANCEL` (tx-C) `NOT EXISTS rolls` yüklemini KENDİ snapshot'ında değerlendirir — tx-B'nin henüz commit etmediği topu görmez, damgalar; tx-B commit eder ⇒ **iptal edilmiş doff'a bağlı top**. İki atomik claim tek başına doğru, aralarındaki PENCERE açık (CUT_SPLIT dersinin eşzamanlılık ikizi: *"iki kapının yeşili dikişi yeşil yapmaz"*). Satır kilidi pencereyi kapatır: tx-C'nin `UPDATE`i tx-B commit edene kadar bloklanır, sonra yüklemi yeniden değerlendirir ve `count=0 → 409 DOFF_HAS_ROLLS`. (`updateMany` ile "dokunma" kilidi kullanılamaz: `DoffEvent` append-only, `updatedAt` yok — `touchWarehouseSackTx` kalıbı burada yasak.) Satır yoksa 404, `revokedAt` doluysa 409 `DOFF_NOT_LINKABLE` (iptal edilmiş indirmeye top bağlanmaz); `machineId` KK1 oturumunun makine damgasıyla uyuşmuyorsa 409 aynı kod (başka makinenin indirmesine top bağlanmaz — *çıkarım değil kontrol*). `doffEventId` verilmeden `WEAVING` yazılabilir (§3.5: "cevap yoksa NULL kalır", rapor "doff'suz top" kovası); `doffEventId` verilip `entrySource` başka bir şeyse 400 — bağ yalnız dokuma topuna aittir.

`Roll.doffEventId` ileri damgadır: **`null`'lanmaz, değiştirilmez** (§3.8 yasağı). Yanlış bağ = topun iptali + yeniden giriş (top kendi ters yolundan gider), doff'a dokunulmaz.

#### ④ Geri alma — `DOFF_CANCEL` (damga, silme değil)

```
UPDATE doff_events SET revokedAt = now(), revokedById = :u, revokeReason = :r
 WHERE id = :id AND revokedAt IS NULL
   AND NOT EXISTS (SELECT 1 FROM rolls WHERE "doffEventId" = :id)      -- statüye BAKILMAZ
```

- `updateMany` + `count === 0 → 409`; tanı tx içinde taze okumayla: satır yoksa 404, `revokedAt` doluysa 409 `DOFF_ALREADY_REVOKED`, top varsa 409 `DOFF_HAS_ROLLS` + `barcodes[]`/`rollIds[]` (§3.8 gövdesi). `revokeMachineRun` claim'iyle aynı kalıp (`:305-309`).
- **Roll'a ne olur: HİÇBİR ŞEY.** Yüklem zaten "hiç top doğurmamış doff" der; top varsa doff geri alınamaz. İptal edilmiş/fire topu da sayılır — doff tarihsel olgudur.
- Geri alınmış doff **koşumun defterinden düşmez** (`machineRunId` bağı kalır); rapor `revokedAt IS NULL` süzer, guard (`doffEventCount`) süzmez — `machineRunCount` ile aynı iki-soru ayrımı.
- `revokeReason` zorunlu (`SEBEP` seçicisi `ReasonPresetKind` genişletmez: serbest metin 300, `revokeMachineRun` emsali). Audit `MACHINE_DOFF_REVOKE`.

#### ⑤ Bekçi kalemleri (yazan uçla AYNI commit'te; `test_machine_doff_source.ts` §3.8'de adlandırıldı)

| # | ölçer | negatif sonda |
|---|---|---|
| 1 | replay: aynı token ikinci istekte AYNI id, ikinci satır YOK; revoked kayıtta 409 | token süzgeci kaldırılınca ikinci satır doğar → kırmızı |
| 2 | koşumsuz doff 201 + `warnings` KAYBI söyler; koşum başka makinedeyse 409 | uyarı metni "bulunamadı"ya dönerse kırmızı (metin ölçülür) |
| 3 | tx-A stok defterine satır yazmaz (`warehouse_movements` sayısı değişmez) — §3.8 bekçi maddesi 2'nin çalışma-zamanı ikizi | |
| 4 | KK1 `WEAVING` + `doffEventId`: bağ kurulur; revoked doff'a 409; başka makinenin doff'una 409 | claim'den `revokedAt IS NULL` düşürülünce kırmızı |
| 5 | `DOFF_CANCEL`: topsuz doff → `revokedAt` dolu, Roll dokunulmadı; toplu doff → 409 `DOFF_HAS_ROLLS` barkodlarla; iptal edilmiş topla da 409 (statüye bakılmaz) | `NOT EXISTS` düşürülünce kırmızı (§3.8 maddesi 3) |
| 5b | ⭐ **PENCERE** (iki yazar iki tx): tx-B elle açık tutulur — `FOR UPDATE` alındı, Roll INSERT edildi, commit EDİLMEDİ; eşzamanlı `DOFF_CANCEL` başlatılır; ölçülen: iptal çağrısı tx-B commit'inden ÖNCE dönmez (süre ölçümü: iptal promise'i, tx-B commit'inden sonra çözülür) VE sonucu 409 `DOFF_HAS_ROLLS`; sonra doff `revokedAt IS NULL`, top bağlı. Gate-tx promise'ine `await`ten önce no-op `.catch` (yarış bekçisi sözleşmesi). ⚠️ `p2002===1` ya da "iki satır yok" pencereyi KANITLAMAZ — kanıt, bloklanan çağrının SIRASI ve sonucudur | `FOR UPDATE` → düz `findUnique` yapılınca iptal beklemeden döner ve doff damgalanır (top iptal edilmiş doff'a bağlı) → kırmızı |
| 6 | `defter-beyan.ts` `DoffEvent` satırı: `yazan` + `tersYazan` dolar (bugün `[]`); §5 ilk yazıcıyı zaten kırmızı yapar — o kırmızı bu commit'in imzasıdır | |
| 7 | `test_advisory_lock_namespaces`: envanter değişmedi (kilit eklenmedi) | |

**minVersion (reçete 13):** `WEAVING` değerini ÜRETEN uç bu commit'le doğar ⇒ eski panel/tablet `entrySource=WEAVING` görebilir. Panel aynaları P3'te indi (etiketler hazır); tablet union'ı `WEAVING` içeriyor ama `PURCHASE_RECEIPT`/`SEMI_FINISHED` yok (devralınan). "Eski istemci ne yapar": bilinmeyen değeri **ham basar, çökmez** (`rollEntrySourceLabels` lookup, `?? value`) — ölçülmeden yazılmaz, o commit'te ölçülür.

### 3.8c · Çelişmeli doğrulama — doff backend (P3b) ↔ §3.8b (2026-09-13, 1c)

**Taban:** `origin/main` 75b1eb0d+ (dilim: 20fb880d servis+bekçi · a218f68c route+izin · 3b80b22b etiket). **Yöntem:** 6 bağımsız Opus okuyucu × 3 mercek (doktrin · mekanik · pencere), salt-okunur kod↔sözleşme karşılaştırması; koşum gerektiren her iddia 1c'nin kendi klon DB'sinde sondayla ölçüldü. Kod YAZILMADI; kod kusurları taze 01 oturumuna kalemdir. Üç sonuç: ÖLÇÜLDÜ / ÖLÇÜLEMEDİ / İHLAL.

#### Hüküm — mekanizma AYAKTA

İki yazar-iki tx-tek bağ düzeni, iki pencere, kilit sırası ve dört durumlu idempotency **kanıtla** ayakta; çürüyen parçalar mesaj/kırpma/uyarı/HTTP yüzeyi/retry tükenmesi/test hijyeni sınıfında. Yeni kural: `docs/standart/ESZAMANLILIK.md` **[ES-26]** — *bloklanma ≠ pencere kapandı; kilit ayrı ifadede önce, claim sonra (EvalPlanQual yalnız hedef satırı tazeler); düzen READ COMMITTED'a bağlı.*

| # | Ölçüm (kendi klon DB) | Sonuç |
|---|---|---|
| B | `test_machine_doff_source` taban | **20/0** |
| M1 | `revokeDoff` başındaki ayrı `FOR UPDATE` kaldırıldı (cp+sha256 geri) | §5b-**2/3/5** kırmızı (17/3): iptal bloklandı, uyanınca `NOT EXISTS` eski snapshot'la geçti, top iptal edilmiş doff'a bağlı — dosya başlığı "§5b-2/3" diyor, **5 de kırmızı** |
| M2 | `claimDoffForRollTx` `FOR UPDATE` → düz SELECT | §5b-**4/5** kırmızı (18/2) — ikinci pencere gerçek |
| W2 | iki eşzamanlı `revokeDoff` | OK · `DOFF_ALREADY_REVOKED`; tek damga, tek sebep |
| W3 | tx-B claim aldı, top yazdı, **ROLLBACK** | iptal bloklandı → tx-B düşünce damgaladı (revoked, top 0) — asılı kalma yok |
| W4 | aynı doff'a iki eşzamanlı KK1 bağı | OK · OK (2 top, serileşti); ardından iptal `DOFF_HAS_ROLLS` |
| W6 | aynı `clientToken` iki paralel `openDoff` | 1 satır, aynı id; ikincisi "yeniden gönderim" |
| W7 | tx-B doff satırını **22 s** tuttu | iptal **P2028** (tx timeout 20 s) → `error.middleware` 503; doff canlı, top bağlı — yanlış durum YOK, ama 409 değil 503 |
| W8 | bloklanmayan iptalin süresi | **3 ms** (bekçi eşiği 400 ms; pay ×130) |
| W9 | aynı makineye N paralel `openDoff` (günlük kod sırası oku-sonra-yaz + `withBarcodeRetry` 5 deneme) | N=10: 10/10 tekil kod · **N=25: 23 başarılı, 2 hata** "Barkod üretimi 5 denemede başarısız oldu" — retry tükeniyor; kod öneki GÜN bazlı, makine değil |

#### A · Kod kusuru — taze 01'e kalem (öncelik sırasıyla)

1. **409 `DOFF_HAS_ROLLS` mesajı yanlış çare söylüyor** (`machine-doff.service.ts:235` "önce topu iptal edin, indirme sonra geri alınır") — yüklem statüye BAKMAZ (§5d bunu ölçüyor): operatör topu iptal eder (geri alınamaz ikinci defter satırı), indirme yine geri alınmaz. Çelişki §3.8'in kendi "şu topu önce iptal et" cümlesinden kopyalanmış. Doğru cümle: *"Bu indirmeden top doğmuş — indirme artık geri alınamaz; yanlış top kendi iptal yolundan gider."* Sözleşme cümlesi de düzeltilir.
2. **`take: 20` hem listeyi hem SAYIYI kırpıyor** (`:228` → `:235` `${fresh.rolls.length}`; `details.barcodes/rollIds` 20 ile kesik, `+N` yok). Adıyla anılan emsal `warehouse-stock.helper.ts:82-91` listeyi kırpıp SAYIYI kırpmaz. `pieceCount` 1000'e kadar meşru. Düzeltme: `_count` ile gerçek sayı, details TAM ya da `truncated/total`.
3. **Replay dönüşleri `warnings` taşımıyor** (`:135`, `:181`): çevrimdışı yeniden gönderimde operatörün göreceği tek cevap replay cevabıdır ve "iş emri metresine GİRMİYOR" orada susuyor — §3.8 "sessiz atlama görünmezlik özelliğidir" şartının tam ortası. Uyarı `machineRunId`/koşumdan yeniden türetilebilir; replay de aynı `warnings`i döndürür. Bekçi §2a yalnız ilk çağrıyı ölçüyor → replay'de de ölçülür.
4. **Kod üretimi yarışta tükeniyor** (W9: 25 paralelde 2 hata) ve hata metni yanlış nesneyi adlandırıyor ("Barkod üretimi…", `barcode-retry.ts:54`). Sözleşme ② (iii) "başka satır okuyup karar vermiyor" cümlesi yanlış: tx günün kodlarını okuyup sırayı türetiyor (`:150-155`, klasik oku-sonra-yaz). Sonuç (advisory kilit gerekmez) 10 paralelde tutuyor, 25'te tutmuyor; **8029 "kod tekilliği" uzayı tam bu iş için envanterde** — ya kod üretimi 8029 altında serileşir ya deneme sayısı/jitter büyür; mesaj "indirme kodu" der. Karar 1e'de (§C.2).
5. **KK1 HTTP ucu `doffEventId` almıyor** (`inventory.controller.ts:20-49 initialEntrySchema`, şema strict DEĞİL ⇒ tablet gönderirse **sessizce düşer**, 201 döner, bağ kurulmaz). Sözleşme ① bunu "bugünkü uç ← yeni opsiyonel alan" diye bu dilime yazıyor; bugün `Roll.doffEventId` üretimde hiçbir uçtan yazılamaz ⇒ `claimDoffForRollTx`, `DOFF_HAS_ROLLS` ve §5b pencereleri sahada **erişilemez** (bekçi yeşil, yüzey yok — "mandal mı tarayıcı mı" sınıfı). Tablet/KK1 dilimiyle iner: `doffEventId` (uuid, opt-in) + `entrySource=WEAVING` kapısı + uçtan uca bekçi kalemi; `minVersion` ölçümü o commit'te.
6. **Test hijyeni** (`test_machine_doff_source.ts`): (a) [ES-19]/[TD-19] ihlali — no-op `.catch` reddedilemeyen `kapi/kapi2`ya konmuş, reddedebilen `txB/txB2` ilk `await`e kadar sahipsiz (:150→:157, :182→:189); erken red = süreç Sonuç satırı basılmadan ölür, `finally` temizliği koşmaz. (b) §3 `warehouseMovement.count()` GLOBAL — paralel koşan başka bekçi sahte kırmızı verir; `rollId`/`createdAt` ile daraltılır. (c) başlıktaki negatif sonda kümeleri eksik: M1 = §5b-2/3/**5**, M2 = §5b-4/5; sözleşme ⑤ satır 1/2/4'ün negatif sondaları hiç koşulmamış. (d) "kanıt SIRA" deniyor ama sıra karşılaştırılmıyor, yalnız t+400 ms bayrakları — [ES-20] gereği sonuç ayakları (§5b-2/3/5) asıl kanıt, bu doğru; taban süresi (W8: 3 ms) başlığa ölçülmüş sabit olarak yazılır.

#### B · Sözleşme bayat — §3.8b düzeltme listesi (docs, 01 ya da 1e)

1. ④ SQL'i tek `updateMany` gösteriyor; kod önce **ayrı ifadede** `SELECT … FOR UPDATE` alıyor ve bu LOAD-BEARING (M1). ③'teki "tx-C'nin UPDATE'i … uyanınca yüklemi yeniden değerlendirir ve count=0 → 409" cümlesi **yanlış** (EvalPlanQual alt sorguyu tazelemez); doğrusu [ES-26].
2. ③ SQL'i `AND "revokedAt" IS NULL FOR UPDATE` yazıyor; kod yüklemi SELECT'ten çıkarıp sonra kontrol ediyor ki 404/409 ayrışsın (`machine-doff-link.helper.ts:47-59`) — kodun tercihi doğru, SQL güncellenir. ⑤ satır 4'ün negatif sondası ("claim'den `revokedAt IS NULL` düşürülünce") bu yüzden tanımsız; denk mutasyon `:53-59` bloğunu silmektir.
3. ② adım 7 audit yükü: kodda `doffEventId` anahtarı yok (kimlik `recordId`de), `machineCode`+`code` var.
4. ② (iii) gerekçesi (bkz. A.4); (ii) "çarpışmayı kendi çözer" — 25 paralelde çözmüyor.
5. Kodda var, sözleşmede yok: hata kodları `DOFF_RUN_MISMATCH` · `RUN_REVOKED` (aynı ad `assertMachineRunReplayAlive`ta başka anlam) · `DOFF_LINK_REQUIRES_WEAVING`; replay gövde karşılaştırması (`machineId · productionLineNo · pieceCount` — `machineRunId/counterAtDoff/doffedAt` dışarıda, hangi alanların KİMLİK olduğu yazılı değil); `pieceCount ≤ 1000` ve `counterAtDoff` tam/negatif değil yalnız Zod'da; `productionLineNo` CHECK'i; koşum var ama `weavingOrderId` yoksa **üçüncü uyarı dalı** (`:120-122`) — §3.8 kova tablosu bu hâli "ana sayı"ya koyar, oysa iş emrine ulaşamaz: **dördüncü kova** ("koşumlu ama işsiz doff") adıyla eklenir.
6. Module kapısı: route `requireProductionEnabled`, sözleşme `dokuma.enabled` (route şerhi bilinçli erteleme diyor) — sözleşmeye "ekran dilimine kadar production.enabled" cümlesi.
7. `createdMachineId` NULL ise makine kontrolü hiç koşmaz (`helper:60`): makinesiz KK1 oturumu başka makinenin indirmesine top bağlayabilir — sözleşme "uyuşmuyorsa 409" der, "damga yoksa" hâlini yazmaz; karar (§C.3).
8. minVersion cümlesi konusuz kaldı (üreten uç doğmadı, A.5).

#### C · 1e kararı bekleyen

1. A.1 mesaj + §3.8 cümlesi (kod + belge, tek commit).
2. A.4: kod üretimi 8029 altında mı, deneme/jitter mi; hata metni.
3. B.7: makinesiz KK1 girişinde doff bağı — reddet (409) mi, kabul + uyarı mı?
4. `counterSource` "kararı backend verir" (§3.7/§3.8 şerhi): kod istemci beyanını olduğu gibi yazıyor (`routes:33`, `service:164`); `SIMULATED` çapraz kontrolü (cihaz bayrağı) bu dilimin mi tablet diliminin mi?
5. W7: 20 s'i aşan kilit beklemesi P2028 → 503 (tekrar dene). Kabul edilebilir davranış; §3.8b ④'e tek cümle.
6. §3.8 raporunun üç (dört) kovası ve "koşumsuz doff oranı" karnesi henüz yok — DoffEvent'i okuyan hiçbir rapor yok; hangi dilim?

#### Ölçülmeyen / açık

- HTTP uçtan uca pencere (bekçi servisi doğrudan çağırıyor); KK1 ucu alanı gelince ölçülür.
- Panel/tablet `WEAVING` etiketi "ham basar, çökmez" iddiası (Electron/mobil'de `loom:` 0 eşleşme) — üreten uç doğduğunda.
- `DEBUG=prisma:query` ile `updateMany … rolls:{none:{}}`in tek `UPDATE … NOT EXISTS` mi yoksa `SELECT`+`UPDATE … IN` mi ürettiği; M1'in kırmızısı davranışı zaten ölçüyor, SQL biçimi [ES-26]'nın gerekçe cümlesini kesinleştirir.

### 3.9 · TABLET DOFF EKRANI — tasarım + mobil dört-kapı envanteri (ÖLÇÜLDÜ 2026-09-14, 47)

> **Bu bölüm bir tasarım + ÖLÇÜMDÜR** — `docs/design/DOKUMA-PANEL-EKRAN-KAPILARI.md`nin (5e, panel) tablet eşi. Her madde `dosya:sembol`, onu ölçen bekçi bölümü ve mevcut bir **emsal ekran** taşır; ölçülemeyen **ÖLÇÜLMEDİ** yazar. Ölçüm tabanı `origin/main` 6a0981c4 (doff backend 20fb880d · a218f68c inmiş; **0c'nin `dokuma.enabled` dilimi HENÜZ İNMEMİŞ** — `module-flags.ts`te `dokuma` anahtarı yok, `machine-doff.routes.ts:22` ve `weaving-order.routes.ts:31` hâlâ `requireProductionEnabled`). Kod YOK. Backend sözleşmesi §3.8b/§3.8c.

**EMSAL EKRANLAR:** iskelet + oturum + HAL + idempotency için **KK1** (`screens/Modules/KK1/KK1Screen.tsx` — ⚠️ 4.217 satır, `max-lines` muafı: KALIP alınır, dosya kopyalanmaz) · 409 ayrıntı kartı + onay modalleri + idempotency ikizi için **Fason Kabul** (`screens/Modules/FasonKabul/`: `receiveAttempt.ts`, `receivePayload.helper.ts`, `CancelReceiptModal`) · ince kabuk için `screens/Modules/HizliIsEmri/` (§3.7).

#### ⓪ Ön koşullar — ÖLÇÜLDÜ, ikisi de YOK

| ön koşul | ölçüm | sahibi |
|---|---|---|
| `StationKind.WEAVING` (§3.3: oturum makineyle, ekran "liste değil TEZGAH") | **YOK** — `schema.prisma` `enum StationKind` = RAW_QC · PROCESS_QC · TAMBUR · SHIPPING…; `work-session.service.ts:33 SESSIONABLE_STATION_KINDS` ve `:38 STATION_KIND_PERM`de yok. Enum reçetesi 13 adım, **geri alınamaz**; `minVersion` tetiği (eski tablet `StationKind` union'ında yeni değer → `stationScreens.ts` haritası çözemez) | **01 (şema penceresi, 1e hükmü):** tezgah rotada ADIM değildir ama tablet oturumu istasyon-tabanlı olduğu için tezgah bir `WEAVING` İSTASYONU olur — **rota şablonuna GİREMEZ** kapısıyla (`docs/kurallar/dokuma.md` "dokuma topun rotasında adım değil"); 6e'nin K2 penceresi ondan sonra |
| Açık koşum / bugünkü indirme **LİSTE uçları** | **YOK** — `machine-run.routes.ts` ve `machine-doff.routes.ts`te `router.get` sıfır (yalnız `weaving-order.routes.ts:95/:129`). Ekran "hangi koşuma" ve "hangi indirmeyi geri al" sorularını listesiz soramaz | **01 backend, "Backend ÖNCE"** (1e hükmü: makine başına GET — açık koşumlar · bugünkü indirmeler · bağlanmamış indirmeler); ilk dilim yerel durumla YAPILMAZ |
| `dokuma.enabled` + `requireDokumaEnabled` | **YOK** (0c getiriyor) | 0c |
| KK1 ucunda `doffEventId` alanı (§3.8c A.5) | **YOK** — `inventory.controller.ts:20 initialEntrySchema`; şema strict değil ⇒ tablet gönderirse **sessizce düşer** | 01 |

⇒ Dilim sırası: ⓪ (şema + liste uçları + KK1 alanı + bayrak) → ekran. Ekran, dördü inmeden **hiçbir kapıyı yeşile çeviremez** (aşağıdaki kapanış ölçütü).

#### A · Ekran: liste değil TEZGAH

- **Anahtar/izin:** `MobileScreenKey` `"Dokuma"`, izin **`mobile:dokuma`** (yeni mobil kod; `permission-catalog.ts` `mobile:` bloğu, emsal `:229 mobile:kk1`) + `MobilePermission` union (`mobil/src/types/permissions.ts:1`) + `MOBILE_SCREENS` (`:84`) + `moduleAccents` (`theme/tokens.ts:156`) + `SCREEN_LOADERS` (`navigation/MainNavigator.tsx:21`). Route kaydı **izinden türer** (`MainNavigator.tsx:112 visibleScreens.map`) — izni olmayanda route hiç doğmaz; emsal KK1.
- **Oturum:** `stationScreens.ts:17 SCREEN_BY_STATION_KIND` + `:26 STATION_KIND_BY_SCREEN` (**iki harita**; bekçi `constants/stationScreens.test.ts` çift yön) → `MainNavigator.tsx:42 componentLoaderFor` → `SessionGate.tsx:37 withWorkSession`. Yer seçimi `PlaceConfirmView` (istasyon → makine), makine `workSession.service.ts:87 resolveMachine`; `stationId` backend'de makineden türer (§3.3). `work-session.service.ts:38 STATION_KIND_PERM += WEAVING → mobile:dokuma`.
- **Yön:** `useLandscapeLock(!compact)` (KK1 `KK1Screen.tsx:329-330` deseni; `useDeviceType.ts:7`).
- **İskelet:** kabuk ≤250 satır + görünüm + ekran-hook + saf mantık (`docs/standart/MOBIL.md [MO-30]…[MO-33]`; `HizliIsEmri/` emsali). Tezgah başlığı = oturumun makinesi + hat (`productionLineNo`, `Machine.productionLineCount > 1` ise seçici; 1 ise çizilmez — `assertProductionLineValid` ikizi).
- **Dört eylem** (§3.4): bu dilim yalnız **(4) TOP İNDİR** ve geri almasını getirir; koşum aç/kapa (`loom:run`), duruş, levent **ayrı dilim** (koşum ekranı yoksa doff "koşumsuz" uyarısıyla kaydedilir — meşru, §3.8).

#### B · Doff KAYDET — alan alan (`machine-doff.routes.ts:24 openSchema` ile birebir)

| alan | ekranda | kaynak / kural | emsal |
|---|---|---|---|
| `machineId` · `productionLineNo` | oturumdan; hat seçici yalnız çok hatlı makinede | §3.7/3: her çağrıda oturumun makinesi, ekran seçtirmez | KK1 `getStampContext` damgası |
| `machineRunId?` | **açık koşum seçici** (bu makine+hat) — liste ucu ⓪; seçilmezse `null` | atıf **uydurulmaz**: açık koşum aranıp otomatik bağlanmaz; backend `warnings` ("Koşum açılmadığı için bu indirme iş emri metresine GİRMİYOR") ekranda **amber şerit** — toast değil, kaydın altında kalıcı | Kurşun `machineId=null` kalıbı |
| `pieceCount` | büyük tuş takımı (`NumpadInput`), ≥1, kayıttan sonra **sıfırlanır** (§3.7/5) | Zod 1..1000 | KK1 metraj girişi |
| `counterAtDoff?` · `counterSource` | **tek dokunuş** sayaç okuma: `useMachinePeripherals('METER')` → `usePeripheralIO.buildIoFromPeripheral` → `meter.codec`; okundu → `METER`; cihaz yok/okunamadı → elle giriş (`OPERATOR`) **ya da** "okunmadı" (`counterAtDoff: null`); cihaz `simulate` ise uydurma değer **`counterSource: SIMULATED` beyanıyla** gider | fail-closed beş dal: `hooks/useSackWeigh.ts:63-76` (`{ kg, source:'SIMULATED' }`); ⚠️ **KK1 metre yolu beyansız** (`KK1Screen.tsx:1259 if (p.simulate) return simMeterage()` — `SIMULATED` göndermez) — bu ekran o boşluğu TEKRARLAMAZ (§3.7 son paragraf). `counterSource` `@default` almaz: ekran **her zaman** gönderir; "kararı backend verir" = enum doğrulaması (1e, §3.8c C.4) | `useSackWeigh` |
| `doffedAt?` | operatörün "İndir"e bastığı an (`clientEnteredAt` kalıbı, `entryAttempt.ts` kimliğinden); backend `resolveRunStamp` makul aralık dışında sunucu saatine düşer + `warnings` | `KK1Screen.tsx:1424` (`clientEnteredAt: identity.clientEnteredAt`) | KK1 |
| `clientToken` | **mantıksal deneme başına bir kez** — `offline/entryAttempt.ts:125 freshEntryIdentity` / `:234 tokenForSubmit` kalıbının doff ikizi (`doffAttempt.ts`: parmak izi = `machineId + productionLineNo + pieceCount`, backend `resolveReplay`in karşılaştırdığı üç alan; `counterAtDoff`/`machineRunId` parmak izine GİRMEZ) | Fason Kabul ikizi `receiveAttempt.ts:74 receiveFingerprint`, `:95 tokenForReceive` (+ `receiveAttempt.test.ts`) | Fason Kabul |
| `notes?` | serbest ≤300, opsiyonel | — | — |

**Sonuç yüzeyi:** başarıda toast **koda büyük yer** verir (`DF`+GGAAYY+NNNN, ≥20 pt — etiket koddan basılır/elle yazılır, §3.8 `code`); replay'de "İndirme zaten kayıtlı (yeniden gönderim)" aynı ekranda; `warnings` amber şeritte kalır (⚠️ backend replay dönüşü bugün `warnings` taşımıyor — §3.8c A.3, 01 kalemi; ekran replay'de şeridi **kendi bilgisinden** (seçilmemiş koşum) çizer, sunucuya güvenmez). 409 `DOFF_RUN_MISMATCH`/`RUN_REVOKED` → koşum seçicisini tazele + kırmızı satır; `CLIENT_TOKEN_COLLISION` → **modal** (KK1 `EntryConflictModal` kalıbı, `constants/duplicateEntryChoice.ts` metin/kontrast bekçisi), toast değil (`kk1.md` çakışma kuralı).

**Çevrimdışı: KUYRUK YOK** (1e kararı; `kk1.md` "kuyruk kalktı, anlık toast"): doff mutasyonu online-only — `networkMode:'always'` (KK1 `onlineOnly` dalı `KK1Screen.tsx:873`), çevrimdışıyken buton kilitli (`KK1Screen.tsx:1296` kapısı), kalıcı düşüş `offline/announceFailure.ts` anlık toast; `STATION_MUT`/`setMutationDefaults`/`stationLabels` üçlüsüne **girmez**. ⚠️ §3.6'nın "dört eylemin dördü de kuyruğa girer" cümlesi doff için bu kararla **GEÇERSİZ**; koşum/duruş/levent kendi diliminde karar alır. Token yine yalnız belirsiz hatada yapışır (ağ/zaman aşımı/5xx), kesin 4xx'te yapışmaz (`entryAttempt.ts` sözleşmesi, uçuş penceresi 90 sn `:83`).

#### C · Doff GERİ AL

- **Ne listelenir:** "bugün bu makinede" (liste ucu ⓪, `revokedAt IS NULL` süzülü, geri alınmışlar soluk). **HÜKÜM (1e):** yerel-durum geçici çözümü YOK — liste ucu backend'den önce iner.
- **İzin — HÜKÜM (1e): EVET, ayrı yetenek izni.** Revoke web'de ayrı kod (`loom:doff-revoke`, defterden satır düşürür); tablet eşi **`mobile:dokuma-geri-al`** — ekran-içi **yetenek** izni (`SCREEN_CATALOG` `capabilities`, emsal `mobile:tambur-duzelt`; geri alma ayrı yetkidir — `shipping:undo-dispatch` emsali); izni olmayanda buton çizilmez, ucun guard'ı da onu kabul eder (aşağıda ①).
- **Sebep:** serbest metin ≤300 **zorunlu** (`revokeSchema`), `ReasonPresetKind` genişletilmez (§3.8b ④; `revokeMachineRun` emsali) — `ModalTextInput`.
- **409 `DOFF_HAS_ROLLS`:** modal, `details.barcodes[]`/`rollIds[]` **adıyla** listeler (Fason Kabul `CancelReceiptModal` kalıbı: önizleme + kalem listesi); metin **doğru çare**: *"Bu indirmeden top doğmuş — indirme artık geri alınamaz; yanlış top kendi iptal yolundan gider."* (§3.8c A.1, 1e kararı; "önce topu iptal edin" YAZILMAZ — yüklem statüye bakmaz). ⚠️ backend bugün listeyi ve SAYIYI `take:20` ile kırpıyor (A.2) — ekran `total`/`truncated` gelene dek "+N" basamaz, sayıyı ham listeden okur. `DOFF_ALREADY_REVOKED` → satırı soluklaştır, "zaten geri alınmış".

#### D · KK1'de doff bağı (KK1 ekranı, ayrı dilim — ⓪ KK1 alanı inince)

- `dokumaEnabled` açıkken KK1 formuna **iki soru**: *"Bu top dokuma mı?"* (`entrySource: WEAVING` — ÇIKARILMAZ, SORULUR; §3.5) ve evetse *"hangi indirmeden?"* (bağlanmamış son indirmeler listesi — ⓪ liste ucu; cevap yoksa `doffEventId: null`, rapor "doff'suz top" kovası). Kapalıyken **hiçbiri çizilmez**, payload bugünkü (§3.7/12).
- Payload iki yeni alan: `entrySource` (yalnız `WEAVING` için) + `doffEventId` — istek gövdesini elle kuran katman **sessiz allowlist**: `roll.service.ts:161 InitialEntryRequest` tipi + backend `initialEntrySchema` **ikisi birden** (kök kural: "alan iki uçta da sözleşmeye eklenir").
- ⚠️ **ÇELİŞKİ ÖLÇÜLDÜ → HÜKÜM (1e, 2026-09-14) = (a):** backend bağ kontrolü `claimDoffForRollTx(createdMachineId)` KK1'in makine damgasını (`inventory.controller.ts:311 stamp?.machineId ?? req.device?.machineId` — RAW_QC oturumu **istasyon** kapsamlı; damga muayene istasyonunu taşır, tezgahı değil) doff'un makinesiyle karşılaştırıyordu; damga olsa bile tezgahla eşleşmez ⇒ hiç geçemeyen kontrol **ölü kapıdır**. **Hüküm:** bağ KK1'de **açık LİSTE seçimidir** (çıkarım değil); makine eşleşmesi **YALNIZ KK1 cihazı bir tezgaha bağlıysa** (tezgah başı KK1: `req.device.machineId` dolu ve o makine tezgah) denetlenir; masa KK1'de (damgasız ya da damgası muayene istasyonunun) bağ **KABUL**. Önceki "makinesiz KK1'de 400" kararı **GEÇERSİZ**. Kod 01'de (KK1 ucu `doffEventId` alanıyla aynı dilim), `dokuma.md` kural satırı + arşiv notu 01'de; bekçi `test_machine_doff_source §4c` ("başka makinenin doff'una top → 409") **tezgah başı KK1** fikstürüyle kalır, masa-KK1 fikstürü (damgasız) **kabul** ölçer.

#### E · Bayrak — `dokuma.enabled`in tablet eşi ("kapalıyken sıfır fark")

- **Mobilde modül kapısı YOK** (ölçüldü): `production.enabled`/`dokuma.enabled`/`MODULE_DISABLED` mobil kaynağında hiç geçmiyor; ekranlar yalnız **izinle** gizleniyor (`usePermission.ts:33 allowedScreens`); `api.ts:255-262` 403'ü jenerik geçirir. `SCREEN_CATALOG`taki `modul` alanı mobil satırlarda **backend-only** beyandır.
- **Kalıp (mevcut mekanizma, tek satır):** `hooks/useVisibleScreens.ts` "izinli ∖ koşulu sağlanmayan" — `ConditionalScreens` bugün **boş** ama bilerek duruyor (yorum: "yeni düzen-koşullu ekran tek satırla eklenir, iki tüketici — navigator + grid — otomatik hizalanır"). Doff ekranı ilk gerçek koşullu ekran olur: `conditional.Dokuma = dokumaEnabled`.
- **Bayrağın kaynağı:** `useFeatureFlags()` (`hooks/useFeatureFlags.ts:11`, `GET /feature-flags`, persist'li) — backend şeması modül anahtarlarını taşıyor (`feature-flag.routes.ts:250 productionEnabled`), tablet `FeatureFlags` tipi (`services/featureFlag.service.ts:20`) taşımıyor ⇒ `dokumaEnabled` alanı + `DEFAULT_FEATURE_FLAGS`ta **`false`** (fail-closed; `useTezgahEnabled` panel emsali: yüklenene dek false) + `useDokumaEnabled()`.
- **Sıfır fark ölçütü:** bayrak kapalıyken (a) grid'de kart yok, (b) navigator'da route yok (aynı liste), (c) KK1'de iki soru çizilmiyor, (d) açılışta yeni istek yok (`feature-flags` zaten çekiliyor). ⚠️ `NoAccess` kapısı ham yetkide kalır (koşul sağlanmadı diye "yetkin yok" denmez — `useVisibleScreens` yorumu).
- Backend tarafında 403 `MODULE_DISABLED`: tablette **kart yok ⇒ istek yok**; yine de gelirse jenerik 403 toast (ölçüldü: özel dal yok) — kabul, çünkü yüzey kapalı.
- **HÜKÜM (1e):** tablet dilimi `ConditionalScreens` + `FeatureFlags.dokumaEnabled` (`false` varsayılan, fail-closed) getirir. Bugünkü tablet **üretim ekranlarının** (KK1 · Kurşun · Tambur · Hızlı İş Emri · Kurşun Dağıtım) `production.enabled`a bakmadan gösterilmesi **ayrı kalem, acil değil** — backend 403 `MODULE_DISABLED` ile kapalı.

#### F · Enum aynası (d9 bekçisi `Teks-Erp/scripts/test_mobil_enum_aynasi.ts`)

- `RollEntrySource`: `mobil/src/types/models.ts:94` union **`WEAVING` VAR** (`:105`), `PURCHASE_RECEIPT`/`SEMI_FINISHED` de var (13a4ca45 ile kapandı). Etiket haritası (`rollEntrySourceLabels`) **mobilde de backend'de de YOK** — "bilinmeyen değeri ham basar" iddiası (§3.8b minVersion) konusuz: basan yüzey yok.
- `MachineDataSource` **mobilde YOK** (yalnız backend `schema.prisma:1739`, route `z.nativeEnum`). Ekran `counterSource` gönderdiği için union **tablet dilimiyle eklenir** (`models.ts`, 1e hükmü) — bugün eklenmezse d9 bekçisi **sessiz kalır** (kesişim boş); d9 aynayı **boş kümede KIRMIZI** verecek şekilde düzeltiyor (1e → d9); eklenince iki yönlü sapma ölçülür (`:76 sapmaOlc`).
- `StationKind` union'ına `WEAVING` (⓪ ile), `stationScreens.ts` iki harita.

#### G · Dört kapı — tablet envanteri (panel belgesinin ①–④ ikizi)

| kapı | dosya:sembol | ölçen bekçi | emsal |
|---|---|---|---|
| ① route + izin | `machine-doff.routes.ts` uçları `requirePermission("loom:doff")` → **`requireAnyPermission("loom:doff", ...MOBILE_DOKUMA)`** (`MOBILE_DOKUMA = ["mobile:dokuma"]`, dosya-yerel sabit — `inventory.routes.ts:28 MOBILE_ROLL_WRITE_KK1` emsali); revoke `("loom:doff-revoke", "mobile:dokuma-geri-al")`. `router.use(verifyToken, requireDokumaEnabled)` (0c). `loom:*` web kodları **`SCREENLESS_PERMISSIONS`ta KALIR** (`screen-catalog.ts:415-416`; gerekçe "panel yüzeyi yok, tablet `mobile:dokuma` ile" diye güncellenir — yoksa ölü muaf değil, yanlış gerekçe) | `test_permission_catalog` (+ §3b `MOBILE_*` yayan uçta guard türü) · `test_mobile_screen_permissions` (ekranın çağırdığı her ucun guard'ı ekran iznini kabul ediyor mu — 2026-08-17 sessiz 403 vakası) · `test_route_auth_coverage` | `inventory.routes.ts:514` |
| ② `SCREEN_CATALOG` | `{ key: "Dokuma", app: "mobile", modul: "dokumaEnabled", title: "Tezgah", requires: ["mobile:dokuma"], capabilities: [{ code: "mobile:dokuma-geri-al", label: "İndirmeyi geri alabilir" }] }` (`screen-catalog.ts:316` KK1 satırı emsal). `EKRANSIZ_MODULLER` (`:384`) `tezgahEnabled` muafı dokumaya **taşınmaz** (ayrı modül) | `test_screen_catalog` "her mobil ekran manifestoda" · "mobil ekranların giriş izni birebir" · "muaf listesi bayat değil" · **§10b** (kapısı olan modülün ekranı — 0c'nin `requireDokumaEnabled`i panel VE tablet ekranı beyanıyla yeşil kalır) | KK1 satırı |
| ③ karo · route · palet (tablet: **kart · navigator · oturum**) | `MOBILE_SCREENS` (tek kaynak: kart + navigator aynı liste) · `SCREEN_LOADERS` · `stationScreens.ts` iki harita · `moduleAccents` · `useVisibleScreens` koşulu · `useModuleOrder` (sıra blob'u) | `usePermission.test.ts` · `useVisibleScreens.test.ts` · `stationScreens.test.ts` · **`npx tsc --noEmit`** (Record tamlığı yalnız tsc ile — `mobil/package.json`da typecheck script'i YOK, Metro tip denetlemez; reçete 3/4) | KK1 |
| ④ bayrak | `dokumaEnabled`: backend dört dosya (0c) + tablet `FeatureFlags.dokumaEnabled` (`false` varsayılan) + `useDokumaEnabled` + `conditional.Dokuma` | `test_feature_flag_contract` · `test_module_flags` · `test_module_profile` · `useVisibleScreens.test.ts` (yeni ayak: bayrak kapalıyken `Dokuma` listede yok) | `useTezgahEnabled` (panel kalıbı) |

#### H · Reçete ile çelişki ölçümü (`docs/RECETELER.md` § Yeni mobil ekran / özellik)

21 madde okundu; **çelişki YOK** (kuyruk maddeleri 12–13 koşullu: "kuyruğa girecek mutation için" — doff girmez). İki **boşluk** ölçüldü ve **reçetede** kapatıldı (belgede değil): ㉒ modül bayrağına bağlı mobil ekran (`useVisibleScreens` koşulu + `FeatureFlags` alanı + fail-closed varsayılan; `SCREEN_CATALOG.modul` mobil satırlarda backend-only'dir) · ㉓ HAL okumasında `simulate` cihazdan gelen değer `source:'SIMULATED'` beyanıyla gider (tartı emsali; KK1 metre yolunda beyan YOK — bilinen boşluk).

#### I · Kapanış ölçütü (tek commit; ⓪ inmeden açılmaz)

1. `mobile:dokuma` (+ `mobile:dokuma-geri-al`) katalogda; `SCREEN_CATALOG` `Dokuma` satırı; `loom:*` SCREENLESS gerekçesi güncel.
2. İki doff ucu `requireAnyPermission` ile mobil izni kabul ediyor (`test_mobile_screen_permissions` yeşil — **negatif sonda:** `MOBILE_DOKUMA` kaldırılınca kırmızı).
3. `MOBILE_SCREENS` · `SCREEN_LOADERS` · `stationScreens` iki harita · `moduleAccents` · `MobilePermission`/`MobileScreenKey`/`MachineDataSource`/`StationKind` union'ları; `npx tsc --noEmit` temiz; d9 aynası `MachineDataSource`u kapsama aldı (**negatif sonda:** union'dan bir değer düşürülünce kırmızı).
4. `dokumaEnabled` tablet ayağı: bayrak KAPALIYKEN kart yok ∧ route yok ∧ KK1 soruları yok — **üçü ayrı ölçülür** (`useVisibleScreens.test.ts` + KK1 render testi).
5. Doff kaydet: `counterSource` her yükte; `simulate` cihazda `SIMULATED`; `clientToken` `doffAttempt.test.ts` (parmak izi üç alan; timeout → aynı token; başarı → yeni kimlik); çevrimdışı buton kilitli, kuyruk anahtarı YOK (**negatif sonda:** `STATION_MUT`e doff anahtarı eklenirse `stationLabels` bekçisi etiketsiz anahtarı düşürür — bilerek yok).
6. Geri al: `DOFF_HAS_ROLLS` modali barkodları listeler ve metni "geri alınamaz" der (metin bekçisi, `duplicateEntryChoice.test.ts` kalıbı).
7. Sürüm notu: **tablet + backend** (yeni ekran + yeni izin + enum değeri `StationKind.WEAVING` ⇒ `minVersion` sorusu ⓪'da cevaplanır; reçete 13/17).

#### J · HÜKÜMLER (1e, 2026-09-14) — hepsi verildi

1. **KK1 makine damgası ↔ doff makinesi → (a):** bağ KK1'de açık LİSTE seçimi; makine eşleşmesi yalnız KK1 cihazı bir tezgaha bağlıysa denetlenir; masa KK1'de bağ KABUL; "makinesiz KK1'de 400" kararı GEÇERSİZ (hiç geçemeyen kontrol ölü kapıdır). Kod + `dokuma.md` kural satırı + arşiv notu **01**.
2. **Liste uçları → 01 backend**, "Backend ÖNCE" (makine başına GET: açık koşumlar · bugünkü indirmeler · bağlanmamış indirmeler); ilk dilim yerel durumla YAPILMAZ.
3. **Revoke izni → EVET**, ayrı yetenek `mobile:dokuma-geri-al` (geri alma ayrı yetkidir, `undo-dispatch` emsali).
4. **`StationKind.WEAVING` → 01** şema penceresi; tezgah rota şablonuna GİREMEZ kapısıyla; 6e'nin K2 penceresi ondan sonra.
5. **§3.6 kuyruk cümlesi → DÖRT eylem için GEÇERSİZ** (`kk1.md`: kuyruk kalktı, anlık toast); §3.6'ya şerh işlendi.
6. **`MachineDataSource` mobil union → tablet dilimiyle**; d9 ayna mandalı boş kümede KIRMIZI verecek şekilde düzeltiliyor.
7. **Bulgu E → tablet dilimi** `ConditionalScreens` + `FeatureFlags.dokumaEnabled` (`false`, fail-closed); mevcut üretim ekranlarının `production.enabled`a bakmaması ayrı kalem, acil değil.

**Ekip:** 0c panel dilimi → sonra TABLET doff UI KODU (bu bölüm); 01 backend ön koşullar (⓪ WEAVING · liste GET'leri · KK1 `doffEventId` + (a)) + defter kalemleri; 47 çelişmeli doğrulama (panel dilimi, sonra tablet dilimi — "kapalıyken sıfır fark" tablet ayağı dahil).

### 3.10 · Bu bölümün açık bıraktıkları

- **Dokuma işinin planlama ekranı** (panel tarafı) — bu belgenin kapsamı dışı, `WeavingOrder` CRUD'u standart master-data kalıbı.
- **`unitsPerCm`in kalıcı evi** — tezgah tasarımı §10/#9 zaten açık bırakmış (kaynak: `WarpSpec` ailesi, **sert bağımlılık eklenmez**). Faz 1-2'de elle girilir ve donar.
- **Vardiya tanımı** (`ShiftDefinition`/`ShiftInstance`) tezgah Faz 1a'nın işi; bu ekran onu **tüketir**, tanımlamaz.
