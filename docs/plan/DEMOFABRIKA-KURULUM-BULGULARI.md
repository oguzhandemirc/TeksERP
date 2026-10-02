# demofabrika kurulumu — bulgular ve sonraki işler

> **Ne bu belge:** 2026-10-02/03'te kullanıcı demofabrika'yı "yeni bir müşteri" gibi baştan kurdu: setup.exe, lisans portalı, panel, tablet. Bu belge o kurulumda görülenleri ve ardından yapılacak işleri sıralar. Her madde **ne oldu → ne olmalı** biçimindedir. Her bölüm kendi içinde önem sırasındadır.
> **Kimlikler:** K1…K11 bulgu numarasıdır. Lisans kademeleri (K0–K5) karışmasın diye metinde "kademe K3" diye yazılır.
> **Kararlar:** bu turda verilen kullanıcı kararları arşivde: `docs/history/CLAUDE-NOT-ARSIVI.md` → "2026-10-02 — Müşteri sunucusu Tailscale ağımıza alınmaz" · "2026-10-02 — Sunucu saati kilitlenemez" · "2026-10-03 — Tek ana dal + sürüm başına TEK ortak paket" · "2026-10-03 — adnansahin dondurulur".
> **Durum:** açık iş listesi. İş bitince belge `docs/history/`e taşınır.

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
