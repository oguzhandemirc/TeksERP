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
  Depo (RollStatus.WAREHOUSE)
```

Fabrika **çözgü/dokuma yapmaz** — kumaş hazır gelir, sadece process + QC + tambur yapılır.

Tambur'dan çıkan top **kesinlikle önce depoya** geçer (`status=WAREHOUSE`). Depo bir istasyon değil, tartı/paket öncesi bekleme statüsüdür.

> **NOT:** Tartı / paket / sevkiyat modülü sıfırdan yeniden yazılıyor — eski sevkiyat kodu silindi. Yeni akış tasarlanırken bu kısım güncellenecek.

## Domain Kuralları

- **Phase 1:** COM port / donanım entegrasyonları sadece simüle edilir — gerçek donanım kodu yazma.
- **Tüm veriler test verisi** — uzun vadeli doğruluk için optimize et, seed satırlarıyla backwards compat derdine girme.
- **İş emri esnekliği:** Bir iş emri birden fazla siparişe bağlanabilir veya hiçbir siparişe bağlı olmadan stok için üretilebilir.
- **WO kapsamı = sadece üretim:** `WorkOrder` yalnızca üretimi (istasyonlar, kurşun/QC2, tambur) yönetir. Tartı / paket / sevkiyat sonradan yeniden yazılacak ayrı bir domain.
- **Şube bazlı planlama:** `Order.branchId` opsiyonel (eski kayıtlar `null`). Yeni siparişler tek bir şubeye yönlendirilir.
- **Refakat Kartı (Traveler Card):** İş emri finalize edildiğinde üretilen barkodlu kart; fiziksel olarak malla birlikte hareket eder ve okutulduğunda istasyon süreçlerini tetikler.
- **Kurşun + QC2 = tek fiziksel istasyon (`StationKind.PROCESS_QC`):** Tek bir `WorkOrderStep` olarak modellenir. Per-roll `RollOperation` log'u `KURSUN_APPLIED` / `QC2_COMPLETED` olarak iz tutar — her top kurşun görmez.
- **Hata yaşam döngüsü:** `RollError` PROCESS_QC'de açılır, Tambur'da kapanır (`isProcessed = true`).
- **Fason dönüş:** Orijinal rulolar yerinde status değiştirir (yeni `Roll` kaydı **yok**). Kabulde miktar/ağırlık **ölçülmez**; sonraki istasyonun `FINISH`'i `RollMovement` üzerinden kaydeder.
- **Roll split:** Sadece Tambur'da (`CUT` kararı) olur — `parentRollId` + yeni barkod ile çocuk roll yaratılır.

## Ortak Konvansiyonlar

- UUID primary key, tüm modellerde `createdAt`/`updatedAt` (M:N pivot ve append-only log tabloları hariç — bunlarda sadece `createdAt`).
- Sadece soft delete — `isActive: false` veya `RollStatus.SCRAP`; **asla** fiziksel DELETE.
- Her CUD operasyonu → `AuditService.log()` → `SystemLog` tablosu.
- Validation hata mesajları Türkçe.
- **Yıkıcı işlemlerde detaylı onay zorunlu** (iptal/sil/scrap): confirm dialog'unda etkilenen her kaydı (WO, rulo, sipariş vb.) somut olarak listele. Backend tarafında preview endpoint döner, frontend per-record seçim sunar — "X kayıt etkilenecek" gibi soyut sayı yetmez.

## Test Kullanıcıları

En sık kullanılan: `admin` / `admin123` (tam yetki). Seed kullanıcılar `Teks-Erp/ARCHITECTURE.md §13`'te listeli. Admin dışı tüm kullanıcılar `test123` şifresini kullanır.
