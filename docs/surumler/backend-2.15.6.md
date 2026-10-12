# Backend `2.15.6`

**Durum:** TASLAK — terfide kullanıcı onayı. Paket henüz ÜRETİLMEDİ (paket adı, SHA256, commit ve CI koşusu
paketlemede yazılır). Bu taslağa başka işlerin maddeleri de eklenecek; çakışmada birleştirilir.
**Önceki saha sürümü:** 2.15.5 (`test` grubu). Güncellenecek her kurulumda sahadaki sürüm kurulumdan önce
sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`). Güncelleme programı **0.2.6** (2.15.5'te 0.2.5),
sunucu hizmet konağı 0.2.0 (değişmedi).

## 1. Özet

- **Destek (sistem) hesabı artık bu sunucunun anahtarıyla mühürlü.** Veritabanına doğrudan yazarak bir kullanıcıyı
  destek hesabı yapmak ya da destek hesabının parolasını veritabanından değiştirmek artık tam yetki VERMEZ: mührü
  olmayan ya da başka sunucunun mührünü taşıyan hesap giriş yapamaz. Yeni kurulumda hesap mühürlü doğar.
  **Var olan kurulumlarda hiçbir şey kilitlenmez:** sunucuda bir kez mühürleme komutu koşulana dek her şey bugünkü
  gibi çalışır, panel yalnız bir uyarı şeridi gösterir (yeni panel gerekir).
- **Tezgah alarmında vardiya yokken ne olacağını fabrika seçer.** Üç seçenek: uyar (bugünkü gibi; vardiya
  dışında açılan duruş alarm üretmez, ayar ekranı ve Tezgah Salonu bunu bir şeritle söyler), vardiya yoksa da çal
  (7/24) ya da vardiya tanımlanmadan alarm açılamasın. Sebebi girilmemiş duruşun alarmı artık ayrı bir anahtarla
  açılıp kapanır; kapatmak girilen süreyi silmez. Güncellemeden sonra hiçbir şey kendiliğinden değişmez.
- **Güncelleme programı 0.2.6.** Davranışı değişmedi; ortak bağımlılık kilidi değiştiği için sürümü artırıldı.
- **Veritabanında değişiklik var** → güncelleme programı güncellemeden ÖNCE otomatik yedek alır; yedek alınamazsa
  güncelleme yapılmaz.

## 2. Ne değişti

Önceki etiket `backend-v2.15.5`e göre.

**Sistem hesabı mührü (güvenlik G1)**

- `e2a0eb240` — `users` tablosuna mühür alanı; lisans çekirdeğine mühür atma ve doğrulama işlevleri (anahtar
  çekirdekte kalır). Migration `20261011210000_sistem_hesabi_muhru`.
- `5caba6475` — yetki, giriş (parola · PIN · kart) ve tam yetki kümesi yalnız geçerli mühürlü hesaba; mühürsüz
  işaretli hesap girişte 403 `SYSTEM_ACCOUNT_SEAL_INVALID`. Kurulum aracı hesabı mühürlü doğurur; var olan kurulum
  için tek seferlik `--muhurle` komutu (hesabın parolasını sorar). Parola/PIN/kart değişimi mührü aynı anda yeniler.
  Mühür zorunluluğu lisans dizinindeki `sistem-hesabi-mandali.json` dosyasıyla açılır; dosya yoksa bugünkü davranış.
- `8a2886d08` — sahte işaretli hesap korunmaz: `admin:users` yetkili yönetici onu panelden pasife alabilir; gerçek
  (mühürlü) hesap başkasınca pasife alınamaz (bugünkü gibi).
- `e76f5b547` — `/api/admin/health` cevabına `sistemHesabiMuhru` (durum ve sayılar; mühür, parola özeti, kullanıcı
  adı taşımaz), `/api/auth/me` cevabına `systemAccountSealStatus`.

**Güncelleme programı**

- `2f801abdb` — `tekserp-guncelleyici` 0.2.5 → 0.2.6: lisans çekirdeğine eklenen bağımlılık ortak `Cargo.lock`u
  değiştirdi; kod davranışı aynı.

**Tezgah alarmı: vardiya yokken + sebepsiz duruş anahtarı** (commit `feat(dokuma-alarm): vardiyasız kip ayarı + sebepsiz duruşta alarm anahtarı`; kısa kimliği paketlemede yazılır)

- yeni ayar `tezgah.alarm.noShiftMode`: `WARN` (varsayılan, bugünkü davranış) · `ALWAYS` (vardiyaya
  bakılmaz, hedef süre duruşun açılışından sayılır) · `REQUIRE_SHIFT` (etkin vardiya tanımı yokken alarm açılamaz;
  yalnız açarken ya da kipi buna çevirirken 400 `TEZGAH_ALARM_SHIFT_REQUIRED`, kapatma engellenmez). Tezgah Salonu
  cevabına `alarmNotice` (vardiya tanımlı değil / şu an vardiya yok), yeni salt okuma uç
  `GET /api/feature-flags/tezgah-alarm-shift-status` (ayar ekranının şeridi; tezgah modülü + alarm ayarı yazma izni).
- yeni anahtar `tezgah.alarm.unclassifiedEnabled` (sebepsiz duruşta alarm). Kayıt yoksa bugünkü anlam:
  süre girilmişse açık. Açıkken süre zorunlu (400 `TEZGAH_ALARM_UNCLASSIFIED_MINUTES_REQUIRED`). Kapılar hiçbir ayarı
  yazmadan önce koşar — reddedilen kayıt yarım yazılmaz.

**Bu sürüme giren öteki işler (maddeleri sahipleri yazacak):** tezgah alarmı sorumluları ve "Kime bildirildi"
(`7f937535e`, `cb82c8b75`, migration `20261011200000_alarm_sorumlu`), duruşu açan/kapatan (`32d78acce`, migration
`20261012010000_durus_acan_kapatan`), alarm görme yetkisi tek liste (`c736606c6`), Tezgah Salonu toplu iş ver /
değiştir / bitir (`4616c45b8`), mobil uyarılar (`da832d60b`, sunucu tarafı).

**Pakete girmeyen:** panel (mühür uyarı şeridi `e76f5b547`, Tezgah Salonu F3 paneli `ba6b58df4`) ayrı sürümle
çıkar. Bekçiler ve belgeler.

**Değişmeyen:** var olan uçların sözleşmesi; mandalsız (mühürlenmemiş) kurulumda yetki davranışı.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR (G1 kısmı) — yalnız ekleme: `/api/auth/me` `systemAccountSealStatus`, health
  `sistemHesabiMuhru`, yeni hata kodu `SYSTEM_ACCOUNT_SEAL_INVALID` (yalnız mühür zorunlu kurulumda, mühürsüz
  işaretli hesaba). Öteki işlerin sözleşme cevabı maddeleriyle eklenecek.
- **Kırıldı mı:** HAYIR (tezgah alarmı kısmı) — yalnız ekleme: ayar cevabında `tezgahAlarmNoShiftMode`,
  `tezgahAlarmUnclassifiedEnabled`; salon cevabında `alarmNotice`; yeni uç `GET /api/feature-flags/tezgah-alarm-shift-status`;
  yeni hata kodları `TEZGAH_ALARM_SHIFT_REQUIRED`, `TEZGAH_ALARM_UNCLASSIFIED_MINUTES_REQUIRED`. Eski panel yalnız
  sebepsiz süreyi yollar: anahtar o kayıttan türer (süre dolu = açık), bugünkü anlam korunur; eski panel yeni kipi
  göremez, varsayılan `WARN` bugünkü davranıştır.
- **Eski istemci ne yapar:** eski panel yeni alanları okumaz, uyarı şeridini göstermez; kapı sunucuda olduğu için
  güvenlik etkisi aynıdır. Tablet etkilenmez.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** EVET — 3 adet: `20261011200000_alarm_sorumlu`, `20261011210000_sistem_hesabi_muhru` (yalnız EKLEME:
  `users` tablosuna boş geçilebilir bir alan + bir kontrol kuralı; var olan satırlar boş kalır, veri dönüşümü YOK),
  `20261012010000_durus_acan_kapatan`.
- **Toplam migration:** 379 (2.15.5'te 376). 2.15.5'ten gelen kurulum tam 3 migration uygulamalıdır. Farklı sayı =
  yanlış paket ya da yanlış veritabanı → DUR. (Paketleme anında yeniden sayılır.)
- **Prova:** YAPILMADI — taslak; paketlemeden önce en eski canlı dump'ta restore → `migrate deploy` → bekçiler →
  profil açılışı.
- **Veri yazan adımlar:** güncelleme sırasında YOK. Mühür yalnız elle koşulan `--muhurle` komutuyla ya da yeni
  hesabın doğuşunda yazılır.
- **Geri alınabilir mi:** migration geri alınmaz. İmaj 2.15.5'e dönebilir: eski sürüm mühür alanını okumaz, destek
  hesabı bugünkü gibi çalışır (mühür koruması o sürede yoktur). Tam dönüş = güncelleme öncesi yedekten geri yükleme.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek + 3 migration); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; uyarı şeridini gösteren panel sonra.
- **Bu sürüme özel:**
  - Migration var → güncelleme programı güncellemeden önce otomatik yedek alır. Yedek adımı geçmeli.
  - Var olan kurulumda güncelleme mühürlemez. Mühürleme ayrı ve elle yapılan bir adımdır: sunucuda gerçek
    terminalde `node dist/tools/superadmin-olustur.cjs --muhurle` (Docker ve Windows yazımı
    `docs/ops/SUPERADMIN-KURULUM.md` § MÜHÜRLEME). Hesabın parolası sorulur; parola sohbete, belgeye, günlüğe
    YAZILMAZ — komutu destek hesabının sahibi koşar. adnansahin bu sürümde mühürlenmez.
  - Mühürlemeden sonra lisans dizinindeki `sistem-hesabi-mandali.json` silinmez (silmek korumayı kaldırır).
- **Bilinen sınırlar (dürüst):** sunucunun lisans dizinini okuyabilen biri (yönetici yetkili işletim sistemi
  kullanıcısı) mühür üretebilir — koruma veritabanına yazabilen ama sunucu dosyalarına erişemeyen kişiye karşıdır.
  Ortak parolalı hazır destek hesabının yalnız sunucunun kendisinden girişi (tehdit modeli G1-6) bu sürümde YOK.
  2.15.0–2.15.5 belgelerindeki güncelleme programı sınırları aynen geçerli.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür; geri dönülen
sürüm kendiliğinden yeniden denenmez. Migration geri alınmaz; 2.15.5 imajı yeni alanlarla açılır (onları okumaz).
Veriyi güncelleme öncesine döndürmek gerekirse otomatik yedekten geri yüklenir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.6, sunucu ve veritabanı ayakta.
- Güncelleme programı hizmeti çalışıyor; `durum` kurulu sürüm 2.15.6, güncelleme programı 0.2.6, kira geçerli
  (DONDURULDU / KIRA_YOK yok).
- Yedek: güncelleme öncesi yedek alındı; günlükte `SEMA_OLCULEMEDI` yok.
- Veritabanı: 379 migration bitmiş, sorunlu migration yok; `users` tablosunda `systemAccountSeal` var, var olan
  kurulumda hepsi boş.
- `/api/admin/health` `sistemHesabiMuhru`: var olan (mühürlenmemiş) kurulumda `MUHURLENMELI`, mühürlemeden sonra
  `TAMAM`. Destek hesabı girişi mühürlemeden önce de sonra da çalışıyor.
- Hata günlüğünün son satırları — yeni hata var mı.
