# Backend `2.15.3`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu (bizim yönettiğimiz Linux deneme sunucusu,
kullanıcı onayı 2026-10-11); Windows fabrika filosuna çıkış ayrı karar ve `docs/design/GUNCELLEYICI-SAGLAMLIK.md`
§9.5 kanıt kapısıyla.
**Paket:** (imzadan sonra yazılır)
**SHA256:** (imzadan sonra yazılır)
**Commit:** (bu belgenin commit'i; etiket `backend-v2.15.3` imza + yayından sonra)
**Önceki saha sürümü:** 2.15.2 yayında (`test` grubu); Linux deneme sunucusunda kurulu olan 2.15.1 (2.15.2 kurulumu
YEDEK adımında geri döndü, güncelleme programı 0.2.4). Güncellenecek her kurulumda sahadaki sürüm kurulumdan önce
sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`). Güncelleme programının sürümü 0.2.4 → 0.2.5;
sunucu hizmet konağı 0.2.0 (değişmedi).

## 1. Özet

Asıl iş güncelleme programı düzeltmeleri: Linux (Docker) kurulumunda 2.15.2 güncellemesi yedek adımında yetki
hatasıyla geri dönüyordu; şema ön denetimi Linux'ta hiç çalışmıyordu; yeni kurulumun varsayılan güncelleme adresi
eskiydi. Üçü 0.2.5'te kapandı. **ERP sunucusunda iki dokuma farkı:** Tezgah Salonu canlı görünümü sensörsüz tezgahı
günün elle kayıtlarından boyar ve her tezgahın durum kaynağını söyler; vardiya tanımları panelden yönetilebilir
(yeni uç `/api/shift-definitions`). İkisi de yalnız dokuma modülü açıkken görünür. Veritabanı şeması 2.15.2 ile
aynıdır.

## 2. Ne değişti

Önceki etiket `backend-v2.15.2`ye göre. Ölçüm: `git diff --stat backend-v2.15.2..` — `Teks-Erp/prisma` altında fark
YOK; `Teks-Erp/src` altında yalnız aşağıdaki dokuma/vardiya farkları.

**Güncelleme programı (0.2.4 → 0.2.5)**

- `f9ca7d172` — Linux yedek adımı: yedek şifreleme alıcısı birimden konakta kopyalanır, yedek aracına salt okunur
  verilir (önce yetkisiz araç birime giremiyor, yedek `EACCES` ile düşüyor, güncelleme geri dönüyordu). Alıcı
  çözülemezse yedek alınmaz, hata adıyla söylenir. Yedek kaydında kurulum alıcısı ilk kez doğru sayılır.
- `cd56b1cf5` — Linux `kur`/`gecis` güncelleme adresi verilmezse indirme kökünü (`indir.etkiliyazilim.com`) yazar
  (önce eski kanal adresi, paket bulunamıyordu). Var olan ayar dosyası kendiliğinden değiştirilmez.
- `75eaaaa51` — Linux şema ön denetimi göç adlarını indirilen imajın içinden (ağsız, salt okunur, yetkisiz geçici
  konteynerle) okur; önce her turda "ölçülemedi" bitiyordu, ileri şema ancak durdurma + yedekten sonra imajın
  açılışında yakalanıyordu. Windows'ta davranış aynı.

**Dokuma — Tezgah Salonu elle boyama (sunucu tarafı)**

- `d788ebf6e` — `GET /api/loom-floor`: sensörsüz (canlı izlenmeyen) tezgahın durumu günün elle kayıtlarından (açık
  duruş · açık koşum · indirme) türer; önce bu tezgahlar hep "izlenmiyor" (gri) dönüyordu. Her tezgaha `stateSource`
  (`olculen` · `elle` · `simule` · `cikarim`) eklendi; kayıt yoksa durum eskisi gibi izlenmiyor. Canlı izlenen
  tezgahın davranışı aynen. Hedef süre / iletim kademesi elle açılmış duruşta da işler. Dokuma karne özetinin
  kaynak sayımı aynı yardımcıya taşındı (sayılar değişmez).

**Vardiya tanımları**

- `00ae0ac4d` — yeni uç `/api/shift-definitions` (liste · ekle · güncelle · önizle · arşivle · geri al); yazma izni
  var olan `loom:spec-manage`, liste ayrıca `report:production` ile okunur. Yeni izin yok. Vardiya takvimi işi
  (yalnız dokuma açıkken) artık yalnız İLERİ yazar: başlamış pencere yeniden yazılmaz; kuralın dışında kalan gelecek
  pencere silinmez, takvim sebebiyle iptal edilir, kural dönünce diriltilir; mühürlü karne değişmez.
- `790bb47b8` — ekran kataloğuna "Vardiya Tanımları" (masaüstü, dokuma modülü, `loom:spec-manage`).

**Pakete girmeyen:** panel (Tezgah Salonu kaynak etiketi `0224226e5`, TV kipi `a24150781`, Vardiya Tanımları ekranı)
ayrı sürümle (panel 1.6.0) çıkar; bekçi düzeltmeleri (`671210d37` · `684c22fc9` · `b4ef87073` · `47d564e56` ·
`4c8784efb` · `b420e158a`) ve belgeler.

**Değişmeyen:** migration'lar, izinler, var olan alanların anlamı (yukarıdaki boyama dışında). `dist-web` bu imajda
yok (Docker).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız ekleme: yeni uç `/api/shift-definitions`, `/api/loom-floor` tezgahına
  `stateSource`. Var olan `state` alanı sensörsüz tezgahta artık elle kayıttan dolu gelebilir (önce hep izlenmiyor).
- **Eski istemci ne yapar:** eski panel yeni alanı okumaz; Tezgah Salonu'nda sensörsüz tezgahları renkli görür ama
  kaynak etiketi çizmez; Vardiya Tanımları ekranı yalnız yeni panelde. Tablet bu uçları kullanmaz.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 374 (2.15.2 ile aynı). 2.15.1/2.15.2'den gelen kurulum 0 uygulanan migration görmelidir.
  Farklı sayı = yanlış paket ya da yanlış veritabanı → DUR.
- **Veri yazan adımlar:** yok. (Vardiya takvimi işi dokuma açık kurulumda olağan zamanlamasıyla ileri pencere yazar;
  güncelleme adımı değildir.)
- **Geri alınabilir mi:** imaj dönüşü 2.15.2/2.15.1'e serbesttir (şema aynı).

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır; süre kurulumda ölçülür ve raporlanır.
- **Sıra:** sunucu önce; Tezgah Salonu kaynak etiketini ve Vardiya Tanımları ekranını gösteren panel sonra.
- **Bu sürüme özel:**
  - Güncelleme programı önce kendini 0.2.5'e yeniler; ardından backend güncellemesi panelden yeniden onaylanır
    (geri dönmüş 2.15.2 kendiliğinden yeniden denenmez). Yedek adımı geçmeli; yedek kaydında kurulum alıcısı 1,
    günlükte `SEMA_OLCULEMEDI` yok.
- **Bilinen sınırlar (dürüst):** 2.15.0–2.15.2 belgelerindeki güncelleme programı sınırları aynen geçerli. Vardiya
  mola süresi pencereye dondurulmuyor: mola değişince mühürsüz karneler yeni molayla yeniden hesaplanır (panel
  kaydetmeden önce uyarır).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür; geri dönülen
sürüm kendiliğinden yeniden denenmez. Şema değişmediği için önceki imaj aynı veritabanıyla açılır.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.3, sunucu ve veritabanı ayakta.
- Güncelleme programı hizmeti çalışıyor; `durum` kurulu sürüm 2.15.3, güncelleme programı 0.2.5, kira geçerli
  (DONDURULDU / KIRA_YOK yok).
- Yedek: güncelleme öncesi yedek alındı, kurulum alıcısı 1; günlükte `SEMA_OLCULEMEDI` yok.
- Veritabanı: 374 migration bitmiş, sorunlu migration yok.
- İmajın bütünlük öz-denetimi geçerli (açılış günlüğü).
- Hata günlüğünün son satırları — yeni hata var mı.
