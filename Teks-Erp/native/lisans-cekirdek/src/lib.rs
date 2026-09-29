//! TeksERP lisans çekirdeği (Faz 2c) — JWS/EdDSA doğrulama ve güven zinciri, parmak izi
//! toplama + tuzlu özet, bütünlük denetimi, modül anahtarı açma.
//!
//! TEK KAYNAK TS protokolüdür (`Teks-Erp/src/lib/license/protocol/`): bu çekirdek onun
//! AYNASIDIR ve TS test kâhini olarak kalır. Eşlik iki yerde ölçülür: aynı vektör dosyası
//! (`test-vektorleri/protokol.json`) burada `cargo test` ile, TS'te `test_lisans_native_kahin`
//! ile; o bekçi ayrıca çalışan `.node`u canlı üretilen vektörlerde TS'le karşılaştırır.
pub mod anchor;
pub mod api;
pub mod b64;
pub mod chain;
pub mod collect;
pub mod fingerprint;
pub mod integrity;
pub mod integrity_list;
pub mod iso;
pub mod jsonx;
pub mod jws;
pub mod module_key;
pub mod outcome;
pub mod schema;

// Test derlemesinde napi makrosu kayıt kodu üretmez; yapıştırıcı yalnız eklenti derlemesinde.
#[cfg(all(feature = "napi", not(test)))]
mod napi_api;
