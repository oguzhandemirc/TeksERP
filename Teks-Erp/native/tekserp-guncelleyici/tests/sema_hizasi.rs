//! Şema hizası (D8e, yönetici kararı 2026-10-02): paket şemanın GERİSİNDEYSE (veritabanında pakette olmayan bitmiş
//! göç) güncelleyici de setup gibi DURUR — `SEMA_ILERIDE`, durum BEKLİYOR, hizmete/`current`a/DB'ye dokunulmaz.
//! Kural tek: `sema::ahead` = PS `deploy/hizmet/sema-hizasi.ps1` `SemaIleride`; eşlik ortak vektörlerle
//! (`test-vektorleri/sema-hizasi.json`, üreten `Teks-Erp/scripts/test_sema_hizasi.ts --vektor-yaz`; elle düzenlenmez).
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

/// Ortak vektörler: SQL bayt-eşit, paketin göç adları (dosya yollarından) ve küme farkı PS ile aynı.
#[test]
fn same_rule_as_shared_vectors() {
    let file = vector_file();
    assert_eq!(file["bicim"], 1, "vektör biçimi");
    assert_eq!(file["sql"].as_str(), Some(sema::FINISHED_MIGRATIONS_SQL), "bitmiş göç SQL'i PS aynasıyla bayt-eşit olmalı");
    let records = file["kayitlar"].as_array().expect("kayitlar");
    assert!(records.len() >= 8, "kayıt sayısı düştü: {}", records.len());
    let mut diverged = Vec::new();
    for (i, r) in records.iter().enumerate() {
        let v = &r["vektor"];
        let name = v["ad"].as_str().expect("ad");
        let dir = std::env::temp_dir().join(format!("tekserp-sema-{}-{i}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for p in strings(&v["paketYollari"]) {
            let f = dir.join(&p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(&f, b"-- goc").unwrap();
        }
        std::fs::create_dir_all(dir.join("prisma").join("migrations")).unwrap();
        let package = sema::package_migrations(&RealFs, &dir).expect("göç dizini");
        let _ = std::fs::remove_dir_all(&dir);
        let ahead = sema::ahead(&strings(&v["veritabani"]), &package);
        let want_package = strings(&r["beklenen"]["paket"]);
        let want_ahead = strings(&r["beklenen"]["ileride"]);
        if package != want_package || ahead != want_ahead {
            diverged.push(format!("{name}: paket {package:?} (beklenen {want_package:?}) · ileride {ahead:?} (beklenen {want_ahead:?})"));
        }
    }
    assert!(diverged.is_empty(), "PS aynasından ayrışan kayıt:\n{}", diverged.join("\n"));
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
