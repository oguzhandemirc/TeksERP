//! Kendini güncelleme (§10): paketteki daha yeni ikili yan dosyaya kopyalanır, künyesi sınanır, çalışan
//! ikiliyle yer değiştirir; yeni ikili doğrulanmadan 3 açılışı aşarsa eskisi geri konur (A/B sayacı).
mod common;

use common::*;
use std::path::PathBuf;
use tekserp_guncelleyici::selfupdate::{self, Startup};
use tekserp_guncelleyici::trust::ANCHOR_MODE;

fn exe_json(name: &str, version: &str) -> String {
    exe_json_mode(name, version, Some(ANCHOR_MODE))
}

fn exe_json_mode(name: &str, version: &str, mode: Option<&str>) -> String {
    let mut k = serde_json::json!({ "ad": name, "surum": version, "hedef": "windows", "testCapasi": false });
    if let Some(m) = mode {
        k["capaKipi"] = m.into();
    }
    k.to_string()
}

/// Kurulu ikili 0.1.0 (guncelleyici\), paket (current\runtime\) 9.9.9 taşır.
fn setup(tag: &str, packaged: Option<String>) -> (World, PathBuf) {
    let w = World::new(tag, Setup { intent: None, ..Setup::default() });
    let own = w.layout.updater_dir().join("tekserp-guncelleyici.exe");
    std::fs::write(&own, exe_json("tekserp-guncelleyici", "0.1.0")).unwrap();
    if let Some(p) = packaged {
        std::fs::write(w.layout.version_dir(OLD).join("runtime").join("tekserp-guncelleyici.exe"), p).unwrap();
    }
    (w, own)
}

fn read(p: &PathBuf) -> String {
    std::fs::read_to_string(p).unwrap_or_default()
}

#[test]
fn stages_newer_binary_and_verifies_on_boot() {
    let (w, own) = setup("kendi", Some(exe_json("tekserp-guncelleyici", "9.9.9")));
    let env = w.env();
    assert_eq!(selfupdate::stage_with_version(&env, &w.layout, &own, &w.layout.version_dir(OLD), "0.1.0"), Ok(true));
    assert!(read(&own).contains("9.9.9"), "yeni ikili asıl adda");
    let old = own.with_file_name("tekserp-guncelleyici.eski.exe");
    assert!(read(&old).contains("0.1.0"), "eski ikili yanda");
    // Yeni ikilinin ilk açılışı: sayaç 1, doğrulama eskisini siler.
    assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "9.9.9"), Startup::Continue);
    selfupdate::mark_healthy(&env, &w.layout, &own, "9.9.9");
    assert!(!old.exists(), "doğrulanınca .eski.exe silinir");
    assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "9.9.9"), Startup::Continue);
    assert!(read(&own).contains("9.9.9"));
}

#[test]
fn unverified_new_binary_is_reverted_after_three_boots() {
    let (w, own) = setup("geri", Some(exe_json("tekserp-guncelleyici", "9.9.9")));
    let env = w.env();
    assert_eq!(selfupdate::stage_with_version(&env, &w.layout, &own, &w.layout.version_dir(OLD), "0.1.0"), Ok(true));
    for boot in 1..=3 {
        assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "9.9.9"), Startup::Continue, "açılış {boot}");
    }
    assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "9.9.9"), Startup::RevertedRestart, "4. açılış doğrulanmadan: geri");
    assert!(read(&own).contains("0.1.0"), "eski ikili asıl adda");
    assert!(read(&own.with_file_name("tekserp-guncelleyici.bozuk.exe")).contains("9.9.9"));
    // Eski ikiliyle açılış: tekrar geri alma yok.
    assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "0.1.0"), Startup::Continue);
}

#[test]
fn interrupted_swap_leaves_old_binary_working() {
    let (w, own) = setup("yarim", Some(exe_json("tekserp-guncelleyici", "9.9.9")));
    let env = w.env();
    // Kopya + künye sınaması yapıldı, yeniden adlandırmadan ÖNCE ölüm: `.yeni.exe` ve HAZIRLANDI kalır.
    let fresh = own.with_file_name("tekserp-guncelleyici.yeni.exe");
    std::fs::create_dir_all(w.layout.work()).unwrap();
    std::fs::write(&fresh, exe_json("tekserp-guncelleyici", "9.9.9")).unwrap();
    std::fs::write(
        w.layout.self_update_file(),
        serde_json::json!({ "durum": "HAZIRLANDI", "eskiSurum": "0.1.0", "yeniSurum": "9.9.9", "acilis": 0, "zaman": "2026-10-01T00:00:00Z" }).to_string(),
    )
    .unwrap();
    assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "0.1.0"), Startup::Continue);
    assert!(!fresh.exists(), "yarım kalan yeni ikili temizlenir");
    assert!(read(&own).contains("0.1.0"));
}

#[test]
fn not_newer_or_foreign_binary_is_ignored() {
    let (w, own) = setup("ayni", Some(exe_json("tekserp-guncelleyici", "0.1.0")));
    let env = w.env();
    assert_eq!(selfupdate::stage_with_version(&env, &w.layout, &own, &w.layout.version_dir(OLD), "0.1.0"), Ok(false));
    assert!(read(&own).contains("0.1.0"));
    let (w, own) = setup("yabanci", Some(exe_json("baska-arac", "9.9.9")));
    let env = w.env();
    assert!(selfupdate::stage_with_version(&env, &w.layout, &own, &w.layout.version_dir(OLD), "0.1.0").is_err());
    assert!(read(&own).contains("0.1.0"), "yabancı ikili yerleşmez");
    let (w, own) = setup("yok", None);
    assert_eq!(selfupdate::stage_with_version(&w.env(), &w.layout, &own, &w.layout.version_dir(OLD), "0.1.0"), Ok(false));
}

/// G3: güven çapası kurulumun kimliğidir — paketteki daha yeni güncelleyici öteki kipte (ya da kipsiz) ise
/// yerleşmez; SYSTEM ikilisi kendini güncellemeyle hazırlık ↔ üretim arasında geçemez.
#[test]
fn other_anchor_mode_binary_is_refused() {
    let other = if ANCHOR_MODE == "uretim" { "hazirlik" } else { "uretim" };
    for (tag, mode) in [("oteki-kip", Some(other)), ("kipsiz", None)] {
        let (w, own) = setup(tag, Some(exe_json_mode("tekserp-guncelleyici", "9.9.9", mode)));
        let env = w.env();
        let r = selfupdate::stage_with_version(&env, &w.layout, &own, &w.layout.version_dir(OLD), "0.1.0");
        assert!(r.as_ref().is_err_and(|e| e.contains("çapa kipini")), "{tag}: {r:?}");
        assert!(read(&own).contains("0.1.0"), "{tag}: kurulu ikili yerinde");
        assert!(!own.with_file_name("tekserp-guncelleyici.yeni.exe").exists(), "{tag}: yan dosya açılmadı");
        assert!(!w.layout.self_update_file().exists(), "{tag}: kendini güncelleme durumu yazılmadı");
    }
}
