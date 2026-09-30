//! Güven ve politika (§6, sözleşme §1–§3): güncelleyici YALNIZ satıcı imzasına güvenir — niyet yetki
//! değildir. Her red "hiçbir şey değişmedi" ile ölçülür: backend hiç durdurulmadı, sürüm dizini
//! açılmadı, DB aynı. Kararlar TS `decideUpdate` aynasından (`durum.json` `karar` · `bekleyen`).
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

/// Son karar `karar/neden` (aday olsun olmasın).
fn verdict(w: &World) -> String {
    let d = w.status().and_then(|s| s.decision).expect("karar");
    format!("{}/{}", d.karar.label(), d.neden.unwrap_or_else(|| "-".into()))
}

fn rejected(tag: &str, setup: Setup, want: &str) -> World {
    let w = World::new(tag, setup);
    w.run(2).unwrap();
    let (state, c) = code(&w);
    assert_eq!(c.as_deref(), Some(want), "{tag}: durum {state:?} — {:?} · karar {}", w.status().and_then(|s| s.message), verdict(&w));
    assert!(matches!(state, State::Waiting | State::Downloading), "{tag}: {state:?}");
    untouched(&w, tag);
    w
}

/// Kesin paket hatası: ilk turda kodu, sonraki turda yeniden indirmenin ERTELENDİĞİNİ gösterir.
fn rejected_package(tag: &str, setup: Setup, want: &str) -> World {
    let w = World::new(tag, setup);
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some(want), "{tag}: {:?}", w.status().and_then(|s| s.message));
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("INDIRME_ERTELENDI"), "{tag}: kesin hatada hemen yeniden indirilmez");
    untouched(&w, tag);
    w
}

fn refused(tag: &str, setup: Setup, want_verdict: &str) -> World {
    let w = World::new(tag, setup);
    w.run(2).unwrap();
    assert_eq!(verdict(&w), want_verdict, "{tag}: {:?}", w.status().and_then(|s| s.message));
    assert_eq!(w.state(), Some(State::Waiting), "{tag}");
    untouched(&w, tag);
    w
}

fn lease(update: Option<serde_json::Value>) -> LeaseOpts {
    LeaseOpts { update, ..LeaseOpts::default() }
}

#[test]
fn frozen_policy_neither_downloads_nor_applies() {
    let w = refused("dondur", Setup { lease: lease(Some(policy("DONDUR", &[], None))), ..Setup::default() }, "DONDURULDU/POLITIKA");
    assert!(!w.layout.downloads().exists(), "dondurulmuşken indirme yapılmaz");
    assert!(w.status().unwrap().pending.is_none(), "aday aranmaz (ağa çıkılmaz)");
    let w = refused(
        "yaptirim",
        Setup { lease: LeaseOpts { frozen_by_sanction: true, ..LeaseOpts::default() }, ..Setup::default() },
        "DONDURULDU/YAPTIRIM",
    );
    assert!(w.status().unwrap().policy.unwrap().frozen);
    // Onay DONDUR'u açmaz.
    refused(
        "dondur-onay",
        Setup {
            lease: lease(Some(policy("DONDUR", &[], None))),
            intent: Some(intent(Some(approval("onay-1", NEW, "HEMEN")))),
            ..Setup::default()
        },
        "DONDURULDU/POLITIKA",
    );
    // Tanınmayan kip: kira şeması düşer (TS ile aynı) → yetki yok.
    let w = rejected(
        "bilinmeyen-kip",
        Setup { lease: lease(Some(json!({ "kip": "ZAMANLI", "pencere": null, "araliklar": [], "hedefSurum": null }))), ..Setup::default() },
        "KIRA_GECERSIZ",
    );
    assert_eq!(verdict(&w), "DONDURULDU/KIRA_YOK");
}

#[test]
fn lease_is_the_authority() {
    let w = refused(
        "sure",
        Setup { lease: LeaseOpts { expired: true, update: None, ..LeaseOpts::default() }, ..Setup::default() },
        "DONDURULDU/KIRA_YOK",
    );
    assert!(w.status().unwrap().policy.is_none(), "süresi geçen kira politika taşımaz");
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
    let (lease_text, _) = lease_and_entitlement(&fake, &LeaseOpts::default(), T0);
    std::fs::write(w.layout.root.join("lisans").join("kira.jws"), lease_text).unwrap();
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("KIRA_GECERSIZ"));
    untouched(&w, "sahte-kok");
    // Eski satıcı (alan yok) → varsayılan ONAYLI: onaysız hiçbir şey kurulmaz.
    let w = World::new("eski-satici", Setup { lease: lease(None), ..Setup::default() });
    w.run(2).unwrap();
    assert_eq!(verdict(&w), "ONAY_BEKLIYOR/-");
    assert_eq!(w.status().unwrap().policy.unwrap().source, "VARSAYILAN");
    assert_eq!(w.backend().starts, 0);
}

#[test]
fn maintenance_and_entitlement_gate() {
    refused(
        "bakim",
        Setup { lease: LeaseOpts { maintenance_end: Some(T0 - 3 * DAY), ..LeaseOpts::default() }, ..Setup::default() },
        "UYGUN_DEGIL/BAKIM_DISI",
    );
    refused(
        "hak-yok",
        Setup { lease: LeaseOpts { maintenance_end: None, ..LeaseOpts::default() }, ..Setup::default() },
        "UYGUN_DEGIL/HAK_YOK",
    );
}

#[test]
fn pinning_reads_the_pinned_version_and_never_goes_past_it() {
    // Sabitleme: `son.json` değil `<hedef>/surum.json` okunur.
    let w = World::new("sabit", Setup { lease: lease(Some(policy("OTOMATIK", &open_window(), Some(NEW)))), ..Setup::default() });
    w.files.lock().unwrap().remove(&format!("/{CHANNEL}/backend/son.json"));
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_invariants(&w, "sabitleme");
    // Kurulu ≥ hedef: ağa çıkmadan GUNCEL.
    let w = refused(
        "hedefte",
        Setup { lease: lease(Some(policy("OTOMATIK", &open_window(), Some(OLD)))), ..Setup::default() },
        "GUNCEL/HEDEF_ULASILDI",
    );
    assert!(w.status().unwrap().pending.is_none());
    // Sabitlenen yol başka sürümün bildirimini verirse: HEDEF_DISI.
    let w = World::new("hedef-disi", Setup { lease: lease(Some(policy("OTOMATIK", &open_window(), Some("2.12.9")))), ..Setup::default() });
    let other = w.files.lock().unwrap().get(&format!("/{CHANNEL}/backend/{NEW}/surum.json")).cloned().unwrap();
    w.files.lock().unwrap().insert(format!("/{CHANNEL}/backend/2.12.9/surum.json"), other);
    w.run(2).unwrap();
    assert_eq!(verdict(&w), "UYGUN_DEGIL/HEDEF_DISI");
    untouched(&w, "hedef-disi");
}

#[test]
fn staging_package_key_only_for_test_class() {
    rejected("hazirlik-uretim", Setup { package_signer_staging: true, ..Setup::default() }, "JWS_KID");
    let w = World::new(
        "hazirlik-test",
        Setup { package_signer_staging: true, lease: LeaseOpts { class: "TEST", ..LeaseOpts::default() }, ..Setup::default() },
    );
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "TEST sınıfında hazırlık anahtarı geçer");
    assert_invariants(&w, "hazırlık/TEST");
}

#[test]
fn release_manifest_must_match_channel_signer_and_schema() {
    rejected("kanal", Setup { manifest_extra: Some(json!({ "kanal": "baskakanal" })), ..Setup::default() }, "SURUM_KANAL");
    rejected("imzalayan", Setup { manifest_extra: Some(json!({ "paketImzaKid": "paket-hazirlik" })), ..Setup::default() }, "SURUM_ANAHTAR");
    rejected(
        "yol",
        Setup {
            manifest_extra: Some(json!({ "paket": { "ad": "../x.zip", "boyut": 10, "sha256": "a".repeat(64), "paketId": PACKAGE_ID } })),
            ..Setup::default()
        },
        "BELGE_SEMA",
    );
    rejected("surum-v2", Setup { manifest_extra: Some(json!({ "v": 2 })), ..Setup::default() }, "BELGE_SURUM");
    refused(
        "kaynak",
        Setup { manifest_extra: Some(json!({ "minKaynakSurum": "2.12.5" })), ..Setup::default() },
        "UYGUN_DEGIL/KAYNAK_SURUM_ESKI",
    );
    // Tanınmayan anahtarla imzalı bildirim.
    let w = World::new("imza", Setup::default());
    let payload = manifest_payload("paket-2026", NEW, b"x", None);
    let forged = sign_manifest(&ed25519_dalek::SigningKey::from_bytes(&[7; 32]), "paket-2026", &payload);
    publish(&w.files, &payload, &forged, None, true);
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("JWS_IMZA"));
    untouched(&w, "imza");
    // İşaretçinin imzasız alanı yetki değildir: fazla alanlı işaretçi reddedilir.
    let w = World::new("isaretci", Setup::default());
    w.files.lock().unwrap().insert(format!("/{CHANNEL}/backend/son.json"), br#"{"v":1,"bildirim":"a.b.c","surum":"9.9.9"}"#.to_vec());
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("SURUM_ISARETCI"));
    untouched(&w, "işaretçi");
}

#[test]
fn package_is_verified_and_bound_before_use() {
    // Sunucu bozuk bayt verir: sha256 imzalı değerle tutmaz → açılmaz, bir sonraki turda yeniden indirilmez.
    let w = World::new("sha", Setup::default());
    w.faults.serve_tampered.store(true, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("PAKET_OZETI"));
    untouched(&w, "sha");
    assert!(!w.layout.staging_dir(NEW).exists(), "imzasız veri zip ayrıştırıcısına girmez");
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("INDIRME_ERTELENDI"), "kesin hatada hemen yeniden indirilmez");
    // Aralık dolunca (ve paket düzelince) iner.
    w.faults.serve_tampered.store(false, Ordering::SeqCst);
    w.clock.fetch_add(16 * 60_000, Ordering::SeqCst);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    // İmzalı kapsamda listede olmayan dosya (FAZLA) · başka müşterinin paketi (bağ) · başka paket (bağ).
    rejected_package("fazla", Setup { extra_file_in_scope: true, ..Setup::default() }, "BUTUNLUK_GECERSIZ");
    rejected_package("musteri", Setup { customer: Some("baska-musteri"), ..Setup::default() }, "PAKET_BAGI");
}

#[test]
fn package_of_another_version_is_not_bound() {
    // İmzalı bildirim 2.13.1 der, paket (künyesi) 2.13.0: indirilir, özet tutar, bağ düşer.
    let w = World::new("bag", Setup::default());
    let zip = w.files.lock().unwrap().get(&format!("/{CHANNEL}/backend/{NEW}/{}", package_name(NEW))).cloned().unwrap();
    let mut payload = manifest_payload("paket-2026", "2.13.1", &zip, None);
    payload["gocSayisi"] = json!(migrations_of(NEW));
    publish(&w.files, &payload, &sign_manifest(&w.keys.package, "paket-2026", &payload), Some(zip), true);
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("PAKET_BAGI"));
    assert!(!w.layout.version_dir("2.13.1").exists());
    untouched(&w, "bağ");
}

#[test]
fn zip_path_traversal_is_rejected() {
    let w = World::new("gezinme", Setup::default());
    let files = version_files(NEW);
    let mut all = files.clone();
    all.extend(integrity_files(&files, NEW, &w.keys.package, "paket-2026", Some(CHANNEL)));
    all.push(("../../kacak.txt".into(), b"disari".to_vec()));
    let zip = zip_of(&all);
    let payload = manifest_payload("paket-2026", NEW, &zip, None);
    publish(&w.files, &payload, &sign_manifest(&w.keys.package, "paket-2026", &payload), Some(zip), true);
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("PAKET_YOL"));
    assert!(!w.layout.staging_dir(NEW).exists(), "yarım açılış silinir");
    assert!(!w.layout.versions().join("..").join("..").join("kacak.txt").exists());
    untouched(&w, "gezinme");
}

#[test]
fn expired_download_token_waits_for_backend() {
    let w = World::new("belirtec", Setup::default());
    let mut i = intent(None);
    i["indirme"]["bitis"] = json!("2026-09-01T00:00:00Z");
    w.write_intent(&i);
    w.run(1).unwrap();
    assert_eq!(code(&w), (State::Waiting, Some("BELIRTEC_SURESI_DOLDU".into())));
    untouched(&w, "belirtec");
    // Backend taze belirteç yazınca devam eder.
    w.write_intent(&intent(None));
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    // Niyet hiç yok: belirteç yok.
    let w = World::new("niyetsiz", Setup { intent: None, ..Setup::default() });
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("BELIRTEC_YOK"));
    untouched(&w, "niyetsiz");
}

#[test]
fn approval_mode_waits_for_the_panel() {
    let w = World::new("onay", Setup { lease: lease(Some(policy("ONAYLI", &[], None))), ..Setup::default() });
    w.run(2).unwrap();
    let s = w.status().unwrap();
    assert_eq!(s.state, State::Ready, "{:?}", s.message);
    assert_eq!(verdict(&w), "ONAY_BEKLIYOR/-");
    assert!(w.layout.version_dir(NEW).exists(), "paket önceden hazırlanır");
    assert_eq!(w.backend().starts, 0, "onaysız uygulanmaz");
    // Başka sürümün onayı sayılmaz.
    w.write_intent(&intent(Some(approval("onay-0", "2.13.5", "HEMEN"))));
    w.run(1).unwrap();
    assert_eq!(verdict(&w), "ONAY_BEKLIYOR/-");
    // PENCERE onayı ama kirada pencere yok: bekler.
    w.write_intent(&intent(Some(approval("onay-1", NEW, "PENCERE"))));
    w.run(1).unwrap();
    assert_eq!(verdict(&w), "PENCERE_BEKLIYOR/PENCERE_YOK");
    assert_eq!(w.backend().starts, 0);
    w.write_intent(&intent(Some(approval("onay-2", NEW, "HEMEN"))));
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_invariants(&w, "onaylı kurulum");
    let hist = std::fs::read_to_string(w.layout.history_file()).unwrap();
    assert!(hist.contains("\"kullaniciId\":\"u-1\"") && hist.contains("\"onayId\":\"onay-2\""), "geçmiş onaylayanı taşır: {hist}");
}

#[test]
fn automatic_mode_waits_for_the_absolute_window() {
    // Kiradaki mutlak aralık T0'dan 6 sa sonra başlıyor: güncelleyici saat dilimi hesabı YAPMAZ.
    let start = T0 + 6 * HOUR;
    let w = World::new("pencere", Setup { lease: lease(Some(policy("OTOMATIK", &[(start, start + 3 * HOUR)], None))), ..Setup::default() });
    w.run(1).unwrap();
    let s = w.status().unwrap();
    assert_eq!(s.state, State::Ready);
    assert_eq!(verdict(&w), "PENCERE_BEKLIYOR/-");
    assert_eq!(s.planned.as_deref(), Some(iso(start).as_str()), "planlanan: sıradaki aralığın başı");
    assert_eq!(w.backend().starts, 0);
    w.clock.store(start + 60_000, Ordering::SeqCst);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_eq!(w.status().unwrap().last.unwrap().result, "BASARILI");
    // HEMEN onayı pencereyi beklemez (OTOMATİK kipte de).
    let w = World::new(
        "pencere-hemen",
        Setup {
            lease: lease(Some(policy("OTOMATIK", &[(start, start + 3 * HOUR)], None))),
            intent: Some(intent(Some(approval("onay-h", NEW, "HEMEN")))),
            ..Setup::default()
        },
    );
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
}

#[test]
fn disk_full_blocks_before_touching_anything() {
    let w = World::new("disk", Setup::default());
    w.fs.free.store(1024 * 1024, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(code(&w).1.as_deref(), Some("DISK_DOLU"));
    untouched(&w, "disk");
    assert!(!w.layout.downloads().join(format!("{NEW}.zip.part")).exists(), "yer yokken indirme başlamaz");
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
    // Niyet bağlantıysa: yok sayılır (biçimsiz), belirteç yok → hiçbir şey yapılmaz.
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
