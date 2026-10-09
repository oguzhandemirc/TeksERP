# Backend `2.15.0`

**Durum:** TASLAK — terfide kullanıcı onayı. **YAYIN KAPISI AÇIK DEĞİL:** bu sürüm yenilenmiş güncelleme programını
(sağlamlık planı W1–W5, güncelleme programı 0.2.0) taşır; `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §9.5 kanıtları (CI koşuları, thinkpad ve VDS
gerçek provaları, onarım provası) tamamlanmadan hiçbir gruba yayınlanmaz.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.14.0 (son paketlenen sürüm). Güncellenecek her kurulumda sahadaki sürüm kurulumdan önce
sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası kullanıcı kararıdır (2026-10-09): 2.15.0 — yeni güncelleme programı TEK büyük sürümle, `main`den
çıkar; panel 1.6.0 (sürüm notu `surum-notlari.json` 2026-10-08c) ve fabrika ağında şifreli bağlantı onunla birlikte.
Tablet bu belgenin kapsamı dışındadır. Önce planlanan "küçük, migration'sız ilk sürüm" (2.14.1) bırakıldı: o plan,
sahadaki eski güncelleme programının (0.1.3) ilk geçişi kendi kurallarıyla yürüteceği kurulumları korumak içindi;
0.1.3'lü tek kayıtlı kurulum demofabrikaydı ve sunucusu 2026-10-06'da kaldırıldı (satıcı kayıtlarından salt-okuma
ölçümü, 2026-10-09). Güncelleme programının sürümü 0.1.3 → 0.2.0, sunucu hizmet konağınınki 0.1.0 → 0.2.0.

## 1. Özet

Bu sürümün ağırlığı güncelleme programındadır: program bir güncellemeden önce kendini yeniler, bozulursa kendini ve
sunucu hizmetini karşılıklı onarır, güncelleme sürerken bilgisayar yeniden açılırsa sunucuyu yarım hâlde başlatmaz,
disk dolunca güvenle geri döner ve panelde ne yapılacağını söyler. Destek için tek dosyalık tanı paketi eklendi;
yeni sürüm sorgusu seyrekleşti. Bunların yanında fabrika ağında şifreli bağlantı (yeni kurulumda zorunlu), müşteri
onaylı hata raporları, fabrikanın kendi yöneticisini açma, geçici parolalı şifre sıfırlama ve lisans tarafında
firma adının lisanstan gelmesi bu sürüme girer.

## 2. Ne değişti

Önceki sürüm 2.14.0'a göre; yalnız sunucu ve kurulum tarafı. Ölçüm: `git log backend-v2.14.0..` (sunucu, veritabanı,
yerel ikililer ve kurulum yolları).

**Güncelleme programı (Windows hizmeti) — sürüm 0.2.0 (önceki 0.1.3)**

- Önce kendini yeniler: indirilen pakette daha yeni bir güncelleme programı varsa, sunucuyu güncellemeden önce kendini
  yeniler ve güncellemeyi yeni sürümü yürütür. Önceden yeni program ancak bir güncelleme başarıyla bittikten sonra
  devreye giriyordu; güncelleme yolundaki bir hatanın düzeltmesi o hata yüzünden kurulamıyordu.
- Son sağlam kopyayı saklar: kendini yeniledikten sonra sorun çıkarsa son sağlam çalışan kopyasına döner ve o
  sürümü bir daha denemez. Başka bir bilgisayar türüne ait programı kabul etmez.
- Güncellemeler satıcı tarafından durdurulmuş olsa da güncelleme programının kendisi yenilenebilir (yalnız imzalı
  sürüm bildirimi bunu açıkça içeriyorsa).
- Karşılıklı onarım: güncelleme programının dosyası silinir, bozulur ya da yarım kalırsa (antivirüs, elektrik
  kesintisi) doğrulanmış bir kopyadan kendiliğinden geri konur. Windows'ta bunu sistem hesabıyla çalışan bir
  zamanlanmış görev yapar (açılıştan 2 dakika sonra ve 15 dakikada bir). Program dosyası sağlam ama hizmet durmuşsa
  hizmet yeniden başlatılır. Sonsuz döngüye girmemek için 24 saatte en çok 3 onarım yapılır; daha fazlası ya da
  doğrulanmış kopya yoksa panelde "müdahale gerekiyor" görünür ve güncelleme onayı sunulmaz. Karşı yönde güncelleme
  programı sunucu hizmetini ve kurtarma ayarını onarır (önceden de vardı); sunucu ise güncelleme programını gözler,
  durduğunda panelde ve satıcının filo görünümünde görünür kılar (dosyalarına yazmaz).
- Bakım koruması: güncelleme sürerken bilgisayar yeniden açılırsa sunucu hizmeti kendiliğinden başlamaz; sunucuyu
  yalnız güncelleme programı, işi bitirince ya da geri aldıktan sonra başlatır. Yöneticinin hizmet için elle seçtiği
  başlatma türüne dokunulmaz. Koruma takılı kalırsa yönetici için tek komutluk geri alma vardır.
- Disk dolu: güncelleme programı diskte kendine küçük bir yedek alan (64 MB) ayırır. Güncellemeden önce yeterli yer
  ölçülür (paket boyunun üç katı + veritabanı boyunun 1,2 katı + 2 GB); yer yoksa güncelleme başlamaz, bekler ve yer
  açılınca kendiliğinden sürer. Güncelleme sırasında disk dolarsa işlem yedek alanla güvenle geri alınır; geri dönülen
  sürüm kendiliğinden yeniden denenmez, panelde yer açıp güncellemeyi yeniden onaylamanız istenir.
- Tanı paketi: destek gerektiğinde sunucuda yönetici tek komutla güncelleme programının durumunu, son işlemlerini,
  günlüklerini, hizmet ayarlarını ve disk bilgisini tek bir zip dosyasında toplar. Parolalar ve gizli değerler pakete
  girmez; dosya hiçbir yere kendiliğinden gönderilmez.
- Yeni sürüm sorgusu seyrekleşti: güncelleme programı güncelleme sunucusuna artık 5 dakikada bir değil; lisans
  yenilendiğinde (saatlik), panelden onay verildiğinde ve en geç 6 saatte bir sorar. Kurulumlar aynı dakikaya
  yığılmaz. Kurulumdan hemen önce sürüm bilgisi yine tazelenir.
- Paket imzası yeni anahtar zincirine geçti (satıcının kök anahtarının altındaki paket anahtarı); iptal edilen paket
  anahtarları ve dağıtım iptalleri tanınır. Veritabanı sunucusu yamalarının künyesi de aynı zincirle seçilir.

**Fabrika ağında şifreli bağlantı**

- Sunucu fabrika ağında şifreli bağlantı (HTTPS, 4443) açabilir; sertifika kurulumda üretilir (30 yıl), bağlantı
  kodla doğrulanır. Yeni kurulumda zorunludur: ağa yalnız şifreli kapı açılır, şifresiz kapı yalnız sunucunun kendi
  içinden erişilir. Kurulum sonunda doğrulama kodu ve durum sayfası gösterilir.
- Var olan kurulumda güncelleme bu ayara DOKUNMAZ: ayar neyse o kalır (ayarsız kurulumda kapalı = bugünkü davranış).

**Hata raporları**

- Müşteri onayıyla, kişisel veri olmadan (hata türü, sürüm, yer) sunucu, panel ve tablet hataları satıcıya gider.
  Varsayılan KAPALI; onay verilmedikçe hiçbir şey toplanmaz ve gönderilmez. Onay geri alınınca gönderilmemiş kayıtlar
  silinir.

**Kullanıcılar ve yetki**

- Fabrikanın kendi yöneticisi: destek hesabıyla girildiğinde fabrikanın yöneticisi yoksa panel bunu hatırlatır;
  sunucu geçici parola üretir, yönetici ilk girişte kendi parolasını belirler.
- Panelde "Şifre Sıfırla" artık geçici parola verir; kullanıcı ilk girişte kendi parolasını belirler ve açık
  oturumları kapanır.

**Lisans**

- Ağda ve giriş ekranında görünen firma adı lisanstan gelir; belge unvanı ilk lisans kabulünde boşsa lisanstaki adla
  doldurulur, fabrikanın girdiği unvana dokunulmaz.
- Güncelleme grubu (test · öncü · genel) lisanstan gelir; panel ve tablet güncellemesini buna göre alır.
- Sunucu saati imzalı lisans saatinden 5 dakikadan fazla saparsa bilgi bandı çıkar; kurulum, alan dışındaki
  bilgisayarda Windows saat eşitlemesini açar.
- Bakım süresi bitmeden 30 gün önce hatırlatma bandı; bakım ihlali bandı "satıcınızla görüşün" der. Panelde birden
  çok lisans mesajı tek bantta sırayla döner.
- Satıcı, fabrikada hangi modüllerin açık olduğunu görür (yalnız modül adları; iş verisi gitmez).

**Kurulum ve ağ**

- Sunucu bilgisayarında bildirim alanında durum simgesi (yeşil · sarı · kırmızı).
- Kurulumda Tailscale seçeneği kalktı; onarımda eski ayar korunur.
- Varsayılan güncelleme adresi yeni indirme adresidir; onarımda eski adres yenisine çevrilir, elle girilmiş başka
  adres korunur.
- Sunucu ağda yalnız gerçekten kullanılabilir adreslerini duyurur (sanal kart ve kendiliğinden atanmış adresler
  elenir).

**Bulut (Linux/Docker) hazırlığı**

- Bizim yönettiğimiz bulut sunucuları için Linux güncelleme altyapısı (imaj yükleme, sistem hizmeti, onarım) koda
  girdi. Windows fabrika sunucusunda kullanılmaz; ilk Linux kurulumu ayrı bir adımdır.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — panel 1.5.0 ve ortak tabletin kullandığı sunucu uçları aynı yol ve biçimle duruyor;
  değişiklikler ekleme (yeni uçlar: fabrika yöneticisi, hata raporları; yanıtlara yeni alanlar). 2026-10-09 kod
  karşılaştırmasıyla ölçüldü; uygulama çalıştırılarak denenmedi.
- **Eski istemci ne yapar:**
  - Panel 1.5.0, güncelleme programının yeni onarım ve bilgi kodlarını Türkçe karşılığı olmadan, kodun kendisiyle
    gösterir; onarım arızasında onay düğmelerini zaten sunucu kapatır.
  - Şifreli bağlantısı zorunlu kurulumda (yalnız yeni kurulum) panel 1.5.0 başka bilgisayardan ancak "Şifreli
    bağlantıya geç" ile kod karşılaştırılarak bağlanır; panel 1.6.0 başka bilgisayardan YALNIZ şifreli bağlanır.
  - Yeni izin yok.
- **`minVersion` dokunuldu mu:** HAYIR — istemci sürüm politikası 2.14.0'dan beri değişmedi (ölçüldü).

## 4. Migration

- **Var mı:** EVET — 1 adet, yalnız ekler: hata raporu kuyruğu tablosu (`20261006120000_hata_raporu_kuyrugu`; var olan
  veri değişmez).
- **Toplam migration:** 373 (2.14.0'da 372). Sıfırdan kurulumda 373'ün hepsi uygulanır; 2.14.0'dan gelen 1 uygulanan
  migration görmelidir. Farklı sayı = yanlış paket ya da yanlış veritabanı → DUR.
- **Veri yazan adımlar:** yok.
- **Geri alınabilir mi:** HAYIR — veritabanı değişikliği geri alınmaz; dönüş, güncelleme öncesi alınan yedekten geri
  yüklemedir.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır; süre bu kurulumda ölçülür ve raporlanır.
  Sıfırdan kurulumda yok.
- **Sıra:** sunucu önce, panel 1.6.0 sonra.
- **Bu sürüme özel:**
  - YAYIN KAPISI (§9.5): yenilenmiş güncelleme programını taşıyan ilk sürümdür. Kanıt dosyası (`kanit/guncelleyici-0.2.0.json`: CI
    koşuları, thinkpad ve VDS gerçek provaları, onarım provası) olmadan hiçbir gruba çıkmaz.
  - Yeni korumalar (önce kendini yenileme, onarım, bakım koruması, disk dolu) 2.15.0'a GEÇİŞ sırasında değil, geçiş
    başarıyla bittikten sonra devreye girer: sahadaki eski güncelleme programı yeni programı ancak bu güncellemeyi
    başarıyla bitirince alır. Geçiş eski programın kurallarıyla yürür
    ve bu sürüm migration taşır; 2026-10-09 ölçümünde sahada böyle bir kurulum yok, yine de bulunursa geçiş elle
    izlenir.
  - Panel 1.6.0 başka bilgisayardan yalnız şifreli bağlanır. Şifreli bağlantısı kapalı (ayarsız) eski kurulumda
    panelleri 1.6.0'a geçirmeden önce sunucuda şifreli bağlantı (en az "HTTP + HTTPS" kipi) açılmalıdır; yoksa
    sunucu bilgisayarı dışındaki paneller bağlanamaz ve güncellemeyi de alamaz. Bu bir karar adımıdır, güncelleme
    kendiliğinden yapmaz.
  - Disk ön kontrolü öncekinden sıkıdır (veritabanı payı eklendi): dar diskli sunucu güncellemeyi "disk dolu" ile
    bekletebilir; yer açılınca kendiliğinden sürer.
- **Bilinen sınırlar (dürüst):**
  - Çok büyük veritabanında disk tamamen dolarsa, geri dönüş için ayrılan 64 MB'lık yedek alan veritabanını yedekten
    geri yüklemeye yetmeyebilir. O durumda güncelleme "müdahale gerekiyor" ile durur: sunucuda yer açılır, destek
    kurtarmayı yürütür. Güncelleme öncesi disk ön kontrolü (veritabanı × 1,2) bu durumu nadir kılar ama tamamen
    önlemez; sahte ortamdaki testler bu durumu ölçemez.
  - Veritabanı sunucusu yamaları (küçük sürüm) sırasında bakım koruması henüz yok; bu işlem sürerken yeniden açılışta
    sunucu hizmeti başlayabilir.
  - Kendini yeniledikten sonra sorun çıkıp eski (2.14.0'daki) programa dönülürse, eski program reddedilen sürümü
    bilmez ve onu bir kez daha deneyebilir. İlk başarılı güncellemeden sonra bu durum kalkar.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · veritabanı ve sunucu süreçleri zorla kapatılmaz · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleyiciyle yapılan güncellemede yeni sürüm açılmazsa önceki sürüme kendiliğinden dönülür; migration yarıda
kalırsa veriler güncelleme öncesi yedekten geri yüklenir; geri dönülen sürüm kendiliğinden yeniden denenmez, yeni bir
onay ister. Tek migration yalnız tablo eklediği için 2.14.0'a dönüş şema işlemi istemez; yeni tablo kalır, eski sürüm
onu okumaz. Bakım koruması takılı kalırsa (hizmet "elle" başlatma türünde kalmışsa) yönetici güncelleme programının
koruma kaldırma komutunu çalıştırır; eski başlatma türü geri yazılır.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.0, sunucu ve veritabanı ayakta.
- Sunucu hizmeti ve güncelleyici hizmeti çalışıyor; sunucu hizmetinin başlatma türü kurulumdaki gibi (bakım koruması
  kalkmış); bilgisayar yeniden başlayınca ikisi de kendiliğinden açılıyor.
- Güncelleme durumu: güncelleyici canlı, kurulu sürüm 2.15.0; güncelleyici sürümü 0.2.0 (paketteki sürüm).
- Windows zamanlanmış görevlerde TeksERP onarım görevi var ve doğrulanmış güncelleme programını gösteriyor.
- Veritabanı: 373 migration bitmiş, sorunlu migration yok.
- Şifreli bağlantı kipi kurulumdan önceki değeriyle aynı (yeni kurulumda zorunlu kip; durum sayfası açılıyor).
- Hata raporu onayı varsayılan kapalı.
- Hata günlüğünün son satırları — yeni hata var mı.
- Panel ve tablet oturumları bağlandı; güncellemeyse ölçülen kesinti.
