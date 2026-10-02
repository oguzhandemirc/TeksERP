# Native Cargo çalışma alanı (Rust)

> **Ne:** TeksERP'in Rust kodu tek çalışma alanında: tek `Cargo.lock`, tek `target/`, tek derleme profili, tek `rustfmt.toml`/`.cargo/config.toml` (Windows'ta CRT statik). Doğrulama kodu BİR KEZ yazılır; `.node` eklentisi ve hizmet ikilileri aynı kodu bağlar.

| Üye | Ne | Kendi belgesi |
|---|---|---|
| `lisans-cekirdek/` | napi `.node` — backend'e yüklenen lisans çekirdeği (parmak izi, modül anahtarı, DPAPI, JSON sınırı) | `lisans-cekirdek/CLAUDE.md` · `docs/design/LISANS-NATIVE-CEKIRDEK.md` |
| `tekserp-dogrulama/` | ORTAK doğrulama: JWS/Ed25519 · güven zinciri · belge şemaları · gömülü güven çapası · PAKET bütünlük listesi (TS protokolünün aynası) | bu dosya § Kurallar |
| `tekserp-guncelleyici/` | `TeksERP-Guncelleyici` Windows hizmeti (SYSTEM): indir · doğrula · uygula · geri dön; çökme güvenli durum makinesi; güncelleme sözleşmesinin (D1) Rust aynası `release.rs` + `decision.rs` | `docs/design/GUNCELLEYICI.md` §0–§13 |
| `tekserp-hizmet/` | `TeksERP-Backend` hizmet konağı: `current\runtime\node.exe dist\server.js`i ortam + günlükle koşar | `docs/design/GUNCELLEYICI.md` §4.3 |

## Kurallar

- `tekserp-dogrulama` TS protokolünün (`Teks-Erp/src/lib/license/protocol/`) AYNASIDIR: kural önce TS'te değişir, sonra burada; eşlik `lisans-cekirdek`in vektör testi ve kâhin bekçisiyle (`Teks-Erp/scripts/test_lisans_native_kahin.ts`, kaynak metni iki crate'ten okur) ölçülür. Modül dosya adları iki crate'te TEKİLDİR (kâhin §0l).
- Güncelleme sözleşmesinin (`protocol/guncelleme*.ts`) aynası güncelleyicidedir (`release.rs` · `decision.rs` · `version.rs`; kiranın `guncelleme` şeması ortak `schema.rs`te): ortak vektörler `test-vektorleri/guncelleme-*.json` TS kâhininin çıktısıdır, ELLE düzenlenmez (üretici D1'in TS kâhini, `--vektor-yaz`); Rust eşliği `tekserp-guncelleyici/tests/sozlesme_vektorleri.rs` + `tekserp-dogrulama/tests/guncelleme_kira.rs`.
- `tekserp-hizmet/src/envfile.rs` backend'in `.env` okuyucusunun (dotenv, kilit dosyasındaki sürüm) AYNASIDIR: kural dotenv'den gelir, burada icat edilmez (içerikten hata yok, biçimsiz satır sessiz); ortak vektörler `test-vektorleri/env-dosyasi.json` gerçek dotenv'in çıktısıdır (üreten `Teks-Erp/scripts/test_env_okuyucu.ts --vektor-yaz`), ELLE düzenlenmez; Rust eşliği `tekserp-hizmet/tests/env_dosyasi_vektorleri.rs` + `tekserp-guncelleyici/tests/ayar_env.rs` (zorunlu anahtar → `AYAR_EKSIK`).
- Güven çapası YALNIZ derlemeye gömülüdür (`tekserp-dogrulama/src/anchor.rs`, `Teks-Erp/scripts/guven-capasi-ekle.ts` yazar) ve TEK kaynaktır — açık anahtar başka bir `.rs`te durmaz (kâhin §0m). Çapa İKİ kiptir, bir ikili TEK kipi taşır: özelliksiz ÜRETİM, `hazirlik-capasi` HAZIRLIK (özellik ortak crate'te; `lisans-cekirdek` ve `tekserp-guncelleyici` kendi `hazirlik-capasi`larıyla iletir). Kip SEÇİMDİR, toplamsal değil: iki kip AYNI cargo çağrısında derlenmez (özellik birleşmesi hepsini hazırlığa çeker). Hizmet ikilileri çapayı dışarıdan ALMAZ; `test-anchor` benzeri enjeksiyon yalnız test derlemesinde.
- C bağımlılığı eklenmez (saf Rust; Windows API'leri `windows-sys`/`windows-service`); yeni crate yönetici onayıyla.
- Tanımlayıcılar İngilizce; tel/şema anahtarları, kod değerleri, günlük/ileti metinleri Türkçe.

## Hizmetler — kurallar

- Yerel sözleşme (dizinler, hizmetler, IPC, güven, adımlar) `docs/design/GUNCELLEYICI.md` §4–§13'tedir; dizin/ortam adlarının Rust tek kaynağı `tekserp-hizmet/src/contract.rs` (= backend `hizmet-duzeni.ts` `SERVICE_DIRS`). Ad değişirse iki taraf birlikte değişir.
- Güncelleyici çekirdeği platformdan bağımsızdır: dünyaya YALNIZ `env::Env` (dosya · hizmet · süreç · ağ · saat · olay · DPAPI) üzerinden dokunur; Windows bağları `src/windows/`. Yeni bir yan etki `Env` dışından yapılmaz (öldür-yeniden başlat ölçümü onu göremez).
- Her uygulama adımı TEKRARLANABİLİR yazılır ve işlem günlüğüne önce BAŞLADI iner; yeni adım/telafi `tests/crash_restart.rs`in "her noktada öldür" döngüsünden geçmeden inmez. Değişmezler `tests/common/mod.rs` `assert_invariants`.
- SYSTEM, backend'in yazabildiği dizine YAZMAZ; oradan `Fs::read_untrusted` ile okur (bağlantı izlemez, boy sınırlı). Güncelleme öncesi yedek ve geçici anahtar yalnız `guncelleme\is\` (korumalı DACL) altında.
- Sır (parola, belirteç, `.env` değeri) günlüğe, duruma, argümana girmez: parola yalnız çocuk sürecin `PGPASSWORD` ortamına; araç çıktısı `settings::redact`ten geçer.

## Komutlar (bu dizinde; `lisans-cekirdek/`teki `npm run denetle`/`npm test` buraya delege eder)

| Komut | Ne |
|---|---|
| `npm run denetle` | `cargo fmt --all --check` + clippy (uyarı = hata): bütün alan · lisans çekirdeği napi'siz — ikisi de İKİ çapa kipinde · hizmet crate'leri `x86_64-pc-windows-msvc` hedefinde (yalnız denetim; hedef std'si yoksa ⏭ beyan) |
| `npm test` | `cargo test` bütün alan (lisans çekirdeği napi'siz + test çapasıyla; güncelleyicinin öldür-yeniden başlat paketi ~1 dk) + HAZIRLIK kipinde ortak crate · güncelleyicinin `capa_kipi` + `self_update` testleri · lisans çekirdeği |
| `npm run derle:hizmetler:win` | Mac'ten iki Windows ikilisi (cargo-xwin, CRT statik, ÜRETİM çapası) → `target/x86_64-pc-windows-msvc/release/` — thinkpad-1 provası için; CI yapıtı `native-windows.yml` |
| `npm run derle:hizmetler:win:hazirlik` | aynı, HAZIRLIK çapalı güncelleyici (`hazirlik-capasi`) → AYRI hedef dizin `target/hazirlik/x86_64-pc-windows-msvc/release/` (hazırlık kanalının paketi: `paketle.ps1 -HizmetIkiliDizini` bu dizin) |

Tanı (Windows'ta, yönetici): `tekserp-guncelleyici.exe durum --kok <KOK> [--veri <VERİ>]` · `tur --kok <KOK>` (tek tur ön planda; yarım işlemi de sonuçlandırır) · `tekserp-hizmet.exe on-planda --kok <KOK> [--ad <ad>] [--dogrulama]` (stdin'e satır = durdur). Hizmet adları parametredir (`--ad`; aynı makinede ikinci kanal — `docs/design/GUNCELLEYICI.md` §4.2).

Commit kapısı bu dizini `Teks-Erp/`den ayrı TEK proje sayar (`scripts/hooks/lib/staged.mjs`); cargo yoksa ⏭ beyanla geçer, ölçüm CI'da (`ci.yml` "Native" · `native-windows.yml` — gerçek SCM dumanı `scripts/duman-windows.ps1`).
