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
- **Tezgah Salonu'nda toplu duruş.** Elektrik kesintisi gibi birçok tezgahı birden durduran olayda seçili
  tezgahlara tek seferde duruş açılır: sebep bir kez seçilir, başlangıç "şimdi" ya da geçmiş bir saat (kesinti
  10 dakika önce olduysa) olabilir. Kesinti bitince "Hepsi çalıştı" ile hepsi birlikte kapanır; yanlış açılan toplu
  duruş da toplu geri alınır (gerekçe bir kez). Her işlemden önce etkilenen tezgahlar tek tek listelenir ve
  istenmeyen çıkarılır; olmayan tezgah sebebiyle söylenir (zaten duruşta, seçilen saat başka bir duruşla çakışıyor,
  vardiya karnesi mühürlü…). Tek tek duruş girişi aynen çalışır (yeni panel gerekir).
- **Hiç etkinleştirilmemiş sunucu yalnız lisans ekranını açar.** Lisansı etkinleştirilmemiş yeni bir kurulumda
  panel ilk girişten sonra yalnız etkinleştirme ekranını gösterir; tablet "Sunucu lisansı etkinleştirilmedi" der.
  Etkinleştirmenin birinci yolu karekod (telefonla okut, yanıtı tabletle okut ya da yapıştır), sonra kod, sonra
  portaldan indirilen dosya. Veritabanı başka bir kurulumdan kopyalanmış görünüyorsa da aynı ekran açılır; bu
  durumda yedek alma ve verileri dışa aktarma açık kalır. **Etkinleştirilmiş kurulumlar etkilenmez.** Daha önce
  kurulmuş ama hiç etkinleştirilmemiş bir sunucu bu sürüme geçmeden önce portaldan muafiyet dosyası almalıdır.
- **Taşıma talebi bekleyen yeni sunucu artık yalnız lisans ekranını açar.** Lisansı başka bir sunucuya taşırken
  yeni sunucu, talep onaylanıp portaldan iletilen taşıma kodu girilene kadar yalnız lisans ekranını gösterir;
  eski sunucu bu sürede çalışmaya devam eder. (Eskiden talep gönderilir gönderilmez yeni sunucu tam açılıyordu;
  bu, lisanssız kopyanın da açık kapısıydı.) Lisans ekranı talebin durumunu gösterir. **Etkinleştirilmiş
  kurulumlar etkilenmez.**
- **Lisans klasörü yanlış yerdeyse sunucu yalnız lisans ekranını açar.** Lisans klasörü program ya da yedek
  klasörünün içine ayarlanmışsa, yazılamıyorsa ya da okunamıyorsa (ve veritabanındaki lisans izi bunu
  karşılayamıyorsa) bu bir kurulum hatası sayılır: panel kırmızı uyarıyla yalnız lisans ekranını açar; yedek alma
  ve verileri dışa aktarma açık kalır. Eskiden bu durumda lisans denetimi tümden devre dışı kalıyordu.
- **Sunucu güncellemesi 5 dakika önceden duyurulur.** Panelden onaylanan sunucu güncellemesi hemen değil onaydan
  5 dk sonra başlar; bu sürede panel ve tabletlerde kalan süreyi gösteren bir şerit çıkar (yeni panel/tablet gerekir).
  Kurulum sırasındaki yaklaşık 1 dk kesintide yeni panel/tablet kaydı bekletir ve bağlantı gelince gönderir.
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

**Etkinleştirme kilidi (güvenlik G2)**

- `56cc360f3` — yeni lisans durumu `ETKINLESMEDI`: korumalı derlemede geçerli lisans kimliği olmayan kurulumda izinli
  küme (giriş/kimlik, `/api/license/*`, sağlık, keşif) dışındaki her `/api` isteği 403 `LICENSE_NOT_ACTIVATED`
  (`details.sinif`). Kilit derleme sabitidir; ortamdan, dosyadan ya da veritabanından açılıp kapanmaz. Veritabanı
  lisans izi bu PostgreSQL kümesine aitse ya da küme kimliği okunamıyorsa kilit yok, lisansın kendi kipi geçerli;
  iz başka kümeye aitse ya da satıcı kirası taşımıyorsa kopya sayılır (kilit + veri dışa aktarma açık).
  `/api/license/durum` ve sağlık cevabına `etkinlestirmeKilidi` alanı.
- `cb54ab35c` — satıcı imzalı muafiyet belgesi (kurulum anahtarına ve parmak izine bağlı) mevcut çevrimdışı yanıt
  yükleme ucundan kabul edilir; muafiyetli kurulum kilide girmez.

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

**Tezgah Salonu toplu duruş (F2)** (commit `feat(tezgah-salonu): F2 backend — toplu duruş aç / kapat / geri al`; kısa kimliği paketlemede yazılır)

- yeni uçlar `POST /api/machine-stops/bulk/preview` · `/bulk/open` · `/bulk/close` · `/bulk/revoke` (izin
  `loom:manual-entry`, dokuma modülü kapısı). Her tezgah mevcut tekli duruş yolundan, kendi işleminde ve tezgah
  kodu sırasıyla yazılır; olmayan tezgah sebebiyle döner, toplu işlem başına tek özet denetim kaydı
  (`MACHINE_STOP_BULK`). Toplu açılışta geçmiş saat, o tezgahın kapanmış bir duruşuyla çakışırsa satır 409
  `STOP_OVERLAP` ile düşer; tekli açılışın davranışı DEĞİŞMEDİ. Salon cevabına `bulkStopActions` (panelin eski
  sunucu tespiti). Migration YOK.

**Sunucu güncellemesi ön duyurusu** (commitler `feat(guncelleme): B backend — …` ve `feat(guncelleme): B istemciler — …`; kısa kimlikleri paketlemede yazılır)

- Onay (HEMEN/PENCERE) güncelleyici niyetine kayıttan 5 dk sonra yazılır (geri alma anında); yürürlük anını süreç
  içi tek zamanlayıcı yakalar, açılışta yeniden kurulur. Güncelleme programına dokunulmadı.
- `GET /api/guncelleme/durum` cevabına `kesinti {planlanan, kalanSn, suruyor}` ve `onay.yururluk`; dar özet ucu
  `/api/guncelleme/ozet`e aynı `kesinti` (panel ve tablet şeridi bunu okur).
- Bilinen sınır: OTOMATİK kipte (onaysız) pencere İÇİNDE hazırlanan paket ön duyurusuz kurulur (güncelleme
  programı sürümü ister; `GUNCELLEYICI-SAGLAMLIK.md` §12 R23).

**Makine kaynaklı duruş hazırlığı (D1)** (commit `feat(dokuma-alarm): makine kaynaklı duruş — tek yazma boğazı, sinyal kapanışı, dürtme birleştirme`; kısa kimliği paketlemede yazılır)

- Duruş açılışı ve kapanışı tek çekirdekten geçer (`openStopCore` · `closeStopCore`); elle giriş (tablet, panel,
  Tezgah Salonu toplu) aynı çekirdeği çağırır, davranışı ve cevapları DEĞİŞMEDİ. Toplayıcı kart için servis düzeyinde
  makine girişi (`openMachineStop` · `closeMachineStop`) hazır; HTTP ucu YOK (kart kimliği ve ingest ucu ayrı dilim).
- Alarm dürtmesi birleşir: duruş yazımından sonra motor en geç ~2 sn sonra (sürekli olay akışında en geç 5 sn'de bir)
  koşar; alarmı doğamayacak açık duruş için motor işlem açmaz. Kullanıcıya görünen etki: duruş kapanınca alarmın
  kapanması ekranda ≤ 2 sn gecikebilir (30 sn'lik tur aynen).
- Duruş cevabına üç ekleme: `signalKind`, `rawStopCode`, `collectorId` (elle duruşta `null`). Migration YOK.

**Lisans güvenlik denetimi düzeltmeleri (Bölge 3)**

- `78542d264` — B1: bekleyen taşıma talebi (imzasız `tasima.json`) kurulumu etkin SAYMAZ; etkinleştirme kilidi
  yeni makinede sürer, bekleyen talebin durumu etkin olmayan kurulumda da yoklanır; panel kilit sayfasında taşıma
  kartı + durum notu.
- `d0cc71059` — B1 satıcı kolu (satıcı sunucusu ayrı yayın; bu pakete girmez): ≤2.15.5 fabrikadan gelen taşıma
  talebi açılmaz (409 `TASIMA_SURUM_ESKI`); protokol hata kataloğuna kod (fabrika aynası + TR mesajı).
- `7e4137228` — B2: kullanılamayan lisans deposu (program/yedek dizini içinde, yazılamaz, DB izsiz okunamaz) =
  `KURULUM_HATASI` kilit sınıfı (yalnız korumalı derlemede); lisans ekranı + "verilerimi al" açık.
- B4 (`fix(lisans): B4` commit'i): destek hesabının mührü iki adımlı doğrulamayı (TOTP) da kapsar — DB'den TOTP
  sırrını değiştirmek, 2FA'yı kapatmak ya da kurtarma kodu eklemek mührü bozar (giriş 403); panelden 2FA kurma ve
  sıfırlama mührü aynı işlemde yeniler. Eski mühür ilk açılışta bir kez kendiliğinden yenilenir (lisans dizinine
  `sistem-hesabi-muhru-v2.json`), kimse kilitlenmez. Migration YOK.

**Yetki denetimi düzeltmeleri (güvenlik Bölge 2)** (commitler `fix(yetki): B1 …`, `B2 …`, `B3+B4 …`, `B5+B6 …`; kısa kimlikleri paketlemede yazılır)

- Yönetici başkasına kendisinde olmayan yetkiyi veremez (409 `GRANT_EXCEEDS_ACTOR`); tam yetkili yönetici
  etkilenmez. ⚠️ Yan etki: Sistem Yöneticisi rolü iş yetkilerini (sipariş, tablet…) taşımadığı için bunları artık
  başkasına veremez.
- Daha yetkili hesabın parola / iki adımlı doğrulama / hızlı PIN / kart sıfırlaması iki kişilik onay ister (403
  `CREDENTIAL_RESET_NEEDS_APPROVAL` → talep → hedefi kapsayan ikinci yönetici onaylar, işlem onun adına yapılır).
  ⚠️ Yan etki: tam yetkili olmayan yöneticinin operatör PIN/kart sıfırlaması da (operatör kendisinde olmayan tablet
  yetkisi taşıyorsa) ikinci onay ister. Migration `20261012120000_kimlik_sifirlama_onayi` (yeni tablo).
- Fatura işareti yalnız `shipping:invoice` ile (sevkiyat yazma yetkisi artık yetmez); Ticaret rol şablonundan
  `shipping:invoice` çıktı. ⚠️ Var olan kurulumlarda veritabanındaki Ticaret şablonu ve ona atanmış kullanıcıların
  izinleri DEĞİŞMEZ (uzlaştırma yalnız ekler) — fatura işaretini Muhasebe/Süpervizör dışında taşıyanlar elle
  gözden geçirilmeli.
- Genel kayıt formlarından varsayılan depo işareti ve donanımın son görülme/silinme damgası yazılamaz (sessiz
  düşer); kullanımdaki istasyonun türü değiştirilemez (409 `STATION_KIND_IN_USE`).
- Üretim modülü kapalıyken açık kumaş girişi ve kurşun bitirme uçları 403 `MODULE_DISABLED`; KK1 girişi ve takılı
  top kurtarma açık kalır.
- İki yeni ayar (varsayılan KAPALI = bugünkü davranış): hızlı iş emri yalnız kendi başlattıklarını düzenler;
  destek talepleri yalnız sahibine görünür (yönetici hepsini).

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
- **Kırıldı mı:** HAYIR (G2 kısmı, etkin kurulum için) — yeni hata kodu `LICENSE_NOT_ACTIVATED` yalnız korumalı
  derlemede hiç etkinleşmemiş (ya da kopya) kurulumda döner; `/api/license/durum` ve sağlık cevabına
  `etkinlestirmeKilidi` eklendi. Eski panel bu kodu tanımaz, genel hata gösterir — yeni kurulum eşleşen paneli
  (1.6.5) alır. Eski tablet 403'ü genel hata olarak gösterir.
- **Kırıldı mı:** HAYIR (lisans denetimi B1/B2, etkin ve doğru kurulmuş kurulum için) — `etkinlestirmeKilidi`ne
  yeni değer `KURULUM_HATASI` (403 `LICENSE_NOT_ACTIVATED` + `details.sinif`); eski panel bilinmeyen sınıfı
  `ETKINLESMEDI` sayar ve etkinleştirme sayfasını açar (yedek/dışa aktarma kartını göstermez — yeni panel 1.6.5
  gösterir). Satıcı hata kataloğuna `TASIMA_SURUM_ESKI` eklendi (fabrika yalnız mesajını tanır). Bekleyen taşıma
  talebi olan ve henüz kodla etkinleşmemiş yeni makine bu sürümle kilitte kalır (bilerek). B4 sözleşme
  değiştirmez (yeni alan/uç yok); TOTP sıfırlama ucu eşzamanlı kimlik değişiminde 409 `TOTP_RESET_CONFLICT`,
  kurulum penceresi tüketimi 409 `TOTP_ENROLL_CONFLICT` dönebilir.
- **Kırıldı mı:** HAYIR (tezgah alarmı kısmı) — yalnız ekleme: ayar cevabında `tezgahAlarmNoShiftMode`,
  `tezgahAlarmUnclassifiedEnabled`; salon cevabında `alarmNotice`; yeni uç `GET /api/feature-flags/tezgah-alarm-shift-status`;
  yeni hata kodları `TEZGAH_ALARM_SHIFT_REQUIRED`, `TEZGAH_ALARM_UNCLASSIFIED_MINUTES_REQUIRED`. Eski panel yalnız
  sebepsiz süreyi yollar: anahtar o kayıttan türer (süre dolu = açık), bugünkü anlam korunur; eski panel yeni kipi
  göremez, varsayılan `WARN` bugünkü davranıştır.
- **Kırıldı mı:** HAYIR (toplu duruş kısmı) — yalnız ekleme: dört yeni uç, salon cevabında `bulkStopActions`,
  yeni hata/satır kodları `STOP_OVERLAP` (409) ve `STOP_NOT_OPEN`/`TRANSIENT_CONFLICT` (yalnız toplu cevabın satırında),
  yeni sistem olayı `MACHINE_STOP_BULK`. Eski panel yeni uçları çağırmaz; yeni panel eski sunucuda toplu duruş
  eylemlerini pasif gösterir ("sunucu güncellenince açılır").
- **Kırıldı mı:** HAYIR (ön duyuru kısmı) — yalnız ekleme: durum cevabında `kesinti`, `onay.yururluk`; özet
  cevabında `kesinti`. Davranış farkı: onaydan sonra kurulum 5 dk gecikir (eski panelde de).
- **Kırıldı mı:** HAYIR (makine kaynaklı duruş kısmı) — yalnız ekleme: duruş DTO'sunda `signalKind`, `rawStopCode`,
  `collectorId`; uç, izin, hata kodu eklenmedi (makine girişinin kodları — `STOP_CLOSED_BY_OPERATOR`,
  `STOP_END_CONFLICT`, `STOP_STAMP_REQUIRED`, `STOP_SOURCE_INVALID`, `STOP_KEY_INVALID` — henüz hiçbir uçtan dönmez).
- **Kırıldı mı:** HAYIR (yetki kısmı) — yeni uçlar `/api/admin/credential-reset-requests`, yeni hata kodları
  `GRANT_EXCEEDS_ACTOR`, `CREDENTIAL_RESET_NEEDS_APPROVAL`, `STATION_KIND_IN_USE`; ayar cevabına iki alan. Davranış
  daralması: `shipping:write`-yalnız aktör fatura işaretinde 403; eski panel onay talebi akışını bilmez, 403'ü
  genel hata olarak gösterir (eşleşen panel 1.6.5).
- **Eski istemci ne yapar:** eski panel yeni alanları okumaz, uyarı şeridini göstermez; kapı sunucuda olduğu için
  güvenlik etkisi aynıdır. Tablet etkilenmez.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** EVET — 4 adet: `20261011200000_alarm_sorumlu`, `20261011210000_sistem_hesabi_muhru` (yalnız EKLEME:
  `users` tablosuna boş geçilebilir bir alan + bir kontrol kuralı; var olan satırlar boş kalır, veri dönüşümü YOK),
  `20261012010000_durus_acan_kapatan`, `20261012120000_kimlik_sifirlama_onayi` (yalnız EKLEME: yeni tablo).
- **Toplam migration:** 380 (2.15.5'te 376). 2.15.5'ten gelen kurulum tam 4 migration uygulamalıdır. Farklı sayı =
  yanlış paket ya da yanlış veritabanı → DUR. (Paketleme anında yeniden sayılır.)
- **Prova:** YAPILMADI — taslak; paketlemeden önce en eski canlı dump'ta restore → `migrate deploy` → bekçiler →
  profil açılışı.
- **Veri yazan adımlar:** güncelleme sırasında YOK. Mühür elle koşulan `--muhurle` komutuyla ya da yeni hesabın
  doğuşunda atılır; açılış işi yalnız ZATEN GEÇERLİ mührü TOTP'yi kapsayan biçime bir kez yeniler (mühürsüz ya da
  bozuk mühürlü hesaba dokunmaz) ve lisans dizinine `sistem-hesabi-muhru-v2.json` koyar.
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
  - Mühürlemeden sonra lisans dizinindeki `sistem-hesabi-mandali.json` silinmez (silmek korumayı kaldırır);
    `sistem-hesabi-muhru-v2.json` de silinmez (silinirse TOTP'yi kapsamayan eski mühür yeniden geçer).
  - **Lisans klasörünün yerini güncellemeden ÖNCE ölç:** panel Sistem → Lisans → makine kartında "Lisans klasörü"
    satırı bir sorun (program/yedek klasörünün içinde, okunamadı, yazılamadı) gösteriyorsa güncellemeden önce
    düzeltilir; yoksa güncellemeden sonra yalnız lisans ekranı açılır (veri kaybı yok; yedek ve dışa aktarma açık).
  - Taşıma talebi açık ama henüz taşıma koduyla etkinleşmemiş bir yeni sunucu bu sürümde lisans ekranında kalır:
    talep portaldan onaylanır, iletilen taşıma kodu "internetle kod" alanına girilir.
  - Hiç etkinleştirilmemiş bir kurulum bu sürüme geçecekse ÖNCE portal → kurulum künyesi → "Lisans" sekmesi →
    "Etkinleştirme muafiyeti" (yalnız yönetici; fabrikanın lisans ekranındaki karekod metni) → dosya fabrikada
    "Portaldan aldığınız lisans ya da muafiyet dosyası" alanından yüklenir. Yoksa güncellemeden sonra yalnız lisans
    ekranı açılır (veri kaybı yok; etkinleştirince ya da muafiyet yüklenince açılır).
- **Bilinen sınırlar (dürüst):** sunucunun lisans dizinini okuyabilen biri (yönetici yetkili işletim sistemi
  kullanıcısı) mühür üretebilir — koruma veritabanına yazabilen ama sunucu dosyalarına erişemeyen kişiye karşıdır.
  Etkinleştirme kilidi: veritabanı kümesinin kimliği okunamayan kurulum kilide girmez, lisansının kendi kipiyle
  çalışır — gözlem kipindeki lisansta bu fiilen sınırsız demektir (yeni kurulumların zorla kipte doğduğu sonraki
  adıma dek). Windows'ta küme kimliğinin okunabildiği henüz ölçülmedi.
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
- Veritabanı: 380 migration bitmiş, sorunlu migration yok; `users` tablosunda `systemAccountSeal` var, var olan
  kurulumda hepsi boş.
- `/api/admin/health` `sistemHesabiMuhru`: var olan (mühürlenmemiş) kurulumda `MUHURLENMELI`, mühürlemeden sonra
  `TAMAM`. Destek hesabı girişi mühürlemeden önce de sonra da çalışıyor.
- `/api/admin/health` lisans bölümünde `etkinlestirmeKilidi` etkin kurulumda `YOK` (`KURULUM_HATASI` görünürse
  lisans klasörü yanlış yerde — DUR, insana rapor et).
- Hata günlüğünün son satırları — yeni hata var mı.
