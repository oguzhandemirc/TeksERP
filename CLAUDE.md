# TeksERP — Monorepo Kökü

Tekstil fabrikası ERP sistemi. Üç alt proje:

| Proje | Stack | Port |
|---|---|---|
| `Teks-Erp/` | Express 5 + Prisma 7 + PostgreSQL backend | 4000 |
| `Electron/` | Electron 33 + React 19 + Vite yönetim paneli | 5174 |
| `mobil/` | React Native + Expo 54, Android tablet (yatay) + telefon (dikey) — saha | — |

Her alt projenin kendi `CLAUDE.md`'si vardır. **Admin frontend değişiklikleri `Electron/`'a yazılır** — `React/` dizini artık yok.

## Üretim Akışı

```
Stok (Roll) → İş Emri → KK1 (RAW_QC) → [opsiyonel Fason] →
  Kurşun + KK2 (PROCESS_QC) → Tambur (final karar) →
  Depo (RollStatus.WAREHOUSE) →
  Çuval/Tartı (Sack) → Sevkiyat (PREPARING → READY → AT_DOOR → DISPATCHED)
```

Fabrika **çözgü/dokuma yapmaz** — kumaş hazır gelir, sadece process + QC + tambur yapılır.

Tambur'dan çıkan üretim topu **önce depoya** geçer (`status=WAREHOUSE` — default; `QualityGrade.targetStatus` katalogdan override edilebilir, seed'de üç kalite de WAREHOUSE). Ham (renksiz) top kesiminde operatör parçayı `STOCK` (üretime devam) da seçebilir. Depo bir istasyon değil, tartı/paket öncesi bekleme statüsüdür.

> **NOT:** Tartı / paket / sevkiyat modülü 2026-06 başında sıfırdan yeniden yazıldı ve canlı (`/api/shipping`, Shipment/Sack/ShipmentAllocation modelleri). Stok yalnız DISPATCH'te `SHIPPED` düşer; READY=Çuval Depo rezervi, AT_DOOR=Kapı Önü. Top→sipariş bağı yok — karşılanma spec-toplam üzerinden (`SEVKIYAT-LOOSE-TASARIM.md`).

## Domain Kuralları

- **Phase 1:** COM port / donanım entegrasyonları sadece simüle edilir — gerçek donanım kodu yazma.
- **Tüm veriler test verisi** — uzun vadeli doğruluk için optimize et, seed satırlarıyla backwards compat derdine girme.
- **İş emri esnekliği:** Bir iş emri birden fazla siparişe bağlanabilir veya hiçbir siparişe bağlı olmadan stok için üretilebilir.
- **WO kapsamı = sadece üretim:** `WorkOrder` yalnızca üretimi (istasyonlar, kurşun/QC2, tambur) yönetir. Tartı / paket / sevkiyat ayrı bir domain'dir (`shipping.service.ts`) — WO'ya değil, depoya/çuvala bağlanır.
- **Şube bazlı planlama:** `Order.branchId` opsiyonel (eski kayıtlar `null`). Yeni siparişler tek bir şubeye yönlendirilir.
- **Refakat Kartı (Traveler Card):** İş emri finalize edildiğinde üretilen barkodlu kart; fiziksel olarak malla birlikte hareket eder ve okutulduğunda istasyon süreçlerini tetikler.
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
