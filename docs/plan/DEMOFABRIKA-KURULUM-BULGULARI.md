# demofabrika kurulumu — bulgular ve sonraki işler

> **Ne bu belge:** 2026-10-02/03'te kullanıcı demofabrika'yı "yeni bir müşteri" gibi baştan kurdu: setup.exe, lisans portalı, panel, tablet. Bu belge o kurulumda görülenleri ve ardından yapılacak işleri sıralar. Her madde **ne oldu → ne olmalı** biçimindedir. Her bölüm kendi içinde önem sırasındadır.
> **Kimlikler:** K1…K11 bulgu numarasıdır. Lisans kademeleri (K0–K5) karışmasın diye metinde "kademe K3" diye yazılır.
> **Kararlar:** bu turda verilen kullanıcı kararları arşivde: `docs/history/CLAUDE-NOT-ARSIVI.md` → "2026-10-02 — Müşteri sunucusu Tailscale ağımıza alınmaz" · "2026-10-02 — Sunucu saati kilitlenemez" · "2026-10-03 — Tek ana dal + sürüm başına TEK ortak paket" · "2026-10-03 — adnansahin dondurulur".
> **Durum:** açık iş listesi. İş bitince belge `docs/history/`e taşınır.

## 0. Sıralı iş listesi (kullanıcı onayı 2026-10-04)

> **Sıra ölçütü:** sonraki işin dayandığı iş önce gelir; müşterinin gördüğü kusur yenilikten önce kapanır. Biten madde `[x]` + tarih + commit; başlayan `▶`. Ayrıntı her maddenin gösterdiği bölümde.

**Faz 0 — hazırlık**
- [x] Kök, satıcı ve patron CLAUDE.md kısaltması — 2026-10-03, `58185acdc`
- [x] İş sırası belirlendi, bu listeye yazıldı — 2026-10-04

**Faz 1 — hemen (küçük, kararı verilmiş)**
- [ ] ▶ 1.1 Satıcı portalı tamamen internetten + `lisans.md`'deki iki biçimli satıcı kurallarının birleştirilmesi (§E; C-1 "satıcı portalı yetkileri" bununla kapanır) — 2026-10-04 keşif + plan başladı · İlerleme: D1 (sunucu kilitleri) · D2 (web kilitleri) · D3b · D3a (belgeler + gövde özeti bekçisi) · denetim temiz; sırada D4 VDS kurulumu (kullanıcı onayıyla), D5 tünel kapatma
- [ ] 1.2 Mac'te dönem töreni: kök anahtar VDS'ten kalkar (§D-2) — 1.1'in hemen arkasından (kullanıcı kararı 2026-10-05: D5 tünel kapatma bitince; kök dosyası bugün VDS'te şifreli duruyor, o arada portaldan kök parolasıyla imza atılmaz)
- [x] 1.3 Test veritabanlarının silinmesi (§D-5) — 2026-10-04, 223 `_test` DB (~6,5 GB) silindi; kalan yalnız `postgres` + `tekserp_fabrika_0923`
- [ ] 1.4 Karar arşivinin aylara bölünmesi (§E)
- [ ] 1.5 `test_uretim_toren` temiz ağaçta kırmızı (PAKET aracı Node 26.8.1'de çöküyor) — ayrı incelenecek

**Faz 2 — demofabrika kusurları (§A)**
- [ ] 2.1 K5 — DEMO lisansı bitişsiz kaydedilemesin
- [ ] 2.2 K11 — panelde backend güncellemesi onay ekranı (panel 1.4.3; ilk backend güncellemesinden önce)
- [ ] 2.3 K4 — müşterinin kendi yönetici hesabını açma adımı
- [ ] 2.4 K6 bant önceliği · K9 bakım bitişi bildirimi · K8 yanlış mesaj · K7 "yenilendi" mesajı · K10 portalda açık modüller
- [ ] 2.5 K1 — kullanılmayan ağ adreslerinin duyurulmaması
- (K2 ve K3'ün kalıcı çözümü Faz 3'te)

**Faz 3 — tek ortak paket (§B-1)**
- [ ] 3.0 Test yükü önerisine kullanıcı onayı (§E) — tasarımdan önce
- [ ] 3.1 Tek ortak paket tasarım + uygulama; K2 firma adı, K3 Tailscale kutusu/gömülü adres
- [ ] 3.2 İndirme kapısı yeni alt adresle (§D-1)
- [ ] 3.3 Panel 1.4.3: sunucu durumu ekranı + canlı güncelleme penceresi + tablet bandı (§E)
- [ ] 3.4 Sunucu bilgisayarında sağ alt simge (§E)
- [ ] 3.5 Sunucu saati (§B-3)
- [ ] 3.6 Hata raporları (§E)
- [ ] 3.7 Fabrika tableti Google Play'de (§E)
- [ ] 3.8 testfabrika üretim lisans sunucusuna taşınır ve "test" güncelleme grubu olur; hazırlık satıcısı portalsız kalır, yalnız lisans sunucusunun kendi sürüm denemesi için (kullanıcı kararı 2026-10-05)
- [ ] 3.9 Paket anahtarı kökün altına alınır: paket anahtarı kök imzalı sertifikayla ve kısa ömürlü (ör. 1 yıl) olur, kaybı/çalınması kökle yeni sertifika + iptalle kapanır, fabrikaya elle kurulum gerekmez; güncelleyici (Rust) zincirle doğrular, geçişte çift imza (kullanıcı kararı 2026-10-05; yedek anahtar ve parola bölme şimdilik YAPILMAZ, donanım anahtarı bütçe yok)

**Faz 4 — adnansahin taşıması (§B-5)**
- [ ] 4.1 thinkpad-1'de yedek kopyasıyla prova
- [ ] 4.2 Gerçek taşıma; eski `guncelleme.etkiliyazilim.com` kapanır

**Faz 5 — patron bulutu**
- [ ] 5.1 Tesis başına ayrı veritabanı (§B-6)
- [ ] 5.2 DEMO sınıfı gönderici (§B-7)
- [ ] 5.3 Canlı güncelleme — önce döküm kopyasında prova (§D-3)

**Faz 6 — kalan güvenlik işleri (§C)**
- [ ] 6.1 Fabrika ağında TLS
- [ ] 6.2 İnternet kenarı: hız sınırı, satıcının genel uçları
- [ ] 6.3 Lisans v2 küçük kalemleri
- [ ] 6.4 PIN bayat özet

**Faz 7 — bulut satışı**
- [ ] 7.1 Bulut kurulum modeli (§B-2) + müşteri başına ek süre önerisi (§B-4)
- [ ] 7.2 Bağımsız güvenlik testi (§E) — bulut satışından önce

**Paralel — konuşma ve kullanıcı işleri**
- [ ] P1 e-İrsaliye / e-Fatura ve muhasebe bağlantısı — konuşma ÖNCE (öncelik ilk), kodlama Faz 3'ten sonra
- [ ] P2 Avukat (§D-4)
- [ ] P3 Bayi akışı
- [ ] P4 Kılavuz ve eğitim
- [ ] P5 Sunucu ve tablet donanım önerisi
- [ ] P6 Modül paketleri ve fiyat · yedek parolası teslim tutanağı · kurulum dosyası imzası (bütçe olunca)

## A. Kurulum bulguları

### K11 — Panel 1.4.2'de backend güncellemesi için onay ekranı yok
- **Ne oldu:** demofabrika'daki panel 1.4.2, backend güncellemesini onaylatan ekranı taşımıyor.
- **Ne olmalı:** demofabrika'ya ilk backend güncellemesi gitmeden ÖNCE panel 1.4.3 çıkmalı ve onay ekranı onda olmalı. Sıra: önce panel, sonra backend güncellemesi.

### K5 — DEMO lisansı portalda süresiz oluşturulabildi
- **Ne oldu:** portalda DEMO sınıfı bir lisans bitiş tarihi olmadan kaydedilebildi.
- **Ne olmalı:** DEMO sınıfında bitiş tarihi zorunlu ve en çok 45 gün olmalı. Portal formu bunu istemeli, satıcı sunucusu da kayıtta reddetmeli. HAK ufkunda bu tavan zaten var (`UFUK_TAVANI_ASIMI`); lisans kaydının bitiş alanı da aynı kuralı taşımalı.

### K3 — Tailscale kutusu ve tabletin gömülü adresi
- **Ne oldu:** kurulumda Ağ sayfasındaki "Tailscale ağından da erişilsin" kutusu müşteri kurulumunda açık göründü. demofabrika tabletinin içine gömülü ERP adresi de bir Tailscale adı (`*.ts.net`). Bu ad müşterinin ağında çözülmez; tablet sunucuyu bulamaz.
- **Ne olmalı:** müşteri sunucusu bizim Tailscale ağımıza alınmaz (karar 2026-10-02). Kutu müşteri kurulumunda varsayılan KAPALI olmalı. Tablete Tailscale adı gömülmemeli: tablet sunucuyu yerel ağda keşifle bulmalı ya da adres kurulumda girilmeli.
- **Ölçüldü (kod):** sihirbazda kutu bugün varsayılan kapalı (`AgSayfasi.Values[0] := False`, `deploy/kurulum/tekserp-kurulum.iss`). Kurulumda neden açık göründüğü ölçülmeli. İki aday var: aynı makinedeki önceki kurulumun cevabı, ya da `kurulum.ps1`in kayıttaki erişimi daraltmaması.

### K4 — Müşterinin kendi yönetici hesabını açma adımı yok
- **Ne oldu:** sihirbazda açılan hesap bizim süperadmin destek hesabımız. Kurulum bittiğinde müşteriye "kendi yönetici hesabını oluştur" diyen bir adım yok.
- **Ne olmalı:** kurulumun sonunda ya da panelin ilk açılışında müşteriye kendi yönetici hesabını açtıran bir adım olmalı. Destek hesabı müşterinin günlük hesabı olmamalı.

### K6 — Panelde tek bant, önemli mesajlar arkada kalıyor
- **Ne oldu:** panel tek bir bant gösteriyor. Lisans bitiş bandı görünürken satıcının mesajı (kademe K0) ve daha yakın olan kademe K3 geri sayımı onun arkasında kaldı, görünmedi.
- **Ne olmalı:** bant EN YAKIN kısıtlama tarihini ve sebebini göstermeli ("X gün sonra kısıtlı kip — sebep: …"). Satıcı mesajı ayrı bir yerde, her zaman görünmeli.

### K9 — Bakım bitince müşteri hiçbir şey duymuyor
- **Ne oldu:** bakım süresi bitti; kurulu sürüm hâlâ hak edilen sürüm olduğu için hiçbir bilgi çıkmadı.
- **Ne olmalı:**
  - Bitişten 30 gün önce hatırlatma bandı.
  - Bitince bilgi bandı: "bakımınız bitti, yeni sürümler için bakımı yenileyin".
  - Portalda "bakımı bitecek müşteriler" listesi ve bildirim (yenileme satışı için).

### K8 — Bakım bitişi geriye alınınca yanlış mesaj
- **Ne oldu:** bakım bitişi kurulu sürümün çıkış tarihinden önceye alınınca panel "hak ettiğiniz sürüme dönün" dedi. Müşteri bunu kendisi yapamaz.
- **Ne olmalı:**
  - Mesaj "bakımı yenilemek için satıcınızla görüşün" olmalı.
  - Portal, bakım tarihi kurulu sürümden önceye düşüyorsa imzadan ÖNCE uyarmalı.

### K10 — Portal fabrikadaki açık modülleri göstermiyor
- **Ne oldu:** portal, fabrikada hangi modüllerin açık olduğunu göstermiyor. Gözlem kipinde lisans dışı modül kullanılıyorsa açık bir uyarı ya da bildirim yok; yalnız "Reddedilecek istek" sayısı var.
- **Ne olmalı:** portal açık modülleri göstermeli. Lisans dışı modül kullanımı adıyla uyarı + bildirim olmalı ("X modülü lisansta yok ama kullanılıyor").

### K7 — "Lisans yenilendi" mesajı yanıltıcı
- **Ne oldu:** "Lisansı şimdi yokla" ve "Bu bilgisayar üzerinden yenile" başarıda "Lisans yenilendi" diyor. Oysa yapılan yalnız eşitleme; bitiş tarihi değişmemiş olabilir.
- **Ne olmalı:** mesaj ne olduğunu söylemeli: "Lisans bilgisi güncellendi — bitiş: X (değişmedi / uzadı)" ve değişen alanlar.

### K2 — Firma adı kurulumda sorulmuyor
- **Ne oldu:** kurulum firma adını sormuyor; keşifte sunucu "TeksERP" adıyla görünüyor.
- **Ne olmalı:** sihirbaz firma adını sormalı ya da ad lisanstan gelmeli (müşteri kimliği lisansta). Keşif kimliği ve ekrandaki firma adı bu değerden gelmeli.

### K1 — Sunucu kullanılmayan ağ adreslerini de duyuruyor
- **Ne oldu:** sunucu sanal ve bağlantısız ağ kartlarının adreslerini de duyuruyor. Panelde "bu sunucunun 5 adresi var" görünüyor; kullanıcı hangisini seçeceğini bilemiyor.
- **Ne olmalı:** duyuru yalnız bağlı ve erişilebilir adresleri taşımalı. Sanal, bağlantısız ve kendi kendine atanmış adresler elenmeli.

## B. Ürün ve mimari

1. **Tek ortak paket — tasarım + uygulama** (karar 2026-10-03). Her ürün için sürüm başına tek paket: backend, panel, fabrika tableti, patron uygulaması/web. Müşteri kimliği etkinleştirme kodu + lisanstan gelir, filigran kurulumda basılır. Yayın güncelleme gruplarıyla yapılır: test → öncü → herkes. Bugünkü müşteri başına kanal + derleme düzeni bu modele taşınır. K2 ve K3'ün kalıcı çözümü de buradan geçer.
2. **Bulut kurulum kodlaması.** Müşteriye özel kiralanan VDS'te kurulum modeli kodlanmalı.
3. **Sunucu saati** (karar 2026-10-02). Kurulum, etki alanına bağlı olmayan makinede Windows NTP eşitlemesini açmalı. Backend, imzalı saatten sapmayı panel bandına, sağlık ucuna ve portala taşımalı. Programda saat değiştiren işlev olmamalı.
4. **Öneri: müşteri başına ek süre.** Ek süre müşteri başına ayarlanabilmeli: 7, 15 ya da 30 gün.
5. **adnansahin için "yedekten kur" + prova** (karar 2026-10-03). adnansahin dondurulur, ileride setup.exe ile temiz kurulur ve veri kendi yedeğinden aktarılır. Önce thinkpad-1'de o yedeğin kopyasıyla prova koşulur. Bugün sihirbazda yedekten başlatma adımı yok; panelin yerel yedek geri yüklemesi var. Hangisinin kullanılacağı tasarımda seçilir.
6. **Patron bulutunda tesis başına ayrı veritabanı** (karar 2026-10-03). Aynı PostgreSQL sunucusu ve tek patron API'si; her fabrikaya ayrı DB ve yalnız o DB'ye yetkili ayrı DB kullanıcısı. İstek doğru DB'ye yönlendirilir, yeni tesiste DB kendiliğinden hazırlanır, göçler her DB'ye tek tek uygulanır (bir tesisin hatası diğerlerini durdurmaz). Yedek, dışa aktarma ve imha tesis DB'si üzerinden yapılır; RLS ikinci savunma olarak kalabilir. Bugünkü tek DB + RLS düzeninin yerine geçer; taşınacak veri yok. Borç ve kapanma koşulu `docs/kurallar/patron-bulutu.md`'de.
7. **DEMO sınıfı patron bulutuna veri gönderebilir** (karar 2026-10-03). Lisansın HAK'ında `patron-bulut` modülü varsa DEMO kurulum da eşitler. Gönderici sınıf kümesi URETIM + BARINDIRILAN + DEMO olur; uygulama bulut kurulum tasarımındaki B1 iş paketiyle (sınıf tek kaynağı) birlikte yapılır. Bugün yalnız `URETIM` gönderir (`SINIF_URETIM_DEGIL`).

## C. Kalan güvenlik işleri

1. **İnternet kenarı:** hız sınırı, satıcının genel uçları, satıcı portalı yetkileri.
2. **Fabrika ağında TLS:** panel/tablet ↔ backend trafiği bugün yerel ağda şifresiz.
3. **Lisans v2 küçük kalemleri:**
   - satıcı uyarısının v2 kuralına uyması;
   - iki iptal belgesi kopyası ayrışınca bunun yerel müdahale nedeni olarak raporlanması;
   - yanıt ile istek arasındaki bağın sıkılaştırılması.
4. **PIN:** kısa kimlik özetinde, geri alıp yeniden yükseltmede bayat özet kalması.

## D. Kullanıcıyla yapılacaklar

1. **İndirme kapısının (Cloudflare Worker) yayını — kullanıcı kararı 2026-10-03: bugün DEĞİL, yeni adresle.** Yeni sistem için ayrı alt adres (öneri `indir.etkiliyazilim.com`) tek ortak paketle birlikte açılır; kapı yalnız o adreste çalışır, klasörler güncelleme grubuna göre (`/test`, `/oncu`, `/genel`). Eski `guncelleme.etkiliyazilim.com` adnansahin için olduğu gibi kalır (kapı dışında; adnansahin yeni sisteme taşınınca kapatılır). Demofabrika panel/tableti yeni adresle panel 1.4.3 turunda yeniden derlenir.
2. **Mac'te dönem töreni.** Kök anahtar VDS'ten kalkar.
3. **Patron bulutu canlı güncellemesi.** Önce döküm kopyasında prova.
4. **Avukat:** lisans v2 maddeleri, Cloudflare/KVKK, uzaktan destek maddesi.
5. **Test veritabanlarının silinmesi.** Komut kullanıcıda.

## E) Kullanıcı kararları ve konuşulacaklar (2026-10-03)

- **Kurulum dosyası imzası (Authenticode):** bugün bütçe yok. Ücretsiz önlem: bayi/ekip kılavuzuna "Ek bilgi → Yine de çalıştır" adımı ekran görüntüsüyle; kurulum USB ile getirilirse internet işareti olmadığından SmartScreen uyarısı çıkmaz. Bütçe olunca kod imzalama sertifikasına geçilir.
- **Fabrika tablet uygulaması Google Play'de (kullanıcı kararı 2026-10-03):** tek "TeksERP" uygulaması, mevcut KURUMSAL Play hesabıyla (yayıncı "Etkili Yazılım" — D-U-N-S zaten var, yeni başvuru GEREKMEZ); herkes kendi sunucusuna IP/ağ araması/QR ile bağlanır; Play test kanalları güncelleme gruplarına eşlenir (iç test → seçili cihazlar → herkes), küçük güncellemeler OTA ile sürer; Google hesabı açmak istemeyen fabrikalar için APK yolu yedek kalır; inceleme için internetten erişilebilen demo sunucu + deneme hesabı gerekir; 2026–2027 Play dışı kurulum doğrulaması aynı hesapla karşılanır. Patron uygulamasının iOS sürümü kullanıcının BİREYSEL Apple hesabıyla yayınlanır (D-U-N-S gerekmez).
- **Satıcı portalı tamamen internetten (kullanıcı kararları 2026-10-03 ve 2026-10-04):** `portal.etkiliyazilim.com` (ERİŞİM, 4613) tünele ayrılmış BÜTÜN işlemleri de sunar (kullanıcı yönetimi, bayi anahtarı, yayıncı anahtarı, imza parolası isteyen sürüm yükseltme ve toplu yeniden basım); ana (kök) anahtar parolası da internetten yazılabilir. Portal tüneli (4611 dinleyicisi + `deploy/satici/portal-baglan.mjs` + tailnet servisi) yedek yol olarak KALMAZ: internet yolu VDS'te doğrulandıktan SONRA ayrı dilim D5'te kapatılır; VDS'e SSH yönetim erişimi kalır. Cloudflare Access oturum süresi 24 saat (Cloudflare ayarı, kodda değişiklik yok). Riskler anlatıldıktan sonra karar verildi: parolalar Cloudflare'den düz metin geçer, yayıncı anahtarı internetten eklenebilir — Cloudflare hesabında iki adımlı giriş: kullanıcı durumunu bilmiyor, D4 öncesi birlikte bakılacak. Korunanlar: her istekte Access e-posta doğrulaması, parola + iki adımlı kod, internet kapısının açık-liste düzeni, imza boğazının bayi yolu reddi, bayi kapısı (4610) aynen. Durum: D1 (sunucu kilitleri) · D2 (web kilitleri) · D3b (lisans.md satıcı bölümleri birleşti) · D3a (belgeler + gövde özetine parola girmez bekçisi) bitti; D4 VDS kurulumu kullanıcı onayıyla, D5 tünel kapatma. C-1'deki "satıcı portalı yetkileri" kalemi bu işle kapanır.
- **Bayi akışı:** ayrıca, ayrıntılı konuşulacak (portal yetkileri, bayi kurulum kılavuzu).
- **Sonra konuşulacak — hiç açılmamış dört konu (kullanıcı 2026-10-03):**
  1. **e-İrsaliye / e-Fatura ve muhasebe programı bağlantısı** — bugün resmi belge dış programda elle yeniden yazılıyor, muhasebeye yalnız fiyatsız Excel dökümü çıkıyor (tasarımda bilerek kapsam dışı); seçenekler: özel entegratörle doğrudan kesim ya da yaygın muhasebe programlarına otomatik aktarım. Öncelik: ilk.
  2. **Kullanım kılavuzu ve eğitim** — personel ve yönetici için kılavuz, ekran içi yardım, kısa eğitim videoları (bayi/ekip arkadaşı müşteri eğitimini bununla verir).
  3. **Sunucu ve tablet donanım önerisi (Model 1)** — sunucu özelliği, kesintisiz güç kaynağı, yedek disk, tablet modeli, ağ; tabletin yalnız TeksERP'ye sabitlenmesi ve kaybolan tabletin kapatılması.
  4. **Bağımsız güvenlik testi** — bulut modeli satılmadan önce dış firma sızma testi (ücretli, acele yok).
- **Destek:** şimdilik panelden gelen destek talebine ilk gören kullanıcı cevap verir.
- **Modül paketleri ve fiyat:** sonra bakılacak.
- **Yedek parolası ve anahtarı:** kurulumda müşteriye yazılı teslim tutanağı (kim saklar, kaybolursa ne olur).
- **Test yükü ("herkese her şey"):** öneri — her şey kapalı (bugünkü davranış) · her şey açık · tek tek açık · gerçek fabrika profilleri (her müşterinin ayar düzeni adlı profil, her sürüm hepsiyle) · yalnız gerçekten etkileşen özellikler birlikte. Tek ortak paket tasarımına girer (kullanıcı onayı bekliyor).
- **Hata raporları:** YAPILACAK — müşteri onayıyla, kişisel veri olmadan (hata türü, sürüm, yer) otomatik bize iletilir.
- **Dil:** ilk hedef yurt içi pazarı; ileride yabancı dillere çevrilecek. Bugünden ucuz hazırlık: ekran yazıları merkezi etiket dosyalarında tutulur (çeviri kolaylaşsın); i18n altyapısı şimdi kurulmaz.
- **Karar arşivi dosyasının boyutu (`docs/history/CLAUDE-NOT-ARSIVI.md`, ~15 bin satır):** aylara bölünmesi önerildi (çakışma ve kazara büyük okuma azalır); limit sıfırlanınca.
- **Panel ve tabletin sunucuyu bulması (kullanıcı kararı 2026-10-03):** Model 1 (fabrika sunucusu) — ağdaki sunucuyu otomatik bulma yeterli (bugünkü "Ağda Ara"); yedek yol elle IP; fabrika ağı birden çok alt ağa bölünmüşse otomatik bulma çalışmayabilir, kılavuzda yazılsın. Model 2 (bulut, müşteriye özel VDS) — panel ve tablet adresi **QR** (panelde "Yeni cihaz ekle") ya da **firma kodu** ile öğrenir (kod → adres eşlemesi lisans sunucumuzdan). Personel hesapları ve girişi (PIN/kart) her zaman fabrikanın KENDİ TeksERP sunucusunda doğrulanır (Model 1'de fabrikadaki sunucu, Model 2'de müşterinin VDS'i); patron uygulamasındaki gibi merkezi bir Etkili Yazılım hesabı/girişi yoktur.
- **Sunucu durumu ve canlı güncelleme ekranı (kullanıcı isteği 2026-10-03, panel 1.4.3 ile):** panelde "Sunucu Durumu" ekranı (servisler, sürüm, lisans, disk, son yedek, bağlı cihazlar, güncelleme geçmişi, kurulum geçmişi ve aşamaları, bekleyen sürüm + onay düğmesi). Güncelleme sırasında backend kapalıyken bilgi, güncelleyicinin yalnız okunur küçük durum sayfasından gelir (fabrika ağıyla sınırlı; bulutta şifreli + girişli; sır yok). **Otomatik aç/kapa:** güncelleme başlayınca panelde ilerleme penceresi kendiliğinden açılır (adım adım: hazırlık → yedek → veritabanı → deneme → başlatma; süre tahmini), bitince kendiliğinden kapanır ve "Sunucu X sürümüne güncellendi" bildirimi; geri dönülürse "güncelleme geri alındı, sistem eski sürümde çalışıyor". Tabletlerde aynı anda "Sunucu güncelleniyor, birkaç saniye" bandı, bitince kendiliğinden kalkar ve yarım kalan giriş kaybolmaz. Sunucunun kendi tarayıcısından da aynı durum sayfası açılabilir. Tahmin ~1–2 ajan işi.
- **Sağ alttaki simge (bildirim alanı) (kullanıcı isteği 2026-10-03):** sunucu bilgisayarında kullanıcı oturum açtığında kendiliğinden başlayan küçük "TeksERP Sunucu" simgesi (setup.exe kurar): renk durumu gösterir (yeşil çalışıyor · sarı uyarı/güncelleme bekliyor · kırmızı sorun), tıklayınca durum penceresi açılır, güncelleme başlayınca balon bildirim + ilerleme penceresi kendiliğinden açılıp biter bitmez kapanır. Yönetici yetkisi istemez; yalnız güncelleyicinin okunur durum bilgisini gösterir, hiçbir şeyi değiştirmez. (Windows servisleri ekrana pencere açamadığı için ayrı küçük program gerekir — Microsoft/Adobe/Java güncelleyicileri de böyle.) Panel bilgisayarlarında simge YOK (kullanıcı 2026-10-03: gerek yok — panel durumu ve ilerlemeyi kendi içinde gösterir). Simge mümkünse güncelleyicinin mevcut Rust/Windows bağımlılıklarıyla yazılır; yeni kütüphane gerekirse uygulama öncesi kullanıcı onayı.
