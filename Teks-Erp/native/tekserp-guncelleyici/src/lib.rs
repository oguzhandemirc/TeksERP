//! TeksERP güncelleyici hizmeti (`TeksERP-Guncelleyici`, LocalSystem) — yerel sözleşme
//! `docs/design/GUNCELLEYICI.md` §4–§13.
//!
//! Güncelleyici YALNIZ satıcı imzalı veriye güvenir: kira (gömülü kök zinciriyle), sürüm bildirimi ve
//! paket (PAKET anahtarı + bütünlük listesi) — doğrulama kodu `tekserp-dogrulama`, lisans çekirdeğiyle
//! AYNI kod; sözleşme (§1–§3, D1) TS protokolünün aynası `release` + `decision`. Niyet dosyası (backend
//! yazar) yetki değildir; yalnız panel onayını ve indirme belirtecini taşır. Uygulama çökme güvenlidir: her adım önce işlem günlüğüne iner, açılışta yarım
//! işlem sürdürülür ya da geri alınır (§7). Çekirdek platformdan bağımsızdır (`env::Env` üzerinden
//! dosya/hizmet/süreç/ağ/saat); Windows bağları `windows` modülünde.
pub mod codes;
pub mod decision;
pub mod download;
pub mod engine;
pub mod env;
pub mod health;
pub mod history;
pub mod ids;
pub mod ipc;
pub mod journal;
pub mod layout;
pub mod lock;
pub mod operation;
pub mod package;
pub mod pgminor;
pub mod policy;
pub mod release;
pub mod selfupdate;
pub mod settings;
pub mod tools;
pub mod trust;
pub mod version;
pub mod wait;

#[cfg(windows)]
pub mod windows;
