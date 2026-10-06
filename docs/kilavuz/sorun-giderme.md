# Sorun Giderme

## 1. Sunucu bulunamıyor / "Sunucuya ulaşılamadı"

**Panel (giriş ekranı):** "Sunucuya ulaşılamadı" ekranı çıkar. Olası sebepler ekranda yazılıdır: sunucu bilgisayarı kapalı, bu bilgisayar farklı bir ağda (Wi-Fi/kablo), sunucunun güvenlik duvarı bağlantıyı engelliyor.
1. Önce sunucu bilgisayarının açık olduğunu ve hizmetlerin çalıştığını doğrulayın ([sunucu-bilgisayari.md](sunucu-bilgisayari.md) bölüm 1).
2. **Sunucuyu Ara** düğmesine basın; "Aranıyor…" biter ve sunucu listelenirse satırına tıklayın, "Sunucuya bağlanıldı" görünür.
3. Bulunamazsa **Adresi Elle Gir**: "Sunucu Adresi" penceresinde Protokol (http), "IP / Sunucu adresi" (ör. 192.168.1.50) ve Port (4000) yazın, **Bağlantıyı Test Et** ile "Bağlantı başarılı — sunucu çalışıyor." görün, sonra **Kaydet**. Adres sunucu bilgisayarının IP'sidir (Windows'ta komut satırına `ipconfig` yazın, "IPv4 Adresi"). Daha önce kullanılanlar "Son kullanılanlar" listesindedir. Bu pencereye girişteki **Ayrıntılar** düğmesi de ağ aramasının neden bulamadığını gösterir.
4. Adres bu bilgisayara bağlı ayar da olabilir: Sistem → **Bu Bilgisayar** karosu.

**Tablet:** giriş ekranındaki dişli simgesi ("Sunucu ayarları") → **API Sunucusu**. "IP / Host" ve "Port" alanlarını yazın, **Bağlantıyı Test Et**, sonra **Kaydet**. Yanlış kaydedildiyse **Varsayılan adrese dön**. Tablet ile sunucu aynı Wi-Fi/ağda olmalıdır; sunucunun IP'si sabit olmalıdır (sabit değilse router'dan sunucuya sabit adres verilir).

**Sürekli kopuyorsa:** Wi-Fi kapsama alanı ve sunucunun kablolu bağlı olduğunu kontrol edin. Tablette kayıtlar bağlantı yokken beklemeye alınır ve bağlantı gelince gider; bekleyen kaydı silmeden bağlantıyı düzeltin.

**Şifreli bağlantı (yalnız panel):** şifreli bağlantı açıkken sunucuya bağlanılamıyorsa panel şifresize düşmez. Sunucu açık ve ağ sağlamsa **Şifreli bağlantıyı kaldır** ile şifresize dönüp ([panel-yonetici.md](panel-yonetici.md) bölüm 10) yöneticiye haber verin.

## 2. Giriş sorunları

- Yönetici parolanızı sıfırladıysa ilk girişte "Yeni parola belirleyin" (tablette "Size verilen parola") ekranı çıkar: yöneticinin verdiği parolayı ve kendi yeni parolanızı girip **Parolayı değiştir**'e basın; PIN/kartla girişte de aynısı olur.
- "Parolalar eşleşmiyor.": parola değişiminde iki alan aynı olmalı; yeni parola en az 10 karakterdir.
- PIN veya kart birkaç kez yanlış girilirse hesap kısa süre kilitlenir (Şirket & Güvenlik ayarındaki "İzin verilen yanlış deneme" ve "Ceza süresi"); bekleyin ya da yöneticiden Yetkilendirme → Kullanıcılar → kullanıcı → **Hızlı PIN** sekmesinden yeni PIN isteyin.
- "Doğrulama kodu" kabul edilmiyorsa telefonun saatinin doğru olduğundan emin olun; kod kaybolduysa yöneticiye başvurun.

## 3. Lisans uyarıları

Panelin üstündeki şerit (Sistem → **Lisans** karosunda ayrıntı) lisansın kademesini söyler. Kademeler sırayla: **Normal → Uyarı → Ek süre → Kısıtlı kip → Durduruldu**. Fabrika aniden durmaz; her kademede okuma, rapor, dışa aktarma ve yedek açık kalır.

| Gördüğünüz | Anlamı | Ne yapılır |
|---|---|---|
| Mavi şerit: "Bakım süreniz bitiyor/bitti" | Yeni sürümler için bakım yenilenecek; kurulu sürüm çalışır | Satıcıyla görüşün |
| Mavi şerit: ödeme yaklaşıyor | Lisans bedeli tarihi yaklaşıyor | Satıcıyla görüşün |
| Sarı şerit: "N gün içinde düzelmezse ek süre/kısıtlı kip" | Lisans doğrulanamıyor ya da süre bitiyor; sayaç işliyor | Aşağıdaki adımlar |
| Sarı şerit: "Ek süre: N gün" | Süre bitti, ek süre tanındı | Süre bitmeden yenileyin |
| "Program kısıtlı kipte" penceresi | Kayıt okunur, yeni kayıt ve değişiklik yapılamaz | **Salt okunur devam et** ile rapor/okuma yapın; lisansı düzeltin |
| "Program durduruldu" | Lisans sağlayıcı durdurdu | Satıcıyı arayın |

Düzeltme adımları:
1. Sistem → **Lisans** → **Lisansı şimdi yokla**. Sunucu internete çıkabiliyorsa çoğu uyarı bununla kalkar.
2. "Etkinleştirme"/"Yenileme" kartında kod verildiyse kodu yazıp **Etkinleştir**.
3. Sunucu internete çıkamıyorsa kartta **Bu bilgisayar üzerinden etkinleştir / yenile** (panelin ağından geçer) ya da "İnternet yoksa: portaldan alınan uzatma dosyası" ile dosyayı yükleyin.
4. "Lisans doğrulanamadı; sistem yöneticinize ya da destek hattına başvurun." çıkarsa sunucu saatini ([sunucu-bilgisayari.md](sunucu-bilgisayari.md) bölüm 3) ve internet bağlantısını kontrol edin, sonra destek talebi açın.
5. Mavi şeritte "Sunucu saati lisans sunucusunun imzalı saatinden … ileride/geride" yazıyorsa lisans bozulmamıştır; yalnız saat kaymıştır. Sunucu bilgisayarında Saat ayarını otomatik yapın ([sunucu-bilgisayari.md](sunucu-bilgisayari.md) bölüm 3).
6. Lisans sahibi/no gibi bilgiler Sistem → **Hakkında** karosundadır; satıcıya bu bilgiyi verin.

## 4. Güncelleme geri alındı

Sunucu güncellemesi sorun çıkarsa kendiliğinden eski sürüme döner. Sistem → **Sunucu Güncellemeleri** → "Son güncelleme" kartı sonucu söyler:
- **Başarılı** — yeni sürüm çalışıyor.
- **Geri dönüldü** — güncelleme yarıda kesildi ve eski sürüme dönüldü; veri korunur, program çalışmaya devam eder. "Sorun" satırı sebebi yazar (ör. "Yeni sürüm sağlık denetiminden geçemedi", "Dosya kilitli — başka bir program kullanıyor", "Disk dolu", "Güncelleme öncesi yedek alınamadı"). Sebebi giderin (disk boşaltmak, kilitleyen programı kapatmak gibi); "Geçmiş" kartında kayıtlar durur. Sebep belli değilse Destek talebi açın.
- **Başarısız — müdahale gerekiyor** ve "Son güncelleme geri alınamadı — müdahale gerekiyor" başlığı: güncelleyici yeni onay gelene dek işlem yapmaz. Yeniden denemeyin; Sistem → **Destek**ten talep açıp satıcıya bildirin. Veri, güncelleme öncesi alınan yedekle korunur.
- "Güncelleyici yanıt vermiyor" ya da "Bu sunucuda güncelleyici kurulu değil": Hizmetlerde **TeksERP-Guncelleyici**'nin çalıştığına bakın ([sunucu-bilgisayari.md](sunucu-bilgisayari.md) bölüm 1).
- Güncelleme sürerken panel ve tabletler birkaç dakika bağlanamaz; bu normaldir. Sunucu bilgisayarında sağ alttaki simge güncelleme sürerken sarı olur, hata olursa kırmızı; simgeye tıklayınca sebep yazar ([sunucu-bilgisayari.md](sunucu-bilgisayari.md) bölüm 1).

## 5. Destek talebi nasıl açılır

Sistem → **Destek** → "Yeni destek talebi" → **Konu**, **Açıklama**, istenirse **Ekran görüntüsü ekle** → **Talebi gönder**. Yanıt aynı sayfada "Satıcı yanıtları"nda görünür. Onay verirseniz hataların türü/yeri/sürümü satıcıya kendiliğinden de gider: Sistem → **Destek** → **Hata raporları** kartı ([panel-yonetici.md](panel-yonetici.md) bölüm 9; varsayılan kapalı).
