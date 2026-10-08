# Tablet: internet sertifikalı (genel CA) sunucuya bağlantı

**Durum:** G1–G5 İNDİ (ortak tablet vc61 1.3.0, runtimeVersion 57.0); G6 (gerçek tablet) bekliyor. Kullanıcı kararları 2026-10-08: KA = a (yalnız `*.etkiliyazilim.com`), KB = a (Play'e ilk gönderim vc61, inceleme sunucusu Cloudflare arkasında). Önceki durum: TASARIM — Kullanıcı kararı K2 (2026-10-08): tablet, Cloudflare gibi herkesin güvendiği bir sertifika yetkilisiyle doğrulanan ALAN ADLI sunuculara da bağlanabilsin. Çözdüğü iki iş: Play inceleme kurulumu (`PLAY-DEMO-SUNUCU.md`) ve bulut kurulumu (`BULUT-KURULUM.md`, tablet Cloudflare üzerinden). Yeni Play paketi gerektirir.
**Bağlam:** `LAN-TLS.md` (sabitli kip) · `docs/kurallar/kesif-cihaz.md` ("tablet sürüm paketi yalnız şifreli ve sabitli bağlanır" — bu tasarım inince o satır değişir) · arşiv `2026-10.md` §2026-10-08 gelen bağlantı istisnası.

## 1. Ölçüm — vc60 bugün ne yapıyor (salt okuma, kod)

| # | Ölçülen | Sonuç |
|---|---|---|
| M1 | Native güven katmanı (`LanTlsPolicy.tlsVerdict`) | Üç karar: iz kümede → kabul · sabitli uca farklı iz → RED · **sabitle ilgisi yoksa → SİSTEM** (OkHttp'un olağan zincir + ad doğrulaması). ⇒ vc60'ın native katmanı genel CA'lı bir sunucuya ZATEN bağlanabilir; engel JS'tedir |
| M2 | JS engeli | `secureAddressUsable`: kayıtlı adres https VE portu bir sabitin portu değilse kullanılmaz → tablet "Sunucuyu ekle"ye döner. Eşleştirme akışı (`decideCodePin`/`decideQrAddressPin`) her zaman parmak izi sabitler |
| M3 | Kullanıcı CA'ları | Uygulamada `networkSecurityConfig` yok; `targetSdkVersion` 36 ⇒ Android varsayılanı yalnız SİSTEM CA'larına güvenir (kullanıcı/MDM'in eklediği CA'lar hariç). Güvence bugün varsayılandan geliyor, beyanlı değil |
| M4 | Düz HTTP | `usesCleartextTraffic: false` (sürüm paketi); OkHttp Android'in şifresiz trafik politikasına uyar ⇒ şifresiz istek native düzeyde de kapalı |
| M5 | Adres girişi | `parsePairAddress` sunucu ADI kabul eder; port yazılmazsa **4443** (LAN TLS portu) |
| M6 | vc60 + Cloudflare'li ad | Ad yazılınca 4443 yoklanır — Cloudflare bu portu dinlemez → "bağlanılamadı". `ad:443` yazılırsa yoklama Cloudflare KENAR sertifikasının kodunu gösterir; karşılaştıracak kod yoktur; körlemesine onaylanırsa kenar yaprağı sabitlenir ve Cloudflare yenileyince (~3 ay) RED. Zarar yok ama yol yanlış ⇒ bulut/inceleme talimatı **vc61+** ister |
| M7 | Panel (Electron) | `setCertificateVerifyProc` sabit dışı sertifikayı Chromium'a bırakır (`-3`) ⇒ panel genel CA'lı adrese bugün de bağlanır. Bu tasarım paneli değiştirmez (QR hariç, §5) |

## 2. Önerilen düzen

İki kip, sunucu kaydına yazılır:

| | SABİTLİ kip (bugünkü) | İNTERNET kipi (yeni) |
|---|---|---|
| Hangi adres | IP adresi · tek etiketli ad (`sahinsrv`) · yerel adlar (`.local` `.lan` `.internal` `.home.arpa`) · izinli üst alan DIŞINDAKİ her ad | Yalnız izinli üst alanın altındaki ad (öneri: `*.etkiliyazilim.com`) |
| Güven | Sertifikanın SHA-256'sı; QR ya da insanın kod karşılaştırması | Android SİSTEM güven deposu zinciri + ad eşleşmesi + geçerlilik tarihi |
| Varsayılan port | 4443 | 443 |
| Ekleme ekranı | 64 haneli kod karşılaştırması | Kod yok; "İnternette doğrulandı: `<ad>` — `<firma adı>`. Eklensin mi?" onayı |
| Sunucu kimliği | `installationId` + iz | `installationId` kayda yazılır; sonradan farklı gelirse bağlanmaz, "sunucu değişti — yeniden ekleyin" |

**Kurallar:**
1. **Kip adresin BİÇİMİNDEN türer, seçilmez.** Kullanıcı, QR ya da sunucunun keşif yanıtı kipi seçemez. Aynı adres için iki kip yoktur ⇒ deneme-yanılma ve otomatik düşüş yolu yoktur.
2. **Düşüş yok.** Kip kayda yazılır; kip değişimi = "Sunucuyu kaldır" + yeniden ekleme (onaylı). İnternet kipinde zincir başarısızsa sabitli kipe ya da koda DÜŞÜLMEZ; sabitli kipte iz tutmazsa CA'ya sorulmaz (bugünkü RED).
3. **IP daima sabitli.** Bir sertifika yetkilisi (Let's Encrypt 2025'ten beri) genel IP için de sertifika verir; IP'yi internet kipine almak, IP'yi ele geçireni sunucu yapar.
4. **http asla** — iki kipte de (manifest + ağ güvenlik yapılandırması, §3).
5. **Kullanıcı ve kurumsal CA'lar HARİÇ** — yalnız sistem deposu, beyanlı (§3). Kurumsal TLS denetim vekili olan ağda bağlantı kurulamaz (fail-closed); çare vekilde alan adı istisnasıdır, tablette değil.
6. **Ara/kök sertifika sabitlemesi YOK.** Cloudflare yaprağı birden çok CA arasında ve kendi takvimiyle döndürür; ara sertifika sabitlemek bütün bulut tabletlerini aynı anda keser.

**Taslağa eleştiri (düzeltilenler):** (a) "Alan adı → genel CA" fazla geniş: vc60 sunucu adı kabul eder (M5), fabrikada iç DNS adı ya da makine adı yazan kullanıcının kendinden imzalı sunucusu internet kipinde KIRILIRDI ve otomatik geri düşüş de yasak ⇒ ölçüt "alan adı" değil "izinli üst alan". (b) "Kullanıcı CA'ları hariç" bugün zaten doğru (M3) ama varsayılana yaslanıyor ⇒ beyanlı hâle getirilir. (c) Port varsayılanı kipe bağlı olmalı (443/4443). (d) Native katman zaten genel CA'yı destekliyor (M1); asgari iş yalnız JS olabilirdi — ama hata sınıfı (saat/vekil/ad) ve beyanlı güven deposu native ister (§3).

## 3. Native değişiklik (neden yeni paket)

- **Ağ güvenlik yapılandırması (yalnız sürüm derlemesi):** taban: şifresiz kapalı, güven çapası yalnız `system`; kullanıcı çapası yok. ⚠️ Yapılandırma eklenince manifestteki `usesCleartextTraffic` yok sayılır → geliştirme derlemesinin Metro bağlantısı için ayrı (debug) yapılandırma gerekir. API 36'da platformun sertifika şeffaflığı (CT) desteği ölçülür; varsa açılır, yoksa kalan risk (§4).
- **`probeWebPki(host, port)`:** sistem doğrulamasını koşar, kimlik ucunu okur, hata SINIFINI döner (saat ileri/geri · güvenilmeyen CA (vekil) · ad tutmuyor · ağ). JS'in `fetch` hatası bunları ayırmaz; kullanıcıya "tablet saati yanlış" ile "ağınız bağlantıyı denetliyor" farklı söylenmeli.
- Native sabit katmanı (`LanTlsPolicy`) DEĞİŞMEZ: internet kipindeki uç zaten SİSTEM kararına düşer.
- ⇒ `runtimeVersion` 56.0 → **57.0**, **vc61**. Aynı kalsaydı 56.0 OTA'sı vc60'a `probeWebPki`siz JS gönderirdi. İnceleme için de yeni paket şart: incelemeci Play'den kurduğu paketin GÖMÜLÜ JS'ini görür, OTA'ya güvenilmez.

## 4. Tehdit modeli

| Tehdit | İnternet kipinde sonuç |
|---|---|
| LAN'da sahte DNS / ARP ile adı ele geçirme | **Engellenir:** saldırgan o ad için geçerli sertifika alamaz (CA alan doğrulamasını kendi noktalarından yapar, fabrikanın LAN'ından değil). Kalan risk bizim DNS/Cloudflare hesabımıza kayar → hesapta iki adımlı giriş, dar API belirteci, **CAA kaydı** (yalnız Cloudflare'in kullandığı CA'lar + Let's Encrypt; D1'de ölçülür) |
| Kurumsal TLS denetim vekili / MDM CA'sı | Kullanıcı deposundadır → güvenilmez → bağlantı kurulmaz, hata "ağınız bağlantıyı denetliyor; BT'den `*.etkiliyazilim.com` istisnası isteyin" |
| Tablet saati yanlış | Zincir tarihi denetlenir (sabitli kip denetlemez). Bağlantı kurulmaz, hata "tablet saati yanlış"; düşüş yok |
| Ele geçirilmiş / yanlış sertifika veren CA | Kalan risk (bankacılık uygulamalarıyla aynı). CAA yalnız dürüst CA'yı bağlar; CT varsa açılır. Ara sabitleme reddedildi (§2 k6) |
| Oltalama: operatör başka ad yazar | İzinli üst alan dışı ad internet kipine giremez; sabitli kipte kod ister |
| Düşüş (internet ↔ sabitli ↔ http) | Kip biçimden türer + kayda yazılır; http iki katmanda kapalı |
| Cloudflare kenarında TLS açılması (KVKK) | Bu tasarımın konusu değil (`BULUT-KURULUM.md` H3). Doğrudan kip (§7.1, Let's Encrypt) seçilirse tablet yolu AYNEN çalışır |

**Play "aktarımda şifreleme: Evet"** doğru kalır: iki kipte de bütün trafik TLS, şifresiz trafik kapalı.

## 5. QR, adres kaynağı, eski istemci

- **QR kipi TAŞIMAZ.** QR yalnız adresi (+ `installationId`) taşır; kip tablette adresten türer — kötü bir QR kip seçtiremez. İnternet kipindeki sunucunun QR'ında parmak izi alanı anlamsızdır (kenar sertifikası döner); panel QR'ına adres ekleme işi (`gece/qr-adres`) ile biçim birlikte kararlaştırılır: ayrı önek ya da iz alanı `-`. vc60 tanımadığı öneki reddeder ("şifreli bağlantı QR'ı değil") — güvenli.
- **Bulut kurulumunun alan adı:** tek kaynak kanal kaydı (`deploy/kanallar.json` bulut bloğu, T1: alt alan = kanal kodu) → `kur.mjs` DNS kaydını ve backend ortamını yazar. Tablete adı operatör yazar ya da panelin QR'ı verir. ⚠️ `BULUT-KURULUM.md` R11 ("tablette adres kanal kaydından gömülü") TEK ORTAK Play paketiyle çelişir (paket herkese aynı) → R11 "elle ya da panel QR'ı, değişiklik onaylı" diye düzeltilir (G5).
- **İzinli üst alan** tek kaynaktan gelir — kullanıcı kararı KA (2026-10-08): "koda sabit ama tek yerde" ⇒ `INTERNET_PARENT_DOMAINS` (`mobil/src/lib/internet-tls.ts`); bekçi (`internet-tls.test.ts`) `mobil/src` altında başka tırnaklı literal arar. Önceki öneri (`kanallar.json` → `app.config extra`) uygulanmadı: tek ortak pakette kanal kaydı tablete girmez.
- **G4 kararı (uygulandı):** QR v2 internet kipindeki adı TAŞIMAZ — tablet v2 adres listesindeki internet adını yoklamaz ve sabitlemez (`pairViaQrHosts`), QR + adres adımı da internet adını reddeder. Gerekli değil: internet kipindeki sunucu kod istemediği için adı yazmak yeterlidir; panel genel CA'lı adrese bağlıyken sabiti olmadığından QR zaten göstermez. Panel kodu değişmedi.
- **Eski vc60:** internet kipini bilmez; böyle bir adresi kullanmaz, "Sunucuyu ekle"ye döner (M6). Bulut/inceleme talimatı vc61+ yazar. vc61'e geçen tabletin vc60 sabitleri olduğu gibi geçerlidir (kayıtta kip yoksa = sabitli). Backend değişmez → "backend önce" sırası etkilenmez, `minVersion` değişmez.

## 6. Dilimler

| Dilim | İçerik | Doğrulama |
|---|---|---|
| G0 | Bu belge + kural/arşiv notu (gelen bağlantı istisnası) | `check-docs` |
| G1 | JS saf kararlar: `kipFor(host)` (IP/tek etiket/yerel ad/izinli üst alan), kayıt biçimi (`TlsPin` yanına internet kaydı; eski kayıt = sabitli), `secureAddressUsable` ve `parsePairAddress` port varsayılanı kipe göre, `installationId` değişim engeli; üst alan tek kaynağı | jest + negatif sonda (IP'yi internet kipine alan değişiklik → kırmızı) |
| G2 | Native: sürüm derlemesine ağ güvenlik yapılandırması (yalnız sistem çapası, şifresiz kapalı), debug'da Metro istisnası, `probeWebPki` hata sınıfı; `runtimeVersion` 57.0, vc61 | `jvm-check.mjs` · AAB'den yapılandırma ölçümü (`test_tablet_ortak_paket` / `play-dagitim.guard`: kullanıcı çapası → kırmızı) |
| G3 | Ekran: "Sunucuyu ekle" adres yolunda internet kipi onayı, hata metinleri (saat · vekil · ad · ağ), ayarlarda kip görünür | render testleri |
| G4 | Panel QR'ı internet kipindeki kurulumda adres taşır (`gece/qr-adres` ile birleşir) | Electron vitest + ikiz bekçisi |
| G5 | Kurallar: `kesif-cihaz.md` "yalnız şifreli ve sabitli" satırı → "yalnız şifreli; sabitli ya da izinli üst alanda internet kipi"; `BULUT-KURULUM.md` R2/R11 | `check-docs` |
| G6 | Gerçek tablet: inceleme kurulumu (Cloudflare arkasında) + bir LAN sunucusu aynı tablette; saat ileri alınarak ve kullanıcı CA'sı yüklenerek negatif deneme | elle, raporlu |

## 7. Kullanıcıya sorulacak kararlar

**KA — Tablet hangi adreslere "internet sertifikasıyla" (kodsuz) bağlansın?**
- a) **Yalnız bizim alan adımızın altındakilere (`….etkiliyazilim.com`)** — yanlış yazılan adla başka bir siteye parola gitmez; müşteri ileride kendi alan adını isterse o gün açılır ⭐ önerilen
- b) Her alan adına — esnek, ama yanlış ya da kötü niyetli bir ad yazılırsa kullanıcı adı/parola oraya gider; fabrika içindeki adlı sunucular da kod ekranını kaybeder

**KB — Play'e ilk gönderim hangi tablet sürümüyle?**
- a) **Yeni sürüm (vc61) hazır olunca; inceleme sunucusu Cloudflare arkasında** — geçici kurulum yok, tek seferlik iş ⭐ önerilen
- b) Şimdiki sürümü (vc60) hemen gönder; inceleme için geçici olarak Cloudflare'siz açık bir kapı kur, vc61 gelince kaldır — daha erken, ama iki kez kurulum ve iki kez Play talimatı
