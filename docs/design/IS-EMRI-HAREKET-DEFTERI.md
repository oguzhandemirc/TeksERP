# İŞ EMRİ HAREKET DEFTERİ · KAPANIŞ KÜNYESİ · TABLET DÜZELTME MENÜSÜ

> **Soru (kullanıcı, 2026-09-25; 1e toparladı):**
> 1. Tablette Hızlı İş Emri'nde boş bırakılan alanlar uyarı versin.
> 2. Açılmış iş emri YIKICI OLMAYAN yolla düzeltilebilsin — her tuş TEK şeyi değiştirir (paneldeki
>    "Rengi Değiştir" gibi); genel "Düzenle" yıkıcı olabiliyor. Tablete hangi tuşlar konur?
> 3. İş emrinin hareketleri kaydedilsin — *"geri adım atmaktansa ilerden dolaşmak ve bunu kayıt altına
>    almak"*. Hareketler iki yerden görülsün: iş emri no ile sorgulanan ayrı ekran + yan panel/detayda
>    "Hareketler" tuşu.
> 4. Tamamlanan iş emrinde "Üretilen Nihai Toplar 13 top · 499 m" bugünkü canlı değeri gösteriyor;
>    iş emri BİTTİĞİ ANDAKİ toplar görülemiyor. Kapanış anı donmalı.
>
> **Kullanıcı ilkeleri (bağlayıcı):** "simple is more" — model karmaşıklığı yüzeye sızmaz, tablet akışında
> dokunuş sayısı kabul ölçütüdür (`URETIM-BELGE-ZINCIRI.md` §6) · defter doktrini — "ne oldu" asla değişmez,
> düzeltme YENİ olaydır (`docs/kurallar/defter.md`) · **audit yalnız ayak izidir** (2026-09-25): çalışan
> program `SystemLog`tan hiçbir karar, sayı, durum ya da join türetmez; bu belgedeki defter, Hareketler
> ekranı ve kapanış künyesi audit'i HİÇ okumaz (tek istisna §8.1'deki bir kerelik göç script'i).
>
> **Durum: ONAYLI 2026-09-25** — dokuz sorunun hepsi cevaplandı (§9), R5/R6 ve D1 teknik kararları 1e'den
> (§6.5, §12). K1 indi. İniş sırası: 9b S2+S3 → 37 K-A3 (`defter_block_tamper`) → 9f D1.

## 0. Yöntem ve kapsam beyanı

- **Ölçülen** (ağaç `b1894b04`, 2026-09-25, dosya okuma — DB'siz): şema, servisler, route'lar, panel ve
  tablet bileşenleri. Her iddia `dosya:satır` taşır; kısaltmalar: **S** = `Teks-Erp/src/services/workorder.service.ts`,
  **L** = `…/workorder-link.service.ts`, **R** = `Teks-Erp/src/routes/workorder.routes.ts`,
  **H** = `mobil/src/screens/Modules/HizliIsEmri/`, **E** = `Electron/src/pages/Operations/WorkOrders/`.
- **ÖLÇÜLEMEDİ — IE2409260005:** numara biçimi `IE+GGAAYY+NNNN` ⇒ 24.09.2026 doğumlu; test dökümü
  `tekserp_fabrika_0923` 23 Eylül'e ait olduğu için içinde YOK. Fabrika DB'lerine sorgu koşulmaz (kural),
  bu yüzden örnek iş emrinin 13 top / 499 m'sinin bugün nasıl kaydığı TEK TEK ölçülmedi; kayma
  MEKANİZMASI koddan ölçüldü (§1.4).
- **Sektör çerçevesi** (§2) genel bilinen SAP kavramlarıdır; bu belge için web taraması yapılmadı.

## 1. BUGÜN (ölçüldü)

### 1.1 Tablet — Hızlı İş Emri formu

Tam ekran, üç adımlı sihirbaz (TOPLAR · ÜRETİM · ONAY — `H/wizard/WizardSteps.tsx:13`); durum ve kurallar
`H/useQuickWorkOrder.ts`, görünüm `H/NewWorkOrderView.tsx`. `ModuleSheet`/`PagedSheet` iskeletini
KULLANMIYOR (tek sayfa + kendi sihirbazı).

| Alan | Adım | Zorunlu | Varsayılan | Boşken / hatalıyken bugün |
|---|---|---|---|---|
| Toplar (okutma) | 1 | ✔ (≥1) | — | İLERİ kilitli + gri ipucu |
| Sipariş satırları | 1 | — | — | seçilince kumaş/renk/en dolar (`H/useQuickWorkOrder.ts:705-723`) |
| Rota | 2 | ✔ (kırmızı `*`) | son kullanılan (`:453-464`) | İLERİ kilitli |
| Kat tipi | 2 (yalnız Tambur'lu rotada görünür) | ✔ yalnız Tambur'luda | katalogun ilk değeri; Tambur yoksa TEMİZLENİR (`:301-309`) | **HATA B1** (aşağıda) |
| En (cm) | 2 | — | boş / siparişten | **SESSİZ**: "abc", "0", "-5" → `null` (`toPositiveNum` `:86-89`) |
| Hedef renk | 2 (rota renk verebiliyorsa) | — ("Renksiz/Ham") | rota plan rengi | rota uygulayamıyorsa sert engel (`applyMissing`) |
| Özellikler | 2 (rota uygulayabiliyorsa) | — | rota planı | — |
| Fasona Gönder | 2 (ilk adım fasonsa) | — | açık | firma yoksa kapalı |
| Adım notu / firma | rota adımları modalı | — | şablondan | **`maxLength` yok**, backend 500 üstünü 400 ile reddeder (`controller:57`) — hata ancak gönderimde |
| Yeniden üretim sebebi | 3 | — | boş | — |

**Bulgular:**
- **B1 — Tambur'suz rotada operatör 2. adımda KİLİTLİ.** `stepBlock` kat tipini KOŞULSUZ ister
  (`H/NewWorkOrderView.tsx:81-85`), `blockingReason` ise yalnız `hasTambur` iken
  (`H/useQuickWorkOrder.ts:789`); Tambur'suz rotada alan gizli ve değer temizlenmiş ⇒ ekranda
  "Kat tipi seçmelisiniz." yazar, doldurulacak alan yoktur. İki ayrı kural kümesi = ayrışan yüzey sınıfı.
- **B2 — Geçersiz en sessizce düşer** (yukarıda).
- **B3 — Backend uyarıları kayboluyor:** quick-start `warnings` ve sevk `message`ını döndürüyor
  (S:1520-1523), başarı işleyicisi ikisini de okumuyor (`H/useQuickWorkOrder.ts:744-775`). Rota kapsaması
  uyarısı ("rotada renk veren adım yok") tablette hiç görünmüyor.
- **B4 — Tablet ↔ backend kuralları ayrışık:** tablet kat tipini ister, backend istemez ve katalogla
  doğrulamaz (`fold-type.ts:65-70`, S:1083); tablet `applyMissing`'de sert engeller, backend yalnız uyarır
  (S:965-995). Tablet yorumu `:178-181` "backend 400 verir" diyor — bayat.

### 1.2 Panel — iş emri yan paneli (`E/WorkOrderDetailSheet.tsx:141-227`)

| Tuş | Uç · izin | Ne değiştirir | Audit | Sebep · önizleme · claim | Defter |
|---|---|---|---|---|---|
| Detayı Aç | GET `/:id` | — | — | — | — |
| **Düzenle ⚠** (PLANNED/IN_PROGRESS) | **PUT** `/:id` (R:463) · `workorder:write` ∨ `mobile:hizli-is-emri` | `replace` S:5257 — rota, bağlar, hedefler, **iş emri no** (aşağıda) | UPDATE, yalnız `newData` özeti; **`oldData` yok, sebep yok** (S:5982) | claim var (S:5624) · önizleme yok · sebep yok | yok (bağ/özellik pivotları `WO_REPLACE` damgası alır) |
| Sipariş Bağla | POST `/:id/order-links` (R:575) · `workorder:write` ∨ `mobile:hizli-is-emri` | `WorkOrderToOrderLine` + tip STOK→SİPARİŞ (L:396) | `ORDER_LINK_ADDED` (L:407) | aday listesi · sebep yok | bağ pivotu (damgalı) |
| Rengi Değiştir | PATCH `/:id/target-color` (R:655) · **yalnız `workorder:write`**; ops. POST `apply-attribute-to-rolls` (R:713) | `targetColorId`; seçilen toplarda `Roll.colorId` + `labelDirty` (inventory:4527) | `TARGET_COLOR_CHANGED` (L:625, `oldData` + sebep) · `ROLL_ATTRIBUTE_BULK_APPLY` · top başına `ROLL_MANUAL_OVERRIDE` | **sebep zorunlu** · 409 `COLOR_PARTIAL_CONFIRM` iki aşamalı onay + top listesi · `touchWorkOrderTx` + claim | yalnız top özellik sürümleri |
| Eni Değiştir | PATCH `/:id/width` (R:724) · `workorder:write` ∨ `mobile:fason-kabul` | `width` (+ ops. toplara uygula) | `TARGET_WIDTH_CHANGED` (L:688) | sebep zorunlu · claim **tx dışında** (L:678) | yok |
| Fason Kabul | POST `/api/subcontractor/receive` | makbuz, doğan toplar, adım; **iş emrini otomatik kapatabilir** | SUBCONTRACTOR_RECEIPT (WO satırı yok) | clientToken | ✔ makbuz · RollOperation · RollMovement · WarehouseMovement · RollVariance · RollPlanDeviation |
| Belgeler | GET `/:id/documents` | baskıda kart sürümü | PRINT_EVENT | — | PrintedDocument |
| Kapat (IN_PROGRESS) | POST `/:id/complete` (R:941) · `workorder:write` (+ dispozisyonda `roll:manual-adjust`) | COMPLETED; açık adımlar SKIPPED | UPDATE (`manualComplete`) | önizleme ✔ · sebep yalnız dispozisyonda | dispozisyonda WarehouseMovement |
| İptal Et | POST `/:id/cancel` (R:984) | CANCELLED + `cancelledAt/ById/Reason` | action "DELETE" | önizleme ✔ · sebep zorunlu | kolonlar + dispozisyon |

**⚠ Düzenle neden yıkıcı (ölçüldü):**
- Rota değişirse eski adımlar "kaldırılan" sayılır; PENDING ve bağsız olanlar **fiziksel silinir**
  (S:5801); başlamış adım 409 verir (S:5788, S:5856).
- Gövdede olmayan sipariş bağları koparılır (S:5902), hedef özellikler geri çekilir (S:5922).
- **İş emri numarası (`WorkOrder.workOrderNumber`) yeniden yazılır** — gövdedeki `batchNumber` ANAHTARI
  (adı yanıltıcı: parti değil, iş emri no taşır; controller :278) `workOrderNumber`a yazılır (S:5944), form
  alanı düzenlemede açık (`E/WorkOrderFormView.tsx:139`). "Numara DOĞUŞTA materyalize edilir" çekirdek
  kuralıyla çelişir.
- **Renk bekçisi atlanır:** `replace` `assertTargetColorChange`i çağırmaz (yalnız `locks.targetColor`);
  PATCH `update` (S:5069) ve "Rengi Değiştir" çağırır.
- Yorumlar koddan kopuk: `E/service.ts:213` ve controller `:292`/`:607` "yalnız PLANNED" der, servis
  IN_PROGRESS'e izin verir (S:5244, S:5266-5275).

### 1.3 Tablet — mevcut iş emri üzerinde bugün ne yapılabiliyor

`H/WorkOrderListView.tsx` → `H/WorkOrderDetailSheet.tsx` (`AppModal`, üç kip: detay · düzenle · iptal):

| Eylem | Uç | Not |
|---|---|---|
| Detay + toplar (salt-okunur) | GET `/:id`, `/:id/rolls` | — |
| Belgeler (refakat kartı, çekler) | GET `/:id/documents` + baskı | `H/WorkOrderDocumentsSheet.tsx` |
| **Düzenle (genel)** | **PATCH `/:id`** (R:439, `mobile:hizli-is-emri` yeter) | renk · en · hedef metre/kg · kat · **İŞ EMRİ NO** — sebepsiz. Renk 409 `COLOR_PARTIAL_CONFIRM` dönerse tablet `confirmPartial` göndermez → yalnız hata tostu. "0" en → 400; "abc" → NaN → en SESSİZCE silinir (`:81`) |
| İptal | GET `cancel-impact` + DELETE `/:id` | etkilenen toplar listelenir, top başına seçim YOK |
| Sipariş bağla/çöz | yalnız **Tambur** ekranında (`Tambur/TamburOrderLinkSheet.tsx`) | Hızlı İş Emri'nden erişilemez |

Yani tablette genel "Düzenle" BUGÜN VAR (PATCH, `update` S:5003) — sebepsiz ve iş emri numarasını da
değiştirebiliyor. PATCH `update` audit'e alan bazlı `changes` yazar (S:5220-5231) ama sebep taşımaz.

### 1.4 "Üretilen Nihai Toplar" nasıl hesaplanıyor ve neden kayıyor

- Gösterim `E/detail-v3/ProducedV3.tsx:25` (`{count} top · {totalMeters} m`); hesap `findById` içinde
  (S:2338-2380), küme TEK KAYNAK `producedOutputWhere` (S:1767): (a) bu iş emrinin adımında doğan Tambur
  birinci-nesil çocukları — **statü süzgeci YOK**; (b) Tambur'suz finalize çıktıları — **statü süzgeçli**
  (`WAREHOUSE · A1_STOCK · SCRAP · SHIPPED · AT_KARTELA · KARTELA_CONSUMED`).
- **Metraj `Roll.initialQty`** (üretim anı), `currentQty` değil — yani metre alanı zaten yarı-donmuş.
  Kovalama (depo · A1 · fire) topun **BUGÜNKÜ** `qualityGrade`inin katalogdaki `targetStatus`undan
  (`loadProducedBuckets`); başlık = depo + A1, **fire metresi dışarıda**.

**Kaymanın beş kaynağı (canlı olan her şey):**
1. (b) dalında statü canlı: sonradan başka iş emrinde yeniden kesilen (`TAMBUR_CONSUMED`), fasona yeniden
   giden (`SUBCONTRACTOR_CONSUMED`) ya da iptal edilen top KÜMEDEN DÜŞER.
2. Kova canlı: kalite sonradan değişirse top depo↔A1↔fire arasında yer değiştirir; fire başlıktan düştüğü
   için metre değişir.
3. `initialQty` aşımda yukarı çekilir (Tambur geri alma bump'ı, `tambur.md` metraj satırı).
4. Renk, en, kg, parti **canlı** okunur (renk "Rengi Değiştir → toplara uygula" ile sonradan değişir);
   en ve kg bu kartta hiç gösterilmiyor.
5. Yeniden açılıp kapanan iş emrinde yeni çıktılar kümeye eklenir; "ilk kapanışta ne vardı" kaybolur.

Ek ayrışma: KPI'lar yalnız `warehouse.totalMeters` okur (`SheetKpis.tsx:24`, `WorkOrderKpis.tsx:24`),
başlık A1'i içerir; kalem listesinde alan adı `currentQty` ama değeri `initialQty` (S:2378).

### 1.5 Tamamlanma, yeniden açılma, iptal — iş emri DÜZEYİNDE iz yok

- `WorkOrder`da **`completedAt`/`completedById` YOK** (şema `WorkOrder`; yalnız `cancelledAt/ById/Reason`).
  `updatedById` yalnız create'te yazılıyor (S:1069).
- **Otomatik COMPLETED** tek boğazdan geçer: `completeWorkOrderIfStepsDone` (`helpers/roll-step.helper.ts:204`)
  — yalnız `status` yazar, **audit'e bile satır düşmez**. Çağıranlar (10): `tambur.finalize` :1363 ·
  `finalizeOpenFabric` :3800 · `kursun-qc.finishStep` :960 · `inventory.kursunFinish` :5764 ·
  `rescueStuckRoll` :5401 · `subcontractor.receiveInner` :3290 · `closeRemainder` :4046 · fason sevk
  iptali :2352 · `executeDirectShip` :6955 · `kursun-bypass.completeFromDistribution` :1416.
- **Otomatik IN_PROGRESS** tek boğaz: `ensureWorkOrderInProgress` (`roll-step.helper.ts:185`); ayrıca
  `lockWorkOrder` S:6577 (audit'li).
- **Elle Kapat** `completeWorkOrder` S:4119 (audit'li).
- **Yeniden açılma (COMPLETED → IN_PROGRESS) YEDİ dağınık yolda**, hiçbiri iş emri düzeyinde tarih/kullanıcı
  yazmıyor: `tambur-undo` :1780, :2153 · `subcontractor.reopenRemainder` :3851 · `tambur-manual` :1229 ·
  `kursun-qc.reopenStep` :1191 · `workorder-manual-move` :877 · `workorder-split` :403.
- **İptal** S:3666; sipariş iptalinin `CANCEL_WO` dalı (order.service :3312) **sebep geçirmiyor** →
  `cancelReason` NULL kalır. **SUPERSEDED** `workorder-split` :288. **Arşiv** `isActive=false` S:4631/4698.

### 1.6 Özet — hangi olayın izi nerede

| Olay | Kalıcı defter/kolon | Yalnız audit | Hiçbir yerde |
|---|---|---|---|
| Doğuş | `createdAt/createdById` | payload | — |
| Sipariş bağla/çöz | `WorkOrderToOrderLine` (damgalı) | ✔ | — |
| Hedef özellik | `WorkOrderTargetProperty` (sürümlü) | ✔ | — |
| Renk / en / metre / kg / kat / tarih / rota / no değişimi | — | ✔ (2026-08-19 öncesi `changes` yok) | eski değer (replace) |
| Adım notu/firma | — | ✔ (`WORK_ORDER_STEP`) | — |
| Fason sevk/kabul, Tambur çıktısı, adım hareketi | ✔ kendi defterleri | ✔ | — |
| PLANNED→IN_PROGRESS (otomatik) | — | — | **✔** |
| →COMPLETED (otomatik) | — | — | **✔** |
| COMPLETED→IN_PROGRESS (yeniden açılma) | — | — | **✔** |
| İptal | kolonlar | ✔ | sebep (sipariş iptali dalı) |
| Kapanış anındaki toplar | — | — | **✔** |

## 2. SEKTÖR ÇERÇEVESİ (model alınır, ekran kalabalığı alınmaz)

- **SAP değişiklik belgesi** (CDHDR başlık + CDPOS kalem): bir kullanıcı eylemi = bir başlık (kim · ne zaman
  · işlem kodu); her değişen alan = bir kalem (tablo · alan · eski · yeni). ⇒ Bizde: bir eylem = bir
  `groupId`, her alan = bir satır (§4.1).
- **SAP durum geçmişi** (JCDS): sistem durumu değişimleri kendi tablosunda, otomatik geçişler dahil.
  ⇒ Bizde: `STATUS_CHANGED` olayı, tetikleyen işlemin adıyla (§4.2).
- **Üretim teyidi / mal girişi belgeleri:** yazıldığı an donar; düzeltme ters belgeyle (iptal teyidi,
  ters hareket türü). ⇒ Bizde: kapanış künyesi donar; yeniden açılma onu SİLMEZ, damgalar; yeni kapanış
  yeni sürümdür (§5).
- **Tekstilde kapanış:** giren ham metre ↔ çıkan mamul metre ⇒ verim %, çekme %, fire %. ⇒ Bizde künye
  toplamları (§5.3).

## 3. TASARIM İLKESİ — iki katman, tek kaynak

**(A) YAZILAN:** `WorkOrderEvent` — iş emrinin KENDİ durumunu ve planını değiştiren ve bugün hiçbir defterde
olmayan olaylar (§1.6'nın "yalnız audit" ve "hiçbir yerde" sütunları).

**(B) OKUNAN:** iş emrine düşen, KENDİ defteri olan olaylar (sipariş bağı, hedef özellik, fason sevk/kabul,
Tambur çıktısı, adım hareketi, plan sapması, dispozisyon, belge baskısı, tebdil). Bunlar `WorkOrderEvent`e
**KOPYALANMAZ**; Hareketler ucu onları kendi defterlerinden okuyup aynı zaman çizelgesine dizer.

Gerekçe: aynı olguyu iki deftere yazmak "tek kaynak" çekirdek kuralını çiğner — ters yolu biri unutursa iki
defter sessizce ayrışır. Kazanç: (B) katmanı geçmiş iş emirleri için **backfill istemez**, çünkü o defterler
zaten var. Reddedilen seçenek: "her şey `WorkOrderEvent`e" (tek tablo, basit okuma) — çift yazım, çift ters
yol, ayrışma riski.

**Audit ile ilişki:** audit yazımı olduğu gibi kalır (ayak izi); defter, künye ve Hareketler ucu audit
okumaz. `WorkOrderEvent` kendi CUD'unu audit'e yazmaz — ebeveyn eylem (iş emri değişikliği) zaten audit'li
⇒ `AUDIT_EXEMPT_MODELS`te `EBEVEYN_EYLEMDE` sınıfı (sınıf emsali `ShipmentEvent`).

## 4. (b) `WorkOrderEvent` DEFTERİ

### 4.1 Şema (yalnız EKLER)

| Kolon | Tip | Anlam |
|---|---|---|
| `id` | UUID | — |
| `workOrderId` | UUID FK `Restrict` | defter satırı ebeveyni silinemez |
| `type` | enum `WorkOrderEventType` | §4.2 |
| `groupId` | UUID | tek kullanıcı eylemi (CDHDR karşılığı); "Düzenle" 3 alan değiştirdiyse 3 satır, 1 grup |
| `field` | VarChar(40)? | `FIELD_CHANGED`de alan anahtarı (katalog TS sabiti, §4.4) |
| `fromValue` / `toValue` | Text? | makine değeri (id, sayı, ISO tarih, statü) |
| `fromLabel` / `toLabel` | VarChar(200)? | O ANKİ görünen ad (renk adı, kullanıcı adı…) — ad sonradan değişse de satır doğruyu söyler ("müşterideki ad donar") |
| `trigger` | VarChar(40)? | olayı tetikleyen işlem (`TAMBUR_FINALIZE`, `FASON_RECEIPT`, `TAMBUR_UNDO_SINGLE`, `MANUAL_COMPLETE`, `ORDER_CANCEL`…) |
| `channel` | enum `PANEL · TABLET · SYSTEM · BACKFILL` | `req.device.kind` (TABLET/PHONE → TABLET, diğer → PANEL); otomatik geçiş → SYSTEM. `clientType`ten TÜRETİLMEZ |
| `reason` / `reasonCode` | VarChar(300)? / VarChar(64)? | serbest sebep / `ReasonPreset.code` (FK'sız, `Roll.cancelReasonCode` emsali) |
| `refType` / `refId` | VarChar(40)? / UUID? | ilgili belge (fason makbuzu, top, kapanış künyesi…) — FK'sız, tür + id |
| `payload` | Json? | olaya özgü ayrıntı (etkilenen top id'leri, adım listesi) — yalnız gösterim; SAYI buradan hesaplanmaz |
| `createdById` | UUID? | aktör; SYSTEM'de tetikleyen isteğin kullanıcısı |
| `deviceId` | UUID? | tablet cihazı (varsa) |
| `createdAt` | Timestamptz | kronoloji; **`updatedAt` YOK** (append-only) |

Index: `(workOrderId, createdAt)` · `(type, createdAt)` · `(groupId)`. Defter reçetesinin sekiz sorusu
(`defter.md` Reçeteler) bu tabloyla cevaplandı; ⑥ miktar kolonu yok (miktar künyede, §5), ⑧ mutabakat §8.4.

### 4.2 Olay kataloğu ve ters mekanizmaları

| Tip | Ne zaman | Ters mekanizma (`defter-beyan.ts`) |
|---|---|---|
| `CREATED` | quick-start / panel formu | **DOĞUŞ** (`CIFT_DISI_DEGERLER`) |
| `STATUS_CHANGED` | her `WorkOrder.status` geçişi: başlama, tamamlanma (elle/otomatik), yeniden açılma, iptal, devir (SUPERSEDED), arşiv | **KARŞI KAYIT** — `fromValue↔toValue` takaslı ikinci satır; yeniden açılma = COMPLETED→IN_PROGRESS satırının kendisidir. CANCELLED/SUPERSEDED hedefleri terminaldir (tersi yazılmaz; bugün de geri dönüş yolu yok) |
| `FIELD_CHANGED` | renk · en · hedef metre · hedef kg · kat · hedef kumaş · plan tarihleri · rota · tip (bağın aynası) | **KARŞI KAYIT** — "geri almak" aynı alanı eski değere çeviren YENİ satırdır (`MachineStopReclass` emsali; ileri yazan = ters yazan, aynı helper) |
| `STEP_PLAN_CHANGED` | adım notu / fason firması / planlanan firma | **KARŞI KAYIT** |
| `ROLL_ATTRIBUTES_APPLIED` | "toplara uygula" (renk/en) | **KARŞI KAYIT** — payload top başına eski değeri taşır; toplara geri uygulama yeni satırdır |
| `BATCH_ADDED` | "Parti Ekle" (§6.5) | **DOĞUŞ** (partinin doğuşu) — geri alma = toplarına Top Çıkar, her top kendi defterinde |

`STATUS_CHANGED` tek tip + from/to tercih edildi (her geçişe ayrı enum değeri yerine): yeniden açılma ile
tamamlanma aynı olayın iki yönüdür ve KARŞI KAYIT kapısı (§3k) bunu yapısal olarak ölçer; yeni bir statü
geçişi enum'a değer eklemeyi gerektirmez ("altıncı enum değeri" sınıfından kaçış).

**(B) katmanı — okunan olaylar ve kaynakları** (Hareketler ucunda aynı çizelgeye dizilir, yazılmaz):

| Görünen olay | Kaynak defter | Ters yol (kaynağında) |
|---|---|---|
| Sipariş bağlandı / çözüldü | `WorkOrderToOrderLine` (`createdAt` / `unlinkedAt` + sebep) | damga |
| Hedef özellik eklendi / çıkarıldı | `WorkOrderTargetProperty` | damga |
| Toplar üretime alındı | `RollMovement` ilk giriş (`qtyIn`, aktif) | damga |
| Fason sevk / iptal | `SubcontractorDispatch` | ✔ |
| Fason kabul / iptal | `SubcontractorReceipt` | ✔ |
| Tambur çıktısı / geri alma | çocuk toplar (`producedInStepId`) + `RollOperation` | damga |
| Plan sapması onayı | `RollPlanDeviation` | damga |
| Kapanış dispozisyonu | `WarehouseMovement` (`DISPOSITION`) | bağlı ters |
| Refakat kartı basıldı | `TravelerCard` sürümü / `PrintedDocument` | sürüm |
| Tebdil / bölme | çocuk iş emri (`splitFromId`) | — |

### 4.3 Yazıcı boğazları (tek yazar)

Yeni helper `services/helpers/workorder-event.helper.ts` (UYGULANDI, D1): statüyü değiştiren TEK yol
`claimWorkOrderStatusTx(tx, id, {from[], to, where?, data?, ctx})` (mevcut statüyü okur, claim'i TAM o statüye
karşı koşar, satır kilidi almaz, `count === 0`da taze okumayla bir kez daha dener, geçişi yazar) ·
`reopenWorkOrderTx` (COMPLETED→IN_PROGRESS, tamamlanmanın karşı kaydı) · `createWorkOrderTx` (iş emrini ve CREATED satırını aynı tx'te doğuran tek yol) ·
`recordWorkOrderFieldChangesTx` (alan başına satır, tek grup; D2'nin kalanı buna bağlanır). Kanal/cihaz/aktör
`lib/request-context` (`currentOrigin` + `deviceKind`) üzerinden — çağıran yalnız `trigger` verir.
Çağıran yerler:

- **Durum:** `ensureWorkOrderInProgress` · `completeWorkOrderIfStepsDone` (imzasına `ctx {userId, trigger,
  channel}` eklenir; 10 çağıranın hepsi geçirir) · `completeWorkOrder` · `softDelete` · order.service
  `CANCEL_WO` (sebep geçirilir) · split SUPERSEDED · arşiv · `lockWorkOrder`.
- **Yeniden açılma:** yedi dağınık yol **tek helper'a** toplanır — `reopenWorkOrderTx(tx, woId, ctx)`:
  `STATUS_CHANGED` COMPLETED→IN_PROGRESS yazar ve son kapanış künyesini damgalar (§5.2). AST kapısı: bu
  helper dışında `workOrder.update*`le `status: IN_PROGRESS` yazımı kırmızı.
- **Alan:** `update` S:5003 · `replace` S:5257 · `changeTargetColor` L:524 · `changeWidth` L:657 ·
  adım planlama S:6236 · `applyAttributeToRolls` L:769 · tip çevrimi (L:396, order.service :548/:2999/:3389).
- Olay, claim BAŞARILI olduktan sonra (`count === 1`) aynı tx'te yazılır; ek kilit gerekmez
  (`touchWorkOrderTx` satır kilidi zaten var) — advisory uzay açılmaz.

### 4.4 Alan kataloğu (tek kaynak)

`constants/workorder-event-fields.ts`: `{ targetColorId: {label:"Hedef renk", resolve:colorName}, width:
{label:"En (cm)"}, targetQuantity, targetWeight, foldType, targetItemId, plannedStartDate, plannedEndDate,
routeTemplateId, type }`. **`workOrderNumber` katalogda YOK** — numara hiçbir uçtan değişmez (§6.3).
Katalog dışı alanı diff'e sokan yol kırmızı (bekçi §8.4).

**Uygulama (D2a, 2026-09-25):** katalog `constants/workorder-event-fields.ts`te alan listesi + değer TÜRÜ
(`WORK_ORDER_FIELD_KIND`) olarak durur; okunur alan adları D4'ün `WORK_ORDER_FIELD_LABEL`inde (iki dal ayrı
indiği için; birleşince etiket haritası `Record<WorkOrderTrackedField, string>`e bağlanır). Kimlik alanlarının
(renk · kumaş · rota) etiketi yazım anındaki ADdır, tarih etiketi fabrika günü. Yazıcılar: `recordWorkOrderFieldDiffTx`
(önce/sonra satırından diff) · `setWorkOrderTypeTx` (tip, CHANGED/ALREADY/NO_MATCH) · `recordStepPlanChangesTx`
(fason adımı: `requiredCategoryId` · `plannedSubcontractorId` · `dispatchWithoutColor`) · `recordRollAttributesAppliedTx`
(`rollColor` · `rollWidth`). `changeWidth` ve `updateStepPlanning` tek tx'e alındı (claim + kart işareti + olay).
`replace` tarihsiz gelirse `resolvePlanDates` tarihleri "şimdi"ye çeker — davranış eskisi gibi, artık deftere düşer.
**D2a-2:** adım planı tek diff'ten (`readStepSnapshotsTx` + `recordStepDiffTx`): istasyon sırası değiştiyse tek
`route` satırı (eski → yeni sıra), iki hâlde de bulunan adımın not/kategori/fasoncu/renksiz sevk farkı adım başına;
`replace`in alan ve rota satırları tek `groupId`de. `ROLL_ATTRIBUTES_APPLIED` yükü `rolls[{rollId, fromColorId,
fromWidth}]`. Ölçülen hata: `replace` araya adım eklerken `(workOrderId, stepSequence)` tekilliğine çarpıp 500
veriyordu (kod yorumu kısıtın olmadığını sanıyordu) — kalan adımlar önce negatif sıraya park edilir.

## 5. (c) KAPANIŞ KÜNYESİ

### 5.1 Şema (yalnız EKLER) — UYGULANDI (D3)

**`WorkOrderCloseSnapshot`** (başlık, `work_order_close_snapshots`): `id · workOrderId (FK Cascade) · version
(1..n) · closeKind (AUTO_LAST_STEP | MANUAL | BACKFILL, CHECK) · trigger · closedById? · rollCount · warehouseM ·
a1M · scrapM · outputM (CHECK = üç kova toplamı) · totalKg? · weighedRollCount · inputRollCount · inputM ·
yieldPct? · shrinkagePct? · scrapPct? · startedAt? · durationSec? · createdAt (= kapanış anı)`. Tekillik
`(workOrderId, version)`.

**`WorkOrderCloseSnapshotLine`** (kalem, `work_order_close_snapshot_lines`): `snapshotId (FK Cascade) ·
rollId (FK'SIZ) · barcode? · producedQtyM (initialQty) · qtyM (currentQty) · weightKg · width · colorId ·
colorLabel · qualityGrade · bucket (WAREHOUSE|A1|SCRAP, CHECK) · batchId · batchLabel · status · foldType ·
itemLabel · createdAt`.

**Tasarım değişikliği (uygulamada, 2026-09-25): `supersededAt` damgası YOK.** Künye tabloları
`defter_block_tamper` mühürlüdür (1e kararı) — UPDATE her zaman reddedilir, yani başlığa sonradan damga
yazılamaz. Eskime TÜRETİLİR: "canlı" künye en yüksek `version`dır; iş emri bugün COMPLETED değilse o künye
"son kapanıştaki" hâldir (ekran bunu böyle yazar); yeniden açılmanın izi `WorkOrderEvent` karşı kaydıdır.
Beyan: ikisi de `SATIR_EBEVEYN`, ebeveyn `WorkOrderEvent` (ters yol = yeniden açma karşı kaydı).

### 5.2 Ne zaman yazılır — UYGULANDI (D3)

- Tek yazar `helpers/workorder-close-snapshot.helper.ts` → `freezeCloseSnapshotTx`; `workOrderCloseSnapshot`
  başka dosyadan yazılamaz (`test_workorder_event_yazar` §6b).
- COMPLETED geçişiyle **aynı tx'te**: `completeWorkOrderIfStepsDone` (otomatik, claim kazanıldıysa) ve
  `completeWorkOrder` (elle — kapanış dispozisyonlarından SONRA; depoya inen top da çıktıdır). Her
  `claimWorkOrderStatusTx(… to: COMPLETED)` çağıran fonksiyon künyeyi de dondurur (§6, AST).
- Küme TEK KAYNAK `producedOutputWhere` — `helpers/produced-output.helper.ts`e taşındı; liste ÇIKAN
  metriği, detay başlığı ve künye aynı yüklemi çağırır.
- Yeniden açılma künyeyi silmez/değiştirmez; sonraki kapanış `version = n+1` yazar.
- İptal edilen iş emri künye YAZMAZ (üretim çıktısı kapanışı değil).

### 5.3 Toplamlar (verim/fire)

- **Giren ham metre** = `computeWoInput` tek kaynağı (kök top sayısı + kök `initialQty` + fasondan-sevk
  charge-split çocuğu; normal ve tebdil iş emrinde doğru — liste/detay `inputRolls` ile aynı). *(Önceki
  taslak "en erken aktif `RollMovement.qtyIn`" diyordu; ayrı bir tanım kurmak yerine mevcut tek kaynak
  kullanıldı.)*
- **Çıkan** = depo + A1 + fire metresi — kova toplamları üretim metresinden (`initialQty`), canlı başlıkla
  aynı ölçü; kalemde ayrıca kapanıştaki `currentQty` durur.
- **Verim %** = çıkan ÷ giren · **çekme %** = (giren − çıkan) ÷ giren · **fire %** = fire ÷ giren ·
  **süre** = ilk `STATUS_CHANGED → IN_PROGRESS` (yoksa ilk giriş hareketi) → kapanış.
- Tanım kullanıcı onayına bağlı (§9 S8).

### 5.4 Ekran — "kapanıştaki" ile "bugünkü" (simple is more)

- Tamamlanmış iş emrinde kart başlığı **kapanış künyesini** gösterir: "Kapanışta: 13 top · 499 m · verim
  %96,2". Bugünkü değer farklıysa tek küçük satır: "Bugün: 12 top · 480 m (−1 top, −19 m) ›".
- `›` karşılaştırmayı açar: top başına iki sütun (kapanışta | bugün) ve fark rozetleri — *Sevk edildi ·
  Kesildi (−x m) · İptal · Kalite değişti · Renk değişti · Yeniden kesildi*. Fark yoksa karşılaştırma
  tuşu hiç görünmez.
- Birden çok sürüm varsa (yeniden açılmış): "Kapanış 2 (25.09 14:10) · önceki: Kapanış 1 (24.09) ›".
- Yeni ekran/sekme yok; mevcut `ProducedV3` kartı genişler. Tablette aynı başlık satırı (salt okunur).

## 6. (d) TABLET DÜZELTME MENÜSÜ

### 6.1 Paneldeki tuşlar → tablet kararı

| Panel tuşu | Tablete | Gerekçe |
|---|---|---|
| Detayı Aç | VAR (bugün) | — |
| **Düzenle ⚠** | **KONMAZ**; bugünkü tablet genel Düzenle'si **kaldırılır**, alanları tek amaçlı tuşlara taşınır | sebepsiz çok alanlı değişiklik + iş emri no (§1.3) |
| **Rengi Değiştir** | **KONUR** | en sık düzeltme; mal kilidi (`assertTargetColorChange`) + iki aşamalı kısmi onay tablete taşınır |
| **Eni Değiştir** | **KONUR** | tek sayı, sebep zorunlu |
| **Sipariş Bağla / Çöz** | **KONUR** | backend + tablet bileşeni hazır (`TamburOrderLinkSheet`) — yeniden kullanılır |
| Fason Kabul | KONMAZ (menüde) | tablette ayrı istasyon modülü zaten var |
| **Belgeler → Refakat kartını yeniden bas** | **KONUR** (kısayol) | kart bayatsa ("renk değişti") tek dokunuşla yeni sürüm |
| Kapat | KONMAZ | dispozisyon + `roll:manual-adjust` ister — süpervizör işi, panelde |
| İptal Et | **Soru S3** | bugün tablette VAR; öneri: yalnız HİÇ işlem görmemiş iş emrinde kalsın |
| (yeni) **Top Çıkar** | **KONUR — yeni backend** | yanlış okutma; bugün uç yok (`detachRolls` ölü koddu, 2026-09-25'te silindi) |
| (yeni) **Parti Ekle** | **KONUR — S4 kararı (2026-09-25)**, tablet + panel | açık iş emrine okutulan toplar YENİ PARTİ olur ve ilk adımdan başlar; mevcut partiye ekleme yok; tamamlanmış iş emrine yok (§6.5) |
| (yeni) Hedef metre / kg | Soru S1 | bugün yalnız genel Düzenle'de; tek amaçlı tuş olarak taşınabilir |

### 6.2 Her tuşun kalıbı (tek iskelet)

`ModuleSheet` (tek kart) — üçüncü biçim yok (`tablet-modal-sayfali-tercihi`). İçerik sırası:
1. **Tek alan** (renk seçici · en sayısı · sipariş satırı seçici).
2. **Etki önizlemesi** — sunucu önizleme ucundan: "Bu değişiklik 8 topu etkiler · 8 etiket bayat olur ·
   refakat kartı yeniden basılmalı" + etkilenen toplar listesi (soyut sayı yetmez, çekirdek kural). Renkte
   kısmi boya durumu (`COLOR_PARTIAL_CONFIRM`) burada seçimle çözülür, 409 tostuna düşmez.
3. **Sebep** — `ReasonPreset` hazır listesi + "Diğer" (tek dokunuş).
4. **Kaydet** → deftere `FIELD_CHANGED` (+ gerekirse `ROLL_ATTRIBUTES_APPLIED`), `channel=TABLET`.

Dokunuş bütçesi (kabul ölçütü): tuş → değer → sebep → Kaydet = **4 dokunuş**; önizleme ayrı sayfa DEĞİL,
aynı kartta.

**Top Çıkar** (yeni uç `POST /:id/rolls/:rollId/detach`): yalnız top bu iş emrinde HİÇBİR işlem görmediyse
(tek aktif giriş hareketi, `RollOperation` yok, çıkış yok). Etki: giriş hareketi DAMGALANIR (silinmez),
stok defterindeki `PRODUCTION_ISSUE` bağlı ters satırla kapanır, top önceki statüsüne/deposuna döner.
Hareketler'de bu olay (B) katmanından — `RollMovement` damgasından — okunur, `WorkOrderEvent`e kopyalanmaz;
iş emrinde top kalmazsa ayrıca `STATUS_CHANGED` yazılır. İşlem görmüş top için cevap: "Bu top işlem gördü —
panelden Konumu Düzelt / Parti Düşür".
**Uygulama (D6, 2026-09-25):** `workorder-roll-detach.service.ts` (`detachTx` tek boğaz; önizleme `listCandidates`
aynı engel yüklemiyle). İşlem görmemiş = ilk adımda · en fazla bir AÇIK giriş hareketi (dış ilk adımda sıfır) ·
bu iş emrinin adımlarında aktif `RollOperation` yok · çocuk top yok · iptal edilmemiş fason sevk kalemi yok ·
çuval/sevk yok · bu iş emrinde `RollVariance` yok. Stok defterinde yeni ters kod `ROLL_DETACH`
(`PRODUCTION_ISSUE` artık `BAGLI_TERS`; `DISPOSITION`/`RESCUE` bağsız karşı yön olarak kalır; `WO_DETACH` yazıcısıyla birlikte silindi).
Önceki durum/depo ileri satırın `from` ucundan; satır yoksa (depo/stok dışı top) son `RollStatusEvent`ten.
**Sapma:** Hareketler satırı `RollMovement` damgası yerine stok defterinin tipli ters satırından okunur
(damga sebebi serbest metin, ters satır tipli kod + aktör + not taşır); depo defteri satırı olmayan topun
çıkarılması bu yüzden çizelgede görünmez (ölçülecek; saha yolu stok topudur). Boş parti `deleteIfEmptyAndTracelessTx`
ile düşer; iş emri PLANNED'a yalnız top kalmaz VE hiçbir adım başlamamışsa döner. Ölü `detachRolls` sonraki dilimde silindi; iş emri iptali aynı bağlı tersi yazar (arşiv 2026-09-25 "iptal").

### 6.3 Genel "Düzenle" ve iş emri numarası — öneri

- **İş emri numarası (`WorkOrder.workOrderNumber`) doğuşta donar, hiçbir uçtan yazılamaz.** Bugün onu
  yazan tek kanal, `update` ve `replace` Zod şemalarındaki yanıltıcı adlı `batchNumber` anahtarıdır
  (controller :278; S:5944) — bu anahtar iki şemadan kalkar. Eski istemci uyumu: gövdede anahtar gelirse ve
  değeri mevcut `workOrderNumber`la AYNIYSA sessizce kabul (panel formu bugün mevcut değeri geri
  gönderiyor), FARKLIYSA 409 "İş emri numarası değiştirilemez". Panel formunda alan salt-okunur olur.
- **Başlamış (IN_PROGRESS) iş emrinde genel Düzenle yalnız yıkıcı olmayan alanlarla sınırlanır:** plan
  tarihleri · hedef metre/kg · notlar. Renk, en, rota, kumaş, sipariş → tek amaçlı tuşlar (bugün panelde
  zaten var). PLANNED (hiç top almamış) iş emrinde tam `replace` kalır.
  **Ölçüm ve karar (D2b, 2026-09-25, 4b — seçenek A):** "tuşlar zaten var" yalnız renk · en · sipariş bağı
  için doğru çıktı; rota adımı ekle/çıkar, kumaş, kat ve hedef özelliğin genel Düzenle dışında yolu yok
  (özelliğin ucu var, panelde çağıranı yok). UYGULANAN: başlamış iş emrinde renk · en · sipariş bağı değişimi
  409 `WO_STARTED_USE_ACTION` (`details.field`: color · width · orderLinks), panel formu bu alanları kilitler;
  rota/kumaş/kat/özellik Düzenle'de kalır (fiziksel kilitler + deftere düşer). **B (eksik tek amaçlı tuşlar:
  rota adımı ekle/çıkar · kumaş · kat · özellik) sonraki faz.** C (tuşsuz kapatma) çıkışsız kapı, reddedildi.
- `replace` renk değiştiriyorsa `assertTargetColorChange`den geçer (bugün atlıyor).
- Bayat yorumlar (`E/service.ts:213`, controller :292/:607) koda hizalanır.

### 6.4 İzinler (reçete: katalog koda, atama panele; migration YOK)

Öneri (S7): tek yeni kod **`mobile:is-emri-duzelt`** ("İş emri düzeltme — tablet"). Gerekçe: "iş emri açabilen"
ile "açılmış iş emrini değiştirebilen" ayrı sorumluluktur; bugün `mobile:hizli-is-emri` PATCH `/:id` ile
her ikisini birden veriyor. Tuşların uçları bu kodu `requireAnyPermission(... "workorder:write")` ile kabul
eder; SoD üçlüsü değişmez. Uyumsuz sipariş bağı (`order-links/override`) tablete GELMEZ.

### 6.5 "Parti Ekle" — tasarım (S4 kararı, 2026-09-25)

**Kullanıcı kararı:** açık iş emrine top eklenebilir; eklenen toplar aynı iş emri altında **YENİ PARTİ** olur
(P02…) ve rotanın **ilk adımından** başlar. Mevcut partiye top eklenmez. **Tamamlanmış iş emrine parti
EKLENMEZ** — yeni iş emri açılır, kapanış künyesi donmuş kalır. Hedef metre ya da sipariş miktarı aşılırsa
kısa uyarı, engel yok. "Tek iş emri tek kumaş" KESİN kuraldır. Bu karar `is-emri.md`'nin "mevcut iş emrine
top EKLEME YOK" kuralını DEĞİŞTİRİR (kural satırı + arşivde "GEÇERSİZ → 2026-09-25" uygulama dilimiyle).

**Tek boğaz:** `addBatchToWorkOrderTx(tx, workOrderId, rolls, ctx)` — `attachRolls`un yerini alır; dört
çağıranı olur ve dördü AYNI kuralı uygular:
1. yeni uç `POST /work-orders/:id/batches` (tablet + panel "Parti Ekle"),
2. `quickStart` (ilk parti — bugünkü `attachRolls` çağrısı),
3. fason sevk otomatik bağlama (`subcontractor.service.ts:1173-1188` — bugün tek partiye KATILIYOR),
4. Tambur "Topu Buraya Al" (`manualMove`) ve "Manuel Top Ekle" (`tambur-manual.service.ts:1166-1178` —
   bugün açık partiye KATILIYOR; `:399-410` tamamlanmış iş emrini sessizce YENİDEN AÇIYOR — kalkar).
Tamamlanmış iş emrine her yoldan 409 `WO_COMPLETED_NO_ADD` — *"Tamamlanmış iş emrine top eklenemez — yeni
iş emri açın."* ⚠️ Saha davranış değişikliği (Tambur'un yeniden açması kalkar): sürüm notunda AYRI madde.

**Uç sözleşmesi** (`POST /work-orders/:id/batches`): gövde `{ clientToken, rollBarcodes[], reason? }`;
tx'in İLK ifadesi 8022 (parti numarası), sonra `touchWorkOrderTx` + taze durum claim'i (`PLANNED |
IN_PROGRESS` — COMPLETED dahil diğer her durum 409, bugünkü S:4801 açığı kapanır); top kabul kümesi
`quickStart.attachable` + çuval/sevkiyat reddi (tablet `scanClassify` ile birebir); kumaş iş emrinin
`targetItemId`sine EŞİT değilse 400 `ITEM_MISMATCH`; renk/özellik rota kapsaması quickStart'la ORTAK
helper'dan (`warnings`); hedef aşımı `warnings` (*"Hedef 1.000 m, girilen toplam 1.240 m"* · *"Sipariş
kalemi 800 m, iş emrindeki toplam 1.040 m"*); `clientToken @unique` replay (kayıt yaratan uç kuralı).

**R1–R7'nin kapanışı (aynı dilim, kabul kapıları):**
- **R1 (kabul kapısı):** ilk adımda bekleyen (sevk edilmemiş) yeni parti varken ilk adım COMPLETED kalamaz
  ve iş emri KAPANAMAZ — `recomputeStepStatus` ilk adımın aday kümesine `currentStepId = ilk adım`
  topları da alır (giriş sayımı `test_wo_input_attach_window` bu birleşimi zaten kullanıyor).
  Bekçi negatif sondayla kırmızı verir (aday kümesinden `currentStepId` dalı düşürülünce iş emri kapanır).
- **R2:** ekleme sonrası TÜM adımlar recompute (sonraki COMPLETED adımlar bayat kalmaz).
- **R3:** kumaş kesin, renk/özellik uyarı, hedef/sipariş aşımı uyarı — hepsi ortak helper.
- **R4:** `clientToken`. **R7:** 8022 ilk ifade.
- **R5 — yeni parti kimliği korunur (öneri):** (a) sevk: K11 değişmez (tek sevk = tek parti); `MULTI_BATCH`
  modalında varsayılan AYRI sevk, `MERGE` açık seçim olarak kalır ve iz `Batch.mergedIntoId`de durur —
  Hareketler'de "P07, P02 ile birleştirildi" satırı; (b) kabul: doğan toplar partiyi `sourceLotRolls.find`
  (ilk bulunan, `subcontractor.service.ts:3324-3330`) ile DEĞİL, kabul edilen SEVKİN partisinden alır; bir
  kabul birden çok partinin açık sevkini kapsıyorsa ekran partiyi sorar (tek dokunuş, varsayılan en eski
  açık sevk) — tek partide bugünkü akış +0 dokunuş. *Karar gerekirse: (b)'deki soru, tartışmalı tek UX adımı.*
- **R6 — parti no çakışması:** P01…P99 global körlemesine sarma aynı iş emrinde iki canlı P05 üretebilir.
  Öneri: sarma, AYNI iş emrinde canlı olan numarayı atlar (`parti.md` profil kuralına ek; karar 1e).
- **R8** kararla kapsam dışı (tamamlanmışa ekleme yok).

**Ekran (tek iskelet):** tablet `ModuleSheet` — tarayıcı (`trigger="tap"`, çok top okutan ekran kuralı) +
okutulanlar şeridi + etki önizlemesi (*"Yeni parti açılacak · 5 top · 240 m · ilk adım: Boyahane (fason)"*
+ varsa hedef aşımı uyarısı) + isteğe bağlı sebep + Kaydet. Dokunuş: tuş → okut ×N → Kaydet. Panel: yan
panelde "Parti Ekle" → `RollPickerModal` emsali seçici (Ham Stok · Bitmiş Depo sekmeleri) + aynı önizleme.
İzin: panel `workorder:write`; tablet S7 kararına bağlı.

**Deftere olay:** `WorkOrderEvent` tipi `BATCH_ADDED` (field=`batch`, `toValue`=batchId, `toLabel`=parti no,
payload=top id'leri, sebep, kanal). Ters yol: partiyi geri almak = partinin toplarına "Top Çıkar" (her top
kendi defterinde — `RollMovement` damgası + stok defteri bağlı ters satırı); `BATCH_ADDED` bu yüzden
çift-dışı **DOĞUŞ** sınıfındadır (partinin doğuşu; `ShipmentEvent.PLANNED` emsali). Refakat kartı: ACTIVE
kart bayat işaretlenir (bugün de öyle), tablet menüsünde "Kartı yeniden bas" görünür.

## 7. (e) HAREKETLER EKRANI

**Durum (2026-09-25): D4a UYGULANDI** — uç `GET /api/work-orders/:id/events` (`workorder-timeline.service.ts`;
iki katman, cursor'lu, grup süzgeci fail-closed, satır başlığı sunucuda Türkçe —
`constants/workorder-event-labels.ts`) + panel `WorkOrderEventsSheet` (yan panel ve detay başlığında
"Hareketler" tuşu). Kalan: D4b ayrı ekran (iş emri no / barkod arama + Excel) · D4c tablet detayında son 5
hareket (S9).
**D4b UYGULANDI (2026-09-25):** Operasyon → "İş Emri Hareketleri" ekranı (`/operations/work-order-events`,
`workorder:read`, üretim modülü kapısı): iş emri no ya da top barkodu (`GET /work-orders/events/lookup` —
barkod topun geçtiği tüm iş emirlerini verir, birden çoksa seçim kullanıcıda) + yan panelle AYNI gövde
(`WorkOrderEventsPanel`) + Excel. Ekrandaki sütunlar = Excel sütunları: ikisi de `EVENT_COLUMNS`ten türer; Excel
ekranda yüklenmiş sayfayla sınırlı değil, süzgeçteki listenin tamamı (sınırı aşarsa sessizce kırpmaz, durur).
**D4c UYGULANDI (2026-09-25):** tablet iş emri detayında "Son Hareketler" — aynı uç `limit=5`, salt-okunur,
"hata" ≠ "kayıt yok"; tam liste ve Excel panelde (S9). Cihazda henüz görülmedi.

- **Uç:** `GET /work-orders/:id/events?types=…&cursor=…` — (A) `WorkOrderEvent` + (B) kaynak defterler,
  `createdAt` sıralı, cursor'lu; süzme SUNUCUDA (liste + cursor + özet tek where). `GET /work-orders/events/
  lookup?q=<iş emri no | top barkodu>` — barkod topun bağlı olduğu iş emirlerini döndürür. İzin
  `workorder:read`. Audit OKUNMAZ.
- **Panel yan panel/detay:** "Hareketler" tuşu → Sheet (`WarehouseMovementsSheet` sözleşmesi: salt-okunur,
  "hata" ≠ "kayıt yok", altbilgi listenin bitip bitmediğini söyler, "Düzelt" tuşu YOK).
- **Panel ayrı ekran:** Operasyon → "İş Emri Hareketleri": iş emri no ya da barkod okutma → aynı zaman
  çizelgesi; olay tipi süzgeci (Durum · Plan değişikliği · Sipariş · Fason · Tambur · Belge); Excel/yazdır
  mevcut dışa aktarım altyapısıyla.
- **Satır biçimi:** zaman · olay · alan "eski → yeni" · sebep · kim · kanal (Panel/Tablet/Sistem) ·
  tetikleyen. `origin=BACKFILL` satırları "sonradan türetildi" rozeti taşır.
- **Fason/Tambur satırları belge düzeyinde** (bir sevk = bir satır, "8 top · 412 m ›" açılır) — S6.

## 8. (f) BACKFILL · MIGRATION · GERİYE DÖNÜKLÜK · BEKÇİLER · DİLİMLER

### 8.1 Backfill — YENİ DOSYA `Teks-Erp/scripts/backfill_workorder_events.ts` (audit okuyan tek, BİR KERELİK göç)

- **Script:** `backfill_workorder_events.ts` (başlıktaki yol) — 37'nin audit kapısında beyanlı istisna.
  Kuru koşum varsayılan; `--apply` öncesi etkilenen her iş emrini listeler; fabrikada KULLANICI koşar.
- **Audit'SİZ türetilenler** (kalıcı kolonlardan): `CREATED` (`createdAt/createdById`), iptal
  (`cancelledAt/ById/Reason`).
- **Audit'ten BİR KEZ aktarılanlar** (`SystemLog ∪ SystemLogArchive`, `tableName=WORK_ORDER`): alan
  değişiklikleri (`changes` 2026-08-19'dan beri var; öncesi `oldData/newData` farkından), renk/en
  (`TARGET_COLOR_CHANGED` · `TARGET_WIDTH_CHANGED` `oldData`), elle kapanış. Her satır `channel=BACKFILL`.
- **Türetilemeyen** (dürüstlük kaydı): otomatik başlama/tamamlanma/yeniden açılma — hiçbir yerde yok.
  Tamamlanma için `max(WorkOrderStep.completedAt)` YAKLAŞIK olarak yazılabilir (S5 ile birlikte karar).
- (B) katmanı backfill istemez.

### 8.2 Migration ve geriye dönüklük

- Şema yalnız EKLER: 3 tablo (`work_order_events` · `work_order_close_snapshots` · `…_lines`) + 2 enum.
  Mevcut kolona dokunulmaz. `migrate dev --create-only` + `DropForeignKey` satırları silinir.
- **Eski istemci ne yapar:** yeni uçlar yalnız ek; eski panel/APK etkilenmez. Tek sözleşme değişikliği
  iş emri numarasının yazılamaması — aynı değer kabul, farklı değer 409 (§6.3); eski tablet genel
  Düzenle'de numarayı değiştirmeye çalışırsa 409 tostu görür. `minVersion` DEĞİŞMEZ.
- Backend ÖNCE; panel + tablet sonra.

### 8.3 Dilim sırası

| # | Dilim | Bağımlılık |
|---|---|---|
| **K1** | Tablet boş alan uyarısı + B1 düzeltmesi + B2/B3 | yok — hemen |
| D1 | Şema + `workorder-event.helper` + durum boğazları (başla/tamamla/yeniden aç/iptal/devir) + beyan + bekçi | 9b S2+S3 indikten sonra |
| D2 | Alan değişiklikleri → `FIELD_CHANGED` (update/replace/renk/en/adım/toplara uygula/tip) + numara kilidi (§6.3) — **D2a + D2a-2 + D2b UYGULANDI** (§4.4 notu, §6.3 kararı) | D1 |
| D3 | Kapanış künyesi (şema + yazım + ProducedV3 karşılaştırma) | D1 |
| D4 | Hareketler ucu (A+B) + panel Sheet + ayrı ekran + Excel | D1 (D2 ile zenginleşir) |
| D5 | Tablet düzeltme menüsü + `mobile:is-emri-duzelt` + önizleme uçları — **D5a (backend) + D5b (tablet menüsü) UYGULANDI**: izin + uç kapıları, renk önizlemesi, `WORK_ORDER_PLAN_CHANGE` sebep kataloğu, panel yetkisiz iptal yalnız dokunulmamış iş emrinde; tablette genel Düzenle kalktı, "Düzelt" menüsü (Top Çıkar D6 ile eklenecek) | D2, S1–S3/S7 cevapları |
| D6 | Top Çıkar ucu (ledger ters yollarıyla) + tablet tuşu — **UYGULANDI** (§6.2 notu) | D1 |
| **D8** | **Parti Ekle** (§6.5): `addBatchToWorkOrderTx` tek boğaz + uç + dört çağıranın bağlanması + R1–R7 + tablet/panel tuşu + `is-emri.md` kural değişimi + arşiv GEÇERSİZ notu | D1 (olay tipi), 9b S2+S3 |
| D7 | Backfill script (kuru koşum) | D1–D3; `--apply` kullanıcıda |
| B-RM | `RollMovement` kapanış damgası borcu (§8.5) | 1e sahip atar |

### 8.4 Bekçiler

- `test_workorder_event_ledger` — her boğaz satır yazar (10 otomatik tamamlama çağıranı dahil), karşı kayıt
  simetrisi, `groupId`, etiket donar, `channel` `req.device`ten; negatif sonda: bir boğazdan yazıcı
  susturulunca kırmızı.
- `test_workorder_event_yazar` — AST cırcırı: `workOrder.update*` ile izlenen alanı/statüyü yazan her
  fonksiyon helper'ı çağırır; `status: IN_PROGRESS` yalnız `reopenWorkOrderTx`/`ensureWorkOrderInProgress`
  içinde. **İki sonda:** ihlal eklenince taban ARTAR · düzeltilince DÜŞER.
- `test_workorder_close_snapshot` — kapanışta künye, kümesi `producedOutputWhere` ile birebir; yeniden
  açma → damga, v1 değişmez; ikinci kapanış v2; top sonradan kesilince künye değişmez, "bugün" farkı görünür.
- Mevcut kapılara giriş: `test_defter_ters_yol` (beyan: `WorkOrderEvent` KARŞI_KAYIT, künye DAMGA) ·
  `test_snapshot_kolonlari` (kalem MUAF/BELGE_DEFTERI) · `test_audit_muafiyeti` (EBEVEYN_EYLEMDE) · 37'nin
  audit okuma kapısı (bu dosyalarda audit okuması 0) · `test_db_invariants` (partial unique envanteri).
- Tablet: K1 saf yüklem jest testi; D5 bileşen testleri.

### 8.5 Borç dilimi B-RM — `RollMovement` kapanış damgası yerinde null'lanıyor

> **İNDİ (37, 2026-09-25).** Altı yol (ölçümde `subcontractor.reopenRemainder` altıncı çıktı) tek kaynak
> `reopenClosedMovementsTx`e bağlandı. Yeni açık satırın `qtyIn`i "geri gelen metre" DEĞİL kapalı satırın giriş
> alanlarıdır (qtyIn · weightIn · enteredAt · operatorId · machineId) — açık satırın `qtyIn`i sonraki kapanışın
> `qtyOut`una, `enteredAt` adım başlangıcına ve operatör penceresine akıyor (ölçüldü). Altı iptal yolu
> `cancelledById` yazar; `restoreCancelledRoll` DURUM kolonu olarak beyanlı; kapı `test_defter_ters_yol` §14.
> Gerekçe ve ölçüm: `docs/history/CLAUDE-NOT-ARSIVI.md` 2026-09-25 B-RM.

- **Ölçüm:** beş yol kapanmış hareketi YENİDEN AÇARKEN `exitedAt/qtyOut/weightOut`u `null`'a çekiyor ve
  `notes`u eziyor: `tambur-undo.service.ts:1697` (SINGLE) · `:1976` (FULL) · `kursun-qc.reopenStep` :1202 ·
  `subcontractor.cancelReceipt` :5587 · `subcontractor.undoTransfer` :6143.
- **Etkisi:** "adımdan kaç metre çıktı" bilgisi geri almada kalıcı kaybolur (ileri kaydı değiştirmek —
  `defter.md` "ileri damgayı null'lamak yasak" ruhu; damga listesi `qtyOut/exitedAt`i adıyla saymıyor ama
  kolon kim/ne zaman/miktar taşıyor ⇒ DAMGA sınıfı); geçmiş kapanışın geri üretimini imkânsız kılar;
  `notes` ezildiği için neden kapandığı da kaybolur.
- **Ters kayıt önerisi:** kapalı satır DAMGALANIR (`revokedAt/revokedById/revokeReason = TAMBUR_UNDO_REOPEN`),
  aynı adıma YENİ açık satır yazılır (`qtyIn` = geri konan metre). Partial unique (`exitedAt IS NULL AND
  revokedAt IS NULL`) yeni satıra izin verir; `recomputeStepStatus` aktif satırı sayar ⇒ adım durumu
  aynı kalır. Etkilenen okuyucular ölçülmeli: giriş noktası (sıra-bazlı, etkilenmez), `test_wo_input_attach_window`
  sayımı (ilk adımda distinct rollId — yeni satır aynı adımda ⇒ değişmez), WIP karnesi.
- Bekçi: beş yolun her birinde "kapalı satırın `qtyOut`u geri almadan sonra aynı" + `test_defter_ters_yol`
  damga-null taramasına `qtyOut/exitedAt` eklenmesi.
- **Aynı dilime eklendi (37'nin notu, 2026-09-25):** `restoreCancelledRoll` `Roll.cancelledAt/cancelledById`i
  null'luyor; `roll_status_events` (37, K-A3) geçmişi koruduğu için orada değişmedi. 5 iptal yolunun (arşiv ·
  tambur geri alma ×3 · fason ×2) `cancelledById` yazmasıyla aynı borç diliminde ele alınır. ⇒ B-RM TEK borç
  dilimidir: `qtyOut` null'lama + `restoreCancelledRoll` + beş yolun aktörü; sahibini 1e atar.

## 9. (g) KULLANICIYA SORULAR — her biri şıklı, ⭐ önerilen

**CEVAPLANDI (2026-09-25, kullanıcı; 1e aracılığıyla):** S1 = A · S2 = A · S3 = A · **S4 = "Parti Ekle"**
(kullanıcının karşı sorusundan doğdu: *"o iş emrine yeni top eklenirse aynı iş emrinde yeni parti olamaz mı?"* —
ölçüm §11, tasarım §6.5; aşağıdaki S4 şıkları tarihsel) · S5 = A (yaklaşık künye, "sonradan türetildi") ·
S6 = A (belge başına tek satır) · S7 = A (tek yeni izin `mobile:is-emri-duzelt`) · S8 = A (metre bazlı) ·
S9 = A (tam liste, arama ve Excel panelde; tablette iş emri detayında son 5 hareketin salt-okunur özeti).
1e kararları: R5 soru adımı ONAYLI (çok partili kabulde tek dokunuşla parti sorulur, varsayılan en eski;
sessiz birleşme her yoldan kalkar) · R6 ONAYLI (sarma aynı iş emrinde canlı numarayı atlar — `parti.md`'ye
ÇEKİRDEK ek, sarmanın kendisi profil; bekçi: aynı iş emrinde iki canlı aynı numara → kırmızı).

**S1 — Tablet düzeltme menüsünde hangi tuşlar olsun?**
- ⭐ **A:** Rengi Değiştir · Eni Değiştir · Sipariş Bağla/Çöz · Refakat Kartını Yeniden Bas · Top Çıkar
  (yanlış okutma)
- B: A + Hedef Metre/Kg
- C: Yalnız Renk ve En

**S2 — Tabletteki bugünkü genel "Düzenle" (renk/en/metre/kat/iş emri no, sebepsiz) ne olsun?**
- ⭐ **A:** Kaldırılsın; alanları tek amaçlı, sebepli tuşlara taşınsın
- B: Kalsın ama iş emri no çıkarılsın ve sebep istensin
- C: Olduğu gibi kalsın

**S3 — Tabletteki "İptal Et" kalsın mı?**
- ⭐ **A:** Yalnız hiç işlem görmemiş iş emrinde kalsın ("yanlış açıldı"); işlem görmüşse "panelden iptal edin"
- B: Tabletten tamamen kalksın (yalnız panel)
- C: Olduğu gibi kalsın

**S4 — "Top Ekle" (açılmış iş emrine sonradan top eklemek)?** Bugünkü kural (2026-06-12): eklenmez, rework
ayrı iş emridir.
- ⭐ **A:** Kural kalsın — yanlış okutma "Top Çıkar" ile düzeltilir, eksik top için yeni iş emri açılır
- B: Dar pencere: iş emri henüz hiç işlem görmediyse ekleme serbest
- C: Serbest ekleme

**S5 — Geçmiş (bu özellikten önce kapanmış) iş emirlerinin kapanış künyesi?**
- ⭐ **A:** Yaklaşık künye yazılsın: metre üretim anından (`initialQty`), diğer alanlar "bugünkü değer"
  etiketiyle, "sonradan türetildi" işaretli
- B: Künye yazılmasın; eski iş emirleri yalnız bugünkü hâli gösterir
- C: Yalnız son 30 günün iş emirleri için A

**S6 — Hareketler ekranında fason/Tambur gibi üretim olayları nasıl görünsün?**
- ⭐ **A:** Belge düzeyinde tek satır ("Fason sevk FS-0042 · 8 top · 412 m ›"), tıklayınca toplar
- B: Her top ayrı satır

**S7 — Tablet düzeltme yetkisi?**
- ⭐ **A:** Tek yeni izin "İş emri düzeltme (tablet)"; açma izninden ayrı
- B: Mevcut "Hızlı İş Emri" izni yeter
- C: Her tuşa ayrı izin

**S8 — Kapanış verimi tanımı onaylanıyor mu?** Giren = iş emrine giren topların giriş metresi; çıkan =
depo + A1 + fire; verim = çıkan ÷ giren; çekme = (giren − çıkan) ÷ giren; fire % ayrı.
- ⭐ **A:** Evet, metre bazlı
- B: Metre + kg ikisi birden (kg yalnız tartılan toplarda)

**S9 — Hareketler tablette de görünsün mü?**
- ⭐ **A:** Şimdilik yalnız panel (tablet detayında son 5 olay özeti, salt-okunur)
- B: Tablette tam liste
- C: Tablette hiç

## 10. YAN BULGULAR (bu belgenin kapsamı dışı, sahip atanmalı)

- order.service `CANCEL_WO` dalı iş emri iptalinde sebep geçirmiyor (`cancelReason` NULL) — D1'de kapanır.
- `defter.md` envanteri `RollPlanDeviation` satırı "damga kolonu bile yok" diyor; şemada `revokedAt` var ve
  `defter-beyan.ts:280-290` borcu 2026-09-13'te kapalı sayıyor — belge bayat (satır :138 ve kural :93).
- `changeWidth` claim'i tx dışında, kart bayat işareti ayrı (L:678/686).
- Tablet `mobil/src/services/workOrder.service.ts:241` yorumu ("online") bayat; mutasyon `networkMode:'always'`.
- Hızlı iş emri `clientToken`ı kesin 4xx'te de yapışıyor (`H/useQuickWorkOrder.ts:162`) — 4xx iş emri
  yaratmadığı için zararsız ama kök kuralın lafzına aykırı.
- Panel "kayıt geçmişi" (`RecordHistoryDialog`) `admin:settings`/`system:activity` ister — planlamacı 403
  alır; Hareketler ekranı (§7) bu ihtiyacı `workorder:read` ile, audit'e uzanmadan karşılar.

## 11. S4 ÖLÇÜMÜ — "aynı iş emrine yeni top = yeni parti" (kullanıcının karşı sorusu, ölçüldü 2026-09-25)

**Kısa cevap:** motor bunu zaten biliyor — `attachRolls` (S:4728) her çağrıda YENİ PARTİ doğurur
(`createBatchTx` S:4925; bekçi `test_batch_multibatch_dispatch.ts:49-50` aynı iş emrine iki dalga = iki parti
ölçüyor). Uç 2026-06-12'de ALAN KARARIYLA değil ÖLÜ UÇ TEMİZLİĞİYLE kalktı ("hiçbir frontend çağırmıyordu",
R:62-65); "rework ayrı emirdir" gerekçesi 2026-08-25'te eklendi. `PARTI-MODELI-TASARIM.md` K3 ("her ekleme
yeni parti") ve K4 ("sevksiz partiye `targetBatchId` ile ekleme", hiç yazılmadı) tam bu isteği öngörüyordu.

**⚠️ Kural bugün zaten üç yan kapıdan deliniyor** (`is-emri.md` "mevcut iş emrine top EKLEME YOK" cümlesi
koda göre YANLIŞ — S4'ün cevabı ne olursa olsun düzeltilmeli):
1. **Fason Sevk otomatik bağlama:** serbest `STOCK` top açık iş emrinin fason adımına bağlanır
   (`subcontractor.service.ts:1022`, :1173-1188) — tek parti varsa ona katılır, yoksa yeni parti.
2. **Tambur "Topu Buraya Al"** (`manualMove`, `rollIds`) → yeni parti; TAMAMLANMIŞ iş emrini de yeniden açar
   (`tambur-manual.service.ts:399-410`, :565).
3. **Tambur "Manuel Top Ekle"** — tek açık partiye katılır / birden çoksa `BATCH_REQUIRED` / yoksa açar (:1166-1178).

**Bugünkü motorla "Parti Ekle" açılsaydı sessizce bozulacaklar:**

| # | Durum | Ölçüm | Gereken düzeltme |
|---|---|---|---|
| R1 | İlk adım FASON (EXTERNAL) | hareket açılmaz, `recomputeStepStatus` çağrılmaz (S:4901, :4936) ⇒ ilk adım COMPLETED kalır, yeni toplar adım hesabında görünmez (aday = hareket şartı, `roll-step.helper.ts:104-107`); eski parti bitince iş emri KAPANIR, yeni parti sevksiz kalır, kapalı iş emrine sevk reddedilir | ilk adım aday kümesi `currentStepId = ilk adım` topları da sayar (giriş sayımı `test_wo_input_attach_window` bu birleşimi zaten kullanıyor) |
| R2 | Sonraki COMPLETED adımlar | yeniden hesaplanmaz, top ulaşana dek bayat COMPLETED (İÇ ilk adımda iş emri yine de kapanmaz — ilk adım ACTIVE) | ekleme sonrası tüm adımlar recompute |
| R3 | Kumaş/renk/özellik kapsaması · hedef metre | yalnız `quickStart`ta (S:1342-1388); `attachRolls` atlar; `targetQuantity` hiçbir yerde uyarmaz | quickStart doğrulaması ortak helper'a; hedef aşımı `warnings` |
| R4 | İdempotency | `attachRolls`ta `clientToken` YOK | uç `clientToken @unique` ile doğar (kayıt yaratan uç kuralı) |
| R5 | Fason K10/K11 (tek sevk = tek parti) | ikinci parti "tümünü gönder"de 409 `MULTI_BATCH`; `MERGE` yeni partiyi en eskiye YUTAR; çok partili makbuzda doğan toplar ilk partiyi alır (`subcontractor.service.ts:3324-3330`) | eklenen partide varsayılan AYRI sevk; birleştirme bilinçli seçim |
| R6 | Parti numarası | `generateBatchNumberTx` (`batch.service.ts:117`) 8022 + `nextSeriesNo("batchShort")` P01…P99 GLOBAL ve körlemesine sarar ⇒ uzun iş emrinde yeni parti canlı eski partiyle AYNI numarayı alabilir (kartta iki P05) | aynı iş emrinde canlı numarayı atlayan sarma (parti.md profil kuralına ek — karar) |
| R7 | Kilit sırası | `attachRolls` tx'inde 8022 kilidi iş emri kilidi + claim'DEN SONRA — "advisory kilit tx'in İLK ifadesi" lafzına aykırı | uçta 8022 ilk ifade |
| R8 | Tamamlanmış iş emri | tx içi kontrol COMPLETED'ı kapsamıyor (S:4801); `completeWorkOrder` kalan adımları SKIPPED yapar ve SKIPPED asla geri açılmaz; COMPLETED kart bayat işaretlenmez (yalnız ACTIVE, `traveler-card-dirty.helper.ts:39`) ⇒ kart açılmazsa tablet okutamaz | tamamlanmışa ekleme = önce `reopenWorkOrderTx` + kart, SONRA parti; SKIPPED adım sorunu ayrı tasarım |

Refakat kartı sorunsuz: kartta top listesi değil "PARTİLER" tablosu var, baskıda canlı çözülür
(`traveler-card.html.ts:419-483`); `createBatchTx` ACTIVE kartı bayat işaretler (`batch.service.ts:283`).
Sipariş bağı: `allocatedQty` top miktarına bağlı değil (tavan yok), kapsama onu okumuyor
(`coverage.helper.ts:9-15`); `committed/inputRolls` hareketten türer ⇒ eklenen parti kendiliğinden sayılır.

**KARAR (2026-09-25): A** — tasarımı §6.5. Aşağıdaki şıklar karar kaydı olarak durur.

**S4 için yeni şıklar (öneri 1e'ye):**
- ⭐ **A — "Parti Ekle" açılsın, yalnız TAMAMLANMAMIŞ iş emrine:** tablet/panel tek tuş, okutulan toplar
  YENİ PARTİ olur; R1–R7 aynı dilimde kapanır; tamamlanmış iş emri için cevap "yeni iş emri aç". Yeni uç
  `POST /work-orders/:id/batches` (`clientToken`, 8022 ilk ifade, quickStart doğrulaması ortak). Hareketler'de
  "Parti P07 eklendi · 5 top · 240 m" — (B) katmanı `Batch` doğuşundan okur.
- B — A + tamamlanmış iş emrine de (yeniden açarak): R8 + SKIPPED adım tasarımı gerekir — büyük iş, sonraya.
- C — Kural kalsın (ekleme yok): üç yan kapı yine de ya kapanmalı ya da kural metni "yalnız bu üç yoldan"
  diye daraltılmalı.

Yan kapıların kaderi (A seçilirse): üçü de aynı ortak ekleme helper'ına bağlanır (tek boğaz — R1–R7 bir
yerde kapanır); seçilmezse `is-emri.md` cümlesi koda hizalanır.

## 12. D1 TASLAĞI — şema · migration · beyan (KOD DEĞİL; D1 açılınca birebir uygulanacak metin)

### 12.1 Prisma

```prisma
/// İş emrinin KENDİ durum/plan değişim defteri (SAP değişiklik belgesi kalıbı). Bir kullanıcı eylemi = bir
/// `groupId`; her değişen alan = bir from→to satırı. APPEND-ONLY: `updatedAt` YOK. Kendi defteri olan olaylar
/// (sipariş bağı, hedef özellik, fason, Tambur) buraya KOPYALANMAZ — Hareketler ucu onları kaynağından okur.
/// Ters yol KARŞI KAYITTIR: geri almak aynı alanı eski değere çeviren YENİ satırdır.
model WorkOrderEvent {
  id          String             @id @default(uuid()) @db.Uuid
  workOrderId String             @db.Uuid
  type        WorkOrderEventType
  /// Tek kullanıcı eylemi (CDHDR karşılığı) — "Düzenle" üç alan değiştirdiyse üç satır, tek grup.
  groupId     String             @db.Uuid
  /// FIELD_CHANGED / STEP_PLAN_CHANGED / ROLL_ATTRIBUTES_APPLIED'de alan anahtarı; STATUS_CHANGED'de "status".
  /// VarChar (enum DEĞİL): alan kümesi büyür, katalog TS sabiti `constants/workorder-event-fields.ts`.
  field       String?            @db.VarChar(40)
  /// Makine değeri (id · sayı · ISO tarih · statü). Doğuşta (CREATED) fromValue null.
  fromValue   String?            @db.VarChar(1000)
  toValue     String?            @db.VarChar(1000)
  /// O ANKİ görünen ad — ad sonradan değişse de satır o günkü gerçeği söyler.
  fromLabel   String?            @db.VarChar(200)
  toLabel     String?            @db.VarChar(200)
  /// Olayı tetikleyen işlem (TAMBUR_FINALIZE · FASON_RECEIPT · TAMBUR_UNDO_SINGLE · MANUAL_COMPLETE …).
  trigger     String?            @db.VarChar(40)
  /// PANEL · TABLET · SYSTEM · BACKFILL — `req.device.kind`ten türer, `clientType`ten DEĞİL.
  /// VarChar + CHECK (enum DEĞİL): kanal kümesi büyüyebilir (API, IMPORT), ALTER TYPE geri alınamaz.
  channel     String             @db.VarChar(16)
  reason      String?            @db.VarChar(300)
  /// `ReasonPreset.code` — FK'sız (emsal `Roll.cancelReasonCode`): kod asla değişmez.
  reasonCode  String?            @db.VarChar(64)
  /// İlgili belge (fason makbuzu · top · kapanış künyesi) — FK'sız tür + id; yalnız gezinme içindir.
  refType     String?            @db.VarChar(40)
  refId       String?            @db.Uuid
  /// Yalnız GÖSTERİM ayrıntısı (etkilenen top id'leri, adım listesi). Buradan SAYI hesaplanmaz.
  payload     Json?
  /// Aktör kolonları FK'SIZ ve index'siz (emsal `SystemLogArchive`): `ON DELETE SET NULL` bir UPDATE'tir ve
  /// tamper trigger'ıyla çarpışır — kullanıcı silen 42 bekçi teardown'ı var (37 ölçtü, 2026-09-25).
  createdById String?            @db.Uuid
  /// İstek bağlamındaki cihaz kimliği (x-device-id; `SystemLog.deviceId` ile aynı değer — UUID değil).
  deviceId    String?            @db.VarChar(128)

  /// ⚠️ `Cascade` BİLİNÇLİ (Cascade FK emsali `ShipmentEvent`; mühür yeni ortak `defter_block_tamper`):
  /// üretim kodu `WorkOrder`ı hiç fiziksel silmez
  /// (ölçüldü: `src`de `workOrder.delete*` 0; "Kalıcı sil" `isActive:false`), `Restrict` yalnız
  /// bekçi temizliklerini kilitlerdi (ölçüldü 2026-09-25: `scripts`te iş emri silen 172 dosya).
  workOrder WorkOrder @relation(fields: [workOrderId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now()) @db.Timestamptz

  @@index([workOrderId, createdAt])
  @@index([type, createdAt])
  @@index([groupId])
  @@map("work_order_events")
}

/// KAPALI küme — tasarım gereği büyümez: yeni statü geçişi STATUS_CHANGED'e, yeni alan FIELD_CHANGED'in
/// `field`ına gider (altıncı enum değeri sınıfından kaçış). Bu yüzden pg enum meşru ([DB-15]).
enum WorkOrderEventType {
  CREATED                 // doğuş — fromValue null
  STATUS_CHANGED          // field="status", from/to WorkOrderStatus; yeniden açılma = COMPLETED→IN_PROGRESS satırı
  FIELD_CHANGED           // field ∈ WORK_ORDER_EVENT_FIELDS
  STEP_PLAN_CHANGED       // field="route" (istasyon sırası, adım yükü yok) | "notes"/"requiredCategoryId"/"plannedSubcontractorId"/"dispatchWithoutColor" (payload.stepId)
  ROLL_ATTRIBUTES_APPLIED // field ∈ {rollColor, rollWidth}; payload.rolls[] top başına eski renk/en
  BATCH_ADDED             // "Parti Ekle" (§6.5) — field="batch", toValue=batchId; DOĞUŞ (ters yol: Top Çıkar)
}
```

`WorkOrder` modeline yalnız ilişki satırı eklenir: `events WorkOrderEvent[]` (kolon değişmez).

### 12.2 Migration (`prisma migrate dev --create-only` çıktısı elle, idempotent)

```sql
-- =============================================================================
-- D1 — İş emri hareket defteri (defter doktrini; docs/design/IS-EMRI-HAREKET-DEFTERI.md)
-- =============================================================================
-- GÜVENLİ / ADDITIVE: bir YENİ tablo + bir YENİ enum tipi + üç CHECK. Mevcut tabloya ve
-- satıra dokunulmaz. Geriye dönük satır ÜRETİLMEZ — geçmiş, ayrı ve kuru-koşumlu
-- `scripts/backfill_workorder_events.ts` ile (kullanıcı kararıyla) doldurulur.
-- ⚠️ Enum YENİ tip (`CREATE TYPE`) — ADD VALUE aynı-tx kısıtı burada geçerli değil.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "WorkOrderEventType" AS ENUM
    ('CREATED', 'STATUS_CHANGED', 'FIELD_CHANGED', 'STEP_PLAN_CHANGED', 'ROLL_ATTRIBUTES_APPLIED', 'BATCH_ADDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "work_order_events" (
  "id"          UUID NOT NULL,
  "workOrderId" UUID NOT NULL,
  "type"        "WorkOrderEventType" NOT NULL,
  "groupId"     UUID NOT NULL,
  "field"       VARCHAR(40),
  "fromValue"   VARCHAR(1000),
  "toValue"     VARCHAR(1000),
  "fromLabel"   VARCHAR(200),
  "toLabel"     VARCHAR(200),
  "trigger"     VARCHAR(40),
  "channel"     VARCHAR(16) NOT NULL,
  "reason"      VARCHAR(300),
  "reasonCode"  VARCHAR(64),
  "refType"     VARCHAR(40),
  "refId"       UUID,
  "payload"     JSONB,
  "createdById" UUID,
  "deviceId"    VARCHAR(128),
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_order_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_order_events_workOrderId_createdAt_idx"
  ON "work_order_events" ("workOrderId", "createdAt");
CREATE INDEX IF NOT EXISTS "work_order_events_type_createdAt_idx"
  ON "work_order_events" ("type", "createdAt");
CREATE INDEX IF NOT EXISTS "work_order_events_groupId_idx"
  ON "work_order_events" ("groupId");

DO $$ BEGIN
  ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_workOrderId_fkey"
    FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DB seddi (şema-dışı → test_db_invariants envanterine AYNI commit'te):
DO $$ BEGIN
  ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_channel_known"
    CHECK ("channel" IN ('PANEL', 'TABLET', 'SYSTEM', 'BACKFILL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_field_required"
    CHECK ("type" = 'CREATED' OR "field" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_birth_has_no_from"
    CHECK ("type" <> 'CREATED' OR "fromValue" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

**Append-only DB mührü — KARAR (1e, 2026-09-25): D1'de, 37'nin ortak fonksiyonuyla.** Cascade FK + tamper
trigger: UPDATE HER ZAMAN reddedilir; DELETE yalnız `pg_trigger_depth() = 0` iken (doğrudan silme)
reddedilir — ebeveynden gelen kaskat silme geçer, bekçi teardown'ları kırılmaz. (ShipmentEvent'te trigger
YOK — yalnız Cascade FK emsalidir.) Fonksiyon `"defter_block_tamper"()` tablodan bağımsızdır ve 37'nin
K-A3 migration'ında doğar; D1 yalnız `CREATE TRIGGER "work_order_events_block_tamper" BEFORE UPDATE OR
DELETE ON "work_order_events" FOR EACH ROW EXECUTE FUNCTION "defter_block_tamper"()` yazar — fonksiyon
YENİDEN TANIMLANMAZ; migration zaman damgası 37'ninkinden SONRA. Aynı trigger kapanış künyesi
tablolarına (D3) da takılır. D1, 37'nin fonksiyonu indikten sonra uygulanır (sıra bağımlılığı).

### 12.3 Beyanlar (aynı commit)

`scripts/lib/defter-beyan.ts`:

```ts
D("WorkOrderEvent", "iş emrinin KENDİ durum/plan değişim defteri (SAP değişiklik belgesi kalıbı): bir eylem = bir groupId, her alan = bir from→to satırı; kendi defteri olan olaylar (bağ, özellik, fason, Tambur) KOPYALANMAZ, Hareketler ucunda kaynaklarından okunur. Ters yol karşı kayıttır — geri almak aynı alanı eski değere çeviren YENİ satırdır, damga değil",
  { tur: "KARSI_KAYIT", ciftler: [["fromValue", "toValue"]], enumAdi: "WorkOrderEventType",
    kendiTersi: ["STATUS_CHANGED", "FIELD_CHANGED", "STEP_PLAN_CHANGED", "ROLL_ATTRIBUTES_APPLIED"] },
  [{ dosya: "src/services/helpers/workorder-event.helper.ts", sembol: "claimWorkOrderStatusTx" }],
  ["src/services/helpers/workorder-event.helper.ts"]),
```

- §3k2 yeşil doğar: ters yazan = ileri yazan (tek dosya, tek sembol). §5 yazar kümesi = yalnız helper
  dosyası — satırı başka bir dosya `create` ederse kırmızı (tek yazar kuralının kapısı).
- **Kapı eki — KARAR (1e, 2026-09-25): D1'de, 9f yazar, iki sondayla.** KARŞI KAYIT mekanizması enum
  TAŞIMADIĞI için §3e `WorkOrderEventType`i TARAMAZ; `CREATED`i çift-dışı yazmak da §3e4'te "mekanizmasız
  enum" kırmızısı verir. Ek: `KARSI_KAYIT`e isteğe bağlı `enumAdi` + `kendiTersi: string[]` (karşı kaydı
  AYNI tip olan değerler); §3e bu enum'u da tarar — her değer `kendiTersi`nde ya da çift-dışı listede.
  Beyan: `kendiTersi: ["STATUS_CHANGED", "FIELD_CHANGED", "STEP_PLAN_CHANGED", "ROLL_ATTRIBUTES_APPLIED"]`;
  çift-dışı: `CREATED` → DOGUS (iş emrinin doğuşu), `BATCH_ADDED` → DOGUS (partinin doğuşu; ters yol Top
  Çıkar, top defterlerinde). Sondalar: (1) enum'a beyansız değer eklenince §3e kırmızı · (2) değer
  `kendiTersi`ne yazılınca yeşile döner — ikisi saf fonksiyon üzerinde her koşumda.

`scripts/lib/audit-muafiyeti.ts`:

```ts
{ model: "WorkOrderEvent", sinif: "EBEVEYN_EYLEMDE",
  gerekce: "iş emri hareket satırını `helpers/workorder-event.helper` yazar; audit değişikliği yapan eylemde (workorder · workorder-link · roll-step helper'ı · tambur · fason · kurşun)" },
```

`scripts/test_db_invariants.ts`: CHECK listesine üç satır (`work_order_events_channel_known` ·
`_field_required` · `_birth_has_no_from`) + trigger listesine `work_order_events_block_tamper` (fonksiyon satırı
37'nin diliminde — tekrar yazılmaz).

`docs/kurallar/defter.md` envanter tablosuna satır: `WorkOrderEvent` · iş emrinin durum/plan değişimi ·
✅ (`updatedAt` yok) · ✅ KARŞI KAYIT (yazan tek dosya `workorder-event.helper.ts`).

### 12.4 D1'in kod kapsamı (sıra)

1. Şema + migration + `prisma generate` + dört beyan (yukarıda) + tamper trigger (37'nin ortak fonksiyonu) +
   `test_defter_ters_yol` KARŞI KAYIT `enumAdi`/`kendiTersi` eki (iki sonda).
2. `helpers/workorder-event.helper.ts`: `claimWorkOrderStatusTx` · `reopenWorkOrderTx` · `createWorkOrderTx` (iş emrini ve CREATED satırını aynı tx'te doğuran tek yol) ·
   `recordWorkOrderFieldChangesTx` (§4.3).
3. Durum boğazları: `ensureWorkOrderInProgress` · `completeWorkOrderIfStepsDone` (+ `ctx`, 10 çağıran) ·
   `completeWorkOrder` · `softDelete` · order.service `CANCEL_WO` (sebep geçer) · split SUPERSEDED · arşiv ·
   `lockWorkOrder` · YENİ `reopenWorkOrderTx` (yedi yol ona taşınır) · `create`/`quickStart` → `CREATED`.
4. Bekçiler: `test_workorder_event_ledger` (her boğaz satır yazar; negatif sonda: bir boğazda yazıcı
   susturulunca kırmızı) · `test_workorder_event_yazar` (AST cırcırı, iki sonda: ihlal → taban ARTAR,
   düzeltme → taban DÜŞER) · mevcut `test_defter_ters_yol` · `test_audit_muafiyeti` · `test_db_invariants` ·
   `test_schema_drift` · `test_timestamptz_contract` · `test_migration_hygiene` · kapanışa dokunan mevcut
   aile (`test_wo_terminal_guard` · `test_wo_terminal_race` · `test_tambur_undo` · `test_wo_manual_complete` ·
   `test_finalize_last_step` · `test_manual_move_field_continuity` · `test_p2_kk2reopen`).
5. Alan değişiklikleri (FIELD_CHANGED) D2'ye kalır — D1 yalnız durum.
