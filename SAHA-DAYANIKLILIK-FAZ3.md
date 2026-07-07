# Saha Dayanıklılığı Faz 3 — Kalıcı Ölçüm, Perf Sayfası, Ağ Simülatörü, Sessions Bakımı

> Branch: `perf/gozlem-faz3` (taban: b1fb15d) · Tarih: 2026-07-07
> Faz 2'nin ölçüm altyapısını "çıkarım yapılabilir" hâle getirir: veriler restart'ta
> kaybolmaz (dev'de nodemon her kayıtta sıfırlıyordu!), panelden okunur, fabrika ağı
> masada taklit edilebilir. + Backlog'daki `sessions` şişme riski kapanır.

## 1. İş Maddeleri

### P1 — Kalıcı günlük özet (`EndpointLatencyDaily`)
**Dosyalar:** `prisma/schema.prisma`, `prisma/migrations/20260707120000_endpoint_latency_daily/`,
`src/services/latency-persist.service.ts` (yeni), `src/middlewares/latency.middleware.ts`,
`src/routes/admin.routes.ts`, `src/server.ts`

- Model: `{ id, day @db.Date, routeKey, count, errCount, maxMs, buckets Json, createdAt, updatedAt }`,
  `@@unique([day, routeKey])`. Bucket sayaçları JSON'da saklanır → günler/aralıklar
  TOPLANABİLİR ve persentil okuma anında hesaplanır (yaklaşıklık kaybı yok).
- **Büyüme sözü:** ~aktif-route-sayısı satır/gün (≈100-200) × ~150 byte ≈ yılda birkaç MB;
  flush içinde 90 günden eski satırlar otomatik silinir (retention) → tablo TAVANLI.
- **Timer YOK (istek-güdümlü flush):** middleware her kayıtta `noteLatencyDelta`'ya da yazar;
  5 dk'da bir (throttle, `inFlush` guard'lı, `setImmediate` ile istek yolunun DIŞINDA)
  birikmiş delta'lar bugünün satırlarına merge-upsert edilir. Best-effort: hata isteği
  düşürmez, audit-health gibi sayaca düşer. `gracefulShutdown`'a 2sn tavanlı son flush eklenir
  (nodemon/NSSM restart'ında son dakikalar kaybolmasın).
- **Migration MANUEL akışla** (proje kuralı): SQL psql ile uygulanır + `prisma migrate resolve
  --applied` + `npm run prisma:generate`. DİKKAT: merge'e kadar ana ağaçta `prisma migrate dev`
  KOŞULMAMALI (klasörde olmayan migration DB'de kayıtlı görünür → reset ister).
- Yeni uç: `GET /api/admin/perf/history?days=N(≤90)&route=...` (admin:settings) —
  günlük satırlar + gün içi p50/p95 (bucket'tan hesaplanmış) döner; Zod parse.

### P2 — `sessions` purge ucu
**Dosyalar:** `src/services/session-registry.service.ts`, `src/routes/admin.routes.ts`

- `POST /api/admin/sessions/purge { olderThanDays: 7..365 }` (admin:settings):
  yalnız `revokedAt < cutoff` VEYA `expiresAt < cutoff` satırları fiziksel siler —
  aktif oturum (revokedAt null + expiresAt gelecekte) matematiksel olarak kapsam dışı.
  Fiziksel DELETE, system-logs archive emsalidir (append-only operasyonel kayıt bakımı);
  audit'lenir, silinen sayı döner. Operasyonel bakım listesine "6 ayda bir" olarak girer.

### P3 — Fabrika ağı simülatörü (`scripts/dev_slow_proxy.ts`)
- Saf Node (paket yok): backend önüne gecikme+jitter+drop proxy'si.
  `npx tsx scripts/dev_slow_proxy.ts --profile kotu` → 0.0.0.0:4100 dinler, 4000'e iletir.
- Profiller: `orta` (RTT 80ms ±60), `kotu` (250ms ±160), `felaket` (500ms ±300 + %5 drop);
  `--rtt/--jitter/--drop/--port/--target` ile elle ayar. Drop = soketi keser (timeout/retry
  yolları gerçekçi tetiklenir).
- Açılışta LAN IP'lerini ve bağlanma talimatını basar: tablet → login dişlisi →
  `http://<IP>:4100`; Electron → Ayarlar/API adresi. Böylece Faz-1/2 dayanıklılık
  davranışları (bekletilen kayıt, tavanlı logout, poll backoff) masada test edilir.

### P4 — Electron "Endpoint Performansı" sayfası
**Dosyalar:** `src/pages/System/Perf/` (types/service/PerfPage/LiveTable/SlowList/TrendChart),
`src/pages/System/tile-config.ts` (kart), `src/routes/content-routes.tsx` (route)

- Canlı tablo (`GET /api/admin/perf`): route, istek, hata, p50/p95/max, son istek — p95 desc.
- Yavaş istek defteri (≥1sn son 50) listesi.
- Trend (`/history`): seçilen route (veya toplam) için günlük p95/p50 çizgi grafiği (recharts).
- "Sıfırla" butonu ConfirmDialog ile (`POST /perf/reset`).
- `ProtectedRoute requirePermission="admin:settings"`; System hub'ına adminOnly kart;
  dosya-boyu kuralları (sayfa <200, dosya <300) parçalamayla korunur.

## 2. Kapsam Dışı
- pg_stat_statements (üretim kutusuna manuel operasyon), alarm/uyarı eşikleri (ileride),
  mobil değişikliği YOK.

## 3. KONTROL LİSTESİ (bağımsız denetçi — koddan sıfırdan doğrula, dosya:satır kanıtı)

- [ ] **G1** Model/migration: şema ↔ SQL birebir; `@@unique([day, routeKey])` var; FK yok (index kuralı n/a); JSON sorgulanmıyor (GIN gerekmez); migration dosyası klasör adıyla tutarlı; `_prisma_migrations`'a resolve ile işlendi (DB'de doğrula).
- [ ] **G2** Flush timer'sız ve istek yolunun DIŞINDA: throttle (≥5dk) + `inFlush` guard + `setImmediate`; flush hatası isteği DÜŞÜRMEZ (best-effort sayaç); delta swap yarışsız (flush sırasında gelen kayıtlar kaybolmaz); retention (90 gün) çalışıyor ve günde ≤1 kez koşuyor.
- [ ] **G3** Bucket-merge doğruluğu: gün içi iki flush üst üste TOPLANIR (upsert-merge); history'de persentil, birleşik bucket'lardan hesaplanır ve gözlenen max'ı aşmaz; scripts testi bunu gerçek DB'de (TEST- verisiyle, cleanup'lı) sınıyor.
- [ ] **G4** `gracefulShutdown` son-flush'ı 2sn tavanlı ve kapanışı bloklamıyor; unref/force-timer davranışı bozulmadı.
- [ ] **G5** History ucu: Zod (days ≤90), admin:settings, route filtresi opsiyonel; prisma import'u route'ta YOK (serviste); Swagger JSDoc; büyük cevap riski yok (gün × route sınırlı).
- [ ] **G6** Purge: aktif oturum silinemez (koşul matematiği + test kanıtı); sınırlar 7..365; audit'li; silinen sayı dönüyor; test kendi TEST- verisini yaratıp temizliyor; başka kod `sessions` satırının varlığına güvenmiyor (verifyToken jti findUnique null → oturum zaten geçersiz sayılır — purge edilen zaten ölü oturum).
- [ ] **G7** dev_slow_proxy: paketsiz; profiller/args doğru uygulanıyor (gecikme her iki yönde, drop soket keser); 0.0.0.0 dinleme + LAN IP çıktısı; hedefe ulaşamayınca anlamlı hata; Content-Length/stream bozulmuyor (büyük JSON cevabı bütün geliyor).
- [ ] **G8** Electron Perf sayfası: veri şekilleri backend kontratıyla birebir (types.ts); yalnız admin:settings görüyor (route + tile adminOnly); reset ConfirmDialog'lu; mutation'da onError generic toast YOK; queryKey konvansiyonu (["perf",...]); dosya boyu kuralları; sayfa hata/boş durumları (endpoint 403/500) düzgün.
- [ ] **G9** Bütünlük — KOMUT KOŞ: backend `npx tsc --noEmit` + `npx tsx scripts/test_latency_persist.ts` + `npx tsx scripts/test_session_purge.ts` + mevcut latency testleri; Electron `npm run typecheck` + `npx vitest run`; smoke (PORT=4010): trafik → 5dk beklemeden zorla flush (test ucu/fonksiyonu) → history dolu.
- [ ] **G10** Konvansiyon: yeni endpoint kontrol listesi maddeleri; `any` yok; Decimal yok; soft-delete istisnası gerekçeli (purge + retention = operasyonel bakım, domain verisi değil); mevcut yorum diline uyum; plan↔commit paritesi.

## 4. Kullanım (geliştirme sırasında çıkarım akışı)
1. `npx tsx scripts/dev_slow_proxy.ts --profile kotu` → tableti proxy'ye bağla.
2. Normal çalış; `Sistem → Endpoint Performansı` sayfasından canlı p95 + yavaş defteri izle.
3. Kod değişikliği sonrası "Sıfırla" → aynı senaryoyu tekrarla → öncesi/sonrası kıyasla
   (geçmiş günler history'de durur; nodemon restart'ları artık veri kaybettirmez).
