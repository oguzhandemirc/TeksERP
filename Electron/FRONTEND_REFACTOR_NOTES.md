# Frontend Refactor Notları — Electron + Mobile

> **Bu doküman ortak.** Electron yönetim paneli ve Mobile (Expo, operatör tablet) — backend değişiklikleri her iki uygulamayı da etkiliyor. Konum şu an `Electron/`'da olsa da içeriğin bir kısmı mobil tarafa aittir; mobil oturumda bu dosyayı oradan da takip et.

> Backend tarafında **Item kimliği sadeleşti, Variant kaldırıldı, Color/Property allowed-list pattern'ine geçti**, ardından **WO düzenleme kilitleri açıldı** ve **per-action undo ailesi eklendi**. Backend tamamlandı; frontend'in iki uygulamada da güncellenmesi gerekiyor.

## Tag rehberi — değişiklikler iki uygulamayı etkiliyor

Her bölüm/madde başında etiket var:

| Tag | Hedef uygulama | Tipik kullanıcı |
|---|---|---|
| **[E]** | Electron — yönetim/admin paneli (`/Users/oad/Documents/AdnanSahin/Electron/`) | Planlamacı, satış, admin |
| **[M]** | Mobile — operatör tablet (Expo, ayrı proje) | Sahada operatör (KK1, Kurşun, Tambur, Fason, Paket, Sevk) |
| **[E+M]** | Her ikisi | İkisinde de farklı kullanım |

Backend permission ailesi de bu ayrımı yansıtır: `mobile:*` mobil, diğerleri web/admin (Electron).

## Bağlam — Backend'de Ne Değişti?

### Schema değişiklikleri
| Alan/Model | Eski | Yeni |
|---|---|---|
| `Item.isDerived`, `baseItemId`, `colorId` | Vardı (kimlik = base+color) | **Silindi** — Item tek kayıt: "Patos" |
| `Item.derivatives`, `Item.baseItem` self-relation | Vardı | **Silindi** |
| `ItemType` enum | `RAW_FABRIC`, `DYED_FABRIC`, `YARN`, `WARP`, `CONSUMABLE` | `FABRIC`, `YARN`, `WARP`, `CONSUMABLE` (ham/işlenmiş ayrımı kalktı) |
| `ItemVariant` modeli | Vardı (`/items/:itemId/variants` route) | **Komple silindi** |
| `CustomerVariantAlias` modeli | Vardı | **Komple silindi** |
| `Roll.variantId`, `OrderLine.variantId`, `Swatch.variantId` | Vardı | **Silindi** |
| `WorkOrder.recipeNo` | Vardı | **Silindi** |
| `ItemProperty` (M:N) | İsim | **Yeniden adlandırıldı:** `ItemAllowedProperty` |
| `ItemAllowedColor` (M:N) | Yoktu | **Yeni** — Item ↔ Color allowed list (boş = serbest) |
| `OrderLine.colorId` | Yoktu | **Yeni** — nullable FK Color |
| `WorkOrder.targetColorId` | Yoktu | **Yeni** — nullable FK Color |
| `Roll.colorId` | Item.colorId üzerinden derive | **Yeni** — nullable FK Color, doğrudan Roll'da |
| `SubcontractorCategory.appliesColor` | Yoktu | **Yeni** — Boolean. true ise bu kategorideki fason kabul rengin/özelliklerin kopyalandığı adımdır |

### Akış değişiklikleri
1. **Ürün kataloğu**: Tek "Patos" kaydı. Kullanıcı ürün açarken artık "ham mı/final mi" seçmiyor. Sadece kod, isim, tip (FABRIC/YARN/...), birim, izin verilen renkler (allowedColors), izin verilen özellikler (allowedProperties).
2. **Sipariş**: `OrderLine` satırında `itemId` (Patos) + `colorId` (Mavi, opsiyonel) + properties (allowed list'ten).
3. **İş emri**: ORDER_PRODUCTION'da `targetItemId` + `targetColorId` + `targetProperties` orderLine'dan **otomatik** çekilir. STOCK_PRODUCTION'da manuel.
4. **Fason Kabul**: Eğer adımın `requiredCategory.appliesColor === true` ise, kabul edilen rulonun `colorId` ve özellikleri WO'dan kopyalanır.
5. **Tambur**: Artık renk/özellik kopyalamıyor. Sadece bölme + WAREHOUSE'a aktarma. (Eğer Fason Kabul'da renk uygulanmadıysa Tambur "ham bitmiş ürün" uyarısı verir, operatör onaylarsa devam.)
6. **Depo (Inventory)**: Filter `?processingStatus=raw|processed|finished`. Türev:
   - `raw` = `colorId IS NULL`
   - `processed` = `colorId IS NOT NULL && status NOT IN (WAREHOUSE, READY_FOR_SHIP)`
   - `finished` = `status IN (WAREHOUSE, READY_FOR_SHIP)`

---

## Etkilenen Frontend Dosyaları

### **[E]** Items sayfası — `src/pages/Items/`
- **`ItemFormDialog.tsx`**: Ham/Final radio kalkacak, `baseItemId` + `colorId` alanları kalkacak. `allowedColorIds` (multi-select Color) ve `allowedPropertyIds` (multi-select FabricProperty) eklenecek. `isDerived` yok. `itemType` enum'undan `RAW_FABRIC/DYED_FABRIC` → tek `FABRIC`.
- **`columns.tsx`**: "Ham/Final" kolonu kaldırılacak. "Temel Ürün" kolonu kaldırılacak. Bunun yerine "İzinli Renkler" ve "İzinli Özellikler" özet kolonu eklenebilir.
- **`schema.ts`**: Zod şeması güncellensin — `baseItemId/colorId/isDerived` çıkar, `allowedColorIds/allowedPropertyIds` ekle.
- **`types.ts`**: Item tipinden `baseItemId/colorId/isDerived/baseItem/color/derivatives` çıkar. `allowedColors` (M:N include) ekle.
- **`ItemsPage.tsx`**: Filter UI'da "Sadece Final" toggle'ını kaldır.

### **[E]** Variants — KOMPLE SİLİNECEK
- `src/pages/Items/Variants/` klasörü (varsa) silinecek
- Items detay tab/sayfasında variant tab'ı kaldırılacak
- `src/pages/Operations/CustomerVariantAliases/` (varsa) komple silinecek

### **[E]** Orders — `src/pages/Operations/Orders/`
- **`OrderLinesEditor.tsx`**:
  - `variantId` field kaldır
  - `colorId` field ekle — Item seçildikten sonra `item.allowedColors` listesinden veya boşsa tüm aktif Color listesinden picker
  - `requiredProperties` Item'a göre filtrelenecek (`item.allowedProperties` veya hepsi)
- **`LineRequiredPropertiesEditor.tsx`**: Item context'i ile birlikte allowed list'ten seçim
- **`types.ts`**: OrderLine tipine `colorId` ekle, `variantId` çıkar

### **[E]** WorkOrders — `src/pages/Operations/WorkOrders/`
- **`TargetItemFields.tsx`**:
  - `targetItemId` picker → artık base Item (Patos) seçer
  - **Yeni:** `targetColorId` picker — Item seçildikten sonra allowed list'ten
  - `targetProperties` zaten vardı, allowed list ile filtrele
  - ORDER_PRODUCTION'da bu üçü disabled + auto-pull
- **`WorkOrderFormDialog.tsx`**: `recipeNo` field'ı kaldır
- **`workOrderPrefill.ts`**: orderLine'dan `colorId` ve properties auto-pull mantığı eklensin
- **`schema.ts`**, **`types.ts`**: `recipeNo` çıkar, `targetColorId` ekle
- **`TravelerCardPrintDialog.tsx`**: Refakat kartı baskısında "Renk: Mavi" göster
- **`WOTargetPropertiesEditDialog.tsx`**: Allowed list filter
- **`WorkOrderDetailSheet.tsx`**: variantId referanslarını çıkar, color göster

### **[E+M]** Rolls — `src/pages/Operations/Rolls/`

> Electron'da yönetim listesi (filter + tablo). Mobile tarafta operatör tabletinde rolün barkod tarama sonrası özet ekranı; aynı `Roll.color/properties` alanları gösterilir. Tip değişikliği her iki proje için geçerli.
- **`columns.tsx`**:
  - "Varyant" kolonu kaldırılacak
  - "Renk" kolonu eklenecek (`roll.color?.name ?? '—'`)
  - "Özellikler" kolonu (`roll.properties.map(p => p.property.name).join(', ')`)
  - "Tip" kolonu — derived: renk boş → "Ham", dolu + status<WAREHOUSE → "İşleniyor", status≥WAREHOUSE → "Bitmiş"
- **`RollsTable.tsx`**: Filter UI'da `processingStatus` tab/select (Hepsi/Ham/İşleniyor/Bitmiş)
- **`types.ts`**: Roll tipine `colorId`, `color`, `properties` ekle; `variantId`, `variant` çıkar
- **`swatchService.ts`**: variantId paramı varsa kaldır

### **[E]** Ortak komponentler
- **`components/forms/ReferenceSelect.tsx`**: Variant referansı varsa kaldır. `Color` ve `FabricProperty` zaten ref olarak kullanılıyor olmalı.
- **`components/data-table/FilterBar.tsx`**: `isDerived` filter alanı kaldırılacak. `processingStatus` filter eklenecek.

### **[E+M]** API client tipleri
- Backend'in Swagger şemasına göre tüm `*.types.ts` dosyaları senkronize edilmeli (özellikle Item, Order, OrderLine, WorkOrder, Roll, Swatch).

---

## Migration Sırası (Frontend)
1. Önce shared `types.ts` dosyaları güncelle (compile error rehberi olur)
2. Items sayfasını sil/temizle (variant alt sayfaları, derived form alanları)
3. Orders sayfası: colorId picker ekle, variant çıkar
4. WorkOrders: targetColorId, recipeNo temizliği, auto-pull
5. Rolls: yeni kolonlar + filter
6. CustomerVariantAlias sayfası komple sil
7. Smoke test: planlama → sipariş → WO → fason sevk → fason kabul → tambur → depo

---

## Test Senaryosu (E2E doğrulama)
1. Patos ürünü yarat — allowedColors: [Mavi, Kırmızı], allowedProperties: [Yanmaz, Su Geçirmez]
2. Sipariş aç — Patos + Mavi + Yanmaz, 500m
3. WO aç — orderLine'a bağla, targetColor/Property otomatik gelsin
4. KK1 girişi — yeni Roll, depoda **Ham** olarak görünsün
5. Fason Sevk → Fason Kabul (Boyahane kategorisi, appliesColor=true) — Roll.colorId=Mavi, RollProperty=[Yanmaz] otomatik kopyalansın, depoda **İşleniyor** olarak görünsün
6. Tambur finalize — Roll WAREHOUSE'a düşsün, depoda **Bitmiş** olarak görünsün
7. Tartı/paket → Sevkiyat — Mavi Patos müşteriye ulaşsın

---

## Notlar
- Mevcut DB tamamen reset edilecek (test verisi, migration baseline yeniden). Frontend'in geriye dönük uyumluluk endişesi yok.
- Backend tamamlandığında bu doküman güncellenecek; özellikle yeni endpoint URL'leri ve request/response şemaları için Swagger UI (`http://localhost:4000/api-docs`) referans alınmalı.

---

# İkinci Refactor — WO Düzenleme Kilitleri Açıldı (2026-05-15)

## Bağlam — Backend'de Ne Değişti?

İş emri her statüde (`PLANNED`/`IN_PROGRESS`) düzenlenebilir hâle geldi. Sadece `COMPLETED` ve `CANCELLED` kilitli. Sebep: planlamacı boyahaneye telefonla "rengi değiştirin" diyebiliyor — sistem bu değişikliği WO'da yansıtabilmeli, gelen rulolar yeni renkle stoğa düşmeli. Mevcut `Fason Kabul → WO.targetColorId` zinciri bunu otomatik halleder; **backend hiçbir cascade/propagation yapmaz**, sadece statü kilitleri kalktı.

### Endpoint davranış değişiklikleri

| Endpoint | Eski | Yeni |
|---|---|---|
| `PATCH /api/workorders/:id` (`update`) | PLANNED only | **PLANNED + IN_PROGRESS serbest** — `batchNumber`, `width`, `targetQuantity`, `plannedDates`, `targetItemId`, `targetColorId` |
| `PUT /api/workorders/:id` (`replace`) | PLANNED + sıfır rulo | **PLANNED + IN_PROGRESS serbest** — smart merge ile bağlı rulolu durumda da çalışır |
| `POST /api/workorders/:id/attach-rolls` | PLANNED only | **PLANNED + IN_PROGRESS serbest** |
| `POST /api/workorders/:id/detach-rolls` | PLANNED only | **PLANNED + IN_PROGRESS serbest** |
| `PATCH /api/workorders/:id/steps/:stepId` (`updateStepPlanning`) | step PENDING only | **Her step durumunda serbest** |

### `replace` smart-merge protokolü (önemli)

`PUT /api/workorders/:id` artık **drop-and-recreate değil, smart merge**. Frontend gönderdiği `steps[]` array'inde her item'a opsiyonel `id` koyabilir:

- **`steps[i].id` mevcut bir step'i işaret ediyorsa** → o step **güncellenir** (stationId, sequence, notes, requiredCategoryId, plannedSubcontractorId).
- **`steps[i].id` yoksa** → **yeni step eklenir**.
- **Eski listede olup yeni listede yoksa**:
  - `status='PENDING'` + bağlı kayıt yoksa → **silinir**
  - Aksi halde → backend **`409 Conflict`** döner: "Adım N silinemez — durum X" veya "bağlı kayıtlar var".

`orderLinks` ve `targetProperties` halen drop-and-recreate. **`OrderAllocation` (Roll→OrderLine fulfillment) ayrı katman, bu çağrıdan etkilenmez.**

## Frontend'de Yapılması Gerekenler

> **Bu refactor tamamen [E] Electron tarafıdır.** WO düzenleme planlamacının yetkisinde; mobil operatörler WO meta'sını değiştirmez.

### **[E]** WorkOrders sayfası — `src/pages/Operations/WorkOrders/`

#### 1. Edit/replace formu artık IN_PROGRESS WO'larda da açılabilir
- **`WorkOrdersPage.tsx`** veya satır aksiyonları: "Düzenle" butonu artık sadece `PLANNED` için değil; `PLANNED` ve `IN_PROGRESS` için açık olmalı. `COMPLETED` / `CANCELLED` için pasif.
- **`WorkOrderFormDialog.tsx`** veya replace dialog'u: aynı koşul.

#### 2. `steps[]` array'ine `id` field'ı ekle (smart-merge için kritik)
- **`schema.ts`**: `stepSchema` veya benzer Zod tanımına `id: z.string().uuid().optional()` ekle.
- **`types.ts`**: WO step tipinde `id?: string` (server'dan gelen mevcut step'ler için zaten dolu olur).
- **`WorkOrderFormDialog.tsx`** form state: kullanıcı mevcut bir adımı düzenlerken `id` form state'inde korunmalı; yeni adım eklediğinde `id` undefined kalır. **Eğer `id`'yi formda kaybedersen, backend o step'i "silinmiş" sayar** (PENDING + bağlısızsa siler, değilse 409 atar).

#### 3. Step silmeye onay modalı
- "Silmek istediğin adım: status=`X`" gösterimi. Backend 409 dönerse mesaj göster: *"Bu adım silinemez — başlamış veya bağlı kayıt var. Önce bağlı işlemleri tamamla."*

#### 4. IN_PROGRESS WO için "değişiklik etkisi" uyarı modalı
Planlamacı `targetColorId`'yi mid-flight değiştirirse:
- **Backend hiç bir şey yapmaz** — sadece WO meta'sını günceller.
- **Frontend** GET `/api/workorders/:id` ile mevcut bağlı rulolarına bak:
  - `colorId IS NULL` olanlar → **yeni rengi otomatik alacak** (Fason Kabul'de)
  - `colorId IS NOT NULL` olanlar → **fiziksel olarak eski rengi taşıyor, sistem de eski renk kalır** (gerçeği yansıtır)
- Modal mesajı: *"Bu değişiklik henüz boyahaneden geçmemiş N rulo için geçerli olacak. Zaten boyalı M rulo eski rengiyle (X) kalır. Devam?"*

Bu sayım için yeni endpoint istemiyoruz — `GET /api/workorders/:id` zaten orderLinks + steps + (gelecekte) bağlı rulo özetini döner. Frontend bağlı rulo listesini ayrıca `?workOrderId=<id>` ile inventory endpoint'inden çekip filtreleyebilir.

#### 5. Status badge / aksiyon UX
- IN_PROGRESS WO için "Düzenle" butonu yanına ⚠️ ikonu: tooltip *"Üretim devam ediyor — değişiklik bağlı rulolara yansıyabilir"*.
- COMPLETED / CANCELLED satırlarda butonlar disabled (mevcut davranış kalır).

### **[E]** Stations / Routes — etki yok
Smart-merge backend tarafında; rota şablonu yönetimi değişmedi.

### **[E]** Sipariş bağı değişikliği
- `replace` ile `orderLineAllocations` array'i güncellenir. Frontend'in artık IN_PROGRESS'te de "WO'ya bağlı sipariş ekle/çıkar" yapabilmesi gerekir.
- Çıkardığın siparişin daha önce `OrderAllocation` ile rulolara bağlı olup olmadığını backend kontrol etmiyor — fulfillment ayrı. Frontend istersen "bu sipariş satırına şu rulolar tahsis edilmiş, çıkarmak istediğine emin misin?" uyarısı göster (read-only bilgi, backend zorlamıyor).

## Test Senaryosu (yeni davranış)

1. Patos/Mavi/Yanmaz siparişi → WO açıldı → boyahaneye sevk edildi (rulolar `AT_SUBCONTRACTOR`, `colorId=null`).
2. Frontend WO'yu aç, "Düzenle" → `targetColorId`'yi Kırmızı yap → kaydet.
3. Frontend uyarı: *"4 rulo henüz boyahaneden gelmedi, Kırmızı olarak gelecekler. Devam?"* → onayla.
4. Backend WO'yu update eder, başka hiçbir şey yapmaz.
5. Boyahane fiziksel olarak Kırmızı boyar → `POST /api/subcontractor/receive`.
6. Fason Kabul akışı `WO.targetColorId=Kırmızı` okur → `Roll.colorId=Kırmızı`, `RollProperty=Yanmaz` set eder.
7. Tambur'dan Kırmızı çıkar, depoda Kırmızı görünür.

## Notlar
- API contract değişmedi (sadece `steps[]` itemına opsiyonel `id` eklendi). Mevcut frontend istekleri kırılmaz; yeni alan opsiyonel.
- `id` göndermeyen istekler eski drop-and-recreate gibi davranmaz — backend o step'i "silinecek" varsayar. Yani **mevcut frontend replace çağrılarını güncellemeden bırakırsan, IN_PROGRESS WO'da bağlı step'leri silmeye çalışıp 409 alabilir.** Frontend güncellemesi şart.

---

# Üçüncü Refactor — Per-Action Undo Ailesi (2026-05-15)

## Bağlam — Backend'de Ne Değişti?

İş emrindeki adımları geri alma yeteneği genişletildi. **Multi-batch fason senaryosu** için (örn. 3 müşterinin tek WO'sunun rulları boyahaneden farklı zamanlarda parça parça geliyor): step-level reopen yerine **per-action undo** yaklaşımına geçildi. Her geri alma sadece kendi etkilediği rulları/operasyonu döndürür; diğer parti/rul bekleyen işlemler dokunulmaz.

### Yeni endpoint'ler

| Endpoint | Kullanım |
|---|---|
| `POST /api/subcontractor/receipts/:id/cancel` | **Fason kabul iptal** — kabul yanlış girilmiş, sadece bu kabuldeki rulalar AT_SUBCONTRACTOR'a döner |
| `POST /api/production/undo-step-finish` | **Internal step finish geri al** — KK1 ve diğer internal istasyonlar için per-rulo finish geri alma |
| `POST /api/kursun-qc/undo-qc2` | (zaten vardı, hatırlatma) Operatör QC2 işaretini geri alır |
| `POST /api/kursun-qc/undo-kursun` | (zaten vardı) Kurşun işaretini geri alır (QC2 sonrası kapalı) |

### Schema değişikliği
`SubcontractorReceipt`'e soft-cancel alanları eklendi:
- `cancelledAt` (DateTime?)
- `cancelledById` (FK User?)
- `cancelReason` (String?)

Migration: `20260514222227_receipt_soft_cancel` — otomatik uygulandı.

### Ortak kural — "geri alabilir miyiz?" kontrolü

Backend her undo'da aynı kontrolü yapar (`canRollGoBackFromStep` helper). Sonraki adımda bu rulo için herhangi bir iz varsa geri alma REDDEDİLİR:
- Sonraki step'te kapalı `RollMovement` (ileride finish basılmış) → 409
- Sonraki step'te `RollOperation` (Kurşun/QC2/Tambur kararı) → 409
- Sonraki step için aktif `SubcontractorDispatch` (fason'a gönderilmiş) → 409

Kullanıcıya net mesaj döner: *"Sonraki adımda işlem yapılmış (KURSUN_APPLIED) — önce o işlemi geri al"* gibi. Bu mesajı UI'da göster, kademeli undo akışı kurarsın.

## Frontend'de Yapılması Gerekenler

> **Bu refactor hem [M] Mobile hem [E] Electron'u etkiliyor.** Operatör sahada tablet'ten geri alma yapar; planlamacı Electron'da denetim/onay görür. Aşağıdaki her madde başında uygulama belirtildi.

### **[M]** 1. Fason Kabul iptal — operatör tablet ekranında
- **Konum:** Mobile'da fason kabul detay/liste ekranı (operatör fason mal kabul tabletinde işliyor).
- **Buton koşulu:** `cancelledAt === null` ise göster.
- **Onay modalı:** "Bu kabul iptal edilecek. <N> rulo boyahaneye geri dönecek, renk/özellik bilgisi silinecek (varsa). Sebep yazın:" + textarea (min 3 karakter zorunlu).
- **POST body:** `{ "reason": "operatör yanlış receipt seçti" }`
- **409 hata gösterimi:** Backend mesajını ("Top X: Sonraki adımda işlem yapılmış (KURSUN_APPLIED)") doğrudan göster.

### **[E]** 1.b. Fason Kabul iptal — Electron yönetim panelinde
- Aynı endpoint, Electron'da **yönetici denetim için** açılabilir. Örn. operatör erişemediği bir kabulü admin geri alır.
- **Konum: `src/pages/Operations/Subcontractor/ReceiptDetail.tsx`** veya benzeri.
- Liste ekranında iptal edilmiş kabuller kırmızı satır + `cancelReason` tooltip ile gösterilsin (admin tarihçeyi görsün).

### **[M]** 2. Production undo-step-finish — operatör tablet ekranı
- **Konum:** Mobile tablet'in step-info ekranında, finish basılmış rulo görüntülendiğinde "Geri Al" butonu.
- **Koşul:** `closedMovement` var (yani finish basılmış) ve operatör bu istasyondaysa.
- **Buton:** "Geri Al" — onay sorusu: *"<barkod> rulosunu <istasyon adı> adımına geri çekmek istediğine emin misin?"*
- **POST body:** `{ "rollId": "<uuid>", "stepId": "<uuid>" }`
- **EXTERNAL/TAMBUR adımları için butonu gösterme** — backend zaten 400 dönecek ama UX iyiliği için disabled bırak.

### **[M]** 3. Kurşun/QC2 undo butonları
- **Konum:** Mobile Kurşun+KK2 tablet ekranı.
- Her rulonun yanına:
  - "Kurşun Geri Al" → `POST /api/kursun-qc/undo-kursun`, body `{ rollId, stepId }`
  - "QC2 Geri Al" → `POST /api/kursun-qc/undo-qc2`, body `{ rollId, stepId }`
- QC2 tamamlandıysa Kurşun geri alınamaz (backend 400 atar) — UI'da Kurşun butonu disabled olsun.

### **[E+M]** 4. Hata mesajı UX (her iki uygulamada)
Tüm undo butonlarında 409 ortak desen:
```
Geri alınamaz:
[Top XYZ-001]: Sonraki adımda işlem yapılmış (KURSUN_APPLIED) — önce o işlemi geri al
[Top XYZ-002]: Sonraki adımda fason sevki yapılmış (SD-2605-...) — önce sevki iptal et
```
Backend her ruloyu ayrı kontrol eder, ilk hatada durur. Frontend kullanıcıya kademeli undo yapması gerektiğini söyler.

### **[E+M]** 5. "Tambur reopen YOK" — buton bulundurma
Tambur finalize edilmiş bir step için "Geri Al" butonu **olmamalı**. Backend reddeder; UI'da hiç göstermemek temizdir. Tambur hatası için: Tambur'da yeni split girer veya operatör manuel `qualityGrade`/`status` düzeltir (mevcut akış).

## Test Senaryosu (multi-batch)

3 müşteri × tek WO × 12 rulo, boyahanede:
1. **1. parti (4 rulo) yanlış kabul edildi** → Fason Kabul listesinde receiptNo'yu seç → "İptal" → sebep gir → 4 rulo AT_SUBCONTRACTOR'a döner, **diğer 8 boyahanede dokunulmaz**.
2. **2. parti (4 rulo) Kurşun'a girdi, yanlış QC2 işaretlendi** → Kurşun ekranında her rulo için "QC2 Geri Al". **1. ve 3. parti etkilenmez.**
3. **3. parti (4 rulo) KK2'den çıkıp Tambur'a girmeden önce fark edildi** → tablet'te "Geri Al" butonu → KK2'ye geri çek. **Diğer parti rulları etkilenmez.**

## Notlar
- Kart okutulması davranışına dokunulmadı; refakat kartı `ACTIVE` kalır WO bitene kadar.
- Tüm undo'lar `AuditService.log` ile kaydedilir; "kim, ne, ne zaman geri aldı"yı admin paneli sistem log'unda görebilir.
- Fason sevki iptali için zaten vardı: `POST /api/subcontractor/dispatches/:id/cancel`.

---

# Dördüncü Refactor — Yanlış İstasyonda Kart Okutma Mesajı (2026-05-15)

## Bağlam — Backend'de Ne Değişti?

Operatör refakat kartını **yanlış istasyonun tabletinde** okuturdu (örn. WO hâlâ Boyahane'de ama operatör Kurşun ekranında okuttu) → eskiden boş liste dönüyordu, operatör kafası karışıyordu. Şimdi backend net mesaj döndürüyor.

### Davranış değişikliği

| Endpoint | Eski | Yeni |
|---|---|---|
| `GET /api/kursun-qc/by-card/:barcode` | Boş roll listesi (200 OK) | **400** mesajla: *"Bu iş emrinin 'Kurşun + KK2' adımında şu an açık top yok. Mevcut konum: Boyahane (4 rulo). Tabletinizi yanlış istasyonda okutmuş olabilirsiniz."* |
| `GET /api/tambur/by-card/:barcode` | Boş roll listesi (200 OK) | Aynı pattern, multi-batch destekli |

### Multi-batch desteği

Eğer aynı WO'nun rulları gerçekten birden fazla adımda dağılmışsa (3 müşteri × tek WO senaryosunda 4 rulo Tambur'da, 4 rulo Kurşun'da, 4 rulo Boyahane'de), mesaj hepsini gösterir:
> *"Mevcut konum: Boyahane (4 rulo), Kurşun (4 rulo)"*

Operatör doğru tableti seçer. Eğer kart Tambur'da okutulduğunda Tambur'da gerçekten 4 rulo varsa → normal akış, liste döner (200 OK + roll listesi). Multi-batch'te bir adımda iş varsa o iş gösterilir, yokken hata atılır.

## Frontend'de Yapılması Gerekenler

> **Bu refactor ağırlıklı olarak [M] Mobile'ı etkiler.** Electron tarafı kart okutmaz; ama hata mesajı handler'ı ortak component ise [E+M] dokunur.

### **[M]** 1. Hata mesajı toast/banner
- **Konum:** Mobile'da Kurşun ve Tambur tablet ekranı, kart scan input'u sonrası.
- **Eski davranış:** API başarılı dönerdi ama roll listesi boştu → `<EmptyState>` göstermeye çalışırdı.
- **Yeni davranış:** API **400 Bad Request** döner. Frontend'in `try/catch` veya error boundary'sinde mesajı yakala, **toast veya tam ekran banner** göster:
  ```
  ⚠️ Yanlış istasyon
  Bu iş emrinin "Kurşun + KK2" adımında şu an açık top yok.
  Mevcut konum: Boyahane (4 rulo).
  Tabletinizi yanlış istasyonda okutmuş olabilirsiniz.
  ```
- Kullanıcıya "Anladım" butonu, başka aksiyon gerekmez. Geri scan input'una dön.

### **[M]** 2. Boş listenin anlamı değişti
- Eski mantıkta "200 OK + boş liste" → ekranda "Bu kart için işlenecek top yok" gibi bir EmptyState gösterirdiniz.
- Artık bu durum **gerçekleşmez**: ya gerçek bir liste döner, ya da 400 hata.
- Eğer hâlâ EmptyState handling'iniz varsa: bu kod path'i **dead code** demek değil — aşağıdaki edge case'lerde kalabilir:
  - WO ACTIVE step yok (henüz kilitlenmemiş veya tamamlanmış) → backend de aynı mesajla hata atar
  - Kart süresi dolmuş (`status != ACTIVE`) → ayrı 400

### **[E]** 3. Yönetim paneli — etki yok
Electron'da kart okutma akışı yok. Ama eğer admin panelinde "system log" veya "audit" sayfası varsa, yanlış istasyonda kart okutma denemeleri **artık 400 olarak görünebilir** (eskiden 200 ile sessizdi). Filter/grafik etkilenmez ama hata yüzdelerinde küçük artış görülebilir.

## Test Senaryosu

1. WO oluştur, KK1 girişi yap, finish bas. Rulolar otomatik Boyahane step'ine taşınır (Fason Sevk yapılmadı henüz).
2. Mobile tablet'te Kurşun ekranını aç, kartı okut.
3. **Beklenen:** Toast/banner çıkar: *"Bu iş emrinin 'Kurşun + KK2' adımında şu an açık top yok. Mevcut konum: Boyahane (4 rulo)..."*
4. Operatör Boyahane sevki yapmaya gider, sevk + kabul tamamlanır → Kurşun'da kart okutulur → roll listesi döner (normal akış).

## Notlar
- Backend'de helper adı: `assertWoAtStepKind(workOrderId, expectedKind)` — gelecekte başka istasyon türleri için (örn. Paketleme, Sevkiyat) kullanılırsa aynı mesaj patterni döner.
- HTTP status seçimi: 400 (Bad Request) çünkü kullanıcı hatası — yanlış yerde okutmuş. 404 değil çünkü WO ve kart var; sadece şu an o adımda iş yok.

---

# Beşinci Refactor — KK1 + Fason Kabul Yanlış Yer Mesajı (2026-05-15)

## Bağlam — Backend'de Ne Değişti?

Önceki refactor (Kurşun + Tambur) tamamlanmıştı. Aynı pattern bu sefer **KK1 (RAW_QC)** ve **Fason Kabul (SUBCONTRACTOR)** akışlarına da uygulandı. Multi-batch ve "kart geçmişten" senaryolarında operatör artık doğru mesaj görüyor.

### Yeni / değişen endpoint'ler

| Endpoint | Eski | Yeni |
|---|---|---|
| **YENİ:** `GET /api/rolls/kk1-context/:cardBarcode` | — | KK1 tabletinde kart okutulduğunda WO context'i (batchNumber, targetItem, targetColor, openRollCount) döner. KK1 zaten tamamlanmışsa veya WO başka adımdaysa **400** ile multi-batch destekli mesaj. |
| `GET /api/subcontractor/pending-returns?workOrderId=X` | Boş array (200 OK) sessiz dönerdi | `workOrderId` verildiğinde + bekleyen rulo yoksa **400/404** mesaj: WO'da fason adımı yoksa 404; varsa "Mevcut konum: Tambur (4 rulo)..." gibi 400. |
| `POST /api/rolls/initial-entry` | KK1 step COMPLETED iken sessizce yeni rulo eklenebiliyordu (step ACTIVE'e geri dönüyordu) | KK1 step COMPLETED ise **409**: *"Bu iş emrinin ilk adımı (KK1) tamamlanmış. Yeni rulo eklemek için önce o adımı yeniden açın."* |

> Not: `pending-returns` çağrısının `workOrderId` **vermeyen** kullanımı (admin tüm-WO listesi) eski davranışı korur — sessiz boş array döner.

## Frontend'de Yapılması Gerekenler

> **Bu refactor [M] Mobile'ı doğrudan etkiliyor.** [E] Electron sadece pending-returns admin listesinden faydalanıyor (orada davranış değişmedi).

### **[M]** 1. KK1 tabletinde kart okutma akışı
- **Eski akış (varsa):** Frontend `traveler-cards/by-barcode` ile kartı çözüp WO bilgisini gösteriyordu — backend tarafından hiçbir step doğrulaması yoktu.
- **Yeni akış:** `GET /api/rolls/kk1-context/:cardBarcode` çağır — WO context döner veya 400/404. Bu endpoint KK1'e özel doğrulama yapar.
- **Beklenen response:**
  ```json
  {
    "success": true,
    "data": {
      "workOrderId": "...",
      "batchNumber": "PARTI-TEST-939944",
      "stepId": "...",
      "stationCode": "KK1",
      "stationName": "Kalite Kontrol 1",
      "targetItem": { "id": "...", "code": "PATOS", "name": "Patos" },
      "targetColor": { "id": "...", "code": "MAVI", "name": "Mavi" },
      "rollCount": 0
    }
  }
  ```
- Bu bilgilerle KK1 ham kabul ekranını aç, operatör yeni rulları kaydetmeye başlar (`POST /api/rolls/initial-entry`).
- **400 alırsa:** Mesajı toast/banner ile göster: *"Bu iş emrinin 'KK1' adımı tamamlanmış. Mevcut konum: Boyahane (4 rulo). Tabletinizi yanlış istasyonda okutmuş olabilirsiniz."*

### **[M]** 2. KK1'de yeni rulo eklerken 409 handling
- `POST /api/rolls/initial-entry` artık KK1 COMPLETED iken 409 atar.
- Frontend: hata mesajını göster, "İş emrinde KK1'i Yeniden Aç" butonu olabilir (operatör onaylarsa `production.undoStepFinish` çağırılır).

### **[M]** 3. Fason Kabul tabletinde 400 handling
- **Eski:** Boş `groups` array geldiğinde `<EmptyState>` gösterirdiniz.
- **Yeni:** `GET /api/subcontractor/pending-returns?workOrderId=X` artık 400 atabilir. Frontend `try/catch` ile mesajı yakala, toast/banner göster.
- Yine 200 OK + boş array kombinasyonu **sadece workOrderId VERİLMEDİĞİNDE** mümkün (admin tüm-WO listesi). Bu kullanımda EmptyState handling kalsın.

### **[E]** 4. Yönetim paneli — etki yok (admin pending-returns)
- Electron'da admin "tüm bekleyen fason kabuller" listesi varsa, `workOrderId` parametresiz çağırıyordur. Davranış değişmedi.
- Eğer admin **belirli bir WO'nun** pending-returns'ını görmek istiyorsa (örn. WO detay sayfasında), artık 400 alabilir — UX olarak bu da bilgi: *"Bu WO için bekleyen fason kabul yok"*.

## Test Senaryosu

### KK1 doğrulaması
1. Yeni WO oluştur, henüz top kaydı yok. `GET /api/rolls/kk1-context/<cardBarcode>` çağır → 200 + WO context.
2. Operatör 4 ham rulo kaydeder, KK1 finish basar, rulolar Boyahane'ye geçer.
3. Operatör tekrar kart okutursa → **400**: "KK1 zaten tamamlanmış. Mevcut konum: Boyahane (4 rulo)."

### Fason Kabul doğrulaması
1. WO'nun rulları boyahaneye sevk edildi (4 rulo AT_SUBCONTRACTOR). `GET /api/subcontractor/pending-returns?workOrderId=X` → 200 + groups.
2. Tüm rulolar geri kabul edildi (boyahane sevkiyatı bitmiş).
3. Operatör tekrar kart okutursa → **400**: "Bu iş emrinin fason adımında bekleyen rulo yok. Mevcut konum: Kurşun + KK2 (4 rulo)..."

## Notlar
- `traveler-cards/by-barcode` generic endpoint korunuyor (admin/debug için kart info okuma). Mobile artık her station kendi specialized endpoint'ini kullanmalı (`kursun-qc/by-card`, `tambur/by-card`, `rolls/kk1-context`).
- Permission: yeni KK1 endpoint `roll:read` istiyor. Mobile permission setinde `mobile:kk1` ile ek kontrol yapılırsa o da mevcut, ayrı izin gerekmez.

# Altıncı Refactor — Müşteri-Bazlı Alias + Etiket Sistemi

**Sebep:** Bizdeki ürün/renk isimleriyle müşterideki isimler farklı olabiliyor.
Örn: bizde "PATOS", ABC müşterisinde "AKTOS". Sipariş girişinde otomatik
öneri olarak gelmeli, override edilebilmeli, ve etiket basımında doğru isim
çıkmalı. Ayrıca "doğru etiket basma" garantisi için yetki 3'e bölündü
(görüntüle / bas / düzenle) — operatör başına ayrı verilebilir.

## Şema değişikliği (uygulandı)

İki yeni master tablo + OrderLine'a 2 override alanı:

```prisma
model CustomerItemAlias {
  id String @id @default(uuid())
  customerId String
  itemId     String
  alias      String  // örn. "AKTOS"
  @@unique([customerId, itemId])
}

model CustomerColorAlias {
  id String @id @default(uuid())
  customerId String
  colorId    String
  alias      String
  @@unique([customerId, colorId])
}

model OrderLine {
  // ...
  customerItemName  String?  // 1-shot override (örn. "CITOS")
  customerColorName String?
}
```

## Effective name cascade (her etiket okumasında)

```
OrderLine.customerItemName    (1-shot override)  → source: "OVERRIDE"
   ↓ yoksa
CustomerItemAlias.alias        (master, live)     → source: "MASTER"
   ↓ yoksa
Item.name                      (default)          → source: "DEFAULT"
```

Aynı sıra color için. Master değişti → override yazılmamış sipariş satırları
**otomatik** güncel isim alır (canlı okuma). OrderLine override DOLU ise
master değişikliğinden etkilenmez (frozen).

## Yeni Permission'lar (5 adet)

| Code | Modül | Açıklama |
|---|---|---|
| `customer-alias:read` | SALES | Alias kayıtlarını listele |
| `customer-alias:write` | SALES | Alias upsert/delete |
| `label:read` | LOGISTICS | Etiket payload'unu görüntüleme (önizleme) |
| `label:print` | LOGISTICS | Etiket basma aksiyonu |
| `label:edit` | LOGISTICS | Sipariş satırı override etme |

**3 ayrı yetki notu:** Bir tartı operatöründe `label:print` varken `label:edit`
olmayabilir (yanlış yazımı engellemek için). Vardiya değişiminde admin tek
yetkiyi geri alıp diğer operatöre atayabilir. Tüm tartı/paket/sevkiyat
ekranlarında etiket UI bu yetkilere göre koşullu render edilmeli.

**Canlı DB için**: `Teks-Erp/scripts/seed-permissions-label-alias.sql` dosyası
eklendi — `psql "$DATABASE_URL" -f scripts/seed-permissions-label-alias.sql`
çalıştırınca admin'e otomatik atanır + Admin (Tam Yetki) şablonuna eklenir.
Idempotent.

## Yeni Endpoint'ler

### Customer Alias CRUD (sales modülü)

```
GET    /api/customers/:customerId/aliases/suggest?itemId=X&colorId=Y
       → { itemAlias: string|null, colorAlias: string|null }
       Sipariş giriş ekranında müşteri+ürün seçilince otomatik çağrılır.

GET    /api/customers/:customerId/item-aliases               (label:read)
PUT    /api/customers/:customerId/item-aliases/:itemId       (customer-alias:write)
DELETE /api/customers/:customerId/item-aliases/:itemId       (customer-alias:write)

GET    /api/customers/:customerId/color-aliases
PUT    /api/customers/:customerId/color-aliases/:colorId
DELETE /api/customers/:customerId/color-aliases/:colorId
```

### Label endpoint'leri

```
GET   /api/labels/rolls/:id          (label:read)
      → effective payload (cascade uygulanmış + default + source bilgisi)

GET   /api/labels/swatches/:id       (label:read)
      → kartela payload'u (parentRoll allocation üzerinden cascade)

PATCH /api/labels/order-lines/:id    (label:edit)
      body: { customerItemName?: string|null, customerColorName?: string|null }
      → OrderLine.customerItemName / customerColorName yazar (1-shot override)
      → null/boş string → override silinir, master/default'a düşer

POST  /api/labels/rolls/:id/print    (label:print)
      → audit-only event (gerçek baskı tarayıcıda olur)
```

### LabelPayload yapısı

```ts
{
  rollId, barcode, status, qualityGrade, widthCm, lengthMeters, weightKg,
  packagingDate,
  itemCode,
  itemName: string,            // effective (cascade)
  itemNameDefault: string,      // bizdeki ad (Item.name)
  itemNameSource: "OVERRIDE" | "MASTER" | "DEFAULT",
  colorCode, colorName, colorNameDefault, colorNameSource,
  customerName,                 // null → frontend bloğu render etmez
  customerId,
  orderNumber,
  orderLineId,                  // null değilse PATCH ile düzenleme yapılır
  ownerCustomerName,            // SERVICE_PRODUCTION fason rulolar için
  batchNumber,
  printedAt,
}
```

### ShipmentPrintSnapshot değişti

`buildShipmentPrintSnapshot` içine 4 yeni alan eklendi (her item için):
- `itemNameForCustomer` (effective)
- `itemNameForCustomerSource`
- `colorNameForCustomer`
- `colorNameForCustomerSource`

İrsaliye PDF/HTML'de bunları kullanın. Eski `itemName` / `colorName` bizdeki
ad olarak kalıyor (audit / iç gösterim için).

### PackagingLabelPayload değişti

Aynı pattern: `itemName` / `colorName` artık effective; `itemNameDefault` /
`colorNameDefault` / `*Source` alanları eklendi.

## Frontend gereksinimler

### [E] Sipariş giriş ekranı (planlamacı) — Order/OrderLine create/edit

Mevcut sipariş satırı formuna 2 yeni alan ekle:
- **Müşterideki ürün adı** (text input)
- **Müşterideki renk adı** (text input)

Default değer akışı:
1. Müşteri + ürün seçilince → `GET /api/customers/:customerId/aliases/suggest?itemId=X&colorId=Y`
2. `itemAlias` varsa text input default'u olarak doldur (placeholder: "Önerilen: <alias>")
3. Planlamacı override edebilir (örnek: "CITOS bir-seferlik")
4. Submit → OrderLine.customerItemName / customerColorName olarak yazılır

Boş bırakılırsa null gider → etikette master alias veya default kullanılır.

**Görsel ipucu:** Field altında küçük yardımcı metin: "Boş bırakırsanız sipariş
boyunca otomatik güncel kalır. Yazarsanız sadece bu sipariş için sabitlenir."

### [E] Müşteri alias yönetimi sayfası — Customer detail

Mevcut müşteri detay sayfasına 2 yeni tab ekle:
- **Ürün Alias'ları** — `GET /api/customers/:id/item-aliases` listesi
  + Satır içi alias düzenleme + ekle/sil. `customer-alias:write` yetkisi.
- **Renk Alias'ları** — `GET /api/customers/:id/color-aliases` listesi
  + aynı pattern.

Mobil için ihtiyaç YOK (mobil operatör alias master'ı yönetmez).

### [E] Etiket bas/düzenle ekranı — Tartı/Paket, Sevkiyat, Tambur reprint

**Yer:** Mevcut tartı-paket finalize ekranı, sevkiyat öncesi gözden geçirme,
ve tambur reprint listesi — hepsi aynı `getRollLabel` payload'ını kullanır.

**UX:**
1. Operatör barkod okutur → `GET /api/labels/rolls/:id`
2. Etiket önizlemesi göster:
   - Ürün satırı: `itemName` (büyük). Sağında küçük badge: source = OVERRIDE → 🔒, MASTER → 👤, DEFAULT → 🏠. Hover/long-press: "Bizdeki ad: <itemNameDefault>"
   - Renk satırı: aynı şablon
   - Müşteri satırı: `customerName` varsa render, **null ise satırı render ETME** (kullanıcı boş alan görmesin)
3. **Düzenle butonu** (`label:edit` yetkisi varsa görünür):
   - Modal: 2 input (Müşterideki ürün adı, Müşterideki renk adı). Mevcut effective değerler placeholder.
   - Kaydet → `PATCH /api/labels/order-lines/:orderLineId` (orderLineId null ise düzenle butonu **disabled**, çünkü allocation yok)
   - Boş gönderilirse override silinir → master/default'a düşer
4. **Bas butonu** (`label:print` yetkisi varsa görünür):
   - `window.print()` veya yazıcı entegrasyonu (mevcut print pattern)
   - Async olarak `POST /api/labels/rolls/:id/print` (audit izi)

**Yetki UI'sı:**
- `label:read` yok → ekrana hiç girilemesin (route guard)
- `label:read` var, `label:edit` yok → düzenle butonu hidden
- `label:read` var, `label:print` yok → bas butonu hidden
- Üçü birden yok → "Bu top için etiket yetkisi yok" mesajı

**[M] Mobile için:** Mobil tartı-paket/tambur ekranları yetki kontrollerini aynen
uygulamalı. Edit modal mobil için kompakt versiyon — TouchableRipple/Button.

### [E] Tambur reprint listesi — müşteri kolonu

Mevcut `tambur.listRecentOutputRolls` listesinde her satır için sadece bilgilendirme
amaçlı bir "Müşteri" kolonu eklenebilir (opsiyonel). Eğer eklenirse: rulonun
allocation'ı varsa müşteri adını backend'den dolaylı çekmek yerine, list'i
clickleyen kullanıcı `getRollLabel` çağırır → orada görür. List endpoint'i
genişletilmedi (perf — extra join'i kalan rulolar için yapmak gereksiz).

### Cascade source badge önerisi

| Source | Anlam | UI ipucu |
|---|---|---|
| `OVERRIDE` | OrderLine'da elle yazılmış (1-shot) | 🔒 + "Bu sipariş için özel" |
| `MASTER` | CustomerXxxAlias'tan canlı | 👤 + "Müşteri tanımı (master)" |
| `DEFAULT` | Bizdeki ad (Item/Color.name) | 🏠 + "Standart ad" |

Operatör tek bakışta hangi kaynaktan isim geldiğini anlasın diye kritik —
yanlış bas mahşerine sebep olur.

## Test Senaryosu

1. **Master alias:** Customer A için Item P alias = "AKTOS" yaz → bir order'a P ürünü ekle, müşteri A seç → suggest endpoint "AKTOS" döner → kabul et → OrderLine.customerItemName = null kalsın
2. Tüm rulolar üretildi → Tambur'dan çık → `GET /api/labels/rolls/:id` → `itemName: "AKTOS"`, `itemNameSource: "MASTER"`
3. **Master değişikliği:** Alias'ı "BAKTOS" olarak güncelle → aynı endpoint'i tekrar çağır → `itemName: "BAKTOS"` (live)
4. **1-shot override:** `PATCH /api/labels/order-lines/:id` body `{ customerItemName: "CITOS" }` → tekrar `getRollLabel` → `itemName: "CITOS"`, `source: "OVERRIDE"`
5. **Override sil:** `PATCH ... { customerItemName: "" }` veya `null` → `source: "MASTER"` (BAKTOS) tekrar
6. **Stok WO (allocation yok):** Yeni rulu, hiçbir siparişe bağlı değil → `getRollLabel` → `customerName: null`, `itemNameSource: "DEFAULT"` (Item.name)
7. **Yetki testi:** `label:read` olmayan kullanıcı → 403. `label:print` olmayan → POST 403. `label:edit` olmayan → PATCH 403.

## Notlar
- Backend tarafında `Manifest`, `SubcontractorDispatch`, `SubcontractorReceipt`,
  `TravelerCard` etiketlerine **dokunulmadı** — bu belgeler iç akış / fason
  firma için, müşteri ismi alakasız.
- Tambur output etiketinde müşteri ismi opsiyonel: allocation varsa cascade ile
  basılır, yoksa müşteri bloğu **render edilmez** (boş alan değil, satır gizlenir).
- Roll seviyesi override şu an YOK (sadece OrderLine seviyesi). İhtiyaç çıkarsa
  `Roll.labelItemName` eklenir + cascade'e bir basamak girer.

# Yedinci Refactor — Etiket Template Sistemi (Standardı Tanımları)

**Sebep:** Bir etikette hangi alanlar gözüksün, hangi sırada, hangi başlıkla,
bold mu — bunlar şu an kod-sabit. Planlama "Tanımlar"dan değiştirebilmeli.
Tambur operatörü de yetkili ise master template'i kalıcı düzenleyebilmeli
(her standartın tek noktada güncellenmesi için).

**Kapsam (B seviyesi):** alan toggle + sıra + Türkçe başlık + bold + fontSize.
Visual designer (drag-drop, koordinat) **YOK** — frontend sabit layout'la
template'in fields listesini render eder.

## Şema (uygulandı)

```prisma
enum LabelKind { ROLL, SWATCH, SHIPMENT_DOCKET }

model LabelTemplate {
  id        String    @id @default(uuid())
  name      String           // "Standart Top Etiketi", "Müşteri X Özel"
  kind      LabelKind
  isDefault Boolean   @default(false)  // her kind için 1 default (service zorlar)
  isActive  Boolean   @default(true)
  fields    Json             // TemplateField[] — aşağıda
  @@unique([kind, name])
}
```

`fields` JSON yapısı:
```ts
type TemplateField = {
  key: string;        // catalog'daki izinli key (whitelist)
  label: string;      // Türkçe başlık ("Barkod", "Ürün")
  order: number;      // sıralama (1'den başlar)
  isVisible: boolean; // gizle/göster
  isBold?: boolean;
  fontSize?: "sm" | "md" | "lg" | "xl";
};
```

## 2 Yeni Permission

| Code | Modül | Açıklama |
|---|---|---|
| `label-template:read` | LOGISTICS | Template listele/önizle |
| `label-template:write` | LOGISTICS | Oluştur/düzenle/default değiştir/pasifleştir |

**Tambur'a yetki verme senaryosu:** Operatöre `label-template:write` atayın →
Tambur ekranındaki etiket düzenleme modal'ı master template'i KALICI olarak
yazar. (Per-baskı geçici override yok — basitlik için kasıtlı.)

**Canlı DB için:** `Teks-Erp/scripts/seed-permissions-label-alias.sql` 7
permission'a güncellendi (önceki 5 + yeni 2). Idempotent.

## Default Template'ler (auto-seed)

`Teks-Erp/scripts/seed-label-templates.sql` 3 default kaydı ekler (kind başına 1):
- "Standart Top Etiketi" (ROLL) — barkod, QR, ürün, renk, kalite, en, metraj,
  kg, müşteri, sipariş, parti — visible + sıralı
- "Standart Kartela Etiketi" (SWATCH)
- "Standart Sevkiyat İrsaliyesi" (SHIPMENT_DOCKET)

İlk kurulum / yeni ortam: `psql ... -f scripts/seed-label-templates.sql`

## Yeni Endpoint'ler

```
GET    /api/label-templates?kind=ROLL                  (label-template:read)
GET    /api/label-templates/:id                        (label-template:read)
GET    /api/label-templates/catalog/:kind              (label-template:read)
       → izinli alanlar + tipleri + Türkçe default başlıkları (UI havuzu)

POST   /api/label-templates                            (label-template:write)
PATCH  /api/label-templates/:id                        (label-template:write)
       → fields gönderildiyse complete-replace
POST   /api/label-templates/:id/set-default            (label-template:write)
       → kind içindeki diğer default'lar atomic düşürülür
DELETE /api/label-templates/:id                        (label-template:write)
       → soft (isActive=false). Default silinemez.
```

## Field Catalog (whitelist source-of-truth)

`Teks-Erp/src/config/label-fields.ts` içinde kind başına izinli alanlar
tanımlı. Her alan: `{ key, defaultLabel, type, required? }`. `type` =
`"text"|"number"|"date"|"qr"|"barcode"|"table"`. `required: true` ise
template'te `isVisible=true` zorunlu (örn. `barcode` ROLL'da, `shipmentNumber`
SHIPMENT_DOCKET'ta).

Yeni alan eklemek için: önce catalog → sonra label payload builder → sonra
frontend renderer (3 nokta sync olmalı).

`GET /api/label-templates/catalog/:kind` frontend'in template editor'ında
"sürükle bana ekle" listesini besler.

## Frontend gereksinimler

### [E] "Tanımlar → Etiket Standartları" sayfası — admin/planlama

**Yeni nav item:** Tanımlar → Etiket Standartları

**Liste ekranı:**
- 3 sekme: ROLL / SWATCH / SHIPMENT_DOCKET
- Her sekme bir tablo: Ad | Default mı? | Aktif mi? | Aksiyonlar (Düzenle, Default Yap, Pasifleştir)
- "Yeni Template" butonu → modal: ad + kind + (default'tan kopyala / sıfırdan)

**Düzenleme ekranı (template editor):**
- Üst: Template Adı (input), Default checkbox, Aktif toggle
- Sol panel: **Catalog alanları** (`GET /api/label-templates/catalog/:kind`) — drag/drop için kaynak. "Bu template'te yok" olanlar listelenir.
- Sağ panel: **Template alanları** — sıralanmış kartlar:
  - Sürükle-bırak ile sıra değişir (her kartta `order` güncellenir)
  - Her kart üzerinde: Görünürlük toggle (isVisible), Türkçe başlık input (label), Bold checkbox, fontSize select (sm/md/lg/xl), "Sil" (catalog'a geri gönder)
  - `required: true` olan alanlarda Görünürlük toggle disabled (zorla görünür) + tooltip "Zorunlu alan, gizlenemez"
- Önizleme paneli (canlı): Sample data ile mock label render et — operatöre değişiklikler nasıl görüneceğini göster
- Kaydet → `PATCH /api/label-templates/:id` body: `{ name?, isDefault?, isActive?, fields: [...] }` (complete-replace)

**Hatalar:**
- 400 "field.key '...' bu etiket türünde tanımlı değil" → toast "Geçersiz alan"
- 400 "Tekrarlanan alan" → toast
- 400 "Default template pasifleştirilemez" → "Önce başka birini default yapın" yönlendirmesi

### [E+M] Etiket bas/önizle ekranlarına template entegrasyonu

**Mevcut akış (önceki refactor'dan):**
1. Operatör barkod okutur → `GET /api/labels/rolls/:id` → payload (effective name cascade ile)
2. Önizleme + edit + bas

**Yeni adım — template uygulama:**
1. Uygulama açılışında 1 kez: `GET /api/label-templates?kind=ROLL` (+ SWATCH, SHIPMENT_DOCKET) → `localStorage` veya state'e cache (her kind için default template seçilir)
2. Etiket önizleme bileşeni payload alır + cache'den default template'i alır
3. Sadece `template.fields.filter(f => f.isVisible).sort(by order)` üzerinden render eder
4. Her field için: `payload[f.key]` değer + `f.label` başlık + `f.isBold/fontSize` stil

**Template değiştirme/düzenleme buton (`label-template:write` yetkisi varsa):**
- "Template Düzenle" butonu → modal (template editor'ın kompakt versiyonu — alan toggle + sıra + bold)
- Save → `PATCH /api/label-templates/:id` → cache'i invalidate et + tekrar fetch et + önizleme yenile
- **Bu master'ı değiştirir** — bir sonraki tüm baskı/önizleme bu yeni template ile gelir

**Template seçici (birden fazla aktif template varsa):**
- Dropdown: "Standart Top Etiketi" | "Müşteri X Özel" | ...
- Seçim default template'i değiştirmez — sadece bu kullanıcının görüntüsünü değiştirir (frontend state)
- Default değiştirmek için "Default Yap" butonu → `POST /api/label-templates/:id/set-default`

### [M] Mobile değişiklik

- Mobil tartı/paket/tambur ekranları aynı endpoint'leri kullanır
- Cache: app açılışında 3 kind için template fetch + AsyncStorage'a yaz
- Düzenleme modal'ı mobil için kompakt: TouchableRipple/Switch/Button (Pressable yasak)
- `label-template:write` yetkisi yoksa düzenleme butonu hidden — sadece varsayılan template uygulanır

### Catalog endpoint çıktısı (frontend referansı)

```ts
GET /api/label-templates/catalog/ROLL
→ {
  success: true,
  data: {
    kind: "ROLL",
    fields: [
      { key: "barcode",      defaultLabel: "Barkod",      type: "barcode", required: true },
      { key: "qrCode",       defaultLabel: "QR Kod",      type: "qr" },
      { key: "itemName",     defaultLabel: "Ürün",        type: "text" },
      ...
    ]
  }
}
```

`type` UI render için: "barcode" → `<BarcodeRenderer/>`, "qr" → `<QRCode/>`,
"date" → `formatDate()`, "number" → `Number.toLocaleString()`, "table" →
SHIPMENT_DOCKET'taki `items` için tablo render.

## Test Senaryosu

1. `GET /api/label-templates?kind=ROLL` → 1 default ("Standart Top Etiketi")
2. Editor: yeni template oluştur "Müşteri X Özel" — kind=ROLL, isDefault=false. customerName field'ını gizle.
3. `POST /api/label-templates/:id/set-default` → kind içinde default değişti, eskisi otomatik isDefault=false
4. `GET /api/labels/rolls/:rollId` + cache'den yeni default → customerName görünmesin
5. **Tambur'a yetki:** Operatöre `label-template:write` ata → Tambur ekranında "Template Düzenle" görünsün → operatör bir alanı toggle etsin → master kalıcı yansısın → başka kullanıcı F5'te aynı template'i görsün
6. **Hata yakalama:** Catalog'da olmayan key gönder → 400 mesaj. Required alanı gizle → 400 mesaj.
7. **Pasifleştirme:** Default template'i pasifleştirmeye çalış → 400 "Önce başka birini default yapın". Önce başkasını default yap → eskiyi pasifleştir → 200.

## Notlar
- Per-baskı geçici override **YOK** — operatör template'i değiştirirse master
  yazar. Audit izinde her UPDATE'in `userId`'si var, kim ne zaman değiştirdi izlenebilir.
- Müşteri-bazlı template (Customer X için özel ROLL template) şu an **YOK**.
  Kind başına tek default. İhtiyaç çıkarsa LabelTemplate'e `customerId?` eklenir
  + cascade'e bir basamak girer (customerSpecific > kindDefault).
- `LabelTemplate.fields` Json olduğu için Prisma şema-level validate etmez —
  service `validateFields()` fonksiyonu whitelist + tip kontrolü yapar.
- Backend etiket payload'larına template **bağlı değil** — payload her zaman tüm
  alanları döner, template-driven filtering frontend'de olur (cache + esneklik).

# Sekizinci Refactor — Sipariş Para Birimi + Fiyat + Feature Flag

**Sebep:** Sipariş şemasında `currency` ve `unitPrice/totalAmount` alanları
zaten vardı ama: (a) currency validate edilmiyordu, (b) totalAmount otomatik
hesaplanmıyordu, (c) UI dropdown'u beslemek için endpoint yoktu, (d) **şu an
fabrika fiyat ve para birimi görmek istemiyor** ama ileride isteyebilir →
runtime feature flag ile UI gösterimi açılıp kapanmalı.

**Backend behavior:** Feature flag **enforce edilmez** — pricing kapalıyken bile
API currency/unitPrice kabul eder (admin/test araçları için). Flag sadece UI
rehberi: kapalıyken alanları gizle, açıkken göster.

## Şema değişikliği YOK

Mevcut `Order.currency`, `Order.totalAmount`, `OrderLine.unitPrice` alanları
yeterli. SystemSetting'e yeni key eklendi: `finance.pricingEnabled`.

## Yeni Endpoint'ler

```
GET   /api/currencies            (auth-only)
      → [{ code: "TRY", name: "Türk Lirası", symbol: "₺" }, ...] (sabit liste)

GET   /api/feature-flags         (auth-only — herkese açık)
      → { pricingEnabled: boolean }
      App start'ta 1 kez çekilir, context'e konur.

PATCH /api/feature-flags         (admin:settings)
      body: { pricingEnabled?: boolean }
      → güncel değerler döner. Verilmeyen flag dokunulmaz.
```

**Currency catalog değişikliği için:** `Teks-Erp/src/config/currencies.ts`
düzenlenir → endpoint otomatik yansır. Şu an: TRY/USD/EUR/GBP.

## Order create/update değişiklikleri

**create (`POST /api/orders`):**
- `currency` whitelist: sadece TRY/USD/EUR/GBP. Geçersizse 400.
- `totalAmount` otomatik hesap:
  - Body'de `totalAmount` yoksa + `lines[]` varsa → `sum(quantity × unitPrice)` hesaplanır
  - Manuel verilirse override (KDV/indirim/navlun gibi)
  - Hiç line'da `unitPrice` yoksa → `null` (fiyatsız sipariş)
- `lines[].unitPrice` opsiyonel — boş bırakılabilir.
- Yeni payload alanları (önceki refactor'dan): `lines[].colorId`,
  `lines[].customerItemName`, `lines[].customerColorName`, `lines[].width`,
  `branchId`.

**update (`PATCH /api/orders/:id`):**
- `currency` allowlist'e eklendi (önceden sessizce geçiyordu, şimdi explicit).
- `totalAmount` allowlist'e eklendi.
- `customerId/branchId` aktif WO bağıyla kilitli (mevcut davranış).
- `PARTIAL_SHIPPED` durumunda sadece `deadline` (mevcut davranış).
- Lines hiçbir koşulda güncellenmez (mevcut davranış).

## Frontend gereksinimler

### [E] App start — feature flag context

```ts
// App.tsx veya main provider
const { pricingEnabled } = await fetch("/api/feature-flags").then(r => r.json()).then(r => r.data);
// → React Context'e koy, tüm child'lar usePricingEnabled() ile okur
```

App ilk açılışta 1 kez. Login sonrası setting değişirse re-fetch için
`POST /api/auth/login` sonrası tekrar çağır.

### [E] Sipariş oluştur/düzenle ekranı — koşullu render

**`pricingEnabled === true` iken:**
- Header bölümünde **Para Birimi** dropdown — `GET /api/currencies` ile beslenir, default "TRY"
- Her line satırında **Birim Fiyat** input (opsiyonel, boş bırakılabilir)
- Line tablosu altında **Toplam** preview: `lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0)` canlı hesap. Manuel override input'u (boş bırakılırsa backend hesaplar).

**`pricingEnabled === false` iken:**
- Para birimi dropdown gizli (backend default "TRY" kullanır, sorun yok)
- Birim fiyat input'ları gizli (line satırlarında sadece miktar görünür)
- Toplam preview gizli
- `totalAmount` payload'a hiç eklenmesin

**Önemli:** Mevcut sipariş kayıtlarında `currency`/`unitPrice`/`totalAmount` dolu
olabilir. Pricing kapalıyken bile detail ekranında **eski sipariş için bu
değerleri gizle** (görünmüyor mu, yok mu? — operatör için aynı şey).

### [E] Sipariş listesi — koşullu kolon

`pricingEnabled === true` iken liste'ye **"Tutar" kolonu** ekle (`totalAmount`
+ `currency` symbol birleştirilmiş: "12.500,00 ₺"). Kapalı iken kolon yok.

### [E] Tanımlar → Sistem Ayarları (admin)

Mevcut admin settings sayfasına **"Görünüm Ayarları"** sekmesi ekle:
- Toggle: **"Sipariş para birimi ve fiyat alanlarını göster"** ↔ `pricingEnabled`
- Açıklama altında: "Kapalıyken sipariş ekranlarında para birimi dropdown'u, birim fiyat input'u ve toplam tutar gizlenir. Mevcut kayıtlardaki değerler korunur (kalıcı veri kaybı YOK)."
- Save → `PATCH /api/feature-flags` body `{ pricingEnabled: true/false }`
- Sayfayı yenile veya Context'i invalidate et

**Yetki:** `admin:settings`.

### [M] Mobile

Mobile uygulamada sipariş oluşturma/görüntüleme ekranı yok (planlamacı
masaüstünden açıyor). Bu nedenle **mobil için bu refactor'da değişiklik YOK**.
Eğer ileride mobil sipariş ekranı eklenirse aynı feature flag kontrolü uygulanır.

### Currency endpoint çıktısı (frontend referansı)

```ts
GET /api/currencies
→ {
  success: true,
  data: [
    { code: "TRY", name: "Türk Lirası",     symbol: "₺" },
    { code: "USD", name: "Amerikan Doları", symbol: "$" },
    { code: "EUR", name: "Euro",            symbol: "€" },
    { code: "GBP", name: "İngiliz Sterlini", symbol: "£" }
  ]
}
```

### Auto-totalAmount örnekleri

| Body | DB'ye yazılan totalAmount |
|---|---|
| `{ lines: [{qty:10, unitPrice:5}, {qty:20, unitPrice:3}] }` | 110.00 |
| `{ totalAmount: 200, lines: [{qty:10, unitPrice:5}] }` | 200 (override) |
| `{ lines: [{qty:10}] }` (unitPrice yok) | null (fiyatsız) |
| `{ lines: [{qty:10, unitPrice:5}, {qty:20}] }` | 50.00 (sadece fiyatlı line) |

## Test Senaryosu

1. `GET /api/feature-flags` → `{ pricingEnabled: false }` (default)
2. UI: order create ekranı → para birimi/fiyat alanları gizli
3. Admin: `PATCH /api/feature-flags { pricingEnabled: true }` → settings güncellendi
4. Yeni kullanıcı login → `GET /api/feature-flags` → `true` → UI alanları görünür
5. Sipariş oluştur: `{ customerId, currency: "EUR", lines: [{itemId, quantity:100, unitPrice:5}] }` → 201 + `totalAmount: 500.00`
6. Geçersiz currency: `{ currency: "ABC", ... }` → 400 "Geçersiz para birimi: ABC. İzinli: TRY, USD, EUR, GBP"
7. APPROVED siparişin currency'sini güncelle: `PATCH { currency: "USD" }` → 200
8. PARTIAL_SHIPPED siparişin currency'sini güncelle: → değişiklik yoksayılır (sadece deadline geçer)
9. Pricing'i kapat: `PATCH /api/feature-flags { pricingEnabled: false }` → UI alanları gizlenir, eski siparişlerin DB değerleri **korunur**

## Notlar
- Backend feature flag'i ENFORCE ETMEZ (önceden söylendi) — UI'nın
  sorumluluğunda. Bu kasıtlı: pricing açık/kapalı arası geçişlerde data
  kaybı/tutarsızlık olmaz, admin/test/migration tool'ları field göndermeye
  devam edebilir.
- `Order.currency` default "TRY" — payload'da yoksa schema doldurur.
- `OrderLine.unitPrice` Decimal(10,2) — frontend Number gönderse de Prisma
  kabul eder, backend'de Number/string ikisini de işler.
- KDV/indirim/navlun ileride eklenirse: yeni feature flag (`finance.taxEnabled`
  vb.) + ek alan + auto-compute güncellemesi. Bu refactor sadece para birimi
  + birim fiyat + toplam.
- Currency master tablosu **YOK** — config sabit liste yeterli (ileride
  esneklik gerekirse `Currency` modeli eklenir).

# Dokuzuncu Refactor — Boyahane Açık Kumaş Akışı (2026-05-15)

**Sebep:** Fabrika gerçekliği: boyahane gibi fasonlardan dönen kumaş **top
şeklinde değil, açık (yığma)** geliyor. Boyahane 3 topu birbirine dikip 1
parça döndürebiliyor — yani giden N top ile dönen M parça arasında 1:1
izlenebilirlik **yok**. Sadece metre bilgisi var, kg yok. Açık kumaşlar
arabaya yığılıyor; Kurşun/KK2 sırasıyla işliyor (top seçmez); Tambur'da
yeniden gerçek toplar oluşuyor.

**Sonuç:** "Roll = barkodlu top, baştan sona aynı" varsayımı boyahane
sonrası kırılıyor. Yeni yaşam döngüsü:
- Orijinal Roll'lar fason kabulde **terminal**'e (`SUBCONTRACTOR_CONSUMED`).
- Yeni "açık kumaş" Roll'lar Kurşun/KK2'de doğar (**barkod yok**, sistem ID).
- Tambur **gerçek toplar** üretir (barkodlu, kesim sonrası child Roll'lar).

## Şema değişiklikleri

- `RollStatus` enum + `SUBCONTRACTOR_CONSUMED` (TAMBUR_CONSUMED zaten vardı).
- `RollEntrySource` enum + `SUBCONTRACTOR_RETURN` (açık kumaş Roll'lar için).
- `Roll.barcode` → **nullable**. Açık kumaşlar fiziksel etiket basmaz.
- `Roll.parentReceiptId` (FK → SubcontractorReceipt) — açık kumaşın kaynak batch'i.
- `RollError.endMeter` → **nullable**. Operatör çoğu zaman sadece startMeter girer ("60. metrede hata").
- `SubcontractorReceipt.appliedColorId` (FK) + `SubcontractorReceiptProperty` (M2M ile FabricProperty).
  Receipt seviyesinde uygulanan renk + özellikler; yeni Roll'lar bunu inherit eder.

## Subcontractor receive endpoint değişikliği

`POST /api/subcontractor/receive` body'sine **opsiyonel** alanlar eklendi:

```json
{
  "workOrderId": "...",
  "stepId": "...",
  "subcontractorId": "...",
  "manifestNo": "irsaliye no | null",
  "appliedColorId": "uuid | null",        // YENİ — UI override
  "appliedPropertyIds": ["uuid", "..."],  // YENİ — UI override
  "returns": [{ "rollId": "...", "notes": "..." }],
  "notes": "..."
}
```

- Verilmezse: kategori `appliesColor=true` ise `WO.targetColor` + `WO.targetProperties` otomatik kullanılır; değilse null/[].
- Eski **Roll'a renk uygulama** mantığı kaldırıldı — artık receipt seviyesinde tutuluyor.
- Orijinal Roll'lar `SUBCONTRACTOR_CONSUMED`'a çekiliyor; sonraki step'e movement açılmıyor (Roll yok henüz).
- Sonraki step (Kurşun/KK2) PENDING kalır; ilk açık kumaş açıldığında ACTIVE olur.

**Cancel davranışı:** Receipt'ten doğmuş açık kumaş Roll varsa **cancel yasak** (önce o Roll'lar elle silinmeli). Aksi halde orijinaller `AT_SUBCONTRACTOR`'a geri çekilir.

## Yeni Endpoint'ler

```
POST   /api/rolls/open-fabric              — Kurşun/KK2'de açık kumaş Roll oluştur
POST   /api/rolls/:id/kursun-finish        — metraj + hata + Tambur'a ilerlet
POST   /api/tambur/:id/cut                 — tek kesim → child Roll (gerçek top)
POST   /api/tambur/:id/finalize-open-fabric — açık kumaşı bitir (parent CONSUMED_AT_TAMBUR)
GET    /api/tambur/context/:cardBarcode    — WO + sipariş progress + LIFO açık kumaşlar
```

### `POST /api/rolls/open-fabric`

Body:
```json
{
  "receiptId": "uuid",
  "stepId": "uuid",   // Kurşun/KK2 (PROCESS_QC) step
  "notes": "..."
}
```

Yeni Roll: `barcode=null`, `colorId/properties` receipt'ten inherit, `itemId=WO.targetItemId`, `parentReceiptId`, `initialQty=0`, `currentQty=0`, `currentStepId=Kurşun/KK2`, `entrySource=SUBCONTRACTOR_RETURN`.

### `POST /api/rolls/:id/kursun-finish`

Body:
```json
{
  "totalMeters": 500,
  "errors": [
    { "startMeter": 60, "endMeter": null, "defectTypeId": "uuid|null" },
    { "startMeter": 240 }
  ],
  "notes": "..."
}
```

Yapılan: `Roll.initialQty = currentQty = totalMeters`; `RollError`'lar insert; `RollOperation: KURSUN_APPLIED + QC2_COMPLETED`; Kurşun movement kapatılır; Tambur movement açılır + Roll Tambur step'ine geçer.

İdempotent değil — `initialQty > 0` ise 409 atar.

### `POST /api/tambur/:id/cut`

Body:
```json
{
  "lengthMeters": 100,
  "status": "WAREHOUSE | SCRAP | A1_STOCK",
  "qualityGrade": "1.KALITE",
  "notes": "..."
}
```

Yeni child Roll (barkodlu, gerçek top). Parent açık kumaşın `currentQty` kalan metreye düşer. **Hatalar otomatik aktarılmaz** — operatör Tambur ekranında metre konumlarını görür, manuel karar verir.

### `POST /api/tambur/:id/finalize-open-fabric`

Body:
```json
{ "scrapRemaining": false, "notes": "..." }
```

Parent Roll `TAMBUR_CONSUMED`'a çekilir. `scrapRemaining=true` verilirse kalan metre fire (SCRAP) child Roll olarak kaydedilir. WO tüm step'leri kapanırsa WO COMPLETED.

### `GET /api/tambur/context/:cardBarcode`

Operatör ekranı için tek atışta:
```json
{
  "workOrderId": "...",
  "batchNumber": "...",
  "stepId": "...",
  "stationName": "Tambur",
  "orders": [
    {
      "orderId": "...",
      "orderNumber": "SP-2026-001",
      "customerId": "...",
      "customerName": "ABC Tekstil",
      "lines": [
        {
          "lineId": "...",
          "itemCode": "PATOS",
          "itemName": "Patos",
          "colorCode": "KIRMIZI",
          "colorName": "Kırmızı",
          "orderedQty": 150,
          "shippedQty": 100
        }
      ]
    }
  ],
  "openFabricRolls": [
    {
      "rollId": "...",
      "currentQty": 500,
      "initialQty": 500,
      "receiptNo": "SR-2605-001",
      "colorCode": "KIRMIZI",
      "colorName": "Kırmızı",
      "kursunFinishedAt": "2026-05-15T...",
      "errors": [{ "id": "...", "startMeter": 60, "endMeter": null, "errorType": "Kıvrım" }]
    }
  ]
}
```

`openFabricRolls` LIFO sıralı — en son giren en üstte (araba mantığı).

## Envanter filtre genişlemeleri

`GET /api/rolls?...` yeni filtreler:

- `filter[processingStatus]=open_fabric` → barkodsuz + IN_PRODUCTION (Kurşun/KK2/Tambur'da bekleyen açık kumaşlar).
- `filter[rollKind]=OPEN_FABRIC | WOUND_ROLL` → barkod varlığına göre fiziksel form ayrımı.
- `filter[currentStepKind]=PROCESS_QC | TAMBUR | SUBCONTRACTOR | ...` → Roll'un şu an hangi istasyon türünde olduğu. UI tab/preset için.

UI öneri preset'leri:
- "Boyahanedekiler" → `status=AT_SUBCONTRACTOR`
- "Kurşun bekleyenler" → `currentStepKind=PROCESS_QC`
- "Tambur bekleyenler" → `currentStepKind=TAMBUR`
- "Açık kumaşlar" → `processingStatus=open_fabric`
- "Depodakiler" → `status=WAREHOUSE`

## Frontend gereksinimler

### A. Fason Kabul ekranı (planlama / mal kabul personeli)

Mevcut `POST /api/subcontractor/receive` çağrısına **renk + özellik seçici** eklenmeli:
- **appliesColor=true kategoride** (boyahane vb.): default WO.targetColor + WO.targetProperties; operatör override edebilir.
- **appliesColor=false kategoride** (yıkama, zımpara vb.): renk/property seçici hiç gösterilmez.
- Operatör seçtiklerini `appliedColorId` + `appliedPropertyIds` olarak gönderir.
- Ölçüm alanları (qty/weight/fire) **kaldırıldı** — UI'dan da kaldırın.

### B. Kurşun/KK2 ekranı (yeni — operatör tabletinde)

İki ana aksiyon:

1. **"Yeni kumaş aç"** butonu:
   - Refakat kartı okutulur → WO context (mevcut kk1-context endpoint'i benzeri).
   - Operatör hangi receipt'ten doğacağını seçer (WO'nun aktif receipt listesi).
   - `POST /api/rolls/open-fabric` → response'da yeni Roll ID döner (barkod yok, sistem ID gösterilir).
   - Roll arabaya bilgi olarak yazılır (kağıt etiket basmaz).

2. **"Kumaş bitir" (kursun-finish)** butonu:
   - Operatör cihazda gözüken toplam metreyi yazar.
   - Hata noktalarını ekler ("60. metre, Kıvrım, defectTypeId opsiyonel"). endMeter çoğunlukla boş bırakılır.
   - `POST /api/rolls/:id/kursun-finish` → Roll Tambur step'ine geçer, ekran sıradaki kumaşa geçer.

### C. Tambur ekranı (refactor — yeni model)

**Sol bölüm:** WO'ya bağlı orderlar + her satır için `shippedQty/orderedQty` progress (örn. "Kırmızı Patos 100/150"). Bilgi amaçlı, operatör kapatma butonu görmez (manuel close planlamacının işi).

**Sağ bölüm:** `openFabricRolls` LIFO sıralı. Her kumaşın metresi + hata listesi + receiptNo görünür.

**Operatör akışı:**
1. Refakat kartı okutur → `GET /api/tambur/context/:cardBarcode`.
2. Üstteki açık kumaşı seçer (sıra önemli ama backend zorlamaz; operatör fiziksel arabadan alıyor).
3. 100 mt'ye gelince **"Kes"** butonuna basar:
   - Modal: status (WAREHOUSE/SCRAP/A1_STOCK), qualityGrade, notes.
   - `POST /api/tambur/:id/cut` → child Roll (barkod basılır), parent kalan metre güncellenir.
   - Sayaç sıfırlanır, operatör devam eder.
4. Açık kumaş bitince **"Kumaşı Bitir"** butonu:
   - Modal: scrapRemaining (kalan metre fire mi?), notes.
   - `POST /api/tambur/:id/finalize-open-fabric` → parent terminal'e gider.

**Mevcut Tambur `/finalize` endpoint'i KORUNDU** — boyahaneye gitmemiş, doğrudan KK1→Tambur akışındaki barkodlu Roll'lar için (varsa). Yeni cut/finalize sadece **açık kumaş** Roll'lar için.

### D. Etiket basma davranışı

`label.service.ts` artık **açık kumaş Roll'lar için 400 döner**:
> "Bu Roll için etiket basılamaz — açık kumaş Roll'ları (Kurşun/KK2 öncesi) fiziksel etiket almaz."

UI'da etiket bas butonunu açık kumaş Roll'lar için disable edin (`barcode === null` kontrolü).

## Test Senaryosu

1. Boyahane WO oluştur (KK1 → Fason Sevk → Boyahane → Kurşun/KK2 → Tambur).
2. KK1'de 3 ham top oluştur (kırmızıya boyanacak).
3. Boyahaneye sevk et → toplar AT_SUBCONTRACTOR.
4. Fason kabul yap (`POST /api/subcontractor/receive`):
   - 3 toplara karşılık `appliedColorId=KIRMIZI`, `appliedPropertyIds=[...]`.
   - Orijinal 3 top → SUBCONTRACTOR_CONSUMED (terminal).
5. Kurşun/KK2'de 2 açık kumaş aç (`POST /api/rolls/open-fabric` x 2):
   - İki yeni Roll, barkodsuz, colorId=KIRMIZI inherit.
6. Birinci açık kumaşa kursun-finish (totalMeters=500, errors=[60, 240]):
   - Roll Tambur step'ine geçer.
7. İkinci açık kumaşa kursun-finish (totalMeters=300):
   - Bu da Tambur'a geçer.
8. Tambur context çek (`GET /api/tambur/context/:cardBarcode`):
   - 2 açık kumaş LIFO sıralı (en son finish edilen üstte).
9. Üstteki kumaşı kes:
   - 5 kez `POST /api/tambur/:id/cut` (her seferinde 60 mt, status=WAREHOUSE).
   - Parent kalan: 0 mt.
10. Finalize: `POST /api/tambur/:id/finalize-open-fabric` → parent TAMBUR_CONSUMED.
11. Diğer kumaş için aynı akış.
12. WO COMPLETED otomatik tetiklenir, refakat kartı COMPLETED.

## Notlar

- **Hatalar inherit edilmez.** Açık kumaşın RollError'ları sadece display amaçlı; child top'lara kopyalanmaz. Operatör hatayı görür, manuel karar verir.
- **Otomatik fire YOK.** Kullanıcı kuralı: "otomatik bir şey yapılmayacak". Σ child metre ≤ parent kontrolü dahi yok — operatör fire'ı manuel scrapRemaining ile ekler.
- **Refakat kartı boyahane dönüşünde geçerli kalır.** Yeni kart basılmaz; tüm yeni Roll'lar aynı WO'nun aktif kartına bağlı.
- **Tek WO garanti.** Boyahane farklı WO'ların kumaşlarını birbirine dikemez — receipt 1 WO'ya bağlı.
- **Manuel order kapatma:** Mevcut `POST /api/orders/:id/manual-complete` kullanılır (planlamacı `allocation:write` permission ile). Yeni endpoint **yok**.
- **Eski Tambur `/finalize` korundu** — barkodlu Roll'lar (boyahaneye gitmemiş simple WO) için. Açık kumaş Roll'lar yeni cut/finalize'e yönlendirilir.

# Onuncu Refactor — Termin Default'ları (Tanımlardan Konfigüre) (2026-05-15)

**Sebep:** Sipariş ve iş emri oluştururken termin/başlangıç çoğu zaman boş
geçiliyor. Backend artık otomatik dolduruyor: termin = başlangıç + N gün.
N hardcode değil, **tanımlardan** okunur — fabrika sipariş döngüsüne göre
ayarlayabilir (örn. acil siparişler için 3 gün, standart 7 gün).

**Backend behavior:**
- Order.create: `deadline` boşsa → `orderDate + N gün`. orderDate boşsa şema default `now()`.
- WorkOrder.create + full-update: `plannedStartDate` boşsa → `now()`; `plannedEndDate` boşsa → `plannedStartDate + N gün`.
- WorkOrder partial header update (`updatePlanning`) **etkilenmez** — explicit null gönderilirse temizlenir, yoksa dokunulmaz.

## Şema değişikliği YOK

Mevcut `Order.deadline`, `WorkOrder.plannedStartDate/plannedEndDate` alanları
yeterli. SystemSetting'e 2 yeni key eklendi:
- `order.defaultDeadlineDays` (default 7)
- `workorder.defaultPlanDurationDays` (default 7)

Pozitif tamsayı; geçersiz değer (0/negatif/NaN) → fallback 7.

## Tanımlar ekranı değişikliği

Mevcut SystemSetting tanımlar tablosuna 2 satır gelir (admin UI'da görünür):

| Key | Description (UI'da gösterilen) | Tip | Default |
|---|---|---|---|
| `order.defaultDeadlineDays` | Sipariş termini varsayılan gün sayısı (boş bırakılırsa) | int | 7 |
| `workorder.defaultPlanDurationDays` | İş emri planlama süresi (başlangıç → termin) varsayılan gün sayısı | int | 7 |

**UI gereksinim:** Mevcut Tanımlar/Sistem Ayarları sayfasında bu iki key
satır olarak görünür; admin sayı girer (1-365 önerilir; backend de ek
validasyon yapmaz, geçersizse fallback'e düşer). Pricing flag ve shipping
tolerance ile aynı tabloda — yeni section gerekmez.

## Frontend gereksinimler

### A. Sipariş + İş Emri create form'ları

- Termin alanı opsiyonel olarak işaretle (kırmızı yıldız kaldırılır).
- Placeholder: "Boş bırakılırsa N gün sonrası" — N'i tanımlardan okuyup placeholder'a yaz (opsiyonel polish).
- Tooltip: "Tanımlar > Sipariş termini varsayılanı buradan değiştirilir."
- Boş gönderildiğinde backend doldurur, response'tan dönen değeri UI gösterir.

### B. İş Emri create form'unda başlangıç tarihi

- Aynı opsiyonel davranış. Boşsa `now()` atar.
- Placeholder: "Boş bırakılırsa bugün"

### C. Tanımlar sayfası

- Mevcut SystemSetting tablosuna yeni iki satır otomatik gelir (key bazlı render).
- Tip "integer" olduğu için `<input type="number" min="1" max="365">` kullanın.
- Save butonuna basınca `POST /api/system-settings` (mevcut endpoint) çağrılır.

## Test Senaryosu

1. Tanımlardan `order.defaultDeadlineDays = 3` set et.
2. Yeni sipariş oluştur, deadline boş bırak → response.deadline = orderDate + 3 gün.
3. Tanımı sil → yeni sipariş için fallback 7 gün.
4. WorkOrder için aynı senaryo `workorder.defaultPlanDurationDays` ile.
5. Kötü değer testi: `order.defaultDeadlineDays = 0` veya `-5` → fallback 7.

## Notlar

- **Partial update (header):** WO'nun mevcut `updatePlanning` endpoint'i bu default'u uygulamaz. Sadece create + full-update'te aktif. Mevcut WO'ya termin set etmek için açıkça date göndermek gerek (eski davranış korundu — backwards compat).
- **Migration gerekmez** — mevcut Order/WO kayıtları etkilenmez, sadece yeni create'lerde devreye girer.
- **Fallback hardcoded 7:** SystemSetting boş ya da geçersizse default 7. İleride bu hardcoded fallback'i de admin UI'dan değiştirilebilir yapmak istemezseniz aynen kalabilir (her durumda 7 mantıklı — fabrika standart sipariş süresi).
- **Performans:** Her create'de 1 ek SELECT (`SystemSetting.findUnique`). Cache yok — saniyede yüzlerce create yok, kabul edilebilir. Cache gerekirse `system-setting.service.ts`'e in-memory cache (TTL 60s) eklenir.

# On Birinci Refactor — Tambur foldType/layerCount Planlamadan Geliyor (2026-05-15)

**Sebep:** Tambur'da operatörün her seferinde "2-KAT mı 4-KAT mı" sorgusunu kafadan
çözmesi yerine, planlama ekranında WO oluştururken belirlensin. Tambur'a
**bilgi olarak** gelir; operatör isterse override eder, gerçek değer audit'e
yazılır (sapma izlenebilir).

**Backend behavior:**
- WO planlama'da `foldType` (string, "2-KAT" / "4-KAT" gibi) ve `layerCount` (int) alanları opsiyonel.
- Tambur context endpoint bu değerleri `plannedFoldType` + `plannedLayerCount` olarak döner.
- `finalizeOpenFabric` (yeni model) ve eski `/finalize` endpoint'leri bu değerleri default kabul eder; body'de `foldType`/`layerCount` gönderilirse override.
- RollOperation `TAMBUR_PROCESSED` metadata'sına 4 alan yazılır: `plannedFoldType`, `plannedLayerCount`, `actualFoldType` (operatör seçimi), `actualLayerCount`. Yeni endpoint ayrıca `overriddenFoldType` / `overriddenLayerCount` boolean'larını da yazar — sapma direkt görülebilir.

## Şema değişikliği

```prisma
model WorkOrder {
  ...
  foldType   String?   // "2-KAT" | "4-KAT" gibi (max 32 karakter)
  layerCount Int?      // 1-20 arası
}
```

Migration: `prisma/migrations/20260515162218_workorder_fold_type/`.

## Endpoint değişiklikleri

### `POST /api/work-orders` (create) + `PUT /api/work-orders/:id` (replace) + `PATCH /api/work-orders/:id` (header update)

Body'ye iki yeni opsiyonel alan:
```json
{
  ...
  "foldType": "2-KAT",
  "layerCount": 4
}
```

Validation: `foldType` max 32 char string; `layerCount` 1-20 int. Null gönderilirse temizlenir.

### `GET /api/tambur/context/:cardBarcode`

Response'da iki yeni alan:
```json
{
  "workOrderId": "...",
  "batchNumber": "...",
  "stepId": "...",
  "stationName": "Tambur",
  "plannedFoldType": "2-KAT",      // YENİ
  "plannedLayerCount": 4,           // YENİ
  "orders": [...],
  "openFabricRolls": [...]
}
```

### `POST /api/tambur/:id/finalize-open-fabric`

Body'ye iki yeni opsiyonel override alan:
```json
{
  "scrapRemaining": false,
  "notes": "...",
  "foldType": "4-KAT",        // YENİ — verilmezse WO.foldType
  "layerCount": 6              // YENİ — verilmezse WO.layerCount
}
```

### `POST /api/tambur/finalize` (eski, barkodlu Roll'lar için)

Mevcut body alanları aynen — `foldType` + `layerCount` zaten kabul ediyordu. Davranış değişikliği yok ama metadata'ya artık `plannedFoldType` + `plannedLayerCount` da yazılır.

## Frontend gereksinimler

### A. WO planlama formu (Planlamacı)

İki yeni alan ekle (opsiyonel, "Tambur Bilgisi" başlığı altında):

- **Kat Tipi (foldType):** dropdown veya free text. Önerilen değerler dropdown'da: `"2-KAT"`, `"4-KAT"`. Custom değer için "Diğer" seçeneği + serbest input.
- **Katman Sayısı (layerCount):** `<input type="number" min="1" max="20">`.

İkisi de boş bırakılabilir (zorunlu değil). Tooltip: "Tambur operatörüne bilgi olarak iletilir; operatör gerekirse değiştirebilir."

### B. Tambur ekranı

`plannedFoldType` ve `plannedLayerCount` üstte rozet/info chip olarak gösterilsin (örn. "Planlanan: 2-KAT, 4 katman"). Görsel olarak operatöre **bilgi** olduğu belli olmalı (gri/secondary renk).

Finalize modal'ında bu değerler form'a **default olarak doldurulur**:
- foldType: `value={plannedFoldType}` (operatör değiştirebilir)
- layerCount: `value={plannedLayerCount}` (operatör değiştirebilir)

Operatör değiştirip kaydederse, override RollOperation metadata'ya yazılır. Frontend'in özel bir görsel uyarı göstermesine gerek yok (audit log raporlamada görünür).

### C. Roll history / WO detay raporları

`RollOperation.TAMBUR_PROCESSED.metadata`'da artık `plannedFoldType` / `plannedLayerCount` / `actualFoldType` / `actualLayerCount` (+ override boolean'ları yeni endpoint için) bulunur. Detay ekranında "Planlanan vs Gerçekleşen" kıyaslaması gösterilebilir.

## Test Senaryosu

1. WO oluştur: `foldType: "2-KAT"`, `layerCount: 4`.
2. Üretim akışını ilerlet (KK1 → boyahane → Kurşun → Tambur).
3. Tambur context çek → response'da `plannedFoldType: "2-KAT"`, `plannedLayerCount: 4`.
4. Açık kumaşı bitir, override gönderme → `actualFoldType: "2-KAT"`, `overriddenFoldType: false` (yeni endpoint).
5. Yeni WO oluştur, `foldType: "2-KAT"` planla.
6. Tambur'da operatör finalize'da `foldType: "4-KAT"` gönderir → metadata'da `plannedFoldType: "2-KAT"`, `actualFoldType: "4-KAT"`, `overriddenFoldType: true`.
7. WO planlamasız (`foldType: null`) bir WO için Tambur context'te `plannedFoldType: null` döner; operatör finalize'da gönderdiği değer actual olur.

## Notlar

- **Validation pragmatik:** `foldType` enum değil free string (max 32). Fabrika ileride farklı pattern kullanmak isterse migration gerek yok. Frontend dropdown'da iyi UX için sabit liste sunabilir.
- **Default null:** Mevcut WO kayıtlarında `foldType` ve `layerCount` null. Tambur ekranı null değerlerde planning rozetini gizleyebilir (UI tercihi).
- **Eski /finalize endpoint:** Barkodlu Roll'lar (boyahaneye gitmemiş) için hâlâ kullanılır. Davranış aynı; sadece metadata zenginleşti (planning bilgisi de yazılır).
- **`updateStepPlanning` etkilenmez** — bu sadece adım atama (subcontractor seçimi vb.). foldType WO seviyesinde, step seviyesinde değil.
