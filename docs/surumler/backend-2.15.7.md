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
- **Top indirme kodu artık bekletmiyor.** Vardiya sonunda çok tablet aynı anda indirme kaydettiğinde kod sırası
  artık tek bir kilitte sıraya girmiyor (yerel ölçüm, 50 tablet: en yavaş %5 ~170 ms → ~70 ms). Kod biçimi aynı;
  başarısız bir kayıt sırada boşluk bırakabilir (bilinçli).

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
- **Etkinlik kaydı kurcalamaya karşı zincirlenir (güvenlik).** Her yeni kayıt bir öncekinin özetini taşır; araya
  kayıt silinir ya da değiştirilirse gece doğrulaması bunu yakalar ve sağlık bilgisinde "audit koruması: kısmi" görünür.
- **Linux (Docker) kurulumunda sunucu artık veritabanının sahibi olarak çalışmaz (güvenlik).** Açılışta ayrı bir
  uygulama rolü kendiliğinden kurulur; sunucu bu rolle bağlanır ve etkinlik kaydını yalnız ekleyebilir, silemez ya da
  değiştiremez. Ek ayar ya da parola gerekmez. Rol kurulamazsa sunucu bugünkü gibi açılır, sağlık bilgisinde
  "audit koruması: kısmi" görünür. Windows kurulumunda değişen yok (sonraki sürüm).
- **Şifresiz yedek indirilirken uyarı.** Yedek anahtarı kurulu değilse panel indirme sırasında uyarır (yeni panel).
- **Sevk karneleri uzun aralıkta daha hızlı açılır.** Sevk & Termin, Müşteri ve İade karneleri ile yön dağılımı
  aynı rakamı daha az okumayla hesaplar (yerel ölçüm, 1 M sevk edilmiş top: 90 gün 263 → 47 ms, 1 yıl 418 → 171 ms).
  Rakamlar aynı (brüt sevk).
- **Kalite, fire ve stok karnesinde çok uzun kırılım listesi kesilir ve söylenir.** Bir kırılım listesi 5.000 satırı
  aşarsa ilk 5.000 satır gösterilir, özet yine tüm kayıtları kapsar ve uyarı çıkar. Bugünkü veride tetiklenmez.

## 2. Ne değişti

**Dokuma raporu: Müdahale ve Çözüm Süresi (B4)** (commit `feat(rapor): B4 …`; kısa kimliği paketlemede yazılır)

- Yeni `GET /api/reports/dokuma/mudahale?from&to` (fabrika günü; izin `report:production`, rapor kapısı `dokuma/mudahale`,
  dokuma modülü). Tezgah alarmı defterinden: ortalama üstlenme (doğuş → ilk üstlenme), ortalama çözüm (doğuş →
  duruşun kapanışı), hedef aşım oranı (çözüm hedefi = K2 vadesi; canlı/hedefsiz/iptal paydada değil, sayısı basılır);
  kırılımlar sebep · hol · vardiya · tezgah. Kişi (ilk üstlenen) kırılımı yalnız `loom:alarm-escalation` sahibinin
  cevabında; yeni izin yok, atama panelden.
- `dist-web`: panel 1.6.5 kaynağı değişir (Raporlar → Dokuma karosu + rapor sayfası).

**Tezgah Salonu: tezgahta aktif operatör (D5)** (commit `feat(salon): D5 …`; kısa kimliği paketlemede yazılır)

- Salon cevabında tezgah başına `operator: { name, since } | null` — tezgahın açık ve hareketsizlik süresi dolmamış
  tablet oturumu. Salon okuması oturum kapatmaz (yazma yok).
- `dist-web`: panel 1.6.5 kaynağı değişir (detay satırı + kart ipucu).

**Tezgah Salonu: Sebep ata** (commit `feat(salon): Sebep ata …`; kısa kimliği paketlemede yazılır)

- Yeni `POST /api/machine-stops/bulk/classify/preview` ve `/bulk/classify` (izin `loom:classify`, mevcut): seçili
  tezgahların AÇIK ve sebepsiz duruşuna sebep bir kez yazılır; satır başına mevcut ilk sınıflandırma yolu, sonuç
  parçalı. Girilmiş sebebi değiştirmek salondan yapılmaz. Salon cevabında `bulkClassifyAction: true`.
- `dist-web`: panel 1.6.5 kaynağı değişir (Tezgah Salonu eylemi).

**Top indirme kodu: sayaç satırı (Perf-4 B-03)** (commit `perf(dokuma): doff kodu sayaç satırından …`; kısa kimliği paketlemede yazılır)

- İndirme kodunun günlük sırası yeni `number_series_counters` tablosundaki satırdan, kayıttan ÖNCE tek ifadeyle
  alınır; eski yol günün bütün kodlarını bir kilit altında tarıyordu. Biçim (`DF`+GGAAYY+NNNN, panel ayarları) aynı.
- Satır günün ilk indirmesinde mevcut en büyük koddan doğar: güncelleme günü sıra kaldığı yerden sürer, mevcut
  kodlar değişmez. Kayıt başarısız olursa o numara kullanılmaz (boşluk) — kod kimliktir, sayım değil.
- Panelde Numara serileri › Doff kodu "sıradaki numara" sayaç satırından okunur.

**Tezgah Salonu: çok iş → çok tezgah (C.6)** (commit `feat(salon): C.6 …`; kısa kimliği paketlemede yazılır)

- `POST /api/machine-runs/bulk/preview` hedefinde ve `/bulk/assign` satırında isteğe bağlı `weavingOrderId`
  (null = işsiz koşum): satır o işle önizlenir/açılır; verilmezse istek düzeyindeki iş (bugünkü davranış). Satır
  işinin engeli (fason/kapalı iş, iş zorunlu ayarı) yalnız o satırı engeller; istek düzeyi işin engeli bugünkü gibi
  400. Önizleme satırında `weavingOrder`, bağlam ucunda `rowJobs: true`. Yazım yolu aynı (satır başına koşum açılışı).
- `dist-web`: panel 1.6.5 kaynağı değişir (İş ver penceresinde tezgah başına iş).

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
- Duruş listesine `pendingEnd=true` süzgeci: watchdog'un geçici kapattığı ve gerçek bitişi henüz uygulanmamış
  duruşlar (panel 1.6.5 "Geçici kapanışlar" kapsamı — D5 dilim 2). Kuyruk ve sağlık sayacı aynı yüklemi okur.
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

**Performans denetimi rapor/belge (Perf-2 B5 · B6)** (commit `perf(rapor): …` ×2; kısa kimliği paketlemede yazılır)

- `reports/_shipped.collectShipped`: top yarısı aynı sevkiyat süzgecini `IN` yarı-birleşimi + `shipmentId IS NOT NULL`
  olarak da taşır; sonuç kümesi değişmez (`test_shipped_esitlik`, dondurulmuş eski sorguyla). İndeks/migration yok.
- `reports/_shared.capReportLists` + `REPORT_MAX_ROWS = 5000`: kalite · fire · stok karnesi kırılım listeleri;
  kesilirse yanıtta `warnings` (ApiResponse sözleşmesi), yoksa anahtar yok.

**Docker DB rol ayrımı (G4-A)** (commit `feat(docker): G4-A …`; kısa kimliği paketlemede yazılır)

- Açılış (`entrypoint.sh` §2b): göç + seed sahip rolüyle (compose `DATABASE_URL` = `POSTGRES_USER`, değişmedi), sonra
  `dist/tools/db-rol-gocu.cjs --uygula` `tekserp_uygulama` (`POSTGRES_USER` adı + `_uygulama`) rolünü idempotent kurar/onarır (LOGIN; süper/CREATEDB/
  CREATEROLE değil; tablolarda DML, `system_logs` yalnız SELECT+INSERT, arşiv yalnız SELECT; sonraki göçler için
  varsayılan yetkiler) ve uygulama rolüyle bağlanıp doğrular; sunucu o URL'le açılır. Parola sahip parolasından
  türetilir (yeni sır yok), PG'ye SCRAM doğrulayıcısı gider.
- Zincir hiç doğrulanmamışsa açılıştan ~1 dk sonra bir kez doğrulanır (2 dk bütçe) — yeni kurulumda `auditProtection`
  gece beklemeden "tam" olur.
- Etki: Docker'da panelin "kopyaya geri yükleme" yeteneği artık süper kullanıcı bulamaz ve bakım rolü ister (yetenek
  yoklaması bunu söyler); Docker geri yüklemesinin belgeli yolu runbook §6 (`yedek` servisi) değişmez. Gece yedeği
  (`yedek` servisi) sahip rolüyle sürer.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (Perf-2 B5/B6) — rapor zarfına isteğe bağlı `warnings` (yalnız tavan aşılınca); eski panel
  alanı okumaz, listeyi kesik görür (uyarısız). Sevk karnesi rakamları değişmez.
- **Kırıldı mı:** HAYIR (B4 müdahale raporu) — yalnız ekleme: bir rapor ucu + katalog anahtarı; 1.6.4 paneli karoyu
  çizmez, uç yalnız yeni panelden çağrılır.
- **Kırıldı mı:** HAYIR (D5) — yalnız ekleme: salon cevabında tezgah başına `operator`.
- **Kırıldı mı:** HAYIR (Sebep ata) — yalnız ekleme: iki uç, salon cevabında bir alan. Eski panel alanı okumaz.
- **Kırıldı mı:** HAYIR (C.6) — yalnız ekleme: iki gövdede isteğe bağlı satır alanı, iki cevap alanı. 1.6.4 paneli
  alanı göndermez, davranışı değişmez; 1.6.5 paneli `rowJobs` yoksa (2.15.6 sunucusu) tezgah başına seçiciyi çizmez.

- **Kırıldı mı:** HAYIR (watchdog) — yalnız ekleme: bir kart ucu (nabız), duruş cevabında
  `provisionalEndedAt`/`endCorrectedAt`/`lateEndedAt`, kart cevabında `lastSeenAt`/`silentSince`, salon cevabında
  `collectorSilentSince`, sağlıkta `machineWatchdog`, ayar cevabında iki sayı. Kartın `end`i WATCHDOG kapanışında
  artık 200 (düzeltme) döner; mühürlü vardiyada 409 `SHIFT_SEALED` + `details.lateEndQueued`. Duruş listesine
  isteğe bağlı `pendingEnd` parametresi (eski panel göndermez; yeni panel bu kapsamı eski sunucuda 400 görür).
- **Kırıldı mı:** HAYIR (kimlik dilim 3, genel) — yalnız ekleme: giriş gövdelerine isteğe bağlı
  `totpCode`/`totpCapable`, ayar yüküne `shortCredentialTotpRequired`, yedek indirmesine `X-Backup-Plain` başlığı.
  Eski panel yeni ayarı görmez.
- **Kırıldı mı:** EVET, yalnız süperadmin için (bilinçli) — PIN/kart girişinde 409 `TOTP_REQUIRED` / 403
  `TOTP_ENROLLMENT_REQUIRED`. Kod adımı olmayan eski tablet 409'u "tableti güncelleyin ya da yönetim panelinden
  giriş yapın" iletisiyle gösterir; destek hesabı panelden ya da tablet 1.4.0'dan girer. Fabrika kullanıcıları için
  bayrak kapalıyken değişen yok.
- **Kırıldı mı:** HAYIR (audit hash zinciri, G4) — yalnız ekleme: `system_logs`/arşivde iki kolon (`chainSeq`,
  `chainHash`), `/api/admin/health`te `auditProtection`, iki yeni uç (`GET /api/admin/system-logs/chain`,
  `POST /api/admin/system-logs/chain/verify`; mevcut izinler `admin:settings` / `system:activity`). Eski panel
  yeni alanları okumaz; arşiv ucu (`POST /system-logs/archive`) aynı gövde/cevapla çalışır, kesim artık DB'de en az
  1 ay zorlanır (panel zaten ≥ 1 ay gönderir).
- **Kırıldı mı:** HAYIR (Docker rol ayrımı) — HTTP sözleşmesi aynı. **Eski kurulum ne yapar:** Windows ve göçü yapılamayan
  Docker kurulumu bugünkü gibi sahip rolüyle çalışır (`auditProtection` "kismi"); eski compose dosyası + yeni imaj da
  göçer (compose değişmedi). Eski imaja geri dönüşte backend yine sahip rolüyle açılır; kalan `tekserp_uygulama` rolü
  zararsızdır.
- **Kırıldı mı:** HAYIR (doff kodu) — uç, gövde ve cevap aynı; aynı `clientToken` tekrarı yine aynı kaydı döner.
- **Eski istemci ne yapar:** eski panel ve tablet yeni alanları okumaz; davranışları değişmez. Kartın kendisi
  nabız ucunu bilmiyorsa duruş yokken sessiz görünür (yalnız uyarı; duruş açılmaz).
- **`minVersion` dokunuldu mu:** hayır.

## 4. Migration

- **Var mı:** EVET — 3 adet: `20261013010000_makine_watchdog` (yalnız EKLEME: toplayıcıya iki, duruşa bir boş
  geçilebilir alan; veri dönüşümü yok) · `20261013030000_doff_sayac_satiri` (yalnız EKLEME: boş
  `number_series_counters` tablosu; veri dönüşümü yok, satırlar ilk kullanımda doğar).
  · `20261013120000_audit_hash_zinciri` (yalnız EKLEME: `system_logs`/arşivde iki boş kolon + iki unique index,
  zincir trigger'ı, iki SECURITY DEFINER arşiv/budama fonksiyonu, tek "zincir başlangıç çapası" satırı; mevcut audit
  satırlarına DOKUNMAZ — onlar zincir öncesidir. `count`suz: yalnız `max(createdAt)` index'ten okunur).
- **Toplam migration:** 390 (2.15.6'da 387). 2.15.6'dan gelen kurulum tam 3 migration uygulamalıdır. Farklı sayı =
  yanlış paket ya da yanlış veritabanı → DUR. (Paketleme anında yeniden sayılır.)
- **Prova:** YAPILMADI — taslak; paketlemeden önce en eski canlı dump'ta restore → `migrate deploy` → bekçiler →
  profil açılışı.
- **Geri alınabilir mi:** HAYIR (bu depoda migration geri alınamaz; geri dönüş = yedekten geri yükleme).

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek + 3 migration); süre kurulumda ölçülür.
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
- Veritabanı: 390 migration bitmiş, sorunlu migration yok.
- `/api/admin/health` `machineWatchdog`: `{ silentCollectors: 0, lateStopEnds: 0 }` (kart yokken); `null` ise
  sayaç okunamadı — günlüğe bak, insana rapor et.
- `/api/admin/health` `auditProtection`: Docker'da `writeOnly: true` ve açılıştan birkaç dakika sonra `level` "tam"
  beklenir (açılış günlüğünde "Backend uygulama rolüyle açılıyor"); "DB rol ayrımı YAPILAMADI" satırı varsa
  `level` "kismi" kalır — günlükteki nedeni insana rapor et. Windows'ta "kismi" beklenir (rol göçü bu sürümde yok).
  `chain.durum` "kurcalanmis" ise insana rapor et.
- Sunucu hata günlüğünün son 30 satırı — `machine-watchdog` kaynaklı yeni hata var mı.
- Destek hesabı tablette PIN ile: kod istendi mi (2FA kurulu) ya da 403 (kurulu değil); normal kullanıcının
  PIN/kart girişi kodsuz çalışıyor mu (bayrak kapalı).
- `GET /api/reports/dokuma/mudahale` (from ve to = kurulum günü, YYYY-MM-DD; rapor izni olan hesapla) 200 dönüyor mu; `data.kisiKirilimi`
  hesabın `loom:alarm-escalation` iznine uyuyor mu.
