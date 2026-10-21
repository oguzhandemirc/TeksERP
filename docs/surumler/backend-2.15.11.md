# Backend `2.15.11`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu; öncü/genel gruba çıkış ayrı karar.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.15.10 (`test` grubu, etiket `backend-v2.15.10`). Güncellenecek her kurulumda sahadaki sürüm
kurulumdan önce sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

- **Dokuma iş emrinin "şu an ne oluyor" görünümü.** Panelde dokuma iş emri satırına tıklayınca sağda açılan
  bölmenin bilgisini sunucu verir: hangi tezgahta dokunuyor (açık duruş, çalışan operatör, takılı levent ve
  kalan metresi), son koşumlar, son indirmeler ve doğan toplar, işe bağlı leventler, ilerleme (hedef, doğan top
  sayısı ve metresi). Yalnız okuma yapar; hiçbir kaydı değiştirmez.
- **Tarayıcı paneli** (imajda taşınan web paneli) aynı sağ bölmeyi taşır.

## 2. Ne değişti

**Dokuma iş emri genel bakış ucu** (commit `78d5e9f4e`, PR #72; karar `docs/kurallar/dokuma.md`)

- Yeni salt okuma ucu `GET /api/weaving-orders/:id/overview` — detayla aynı izin kümesi (`weavingorder:read` ya da
  mobil dokuma izinleri), dokuma modülü kapalıysa 403 `MODULE_DISABLED`, geçersiz kimlik 400, yok 404.
- Cevap: ilerleme (hedef · doğan top sayısı ve ölçülen metresi · kapanmış koşum metresi · indirme sayısı; ölçülmeyen
  `null`), açık koşumlar, son koşumlar, son indirmeler (doğan toplarıyla), işe bağlı leventler, bağlantılar. Listeler
  tavanla kırpılır ve `{ items, total, truncated }` taşır.
- Top sayısı `producedRollCount` ile aynı yüklemden (`rollsOfWeavingOrderWhere`, `weaving-order-of-roll.helper.ts`);
  geri alınmış top/indirme sayılmaz.
- Bekçi: `test_weaving_order_overview` (yeni, 29/0; negatif sondalar commit mesajında).

**Tarayıcı paneli** (commit `78d5e9f4e`) — imajdaki web paneli dokuma iş emri sağ bölmesini taşır (masaüstü panel
1.6.7 ile aynı kod).

**Pakete girmeyenler:** `scripts/deneme-veri/` (deneme verisi araçları, commit `8ee2db63c`, PR #71), plan belgeleri
(`docs/ops/PLAN-*.md`).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. Yalnız yeni bir salt okuma ucu eklendi; var olan uçların cevabı değişmedi.
- **Eski istemci ne yapar:** eski panel yeni ucu çağırmaz, davranışı aynıdır. Yeni panel (1.6.7) eski sunucuya
  (≤ 2.15.10) bağlanırsa uç 404 döner; sağ bölme "yüklenemedi" hatasını ve yeniden dene düğmesini gösterir —
  liste, düzenleme, kapatma ve iptal etkilenmez. Tablet bu ucu kullanmaz.
- **`minVersion` dokunuldu mu:** hayır.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 392 (2.15.10 ile aynı). Farklı sayı = yanlış paket ya da yanlış veritabanı → DUR.
  (Paketleme anında yeniden sayılır.)
- **Prova:** gerekmez (şema değişmedi).
- **Geri alınabilir mi:** evet — şema değişmediği için 2.15.10 imajı aynı veritabanında açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek; migration yok); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; masaüstü panel güncellemesi gerekmez (sağ bölmeyi görmek için panel 1.6.7 gerekir).
- **Bu sürüme özel:** yok.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür. Şema
değişmediğinden 2.15.10 imajı sorunsuz açılır; yeni panelin sağ bölmesi o sürede "yüklenemedi" gösterir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.11, sunucu ve veritabanı ayakta.
- Veritabanı: 392 migration bitmiş, sorunlu migration yok.
- `/api/admin/health` `sistemHesabiMuhru` ve `auditProtection` 2.15.10'daki değerleriyle aynı.
- Dokuma modülü açık kurulumda `GET /api/weaving-orders/:id/overview` (bir iş emri için) 200 ve `progress` alanını taşıyor.
- `docker ps`: `yedek` konteyneri de `tekserp-korumali:2.15.11` imajında.
- Masaüstü panelle giriş ve tabletle PIN girişi bugünkü gibi çalışıyor.
