//! Karşılıklı onarım (W1b, plan `GUNCELLEYICI-SAGLAMLIK.md` §4.7): senaryo tablosunun K1 (sahte dünya) satırları.
//! Her test İKİ yerleşimde koşar — W-A (Windows: ImagePath `s\<sürüm>\`i gösterir, onarıcı zamanlanmış görevin
//! `.lkg`si, tam kip) ve L-A (Linux: asıl ad, onarıcı taban birimin `ExecStartPre=-….lkg onar --yalniz-asil-ad`
//! satırı, hizmete dokunulmaz — systemd başlatır). Dünya gerçek dosya sistemi + sahte SCM/saat; ölüm panikle.
mod common;

use common::*;
use std::collections::BTreeSet;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Barrier;
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_guncelleyici::env::{Fs, RealFs, SvcState};
use tekserp_guncelleyici::ipc::{self, State, StatusDoc};
use tekserp_guncelleyici::onarim::{self, Options, Outcome, MAX_REPAIRS};
use tekserp_guncelleyici::platform::windows::gorev;
use tekserp_guncelleyici::selfupdate::{self, Startup, OWN_TARGET};
use tekserp_guncelleyici::trust::ANCHOR_MODE;

/// `false` = W-A sürümlü ImagePath (Windows) · `true` = L-A atomik adlandırma (Linux).
const LAYOUTS: [bool; 2] = [false, true];
const INSTALLED: &str = "0.1.0";
const STAGED: &str = "9.9.9";
const MIN: i64 = 60_000;

fn la_name(la: bool) -> &'static str {
    if la {
        "la"
    } else {
        "wa"
    }
}

/// Sahte ikili = künyesi. `repairs` = künye `"onarim":1` taşır (W1b); taşımayan W1 ikilisidir.
fn binary(version: &str, repairs: bool) -> Vec<u8> {
    let mut k = serde_json::json!({ "ad": "tekserp-guncelleyici", "surum": version, "testCapasi": false,
        "hedef": OWN_TARGET, "capaKipi": ANCHOR_MODE });
    if repairs {
        k["onarim"] = 1.into();
    }
    k.to_string().into_bytes()
}

fn keys(w: &World) -> PackageTrust {
    PackageTrust::embedded(vec![("paket-2026".to_string(), x_of(&w.keys.package))])
}

/// `surumler/<v>`e PAKET imzalı bütünlük listesiyle bir sürüm dizini yazar (`runtime` güncelleyicisi isteğe bağlı).
/// Onarım backend dosyalarını okumaz: dizin küçük tutulur (her doğrulama bütün dizini özetler).
fn write_version(w: &World, v: &str, runtime: Option<&[u8]>) {
    let _ = std::fs::remove_dir_all(w.layout.version_dir(v));
    let mut files: Vec<(String, Vec<u8>)> =
        vec![("package.json".into(), format!("{{\"version\":\"{v}\"}}").into_bytes()), ("dist/server.js".into(), b"//".to_vec())];
    if let Some(b) = runtime {
        files.push(("runtime/tekserp-guncelleyici.exe".into(), b.to_vec()));
    }
    for (rel, content) in files.iter().chain(integrity_files(&files, v, &w.keys.package, "paket-2026", Some(CHANNEL)).iter()) {
        let f = w.layout.version_dir(v).join(rel);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, content).unwrap();
    }
}

fn runtime_of(w: &World, v: &str) -> PathBuf {
    w.layout.version_dir(v).join("runtime").join("tekserp-guncelleyici.exe")
}

struct Site {
    w: World,
    /// Kurulumun yazdığı ikili (asıl ad).
    asil: PathBuf,
    /// Son bilinen iyi — W-C görevinin / L-B satırının onarıcısı.
    lkg: PathBuf,
    la: bool,
}

/// Gerçek kurulum: asıl ad `INSTALLED` (W1b), kurulu sürüm dizini (`current`) imzalı listeyle aynı ikiliyi
/// `runtime/`da taşır (`runtime`=None: taşımaz), güncelleyici bir SAĞLIKLI tur geçirmiş (`.lkg` + `calisanOzet`).
fn installed(tag: &str, la: bool, runtime: Option<Vec<u8>>) -> Site {
    let w = World::new(&format!("onarim-{tag}-{}", la_name(la)), Setup { intent: None, ..Setup::default() });
    w.atomic_layout.store(la, Ordering::SeqCst);
    let asil = selfupdate::asil_ad_path(&w.env(), &w.layout);
    std::fs::write(&asil, binary(INSTALLED, true)).unwrap();
    write_version(&w, OLD, runtime.as_deref());
    selfupdate::on_healthy(&w.env(), &w.layout, &asil, INSTALLED);
    let lkg = selfupdate::lkg_path(&w.env(), &w.layout, &asil);
    assert_eq!(std::fs::read(&lkg).unwrap(), binary(INSTALLED, true), "kurulum: ilk sağlıklı tur .lkg kopyasını kurar");
    Site { w, asil, lkg, la }
}

impl Site {
    /// Hizmetin ÇALIŞTIRACAĞI ikili (W-A: ImagePath'in ikilisi, L-A: asıl ad).
    fn svc_exe(&self) -> PathBuf {
        selfupdate::service_exe(&self.w.env(), &self.w.layout).expect("hizmet ikilisi")
    }
    fn opts(&self) -> Options {
        Options { yalniz_asil_ad: self.la }
    }
    fn onar_as(&self, own: &Path, trust: Option<&PackageTrust>) -> Outcome {
        onarim::onar(&self.w.env(), &self.w.layout, own, trust, &self.opts())
    }
    /// Görev / birim satırı: `.lkg onar` (imzalı kaynaklar da açık).
    fn onar(&self) -> Outcome {
        self.onar_as(&self.lkg, Some(&keys(&self.w)))
    }
    fn updater(&self) -> Svc {
        self.w.svcs.lock().unwrap().get(UPDATER).cloned().expect("güncelleyici hizmeti")
    }
    fn set_updater_state(&self, s: SvcState) {
        self.w.svcs.lock().unwrap().get_mut(UPDATER).unwrap().state = s;
    }
    /// SCM ikiliyi bulamadı / ikili düştü: hizmet durmuş.
    fn stop_updater(&self) {
        self.set_updater_state(SvcState::Stopped);
    }
    fn advance(&self, ms: i64) {
        self.w.clock.fetch_add(ms, Ordering::SeqCst);
    }
    fn log(&self) -> onarim::RepairLog {
        onarim::read_log(&self.w.env(), &self.w.layout)
    }
    fn error_code(&self) -> Option<String> {
        self.w.status().and_then(|s| s.error_code)
    }
    /// Hizmetin ikilisi var ve baytları `allowed` kümesinden biri (yarım/bozuk/yabancı değil).
    fn runs_one_of(&self, allowed: &[Vec<u8>]) -> bool {
        std::fs::read(self.svc_exe()).is_ok_and(|b| allowed.contains(&b))
    }
    fn runs_installed(&self) -> bool {
        self.runs_one_of(&[binary(INSTALLED, true)])
    }
    /// Çalıştırılan (künyesi alınan) her dosya bir doğrulanmış KOPYADIR: onarımın `.onarim`ı ya da kendini
    /// güncellemenin `.yeni`si — asıl ad, `.tmp` artığı ya da bozuk aday ASLA. `vetted`: görev seçiminin (`pick_target`)
    /// özeti doğrulanmış adayları — görev onları zaten SYSTEM olarak çalıştırır.
    fn assert_ran_only_verified(&self, vetted: &[&Path]) {
        for p in self.w.faults.executed.lock().unwrap().iter() {
            let n = name(p);
            let parent = p.parent().map(name).unwrap_or_default();
            let copy = !n.ends_with(".tmp") && (n.contains(".onarim") || n.contains(".yeni") || parent == ".onarim");
            assert!(copy || vetted.contains(&p.as_path()), "{}: doğrulanmamış dosya çalıştırıldı: {}", la_name(self.la), p.display());
        }
    }
    fn assert_only_verified_copies_ran(&self) {
        self.assert_ran_only_verified(&[]);
    }
}

/// Dizindeki bütün dosyalar (göreli) — "hiçbir şey silinmedi" ölçüsü.
fn tree(root: &Path) -> BTreeSet<PathBuf> {
    fn walk(base: &Path, d: &Path, out: &mut BTreeSet<PathBuf>) {
        for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() && !p.is_symlink() {
                walk(base, &p, out);
            } else {
                out.insert(p.strip_prefix(base).unwrap().to_path_buf());
            }
        }
    }
    let mut out = BTreeSet::new();
    walk(root, root, &mut out);
    out
}

/// Bozuk bayt: dosyanın sonu kesilmiş + çöp (güç kesintisinde yarım yazım, disk hatası, "son 4 KB kesildi").
fn tear(p: &Path) {
    let b = std::fs::read(p).unwrap();
    let mut half = b[..b.len() / 2].to_vec();
    half.extend_from_slice(&[0u8; 7]);
    std::fs::write(p, half).unwrap();
}

fn assert_repaired(o: &Outcome, reason: &str, label: &str, ctx: &str) {
    match o {
        Outcome::Onarildi { neden, kaynak } => {
            assert_eq!(neden, reason, "{ctx}: neden");
            assert!(kaynak.starts_with(label), "{ctx}: kaynak {kaynak} ≠ {label}");
        }
        other => panic!("{ctx}: onarım beklenirdi, {other:?}"),
    }
}

// ── §4.7 satır 1 · 2: kendini güncellemenin ve onarımın her adımında ölüm / güç kesintisi ────────────────────

/// R13'ün kapanışı: W1'in iki ayrı yeniden adlandırması arasında ölmüş bir kurulum (L-A: asıl ad BOŞ, eski ikili
/// `.eski`de, yeni `.yeni`de) ya da W-A'da var olmayan bir sürüm dizinini gösteren ImagePath — `onar` doğrulanmış
/// kaynaktan geri koyar; asıl ada yarım/doğrulanmamış `.yeni` asla konmaz.
#[test]
fn asil_ad_bosluk_onarilir() {
    for la in LAYOUTS {
        let s = installed("bosluk", la, None);
        let ctx = la_name(la);
        if la {
            std::fs::rename(&s.asil, selfupdate::sibling(&s.asil, "eski")).unwrap();
            std::fs::write(selfupdate::sibling(&s.asil, "yeni"), &binary(STAGED, true)[..20]).unwrap();
        } else {
            let gone = s.w.layout.updater_versions().join(STAGED).join(s.asil.file_name().unwrap());
            let image = updater_image(&gone, &s.w.layout.root);
            s.w.svcs.lock().unwrap().get_mut(UPDATER).unwrap().image = image;
        }
        s.stop_updater();
        assert!(!s.svc_exe().exists(), "{ctx}: boşluk kuruldu");
        let o = s.onar();
        assert_repaired(&o, "EKSIK", "son bilinen iyi", ctx);
        assert_eq!(o.exit_code(), 0);
        assert!(s.runs_installed(), "{ctx}: hizmetin ikilisi doğrulanmış kurulu ikili");
        if la {
            assert_eq!(s.svc_exe(), s.asil, "L-A: asıl ad geri geldi");
            assert_eq!(s.updater().starts, 0, "L-A: hizmete dokunulmaz (systemd başlatır)");
        } else {
            assert_eq!(s.svc_exe(), s.w.layout.updater_versions().join(INSTALLED).join(s.asil.file_name().unwrap()));
            assert_eq!((s.updater().state, s.updater().starts), (SvcState::Running, 1), "W-A: hizmet başlatıldı");
        }
        assert_eq!(s.log().repairs.len(), 1);
        let n = onarim::recent_notice(&s.w.env(), &s.w.layout).expect("ONARILDI bilgisi");
        assert_eq!(n.code, "ONARILDI");
        assert_eq!(s.onar(), Outcome::Saglam, "{ctx}: ikinci koşu iş bulmaz");
        assert_eq!(s.log().repairs.len(), 1, "{ctx}: sağlam ikili onarım sayılmaz");
        s.assert_only_verified_copies_ran();
    }
}

/// Dünyanın dosya + SCM anlık görüntüsü: ölüm döngüsü her nokta için `World::new`un imzalarını ve zip'ini yeniden
/// üretmek yerine aynı kurulumu geri yükler (kapının süre bütçesi).
struct Snapshot {
    dirs: Vec<PathBuf>,
    files: Vec<(PathBuf, Vec<u8>)>,
    links: Vec<(PathBuf, PathBuf)>,
    svcs: std::collections::HashMap<String, Svc>,
    clock: i64,
}

impl Snapshot {
    fn take(w: &World) -> Snapshot {
        fn walk(d: &Path, s: &mut Snapshot) {
            for e in std::fs::read_dir(d).unwrap().flatten() {
                let p = e.path();
                if let Ok(Some(t)) = RealFs.link_target(&p) {
                    s.links.push((p, t));
                } else if p.is_dir() {
                    s.dirs.push(p.clone());
                    walk(&p, s);
                } else {
                    s.files.push((p.clone(), std::fs::read(&p).unwrap()));
                }
            }
        }
        let mut s = Snapshot {
            dirs: vec![],
            files: vec![],
            links: vec![],
            svcs: w.svcs.lock().unwrap().clone(),
            clock: w.clock.load(Ordering::SeqCst),
        };
        walk(&w.dir, &mut s);
        s
    }

    fn restore(&self, w: &World) {
        std::fs::remove_dir_all(&w.dir).unwrap();
        for d in &self.dirs {
            std::fs::create_dir_all(d).unwrap();
        }
        for (p, b) in &self.files {
            std::fs::write(p, b).unwrap();
        }
        for (l, t) in &self.links {
            RealFs.set_link(l, t).unwrap();
        }
        *w.svcs.lock().unwrap() = self.svcs.clone();
        w.clock.store(self.clock, Ordering::SeqCst);
        w.faults.executed.lock().unwrap().clear();
        w.crash.disarm();
    }
}

/// Hangi akışın ölüme sokulduğu.
#[derive(Clone, Copy, Debug)]
enum Flow {
    /// Kendini güncelleme + yeni ikilinin ilk açılışı + ilk sağlıklı tur.
    Forward,
    /// Kendini güncelleme + doğrulanmadan 4 açılış → geri dönüş + dönülen ikilinin açılışı.
    Revert,
    /// İkili silinmiş; `onar`ın kendisi.
    Repair,
}

fn version_in(p: &Path) -> String {
    serde_json::from_slice::<serde_json::Value>(&std::fs::read(p).unwrap_or_default())
        .ok()
        .and_then(|v| v["surum"].as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Kurulum + kurulu sürüm dizini daha yeni (imzalı) güncelleyiciyi taşır.
fn crash_site(la: bool) -> Site {
    installed("olum", la, Some(binary(STAGED, true)))
}

fn run_flow(s: &Site, flow: Flow) {
    let env = s.w.env();
    let l = &s.w.layout;
    match flow {
        Flow::Forward | Flow::Revert => {
            let _ = selfupdate::stage_with_version(&env, l, &s.asil, &l.version_dir(OLD), INSTALLED, &keys(&s.w));
            let new = s.svc_exe();
            let v = version_in(&new);
            let boots = if matches!(flow, Flow::Forward) { 1 } else { 4 };
            for _ in 0..boots {
                if selfupdate::on_startup(&env, l, &new, &v) == Startup::RevertedRestart {
                    break;
                }
            }
            let now = s.svc_exe();
            let nv = version_in(&now);
            if matches!(flow, Flow::Forward) {
                selfupdate::on_healthy(&env, l, &now, &nv);
            } else {
                selfupdate::on_startup(&env, l, &now, &nv);
            }
        }
        Flow::Repair => {
            let _ = s.onar();
        }
    }
}

fn prepare(s: &Site, flow: Flow) {
    if matches!(flow, Flow::Repair) {
        std::fs::remove_file(s.svc_exe()).unwrap();
        s.stop_updater();
    }
}

/// §4.7 satır 1 + 2: kendini güncellemenin, geri dönüşün ve `onar`ın HER değiştiren adımında süreç ölür — `torn`
/// kipinde ölüm anındaki yazım/kopya yarım `.tmp` bırakır (güç kesintisi). Her ölümden sonra: hizmetin ikilisi YA
/// doğrulanmış (kurulu ya da yeni) ikilidir YA DA (yalnız onarım akışında, onarımdan önce zaten silinmiş) yoktur —
/// yarım dosya hiçbir an hedefte durmaz; yeniden koşan `onar` kurtarır ve hiçbir yarım dosyayı çalıştırmaz.
#[test]
fn kendi_guncelleme_her_adimda_oldur() {
    let verified = [binary(INSTALLED, true), binary(STAGED, true)];
    let mut total = 0;
    for la in LAYOUTS {
        for flow in [Flow::Forward, Flow::Revert, Flow::Repair] {
            let s = crash_site(la);
            prepare(&s, flow);
            let snap = Snapshot::take(&s.w);
            s.w.crash.disarm();
            run_flow(&s, flow);
            let points = s.w.crash.count.load(Ordering::SeqCst);
            assert!(points >= 4, "{flow:?}: ölçülecek adım yok ({points})");
            for torn in [false, true] {
                for k in 1..=points {
                    let ctx = format!("{}/{flow:?}/torn={torn}/adım {k}/{points}", la_name(la));
                    snap.restore(&s.w);
                    s.w.crash.arm(k, torn);
                    let died = catch_unwind(AssertUnwindSafe(|| run_flow(&s, flow))).is_err();
                    s.w.crash.disarm();
                    assert!(died, "{ctx}: ölüm noktasına varılmadı ({:?})", s.w.crash.log.lock().unwrap());
                    let gap_allowed = matches!(flow, Flow::Repair) && !s.svc_exe().exists();
                    assert!(
                        gap_allowed || s.runs_one_of(&verified),
                        "{ctx}: ölümden sonra hizmetin ikilisi doğrulanmış değil ({}) — {:?}",
                        s.svc_exe().display(),
                        s.w.crash.log.lock().unwrap()
                    );
                    // Elektrik geri geldi: görev / birim satırı yeniden koşar.
                    let o = s.onar();
                    match flow {
                        // Önleme (W-A / L-A): kendini güncellemenin hiçbir adımı onarım gerektirmez.
                        Flow::Forward | Flow::Revert => assert_eq!(o, Outcome::Saglam, "{ctx}"),
                        Flow::Repair => {
                            assert!(matches!(o, Outcome::Onarildi { .. } | Outcome::Baslatildi | Outcome::Saglam), "{ctx}: {o:?}")
                        }
                    }
                    assert!(s.runs_one_of(&verified), "{ctx}: onar sonrası doğrulanmış ikili");
                    if !la {
                        assert_eq!(s.updater().state, SvcState::Running, "{ctx}: W-A hizmet ayakta");
                    }
                    s.assert_only_verified_copies_ran();
                    total += 1;
                }
            }
        }
    }
    assert!(total > 50, "ölüm noktası sayısı kuşkulu: {total}");
}

// ── §4.7 satır 3 · 4: silinme / karantina / bozuk bayt ──────────────────────────────────────────────────────

/// Defender ikiliyi siler (karantinaya taşır), SCM hizmeti başlatamaz: `.lkg` kopyası hizmete konur; W-A'da hizmet
/// başlatılır. İkinci koşu iş bulmaz.
#[test]
fn ikili_silindi_onarilir() {
    for la in LAYOUTS {
        let s = installed("silindi", la, None);
        let ctx = la_name(la);
        let quarantine = s.w.dir.join("karantina");
        std::fs::create_dir_all(&quarantine).unwrap();
        std::fs::rename(s.svc_exe(), quarantine.join("tehdit.bin")).unwrap();
        s.stop_updater();
        let o = s.onar();
        assert_repaired(&o, "EKSIK", "son bilinen iyi", ctx);
        assert!(s.runs_installed(), "{ctx}");
        assert_eq!(std::fs::read(&s.lkg).unwrap(), binary(INSTALLED, true), "{ctx}: .lkg yerinde kalır (taşınmaz, kopyalanır)");
        assert_eq!(s.updater().state, if la { SvcState::Stopped } else { SvcState::Running }, "{ctx}");
        let log = s.log();
        assert_eq!((log.repairs.len(), log.repairs[0].neden.as_str()), (1, "EKSIK"), "{ctx}");
        assert_eq!(s.onar(), Outcome::Saglam, "{ctx}");
        s.assert_only_verified_copies_ran();
    }
}

/// Defender `.lkg`yi de aldı: onarıcı imzalı kurulu sürümün `runtime` ikilisidir (görevin ikinci adayı) ve kaynak
/// sırası `.lkg`yi atlayıp kurulu sürümden koyar.
#[test]
fn lkg_karantinada_sonraki_kaynak() {
    for la in LAYOUTS {
        let s = installed("lkg-karantina", la, Some(binary(INSTALLED, true)));
        let ctx = la_name(la);
        std::fs::remove_file(s.svc_exe()).unwrap();
        std::fs::remove_file(&s.lkg).unwrap();
        s.stop_updater();
        // `.lkg onar` hiç koşamaz (dosya yok) — görev hizalanınca onarıcı kurulu sürümün ikilisi olur.
        let (repairer, _) = gorev::pick_target(&s.w.env(), &s.w.layout, &s.asil, Some(&keys(&s.w))).unwrap();
        assert_eq!(repairer, runtime_of(&s.w, OLD), "{ctx}: .lkg yokken onarıcı imzalı runtime");
        let o = s.onar_as(&repairer, Some(&keys(&s.w)));
        assert_repaired(&o, "EKSIK", "kurulu sürüm", ctx);
        assert!(s.runs_installed(), "{ctx}");
        assert!(!s.lkg.exists(), "{ctx}: onarım .lkg'yi yeniden doğurmaz — onu sağlıklı tur kurar");
        // Sağlıklı tur `.lkg`yi yeniden kurar; görev ona döner.
        selfupdate::on_healthy(&s.w.env(), &s.w.layout, &s.svc_exe(), INSTALLED);
        let (back, _) = gorev::pick_target(&s.w.env(), &s.w.layout, &s.asil, Some(&keys(&s.w))).unwrap();
        assert_eq!(back, s.lkg, "{ctx}");
        s.assert_ran_only_verified(&[&repairer, &s.lkg]);
    }
}

/// Bozuk bayt: asıl ad VE `.lkg` yarım yazılmış. `.lkg`nin `onar`ı kendini doğrulayamaz ve HİÇBİR ŞEY yazmaz;
/// imzalı runtime onarıcısı bozuk `.lkg`yi atlar (künyesini bile almaz), kurulu sürümden koyar. Bozuk dosyalar
/// tanı için yerinde kalır; çalıştırılan tek dosya doğrulanmış kopyadır.
#[test]
fn onarim_dogrulanmamis_calistirmaz() {
    for la in LAYOUTS {
        let s = installed("dogrulanmamis", la, Some(binary(INSTALLED, true)));
        let ctx = la_name(la);
        tear(&s.svc_exe());
        tear(&s.lkg);
        let torn_lkg = std::fs::read(&s.lkg).unwrap();
        s.stop_updater();
        let before = tree(&s.w.layout.root);
        let o = s.onar();
        assert!(matches!(o, Outcome::KendiDogrulanmadi(_)), "{ctx}: {o:?}");
        assert_eq!(o.exit_code(), 10);
        assert_eq!(tree(&s.w.layout.root), before, "{ctx}: kendini doğrulayamayan onarıcı hiçbir şey yazmaz");
        assert!(s.w.faults.executed.lock().unwrap().is_empty(), "{ctx}: hiçbir şey çalıştırılmadı");
        assert!(!s.w.layout.repair_file().exists());
        let o = s.onar_as(&runtime_of(&s.w, OLD), Some(&keys(&s.w)));
        assert_repaired(&o, "BOZUK", "kurulu sürüm", ctx);
        assert!(s.runs_installed(), "{ctx}");
        assert_eq!(std::fs::read(&s.lkg).unwrap(), torn_lkg, "{ctx}: bozuk .lkg silinmez, üzerine de yazılmaz");
        s.assert_only_verified_copies_ran();
    }
}

/// "Son 4 KB kesildi": hizmetin ikilisi yarım. Kopyası doğrulamayla yerleştirme arasında değişirse (sha256 tutmayan
/// aday) hiçbir yere konmaz ve `.onarim` kalmaz — kaynak yok görünür; kopya sağlamsa `.lkg`den onarılır.
#[test]
fn bozuk_asil_ad_dogru_kaynaktan() {
    for la in LAYOUTS {
        let s = installed("bozuk", la, None);
        let ctx = la_name(la);
        tear(&s.svc_exe());
        let torn = std::fs::read(s.svc_exe()).unwrap();
        s.stop_updater();
        s.w.fs.corrupt_copy.store(true, Ordering::SeqCst);
        let o = s.onar();
        assert_eq!(o, Outcome::KaynakYok, "{ctx}: değişen kopya kaynak sayılmaz");
        assert_eq!(std::fs::read(s.svc_exe()).unwrap(), torn, "{ctx}: hedefe dokunulmadı");
        assert!(s.w.faults.executed.lock().unwrap().is_empty(), "{ctx}: özeti tutmayan kopyanın künyesi alınmadı");
        assert!(!tree(&s.w.layout.root).iter().any(|p| p.to_string_lossy().contains(".onarim")), "{ctx}: yarım kopya kalmadı");
        assert!(!s.w.layout.repair_file().exists(), "{ctx}: başarısız deneme sayılmaz");
        s.w.fs.corrupt_copy.store(false, Ordering::SeqCst);
        let o = s.onar();
        assert_repaired(&o, "BOZUK", "son bilinen iyi", ctx);
        assert!(s.runs_installed(), "{ctx}");
        s.assert_only_verified_copies_ran();
    }
}

// ── §4.7 satır 5: yönetici kararı ───────────────────────────────────────────────────────────────────────────

/// Yönetici güncelleyiciyi "Devre dışı" yaptı ya da kaydını sildi (Windows): ONARILMAZ, görünür (`GUNCELLEYICI_KAPALI`,
/// çıkış 14); ikili de geri konmaz, hizmet başlatılmaz. Linux'ta karar systemd'nindir: `--yalniz-asil-ad` hizmete
/// hiç dokunmaz (başlatmaz, etkinleştirmez).
#[test]
fn devre_disi_onarilmaz_gorunur() {
    for la in LAYOUTS {
        let s = installed("devre-disi", la, None);
        let ctx = la_name(la);
        s.w.faults.disabled_services.lock().unwrap().push(UPDATER.into());
        s.stop_updater();
        std::fs::remove_file(s.svc_exe()).unwrap();
        let o = s.onar();
        if la {
            assert_repaired(&o, "EKSIK", "son bilinen iyi", ctx);
            assert_eq!((s.updater().state, s.updater().starts), (SvcState::Stopped, 0), "L-A: hizmete dokunulmadı");
            assert_ne!(s.error_code().as_deref(), Some("GUNCELLEYICI_KAPALI"));
            continue;
        }
        assert!(matches!(&o, Outcome::Kapali(m) if m.contains("Devre dışı")), "{o:?}");
        assert_eq!(o.exit_code(), 14);
        assert_eq!(s.error_code().as_deref(), Some("GUNCELLEYICI_KAPALI"));
        assert_eq!(s.w.state(), Some(State::Failed));
        assert!(!s.svc_exe().exists(), "W-A: yönetici kararı geri alınmaz — ikili de konmaz");
        assert_eq!((s.updater().state, s.updater().starts), (SvcState::Stopped, 0));
        assert!(s.w.faults.disabled_services.lock().unwrap().contains(&UPDATER.to_string()), "hâlâ devre dışı");
        assert!(!s.w.layout.repair_file().exists());
        // Kayıt silinmiş: aynı karar.
        s.w.faults.disabled_services.lock().unwrap().clear();
        s.w.svcs.lock().unwrap().remove(UPDATER);
        let o = s.onar();
        assert!(matches!(&o, Outcome::Kapali(m) if m.contains("kaydı yok")), "{o:?}");
        assert_eq!(s.error_code().as_deref(), Some("GUNCELLEYICI_KAPALI"));
        assert!(s.w.faults.executed.lock().unwrap().is_empty());
    }
}

/// W2 çitinin kendi koyduğu "Devre dışı" (`is/cit.json`): onarılmaz ama yönetici kararı da sayılmaz — uyarı yok,
/// çıkış 0. Çit işareti DURMUŞ (devre dışı olmayan) hizmetin onarımını engellemez.
#[test]
fn cit_isareti_istisna() {
    for la in LAYOUTS {
        let s = installed("cit", la, None);
        let ctx = la_name(la);
        std::fs::create_dir_all(s.w.layout.work()).unwrap();
        std::fs::write(s.w.layout.fence_marker(), br#"{"v":1}"#).unwrap();
        s.stop_updater();
        std::fs::remove_file(s.svc_exe()).unwrap();
        s.w.faults.disabled_services.lock().unwrap().push(UPDATER.into());
        let o = s.onar();
        if la {
            // Linux'ta çit systemd düzeyindedir; asıl ad onarımı hizmete dokunmaz.
            assert_repaired(&o, "EKSIK", "son bilinen iyi", ctx);
            assert_eq!(s.updater().starts, 0);
            continue;
        }
        assert_eq!(o, Outcome::Cit);
        assert_eq!(o.exit_code(), 0);
        assert_eq!(s.error_code(), None, "çit uyarı üretmez");
        assert!(!s.svc_exe().exists() && s.updater().starts == 0, "çite dokunulmaz");
        // Çit kalktı (hizmet etkin, ama durmuş ve ikili yok): normal onarım.
        s.w.faults.disabled_services.lock().unwrap().clear();
        let o = s.onar();
        assert_repaired(&o, "EKSIK", "son bilinen iyi", ctx);
        assert_eq!(s.updater().state, SvcState::Running);
    }
}

// ── §4.7 satır 6: kaynak sırası, kaynak yok ─────────────────────────────────────────────────────────────────

/// Kaynak sırası `.lkg` → eski ikili → kurulu sürüm (`current`) → `surumler/<v>` yeniden eskiye. Kendini güncellemeden
/// hemen sonra yeni ikili bozulur; her adımda bir önceki kaynak da düşer (bozuk bayt / silinme / kesik), onarıcı
/// görevin seçtiği sıradaki doğrulanmış ikilidir. Günler ayrı (tavan karışmasın).
#[test]
fn onarim_kaynak_sirasi() {
    for la in LAYOUTS {
        let s = installed("sira", la, Some(binary(STAGED, true)));
        let ctx = la_name(la);
        let older = "2.11.0";
        write_version(&s.w, older, Some(&binary("0.0.5", true)));
        let env = s.w.env();
        let l = &s.w.layout;
        assert_eq!(selfupdate::stage_with_version(&env, l, &s.asil, &l.version_dir(OLD), INSTALLED, &keys(&s.w)), Ok(true));
        let new = s.svc_exe();
        assert_eq!(selfupdate::on_startup(&env, l, &new, STAGED), Startup::Continue);
        let old = PathBuf::from(selfupdate::read(&env, l).unwrap().old_path.expect("eskiYol"));
        let step = |what: &str, repairer: &Path, label: &str, expect: &[u8]| {
            s.advance(25 * HOUR);
            tear(&s.svc_exe());
            let o = s.onar_as(repairer, Some(&keys(&s.w)));
            assert_repaired(&o, "BOZUK", label, &format!("{ctx}/{what}"));
            assert!(s.runs_one_of(&[expect.to_vec()]), "{ctx}/{what}: {}", s.svc_exe().display());
        };
        step("hepsi yerinde", &s.lkg, "son bilinen iyi", &binary(INSTALLED, true));
        let repairer = runtime_of(&s.w, OLD);
        tear(&s.lkg);
        step(".lkg bozuk", &repairer, "eski ikili", &binary(INSTALLED, true));
        std::fs::remove_file(&old).unwrap();
        step(".lkg bozuk + eski silindi", &repairer, "kurulu sürüm", &binary(STAGED, true));
        let repairer = runtime_of(&s.w, older);
        tear(&runtime_of(&s.w, OLD));
        step("kurulu sürüm kesik", &repairer, "kurulu sürüm", &binary("0.0.5", true));
        assert!(
            s.svc_exe().starts_with(l.updater_dir()) || s.svc_exe() == s.asil,
            "{ctx}: kaynak sürüm dizini hizmete VERİLMEZ, kopyası konur"
        );
        s.assert_only_verified_copies_ran();
    }
}

/// Hiçbir doğrulanmış kaynak yok (`.lkg` ve ikili silinmiş, paket güveni kurulamadı): `ONARIM_KAYNAK_YOK` panelde ve
/// satıcıda görünür (çıkış 12), sessiz kalmaz; hiçbir şey yazılmaz, sayaç işlemez, hizmet başlatılmaz.
#[test]
fn kaynak_yoksa_gorunur() {
    for la in LAYOUTS {
        let s = installed("kaynak-yok", la, Some(binary(INSTALLED, true)));
        let ctx = la_name(la);
        // Görev kurulu sürümün ikilisini gösteriyordu (özeti `onariciOzet`te); Defender ikiliyi ve `.lkg`yi aldı.
        let repairer = runtime_of(&s.w, OLD);
        selfupdate::remember_repairer(&s.w.env(), &s.w.layout, &sha_b64u(&binary(INSTALLED, true)));
        std::fs::remove_file(s.svc_exe()).unwrap();
        std::fs::remove_file(&s.lkg).unwrap();
        s.stop_updater();
        let before = tree(&s.w.layout.root);
        let o = s.onar_as(&repairer, None);
        assert_eq!(o, Outcome::KaynakYok, "{ctx}");
        assert_eq!(o.exit_code(), 12);
        let st = s.w.status().expect("durum.json");
        assert_eq!((st.state, st.error_code.as_deref()), (State::Failed, Some("ONARIM_KAYNAK_YOK")), "{ctx}");
        assert!(st.message.as_deref().is_some_and(|m| m.contains("ikili yoktu")), "{ctx}: {:?}", st.message);
        assert_eq!(tree(&s.w.layout.root), before, "{ctx}: hiçbir şey yazılmadı/silinmedi");
        assert!(!s.w.layout.repair_file().exists());
        assert_eq!(s.updater().starts, 0);
        // `.lkg` geri geldi ama bozuk (karantinadan yarım dönmüş): aday var, doğrulanmıyor — yine görünür, çalıştırılmaz.
        std::fs::write(&s.lkg, b"MZ yarim").unwrap();
        assert_eq!(s.onar_as(&repairer, None), Outcome::KaynakYok, "{ctx}");
        assert_eq!(std::fs::read(&s.lkg).unwrap(), b"MZ yarim", "{ctx}: bozuk aday silinmez");
        assert!(s.w.faults.executed.lock().unwrap().is_empty(), "{ctx}");
    }
}

/// Disk dolu: kopya sığmaz → `DISK_DOLU` (çıkış 13). Hiçbir dosya silinmez, yarım kopya kalmaz, sayaç işlemez;
/// yer açılınca bir sonraki koşu onarır.
#[test]
fn onarim_disk_dolu() {
    for la in LAYOUTS {
        let s = installed("disk-dolu", la, None);
        let ctx = la_name(la);
        std::fs::remove_file(s.svc_exe()).unwrap();
        s.stop_updater();
        s.w.fs.enospc_copy.store(true, Ordering::SeqCst);
        let before = tree(&s.w.layout.root);
        let o = s.onar();
        assert!(matches!(&o, Outcome::DiskDolu(m) if m.contains("hiçbir şey silinmedi")), "{ctx}: {o:?}");
        assert_eq!(o.exit_code(), 13);
        assert_eq!(s.error_code().as_deref(), Some("DISK_DOLU"), "{ctx}");
        assert_eq!(tree(&s.w.layout.root), before, "{ctx}: hiçbir dosya silinmedi, yarım kopya kalmadı");
        assert!(!s.w.layout.repair_file().exists(), "{ctx}: sayaç işlemedi");
        assert_eq!(s.updater().starts, 0);
        s.w.fs.enospc_copy.store(false, Ordering::SeqCst);
        assert_repaired(&s.onar(), "EKSIK", "son bilinen iyi", ctx);
        assert!(s.runs_installed());
    }
}

// ── §4.7 satır 8: döngü tavanı ──────────────────────────────────────────────────────────────────────────────

/// Bozuk ikili sürekli geri geliyor (karantina döngüsü, disk arızası): 10 dakikada bir 100 kez bozulur — 24 saatte
/// en çok 3 onarım, sonra `ONARIM_TAVANI` (çıkış 11) ve ikili ONARILMAZ. Tavan altında sağlıklı tur sayacı
/// sıfırlamaz; tavandan sonra ya insan düzeltir + sağlıklı tur (sıfırlar) ya da 24 saatlik pencere boşalır.
#[test]
fn onarim_dongusu_tavanli() {
    for la in LAYOUTS {
        let s = installed("tavan", la, None);
        let ctx = la_name(la);
        let breaks = |i: usize| {
            let p = s.svc_exe();
            if i % 2 == 0 {
                let _ = std::fs::remove_file(&p);
            } else {
                std::fs::write(&p, b"MZ karantinadan donen bozuk ikili").unwrap();
            }
            s.stop_updater();
        };
        let (mut repaired, mut ceiling) = (0, 0);
        for i in 0..100 {
            breaks(i);
            s.advance(10 * MIN);
            match s.onar() {
                Outcome::Onarildi { .. } => repaired += 1,
                Outcome::Tavan => ceiling += 1,
                other => panic!("{ctx}: tur {i}: {other:?}"),
            }
            if i == 1 {
                // Tavan altında sağlıklı tur: sayaç SIFIRLANMAZ (yoksa döngü hiç tavana varmaz).
                selfupdate::on_healthy(&s.w.env(), &s.w.layout, &s.svc_exe(), INSTALLED);
                assert_eq!(s.log().repairs.len(), 2, "{ctx}: tavan altında sıfırlanmaz");
            }
        }
        assert_eq!((repaired, ceiling), (MAX_REPAIRS, 100 - MAX_REPAIRS), "{ctx}");
        assert_eq!(s.onar().exit_code(), 11);
        let log = s.log();
        assert!(log.at_ceiling && log.repairs.len() == MAX_REPAIRS, "{ctx}: {log:?}");
        assert_eq!(s.error_code().as_deref(), Some("ONARIM_TAVANI"), "{ctx}");
        assert!(!s.runs_installed(), "{ctx}: tavanda ikili onarılmaz");
        // İnsan düzeltir, güncelleyici sağlıklı bir tur geçirir: tavan kalkar.
        std::fs::copy(&s.lkg, s.svc_exe()).unwrap();
        selfupdate::on_healthy(&s.w.env(), &s.w.layout, &s.svc_exe(), INSTALLED);
        assert_eq!(s.log(), onarim::RepairLog { v: 1, ..Default::default() }, "{ctx}: kanıtlı tur sayacı sıfırlar");
        breaks(0);
        assert!(matches!(s.onar(), Outcome::Onarildi { .. }), "{ctx}: tavan kalktıktan sonra yine onarır");
        // Pencere: 3 onarım daha → tavan; 24 saat sonra (insan yok) pencere boşalır.
        for i in 1..=MAX_REPAIRS {
            breaks(i);
            s.advance(MIN);
            let o = s.onar();
            assert_eq!(matches!(o, Outcome::Tavan), i == MAX_REPAIRS, "{ctx}: {i}: {o:?}");
        }
        s.advance(24 * HOUR);
        assert!(matches!(s.onar(), Outcome::Onarildi { .. }), "{ctx}: 24 saat sonra pencere boşaldı");
        if la {
            continue;
        }
        // W-A: ikili sağlam ama hizmet her açılışta düşüyor — başlatma da onarım sayılır, tavan döngüyü keser.
        s.advance(25 * HOUR);
        let mut started = 0;
        for _ in 0..10 {
            s.stop_updater();
            s.advance(MIN);
            match s.onar() {
                Outcome::Baslatildi => started += 1,
                Outcome::Tavan => {}
                other => panic!("W-A durmuş hizmet: {other:?}"),
            }
        }
        assert_eq!(started, MAX_REPAIRS, "W-A: durmuş hizmet en çok 3 kez başlatılır");
        assert_eq!(s.error_code().as_deref(), Some("ONARIM_TAVANI"));
    }
}

// ── §4.7 satır 9: eski `.lkg` geçişi ────────────────────────────────────────────────────────────────────────

/// İlk W1b'li sürüm geldiğinde `.lkg` W1 ikilisidir (`onar`ı tanımaz; orada `onar` = `tur`): görev onu ASLA
/// göstermez — imzalı listedeki `runtime` W1b ikilisini, o da yoksa çalışanı gösterir. W1 → W1b → W1b+1 zincirinin
/// her halkasında seçilen onarıcı gerçekten onarır; `.lkg` W1b olunca görev ona döner.
#[test]
fn onarim_eski_lkg_gecisi() {
    for la in LAYOUTS {
        let ctx = la_name(la);
        // Halka 1: kurulu W1 (0.1.0, künyesi `onarim`suz), paket W1b (0.2.0) taşır.
        let s = installed("gecis", la, Some(binary("0.2.0", true)));
        std::fs::write(&s.asil, binary(INSTALLED, false)).unwrap();
        std::fs::write(&s.lkg, binary(INSTALLED, false)).unwrap();
        let w1 = sha_b64u(&binary(INSTALLED, false));
        let state = s.w.layout.self_update_file();
        let mut st: serde_json::Value = serde_json::from_slice(&std::fs::read(&state).unwrap()).unwrap();
        st["lkgOzet"] = w1.clone().into();
        st["calisanOzet"] = w1.into();
        std::fs::write(&state, st.to_string()).unwrap();
        let env = s.w.env();
        let l = &s.w.layout;
        let pick = |own: &Path, trust: Option<&PackageTrust>| gorev::pick_target(&env, l, own, trust).map(|(p, _)| p);
        assert_eq!(pick(&s.asil, Some(&keys(&s.w))), Some(runtime_of(&s.w, OLD)), "{ctx}: W1 .lkg değil, imzalı W1b runtime");
        assert_eq!(pick(&s.asil, None), Some(s.asil.clone()), "{ctx}: güven yoksa çalışan — W1 .lkg ASLA");
        // Halka 2: W1 → W1b kendini günceller; ilk sağlıklı turda `.lkg` W1 kalır (vardı).
        assert_eq!(selfupdate::stage_with_version(&env, l, &s.asil, &l.version_dir(OLD), INSTALLED, &keys(&s.w)), Ok(true));
        let w1b = s.svc_exe();
        assert_eq!(selfupdate::on_startup(&env, l, &w1b, "0.2.0"), Startup::Continue);
        selfupdate::on_healthy(&env, l, &w1b, "0.2.0");
        assert_eq!(std::fs::read(&s.lkg).unwrap(), binary(INSTALLED, false), "{ctx}: .lkg hâlâ W1");
        let repairer = pick(&w1b, Some(&keys(&s.w))).unwrap();
        assert_ne!(repairer, s.lkg, "{ctx}: W1 .lkg'ye onar verilmez");
        tear(&s.svc_exe());
        let o = s.onar_as(&repairer, Some(&keys(&s.w)));
        // Kaynak sırası `.lkg`yi öne koyar: W1 ikilisi KAYNAK olabilir (onarıcı olamaz) — hizmet W1'e iner, W1
        // sonraki turunda paketteki W1b'yi yeniden yerleştirir.
        assert_repaired(&o, "BOZUK", "son bilinen iyi", &format!("{ctx}: halka 2'de onarım çalışır"));
        assert!(s.runs_one_of(&[binary(INSTALLED, false)]), "{ctx}: doğrulanmış W1 kondu");
        // Halka 3: dönülen W1 paketteki W1b'yi yeniden yerleştirir; W1b kanıtlanır (backend denemesi BAŞARILI) →
        // `.lkg` W1b olur, görev ona döner.
        let w1 = s.svc_exe();
        assert_eq!(selfupdate::stage_with_version(&env, l, &w1, &l.version_dir(OLD), INSTALLED, &keys(&s.w)), Ok(true), "{ctx}");
        let w1b = s.svc_exe();
        assert_eq!(selfupdate::on_startup(&env, l, &w1b, "0.2.0"), Startup::Continue);
        selfupdate::after_attempt(&env, l, &w1b, "0.2.0", true);
        assert_eq!(std::fs::read(&s.lkg).unwrap(), binary("0.2.0", true), "{ctx}: .lkg artık W1b");
        assert_eq!(pick(&w1b, Some(&keys(&s.w))), Some(s.lkg.clone()), "{ctx}: görev W1b .lkg'yi gösterir");
        s.advance(25 * HOUR);
        tear(&s.svc_exe());
        assert_repaired(&s.onar(), "BOZUK", "son bilinen iyi", ctx);
        assert!(s.runs_one_of(&[binary("0.2.0", true)]));
        s.assert_ran_only_verified(&[&s.lkg, &runtime_of(&s.w, OLD)]);
    }
}

// ── yarışmama: çalışan güncelleyici, eşzamanlı iki onarım, taze kalp atışı ──────────────────────────────────

/// Çalışan güncelleyici işlem kilidini tutarken `onar` dokunmaz (çıkış 0); aynı anda iki onarıcı (görev + elle
/// koşum) en çok BİR onarım yapar; ikili sağlam ve kalp atışı tazeyken durmuş hizmet başlatılmaz.
#[test]
fn kilit_doluysa_dokunmaz() {
    for la in LAYOUTS {
        let s = installed("kilit", la, None);
        let ctx = la_name(la);
        std::fs::remove_file(s.svc_exe()).unwrap();
        s.stop_updater();
        {
            let _held = tekserp_guncelleyici::lock::acquire(&s.w.layout.lock_file()).expect("kilit");
            let before = tree(&s.w.layout.root);
            assert_eq!(s.onar(), Outcome::KilitDolu, "{ctx}");
            assert_eq!(Outcome::KilitDolu.exit_code(), 0);
            assert_eq!(tree(&s.w.layout.root), before, "{ctx}: kilit doluyken hiçbir şey");
        }
        let gate = Barrier::new(2);
        let outcomes: Vec<Outcome> = std::thread::scope(|sc| {
            let runs: Vec<_> = (0..2)
                .map(|_| {
                    sc.spawn(|| {
                        gate.wait();
                        s.onar()
                    })
                })
                .collect();
            runs.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let done = outcomes.iter().filter(|o| matches!(o, Outcome::Onarildi { .. })).count();
        assert_eq!(done, 1, "{ctx}: iki onarıcıdan yalnız biri onarır: {outcomes:?}");
        assert!(outcomes.iter().all(|o| matches!(o, Outcome::Onarildi { .. } | Outcome::KilitDolu | Outcome::Saglam)), "{outcomes:?}");
        assert_eq!(s.log().repairs.len(), 1, "{ctx}");
        assert!(s.runs_installed());
        if la {
            continue;
        }
        // W-A: ikili sağlam, hizmet durmuş ama kalp atışı taze (güncelleyici az önce yazdı; SCM yeniden başlatıyor).
        s.stop_updater();
        let mut d = StatusDoc::new(State::Waiting);
        d.heartbeat = iso(s.w.clock.load(Ordering::SeqCst));
        d.liveness_threshold_s = 120;
        ipc::write_status(&RealFs, &s.w.layout, &d).unwrap();
        s.advance(MIN);
        assert_eq!(s.onar(), Outcome::Saglam, "taze kalp atışı: yarışılmaz");
        assert_eq!(s.updater().state, SvcState::Stopped);
        s.advance(5 * MIN);
        assert_eq!(s.onar(), Outcome::Baslatildi, "kalp atışı bayat: başlatılır");
    }
}
