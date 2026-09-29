# Native lisans çekirdeği (Faz 2c) — arayüz, biçimler, derleme

> **Durum:** Faz 2c, 2026-09-29, dal `lisans/2c-native` (taban `lisans/entegrasyon`). Plan: `docs/design/LISANS-KOD-KORUMA.md` §5 Faz 2 (2c). Kurallar: `docs/kurallar/lisans.md` § Native lisans çekirdeği. Arşiv: `docs/history/CLAUDE-NOT-ARSIVI.md` (2026-09-29, native çekirdek notu).
> **Tek kaynak TS protokolüdür** (`Teks-Erp/src/lib/license/protocol/`): native çekirdek onun AYNASIDIR ve TS test kâhini olarak kalır. Ayrışırsa TS kazanır; ayna düzeltilir, vektör dosyası yeniden üretilir.
> **Kapsam:** yalnız arayüz + düşme davranışı + bekçi. Motorun (`runtime.ts`, `state.ts`, `license-sync.service.ts`) native'e bağlanması ve zorunluluk bayrağının açılması Faz 2b/2e'nindir (§9).

## 0. Özet

| Parça | Nerede | Ölçüm |
|---|---|---|
| Rust çekirdeği (napi-rs) | `Teks-Erp/native/lisans-cekirdek/` | `cargo test` 6 birim + vektör dosyası (319 kayıt) · clippy üç hedefte temiz |
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

## 2. JSON sınırı (ABI 2 — tek sürümde iki değişiklik, ikisi de yayınlanmadan: Faz 2d kiradan açma + yerel koruma · 2e-S bütünlük yükü liste dosyasına bağlı, rapora `fazla`)

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
| `unwrapLeaseModuleKey` (ABI 2) | `{lease, entitlement, privateKey, modul, kid, roots?}` | `{ok, value: {anahtar, surum}}` |
| `protectLocal` · `unprotectLocal` (ABI 2) | `{veri}` (base64url) | `{ok, value: {veri}}` — Windows DPAPI; başka platformda `KORUMA_YOK` |

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

## 6. Bütünlük — imzalı yük + liste dosyası (Faz 2e-S, arayüz sürümü 2)

JWS `typ: tekserp-butunluk`, imzalayan PAKET anahtarı (`kid` `paket-<…>`). Yük (tanınmayan üst alan atılır — ör. filigranın `kurulumId`i):

```json
{ "v": 1, "paketId": "<uuid>", "urun": "backend", "surum": "2.12.0", "derlemeTarihi": "<ISO Z>",
  "musteri": "<kod>" | null,
  "liste": { "sha256": "<base64url 43>", "boyut": 1234, "dosyaSayisi": 15210 },
  "kapsam": { "dizinler": ["dist", "native", "node_modules", "prisma/migrations"], "dosyalar": ["package.json", "kur.ps1"] } }
```

- `liste` ve `kapsam` KATI nesne; kapsam yolları göreli POSIX (`[A-Za-z0-9_.@+-]` segmentleri, `.`/`..` RED, ≤ 512), tekrarsız, en çok 32 dizin / 64 dosya; `liste.boyut` 1…64 MB, `dosyaSayisi` 1…200 000.
- Liste dosyası `butunluk-liste.txt` (paket kökü): `<sha256>\t<boyut>\t<yol>\n`; yalnız yazdırılabilir ASCII + TAB + LF, son satır LF, yollar bayt sırasıyla kesin artan (tekrar yok), yol segmenti `/ \ : * ? " < > |` içermez, `.`/`..` değil, boşluk serbest; satır sayısı `dosyaSayisi`na eşit; boyut ≤ 2^53−1, baştaki sıfır yok.
- **Karar sırası:** çapa boş/biçimsiz → `OLCULEMEDI(BUTUNLUK_CAPA_BOS)` · imza/şema → `GECERSIZ(<protokol kodu>)` · kök dizin değil → `OLCULEMEDI(BUTUNLUK_OKUNAMADI)` · liste dosyası yok (eksik) / boy-özet-dilbilgisi tutmaz (değişik) → `GECERSIZ(BUTUNLUK_LISTE_BOZUK)`, okunamaz → `OLCULEMEDI(BUTUNLUK_OKUNAMADI)` · eksik (yok ya da dosya değil) veya değişmiş (boy ya da sha256) dosya → `GECERSIZ(BUTUNLUK_UYUSMAZ)` · imzalı kapsamda listede olmayan girdi → `GECERSIZ(BUTUNLUK_FAZLA)` · yalnız okunamayan (dosya ya da kapsam dizini) → `OLCULEMEDI(BUTUNLUK_OKUNAMADI)` · aksi `GECERLI`. Rapor listeleri (`eksik` · `degisik` · `okunamayan` · `fazla`) 50'de kesilir, sayılar tam.
- **2e-S (arayüz sürümü 2):** liste JWS'te değil, sha256'sı imzalı ayrı dosyada (`butunluk-liste.txt`, `src/integrity_list.rs` ↔ `integrity-list.ts`; biçim kararı `LISANS-KOD-KORUMA.md` §13.8). Native imzalı `kapsam`ta listede olmayan FAZLA girdiyi de sorar (sembolik bağ izlenmez; okunamayan dizin ÖLÇÜLEMEDİ); karar sırası eksik/değişmiş → `BUTUNLUK_UYUSMAZ` · fazla → `BUTUNLUK_FAZLA` · okunamayan → `BUTUNLUK_OKUNAMADI`; liste dosyası yok/özet/dilbilgisi → `BUTUNLUK_LISTE_BOZUK`. TS ikinci katmanı (`integrity-check.ts`) FAZLA'yı imzalı kapsamda yeniden arar. `PACKAGE_PUBLIC_KEYS` = [`paket-hazirlik`] (yalnız TEST/DEMO, sınıf kuralı TS'te), üretim anahtarı ayrı tören. Tür protokolün `TYP` kayıt defterindedir (`TYP.BUTUNLUK`; TS `INTEGRITY_TYP` ondan okur, Rust `TYP_BUTUNLUK` aynasıdır — kâhin §0j ölçer); liste sabitleri kâhin §0k'da.

## 7. Modül anahtarı sarması v1 — Faz 2d için arayüz

`{v: 1, modul: "<modül anahtarı>", epk: <32 bayt>, sarili: <32 anahtar + 16 etiket>}`: geçici X25519 → ortak sır → HKDF-SHA256 (tuz = `epk ‖ alıcı açık`, bilgi = `tekserp/modul-anahtari/v1␟<modül>`) → AES-256-GCM (sıfır nonce — anahtar her sarmada tektir). `.tkenc` alıcı sarmasının kalıbıdır; fark, HKDF bilgisine giren modül adıdır (bir modülün sarması başkasının yerine geçemez, vektörle ölçüldü). Kodlar: `MODUL_SARMA_BICIM` · `MODUL_UYUSMAZ` · `MODUL_ANAHTAR_GECERSIZ` (biçimsiz özel anahtar ya da düşük mertebeli nokta — OpenSSL türetmeyi reddeder, Rust sıfır sırrı yakalar) · `MODUL_SARMA_ACILAMADI`. Sarma satıcı tarafındadır (`wrapModuleKey`, protokolün `modul-anahtari.ts`i). **Faz 2d (YAPILDI, 2026-09-30):** açma kira doğrulamasına bağlandı — `unwrapLeaseModuleKey` kira + HAK'ı doğrular ve bağlar, modül HAK'ta ∧ dondurulmamış olmalı, kiranın `modulAnahtarlari` listesinde (modül, kid) hakkı aranır, sarma kurulumun X25519 özel yarısıyla açılır ve açılan anahtarın özeti (`mk-` + sha256(önek ␟ anahtar) 22 karakter) kid'e eşit olmalı; kodlar `MODUL_HAK_YOK` · `MODUL_DONMUS` · `MODUL_ANAHTARI_YOK` · `MODUL_KID_UYUSMAZ`. Kurulumun X25519'u kurulum anahtar dosyasındadır (eski kurulumda ilk yoklamada doğar). Yerel koruma (`protectLocal`, Windows DPAPI FFI, ek entropi `tekserp/modul-onbellek/v1`) modül anahtarı önbelleği içindir. Ayrıntı: `docs/kurallar/lisans.md` § Modül şifreleme (Faz 2d).

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
- **Motor bağlantısı (2e'de YAPILDI):** `state.ts` `verifyLicenseDocuments` + `license-sync.service.ts` doğrulamaları + `fingerprint.ts` ölçümü `getLicenseCore()`den (`core-bridge.ts`); `runtime.ts` `butunluk` açılış + günlük denetimden (`integrity-check.ts` · `integrity-state.ts`), derleme tarihi imzalı künyeden; yükleyici durumu sağlık bloğunda (`cekirdek`). Lisans ekranına yükleyici durumu henüz girmedi.
- **Açık risk (2e'de sınırlandı):** native kendi bütünlüğünü doğrulayamaz — imzalı liste `.node`u kapsar ve zorunlu kipte yükleyici `.node`u dlopen ÖNCESİ TS'te listeye karşı denetler (ikinci nokta, `packagedNativeRejection`). Yamalı JS + yamalı `.node` birlikte bu iki noktayı da atlayabilir; kira + parmak izi + şifreli modül (2d) riski sınırlar, kapatmaz (plan §12).

## 10. Bekçi ve vektörler

- `test_lisans_native_kahin` (DB'siz): §0 statik aynalar · §1 yükleyici (dosya yok · zorunlu · platform · bozuk `.node` · ortam yolu · aday sırası · künye kararı) · §2 vektör dosyası bayatlık + kod kapsamı · §3–§7 native (yoksa "⏭ ATLANDI — native yok", 7 kontrol sayılı; `TEKSERP_STRICT=1`de kırmızı) · §8 kalıcı K sondaları. Vektör dosyası: `npx tsx scripts/test_lisans_native_kahin.ts --vektor-yaz` (TS kâhini yazar; 319 kayıt: JWS 39 · sertifika 34 · HAK 41 · kira 52 · bağ 7 · normalleştirme 49 · özet 6 · bütünlük 33 · modül 14 · kiradan modül 12 · tarih 32).
- `cargo test` aynı dosyayı Rust tarafında koşar (tarih vektörleri dahil — native'in tarih ucu yok).
- Negatif sondalar (her biri uygulandı/geri alındı sha ile, geri alınınca 34/0): alg denetimi · parmak izi katılığı · UTF-16 boy · kesir yuvarlama · yer tutucu · Windows sondası · HKDF modül bağı · gömülü kök · bayi modül tavanı · zorunlu kipte TS'e düşme · regex tek yanlı değişim · sertifika zaman toleransı · zorunlu kipte test derlemesi reddi — 13'ü de kırmızı; I3-1c'de dört sonda daha: kirada `sunucuSaati` isteğe bağlı · HAK'ta `kurulumId` isteğe bağlı (ikisi §4a/§5a + `cargo test`) · Rust `TYP_BUTUNLUK` değeri · TS `TYP` adı (ikisi §0j) (ayrıntı `Teks-Erp/docs/BEKCI-HARITASI.md` `## lisans`).

## 11. P0 protokolüne uyum (I3-1c, 2026-09-29)

- **Ölçüm** (`git diff 4cabcaa3 lisans/p0-protokol -- Teks-Erp/src/lib/license/`): P0 yalnız satıcı uçlarının sözleşmesini değiştirdi — `RequestSchema`/`istek.ts` (kurulum kimliği etkinleştirme ve taşımada boş olabilir), `uclar.ts` (16 karakterlik kod, taşıma kodu, `ortam.installationId`, `saat.saticiSapmaSn`, yanıtta `kurulumId`/`kodTuru`, `TASIMA_KODU_GEREKLI`, hata ayrıntısında imzasız `sunucuSaati`) ve `state-rules.ts` `SAAT_KAYIK`. Bunlar fabrikada TS'te kalır (istek imzalama, uç gövdeleri, yanıt okuma); native yüzey (HAK · kira · sertifika · bütünlük · modül anahtarı · parmak izi) değişmedi, Rust'ta P0 için kod değişikliği gerekmedi.
- **P0'ın native'e dokunan iki kuralı vektörle sabitlendi:** imzasız satıcı saati güvenilir saate girmez, imzalı tek saat kaynağı kiranın `sunucuSaati`dir (D4) ve lisans kimliği kiradır (D14; istekte boş kimlik meşru, kira ve HAK'ta değil). 7 vektör: kira `sunucuSaati` yok/saatsiz, kira `kurulumId` yok/boş/null, HAK `kurulumId` yok/boş — hepsi iki uygulamada `BELGE_SEMA`.
- **`tekserp-butunluk` kayıt defterinde:** `TYP.BUTUNLUK` (satıcı ve patron aynası bayt-eşit); kâhin §0j Rust'taki her `TYP_*` sabitini ad ve değerle ölçer.
- **Hedef ölçümü:** darwin-arm64 kâhin 37/0 (`TEKSERP_STRICT=1`) · `cargo test` 6 + 2 · fmt + clippy temiz · win-x64 (cargo-xwin) ve linux-x64-gnu (zigbuild, GLIBC 2.28) test ve üretim derlemesi başarılı. Bu dilimde yalnız DERLEME ölçüldü; Windows'ta ve Linux'ta çalıştırma ölçümü 2c'nin ölçümüdür (thinkpad-1 kullanılmadı).
