//! Güven ve politika (§6): güncelleyici YALNIZ satıcı imzasına güvenir — niyet yetki değildir. Her
//! red "hiçbir şey değişmedi" ile ölçülür: backend hiç durdurulmadı, sürüm dizini açılmadı, DB aynı.
mod common;

use common::*;
use serde_json::json;
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::ipc::State;

/// Red sonrası: dokunulmamış dünya.
fn untouched(w: &World, ctx: &str) {
    let b = w.backend();
    assert_eq!(b.starts, 0, "{ctx}: backend yeniden başlatıldı");
    assert_eq!(w.current().as_deref(), Some(OLD), "{ctx}: current değişti");
    assert!(!w.layout.version_dir(NEW).exists(), "{ctx}: sürüm dizini açılmış");
    assert_eq!(w.db(), Db { finished: migrations_of(OLD), total: migrations_of(OLD), data: 42 }, "{ctx}: DB değişti");
}

fn code(w: &World) -> (State, Option<String>) {
    let s = w.status().expect("durum");
    (s.state, s.error_code)
}

fn rejected(tag: &str, setup: Setup, want: &str) -> World {
    let w = World::new(tag, setup);
    w.run(2).unwrap();
    let (state, c) = code(&w);
    assert_eq!(c.as_deref(), Some(want), "{tag}: durum {state:?} — {:?}", w.status().and_then(|s| s.message));
    assert!(matches!(state, State::Waiting | State::Downloading), "{tag}: {state:?}");
    untouched(&w, tag);
    w
}

#[test]
fn frozen_policy_neither_downloads_nor_applies() {
    let w = rejected(
        "dondur",
        Setup { lease: LeaseOpts { update: Some(json!({ "kip": "DONDUR" })), ..LeaseOpts::default() }, ..Setup::default() },
        "POLITIKA_DONDUR",
    );
    assert!(!w.layout.downloads().exists(), "dondurulmuşken indirme yapılmaz");
    let w = rejected(
        "yaptirim",
        Setup { lease: LeaseOpts { frozen_by_sanction: true, ..LeaseOpts::default() }, ..Setup::default() },
        "YAPTIRIM_DONUK",
    );
    assert!(!w.status().unwrap().policy.unwrap().allowed);
    rejected(
        "bilinmeyen-kip",
        Setup { lease: LeaseOpts { update: Some(json!({ "kip": "ZAMANLI" })), ..LeaseOpts::default() }, ..Setup::default() },
        "POLITIKA_DONDUR",
    );
}

#[test]
fn lease_is_the_authority() {
    rejected(
        "kanal-ustu",
        Setup { lease: LeaseOpts { channel_backend: Some("2.12.5"), ..LeaseOpts::default() }, ..Setup::default() },
        "SURUM_IZINSIZ",
    );
    rejected(
        "kanal-yok",
        Setup { lease: LeaseOpts { channel_backend: None, ..LeaseOpts::default() }, ..Setup::default() },
        "SURUM_IZINSIZ",
    );
    rejected(
        "hedef-ustu",
        Setup {
            lease: LeaseOpts { update: Some(json!({ "kip": "OTOMATIK", "hedefSurum": "2.12.9" })), ..LeaseOpts::default() },
            ..Setup::default()
        },
        "SURUM_IZINSIZ",
    );
    rejected("sure", Setup { lease: LeaseOpts { expired: true, ..LeaseOpts::default() }, ..Setup::default() }, "KIRA_SURESI_DOLDU");
    let w = World::new("kira-yok", Setup::default());
    std::fs::remove_file(w.layout.root.join("lisans").join("kira.jws")).unwrap();
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("KIRA_YOK"));
    untouched(&w, "kira-yok");
    // Kira başka bir kökle imzalanmış (yamalı): gömülü çapa tanımaz.
    let w = World::new("sahte-kok", Setup::default());
    let fake = Keys {
        root: ed25519_dalek::SigningKey::from_bytes(&[9; 32]),
        alt: ed25519_dalek::SigningKey::from_bytes(&[2; 32]),
        package: ed25519_dalek::SigningKey::from_bytes(&[3; 32]),
        staging: ed25519_dalek::SigningKey::from_bytes(&[4; 32]),
    };
    let (lease, _) = lease_and_entitlement(&fake, &LeaseOpts::default(), T0);
    std::fs::write(w.layout.root.join("lisans").join("kira.jws"), lease).unwrap();
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("KIRA_GECERSIZ"));
    untouched(&w, "sahte-kok");
}

#[test]
fn staging_package_key_only_for_test_class() {
    rejected("hazirlik-uretim", Setup { package_signer_staging: true, ..Setup::default() }, "PAKET_HAZIRLIK_ANAHTARI");
    let w = World::new(
        "hazirlik-test",
        Setup { package_signer_staging: true, lease: LeaseOpts { class: "TEST", ..LeaseOpts::default() }, ..Setup::default() },
    );
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "TEST sınıfında hazırlık anahtarı geçer");
    assert_invariants(&w, "hazırlık/TEST");
}

#[test]
fn manifest_must_match_channel_version_and_signature() {
    rejected("kanal", Setup { manifest_extra: Some(json!({ "kanal": "baskakanal" })), ..Setup::default() }, "MANIFEST_GECERSIZ");
    rejected("surum", Setup { manifest_extra: Some(json!({ "surum": "2.13.1" })), ..Setup::default() }, "MANIFEST_GECERSIZ");
    rejected(
        "yol",
        Setup {
            manifest_extra: Some(json!({ "paket": { "yol": "/baskakanal/backend/x.zip", "sha256": "A".repeat(43), "boyut": 10 } })),
            ..Setup::default()
        },
        "MANIFEST_GECERSIZ",
    );
    rejected("kaynak", Setup { manifest_extra: Some(json!({ "enAzKaynakSurum": "2.12.5" })), ..Setup::default() }, "KAYNAK_SURUM_ESKI");
    // Tanınmayan anahtarla imzalı manifest.
    let w = World::new("imza", Setup::default());
    let forged = manifest_for(&ed25519_dalek::SigningKey::from_bytes(&[7; 32]), "paket-2026", NEW, b"x", None);
    w.files.lock().unwrap().insert(format!("/{CHANNEL}/backend/{NEW}/manifest.jws"), forged.into_bytes());
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("MANIFEST_GECERSIZ"));
    untouched(&w, "imza");
}

#[test]
fn package_is_verified_before_use() {
    // Sunucu bozuk bayt verir: sha256 imzalı değerle tutmaz → açılmaz.
    let w = World::new("sha", Setup::default());
    w.faults.serve_tampered.store(true, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("PAKET_OZET"));
    untouched(&w, "sha");
    assert!(!w.layout.staging_dir(NEW).exists(), "imzasız veri zip ayrıştırıcısına girmez");
    // İmzalı kapsamda listede olmayan dosya (FAZLA) · başka müşterinin paketi.
    rejected("fazla", Setup { extra_file_in_scope: true, ..Setup::default() }, "PAKET_BUTUNLUK");
    rejected("musteri", Setup { customer: Some("baska-musteri"), ..Setup::default() }, "PAKET_BUTUNLUK");
}

#[test]
fn zip_path_traversal_is_rejected() {
    let w = World::new("gezinme", Setup::default());
    let mut files = version_files(NEW);
    let mut all = files.clone();
    all.extend(integrity_files(&files, NEW, &w.keys.package, "paket-2026", Some(CHANNEL)));
    files.clear();
    all.push(("../../kacak.txt".into(), b"disari".to_vec()));
    let zip = zip_of(&all);
    let manifest = manifest_for(&w.keys.package, "paket-2026", NEW, &zip, None);
    w.files.lock().unwrap().insert(format!("/{CHANNEL}/backend/{NEW}/paket.zip"), zip);
    w.files.lock().unwrap().insert(format!("/{CHANNEL}/backend/{NEW}/manifest.jws"), manifest.into_bytes());
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("PAKET_YOL"));
    assert!(!w.layout.versions().join("..").join("..").join("kacak.txt").exists());
    untouched(&w, "gezinme");
}

#[test]
fn expired_download_token_waits_for_backend() {
    let w = World::new("belirtec", Setup::default());
    let mut i = intent(NEW, "niyet-1", None);
    i["indirme"]["bitis"] = json!("2026-09-01T00:00:00Z");
    w.write_intent(&i);
    w.run(1).unwrap();
    assert_eq!(code(&w), (State::Downloading, Some("BELIRTEC_SURESI_DOLDU".into())));
    untouched(&w, "belirtec");
    // Backend taze belirteç yazınca (aynı niyet) devam eder.
    w.write_intent(&intent(NEW, "niyet-1", None));
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
}

#[test]
fn approval_mode_waits_for_the_panel() {
    let w = World::new(
        "onay",
        Setup { lease: LeaseOpts { update: Some(json!({ "kip": "ONAYLI" })), ..LeaseOpts::default() }, ..Setup::default() },
    );
    w.run(2).unwrap();
    let s = w.status().unwrap();
    assert_eq!(s.state, State::Ready, "{:?}", s.message);
    assert!(w.layout.version_dir(NEW).exists(), "paket önceden hazırlanır");
    assert_eq!(w.backend().starts, 0, "onaysız uygulanmaz");
    let at = tekserp_hizmet::timefmt::iso_seconds(T0 + 3_600_000);
    w.write_intent(&intent(NEW, "niyet-1", Some(json!({ "kullaniciId": "u-1", "ad": "Ayşe", "zaman": at, "planlanan": at }))));
    w.run(1).unwrap();
    assert_eq!(w.state(), Some(State::Ready), "planlanan zamandan önce değil");
    w.clock.fetch_add(3_600_000, Ordering::SeqCst);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_invariants(&w, "onaylı kurulum");
    let hist = std::fs::read_to_string(w.layout.history_file()).unwrap();
    assert!(hist.contains("\"kullaniciId\":\"u-1\""), "geçmiş onaylayanı taşır: {hist}");
}

#[test]
fn automatic_mode_waits_for_the_window_in_factory_time() {
    // T0 = 02:30 İstanbul; pencere 10:00–11:00 İstanbul (07:00–08:00Z).
    let w = World::new(
        "pencere",
        Setup {
            lease: LeaseOpts {
                update: Some(json!({ "kip": "OTOMATIK", "pencere": { "baslangic": "10:00", "bitis": "11:00" } })),
                ..LeaseOpts::default()
            },
            ..Setup::default()
        },
    );
    w.run(1).unwrap();
    let s = w.status().unwrap();
    assert_eq!(s.state, State::Ready);
    assert_eq!(s.planned.as_deref(), Some("2026-10-01T07:00:00.000Z"), "planlanan fabrika saatiyle pencere başı");
    assert_eq!(w.backend().starts, 0);
    w.clock.store(1_790_838_000_000 + 60_000, Ordering::SeqCst); // 2026-10-01T07:01Z = 10:01 İstanbul
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
}

#[test]
fn disk_full_blocks_before_touching_anything() {
    let w = World::new("disk", Setup::default());
    w.fs.free.store(1024 * 1024, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("DISK_DOLU"));
    assert_eq!(w.backend().starts, 0);
    assert_eq!(w.current().as_deref(), Some(OLD));
}

#[cfg(unix)]
#[test]
fn links_in_untrusted_dirs_are_not_followed() {
    let w = World::new("baglanti", Setup::default());
    let lisans = w.layout.root.join("lisans");
    let real = w.dir.join("baska-kira.jws");
    std::fs::rename(lisans.join("kira.jws"), &real).unwrap();
    std::os::unix::fs::symlink(&real, lisans.join("kira.jws")).unwrap();
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("KIRA_GECERSIZ"), "bağlantı izlenmez");
    untouched(&w, "bağlantı");
    // Niyet bağlantıysa: yok sayılır (biçimsiz), hiçbir şey yapılmaz.
    std::fs::remove_file(lisans.join("kira.jws")).unwrap();
    std::fs::rename(&real, lisans.join("kira.jws")).unwrap();
    let niyet = w.layout.intent_file();
    let elsewhere = w.dir.join("niyet-baska.json");
    std::fs::rename(&niyet, &elsewhere).unwrap();
    std::os::unix::fs::symlink(&elsewhere, &niyet).unwrap();
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("NIYET_BICIMSIZ"));
    untouched(&w, "niyet bağlantısı");
}
