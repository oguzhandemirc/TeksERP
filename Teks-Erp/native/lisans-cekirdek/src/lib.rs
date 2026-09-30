//! TeksERP lisans çekirdeği (Faz 2c) — JWS/EdDSA doğrulama ve güven zinciri, parmak izi
//! toplama + tuzlu özet, bütünlük denetimi, modül anahtarı açma.
//!
//! TEK KAYNAK TS protokolüdür (`Teks-Erp/src/lib/license/protocol/`): bu çekirdek onun
//! AYNASIDIR ve TS test kâhini olarak kalır. Eşlik iki yerde ölçülür: aynı vektör dosyası
//! (`test-vektorleri/protokol.json`) burada `cargo test` ile, TS'te `test_lisans_native_kahin`
//! ile; o bekçi ayrıca çalışan `.node`u canlı üretilen vektörlerde TS'le karşılaştırır.
//!
//! Doğrulama (JWS · zincir · şemalar · gömülü çapa · bütünlük) ORTAK `tekserp-dogrulama`
//! crate'indedir; güncelleyici hizmeti de aynı kodu bağlar. Modüller burada yeniden dışa
//! verilir: `lisans_cekirdek::jws` ile `tekserp_dogrulama::jws` AYNI moduldür.
pub use tekserp_dogrulama::{anchor, b64, chain, integrity, integrity_list, iso, jsonx, jws, outcome, schema};

pub mod api;
pub mod collect;
pub mod fingerprint;
pub mod local_protect;
pub mod module_key;

// Test derlemesinde napi makrosu kayıt kodu üretmez; yapıştırıcı yalnız eklenti derlemesinde.
#[cfg(all(feature = "napi", not(test)))]
mod napi_api;
