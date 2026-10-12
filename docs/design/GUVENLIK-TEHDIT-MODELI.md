# Güvenlik tehdit modeli ve fazlı koruma planı

> **Durum: PLAN — kod yok.** Tarih 2026-10-11 · ölçüm tabanı `origin/main` @ `59417f2e6` + yerel `postgres:16-bookworm` imajı.
> Kullanıcı kararları (2026-10-11) §2'de aynen işlidir; karar notu `docs/history/arsiv/2026-10.md` (2026-10-11, "Güvenlik tehdit modeli" başlığı). Kural satırları `docs/kurallar/lisans.md` ve `docs/kurallar/superadmin.md`de "(hedef — GUVENLIK-TEHDIT-MODELI G<n>)" işaretiyle durur; faz inince işaret düşer.
> İşaretler: **[ÖLÇÜLDÜ]** bu turda dosya/komutla doğrulandı · **[VARSAYIM]** ölçülmedi, fazın ilk işi doğrulamaktır.
> Üstüne kurulduğu belgeler (tekrar edilmez): `docs/design/LISANS-KOD-KORUMA.md` · `docs/design/KOD-KORUMA-OLCUM.md` · `docs/design/LISANS-NATIVE-CEKIRDEK.md` · `docs/design/LISANS-V2-CEVRIMDISI-KIRA.md` · `docs/design/LAN-TLS.md`.

---

## 0. Özet

- **Korunan iki şey:** (A) DB'ye giren biri kendini süperadmin yapamaz; programa özel varlıklar (imza anahtarları, kod, şablon/katalog mantığı) çalınamaz — ama müşterinin **kendi iş verisi müşterinindir** (okuma + dışa aktarma hakkı, sektör standardı). (B) Kaynak kod çalınmaz; çalınsa da başka makinede **lisanssız ayağa kalkmaz**.
- **Bugünkü en büyük iki açık [ÖLÇÜLDÜ]:** (1) etkinleştirilmemiş kurulum "gözlem" kipinde süresiz ve tam çalışır (`DEFAULT_LICENSE_MODE = "gozlem"`, `Teks-Erp/src/lib/license/runtime.ts`; merdiven yalnız `snap.activated` iken sürer) — çalınan paket/imaj her makinede açılır; (2) süperadmin düz bir DB kolonudur (`User.isSystemAccount`), DB'ye yazan biri kendini yükseltir ve Docker kurulumunda uygulamanın DB kullanıcısı zaten PostgreSQL süper kullanıcısıdır.
- **Dürüst sınır:** müşteri sunucusunda root müşteridir. Kendi makinesindeki dosyayı ve belleği ondan %100 saklayamayız. Her koruma aşağıdaki üç sınıftan birine konur ve bu belge hangisi olduğunu her satırda söyler.

| Sınıf | Anlamı |
|---|---|
| **E — ENGELLE** | Saldırgan hedefe ulaşamaz: anahtar onun makinesinde hiç yoktur ya da iş bizim imzamız olmadan yapılamaz. |
| **T — TESPİT ET** | Yapabilir ama iz kalır ve bize ulaşır (internetle yoklamada, internetsiz kurulumda yenileme zarfında). |
| **P — PAHALILAŞTIR** | Yapabilir ama uzmanlık + zaman ister; sözleşme ve filigran ihlali ispatlanabilir kılar. |
| **S — SÖZLEŞME** | Teknik değil hukuki bağ (yardımcı sınıf; tek başına koruma sayılmaz). |

---

## 1. Senaryolar, saldırganlar, varlıklar

**Senaryolar (kullanıcı):** **S1** fabrika iç ağı, internetsiz · **S2** fabrika iç ağı, internetli (gelen port yok, yalnız çıkan imzalı kanal) · **S3** bizim yönettiğimiz VDS (root biziz, müşteride sunucu dosyası yok) · **S4** fabrika IT'sinin yönettiği VDS (root müşteride, API internete açık).

**Saldırganlar:** **D** dış saldırgan (ağdan) · **Ç** fabrika çalışanı (kendi izinleri kadar) · **Y** sunucunun yöneticisi (root/Administrator; S1/S2/S4'te müşteri, S3'te biz) · **X** kopyalayan (yedek, disk imajı, indirilen paket, sızan artefakt) · **B** bizim çalışanımız.

**Varlıklar:** **SA** süperadmin/sistem hesabı ve yetki kayıtları · **LİS** lisans hakkı · **KOD** kaynak kod ve iş mantığı · **ANH** bizim imza anahtarlarımız · **VERİ** müşterinin iş verisi · **ÖZEL** katalog/şablon/rota/rapor mantığı.

---

## 2. Kullanıcı kararları (2026-10-11) — aynen

1. **Repo şimdilik PUBLIC kalır; SATIŞTAN HEMEN ÖNCE private yapılır.** Plan private'ı varsayar. Bugünkü risk: kaynak ve tüm geçmiş zaten kopyalanmış sayılır (private yapmak ileriye dönük korur, geçmişi geri almaz); ayrıca public repoda Actions artefaktları her GitHub hesabına açıktır (§3 M18–M19) → G0a bugün yapılır, G0b satış öncesi.
2. **Etkinleştirilmemiş kurulum YALNIZ ETKİNLEŞTİRME EKRANINI açar** (bugün gözlem kipinde süresiz çalışıyor — bu açık kapanır). İnternetsiz fabrikada: kurulum istek kodu/karekod üretir → portal imzalı etkinleştirme kodu/dosyası (USB) verir. **Mevcut kurulumlar (adnansahin) etkilenmez.** → G2.
3. **Yeni kurulumlar `zorla` kipinde doğar** — portalın HAK'ında `kipAltSiniri` ile; adnansahin olduğu gibi kalır. → G3.
4. **Müşteriye ayrı YALNIZ-OKUMA DB girişi verilir** (satış avantajı); DB'ye elle yazma garanti dışıdır. → G5.
5. **Bizim yedek (emanet) anahtarımız KALIR**; sözleşme + KVKK ekinde yazılır; müşteri kurulumda kapatabilir. → G8.
6. **TPM YOK;** donanım parmak izi (bugünkü F1–F5 bulanık eşleşme) yeter. Önceki taslaktaki TPM fazı kapsam dışıdır.
7. **Varsayılan süperadmin (inmekte, `feature/varsayilan-superadmin`):** kurulumda süperadmin belirtilmediyse ORTAK kullanıcı adı + parolalı varsayılan süperadmin doğar, ilk girişte zorunlu değişim. **Ardından gelen dilim:** sistem hesabı kaydı kurulum anahtarıyla İMZALI — DB'de `isSystemAccount=true` yazmak yetki vermez; mevcut kurulum için tek seferlik imzalama yolu. → G1.

---

## 3. Bugünkü durum — ölçüm tablosu

| # | Konu | Bugün | Kaynak |
|---|---|---|---|
| M1 | Sunucu kodu | esbuild (minify + ad karartma) → bytenode tek `server.jsc`; yükleyici `dist/server.js` düz; harita pakete girmez | `Teks-Erp/scripts/build-korumali.mjs` [ÖLÇÜLDÜ] |
| M2 | `.jsc` okunur izler | `strings` ile `getEffectivePermissions`, `isSystemAccount` gibi adlar görünür; yama yerine yol işareti | önceki tur imaj ölçümü (2.15.0) [ÖLÇÜLDÜ, önceki tur] |
| M3 | **Paketteki araçlar okunur JS** | `dist/tools/*.cjs` bytenode'a çevrilmez, Docker'da yalnız minify (`docker/korumali/sahne.mjs` §2), Windows'ta `build-araclar.mjs --korumali` minify. `superadmin-olustur.cjs` HER İKİ pakete girer: Windows paket kapısı onsuz durur (`deploy/paketle.ps1` "satici hesabi KURULAMAZ"), `npm run superadmin:kur` onu çağırır | `Teks-Erp/scripts/build-araclar.mjs`, `deploy/paketle.ps1`, `Teks-Erp/package.json` [ÖLÇÜLDÜ — VARSAYIM DOĞRULANDI]. ⚠️ `docs/kurallar/superadmin.md` Yasaklar satırındaki "sunucu paketine girmez" cümlesi bayattır (çelişki `deploy-kurulum.md` çözülmüş çelişkiler bölümünde zaten kayıtlı) |
| M4 | Docker imajında kaynak | `.ts`/`.map`/`app/src`/`.env` yok; şema yorumsuz ama tam (kaçınılmaz) | `Teks-Erp/docker/korumali/Dockerfile` + `scripts/test_korumali_imaj.mjs` [ÖLÇÜLDÜ, önceki tur] |
| M5 | Windows korumalı paket | `paketle.ps1 -Korumali` bir anahtar; **varsayılanı KAPALI** (verilmezse okunur tsc JS); yayın yolu yalnız imzalı korumalı zip kabul eder | `deploy/paketle.ps1` param bloğu, `deploy/backend-yayinla.mjs` [ÖLÇÜLDÜ] |
| M6 | Şifreli modül `.tkmod` | Katalogda tek modül; Windows'ta `-Sifrele` ile; **Docker sahnesi `--sifrele` geçmez** | `Teks-Erp/src/lib/license/sifreli-moduller.json`, `sahne.mjs` (grep `sifrele` 0) [ÖLÇÜLDÜ] |
| M7 | **Lisans kipi** | `computeMode` (`state.ts`): HAK `kipAltSiniri` → kira `zorlama` → durum kaydı → derleme varsayılanı `gozlem`. Etkinleşmemiş kurulumun `ETKINLESTIRME_EK_SURESI` çapası (DB ilk açılışı) var ama merdiven yalnız etkinken sürer → etkisiz | `Teks-Erp/src/lib/license/state.ts`, `state-rules-time.ts`, `runtime.ts` [ÖLÇÜLDÜ] |
| M8 | `kipAltSiniri` uçtan uca | Protokolde (`belgeler.ts` `z.literal("zorla")`), satıcıda `Hak.kipAltSiniriZorla` (varsayılan `false`), portal imza ekranında onay kutusu; kurulumun `zorlama` alanı da varsayılan `false` | `satici/sunucu/prisma/schema.prisma`, `satici/web/src/portal/installation/EntitlementSigning.tsx` [ÖLÇÜLDÜ] |
| M9 | Çevrimdışı etkinleştirme | VAR: fabrikada `POST /api/license/cevrimdisi-istek` (`amac: etkinlestir`, kod) → zarf (karekod/dosya) → satıcı `/v1/cevrimdisi` (gövdede `kod` varsa etkinleştirme dalı) → `POST /api/license/cevrimdisi-yanit`; aktarma (`aktarma-istegi`/`aktarma-yaniti`) panel üstünden | `Teks-Erp/src/routes/license.routes.ts`, `satici/sunucu/src/http/public-app.ts` [ÖLÇÜLDÜ] |
| M10 | Lisans kapısı | `licenseGate` app düzeyinde `/api` önünde; yol listeleri tek kaynak `Teks-Erp/src/constants/license-routes.ts` (K5 "verilerimi al" `DATA_EXPORT_PATHS`); bekçi `test_lisans_kapisi` | [ÖLÇÜLDÜ] |
| M11 | Lisans çekirdeği (Rust) | Doğrulama (JWS/sertifika/HAK/kira/iptal), parmak izi, bütünlük, modül anahtarı açma, yerel koruma. **İmzalama fonksiyonu YOK**: kurulum anahtarıyla imza TS'te (`protocol/jws.ts` `signJws`), anahtar `LICENSE_DIR/kurulum-anahtari.json` | `Teks-Erp/native/lisans-cekirdek/src/napi_api.rs`, `Teks-Erp/src/lib/license/store.ts` [ÖLÇÜLDÜ] |
| M12 | Süperadmin | `User.isSystemAccount`; JWT'ye girmez, her istekte taze okunur (`auth.middleware.ts`); API'den atanamaz; **DB'den atanabilir, imzası/izi yok**. Supap: sistem hesabı yoksa `admin:settings` modül bayrağı yazar | `docs/kurallar/superadmin.md` [ÖLÇÜLDÜ] |
| M13 | **Docker DB rolü süper kullanıcı** | `POSTGRES_USER` hem PG'nin ilk rolü hem `DATABASE_URL` kullanıcısı; init betiği yok. Ölçüm: `postgres:16-bookworm`, `POSTGRES_USER=tekserp` → `select rolsuper … current_user` = **`t`**. Göç de açılışta aynı kullanıcıyla (`Teks-Erp/docker/entrypoint.sh` `migrate deploy`) | `Teks-Erp/docker/korumali/docker-compose.yml` + canlı ölçüm 2026-10-11 [ÖLÇÜLDÜ — VARSAYIM DOĞRULANDI] |
| M14 | Windows DB rolü | Uygulama rolü `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` ama DB'nin **SAHİBİ** (göçü de o koşar); ayrı `tekserp_bakim` rolü var; PG yalnız 127.0.0.1 + scram | `deploy/pg/pg-ornegi.json`, `deploy/ilk-kurulum.ps1`, `deploy/bakim-rolu.ps1` [ÖLÇÜLDÜ] |
| M15 | Audit kurcalama seddi | `system_logs` UPDATE/DELETE tetiği `teks.audit_guard = 'on'` iken çalışır; Windows kurulumu DB düzeyinde açar, **Docker'da hiç açılmaz** (docker dizininde `audit_guard` 0); özel GUC oturumda herkesçe kapatılabilir → bugün emniyet kemeri, kilit değil | `Teks-Erp/prisma/migrations/20260819161000_audit_tamper_guard/migration.sql`, `Teks-Erp/src/lib/health-snapshot.ts` [ÖLÇÜLDÜ] |
| M16 | Yedek şifreleme | `.tkenc` çok alıcılı. Yeni Windows kurulumunda `yedek.sifreleme` **varsayılan AÇIK**; Etkili alıcısı (`etkili.tkpub`) cevapta İSTEĞE BAĞLI (`yedek.etkiliAcikAnahtar`, varsayılan `null`), yoksa kurulum "açık madde" basar. Docker'da `BACKUP_KEY_DIR` imajda beyanlı, alıcı yoksa gece işi düz kalır | `deploy/kurulum/cevap-semasi.json`, `deploy/kurulum/kurulum.ps1`, `Teks-Erp/src/lib/backup-crypto/config.ts` [ÖLÇÜLDÜ]. Sözleşme tarafı: `docs/hukuk/VERI-ISLEME-EKI.md` B.3 emanet anahtarını zaten yazıyor; "kapatabilir" cümlesi yok |
| M17 | Dinleme adresi / TLS | Varsayılan `0.0.0.0` + `LAN_TLS_MODE=off`; yeni kurulumlar `required` (HTTPS 4443, HTTP yalnız döngü); Docker portu `127.0.0.1:4000` | `Teks-Erp/src/server.ts`, `docs/kurallar/kesif-cihaz.md` [ÖLÇÜLDÜ] |
| M18 | **GitHub** | Repo PUBLIC; `main` dal koruması yok; commit'ler imzasız; Actions sırrı 0 (imza anahtarı CI'a girmez). Tarihçe taraması: özel anahtar bloğu (`BEGIN … PRIVATE KEY`) tüm dallarda **0**; ama `Teks-Erp/.env` 2026-05-11'de (`7e2cf0023`) eklenip 2026-08-31'de (`8aab44b48`) silinmiş — içinde **uzak bir PostgreSQL sunucusunun kullanıcı + 4 karakterlik parolası** ve yer tutucu biçimli bir `JWT_SECRET` var; geçmişte duruyor | `gh api`, `git log --all -G`, `git log --diff-filter=A` [ÖLÇÜLDÜ; değerler bu belgeye yazılmadı] |
| M19 | **Public artefaktlar** (→ G0a ✓ `cfb498cb3`: harita ayrı artefakt değil, saklama 1 gün, 53 artefakt silindi) | `korumali-paket.yml` korumalı yapıtı (`korumali-win-x64`, `korumali-imaj-linux-x64`) ve **kaynak haritası arşivini** (`kaynak-haritasi-*`, esbuild `sourcemap: 'external'` → `sourcesContent` içerir) 7 gün saklıyor; ölçüm anında üçü de süresi dolmamış durumda. Public repoda artefakt her GitHub hesabına indirilebilir → indirme kapısı (CF Worker) dolanılmış olur | `.github/workflows/korumali-paket.yml`, `gh api …/actions/artifacts` [ÖLÇÜLDÜ] |
| M20 | Actions maliyeti (private olunca) | Son 7 günde CI 201 koşu; tek CI koşusu ≈ 70–83 iş-dakikası (12 iş, bunun 3–7 dk'sı macOS). Kaba hesap ≈ 16.000 iş-dk/hafta yalnız CI (+ Windows/Linux native, kurulum işleri) → aylık ücretsiz kotanın (planına göre 2.000–3.000 dk) çok üstü | `gh run list`/`gh run view --json jobs` [ÖLÇÜLDÜ, 5 koşu örneklemi; fiyat ve kota planına göre VARSAYIM] |
| M21 | S3 yerleşimi | Bulut deneme sunucusu satıcı/patron VDS'inden AYRI makine | `docs/ops/SUNUCU-ENVANTERI.md` [ÖLÇÜLDÜ, belge] |
| M22 | Panel | Electron `asar: true` (şifresiz arşiv); iş mantığı backend'de | `Electron/package.json` [ÖLÇÜLDÜ]; risk düşük [VARSAYIM] |

---

## 4. Tehdit kataloğu

| Kod | Tehdit | Saldırgan × varlık |
|---|---|---|
| T1 | DB'ye yazıp kendini süperadmin yapmak (`isSystemAccount=true`) | Y/X × SA |
| T2 | DB'den rol/izin satırını elle değiştirmek | Y × SA |
| T3 | Paketi/imajı/yedeği başka makinede lisanssız çalıştırmak | X × LİS, KOD |
| T4 | Kira/durum kaydını silip kipi gevşetmek | Y × LİS |
| T5 | Kodu okumak (araçlar, `.jsc` adları, harita) | Y/X × KOD, ÖZEL |
| T6 | Kodu yamalayıp lisans kapısını atlamak | Y × LİS |
| T7 | Bizim imza anahtarlarımızı çalmak | D/B × ANH |
| T8 | SQL enjeksiyonundan komut çalıştırmaya geçmek (süper kullanıcı `COPY … TO PROGRAM`) | D × VERİ, SA |
| T9 | Yedek/disk sızıntısıyla veriyi ele geçirmek | X × VERİ |
| T10 | Ağda dinleme / LAN'dan erişim | D × VERİ |
| T11 | Varsayılan ortak parolalı süperadmine ilk değişimden önce girmek | D/Ç × SA |
| T12 | Bizim çalışanın müşteri verisine/yedeğine erişmesi | B × VERİ |
| T13 | Müşterinin kendi verisini okuması/dışa aktarması | Y × VERİ — **MEŞRU, kapatılmaz** |

---

## 5. Senaryo × tehdit

Hücre: **bugün → hedef (sınıf, faz)**. "✗" = korumasız.

### 5.1 S1 — iç ağ, internetsiz (root müşteride)

| Tehdit | Bugün | Hedef |
|---|---|---|
| T1 | ✗ düz kolon | İmzasız/bozuk imzalı kayıt süperadmin sayılmaz + bulgu (**E** DB-yalnız saldırgana; root kurulum anahtarıyla yeniden imzalayabilir → **P**; iz yenileme zarfında → **T**) — G1, G9 |
| T2 | audit (Docker'da seddi kapalı) | Yetki defteri hash zinciri + kırık zincir bulgusu (**T**); fabrika yöneticisinin hakkı olduğu için kilitlenmez — G9 |
| T3 | ✗ gözlemde süresiz açılır | Yalnız etkinleştirme ekranı (**E** sıfır kurulum kopyasına); aynı makinenin VM anlık görüntüsü ödenmiş tarihe kadar çalışır (**P**, lisans v2 bilinçli kabulü) — G2, G3 |
| T4 | ✗ gözleme düşer | HAK `kipAltSiniri: zorla` → kira silinse de kip düşmez (**E** kip için; merdiven ek süre verir) — G3 |
| T5 | araçlar okunur, `.jsc`'de adlar | Araçlar `.jsc`/daraltılmış, yasak ad bekçisi (**P**) — G6 |
| T6 | `if` yamasıyla atlanır | Vazgeçilmez bir çekirdek paketin `.tkmod` olması: anahtar yalnız imzalı kirada (**P→E-benzeri**: kodu diskte şifreli, atlamak için yeniden yazmak gerekir) — G7 |
| T7 | fabrikada bizim özel anahtar yok (**E**) | aynı |
| T8 | Docker'da süper kullanıcı | Uygulama rolü `NOSUPERUSER`, nesne sahibi değil (**E** komut çalıştırmaya) — G4 |
| T9 | Windows yeni kurulumda şifreli; Docker'da alıcı yoksa düz | Şifreli yedek her kurulumda varsayılan (**E** yedek sızıntısına) — G8 |
| T10 | eski kurulum LAN'da düz HTTP | TLS `required` (yeni kurulumda var) (**E**) |
| T11 | (inmekte) ilk girişte zorunlu değişim | ~~Değişene dek yalnız döngü adresinden giriş~~ — KAPANDI: kullanıcı 2026-10-11 "sınır koyma" (G1-6 uygulanmaz) |
| T12 | bizde sunucu erişimi yok | aynı (**E**); emanet anahtarı yalnız Ek-4 §7 hallerinde (**S**+bildirim) — G8 |
| T13 | panel dışa aktarma her kademede açık | + yalnız-okuma DB rolü (**meşru**) — G5 |

### 5.2 S2 — iç ağ, internetli

S1'in tamamı, şu farklarla:

| Tehdit | Fark |
|---|---|
| T1, T2 | Bulgu her yoklamada satıcıya gider (**T** anında) — G9 (yoklama gövdesine alan: satıcı ÖNCE yayınlanır) |
| T3 | İkiz kurulum (aynı `kurulumId`, iki parmak izi) kira zincirinde görünür (**T**, bugün var); etkinleştirme çevrimiçi |
| T6 | Bütünlük bulgusu yoklamayla gelir (**T**, bugün var; etkisi zorla kipine bağlı → G3) |

### 5.3 S3 — bizim yönettiğimiz VDS

| Tehdit | Bugün | Hedef |
|---|---|---|
| T1–T6 | root biziz, müşteride dosya yok | **E** (müşteri tarafı için); risk bizim tarafa kayar |
| T7 | satıcı/imzacı ayrı makinede (M21) | aynı + kök için donanım anahtarı (**P→E**) — G10 |
| T8 | Docker süper kullanıcı | **G4 burada en kritik**: API internete açık |
| T9 | — | LUKS + şifreli yedek, müşteri alıcısı müşteride (**E**) — G10, G8 |
| T10 | CF proxy + hız sınırı + TOTP herkese | aynı (**E**) |
| T11 | — | Bulut kurulumunda süperadmin her zaman BELİRTİLİR, varsayılan doğmaz (**E**) — G1 |
| T12 | — | Kiracı başına DB/rol, süreli destek erişimi, erişim kaydı müşteriye gösterilir (**T**+**S**) — G10 |
| T13 | — | Yalnız-okuma rolü tünel/özel uçla (**meşru**) — G5 |

### 5.4 S4 — müşteri IT'sinin VDS'i (root müşteride, API internete açık)

S2'nin tamamı + internete açık yüzey:

| Tehdit | Fark |
|---|---|
| T8 | S3 gibi kritik: G4 satıştan önce |
| T10 | Sertleştirmeyi müşteri yapar; kurulumda denetim listesi + sonucun yoklamada bilgi olarak raporu (**T**) — G10 |
| T11 | **En riskli senaryo:** ortak parolalı varsayılan hesap internete açık API'de. Döngü adresi sınırı kullanıcı kararıyla (2026-10-11 "sınır koyma") uygulanmaz; bu kurulum tipinde varsayılan doğmaz (**E**) — G1, §8-1 kapandı |
| T3, T6 | VDS anlık görüntüsü/klonu: S1 ile aynı sınır (**P**+**T**) |

---

## 6. Fazlı plan

**Sıra (bağımlılık):** `G0a` (bugün) → `G1` (varsayılan süperadmin indikten sonra) ∥ `G2` → `G3` → `G4` → `G5` ∥ `G6` → `G7` · `G8` bağımsız · `G9` (G1'den sonra, satıcı önce) · `G10` paralel · `G0b` satıştan hemen önce.
**Satıştan önce zorunlu küme:** G0a · G0b · G1 · G2 · G3 · G4 (en az Docker kolu) · G6 · G8 (sözleşme metni).
Her faz kendi bekçisiyle iner (negatif sonda dahil, `docs/RECETELER.md` § Yeni bekçi) ve önce test kurulumunda (portalda "test" grubu) ölçülür.

### G0a — Public repo hijyeni (bugün) · **S** · ✓ `cfb498cb3` (2026-10-11; (2)'nin `JWT_SECRET` ölçümü açık)

- **Kapsam:** (1) `korumali-paket.yml`den kaynak haritası artefaktını kaldır (harita yalnız Mac arşivine: yapıtla birlikte indirilip yerelde ayrılır) ve korumalı yapıt artefaktlarının saklamasını 1 güne indir; mevcut süresi dolmamış artefaktları sil. (2) Tarihçedeki `.env` kimliği (M18): o PostgreSQL sunucusu hâlâ açıksa parolayı döndür ya da sunucuyu kapat; `JWT_SECRET` değeri hiçbir canlı kurulumda kullanılmıyor olmalı (ölç). (3) GitHub gizli bilgi taraması + push koruması (public repoda ücretsiz) aç.
- **Dokunulan:** `.github/workflows/korumali-paket.yml`; GitHub ayarları (kullanıcı/1e eylemi).
- **Kabul:** `gh api repos/{owner}/{repo}/actions/artifacts` çıktısında `kaynak-haritasi-*` 0; iş akışında `kaynak-haritasi` adı 0 (yeni bir iş akışı bekçisi ya da `scripts/test_korumali_imaj.mjs` genişletmesi); M18 maddesinin kapanışı arşiv notunda ölçümle.
- **Mevcut kurulum / eski istemci:** etkisiz (yalnız CI).
- **Durum (2026-10-11):** (1) ✓ `cfb498cb3` — `kaynak-haritasi-*` artefaktı kalktı, harita arşivi `korumali-<hedef>` yapıtının `harita-arsivi/` alt dizininde; `korumali-paket.yml`deki dört yüklemenin saklaması 1 gün; bekçi `test_docker_hijyeni.ts` §5q (+ §5o 1 gün). Süresi dolmamış 53 artefakt silindi (`kaynak-haritasi-*` 22 · `korumali-win-x64` 11 · `korumali-linux-x64` 11 · `korumali-imaj-linux-x64` 9; ≈3,1 GB); kabul ölçümü `kaynak-haritasi-*` = 0. Kalan artefaktlar korumalı içerik taşımaz (kurulum `setup.exe` · Rust hizmet/güncelleyici ikilileri · imaj künyesi · PG manifestosu — hepsi açık kaynaktan derlenir). GitHub Release varlığı 0. (2) Eski `.env`deki PG parolası ölçüldü: artık geçmiyor (1e) — `JWT_SECRET` değerinin hiçbir canlı kurulumda kullanılmadığı ölçümü AÇIK. (3) ✓ gizli bilgi taraması + push koruması açık; ilk uyarı listesi 0.

### G0b — Repo private geçiş kontrol listesi (satıştan hemen önce) · **S** (+ kullanıcı eylemi)

- [ ] **Actions dakikası:** M20 ölçümüne göre bugünkü kadansla aylık kota birkaç haftada biter. Geçişten ÖNCE seç: (a) kendi makinelerimizde self-hosted koşucu (dakika ücretsiz; Linux için Mac/VDS dışı bir makine, Windows için ayrı makine), (b) CI'ı yalnız PR + `main` push'a ve yol süzgecine daralt, (c) ücretli dakika. Kural: `github-ci-public-repo-karari` hafıza kaydı "lokale al" denene dek GitHub'da.
- [ ] **Gizli bilgiler:** Actions sırrı bugün 0 (imza CI'a girmez) — private sonrası da sır eklenmez; deploy anahtarı 0.
- [ ] **Geçmişte sızmış sır taraması:** G0a(2) kapandı mı; tam tarama aracı (gitleaks/trufflehog — yeni araç, kurulum onayı ister) ile bir kez koş, bulguyu arşive yaz. Not: private yapmak sızmış sırrı geri almaz, yalnız döndürmek kapatır.
- [ ] **Dal koruması:** `main` için zorla push yok, silme yok; zorunlu durum denetimleri (CI yeşil). Ekip tek kişi olduğu için zorunlu inceleme yerine yalnız durum denetimi [öneri].
- [ ] **Hesap:** 2FA zorunlu; commit imzası (SSH anahtarı) — imzasız commit'i dal koruması reddeder.
- [ ] **Public'e bağlı yollar:** repo içeriğine anonim bağlanan bir şey kalmadı mı (raw dosya, Pages, rozet) — `git grep raw.githubusercontent` bugün 0 [ÖLÇÜLDÜ, deploy/ ve docker/ içinde].
- [ ] **Çatallar:** public dönemde alınmış çatallar ve klonlar private'tan etkilenmez — kod "sızmış" kabulü sürer (plan buna göre: asıl savunma G2/G3/G7).
- **Kabul:** `gh api repos/{owner}/{repo} --jq .visibility` = `private`; `…/branches/main/protection` 200; ilk private haftanın dakika tüketimi ölçülüp arşive yazılır.

### G1 — Sistem hesabı imzası (karar 7 ardılı) · **M** · ✓ `e2a0eb240`…`e76f5b547` + D5 (2026-10-12; G1-6 kapandı — kullanıcı kararı 2026-10-11 "sınır koyma")

- **Önkoşul:** `feature/varsayilan-superadmin` `main`e inmiş olmalı.
- **Kapsam:**
  1. Sistem hesabı kaydı, kurulum anahtarıyla imzalı bir **sistem hesabı belgesi** taşır: `{kurulum açık anahtarı özeti, userId, username, tokenVersion, isSystemAccount}` üstüne Ed25519 imza; DB'de yeni kolon (ör. `systemAccountSeal`). İmza **Rust çekirdeğinde** atılır ve doğrulanır (çekirdeğe iki yeni napi ucu: imzala/doğrula); özel anahtar TS'e çıkmaz. Bugün çekirdekte imza fonksiyonu yok (M11) — bu fazın en büyük parçası.
  2. `auth.middleware.ts`deki taze okuma: `isSystemAccount === true` **ve** mühür geçerli → süperadmin. Mühür yoksa/bozuksa: süperadmin DEĞİL + `SISTEM_HESABI_MUHURSUZ` bulgusu (lisans merdivenine bilgi + yoklamada iz, G9).
  3. `getEffectivePermissions`in ilk ifadesi `["*"]` yalnız mühürlü hesaba döner. Supap (`resolveSystemAccountLock`): mühürsüz `isSystemAccount=true` satırı "hesap VAR" sayılır (fail-closed — DB'de bozulmuş satır fabrika yöneticisine modül kapısını açmasın).
  4. **Tek yazar aynı kalır:** mühürü yalnız `superadmin-olustur` (doğuş, `--rotate`, kurulum kipi) ve varsayılan doğuş yolu atar. **Mevcut kurulum için tek seferlik yol:** `superadmin-olustur --muhurle` (sunucuda, TTY'li; mevcut sistem hesabının parolasını sorar, doğrularsa mühürler; idempotent).
  5. **Geçiş mandalı:** "mühür zorunlu" mandalı DB'de değil `LICENSE_DIR`'deki kurulum imzalı durum kaydında durur; yeni kurulumda doğuşta kurulur, mevcut kurulumda `--muhurle` ilk başarılı koşumunda. Mandal yokken mühürsüz hesap bugünkü gibi çalışır + uyarı bandı "sistem hesabını mühürleyin" (yeni davranışın varsayılanı = bugünkü davranış).
  6. **T11 sertleştirmesi:** varsayılan ortak parolalı hesap, parolası değişene dek yalnız döngü adresinden (`127.0.0.1`/`::1`) giriş yapar; LAN/internet girişi 403 + açıklama. Bulut kurulumunda (S3) süperadmin her zaman belirtilir.
- **Dokunulan:** `Teks-Erp/native/lisans-cekirdek/src/` (yeni imza/doğrulama), `Teks-Erp/src/lib/license/native-adapter.ts`, `Teks-Erp/src/middlewares/auth.middleware.ts`, `Teks-Erp/src/services/auth.service.ts`, `system-account.registry.ts`, `Teks-Erp/scripts/superadmin-olustur.ts`, `prisma/schema.prisma` + additive migration, Electron uyarı bandı.
- **Kabul:** `test_superadmin` + `test_superadmin_provision` genişler: (a) DB'den `isSystemAccount=true` yapılan hesap mandallı kurulumda `["*"]` ALMAZ ve bulgu doğar (negatif sonda); (b) mühürlü hesap aynen çalışır; (c) `--muhurle` idempotent; (d) başka kurulum anahtarıyla atılmış mühür reddedilir (döküm başka sunucuya taşınınca süperadmin düşer); (e) mandalsız kurulumda davranış bugünküyle bayt eşit. Çekirdek tarafı `test_lisans_native_kahin` vektörleri.
- **Mevcut kurulum / eski istemci:** adnansahin mandalsız kalır → davranış değişmez, yalnız bant. Panel `/auth/me` alanları aynı; yeni bant alanı eski panelde görünmez (zararsız). Yayın sırası: backend önce.
- **Dürüst sınır:** root `LICENSE_DIR`'i okuyup çekirdeği çağırarak mühür üretebilir → **P**; DB-yalnız saldırgan (SQL enjeksiyonu, pgAdmin, başka sunucuya yüklenen döküm) → **E**.
- **Durum (2026-10-12):** (1)–(5) ✓. Commit'ler: `e2a0eb240` şema + çekirdek işlevleri (`sealSystemAccount` · `verifySystemAccountSeal`) · `5caba6475` yetki/giriş kapısı, mühürlü doğuş, `--muhurle`, kimlik değişiminde yeniden mühür · `2f801abdb` güncelleyici 0.2.6 (ortak `Cargo.lock`) · `8a2886d08` hedef koruması aynı yüklemi okur (sahte işaretli hesap pasife alınabilir) · `e76f5b547` health `sistemHesabiMuhru` + `/auth/me` `systemAccountSealStatus` + panel bandı · D5 uçtan uca bekçi. **Sapmalar:** mühür parola/PIN/kart **kimlik özetlerini kapsar** (alan listesi parola özetini kapsamıyordu — DB'den özet değiştirip mührü bozmadan girilirdi); **`tokenVersion` girmez** (oturum iptal sayacı, her artışta yeniden mühür gerekirdi); mandal imzalı durum kaydı değil **`LICENSE_DIR/sistem-hesabi-mandali.json`** (imzasız; gevşetmenin tek yolu silmek, imza bunu engellemez). **Denetim B4 (2026-10-12):** mühür TOTP'yi de kapsar (açık sırrın özeti, açılış, kurulum kanıtı, kurtarma kodu kümesi; saklama biçiminden bağımsız) — DB'den 2FA'yı değiştirmek/kapatmak mührü bozar; TOTP'suz eski mühür yalnız `sistem-hesabi-muhru-v2.json` işareti yokken geçer, açılış işi bir kez yeniler (geçişten önce kurcalanmış TOTP bir kez aklanır). Mühür TS ve Rust'ta bayt-eşit (Ed25519 belirlenimci; kâhin vektörleri). **Bekçiler:** `test_sistem_hesabi_muhru` · `test_sistem_hesabi_muhru_uctan_uca` (bekci-http) · `test_lisans_native_kahin` (kabul (a)–(e) bunlarda ölçülür; `test_superadmin`/`test_superadmin_provision` yerine ayrı dosya). Gerekçe: `docs/history/arsiv/2026-10.md` 2026-10-12 G1 notu. **(6) KAPANMIŞ KARAR (kullanıcı 2026-10-11, "sınır koyma"):** ortak parolalı varsayılan hesaba döngü adresi sınırı konmaz; T11 riski ilk girişte zorunlu parola değişimi ve panel uyarı şeridiyle taşınır (bilinçli kabul).

### G2 — Çalıştırma kilidi: yalnız etkinleştirme ekranı + çevrimdışı etkinleştirme (karar 2) · **M** · ✓ (2026-10-12)

- **Kapsam:**
  1. `licenseGate`e yeni durum **`ETKINLESMEDI`**: kurulumun geçerli lisans kimliği yoksa izinli küme dışındaki her `/api` isteği 403 `details.code = LICENSE_NOT_ACTIVATED`. İzinli küme tek kaynakta (`Teks-Erp/src/constants/license-routes.ts`, gerekçeli satırlar): kimlik (giriş, `/auth/me`, çıkış, zorunlu parola değişimi, TOTP), `/api/license/*` (durum, detay, kabul, etkinleştir, çevrimdışı istek/yanıt, aktarma), sağlık, sürüm/keşif uçları, "yedekten kur".
  2. **Kopya ↔ kayıp ayrımı (aniden durdurmaz kuralı korunur):** (a) hiç lisans izi yok (LICENSE_DIR kimliksiz ve DB `license.trace` yok) → kilit; (b) DB izi var, LICENSE_DIR kimliği yok/başka anahtar, parmak izi DB izindekiyle **tutuyor** → bugünkü merdiven (ek süre, etkin fabrika kaybı); (c) DB izi var, parmak izi **tutmuyor** → kopya: kilit + K5 "verilerimi al" yolları (`DATA_EXPORT_PATHS`) açık — veri müşterinindir.
  3. **Mevcut kurulum muafiyeti:** adnansahin bugün etkinleşmemiş ve gözlemde. DB'ye yazılan bir "eski kurulum" işareti kopyacı tarafından da yazılabilir (kod public'ti) → muafiyet **satıcı imzalı muafiyet belgesi**dir: kurulumun açık anahtarına ve parmak izi özetine bağlı, portaldan bir kez üretilir, USB/dosyayla `LICENSE_DIR`e konur. Belge yokken kilit sürümü o kuruluma yayınlanmaz (adnansahin zaten dondurulmuş; lisansı yeni kurulumda etkinleştirmeyle gelecek).
  4. **Çevrimdışı akış (S1):** mevcut uçlar (M9) kilit kipinde de açık; panelin kilit ekranı = etkinleştirme ekranı: "Kod gir (internet var)" · "İstek kodu/karekod üret (internet yok)" → telefonla satıcının `/q` sayfası ya da portal → imzalı yanıt dosyası/karekodu → "Yanıtı yükle". Sözleşme kabulü (Ek-7) etkinleştirmenin ön şartı olarak aynı ekranda kalır.
  5. Tablet: kilitte 403 `LICENSE_NOT_ACTIVATED` → "Sunucu lisansı etkinleştirilmedi, yöneticinize başvurun" (yeni ekran yok, mevcut hata yüzeyi).
  6. Eski `ETKINLESTIRME_EK_SURESI` çapası (DB ilk açılışı — DB sıfırlanınca yenilenir) kip kararından çıkar.
- **Dokunulan:** `Teks-Erp/src/middlewares/license.middleware.ts`, `Teks-Erp/src/constants/license-routes.ts`, `Teks-Erp/src/lib/license/runtime.ts`, `state.ts`, `state-rules-time.ts`, protokol (muafiyet belgesi türü — satıcı + fabrika ikizi, `test_lisans_protokol_aynasi`), `satici/sunucu` (muafiyet imzalama ucu, portal düğmesi), Electron lisans sayfası + kabuk yönlendirmesi, mobil hata metni.
- **Kabul:** `test_lisans_kapisi` (izinli küme rota envanteriyle birebir; kilitte iş ucu 403, izinli uç 200) · `test_lisans_durumu` (a/b/c ayrımı; b'de bugünkü merdiven bayt eşit) · uçtan uca: temiz DB + temiz `LICENSE_DIR` ile korumalı imaj → iş ucu 403, çevrimdışı istek → test satıcısı → yanıt yükle → 200 · muafiyet belgeli kurulumda davranış bugünküyle eşit · yanlış anahtara bağlı muafiyet reddedilir.
- **Mevcut kurulum / eski istemci:** adnansahin muafiyetsiz bu sürümü almaz (yayın kapısı); etkin kurulumlar etkilenmez. Eski panel yeni kodu tanımaz → genel hata gösterir; setup.exe yeni kurulumda eşleşen paneli kurar, `minVersion` değişmez (kırılma yalnız etkinleşmemiş yeni kurulumda).
- **Durum (2026-10-12):** ✓. Commit'ler: `56cc360f3` backend kilit (`ETKINLESMEDI`, izinli küme, K3 küme kimliği) · `cb54ab35c` muafiyet kabulü yükleme yolundan + uçtan uca bekçi · `5b7d54152` panel etkinleştirme ekranı (karekod birinci yol) + tablet hata yüzeyi · `9a580f39c` satıcı muafiyet belgesi (portal, yalnız yönetici) · `31c3fe911` K5 giriş bekçisi `lisansEtkinlesmedi` beyanı. **Sapmalar:** (K1) kilit yalnız **korumalı derlemede** işler (`__TEKSERP_ETKINLESTIRME_KILIDI__`, `build-korumali.mjs`); geliştirme/bekçi sunucusunda kapalı, ortamdan/dosyadan/DB'den açılıp kapanmaz. (K3) kayıp ↔ kopya ayrımı parmak izi değil **PG küme kimliği + satıcı kirası**yla: aynı küme → KAYIP (kilit yok) · küme kimliği şimdi ya da kayıtta okunamadı → BELIRSIZ (kilit yok) · iki kimlik okundu ve farklı → KOPYA; satıcı kirası taşımayan / başka anahtara bağlı kiralı iz → KOPYA (DB'ye elle yazılan sahte iz kilidi açmasın). Windows uygulama hesabının `pg_control_system()` okuyabildiği ÖLÇÜLMEDİ — okunamazsa BELIRSIZ (kilitsiz). (K5) kapsam (6) uygulanmadı: `ETKINLESTIRME_EK_SURESI` çapası KALIR (muafiyetli kurulumun kademesi bayt-eşit kalsın; kilitli kurulumda etkisiz). **KAYIP/BELIRSIZ kurulumun davranışı lisansın kipine göredir (1e kararı 2026-10-12):** `zorla` kipte uyarı → ek süre → kısıtlı merdiveni; gözlem kipindeki eski kurulum (adnansahin) bugünkü gibi sınırsız — yeni kurulumlar G3 ile `zorla` kipte doğunca merdiven uygulanır. Muafiyet portalda **yalnız yönetici**, fabrikanın imzalı karekod metninden (etkinleştirme/taşıma isteği; imza zarftaki anahtarla doğrulanır, tazelik penceresi yok) basar; plan ara imzacı (varsa) ya da kök, kuyruk yok. Yazarak (karekodsuz) etkinleştirme yapılmadı — kullanıcı kararı bekliyor (arşiv notu). **Bekçiler:** `test_etkinlestirme_kilidi` · `test_lisans_kapisi` §5c–§5e · satici `test_muafiyet_belgesi` · `test_portal_uclar` §1e0 · panel `LicenseActivationPage.test.tsx` · `apiClient.license.test.ts` · tablet `license.test.ts`. Gerekçe: `docs/history/arsiv/2026-10.md` 2026-10-12 G2 notu. **Denetim düzeltmeleri (Bölge 3, 2026-10-12):** bekleyen taşıma talebi kurulumu etkin SAYMAZ (B1, `78542d264`; satıcı ≤2.15.5'ten taşıma talebi açmaz `d0cc71059`); kullanılamayan `LICENSE_DIR` (program/yedek içinde, yazılamaz, DB izsiz okunamaz) `KURULUM_HATASI` kilididir (B2, `7e4137228`) — G1 mandalı bu konumlarda görünmez kalır (bilinçli; root boş dizinle de düşürür). Açık: B6 BELIRSIZ etkin olmayan kurulumda süresiz kilitsiz (G3 ile kapanır), B5 muafiyet süresiz/iptalsiz. Gerekçe: arşiv 2026-10-12 lisans denetimi notu.

### G3 — Yeni kurulum `zorla` kipinde doğar (karar 3) · **S**

- **Kapsam:** Satıcıda yeni HAK'ın `kipAltSiniriZorla` ve kurulumun `zorlama` alanı **portal oluşturma akışında** varsayılan `true` (şema varsayılanı değil — mevcut satırlar değişmez); portal onay kutusu "Lisans kurallarını uygula" önceden işaretli gelir; `DEMO`/`TEST` sınıfı da zorla. Bayi formu aynı. Mevcut HAK'lar (adnansahin) olduğu gibi kalır.
- **Önkoşul (`lisans.md` Geçiş sırası satırı):** `zorla` merdiveni yeni test kurulumunda (portal "test" grubu; eski deneme makinesi emekli) ölçülür ve yanlış pozitif 0 çıkmadan ilk satış kurulumuna gitmez.
- **Dokunulan:** `satici/sunucu/src/services/entitlement-version.service.ts`, kurulum oluşturma servisi, `satici/web/src/portal/installation/EntitlementSigning.tsx` + oluşturma formu.
- **Kabul:** satıcı bekçisi: yeni kurulum + ilk HAK → imzalı belgede `kipAltSiniri: "zorla"`; mevcut kurulumun yeni HAK sürümü eski değeri korur (`isEntitlementWithin` genişlik kapısı zaten koruyor). Fabrika: `test_lisans_durumu` zorla HAK + kira silindi → kip `zorla` kalır (bugün var, regresyon olarak).
- **Mevcut kurulum / eski istemci:** etkisiz; satıcı önce yayınlanır, fabrika kodu değişmez.

### G4 — DB en az yetki (göç) · **L**

- **Kapsam:**
  1. **Docker:** üç rol — `tekserp_sahip` (nesne sahibi, yalnız göçte), `tekserp` uygulama (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, yalnız DML), `tekserp_okur` (G5). PG süper kullanıcısı ayrı adla (`postgres`) yalnız konteyner içi bakımda; `DATABASE_URL` uygulama rolü, göç `entrypoint.sh` içinde ayrı `MIGRATE_DATABASE_URL` (sahip). Yeni kurulum: init betiği. **Mevcut Docker kurulumu (göç):** güncelleyici/entrypoint tek seferlik, idempotent, yalnız-ekleyen göç adımı — yeni rolleri yarat, nesne sahipliğini `tekserp_sahip`e devret (`REASSIGN OWNED`), uygulama rolünden süper kullanıcılığı al (`ALTER ROLE … NOSUPERUSER`) EN SON; her adım ölçülür, yarıda kalırsa bir sonraki açılış kaldığı yerden sürer. Veri silinmez, reset yok; geri dönüş yalnız göç öncesi yedekten.
  2. **Windows:** uygulama rolü bugün DB sahibi → sahipliği `tekserp_bakim`e (zaten var, `NOSUPERUSER`) devret, göçü bakım rolü koşar; uygulama rolü DML.
  3. **Audit seddi:** `teks.audit_guard` GUC'si yerine rol tabanlı: uygulama rolünden `system_logs`/arşiv tablolarında `UPDATE, DELETE` `REVOKE` (arşivleme işi beyanlı istisna rolüyle). Docker'da bugün sed hiç yok (M15).
  4. **Defter tablolarında yalnız ekleme:** önce ÖLÇÜM — `scripts/lib/defter-beyan.ts` envanterinden hangi defterde meşru UPDATE (durum kolonu) var; yalnız saf-ekleme defterlerine `REVOKE UPDATE, DELETE`. Ölçümsüz REVOKE yok.
- **Dokunulan:** `Teks-Erp/docker/korumali/docker-compose.yml`, `docker-compose.bulut-ornek.yml`, `Teks-Erp/docker/entrypoint.sh`, Docker güncelleyici, `deploy/pg/pg-ornegi.json`, `deploy/kurulum/kurulum.ps1`, `deploy/bakim-rolu.ps1`, yeni migration'lar (GRANT/REVOKE — `docs/kurallar/deploy-kurulum.md` migration reçetesi, en eski canlı dökümde prova).
- **Kabul:** yeni bekçi: Docker ve Windows kurulum provasında `select rolsuper` uygulama rolü için `f`, uygulama rolü hiçbir tablonun sahibi değil, `COPY … TO PROGRAM` 42501; `system_logs` UPDATE 42501; bütün backend bekçileri yeşil (uygulama hiçbir DDL'e muhtaç değil — ölç: çalışma anında `CREATE`/`ALTER` yapan kod yolu var mı). `test_docker_hijyeni` genişler. Göç provası en eski canlı dökümde.
- **Mevcut kurulum / eski istemci:** istemci etkisiz. Mevcut kurulumda göç geri alınamaz → bakım penceresi + önce yedek; adnansahin dondurulmuş, bu fazı yeni kurulumunda alır.

### G5 — Yalnız-okuma DB rolü (karar 4) · **M**

- **Kapsam:** `tekserp_okur` (`LOGIN`, `pg_read_all_data` ya da şema başına `SELECT` + varsayılan ayrıcalık); hassas kolonlar dışarıda: kimlik özeti tabloları (parola/PIN/kart/TOTP özetleri, oturumlar, `security.*`/`license.*` ayarları) için kolon/tablo düzeyinde REVOKE ya da okuma görünümleri (`okur` şeması). Kurulum parolayı üretir; panel **Sistem → Veritabanı erişimi** kartı: bağlantı bilgisi göster, parolayı döndür (ayar şifresi + `admin:settings`), audit. Ağ: S1/S2'de PG yalnız 127.0.0.1 → müşteri okuma için ya sunucuda araç kullanır ya da IT'si `pg_hba`'ya LAN satırı ekler (kurulum seçeneği, varsayılan kapalı). S3'te okuma rolü yalnız tünel/özel uçla.
- **Sözleşme:** "DB'ye elle yazma garanti dışıdır" maddesi (G8 ile aynı hukuk turunda).
- **Dokunulan:** G4 rol modeli, `deploy/kurulum/*`, Docker init, yeni panel kartı + backend uç (yeni izin değil; `admin:settings` + ayar şifresi), `docs/hukuk/SON-KULLANICI-LISANS-SOZLESMESI.md` taslak maddesi.
- **Kabul:** okur rolüyle `INSERT/UPDATE/DELETE` 42501, hassas tablo `SELECT` 42501, iş tabloları okunur; parola döndürme eski parolayı geçersiz kılar; parola audit yüküne girmez (`test_settings_password` emsali sır sondası).
- **Mevcut kurulum:** isteğe bağlı; rol yoksa kart "kurulu değil — kur" der.

### G6 — Paket araçları ve korumalı varsayılan · **M**

- **Kapsam:** (1) `dist/tools/*.cjs` → aynı runtime ile `.jsc` (bytenode) ya da içe aktarma ağacı daraltılır (`superadmin-olustur` iş servislerini çekmesin). (2) `paketle.ps1 -Korumali` varsayılan AÇIK; okunur paket yalnız açık bir geliştirme anahtarıyla. (3) Lisans/yetki/bütünlük modüllerinde hedefli ad karartma (Prisma özellik adlarına dokunmadan). (4) `superadmin.md` Yasaklar satırındaki bayat "sunucu paketine girmez" cümlesi düzeltilir (bu faz o dosyaya dokunur).
- **Dokunulan:** `Teks-Erp/scripts/build-araclar.mjs`, `Teks-Erp/docker/korumali/sahne.mjs`, `deploy/paketle.ps1`, `Teks-Erp/scripts/build-korumali.mjs`.
- **Kabul:** `scripts/test_korumali_imaj.mjs` genişler: `docker save` katman taraması, `dist/tools`'ta okunur `.cjs` 0 (ya da boyut tavanı), `.jsc` `strings` taramasında yasak ad listesi 0 (negatif sonda: listeye bilinen bir ad koyup kırmızı gör). Windows paket kapısı aynı kuralı.
- **Mevcut kurulum:** `npm run superadmin:kur` ve `kurulum-stdin` aynı arayüzle çalışmalı (`test_kurulum_girdisi` §4 gerçek süreç).

### G7 — Docker'da şifreli modül eşitliği + vazgeçilmez çekirdek modül · **L**

- **Kapsam:** (1) `sahne.mjs` `--sifrele` ile `.tkmod` üretir; imaj ↔ Windows eşit. (2) Sınırı temiz, büyük bir çekirdek iş paketinin (`docs/design/KOD-KORUMA-OLCUM.md` borç listesinden seçilir; aday ölçülecek) `.tkmod` olması: anahtar yalnız imzalı kirada, kurulum X25519 anahtarına sarılı. Kirasız (etkinleşmemiş) kurulumda o paket diskte şifreli kalır → G2 kilidi "if yaması"yla atlanamaz.
- **Dokunulan:** `Teks-Erp/src/lib/license/sifreli-moduller.json`, `module-key-cache.ts`, `sahne.mjs`, satıcı kira modül anahtarı alanı.
- **Kabul:** `test_lisans_butunluk`/modül şifreleme bekçileri; imajda `.tkmod` var; kirasız açılışta o modülün uçları kilitli, düz kaynak `strings`te yok.
- **Mevcut kurulum:** modül anahtarı kirayla gelir; kirası olmayan etkin kurulum (gözlemdeki eski kurulum) için geçiş: anahtar ilk yoklamada teslim — ölçülmeden açılmaz. adnansahin muafiyet belgesiyle anahtarı da alır [tasarım ayrıntısı fazda].

### G8 — Yedek emanet anahtarı (karar 5) · **S**

- **Kapsam:** Etkili alıcısı (`etkili.tkpub`) kurulum paketine gömülür ve **varsayılan dahil**; kurulum sihirbazında görünür seçenek "Etkili Yazılım kurtarma anahtarı (önerilir)" — kaldırılırsa kurulum açık maddeyi bir kez yazar, sonra sessiz. Docker: imaj `etkili.tkpub`yi taşır, `.env`de kapatma anahtarı. Panel Sistem → Yedek kartında alıcı listesi görünür (bugün `/api/admin/health` sayar).
- **Sözleşme maddesi taslağı notu (hukuk turu):** `docs/hukuk/VERI-ISLEME-EKI.md` B.3'e "Lisans Alan kurulumda ya da sonradan Lisans Veren yedek alıcısını kaldırabilir; kaldırırsa sunucu kaybında Lisans Veren yedekleri açamaz ve kurtarma Lisans Alan'ın kendi anahtarına bağlıdır" cümlesi; SKLS'ye "DB'ye doğrudan yazma garanti/destek dışı; yalnız-okuma erişimi verilir" maddesi. Avukat incelemesi (hukuk klasörü TASLAK).
- **Dokunulan:** `deploy/kurulum/cevap-semasi.json` (`yedek.etkiliAcikAnahtar` → paket içi varsayılan + açık kapatma), `deploy/kurulum/kurulum.ps1`, `deploy/kurulum/kurulum-arsivi.mjs`, Docker imajı, `docs/hukuk/*` (taslak).
- **Kabul:** `test_yedek_sifreleme` + `test_sunucu_betikleri`: varsayılan kurulumda yedek başlığında Etkili alıcısı var; kapatma seçeneğiyle yok; ikisinde de müşteri anahtarı çözebiliyor.
- **Mevcut kurulum:** alıcı dizinine dokunulmaz (kurulum EZMEZ kuralı).

### G9 — İz kanalı: yetki defteri zinciri + kurcalama özeti · **M**

- **Kapsam:** (1) Rol/izin/`admin:*` verilişleri hash zincirli yetki defterine (her satır öncekinin özeti + kurulum anahtarı HMAC'i); açılışta/günlük doğrulama; kırık zincir `YETKI_DEFTERI_KIRIK`. (2) G1 `SISTEM_HESABI_MUHURSUZ` + bütünlük bulguları imzalı **kurcalama özeti** olarak yoklamaya ve çevrimdışı istek zarfına; satıcıda `LOCAL_INTERVENTION_CAUSES`a yeni nedenler (`satici/sunucu/src/services/local-intervention.ts`), portal uyarısı. Yenileme REDDEDİLMEZ (aniden durdurmaz); karar satıcıda.
- **Kabul:** elle değiştirilen rol satırı → bulgu; zarfta özet var; satıcı bekçisi uyarıyı doğurur. KATI yoklama şeması: satıcı ÖNCE yayınlanır.
- **Mevcut kurulum:** eski fabrika alanı göndermez → satıcı "bilinmiyor" sayar.

### G10 — Bizim taraf ve S3/S4 sertleştirme · **M** (kısmen kullanıcı eylemi)

- **Kapsam:** S3 runbook'u (ayrı makine — bugün var, M21; SSH yalnız anahtar, tercihen FIDO2; LUKS; `auditd`; kiracı başına DB/rol/compose ağı; süreli destek erişimi + erişim kaydı); S4 kurulum denetim listesi (TLS, 127.0.0.1, güvenlik duvarı) ve sonucun yoklamada bilgi olarak raporu; kök anahtar için donanım anahtarı ya da ayrı çevrimdışı makine (bugün Mac Anahtar Zinciri, sorusuz — kullanıcı kararı 2026-10-08, risk kabul).
- **Kabul:** `deploy/vds-dogrula.sh` yeni maddeler; tören provası.

### Kapsam dışı

- **TPM bağı** (karar 6). Kopya koruması parmak izi (F1–F5) + G2 + G7 ile.
- Kodun tam gizliliği: repo bir süre public kaldı; yatırım kopyanın **açılmamasına** (G2/G3/G7), gizliliğe değil.

---

> **Bölge 7 düzeltmesi (2026-10-12):** satıcı/patron B2 · B5 · B5s · B6 · B9 kapandı (`docs/history/arsiv/2026-10.md` "Güvenlik denetimi Bölge 7 düzeltmesi"); B1/B1k · B3 · B4 · B7 · B8 açık.

> **Bölge 4+5 düzeltmesi (2026-10-12):** S4/T10 için HTTP katmanı varsayılanları sertleşti — değişkensiz kurulumda giriş/PIN/kart/TOTP/lisans uçları IP başına 60/dk, barındırılanda `TRUST_PROXY=true` açılışı durdurur; panel sabitli LAN adresinde yabancı sertifikayı reddeder; geçiş LAN TLS'i `dual` açar (`docs/history/arsiv/2026-10.md` "Bölge 4+5 düzeltmesi"). Açık: B3 cihaz kimliği kanıtı, B5, B6, B8, B9.

## 7. Eski istemci ve mevcut kurulum — özet

| Faz | Sözleşme kırar mı | Mevcut kurulum (adnansahin) |
|---|---|---|
| G0a/G0b | hayır | etkisiz |
| G1 | hayır (yeni alan + bant) | mandalsız: bugünkü davranış + bant |
| G2 | yeni hata kodu yalnız etkinleşmemiş kurulumda | muafiyet belgesi olmadan bu sürüm gönderilmez; KAYIP/BELIRSIZ iz gözlem kipinde bugünkü gibi |
| G3 | hayır (satıcı varsayılanı) | eski HAK aynen |
| G4 | hayır (istemci) · geri alınamaz göç (sunucu) | yeni kurulumunda |
| G5 | hayır (yeni uç) | isteğe bağlı |
| G6 | hayır | araç arayüzü aynı |
| G7 | hayır | anahtar kirayla; muafiyetle |
| G8 | hayır | alıcı dizinine dokunulmaz |
| G9 | yoklama gövdesine alan → satıcı önce | alan gönderilmez → "bilinmiyor" |

---

## 8. Kullanıcıdan gereken ek karar (sade dil)

1. ✓ KAPANDI (kullanıcı 2026-10-11: "sınır koyma" — G1-6 uygulanmaz, bilinçli kabul) **Ortak parolalı varsayılan süperadmin internete açık sunucuda.** Müşterinin kendi VDS'ine (S4) kurulumda süperadmin belirtilmezse ortak parolalı hesap, parola değişene kadar internetten giriş alabilir. Öneri: parola değişene dek bu hesap yalnız sunucunun kendisinden giriş yapsın (G1-6).
2. **Private olunca otomatik testler nerede koşsun?** Bugünkü test sıklığıyla aylık ücretsiz dakika birkaç günde biter. Öneri: satıştan önce testleri kendi bilgisayarlarımızda koşan GitHub koşucusuna taşıyalım (ücretsiz); yalnız gerekirse ücretli dakika.
3. ✓ (2026-10-11, 1e ölçtü: sızan parola artık geçmiyor) **Eski `.env` dosyasındaki veritabanı parolası.** Repo geçmişinde 2026 Mayıs–Ağustos arası duran bir dosyada uzak bir veritabanı sunucusunun kullanıcı adı ve kısa parolası var. O sunucu hâlâ açıksa parolası değişmeli ya da sunucu kapatılmalı (G0a-2) — sunucunun bugün ne olduğunu siz biliyorsunuz.
