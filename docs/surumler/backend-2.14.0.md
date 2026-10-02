# Backend `2.14.0`

**Durum:** TASLAK — terfide kullanıcı onayı
**Paket:** `tekserp-backend-20261002_094313-bf4e9683.zip`
**SHA256:** `B0386895275DA294CEF373CF7201093CCA854B37BD0C4F960BDFEB60B3F63B92`
**Commit:** `bf4e9683`
**Önceki saha sürümü:** yok — sıfırdan kurulum (`demofabrika`, ilk kurulum). Başka bir kuruluma güncelleme olarak
gidecekse sahadaki sürüm kurulumdan önce sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası yönetici kararıdır (2026-10-02): 2.14.0 — küçük hane elle verilir. Panel (1.4.2) ve tablet (1.0.15)
bu turda değişmez.

## 1. Özet

Bu sürümle sunucu yeni kurulum ve güncelleme düzenine geçer: tek bir kurulum sihirbazı, programla birlikte gelen kendi
veritabanı sunucusu, Windows hizmeti olarak çalışma ve imzalı güncellemeleri kuran, sorun çıkarsa eski sürüme
kendiliğinden dönen otomatik güncelleyici. Lisans artık internet kesintisinden etkilenmez: sunucu, ödemesi yapılmış
tarihe kadar internetsiz de tam çalışır; süre sonunda 30 gün ek süre verilir ve verilere erişim her aşamada açık kalır.
Güvenlik tarafında parola kuralı sıkılaştı (en az 10 karakter), hızlı PIN ve personel kartı sunucuda okunamaz biçimde
saklanır, yetkiler her istekte yeniden denetlenir.

## 2. Ne değişti

Önceki sürüm 2.13.0'a göre; yalnız sunucu ve kurulum tarafı.

**Kurulum ve güncelleme**

- Tek kurulum sihirbazı: bilgisayarı önce ölçer (engel varsa kurulum ilerlemez), sonra veritabanı veri klasörünü,
  portları, ağ ve güvenlik duvarı erişimini, destek hesabını, gece yedeğini ve modül profilini sorar. Cevap dosyalı
  sessiz kurulum, onarım, kaldırma ve yeniden kurma desteklenir.
- Kendi PostgreSQL 16 veritabanı sunucusu programla birlikte gelir; ayrıca veritabanı kurmak gerekmez. Veritabanına
  yalnız bu bilgisayardan erişilir.
- Sunucu Windows hizmeti olarak, düşük yetkili ayrı bir hizmet hesabıyla çalışır; bilgisayar açılınca kendiliğinden
  başlar, çökerse yeniden başlatılır.
- Otomatik güncelleyici (ayrı bir Windows hizmeti): yeni sürüm yalnız imzası doğrulanırsa indirilir ve kurulur;
  kurmadan önce şifreli bir yedek alınır. Yeni sürüm açılmazsa yaklaşık yarım dakikada eski sürüme dönülür;
  veritabanı adımı yarıda kalırsa veriler bu yedekten geri yüklenir. Elektrik kesintisi, dolu disk ya da antivirüs
  kilidi gibi durumlarda işlem ya kaldığı yerden sürer ya da güvenle geri alınır. Veritabanı sunucusunun küçük sürüm
  yamaları da aynı yoldan gelir.
- Güncelleme politikası lisansla gelir: belirlenen saat aralığında kendiliğinden, yalnız onayla (hemen ya da gece) ya
  da dondurulmuş. Politika yoksa onaysız hiçbir şey kurulmaz. Sunucu güncelleme durumunu ve onayları kaydeder.
- Kurulum gece yedeği görevini (isteğe bağlı şifreli; müşteri anahtarının özel yarısı sunucuda bırakılmaz) ve güvenlik
  duvarı kuralını da kurar: sunucu portu yalnız yerel ağa (isteğe bağlı Tailscale ağına) açılır, veritabanı dışarıya
  kapalıdır.
- Eski düzende çalışan sunucular için hizmet düzenine geçiş aracı: veritabanına dokunmaz, geri alınabilir.

**Lisans**

- İnternet kesintisi lisans süresini kısaltmaz: sunucu, ödemesi yapılmış tarihe kadar internetsiz de tam çalışır.
- Süre bitmeden 30 gün önce bilgi bandı görünür (sunucu bir haftadır lisans sunucusuna ulaşamadıysa ya da sözleşme
  sonuna gelindiyse).
  Süre dolunca 30 gün ek süre, ardından kısıtlı kip; verilere erişim (okuma, rapor, dışa aktarma, yedek) her aşamada
  açıktır.
- Ödeme gelince süre internet üzerinden kendiliğinden uzar; internetsiz kurulumda uzatma, satıcının verdiği dosya ya
  da QR kodla yapılır (önceden istek oluşturmak gerekmez).
- Bilgisayar tanıma sağlamlaştı: her donanım bilgisi birden çok yoldan okunur; tek bir parçanın değişmesi lisansı
  bozmaz, yeni parça öğrenilir. Donanım değişikliği sunucuya bildirilebilir.
- Lisans kaydı okunamaz ya da silinirse program hemen durmaz: 14 gün uyarı, sonra ek süre; yeni lisans bilgisi gelince
  durum kendiliğinden düzelir.
- Üretim kurulumu yalnız üretim imzalı lisanslara ve paketlere güvenir; deneme anahtarıyla imzalı paketi üretim lisansı
  geçerli saymaz.
- Etkinleştirmeden önce lisans sözleşmesinin panelde kabul edilmesi (2.13.0'dan beri) aynen sürer.

**Güvenlik**

- Yeni ve değiştirilen parolalar en az 10 karakter olmalı (önceden 6); var olan parolalarla giriş sürer.
- Kullanıcının kendi parolasını değiştirmesi için sunucu desteği: değişince o kullanıcının açık bütün oturumları
  kapanır. Sihirbaz dışındaki kurulum yollarında ilk yöneticiye verilen geçici parola ilk girişte değiştirilmek
  zorundadır.
- Yetkiler her istekte veritabanından okunur: kullanıcıdan alınan yetki, yeniden giriş beklemeden en geç yarım dakikada
  geçerli olur.
- Hızlı PIN ve personel kartı sunucuda okunamaz biçimde (özet olarak) saklanır; düz değer yalnız verildiği an
  gösterilir. Var olan PIN ve kartlar sahibinin ilk başarılı girişinde dönüştürülür. Bunu çözen anahtar şifreli yedeğe
  girer; sunucu başka bilgisayara taşınınca yedek parolasıyla geri konur.
- Hızlı PIN ve kartla yanlış denemelerden doğan giriş kilidi sunucu yeniden başlatılınca sıfırlanmaz.
- İsteğe bağlı ayar: hızlı PIN ve personel kartıyla giriş yalnız onaylı cihazlardan. Varsayılan kapalı (bugünkü
  davranış).
- Oturumları imzalayan gizli değer zayıf ya da bilinen bir değerse sunucu çalışmayı sürdürür ama yöneticiyi uyarır;
  yeni kurulumlar böyle bir değeri kabul etmez.
- Belge ve etiket şablonları basılmadan önce zararlı içerikten daha sıkı temizlenir (yalnız izin verilen öğeler kalır).

**Pakette**

- Lisans çekirdeği bu sürümde yenilendi; pakete bu sürümle derlenmiş çekirdek girer, 2.13.0'ınki kullanılmaz.
- Paket, sunucunun hizmet konağını ve güncelleyiciyi de taşır.
- Web paneli pakete girmez — değişiklik yok.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — panel 1.4.2 ve tablet 1.0.15'in kullandığı bütün sunucu uçları bu sürümde aynı yol ve
  biçimle duruyor; değişiklikler yalnız ekleme (2026-10-02 kod karşılaştırmasıyla ölçüldü; uygulama çalıştırılarak
  denenmedi). Giriş, lisans ekranı (sözleşme kabulü, etkinleştirme, durum) ve yetkiler eski panelde çalışır.
  2.13.0'dan devralınan kural aynen geçerli: lisans etkinleştirmesi sözleşme kabulü ister, bunun için panel en az
  1.4.2 olmalı.
- **Eski istemci ne yapar:** eski panel ve tabletin göreceği farklar:
  - Parola: yeni ya da değiştirilen parola 10 karakterden kısaysa sunucu Türkçe gerekçeyle reddeder.
  - "Parolasını değiştirmeli" işaretli hesap yalnız parola değiştirme adımına girebilir, tabletten giriş yapamaz.
    Panel 1.4.2'de bu adımın ekranı yoktur. Sihirbazla kurulan sunucuda böyle işaretli hesap doğmaz.
  - Güncelleme durumu ve onayı için yeni sunucu uçları eklendi; panel 1.4.2'de bu ekran yoktur. Politika "yalnız
    onayla" ise onay bu panel sürümünden verilemez.
  - Lisans durum bilgisine yeni alanlar eklendi (ödenmiş tarih, bağlantı); eski panel bunları yok sayar.
  - Yeni izin yok.
- **`minVersion` dokunuldu mu:** HAYIR — istemci sürüm politikası 2.13.0'dan beri değişmedi (ölçüldü).

## 4. Migration

- **Var mı:** EVET — 3 adet, hepsi yalnız ekler (yeni tablo ve kolon; var olan veri değişmez): güncelleme onay kaydı ·
  hızlı PIN ve kart özetleri, giriş kilidi kaydı ve anahtar emaneti · "parolasını değiştirmeli" işareti (varsayılan
  kapalı).
- **Toplam migration:** 372 (2.13.0'da 369). Sıfırdan kurulumda 372'nin hepsi uygulanır; 2.13.0'dan gelen 3, 2.12.1'den
  gelen 4, 2.11.2'den gelen 9 uygulanan migration görmelidir. Farklı sayı = yanlış paket ya da yanlış veritabanı → DUR.
- **Veri yazan adımlar:** migration'larda yok. Var olan PIN ve kartlar çalışma anında, sahibinin ilk başarılı girişinde
  dönüştürülür (sıfırdan kurulumda böyle kayıt yok).
- **Geri alınabilir mi:** HAYIR — veritabanı değişikliği geri alınmaz; dönüş, güncelleme öncesi alınan yedekten geri
  yüklemedir.

## 5. Kurulum notu

- **Beklenen kesinti:** sıfırdan kurulumda yok (çalışan sunucu yok). Güncellemede sunucu kısa süre kapalı kalır; süre
  bu kurulumda ölçülür ve raporlanır.
- **Sıra:** sunucu önce; panel 1.4.2 ve tablet 1.0.15 bu turda değişmez. Etkinleştirme panel 1.4.2 ister.
- **Bu sürüme özel:**
  - Bu sürüm yeni kurulum sihirbazıyla kurulur: kurulum programı, sunucu paketi ve veritabanı paketi aynı klasörde
    durur. Destek hesabı sihirbazda ya da kurulum sonunda konsoldan oluşturulur.
  - İmzasız paket kurulmaz. Deneme anahtarıyla imzalı paket uyarıyla kurulur ama üretim lisansı onu geçersiz sayar —
    bu kurulumda paket üretim anahtarıyla imzalanır.
  - Etkinleştirmeden önce panelde Sistem → Lisans → "Lisans sözleşmesi" kartında kutular, ad soyad ve unvan
    doldurulup sözleşme kabul edilir.
  - Eski düzende çalışan sunucular eski kurulum yoluyla güncellenmeye devam edebilir; hizmet düzenine geçiş ayrı ve
    geri alınabilir bir adımdır.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · veritabanı ve sunucu süreçleri zorla kapatılmaz · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Sıfırdan kurulumda geri alınacak önceki sürüm yok: migration adımından önceki hata kurulumu durdurur; sonrasında DUR,
insana rapor (veritabanı yeni; baştan kurma kararı insanındır). Güncelleyiciyle yapılan güncellemede yeni sürüm
açılmazsa önceki sürüme kendiliğinden dönülür, migration yarıda kalırsa veriler güncelleme öncesi yedekten geri
yüklenir; geri dönülen sürüm kendiliğinden yeniden denenmez, yeni bir onay ister. Migration'lar yalnız eklediği için
2.13.0'a dönüş şema işlemi istemez; yeni tablolar kalır, eski sürüm onları okumaz.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.14.0, sunucu ve veritabanı ayakta.
- Sunucu hizmeti ve güncelleyici hizmeti çalışıyor; bilgisayar yeniden başlayınca ikisi de kendiliğinden açılıyor;
  sunucu portunda tek dinleyici var.
- Veritabanı: 372 migration bitmiş, sorunlu migration yok.
- Lisans: çekirdek yerel, bütünlük geçerli, motor çalışıyor; sözleşme kabulünden önce etkinleştirme kapalı; kabul ve
  etkinleştirmeden sonra kip zorunlu, kademe normal; lisans durumunda ödenmiş tarih görünüyor.
- Güncelleme durumu: güncelleyici canlı, kurulu sürüm 2.14.0.
- Gece yedeği görevi kurulmuş; şifreli yedek seçildiyse müşteri anahtarının özel yarısı sunucuda değil.
- Güvenlik duvarı: sunucu portu yalnız yerel ağa açık, veritabanı portu dışarıya kapalı.
- Hata günlüğünün son satırları — yeni hata var mı.
- Panel ve tablet oturumları bağlandı; güncellemeyse ölçülen kesinti.
