//! Açılan paketin dizinleri umask'tan bağımsız, güncelleyicinin izin ölçümünden (`Fs::foreign_writers`,
//! `IZIN_GUVENSIZ`) geçecek kiple doğar: `kur`/`gecis` (`kurulum::oci_paketi`) ve güncelleme hazırlığı
//! (`Fs::extract_tar`, ara dizinler dahil). Süreç geneli umask'ı değiştirdiği için bu dosyada TEK test vardır.
#![cfg(unix)]
mod common;

use common::*;
use ed25519_dalek::SigningKey;
use std::path::Path;
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_guncelleyici::env::{Fs, RealFs};
use tekserp_guncelleyici::package::ExtractLimits;

fn guvenli(p: &Path) {
    let yabanci = RealFs.foreign_writers(p).unwrap();
    assert!(yabanci.is_empty(), "{}: {yabanci:?} — güncelleyici IZIN_GUVENSIZ ile reddeder", p.display());
}

#[test]
fn gevsek_umaskta_acilan_dizinler_izin_olcumunden_gecer() {
    let d = std::env::temp_dir().join(format!("tekserp-izin-umask-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(d.join("surumler")).unwrap();
    let k = SigningKey::from_bytes(&[41; 32]);
    let trust = PackageTrust::embedded(vec![("paket-2026".into(), x_of(&k))]);
    let tar = d.join(oci_package_name(NEW));
    std::fs::write(&tar, ustar_of(&oci_files(NEW, &oci_default_updater(), &k, "paket-2026", None, &|_| {}))).unwrap();

    let eski = unsafe { libc::umask(0) };
    let kurulum = tekserp_guncelleyici::kurulum::oci_paketi(&tar, &d.join("surumler").join(NEW), &trust);
    let hazirlik = d.join("is").join("hazirlik").join(NEW);
    let acma = RealFs.extract_tar(&tar, &hazirlik, &tekserp_guncelleyici::oci::members(NEW), &ExtractLimits::default());
    unsafe { libc::umask(eski) };

    kurulum.unwrap();
    acma.unwrap();
    guvenli(&d.join("surumler").join(NEW));
    for p in [d.join("is"), d.join("is").join("hazirlik"), hazirlik] {
        guvenli(&p);
    }
    let _ = std::fs::remove_dir_all(&d);
}
