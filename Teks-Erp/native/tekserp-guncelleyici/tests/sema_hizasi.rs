//! Şema hizası (D8e, yönetici kararı 2026-10-02): paket şemanın GERİSİNDEYSE (veritabanında pakette olmayan bitmiş
//! göç) güncelleyici de setup gibi DURUR — `SEMA_ILERIDE`, durum BEKLİYOR, hizmete/`current`a/DB'ye dokunulmaz.
//! Kural tek: `sema::ahead` = PS `deploy/hizmet/sema-hizasi.ps1` `SemaIleride`; eşlik ortak vektörlerle
//! (`test-vektorleri/sema-hizasi.json`, üreten `Teks-Erp/scripts/test_sema_hizasi.ts --vektor-yaz`; elle düzenlenmez).
//! Üç sonuç (`sema::verdict`): uyumlu → sürer · ileride → BEKLİYOR · ölçülemedi → `SEMA_OLCULEMEDI` BİLGİ, sürer.
mod common;

use common::*;
use serde_json::Value;
use std::path::PathBuf;
use tekserp_guncelleyici::env::{RealFs, SvcState};
use tekserp_guncelleyici::ipc::State;
use tekserp_guncelleyici::sema;

fn vector_file() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri").join("sema-hizasi.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).expect("vektör dosyası JSON")
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().expect("dizi").iter().map(|x| x.as_str().expect("dize").to_string()).collect()
}

/// Ortak vektörler: SQL bayt-eşit, paketin göç adları (dosya yollarından), küme farkı ve ÜÇ sonuç PS ile aynı.
/// `null` girdi = o yan okunamadı: veritabanı sorgusu düştü ya da paketin göç dizini hiç yok (göçsüz paketten AYRI).
#[test]
fn same_rule_as_shared_vectors() {
    let file = vector_file();
    assert_eq!(file["bicim"], 2, "vektör biçimi");
    assert_eq!(file["sql"].as_str(), Some(sema::FINISHED_MIGRATIONS_SQL), "bitmiş göç SQL'i PS aynasıyla bayt-eşit olmalı");
    let records = file["kayitlar"].as_array().expect("kayitlar");
    assert!(records.len() >= 10, "kayıt sayısı düştü: {}", records.len());
    let opt = |v: &Value| (!v.is_null()).then(|| strings(v));
    let mut seen = std::collections::BTreeSet::new();
    let mut diverged = Vec::new();
    for (i, r) in records.iter().enumerate() {
        let v = &r["vektor"];
        let name = v["ad"].as_str().expect("ad");
        let dir = std::env::temp_dir().join(format!("tekserp-sema-{}-{i}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        if let Some(paths) = opt(&v["paketYollari"]) {
            for p in paths {
                let f = dir.join(&p);
                std::fs::create_dir_all(f.parent().unwrap()).unwrap();
                std::fs::write(&f, b"-- goc").unwrap();
            }
            std::fs::create_dir_all(dir.join("prisma").join("migrations")).unwrap();
        }
        let package = sema::package_migrations(&RealFs, &dir).map_err(|e| e.to_string());
        let _ = std::fs::remove_dir_all(&dir);
        let db = opt(&v["veritabani"]).ok_or_else(|| "veritabanı okunamadı".to_string());
        let got_package = package.clone().ok();
        let (outcome, ahead) = match sema::verdict(db, package) {
            sema::Verdict::Aligned => ("UYUMLU", Some(vec![])),
            sema::Verdict::Ahead(x) => ("ILERIDE", Some(x)),
            sema::Verdict::Unmeasured(_) => ("OLCULEMEDI", None),
        };
        seen.insert(outcome);
        let want_package = opt(&r["beklenen"]["paket"]);
        let want_ahead = opt(&r["beklenen"]["ileride"]);
        let want_outcome = r["beklenen"]["sonuc"].as_str().expect("sonuc");
        if got_package != want_package || ahead != want_ahead || outcome != want_outcome {
            diverged.push(format!(
                "{name}: {outcome} (beklenen {want_outcome}) · paket {got_package:?} (beklenen {want_package:?}) · ileride {ahead:?} (beklenen {want_ahead:?})"
            ));
        }
    }
    assert!(diverged.is_empty(), "PS aynasından ayrışan kayıt:\n{}", diverged.join("\n"));
    assert_eq!(seen.len(), 3, "vektörler üç sonucun üçünü de taşımalı: {seen:?}");
}

fn ahead_world(tag: &str, finished: u64, foreign: Option<&str>, setup: Setup) -> World {
    let w = World::new(tag, setup);
    w.db.lock().unwrap().finished = finished;
    w.db.lock().unwrap().total = finished;
    *w.faults.foreign_migration.lock().unwrap() = foreign.map(str::to_string);
    w
}

fn assert_waits_untouched(w: &World, finished: u64, needle: &str, ctx: &str) {
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::Waiting, Some("SEMA_ILERIDE")), "{ctx}: {:?}", st.message);
    let msg = st.message.unwrap_or_default();
    assert!(msg.contains(needle) && msg.contains(NEW), "{ctx}: {msg}");
    let b = w.backend();
    assert_eq!((b.state, b.starts), (SvcState::Running, 0), "{ctx}: hizmet durdurulmadı/yeniden başlatılmadı");
    assert_eq!(w.current().as_deref(), Some(OLD), "{ctx}: current değişmedi");
    assert!(!w.unfinished(), "{ctx}: işlem başlamadı");
    let db = w.db();
    assert_eq!((db.finished, db.total, db.data), (finished, finished, 42), "{ctx}: veritabanına dokunulmadı");
    assert!(install_records(w).is_empty(), "{ctx}: kurulum kaydı yok");
}

/// Veritabanı paketin (NEW, 4 göç) ilerisinde (5 göç): kurulmaz, hiçbir şey değişmez, her turda aynı.
#[test]
fn schema_ahead_waits_without_touching_anything() {
    let w = ahead_world("sema-ileride", migrations_of(NEW) + 1, None, Setup::default());
    w.run(1).unwrap();
    assert_waits_untouched(&w, 5, "0005_goc", "ilk tur");
    w.run(3).unwrap();
    assert_waits_untouched(&w, 5, "0005_goc", "sonraki turlar");
}

/// Sayı EŞİT (4 = 4) ama son ad pakette yok: sayı karşılaştırması geçirirdi, ad kümesi durdurur.
#[test]
fn same_count_foreign_name_is_ahead() {
    let w = ahead_world("sema-yabanci-ad", migrations_of(NEW), Some("0004_baska_dal"), Setup::default());
    w.run(1).unwrap();
    assert_waits_untouched(&w, 4, "0004_baska_dal", "yabancı ad");
}

/// Onaylı kipte "Şimdi kur" onayı da kurmaz: onaylı sürüm şema yüzünden BEKLİYOR (panel nedeni `SEMA_ILERIDE`).
#[test]
fn approved_version_still_waits_on_schema_ahead() {
    let lease = LeaseOpts { update: Some(policy("ONAYLI", &open_window(), None)), ..LeaseOpts::default() };
    let setup = Setup { lease, intent: Some(intent(Some(approval("onay-1", NEW, "HEMEN")))), ..Setup::default() };
    let w = ahead_world("sema-onayli", migrations_of(NEW) + 1, None, setup);
    w.run(2).unwrap();
    assert_waits_untouched(&w, 5, "0005_goc", "onaylı");
    assert_eq!(w.status().unwrap().pending.map(|p| p.karar), Some("KUR".into()), "karar KUR, uygulama şema yüzünden bekler");
}

/// Eşit (paket = veritabanı adları) ve geride (veritabanı paketin alt kümesi): güncelleme sürer.
#[test]
fn equal_or_behind_proceeds() {
    for (tag, finished) in [("sema-esit", migrations_of(NEW)), ("sema-geride", migrations_of(NEW) - 1)] {
        let w = ahead_world(tag, finished, None, Setup::default());
        w.run_to_rest(0);
        let st = w.status().unwrap();
        assert_eq!(st.state, State::Succeeded, "{tag}: {:?} {:?}", st.error_code, st.message);
        assert_eq!(w.current().as_deref(), Some(NEW), "{tag}");
        assert_eq!(w.db().finished, migrations_of(NEW), "{tag}: göçler tam");
    }
}

/// ÖLÇÜLEMEDİ (yönetici kararı 2026-10-02): bitmiş göç adları okunamazsa güncelleme DURMAZ — kurulur — ama sessiz de
/// geçmez: günlükte ve durum dosyasında `SEMA_OLCULEMEDI` + neden; `hataKodu` boş kalır (sorun değil, bilgi).
#[test]
fn unmeasured_schema_proceeds_with_info_in_log_and_status() {
    let w = ahead_world("sema-olculemedi", migrations_of(NEW) - 1, None, Setup::default());
    w.faults.finished_migrations_unreadable.store(true, std::sync::atomic::Ordering::SeqCst);
    let log = w.run_logged(1);
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::Succeeded, None), "ölçülemedi engel değil: {:?}", st.message);
    assert_eq!(w.current().as_deref(), Some(NEW), "güncelleme sürdü");
    let notice = st.notice.expect("durum.bilgi yazılmadı (sessiz geçiş)");
    assert_eq!(notice.code, "SEMA_OLCULEMEDI");
    assert!(notice.message.contains(NEW) && notice.message.contains("permission denied"), "neden metni: {}", notice.message);
    let line = log.lines().find(|l| l.contains("SEMA_OLCULEMEDI")).unwrap_or_else(|| panic!("günlükte SEMA_OLCULEMEDI yok:\n{log}"));
    assert!(line.contains(" BILGI ") && line.contains("permission denied"), "günlük satırı BİLGİ düzeyinde, nedenli: {line}");
    // Bilgi turun ölçümüdür: sonraki tur (aday kurulu, ölçüm yok) onu taşımaz.
    w.run(1).unwrap();
    assert!(w.status().unwrap().notice.is_none(), "bayat bilgi sonraki tura taşındı");
}

/// Onaylı kipte onay beklerken (HAZIR) ölçülemedi: durum HAZIR kalır (BEKLİYOR değil), bilgi görünür, sorun yok.
#[test]
fn unmeasured_schema_while_ready_is_info_not_problem() {
    let lease = LeaseOpts { update: Some(policy("ONAYLI", &open_window(), None)), ..LeaseOpts::default() };
    let w = ahead_world("sema-olculemedi-hazir", migrations_of(NEW), None, Setup { lease, ..Setup::default() });
    w.faults.finished_migrations_unreadable.store(true, std::sync::atomic::Ordering::SeqCst);
    w.run(2).unwrap();
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::Ready, None), "{:?}", st.message);
    assert_eq!(st.notice.map(|n| n.code).as_deref(), Some("SEMA_OLCULEMEDI"));
    assert_eq!(w.current().as_deref(), Some(OLD), "onay beklenir; kurulmadı");
    // Ölçüm geri gelince bilgi kalkar.
    w.faults.finished_migrations_unreadable.store(false, std::sync::atomic::Ordering::SeqCst);
    w.run(1).unwrap();
    let st = w.status().unwrap();
    assert_eq!((st.state, st.notice), (State::Ready, None));
}
