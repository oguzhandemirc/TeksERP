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

- **Destek hesabı tablette PIN ya da kartla girerken doğrulama kodu da ister (güvenlik).** PIN tek başına
  kimlik olduğu için destek (sistem) hesabı artık PIN/kartla yalnız telefondaki doğrulama koduyla girer. Hesapta iki
  adımlı doğrulama kurulmamışsa PIN/kart girişi reddedilir; kullanıcı adı ve parolayla girip doğrulamayı kurar.
  Eski tablet kodu soramadığı için destek hesabı eski tabletten PIN/kartla giremez ("tableti güncelleyin").
- **İsteğe bağlı: iki adımlı doğrulaması açık kullanıcıya PIN/kartta da kod sorulsun.** Ayarlar → Oturum'da yeni
  anahtar; varsayılan KAPALI, güncellemeden sonra hiçbir şey kendiliğinden değişmez (yeni panel gerekir).
- **Parola özetleri daha güçlü (güvenlik).** Yeni parolalar daha pahalı bir özetle saklanır; var olan parolalar
  kullanıcı bir sonraki girişinde kendiliğinden yükseltilir. Kullanıcı bir şey yapmaz.
- **Silinen kullanıcının giriş bilgileri tamamen temizlenir.** Kayıt (geçmiş ve atıflar için) durur ama parola,
  doğrulama sırrı, PIN, kart ve kullanılmamış kurtarma kodları kalmaz.
- **Etkinlik kaydı hiçbir sırrı yazmaz.** İç içe kayıtlardaki parola/PIN/kart özetleri de gizlenir.
- **Şifresiz yedek indirilirken uyarı.** Yedek anahtarı kurulu değilse panel indirme sırasında uyarır (yeni panel).

## 2. Ne değişti

**Tezgah Salonu: Sebep ata** (commit `feat(salon): Sebep ata …`; kısa kimliği paketlemede yazılır)

- Yeni `POST /api/machine-stops/bulk/classify/preview` ve `/bulk/classify` (izin `loom:classify`, mevcut): seçili
  tezgahların AÇIK ve sebepsiz duruşuna sebep bir kez yazılır; satır başına mevcut ilk sınıflandırma yolu, sonuç
  parçalı. Girilmiş sebebi değiştirmek salondan yapılmaz. Salon cevabında `bulkClassifyAction: true`.
- `dist-web`: panel 1.6.5 kaynağı değişir (Tezgah Salonu eylemi).

**Makine kartı: watchdog (D4)** (commit `feat(tezgah): makine kartı watchdog'u …`; kısa kimliği paketlemede yazılır)

- Kart belirli süre (ayar `tezgah.collectorSilenceMinutes`, varsayılan 10 dk) hiçbir imzalı istek göndermezse
  "sessiz" sayılır: kayıt, Tezgah Salonu cevabında `collectorSilentSince`, sağlık ekranında sayaç. Sessizlik duruş
  AÇMAZ. Kart duruş yokken canlı kalmak için yeni nabız ucunu çağırır (`POST /api/machine-signals/heartbeat`).
- Kartın açtığı duruş uzun süre (ayar `tezgah.maxOpenStopHours`, varsayılan 12 sa) kapanmazsa sunucu onu GEÇİCİ
  kapatır (tahmin olduğu kayıtta yazılı); kartın sonradan gelen "bitti"si bunu bir kez düzeltir. Vardiya karnesi
  mühürlüyse düzeltme bekletilir ve mühür açılınca uygulanır. Elle bildirilen duruşlara dokunulmaz.
- Watchdog işi 60 sn'de bir koşar (tek süreç); tezgah ya da dokuma modülü kapalıyken iş yapmaz. İki ayarın panel
  satırı sonraki panel sürümünde.
- İki eşik `settings:dokuma` izin kapsamında (öteki tezgah ayarlarıyla aynı): bu izinle Genel Ayarlar › Tezgah
  izleme'den yazılır (panel 1.6.5 satırları — D5 dilim 1).
- `dist-web`: bu madde panel kaynağını değiştirmez.

**Kimlik dilim 3 (güvenlik denetimi Y-02, B1, B2, B4, B5)** (commit `fix(kimlik): dilim 3 …`; kısa kimliği paketlemede yazılır)

- PIN/kart girişinde ikinci faktör: tek kapı `AuthService.assertSecondFactor` (token üretiminden ÖNCE). Süperadmin
  PIN/kart: kod her zaman; 2FA kurulmamışsa 403 `TOTP_ENROLLMENT_REQUIRED`. Diğerleri: TOTP açık ∧ yeni oturum
  bayrağı `auth.shortCredentialTotpRequired` (varsayılan false). Giriş uçlarına isteğe bağlı `totpCode`, `totpCapable`.
- bcrypt turu 10 → 12 (`PASSWORD_BCRYPT_COST`); eski özet başarılı parolalı girişte yükseltilir (sistem hesabında
  mühür aynı yazımda yenilenir). Kurtarma kodları bilerek 10.
- `deleteUser`: parola özeti geçersiz değere, TOTP/PIN/kart alanları boşa çekilir; kullanılmamış kurtarma kodları
  silinir; eşzamanlı değişimde 409 `USER_DELETE_CONFLICT`.
- Audit `oldData`/`newData`/`payload` derin maskeli (`maskAuditPayload`).
- Düz yedek indirmesi `X-Backup-Plain: 1` başlığı + audit `plain`; Docker kaynak kurulumunda `BACKUP_KEY_DIR`
  birimi (boş = kapalı).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (Sebep ata) — yalnız ekleme: iki uç, salon cevabında bir alan. Eski panel alanı okumaz.

- **Kırıldı mı:** HAYIR (watchdog) — yalnız ekleme: bir kart ucu (nabız), duruş cevabında
  `provisionalEndedAt`/`endCorrectedAt`/`lateEndedAt`, kart cevabında `lastSeenAt`/`silentSince`, salon cevabında
  `collectorSilentSince`, sağlıkta `machineWatchdog`, ayar cevabında iki sayı. Kartın `end`i WATCHDOG kapanışında
  artık 200 (düzeltme) döner; mühürlü vardiyada 409 `SHIFT_SEALED` + `details.lateEndQueued`.
- **Kırıldı mı:** HAYIR (kimlik dilim 3, genel) — yalnız ekleme: giriş gövdelerine isteğe bağlı
  `totpCode`/`totpCapable`, ayar yüküne `shortCredentialTotpRequired`, yedek indirmesine `X-Backup-Plain` başlığı.
  Eski panel yeni ayarı görmez.
- **Kırıldı mı:** EVET, yalnız süperadmin için (bilinçli) — PIN/kart girişinde 409 `TOTP_REQUIRED` / 403
  `TOTP_ENROLLMENT_REQUIRED`. Kod adımı olmayan eski tablet 409'u "tableti güncelleyin ya da yönetim panelinden
  giriş yapın" iletisiyle gösterir; destek hesabı panelden ya da tablet 1.4.0'dan girer. Fabrika kullanıcıları için
  bayrak kapalıyken değişen yok.
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
- **Bu sürüme özel (kimlik dilim 3):** destek hesabıyla tablette PIN/kart kullanılıyorsa güncellemeden ÖNCE hesapta
  iki adımlı doğrulamanın kurulu olduğu ölçülür; değilse parolayla girip kurulur. Migration getirmez.
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
- Destek hesabı tablette PIN ile: kod istendi mi (2FA kurulu) ya da 403 (kurulu değil); normal kullanıcının
  PIN/kart girişi kodsuz çalışıyor mu (bayrak kapalı).
