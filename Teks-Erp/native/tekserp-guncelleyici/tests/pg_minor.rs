//! PostgreSQL küçük sürümü (D4 §5 U0–U11, §9): yan yana açılış + içerik manifestosu, ImagePath +
//! `pgsql\bin` bağlantısı, ICU değiştiyse yeniden dizinleme, sorunda eski yola dönüş; PG adımı
//! backend'den ÖNCE ve PG düşerse backend'e dokunulmaz; harici kipte PG'ye hiç dokunulmaz.
mod common;

use common::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::env::{Fs, RealFs, SvcState};
use tekserp_guncelleyici::ipc::State;

const OLD_TAG: &str = "16.9-1";
const NEW_TAG: &str = "16.15-4";

fn hex(b: &[u8]) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn pg_files(version: &str, icu: &str) -> Vec<(String, Vec<u8>)> {
    vec![
        ("bin/postgres".into(), b"#!fake postgres".to_vec()),
        ("bin/pg_ctl".into(), b"#!fake pg_ctl".to_vec()),
        ("bin/psql".into(), b"#!fake psql".to_vec()),
        ("bin/SURUM".into(), version.as_bytes().to_vec()),
        (format!("bin/icuuc{icu}.dll"), b"icu".to_vec()),
        ("share/timezone/UTC".into(), b"tz".to_vec()),
    ]
}

fn image_for(root: &Path, tag: &str) -> String {
    format!(
        "\"{}\" runservice -N \"TeksERP-PostgreSQL\" -D \"{}\" -w",
        root.join("pgsql").join(tag).join("bin").join("pg_ctl").display(),
        root.join("pgveri").display()
    )
}

/// Kendi PG örneği (16.9-1) + sunucuda 16.15-4 paketi ve onu isteyen manifest.
fn pg_world(tag: &str, kind: &str, new_icu: &str) -> World {
    let w = World::new(tag, Setup::default());
    let root = w.layout.root.clone();
    for (p, c) in pg_files("16.9", "67") {
        let f = root.join("pgsql").join(OLD_TAG).join(&p);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, c).unwrap();
    }
    RealFs.set_link(&w.layout.pg_bin_link(), &root.join("pgsql").join(OLD_TAG).join("bin")).unwrap();
    std::fs::create_dir_all(root.join("pgveri")).unwrap();
    std::fs::write(root.join("pgveri").join("PG_VERSION"), "16\n").unwrap();
    let instance = json!({
        "bicim": 1, "kip": kind, "hizmet": PG, "surum": "16.9", "derleme": "1",
        "ikiliDizin": root.join("pgsql").join(OLD_TAG), "oncekiIkiliDizin": null,
        "veriDizini": root.join("pgveri"), "port": 5432, "kuruldu": "2026-09-01T00:00:00Z", "guncellendi": null,
    });
    std::fs::write(w.layout.pg_instance_file(), serde_json::to_vec_pretty(&instance).unwrap()).unwrap();
    {
        let mut svcs = w.svcs.lock().unwrap();
        let pg = svcs.get_mut(PG).unwrap();
        pg.image = image_for(&root, OLD_TAG);
        pg.version = Some("16.9".into());
    }
    // PG paketi: sahne + `shasum -c` biçiminde içerik manifestosu.
    let files = pg_files("16.15", new_icu);
    let mut manifest_text = String::new();
    for (p, c) in &files {
        manifest_text.push_str(&format!("{}  {p}\n", hex(c)));
    }
    let mut all = files.clone();
    all.push(("TEKSERP-ICERIK.sha256".into(), manifest_text.clone().into_bytes()));
    let pg_zip = zip_of(&all);
    let pg_path = format!("/{CHANNEL}/backend/pg/{NEW_TAG}.zip");
    // Backend manifestine pg bloğu (backend paketi aynı).
    let backend_zip = w.files.lock().unwrap().get(&format!("/{CHANNEL}/backend/{NEW}/paket.zip")).cloned().unwrap();
    let manifest = manifest_for(
        &w.keys.package,
        "paket-2026",
        NEW,
        &backend_zip,
        Some(json!({ "pg": {
            "cizgi": "16", "enAz": "16.9",
            "hedef": { "surum": "16.15", "derleme": "4", "paket": pg_path, "boyut": pg_zip.len(), "sha256": sha_b64u(&pg_zip),
                       "icerikSha256": sha_b64u(manifest_text.as_bytes()), "icuSurum": new_icu },
        } })),
    );
    let mut served = w.files.lock().unwrap();
    served.insert(pg_path, pg_zip);
    served.insert(format!("/{CHANNEL}/backend/{NEW}/manifest.jws"), manifest.into_bytes());
    drop(served);
    w
}

fn instance(w: &World) -> Value {
    serde_json::from_slice(&std::fs::read(w.layout.pg_instance_file()).unwrap()).unwrap()
}

fn pg_link(w: &World) -> PathBuf {
    RealFs.link_target(&w.layout.pg_bin_link()).unwrap().unwrap()
}

/// PG'nin üç kaydı (ImagePath · `pgsql\bin` · ornek.json) ve çalışan sürüm TUTARLI mı; hangi sürüm.
fn pg_consistent(w: &World, ctx: &str) -> &'static str {
    let pg = w.svcs.lock().unwrap().get(PG).cloned().unwrap();
    assert_eq!(pg.state, SvcState::Running, "{ctx}: PG çalışmıyor");
    let inst = instance(w);
    let (tag, ver) = if pg.image.contains(NEW_TAG) { (NEW_TAG, "16.15") } else { (OLD_TAG, "16.9") };
    assert!(pg.image.contains(tag) && !pg.image.contains(if tag == NEW_TAG { OLD_TAG } else { NEW_TAG }), "{ctx}: ImagePath {}", pg.image);
    assert!(pg_link(w).to_string_lossy().contains(tag), "{ctx}: pgsql\\bin {} ↔ ImagePath {}", pg_link(w).display(), pg.image);
    assert_eq!(inst["surum"], ver, "{ctx}: ornek.json {inst}");
    assert_eq!(pg.version.as_deref(), Some(ver), "{ctx}: çalışan PG sürümü");
    for stray in ["bin.yeni", "bin.eski"] {
        assert!(std::fs::symlink_metadata(w.layout.pgsql().join(stray)).is_err(), "{ctx}: artık bağlantı {stray}");
    }
    tag
}

/// PG + backend işlemleri bitene (ya da PG geri dönene) dek yeniden başlatarak koşar.
fn run_both(w: &World) {
    for _ in 0..8 {
        match w.run(3) {
            Ok(_) => {
                let s = w.status().unwrap();
                let done = !w.unfinished()
                    && (s.product == "backend" && matches!(s.state, State::Succeeded | State::RolledBack | State::Failed)
                        || s.product == "pg" && matches!(s.state, State::RolledBack | State::Failed));
                if done {
                    return;
                }
            }
            Err(Killed) => w.crash.disarm(),
        }
    }
    panic!("PG + backend dinlenmeye varmadı: {:?}", w.status().map(|s| (s.product, s.state, s.error_code, s.message)));
}

#[test]
fn minor_update_then_backend() {
    let w = pg_world("pg-mutlu", "kendi", "72");
    run_both(&w);
    let s = w.status().unwrap();
    assert_eq!((s.product.as_str(), s.state), ("backend", State::Succeeded), "{:?}", s.message);
    assert_eq!(pg_consistent(&w, "pg mutlu"), NEW_TAG);
    let inst = instance(&w);
    assert_eq!(inst["derleme"], "4");
    assert!(inst["oncekiIkiliDizin"].as_str().unwrap().ends_with(OLD_TAG), "{inst}");
    assert!(w.events.lock().unwrap().iter().any(|e| e == "reindex"), "ICU 67 → 72: ICU'ya bağlı index'ler yeniden kurulmalı");
    assert!(w.layout.pg_version_dir(OLD_TAG).exists(), "bir önceki PG sürümü geri dönüş için kalır");
    assert_invariants(&w, "PG sonrası backend");
    let hist = std::fs::read_to_string(w.layout.history_file()).unwrap();
    assert!(hist.contains("\"urun\":\"pg\"") && hist.contains("\"urun\":\"backend\""), "{hist}");
}

#[test]
fn same_icu_skips_reindex() {
    let w = pg_world("pg-icu", "kendi", "67");
    run_both(&w);
    assert_eq!(pg_consistent(&w, "aynı ICU"), NEW_TAG);
    assert!(!w.events.lock().unwrap().iter().any(|e| e == "reindex"));
}

#[test]
fn failed_pg_rolls_back_and_backend_is_untouched() {
    let w = pg_world("pg-geri", "kendi", "72");
    // Yeni ikiliyle başlayan sunucu yanlış sürüm bildirir → PG_SURUM_UYUSMAZ → eski yola dönüş.
    *w.faults.pg_wrong_for.lock().unwrap() = Some(NEW_TAG.into());
    run_both(&w);
    let s = w.status().unwrap();
    assert_eq!(
        (s.product.as_str(), s.state, s.error_code.as_deref()),
        ("pg", State::RolledBack, Some("PG_SURUM_UYUSMAZ")),
        "{:?}",
        s.message
    );
    assert_eq!(pg_consistent(&w, "pg geri"), OLD_TAG);
    assert_eq!(w.current().as_deref(), Some(OLD), "PG düştü: backend güncellenmez");
    let b = w.backend();
    assert_eq!((b.state, b.version.as_deref()), (SvcState::Running, Some(OLD)));
    assert_eq!(w.events.lock().unwrap().iter().filter(|e| *e == "reindex").count(), 0, "ICU adımına gelinmedi: yeniden dizinleme gereksiz");
}

#[test]
fn icu_failure_rolls_back_and_reindexes_under_old_binaries() {
    let w = pg_world("pg-icu-hata", "kendi", "72");
    *w.faults.reindex_fail_for.lock().unwrap() = Some(NEW_TAG.into());
    run_both(&w);
    let s = w.status().unwrap();
    assert_eq!((s.product.as_str(), s.state, s.error_code.as_deref()), ("pg", State::RolledBack, Some("PG_ICU_HATASI")), "{:?}", s.message);
    assert_eq!(pg_consistent(&w, "icu geri"), OLD_TAG);
    assert_eq!(
        w.events.lock().unwrap().iter().filter(|e| *e == "reindex").count(),
        1,
        "ICU adımı başladı: eski ikililerle geri dönüşte yeniden dizinleme"
    );
    assert_eq!(w.current().as_deref(), Some(OLD));
}

#[test]
fn external_pg_is_never_touched() {
    let w = pg_world("pg-harici", "harici", "72");
    run_both(&w);
    let s = w.status().unwrap();
    assert_eq!((s.product.as_str(), s.state), ("backend", State::Succeeded));
    assert_eq!(pg_consistent(&w, "harici"), OLD_TAG, "harici kipte PG'ye dokunulmaz");
    assert!(!w.layout.pg_version_dir(NEW_TAG).exists(), "harici kipte PG paketi indirilmez");
    // enAz altındaki harici sunucu: backend güncellemesi RED.
    let w = pg_world("pg-harici-eski", "harici", "72");
    w.svcs.lock().unwrap().get_mut(PG).unwrap().version = Some("16.4".into());
    w.run(2).unwrap();
    let s = w.status().unwrap();
    assert_eq!(s.error_code.as_deref(), Some("PG_SURUM_ESKI"), "{:?}", s.message);
    assert_eq!(w.current().as_deref(), Some(OLD));
}

#[test]
fn major_version_data_dir_is_refused() {
    let w = pg_world("pg-buyuk", "kendi", "72");
    std::fs::write(w.layout.root.join("pgveri").join("PG_VERSION"), "15\n").unwrap();
    w.run(2).unwrap();
    assert_eq!(w.status().unwrap().error_code.as_deref(), Some("PG_BUYUK_SURUM"));
    assert_eq!(pg_consistent(&w, "büyük sürüm"), OLD_TAG);
}

#[test]
fn tampered_pg_content_is_refused() {
    let w = pg_world("pg-icerik", "kendi", "72");
    // İmzalı manifestte içerik özeti farklı (paket değiştirilmiş gibi): manifest yeniden imzalanır.
    let backend_zip = w.files.lock().unwrap().get(&format!("/{CHANNEL}/backend/{NEW}/paket.zip")).cloned().unwrap();
    let pg_zip = w.files.lock().unwrap().get(&format!("/{CHANNEL}/backend/pg/{NEW_TAG}.zip")).cloned().unwrap();
    let manifest = manifest_for(
        &w.keys.package,
        "paket-2026",
        NEW,
        &backend_zip,
        Some(
            json!({ "pg": { "cizgi": "16", "enAz": "16.9", "hedef": { "surum": "16.15", "derleme": "4", "paket": format!("/{CHANNEL}/backend/pg/{NEW_TAG}.zip"),
            "boyut": pg_zip.len(), "sha256": sha_b64u(&pg_zip), "icerikSha256": sha_b64u(b"baska"), "icuSurum": "72" } } }),
        ),
    );
    w.files.lock().unwrap().insert(format!("/{CHANNEL}/backend/{NEW}/manifest.jws"), manifest.into_bytes());
    w.run(2).unwrap();
    assert_eq!(w.status().unwrap().error_code.as_deref(), Some("PG_PAKET"));
    assert!(!w.layout.pg_version_dir(NEW_TAG).exists() && !w.layout.pg_staging_dir(NEW_TAG).exists());
    assert_eq!(pg_consistent(&w, "içerik"), OLD_TAG);
}

#[test]
fn kill_at_every_point_of_a_pg_minor_update() {
    let probe = pg_world("pg-sayac", "kendi", "72");
    probe.crash.disarm();
    let _ = probe.run(3);
    let points = probe.crash.count.load(Ordering::SeqCst);
    assert!(points >= 40, "{points}");
    for k in 1..=points {
        let w = pg_world("pg-oldur", "kendi", "72");
        w.crash.arm(k, k % 3 == 0);
        if w.run(3).is_ok() {
            continue;
        }
        w.crash.disarm();
        run_both(&w);
        let ctx = format!("pg nokta {k}");
        let tag = pg_consistent(&w, &ctx);
        let s = w.status().unwrap();
        if tag == OLD_TAG {
            assert_eq!(w.current().as_deref(), Some(OLD), "{ctx}: PG eski kaldıysa backend de eski olmalı ({:?})", s.message);
        }
        if s.product == "backend" {
            assert_invariants(&w, &ctx);
        } else {
            let b = w.backend();
            assert_eq!((b.state, b.version.as_deref()), (SvcState::Running, Some(OLD)), "{ctx}");
        }
    }
}

#[allow(dead_code)]
fn _unused(_: &dyn Fs) {}
