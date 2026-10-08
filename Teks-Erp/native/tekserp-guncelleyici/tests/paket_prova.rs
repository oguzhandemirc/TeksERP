//! D7 paket zinciri PROVASI — motor tarafı. Elle koşulmaz: `deploy/satici/prova-paket-zinciri.mjs` çağırır
//! (`#[ignore]`; ortam `TEKSERP_PAKET_PROVA=<geçici prova dizini>`).
//!   prova_hazirla — sahte dünyanın sürüm ağacı (`version_files(NEW)`) ve PG sahnesi dizine yazılır; GERÇEK TS
//!                   araçları bunları test köküne bağlı `pkt-*` sertifikalarıyla imzalar.
//!   prova_motor   — `senaryolar.json`daki her yayın düzeni için taze dünya: sunucu dosyaları = provanın ürettikleri,
//!                   çapaya provanın test kökü eklenir, kira/niyet/saat gerçek tarihe taşınır (sertifikalar bugün
//!                   doğar), motor koşar; sonuç `motor-sonuc.json`a yazılır, hükmü betik verir.
mod common;

use common::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tekserp_dogrulama::b64;
use tekserp_dogrulama::chain::RootKey;
use tekserp_dogrulama::paket_zinciri;
use tekserp_guncelleyici::env::{Fs, RealFs};
use tekserp_guncelleyici::ipc::State;

fn prova_dir() -> PathBuf {
    PathBuf::from(std::env::var_os("TEKSERP_PAKET_PROVA").expect("TEKSERP_PAKET_PROVA (prova dizini) gerekli"))
}

fn write_tree(dir: &Path, files: &[(String, Vec<u8>)]) {
    for (p, c) in files {
        let f = dir.join(p);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, c).unwrap();
    }
}

#[test]
#[ignore = "prova betiği çağırır"]
fn prova_hazirla() {
    let dir = prova_dir();
    write_tree(&dir.join("paket-agaci"), &version_files(NEW));
    write_tree(&dir.join("pg-sahne"), &pg_stage_files("67"));
    std::fs::write(dir.join("hazirlik.json"), json!({ "surum": NEW, "gocSayisi": migrations_of(NEW), "kurulu": OLD }).to_string()).unwrap();
}

/// Gerçek saatten sonraki ilk 23:30Z (İstanbul 02:30 — kiranın güncelleme penceresi içinde).
fn prova_clock() -> i64 {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    let mut t = (now / DAY) * DAY + DAY - 30 * 60_000;
    while t <= now + 60_000 {
        t += DAY;
    }
    t
}

fn header_kid(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let header: Value = serde_json::from_slice(&b64::decode_strict(text.trim().split('.').next()?)?).ok()?;
    header["kid"].as_str().map(str::to_string)
}

fn scenario(spec: &Value, roots: &[RootKey], channel: &str, n: usize) -> Value {
    let name = spec["ad"].as_str().expect("ad");
    let target = spec["hedef"].as_str();
    let w = {
        let mut w = World::new(&format!("prova-{n}"), Setup::default());
        w.anchor.roots.extend(roots.iter().cloned());
        w
    };
    let t = prova_clock();
    w.clock.store(t, Ordering::SeqCst);
    let window: Vec<(i64, i64)> = (0..5).map(|d| (t - 30 * 60_000 + d * DAY, t + 150 * 60_000 + d * DAY)).collect();
    let opts =
        LeaseOpts { update: Some(policy("OTOMATIK", &window, target)), maintenance_end: Some(t + 365 * DAY), ..LeaseOpts::default() };
    let (lease, hak) = lease_and_entitlement_in(&w.keys, &opts, t, channel);
    let lic = w.layout.root.join("lisans");
    std::fs::write(lic.join("kira.jws"), lease).unwrap();
    std::fs::write(lic.join("hak.jws"), hak.unwrap()).unwrap();
    w.write_intent(&json!({ "v": 1, "yazildi": iso(t), "indirme": { "belirtec": TOKEN, "bitis": iso(t + 30 * DAY) }, "onay": null }));
    if let Some(p) = spec["iptal"].as_str() {
        std::fs::copy(p, lic.join(paket_zinciri::PACKAGE_REVOCATION_FILE)).unwrap();
    }
    install_pg_instance(&w, "kendi");
    {
        let mut f = w.files.lock().unwrap();
        f.clear();
        for (url, file) in spec["dosyalar"].as_object().expect("dosyalar") {
            f.insert(url.clone(), std::fs::read(file.as_str().unwrap()).unwrap_or_else(|e| panic!("{file}: {e}")));
        }
    }
    let mut log = w.run_logged(12);
    for _ in 0..4 {
        if !w.unfinished() && matches!(w.state(), Some(State::Succeeded | State::RolledBack | State::Failed)) {
            break;
        }
        log.push_str(&w.run_logged(6));
    }
    let st = w.status();
    let pg = RealFs.link_target(&w.layout.pg_bin_link()).ok().flatten().map(|p| p.to_string_lossy().into_owned());
    let pg_tag = pg.as_deref().and_then(|p| [PG_NEW_TAG, PG_OLD_TAG].into_iter().find(|t| p.contains(t)));
    json!({
        "ad": name,
        "durum": st.as_ref().map(|s| format!("{:?}", s.state)),
        "kod": st.as_ref().and_then(|s| s.error_code.clone()),
        "mesaj": st.as_ref().and_then(|s| s.message.clone()),
        "surum": w.current(),
        "pg": pg_tag,
        "kurulanKid": header_kid(&w.layout.version_dir(NEW).join(paket_zinciri::CHAINED_INTEGRITY_FILE)),
        "secim": log
            .lines()
            .filter(|l| l.contains(" seçildi"))
            .filter_map(|l| l.find("sürüm bildirimi:").or_else(|| l.find("PG künyesi:")).map(|i| l[i..].to_string()))
            .collect::<Vec<_>>(),
    })
}

#[test]
#[ignore = "prova betiği çağırır"]
fn prova_motor() {
    let dir = prova_dir();
    let spec: Value = serde_json::from_slice(&std::fs::read(dir.join("senaryolar.json")).unwrap()).unwrap();
    let channel = spec["kanal"].as_str().expect("kanal");
    let roots: Vec<RootKey> = spec["kokler"]
        .as_array()
        .expect("kokler")
        .iter()
        .map(|r| RootKey {
            kid: r["kid"].as_str().unwrap().into(),
            x: r["x"].as_str().unwrap().into(),
            classes: r["classes"].as_array().unwrap().iter().map(|c| c.as_str().unwrap().into()).collect(),
        })
        .collect();
    let out: Vec<Value> =
        spec["senaryolar"].as_array().expect("senaryolar").iter().enumerate().map(|(i, s)| scenario(s, &roots, channel, i)).collect();
    std::fs::write(dir.join("motor-sonuc.json"), serde_json::to_vec_pretty(&json!({ "v": 1, "senaryolar": out })).unwrap()).unwrap();
}
