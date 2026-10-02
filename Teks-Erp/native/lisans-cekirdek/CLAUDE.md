# Native lisans çekirdeği (Rust + napi-rs) — Faz 2c

> **Ne:** fabrikanın lisans doğrulamasının native aynası — JWS/EdDSA + güven zinciri (lisans v2: ara imzacı · iptal · ufuk · veriliş · bayt bağı) + belge şemaları, parmak izi toplama + tuzlu özet + eşleşme kararı (v1 · v2 standart/zayıf), bütünlük denetimi (2e arayüzü), modül anahtarı açma (2d arayüzü). Node'a `.node` eklentisi olarak yüklenir (`Teks-Erp/src/lib/license/native.ts`).
> **Tek kaynak TS protokolüdür** (`Teks-Erp/src/lib/license/protocol/`); bu crate onun AYNASIDIR. Tasarım ve sözleşme: `docs/design/LISANS-NATIVE-CEKIRDEK.md`. Kurallar: `docs/kurallar/lisans.md` § Native lisans çekirdeği.

## Kurallar (bu dizine dokunmadan önce)

- Doğrulama/şema/parmak izi kuralı önce TS'te değişir; sonra bu crate ve vektör dosyası AYNI commit'te: `cd Teks-Erp && npx tsx scripts/test_lisans_native_kahin.ts --vektor-yaz` → `npm test` (burada) → kâhin bekçisi. Vektör dosyaları (`test-vektorleri/protokol.json` + lisans v2 `protokol-v2.json` + parmak izi toplama `toplama.json` — `--vektor-yaz --yalniz-toplama`, cargo `tests/toplama.rs`) elle düzenlenmez; v2'nin `istek` ailesi native dışıdır (fabrika istek doğrulamaz), öteki her v2 türü `tests/vektorler.rs`te en az bir kayıtla koşmalı.
- Yeni napi işlevi `native-adapter.ts` `BINDING_FUNCTIONS` listesine AYNI commit'te girer: liste eski ikiliyi reddetmenin tek yoludur (aynı ABI'de yayınlanmamış ekleme — kâhin §1h).
- Native'e iptal belgesi JWS METNİ olarak verilir ve burada aynı çapayla yeniden doğrulanır; JS'ten doğrulanmış görünüm alınmaz.
- Denetim SIRASI da aynadır (hata kodu eşliği) — yeni bir denetimi TS'teki yerine koy.
- Rust'a yeni regex yazılırsa TS kaynağında birebir karşılığı olmalı (`\d` yerine `[0-9]`: Rust'ta `\d` Unicode'dur); bekçi §0h ölçer.
- `test-anchor` özelliği (dışarıdan güven çapası) YALNIZ geliştirme/test derlemesinde. Gömülü çapa İKİ kiptir ve bir ikili TEK kipi taşır: özelliksiz derleme ÜRETİM kökleri + PAKET anahtarları (`npm run derle:*:uretim` → `dist-uretim/`), `hazirlik-capasi` HAZIRLIK olanları (`npm run derle:*:hazirlik` → `dist-hazirlik/`). `src/anchor.rs`in dört bloğu TS `PRODUCTION_`/`STAGING_ROOT_PUBLIC_KEYS` + `…_PACKAGE_PUBLIC_KEYS` aynasıdır ve her blok kendi kipinin `cfg`siyle kapılıdır (öteki kipin baytı ikiliye girmez); künye `capaKipi` taşır, TS yükleyicisi kendi kipinden farklı ikiliyi açmaz. Paketin native'i kanalın kipiyle derlenir (`deploy/kanallar.json` `backend.guvenCapasi`).
- Windows parmak izi sondası (`src/collect.rs` `WINDOWS_PROBE_LINES`) TS `fingerprint-os.ts` ile, yol tablosu (`src/paths.rs` `PATHS`) TS `fingerprint-paths.ts` `FINGERPRINT_PATH_LINES` ile satır satır aynıdır; birini değiştiren ikisini değiştirir. Seçim (`paths.rs`) G/Ç'siz ve her platformda derlenir — Windows/Linux mantığı Mac'te de `toplama.json` vektörleriyle sınanır; G/Ç `collect.rs`te kalır. Yol tablosu künyede (`parmakIziYollari`) de gider: taşımayan eski ABI-3 ikilisi açılmaz.
- C bağımlılığı yok (saf Rust kripto: ed25519-dalek, x25519-dalek, RustCrypto) — çapraz derleme basit kalsın; yeni crate eklemeden önce onay.
- `panic = "unwind"` bilerek (napi `catch_unwind` → JS istisnası; abort backend'i düşürürdü). Yapıştırıcı (`src/napi_api.rs`) ince kalır: JSON al → `api.rs` → JSON ver.
- Tanımlayıcılar İngilizce; tel/şema anahtarları, kod değerleri, mesajlar Türkçe.

## Araç zinciri (bir kez, sudo'suz)

- Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal` → `~/.cargo/bin/rustup component add rustfmt clippy` → `rustup target add x86_64-pc-windows-msvc x86_64-unknown-linux-gnu`.
- Windows çapraz derleme: `napi build -x` cargo-xwin'i kendisi kurar (MSVC CRT/SDK başlıklarını indirir).
- Linux çapraz derleme: zig (ör. `~/.local/zig-<sürüm>/zig`, PATH'e) + `cargo install cargo-zigbuild --locked`.
- `npm ci` bu dizinde (yalnız `@napi-rs/cli`).

## Komutlar

| Komut | Ne |
|---|---|
| `npm run derle` | yerel hedef, test çapalı → `dist/` (kâhin bekçisi buradan yükler) |
| `npm run derle:uretim` | yerel hedef, özelliksiz (ÜRETİM çapası) → `dist-uretim/` |
| `npm run derle:hazirlik` | yerel hedef, `hazirlik-capasi` (HAZIRLIK çapası) → `dist-hazirlik/` |
| `npm run derle:win` · `derle:win:uretim` · `derle:win:hazirlik` | win-x64 (cargo-xwin, CRT statik) |
| `npm run derle:linux` · `derle:linux:uretim` · `derle:linux:hazirlik` | linux-x64-gnu, glibc 2.28 tabanı (zigbuild; GLIBC tavanını betik ölçer) |
| `npm run denetle` | `cargo fmt --check` + clippy (uyarı = hata, dört özellik kümesi: napi/çıplak × üretim/hazırlık) — commit kapısının tip adımı |
| `npm test` | `cargo test` (birim + TS vektörleri) İKİ kipte (üretim + `hazirlik-capasi`) — commit kapısının test adımı |

Kâhin bekçisi: `cd Teks-Erp && npx tsx scripts/test_lisans_native_kahin.ts` (native yoksa "⏭ ATLANDI — native yok", `TEKSERP_STRICT=1`de kırmızı). Çapa değişince (`guven-capasi-ekle.ts`) `dist/`, `dist-uretim/` ve `dist-hazirlik/` YENİDEN derlenir: kâhin §3d derlenmiş her ikilinin `builtinAnchor()`ını KENDİ kipinin TS çapasıyla kıyaslar (bayat ikili kırmızı), §9 iki kip ikilisini gömülü çapa vektörleriyle sınar. Commit kapısı bu projeyi `Teks-Erp/`den ayrı sayar (dosya en özgül projeye aittir); cargo yoksa ⏭ beyanla geçer, ölçüm CI "Native lisans çekirdeği" job'ında.
