//! Kendini güncelleme (§10, plan `GUNCELLEYICI-SAGLAMLIK.md` §4.2 — W1): paketteki daha yeni ikili imzalı listeyle
//! bağlanır (KOPYANIN özeti listedekiyle tutmadan hiçbir ikili çalışmaz — DAGK-3), künyesi kopyadan sınanır (ad ·
//! platform · sürüm · çapa kipi), hizmete konur; yeni ikili doğrulanmadan 3 açılışı aşarsa geri döner.
//! W1: önce güncelleyici (aday HAZIR iken backend işleminden ÖNCE; `DONDUR`da da, K1'de hiç) · son bilinen iyi
//! (`.lkg`; kanıtsız yeni ikili ilk HATA'da ona döner) · ilk SAĞLIKLI tur ölçütü.
//! W1b (§4.7): her test İKİ yerleşimde koşar — W-A (Windows: asıl ad değişmez, ImagePath `s\<sürüm>\`i gösterir) ve
//! L-A (Linux: yeni ikili asıl adın üzerine tek yeniden adlandırmayla iner, `.eski` kopya). Beklenti yerleşime göre kurulur.
mod common;

use common::*;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_guncelleyici::engine::{Engine, TickResult};
use tekserp_guncelleyici::ipc::State;
use tekserp_guncelleyici::release::ReleaseUpdater;
use tekserp_guncelleyici::selfupdate::{self, AfterAttempt, SelfState, Startup, OWN_TARGET};
use tekserp_guncelleyici::trust::ANCHOR_MODE;
use tekserp_hizmet::logfile::RotatingLog;

/// `false` = W-A sürümlü ImagePath (Windows) · `true` = L-A atomik adlandırma (Linux).
const LAYOUTS: [bool; 2] = [false, true];

fn la_name(la: bool) -> &'static str {
    if la {
        "la"
    } else {
        "wa"
    }
}

fn is_la(w: &World) -> bool {
    w.atomic_layout.load(Ordering::SeqCst)
}

fn world(tag: &str, s: Setup, la: bool) -> World {
    let w = World::new(&format!("{tag}-{}", la_name(la)), s);
    w.atomic_layout.store(la, Ordering::SeqCst);
    w
}

/// Kurulumun yazdığı ikili (asıl ad): W-A `guncelleyici\tekserp-guncelleyici.exe`, L-A `guncelleyici/tekserp-guncelleyici`.
fn asil(w: &World) -> PathBuf {
    selfupdate::asil_ad_path(&w.env(), &w.layout)
}

/// Hizmetin ÇALIŞTIRACAĞI ikili (W-A: ImagePath'in ikilisi, L-A: asıl ad).
fn svc_exe(w: &World) -> PathBuf {
    selfupdate::service_exe(&w.env(), &w.layout).expect("hizmet ikilisi")
}

fn fresh_of(own: &Path) -> PathBuf {
    selfupdate::sibling(own, "yeni")
}

fn fresh_name(own: &Path) -> String {
    name(&fresh_of(own))
}

/// Kendini güncellemeden sonra: hizmetin ikilisi `new_v`, eski ikili yerleşimin yerinde. Dönen = yeni ikilinin yolu
/// (yeni sürecin `own_exe`si).
fn assert_placed(w: &World, own_old: &Path, new_v: &str, old_v: &str) -> PathBuf {
    let exe = svc_exe(w);
    assert!(read(&exe).contains(new_v), "hizmetin ikilisi yeni sürüm: {}", exe.display());
    if is_la(w) {
        assert_eq!(exe, own_old, "L-A: yeni ikili asıl adda");
        assert!(read(&selfupdate::sibling(own_old, "eski")).contains(old_v), "L-A: eski ikili .eski kopyası");
    } else {
        assert_eq!(exe, w.layout.updater_versions().join(new_v).join(own_old.file_name().unwrap()), "W-A: s\\<sürüm>\\");
        assert!(read(own_old).contains(old_v), "W-A: asıl ad değişmez");
    }
    exe
}

fn exe_json(name: &str, version: &str) -> String {
    exe_json_mode(name, version, Some(ANCHOR_MODE))
}

fn exe_json_mode(name: &str, version: &str, mode: Option<&str>) -> String {
    exe_json_full(name, version, mode, Some(OWN_TARGET))
}

fn exe_json_full(name: &str, version: &str, mode: Option<&str>, target: Option<&str>) -> String {
    let mut k = serde_json::json!({ "ad": name, "surum": version, "testCapasi": false });
    if let Some(t) = target {
        k["hedef"] = t.into();
    }
    if let Some(m) = mode {
        k["capaKipi"] = m.into();
    }
    k.to_string()
}

/// Kurulu ikili 0.1.0 (asıl ad), paket (current\runtime\) 9.9.9 taşır; kurulu sürüm dizini
/// PAKET imzalı bütünlük listesiyle (ikili kapsamda).
fn setup(tag: &str, packaged: Option<String>, la: bool) -> (World, PathBuf) {
    let w = world(tag, Setup { intent: None, ..Setup::default() }, la);
    let own = asil(&w);
    std::fs::write(&own, exe_json("tekserp-guncelleyici", "0.1.0")).unwrap();
    let mut files = version_files(OLD);
    if let Some(p) = packaged {
        files.push(("runtime/tekserp-guncelleyici.exe".into(), p.into_bytes()));
    }
    for (rel, content) in files.iter().chain(integrity_files(&files, OLD, &w.keys.package, "paket-2026", Some(CHANNEL)).iter()) {
        let f = w.layout.version_dir(OLD).join(rel);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, content).unwrap();
    }
    (w, own)
}

fn keys(w: &World) -> PackageTrust {
    PackageTrust::embedded(vec![("paket-2026".to_string(), x_of(&w.keys.package))])
}

fn stage(w: &World, own: &std::path::Path, own_version: &str) -> Result<bool, String> {
    selfupdate::stage_with_version(&w.env(), &w.layout, own, &w.layout.version_dir(OLD), own_version, &keys(w))
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_default()
}

#[test]
fn stages_newer_binary_and_verifies_on_boot() {
    for la in LAYOUTS {
        let (w, own) = setup("kendi", Some(exe_json("tekserp-guncelleyici", "9.9.9")), la);
        let env = w.env();
        assert_eq!(stage(&w, &own, "0.1.0"), Ok(true));
        let new = assert_placed(&w, &own, "9.9.9", "0.1.0");
        // Yeni ikilinin ilk açılışı: sayaç 1; doğrulama eskisini SİLMEZ — son bilinen iyi yoksa o olur (W1 §4.2 madde 2).
        assert_eq!(selfupdate::on_startup(&env, &w.layout, &new, "9.9.9"), Startup::Continue);
        selfupdate::mark_healthy(&env, &w.layout, &new, "9.9.9");
        let lkg = selfupdate::lkg_path(&env, &w.layout, &new);
        assert_eq!(lkg.parent(), own.parent(), "{la}: .lkg asıl adın yanında");
        assert!(read(&lkg).contains("0.1.0"), "{la}: eski ikili son bilinen iyi (.lkg) oldu");
        if la {
            assert!(!selfupdate::sibling(&own, "eski").exists(), "doğrulanınca .eski kalmaz");
        } else {
            assert!(read(&own).contains("0.1.0"), "W-A: asıl ad kurulumun dosyası — taşınmaz, kopyalanır");
            assert_eq!(std::fs::read_dir(w.layout.updater_versions()).unwrap().count(), 1, "W-A: s\\ altında yalnız çalışan sürüm");
        }
        let s = state(&w);
        assert_eq!((s.durum.as_str(), s.lkg_version.as_deref(), s.proven), ("DOGRULANDI", Some("0.1.0"), false), "{la}");
        assert_eq!(selfupdate::on_startup(&env, &w.layout, &new, "9.9.9"), Startup::Continue);
        assert_eq!(svc_exe(&w), new, "{la}");
        assert!(read(&new).contains("9.9.9"));
    }
}

#[test]
fn unverified_new_binary_is_reverted_after_three_boots() {
    for la in LAYOUTS {
        let (w, own) = setup("geri", Some(exe_json("tekserp-guncelleyici", "9.9.9")), la);
        let env = w.env();
        assert_eq!(stage(&w, &own, "0.1.0"), Ok(true));
        let new = assert_placed(&w, &own, "9.9.9", "0.1.0");
        for boot in 1..=3 {
            assert_eq!(selfupdate::on_startup(&env, &w.layout, &new, "9.9.9"), Startup::Continue, "{la} açılış {boot}");
        }
        assert_eq!(selfupdate::on_startup(&env, &w.layout, &new, "9.9.9"), Startup::RevertedRestart, "{la}: 4. açılış doğrulanmadan: geri");
        let back = svc_exe(&w);
        assert_eq!(back, own, "{la}: hizmet yine asıl adı çalıştırır");
        assert!(read(&back).contains("0.1.0"), "{la}: eski ikili hizmette");
        if la {
            assert!(read(&selfupdate::sibling(&own, "bozuk")).contains("9.9.9"), "L-A: düşen ikili tanı için .bozuk");
        }
        // Eski ikiliyle açılış: tekrar geri alma yok.
        assert_eq!(selfupdate::on_startup(&env, &w.layout, &back, "0.1.0"), Startup::Continue);
        assert_eq!(svc_exe(&w), own);
    }
}

#[test]
fn interrupted_swap_leaves_old_binary_working() {
    for la in LAYOUTS {
        let (w, own) = setup("yarim", Some(exe_json("tekserp-guncelleyici", "9.9.9")), la);
        let env = w.env();
        // Kopya + künye sınaması yapıldı, yerleşimden ÖNCE ölüm: `.yeni` (W-A'da yarım `s\9.9.9\` de) ve HAZIRLANDI kalır.
        let fresh = fresh_of(&own);
        std::fs::create_dir_all(w.layout.work()).unwrap();
        std::fs::write(&fresh, exe_json("tekserp-guncelleyici", "9.9.9")).unwrap();
        let half = w.layout.updater_versions().join("9.9.9").join(own.file_name().unwrap());
        if !la {
            std::fs::create_dir_all(half.parent().unwrap()).unwrap();
            std::fs::write(&half, exe_json("tekserp-guncelleyici", "9.9.9")).unwrap();
        }
        std::fs::write(
            w.layout.self_update_file(),
            serde_json::json!({ "durum": "HAZIRLANDI", "eskiSurum": "0.1.0", "yeniSurum": "9.9.9", "acilis": 0, "zaman": "2026-10-01T00:00:00Z" }).to_string(),
        )
        .unwrap();
        assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "0.1.0"), Startup::Continue);
        assert!(!fresh.exists(), "{la}: yarım kalan yeni ikili temizlenir");
        assert!(!half.exists(), "{la}: W-A yarım sürüm dizini budanır");
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains("0.1.0"));
    }
}

#[test]
fn not_newer_or_foreign_binary_is_ignored() {
    for la in LAYOUTS {
        let (w, own) = setup("ayni", Some(exe_json("tekserp-guncelleyici", "0.1.0")), la);
        assert_eq!(stage(&w, &own, "0.1.0"), Ok(false));
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains("0.1.0"));
        assert!(!fresh_of(&own).exists(), "{la}: daha yeni olmayan kopya silinir");
        let (w, own) = setup("yabanci", Some(exe_json("baska-arac", "9.9.9")), la);
        assert!(stage(&w, &own, "0.1.0").is_err());
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains("0.1.0"), "{la}: yabancı ikili yerleşmez");
        let (w, own) = setup("yok", None, la);
        assert_eq!(stage(&w, &own, "0.1.0"), Ok(false));
    }
}

/// DAGK-3: imzadan SONRA değiştirilmiş paket ikilisi hiç ÇALIŞTIRILMAZ (künyesi de alınmaz); kurulu
/// ikiliye dokunulmaz, yan kopya kalmaz. İmzalı listede olmayan ikili de reddedilir.
#[test]
fn tampered_or_unlisted_packaged_binary_is_never_executed() {
    for la in LAYOUTS {
        let (w, own) = setup("kurcali", Some(exe_json("tekserp-guncelleyici", "9.9.9")), la);
        let packaged = w.layout.version_dir(OLD).join("runtime").join("tekserp-guncelleyici.exe");
        std::fs::write(&packaged, exe_json("tekserp-guncelleyici", "9.9.8")).unwrap();
        let r = stage(&w, &own, "0.1.0");
        assert!(r.as_ref().is_err_and(|e| e.contains("imzalı listeyle doğrulanamadı")), "{la}: {r:?}");
        assert!(w.faults.executed.lock().unwrap().is_empty(), "kurcalı ikili çalıştırıldı: {:?}", w.faults.executed.lock().unwrap());
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains("0.1.0"));
        assert!(!fresh_of(&own).exists());
        // İmzalı listede yok (liste ikiliden ÖNCE imzalanmış): yine çalıştırılmaz.
        let (w, own) = setup("listesiz", None, la);
        std::fs::write(
            w.layout.version_dir(OLD).join("runtime").join("tekserp-guncelleyici.exe"),
            exe_json("tekserp-guncelleyici", "9.9.9"),
        )
        .unwrap();
        assert!(stage(&w, &own, "0.1.0").is_err());
        assert!(w.faults.executed.lock().unwrap().is_empty());
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains("0.1.0"));
    }
}

/// Çalıştırılan YALNIZ doğrulanmış kopyadır (`.yeni`), paketteki ikili değil.
#[test]
fn only_the_verified_copy_is_executed() {
    for la in LAYOUTS {
        let (w, own) = setup("kopya", Some(exe_json("tekserp-guncelleyici", "9.9.9")), la);
        assert_eq!(stage(&w, &own, "0.1.0"), Ok(true));
        let ran = w.faults.executed.lock().unwrap().clone();
        assert!(!ran.is_empty() && ran.iter().all(|p| name(p) == fresh_name(&own)), "{la}: {ran:?}");
    }
}

/// Doğrulama ile kopyalama arasında değişen kopya (TOCTOU): çalıştırılacak KOPYANIN özeti imzalı
/// listeyle tutmazsa künyesi alınmaz, kopya silinir.
#[test]
fn copy_changed_after_verification_is_never_executed() {
    for la in LAYOUTS {
        let (w, own) = setup("kopya-degisti", Some(exe_json("tekserp-guncelleyici", "9.9.9")), la);
        w.fs.corrupt_copy.store(true, std::sync::atomic::Ordering::SeqCst);
        let r = stage(&w, &own, "0.1.0");
        assert!(r.as_ref().is_err_and(|e| e.contains("kopyalanan ikili imzalı listeyle uyuşmuyor")), "{la}: {r:?}");
        assert!(w.faults.executed.lock().unwrap().is_empty(), "{la}: değişmiş kopya çalıştırıldı");
        assert!(!fresh_of(&own).exists());
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains("0.1.0"));
    }
}

/// G3: güven çapası kurulumun kimliğidir — paketteki daha yeni güncelleyici başka kipte (eski `hazirlik` künyesi)
/// ya da kipsiz ise yerleşmez; SYSTEM ikilisi kendini güncellemeyle çapa kipini değiştiremez.
#[test]
fn other_anchor_mode_binary_is_refused() {
    assert_eq!(ANCHOR_MODE, "uretim");
    let other = "hazirlik";
    for la in LAYOUTS {
        for (tag, mode) in [("oteki-kip", Some(other)), ("kipsiz", None)] {
            let (w, own) = setup(tag, Some(exe_json_mode("tekserp-guncelleyici", "9.9.9", mode)), la);
            let r = stage(&w, &own, "0.1.0");
            assert!(r.as_ref().is_err_and(|e| e.contains("çapa kipini")), "{tag}/{la}: {r:?}");
            assert_eq!(svc_exe(&w), own, "{tag}/{la}");
            assert!(read(&own).contains("0.1.0"), "{tag}: kurulu ikili yerinde");
            assert!(!fresh_of(&own).exists(), "{tag}: yan dosya açılmadı");
            assert!(!w.layout.self_update_file().exists(), "{tag}: kendini güncelleme durumu yazılmadı");
        }
    }
}

// ── W1 ────────────────────────────────────────────────────────────────────────────────────────

const OWN_OLD: &str = "0.1.0";
const OWN_NEW: &str = "9.9.9";

fn lkg_of(w: &World, own: &Path) -> PathBuf {
    selfupdate::lkg_path(&w.env(), &w.layout, own)
}

fn state(w: &World) -> SelfState {
    selfupdate::read(&w.env(), &w.layout).expect("kendi.json")
}

/// Kurulu ikili `OWN_OLD`; yeni paket (sunucuda) `OWN_NEW` güncelleyici taşır.
fn w1_world(tag: &str, s: Setup, la: bool) -> (World, PathBuf) {
    let w = world(tag, Setup { packaged_updater: Some(exe_json("tekserp-guncelleyici", OWN_NEW).into_bytes()), ..s }, la);
    let own = asil(&w);
    std::fs::write(&own, exe_json("tekserp-guncelleyici", OWN_OLD)).unwrap();
    (w, own)
}

/// "Süreç başlangıcı": `version` sürümlü ikili olarak çalışan motor (kendini güncellemesi açık).
fn engine_as(w: &World, own: &Path, version: &str) -> Engine {
    let mut e = Engine::new(w.env(), w.layout.clone(), w.anchor.clone(), Arc::new(RotatingLog::disabled()), Some(own.to_path_buf()));
    e.own_version = version.to_string();
    e
}

fn announced_block() -> serde_json::Value {
    json!({ "guncelleyici": { "surum": OWN_NEW, "sha256": sha_hex(exe_json("tekserp-guncelleyici", OWN_NEW).as_bytes()) } })
}

fn journal_ops(w: &World) -> usize {
    std::fs::read_to_string(w.layout.journal_file()).map(|t| t.lines().filter(|l| l.contains("\"ISLEM\"")).count()).unwrap_or(0)
}

/// §4.2 madde 1: aday HAZIR ve paketteki güncelleyici YENİ → backend işleminden ÖNCE kendini yeniler (`durum.bilgi =
/// GUNCELLEYICI_ONCE`, işlem günlüğünde işlem YOK, `current` ESKİ); yeni ikili aynı paketi yeniden doğrulayıp işlemi
/// yürütür, BASARILI ile kendini son bilinen iyi yapar.
#[test]
fn once_guncelleyici() {
    for la in LAYOUTS {
        let (w, own) = w1_world("once", Setup::default(), la);
        let r = engine_as(&w, &own, OWN_OLD).tick(&|| false);
        assert_eq!(r, TickResult::RestartForSelfUpdate, "{la}: {:?}", w.status().map(|s| s.message));
        let new = assert_placed(&w, &own, OWN_NEW, OWN_OLD);
        assert_eq!(w.current().as_deref(), Some(OLD), "backend'e dokunulmadı");
        assert_eq!(journal_ops(&w), 0, "işlem başlamadı — güncelleyici ÖNCE");
        let st = w.status().unwrap();
        assert_eq!(st.notice.as_ref().map(|n| n.code.as_str()), Some("GUNCELLEYICI_ONCE"), "{st:?}");
        assert_eq!(st.error_code, None);
        let ran = w.faults.executed.lock().unwrap().clone();
        assert!(!ran.is_empty() && ran.iter().all(|p| name(p) == fresh_name(&own)), "{la}: yalnız doğrulanmış kopya: {ran:?}");
        // Yeni ikili: aynı paket, işlemi o yürütür.
        assert_eq!(selfupdate::on_startup(&w.env(), &w.layout, &new, OWN_NEW), Startup::Continue);
        let e = engine_as(&w, &new, OWN_NEW);
        assert!(matches!(e.tick(&|| false), TickResult::Idle(_)));
        assert_eq!((w.state(), w.current().as_deref()), (Some(State::Succeeded), Some(NEW)), "{:?}", w.status().map(|s| s.message));
        assert!(e.verified(), "işlemi bitiren tur sağlıklı");
        let s = state(&w);
        assert_eq!((s.durum.as_str(), s.proven, s.lkg_version.as_deref()), ("DOGRULANDI", true, Some(OWN_NEW)), "{la}: {s:?}");
        assert!(read(&lkg_of(&w, &new)).contains(OWN_NEW), "{la}: BASARILI: son bilinen iyi = işlemi bitiren ikili");
        assert!(!selfupdate::sibling(&own, "eski").exists());
        assert_eq!(svc_exe(&w), new, "{la}");
    }
}

/// §4.2 madde 2: son bilinen iyi. Kanıtsız yeni ikili HATA ile biten İLK denemesinde `.lkg`ye döner (özeti tutan KOPYA;
/// `.lkg` yerinde kalır), geri alınan sürüm yeniden yerleşmez; kanıtlanmış ikili HATA'da dönmez.
#[test]
fn lkg_donusu() {
    for la in LAYOUTS {
        let lease = LeaseOpts { update: Some(policy("ONAYLI", &open_window(), None)), ..LeaseOpts::default() };
        let (w, own) = w1_world("lkg", Setup { lease, ..Setup::default() }, la);
        // ONAY_BEKLIYOR iken de önce güncelleyici.
        assert_eq!(engine_as(&w, &own, OWN_OLD).tick(&|| false), TickResult::RestartForSelfUpdate);
        let new = assert_placed(&w, &own, OWN_NEW, OWN_OLD);
        assert_eq!(selfupdate::on_startup(&w.env(), &w.layout, &new, OWN_NEW), Startup::Continue);
        let e = engine_as(&w, &new, OWN_NEW);
        assert!(matches!(e.tick(&|| false), TickResult::Idle(_)));
        assert_eq!(w.state(), Some(State::Ready));
        assert!(read(&lkg_of(&w, &new)).contains(OWN_OLD), "{la}: ilk sağlıklı tur: eski ikili son bilinen iyi");
        // Onay gelir, işlem geri alınamaz (HATA).
        w.write_intent(&intent(Some(approval("onay-1", NEW, "HEMEN"))));
        w.faults.unhealthy_all.store(true, Ordering::SeqCst);
        assert_eq!(e.tick(&|| false), TickResult::RestartForSelfUpdate, "{la}: {:?}", w.status().map(|s| s.message));
        assert_eq!(w.state(), Some(State::Failed));
        let back = svc_exe(&w);
        assert_eq!(back, own, "{la}: hizmet asıl adı çalıştırır");
        assert!(read(&back).contains(OWN_OLD), "{la}: son bilinen iyi hizmette");
        assert!(read(&lkg_of(&w, &back)).contains(OWN_OLD), "{la}: .lkg yerinde kalır");
        if la {
            assert!(read(&selfupdate::sibling(&own, "bozuk")).contains(OWN_NEW));
        }
        let s = state(&w);
        assert_eq!((s.durum.as_str(), s.refused.as_deref()), ("GERI_ALINDI", Some(OWN_NEW)), "{la}: {s:?}");
        // Dönülen ikili HATA'yı sürdürür (insan); aynı sürüm ondan yeniden yerleşmez.
        assert_eq!(selfupdate::on_startup(&w.env(), &w.layout, &back, OWN_OLD), Startup::Continue);
        assert!(matches!(engine_as(&w, &back, OWN_OLD).tick(&|| false), TickResult::Idle(_)));
        assert_eq!(w.status().unwrap().error_code.as_deref(), Some("INSAN_GEREKIYOR"));
        let again = selfupdate::stage_from(&w.env(), &w.layout, &back, OWN_OLD, &w.layout.version_dir(NEW), &keys(&w), None);
        assert_eq!(again, Ok(None), "{la}: geri alınan sürüm yeniden yerleşmez");
        assert_eq!(svc_exe(&w), own);
        assert!(read(&own).contains(OWN_OLD));
        // Kanıtlanmış ikili HATA'da dönmez.
        let (w, own) = setup("lkg-kanitli", Some(exe_json("tekserp-guncelleyici", OWN_NEW)), la);
        let env = w.env();
        assert_eq!(stage(&w, &own, OWN_OLD), Ok(true));
        let new = assert_placed(&w, &own, OWN_NEW, OWN_OLD);
        assert_eq!(selfupdate::after_attempt(&env, &w.layout, &new, OWN_NEW, true), AfterAttempt::Nothing);
        assert_eq!(selfupdate::after_attempt(&env, &w.layout, &new, OWN_NEW, false), AfterAttempt::Nothing, "{la}: kanıtlanmış: dönmez");
        assert_eq!(svc_exe(&w), new);
        assert!(read(&new).contains(OWN_NEW));
        // Özeti tutmayan kaynağa dönülmez (doğrulanmamış bayt çalışmaz). W-A'da eski yol (asıl ad) da yerinde durur:
        // o da kurcalanır — `.lkg` gibi ona da dönülmemeli.
        let (w, own) = setup("lkg-kurcali", Some(exe_json("tekserp-guncelleyici", OWN_NEW)), la);
        let env = w.env();
        assert_eq!(stage(&w, &own, OWN_OLD), Ok(true));
        let new = assert_placed(&w, &own, OWN_NEW, OWN_OLD);
        selfupdate::mark_healthy(&env, &w.layout, &new, OWN_NEW);
        std::fs::write(lkg_of(&w, &new), exe_json("tekserp-guncelleyici", "0.0.9")).unwrap();
        if !la {
            std::fs::write(&own, exe_json("tekserp-guncelleyici", "0.0.8")).unwrap();
        }
        assert_eq!(selfupdate::after_attempt(&env, &w.layout, &new, OWN_NEW, false), AfterAttempt::Nothing, "{la}");
        assert_eq!(svc_exe(&w), new, "{la}: kurcalı kaynak hizmete konmadı");
        assert!(read(&new).contains(OWN_NEW));
    }
}

/// §4.6: platform geçmez — `kunye.hedef` çalışanın hedefi değilse (ya da yoksa) yerleşmez.
#[test]
fn kendi_platform_gecmez() {
    let other = if OWN_TARGET == "windows" { "linux" } else { "windows" };
    for la in LAYOUTS {
        for (tag, target) in [("oteki-platform", Some(other)), ("hedefsiz", None)] {
            let (w, own) = setup(tag, Some(exe_json_full("tekserp-guncelleyici", OWN_NEW, Some(ANCHOR_MODE), target)), la);
            let r = stage(&w, &own, OWN_OLD);
            assert!(r.as_ref().is_err_and(|e| e.contains("platform")), "{tag}/{la}: {r:?}");
            assert_eq!(svc_exe(&w), own, "{tag}/{la}");
            assert!(read(&own).contains(OWN_OLD), "{tag}: kurulu ikili yerinde");
            assert!(!fresh_of(&own).exists(), "{tag}: yan dosya kalmadı");
            assert!(!w.layout.self_update_file().exists(), "{tag}: kendini güncelleme durumu yazılmadı");
        }
        // Bildirimin ilan ettiği sürümden sapan künye de yerleşmez.
        let (w, own) = setup("ilan", Some(exe_json("tekserp-guncelleyici", OWN_NEW)), la);
        let announced = ReleaseUpdater { surum: "9.9.8".into(), sha256: sha_hex(exe_json("tekserp-guncelleyici", OWN_NEW).as_bytes()) };
        let r = selfupdate::stage_from(&w.env(), &w.layout, &own, OWN_OLD, &w.layout.version_dir(OLD), &keys(&w), Some(&announced));
        assert!(r.as_ref().is_err_and(|e| e.contains("ilan")), "{la}: {r:?}");
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains(OWN_OLD));
    }
}

/// R15: imzalı bildirimin `guncelleyici.sha256`ı paketteki ikilinin imzalı listedeki özetiyle tutmazsa ikili
/// KOPYALANMAZ bile (yan dosya yok, künye koşmaz, durum yazılmaz); tutarsa (büyük/küçük harf fark etmez) yerleşir.
#[test]
fn ilan_ozeti_tutmazsa_yerlesmez() {
    let ilan = |sha256: String| ReleaseUpdater { surum: OWN_NEW.into(), sha256 };
    for la in LAYOUTS {
        let (w, own) = setup("ilan-ozet", Some(exe_json("tekserp-guncelleyici", OWN_NEW)), la);
        let stage_announced =
            |a: &ReleaseUpdater| selfupdate::stage_from(&w.env(), &w.layout, &own, OWN_OLD, &w.layout.version_dir(OLD), &keys(&w), Some(a));
        let foreign = ilan(sha_hex(exe_json("tekserp-guncelleyici", "9.9.8").as_bytes()));
        let r = stage_announced(&foreign);
        assert!(r.as_ref().is_err_and(|e| e.contains("guncelleyici.sha256")), "{la}: {r:?}");
        assert!(w.faults.executed.lock().unwrap().is_empty(), "{la}: ilanla tutmayan ikilinin künyesi koşturuldu");
        assert!(!fresh_of(&own).exists(), "{la}: ilanla tutmayan ikili kopyalandı");
        assert!(!w.layout.updater_versions().exists(), "{la}: sürüm dizini açılmadı");
        assert!(!w.layout.self_update_file().exists(), "{la}: kendini güncelleme durumu yazılmadı");
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains(OWN_OLD));
        // Bozuk onaltılık da tutmaz (boş ilan "denetim yok" demek değildir).
        assert!(stage_announced(&ilan(String::new())).is_err(), "{la}: boş sha256");
        assert!(w.faults.executed.lock().unwrap().is_empty());
        // Aynı baytı gösteren ilan (büyük harf onaltılık): yerleşir.
        let right = ilan(sha_hex(exe_json("tekserp-guncelleyici", OWN_NEW).as_bytes()).to_uppercase());
        assert_eq!(stage_announced(&right), Ok(Some(OWN_NEW.to_string())), "{la}");
        assert_placed(&w, &own, OWN_NEW, OWN_OLD);
    }
}

/// AK-3: `DONDUR` backend sürümünü dondurur, güncelleyiciyi DEĞİL — imzalı bildirim yeni ikili ilan ediyorsa paket
/// hazırlanır, ikili yenilenir, backend aynen kalır; blok yoksa paket indirilmez bile.
#[test]
fn dondur_kendini_yeniler() {
    let lease = || LeaseOpts { update: Some(policy("DONDUR", &[], None)), ..LeaseOpts::default() };
    for la in LAYOUTS {
        let (w, own) = w1_world("dondur", Setup { lease: lease(), manifest_extra: Some(announced_block()), ..Setup::default() }, la);
        assert_eq!(
            engine_as(&w, &own, OWN_OLD).tick(&|| false),
            TickResult::RestartForSelfUpdate,
            "{la}: {:?}",
            w.status().map(|s| s.message)
        );
        let new = assert_placed(&w, &own, OWN_NEW, OWN_OLD);
        assert_eq!((w.current().as_deref(), w.backend().version.as_deref()), (Some(OLD), Some(OLD)), "backend dondurulmuş kalır");
        assert_eq!(journal_ops(&w), 0);
        let st = w.status().unwrap();
        assert_eq!(st.decision.as_ref().map(|d| (d.karar.label(), d.neden.clone())), Some(("DONDURULDU", Some("POLITIKA".into()))));
        assert_eq!(st.notice.as_ref().map(|n| n.code.as_str()), Some("GUNCELLEYICI_ONCE"));
        // Yeni ikili de dondurmaya uyar: backend'e dokunmaz.
        assert_eq!(selfupdate::on_startup(&w.env(), &w.layout, &new, OWN_NEW), Startup::Continue);
        assert!(matches!(engine_as(&w, &new, OWN_NEW).tick(&|| false), TickResult::Idle(_)));
        assert_eq!((w.current().as_deref(), journal_ops(&w)), (Some(OLD), 0));
        // İmzalı blok yok: DONDUR'da paket indirilmez, ikili değişmez.
        let (w, own) = w1_world("dondur-bloksuz", Setup { lease: lease(), ..Setup::default() }, la);
        assert!(matches!(engine_as(&w, &own, OWN_OLD).tick(&|| false), TickResult::Idle(_)));
        assert_eq!(svc_exe(&w), own, "{la}");
        assert!(read(&own).contains(OWN_OLD));
        assert!(!w.layout.version_dir(NEW).exists(), "paket indirilmedi");
    }
}

/// R15: `DONDUR` dünyası YAYINCININ GERÇEK çıktısıyla beslenir — `test-vektorleri/guncelleme-yayinci.json`
/// (`scripts/test_backend_yayin.mjs --vektor-yaz`): `backend-bildirim.ts`in sentetik Windows paketinden ölçtüğü
/// `guncelleyici` bloğu + paketteki ikili (PE başlıklı bayt). Blok ikilinin özetini ve künyenin sürümünü taşır; motor bu
/// blokla paketi hazırlar ve ikiliyi yeniler. Künye ikilinin özetine bağlıdır (sahte koşucu `Faults::identities`).
#[test]
fn dondur_yayinci_blogu() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri").join("guncelleme-yayinci.json");
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("guncelleme-yayinci.json")).unwrap();
    use base64::Engine as _;
    let bin = base64::engine::general_purpose::STANDARD.decode(v["ikili"].as_str().unwrap()).unwrap();
    let block = v["guncelleyici"].clone();
    let announced = block["surum"].as_str().unwrap().to_string();
    assert_eq!(
        (v["platform"].as_str(), block["sha256"].as_str()),
        (Some("win32-x64"), Some(sha_hex(&bin).as_str())),
        "blok paketteki ikilinin özeti"
    );
    assert_eq!(&bin[..2], b"MZ", "yayıncının ölçtüğü ikili PE biçiminde");
    assert_eq!(Some(announced.as_str()), v["kunye"]["surum"].as_str(), "blok sürümü paketleyici künyesinden");
    let lease = LeaseOpts { update: Some(policy("DONDUR", &[], None)), ..LeaseOpts::default() };
    let s =
        Setup { lease, manifest_extra: Some(json!({ "guncelleyici": block })), packaged_updater: Some(bin.clone()), ..Setup::default() };
    let w = World::new("dondur-yayinci", s);
    w.faults.identities.lock().unwrap().insert(sha_hex(&bin), exe_json("tekserp-guncelleyici", &announced));
    let own = w.layout.updater_dir().join("tekserp-guncelleyici.exe");
    std::fs::write(&own, exe_json("tekserp-guncelleyici", OWN_OLD)).unwrap();
    assert_eq!(engine_as(&w, &own, OWN_OLD).tick(&|| false), TickResult::RestartForSelfUpdate, "{:?}", w.status().map(|s| s.message));
    assert_eq!(std::fs::read(svc_exe(&w)).unwrap(), bin, "hizmetin ikilisi (W-A: s\\<sürüm>\\) yayıncının ölçtüğü ikili");
    assert!(read(&own).contains(OWN_OLD), "W-A: asıl ad değişmez");
    assert_eq!((w.current().as_deref(), journal_ops(&w)), (Some(OLD), 0), "backend dondurulmuş kalır");
    assert_eq!(state(&w).new_version, announced);
    // Kontrol: aynı dünya, blok ikiliyle tutmayan sürüm ilan ediyor → künye ilandan sapar, ikili YERLEŞMEZ.
    let lease = LeaseOpts { update: Some(policy("DONDUR", &[], None)), ..LeaseOpts::default() };
    let wrong = json!({ "guncelleyici": { "surum": "99.0.0", "sha256": sha_hex(&bin) } });
    let w = World::new(
        "dondur-yayinci-ilan",
        Setup { lease, manifest_extra: Some(wrong), packaged_updater: Some(bin.clone()), ..Setup::default() },
    );
    w.faults.identities.lock().unwrap().insert(sha_hex(&bin), exe_json("tekserp-guncelleyici", &announced));
    let own = w.layout.updater_dir().join("tekserp-guncelleyici.exe");
    std::fs::write(&own, exe_json("tekserp-guncelleyici", OWN_OLD)).unwrap();
    assert_ne!(engine_as(&w, &own, OWN_OLD).tick(&|| false), TickResult::RestartForSelfUpdate);
    assert!(read(&own).contains(OWN_OLD), "ilanla tutmayan künye yerleşmedi");
}

/// AK-3: lisans yaptırımı (K1, `yaptirim.guncellemeDonuk`) varken HİÇBİR ŞEY yenilenmez — ne backend ne güncelleyici;
/// paket indirilmez, künye koşturulmaz (politika OTOMATİK de DONDUR da olsa). Sağlıklı tur `kendi.json`a yalnız ÖLÇÜ
/// yazar (W1b: `KURULUM` · `calisanOzet` · `.lkg`) — kendini güncelleme durumu açılmaz.
#[test]
fn k1_hicbir_sey_yenilenmez() {
    for la in LAYOUTS {
        for (tag, kip) in [("k1-otomatik", "OTOMATIK"), ("k1-dondur", "DONDUR")] {
            let lease = LeaseOpts { update: Some(policy(kip, &open_window(), None)), frozen_by_sanction: true, ..LeaseOpts::default() };
            let (w, own) = w1_world(tag, Setup { lease, manifest_extra: Some(announced_block()), ..Setup::default() }, la);
            let e = engine_as(&w, &own, OWN_OLD);
            for _ in 0..3 {
                assert!(matches!(e.tick(&|| false), TickResult::Idle(_)), "{tag}/{la}");
            }
            assert_eq!(svc_exe(&w), own, "{tag}/{la}");
            assert!(read(&own).contains(OWN_OLD), "{tag}: güncelleyici yenilenmedi");
            assert_eq!((w.current().as_deref(), journal_ops(&w)), (Some(OLD), 0), "{tag}: backend yenilenmedi");
            assert!(!w.layout.version_dir(NEW).exists(), "{tag}: paket indirilmedi");
            assert!(w.faults.executed.lock().unwrap().is_empty(), "{tag}: hiçbir ikili koşturulmadı");
            assert!(!fresh_of(&own).exists() && !w.layout.updater_versions().exists(), "{tag}/{la}: yerleşim açılmadı");
            let s = state(&w);
            assert_eq!((s.durum.as_str(), s.new_version.as_str(), s.new_path.as_deref()), ("KURULUM", OWN_OLD, None), "{tag}/{la}: {s:?}");
            let st = w.status().unwrap();
            assert_eq!(st.decision.map(|d| d.neden), Some(Some("YAPTIRIM".into())), "{tag}");
        }
    }
}

/// §4.2 madde 3: "ilk sağlıklı tur" = kilit · günlük · kira/HAK okundu · karar verildi · `durum.json` yazıldı. Ayarı
/// okunamayan tur turu bitirse de yeni ikiliyi DOĞRULAMAZ (eski ikili yerinde, sayaç işler).
#[test]
fn ilk_saglikli_tur_olcutu() {
    for la in LAYOUTS {
        let (w, own) = setup("saglikli", Some(exe_json("tekserp-guncelleyici", OWN_NEW)), la);
        assert_eq!(stage(&w, &own, OWN_OLD), Ok(true));
        let new = assert_placed(&w, &own, OWN_NEW, OWN_OLD);
        assert_eq!(selfupdate::on_startup(&w.env(), &w.layout, &new, OWN_NEW), Startup::Continue);
        let settings = std::fs::read(w.layout.settings_file()).unwrap();
        std::fs::write(w.layout.settings_file(), b"{bozuk").unwrap();
        let e = engine_as(&w, &new, OWN_NEW);
        assert!(matches!(e.tick(&|| false), TickResult::Idle(_)));
        assert_eq!(w.status().unwrap().error_code.as_deref(), Some("AYAR_BICIMSIZ"));
        assert!(!e.verified());
        let s = state(&w);
        assert_eq!(s.durum, "YER_DEGISTIRILDI", "{la}: kararsız tur doğrulamaz");
        let old = PathBuf::from(s.old_path.expect("eskiYol"));
        assert!(read(&old).contains(OWN_OLD), "{la}: eski ikili yerinde ({})", old.display());
        std::fs::write(w.layout.settings_file(), settings).unwrap();
        assert!(matches!(e.tick(&|| false), TickResult::Idle(_)));
        assert!(e.verified());
        assert_eq!(state(&w).durum, "DOGRULANDI");
        assert!(read(&lkg_of(&w, &new)).contains(OWN_OLD), "{la}");
    }
}

/// Eski `kendi.json` (W1 öncesi alanlar) aynen okunur; yeni alanlar eski okuyucuya ek alandır.
#[test]
fn eski_kendi_json_okunur() {
    for la in LAYOUTS {
        let (w, own) = setup("eski-kendi", Some(exe_json("tekserp-guncelleyici", OWN_NEW)), la);
        std::fs::create_dir_all(w.layout.work()).unwrap();
        std::fs::write(
            w.layout.self_update_file(),
            json!({ "durum": "DOGRULANDI", "eskiSurum": "0.0.9", "yeniSurum": OWN_OLD, "acilis": 1, "zaman": "2026-10-01T00:00:00Z" })
                .to_string(),
        )
        .unwrap();
        let s = state(&w);
        assert_eq!((s.proven, s.lkg_version, s.refused), (false, None, None));
        assert_eq!(stage(&w, &own, OWN_OLD), Ok(true));
        assert_placed(&w, &own, OWN_NEW, OWN_OLD);
    }
}

// ── L profili (L6): Linux'ta `.exe` yok — asıl ad `guncelleyici/tekserp-guncelleyici`, paketteki ikili sürüm dizininin
// KÖKÜNDE (`oci-paket.ts`), yan adlar `.yeni` · `.eski` · `.lkg` · `.bozuk`. Aynı A/B, Linux arka ucunun yol beyanıyla.

/// Sahte dünyanın ortamı, Linux arka ucuyla (kendini güncellemenin paket yolu arka uçtan gelir).
fn env_l(w: &World) -> tekserp_guncelleyici::env::Env {
    let mut e = w.env();
    e.arka = tekserp_guncelleyici::platform::linux::arka_ucu();
    e
}

/// Kurulu ikili 0.1.0 (`guncelleyici/tekserp-guncelleyici`); paket `files` taşır (imzalı listeyle).
fn setup_l(tag: &str, files_extra: Vec<(String, Vec<u8>)>) -> (World, PathBuf) {
    let w = World::new(tag, Setup { intent: None, ..Setup::default() });
    let own = w.layout.updater_dir().join("tekserp-guncelleyici");
    std::fs::write(&own, exe_json("tekserp-guncelleyici", "0.1.0")).unwrap();
    let mut files = version_files(OLD);
    files.extend(files_extra);
    for (rel, content) in files.iter().chain(integrity_l(&files, &w).iter()) {
        let f = w.layout.version_dir(OLD).join(rel);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, content).unwrap();
    }
    (w, own)
}

/// Ortak `integrity_files` ile aynı imzalı liste; kapsam paket kökündeki `.exe`siz ikiliyi de kapsar (Linux paketinin
/// gerçek bütünlük biçimi — `PAKET-DOCKER.json` — L4b/L7'nin; burada ölçülen yalnız yol ve yan adlar).
fn integrity_l(files: &[(String, Vec<u8>)], w: &World) -> Vec<(String, Vec<u8>)> {
    let in_scope = |p: &str| {
        ["dist/", "runtime/", "node_modules/", "prisma/migrations/"].iter().any(|d| p.starts_with(d))
            || p == "package.json"
            || p == "tekserp-guncelleyici"
    };
    let mut scoped: Vec<&(String, Vec<u8>)> = files.iter().filter(|(p, _)| in_scope(p)).collect();
    scoped.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let list: String = scoped.iter().map(|(p, c)| format!("{}\t{}\t{}\n", sha_b64u(c), c.len(), p)).collect();
    let payload = json!({
        "v": 1, "paketId": PACKAGE_ID, "urun": "backend", "surum": OLD, "derlemeTarihi": BUILT_AT, "musteri": CHANNEL,
        "liste": { "sha256": sha_b64u(list.as_bytes()), "boyut": list.len(), "dosyaSayisi": scoped.len() },
        "kapsam": { "dizinler": ["dist", "node_modules", "prisma/migrations", "runtime"], "dosyalar": ["package.json", "tekserp-guncelleyici"] },
    });
    vec![
        ("butunluk-liste.txt".into(), list.into_bytes()),
        ("butunluk.jws".into(), sign(&w.keys.package, "tekserp-butunluk", "paket-2026", &payload).into_bytes()),
    ]
}

fn stage_l(w: &World, own: &Path) -> Result<bool, String> {
    selfupdate::stage_with_version(&env_l(w), &w.layout, own, &w.layout.version_dir(OLD), "0.1.0", &keys(w))
}

#[test]
fn l_profili_exesiz_ab() {
    let (w, own) = setup_l("l-ab", vec![("tekserp-guncelleyici".into(), exe_json("tekserp-guncelleyici", "9.9.9").into_bytes())]);
    let env = env_l(&w);
    assert_eq!(stage_l(&w, &own), Ok(true));
    assert!(read(&own).contains("9.9.9"), "yeni ikili asıl adda (.exe'siz)");
    let old = own.with_file_name("tekserp-guncelleyici.eski");
    assert!(read(&old).contains("0.1.0"), "eski ikili `.eski` (uzantısız)");
    assert!(!own.with_file_name("tekserp-guncelleyici.yeni").exists(), "yan kopya yer değiştirmede tükenir");
    assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "9.9.9"), Startup::Continue);
    selfupdate::mark_healthy(&env, &w.layout, &own, "9.9.9");
    let lkg = own.with_file_name("tekserp-guncelleyici.lkg");
    assert!(read(&lkg).contains("0.1.0"), "son bilinen iyi `.lkg` (taban birimin onarım satırının gösterdiği ad)");
    assert!(!old.exists());
}

#[test]
fn l_profili_dogrulanmayan_ikili_geri_doner() {
    let (w, own) = setup_l("l-geri", vec![("tekserp-guncelleyici".into(), exe_json("tekserp-guncelleyici", "9.9.9").into_bytes())]);
    let env = env_l(&w);
    assert_eq!(stage_l(&w, &own), Ok(true));
    for boot in 1..=3 {
        assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "9.9.9"), Startup::Continue, "açılış {boot}");
    }
    assert_eq!(selfupdate::on_startup(&env, &w.layout, &own, "9.9.9"), Startup::RevertedRestart);
    assert!(read(&own).contains("0.1.0"), "eski ikili asıl adda");
    assert!(read(&own.with_file_name("tekserp-guncelleyici.bozuk")).contains("9.9.9"));
}

/// Linux arka ucu Windows yolundaki ikiliyi (`runtime/…exe`) kaynak saymaz; Windows arka ucu da kökteki `.exe`siz
/// ikiliyi. İmzalı listede olmayan kök ikili hiç çalıştırılmaz.
#[test]
fn l_profili_yalniz_kendi_paket_yolu() {
    let win = ("runtime/tekserp-guncelleyici.exe".to_string(), exe_json("tekserp-guncelleyici", "9.9.9").into_bytes());
    let (w, own) = setup_l("l-winyolu", vec![win]);
    assert_eq!(stage_l(&w, &own), Ok(false), "Windows yolundaki ikili Linux'ta kaynak değil");
    assert!(read(&own).contains("0.1.0"));
    let (w, _) = setup_l("l-kok", vec![("tekserp-guncelleyici".into(), exe_json("tekserp-guncelleyici", "9.9.9").into_bytes())]);
    let own_w = w.layout.updater_dir().join("tekserp-guncelleyici.exe");
    std::fs::write(&own_w, exe_json("tekserp-guncelleyici", "0.1.0")).unwrap();
    assert_eq!(stage(&w, &own_w, "0.1.0"), Ok(false), "kökteki .exe'siz ikili Windows'ta kaynak değil");
    // İmzadan sonra eklenen kök ikili: listede yok → hata, hiç çalıştırılmaz.
    let (w, own) = setup_l("l-imzasiz", vec![]);
    std::fs::write(w.layout.version_dir(OLD).join("tekserp-guncelleyici"), exe_json("tekserp-guncelleyici", "9.9.9")).unwrap();
    assert!(stage_l(&w, &own).is_err());
    assert!(read(&own).contains("0.1.0") && !own.with_file_name("tekserp-guncelleyici.yeni").exists());
}
