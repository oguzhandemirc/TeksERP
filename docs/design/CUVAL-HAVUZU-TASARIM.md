# Çuval Depo Modeli — Sevkiyat (2026-07)

> Bu doküman `../history/SEVKIYAT-LOOSE-TASARIM.md`'yi, ondan sonra kısa süre canlı kalan
> "markReady/ShipmentAllocation" ara modelini **ve** onu izleyen "çuval havuzu"
> (mühür + `rebalanceCustomerPool` + `packedQty` rezerv) modelini **süperseder**.
> Kanonik referanslar:
> `Teks-Erp/prisma/schema.prisma` (Shipment / Sack / SackAllocation),
> `Teks-Erp/src/services/shipping.service.ts` (`computeSackAllocations` / `writeShipmentAllocationsTx`,
> `Teks-Erp/src/services/helpers/allocation.helper.ts:distributeSacksToLines` üzerinden sevk-anı tahsis),
> `Teks-Erp/scripts/test_sack_pool_lifecycle.ts` (yaşam döngüsü testi, 33 kontrol).

## Neden değişti

Önceki "havuz" modeli çuvalı **mühürleyip** (`sealSack`) mühür anında müşterinin açık
sipariş satırlarına `rebalanceCustomerPool` FIFO'suyla **rezerve** ediyordu
(`OrderLine.packedQty`). Bu, sahanın istemediği bir "erken taahhüt" yüküydü: çuval daha
depodayken sipariş defteri kilitleniyor, mühür/aç-kapa her seferinde tüm müşteriyi yeniden
dengeliyor, "hangi çuval hangi siparişe" kararı fiziksel sevkten çok önce donuyordu.

Yeni model bunu **sevk anına** erteler: çuval sadece bir **depo nesnesidir**; sipariş
karşılanması yalnızca sevkiyat kurulurken (seçilen siparişlere) ve stok düşüşü yalnızca
**dispatch**'te olur. Mühür yok, rezerv yok, `rebalanceCustomerPool` yok.

## Model

**Çuval (Sack) bir depo nesnesidir.** Açılır, içine top/kartela okutulur, opsiyonel brüt
tartılır. İki hâli vardır:

- **Depoda** (`shipmentId = null`): her an düzenlenebilir (top ekle/çıkar/taşı, sil, tart).
  Çuval `customerId` **opsiyoneldir** — bilinen sipariş için açılışta atanabilir, yoksa
  depoda müşterisiz "genel stok çuvalı" olarak durur.
- **Sevk edilmiş / atanmış** (`shipmentId` dolu): bir sevkiyata bağlıdır, içeriği kilitlidir.

```
WAREHOUSE serbest top (sackId = null)
  → openSack(customerId?)            → çuval DEPODA (shipmentId=null, customerId opsiyonel)
  → scanIntoSack(sackId, barcode)    → Roll.sackId (çuval hâlâ depoda, düzenlenebilir)
  → (opsiyonel) weighSack            → brüt kg + kod (irsaliye için; rezerv/mühür YOK)
  → createShipment({ sackIds, customerId, branchId?, orderIds? })
        çuvallar atanır (shipmentId + seq), müşteri/şube çuvala backfill edilir,
        SEÇİLEN siparişlere SackAllocation yazılır (distributeSacksToLines, spec+şube FIFO).
        Sevk onayı KAPALI (varsayılan) → aynı adımda DISPATCHED; AÇIK → PLANNED kalır
        (shippedQty HÂLÂ değişmez).
  → dispatchShipment → DISPATCHED (onay açıkken; kapı önü ara adımı YOK):
        toplar SHIPPED (stok bina dışı), DISPATCHED tahsisler → OrderLine.shippedQty terfi.
  iptal: cancelShipment              → sevkiyatın tahsisleri silinir, çuvallar DEPOYA döner.
```

- **ShipmentStatus:** `PLANNED | DISPATCHED | CANCELLED`. (PREPARING/READY/AT_DOOR yok — kapı önü ara adımı kaldırıldı.)
- **Karşılanma defteri:** `SackAllocation(sackId, orderLineId, qty)` — çuval bazlı, "ne kadar
  metraj", "hangi top" değil. Yalnız **sevkiyata atanmış** çuvalların tahsisi olur; depodaki
  çuvalın tahsisi **yoktur** (rezerv kalktı).
  - Çuval PLANNED sevkiyatta → tahsis bekler, `shippedQty`'ye **sayılmaz**.
  - Çuval DISPATCHED → tahsis `OrderLine.shippedQty`'ye sayılır (sevk defteri, kalıcı).
- **Denorm defter-otoritatif:** `shippedQty` increment/decrement DEĞİL, her tetikte defterden
  yeniden hesaplanır (`recomputeOrderStatusForOrders` → `computeLineLedger`, drift-free).
  `shippedQty = Σ SackAllocation(çuval DISPATCHED) + Σ DirectShipAllocation`.
- **Sipariş görünümü:** **İstenen | Sevk | Açık** — `Açık = quantity − shippedQty`.
  (Rezerv/`packedQty` sütunu yok; düşüş yalnız sevkte.)
- **Serbest stok:** `status=WAREHOUSE, shipmentId=null, sackId=null`. Depo çuvalındaki top
  (sackId dolu, shipmentId null) fiziksel olarak hâlâ depodadır ama serbest listeye girmez.

## Sevkiyat = çuval seçimi

`createShipment({ sackIds, customerId, branchId?, orderIds?, destination?, procedureCode? })`:
seçilen çuvalların **hepsi depoda** olmalı; `customerId` zorunlu (çuvalı olmayanlara backfill
edilir), EXPORT'ta tümü tartılı. Çuvallar sevkiyata atanır (shipmentId + seq), içerik
roll/swatch shipmentId açıkça yazılır (composite FK deferred). Sipariş kümesi **kullanıcı
seçimidir** (`orderIds`) — `ShipmentOrder` bundan kurulur; tahsis
(`computeSackAllocations`/`writeShipmentAllocationsTx` → `distributeSacksToLines`) seçilen
siparişlere spec+şube FIFO ile yazılır.

- **Fazla / eşleşmeyen / siparişsiz sevk serbesttir.** Sipariş ihtiyacından fazla metraj →
  tahsis need'de kapanır, fazlası yine sevk edilir; hiç sipariş seçilmezse hiçbir siparişten
  düşülmez. `previewCreateShipment` bunları `warnings[]` + `totals.surplusMeters` ile önden
  gösterir (DB'ye yazmaz).
- **İptal:** `cancelShipment` sevkiyatın `SackAllocation`'larını siler, çuvalları depoya
  (shipmentId=null, seq=null) döndürür, etkilenen siparişleri recompute eder. DISPATCHED
  olmadığı için `shippedQty` zaten 0'dı → sipariş etkilenmez.

## UI

- **Electron paketleme (`SackContentEdit`):** çuval aç → açık çuvala okut → (opsiyonel
  tart). Mühür yok — çuval depoda düzenlenebilir kalır.
- **Electron `SackSearch`:** depo çuvallarının ana ekranı; spec (ürün/renk/en) filtresi +
  çoklu seçim → "Seçili Çuvallardan Sevkiyat Oluştur" (önizleme + müşteri/şube/sipariş
  seçimi). **Kullanıcı senaryosunun birebir ekranı.**
- **Electron `SackStore` / mobil `SevkiyatScreen`:** PLANNED board → sevk (dispatch).
- **Sipariş görünümü:** İstenen | Sevk (shippedQty) | Açık (quantity − shippedQty).

## Belge zinciri (değişmedi)

İrsaliye + muhasebe fişi + accounting-export tahsis'e DEĞİL, çuval içeriğine (Sack→Roll)
dayanır (`collectShipmentDocContent`). Depo remodeli belge zincirini bozmaz. İrsaliyedeki
çuval kodu artık `Sack.sackNo`'dur (ayrı `manualCode` alanı kaldırıldı).

## Migration

`20260712000000_cuval_depo_no_seal` — mühür/rezerv modelini söker: `OrderLine.packedQty` +
`Order.packedQty` DROP, `Sack.sealedAt` + `Sack.sealedById` DROP (+ FK/index), `Sack.customerId`
NULLABLE, havuz/liste index'i `sacks(customerId, sealedAt)` → `sacks(customerId, createdAt)`.
Öncesindeki `20260711120000_cuval_havuzu_remodel` (Sack/SackAllocation + ShipmentStatus recreate)
tabanının üstüne biner; `20260712120000_drop_sack_manual_code` ayrıca `Sack.manualCode`'u ve
`sack.codeTemplate` ayarını kaldırır (çuval yalnız `sackNo` ile yürür). Tümü boş DB'de
(`migrate reset` + `npm run seed`) oynatılacak biçimde yazıldı; veri dönüşümü yok (tüm veriler
test verisi).
