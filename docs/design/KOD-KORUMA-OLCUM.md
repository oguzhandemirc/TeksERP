# Kod koruma — Faz 2a ölçümü (paketleme · modül sınırları · bytenode · Prisma yorumları)

> **Durum:** ölçüm raporu, 2026-09-29, dal `lisans/2a-olcum` (taban `lisans/entegrasyon`). Üretim koduna DOKUNULMADI; yalnız `Teks-Erp/scripts/olcum/` altındaki beş ölçüm betiği ve bu belge.
> **Plan:** `docs/design/LISANS-KOD-KORUMA.md` Faz 2 (2a → 2b/2c/2d). Bu belge o planın 2a maddesinin sonucudur; 2b/2c/2d için önerdiği sınırlar KARAR DEĞİLDİR, dilim sahibinin girdisidir.
> **Ortam:** macOS darwin-arm64 · Node **24.18.0** (resmî `SHASUMS256.txt` ile SHA256 eşleşti; SAHINSRV sürümü) · esbuild 0.28.1 · Prisma 7.10.0 · bytenode 1.7.0 (ağaç DIŞINDA geçici dizine kuruldu, `package.json`a eklenmedi) · DB `tekserp_lis2a_test` (fabrika verisi YOK). Windows ve Linux'ta ÖLÇÜLMEDİ — bayt kodu platforma kilitli olduğundan 2b'nin CI koşucuları bu ölçümün Win/Linux ikizidir.

## 0. Özet

| Soru | Cevap (ölçülen) | 2b/2d'ye sonuç |
|---|---|---|
| Backend tek dosyaya paketlenip Node 24 ile açılıyor mu? | **Evet.** 689 src dosyası → `server.cjs` 5.952 KB (minify 3.061 KB), 136–193 ms; `/health` 200 (DB UP), giriş + kimlikli uçlar 200 | Paket hattı esbuild ile kurulabilir; `tsc --removeComments` çıktısının yerini alır |
| Yol çözen dosyalar pakette doğru yeri buluyor mu? | **10 dosyanın 9'u evet**; yalnız `config/swagger` boş (0 yol) — `__dirname` kullanan TEK dosya | Swagger üretimde zaten bağlanmıyor; gerileme değil, bilinçli kabul |
| Satılabilir modüller çekirdekten ayrılabilir mi? | **Bugün yalnız `depoMulti`** (2 dosya, 46 KB). `finance` 4, `devere+dokuma` 7 çekirdek kenarı kesilince ayrılır; `production` 33 kenar, `emanet` davranış bayrağı | 2d ilk hedef finance (+ticaret/iplik grubu) ve devere+dokuma; production/emanet şifrelenmez (borç) |
| bytenode Node 24'te çalışıyor mu? | **Evet**; iş uçları `.jsc` ile 200; başlatma +13…+19 ms (dis), −45 ms (tam); RSS +13…+40 MB | Uygulanabilir; yalnız YAVAŞLATICI (dizgeler düz metin) |
| `.jsc` başka Node ile açılır mı? | 26.8.1 **RED** (`cachedDataRejected`); **24.21.0 KABUL** (aynı V8 13.6.233.17) | Yükleyici Node yama sürümüne değil V8 sürümü + platform/mimariye bakmalı |
| Prisma istemcisi şema yorumlarını taşıyor mu? | **Evet**, üç kanalda 4.640 satır; yorumsuz kopyadan `generate` → 0, çalışma anı veri modeli BİREBİR aynı, `migrate diff` 0 ifade | Paketleme şemanın yorumsuz kopyasını sahneye koyar; dördüncü kanal (paketteki `schema.prisma`) de kapanır |

## 1. Paketleme provası (esbuild tek dosya)

**Betik:** `Teks-Erp/scripts/olcum/paket-provasi.ts` — `src/server.ts` + yol sondasını esbuild ile `app/dist/*.cjs`e paketler; sahne düzeni bugünkü paketin aynısıdır (`app/{dist,prisma,assets,public,package.json,node_modules}`, cwd = `app/`); `--calistir` ile sunucuyu 127.0.0.1'de açar, uçları yoklar ve KENDİ sürecini kapatır. Hedef DB kapısı `fixtureHedefEngeli` (yalnız `_test`). Seçenekler `scripts/build-araclar.mjs` ile AYNI: `platform: node`, `format: cjs`, `target: node24`, dışarıda = `@prisma/client`, `.prisma/client`, `prisma`, `bwip-js`.

| Varyant | Ne paketlenir | `server.cjs` | Harita | Süre | Çalışma anı `require` (yerleşik dışı) | `/health` | Giriş · admin/health · lisans/durum · items · rolls |
|---|---|---|---|---|---|---|---|
| `dis` | yalnız BİZİM kod (`packages: external`) | 5.952 KB | 15.147 KB | 176–193 ms | 20 paket (bugünkü `node_modules` aynen) | 200 · 456–522 ms | 200 · 200 · 200 · 200 · 200 |
| `dis --minify` | aynı + minify (ad karartma dahil) | 3.061 KB | 15.200 KB | 118–136 ms | 20 paket | 200 · 407–415 ms | 200 · 200 · 200 · 200 · 200 |
| `tam` | `node_modules` da içeride | 9.954 KB | 21.701 KB | 194–241 ms | yalnız `@prisma/client`, `bwip-js`, `pg-native` (isteğe bağlı) | 200 · 372–414 ms | 200 · 200 · 200 · 200 · 200 |

Uyarı sayısı üç varyantta da 0. `pg-native` `pg`nin koşullu `require`ıdır (kurulu değil, kullanılmıyor). `tam` varyantta `swagger-ui-express` statik dosyaları kırılıyor (`/api-docs/swagger-ui.css` → `text/html`) — paketin `__dirname`'e göre dosya çözen üçüncü taraf kodu buna benzer sessiz kırılmalar üretebilir.

**Paketteki yol davranışı** (`Teks-Erp/scripts/olcum/yol-sondasi.ts`, kaynakta tsx ile ve pakette node ile AYNI giriş):

| Dosya | Yol kaynağı | Kaynak (tsx) | Paket (`dis`/`min`/`tam`) | Not |
|---|---|---|---|---|
| `app.ts` (`publicDir`) | `process.cwd()/public` | ✓ | ✓ | |
| `config/mobile-update.ts` | env ya da `cwd/../mobil-guncelleme` | ✓ | ✓ | |
| `config/swagger.ts` | **`__dirname`**`/../routes/**/*.{ts,js}` | ✓ 642 yol | ✗ 0 yol | Pakette `routes/` dizini yok ve esbuild JSDoc'u siler |
| `lib/app-version.ts` | `cwd/package.json` | ✓ 2.11.2 | ✓ 2.11.2 | |
| `lib/disk-metrics.ts` | `cwd` diski | ✓ | ✓ | |
| `lib/license/store.ts` | env ya da `cwd/../lisans` | ✓ | ✓ | 1c'nin eklediği onuncu dosya (plan "9 dosya" diyordu) |
| `services/backup-impact.service.ts` | `cwd/dist/tools/yedek-sifrele.cjs` | — (kaynakta derlenmemiş) | ✓ | |
| `services/db-copy.service.ts` | `cwd` (disk birimi tahmini) | ✓ | ✓ | yalnız bilgi alanı |
| `services/db-copy-verify.service.ts` | `cwd/prisma/migrations` | ✓ 363 | ✓ 363 | |
| `services/helpers/raster/raster-font.ts` | `cwd/assets/fonts` | ✓ | ✓ | |

**Sonuç:** 10 dosyanın dokuzu `process.cwd()` kullanıyor ve paketleme bunları DEĞİŞTİRMEZ — sözleşme bugünkü gibi "süreç `app/` kökünde başlar"dır (`ecosystem.config.js` `cwd: __dirname`, `kur.ps1` `Set-Location $appDir`). `__dirname` kullanan tek dosya swagger'dır; üretimde `NODE_ENV=production` iken Swagger zaten bağlanmaz ve bugünkü `tsc --removeComments` paketi de spec'i boş üretir (`deploy/paketle.ps1` [2/6] notu). Yani paketleme bir gerileme getirmez.

**İsim bağımlı mantık taraması:** `err.constructor.name === "PrismaClientKnownRequestError" | "PrismaClientValidationError" | "ZodError"` ve `constructor?.name === "Decimal"` karşılaştırmaları üçüncü taraf sınıflarına bakar; `dis` varyantında o sınıflar paket dışıdır, minify onları yeniden adlandırmaz (duman uçları 200). `tam + minify` birleşimi bu karşılaştırmaları kırabilir (yalnız `instanceof` kolu kalır) — ölçülmedi.

## 2. Modül sınırları

**Betik:** `Teks-Erp/scripts/olcum/modul-sinirlari.ts` — girdi `dis` varyantının esbuild metafile'ı (src → src içe aktarma grafiği, 689 dosya, 10.118 KB kaynak). Her modül için:

- **Tohum** = yönlendirici düzeyinde (`router.use(verifyToken, requireXEnabled)`) modül kapısı taşıyan route dosyaları. Karma yönlendiriciler (`reports.routes.ts`, `subcontractor.routes.ts` — uç düzeyinde iplik/devere/dokuma/finance kapısı) BİLEREK tohum değildir: çekirdek yönlendirici içinde kalırlar.
- **R** = tohumdan erişilen src dosyaları · **C** = `server.ts`ten tohumlar SİLİNMİŞ grafikte erişilenler ("modül yokken çekirdek") · **E = R − C** (bugün ayrılabilen) · **sızıntı** = adı modülün alanına ait olup C'de kalan dosya · **engel kenarı** = C'deki alan-dışı bir dosyadan alan dosyasına doğrudan içe aktarma · **E′** = engel kenarları kesilince (arayüz/kanca arkasına alınınca) ayrılan kod · **yüzey** = E′ dosyalarının çekirdekten doğrudan içe aktardığı dosya sayısı (şifreli modülün çekirdeğe açılan kapısı).
- Varsayım: `app.ts`teki bağlama satırı modül açıldığında tembel yüklemeye çevrilir (tohumlar grafikten silinir). Aracın kendisi negatif sondayla doğrulandı: metafile kopyasına `inventory.service.ts → warehouse-transfer.service.ts` kenarı eklenince `depoMulti` "AYRILABİLİR"den "ayrılamaz — 1 alan dosyası"na döndü; kenar yokken yeniden AYRILABİLİR.

| Modül | Tohum | R | E | E / R bayt | Sızıntı | Engel kenarı (çekirdek + modül) | E′ (kesimle) · yüzey | Karar |
|---|---|---|---|---|---|---|---|---|
| finance | 9 | 220 | 18 | 302 / 3.180 KB | 18/36 | 4 (4 + 0) | 36 dosya · 834 KB · 42 | **4 kanca ile ayrılır** |
| ticaret | 4 | 181 | 7 | 135 / 2.389 KB | 7/14 | 8 (1 + 7: finance) | 16 dosya · 353 KB · 34 | finance'a bağımlı; grupla |
| iplik | 1 | 110 | 2 | 23 / 1.341 KB | 6/8 | 18 (2 + 16: devere, dokuma, finance, ticaret) | 6 dosya · 66 KB · 13 | tek başına anlamsız; grupla |
| devere | 3 | 139 | 13 | 130 / 1.601 KB | 8/21 | 9 (6 + 3: dokuma) | 18 dosya · 162 KB · 27 | dokuma ile grupla |
| **depoMulti** | 1 | 80 | 2 | 46 / 1.101 KB | 0/2 | 0 | 2 dosya · 46 KB · 18 | **AYRILABİLİR (bugün)** |
| production | 10 | 289 | 23 | 447 / 4.678 KB | 40/59 | 33 (33 + 0) | 65 dosya · 1.640 KB · 75 | ayrılamaz — çekirdeğin dokusu |
| dokuma | 8 | 235 | 27 | 248 / 3.023 KB | 9/35 | 4 (2 + 2: devere) | 37 dosya · 324 KB · 38 | devere ile grupla |
| emanet | — | — | — | — | 1/1 | 7 çekirdek servis | — | yönlendirici yok: davranış bayrağı, şifrelenemez |
| tezgah | — | — | — | — | 0/0 | 0 | — | yer tutucu (arkasında yüzey yok) |
| kumasTeknik | — | — | — | — | 0/0 | 0 | — | yer tutucu (arkasında yüzey yok) |
| grup finance+ticaret+iplik | 14 | 231 | 27 | 460 / 3.369 KB | 31/58 | 12 (7 + 5: devere, dokuma) | 58 dosya · 1.252 KB · 52 | 7 çekirdek kancası + devere/dokuma'nın iplik bağı |
| **grup devere+dokuma** | 11 | 250 | 43 | 394 / 3.216 KB | 16/56 | **7 (7 + 0)** | 59 dosya · 517 KB · 39 | **7 kanca ile ayrılır** |
| grup devere+dokuma+iplik | 12 | 252 | 45 | 416 / 3.238 KB | 22/64 | 20 (9 + 11: finance, ticaret) | 66 dosya · 603 KB · 36 | iplik'i eklemek finance/ticaret bağı getirir |

**Engel kenarları (refaktör noktaları):**

- **finance (4, hepsi çekirdek):** `server.ts → jobs/exchange-rate.job.ts` (iş kaydı) · `controllers/shipping.controller.ts → services/accounting-export.service.ts` · `services/customer.service.ts → helpers/customer-finance-bridge.helper.ts` · `services/shipping.service.ts → helpers/shipment-auto-draft.helper.ts` (zaten dinamik `import()`; esbuild CJS'te yine de gövdeye katar).
- **devere+dokuma (7, hepsi çekirdek):** `server.ts → jobs/machine-shift-close.job.ts` · `inventory.service.ts → helpers/machine-doff-link.helper.ts` · `inventory.service.ts → warp-beam-auto-consume.service.ts` · `quality-scorecard` ve `scrap-scorecard` raporları `→ helpers/warp-beam-roll-filter.helper.ts` · `subcontractor.controller.ts` ve `subcontractor.service.ts → subcontractor-beam.service.ts`.
- **ticaret (8):** 1 çekirdek (`inventory.service.ts → purchase-order.service.ts`) + 7 finance'tan (`invoice.service`/`invoice-receipts`/`shipment-auto-draft → goods-receipt`, `receipt-qty`, `contract-price`, `item-price`). Ticaret finance'ın ÖNKOŞULU gibi davranıyor: finance şifreli ve ticaret açıkken sorun yok, tersi (ticaret şifreli, finance açık) finance'ı kırar.
- **iplik (18):** `yarn.service`, `yarn-sign`, `yarn-lot`, `subcontractor-yarn` mal kabul, sayım, fatura, devere sarımı ve fason dokumadan çağrılıyor — iplik bir modülden çok ortak bir defter (iplik lotu) gibi davranıyor.
- **production (33):** en çok `subcontractor.service` (7), `inventory.service` (4), `order.service` (4), `system-setting.service` (3), `roll-step.helper` (3). İş emri kilitleri, olay defteri ve refakat kartı yardımcıları çekirdek akışın parçasıdır.
- **emanet (7):** `helpers/emanet-owner.helper.ts` yedi çekirdek servisten (`inventory`, `shipping`, `subcontractor`, `subcontractor-weaving`, `warp-beam`, `warp-beam-wind`, `yarn-lot`) çağrılır; kod değil DAVRANIŞ satılıyor.

**Ölçümün sınırı:** grafik yalnız statik/dinamik İÇE AKTARMAYI görür. Çekirdeğin modül tablolarını Prisma üzerinden doğrudan okuması (ör. cari bakiyesi, iplik lotu) kenar değildir ve şifrelemeyle kapanmaz; şema ve üretilmiş istemci her modülün tablolarını taşımaya devam eder (§4). İzin kataloğu, rota adları ve panel ekranları da modül varlığını gösterir — 2d yalnız İŞ MANTIĞINI gizler.

## 3. bytenode fizibilitesi

**Betik:** `Teks-Erp/scripts/olcum/bytenode-deneme.mjs` — HEDEF Node ikilisiyle koşulur (Node 24.18.0), bytenode yolu argümandır. Küçük örnek + üç paket varyantı; başlatma 7 tekrar, ilk tekrarda kimlikli duman.

**Davranış (örnek modül):**

| Özellik | Sonuç |
|---|---|
| Çalışma | doğru (`gizliHesap(3,4) === 26`, sınıf metodu doğru) |
| `fn.toString()` | kaynak YOK — aynı uzunlukta sıfır genişlikli boşluk dizisi (U+200B); sınıf için de |
| `fn.name` / `length` / sınıf adı | korunur (`gizliHesap`, 2, `LisansKapisi`) |
| Yığın | `ornek.jsc:1:<sütun>` — satır HEP 1; sütun = CJS sarmalayıcısı (62 karakter) + kaynak karakter ofseti + 1 (ölçüldü: `new Error` ofseti 54 → sütun 117). Bytenode ÖNCESİ `.cjs` + kaynak haritası arşivlenirse ofsetten satıra çevrilebilir |
| Yorum | `.jsc`te YOK |
| Dizge sabitleri | `.jsc`te DÜZ METİN (latin1/UTF-16): Türkçe hata mesajları, SQL (`pg_advisory_xact_lock`) okunur |
| Tanımlayıcı adları | minify'sız pakette `licenseGate`, `assertKursunTabletMayWrite` düz metin; **minify'lı pakette ikisi de YOK** |

**Sunucu paketi:**

| Varyant | `.cjs` → `.jsc` | Derleme | Başlatma medyanı (cjs → jsc) | RSS (cjs → jsc) | Duman (jsc) |
|---|---|---|---|---|---|
| `dis` | 5.952 → 8.368 KB | 138–151 ms | 389 → 402 ms (+3 %) | 417 → 441 MB | giriş · admin/health · lisans/durum · items · rolls hepsi 200 |
| `dis --minify` | 3.061 → 8.219 KB | 135–205 ms | 400 → 419 ms (+5 %) | 409 → 449 MB | hepsi 200 |
| `tam` | 9.954 → 12.987 KB | 224–235 ms | 377 → 332 ms (−12 %) | 483 → 496 MB | hepsi 200 (swagger CSS zaten kırık) |

`.jsc` `.cjs`ten büyüktür ve RSS artar çünkü bytenode `--no-lazy` ile HER fonksiyonu önceden derler. `tam`da ayrıştırma payı büyük olduğundan `.jsc` daha hızlı açılır.

**Uyumluluk:**

| Yükleyen | Sonuç |
|---|---|
| Node 26.8.1 (V8 farklı) | **RED** — `Invalid or incompatible cached data (cachedDataRejected)`, süreç açık hatayla düşer (sessiz yanlış çalışma yok) |
| Node 24.21.0 (V8 13.6.233.17-node.53; derleyen 13.6.233.17-node.50) | **KABUL** — örnek ve sunucu paketi yüklendi |
| Node 24.18.0 + `--max-old-space-size=4096` / `--jitless` / `--no-opt` / `--enable-source-maps` / `--stack-trace-limit=50` / `--expose-gc` | hepsi KABUL |

**Değerlendirme:** bytenode Node 24'te uygulanabilir ve iş yolunu taşır; maliyeti küçük (başlatma ±%5–12, RSS +13…+40 MB). Koruma değeri SINIRLI: dizgeler düz metin, V8 bayt kodu açık araçlarla (View8 vb.) okunur koda çevrilebiliyor — planın "yalnız YAVAŞLATICI" hükmünü ölçüm doğruluyor. Tanımlayıcıları gizleyen minify'dır, bytenode değil; ikisi birlikte kullanılmalı.

## 4. Prisma şema yorum sızıntısı

**Betik:** `Teks-Erp/scripts/olcum/prisma-yorumsuz.ts` — şemanın yorumsuz kopyasını (`//` ve `///` satırları; dizge içindeki `//` korunur) geçici dizine yazar, oradan `prisma generate` eder, sızıntı kanallarını sayar ve eşdeğerliği ölçer. DB'ye bağlanmaz; varsayılan kipte ağaca yazmaz.

| Ölçü | Kaynak şema | Yorumsuz kopya |
|---|---|---|
| Satır / bayt | 10.583 / 545 KB | 5.909 / 198 KB |
| Yorum satırı | 4.640 | 0 |
| Üretilmiş istemci: `schema.prisma` kopyası | 4.640 yorum | 0 |
| Üretilmiş istemci: `index.js` `inlineSchema` | 4.640 yorum | 0 |
| Üretilmiş istemci: `index.d.ts` JSDoc (`///` örneklem 3.268 satır) | 2.760 isabet | 0 |
| `runtimeDataModel` · `parameterizationSchema` | — | BİREBİR AYNI |
| `prisma migrate diff` (kaynak → yorumsuz) | — | **0 SQL ifadesi** (negatif sonda: bir kolon silinmiş kopya → 2 ifade) |
| `generate` süresi | — | 2,8–3,4 sn |

**Dördüncü kanal:** paket `prisma/schema.prisma`nın KENDİSİNİ de taşıyor (`deploy/paketle.ps1` prisma kopyası) — yorumlarıyla birlikte.

**Öneri (2b):** paketleme sahneye şemanın YORUMSUZ kopyasını yazar (`Copy-Item` yerine ayıklayıcı); sahnedeki `npx prisma generate` ve `-NodeModulesHaric` yolunda sunucudaki `generate` o kopyadan çalıştığı için üretilmiş istemci kendiliğinden yorumsuz olur — ayrı bir generate adımı gerekmez. Proje kökündeki `generate` (tsc tipleri için) yorumlu kalır, pakete girmez. Paket kapısı: sahnedeki `schema.prisma` ve `.prisma/client/{schema.prisma,index.js}` içinde yorum satırı 0; `runtimeDataModel` kaynakla aynı.

**Ayrı kanal — migration SQL:** 363 migration, 18.012 satır, 6.996 `--` yorum satırı pakette (çalışma anında da okunuyor). DDL'in kendisi müşterinin veritabanında zaten görünür; yorumlar gerekçe taşır. Uygulanmış migration'ın içeriğini değiştirmek sağlama toplamını değiştirir (`migrate deploy` bunu umursamaz, `migrate dev` konuşur) — soyulması ÖNERİLMEZ ya da ancak eski canlı dökümde `restore → migrate deploy` provasıyla açılır. Karar 2b sahibinde.

## 5. 2b / 2c / 2d için önerilen sınırlar

**2b paketleme hattı**

1. esbuild `dis` varyantı + `minify` (tanımlayıcı karartma dahil), `legalComments: none`, `sourcemap: external`; üçüncü taraf kod pakete ve bayt koduna GİRMEZ (`node_modules` bugünkü gibi `npm ci --omit=dev` ya da pakette; `kur.ps1` akışı değişmez). `tam` varyantı reddedilir: üçüncü taraf `__dirname` çözümünü sessizce kırıyor (§1) ve plan üçüncü taraf kodu bayt koduna çevirmeyi yasaklıyor.
2. Dosya adı sözleşmesi: `kur.ps1` ve `ecosystem.config.js` `dist\server.js` bekliyor (varlık denetimi dört yerde) → `dist/server.js` küçük, okunur yükleyici olur; paket `dist/server.jsc` (+ araçlar `dist/tools/*.cjs`; 2b-D: onlar da minify ile karartılır, §8).
3. Yükleyici `.jsc`'yi açmadan önce `process.versions.v8`, `process.platform`, `process.arch`ı derleme künyesiyle karşılaştırır; uyuşmazlıkta açık Türkçe hatayla düşer. Node YAMA sürümü tek başına ölçüt değildir (24.18 → 24.21 kabul edildi); V8 sürümü değişirse V8 zaten reddeder, yükleyici bunu anlaşılır hataya çevirir.
4. bytenode çalışma zamanı bir npm bağımlılığıdır (MIT, 1.7.0); iki seçenek: (a) onayla bağımlılık olarak eklemek, (b) aynı tekniği (`vm.Script` + `cachedData`, `--no-lazy` / `--no-flush-bytecode`) ~40 satırlık kendi yükleyicimizle yazmak — tedarik zinciri ve sürüm denetimi bizde kalır. **Öneri (b)**; derleme tarafı CI'da yine bytenode ya da aynı betikle.
5. Arşiv: her derlemenin bytenode ÖNCESİ `server.cjs` + `server.cjs.map` (≈15 MB) bizde saklanır, pakete girmez; yığındaki `:1:<sütun>`u kaynağa çeviren küçük bir araç 2b'ye girer (§3 formülü).
6. Swagger: pakette boş kalır (bugünkü gibi); istenirse derleme anında `swagger-jsdoc` kaynaktan bir kez koşup JSON gömülür — üretimde kapalı olduğu için ÖNERİLMEZ.
7. Prisma: §4 önerisi. Kapı paketin iki sızıntı sayısını (şema yorum satırı, minify sonrası seçili tanımlayıcı adları) ölçer.
8. 2b doğrulaması duman ile kalmamalı: bekçi HTTP koşucusu (`Teks-Erp/scripts/bekci-http.ts`) minify'lı + `.jsc` paketine karşı koşulur (isim/sıra bağımlı sessiz kırılma sınıfı; §1 isim taraması yalnız bilinen kalıpları gördü).

**2c native çekirdek:** 2a'nın ölçtüğü şey onu değiştirmez; tek sonuç: dizgeler `.jsc`te düz metin olduğundan güvenlik-kritik sabitler (açık anahtarlar, kira biçimi) TS'te dizge olarak durursa bayt kodundan okunur — plan zaten ANAHTAR sonucunu native'e veriyor.

**2d modül şifreleme — önerilen kapsam:**

| Sıra | Paket | Ön iş | Şifrelenen |
|---|---|---|---|
| 1 | **finance** (+ticaret, finance açıkken ticaret açık olmalı) | 4 çekirdek kancası (iş kaydı, muhasebe dışa aktarımı, cari köprüsü, sevk otomatik taslağı) + ticaret↔finance'ın 7 kenarı | 36 (+16) dosya · 834 (+353) KB |
| 2 | **devere + dokuma** (tek paket) | 7 çekirdek kancası (vardiya kapanış işi, doff bağı, levent otomatik tüketim, iki karne filtresi, fason levent servisi ×2) | 59 dosya · 517 KB |
| — | depoMulti | yok | 2 dosya · 46 KB — değer küçük, hattı sınamak için ilk deneme adayı |
| borç | production | 33 kenar; çekirdek akışın kendisi | ŞİFRELENMEZ, tavan kapısı uygulanır |
| borç | iplik | 18 kenar, dört modülden çağrılan ortak defter | ŞİFRELENMEZ (grup içinde ele alınır) |
| borç | emanet | davranış bayrağı (7 çekirdek servis) | ŞİFRELENMEZ |
| — | tezgah, kumasTeknik | yüzey yok | — |

Mimari not: esbuild CJS çıktısında kod bölme yok. Şifreli modül ayrı bir derleme olur ve çekirdeğe "yüzey" sütunundaki dosyalar kadar (finance 42, devere+dokuma 39) bağımlıdır; bu yüzey ya enjekte edilen bir kayıt nesnesiyle (çekirdek modüle `prisma`, `AuditService`, kapılar, yardımcılar verir) ya da ESM + kod bölme ile kurulur. İkisi de 2d'nin tasarım kararıdır; ölçülen yüzey büyüklüğü kayıt nesnesi yaklaşımını makul kılıyor.

## 6. Riskler ve açık uçlar

- **Platform:** tüm bayt kodu ölçümleri Mac darwin-arm64'tedir; win-x64 ve linux-x64 `.jsc` davranışı ancak CI koşucularında ölçülür (plan: `korumali-paket.yml`).
- **RSS:** paket 409–496 MB ölçüldü (tsx'siz, tek süreç); `ecosystem.config.js` `max_memory_restart: 1G`. `.jsc` +40 MB'a kadar ekliyor — sınıra uzak ama yük altında ölçülmedi.
- **Bugünkü `tsc` paketiyle başlatma karşılaştırması** yapılmadı (taban ölçülmedi).
- **Minify + isim:** yalnız bilinen `constructor.name` kalıpları tarandı; bekçi HTTP paketi minify'lı pakete karşı koşulmadan 2b inmemeli.
- **Modül grafiği** yalnız içe aktarma kenarlarını görür; Prisma üzerinden tablo okuma, izin kataloğu ve panel yüzeyi modül varlığını gizlemez.
- **bytenode yavaşlatıcıdır:** dizgeler ve (minify'sız) adlar okunur; asıl koruma 2c/2d.

## 7. Betikler ve yeniden koşum

Hepsi `Teks-Erp/` içinden, ağır iş sarmalayıcısıyla (`node ../scripts/agir-is.mjs -- …`), hedef DB `_test`:

| Betik | Ne yapar | Yan etki |
|---|---|---|
| `Teks-Erp/scripts/olcum/paket-provasi.ts` | paketler, sahne kurar, isteğe bağlı sunucuyu açar/yoklar/kapatır; `ozet.json` + `metafile.json` | yalnız `os.tmpdir()/tekserp-kod-koruma-2a/` |
| `Teks-Erp/scripts/olcum/yol-sondasi.ts` | yol çözen 10 noktanın sonucunu JSON basar | yok (okuma) |
| `Teks-Erp/scripts/olcum/modul-sinirlari.ts` | metafile'dan modül tablosu (+ `--json`) | yok |
| `Teks-Erp/scripts/olcum/bytenode-deneme.mjs` | `.jsc` üretir, davranış/başlatma/uyumluluk ölçer | paket sahnesine `server.jsc`; bytenode AĞAÇ DIŞINDA |
| `Teks-Erp/scripts/olcum/prisma-yorumsuz.ts` | yorumsuz şemadan `generate` + eşdeğerlik | geçici dizin (`--uygula` yalnız izole ağaçta) |

## 8. 2b-D — Windows duman provası (thinkpad-1, 2026-09-29)

Korumalı paketin HEDEF platformda ilk gerçek üretimi ve açılışı. Yalıtım: her şey `C:\TeksERP-korumali-prova` altında (TEMP/TMP, LOCALAPPDATA/APPDATA, npm önbelleği, kaynak haritası arşivi, git yapılandırması); testfabrika kurulumuna, pm2'ye, görevlere, güvenlik duvarına, sistem Node'una dokunulmadı; sunucu yalnız `127.0.0.1:4090`. Kaynak `lisans/2b-paket` dalının 2b ucu (`git archive` → hedefte yerel git commit); paketleyici `pwsh 7.6.6 paketle.ps1 -Korumali -Prova -WebPanelHaric -Surum 2.11.2`.

**Derleme (ölçüldü):**

| Adım | Sonuç |
|---|---|
| Toplam | 723 sn, rc 0 |
| `npm ci` (tam) | 56 sn, 436 paket (sistem Node 26.4 / npm 11.17) |
| runtime indirme | `node-v24.18.0-win-x64.zip`, SHA256 resmî kayıtla eşit, `runtime\node.exe` 88,2 MB |
| esbuild | `server.cjs` 5.191 KB, uyarı 0 |
| bytenode | `server.jsc` 12.712 KB, V8 13.6.233.17-node.50 (runtime Node ile — V8 kilidi tuttu) |
| `npm ci --omit=dev` + generate | 27 sn, 298 paket; `schema-engine-windows.exe` 19,8 MB MZ ✓ |
| Paket | 13.379 dosya / 499,8 MB → zip 154,9 MB (`Compress-Archive` ~7 dk, en yavaş adım); 363 migration |
| Prisma şeması | 4.640 yorum satırı soyuldu |
| Kaynak haritası | arşivde (`KORUMA_ARSIV_DIZINI`), `dist`te `.map` 0 |

**Bulunan kusurlar:**

1. **Araçlar okunur kaynak taşıyordu (DÜZELTİLDİ).** `dist/tools/*.cjs` karartmasızdı; `superadmin-olustur.cjs` tek başına 60 src modülünü (`src/lib/license/protocol/*` dahil) 33.884 satır ve 679 `// src/...` yol yorumuyla taşıyordu. `build-araclar --korumali` → minify: 1.262 → 683 KB, 89 satır, yol yorumu 0; paketleyici yol yorumu kalırsa durur; bekçi `test_node_surumu` §5.
2. **5.1'de yanıltıcı hata (DÜZELTİLDİ).** `paketle.ps1` pwsh 7 ister ama söylemiyordu; 5.1'de `-Korumali` Windows x64'te bile "bu hostta üretilemez" derdi. `#Requires -Version 7.0`; bekçi `test_sunucu_betikleri` §13.
3. **npm 11 `allow-scripts` (etkisiz, not).** Kurulum betikleri koşmadı; şema motoru `prisma generate` ile indi.
4. **Sistem Node'u hâlâ ön koşul (not).** `kur.ps1 [7/9]` `migrate deploy`u ve `ilk-kurulum.ps1`in araç ipucu sistem `node`unu çağırır; pm2 de sistem Node'unda koştuğu için bugün zararsız.

**Kapandı — duman ölçüldü (2b-D2, 2026-09-30).** Aynı zip ile (yeniden üretmeden) paylaşılan makinede ölçüldü; ölçüm sonunda prova izi tamamen silindi (§8.3).

### 8.1 Düşme nedeni (2b-D2 teşhisi, salt okuma)

**Sınıf: UYKU** — S0 modern bekleme; ağ kopması bunun politika gereği sonucu. Çökme/yeniden başlatma DEĞİL: son açılış 2026-09-19 12:33 (uptime 252 sa), Kernel-Power 41 · EventLog 6005/6006/6008 yok.

| Saat (TR) | Olay (System günlüğü, Kernel-Power alanları) | Anlamı |
|---|---|---|
| 29.09 19:29:07 | 105 `AcOnline=false` (pil 43,7/44,1 Wh) | şarj çekildi, makine pilde |
| 20:36:20 | 506 `Reason=12` (IdleTimeout), `LidOpenState=true`; pil 33,2 Wh | pilde 60 dk girdisizlik → ekran kapandı, 10,4 sn sonra modern bekleme |
| 20:39 – 21:42 | Netwtw10 7025/7026 + e1dexpress 27, her 3 dk | bağlı bekleme: NIC periyodik D3'ten dönüyor (~21:40'taki kısa Tailscale görünmesi) |
| 21:42:06 → 21:42:17 | 507/506 `Reason=55` (ekransız sistem uyanışı) → 172 `State=2 Reason=1` ("Policy Setting"); WLAN 8003 21:42:18 | ~66 dk sonra politika ağı kesti: bağlantısız bekleme |
| 30.09 00:30:26 | 507 `Reason=33` (touchpad), `DisconnectedStandby=true`; WLAN 8001 00:30:27 | kullanıcı dokundu, ağ döndü |
| 00:30:34 – 00:30:47 | 105 `AcOnline` true/false ×7 | şarj takıldı (soket titremesi) |

Güç planı (yalnız okundu): "Dengeli"; `powercfg /a` → S0 Low Power Idle Network Connected + Hibernate (S3 yok); `VIDEOIDLE` ve `STANDBYIDLE` **AC 0 (asla) / DC 3600 sn**; `HIBERNATEIDLE` DC asla.

**Bizim yükümüzün payı: YOK.** (a) Uyku nedeni `IdleTimeout` (12) — pil-kritik (53) ya da termal (23) değil; (b) SSH/WMI arka plan süreçleri güç isteği tutmaz: `powercfg /requests` `tar` açarken bile altı sınıfta `None` — iş makineyi uyanık TUTAMAZ, uyutmaz da; (c) Defender/Operational 20:20–00:30 arası 0 olay (1116/1117 yok). Tek katkı pil tüketimi: 19:29–20:36 derleme + zip sırasında 43,7 → 33,2 Wh (−10,5 Wh, %24) — uykunun nedeni değil. **Kök:** makine şarjdan çekilmişti ve plan pilde 60 dk girdisizlikte uyutuyor; AC'de zaman aşımı yok. Önlem runbook §3c'de (AC kapısı; güç planına dokunulmaz).

### 8.2 Duman (ölçüldü, 2026-09-30 00:40–00:48, thinkpad-1, AC'de)

Her adım WMI (`Win32_Process.Create`) ile ayrık ve **BelowNormal** öncelikte; çocuk süreçler (`tar`, sunucu) önceliği miras aldı — testfabrika'nın süreçleri normal öncelikte kaldı.

| Adım | Sonuç |
|---|---|
| Açma | eski `app\` silindi (4,8 sn); `tar -xf` (Windows yerleşik bsdtar) **14 sn**, 13.380 dosya / 499,8 MB, `tar.err` boş (`Expand-Archive` ile aynı paket dakikalar sürüyordu); Defender gerçek zamanlı tarama bu sürede `MsMpEng` +13,2 CPU-sn, tehdit 0 |
| İçerik | `dist`te `.map` 0, `sourceMappingURL` 0; `schema.prisma` 5.908 satır, yorum 0; runtime `node.exe` v24.18.0 88,2 MB; künye win-x64 / V8 13.6.233.17 / `.jsc` 13.017.528 B; `PAKET.json` `korumali=true`. Araçlar bu zipte hâlâ karartmasız (`superadmin-olustur.cjs` 1.261 KB, 33.884 satır, 679 yol yorumu) — zip araç karartma düzeltmesinden (kusur 1) ÖNCE üretildi, beklenen |
| DB + şema | prova DB (`tekserp_korumali_prova`), `migrate deploy` paketin runtime Node'u + paket şema motoruyla: rc 0, **34,9 sn, 363 migration** |
| Satıcı hesabı | `dist\tools\superadmin-olustur.cjs` gerçek terminalde (`ssh -tt` + expect): OLUŞTURULDU rc 0; parola hedefte üretildi, Mac diskine / argv'ye / loga girmedi |
| Açılış | `runtime\node.exe dist\server.js` → `/health` 200: **1,51 sn** (ilk koşu) · **5,64 sn** (ikinci koşu); `db:UP`, sürüm `2.11.2-prova.a551aa9` |
| Giriş | `bakim` yerel (127.0.0.1) giriş başarılı, TOTP istenmedi |
| Uçlar | `/api/admin/health` 200 (1.787 ms) · `/api/rolls?limit=5` 200 (2.134 ms) · `/api/work-orders?limit=5` 200 (301 ms) · `/api/admin/settings` 200 (51 ms) — ilk çağrılar, boş DB |
| Bellek | WS 330–371 MB · özel 368–393 MB · tepe WS 368–391 MB (iki koşu) |
| Sunucu uyarıları | `offsite BACKUP_DIR tanımsız` (prova `.env`i bilerek yedeksiz) · `audit-guard KORUMA KAPALI` (taze DB; `teks.audit_guard=on`u `ilk-kurulum.ps1`in DB ayarı adımı yazar, prova o adımı koşmadı) |
| Yanlış Node | sistem Node v26.4.0 ile `dist\server.js`: **çıkış 78, 0,13 sn**, açık Türkçe: "KORUMALI PAKET bu Node ile AÇILAMAZ" + bu Node V8 14.6.202.34 ↔ paket V8 13.6.233.17 + çözüm satırı (runtime Node / `ecosystem.config.js` interpreter) |
| Defender | tehdit sayısı önce 0 / sonra 0; 1116/1117/1015 olayı 0 — uyarı yok |

**Not (kusur değil, izlenecek):** `PAKET.json`da sürüm anahtarı yok (sürüm `/health`te ve zip adında); `ureten` alanı üreten makine\kullanıcı adını taşır (`THINKPAD\...`) — müşteri paketinde gerekli mi, 2c'de karar.

**Açık kalan:** araçları karartan (kusur 1 düzeltmeli) paket Windows'ta yeniden üretilip ölçülmedi; araç karartma ölçümü macOS'ta.

### 8.3 Temizlik kanıtı (2026-09-30 00:52)

- Prova süreci 0 (PID ile durduruldu; sunucu ve yanlış-Node süreçleri betik içinde PID ile kapanmıştı), `4090` dinleyen 0.
- `DROP DATABASE tekserp_korumali_prova` — ad iki kez doğrulandı, bağlantı 0; kalan DB'ler `postgres`, `tekserp_testfabrika`. Prova hiç DB rolü açmadı; roller önce/sonra aynı (`postgres`, `tekserp`, `tekserp_bakim`).
- `C:\TeksERP-korumali-prova` tamamen silindi (`rd /s /q`, 32.993 dosya / 1,29 GB, 16,9 sn; `sir\pg.txt` ve `sir\sa.txt` dahil). Kullanıcı `TEMP`i ve `C:\Windows\Temp`te prova adlı iz 0; `%USERPROFILE%\.tekserp` yok; kullanıcının `npm-cache`, `prisma-nodejs`, `.gitconfig`i Temmuz tarihli (dokunulmadı).
- testfabrika `/health` 200 (`2.11.2-lis-prova.771ac50d`, `db:UP`); pm2 süreçleri tabanla aynı PID + başlangıç zamanı (Daemon 18880 · iki fork 18096, 29940); `C:\TeksERP`, görevler, güvenlik duvarı, güç planı, PATH, sistem Node'u dokunulmadı; yeniden başlatma yok.
- Mac tarafında parola taşıyan betik/dosya yoktu (silinecek dosya çıkmadı).
