# Native Cargo çalışma alanı (Rust)

> **Ne:** TeksERP'in Rust kodu tek çalışma alanında: tek `Cargo.lock`, tek `target/`, tek derleme profili, tek `rustfmt.toml`/`.cargo/config.toml` (Windows'ta CRT statik). Doğrulama kodu BİR KEZ yazılır; `.node` eklentisi ve hizmet ikilileri aynı kodu bağlar.

| Üye | Ne | Kendi belgesi |
|---|---|---|
| `lisans-cekirdek/` | napi `.node` — backend'e yüklenen lisans çekirdeği (parmak izi, modül anahtarı, DPAPI, JSON sınırı) | `lisans-cekirdek/CLAUDE.md` · `docs/design/LISANS-NATIVE-CEKIRDEK.md` |
| `tekserp-dogrulama/` | ORTAK doğrulama: JWS/Ed25519 · güven zinciri · belge şemaları · gömülü güven çapası · PAKET bütünlük listesi (TS protokolünün aynası) | bu dosya § Kurallar |
| `tekserp-guncelleyici/` | `TeksERP-Guncelleyici` Windows hizmeti (SYSTEM): indir · doğrula · uygula · geri dön; çökme güvenli durum makinesi | `docs/design/GUNCELLEYICI.md` §4–§13 |
| `tekserp-hizmet/` | `TeksERP-Backend` hizmet konağı: `current\runtime\node.exe dist\server.js`i ortam + günlükle koşar | `docs/design/GUNCELLEYICI.md` §4.3 |

## Kurallar

- `tekserp-dogrulama` TS protokolünün (`Teks-Erp/src/lib/license/protocol/`) AYNASIDIR: kural önce TS'te değişir, sonra burada; eşlik `lisans-cekirdek`in vektör testi ve kâhin bekçisiyle (`Teks-Erp/scripts/test_lisans_native_kahin.ts`, kaynak metni iki crate'ten okur) ölçülür. Modül dosya adları iki crate'te TEKİLDİR (kâhin §0l).
- Güven çapası YALNIZ derlemeye gömülüdür (`tekserp-dogrulama/src/anchor.rs`, `Teks-Erp/scripts/guven-capasi-ekle.ts` yazar). Hizmet ikilileri çapayı dışarıdan ALMAZ; `test-anchor` benzeri enjeksiyon yalnız test derlemesinde.
- C bağımlılığı eklenmez (saf Rust; Windows API'leri `windows-sys`/`windows-service`); yeni crate yönetici onayıyla.
- Tanımlayıcılar İngilizce; tel/şema anahtarları, kod değerleri, günlük/ileti metinleri Türkçe.

## Komutlar (bu dizinde; `lisans-cekirdek/`teki `npm run denetle`/`npm test` buraya delege eder)

| Komut | Ne |
|---|---|
| `npm run denetle` | `cargo fmt --all --check` + clippy (uyarı = hata): bütün alan · lisans çekirdeği napi'siz · hizmet crate'leri `x86_64-pc-windows-msvc` hedefinde (yalnız denetim; hedef std'si yoksa ⏭ beyan) |
| `npm test` | `cargo test` bütün alan (lisans çekirdeği napi'siz + test çapasıyla) |

Commit kapısı bu dizini `Teks-Erp/`den ayrı TEK proje sayar (`scripts/hooks/lib/staged.mjs`); cargo yoksa ⏭ beyanla geçer, ölçüm CI'da (`ci.yml` "Native" · `native-windows.yml`).
