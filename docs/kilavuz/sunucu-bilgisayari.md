# Sunucu Bilgisayarı

Sunucu bilgisayarı fabrikadaki program verisini tutan Windows bilgisayarıdır. Panel ve tabletler ona ağdan bağlanır; bu yüzden **kapanırsa kimse çalışamaz**. Bilgisayarı başka işe kullanmayın, uyku ve hazırda bekletme kapalı olsun.

## 1. Çalıştığını nasıl anlarım

- Bu sürümde sağ alttaki bildirim alanında (saatin yanında) TeksERP'ye ait bir simge ya da renk göstergesi **yoktur**. Çalışma durumu aşağıdaki yollarla izlenir.
- Panelden: Sol menü → **Yönetim → Sistem** → **Sunucu Durumu**. Sayfa açılıyor ve "Çalışma süresi", "Son yedek" doluysa sunucu çalışıyordur. Üstte "Dikkat gerekiyor" bandı varsa satırlara bakın (disk, yedek, bağlantı).
- Bilgisayarda: Windows Başlat → **Hizmetler** (services.msc) → şu hizmetler "Çalışıyor" olmalıdır:
  - **TeksERP-Backend** — programın kendisi
  - **TeksERP-Guncelleyici** — sunucu güncelleyicisi
  - PostgreSQL (veritabanı) hizmeti
  Bir müşteri kurulumunda hizmet adının sonuna kurulum adı eklenmiş olabilir (ör. TeksERP-Backend-ad); önek aynıdır.

## 2. Kapatıp açma

Hizmetler Windows açılışında kendiliğinden başlar (gecikmeli otomatik); programı elle başlatmanız gerekmez.
1. Mesai dışında bir an seçin; panelde **Sunucu Durumu**ndan "Online kullanıcı" ve "Bağlı cihaz"a bakıp kimse çalışmıyorken kapatın. Sistem → **Sunucu Durumu** → **Şimdi yedek al** ile önce yedek alın.
2. Windows'u normal yolla kapatın (Başlat → Kapat). Güç düğmesine basarak ya da fişi çekerek kapatmayın; veritabanı bozulabilir.
3. Açınca hizmetlerin başlaması birkaç dakika sürer. Panelde giriş ekranı gelene kadar bekleyin; tabletler kendiliğinden yeniden bağlanır.
4. Hizmet çalışmıyorsa Hizmetler penceresinde **TeksERP-Backend**'e sağ tık → **Başlat**. Yine başlamıyorsa [sorun-giderme.md](sorun-giderme.md) bölüm 1 ve satıcıya başvurun.

## 3. Saat eşitlemesi

Sunucunun saati doğru olmalıdır: kayıtların zamanı ve lisans süresi buna bağlıdır.
- Windows → Ayarlar → **Saat ve dil → Tarih ve saat** → "Saati otomatik ayarla" **Açık** olsun ve **Şimdi eşitle**'ye basılabilir.
- Saati elle değiştirmeyin. Program saati değiştirmez; fark büyürse lisans uyarısı çıkabilir ([sorun-giderme.md](sorun-giderme.md) bölüm 3).
- Sunucu bir etki alanındaysa saat etki alanından gelir; ayrıca bir şey yapmayın.

## 4. Yedek nerede

- Gece yedeği Windows Görev Zamanlayıcı'daki **TeksERP-DB-Backup** görevi ya da programın kendi zamanlayıcısıyla, varsayılan olarak **03:00**'te alınır; sunucu o saatte kapalıysa açılınca telafi edilir. Saat panelden Sistem → **Yedekler** → "Otomatik yedek saati" kartında görülür/değişir (görev dışarıda kurulmuşsa saat görevden ayarlanır).
- Dosyalar sunucuda kurulum klasörünün altındaki **backups** klasöründedir (varsayılan kurulumda `C:\TeksERP\backups`; kurulumda başka bir klasör seçildiyse onun altı). Dosyalar şifrelidir; şifreleme anahtarı yedek klasörünün dışında ayrı bir yerde tutulur ve kurulumda teslim edilen yedek parolası/anahtar tutanağıyla birlikte saklanmalıdır.
- Yedekler aynı disktedir; disk bozulursa ikisi birlikte gider. Mutlaka ikinci bir yere kopyalayın: Sistem → **Yedekler** → "Offsite Yedek" kartı ("Yerel ikinci hedef" ağ paylaşımı/ikinci disk ya da bulut).
- Yedek listesi ve indirme: Sistem → **Yedekler**. Geri yükleme için satıcıya başvurun.
