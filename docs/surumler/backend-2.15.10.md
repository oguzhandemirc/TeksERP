# Backend `2.15.10`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu; öncü/genel gruba çıkış ayrı karar.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.15.9 (`test` grubu, etiket `backend-v2.15.9`). Güncellenecek her kurulumda sahadaki sürüm
kurulumdan önce sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`).

## 1. Özet

- **Onaysız tablet parolayla girebilir (isteğe bağlı, varsayılan KAPALI).** Cihaz eşleştirmesi zorunlu olan
  kurulumda yönetici yeni bir ayarı açarsa, henüz onaylanmamış tablet onay beklemeden yalnız kullanıcı adı ve
  parolayla girebilir. Personel listesi, hızlı PIN, personel kartı ve güncelleme indirme yine yalnız onaylı
  cihazdadır. Ayar kapalıyken (varsayılan) hiçbir şey değişmez. Yasaklanmış (pasife alınmış) cihaz girmez.
- **"Patron bulutu" adı "Yönetim bulutu" oldu.** Sunucunun verdiği mesajlar, ekran kataloğundaki başlık ve teknik
  kullanıcının görünen adı yeni adı taşır. Bulut bağlantısı ayarlanmamış kurulumlar artık varsayılan olarak
  `yonetim.etkiliyazilim.com` adresine bağlanır; eski `patron.etkiliyazilim.com` adresi açık kalır, onu kullanan
  kurulum aynen çalışır.
- **Tarayıcı paneli** (imajda taşınan web paneli) aynı değişiklikleri taşır: Cihaz eşleştirme bölümünde yeni
  ayarın satırı ve "Yönetim bulutu" metinleri.

## 2. Ne değişti

**`device.unpairedPasswordLogin` — onaysız tablet yalnız parola** (commit `8f9f3a796`; panel `14ecb1b20`; tablet
`b4778c1de`; karar `docs/kurallar/kesif-cihaz.md` G21-K)

- Yeni sistem ayarı `device.unpairedPasswordLogin` (varsayılan `false` = bugünkü davranış; barındırılan kurulumda
  ZORLANMAZ). Bayrak sözleşmesine `deviceUnpairedPasswordLogin` eklendi (`PATCH /api/feature-flags`).
- `device.middleware`: eşleştirme etkin zorunluyken PENDING + aktif cihaz, bayrak açıksa `req.device`siz,
  `req.unapprovedDevice` işaretiyle geçer. Kayıtsız ya da pasif cihaz yine 401.
- İşaretli cihaza kapalı kalanlar: PIN/kart girişi (`rejectUnapprovedDevice`, bayrağın kuralından bağımsız 403),
  personel listesi (401), indirme belirteci (`license.routes` 403 `DEVICE_NOT_APPROVED`).
- `GET /api/auth/login-methods` cevabına `unpairedPasswordOnly`; cihaz durum/kayıt cevabına `unpairedPasswordLogin`
  (onay ekranını atlatan TEK sinyal; middleware ile aynı yüklem `isUnpairedPasswordCandidate`).
- Bayrak okuması önbelleksizdir: kapatıldığı an onaysız tabletler kesilir.
- Bekçiler: `test_onaysiz_parola_girisi` (yeni), `test_feature_flag_contract`, `test_profil_tamligi`,
  `test_lisans_k5_giris`.

**Parola kilidi bekçisi** (commit `abf7f3070`; yalnız test) — `test_parola_kilidi_ip`: yanlış parola seli başka
kullanıcının hesabını kilitleyemez; kilit kovası istemci IP'sini taşır. Ürün kodu değişmedi.

**Yönetim bulutu adı** (commit `f37fbd511`, `5604b5e6e`)

- `DEFAULT_PATRON_CLOUD_URL` = `https://yonetim.etkiliyazilim.com` (yalnız `PATRON_CLOUD_URL` verilmemiş kurulumda
  etkili; `patron.` kalıcı takma ad, `docs/ops/PATRON-BULUTU-KURULUM.md`).
- Görünen metinler: `patron-cloud.routes`/`patron-cloud.service` mesajları, `PATRON_CLOUD_FULL_NAME`, ekran
  kataloğu başlığı. Teknik kullanıcı adı (`patronbulutu`), hata kodları ve izinler DEĞİŞMEDİ. Var olan teknik
  kullanıcının görünen adı güncellenmez (`activatePatronCloud` var olan kullanıcıyı yalnız doğrular); yeni ad
  yalnız yeni etkinleştirmede doğar — yalnız görüntü.

**Pakete girmeyenler:** `scripts/deneme-veri/` (deneme verisi araçları), `scripts/dump-aktar*`, Play mağaza araçları
ve görselleri (`deploy/play-*`, `*/magaza/`).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR. Eklenen alanlar (`unpairedPasswordOnly`, `unpairedPasswordLogin`,
  `deviceUnpairedPasswordLogin`) isteğe bağlıdır; bayrak varsayılan kapalıdır.
- **Eski istemci ne yapar:** eski tablet yeni alanları okumaz; bayrak kapalıyken davranış aynıdır. Bayrak AÇILIRSA
  eski tablet onaysız cihazda yine onay ekranında kalır (parola formunu bilmez) — kırılma değil, yeni yetenek
  yalnız tablet 1.4.1+ ile kullanılır. Eski panel ayarın satırını göstermez; ayar yalnız yeni panelden (ya da imajın
  tarayıcı panelinden) açılır. Masaüstü panelin Bearer girişi değişmez.
- **`minVersion` dokunuldu mu:** hayır.

## 4. Migration

- **Var mı:** HAYIR (yeni ayar `system_settings` satırıdır, yazılınca doğar).
- **Toplam migration:** 392 (2.15.9 ile aynı). Farklı sayı = yanlış paket ya da yanlış veritabanı → DUR.
  (Paketleme anında yeniden sayılır.)
- **Prova:** gerekmez (şema değişmedi).
- **Geri alınabilir mi:** evet — şema değişmediği için 2.15.9 imajı aynı veritabanında açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek; migration yok); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; masaüstü panel/tablet güncellemesi gerekmez (yeni ayarı kullanmak için panel ve tablet
  1.4.1 gerekir).
- **Bu sürüme özel:** yok. Yeni ayar kendiliğinden AÇILMAZ; açmak yöneticinin kararıdır (Cihaz eşleştirme bölümü).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür. Şema
değişmediğinden 2.15.9 imajı sorunsuz açılır. 2.15.10'da yazılmış `device.unpairedPasswordLogin` satırı 2.15.9'da
okunmaz (etkisiz kalır); onaysız tabletler yeniden onay ekranına düşer.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.10, sunucu ve veritabanı ayakta.
- Veritabanı: 392 migration bitmiş, sorunlu migration yok.
- `/api/admin/health` `sistemHesabiMuhru` ve `auditProtection` 2.15.9'daki değerleriyle aynı.
- `GET /api/auth/login-methods` cevabında `unpairedPasswordOnly: false` (onaylı/kimliksiz istekte).
- `docker ps`: `yedek` konteyneri de `tekserp-korumali:2.15.10` imajında.
- Masaüstü panelle giriş ve tabletle PIN girişi bugünkü gibi çalışıyor.
