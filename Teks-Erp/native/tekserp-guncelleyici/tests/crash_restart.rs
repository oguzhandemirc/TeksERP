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

/// Sözleşme 4 öncesi bir backend'e (`/health/yerel` yok) geri dönüş: canlılık public `/health`ten okunur,
/// geri dönüş başarılı biter (HATA'ya düşmez); işlem öncesi lisans görüntüsü de yoktur.
#[test]
fn rollback_reaches_legacy_backend_without_local_health() {
    let w = world("eski-saglik");
    *w.faults.legacy_health_version.lock().unwrap() = Some(OLD.into());
    *w.faults.unhealthy_version.lock().unwrap() = Some(NEW.into());
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::RolledBack, Some("SAGLIK_ZAMAN_ASIMI")), "{:?}", st.message);
    assert_eq!(w.current().as_deref(), Some(OLD));
    assert_invariants(&w, "eski backend'e geri dönüş");
}

/// Yeni sürüm `/health/yerel`i tanımıyorsa lisans ölçülemez: beklemeden `SAGLIK_LISANS_OLCULEMEDI`, geri
/// dönülür — public `/health` (kurala aykırı olarak) lisans taşısa bile oradan alınmaz.
#[test]
fn new_version_without_local_health_is_not_accepted() {
    let w = world("yerelsiz");
    *w.faults.legacy_health_version.lock().unwrap() = Some(NEW.into());
    w.faults.public_health_has_license.store(true, Ordering::SeqCst);
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::RolledBack, Some("SAGLIK_LISANS_OLCULEMEDI")), "{:?}", st.message);
    let detail = st.last_detail.clone().and_then(|d| d.message);
    assert!(detail.as_deref().is_some_and(|m| m.contains("/health/yerel ucunu tanımıyor")), "beklemeden düşmeli: {detail:?}");
    assert_eq!(w.current().as_deref(), Some(OLD));
    assert_invariants(&w, "yerel sağlıksız yeni sürüm");
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
    let st = w.status().unwrap();
    assert_eq!(st.decision.map(|d| d.karar.label()), Some("KUR"), "karar (TS aynası) KUR der");
    assert_eq!(
        st.pending.map(|p| (p.karar, p.neden)),
        Some(("ONAY_BEKLIYOR".to_string(), None)),
        "ama aday yeni onay bekler (rapor bunu gösterir)"
    );
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

/// Aynı makinede ikinci kanal: yönetilen backend hizmetinin adı `ayar.json` `backendHizmeti`den
/// (kanal kaydı `backend.hizmetAdi`); varsayılan adlı hizmete hiç dokunulmaz.
#[test]
fn backend_service_name_comes_from_settings() {
    let w = world("hizmet-adi");
    w.rename_backend("TeksERP-Backend-testkanal");
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().map(|s| (s.error_code, s.message)));
    assert_invariants(&w, "hizmet adı parametresi");
    assert!(w.svcs.lock().unwrap().get(BACKEND).is_none(), "varsayılan adla hizmet aranmadı/yaratılmadı");
    // Biçimsiz ad: ayar okunmaz, hiçbir şey yapılmaz.
    let w = world("hizmet-adi-bicimsiz");
    std::fs::write(w.layout.settings_file(), r#"{"v":1,"guncellemeSunucusu":"https://guncelleme.test","backendHizmeti":"a b"}"#).unwrap();
    w.run(1).unwrap();
    let st = w.status().unwrap();
    assert_eq!(st.error_code.as_deref(), Some("AYAR_BICIMSIZ"));
    assert_eq!(w.backend().starts, 0);
}

/// `.env` okuyucusu biçimsiz satırı backend gibi sessizce atlar (D2b); atlanan satır güncelleyicinin
/// ZORUNLU anahtarıysa hiçbir şey yapılmaz, durum `AYAR_EKSIK` — ileti anahtar adı taşır, değer değil.
#[test]
fn silently_skipped_required_env_key_stops_updater() {
    let w = world("env-zorunlu");
    std::fs::write(
        w.layout.backend_env(),
        "PORT=4999\nDATABASE_URL postgresql://tekserp:gizli-parola@127.0.0.1:5432/tekserp\nPG_BIN_DIR=/fake/pgbin\n",
    )
    .unwrap();
    w.run(1).unwrap();
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::Waiting, Some("AYAR_EKSIK")));
    assert!(st.message.as_deref().is_some_and(|m| m.contains("DATABASE_URL") && !m.contains("gizli-parola")), "{:?}", st.message);
    assert_eq!(w.backend().starts, 0);
    assert_eq!(w.current().as_deref(), Some(OLD));
}

/// Kalp atışı (§5.2): her tur `sonCanlilik`i tazeler — değişen bir şey olmasa da; eşik duruma göre.
#[test]
fn heartbeat_is_refreshed_every_tick() {
    let w = World::new(
        "canlilik",
        Setup { lease: LeaseOpts { update: Some(policy("DONDUR", &[], None)), ..LeaseOpts::default() }, ..Setup::default() },
    );
    w.run(1).unwrap();
    let a = w.status().unwrap();
    assert!(!a.heartbeat.is_empty() && a.heartbeat == a.at);
    assert_eq!((a.tick_s, a.liveness_threshold_s), (60, 180), "boşta: 3 tur");
    w.clock.fetch_add(61_000, Ordering::SeqCst);
    w.run(1).unwrap();
    let b = w.status().unwrap();
    assert!(b.heartbeat > a.heartbeat, "hiçbir şey değişmese de kalp atışı ilerler: {} → {}", a.heartbeat, b.heartbeat);
    assert_eq!(b.decision, a.decision);
}

/// HATA (geri alınamadı) dünyası: her sürüm sağlıksız → doğrulama da geri dönüş de düşer; sonra insan düzeltir.
fn failed_world(tag: &str) -> World {
    let w = world(tag);
    w.faults.unhealthy_all.store(true, Ordering::SeqCst);
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::Failed, Some("INSAN_GEREKIYOR")), "{:?}", st.message);
    assert_eq!(st.last_detail.and_then(|d| d.error_code).as_deref(), Some("GERI_DONUS_SAGLIKSIZ"));
    w.faults.unhealthy_all.store(false, Ordering::SeqCst);
    w
}

fn assert_still_failed(w: &World, code: &str, starts: u64, ctx: &str) {
    w.run(2).unwrap();
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::Failed, Some(code)), "{ctx}: {:?}", st.message);
    assert_eq!(w.backend().starts, starts, "{ctx}: işlem başladı");
}

/// HATA'dan çıkış (D7 raporu): yalnız başarısız denemenin sürümüne verilen YENİ onay açar; eski ya da
/// imzalı aday olmayan bir sürüme onay `ONAY_REDDEDILDI` ile reddedilir (politika OTOMATİK olsa da
/// kendiliğinden kurulum başlamaz).
#[test]
fn failed_state_is_left_only_by_an_approval_for_the_failed_version() {
    let w = failed_world("hata-onay");
    let starts = w.backend().starts;
    assert_still_failed(&w, "INSAN_GEREKIYOR", starts, "onaysız");
    w.write_intent(&intent(Some(approval("onay-eski", "2.12.9", "HEMEN"))));
    assert_still_failed(&w, "ONAY_REDDEDILDI", starts, "başarısız denemeden ESKİ sürüme onay");
    w.write_intent(&intent(Some(approval("onay-yabanci", "9.0.0", "HEMEN"))));
    assert_still_failed(&w, "ONAY_REDDEDILDI", starts, "imzalı aday olmayan YENİ sürüme onay");
    let m = w.status().unwrap().message.unwrap_or_default();
    assert!(m.contains("imzalı aday 2.13.0") && m.contains("(2.13.0)"), "ileti kuralı söyler: {m}");
    // Geçerli onay ama uygulanamıyor (belirteç yok): HATA görünür kalır, kod nedeni söyler.
    w.write_intent(&serde_json::json!({ "v": 1, "yazildi": iso(T0), "onay": approval("onay-ayni", NEW, "HEMEN") }));
    assert_still_failed(&w, "BELIRTEC_YOK", starts, "onay var, belirteç yok");
    w.write_intent(&intent(Some(approval("onay-ayni", NEW, "HEMEN"))));
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().map(|s| (s.error_code, s.message)));
    assert_invariants(&w, "başarısız sürüme yeni onay");
}

/// HATA'dan çıkışın ikinci yolu: imzalı bildirimle gelen daha YENİ adaya verilen yeni onay; aday ilerlemişken
/// başarısız sürüme verilen onay artık uygulanamaz (yalnız imzalı aday kurulur) — o da reddedilir.
#[test]
fn failed_state_is_left_by_an_approval_for_a_newer_signed_candidate() {
    const NEWER: &str = "2.14.0";
    let w = failed_world("hata-yeni-aday");
    let files = version_files(NEWER);
    let mut all = files.clone();
    all.extend(integrity_files(&files, NEWER, &w.keys.package, "paket-2026", Some(CHANNEL)));
    let zip = zip_of(&all);
    let payload = manifest_payload("paket-2026", NEWER, &zip, None);
    publish(&w.files, &payload, &sign_manifest(&w.keys.package, "paket-2026", &payload), Some(zip), true);
    let starts = w.backend().starts;
    w.write_intent(&intent(Some(approval("onay-eski-hedef", NEW, "HEMEN"))));
    assert_still_failed(&w, "ONAY_REDDEDILDI", starts, "aday ilerledi, başarısız sürüme onay");
    w.write_intent(&intent(Some(approval("onay-yeni-aday", NEWER, "HEMEN"))));
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().map(|s| (s.error_code, s.message)));
    assert_eq!(w.current().as_deref(), Some(NEWER));
}

/// Başarısız denemeden ESKİ ama imzalı bir aday (politika hedefi geri çekildi gibi) onaylansa da HATA'dan
/// çıkış yolu değildir: onay aday çözülmeden reddedilir.
#[test]
fn failed_state_is_not_left_by_an_older_signed_candidate() {
    const OLDER: &str = "2.12.5";
    let w = failed_world("hata-eski-aday");
    let files = version_files(OLDER);
    let mut all = files.clone();
    all.extend(integrity_files(&files, OLDER, &w.keys.package, "paket-2026", Some(CHANNEL)));
    let zip = zip_of(&all);
    let payload = manifest_payload("paket-2026", OLDER, &zip, None);
    publish(&w.files, &payload, &sign_manifest(&w.keys.package, "paket-2026", &payload), Some(zip), true);
    let starts = w.backend().starts;
    w.write_intent(&intent(Some(approval("onay-eski-aday", OLDER, "HEMEN"))));
    assert_still_failed(&w, "ONAY_REDDEDILDI", starts, "başarısız denemeden eski imzalı aday");
}

fn izin_guvensiz(w: &World, needle: &str, ctx: &str) {
    let st = w.status().unwrap();
    assert_eq!((st.state, st.error_code.as_deref()), (State::Waiting, Some("IZIN_GUVENSIZ")), "{ctx}: {:?}", st.message);
    assert!(st.message.as_deref().is_some_and(|m| m.contains(needle)), "{ctx}: {:?}", st.message);
}

/// DAGK-3: SYSTEM'in çalıştıracağı/güveneceği dizin yabancı yazmaya açıksa ya da izni ölçülemiyorsa
/// hiçbir şey yapılmaz (`IZIN_GUVENSIZ`); düzelince güncelleme olağan biçimde sürer.
#[test]
fn untrusted_directory_permissions_stop_everything() {
    let w = world("izin");
    for (dir, needle) in
        [(w.layout.versions(), "surumler"), (w.layout.root.clone(), "güvenilmez izin"), (w.layout.updater_dir(), "guncelleyici")]
    {
        *w.fs.foreign.lock().unwrap() = vec![dir];
        w.run(1).unwrap();
        izin_guvensiz(&w, needle, "yabancı yazar");
    }
    w.fs.foreign.lock().unwrap().clear();
    *w.fs.unmeasurable.lock().unwrap() = vec![w.layout.updater_dir()];
    w.run(1).unwrap();
    izin_guvensiz(&w, "ölçülemedi", "ölçülemeyen izin");
    assert_eq!(w.backend().starts, 0, "hiçbir şey başlamadı");
    assert!(!w.layout.version_dir(NEW).exists() && !w.layout.staging_dir(NEW).exists(), "paket açılmadı");
    w.fs.unmeasurable.lock().unwrap().clear();
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_invariants(&w, "izin düzelince");
}

/// DAGK-4: PG araçları (çözülmüş `PG_BIN_DIR` + ikililer) SYSTEM olarak koşar — biri yabancı yazmaya
/// açıksa güncelleme öncesi yedek dahil hiçbir şey yapılmaz.
#[test]
fn untrusted_pg_tools_stop_everything() {
    let w = world("izin-pg");
    let bin = w.layout.root.join("harici-pg").join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let dump = bin.join(if cfg!(windows) { "pg_dump.exe" } else { "pg_dump" });
    std::fs::write(&dump, "sahte").unwrap();
    std::fs::write(
        w.layout.backend_env(),
        format!(
            "PORT=4999\nDATABASE_URL=\"postgresql://tekserp:gizli-parola@127.0.0.1:5432/tekserp?schema=public\"\nPG_BIN_DIR='{}'\n",
            bin.display()
        ),
    )
    .unwrap();
    *w.fs.foreign.lock().unwrap() = vec![dump];
    w.run(1).unwrap();
    izin_guvensiz(&w, "pg_dump", "yabancı yazılabilir pg_dump");
    *w.fs.foreign.lock().unwrap() = vec![bin.clone()];
    w.run(1).unwrap();
    izin_guvensiz(&w, "harici-pg", "yabancı yazılabilir PG bin dizini");
    assert_eq!(w.backend().starts, 0);
}

/// Yarım kalmış işlem de güvenilmez izinle SÜRDÜRÜLMEZ (geri alma da SYSTEM olarak araç koşturur).
#[test]
fn unfinished_operation_is_not_resumed_under_untrusted_permissions() {
    let points = world("izin-sayac").count_points();
    let w = world("izin-yarim");
    w.crash.arm(points / 2, false);
    assert!(w.run(3).is_err(), "ölüm yok");
    w.crash.disarm();
    assert!(w.unfinished(), "işlem yarımda kalmalı");
    *w.fs.foreign.lock().unwrap() = vec![w.layout.versions()];
    w.run(1).unwrap();
    izin_guvensiz(&w, "surumler", "yarım işlem");
    assert!(w.unfinished(), "güvenilmez izinle sürdürüldü");
    w.fs.foreign.lock().unwrap().clear();
    w.run_to_rest(2);
    assert_invariants(&w, "izin düzelince yarım işlem");
}
