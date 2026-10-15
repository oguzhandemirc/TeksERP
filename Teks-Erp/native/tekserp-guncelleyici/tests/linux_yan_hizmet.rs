//! Linux yan hizmetleri (BULGU-2, bulut 2026-10-15): compose'ta backend imajını paylaşan `yedek` konteyneri sürüm
//! kurulumunda backend'le birlikte YENİ imaja taşınır — ama yalnız yeni sürüm doğrulanıp normal kipte sağlıklı
//! başladıktan SONRA; geri dönüşte önceki imaja döner; sürmekte olan yedek işi kesilmez; yan hizmetin hiçbir hatası
//! sağlıklı backend kurulumunu geri aldırmaz (sapma olay + adım verisinde görünür).
mod common;

use common::*;
use serde_json::Value;
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::env::RealFs;
use tekserp_guncelleyici::ipc::State;
use tekserp_guncelleyici::journal::Journal;

fn linux(tag: &str) -> World {
    World::new_in(Profil::Linux, tag, Setup::default())
}

fn sidecar(w: &World) -> Option<String> {
    w.faults.sidecar_version.lock().unwrap().clone()
}

fn recreates(w: &World) -> Vec<String> {
    w.faults.sidecar_recreates.lock().unwrap().clone()
}

/// BASLAT adımının yan hizmet verisi (`yanHizmetler.yedek`).
fn baslat_yedek(w: &World) -> Value {
    let j = Journal::open(&RealFs, &w.layout.journal_file()).unwrap();
    let v = j.last_op().unwrap();
    v.step_data("BASLAT").and_then(|d| d.get("yanHizmetler")).and_then(|y| y.get("yedek")).cloned().unwrap_or_default()
}

fn events_with(w: &World, part: &str) -> Vec<String> {
    w.events.lock().unwrap().iter().filter(|e| e.contains(part)).cloned().collect()
}

#[test]
fn yedek_dogrulanan_surume_tasinir() {
    let w = linux("yh-basari");
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().and_then(|s| s.message));
    assert_invariants(&w, "başarı");
    assert_eq!(sidecar(&w).as_deref(), Some(NEW), "yedek konteyneri yeni imajda");
    assert_eq!(recreates(&w), [NEW], "tek yeniden yaratma, yeni sürüme (doğrulama kipinde değil)");
    assert_eq!(baslat_yedek(&w)["sonuc"], "ESIT");
    // İkinci eşitleme (aynı tanım) konteynere dokunmaz.
    let env = w.env();
    env.svc.yan_hizmet_esitle("yedek").unwrap();
    assert_eq!(recreates(&w), [NEW], "tanım aynıyken yeniden yaratılmaz");
}

#[test]
fn dogrulama_duserse_yedege_dokunulmaz() {
    let w = linux("yh-saglıksiz");
    *w.faults.unhealthy_version.lock().unwrap() = Some(NEW.into());
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::RolledBack));
    assert_invariants(&w, "doğrulama düştü");
    assert_eq!(sidecar(&w).as_deref(), Some(OLD));
    assert!(recreates(&w).is_empty(), "doğrulanmamış sürüm yedeğe taşınmaz: {:?}", recreates(&w));
}

#[test]
fn geri_donuste_yedek_eskiye_doner() {
    // Yan hizmet BASLAT'ta yeni imaja taşındıktan SONRA ONAY'ın kurulum kaydı yazımı disk dolu düşer: işlem geri alınır,
    // yedek konteyneri önceki sürümün imajına döner.
    let sayac = linux("yh-sayac");
    sayac.count_points();
    let hist = sayac.layout.install_history().file_name().unwrap().to_string_lossy().into_owned();
    let log = sayac.crash.log.lock().unwrap().clone();
    let k = log
        .iter()
        .find_map(|l| l.split_once(':').filter(|(_, x)| *x == format!("ekle {hist}")).and_then(|(n, _)| n.parse::<u64>().ok()))
        .expect("sayımda kurulum kaydı yazımı yok");
    drop(sayac);
    let w = linux("yh-geri");
    w.enospc_at(k);
    let _ = w.run(3);
    assert!(w.crash.enospc_fired(), "disk dolmadı");
    w.crash.free_disk();
    w.run_to_rest(4);
    assert_eq!(w.state(), Some(State::RolledBack), "{:?}", w.status().map(|s| (s.error_code, s.message)));
    assert_invariants(&w, "ONAY'da geri dönüş");
    assert_eq!(recreates(&w), [NEW, OLD], "önce yeniye (doğrulandıktan sonra), geri dönüşte eskiye");
    assert_eq!(sidecar(&w).as_deref(), Some(OLD));
}

#[test]
fn yedek_isi_bitene_dek_beklenir() {
    let w = linux("yh-mesgul");
    // Sonda üç kez "iş sürüyor" der: güncelleyici bekler, iş bitince (dördüncü sonda) yeniden yaratır — yarıda kesmez.
    w.faults.sidecar_busy_probes.store(3, Ordering::SeqCst);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_invariants(&w, "meşgul yedek");
    assert_eq!(w.faults.sidecar_busy_probes.load(Ordering::SeqCst), 0, "iş bitmesi beklenmedi");
    assert_eq!(recreates(&w), [NEW]);
    assert_eq!(baslat_yedek(&w)["sonuc"], "ESIT");
}

#[test]
fn yedek_isi_bitmezse_ertelenir_kurulum_basarili() {
    let w = linux("yh-ertele");
    *w.faults.sidecar_busy_until.lock().unwrap() = Some(i64::MAX);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "yan hizmet backend kurulumunu geri aldırmaz");
    assert_eq!((w.current().as_deref(), w.backend().version.as_deref()), (Some(NEW), Some(NEW)));
    assert_eq!(sidecar(&w).as_deref(), Some(OLD), "iş kesilmedi: eski imajda kaldı");
    assert!(recreates(&w).is_empty());
    let d = baslat_yedek(&w);
    assert_eq!(d["sonuc"], "ERTELENDI", "{d}");
    assert_eq!(events_with(&w, "UYARI: yedek: yedek işi").len(), 1, "{:?}", w.events.lock().unwrap());
    assert!(events_with(&w, "IHLAL").is_empty());
}

#[test]
fn yedek_yaratilamazsa_kurulum_basarili_hata_gorunur() {
    let w = linux("yh-hata");
    w.faults.sidecar_up_fails.store(true, Ordering::SeqCst);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "sağlıklı backend yan hizmet yüzünden geri alınmaz");
    assert_eq!(w.backend().version.as_deref(), Some(NEW));
    assert_eq!(sidecar(&w).as_deref(), Some(OLD));
    let d = baslat_yedek(&w);
    assert_eq!(d["sonuc"], "HATA", "{d}");
    let e = events_with(&w, "HATA: yedek: yeniden yaratılamadı");
    assert_eq!(e.len(), 1, "{:?}", w.events.lock().unwrap());
    assert!(!e[0].contains("gizli-parola"), "olayda sır yok");
}

#[test]
fn mesguliyet_olculemezse_yeniden_yaratilmaz() {
    let w = linux("yh-sonda");
    w.faults.sidecar_probe_fails.store(true, Ordering::SeqCst);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_eq!(sidecar(&w).as_deref(), Some(OLD), "ölçülemeyen iş kesilmez");
    assert_eq!(baslat_yedek(&w)["sonuc"], "OLCULEMEDI");
}

#[test]
fn yedek_konteyneri_yoksa_yaratilir() {
    // Konteyner yok (elle silinmiş): sonda "çalışmıyor" der — kesilecek iş yok, compose yeni imajla yaratır.
    let w = linux("yh-yok");
    w.faults.sidecar_version.lock().unwrap().take();
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_invariants(&w, "yedek konteyneri yoktu");
    assert_eq!(recreates(&w), [NEW]);
}
