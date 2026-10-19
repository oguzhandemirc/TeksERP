# PLAN — Dokuma iş emri sağ paneli (canlı durum)

> Durum: 2026-10-20, dal `feature/weaving-order-detail-sheet`. Kural dosyası `docs/kurallar/dokuma.md`.
> Kullanıcı isteği: "dokuma iş emrine basınca onun ne halde olduğunu göremiyorum, terbiye iş emrindeki gibi sağdan bir panel ve o anda neler olduğunu göremez miyiz? tıklayınca ayrıntısına girsin"

## 0. Ölçülen başlangıç

- Liste satırına tık → yalnız açık işte düzenleme formu; kapalı işte hiçbir şey.
- `GET /api/weaving-orders/:id` yalnız DTO + `openRunCount` + `producedRollCount`. İşe göre koşum / indirme / top / levent okuyan uç yok.
- Top sayısı TEK yüklem: `countRollsOfWeavingOrder` (indirme bağlı, indirme geri alınmamış; top statüsüne bakmaz).
- Açık koşum TEK yüklem: `OPEN_RUN_WHERE` (`endedAt IS NULL AND revokedAt IS NULL`).
- Canlı operatör `liveMachineOperators`; takılı levent + kalan `mountedBeamViewsTx` (devere ∧ `devere.mountTracking`); levent kalanı gösterimi `remainingByBeam`.

## 1. Senaryolar

1. PLANLANDI iş: panel açılır, "Şu an tezgahta" bölümü "Henüz tezgaha verilmedi — koşum tabletten ya da Tezgah Salonu'ndan açılır" der.
2. DEVAM EDEN iş: açık koşum satırı — tezgah kod/ad, hat, başlangıç, açık duruş (sebep + başlangıç), operatör, takılı leventler + kalan (yalnız bağ defteri açıkken), bu koşumdaki indirme sayısı.
3. Kapanmış / iptal iş: satır tıklaması da paneli açar (salt okuma), eylem düğmesi yok.
4. Fasonda dokunan iş: "Fason (sevk · kabul)" düğmesi mevcut `FasonSheet`i açar; kabul edilen metre KPI'da.
5. Açık uçlu iş (`plannedM` null): % yerine "açık uçlu".
6. İstek düşer: "kayıt yok" yazılmaz, hata + "Yeniden dene".
7. Eski backend (uç yok / alan yok): canlı bölümler çizilmez ya da hata kutusu; başlık listeden gelen satırla çizilir, çökmez.

## 2. Dilimler

**D1 Backend** — `GET /api/weaving-orders/:id/overview` (salt okur; `verifyToken → requireDokumaEnabled → requireAnyPermission(weavingorder:read, mobile:dokuma)`, detayla aynı küme; Swagger JSDoc). Servis `weaving-order-overview.service.ts`:
- `order` (DTO + `producedRollCount`), `progress`: `plannedM` · `rollMeters` (doğan topların Σ `initialQty`; top yoksa null) · `rollCount` (aynı where, `countRollsOfWeavingOrder` ile paylaşılan `rollsOfWeavingOrderWhere`) · `runMeters` (kapanmış ∧ geri alınmamış koşumların Σ `producedM`; ölçülmeyen koşum sayısı ayrı; hiç ölçüm yoksa null) · `doffCount` (geri alınmamış) · `fasonReceivedM` (yalnız fasonda; `receivedMetersByWeavingOrder`).
- `liveRuns` (açık koşumlar, tavan 50), `recentRuns` (kapanmış/geri alınmış, son 10), `recentDoffs` (geri alınmamış, son 10, doğan topların barkod/metre), `beams` (işe bağlı leventler, son 20; devere kapalıysa null). Her liste `{ items, total, truncated }`.
- Tx yok; okumalar `prisma` üzerinden, `select` ile.

**D2 Panel** — `WeavingOrderDetailSheet` (v3 dili, `.wo-v3 sheet`): başlık (no · durum · kumaş/renk · kim dokuyor · plan tarihleri), KPI şeridi, "Şu an tezgahta", "Son koşumlar", "Son indirmeler", "Leventler", "Bağlı siparişler"; eylemler Düzenle / Kapat / İptal (açık durumda, `weavingorder:write`) + Fason. `onRowClick` paneli açar. `refetchInterval` 20 sn yalnız panel açıkken; mutasyon sonrası overview anahtarı da tazelenir. Tezgah satırı → `/operations/weaving-floor?tezgah=<id>` (`useOpenTarget`; yalnız `tezgahEnabled` ∧ `loom:live-view`). Çağrı yalnız `WeavingOrders/service.ts`ten.

## 3. Kabul testleri

- Backend bekçisi `scripts/test_weaving_order_overview.ts` (GERÇEK DB + HTTP): açık / kapalı / geri alınmış koşum ayrımı · geri alınmış indirme sayılmaz · `rollCount === producedRollCount` · açık uçlu iş `plannedM` null · metre alanları ayrı ve ölçülmeyen null · tavan + `truncated` · 403 `MODULE_DISABLED` · izinsiz 403 · 404 · yapısal (paylaşılan yüklem, kopya yok). Negatif sonda: paylaşılan yüklemden `revokedAt: null` düşürülünce kırmızı.
- Panel vitest: PLANNED cümlesi · açık koşum satırı (tezgah + duruş + operatör) · hata durumu (kayıt yok yazmaz, yeniden dene) · eski backend (alan yok → bölüm yok, çökme yok) · açık uçlu · satır tıklaması paneli açar.
- Koşulan: `test_dokuma_regime_gate`, dokuma alan bekçileri (ilgili), backend typecheck + lint, Electron typecheck + ilgili vitest.

## 4. Sözleşme ve eski istemci

Yeni uç EK; mevcut uçların cevabı değişmez → eski panel/tablet aynı çalışır, `minVersion` GEREKMEZ. Yeni panel eski backend'e bağlanırsa overview 404 → panel hata kutusu + başlık (listeden), çökme yok.
