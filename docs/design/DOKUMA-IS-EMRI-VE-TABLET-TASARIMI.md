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

Etkilenen tanımlar (tezgah tasarımından, iniş anında):
`MachineRun.productionLineNo` · `MachineInterval.productionLineNo` (PK'ya girer) · `MachineShiftStat.productionLineNo` (unique'e girer) · `PeripheralSignal.productionLineNo` (nullable, varsayılan YOK) · `machine_runs_one_open_per_line_uq` ve kardeş kısıt adları.

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

### 2.2 · Dokuma işinin kabı — `WeavingOrder`, minimum hâliyle

`MachineRun.workOrderStepId`'nin yerine gelen kap. Faz 1'de **yalnız** şunlar:

```
WeavingOrder
  id · weavingOrderNumber @unique · clientToken? @unique
  itemId            → dokunacak kumaş (ItemType.FABRIC), ZORUNLU
  colorId?          → renk (ham dokumada NULL meşru)
  warpSpecId?       → hangi çözgü kartı besliyor
  plannedM?         → TALEP ekseni (metre); NULL = açık uçlu koşum meşru
  executionKind     → IN_HOUSE | SUBCONTRACTED
  subcontractorId?  → XOR: SUBCONTRACTED ise dolu, IN_HOUSE ise NULL (CHECK)
  status            → PLANNED | IN_PROGRESS | COMPLETED | CANCELLED
  künye + zaman damgaları
```

`MachineRun.weavingOrderId String?` — **nullable**, çünkü tasarımın kendi cümlesi zaten böyle diyordu: *"Bağ OPSİYONEL: iş emirsiz koşum meşrudur (numune, deneme)."* Bu cümle korunuyor, yalnız işaret ettiği yer değişiyor.

**Faz 1'de BİLEREK YOK:**
- ❌ sipariş bağı (§1.5 — `SackAllocation` zaten karşılıyor)
- ❌ `requiredBeamCount` (take-up yok, hesaplanamaz)
- ❌ rota şablonu / adım (§1 hükmü)
- ❌ refakat kartı (kart iş emriyle doğar; dokuma iş emri değil)

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

> Kök kural: *"Bir yetenek 'VAR' sayılmak için üçü birden: motor + **en az bir çıkış yüzeyi** + izin ataması."* Devere ve tezgah bugün **yüzeysizdir** ⇒ kendi kuralımıza göre o modüller **yok** sayılır. Bu bölüm o yüzeyi kurar.

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

Dört eylemin dördü de **kuyruğa girer** (`STATION_MUT` + `OFFLINE_AWARE`) — tezgah başında ağ en zayıf yerdir ve duruş bildirimi gecikirse **randımanın paydası bozulur**.

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

### 3.8 · Bu bölümün açık bıraktıkları

- **Dokuma işinin planlama ekranı** (panel tarafı) — bu belgenin kapsamı dışı, `WeavingOrder` CRUD'u standart master-data kalıbı.
- **`unitsPerCm`in kalıcı evi** — tezgah tasarımı §10/#9 zaten açık bırakmış (kaynak: `WarpSpec` ailesi, **sert bağımlılık eklenmez**). Faz 1-2'de elle girilir ve donar.
- **Vardiya tanımı** (`ShiftDefinition`/`ShiftInstance`) tezgah Faz 1a'nın işi; bu ekran onu **tüketir**, tanımlamaz.
