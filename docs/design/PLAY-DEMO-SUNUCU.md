# Play incelemesi için demo sunucusu ve deneme hesabı (Play K4)

**Durum:** TASARIM — kullanıcı kararları alındı (2026-10-08, §0). Sunucuya, Cloudflare'e, VDS'e henüz hiçbir şey yazılmadı.
**Bağlam:** Kullanıcı kararı 2026-10-08: tablet dağıtımı = Play KAPALI TEST + Google Grubu. Kapalı test de Play incelemesinden geçer; incelemeci uygulamaya girip bir akışı deneyebilmeli. Tablet vc60 (1.2.0) sunucuya yalnız şifreli ve sabitlenmiş (parmak izli) TLS ile bağlanır (`docs/design/LAN-TLS.md` §6, `docs/kurallar/kesif-cihaz.md`).

## 0. Kararlar (kullanıcı, 2026-10-08)

| # | Karar | Sonucu |
|---|---|---|
| K1 | a — eski demo sunucusunda, satış demosundan AYRI kurulum | Ayrı konteyner + kendi PostgreSQL'i; satış demosuna dokunulmaz |
| K2 | **b** — tablete "internet sertifikalı sunucu" desteği; Cloudflare kalır | Gri bulut + 4443 + kod karşılaştırması (eski A düzeni) DÜŞTÜ. Tablet tasarımı `TABLET-GENEL-CA-BAGLANTI.md`; yeni Play paketi (vc61) gerekir. Aynı iş bulut kurulumunun tablet bağlantısını da çözer |
| K3 | a — beyanlı istisna | Kök `CLAUDE.md` cümlesi: müşterinin kendi yerindeki fabrika sunucusuna gelen port açılmaz; bizim kurup yönettiğimiz sunucular (bulut VDS'i, demo/inceleme) istisnadır, API orada internete açık yayın yapar. Arşiv `2026-10.md` §2026-10-08 gelen bağlantı istisnası |
| K4 | a — lisans sunucusunda "test" grubunda inceleme lisansı | Plan 3.8 ile aynı grup |
| K5 | a — yalnız tablet operatör ekranları, tek istasyon, sahte veri | §4 deneme hesabı satırı |
| K6 | a — her Play gönderiminden önce elle sıfırlama | §5 D6 sıfırlama betiği |


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

⚠️ **Aynı düğüm bulut kurulumunu da bağlar:** `BULUT-KURULUM.md` tabletin `https://<kanal>.etkiliyazilim.com`'a Cloudflare üzerinden bağlandığını varsayar; vc60'ta genel sertifikalı (sabitsiz) sunucu yolu YOK (`secureTransportOnly`, eşleştirme akışı her zaman sabitler). Karar K2-b bu çelişkiyi tablet tarafında çözer (`TABLET-GENEL-CA-BAGLANTI.md`).

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

~~Önerilen: A şimdi.~~ **Karar (K2, kullanıcı 2026-10-08): C.** Tablet işi bulut kurulumunun önünde zaten duruyordu; tek seferde ikisini çözer. A'nın açık 4443'ü ve kod karşılaştırması gerekmez.

## 4. Kararlaştırılan düzen (K1-a + K2-b)

**Ayrı inceleme kurulumu, satış demosundan bağımsız, Cloudflare arkasında.** Satış demosu (`demo.etkiliyazilim.com`) DOKUNULMADAN kalır. Ayrı olmasının nedeni artık yalnız veri yalıtımıdır (incelemecinin verisi satış demosunu kirletmez, ayrı sıfırlanır); A düzenindeki `TRUST_PROXY` gerekçesi düştü — yeni kapı açılmaz, bütün istekler aynı vekil zincirinden gelir.

| Konu | Karar |
|---|---|
| Ad | `inceleme.etkiliyazilim.com`, A kaydı **turuncu bulut** (Cloudflare vekili, SSL `strict`). `BULUT-KURULUM.md` T1 ayrılmış adlar listesine `inceleme` eklenir |
| Port | Yeni port AÇILMAZ: eski sunucunun 443'ü (yalnız Cloudflare aralıkları, Ö5) + mevcut Traefik'te yeni yönlendirici. Panel web YOK (`WEB_DIST_DIR` verilmez), Swagger kapalı |
| TLS | Kenarda Cloudflare'in sertifikası; Cloudflare → köken arası mevcut Traefik sertifikası. `LAN_TLS_MODE` verilmez (`off`) — tablet internet kipinde bağlanır, parmak izi kodu YOK |
| Gerçek IP | Satış demosuyla aynı zincir (Cloudflare → Traefik → uygulama): `TRUST_PROXY` sıçrama sayısı + `CLIENT_IP_HEADER`; D1'de ölçülür |
| Veritabanı | Kendi küçük PostgreSQL konteyneri, kendi iç ağında (ortak PostgreSQL ve komşu konteynerler bu ağdan görünmez); uygulama konteyneri ayrıca yalnız Traefik ağına bağlanır |
| İmaj | Korumalı imaj (`Teks-Erp/docker/korumali/Dockerfile`), güncel terfi edilmiş backend (LAN TLS şartı düştü). Salt okunur kök FS, `cap_drop: ALL`, `no-new-privileges`, bellek 768 MB–1 GB |
| Çıkan trafik | Yalnız lisans sunucusu (443). Patron eşitlemesi KAPALI, satıcı/portal bağı yok |
| Lisans | K4: üretim lisans sunucusunda "test" grubunda inceleme lisansı (plan 3.8 ile aynı grup) |
| Hız/kilit | `RATE_LIMIT_ENABLED=true`; giriş kilidi gerçek istemci IP'siyle (vekil başlığından) |
| Cihaz onayı | `devicePairingRequired` KAPALI, kurulum sınıfı BARINDIRILAN DEĞİL — açık olsaydı incelemecinin tableti "onay bekliyor" ekranında kalırdı. Karşılığı: hiçbir kullanıcıya hızlı PIN / QR kart tanımlanmaz (6 haneli PIN internete açık kalmaz); giriş yalnız kullanıcı + parola |
| Deneme hesabı | K5: `Play İnceleme` kullanıcısı; rolü yalnız tablet operatör izinleri, tek istasyon/makineye atanmış; panel, yönetim, SoD izinleri YOK. Parola 20+ karakter rastgele, sunucuda üretilir; yalnız sunucudaki 0600 dosyada ve Play Console formunda durur — repoya, log'a, sürüm notuna, sohbete girmez. Zorunlu parola değişimi KAPALI |
| Veri | Sahte fabrika seed'i (`seed-demo-full` ailesi), incelemecinin akışı için hazır topların olduğu bir istasyon |
| Tablet | vc61+ (internet kipi). vc60 bu adrese bağlanamaz (`TABLET-GENEL-CA-BAGLANTI.md` M6) — Play'e vc61 gönderilir |

**Play "Uygulama erişimi" talimatı (taslak, İngilizce yazılır):** 1) Uygulamayı aç → "Add server / Sunucuyu ekle" → "Adres yaz" → `inceleme.etkiliyazilim.com` · 2) Ekranda adı ve firma adını gösteren onayı kabul et · 3) Kullanıcı listesinden "Play İnceleme" → parola · 4) Denenecek akış (ör. bir topu tartmak).

### Kök kuralla ilişki

K3-a ile çözüldü: kök `CLAUDE.md` cümlesi müşterinin kendi yerindeki fabrika sunucusunu bizim kurup yönettiğimiz sunuculardan ayırır; inceleme kurulumu bizim sunucumuzdadır, sahte veriyle koşar. Kural satırı `docs/kurallar/deploy-kurulum.md`.

## 5. Dilimler

| Dilim | İçerik | Yazma? |
|---|---|---|
| D0 | Bu belge + kararlar | — |
| D1 | Eski sunucuda salt ölçüm: Traefik sürümü ve yönlendirici kalıbı, demo'nun `TRUST_PROXY`/`CLIENT_IP_HEADER` zinciri, derleme önbelleği/disk, etkiliyazilim.com CAA kaydı; satış demosuna dokunulmaz | Hayır |
| D2 | Tablet vc61 — `TABLET-GENEL-CA-BAGLANTI.md` G1–G3 (inceleme kurulumunun ön koşulu) | Repo |
| D3 | İnceleme yığını: compose (backend + kendi PG + iç ağ + adlı birimler + Traefik etiketi), `.env` (sırlar sunucuda üretilir), seed + deneme hesabı, lisans (test grubu). Önce yalnız sunucunun kendi içinden ölçülür | Sunucuya (onaylı) |
| D4 | Dışarı açma: Cloudflare'de turuncu bulutlu `inceleme` A kaydı | Cloudflare (onaylı) |
| D5 | Doğrulama: gerçek tablet vc61 ile ad yaz → onay → giriş → akış; sahte `X-Forwarded-For` ile kilit sayacının gerçek IP'yi aldığı; kökene doğrudan IP isteğinin reddedildiği | Hayır |
| D6 | Bakım: sıfırlama betiği (K6: her Play gönderiminden önce elle; `demo-reset.sh` kalıbı, sabit DB adı), `SUNUCU-ENVANTERI.md` satırı, ayrılmış ad listesi | Repo |

Geri alma: A kaydını sil → Traefik yönlendiricisini kaldır → yığını durdur. Gerçek veri yok; satış demosu etkilenmez.

## 6. Karar durumu

K1 a ✅ · K2 **b** ✅ · K3 a ✅ · K4 a ✅ · K5 a ✅ · K6 a ✅ (kullanıcı, 2026-10-08). Açık kalan: `TABLET-GENEL-CA-BAGLANTI.md` §7 KA (izinli alan) · KB (Play'e hangi sürümle).
