//! TeksERP backend hizmet konağı (`TeksERP-Backend`) + iki Windows hizmetinin ORTAK yardımcıları.
//!
//! Konak `<KOK>\current\runtime\node.exe dist\server.js`i `<KOK>\ayar\backend.env` ortamıyla koşar,
//! çıktısını döner günlüğe yazar, SCM durdurmasını node'a stdin `kapat` satırıyla iletir ve node
//! beklenmedik çıkarsa hata koduyla çıkar (SCM kurtarması yeniden başlatır). Sözleşme:
//! `docs/design/GUNCELLEYICI.md` §4.2–§4.3. Güncelleyici (`tekserp-guncelleyici`) hizmet adlarını,
//! SCM denetimini ve olay günlüğünü bu crate'ten alır — tek kaynak. Tanımlayıcılar İngilizce; dosya,
//! hizmet ve anahtar adları ile iletiler Türkçe (yerel sözleşmenin kendisi).
pub mod contract;
pub mod envfile;
pub mod host;
pub mod logfile;
pub mod timefmt;

#[cfg(windows)]
pub mod windows;
