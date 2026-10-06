//! TeksERP ORTAK doğrulama — lisans çekirdeği (`lisans-cekirdek`, napi `.node`) ile güncelleyici
//! hizmetinin (`tekserp-guncelleyici`) TEK doğrulama kodu: JWS compact + Ed25519, güven zinciri
//! (kök → ALT/İNDİRME/BAYİ sertifikası → belge), belge şemaları, derlemeye gömülü güven çapası,
//! PAKET imzalı bütünlük listesi.
//!
//! TEK KAYNAK TS protokolüdür (`Teks-Erp/src/lib/license/protocol/`); bu crate onun AYNASIDIR.
//! Eşlik `lisans-cekirdek`in vektör testi (`tests/vektorler.rs`) ve TS kâhin bekçisiyle
//! (`test_lisans_native_kahin`) ölçülür — kâhin bu dizinin kaynak metnini de okur (§0).
pub mod anchor;
pub mod b64;
pub mod chain;
pub mod integrity;
pub mod integrity_list;
pub mod iso;
pub mod jsonx;
pub mod jws;
pub mod outcome;
pub mod paket_zinciri;
pub mod schema;
