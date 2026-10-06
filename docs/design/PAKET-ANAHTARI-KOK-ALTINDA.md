# PAKET anahtarı kökün altında — kök imzalı paket sertifikası, iptal, çift imzalı geçiş

> **Durum:** TASARIM + §8 kararları verildi (2026-10-06, arşiv notu `docs/history/arsiv/2026-10.md`); D1–D3 doğrulayıcıları `gece/paket-anahtar-d13` dalında, kural satırı D9'da. İş listesi maddesi 3.9 ([DEMOFABRIKA-KURULUM-BULGULARI.md](../plan/DEMOFABRIKA-KURULUM-BULGULARI.md), Faz 3).
> **Bağlayıcı karar (kullanıcı, 2026-10-05):** paket anahtarı kök imzalı sertifikayla ve kısa ömürlü (ör. 1 yıl) olur; kaybı ya da çalınması kökle yeni sertifika + iptalle kapanır; fabrikaya elle kurulum gerekmez; güncelleyici (Rust) zincirle doğrular; geçişte çift imza. Yedek anahtar ve parola bölme şimdilik YAPILMAZ; donanım anahtarı için bütçe yok.
> **Üst belgeler:** [LISANS-V2-CEVRIMDISI-KIRA.md](LISANS-V2-CEVRIMDISI-KIRA.md) (ara imzacı + iptal deseni, bu belge onu PAKET'e uygular) · [GUNCELLEYICI.md](GUNCELLEYICI.md) · kurallar [lisans.md](../kurallar/lisans.md) · tören [URETIM-SATICI-TOREN.md](../ops/URETIM-SATICI-TOREN.md).
> **Önkoşul:** iş listesi 1.2 (kök Mac'e iner, VDS'te durmaz). Kök VDS'teyken PAKET sertifikası basılmaz.

## 0. Özet

| Konu | Bugün | Hedef |
|---|---|---|
| Güven | `paket-2026` açık anahtarı derlemeye GÖMÜLÜ, süresiz | gömülü olan yalnız KÖK; PAKET anahtarı kök imzalı sertifikayla gelir |
| Ömür | yok (anahtar ömrü = derlemenin ömrü) | sertifika 1 yıl + 30 gün örtüşme |
| Kayıp / çalınma | yeni anahtar → yeni çapa → her doğrulayıcının yeni sürümü; eski güncelleyici eski anahtara sonsuza dek güvenir | kökle yeni sertifika + kök imzalı PAKET iptal belgesi; fabrikada elle iş yok |
| İptal belgesi | `tekserp-iptal` (yalnız ALT · İNDİRME · BAYİ · HAK) | AYRI belge `tekserp-paketiptal` (§2.4 — eski doğrulayıcıyı kırmamak için) |
| Geçiş | — | çift imza: eski dosyalar `paket-2026` ile aynen, yanında `-zincir` dosyaları; kesimde son çift imzalı sürüm "köprü sürüm" olarak donar |

**Ana seçim:** mevcut sertifika biçimi (`tekserp-sertifika`) yeni bir kullanım değeriyle (`PAKET`, kid öneki `pkt-`) aynen kullanılır; sertifika imzalı belgenin YÜKÜNDE gömülü taşınır (HAK'taki `imzaciSertifikasi` gibi — JWS başlığına alan eklenemez). İptal ayrı belge türüyle taşınır. Sahadaki eski güncelleyici eski dosyaları okumaya devam eder ve son çift imzalı "köprü sürüme" kadar kendiliğinden gelir, oradan kendini günceller.

## 1. Bugünkü durum (koddan)

### 1.1 PAKET anahtarı ne imzalar

| Belge | `typ` | İmzalayan araç (Mac) | Kaynak |
|---|---|---|---|
| Paket bütünlük listesi `butunluk.jws` (+ `butunluk-liste.txt`) | `tekserp-butunluk` | `Teks-Erp/scripts/build-korumali-imza.ts` (`zip` · `imzala`) | `Teks-Erp/src/lib/license/protocol/belgeler.ts:30-31`, dosya adı `Teks-Erp/src/lib/license/integrity-scope.ts:13` |
| Backend sürüm bildirimi (`son.json` ve `<sürüm>/surum.json` işaretçilerindeki JWS) | `tekserp-surum` | `Teks-Erp/scripts/backend-bildirim.ts imzala` | `belgeler.ts:34-35`; `tekserp-guncelleyici/src/release.rs:18,28` |
| PostgreSQL paketi künyesi `pg.json` | `tekserp-pg` | `backend-bildirim.ts pg-imzala` | `belgeler.ts:36-37`; `release.rs:19,30` |

Panel ve tablet güncelleme künyeleri PAKET anahtarıyla İMZALANMAZ: ayrı istemci anahtarı `panel-2026` (+ çevrimdışı yedek `panel-2026-2`) kullanılır (`Electron/electron/guncelleme/imza-capasi.json`, `mobil/src/lib/apk-imza-capasi.json`). 3.9'un kapsamı dışındadır (§8 soru 7).

### 1.2 Çapa (güven listesi)

- TS: `PRODUCTION_PACKAGE_PUBLIC_KEYS = [paket-2026]`, `STAGING_PACKAGE_PUBLIC_KEYS = [paket-hazirlik]` — `Teks-Erp/src/lib/license/integrity.ts:49-55`; kid biçimi `^paket-[a-z0-9-]{1,40}$` (`integrity.ts:70`); derlemenin kipi `integrity.ts:68`.
- Native: `tekserp-dogrulama/src/anchor.rs:20-40` aynı iki liste, `cfg(feature = "hazirlik-capasi")` ile ayrık; `builtin_package_keys()` `anchor.rs:53`. Birim testi PAKET listesinin BOŞ OLMADIĞINI ölçer (`anchor.rs:67`).
- Kökler ayrı listede: `Teks-Erp/src/lib/license/protocol/kok-anahtarlar.ts:23-38` (`kok-2026-1` bütün sınıflar · `hazirlik-2026-1` TEST/DEMO).
- Çapaya satır yalnız `Teks-Erp/scripts/guven-capasi-ekle.ts` ile girer, satır yalnız EKLENİR (`lisans.md` güven çapası satırı).
- Hazırlık PAKET anahtarının sınıf süzgeci kid önekinden: `integrity-scope.ts:44-54` (`paket-hazirlik*` yalnız TEST/DEMO), Rust aynası `tekserp-guncelleyici/src/trust.rs:71-75` + `policy.rs:80-83`.

### 1.3 PAKET imzası nerede doğrulanıyor — eksiksiz liste

| # | Doğrulayıcı | Ne doğrular | Anahtar kaynağı | Kaynak |
|---|---|---|---|---|
| V1 | Güncelleyici — aday sürüm | işaretçi (`son.json`, KATI `{v:1, bildirim}`) → `tekserp-surum` JWS | gömülü çapa, sınıfa göre süzülmüş | `engine.rs:561`, `engine.rs:753-756`, `release.rs:93-107` (KATI işaretçi `release.rs:104`), `release.rs:345-355` |
| V2 | Güncelleyici — açılan paket | `butunluk.jws` + liste; imzalayan kid = bildirimin `paketImzaKid`i | aynı süzgeç | `package.rs:86-93`, bağ `release.rs:374` |
| V3 | Güncelleyici — PG künyesi | `tekserp-pg` | aynı süzgeç | `release.rs:452-455` |
| V4 | Güncelleyici — kendini güncelleme | kurulu sürüm dizinindeki imzalı listeden yeni ikilinin özeti | aynı süzgeç | `engine.rs:445`, `selfupdate.rs:128-145`, `package.rs:142-144` |
| V5 | Güncelleyici CLI (setup.exe) | `kurulum-paket` · `kurulum-pg` · `kurulum-dizin` | gömülü çapa, SÜZGEÇSİZ | `kurulum.rs:200-206` |
| V6 | Backend — `.node` açılmadan önce | `butunluk.jws` + liste, native dosyanın özeti | derlemenin `PACKAGE_PUBLIC_KEYS`i | `Teks-Erp/src/lib/license/native.ts:178-213` |
| V7 | Native lisans çekirdeği | bütünlük (açılış · günlük · HAK kabulü) | gömülü çapa | `lisans-cekirdek/src/api.rs:319-340` |
| V8 | Backend — ikinci katman | aynı imzayı TS'te yeniden; hazırlık anahtarı ÜRETİM HAK'ında `BUTUNLUK_HAZIRLIK_ANAHTARI` | `PACKAGE_PUBLIC_KEYS` | `Teks-Erp/src/lib/license/integrity-check.ts:214,241` |
| V9 | Yayın araçları (Mac) | bildirim/PG künyesini kanalın kipinin çapasıyla doğrular | `packagePublicKeysFor(kip)` | `backend-bildirim.ts` (dogrula · pg-dogrula), `deploy/backend-yayinla.mjs:211,298`, `deploy/kurulum/kurulum-arsivi.mjs:363-373` |

Satıcı ve patron sunucusu PAKET imzası doğrulamaz (protokol aynaları var, çalışma anında çağrılmaz); satıcının yayın görünümü `son.json`ı İMZASIZ okur (`satici/sunucu/src/distribution/releases.view.ts:38-42`). Panel `LicenseIntegrityCard` imzalayan kid'i yalnız gösterir.

### 1.4 Var olan "kök imzalı alt sertifika" deseni

- Biçim: `tekserp-sertifika` JWS, yük `{v, sertifikaId, kullanim, kid, x, siniflar, baslangic, bitis, bayi}` — `belgeler.ts:324-342`; kullanımlar `ALT · INDIRME · BAYI · HAK`, kid önekleri `alt- · ind- · bayi- · ara-` (`belgeler.ts:47,324`; Rust `tekserp-dogrulama/src/schema.rs:19,497-510`).
- Doğrulama: `verifyCertificate` — kök tanınıyor mu, kullanım, iptal, sınıf kümesi kökün yetkisini aşmıyor, imza anı `[baslangic, bitis]` içinde (`anahtar-zinciri.ts:99-127`; Rust `chain.rs:149`).
- Gömme: HAK'ın yükünde `imzaciSertifikasi` + `verilis` (`anahtar-zinciri.ts:129-135,186`). JWS başlığında yalnız `alg · typ · kid` serbest (`tekserp-dogrulama/src/jws.rs:18`) — sertifika başlığa giremez, YÜKE girer.
- Ara imzacı anahtar dosyası: `satici/sunucu/scripts/anahtar.ts ara-uret` kök imzalı sertifika + kendi parolasıyla sarılı özel yarı (`<kid>.ara.json`); sarma tek uygulama `protocol/anahtar-sarma.ts` (PAKET aracı da aynısını kullanır).

### 1.5 İptal belgesi ve eski doğrulayıcının katılığı

- `tekserp-iptal`: yalnız kök imzalar, `sira` tekdüze artar, satırlar `{kid, sertifikaId, kullanim, tarih, neden}` (`belgeler.ts:345-366`).
- **Satırın `kullanim`ı KAPALI enum'dur** (TS `z.enum(CERT_USAGES)` `belgeler.ts:349`; Rust `schema.rs:548-560`, bir satır düşerse bütün belge düşer). Belgeye `PAKET` satırı eklenirse BUGÜNKÜ her doğrulayıcı belgenin TAMAMINI reddeder: eski iptal belgesinde donar (yeni ALT/ara iptalleri ulaşmaz) ve kiranın `iptalSira` pini yetişmediği için `IPTAL_BELGESI_KAYIP` → ÖLÇÜLEMEDİ → UYARI merdivenine düşer (`Teks-Erp/src/lib/license/state-rules-revocation.ts:25`). ⇒ PAKET iptali bu belgeye GİREMEZ (§2.4).
- Güncelleyici iptali `lisans\iptal.jws`ten okur, doğrulanamazsa yok sayar (`policy.rs:42-46`).
- Kira yanıtı şeması GEVŞEK (`LicenseResponseSchema = z.object`, `Teks-Erp/src/lib/license/protocol/uclar.ts:257`; iptal alanı `uclar.ts:268`): yeni isteğe bağlı alan eski fabrikada sessizce atılır.

### 1.6 Anahtarın kendisi

- Üretim PAKET anahtarı `~/.tekserp/satici-uretim/paket/paket-2026.paket.json`, parolalı (`lisans.md` "Üretim PAKET anahtarı" satırı). Tören runbook'unun dosya tablosu bir **"VDS anahtar birimi (ARA kopya, USB gelene dek)"** kopyasından söz eder (`URETIM-SATICI-TOREN.md` satır 16) — bugün orada durup durmadığı ÖLÇÜLMEDİ (§8 soru 5).
- Rotasyon bugün: yeni kid + çapa sürümü; "eski anahtarla imzalı paketler geçerli kalır" (runbook §6 satır 127). Yani çalınan `paket-2026` bütün kurulu doğrulayıcılarda süresiz geçerlidir.
- Hazırlık anahtarı `paket-hazirlik` parolasızdır.

## 2. Hedef zincir

### 2.1 Zincir

```
KÖK (kok-<yıl>-<n>, Mac'te, çevrimdışı)
  └─ PAKET sertifikası  tekserp-sertifika { kullanim: "PAKET", kid: "pkt-<yıl>-<n>", x, siniflar, baslangic, bitis }
       └─ paket belgeleri (yükte paketSertifikasi + imzaZamani; JWS kid = pkt-<yıl>-<n>)
            · bütünlük listesi   butunluk-zincir.jws   (typ tekserp-butunluk)
            · sürüm bildirimi    son-zincir.json / <sürüm>/surum-zincir.json  (typ tekserp-surum)
            · PG künyesi         pg-zincir.json        (typ tekserp-pg)
KÖK ── PAKET iptal belgesi  tekserp-paketiptal { sira, iptaller: [{kid, sertifikaId, tarih, neden}] }
```

- Hazırlık aynı zincirdir: `hazirlik-<yıl>-<n>` kökü `pkt-hazirlik-<yıl>-<n>` sertifikası basar; kip ayrımı KÖKTEN gelir (hazırlık derlemesinde üretim kökü yoktur, tersi de), kid öneki ikinci savunmadır.
- `typ` değerleri DEĞİŞMEZ: aynı belge türü, iki imza biçimi. Ayrım kid ailesindedir: `paket-*` kid'li belge gömülü çapayla doğrulanır ve sertifika TAŞIYAMAZ; `pkt-*` kid'li belge sertifika TAŞIMAK ZORUNDADIR ve sertifikanın `kid`i/`x`i JWS'nin kid'i/anahtarıdır.
- Sertifikanın sınıf kümesi kökün yetkisini aşamaz (mevcut `KOK_SINIF_YETKISIZ`). Bugünkü kid önekli sınıf süzgeci (`paket-hazirlik*` yalnız TEST/DEMO) sertifikanın `siniflar`ına taşınır: güncelleyici motorunda kurulumun sınıfı sertifikanın kümesinde olmalı (bilinmiyorsa RED — bugünkü "sınıf bilinmiyorsa DIŞARIDA" ile aynı); setup CLI'si (V5) bugün de süzgeçsizdir, öyle kalır.

### 2.2 Sertifika biçimi — mevcutla AYNI

- `CertificateSchema` aynen; `CERT_USAGES`a `PAKET`, `SUB_KID_PREFIX`e `PAKET: "pkt-"` eklenir (TS + Rust + satıcı/patron aynası). `bayi` alanı `null`.
- Neden `paket-` değil `pkt-`: `paket-*` bugünkü gömülü anahtarın ailesidir ve `release.rs:54`, `integrity.ts:70`, `isProductionPackageKid` bu aileyi "çapadan doğrula" diye okur. Ayrık önek, aynı kid'in iki yoldan da doğrulanabildiği bir ara durumu imkânsız kılar.
- Eski doğrulayıcı için risk YOK: `PAKET` kullanımlı sertifikayı hiçbir eski kod okumaz (yalnız `-zincir` dosyalarında ve yeni iptal belgesinde durur).

### 2.3 Ömür ve zaman

- Sertifika: **395 gün** (1 yıl + 30 gün örtüşme; kullanıcı "ör. 1 yıl"). Yeni sertifika eskisinin bitişinden ≥ 30 gün önce basılır; satıcı uyarısı 60/30/15/7/1 gün kala (dönem töreni uyarısıyla aynı kanal).
- Belgeye imzalı **`imzaZamani`** girer (HAK'taki `verilis` karşılığı). Sertifika `imzaZamani` anında geçerli olmalı.
- Doğrulamanın İKİ KİPİ vardır, çünkü bir paket hem "dışarıdan gelen yeni şey" hem "kurulu duran şey" olabilir:

| Kip | Nerede | Zaman ölçütü | İptal |
|---|---|---|---|
| **KABUL** — dışarıdan gelen yeni belge | V1 aday · V2 indirilen paket · V3 PG künyesi · V5 setup CLI (`kurulum-dizin` hariç: YERLEŞİK, KARAR 2026-10-06) | `imzaZamani ∈ [baslangic, bitis]` VE `şimdi ≤ bitis + kabul toleransı (180 gün)`; `şimdi` = max(sistem saati, elde doğrulanmış kiranın `verilis`i) | iptalli sertifika RED |
| **YERLEŞİK** — zaten kabul edilip kurulmuş dizin | V4 kendini güncelleme · kurulu sürüm dizinine geri dönüş · V6 · V7 · V8 | yalnız `imzaZamani ∈ [baslangic, bitis]` (kurulu paket sertifika bitince ÖLMEZ) | uyarı (§8 soru 3; KARAR 2026-10-06) |

- Kabul toleransı **180 gün** (KARAR 2026-10-06, §8 soru 2; önceki öneri 90 gündü): internetsiz fabrikaya USB ile geç gelen paketin, sertifikası yeni bitmiş diye reddedilmemesi için. Toleransın amacı süreyi uzatmak değil, yıllık törenle aynı gün basılmış paketlerin USB gecikmesini karşılamaktır; çalınan anahtarın ömrünü üst sınırlayan değer `bitis + tolerans`tır.
- `imzaZamani` imzalayanın beyanıdır: çalınan anahtar geçmiş tarih yazabilir. Bu yüzden KABUL kipinde `şimdi` ölçütü ZORUNLUDUR; YERLEŞİK kipte zaman yalnız tutarlılık denetimidir (güvenlik kapısı değildir — kurulu paketi zaten KABUL kipi süzdü).
- Neden YERLEŞİK kipte iptal sert değil: çalışma anı bütünlük denetimini paketin KENDİ kodu yapar (V6–V8 paketin içindedir). Kötü niyetli ama geçerli imzalı bir paket kendi denetimini atlayabilir; bu denetim yalnız kurulumdan SONRA dosyaya dokunulmasına karşı korur. Gerçek kapı, paketten ÖNCE kurulu olan güncelleyicidir (KABUL). Kurulu meşru paketleri iptal yüzünden GEÇERSİZ'e düşürmek, güvenlik kazancı olmadan bütün filoyu 30 günlük ek süre merdivenine sokar.

### 2.4 PAKET iptal belgesi ve taşınması

- **Ayrı belge türü** `tekserp-paketiptal` (yeni `typ`; adda tire YOK — JWS `typ` deseni `^tekserp-[a-z]+$` tireyi kabul etmez, D1'de böyle uygulandı), yalnız KÖK imzalar, kendi tekdüze `sira`sı, satır `{kid (pkt-*), sertifikaId, tarih, neden}`, en çok 256 satır. Gerekçe §1.5: mevcut `tekserp-iptal`e yeni kullanım eklemek sahadaki her doğrulayıcıyı iptal belgesinden koparır. Kod paylaşımı: şema ve `pickNewer…` mantığı iptal belgesinin aynısıdır, yalnız tür ve satır kullanımı sabittir.
- Fabrikada tek dosya: `lisans\paket-iptal.jws` (backend'in iptal deposu yazar, en yüksek `sira` kazanır, düşük olan yok sayılır — mevcut iptal kuralıyla aynı).
- **Üç taşıma yolu**, hepsi kendini doğrular (kök imzalı) ve "en yüksek `sira`" kuralıyla birleşir:
  1. **Kira yanıtı** — `LicenseResponse`a isteğe bağlı `paketIptal` alanı; satıcı yalnız `paket-zinciri` yeteneğini bildiren kuruluma gönderir (şema gevşek olduğu için eski fabrika zaten atar; yetenek kapısı yine de beyan içindir).
  2. **Paketin içi** — her yeni paket kökünde o anki en yeni `paket-iptal.jws` (bütünlük kapsamı dışında; kök imzası onu korur). Güncelleyici KABUL kipinde elindekiyle paketin getirdiğinden yükseğini kullanır ve yükseği `lisans\` altına yazar.
  3. **Çevrimdışı kira yolu** — elle taşınan kira yanıtı canlı yanıtla AYNI kabul boğazından ve şemadan geçer (`Teks-Erp/src/services/license-sync.service.ts:161-171`, `iptal` alanı dahil); `paketIptal` oraya ek iş olmadan gelir.
- Lisans çevrimdışı kuralıyla ilişki: internet kesintisi hiçbir şeyi kısaltmaz. İnternetsiz fabrika iptali ancak yeni bir paketle ya da çevrimdışı kirayla öğrenir; o arada onu koruyan sertifika ömrüdür (`bitis + tolerans`). Bu, ara imzacıdaki "iptal kirayla yayılır" kabulünün PAKET karşılığıdır.
- Kiraya ayrı bir `paketIptalSira` pini KONMAZ: iptal YERLEŞİK kipte zaten sert değildir; pin yalnız kira şemasına yeni zorunlu kural getirirdi.

### 2.5 Anahtar dosyası

- Özel yarı bugünkü gibi PAKET aracında, paket parolasıyla sarılı (`build-korumali-imza.ts anahtar-uret --kid=pkt-<yıl>-<n>`); kök parolası PAKET aracına HİÇ gitmez (bugünkü kural korunur).
- Sertifikayı kök basar (satıcı `anahtar.ts`, kök parolası), PAKET aracı açık sertifikayı anahtar dosyasına ekler (`sertifika-ekle`: sertifikanın `x`i dosyanınkiyle aynı değilse RED, parola istemez). İmza araçları sertifikayı dosyadan okur ve her belgeye gömer.
- Anahtar yalnız Mac'te durur; VDS'te hiçbir PAKET özel yarısı bulunmaz.

## 3. Doğrulayıcı değişiklikleri

### 3.1 Ortak çekirdek (`tekserp-dogrulama` + TS protokol)

- `verify_package_certificate(cert_token, roots, at_ms, paket_iptal)` — mevcut `verify_certificate`in `PAKET` kullanımıyla çağrılması + paket iptaline bakış.
- `verify_chained(token, typ, roots, kip, sinif, paket_iptal, simdi)` → `(yük, imzalayan sertifika)`: JWS ayrıştır → kid `pkt-*` mı → yükten `paketSertifikasi` → sertifikayı doğrula (KABUL/YERLEŞİK zaman kuralı §2.3) → JWS'yi sertifikanın anahtarıyla doğrula → `imzaZamani` penceresi → sınıf.
- Bütünlük (`integrity::verify`), sürüm bildirimi ve PG künyesi doğrulayıcıları anahtar listesi yerine bir **anahtar çözücüsü** alır: `paket-*` → gömülü çapa (geçiş süresince), `pkt-*` → zincir. Çapa listesi boş olabilir (kesimden sonra).
- `paket-iptal` şeması + doğrulayıcısı + `pick_newer`.
- TS ikizleri (`protocol/anahtar-zinciri.ts`, `integrity.ts`, `guncelleme.ts`, `guncelleme-pg.ts`) aynı sırayla; kâhin vektörleri iki kipte.

### 3.2 Rust güncelleyici (`tekserp-guncelleyici`)

- **İşaretçi sırası (V1):** önce `son-zincir.json` (ya da hedef sürümde `<sürüm>/surum-zincir.json`) okunur; YOKSA ve bu derleme hâlâ gömülü `paket-*` anahtarı taşıyorsa eski `son.json`a düşülür. Eski dosyanın KATI biçimi (`release.rs:104`) aynen kalır; yeni işaretçi ayrı dosyadır, eski dosyaya alan EKLENMEZ.
- **Paket (V2):** açılan pakette `butunluk-zincir.jws` varsa o, yoksa (geçiş) `butunluk.jws`; bildirimin imzalayanı ile listenin imzalayanı AYNI sertifika (bugünkü `paketImzaKid` bağı, `release.rs:374`, sertifika kimliğine genişler).
- **PG (V3):** `pg-zincir.json` önce, aynı düşüş kuralı.
- **Kendini güncelleme (V4) ve sürüm dizinleri:** YERLEŞİK kip. Kendini güncelleme kip değiştirmez kuralı aynen.
- **Setup CLI (V5):** KABUL kipi, `şimdi` = sistem saati (kira yok); iptal yalnız paketin getirdiğinden.
  - **KARAR (2026-10-06, 1e):** `kurulum-paket` ve `kurulum-pg` KABUL kalır; `kurulum-dizin` YERLEŞİK kipindedir — onarım komutu yeni belge kabul etmez, kurulu dizini yeniden ölçer (V4 ile aynı ölçü; süresi geçmiş ya da sonradan iptal edilmiş sertifikalı kurulu paket onarımda düşmez).
- **İptal:** `policy.rs` `lisans\paket-iptal.jws`i `iptal.jws` gibi yükler; KABUL kipinde paketin getirdiğiyle birleştirir.
- **Yetenek bildirimi:** güncelleyicinin künyesi/durum dosyası `paketZinciri: true` taşır; backend `paket-zinciri` yeteneğini YALNIZ güncelleyici bunu bildiriyorsa yoklamaya koyar (satıcının filo ekranı kesim kararını buna bakarak verir).
- **Durum kodları:** `PAKET_SERTIFIKA_ZAMAN` · `PAKET_SERTIFIKA_IPTAL` · `PAKET_SERTIFIKA_SINIF` · `PAKET_SERTIFIKA_YOK` (Türkçe mesajlı, panel güncelleme ekranında görünür).

### 3.3 Backend ve native çekirdek

- V6 (`native.ts` dlopen öncesi), V7 (`api.rs` `verify_integrity`), V8 (`integrity-check.ts`): `butunluk-zincir.jws` varsa YERLEŞİK kipte zincirle; yoksa gömülü çapayla (kesime dek). Gömülü kökler zaten her iki ikilide var (`builtin_roots`).
- İptalli sertifika YERLEŞİK kipte `GECERLI` + uyarı satırı (`BUTUNLUK_SERTIFIKA_IPTAL`, panel bandı: "Program yeniden imzalı bir sürüme güncellenmeli"); `imzaZamani` pencere dışı ya da sertifika kökle doğrulanmıyor → `GECERSIZ` (bugünkü 30 gün EK_SURE merdiveni).
- `BUTUNLUK_HAZIRLIK_ANAHTARI` kuralı sertifikanın `siniflar`ından türer (`integrity-check.ts:241` kid önekine bakmayı bırakır).
- Kira yanıtındaki `paketIptal` → iptal deposu → `lisans\paket-iptal.jws`.
- Panel: `LicenseIntegrityCard` imzalayanı "pkt-2027-1 (kök kok-2026-1, bitiş …)" diye gösterir; yeni alan isteğe bağlıdır, eski panel kid'i düz metin olarak gösterir.

### 3.4 Satıcı ve dağıtım altyapısı

- PAKET iptal belgesi defteri (ekleme-yalnız; `IptalBelgesi` modeline `tur` kolonu ya da ayrı model — dilimde karar, migration reçetesiyle) + `donem-ice-aktar`ın onu da alması + kira yanıtına `paketIptal`.
- Filo ekranına "paket zinciri" sütunu (yetenek); kesim kararının ölçüsü.
- `ANAHTAR_SURESI_BITIYOR` uyarısına PAKET sertifikası (satıcı açık sertifikayı tören paketinden alır; özel yarı VDS'e gitmez).
- Yayın görünümü (`releases.view.ts`) `son-zincir.json`ı da okur.
- İndirme kapısı (CF Worker): `DEGISKEN_DOSYA` deseni (`deploy/guncelleme-sunucusu/worker/indirme-kapisi.js:284`) yeni işaretçileri kenarda önbelleklememek için genişler — atlanırsa yeni güncelleyici bayat işaretçi okur.

## 4. Geçiş — çift imza ve "eski istemci ne yapar"

### 4.1 Evreler

| Evre | Ne yayınlanır | Gömülü çapa (yeni derlemede) |
|---|---|---|
| **G0 — doğrulayıcı inişi** | Yalnız `paket-2026` imzası (bugünkü dosyalar). Pakette zincir doğrulayıcılı yeni güncelleyici + backend. | kökler + `paket-2026` |
| **G1 — çift imza** | Her sürümde İKİ takım: eski (`butunluk.jws` · `son.json` · `surum.json` · `pg.json`, `paket-2026`) ve zincir (`butunluk-zincir.jws` · `son-zincir.json` · `surum-zincir.json` · `pg-zincir.json`, `pkt-2027-1`). Aynı zip, aynı dosyalar; yalnız imza dosyaları iki tane. | kökler + `paket-2026` |
| **G2 — kesim** | Son çift imzalı sürüm **KÖPRÜ SÜRÜM** ilan edilir: `son.json` onda DONAR (yayın aracı bir daha yazmaz), köprü sürümün dosyaları ve PG künyesi kalıcı tutulur. Sonraki sürümler yalnız zincirle. `paket-2026` özel yarısı imha edilir (Mac + şifreli kopyalar). | kökler + `paket-2026` |
| **G3 — çapadan çıkarma** | Gömülü PAKET listesi boşaltılan sürüm (çapa betiğine "çıkar" komutu; anahtar listesi boş olabilir). | yalnız kökler |

G0 → G1 arası en az bir sürüm geçer ki G1'in ilk zincirli paketini indiren güncelleyici onu okuyabilsin. G1 → G2 kullanıcı kararıyla (§8 soru 4).

### 4.2 Eski istemci ne yapar (sözleşme kıran değişiklik değerlendirmesi)

| İstemci | G1'de | G2'den sonra |
|---|---|---|
| Bugünkü güncelleyici (yalnız `paket-2026`) | `son.json`ı okur, eski imzalı paketi kurar, paketteki yeni ikiliye kendini günceller (V4 eski `butunluk.jws` ile). Zincir dosyalarını hiç görmez — `-zincir` adları ne işaretçi yoluna ne bütünlük kapsamına girer (`integrity-scope.ts:21-38`). | `son.json` köprü sürümü gösterir: köprüyü kurar, kendini günceller, sonra zincirle devam eder. **Elle iş yok.** Kiradaki kanal güncel sürümü köprüden yeniyse "sunucu geride" uyarısı görünür (karar değişmez, `engine.rs` DAGK-9) — köprüye gelince kalkar. |
| Bugünkü backend | Kendi paketini kendi çapasıyla doğrular; yeni paketi ASLA doğrulamaz (her paket kendi doğrulayıcısını getirir). | aynı |
| Bugünkü native çekirdek | aynı (paketin içinde) | aynı |
| Eski kurulumlar (pm2 + `kur.ps1`, güncelleyicisiz) | Yeni kod yazılmaz (`lisans.md` v1 kuralı); paketi biz taşırız, açılan yeni backend zinciri kendisi doğrular. | aynı |
| Eski satıcı (fabrika yeni) | `paketIptal` gelmez → güncelleyici yalnız paketin getirdiği iptali kullanır. Satıcı fabrikadan ÖNCE dağıtılır. | — |
| Eski panel | İmzalayan kid'i düz metin gösterir. | aynı |
| Eski setup.exe (kurulum arşivinde) | Eski ikili eski `butunluk.jws`/`pg.json` ile kurar. | Yalnız zincirli zip'le eski setup ÇALIŞMAZ ⇒ kurulum arşivi aracı (`kurulum-arsivi.mjs`) setup'ın güncelleyicisinin zincir yeteneğini künyesinden ölçer, yoksa DUR. Setup her sürümde yeniden derlendiği için sahaya etkisi yok. |
| Hazırlık kipi | Hazırlık satıcısı fabrikasızdır (iş listesi 3.8) — sahada hazırlık kipli kurulum yoksa (D0'da ölçülür) hazırlık doğrudan G2'den başlar, çift imza gerekmez. | — |

### 4.3 Kabul edilen riskler (açıkça)

- G2'den ÖNCE çalınan `paket-2026`, güncellemeyen eski güncelleyicilerde geçerli kalır; bunu yalnız güncellemek kapatır. Bu yüzden G0 hızlı çıkar ve kesim ölçüyle yapılır.
- `paket-2026` G0'dan önce KAYBOLURSA köprü imzalanamaz: o anki fabrikalar bugünkü gibi elle güncellenir. G0 bu pencereyi kapatır.
- Taze kurulumda (kira yok) güncelleyici yalnız sistem saatine ve paketin getirdiği iptale güvenir; sahte setup dosyasına karşı koruma bu tasarımın dışındadır (kurulum dosyası imzası bütçe kararı).
- Yerel yönetici saati geri alarak bitmiş sertifikalı paketi KABUL ettirebilir; yerel yönetici zaten makinenin sahibidir (`şimdi`nin alt sınırı elde doğrulanmış kiranın `verilis`i olduğu için kira tazeyse bu da kapanır).

## 5. Tören adımları

- **Ön koşul (iş listesi 1.2):** kök Mac'te, VDS'te yok. PAKET sertifikası ve PAKET iptal belgesi YALNIZ Mac'te, kök parolasıyla basılır; VDS'e yalnız AÇIK belgeler gider (sertifika, iptal belgesi). 1.2 töreninde 3.9 için yapılacak tek iş: VDS anahtar biriminde PAKET özel yarısı kopyası olup olmadığının ölçülmesi ve varsa kaldırılması (§8 soru 5).
- **Yıllık PAKET adımı** — YILLIK dönem töreninin parçasıdır (KARAR 2026-10-06, §8 soru 8: bütün anahtar yenilemeleri yılda bir törende; `uretim-toren.mjs donem --paket`), kök parolası bir kez:
  1. PAKET aracı yeni anahtarı üretir (`anahtar-uret --kid=pkt-<yıl>-<n>`), **paket parolasını kendisi sorar** (kökten FARKLI).
  2. `anahtar.ts paket-sertifika-uret --x=<x> --kid=pkt-<yıl>-<n> --kok=<kök> --gun=395` — kök parolası stdin'den; çıktı açık `<kid>.sertifika.json`.
  3. PAKET aracı `sertifika-ekle` — sertifika anahtar dosyasına girer (`x` eşleşmesi).
  4. Künye: kid · açık anahtar · sertifika penceresi · özetler (`DONEM-KUNYE.json`).
  5. **Yayındaki her kanalın/grubun son sürümünü ve etkin PG künyelerini yeni sertifikayla yeniden imzala** (paket parolası) — eski sertifika `bitis + tolerans` geçince taze kurulum ve USB ile geç gelen paket bunlara dayanır. Aynı sürüm yeniden imzalandığında kurulu fabrika yeniden kurmaz (sürüm aynı).
  6. VDS'e açık sertifika (süre uyarısı için).
- **Kayıp / çalınma:** aynı adımlar `--iptal=pkt-<…>` ile; kök `tekserp-paketiptal`i bir sıra artırarak basar → satıcıya içe aktarılır (kira yanıtıyla yayılır) → yeniden imzalanan sürümler iptali içlerinde taşır. Kurulu fabrikada elle iş YOK.
- **Paket parolası unutuldu:** sertifika iptal edilmez (anahtar çalınmadı), yalnız yeni anahtar + sertifika basılır; eskisi süresiyle söner.
- Hazırlık ortamı aynı adımları hazırlık köküyle provalar.

## 6. Bekçiler

| Bekçi | Ölçtüğü | Negatif sonda |
|---|---|---|
| `test_lisans_protokol` (genişler) | PAKET sertifikası vektörleri: geçerli · kullanım yanlış · sınıf kökü aşıyor · imza anı dışı · iptalli · `pkt-` olmayan kid · `paket-*` kid'li belgede sertifika | her vektörün ters hâli kırmızı |
| `test_lisans_native_kahin` (genişler) | TS ↔ Rust birebir: zincirli bütünlük, bildirim, PG künyesi, `paket-iptal`; iki çapa kipinde (öteki kipin kökünden sertifika `KOK_BILINMIYOR`) | kipi çevirince kırmızı |
| `tekserp-guncelleyici/tests/paket_zinciri.rs` (yeni) | KABUL/YERLEŞİK zaman kuralı, tolerans sınırı, elde + paketteki iptalin birleşmesi, işaretçi sırası ve düşüş yalnız gömülü `paket-*` varken, kendini güncelleme YERLEŞİK, setup CLI | tolerans +1 gün kırmızı |
| `tekserp-guncelleyici/tests/capa_kipi.rs` (genişler) | öteki kipin kökünden PAKET sertifikası RED | — |
| **Eski güncelleyici aynası** (yeni) | yayın aracının G1 çıktısı (`son.json`, `butunluk.jws`, `pg.json`) bugünkü doğrulayıcının DONDURULMUŞ kopyasıyla (KATI işaretçi + yalnız `paket-2026`) geçer; `-zincir` dosyaları bütünlük kapsamına girmez | `son.json`a alan eklenince kırmızı |
| `test_iptal_belgesi` (satıcı, genişler) | `tekserp-iptal`e `PAKET` satırı GİREMEZ (araç RED); `tekserp-paketiptal` sıra kuralı | — |
| `test_lisans_butunluk` (genişler) | YERLEŞİK kip: iptal → GEÇERLİ + uyarı; pencere dışı → GEÇERSİZ; sınıf süzgeci sertifikadan | — |
| `test_paket_kapsami` (genişler) | `butunluk-zincir.jws` ve `paket-iptal.jws` paket kökünde, kapsam dışında; FAZLA sayımı değişmez | — |
| `test_lisans_paket_anahtari` (genişler) | `sertifika-ekle` `x` uyuşmazlığı RED; kök parolası PAKET aracına gitmez | — |
| `test_uretim_toren` (genişler) | `donem --paket` adımı, hepsi-ya-da-hiçbiri, VDS paketinde PAKET özel yarısı YOK | özel yarı konunca kırmızı |
| `test_backend_yayin` (genişler) | G1'de iki takım birlikte ya da hiç; G2 sonrası `son.json`a yazım RED (köprü donması) | — |
| Worker birim testi | yeni işaretçi adları `DEGISKEN_DOSYA`da | — |
| `test_guven_capasi_ekle` (genişler) | G3 "çıkar" komutu yalnız PAKET listesinde, kökten asla | — |

## 7. Dilimler (sıralı)

| # | İş | Bağımlılık | Model önerisi |
|---|---|---|---|
| D0 | Ölçüm + kullanıcı kararları (§8): sahadaki güncelleyicili kurulumlar ve sürümleri, hazırlık kipli kurulum var mı, VDS'te PAKET kopyası var mı (kullanıcıyla). Kod yok. | 1.2 ile aynı oturum olabilir | Opus, orta efor |
| D1 | Protokol: `PAKET` kullanımı, `pkt-` öneki, `imzaZamani` + `paketSertifikasi` alanları, `tekserp-paketiptal`, zincirli doğrulayıcılar (TS + `tekserp-dogrulama`) + kâhin vektörleri | — | Opus, yüksek efor |
| D2 | Rust güncelleyici: KABUL/YERLEŞİK, işaretçi sırası, iptal birleştirme, yetenek künyesi, durum kodları, `paket_zinciri.rs` + eski güncelleyici aynası | D1 | Opus, yüksek efor |
| D3 | Backend + native çekirdek: V6–V8 zincirle, iptal deposu, `paket-zinciri` yeteneği, panel kartı etiketi | D1 | Opus, yüksek efor |
| D4 | Satıcı: PAKET iptal defteri (migration reçetesi), içe aktarma, kira yanıtında `paketIptal`, filo sütunu, süre uyarısı | D1; fabrikadan ÖNCE dağıtılır | Opus, orta efor |
| D5 | Araçlar: PAKET aracı `sertifika-ekle`, `anahtar.ts paket-sertifika-uret` + `paket-iptal-uret`, imza araçlarının çift çıktısı, yayın aracının iki takım + köprü donması, kurulum arşivi kapısı, Worker deseni, yayın görünümü | D1–D4 | Opus, orta efor |
| D6 | Tören: `donem --paket`, runbook bölümü | D5 | Opus, orta efor |
| D7 | Prova (hazırlık kökü, thinkpad): bugünkü güncelleyici ikilisi → G0 sürümü → G1 çift imzalı → kendini güncelleme → zincirle devam; iptal senaryosu; USB ile geç gelen paket (tolerans içi/dışı) | D1–D6 | Opus, orta efor |
| D8 | G0 üretim yayını (yalnız doğrulayıcılar), sonra ilk gerçek PAKET sertifikası töreni (kullanıcıyla, Mac) ve G1 başlangıcı | D7 + 1.2 | Opus, orta efor |
| D9 | G2 kesim (kullanıcı onayıyla, filo ölçüsüyle) + `paket-2026` imhası; G3 çapadan çıkarma sürümü; kural satırları + arşiv notu | D8 | Opus, orta efor |

Her dilimde yalnız o dilimin bekçileri koşulur; D9 sonunda tam koşum.

## 8. Açık kararlar — kullanıcıya sorulacak (sade dille)

1. **Sertifika süresi:** programı imzalayan anahtarın "kimlik belgesi" 1 yıl + 1 ay geçerli olsun, her yıl yenisi çıkarılsın — uygun mu?
   **KARAR (2026-10-06): evet — sertifika 1 yıl + 1 ay (395 gün), her yıl yenisi basılır.**
2. **İnternetsiz fabrikaya geç gelen paket:** bir güncelleme USB ile birkaç ay sonra götürülürse, imzanın belgesi süresi bittikten sonra kaç gün daha kurulabilsin? Öneri **90 gün**. Sayı küçüldükçe çalınma riski azalır, eski USB paketi reddedilme ihtimali artar.
   **KARAR (2026-10-06): 180 gün — sertifika bitiminden sonra 180 gün daha kurulabilir (KABUL toleransı 180 gün; §2.3'teki 90 günlük öneri GEÇERSİZ).**
3. **Anahtar çalındığında zaten çalışan fabrikalar:** iptalden sonra kurulu programda yalnız uyarı mı çıksın (öneri), yoksa fabrika 30 günlük ek süreye girip yeni sürüme zorlansın mı? Öneri uyarı, çünkü asıl kapı yeni paketi kurmadan önce bakan güncelleyicidir.
   **KARAR (2026-10-06): yalnız uyarı — kurulu programda iptal YERLEŞİK kipte GEÇERLİ + uyarıdır; sert kapı yeni paketi kurmadan önce bakan güncelleyicidir.**
4. **Eski anahtarla imzalamayı ne zaman bırakalım:** bütün fabrikalar yeni güncelleyiciye geçtiği portaldaki listede görülünce mi (öneri), yoksa sabit bir tarihte mi? Geçmeyen bir fabrika olursa o tarihten sonra da elle iş gerekmez; son eski imzalı sürüme kendiliğinden gelir ve oradan devam eder.
   **KARAR (2026-10-06): bütün fabrikalar yeni güncelleyiciye geçtiği portal listesinde görülünce bırakılır (sabit tarih yok).**
5. **Eski paket anahtarının kopyası:** tören belgesi, eski paket anahtarının USB gelene dek VDS'te de bir kopyası olduğunu yazıyor. Bugün orada duruyor mu, birlikte bakıp 1.2 töreninde silelim mi?
   **KARAR (2026-10-06): VDS'te eski paket anahtarının kopyası YOK (2026-10-05 ölçüldü); 1.2 töreninde silinecek bir şey kalmadı.**
6. **Sıra:** 3.9'un kodu tek ortak paketten (3.1) ve yeni indirme adresinden (3.2) önce mi insin? Öneri: doğrulayıcılar (D1–D3) 3.1'den ÖNCE iner; yeni adres baştan yalnız yeni düzenle açılır, çift imza yalnız eski adreste yaşar.
   **KARAR (2026-10-06): evet — doğrulayıcılar (D1–D3) 3.1'den ÖNCE iner; yeni adres baştan yalnız yeni düzenle açılır, çift imza yalnız eski adreste yaşar.**
7. **Panel ve tablet:** panel ile tablet güncellemelerini imzalayan ayrı anahtar da (bugün iki tane, biri yedek) ileride aynı "kökün altında, süreli" düzene alınsın mı? Öneri evet, ama ayrı iş olarak.
   **KARAR (2026-10-06): evet, ama AYRI iş — panel/tablet imza anahtarları aynı düzene ayrı dilimde alınır; 3.9'un kapsamı dışında kalır.**  Tasarım: [ISTEMCI-ANAHTARI-KOK-ALTINDA.md](ISTEMCI-ANAHTARI-KOK-ALTINDA.md).
8. **Yıllık tören günü:** yıllık paket belgesi yenilemesi üç ayda bir yapılan anahtar töreninin birine eklensin mi (ana parola bir kez yazılır)? Öneri evet.
   **KARAR (2026-10-06): evet, daha da ileri — kullanıcı aynı gece bütün anahtar yenilemelerini YILDA BİR dönem töreninde topladı (ara imzacı/ALT/İNDİRME de 1 yıla çıkıyor; o ayrı işte kodlanıyor). Yıllık PAKET adımı bu tek yıllık törenin parçasıdır, ana parola bir kez yazılır.**
