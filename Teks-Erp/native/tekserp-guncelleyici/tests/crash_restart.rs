//! Durum makinesinin "öldür ve yeniden başlat" ölçümü (§7): tam bir güncellemenin HER değiştiren
//! işleminden önce süreç öldürülür, aynı dünyada yeni motorla yeniden başlatılır ve son durumun
//! değişmezleri ölçülür — ya BAŞARILI (yeni sürüm + tam göç + veri) ya GERİ DÖNDÜ (eski sürüm +
//! işlem öncesi DB); arada kalmış, yetim, düz yedek/anahtar bırakmış hiçbir son durum yok.
mod common;

use common::*;
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::ipc::State;

fn world(tag: &str) -> World {
    World::new(tag, Setup::default())
}

#[test]
fn happy_path_updates_and_records() {
    let w = world("mutlu");
    let restarts = w.run_to_rest(0);
    assert_eq!(restarts, 0);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded, "{:?} {:?}", st.error_code, st.message);
    assert_invariants(&w, "mutlu yol");
    let b = w.backend();
    assert!(b.starts >= 2, "doğrulama + normal başlatma: {}", b.starts);
    let recs = install_records(&w);
    assert_eq!(recs.len(), 1);
    assert_eq!(recs[0]["tur"], "KURULUM");
    assert_eq!(recs[0]["oncekiSurum"], OLD);
    assert_eq!(recs[0]["yeniSurum"], NEW);
    assert_eq!(recs[0]["migrationSayisi"], 2);
    assert_eq!(recs[0]["yeniMigrationSayisi"], 4);
    assert_eq!(recs[0]["commit"], COMMIT, "commit imzalı bildirimden");
    assert_eq!(recs[0]["paketOzeti"].as_str().map(str::len), Some(64));
    // Yoklama raporunun `son`u (sözleşme §3.1): tam biçim, başarıda kod yok.
    let son = st.last.clone().expect("son");
    assert_eq!(
        (son.target.as_str(), son.source.as_deref(), son.result.as_str(), son.kod.as_deref(), son.data_restored),
        (NEW, Some(OLD), "BASARILI", None, false)
    );
    // Yedek: kurulumun alıcısı + geçici anahtar; düz döküm yok; anahtar DPAPI'li.
    let op = son.record_id.clone();
    let enc = std::fs::read(w.layout.update_backup_dir(&op).join("db.dump.tkenc")).unwrap();
    assert!(enc.starts_with(b"ENC2:"), "iki alıcı (müşteri + geçici)");
    assert!(w.layout.op_keys(&op).join("guncelleme.tksec.dpapi").exists());
    // Sonraki tur: aday kurulu sürüm (GUNCEL/SURUM_GUNCEL) — iş yok, sonuç korunur.
    w.run(2).unwrap();
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded);
    assert_eq!(st.pending.map(|p| (p.karar, p.neden)), Some(("GUNCEL".into(), Some("SURUM_GUNCEL".into()))));
    assert_eq!(install_records(&w).len(), 1, "ikinci kayıt yok");
}

/// Her enjeksiyon noktasında öldür → yeniden başlat → değişmezler. Göç adımında ölüm GERİ DÖNDÜ'ye
/// (yarım göç güvenilmez), diğer her yerde işlem sürdürülür ya da güvenle geri alınır.
#[test]
fn kill_at_every_point_of_a_successful_update() {
    let points = world("sayac").count_points();
    assert!(points >= 40, "enjeksiyon noktası beklenenden az: {points}");
    let mut outcomes = std::collections::BTreeMap::new();
    for torn in [false, true] {
        for k in 1..=points {
            let w = world("oldur");
            w.crash.arm(k, torn);
            let killed = w.run(3).is_err();
            assert!(killed, "nokta {k}: ölüm tetiklenmedi");
            let last = w.crash.log.lock().unwrap().last().cloned().unwrap_or_default();
            w.crash.disarm();
            w.run_to_rest(4);
            let ctx = format!("nokta {k}{} ({last})", if torn { " yırtık" } else { "" });
            assert_invariants(&w, &ctx);
            *outcomes.entry(format!("{:?}", w.state().unwrap())).or_insert(0u32) += 1;
            if w.state() == Some(State::Succeeded) {
                assert_eq!(install_records(&w).iter().filter(|r| r["tur"] == "KURULUM").count(), 1, "{ctx}: kurulum kaydı tekil değil");
            }
        }
    }
    assert!(outcomes.get("Succeeded").copied().unwrap_or(0) > 0, "{outcomes:?}");
    assert!(outcomes.get("RolledBack").copied().unwrap_or(0) > 0, "göçte ölüm geri dönüş üretmeli: {outcomes:?}");
}

/// Sağlık düşer → geri dönüş (göç uygulanmıştı → DB yedekten); her noktada öldürülse de son GERİ DÖNDÜ.
#[test]
fn kill_at_every_point_of_a_rollback() {
    let setup = |tag: &str| {
        let w = world(tag);
        *w.faults.unhealthy_version.lock().unwrap() = Some(NEW.into());
        w
    };
    let w = setup("saglik");
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::RolledBack);
    assert_eq!(st.error_code.as_deref(), Some("SAGLIK_ZAMAN_ASIMI"), "{:?}", st.message);
    let son = st.last.clone().expect("son");
    assert_eq!((son.result.as_str(), son.kod.as_deref(), son.data_restored), ("GERI_DONDU", Some("SAGLIK_HATASI"), true));
    assert_invariants(&w, "sağlık geri dönüşü");
    let recs = install_records(&w);
    assert_eq!(recs.last().unwrap()["tur"], "GERI_ALMA");
    assert!(w.events.lock().unwrap().iter().any(|e| e.starts_with("UYARI: Güncelleme geri alındı")), "olay günlüğü");
    let points = setup("sayac2").count_points();
    for k in 1..=points {
        let w = setup("oldur2");
        w.crash.arm(k, false);
        assert!(w.run(3).is_err(), "nokta {k}: ölüm yok");
        w.crash.disarm();
        w.run_to_rest(4);
        assert_eq!(w.state(), Some(State::RolledBack), "nokta {k}: {:?}", w.status().map(|s| (s.error_code, s.message)));
        assert_invariants(&w, &format!("geri dönüşte nokta {k}"));
    }
}

/// İki ölüm: ilk koşumda k1'de, kurtarma koşumunda k2'de (seyreltilmiş ızgara).
#[test]
fn double_kill_during_recovery() {
    let points = world("sayac3").count_points();
    for k1 in (1..=points).step_by(5) {
        for k2 in [1u64, 2, 3, 5, 8, 13] {
            let w = world("cift");
            w.crash.arm(k1, false);
            assert!(w.run(3).is_err());
            w.crash.arm(k2, false);
            let _ = w.run(3);
            w.crash.disarm();
            w.run_to_rest(4);
            assert_invariants(&w, &format!("çift ölüm {k1}/{k2}"));
        }
    }
}

#[test]
fn migration_failure_restores_database() {
    let w = world("goc");
    w.faults.migrate_fails.store(true, Ordering::SeqCst);
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::RolledBack);
    assert_eq!(st.error_code.as_deref(), Some("GOC_HATASI"));
    assert!(!st.message.clone().unwrap().contains("gizli-parola"), "araç çıktısındaki parola maskelenmeli");
    let son = st.last.clone().expect("son");
    assert_eq!((son.result.as_str(), son.kod.as_deref(), son.data_restored), ("GERI_DONDU", Some("GOC_HATASI"), true));
    let text = std::fs::read_to_string(w.layout.status_file()).unwrap();
    assert!(!text.contains("gizli-parola"), "durum.json sır taşımaz");
    assert_invariants(&w, "göç hatası");
}

#[test]
fn license_regression_rolls_back() {
    let w = world("lisans");
    *w.faults.license_broken_version.lock().unwrap() = Some(NEW.into());
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::RolledBack, Some("SAGLIK_LISANS")));
    assert_invariants(&w, "lisans kötüleşti");
}

#[test]
fn rolled_back_version_is_not_retried_until_a_fresh_approval() {
    let w = world("tekrar");
    *w.faults.unhealthy_version.lock().unwrap() = Some(NEW.into());
    w.run_to_rest(0);
    let starts = w.backend().starts;
    w.run(3).unwrap();
    assert_eq!(w.backend().starts, starts, "geri dönen sürüm kendiliğinden yeniden denendi");
    assert_eq!(w.state(), Some(State::RolledBack));
    *w.faults.unhealthy_version.lock().unwrap() = None;
    // Başka bir sürümün onayı açmaz; aynı sürüme YENİ onay açar.
    w.write_intent(&intent(Some(approval("onay-baska", "2.12.9", "HEMEN"))));
    w.run(2).unwrap();
    assert_eq!(w.backend().starts, starts, "başka sürümün onayı geri dönen sürümü açmaz");
    w.write_intent(&intent(Some(approval("onay-2", NEW, "HEMEN"))));
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_invariants(&w, "yeni onayla ikinci deneme");
    let hist = std::fs::read_to_string(w.layout.history_file()).unwrap();
    assert!(hist.contains("\"onayId\":\"onay-2\""), "geçmiş tetikleyen onayı taşır: {hist}");
}

#[test]
fn download_resumes_after_cut() {
    let w = world("devam");
    w.faults.cut_after.store(4096, Ordering::SeqCst);
    w.run(1).unwrap();
    let part = w.layout.downloads().join(format!("{NEW}.zip.part"));
    assert_eq!(std::fs::metadata(&part).map(|m| m.len()).ok(), Some(4096), "parça korunmalı");
    assert_eq!(w.state(), Some(State::Downloading));
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert!(!part.exists());
    assert_invariants(&w, "kesilen indirme");
}
