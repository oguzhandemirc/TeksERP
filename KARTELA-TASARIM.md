# KARTELA — Fason Dönüşü Modeli (Yeniden Tasarım)

> Durum: **TASARIM SABİT** (2026-06-04). Kod yazımı bu dokümana göre fazlı ilerler.
> İlgili: `SEVKIYAT-LOOSE-TASARIM.md` (çuval/sevkiyat), root `CLAUDE.md` (üretim akışı).

> ## ⚑ 2026-06-28 EK — Kartela ADET-bazlı stok + "seçerek sevk" + ölçüm opsiyonel
>
> Sahadan düzeltme: **kartelaya fiziksel ETİKET vurulmuyor; yalnız ADET sayılıyor.**
> Boyut (cm) / ağırlık (kg) bu firma için önemsiz. Müşteriye sevk: sevkiyatçı
> göndereceği kartelayı **listeden seçer** (barkod okutma YOK) ve adet **kartela
> stoğundan düşer.** Aşağıdaki §3.3'teki "cm-uzunluk" ve §4'teki "etiket basılır"
> ifadeleri bu EK ile güncellenmiştir. Veri modeli **değişmedi** (Swatch korunur,
> migration yok) — değişen UI + iki yeni uç + bir flag:
>
> - **Flag `kartela.measurementEnabled`** (default **KAPALI**; diğer UI flag'leri gibi
>   backend ENFORCE etmez). KAPALI → kabulde cm/kg girişi + kartela listelerinde
>   ölçü GÖSTERİMİ gizli (yalnız adet). Başka firmalara AÇIK satılabilir. Kartela-
>   firmasına gönderilen **topun** gerçek metresi bu flag'den **etkilenmez** (gerçek top).
> - **Kartela stoğu = ADET, `(ürün, renk)` bazında.** `GET /api/kartela/stock`
>   (`kartelaService.getStock`): `swatch.groupBy([itemId,colorId]) WHERE shipmentId
>   IS NULL AND cancelledAt IS NULL` + isim/hex batch çözümü. `colorId null` = "renksiz".
> - **Seçerek sevk (mevcut sevkiyat akışına entegre):** `POST /api/shipping/shipments/
>   :id/add-kartela` (`shippingService.addKartelaToShipment`) — ürün+renk+adet → o gruptan
>   N müsait Swatch satırı **select-then-claim** ile atomik bağlanır (FIFO; `claimed.count
>   !== count` → 409 + tam rollback), `resetSackWeightsTx`. `scanIntoShipment` gibi
>   **yalnız PLANNED** (`touchShipmentPlannedTx`); kartela tahsise girmediğinden recommit YOK.
>   Mevcut barkod-okut swatch dalı KALIR (zararsız; etiket olmadığından pratikte ölü).
> - **Yeni izin/seed/migration YOK** (stok: `kartela:read|shipping:*|mobile:tarti-paket|sevkiyat`;
>   add: mevcut `WRITE`). UI: Electron `AddKartelaDialog` (ScanInBar "Kartela Ekle", çuval
>   yoksa oto-aç) + ölçü gating (SwatchesPanel/swatchColumns→`buildSwatchColumns`/SwatchDetailSheet/
>   KartelaDetailSheet) + Genel Ayarlar "Kartela" kategorisi; mobil `KartelaStockPickerModal`
>   (Paketleme "Kartela", online-gerektirir) + KartelaKabul sheet `showMeasure` + DepoScreen null-fix.
> - Test: `Teks-Erp/scripts/test_kartela_stock_and_ship.ts` (13/13). 3 app tsc temiz + HTTP smoke geçti.
> - Ertelenen: partial index `swatches(itemId,colorId) WHERE shipmentId IS NULL AND cancelledAt IS NULL`
>   (hacim düşük; tablo büyürse ekle).

## 1. Neden değişiyor?

Müşteri geri bildirimi: mevcut kartela mantığı **yanlış**. Bugün sistem kartelayı
**Tambur'da bir rulodan kesilen tek bir numune parçası** olarak modelliyor
(mobil Tambur'daki "Kartela" düğmesi → lokal `Swatch` kaydı). Bu tamamen kalkıyor.

**Gerçek senaryo:** Kartela, **Tambur'dan çıkmış bitmiş bir ürünün fason firmada
yeni bir işleme girmesiyle** oluşur:

1. Tambur kumaşı keser → **bitmiş ürün** olarak depoya gider (`RollStatus.WAREHOUSE`).
   Tambur'da kartela ayrımı **YOK**.
2. Depodan personel bitmiş bir **topu okutur** → bir fason firmaya (ör. "Kartela A.Ş.")
   **top olarak** gönderir.
3. Top fasonda işlenir → **kartela olarak** geri döner.
4. **1 top gidip N kartela olarak dönebilir** (1 giriş → N çıkış dönüşümü).
5. **Top tamamen tükenir** — artan kumaş geri dönmez; orijinal top kapanır.

## 2. Temel kararlar (kilitli)

| # | Karar | Sonuç |
|---|---|---|
| WO | **İş emri YOK** | Sevk+kabul belge çifti + Swatch soy ağacı tam izlenebilirlik verir. WO üretim raporlarını kirletmesin. |
| Akış | **Ayrı temiz akış** (üretim fasonunu genelleştirme) | Yeni `Kartela*` tabloları; üretim fason koduna dokunulmaz. |
| Kartela tablosu | **`Swatch` korunur**, doğum yeri taşınır | Tambur değil → `KartelaReceipt`. cm-uzunluk + çuval/sevkiyat entegrasyonu aynen kalır. |
| Tüketim | **Top komple tükenir** | Parent roll → `KARTELA_CONSUMED`, kısmi düşüm yok. |
| Ölçüm | **~~Uzunluk (cm) + ağırlık (kg) opsiyonel~~** → flag arkasında, default KAPALI (bkz. ⚑ 2026-06-28 EK) | Kartela esasen **ADET**; ölçü `kartela.measurementEnabled` AÇIKsa girilir/gösterilir. **Etiket basılmaz** (etiketsiz, adet sayılır). |
| Ölçüm girişi (mobil) | **Hem toplu hem tek-tek** | Dönen tüm kartelalara tek kg/cm uygula **veya** her birine ayrı gir. |
| Durum | **Yeni enumlar** `AT_KARTELA` + `KARTELA_CONSUMED` | Rapor/rozet netliği ("Fasonda" değil "Kartelada"). |
| Eşleştirme | **Top-bazlı otomatik** | Kabulde firma seç → `AT_KARTELA` bekleyen toplar listelenir → dispatch bağı her topun üstünden otomatik çözülür. |
| Firma | **Çok firma** | Fason firma listesi + "Kartela" kategorisi (`appliesColor=false`). |
| Yetki | **Yeni** `kartela:read/write`, `mobile:kartela-sevk`, `mobile:kartela-kabul` | Kartela görevini üretim-fason yetkisi açmadan verebilmek için. |
| Kartelalık işareti | **`Roll.markedForKartela`** | Tambur finalize'da set (mobil checkbox), depoda bulunabilirlik filtresi. Sevki **engellemez**. Kaldırma = backend toggle (frontend gerekmez). |

## 3. Veri modeli

### 3.1 Yeni enum değerleri (`RollStatus`)
- `AT_KARTELA` — top kartela firmasında işlemde.
- `KARTELA_CONSUMED` — kabulde kapandı; metraj N kartela olarak doğdu (parent retire).

### 3.2 Yeni modeller

```prisma
model KartelaDispatch {
  id              String    @id @default(uuid())
  dispatchNo      String    @unique @db.VarChar(64) // KD-YYMM-NNNNNN
  subcontractorId String                            // Kartela fason firma
  plateNumber     String?
  driverName      String?
  dispatchedAt    DateTime  @default(now())
  dispatchedById  String?
  notes           String?
  totalQty        Decimal   @default(0) @db.Decimal(12, 3) // sevk metrajı snapshot
  printSnapshot   Json?     // çeki listesi / irsaliye snapshot

  cancelledAt   DateTime?
  cancelledById String?
  cancelReason  String?

  subcontractor Subcontractor          @relation("KartelaDispatchSub", fields: [subcontractorId], references: [id])
  dispatchedBy  User?                  @relation("KartelaDispatchBy", fields: [dispatchedById], references: [id])
  cancelledBy   User?                  @relation("KartelaDispatchCancelledBy", fields: [cancelledById], references: [id])
  items         KartelaDispatchItem[]
  receipts      KartelaReceipt[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // index: dispatchedAt, [subcontractorId, dispatchedAt], dispatchedById, cancelledById
}

model KartelaDispatchItem {
  id               String   @id @default(uuid())
  dispatchId       String
  rollId           String
  dispatchedQty    Decimal  @db.Decimal(12, 3)
  dispatchedWeight Decimal? @db.Decimal(12, 3)

  dispatch     KartelaDispatch       @relation(fields: [dispatchId], references: [id], onDelete: Cascade)
  roll         Roll                  @relation("RollKartelaDispatchItems", fields: [rollId], references: [id])
  receiptItems KartelaReceiptItem[]  @relation("KartelaReceiptItemSource")

  createdAt DateTime @default(now())
  // index: dispatchId, rollId
}

model KartelaReceipt {
  id              String    @id @default(uuid())
  receiptNo       String    @unique @db.VarChar(64) // KR-YYMM-NNNNNN
  manifestNo      String?   @db.VarChar(64)
  dispatchId      String?                           // bilgi amaçlı; bağ top üstünden de var
  subcontractorId String
  receivedAt      DateTime  @default(now())
  receivedById    String?
  notes           String?

  cancelledAt   DateTime?
  cancelledById String?
  cancelReason  String?

  dispatch      KartelaDispatch?     @relation(fields: [dispatchId], references: [id])
  subcontractor Subcontractor        @relation("KartelaReceiptSub", fields: [subcontractorId], references: [id])
  receivedBy    User?                @relation("KartelaReceiptBy", fields: [receivedById], references: [id])
  cancelledBy   User?                @relation("KartelaReceiptCancelledBy", fields: [cancelledById], references: [id])
  items         KartelaReceiptItem[]
  swatches      Swatch[]             @relation("SwatchFromReceipt") // bu kabulde doğan kartelalar

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // index: receivedAt, [subcontractorId, receivedAt], dispatchId
}

model KartelaReceiptItem {
  id                   String  @id @default(uuid())
  receiptId            String
  consumedRollId       String                  // KARTELA_CONSUMED'a çekilen orijinal top
  sourceDispatchItemId String?                 // otomatik eşleşen kaynak sevk kalemi
  kartelaCount         Int                     // bu toptan doğan kartela adedi (1 top → N)
  notes                String?

  receipt            KartelaReceipt        @relation(fields: [receiptId], references: [id], onDelete: Cascade)
  consumedRoll       Roll                  @relation("RollKartelaConsumed", fields: [consumedRollId], references: [id])
  sourceDispatchItem KartelaDispatchItem?  @relation("KartelaReceiptItemSource", fields: [sourceDispatchItemId], references: [id])

  createdAt DateTime @default(now())
  @@unique([receiptId, consumedRollId])
  // index: receiptId, consumedRollId, sourceDispatchItemId
}
```

### 3.3 `Swatch` değişiklikleri (repurpose)
- **Ekle:** `parentReceiptId String?` → `KartelaReceipt` (`SwatchFromReceipt` relation). Doğum batch'i.
- **Koru:** `parentRollId` → her kartelanın kaynağı orijinal (tükenen) top.
- **Kaldır:** `workOrderId` + `workOrder` relation (WO yok).
- **Değiştir:** `length` → **nullable** (`Decimal?`). `weightKg` zaten nullable. `width` zaten nullable (parent'tan miras).
- **Koru:** `cardNumber`/`barcode` (`SW-...`), `purpose`, çuval/sevkiyat (`shipmentId`/`sackId`) entegrasyonu.

### 3.4 `Roll` değişiklikleri
- **Ekle:** `markedForKartela Boolean @default(false)` — Tambur finalize'da set; depo/kartela-sevk worklist filtresi. Sevki engellemez.

## 4. Akış + durum geçişleri

```
Tambur kesim → Roll(status=WAREHOUSE, markedForKartela=?)   ◀── depoya bitmiş ürün
                          │
          [Kartela Sevk]  │  personel topu okutur, firma seçer
                          ▼
        KartelaDispatch (KD-) + KartelaDispatchItem
        Roll.status: WAREHOUSE → AT_KARTELA
                          │
          [Kartela Kabul] │  firma seç → AT_KARTELA toplar → her top için adet (+ops. kg/cm)
                          ▼
        KartelaReceipt (KR-) + KartelaReceiptItem(kartelaCount=N)
        Roll.status: AT_KARTELA → KARTELA_CONSUMED        (top komple tüketildi)
        N × Swatch doğar (parentReceiptId + parentRollId; ops. length/weightKg)
        Barkod SW- kabulde üretilir; ETİKET kabulden sonra basılır
                          │
                          ▼
        Kartela envanteri → (mevcut) Shipment/Sack ile sevk
```

**İptaller (simetrik, soft — kayıt silinmez):**
- **Sevk iptali:** `KartelaDispatch.cancelledAt` set; toplar `AT_KARTELA → WAREHOUSE`. Kabul yapılmışsa engellenir.
- **Kabul iptali:** `KartelaReceipt.cancelledAt` set; doğan Swatch'lar geri alınır (downstream — çuval/sevkiyat — yoksa); toplar `KARTELA_CONSUMED → AT_KARTELA`. Downstream bağlı Swatch varsa per-record önizleme + engel ([[feedback_destructive_actions_confirm]]).

## 5. Backend

### 5.1 `kartela.service.ts` (mevcut `subcontractor.service.ts` aynası, WO'suz)
- `dispatch({ subcontractorId, rollIds, plateNumber?, driverName?, notes? }, userId)` — `WAREHOUSE` topları doğrula → `KD-` üret → item'lar → `AT_KARTELA`. Idempotency: aynı firma+toplar açık sevki varsa retry kabul.
- `cancelDispatch(id, reason, userId)` — soft cancel; toplar `WAREHOUSE`'a döner. Kabul varsa engelle.
- `receive({ subcontractorId, manifestNo?, notes?, returns: [{ rollId, count, measure?: { mode:'bulk'|'each', kg?, cm?, items?:[{kg?,cm?}] } }] }, userId)` — `KR-` üret; her `returns[]` için: orijinal top `KARTELA_CONSUMED` + `KartelaReceiptItem(kartelaCount=count)` + `count` adet `Swatch` doğur (`SW-` barkod, length=cm, weightKg=kg; bulk→hepsine aynı, each→sırayla). `withBarcodeRetry` ile P2002 koruması.
- `cancelReceipt(id, reason, userId, cascadeSwatchIds[])` — Swatch'ları geri al (downstream güvenli ise) + toplar `AT_KARTELA`.
- `getReceiptCancelPreview(id)` — doğan Swatch'ların downstream bağ (shipment/sack) önizlemesi.
- `listDispatches` / `listReceipts` (cursor + filtre: firma, tarih, iptal) ; `getDispatch` / `getReceipt` (detay + çeki listesi/`items`/`swatches`).
- `outstandingRolls({ subcontractorId })` — kabul worklist'i: `AT_KARTELA` toplar (+ kaynak dispatch).
- `setRollMarkedForKartela(rollId, value, userId)` — `markedForKartela` toggle (Tambur'dan set + backend kaldırma).
- Barkod: `nextPrefixedSequence` tablo union'ına `kartelaDispatch | kartelaReceipt`; Swatch için mevcut `SW-` sequence. Tüm CUD'de `AuditService.log` (`KARTELA_DISPATCH` / `KARTELA_RECEIPT` / `SWATCH`).
- **Not:** Traveler-card scan (logTravelerScan) WO gerektirdiği için kartelada **atlanır**.

### 5.2 Controller + routes + yetki
- `kartela.controller.ts` (Zod) + `kartela.routes.ts` (`verifyToken` + `requireAnyPermission`) + `app.ts` → `app.use("/api/kartela", kartelaRoutes)`.
- Endpoint yetkileri: sevk `kartela:write | mobile:kartela-sevk`; kabul `kartela:write | mobile:kartela-kabul`; listeler `kartela:read | mobile:*`.
- `seed.ts`: `kartela:read/write` (modül `KARTELA`), `mobile:kartela-sevk`, `mobile:kartela-kabul` + template kartları. Canlı DB'ye de INSERT.

### 5.3 Temizlik
- **Sil:** `tambur.service.createSwatch` + `recut/handleRecutKartela` doğum yolu, `tambur.controller.createSwatch`, route `POST /api/tambur/swatch`, `tambur.service.nextSwatchSequence` (kartela servisine taşınır).
- **Koru:** Swatch listele/stats/by-barcode (envanter + çuval okutma hâlâ kullanır).
- **Güncelle:** `label.service.getSwatchLabel` — `workOrderId` kalktığı için WO→sipariş→müşteri türetmesi düşer; müşteri gevşek modelde baskı anında seçilir (top etiketi gibi).

## 6. Mobil (`mobil/`)

### 6.1 Yeni modüller (FasonSevk/FasonKabul aynası)
- **Kartela Sevk** (`mobile:kartela-sevk`): firma seç → depo topları okut/seç (`markedForKartela` rozetli; ama her top gönderilebilir) → sevk. 3-kart düzeni.
- **Kartela Kabul** (`mobile:kartela-kabul`): firma seç → `AT_KARTELA` bekleyen toplar → her top için **kartela adedi** + ops. ölçüm.
  - **Ölçüm girişi 2 mod:** *Toplu* (tek kg + tek cm → dönen tüm kartelalara uygula) / *Tek-tek* (her kartelaya ayrı kg/cm). "Dönen Açık Kumaş" batch-input deseni temel alınır.
- Kayıt: `permissions.ts` (`MobileScreenKey` + `MOBILE_SCREENS`), `tokens.ts` `moduleAccents`, `MainNavigator` `SCREEN_LOADERS`. Servis `kartela.service.ts`. Offline mutation key'leri (`KARTELA_SEVK_DISPATCH`, `KARTELA_KABUL_RECEIVE`).

### 6.2 Tambur temizliği + kartelalık
- **Sil:** iki "Kartela" düğmesi + `swatchMutation` + `recutSwatchMutation` + `addKartela`/`handleRecutKartela`.
- **Ekle:** finalize formunda küçük **"Kartelalık" checkbox** → `markedForKartela` set (depoda bulunurluk). Kaldırma ekranı şimdilik yok.

## 7. Electron admin (`Electron/`) — Takip

`src/pages/Operations/Kartela/`: `types.ts`, `service.ts`, `kartelaColumns.tsx`, `KartelaDetailSheet.tsx`, `KartelaPage.tsx`.
- **KartelaPage:** Sekmeler **Sevkler** (ne gönderdim) / **Kabuller** (ne geldi); cursor liste + firma/tarih filtresi. Satıra tıkla → `Sheet` (sağ slide-over) detay.
- **Detay (SideOver):** Sevk → çeki listesi (toplar + metraj/ağırlık + firma + tarih + personel + iptal). Kabul → tüketilen toplar + doğan kartelalar (adet/ölçüm) + manifest.
- Kayıt: `content-routes.tsx` (`operations/kartela`, `kartela:read`), `tile-config.ts` (hub kartı). Tab meta otomatik.
- **SwatchesPanel repurpose:** `workOrder` kolonu kalkar; kaynak `parentReceipt`/dispatch + firma gösterilir (kartela artık fasondan doğuyor).

## 8. Faz planı

| Faz | Kapsam | Çıktı | Durum |
|---|---|---|---|
| **A** | Backend şema + çekirdek servis | Prisma model/enum + migration + `kartela.service.ts` | ✅ DONE |
| **B** | Controller + routes + yetki + temizlik | API yüzeyi + seed + Tambur/label temizliği | ✅ DONE |
| **C** | Mobil Kartela Sevk + Kabul | 2 ekran + servis + modül kaydı + Tambur temizliği | ✅ DONE |
| **D** | Electron takip ekranı | Kartela sayfası + detay SideOver + SwatchesPanel repurpose | ✅ DONE |

> **2026-06-04: TÜM FAZLAR UYGULANDI.** Üçü de tsc temiz; backend akış (sevk→kabul
> 1top→Nkartela→iptaller) ve admin HTTP endpoint'leri gerçek veriyle doğrulandı.
>
> **Kartelalık checkbox da eklendi:** mobil Tambur kesim footer'larında (recut +
> açık-kumaş) "Kartelalık" checkbox'ı. Backend `cutWarehouseRoll` / `cutOpenFabric`
> / `finalize` endpoint'lerine `markedForKartela` parametresi geçirildi — çıktı topu
> (yalnız WAREHOUSE) işaretli doğar. Kesimler arası kalıcı, finalize'da sıfırlanır.
> Doğrulandı: kesim→çocuk top markedForKartela=true, envanter korunur.

> Sıra A→B→C→D. Her faz derlenir/typecheck'ten geçer. Domain kuralları root `CLAUDE.md`
> ve [[project_coverage_hybrid]] / [[project_shipping_simplified_faza]] ile tutarlı kalır.
