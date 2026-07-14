# TeksERP — Monorepo Kökü

Tekstil fabrikası ERP sistemi. Üç alt proje:

| Proje | Stack | Port |
|---|---|---|
| `Teks-Erp/` | Express 5 + Prisma 7 + PostgreSQL backend | 4000 |
| `Electron/` | Electron 42 + React 19 + Vite yönetim paneli | 5174 |
| `mobil/` | React Native + Expo 54, Android tablet (yatay) + telefon (dikey) — saha | — |

Her alt projenin kendi `CLAUDE.md`'si vardır. **Admin frontend değişiklikleri `Electron/`'a yazılır** — `React/` dizini artık yok.

## Üretim Akışı

```
Stok (Roll) → İş Emri → KK1 (RAW_QC) → [opsiyonel Fason] →
  Kurşun + KK2 (PROCESS_QC) → Tambur (final karar) →
  Depo (RollStatus.WAREHOUSE) →
  Çuval Depo (Sack — depo nesnesi, müşteri opsiyonel; aç→okut→(opsiyonel tart), mühür/rezerv YOK) →
  Sevkiyat (depodan çuval seç + müşteri/sipariş ata → PLANNED → DISPATCHED)
```

Fabrika **çözgü/dokuma yapmaz** — kumaş hazır gelir, sadece process + QC + tambur yapılır.

**Her rotanın SON adımı** topu final ürüne çeker — Tambur özel değil (2026-07-13). Kaliteden çözülen `RollStatus` (varsayılan `WAREHOUSE`; `QualityGrade.targetStatus` override, seed'de üç kalite de WAREHOUSE; kalite null → WAREHOUSE) + `form=ACIK` (Tambur çocukları `TOP`) + barkodsuz açık kumaşa barkod. `PRODUCED` limbosu **kaldırıldı** (enum'dan da düştü). Tambur = kesim/bölme + kalite kararı istasyonu; "final ürün kapısı" DEĞİL. Ham (renksiz) top kesiminde operatör parçayı `STOCK` (üretime devam) da seçebilir. Depo bir istasyon değil, tartı/paket öncesi bekleme statüsüdür.

> **NOT:** Tartı / paket / sevkiyat modülü **2026-07'de çuval depo modeline** geçti (`/api/shipping`, Shipment / Sack / **SackAllocation** / ShipmentOrder). Çuval bir **depo nesnesidir**; `Sack.customerId` **opsiyonel** (açılışta atanabilir, yoksa sevkte atanır), **mühür yok**. Akış: aç→okut→(opsiyonel tart) → çuval DEPODA (`shipmentId=null`, her an düzenlenebilir). **Rezerv yok** — `OrderLine.packedQty`/`Order.packedQty` ve `rebalanceCustomerPool` kaldırıldı; sipariş görünümü **İstenen | Sevk | Açık** (`Açık = quantity − shippedQty`). Sevkiyat depodan **çuval seçilerek** kurulur (`createShipment({ sackIds, customerId, orderIds? })`); sevk onayı (`shipping.confirmationEnabled`, varsayılan **kapalı**) → çuvallar **doğrudan sevk** edilir (`DISPATCHED`, yanıtta `dispatched=true`), onay **açık** → sevkiyat `PLANNED` kalır ve çıkış ayrıca `dispatchShipment` ile onaylanır — kapı önü ara adımı YOK (`PLANNED → DISPATCHED`). `SackAllocation` **sevk anında** seçilen siparişlere spec+şube FIFO ile yazılır (`distributeSacksToLines`). Stok yalnız DISPATCH'te `SHIPPED` düşer ve tahsis **dispatch'te** `shippedQty`'ye terfi eder (PLANNED tahsis sayılmaz). İptalde tahsis silinir, çuval depoya döner. Top→sipariş bağı yok. Tasarım: `docs/design/CUVAL-HAVUZU-TASARIM.md` (eski `docs/history/SEVKIYAT-LOOSE-TASARIM.md` superseded).

> **NOT (2026-07-13 — "her rota final üretir"):** Fabrika jenerik bir operasyon servisi — bir WO herhangi bir işlem dizisidir, **son adımın çıktısı her zaman final ürün** (`finalizeRollsAtLastStep`). **Tambur zorunlu değil:** rota Kurşun/QC2 ile bitebilir (→ açık kumaş final) veya **fason (boyahane) ile bitebilir** (fason kabulü finalize eder — doğan açık-kumaş toplar `WAREHOUSE` + barkod, `form=ACIK`; eski STOCK-orphan limbosu kalktı). **top ⟺ Tambur; açık kumaş ⟺ diğer istasyonlar.** **`Roll.form` (TOP|ACIK)** otomatik. **`Roll.qualityGrade` NULLABLE** — kaliteyi yalnız kalite istasyonları (KK1 opsiyonel giriş, KK2/Kurşun, Tambur) belirler; kalitesiz top UI'da "—", istatistikte "Belirsiz". **WO artık `WAREHOUSE`/`A1_STOCK` topu da tüketir** (bir depo topu yeni WO'ya sokulabilir — örn. zımpara ya da WAREHOUSE açık kumaşı Tambur'a; finalize geri döndürür; detach: renksiz→STOCK, renkli→kalite/WAREHOUSE; çuval/sevkteki top bağlanamaz). Süpervizör **"Durum Düzelt" + "recover-to-production" KALDIRILDI** → yerine **IN_PRODUCTION-stuck "Kurtar"** (istasyonda takılı topu güvenle depoya al: açık movement kapanır, barkod üretilir, adım/WO recompute; `roll:manual-adjust`).

## Domain Kuralları

- **Phase 1:** COM port / donanım entegrasyonları sadece simüle edilir — gerçek donanım kodu yazma.
- **Tüm veriler test verisi** — uzun vadeli doğruluk için optimize et, seed satırlarıyla backwards compat derdine girme.
- **İş emri esnekliği:** Bir iş emri birden fazla siparişe bağlanabilir veya hiçbir siparişe bağlı olmadan stok için üretilebilir.
- **WO kapsamı = sadece üretim:** `WorkOrder` yalnızca üretimi (istasyonlar, kurşun/QC2, tambur) yönetir. Tartı / paket / sevkiyat ayrı bir domain'dir (`shipping.service.ts`) — WO'ya değil, depoya/çuvala bağlanır.
- **Şube bazlı planlama:** `Order.branchId` opsiyonel (eski kayıtlar `null`). Yeni siparişler tek bir şubeye yönlendirilir.
- **Refakat Kartı (Traveler Card):** İş emri **açılışında** doğan barkodlu kart (2026-07-14 "kart iş emriyle doğar"; bir WO = tek kart, `TravelerCard.workOrderId @unique`, karekod = İş Emri No). Fiziksel olarak malla birlikte hareket eder ve okutulduğunda istasyon süreçlerini tetikler. Parti (Batch) yeni kart üretmez.
- **İş Emri No ≠ Parti (2026-07-13):** `WorkOrder.workOrderNumber` (İE+GGAAYY+NNNN) üretim emridir; `Batch` (P+GGAAYY+NNNN) üretime aynı anda giren top grubudur (bir WO N parti içerir). Eski "dal"/`batchSplitId` kavramı kalktı. Tasarım: `docs/design/PARTI-MODELI-TASARIM.md`.
- **Kartela fason (Swatch):** Bitmiş top kartela firmasına gider, fasonda N kartela (`Swatch`) olarak döner (`KartelaDispatch`/`KartelaReceipt`, `AT_KARTELA`/`KARTELA_CONSUMED`). Üretim fasonundan ayrı, WO'suz akış. Tasarım: `docs/design/KARTELA-TASARIM.md`.
- **İdempotency (2026-07-14):** Kayıt-yaratan uçlar istemci `clientToken @unique` taşır (Roll, Order, WorkOrder) — timeout-retry'de mükerrer kayıt önlenir; sayaç-bazlı kartela düşümü için ayrı `SwatchStockReduction` olay modeli (`clientToken @unique` onda; `KartelaDispatch`'te token YOK). Durum geçişleri **atomik claim** (`updateMany WHERE {id, beklenen-durum}` + `count===0 → 409`; `findUnique→if→update` YASAK).
- **Kurşun + QC2 = tek fiziksel istasyon (`StationKind.PROCESS_QC`):** Tek bir `WorkOrderStep` olarak modellenir. Per-roll `RollOperation` log'u `KURSUN_APPLIED` / `QC2_COMPLETED` olarak iz tutar — her top kurşun görmez.
- **Hata yaşam döngüsü:** `RollError` PROCESS_QC'de (hata Tambur'da görülürse Tambur'da da) açılır; Tambur kararıyla kapanır (`isProcessed = true`, `actionTaken = CUT|NO_CUT`). Redye/parti ayırmada Tambur dışında `NO_CUT` ile idari kapanış olabilir.
- **Fason dönüş:** Kabulde orijinal rulolar `SUBCONTRACTOR_CONSUMED` ile emekliye ayrılır; makbuz (receipt) üzerinden `parentReceiptId`'li **yeni açık-kumaş `Roll`'lar doğar** (`entrySource=SUBCONTRACTOR_RETURN`, barcode null). Kabulde metraj girilir (zorunlu, ağırlık opsiyonel); kesin ölçüm sonraki istasyonun `FINISH`'inde damgalanır.
- **Roll split:** Sadece Tambur'da (`CUT` kararı) olur — `parentRollId` + yeni barkod ile çocuk roll yaratılır.

## Ortak Konvansiyonlar

- UUID primary key, tüm modellerde `createdAt`/`updatedAt` (M:N pivot ve append-only log tabloları hariç — bunlarda sadece `createdAt`).
- Sadece soft delete — `isActive: false` veya `RollStatus.CANCELLED` (`SCRAP` = gerçek fire **kararıdır**, arşivleme değil); **asla** fiziksel DELETE. Bilinçli istisnalar: bağımlılık-guard'lı master-data `DELETE /:id/permanent` uçları, boş çuval silme, cihaz unpair, pivot replace.
- Her CUD operasyonu → `AuditService.log()` → `SystemLog` tablosu. (İstisna: `UserPreference` kişisel UI blob'u. Audit **best-effort**'tur — yazım hatası isteği düşürmez, `/health` sayacına düşer; çağrı tx **dışında** yapılır.)
- Validation hata mesajları Türkçe.
- **Yıkıcı işlemlerde detaylı onay zorunlu** (iptal/sil/scrap): confirm dialog'unda etkilenen her kaydı (WO, rulo, sipariş vb.) somut olarak listele. Backend tarafında preview endpoint döner, frontend per-record seçim sunar — "X kayıt etkilenecek" gibi soyut sayı yetmez.

## Test Kullanıcıları

En sık kullanılan: `admin` / `123123` (tam yetki). Seed kullanıcılar `Teks-Erp/ARCHITECTURE.md §13`'te listeli. Admin dışı tüm kullanıcılar `test123` şifresini kullanır.
