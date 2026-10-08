# Play incelemesi için demo sunucusu ve deneme hesabı (Play K4)

**Durum:** TASARIM — ölçüm + seçenekler. Sunucuya, Cloudflare'e, VDS'e henüz hiçbir şey yazılmadı.
**Bağlam:** Kullanıcı kararı 2026-10-08: tablet dağıtımı = Play KAPALI TEST + Google Grubu. Kapalı test de Play incelemesinden geçer; incelemeci uygulamaya girip bir akışı deneyebilmeli. Tablet vc60 (1.2.0) sunucuya yalnız şifreli ve sabitlenmiş (parmak izli) TLS ile bağlanır (`docs/design/LAN-TLS.md` §6, `docs/kurallar/kesif-cihaz.md`).

## 1. Ölçümler (2026-10-08, salt okuma)

| # | Ölçülen | Sonuç |
|---|---|---|
| Ö1 | `demo.etkiliyazilim.com` | Ayakta. `/health` UP, backend **2.9.0**, firma adı sahte (DEMOTEKS). Kimlik ucunda `tls` alanı YOK → LAN TLS bu sürümde yok |
| Ö2 | Nerede koşuyor | ESKİ paylaşımlı sunucuda (`SUNUCU-ENVANTERI.md` "Eski paylaşımlı sunucu"; ters DNS bir müşterinin posta sunucusu adı). Konteyner `tekserp-demo`, 2026-09-01'den beri, 1 GB bellek sınırı, port yayını yok (Traefik arkasında). Makine: 4 çekirdek, ~2,9 GB boş bellek, diskte 33 GB boş. Komşular: posta, WordPress'ler, ortak PostgreSQL/MariaDB/Redis |
| Ö3 | VDS (lisans/satıcı/patron) | Demo orada YOK. 2 çekirdek, ~3 GB bellek (≈2 GB kullanılabilir) — lisans sunucusunun yanında |
| Ö4 | Demo `.env` | `TRUST_PROXY=2` (sıçrama sayısı) · `RATE_LIMIT_ENABLED=true` · `SWAGGER_ENABLED=false` · `LAN_TLS_MODE` yok · `CLIENT_IP_HEADER` tanımlı |
| Ö5 | Eski sunucu güvenlik duvarı | 80/443 yalnız Cloudflare aralıklarına; 2222 (SSH) ve posta portları herkese. 4443/4000 dışarıdan kapalı (ölçüldü: zaman aşımı) |
| Ö6 | Cloudflare bölgesi | Bütün A kayıtları turuncu bulut (vekil), SSL kipi `strict`. `demo` ve `api` eski sunucuya, `lisans/portal/patron/guncelleme/indir/tekserp` VDS'e bakıyor. Gri bulutlu (yalnız DNS) A kaydı yok |
| Ö7 | Sunucu adreslerinin gizliliği | İki makinenin IP'si zaten açık: repo PUBLIC ve `SUNUCU-ENVANTERI.md` ikisini de yazıyor; eski sunucu ayrıca bir posta sunucusu (ters DNS). Gri bulutlu bir ad YENİ bir sır açmaz |
| Ö8 | Tablet adres girişi | `parsePairAddress` sunucu ADI kabul eder, port yazılmazsa **4443**. İncelemeci yalnız `inceleme.etkiliyazilim.com` yazar |
| Ö9 | Tablet doğrulaması | Native katman sertifikayı yalnız parmak iziyle kabul eder (`LanTlsPolicy.tlsVerdict`: iz kümede → kabul; sabitli uçta iz farklı → RED). Ad doğrulaması sabitli uçta atlanır → sertifikadaki adın `inceleme…` olması gerekmez |
| Ö10 | LAN TLS hangi sürümde | Backend **2.14.0** (bugün TASLAK, terfi bekliyor). Demo 2.9.0 → en az 2.14.0'a çıkmadan tablet bağlanamaz |
| Ö11 | Yan bulgu (kapsam dışı) | VDS'in 443'ü IP'ye doğrudan istekte Traefik 404'ü döndü — "yalnız Cloudflare" kısıtı orada yok ya da ölçen adres muaf. Ayrı ölçüm işi |

## 2. Asıl düğüm: Cloudflare vekili sabitlemeyi kırar

Turuncu bulutta tableti karşılayan sertifika Cloudflare'in KENAR sertifikasıdır: sunucunun kendi sertifikası değildir ve Cloudflare onu kendi takvimiyle yeniler (Universal SSL, ~3 ayda bir; istemciye göre ECDSA/RSA farklı yaprak da dönebilir). Tablet o yaprağın izini sabitler → ilk yenilemede `REJECT`, incelemeci "bağlanamıyor" görür. Aynı yoldaki diğer seçenekler de sonucu değiştirmez:

- **Ayrı port/yol (Cloudflare'in 2053/8443 gibi HTTPS portları):** yine kenarda sonlanır, yine kenar sertifikası. RED.
- **Cloudflare Tunnel:** kenarda sonlanır; TCP kipi istemcide `cloudflared` ister. RED.
- **Spectrum (ham TCP geçişi):** sunucunun sertifikası uçtan uca gider, sabitleme çalışır; ama keyfi TCP yalnız Enterprise planda. Maliyet orantısız. RED.
- **Kenara kendi sertifikamızı yüklemek:** Business plan; ayrıca kenar sertifikası tek kurulumun anahtarı olmaz. RED.

⚠️ **Aynı düğüm bulut kurulumunu da bağlar:** `BULUT-KURULUM.md` tabletin `https://<kanal>.etkiliyazilim.com`'a Cloudflare üzerinden bağlandığını varsayar; vc60'ta genel sertifikalı (sabitsiz) sunucu yolu YOK (`secureTransportOnly`, eşleştirme akışı her zaman sabitler). Bu belge o çelişkiyi çözmez, karar K2'de işaretler.

## 3. Seçenekler

| | A — Gri bulutlu ad + sunucunun kendi sertifikası | B — A'nın aynısı, ayrı küçük kiralık sunucuda | C — Tablete "genel sertifikalı sunucu" yolu, Cloudflare kalır |
|---|---|---|---|
| Nasıl | Eski sunucuda AYRI bir inceleme kurulumu (yeni konteyner + kendi PostgreSQL'i). `inceleme.etkiliyazilim.com` gri bulut. Yalnız 4443 dışarı açılır, `LAN_TLS_MODE=required` | Aynı kurulum, yalnız ona ayrılmış küçük bir VPS'te | Demo Cloudflare arkasında kalır; tablet, Android'in güvendiği bir sertifika + ad doğrulamasıyla sabitsiz bağlanır |
| Tablet değişikliği | Yok (vc60 olduğu gibi) | Yok | Yeni APK (native yoklama + JS akışı) + kural değişikliği (`kesif-cihaz.md` "yalnız sabitli") |
| Ek maliyet | 0 | aylık ~5–8 € + bir makine daha (yama, izleme) | 0 para; birkaç günlük iş |
| Hareketli parça | 1 konteyner + 1 DB konteyneri + 1 DNS kaydı | + 1 sunucu | + tablet kod yolu, + ikinci güven modeli |
| Risk | İnternete açık 4443, posta sunucusuyla aynı makinede (konteyner yalıtımı, kendi ağı). Cloudflare'in saldırı süzgeci bu adda yok | En düşük paylaşım riski | Güven modelinin genişlemesi (yanlış ad yazan kullanıcı başka bir siteye bağlanabilir → yalnız `*.etkiliyazilim.com` gibi bir sınır gerekir) |
| İncelemeci deneyimi | Ad yaz → 64 haneli kodu talimattaki kodla karşılaştır → Onayla → giriş | Aynı | Ad yaz → giriş (kod ekranı yok) |
| Zaman | Hemen (backend 2.14.0 terfisine bağlı) | VPS kiralama + aynı adımlar | Play gönderimini geciktirir |

**Önerilen: A şimdi.** Tablet hazır, ek maliyet yok, saldırı yüzeyi tek port + tek konteyner. C bulut kurulumunun önünde zaten duran bir iştir; Play için beklenmez, bulut işinde karar verilir (K2).

## 4. Önerilen düzen (A)

**Ayrı inceleme kurulumu, satış demosundan bağımsız.** Satış demosu (`demo.etkiliyazilim.com`, panel web, Traefik + Cloudflare) DOKUNULMADAN kalır. Neden ayrı: (1) satış demosu `TRUST_PROXY=2` ile vekil arkasında çalışır; aynı süreç 4443'ten doğrudan istemci de alırsa saldırgan `X-Forwarded-For` başlığına iki sahte adres yazıp `req.ip`'yi seçer → giriş kilidi ve hız sınırı atlanır (Express `trust proxy` uygulama genelidir, dinleyici başına değil). Ayrı kurulumda vekil yok → `TRUST_PROXY` hiç verilmez, IP soketten gelir. (2) İncelemecinin verisi satış demosunu kirletmez, ayrı sıfırlanır.

| Konu | Karar |
|---|---|
| Ad | `inceleme.etkiliyazilim.com`, A kaydı, **gri bulut**. `BULUT-KURULUM.md` T1 ayrılmış adlar listesine `inceleme` eklenir |
| Port | Yalnız `4443/tcp` yayınlanır. `LAN_TLS_MODE=required` → HTTP yalnız konteynerin kendi 127.0.0.1'inde (sağlık denetimi orada). Panel web YOK (`WEB_DIST_DIR` verilmez), Swagger kapalı |
| Sertifika | Backend'in kendi ürettiği kendinden imzalı ECDSA P-256, 10 yıl. `LAN_TLS_DIR` ADLI bir Docker biriminde (konteyner yeniden kurulsa da iz değişmez). Sıfırlama betiği bu birime DOKUNMAZ. Konteynere sabit `hostname: inceleme` (sertifika SAN'ı ve kimlik ucundaki sunucu adı okunur olsun) |
| Kodun ömrü | Kod = sertifikanın SHA-256'sı; dosya durdukça değişmez (D7 yenileme yok, 10 yıl yeter). Birim kaybolursa yeni kod doğar → yalnız Play Console "Uygulama erişimi" metni güncellenir; uygulama sürümü gerekmez |
| Veritabanı | Kendi küçük PostgreSQL konteyneri, kendi iç ağında (eski sunucunun ortak PostgreSQL'i ve komşu konteynerler bu ağdan görünmez) |
| İmaj | Korumalı imaj (`Teks-Erp/docker/korumali/Dockerfile`), backend ≥ 2.14.0. Salt okunur kök FS, `cap_drop: ALL`, `no-new-privileges`, bellek 768 MB–1 GB |
| Gelen trafik | Docker yayınlanan portu UFW'yi ATLAR (iptables DNAT) → kural `DOCKER-USER` zincirinde yazılır ve ölçülür; `userland-proxy` açıksa kaynak IP konteyner ağ geçidi olur → D1'de ölçülür, kapalı olmalı |
| Çıkan trafik | Yalnız lisans sunucusu (443). Patron eşitlemesi KAPALI, satıcı/portal bağı yok |
| Lisans | Üretim lisans sunucusunda "test" grubunda inceleme lisansı (plan 3.8 ile aynı grup) — K4 |
| Hız/kilit | `RATE_LIMIT_ENABLED=true`; giriş kilidi kipi `ip` (vekil yok). İncelemeci başka IP'den geldiği için saldırganın kilidi onu etkilemez |
| Cihaz onayı | `devicePairingRequired` KAPALI, kurulum sınıfı BARINDIRILAN DEĞİL — açık olsaydı incelemecinin tableti "onay bekliyor" ekranında kalırdı. Karşılığı: hiçbir kullanıcıya hızlı PIN / QR kart tanımlanmaz (6 haneli PIN internete açık kalmaz); giriş yalnız kullanıcı + parola |
| Deneme hesabı | `Play İnceleme` kullanıcısı; rolü yalnız tablet operatör izinleri, tek istasyon/makineye atanmış; panel, yönetim, SoD izinleri YOK. Parola 20+ karakter rastgele, sunucuda üretilir; yalnız sunucudaki 0600 dosyada ve Play Console formunda durur — repoya, log'a, sürüm notuna, sohbete girmez. Zorunlu parola değişimi KAPALI (incelemeci her seferinde aynı parolayla girer) |
| Veri | Sahte fabrika seed'i (`seed-demo-full` ailesi), incelemecinin akışı için hazır topların olduğu bir istasyon |

**Play "Uygulama erişimi" talimatı (taslak, İngilizce yazılır):** 1) Uygulamayı aç → "Add server / Sunucuyu ekle" → "Adres yaz" → `inceleme.etkiliyazilim.com` · 2) Ekrandaki doğrulama kodu şu kodla aynıysa Onayla: `<kod>` · 3) Kullanıcı listesinden "Play İnceleme" → parola · 4) Denenecek akış (ör. bir topu tartmak).

### Kök kuralla ilişki

Kök `CLAUDE.md`: *"Fabrika sunucusuna GELEN port açılmaz … dışarıyla tek bağ fabrikanın ÇIKAN imzalı kanallarıdır."* Kuralın amacı müşterinin fabrikasındaki gerçek veriyi korumaktır; inceleme kurulumu bizim sunucumuzda, sahte veriyle koşar. Yine de metin kapsamı ayırmıyor (aynı yazılım, "fabrika sunucusu") → yorumla geçmek yerine **beyanlı istisna** yazılmalı. `BULUT-KURULUM.md` aynı kuralı bulut sınıfı için zaten yeniden yazmayı planlıyor; tek cümlede ikisi birlikte: *"Müşterinin fabrikasındaki sunucuya gelen port açılmaz; bizim sunucumuzdaki kurulumlar (bulut sınıfı, demo/inceleme) beyanlı istisnadır ve kendi sertleştirmesini taşır."* Kullanıcı onayı gerekir (K3); bu dal CLAUDE.md'ye dokunmaz.

## 5. Dilimler

| Dilim | İçerik | Yazma? |
|---|---|---|
| D0 | Bu belge | — |
| D1 | Eski sunucuda salt ölçüm: `userland-proxy`, `DOCKER-USER`, Docker sürümü, derleme önbelleği/disk; satış demosuna dokunulmaz | Hayır |
| D2 | Backend 2.14.0 terfisi (inceleme kurulumunun ön koşulu; ayrı iş) | — |
| D3 | İnceleme yığını: compose (backend + kendi PG + iç ağ + adlı birimler), `.env` (sırlar sunucuda üretilir), seed + deneme hesabı, lisans (test grubu). Önce yalnız sunucunun kendi içinden ölçülür (`curl -k https://127.0.0.1:4443/api/discovery/identity`) | Sunucuya (onaylı) |
| D4 | Dışarı açma: `DOCKER-USER` kuralı + Cloudflare'de gri bulutlu `inceleme` A kaydı | Sunucu + Cloudflare (onaylı) |
| D5 | Doğrulama: gerçek tablet vc60 ile ad yaz → kod → giriş → akış; dışarıdan port taraması (yalnız 4443); sahte `X-Forwarded-For` ile kilit sayacının IP'yi soketten aldığı; HTTP'nin dışarıdan kapalı olduğu; kod Play formuna yazılır | Hayır |
| D6 | Bakım: sıfırlama betiği (`demo-reset.sh` kalıbı, sabit DB adı, sertifika birimine dokunmaz), `SUNUCU-ENVANTERI.md` satırı, ayrılmış ad listesi, kök kural cümlesi (K3 onayıyla) | Repo |

Geri alma: A kaydını sil → `DOCKER-USER` kuralını kaldır → yığını durdur. Gerçek veri yok; satış demosu etkilenmez.

## 6. Kullanıcıya sorulacak kararlar

**K1 — İnceleme sunucusu nerede koşsun?**
- a) **Mevcut demo sunucusunda, satış demosundan ayrı bir kurulum olarak** — ek maliyet yok ⭐ önerilen
- b) Yalnız buna ayrılmış küçük bir kiralık sunucuda — aylık ~5–8 €, tamamen ayrı
- c) Lisans sunucusunun olduğu makinede — bellek dar ve lisans sunucusunun yanına internete açık bir kapı koymak istemeyiz (önerilmez)

**K2 — Tablet sunucuya nasıl bağlansın?**
- a) **Bu ad için Cloudflare devre dışı; sunucunun kendi sertifikası, incelemeci 64 haneli kodu talimattaki kodla karşılaştırır** — tablet olduğu gibi kalır ⭐ önerilen (şimdi)
- b) Tablete "internette güvenilen sertifikalı sunucu" desteği ekleyelim, Cloudflare kalsın — yeni tablet sürümü gerekir; bulut kurulumda tabletin bağlanabilmesi için bu iş zaten gerekecek, o işte karar verilsin

**K3 — "Fabrika sunucusuna dışarıdan bağlantı açılmaz" kuralı**
- a) **Kurala tek cümle eklensin: bizim sunucumuzdaki kurulumlar (bulut, demo/inceleme) açıkça yazılmış istisnadır** ⭐ önerilen
- b) Eklenmesin; kural yalnız müşteri fabrikası için sayılsın

**K4 — İnceleme sunucusunun lisansı**
- a) **Lisans sunucusunda "test" grubunda bir inceleme lisansı** — program tam çalışır ⭐ önerilen
- b) Lisanssız — program kısıtlı kipe düşebilir, incelemeci kayıt yapamayabilir

**K5 — İncelemeci neleri görebilsin?**
- a) **Yalnız tablet operatör ekranları, tek istasyon, sahte veri** ⭐ önerilen
- b) Süpervizör ekranları da açık olsun

**K6 — İnceleme verisi ne zaman sıfırlansın?**
- a) **Her Play gönderiminden önce elle** ⭐ önerilen
- b) Haftada bir otomatik
