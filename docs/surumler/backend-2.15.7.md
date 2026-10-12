# Backend `2.15.7`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu; öncü/genel gruba çıkış ayrı karar.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.15.6 (`test` grubu, etiket `backend-v2.15.6`). Güncellenecek her kurulumda sahadaki sürüm
kurulumdan önce sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

- **Makine kartı izlenir (watchdog).** Tezgaha bağlı kart belirli süre sessiz kalırsa sunucu bunu kaydeder ve
  Tezgah Salonu ile sağlık ekranına taşır; kartın açtığı duruş çok uzun süre kapanmazsa sunucu onu geçici olarak
  kapatır, kartın sonradan gelen "bitti"si bunu bir kez düzeltir. Kart bugün sahada olmadığından kurulumda görünen
  değişiklik yok.

## 2. Ne değişti

**Makine kartı: watchdog (D4)** (commit `feat(tezgah): makine kartı watchdog'u …`; kısa kimliği paketlemede yazılır)

- Kart belirli süre (ayar `tezgah.collectorSilenceMinutes`, varsayılan 10 dk) hiçbir imzalı istek göndermezse
  "sessiz" sayılır: kayıt, Tezgah Salonu cevabında `collectorSilentSince`, sağlık ekranında sayaç. Sessizlik duruş
  AÇMAZ. Kart duruş yokken canlı kalmak için yeni nabız ucunu çağırır (`POST /api/machine-signals/heartbeat`).
- Kartın açtığı duruş uzun süre (ayar `tezgah.maxOpenStopHours`, varsayılan 12 sa) kapanmazsa sunucu onu GEÇİCİ
  kapatır (tahmin olduğu kayıtta yazılı); kartın sonradan gelen "bitti"si bunu bir kez düzeltir. Vardiya karnesi
  mühürlüyse düzeltme bekletilir ve mühür açılınca uygulanır. Elle bildirilen duruşlara dokunulmaz.
- Watchdog işi 60 sn'de bir koşar (tek süreç); tezgah ya da dokuma modülü kapalıyken iş yapmaz. İki ayarın panel
  satırı sonraki panel sürümünde.
- `dist-web`: bu madde panel kaynağını değiştirmez.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (watchdog) — yalnız ekleme: bir kart ucu (nabız), duruş cevabında
  `provisionalEndedAt`/`endCorrectedAt`/`lateEndedAt`, kart cevabında `lastSeenAt`/`silentSince`, salon cevabında
  `collectorSilentSince`, sağlıkta `machineWatchdog`, ayar cevabında iki sayı. Kartın `end`i WATCHDOG kapanışında
  artık 200 (düzeltme) döner; mühürlü vardiyada 409 `SHIFT_SEALED` + `details.lateEndQueued`.
- **Eski istemci ne yapar:** eski panel ve tablet yeni alanları okumaz; davranışları değişmez. Kartın kendisi
  nabız ucunu bilmiyorsa duruş yokken sessiz görünür (yalnız uyarı; duruş açılmaz).
- **`minVersion` dokunuldu mu:** hayır.

## 4. Migration

- **Var mı:** EVET — 1 adet: `20261013010000_makine_watchdog` (yalnız EKLEME: toplayıcıya iki, duruşa bir boş
  geçilebilir alan; veri dönüşümü yok).
- **Toplam migration:** 388 (2.15.6'da 387). 2.15.6'dan gelen kurulum tam 1 migration uygulamalıdır. Farklı sayı =
  yanlış paket ya da yanlış veritabanı → DUR. (Paketleme anında yeniden sayılır.)
- **Prova:** YAPILMADI — taslak; paketlemeden önce en eski canlı dump'ta restore → `migrate deploy` → bekçiler →
  profil açılışı.
- **Geri alınabilir mi:** HAYIR (bu depoda migration geri alınamaz; geri dönüş = yedekten geri yükleme).

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek + 1 migration); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; panel sonra (kırılma yok, sıra serbest).
- **Bu sürüme özel:** yok (watchdog'un dokunabileceği onaylı kart ve kart duruşu sahada yok).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür. Migration geri
alınmaz; 2.15.6 imajı yeni alanlarla açılır (onları okumaz). Veriyi güncelleme öncesine döndürmek gerekirse
otomatik yedekten geri yüklenir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.7, sunucu ve veritabanı ayakta.
- Veritabanı: 388 migration bitmiş, sorunlu migration yok.
- `/api/admin/health` `machineWatchdog`: `{ silentCollectors: 0, lateStopEnds: 0 }` (kart yokken); `null` ise
  sayaç okunamadı — günlüğe bak, insana rapor et.
- Sunucu hata günlüğünün son 30 satırı — `machine-watchdog` kaynaklı yeni hata var mı.
