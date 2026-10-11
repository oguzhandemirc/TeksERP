# Backend `2.15.5`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu (bizim yönettiğimiz Linux deneme
sunucusu); öncü/genel gruba ve Windows fabrika filosuna çıkış ayrı karar.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.15.4 yayında (`test` grubu). Güncellenecek her kurulumda sahadaki sürüm kurulumdan önce
sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`). Güncelleme programı 0.2.5 (değişmedi), sunucu
hizmet konağı 0.2.0 (değişmedi).

## 1. Özet

Üç iş: **gece başlayıp sabaha süren tezgah duruşunda alarm**, **ayar yerini gösteren mesajların düzeltilmesi** ve
**ilk kurulumda hazır gelen destek hesabı**.

- **Vardiya dışında durup vardiyaya taşan tezgah artık alarm verir.** Örnek: tezgah gece (vardiya yokken) durdu ve
  sabah vardiyası başladığında hâlâ duruyor. Önceki sürümde bu duruş hiç alarm vermiyordu. Artık hedef süre sabah
  vardiyasının başladığı andan sayılır; süre dolunca alarm görevliye, daha da uzarsa üst kademeye çalar. Vardiya
  içinde başlayan duruş eskisi gibi duruşun başından sayılır. Hiç vardiyaya değmeyen duruş (ör. hafta sonu çalışma
  yokken) yine alarm vermez. Vardiya bitince çalan alarm kendiliğinden kapanmaz; duruş kapanınca kapanır.
  Tezgah alarmı kapalı kurulumda hiçbir şey değişmez.
- **Ayar yerini söyleyen mesajlar doğru yeri gösterir.** Sunucunun "bu ayar kapalı, şuradan açılır" diyen
  mesajları artık var olmayan "Genel Ayarlar" menüsünü değil, paneldeki gerçek yeri söyler. Örnekler:
  - Tezgah alarmı kapalı: **Sistem → Özellik Anahtarları → Tezgah izleme → "Tezgah alarmı"**
  - Kapalı modül: **Sistem → Modüller**
  - Sevkiyat, mal kabul, iplik, muhasebe ayarları: **Sistem → Özellik Anahtarları →** ilgili sekme
  - Kartla ve PIN ile giriş: **Sistem → Şirket & Güvenlik → Oturum & Güvenlik**
- **İlk kurulumda hazır destek hesabı.** Hiç destek (sistem) hesabı olmayan yeni kurulumda sunucu ilk açılışta
  ortak kullanıcı adı ve ortak parolayla bir destek hesabı açar; bu hesapla ilk girişte parola değiştirilmeden
  hiçbir işlem yapılamaz. Parola değişene kadar panelde kırmızı uyarı şeridi görünür (yeni panel gerekir). Destek
  hesabı zaten olan kurulumda (bugünkü bütün kurulumlar) hiçbir şey değişmez.
- **Veritabanında değişiklik var** (kullanıcı tablosuna iki yeni alan) → güncelleme programı güncellemeden ÖNCE
  otomatik yedek alır; yedek alınamazsa güncelleme yapılmaz.

## 2. Ne değişti

Önceki etiket `backend-v2.15.4`e göre. Ölçüm: `git log backend-v2.15.4.. -- Teks-Erp/src Teks-Erp/prisma` — üç iş,
bir yeni migration; güncelleme programı ve native kod farksız.

**Vardiyaya taşan duruşta alarm**

- "fix(dokuma-alarm): vardiyaya taşan duruş alarm doğurur" — duruşun hedef süresinin başladığı an tek yerden hesaplanır: vardiyada açılan duruş açılıştan;
  vardiya dışında açılıp vardiyaya taşan duruş taştığı ilk vardiyanın başından, alarm yalnız vardiya sürerken
  doğar; iptal edilmiş vardiya sayılmaz. Alarm motoru ve Tezgah Salonu aynı hesabı kullanır; Salon cevabına yeni
  alan `clockStartedAt` (hedef sayacının başladığı an) eklendi. Hedef süresi vardiyadan uzun duruşta saat her
  vardiya sınırında sıfırlanmaz (ilk vardiyanın başı sabit kalır).

**Ayar yolu mesajları**

- "fix(mesaj): ayar yolu tek kaynaktan" — sunucunun kullanıcıya dönen 24 mesajı (modül kapalı, muhasebe/demo kapıları, tezgah alarmı
  kapalı, kartla/PIN ile giriş, sevkiyat, iplik, tahsilat/ödeme, fatura, mal kabul, ileri tarihli belge, levent,
  fason, stok) paneldeki gerçek menü yolunu ve ayar başlığını tek tablodan alır; tablo panelin ayar ekranlarıyla
  birebir tutulur. Dört mesajda ayar başlığı da paneldekinden farklıydı, düzeldi.

**Hazır destek hesabı**

- `b3e9f6f15` — destek hesabı olmayan kurulumda açılışta ortak kullanıcı adı + ortak parolayla destek hesabı
  açılır (malzeme derlemede gizli bilgiden gömülür; yoksa paket hesapsız çıkar ve açılış günlüğü bunu tek satırla
  söyler). İlk girişte parola değişimi zorunlu. Destek hesabı artık kendi parolasını kendisi değiştirebilir;
  yeni parola ortak parola olamaz (`PASSWORD_IS_DEFAULT`). Windows kurulum sihirbazı, parolası henüz değişmemiş
  hazır hesabı kurulumcunun girdiği ad/parolayla devralır. Migration `20261011130000_varsayilan_superadmin`.

**Pakete girmeyen:** panel (Tezgah Salonu kartındaki hedef sayacının vardiya başından işlemesi, destek hesabı
uyarı şeridi) ayrı sürümle çıkar. Bekçiler ve belgeler.

**Değişmeyen:** var olan uçların sözleşmesi, güncelleme programı, alarm ayarları. `dist-web` bu imajda yok
(Docker).

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız ekleme: Tezgah Salonu açık duruşuna `clockStartedAt`, `/api/auth/me` cevabına
  `defaultSuperadminPasswordPending`, yeni hata kodu `PASSWORD_IS_DEFAULT`. Mesaj METİNLERİ değişti (hata kodları
  aynı).
- **Eski istemci ne yapar:** eski panel (1.6.4) yeni alanları okumaz. Taşan duruşta sunucu alarmı doğru çalar ve
  Salon'daki kademe/özet sayıları doğrudur; yalnız kartın hedef sayacı duruşun başından işler (yeni panelle
  düzelir). Eski panel destek hesabı uyarı şeridini göstermez; parola değişimi zorunluluğu sunucuda olduğu için
  güvenlik kapısı yine çalışır. Tablet bu değişikliklerden etkilenmez.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** EVET — 1 adet: `20261011130000_varsayilan_superadmin` (yalnız EKLEME: `users` tablosuna boş
  geçilebilir iki tarih alanı + iki kontrol kuralı; var olan satırlar boş kalır, veri dönüşümü YOK).
- **Toplam migration:** 376 (2.15.4'te 375). 2.15.4'ten gelen kurulum tam 1 migration uygulamalıdır. Farklı sayı =
  yanlış paket ya da yanlış veritabanı → DUR.
- **Veri yazan adımlar:** güncelleme sırasında YOK. Destek hesabı yalnız hiç destek hesabı olmayan kurulumda,
  açılışta bir kez doğar.
- **Geri alınabilir mi:** migration geri alınmaz. İmaj 2.15.4'e dönebilir: yeni alanlar eski sürümce okunmaz, iş
  akışı etkilenmez. Tam dönüş = güncelleme öncesi yedekten geri yükleme.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır (yedek + 1 migration); süre kurulumda ölçülür.
- **Sıra:** sunucu önce; Tezgah Salonu sayacını ve uyarı şeridini gösteren panel sonra.
- **Bu sürüme özel:**
  - Migration var → güncelleme programı güncellemeden önce otomatik yedek alır (ONAYLI kipte panel onayından sonra).
    Yedek adımı geçmeli.
  - Tezgah alarmı açık kurulumda: güncellemeden sonra vardiya dışında başlamış ve hâlâ süren duruş, vardiya
    sürüyorsa ve hedef süre vardiya başından itibaren dolmuşsa hemen alarm verebilir — beklenen davranıştır.
  - Alarmı açmak/kapatmak için yer: **Sistem → Özellik Anahtarları → Tezgah izleme → "Tezgah alarmı"**.
  - Yeni kurulumda hazır destek hesabının ortak parolası belgeye, günlüğe ve sohbete YAZILMAZ; ilk girişte
    hemen değiştirilir.
- **Bilinen sınırlar (dürüst):** 2.15.0–2.15.4 belgelerindeki güncelleme programı sınırları aynen geçerli. Ortak
  parola her kurulumda aynıdır; parola değişene kadar parolayı bilen biri o kurulumda tam yetkili girer (kabul
  edilmiş risk, ilk girişte değişim zorunlu). Menü yolları yalnız ayar ekranları için denetlenir; "Tanımlar" gibi
  öteki menülerin adları mesajlarda denetim dışıdır.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür; geri dönülen
sürüm kendiliğinden yeniden denenmez. Migration geri alınmaz; 2.15.4 imajı yeni alanlarla açılır (onları okumaz).
Veriyi güncelleme öncesine döndürmek gerekirse otomatik yedekten geri yüklenir.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.5, sunucu ve veritabanı ayakta.
- Güncelleme programı hizmeti çalışıyor; `durum` kurulu sürüm 2.15.5, güncelleme programı 0.2.5, kira geçerli
  (DONDURULDU / KIRA_YOK yok).
- Yedek: güncelleme öncesi yedek alındı; günlükte `SEMA_OLCULEMEDI` yok.
- Veritabanı: 376 migration bitmiş, sorunlu migration yok; `users` tablosunda `defaultPasswordIssuedAt` ve
  `defaultPasswordChangedAt` var, var olan kurulumda hepsi boş.
- Tezgah alarmı kapalı kurulumda `GET /api/loom-alarms` 403 `LOOM_ALARM_DISABLED` döner ve mesajı
  "Sistem → Özellik Anahtarları → Tezgah izleme → "Tezgah alarmı"" yolunu söyler.
- Destek hesabı olan kurulumda yeni hesap doğmadı (destek hesabı sayısı değişmedi); paket hazır hesap malzemesi
  taşımıyorsa açılış günlüğünde bunu söyleyen tek satır uyarı vardır. İmajın bütünlük öz-denetimi geçerli.
- Hata günlüğünün son satırları — yeni hata var mı.
