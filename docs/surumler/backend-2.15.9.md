# Backend `2.15.9`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu; öncü/genel gruba çıkış ayrı karar.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.15.8 (`test` grubu, etiket `backend-v2.15.8`). Güncellenecek her kurulumda sahadaki sürüm
kurulumdan önce sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

- **Tarayıcı panelinin oturum çerezi küçüldü.** Tarayıcıdan girişte saklanan oturum bilgisi artık kullanıcının izin
  listesini taşımıyor; çerez yaklaşık 3,8 KB'tan 0,4 KB'a indi. Tarayıcıların çerez sınırına (4 KB) yaklaşıldığı için
  izinler çoğaldıkça girişin sessizce kopması riski kapandı. Yetkiler bugünkü gibi her istekte sunucuda denetlenir;
  kullanıcının gördüğü ekranlar değişmez.
- **Bulut kurulumunda yedekleyici de güncelleniyor.** Sunucu güncellenirken yedek alan yardımcı hizmet eski sürümde
  kalıyordu; artık yeni sürüm sağlıklı açıldıktan sonra o da yeni sürüme geçiyor (sürmekte olan yedek kesilmez,
  bitmesi beklenir). Geri dönüşte o da önceki sürüme döner.
- **Masaüstü panel ve tablet için değişen yok.** Girişleri ve oturumları aynı kalır.

## 2. Ne değişti

**Web çerezindeki JWT izin taşımaz** (commit `080724da0`; sözleşme `docs/design/BULUT-WEB-PANELI.md`)

- `AuthService.issueToken`: `cookieLoginApplies(clientType)` doğruyken imzalanan claim'de `permissions: []`. Giriş
  gövdesindeki `user.permissions` ve `/api/auth/me` dolu kalır; yetki kararı zaten DB'den
  (`resolveRequestPermissions`). Bearer (masaüstü panel, tablet) claim'i ve panel kipi kapalı web girişi aynen kalır.
- Ölçüm: tam izinli kullanıcıda `Set-Cookie` 3774 → 427 bayt. Yan etki: kenar vekilinde (nginx) yanıt başlığı
  tamponu sınırına da artık yaklaşılmaz (2.15.8 kurulumunda görülen 502 "upstream sent too big header").
- Bekçi: `test_web_cerez_oturumu` §12 (negatif sondalı).

**Güncelleyici 0.2.8 — imajı paylaşan yan hizmetler eşitlenir (BULGU-2)** (commit `fix(guncelleyici): move image-sharing sidecars …`; kısa kimliği paketlemede yazılır)

- Linux/Docker: `BASLAT` adımında yeni sürüm normal kipte sağlıklı açıldıktan SONRA `current` compose tanımında
  backend imajını (`tekserp-korumali:*`) kullanan yan hizmetler (bugün `yedek`) `compose up -d --no-deps <svc>` ile
  (`--force-recreate` yok) eşitlenir; geri dönüşte (`start_previous`) önceki sürüme. Doğrulama kipinde dokunulmaz.
- Sürmekte olan yedek işi (`pg_dump`/`pg_restore`/şifreleme, taze `*.part`) kesilmez: yedek zaman aşımı kadar
  beklenir, bitmezse `ERTELENDI`. Yan hizmet sonucu (`ERTELENDI`/`OLCULEMEDI`/`HATA`) sağlıklı backend kurulumunu
  geri aldırmaz; günlüğe, olaya ve `BASLAT.yanHizmetler`e yazılır. Windows: yan hizmet yok, değişiklik yok.
- Teslim paketi 0.2.8 güncelleyicisini taşır; güncelleyici kendini backend işleminden ÖNCE yenilediği için bu
  sürümün kurulumu da düzeltmeden yararlanır. Testler: `tests/linux_yan_hizmet.rs` (8 senaryo, negatif sondalı),
  `crash_restart` değişmezi.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. JWT claim'indeki `permissions` hiçbir istemcide karar kaynağı değildir; web istemcisi
  çerezi okuyamaz (`HttpOnly`) ve izinleri giriş gövdesinden / `/auth/me`den alır.
- **Eski istemci ne yapar:** masaüstü panel ve tablet `Authorization: Bearer` kullanır, değişmez. 2.15.8'de açılmış
  web oturumlarının çerezi dolu claim taşımaya devam eder ve sorunsuz çalışır; oturum süresi dolunca kalkar.
- **`minVersion` dokunuldu mu:** hayır.

## 4. Migration

- **Var mı:** HAYIR.
- **Toplam migration:** 392 (2.15.8 ile aynı). Farklı sayı = yanlış paket ya da yanlış veritabanı → DUR.
  (Paketleme anında yeniden sayılır.)
- **Prova:** gerekmez (şema değişmedi).
- **Geri alınabilir mi:** evet — şema değişmediği için 2.15.8 imajı aynı veritabanında açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek; migration yok); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; masaüstü panel/tablet güncellemesi gerekmez.
- **Bu sürüme özel:** yok. Tarayıcı paneli açık kurulumlarda kullanıcıların yeniden giriş yapması gerekmez.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür. Şema
değişmediğinden 2.15.8 imajı sorunsuz açılır; 2.15.9'da açılmış web oturumları 2.15.8'de de geçerlidir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.9, sunucu ve veritabanı ayakta.
- Veritabanı: 392 migration bitmiş, sorunlu migration yok.
- `/api/admin/health` `sistemHesabiMuhru` ve `auditProtection` 2.15.8'deki değerleriyle aynı.
- (Panel açıksa) tarayıcıda yeni girişin `Set-Cookie` uzunluğu ~0,5 KB'ın altında; giriş, liste ve çıkış çalışıyor.
- `docker ps`: `yedek` konteyneri de `tekserp-korumali:2.15.9` imajında; güncelleme günlüğünde `BASLAT.yanHizmetler`
  `yedek: ESIT`.
- Masaüstü panelle giriş ve tabletle PIN girişi bugünkü gibi çalışıyor.
