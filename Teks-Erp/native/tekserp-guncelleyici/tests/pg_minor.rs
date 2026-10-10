//! PostgreSQL küçük sürümü (D4 §5 U0–U11, §9): yan yana açılış + içerik manifestosu, ImagePath +
//! `pgsql\bin` bağlantısı, ICU değiştiyse yeniden dizinleme, sorunda eski yola dönüş; PG adımı
//! backend'den ÖNCE ve PG düşerse backend'e dokunulmaz; harici kipte PG'ye hiç dokunulmaz.
mod common;

use common::*;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::env::{Fs, RealFs, SvcState};
use tekserp_guncelleyici::ipc::State;

const OLD_TAG: &str = PG_OLD_TAG;
const NEW_TAG: &str = PG_NEW_TAG;

/// Backend bildirimini verilen `pg` bloğuyla yeniden imzalayıp yayınlar (paket aynı).
fn republish_backend(w: &World, pg: Value) {
    let zip = w.files.lock().unwrap().get(&format!("/{CHANNEL}/backend/{NEW}/{}", package_name(NEW))).cloned().unwrap();
    let payload = manifest_payload("paket-2026", NEW, &zip, Some(&json!({ "pg": pg })));
    publish(&w.files, &payload, &sign_manifest(&w.keys.package, "paket-2026", &payload), None, true);
}

/// Kendi PG örneği (16.9-1) + sunucuda 16.15-4 paketi, imzalı künyesi ve onu isteyen backend bildirimi.
fn pg_world(tag: &str, kind: &str, new_icu: &str) -> World {
    let w = World::new(tag, Setup::default());
    install_pg_instance(&w, kind);
    // PG paketi: sahne + `shasum -c` biçiminde içerik manifestosu + imzalı künye (pg.json).
    let (pg_zip, content_hex) = pg_stage_zip(new_icu);
    let kunye = pg_manifest(&pg_zip, &content_hex, new_icu);
    let dir = format!("/{CHANNEL}/backend/pg/{NEW_TAG}");
    {
        let mut served = w.files.lock().unwrap();
        served.insert(format!("{dir}/{PG_ZIP}"), pg_zip);
        served.insert(format!("{dir}/pg.json"), pointer(&sign(&w.keys.package, "tekserp-pg", "paket-2026", &kunye)));
    }
    republish_backend(&w, pg_requirement(&kunye));
    w
}

fn served_kunye(w: &World) -> Value {
    let text = w.files.lock().unwrap().get(&format!("/{CHANNEL}/backend/pg/{NEW_TAG}/pg.json")).cloned().unwrap();
    let token = serde_json::from_slice::<Value>(&text).unwrap()["bildirim"].as_str().unwrap().to_string();
    let payload = token.split('.').nth(1).unwrap();
    serde_json::from_slice(&tekserp_dogrulama::b64::decode_strict(payload).unwrap()).unwrap()
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

/// Son denemenin ürünü (`sonAyrinti.urun`): `pg` · `backend`.
fn product(w: &World) -> String {
    w.status().and_then(|s| s.last_detail).map(|d| d.product).unwrap_or_default()
}

/// PG + backend işlemleri bitene (ya da PG geri dönene) dek yeniden başlatarak koşar.
fn run_both(w: &World) {
    for _ in 0..8 {
        match w.run(3) {
            Ok(_) => {
                let s = w.status().unwrap();
                if !w.unfinished() && matches!(s.state, State::Succeeded | State::RolledBack | State::Failed) {
                    return;
                }
            }
            Err(Killed) => w.crash.disarm(),
        }
    }
    panic!("PG + backend dinlenmeye varmadı: {:?}", w.status().map(|s| (s.state, s.error_code, s.message, s.decision)));
}

#[test]
fn minor_update_then_backend() {
    let w = pg_world("pg-mutlu", "kendi", "72");
    run_both(&w);
    let s = w.status().unwrap();
    assert_eq!((product(&w).as_str(), s.state), ("backend", State::Succeeded), "{:?}", s.message);
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
        (product(&w).as_str(), s.state, s.error_code.as_deref()),
        ("pg", State::RolledBack, Some("PG_SURUM_UYUSMAZ")),
        "{:?}",
        s.message
    );
    let son = s.last.clone().expect("son");
    assert_eq!(
        (son.target.as_str(), son.result.as_str(), son.kod.as_deref(), son.data_restored),
        (NEW, "GERI_DONDU", Some("PG_GUNCELLEME_HATASI"), false),
        "rapor: PG düştü, deneme backend {NEW} içindi"
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
    assert_eq!(
        (product(&w).as_str(), s.state, s.error_code.as_deref()),
        ("pg", State::RolledBack, Some("PG_ICU_HATASI")),
        "{:?}",
        s.message
    );
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
    assert_eq!((product(&w).as_str(), s.state), ("backend", State::Succeeded));
    assert_eq!(pg_consistent(&w, "harici"), OLD_TAG, "harici kipte PG'ye dokunulmaz");
    assert!(!w.layout.pg_version_dir(NEW_TAG).exists(), "harici kipte PG paketi indirilmez");
    // enAz altındaki harici sunucu: backend güncellemesi RED (karar).
    let w = pg_world("pg-harici-eski", "harici", "72");
    w.svcs.lock().unwrap().get_mut(PG).unwrap().version = Some("16.4".into());
    w.run(2).unwrap();
    let d = w.status().unwrap().decision.unwrap();
    assert_eq!((d.karar.label(), d.neden.as_deref()), ("UYGUN_DEGIL", Some("PG_SURUMU_ESKI")));
    assert_eq!(w.current().as_deref(), Some(OLD));
    // Kurulu PG'nin ANA sürümü bildirimin çizgisi değil: hiçbir kipte otomatik değil.
    let w = pg_world("pg-ana", "kendi", "72");
    w.svcs.lock().unwrap().get_mut(PG).unwrap().version = Some("15.8".into());
    w.run(2).unwrap();
    let d = w.status().unwrap().decision.unwrap();
    assert_eq!((d.karar.label(), d.neden.as_deref()), ("UYGUN_DEGIL", Some("PG_ANA_SURUM")));
    assert_eq!(pg_consistent_version(&w), "15.8");
    // Örnek kaydı yok (bugünkü kurulumlar): harici sayılır, PG'ye dokunulmaz.
    let w = pg_world("pg-kayitsiz", "kendi", "72");
    std::fs::remove_file(w.layout.pg_instance_file()).unwrap();
    run_both(&w);
    assert_eq!((product(&w).as_str(), w.state()), ("backend", Some(State::Succeeded)));
    assert!(!w.layout.pg_version_dir(NEW_TAG).exists());
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
    // Künye ile bildirim bağlı ama içerik özeti paketin manifestosu değil: açılır, ölçülür, RED.
    let w = pg_world("pg-icerik", "kendi", "72");
    let mut kunye = served_kunye(&w);
    kunye["icerikSha256"] = json!(sha_hex(b"baska"));
    w.files
        .lock()
        .unwrap()
        .insert(format!("/{CHANNEL}/backend/pg/{NEW_TAG}/pg.json"), pointer(&sign(&w.keys.package, "tekserp-pg", "paket-2026", &kunye)));
    republish_backend(&w, pg_requirement(&kunye));
    w.run(1).unwrap();
    assert_eq!(w.status().unwrap().error_code.as_deref(), Some("PG_PAKET"));
    w.run(1).unwrap();
    assert_eq!(w.status().unwrap().error_code.as_deref(), Some("INDIRME_ERTELENDI"), "kesin hatada hemen yeniden indirilmez");
    assert!(!w.layout.pg_version_dir(NEW_TAG).exists() && !w.layout.pg_staging_dir(NEW_TAG).exists());
    assert_eq!(pg_consistent(&w, "içerik"), OLD_TAG);
    // Künye bildirimin hedefiyle bağlanmıyor (ICU farklı): paket hiç indirilmez.
    let w = pg_world("pg-bag", "kendi", "72");
    let mut kunye = served_kunye(&w);
    kunye["icuSurum"] = json!("73");
    w.files
        .lock()
        .unwrap()
        .insert(format!("/{CHANNEL}/backend/pg/{NEW_TAG}/pg.json"), pointer(&sign(&w.keys.package, "tekserp-pg", "paket-2026", &kunye)));
    w.run(1).unwrap();
    assert_eq!(w.status().unwrap().error_code.as_deref(), Some("PG_BAGI"));
    assert!(!w.layout.downloads().join(format!("pg-{NEW_TAG}.zip")).exists());
    assert_eq!(pg_consistent(&w, "bağ"), OLD_TAG);
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
        if product(&w) == "backend" {
            assert_invariants(&w, &ctx);
        } else {
            let b = w.backend();
            assert_eq!((b.state, b.version.as_deref()), (SvcState::Running, Some(OLD)), "{ctx}");
        }
    }
}

/// PG çalışıyor ve bildirdiği sürüm (ana sürüm reddinde dokunulmadığını ölçmek için).
fn pg_consistent_version(w: &World) -> String {
    let pg = w.svcs.lock().unwrap().get(PG).cloned().unwrap();
    assert_eq!(pg.state, SvcState::Running);
    assert!(pg.image.contains(OLD_TAG), "ImagePath değişti: {}", pg.image);
    pg.version.unwrap_or_default()
}

#[allow(dead_code)]
fn _unused(_: &dyn Fs) {}

/// DAGK-3: hazır PG dizini onay beklerken değiştirilirse uygulama anında içerik manifestosuyla yeniden
/// doğrulanır — PG'ye de backend'e de dokunulmaz; sonraki tur yeniden hazırlayıp ikisini de kurar.
#[test]
fn prepared_pg_is_reverified_at_apply_time() {
    let w = pg_world("pg-yeniden", "kendi", "72");
    let onayli = LeaseOpts { update: Some(policy("ONAYLI", &open_window(), None)), ..LeaseOpts::default() };
    let (lease, _) = lease_and_entitlement(&w.keys, &onayli, T0);
    std::fs::write(w.license_dir().join("kira.jws"), lease).unwrap();
    w.run(1).unwrap();
    assert_eq!(w.state(), Some(State::Ready), "{:?}", w.status().map(|s| (s.error_code, s.message)));
    assert!(w.layout.pg_version_dir(NEW_TAG).exists(), "PG hazırlanmalı");
    std::fs::write(w.layout.pg_version_dir(NEW_TAG).join("bin").join("psql"), b"#!kurcali").unwrap();
    w.write_intent(&intent(Some(approval("onay-pg", NEW, "HEMEN"))));
    w.run(1).unwrap();
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::Waiting, Some("PG_PAKET")), "{:?}", st.message);
    assert!(st.message.as_deref().is_some_and(|m| m.contains("uygulama anında")), "{:?}", st.message);
    assert_eq!(pg_consistent(&w, "kurcalı PG"), OLD_TAG);
    assert_eq!(w.backend().starts, 0);
    run_both(&w);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().map(|s| (s.error_code, s.message)));
    assert_eq!(pg_consistent(&w, "yeniden hazırlanan PG"), NEW_TAG);
}
