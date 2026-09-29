# Native lisans çekirdeği (Faz 2c) — arayüz, biçimler, derleme

> **Durum:** Faz 2c, 2026-09-29, dal `lisans/2c-native` (taban `lisans/entegrasyon`). Plan: `docs/design/LISANS-KOD-KORUMA.md` §5 Faz 2 (2c). Kurallar: `docs/kurallar/lisans.md` § Native lisans çekirdeği. Arşiv: `docs/history/CLAUDE-NOT-ARSIVI.md` (2026-09-29, native çekirdek notu).
> **Tek kaynak TS protokolüdür** (`Teks-Erp/src/lib/license/protocol/`): native çekirdek onun AYNASIDIR ve TS test kâhini olarak kalır. Ayrışırsa TS kazanır; ayna düzeltilir, vektör dosyası yeniden üretilir.
> **Kapsam:** yalnız arayüz + düşme davranışı + bekçi. Motorun (`runtime.ts`, `state.ts`, `license-sync.service.ts`) native'e bağlanması ve zorunluluk bayrağının açılması Faz 2b/2e'nindir (§9).

## 0. Özet

| Parça | Nerede | Ölçüm |
|---|---|---|
| Rust çekirdeği (napi-rs) | `Teks-Erp/native/lisans-cekirdek/` | `cargo test` 6 birim + vektör dosyası (289 kayıt) · clippy üç hedefte temiz |
| Arayüz + TS uygulaması | `Teks-Erp/src/lib/license/license-core.ts` | TS protokolünün kendisi — kâhin |
| Yükleyici · adaptör | `Teks-Erp/src/lib/license/native.ts` · `Teks-Erp/src/lib/license/native-adapter.ts` | dosya yok / bozuk / künye uyuşmaz / zorunlu kip dalları bekçide; native yanıtı sözleşme şemalarından geçer |
| Bütünlük (2e arayüzü) · modül anahtarı (2d arayüzü) | `Teks-Erp/src/lib/license/integrity.ts` · `Teks-Erp/src/lib/license/module-key.ts` | TS başvurusu = native ile aynı vektörler |
| OS parmak izi toplayıcısı (TS) | `Teks-Erp/src/lib/license/fingerprint-os.ts` (F5 `fingerprint.ts`te) | native toplayıcıyla aynı makinede aynı özet |
| Kâhin bekçisi | `Teks-Erp/scripts/test_lisans_native_kahin.ts` · vektörler `Teks-Erp/scripts/lib/lisans-cekirdek-vektor.ts` | darwin-arm64 34/0 · **gerçek Windows (thinkpad-1) 33/0 test derlemesi, 34/0 + 2 beyanlı atlama üretim derlemesi** · linux-x64 (Docker amd64, glibc 2.36) 34/0 |

## 1. Mimari

```
çağıran (2b/2e'den sonra: runtime/state) ──► getLicenseCore(): LicenseCore
                                              ├─ native  (.node, künyesi uyuyorsa)   ── üretimde ZORUNLU
                                              ├─ ts      (tsLicenseCore = protokolün kendisi)  ── yalnız zorunlu değilken
                                              └─ yok     (zorunlu kipte native kullanılamıyor: her doğrulama CEKIRDEK_YOK)
```

- **Arayüz** (`LicenseCore`): `verifyJws` · `verifyCertificate` · `verifyEntitlement` · `verifyLease` · `checkLeaseBinding` (iki belgeyi doğrular VE bağlar — JS'ten gelen "doğrulanmış" görünüme güvenilmez) · `normalizeFactor` · `digestFingerprint` · `collectFingerprint` (OS f1..f4 + çağıranın F5'i → yalnız tuzlu özet) · `verifyIntegrity` · `unwrapModuleKey`. Sonuç `CoreResult<T>` = protokolün `Result<T>`'si + çekirdek kodları. Görünümler yalnız VERİ taşır (anahtar nesnesi, imza baytı dışarı çıkmaz).
- **Yükleyici aday sırası:** `TEKSERP_LISANS_CEKIRDEK` ortam yolu → paket düzeni `app/native/lisans-cekirdek.<platform>-<arch>[-abi].node` → geliştirme düzeni `Teks-Erp/native/lisans-cekirdek/dist/…`. Dosya adı napi-rs adlandırması: `darwin-arm64` · `win32-x64-msvc` · `linux-x64-gnu`.
- **Künye kararı** (`identityRejection`, saf): arayüz sürümü (`abi`) + platform + mimari eşit olmalı; zorunlu kipte test çapalı derleme `TEST_DERLEMESI` ile RED.
- **Zorunlu kip** (`__TEKSERP_NATIVE_REQUIRED__`, derleme sabiti): TS'e DÜŞÜLMEZ (yamalı JS'e kaçış olmasın), ortam yolu OKUNMAZ (yamalı `.node` enjekte edilemesin), yalnız paket yolu. Kullanılamayan çekirdek istisna ATMAZ: doğrulamalar `CEKIRDEK_YOK`, parmak izi ölçülemedi, bütünlük `GECERSIZ(CEKIRDEK_YOK)` — lisans merdiveni (uyarı → ek süre → kısıtlı) işler, süreç düşmez.
- **Native yanıtı sözleşme şemalarından geçer** (Zod: belge şemaları, sonuç zarfı, kod kümesi): native'deki bir hata sessiz kabul üretemez; sözleşmeye uymayan yanıt `CEKIRDEK_YOK`'tur. JWS yükü kopyalanmadan geçer (`z.record` `__proto__` anahtarını prototipe yazıp yükten düşürürdü — vektörle yakalandı).
- **Panik** JS istisnasına döner (`#[napi(catch_unwind)]`, iş parçacığı görevlerinde `catch_unwind`); `panic = "unwind"` bilerek (abort backend'i düşürürdü). Süreç başlatan/dosya özetleyen çağrılar (`collectFingerprint`, `verifyIntegrity`) libuv havuzunda koşar, olay döngüsü bloke olmaz.

## 2. JSON sınırı (ABI 1)

Her dışa aktarım JSON metni alır, JSON metni döndürür (napi nesne eşlemesi yok — sürümler arası kırılgan değil). `api.rs` fonksiyonlarını hem napi yapıştırıcısı hem `cargo test` çağırır: test edilen yüzey Node'un gördüğü yüzeydir.

| İhraç | İstek | Yanıt |
|---|---|---|
| `kunye()` | — | `{ad, surum, abi, platform, arch, hedef, profil, testCapasi, protokolKodlari, cekirdekKodlari, yerTutucular, windowsSondasi, modulHkdfOneki}` |
| `builtinAnchor()` | — | `{roots: [{kid, x, classes}], packageKeys: [{kid, x}]}` |
| `verifyJws` | `{token, typ, keys: [{kid, x}]}` | `{ok, value: {header, payload}}` · `{ok: false, code, message}` |
| `verifyCertificate` | `{token, usage, atMs (null = NaN), roots?}` | `{document, rootKid, allowedClasses}` |
| `verifyEntitlement` · `verifyLease` | `{token, roots?}` | `{document, signer}` · `{document, subCertificate}` |
| `checkLeaseBinding` | `{lease, entitlement, roots?}` | `true` |
| `normalizeFactor` | `{factor, raw}` | `{value}` |
| `digestFingerprint` | `{raw: {f1..f5}, salt}` | `{f1..f5}` (tuz < 16 bayt → istisna, TS gibi) |
| `collectFingerprint` (Promise) | `{salt, f5}` | `{digest, measured}` |
| `verifyIntegrity` (Promise) | `{manifest, root, keys?}` | `{ok, value: IntegrityReport}` |
| `unwrapModuleKey` | `{wrap, privateKey, modul}` | `{ok, value: {anahtar}}` |

`roots?`/`keys?` verilmezse GÖMÜLÜ çapa. Biçim kırılırsa `api::ABI` ve `NATIVE_ABI` birlikte artar (bekçi §0f eşitliği ölçer).

## 3. Güven çapası

- Çapa native ikiliye **gömülüdür** (`src/anchor.rs` = `ROOT_PUBLIC_KEYS` + `PACKAGE_PUBLIC_KEYS`, bekçi §0e hem kaynak metinden hem çalışan ikiliden ölçer). Üretim çağıranı çapayı native'e VERMEZ.
- Dışarıdan çapa yalnız `test-anchor` cargo özellikli derlemede kabul edilir; özelliksiz (üretim) derleme `CAPA_ENJEKSIYONU_KAPALI` döner (bekçi §7b, ölçüldü darwin + Windows). Paketleme (2b) özelliksiz derlemeyi taşır; yükleyici zorunlu kipte test çapalı derlemeyi reddeder.

## 4. Eşlik — nerede ve nasıl

- **Denetim SIRASI da aynadır** (kod eşliği): JWS başlık JSON → `alg` (başka alana bakılmadan) → allowlist dışı alan → `typ` → `kid` → yük → imza uzunluğu; zincirde çapa → ayrıştırma → kök → imza → şema → kullanım → sınıf → zaman → anahtar; kira çapadan ÖNCE ayrıştırılır.
- **Zod aynası:** `z.object` tanımadığı anahtarı atar (Rust da atar, iç içe dahil), `strictObject` (parmak izi, bütünlük dosya girdisi) reddeder; dizge boyu UTF-16 kod birimi; `.int()` güvenli tamsayı; `z.iso.datetime()` ve `z.uuid()` desenleri canlı Zod'dan ölçülür (bekçi §0h: Rust'taki HER regex TS kaynağında ya da canlı Zod deseninde birebir).
- **Tarih:** V8 `Date.parse` ES biçimi birebir (kesir ilk üç hane KESİLİR, `24:00` ertesi gün, gün 1–31 taşar); Zod'dan geçmiş her damga dar alt kümede.
- **Ed25519:** cofactor'suz doğrulama, kanonik olmayan S RED (OpenSSL ile aynı); nokta olmayan açık anahtar imzasız sayılır (TS'te içe aktarılır, doğrulama düşer → ikisi de `JWS_IMZA`).
- **Beyanlı sapmalar** (yalnız imzasız saldırı girdisinde; iki tarafta da belge REDDEDİLİR, yalnız kod farklı olabilir): eşlenmemiş vekil kaçışı (`"\ud800"`) ve 128'den derin JSON serde'de ayrıştırma hatasıdır · imza anı hesabında V8'in eski ayrıştırıcısına düşen biçimler (küçük harf `t`/`z`, boşluk ayırıcı, `+0100`, saat dilimsiz yerel saat) native'de NaN'dır.

## 5. Parmak izi

- Toplayıcı iki uygulamada **aynı ham değeri** okumalıdır: Faz 1 kiralarının kabul edilen kümesi TS toplayıcısıyla ölçüldü; native farklı okursa yükseltmeden sonra parmak izi "uyuşmaz" olurdu. Windows'ta AYNI PowerShell sondası koşulur (satır satır aynı metin, bekçi §0d + §3b); Linux'ta aynı dosyalar aynı sırayla (Node `readdirSync` bayt sırasıyla sıralar — native de sıralar; JS `trim` kümesi U+FEFF'i kırpar, U+0085'i kırpmaz); macOS'ta aynı `ioreg` çağrısı.
- **Ölçüm (§6a, aynı tuz):** darwin-arm64 f1 + f4 · **thinkpad-1 (gerçek Windows) f1 + f2 + f3 + f4 dördü de ölçüldü, iki toplayıcı birebir** · Linux (Docker amd64) `/etc/machine-id` bağlanınca f1 birebir; konteynerde disk (f3) ve DMI (f2/f4) ölçülemedi → bekçi §6b bunu "ikisi de boş" eşitliği saymaz, beyanla atlar.

## 6. Bütünlük v1 — Faz 2e'nin biçimi için arayüz

JWS `typ: tekserp-butunluk`, imzalayan PAKET anahtarı (`kid` `paket-<…>`). Yük:

```json
{ "v": 1, "paketId": "<uuid>", "urun": "backend", "surum": "2.12.0", "derlemeTarihi": "<ISO Z>",
  "musteri": "<kod>" | null,
  "dosyalar": [ { "yol": "dist/server.jsc", "sha256": "<base64url 43>", "boyut": 123 } ] }
```

- `yol` göreli POSIX (`[A-Za-z0-9_.@+-]` segmentleri, `.`/`..`, ters eğik çizgi, sürücü harfi, baştaki `/` RED, ≤ 512), tekrarsız; dosya girdisi KATI nesne; 1–20 000 dosya.
- **Karar sırası:** çapa boş/biçimsiz → `OLCULEMEDI(BUTUNLUK_CAPA_BOS)` · imza/şema → `GECERSIZ(<protokol kodu>)` · kök dizin değil → `OLCULEMEDI(BUTUNLUK_OKUNAMADI)` · eksik (yok ya da dosya değil) veya değişmiş (boy ya da sha256) dosya → `GECERSIZ(BUTUNLUK_UYUSMAZ)` · yalnız okunamayan → `OLCULEMEDI(BUTUNLUK_OKUNAMADI)` · aksi `GECERLI`. Rapor listeleri 50'de kesilir, sayılar tam.
- Listede olmayan fazla dosya bu sürümde sorulmaz (paket `node_modules` taşır) — kapsam 2e'nin kararı. `PACKAGE_PUBLIC_KEYS` bugün BOŞ (PAKET anahtarı 2e'de): gömülü çapayla her denetim `OLCULEMEDI` (erken kısıt yok). Yeni `typ` protokolün `TYP` kayıt defterine P0'ın dilimiyle girmelidir (bugün yalnız JWS deseni `^tekserp-[a-z]+$` ile geçer).

## 7. Modül anahtarı sarması v1 — Faz 2d için arayüz

`{v: 1, modul: "<modül anahtarı>", epk: <32 bayt>, sarili: <32 anahtar + 16 etiket>}`: geçici X25519 → ortak sır → HKDF-SHA256 (tuz = `epk ‖ alıcı açık`, bilgi = `tekserp/modul-anahtari/v1␟<modül>`) → AES-256-GCM (sıfır nonce — anahtar her sarmada tektir). `.tkenc` alıcı sarmasının kalıbıdır; fark, HKDF bilgisine giren modül adıdır (bir modülün sarması başkasının yerine geçemez, vektörle ölçüldü). Kodlar: `MODUL_SARMA_BICIM` · `MODUL_UYUSMAZ` · `MODUL_ANAHTAR_GECERSIZ` (biçimsiz özel anahtar ya da düşük mertebeli nokta — OpenSSL türetmeyi reddeder, Rust sıfır sırrı yakalar) · `MODUL_SARMA_ACILAMADI`. Sarma satıcı tarafındadır (`wrapModuleKey`, TS). **2d'ye not:** "güvenlik-kritik sonuç anahtardır" ilkesi için açma native'de kira doğrulamasına BAĞLANMALI (sarma kiradan okunur, kira native'de doğrulanır, anahtar yalnız geçerli kirayla döner); kurulumun X25519 anahtarı bugün yok (`store.ts` `x25519: null`).

## 8. Derleme ve hedefler

Komutlar `Teks-Erp/native/lisans-cekirdek/` içinde (araç zinciri ve kurulum: o dizinin `CLAUDE.md`'si):

| Komut | Çıktı | Not |
|---|---|---|
| `npm run derle` / `derle:uretim` | `dist/` test çapalı · `dist-uretim/` özelliksiz | yerel hedef (`napi build --platform --release --no-js`) |
| `npm run derle:win[:uretim]` | `lisans-cekirdek.win32-x64-msvc.node` | Mac'ten `napi build -x` (cargo-xwin); CRT STATİK (`.cargo/config.toml`) — ölçüldü: statiksiz derleme `VCRUNTIME140.dll` ister, statikle yalnız sistem DLL'leri |
| `npm run derle:linux[:uretim]` | `lisans-cekirdek.linux-x64-gnu.node` | `cargo zigbuild --target x86_64-unknown-linux-gnu.2.28` (zig PATH'te); betik en yüksek GLIBC sembolünü ölçer, 2.28'i aşarsa DÜŞER (ölçüldü: 2.28) |
| `npm run denetle` · `npm test` | — | `cargo fmt --check` + clippy (uyarı = hata) · `cargo test` (vektörler) |

Hedef ölçümü: **darwin-arm64** yerel 34/0 · **win-x64** thinkpad-1'de (Node 26.4, gerçek Windows) test derlemesi 33/0, üretim derlemesi zorunlu kipte kabul + çapa enjeksiyonu reddi · **linux-x64-gnu** Docker `linux/amd64` (Node 24.21, glibc 2.36) 34/0. Linux arm64 derlenmedi (plan "[+ arm64]"; ihtiyaç doğunca aynı betiğe hedef eklenir).

## 9. Faz 2b/2e'ye devir

- **Derleme sabiti:** paketleyici esbuild'e `define: { __TEKSERP_NATIVE_REQUIRED__: "true" }` verir; `.node` paket düzeninde `app/native/<dosya>`. Geliştirmede sabit tanımsızdır → zorunlu değil (bekçi §0i).
- **Korumalı paket iş akışı** (2b sahipliği): native derleme adımları — `windows-latest`: `rustup toolchain install stable --profile minimal` → `npm ci` (native klasörü) → `npx napi build --platform --release --no-js --target x86_64-pc-windows-msvc --output-dir dist-uretim` (Windows'ta yerel; CRT statik config'ten); `ubuntu-latest`: yerel `napi build` koşucunun glibc'sine (2.35+) bağlanır — üretim ikilisi için `pip install ziglang` ya da zig + `cargo install cargo-zigbuild` → `npm run derle:linux:uretim` (GLIBC ≤ 2.28 kapısı betikte). Her iki koşucuda özelliksiz derlemeden SONRA test çapalı derleme + `npx tsx scripts/test_lisans_native_kahin.ts` (`TEKSERP_STRICT=1`) kıyası koşulur; paket yalnız özelliksiz çıktıyı taşır.
- **Motor bağlantısı (bu dilimde YAPILMADI):** `state.ts` `verifyLicenseDocuments` + `license-sync.service.ts` doğrulamaları + `fingerprint.ts` ölçümü `getLicenseCore()`e geçer; `runtime.ts` `butunluk: "KAPSAM_DISI"` → `verifyIntegrity` sonucu. Yükleyici durumu (`getLicenseCoreStatus`) sağlık özetine ve lisans ekranına girer.
- **Açık risk:** native kendi bütünlüğünü doğrulayamaz (değiştirilmiş `.node` her şeyi "geçerli" diyebilir) — imzalı dosya listesi `.node`u da kapsamalı ve liste denetimi en az bir ikinci noktada (örgülü denetim, plan Tur 4) yapılmalı. Kira + parmak izi + yoksa şifreli modül (2d) bu riski sınırlar, kapatmaz (plan §12).

## 10. Bekçi ve vektörler

- `test_lisans_native_kahin` (DB'siz): §0 statik aynalar · §1 yükleyici (dosya yok · zorunlu · platform · bozuk `.node` · ortam yolu · aday sırası · künye kararı) · §2 vektör dosyası bayatlık + kod kapsamı · §3–§7 native (yoksa "⏭ ATLANDI — native yok", 7 kontrol sayılı; `TEKSERP_STRICT=1`de kırmızı) · §8 kalıcı K sondaları. Vektör dosyası: `npx tsx scripts/test_lisans_native_kahin.ts --vektor-yaz` (TS kâhini yazar; 289 kayıt: JWS 39 · sertifika 34 · HAK 39 · kira 36 · bağ 7 · normalleştirme 49 · özet 6 · bütünlük 33 · modül 14 · tarih 32).
- `cargo test` aynı dosyayı Rust tarafında koşar (tarih vektörleri dahil — native'in tarih ucu yok).
- Negatif sondalar (her biri uygulandı/geri alındı sha ile, geri alınınca 34/0): alg denetimi · parmak izi katılığı · UTF-16 boy · kesir yuvarlama · yer tutucu · Windows sondası · HKDF modül bağı · gömülü kök · bayi modül tavanı · zorunlu kipte TS'e düşme · regex tek yanlı değişim · sertifika zaman toleransı · zorunlu kipte test derlemesi reddi — 13'ü de kırmızı (ayrıntı `Teks-Erp/docs/BEKCI-HARITASI.md` `## lisans`).
