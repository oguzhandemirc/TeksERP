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
- **Yazarak etkinleştirme (internet ve karekod yoksa, geçici).** Etkinleştirilmemiş sunucunun lisans ekranında bir
  istek kodu görünür; satıcıya okunur, satıcının verdiği 23 gruplu geçici açılış kodu yazılınca program kodun süresi
  boyunca açılır. Bitişe 7 gün kala uyarı, bitişten sonra 30 gün ek süre, sonra kısıtlı kip. Tam etkinleştirme yine
  karekod ya da internetle yapılır.
- **Lisans dosyaları kaybolan yeni sürüm kurulumda süre sınırı.** Lisans klasörü silinmiş ya da kaybolmuş ama
  veritabanı daha önce zorlama kipinde etkinleştirilmiş bir lisansın izini taşıyan sunucu artık süresiz çalışmaz:
  14 gün uyarı, sonra 30 gün ek süre, sonra kısıtlı kip (okuma, rapor, yedek ve dışa aktarma açık). Yeniden
  etkinleştirince kalkar. Gözlem kipindeki eski kurulumlar ve etkinleştirilmiş kurulumlar etkilenmez.
- **Lisans klasörü yanlış yerdeyse sunucu yalnız lisans ekranını açar.** Lisans klasörü program ya da yedek
  klasörünün içine ayarlanmışsa, yazılamıyorsa ya da okunamıyorsa (ve veritabanındaki lisans izi bunu
  karşılayamıyorsa) bu bir kurulum hatası sayılır: panel kırmızı uyarıyla yalnız lisans ekranını açar; yedek alma
  ve verileri dışa aktarma açık kalır. Eskiden bu durumda lisans denetimi tümden devre dışı kalıyordu.
- **Sunucu güncellemesi 5 dakika önceden duyurulur.** Panelden onaylanan sunucu güncellemesi hemen değil onaydan
  5 dk sonra başlar; bu sürede panel ve tabletlerde kalan süreyi gösteren bir şerit çıkar (yeni panel/tablet gerekir).
  Kurulum sırasındaki yaklaşık 1 dk kesintide yeni panel/tablet kaydı bekletir ve bağlantı gelince gönderir.
- **Giriş ve lisans işlemlerine dakika sınırı (güvenlik).** Giriş (parola · PIN · kart), iki adımlı doğrulama
  kurulumu ve lisans işlemleri artık aynı adresten dakikada en çok 60 kez denenebilir; aşılırsa kısa bir bekleme
  istenir ("çok fazla istek", 429). Normal kullanımda fark edilmez. Kapatmak için sunucu ayarında
  `RATE_LIMIT_ENABLED=false`.
- **İnternete açık kurulumda yanlış vekil ayarı sunucuyu açmaz.** Bizim yönettiğimiz/barındırılan kurulumda
  `TRUST_PROXY=true` yazılıysa sunucu başlamaz ve doğru değeri (`TRUST_PROXY=1`) söyler. Fabrika kurulumları etkilenmez.
- **Küçük güvenlik düzeltmeleri.** Excel/CSV dışa aktarımında `=`, `+`, `-`, `@` ile başlayan metin hücrelerinin
  başına `'` konur (Excel formül sanmasın); kullanıcı adı/parola 256 karakterle sınırlı; tanımsız bir veri kuralı
  ihlalinde hata mesajı iç kural adını değil bir başvuru kodunu gösterir; cihaz tanıma deseni olarak tableti
  kilitleyebilecek desenler kaydedilmez.
- **Tablet kimliği taklit edilemez (cihaz kanıtı).** Onaylı tablet sunucudan bir kez gizli bir anahtar alır ve
  her isteğini onunla imzalar; başka bir cihaz yalnız tabletin numarasını yazarak onun yerine geçemez. Bulut
  (barındırılan) kurulumda bu kural her zaman açıktır — **barındırılan kurulumda tabletler önce OTA ile
  güncellenir**, sonra sunucu; eski tablet orada her istekte reddedilir. Fabrika kurulumunda yeni bir ayar
  ("Cihaz kanıtı zorunlu") kapalı gelir ve hiçbir şey değişmez; bütün tabletler güncellendikten sonra açılabilir.
- **Dokuma karneleri tam aralığı sayar ve hızlandı.** Randıman, Duruş Pareto, Vardiya Karnesi ve Karne Listesi
  artık seçilen tarih aralığının BÜTÜN tezgah × vardiya satırlarını toplar. **Karne toplamları artık tam aralığı
  kapsar; eski sürüm ilk 500 çifti sayıyordu** — çok tezgahlı fabrikada aynı aralığın rakamı bu yüzden değişir
  (200 tezgahta 7 gün = 4.200 çift; eskiden ilk 2,5 vardiya sayılıyordu). Satır listesi sayfa sayfa döner
  (toplamlar sayfadan bağımsız). 200 tezgah × 7 günlük randıman 4–6 sn'den 0,5–0,9 sn'ye indi.
- **Toplu etiket hızlandı.** 2.000 topluk toplu etiket ilk basımda ~8 sn'den ~5,6 sn'ye, aynı topların
  yeniden basımında ~2 sn'ye indi; barkod ve karekod görüntüsü değişmedi (aynı çizgiler, aynı boyut). Uzun
  baskı sırasında diğer istasyonlar takılmaz.
- **Yoğun anda top girişi ve duruş açma hızlandı.** Aynı anda çok tabletten top girildiğinde girişler artık barkod
  sayacında birbirini beklemiyor; tezgah duruşu açmak veritabanı bağlantısını daha az meşgul ediyor; Tezgah Salonu
  duruş penceresi ve depo hareket listesi yeni indekslerle hızlandı. Başarısız bir girişin ayırdığı barkod numarası
  boş kalabilir (numaralar yine tekil).
- **Gece bakımı (davranış değişir — dört madde).** ① Denetim kaydı arşivi artık **3 yıl** saklanır, daha eskisi
  gece silinir (bugüne dek sonsuz saklanıyordu; ayar `audit.archiveRetentionYears`, `0` = hiç silme). Denetim
  kaydı yalnız ayak izidir — rapor ve sayılar ondan türemez. ② Güncelleme öncesi alınan geri dönüş yedekleri
  (`premigrate_`) döner: en yeni 3 her zaman kalır, kalanlardan 90 günden eskiler silinir. ③ Denetim kaydı
  arşivleyicisi yalnız gece 02:00–05:00 arasında (fabrika saati) çalışır, mesai saatinde yük bindirmez. ④ 90 günden
  eski kapanmış oturum kayıtları her gece kendiliğinden temizlenir. Ayrıca yoğun tablolarda veritabanı bakımı daha
  sık tetiklenir; Linux (Docker) kurulumunda veritabanı paylaşımlı belleği 256 MB ve konteyner günlükleri sınırlı.
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

**Makine kaynaklı duruş: ham kod → sebep eşlemesi (D2)** (commitler `feat(dokuma): makine duruşu D2 — …` ×2; kısa kimlikleri paketlemede yazılır)

- Yeni tablo `machine_stop_code_maps`: kart tipi + kartın ham duruş kodu → tezgah duruş sebebi; isteğe bağlı tezgah
  satırı o tezgah için genel eşlemeyi ezer. Kart duruş bildirdiğinde eşleşme varsa sebep makine kararı olarak
  açılışta yazılır (hedef süre dahil donar), yoksa duruş bugünkü gibi sebepsiz açılır. Toplayıcıya boş geçilebilir
  `collectorType` alanı (yazarı kart onay dilimi). Migration `20261012140000_makine_durus_kod_esleme` (yalnız EKLEME).
- Yeni uçlar `GET/POST /api/machine-stop-code-maps`, `GET/PATCH/DELETE /api/machine-stop-code-maps/:id` (tezgah
  modülü, izin `loom:spec-manage` — yeni izin kodu yok). Silme pasife almadır; eşlemeyi değiştirmek geçmiş duruşu
  değiştirmez. Panel ekranı ayrı dilim; kart bugün sahada olmadığından eşlemenin etkisi yok.

**Makine kartı: kimlik ve imzalı duruş ucu (D3)** (commitler `feat(tezgah): makine kartı …` ×2 + bekçi; kısa kimlikleri paketlemede yazılır)

- Makine kartı (tezgaha takılan toplayıcı) panel/API'den kaydedilir: ad, kart tipi, bağlı tezgahlar (bir tezgah
  tek karta). Kart sırrı yalnız kayıtta ve yenilemede bir kez gösterilir; veritabanında sır yoktur (yalnız tohum,
  sır sunucunun anahtar halkasından türer). Yeni uçlar `GET/POST /api/machine-collectors`,
  `GET/PATCH /api/machine-collectors/:id`, `POST …/:id/rotate-secret`, `POST …/:id/revoke` (tezgah modülü, izin
  `loom:spec-manage` — yeni izin kodu yok). Migration `20261012180000_makine_kart_kimligi` (yalnız EKLEME).
- Kartın kendi uçları `POST /api/machine-signals/stop` (duruş başladı) ve `/end` (bitti): oturum yok, her istek
  kart imzalı (kimlik + zaman damgası ±5 dk + tek kullanımlık nonce + HMAC-SHA256); bağlı olmayan tezgaha 403;
  kart başına hız sınırı. Protokol: `docs/design/MAKINE-KART-PROTOKOLU.md`.
- Operatör bir duruşu önce bildirmişse kart onu sahiplenir: başlangıç operatörünki kalır, kart kodu (ve eşleşirse
  sebep — operatör sebep girmemişse) yazılır, kapanışı kart yapar; operatör önce "Çalıştı" dediyse kartın "bitti"si
  kapanışı değiştirmez. Duruş cevabına `signalStopKey` eklendi. Migration `20261012190000_makine_kart_sahiplenme`
  (yalnız EKLEME). Kart bugün sahada olmadığından kurulumda görünen değişiklik yok.

**Lisans güvenlik denetimi düzeltmeleri (Bölge 3)**

- `78542d264` — B1: bekleyen taşıma talebi (imzasız `tasima.json`) kurulumu etkin SAYMAZ; etkinleştirme kilidi
  yeni makinede sürer, bekleyen talebin durumu etkin olmayan kurulumda da yoklanır; panel kilit sayfasında taşıma
  kartı + durum notu.
- `d0cc71059` — B1 satıcı kolu (satıcı sunucusu ayrı yayın; bu pakete girmez): ≤2.15.5 fabrikadan gelen taşıma
  talebi açılmaz (409 `TASIMA_SURUM_ESKI`); protokol hata kataloğuna kod (fabrika aynası + TR mesajı).
- `dcd25fc67` · `acc88f1b5` — taşıma talebi iptal yüzeyi (satıcı sunucusu + portal web, ayrı yayın; bu pakete
  girmez): bayi kendi kurulumunu hedefleyen bekleyen taşıma talebini portalda görür ve gerekçeyle reddeder,
  onay yalnız satıcıda; satıcı taşıma listesinde hedef kimlik kolonu ve süzgeci.
- `7e4137228` — B2: kullanılamayan lisans deposu (program/yedek dizini içinde, yazılamaz, DB izsiz okunamaz) =
  `KURULUM_HATASI` kilit sınıfı (yalnız korumalı derlemede); lisans ekranı + "verilerimi al" açık.
- `6fd3d8ae9` — B4: destek hesabının mührü iki adımlı doğrulamayı (TOTP) da kapsar — DB'den TOTP
  sırrını değiştirmek, 2FA'yı kapatmak ya da kurtarma kodu eklemek mührü bozar (giriş 403); panelden 2FA kurma ve
  sıfırlama mührü aynı işlemde yeniler. Eski mühür ilk açılışta bir kez kendiliğinden yenilenir (lisans dizinine
  `sistem-hesabi-muhru-v2.json`), kimse kilitlenmez. Migration YOK.
- `d9572aa77` — B6/G3: etkinleşmemiş (korumalı derleme) kurulumda veritabanında `zorla` kipli başka bir kurulumun
  izi (aynı PG kümesi ya da küme kimliği okunamadı) varsa kip zorla olur ve merdiven akar: 14 g uyarı → 30 g ek
  süre → kısıtlı. Başlangıç lisans dizinindeki kurulum anahtarıyla imzalı `yabanci-iz-baslangic.json`dan sayılır
  (veritabanını silmek/geri yüklemek sıfırlamaz); etkinleştirme ek süresi bu kurulumda ilk açılıştan sayılmaz.
  Gözlem kipli iz ve korumasız derleme bugünkü gibi. Sözleşme değişmez (yeni alan/uç/kod yok).
- `e61fa7cc0` — yazarak etkinleştirme (G2 yazma yolu): istek kodu `TI-…` LICENSE_DIR'de bekler; `TG-…` 23×5 açılış
  kodu yalnız ÜRETİM sınıflı gömülü kökle, istek koduna bağlı imzayla, tek kullanımlık doğrulanır; geçici etkinlik
  kilit sınıfı açmaz (neden `GECICI`), merdiven ≤ 7 g uyarı → 30 g ek süre → kısıtlı, yalnız korumalı derlemede;
  tam etkinleştirme geçici kaydı kapatır, tüketim satıcıya kuyrukla bildirilir.
- `40ea5684f` — `GET /api/license/durum` cevabına `gecici: {bitis, kalanGun, kodSonu} | null` (panel bandı).

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

**Girdi ve ağ denetimi düzeltmeleri (güvenlik Bölge 4+5)** (`1694bbf10`, `2341c80e0`, `6fe734733`, `e3b19ba01`)

- Değişkensiz kurulumda giriş/PIN/kart, `/api/auth/totp/enroll` ve `/api/license/*` yazma uçları IP başına 60/dk
  (429 `RATE_LIMITED` + `Retry-After`); genel yazma kovası yalnız `RATE_LIMIT_ENABLED=true`de; `=false` hepsini kapatır.
- Barındırılan kurulumda `TRUST_PROXY=true` → açılış durur (`process.exit(1)`, Türkçe gerekçe); `TRUST_PROXY` yoksa uyarı.
- Tanımsız CHECK ihlali 409: mesajda kısıt adı yok, `details: {code: "INTEGRITY_RULE", ref}` (8 hex başvuru kodu; ad log'da).
- Mükerrer kayıt CSV'si metin hücresine `'` öneki; LIKE aramalarında `%` `_` `\` kaçışı (7 yer); giriş gövdesi
  `username`/`password` 256 üstü 400; belge önizlemesinde taslak ayar temizleyiciden geçer.
- Cihaz tanıma deseni (`Peripheral.identifyPattern`) iç içe niceleyici · tekrarlanan seçenek · geri başvuru ·
  255 üstü → 400.
- pm2→hizmet geçiş betiği LAN TLS satırı olmayan kurulumda `LAN_TLS_MODE=dual` yazar + HTTPS 4443 duvar kuralı
  (geçiş paketinde; güncellemeyle gelmez).

**Cihaz kanıtı (güvenlik Bölge 5 B3)** (`1afaf3b57` backend · `aa72ab54b` tablet · `4b114fd30` panel)

- Onaylı cihaza announce/status cevabında `deviceSecret` (bir kez; teyit edilene dek yeniden, sonra yalnız revoke
  ile). İstek başlığı `x-device-proof` = sürüm + milisaniye damgası + sırla HMAC (ileti: sürüm, damga, HTTP yöntemi ve yol), ±5 dk.
- DB'de sır yok: `devices.proofSalt` (yalnız tuz) · `proofIssuedAt` · `proofConfirmedAt`; sır kısa kimlik
  halkasından türetilir. Migration `20261012150000_cihaz_kaniti` (yalnız EKLEME).
- Yeni ayar `device.proofRequired` (varsayılan KAPALI = bugünkü davranış; barındırılanda daima açık, kapatma 409
  `HOSTED_CLASS_FORCED`). Zorlanırken kanıtsız/yanlış kanıtlı istek 401 `DEVICE_PROOF_INVALID`; anahtar halkası
  okunamazsa 503. Audit olayı `DEVICE_PROOF_SECRET_ISSUED`.

**Performans dilimi 1**

- `8a4d99a11` — KK1 ilk giriş ve takılı top kurtarma top barkodunu yazma tx'i açılmadan önce alıyor; sayaç satır
  kilidi tx boyunca tutulmuyor. Başarısız tx'in numarası boşluk kalır. Bekçi `test_perf_sayac_tx_disi` (`9ee23ff3c`).
- `3007ca16e` — Migration `20261012200000_perf_indeksler`: duruş penceresi, tezgah çalışması, depo defteri sırası
  indeksleri (yalnız indeks).
- `6179b0119` + `0518b363d` — duruş açmada replay okuması tx içinde; istek başına havuz alımı 9 → 2. Sözleşme aynı.

**Performans dilimi 4 (bakım)**

- `5828ac5ec` — Migration `20261012210000_autovacuum_tablo_ayarlari`: altı yoğun tabloda (`rolls` ·
  `machine_stop_events` · `machine_runs` · `system_logs` · `system_log_archives` · `sessions`) autovacuum eşiği
  0.02 / analyze 0.01 (yalnız tablo ayarı, veri yazmaz).
- `e9631a4ad` — korumalı compose: postgres `shm_size: 256m`, üç serviste json-file günlük sınırı (20m × 5).
- `226e47cf3` — günlük bakım işi (fabrika saati 02:00–05:00): `premigrate_` yedek rotasyonu (en yeni 3 + 90 gün),
  sistem olayı `BACKUP_ROTATED`. Güncelleyici işlem yedekleri bu sürümde dönmez (güncelleyici 0.2.7).
- `30f8a1f98` — yeni ayar `audit.archiveRetentionYears` (varsayılan 3, `0` = budama yok): arşiv budaması aylık
  dilimle, sistem olayı `AUDIT_ARCHIVE_PURGE`; ölü oturum budaması 90 gün otomatik; arşivleyici yalnız gece
  penceresinde. **Varsayılan bugünkü davranışı değiştirir** (sonsuz → 3 yıl). Bekçi `test_bakim_isleri` (`79a67f2f6`).

**Bu sürüme giren öteki işler (maddeleri sahipleri yazacak):** tezgah alarmı sorumluları ve "Kime bildirildi"
(`7f937535e`, `cb82c8b75`, migration `20261011200000_alarm_sorumlu`), duruşu açan/kapatan (`32d78acce`, migration
`20261012010000_durus_acan_kapatan`), alarm görme yetkisi tek liste (`c736606c6`), Tezgah Salonu toplu iş ver /
değiştir / bitir (`4616c45b8`), mobil uyarılar (`da832d60b`, sunucu tarafı).

**Pakete girmeyen:** panel (mühür uyarı şeridi `e76f5b547`, Tezgah Salonu F3 paneli `ba6b58df4`) ayrı sürümle
çıkar. Bekçiler ve belgeler.

**Değişmeyen:** var olan uçların sözleşmesi; mandalsız (mühürlenmemiş) kurulumda yetki davranışı.

**İki adımlı doğrulama sırrı şifreli saklanır (güvenlik denetimi B1c)**

- TOTP sırrı veritabanında artık şifreli durur (anahtar lisans klasöründeki kısa kimlik anahtar halkasından türer;
  halka zaten şifreli yedeğin emanetindedir, ek anahtar dosyası yoktur). Düz yedek dosyası (`.dump`) açık sırrı
  taşımaz. Açılışta var olan düz sırlar BİR KEZ şifrelenir; ikinci açılış dokunmaz. Destek hesabının mührü
  değişmez (özet açık sırdan hesaplanır). Lisans klasörü/anahtar halkası yoksa iki adımlı kurulum 503
  `TOTP_KEY_UNAVAILABLE`; başka sunucudan gelen yedekte sır çözülemezse 503 `TOTP_SECRET_UNREADABLE` (giriş
  kapalı kalır, 2FA sessizce düşmez — anahtar halkası emanetten geri konunca açılır). Migration
  `20261012220000_totp_sirri_sarili_saklama` (yalnız iki kolonu genişletir).

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
- **Kırıldı mı:** HAYIR (ham kod eşlemesi kısmı) — yalnız ekleme: beş yeni uç, yeni hata kodları
  `STOP_CODE_MAP_DUPLICATE` (409), `STOP_REASON_INVALID` (400); var olan uçlar değişmedi. Eski istemci yeni uçları
  çağırmaz.
- **Kırıldı mı:** HAYIR (makine kartı kısmı) — yalnız ekleme: altı yönetim ucu, iki kart ucu, duruş DTO'sunda
  `signalStopKey`, yeni hata kodları `MACHINE_ALREADY_LINKED`, `COLLECTOR_NAME_TAKEN`, `COLLECTOR_REVOKED`,
  `COLLECTOR_*` (401/429), `MACHINE_NOT_IN_SCOPE` (403). Var olan uçların davranışı değişmedi; eski istemci yeni
  uçları çağırmaz.
- **Kırıldı mı:** HAYIR (yetki kısmı) — yeni uçlar `/api/admin/credential-reset-requests`, yeni hata kodları
  `GRANT_EXCEEDS_ACTOR`, `CREDENTIAL_RESET_NEEDS_APPROVAL`, `STATION_KIND_IN_USE`; ayar cevabına iki alan. Davranış
  daralması: `shipping:write`-yalnız aktör fatura işaretinde 403; eski panel onay talebi akışını bilmez, 403'ü
  genel hata olarak gösterir (eşleşen panel 1.6.5).
- **Kırıldı mı:** HAYIR (girdi/ağ denetimi kısmı) — davranış daralması: giriş/lisans uçlarında dakikada 60 üstü
  429 `RATE_LIMITED` (eski panel/tablet bunu genel hata olarak gösterir; normal kullanımda oluşmaz); tanımsız CHECK
  409'unun mesajı değişti, `details.code` `INTEGRITY_RULE` + `details.ref` eklendi (eski istemci yalnız mesajı
  gösterir); 256 üstü kullanıcı adı/parola 400; tehlikeli cihaz deseni 400. Uç/izin eklenmedi.
- **Kırıldı mı:** HAYIR (cihaz kanıtı kısmı, fabrika kurulumu) — yalnız ekleme: cihaz cevabına `deviceSecret`,
  ayar cevabına `deviceProofRequired`, yeni başlık `x-device-proof`, yeni hata kodu `DEVICE_PROOF_INVALID`.
  **Barındırılan kurulumda EVET (bilerek):** kanıt üretemeyen eski tablet her istekte 401 alır — tabletler önce OTA
  ile güncellenir; `minVersion` yükseltilmedi. Eski panel yeni ayarı göstermez.
- **Kırıldı mı:** HAYIR (dokuma karnesi kısmı) — ekleme: `GET /api/reports/dokuma/randiman` ve
  `GET /api/machine-shift-stats` `cursor` + `limit` (≤ 5000, varsayılan 500) kabul eder, `meta.nextCursor`
  döner; bozuk imleç 400 `INVALID_CURSOR`. **Anlam değişimi:** toplam/Pareto/kırılım ve `meta.total` tam kümeden;
  `meta.truncated` artık "sonraki sayfa var" demektir. Eski panel ilk 500 satırı + "kırpıldı" şeridini görür,
  üstteki toplamlar yine tam kümedir.
- **Kırıldı mı:** HAYIR (yazarak etkinleştirme kısmı) — yalnız ekleme: `GET /api/license/gecici-kod/istek`,
  `POST /api/license/gecici-kod/istek/yenile`, `POST /api/license/gecici-kod` (400 `TEMP_CODE_INVALID` +
  `details.neden`/`konum`), durum cevabında `gecici`. Eski panel kartı göstermez, yeni alanı okumaz; geçici açık
  kurulumda eski panel kilit sınıfını "YOK" görür ve normal çalışır.
- **Kırıldı mı:** HAYIR (toplu etiket kısmı) — uçlar ve yanıt biçimi aynı; etiket HTML'indeki barkod SVG'sinin
  metni değişti (bwip yol çizimi yerine dikdörtgenler), viewBox ve görüntü aynı.
- **Eski istemci ne yapar:** eski panel yeni alanları okumaz, uyarı şeridini göstermez; kapı sunucuda olduğu için
  güvenlik etkisi aynıdır. Tablet etkilenmez.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** EVET — 11 adet: `20261011200000_alarm_sorumlu`, `20261011210000_sistem_hesabi_muhru` (yalnız EKLEME:
  `users` tablosuna boş geçilebilir bir alan + bir kontrol kuralı; var olan satırlar boş kalır, veri dönüşümü YOK),
  `20261012010000_durus_acan_kapatan`, `20261012120000_kimlik_sifirlama_onayi` (yalnız EKLEME: yeni tablo),
  `20261012140000_makine_durus_kod_esleme` (yalnız EKLEME: boş yeni tablo + toplayıcıya boş geçilebilir alan),
  `20261012180000_makine_kart_kimligi` (yalnız EKLEME: toplayıcıya iki boş geçilebilir alan),
  `20261012190000_makine_kart_sahiplenme` (yalnız EKLEME: duruşa boş geçilebilir alan + kısmi tekil indeks),
  `20261012150000_cihaz_kaniti` (yalnız EKLEME: `devices`e üç boş geçilebilir alan),
  `20261012200000_perf_indeksler` (yalnız indeks, veri dönüşümü yok; 300k satırlık duruş tablosunda ~0,16 sn),
  `20261012210000_autovacuum_tablo_ayarlari` (yalnız tablo ayarı, veri yazmaz, tabloyu yeniden yazmaz),
  `20261012220000_totp_sirri_sarili_saklama` (yalnız iki kolonun genişliği; veri dönüşümü migration'da YOK, düz
  sırları açılış işi şifreler).
- **Toplam migration:** 387 (2.15.5'te 376). 2.15.5'ten gelen kurulum tam 11 migration uygulamalıdır. Farklı sayı =
  yanlış paket ya da yanlış veritabanı → DUR. (Paketleme anında yeniden sayılır.)
- **Prova:** YAPILMADI — taslak; paketlemeden önce en eski canlı dump'ta restore → `migrate deploy` → bekçiler →
  profil açılışı.
- **Veri yazan adımlar:** güncelleme sırasında YOK. Mühür elle koşulan `--muhurle` komutuyla ya da yeni hesabın
  doğuşunda atılır; açılış işi yalnız ZATEN GEÇERLİ mührü TOTP'yi kapsayan biçime bir kez yeniler (mühürsüz ya da
  bozuk mühürlü hesaba dokunmaz) ve lisans dizinine `sistem-hesabi-muhru-v2.json` koyar.
- **Geri alınabilir mi:** migration geri alınmaz. İmaj 2.15.5'e dönebilir: eski sürüm mühür alanını okumaz, destek
  hesabı bugünkü gibi çalışır (mühür koruması o sürede yoktur). Tam dönüş = güncelleme öncesi yedekten geri yükleme.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek + 10 migration); süre kurulumda ölçülür.
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
  Hız sınırı ve `TRUST_PROXY` reddi: güncellemeden ÖNCE barındırılan kurulumun `.env`inde `TRUST_PROXY` değeri
  ölçülür — `true` ise `1` yapılır, yoksa sunucu açılmaz. Cihaz kanıtı: barındırılan kurulumda tabletler sunucudan
  ÖNCE OTA ile güncellenir (eski tablet orada 401 alır); fabrikada ayar kapalı gelir, açmadan önce bütün
  tabletlerin güncellendiği panelin Cihazlar sayfasından ölçülür. Windows kod imzası adımı hazır ama sertifika
  henüz yok: paket bu sürümde de imzasız çıkar (Windows SmartScreen uyarısı sürer).
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür; geri dönülen
sürüm kendiliğinden yeniden denenmez. Migration geri alınmaz; 2.15.5 imajı yeni alanlarla açılır (onları okumaz).
Veriyi güncelleme öncesine döndürmek gerekirse otomatik yedekten geri yüklenir.
**Dikkat (TOTP):** yeni sürüm ilk açılışta iki adımlı doğrulama sırlarını şifreler; 2.15.5 şifreli sırrı okuyamaz.
Açılıştan SONRA yalnız imajı 2.15.5'e döndürmek, iki adımlı doğrulaması açık hesapların (destek hesabı dahil)
girişini bozar — bu sürümden geri dönüş güncelleme öncesi yedekten geri yüklemeyle yapılır. Doğrulama kipinde
düşen güncelleme zaten yedekten geri yüklenir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.6, sunucu ve veritabanı ayakta.
- Güncelleme programı hizmeti çalışıyor; `durum` kurulu sürüm 2.15.6, güncelleme programı 0.2.6, kira geçerli
  (DONDURULDU / KIRA_YOK yok).
- Yedek: güncelleme öncesi yedek alındı; günlükte `SEMA_OLCULEMEDI` yok.
- Veritabanı: 386 migration bitmiş, sorunlu migration yok; `users` tablosunda `systemAccountSeal` var, var olan
  kurulumda hepsi boş.
- `/api/admin/health` `sistemHesabiMuhru`: var olan (mühürlenmemiş) kurulumda `MUHURLENMELI`, mühürlemeden sonra
  `TAMAM`. Destek hesabı girişi mühürlemeden önce de sonra da çalışıyor.
- `/api/admin/health` lisans bölümünde `etkinlestirmeKilidi` etkin kurulumda `YOK` (`KURULUM_HATASI` görünürse
  lisans klasörü yanlış yerde — DUR, insana rapor et).
- Denetim arşivinin en eski kaydı (`SELECT min("createdAt") FROM system_log_archives`): 3 yıldan eskiyse ilk gece
  budanacağı bilinerek rapor edilir.
- Hata günlüğünün son satırları — yeni hata var mı.
