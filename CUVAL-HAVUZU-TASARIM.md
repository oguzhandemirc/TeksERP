# Çuval Havuzu Modeli — Sevkiyat "B Tasarımı" (2026-07)

> Bu doküman `SEVKIYAT-LOOSE-TASARIM.md`'yi (ve ondan sonra kısa süre canlı kalan
> "markReady/ShipmentAllocation" ara modelini) **süperseder**. Kanonik referanslar:
> `Teks-Erp/prisma/schema.prisma` (Shipment / Sack / SackAllocation),
> `Teks-Erp/src/services/helpers/sack-allocation.helper.ts` (rebalance),
> `Teks-Erp/scripts/test_sack_pool_lifecycle.ts` (yaşam döngüsü testi, 28 kontrol).

## Neden değişti

Eski model **sipariş-önce** idi: sevkiyat siparişlerden doğuyor, toplar sevkiyat
içindeki çuvallara okunuyordu. Saha senaryosu bunu kırdı: bir müşterinin 100 siparişi
30 çuvala paketlenmiş depoda bekliyor; müşteri arayıp yalnız belli kumaş/renkteki
çuvalları istiyor. "30 çuvaldan spec'e uyan 10'unu seç-gönder" eski modelde imkânsızdı
(sevkiyat sipariş-önce, çuval sevkiyatsız var olamıyor, kısmi dispatch yok).

## Model

**Çuval (Sack) müşteriye ait birinci sınıf depo varlığıdır.** Sevkiyat, havuzdan çuval
seçilerek kurulan ince bir "kamyon" nesnesine iner.

```
WAREHOUSE serbest top (sackId=null)
  → openSack(customerId)            → açık çuval (Sack.customerId, shipmentId=null, sealedAt=null)
  → scanIntoSack(sackId, barcode)   → Roll.sackId (shipmentId hâlâ null)
  → weighSack + sealSack            → sealedAt dolu → ÇUVAL DEPO HAVUZU
      ↳ rebalanceCustomerPool: SackAllocation (FIFO) → OrderLine.packedQty (rezerv)
  → createShipment(sackIds)         → Shipment PLANNED (çuvallar atanır, tahsis donar)
  → moveToDoor → AT_DOOR → dispatch → DISPATCHED: toplar SHIPPED, tahsis → shippedQty
  iptal: cancelShipment             → çuvallar havuza döner (mühürlü), rebalance
```

- **ShipmentStatus:** `PLANNED | AT_DOOR | DISPATCHED | CANCELLED`. (PREPARING/READY kaldırıldı.)
- **Karşılanma defteri:** `SackAllocation(sackId, orderLineId, qty)` — çuval bazlı.
  - Çuval havuzdayken (shipment=null) veya PLANNED/AT_DOOR sevkiyatta → `OrderLine.packedQty` (rezerv).
  - Çuval DISPATCHED → `OrderLine.shippedQty` (sevk defteri, kalıcı).
- **Denormlar defter-otoritatif:** `shippedQty`/`packedQty` increment/decrement DEĞİL,
  her tetikte defterden yeniden hesaplanır (`recomputeOrderStatus`, drift-free).
  `shippedQty = Σ SackAllocation(DISPATCHED) + Σ DirectShipAllocation`;
  `packedQty = Σ SackAllocation(havuz veya PLANNED/AT_DOOR)`.
- **Açık miktar:** `quantity − shippedQty − packedQty` (her openQty/Ürün Dengesi/kapsama tüketicisi).
- **Serbest stok:** `status=WAREHOUSE, shipmentId=null, sackId=null`. Havuz çuvalındaki
  top (sackId dolu) serbest DEĞİL — packedQty'de sayılır (çift sayım önlenir).

## rebalanceCustomerPool (çekirdek)

`sack-allocation.helper.ts`. Bir müşterinin **havuz** çuvallarını (shipmentId=null, mühürlü)
açık sipariş satırlarına deterministik **çuval-farkındalı FIFO** ile dağıtır:

1. Müşterinin açık satırlarını id-sıralı kilitle (`touchOrderLinesTx`).
2. Havuz SackAllocation'larını sil (yalnız shipmentId=null; donmuşlara dokunma).
3. `need(satır) = quantity − shippedQty − frozenPacked` (donmuş + sevk edilmiş düşülür).
4. Havuz çuvalları mühür sırasında (sealedAt asc); içerik spec+şube eşleşen satırlara
   FIFO (termin→tarih) dağıtılır → yeni SackAllocation'lar. Cap need'de → over-coverage imkânsız.
5. Etkilenen siparişleri recompute (packedQty + status).

**Tetikleyiciler:** seal / reopen / havuz çuvalı sil / sevkiyat kur & iptal & çuval çıkar /
dispatch / sipariş oluştur·onay·iptal·satır-düzenle·manuel-kapat·reopen (o müşteri için).

## Sevkiyat = çuval seçimi

`createShipment({sackIds})`: hepsi mühürlü + havuzda + tek müşteri/şube; EXPORT'ta tümü
tartılı. Çuvallar sevkiyata atanır (shipmentId + seq), içerik roll/swatch shipmentId
açıkça yazılır (composite FK deferred), donmuş tahsislerden `ShipmentOrder` **türetilir**
(irsaliye orderNos), kalan havuz yeniden dengelenir. Sipariş kümesi elle değiştirilemez
(retarget kaldırıldı) — çuval seçiminden türer.

## UI

- **Electron paketleme (`SackContentEdit`):** müşteri-bazlı; sipariş seç (rehber) veya
  doğrudan müşteri → açık çuvala okut → tart+kod → mühürle.
- **Electron `SackSearch`:** havuzun ana ekranı; spec (ürün/renk/en) filtresi + çoklu
  seçim → "Seçili Çuvallardan Sevkiyat Oluştur" (önizleme + destinasyon). **Kullanıcı
  senaryosunun birebir ekranı.**
- **Electron `SackStore` / mobil `SevkiyatScreen`:** PLANNED/AT_DOOR board → kapı önü / sevk.
- **Sipariş görünümü:** İstenen | Çuvallanmış (packedQty) | Sevk (shippedQty) | Açık.

## Belge zinciri (değişmedi)

İrsaliye + muhasebe fişi + accounting-export tahsis'e DEĞİL, çuval içeriğine (Sack→Roll)
dayanır (`collectShipmentDocContent`). Havuz remodeli belge zincirini bozmaz.

## Migration

`20260711120000_cuval_havuzu_remodel` — boş DB'de (`migrate reset`) oynatılacak biçimde
yazıldı (veri dönüşümü yok; tüm veriler test verisi). Sack.customerId/sealedAt eklendi,
SackAllocation tablosu, ShipmentStatus enum recreate (remove_paused deseni), ShipmentAllocation
DROP, readyAt/readyById DROP, shipment_orders_active_order_uq DROP, manualCode global unique.
`reset` seed'i otomatik koşmaz → sonrasında `npm run seed`.
