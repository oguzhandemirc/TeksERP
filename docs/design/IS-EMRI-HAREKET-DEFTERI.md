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
> **Durum:** KARAR BELGESİ (Faz 0). K1 (tablet boş alan uyarısı) dışında kod yok; §9'daki sorular
> cevaplanmadan dilim açılmaz. Backend dilimleri 9b'nin S2+S3'ü (workorder.service create/update/replace/
> quickStart) indikten SONRA başlar.

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
- **İş emri numarası yeniden yazılır** — gövdedeki `batchNumber` `workOrderNumber`a gider (S:5944), form
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
⇒ `AUDIT_EXEMPT_MODELS`te `EBEVEYN_EYLEMDE` sınıfı (`ShipmentEvent` emsali).

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

Yeni helper `services/helpers/workorder-event.helper.ts`: `writeWorkOrderEventsTx(tx, events[])` ve
`diffWorkOrderFieldsTx(before, after, ctx)` (alan kataloğundan satır üretir, etiketleri tx içinde çözer).
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

## 5. (c) KAPANIŞ KÜNYESİ

### 5.1 Şema (yalnız EKLER)

**`WorkOrderCloseSnapshot`** (başlık): `id · workOrderId (FK Restrict) · version (1..n) · closedAt ·
closedById? · closeKind (AUTO_LAST_STEP | MANUAL) · trigger · rollCount · warehouseM · a1M · scrapM ·
totalKg · inputRollCount · inputM · yieldPct · shrinkagePct · scrapPct · durationSec · supersededAt? ·
supersededByEventId? · createdAt`. Tekillik: `(workOrderId, version)` ve PARTIAL `(workOrderId) WHERE
supersededAt IS NULL` (canlı künye tek).

**`WorkOrderCloseSnapshotLine`** (kalem, append-only): `snapshotId · rollId (FK) · barcode · qtyM · weightKg
· width · colorId · colorLabel · qualityGrade · qualityLabel · bucket (WAREHOUSE|A1|SCRAP) · batchId ·
batchLabel · status · foldType · itemLabel · createdAt`.

Sınıf: kalem SATIR olarak donar (`Manifest.snapshot` emsali, `snapshot-kolonlari.ts` `MUAF/BELGE_DEFTERI`
"kolon değil satır donar"); başlık `supersededAt` DAMGASI taşır (`defter-beyan.ts` `DAMGA`, `yari`).

### 5.2 Ne zaman yazılır

- COMPLETED geçişiyle **aynı tx'te**: `completeWorkOrderIfStepsDone` (otomatik) ve `completeWorkOrder`
  (elle). Küme TEK KAYNAK `producedOutputWhere` — künye ile canlı başlık aynı soruyu sorar.
- Yeniden açılma (`reopenWorkOrderTx`) canlı künyeyi **silmez, değiştirmez**: `supersededAt` +
  `supersededByEventId` damgası. Sonraki kapanış `version = n+1` yazar; eski sürümler okunabilir kalır.
- İptal edilen iş emri künye YAZMAZ (üretim çıktısı kapanışı değil).

### 5.3 Toplamlar (verim/fire)

- **Giren ham metre** = iş emrine giren her topun EN ERKEN aktif `RollMovement.qtyIn`i (giriş noktası
  kuralıyla aynı tanım; `qtyIn` yerinde değiştirilmiyor — ölçüldü, yalnız `qtyOut` null'lanıyor, §8.5).
- **Çıkan** = depo + A1 + fire metresi (künye kalemlerinden).
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
| (yeni) **Top Çıkar** | **KONUR — yeni backend** | yanlış okutma; bugün uç yok (`detachRolls` S:6364 ölü kod, defter yazmıyor) |
| (yeni) Top Ekle | **Soru S4** — öneri KONMAZ | `is-emri.md`: "mevcut iş emrine top EKLEME YOK (2026-06-12), rework ayrı emirdir" |
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

### 6.3 Genel "Düzenle" ve iş emri numarası — öneri

- **Numara doğuşta donar, hiçbir uçtan yazılamaz.** `update` ve `replace` şemalarından `batchNumber`
  kalkar. Eski istemci uyumu: gövdede numara gelirse ve mevcutla AYNIYSA sessizce kabul (panel formu bugün
  mevcut değeri geri gönderiyor), FARKLIYSA 409 "İş emri numarası değiştirilemez". Panel formunda alan
  salt-okunur olur.
- **Başlamış (IN_PROGRESS) iş emrinde genel Düzenle yalnız yıkıcı olmayan alanlarla sınırlanır:** plan
  tarihleri · hedef metre/kg · notlar. Renk, en, rota, kumaş, sipariş → tek amaçlı tuşlar (bugün panelde
  zaten var). PLANNED (hiç top almamış) iş emrinde tam `replace` kalır.
- `replace` renk değiştiriyorsa `assertTargetColorChange`den geçer (bugün atlıyor).
- Bayat yorumlar (`E/service.ts:213`, controller :292/:607) koda hizalanır.

### 6.4 İzinler (reçete: katalog koda, atama panele; migration YOK)

Öneri (S7): tek yeni kod **`mobile:is-emri-duzelt`** ("İş emri düzeltme — tablet"). Gerekçe: "iş emri açabilen"
ile "açılmış iş emrini değiştirebilen" ayrı sorumluluktur; bugün `mobile:hizli-is-emri` PATCH `/:id` ile
her ikisini birden veriyor. Tuşların uçları bu kodu `requireAnyPermission(... "workorder:write")` ile kabul
eder; SoD üçlüsü değişmez. Uyumsuz sipariş bağı (`order-links/override`) tablete GELMEZ.

## 7. (e) HAREKETLER EKRANI

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
| D2 | Alan değişiklikleri → `FIELD_CHANGED` (update/replace/renk/en/adım/toplara uygula/tip) + numara kilidi (§6.3) | D1 |
| D3 | Kapanış künyesi (şema + yazım + ProducedV3 karşılaştırma) | D1 |
| D4 | Hareketler ucu (A+B) + panel Sheet + ayrı ekran + Excel | D1 (D2 ile zenginleşir) |
| D5 | Tablet düzeltme menüsü + `mobile:is-emri-duzelt` + önizleme uçları | D2, S1–S3/S7 cevapları |
| D6 | Top Çıkar ucu (ledger ters yollarıyla) + tablet tuşu | D1, S4 |
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

## 9. (g) KULLANICIYA SORULAR — her biri şıklı, ⭐ önerilen

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
- Kök `CLAUDE.md` advisory envanteri 8032'de bitiyor; kodda 8033 · 8034 · 8035 var
  (`helpers/period-guard.helper.ts:46-60`).
- `changeWidth` claim'i tx dışında, kart bayat işareti ayrı (L:678/686).
- Tablet `mobil/src/services/workOrder.service.ts:241` yorumu ("online") bayat; mutasyon `networkMode:'always'`.
- Hızlı iş emri `clientToken`ı kesin 4xx'te de yapışıyor (`H/useQuickWorkOrder.ts:162`) — 4xx iş emri
  yaratmadığı için zararsız ama kök kuralın lafzına aykırı.
- Panel "kayıt geçmişi" (`RecordHistoryDialog`) `admin:settings`/`system:activity` ister — planlamacı 403
  alır; Hareketler ekranı (§7) bu ihtiyacı `workorder:read` ile, audit'e uzanmadan karşılar.
