# Backend `2.15.2`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu (bizim yönettiğimiz Linux deneme sunucusu,
kullanıcı onayı 2026-10-10); Windows fabrika filosuna çıkış ayrı karar ve `docs/design/GUNCELLEYICI-SAGLAMLIK.md`
§9.5 kanıt kapısıyla.
**Paket:** `tekserp-backend-oci-2.15.2.tar` (213158400 B; imaj config özeti `sha256:45fe396779651bfcf93bfe4056530b1080eceb521766c202f2edb5edae6ed81a`, güncelleyici 0.2.4 `05b8b3008926817a…`, kid `pkt-2026-1`, CI koşusu 38079271752)
**SHA256:** `ad0e03056de397a51fe11fbc7398f2773ca82e5d183d842d79e137900799f1bc`
**Commit:** `d567ee666` (etiket `backend-v2.15.2`; `test` grubu `backend-oci/2.15.2`, 2026-10-10)
**Önceki saha sürümü:** 2.15.1 (son etiket `backend-v2.15.1`; Linux deneme sunucusunda güncelleme programı
yönetiminde 2.15.1 Docker imajı). Güncellenecek her kurulumda sahadaki sürüm kurulumdan önce sunucunun sağlık
bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`). Güncelleme programının sürümü 0.2.3 → 0.2.4;
sunucu hizmet konağı 0.2.0 (değişmedi).

## 1. Özet

Asıl iş güncelleme programı düzeltmesi: Linux (Docker) kurulumunda güncelleme programı lisans kirasını yanlış yerden
okuyordu ve kurulumu kalıcı olarak "donduruldu / kira yok" sayıyordu. **ERP sunucusunda tek davranış farkı:**
Tezgah Salonu canlı görünümü (`GET /api/loom-floor`) tezgaha takılı levent bilgisini de döner — yalnız devere modülü
ve levent bağı takibi açıkken; kapalıyken alan boştur (bugünkü davranış). Veritabanı şeması 2.15.1 ile aynıdır.

## 2. Ne değişti

Önceki etiket `backend-v2.15.1`a göre. Ölçüm: `git diff --stat backend-v2.15.1..` — `Teks-Erp/prisma` altında fark
YOK; `Teks-Erp/src` altında yalnız aşağıdaki dokuma farkı.

**Güncelleme programı (0.2.3 → 0.2.4)**

- `ddc2ebb14` — Linux'ta lisans kirası ERP sunucusunun Docker lisans biriminden okunur (önce kurulum dizininde
  aranıyor, bulunamıyordu). `onar` komutu yetki bilgisini de oradan alır; birim bulunamazsa hata adıyla birlikte
  söylenir, sessizce geçilmez. Geçici dosya bağlantı izlemeden açılır. Windows'ta davranış aynı.
- `f8daab185` · `fa2aed3eb` — duman testi ve Linux profili testleri kirayı lisans biriminde tutar; geçiş
  runbook'u (§11.1) güncellendi.

**Dokuma — Tezgah Salonu levent alanı (sunucu tarafı)**

- `6b4ad0b77` — `GET /api/loom-floor` yanıtına `beamTracking` ve tezgah başına `beams` (levent no · yuva · çözgü ·
  kalan · plan) eklendi; kaynak `GET /api/warp-beams/mounted` ile aynı yardımcı. `beams` yalnız devere modülü ve
  levent bağı takibi açıkken dizi, kapalıyken `null` — varsayılan davranış değişmez. Aynı commit
  `GET /api/warp-beams/mounted` cevabına `plannedLengthM` (planlanan çözgü boyu) ekler — yalnız ekleme.

**Yayın aracı (pakete girmez, yayın tarafı)**

- `169c4efbd` — yeni adres kapısı açıldı: terfide kaynak gruptaki paket bayt-eşit aranır; Linux (OCI) sürümü kendi
  dizininden okunur, Windows sürümüyle karışmaz.

**Değişmeyen:** migration'lar, izinler, var olan alanlar. `dist-web` bu imajda yok (Docker).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız ekleme: `/api/loom-floor` yanıtına iki yeni alan, `/api/warp-beams/mounted`
  yanıtına `plannedLengthM`.
- **Eski istemci ne yapar:** yeni alanları okumaz; Tezgah Salonu ekranı levent rozetini yalnız yeni panelde gösterir.
  Tablet bu ucu kullanmaz.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 374 (2.15.1 ile aynı). 2.15.1'den gelen kurulum 0 uygulanan migration görmelidir. Farklı
  sayı = yanlış paket ya da yanlış veritabanı → DUR.
- **Veri yazan adımlar:** yok.
- **Geri alınabilir mi:** imaj dönüşü 2.15.1'e serbesttir (şema aynı).

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır; süre kurulumda ölçülür ve raporlanır.
- **Sıra:** sunucu önce; levent rozetini gösteren panel sonra (bu belgenin kapsamı dışında).
- **Bu sürüme özel:**
  - Güncelleme programı önce kendini 0.2.4'e yeniler; ardından Linux deneme sunucusunda kira lisans biriminden
    okunur, kurulum "donduruldu" durumundan çıkmalıdır (`durum` ile doğrulanır).
- **Bilinen sınırlar (dürüst):** 2.15.0/2.15.1 belgelerindeki güncelleme programı sınırları aynen geçerli.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür; geri dönülen
sürüm kendiliğinden yeniden denenmez. Şema değişmediği için 2.15.1 imajı aynı veritabanıyla açılır.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.2, sunucu ve veritabanı ayakta.
- Güncelleme programı hizmeti çalışıyor; `durum` kurulu sürüm 2.15.2, güncelleme programı 0.2.4, kira geçerli
  (DONDURULDU / KIRA_YOK yok).
- Veritabanı: 374 migration bitmiş, sorunlu migration yok.
- İmajın bütünlük öz-denetimi geçerli (açılış günlüğü).
- Hata günlüğünün son satırları — yeni hata var mı.
