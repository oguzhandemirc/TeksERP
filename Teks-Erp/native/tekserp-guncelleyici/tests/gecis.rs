//! Linux kurulum ve geçiş araçları (L7, `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §8.1 · §8.2): `gecis` elle Docker
//! kurulumunu güncelleyici düzenine alır (KURU varsayılan · `--onay <N>` · sağlıklı olana dek her hatada kendiliğinden
//! geri), `gecis --geri-al` tersine çevirir, `kur` tekrarlanabilir. Docker ve systemd sahtedir; dosya sistemi gerçek.
#![cfg(unix)]
mod common;

use common::*;
use ed25519_dalek::SigningKey;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_guncelleyici::env::{Clock, Cmd, CmdOut, Env, EnvResult, Procs};
use tekserp_guncelleyici::imaj;
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::platform::linux::duzen;
use tekserp_guncelleyici::platform::linux::kurulum::{self, cikis, Baglam, Konak, Secenek};

const PROJE: &str = "prova";

fn out(code: i32, stdout: &str) -> CmdOut {
    CmdOut { code: Some(code), stdout: stdout.as_bytes().to_vec(), stderr: vec![], timed_out: false }
}

fn saglik(v: &str) -> String {
    format!(
        "200\n{}",
        json!({ "status": "UP", "db": "UP", "version": v, "lisans": { "kip": "NORMAL", "butunluk": "GECERLI", "cekirdek": "NATIVE" } })
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kurulu {
    Yok,
    Eski,
    Yeni,
}

/// Sahte `docker`: projenin konteynerleri hangi compose dosyasıyla kalktığını bilir; imaj deposu etiket → (tutamaç, katmanlar).
struct Docker {
    calls: Mutex<Vec<Vec<String>>>,
    kurulu: Mutex<Kurulu>,
    birimler: Mutex<HashSet<String>>,
    imajlar: Mutex<BTreeMap<String, (String, Vec<String>)>>,
    loads: AtomicU64,
    /// Yeni compose ile kalkan backend sağlıksız (sürüm yanlış) döner.
    yeni_bozuk: AtomicBool,
}

impl Docker {
    fn new(kurulu: Kurulu) -> Arc<Docker> {
        let kimlik = oci_image_id(NEW);
        let mut imajlar = BTreeMap::new();
        if kurulu == Kurulu::Eski {
            imajlar.insert(format!("tekserp-korumali:{NEW}"), (docker_handle(&kimlik), vec![oci_layer_id(NEW)]));
        }
        imajlar.insert("postgres:16-bookworm".into(), ("sha256:pg".into(), vec![]));
        Arc::new(Docker {
            calls: Mutex::new(vec![]),
            kurulu: Mutex::new(kurulu),
            birimler: Mutex::new([format!("{PROJE}_pg_data"), format!("{PROJE}_lisans")].into_iter().collect()),
            imajlar: Mutex::new(imajlar),
            loads: AtomicU64::new(0),
            yeni_bozuk: AtomicBool::new(false),
        })
    }
    fn kurulu(&self) -> Kurulu {
        *self.kurulu.lock().unwrap()
    }
    fn backend_saglik(&self) -> CmdOut {
        match self.kurulu() {
            Kurulu::Yok => out(1, ""),
            Kurulu::Eski => out(0, &saglik(NEW)),
            Kurulu::Yeni if self.yeni_bozuk.load(Ordering::SeqCst) => out(0, &saglik("0.0.1")),
            Kurulu::Yeni => out(0, &saglik(NEW)),
        }
    }
    /// Değiştiren çağrılar (salt-okur sorgular dışındaki her şey).
    fn yazanlar(&self) -> Vec<Vec<String>> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|a| {
                let sub = alt(a);
                !matches!(
                    sub.iter().map(String::as_str).collect::<Vec<_>>().as_slice(),
                    ["ps", ..]
                        | ["inspect", ..]
                        | ["volume", "inspect", ..]
                        | ["image", "inspect" | "ls", ..]
                        | ["exec", ..]
                        | ["config", ..]
                )
            })
            .cloned()
            .collect()
    }
    fn uplar(&self) -> Vec<Vec<String>> {
        self.calls.lock().unwrap().iter().filter(|a| alt(a).first().is_some_and(|s| s == "up")).cloned().collect()
    }
}

fn alt(a: &[String]) -> Vec<String> {
    match duzen::compose_basi_coz(a) {
        Some((_, i)) => a[i..].to_vec(),
        None => a.to_vec(),
    }
}

impl Procs for Docker {
    fn run(&self, c: &Cmd) -> EnvResult<CmdOut> {
        let args: Vec<String> = c.args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        self.calls.lock().unwrap().push(args.clone());
        if let Some((files, i)) = duzen::compose_basi_coz(&args) {
            let sub: Vec<&str> = args[i..].iter().map(String::as_str).collect();
            return Ok(match sub.as_slice() {
                ["config", "--format", "json"] => out(0, &oci_compose(NEW).to_string()),
                ["up", "-d", "--wait", "postgres"] => out(0, ""),
                ["up", "-d"] => {
                    let f = files[0];
                    *self.kurulu.lock().unwrap() = if f.ends_with("current/docker-compose.yml") { Kurulu::Yeni } else { Kurulu::Eski };
                    out(0, "")
                }
                ["exec", "-T", "backend", "node", "-e", _] => self.backend_saglik(),
                ["run", ..] => out(0, ""),
                other => out(125, &format!("sahte compose: {other:?}")),
            });
        }
        let s: Vec<&str> = args.iter().map(String::as_str).collect();
        Ok(match s.as_slice() {
            ["volume", "inspect", "--format", _, ad] => {
                if self.birimler.lock().unwrap().contains(*ad) {
                    out(0, ad)
                } else {
                    out(1, "")
                }
            }
            ["ps", "-q", "--filter", _, "--filter", svc] => match (self.kurulu(), *svc) {
                (Kurulu::Yok, _) => out(0, ""),
                (_, "label=com.docker.compose.service=backend") => out(0, "cid-backend\n"),
                (_, "label=com.docker.compose.service=postgres") => out(0, "cid-pg\n"),
                _ => out(0, ""),
            },
            ["inspect", "--format", "{{.Config.Image}}", "cid-pg"] => out(0, "postgres:16-bookworm\n"),
            ["exec", "cid-backend", "node", "-e", _] => self.backend_saglik(),
            ["image", "inspect", "--format", fmt, r] => match self.imajlar.lock().unwrap().get(*r) {
                None => {
                    CmdOut { code: Some(1), stdout: vec![], stderr: format!("Error: No such image: {r}").into_bytes(), timed_out: false }
                }
                Some((id, layers)) if *fmt == imaj::INSPECT_FORMAT => out(0, &format!("{id}|{}\n", serde_json::to_string(layers).unwrap())),
                Some((id, _)) => out(0, &format!("{id}\n")),
            },
            ["image", "ls", ..] => out(0, ""),
            ["load", "-i", _] => {
                self.loads.fetch_add(1, Ordering::SeqCst);
                let kimlik = oci_image_id(NEW);
                self.imajlar.lock().unwrap().insert(format!("tekserp-korumali:{NEW}"), (docker_handle(&kimlik), vec![oci_layer_id(NEW)]));
                out(0, "")
            }
            ["rm", "-f", _] => out(0, ""),
            other => out(125, &format!("sahte docker: {other:?}")),
        })
    }
}

#[derive(Default)]
struct SahteKonak {
    root: bool,
    birimler: Mutex<HashSet<String>>,
    etkin: Mutex<HashSet<String>>,
    baslatma_duser: AtomicBool,
    olaylar: Mutex<Vec<String>>,
}

impl Konak for SahteKonak {
    fn root(&self) -> bool {
        self.root
    }
    fn sahiplen(&self, yol: &Path, uid: u32) -> Result<(), String> {
        self.olaylar.lock().unwrap().push(format!("chown {uid} {}", yol.display()));
        Ok(())
    }
    fn birim_var(&self, ad: &str) -> bool {
        self.birimler.lock().unwrap().contains(ad)
    }
    fn birim_kur(&self, _kok: &Path, _veri: &Path, ad: &str) -> Result<(), String> {
        self.olaylar.lock().unwrap().push(format!("kur {ad}"));
        self.birimler.lock().unwrap().insert(ad.into());
        Ok(())
    }
    fn birim_kaldir(&self, ad: &str) -> Result<(), String> {
        self.olaylar.lock().unwrap().push(format!("kaldir {ad}"));
        self.birimler.lock().unwrap().remove(ad);
        self.etkin.lock().unwrap().remove(ad);
        Ok(())
    }
    fn birim_baslat(&self, ad: &str) -> Result<(), String> {
        self.olaylar.lock().unwrap().push(format!("baslat {ad}"));
        if self.baslatma_duser.load(Ordering::SeqCst) {
            return Err("systemctl start: düştü".into());
        }
        self.etkin.lock().unwrap().insert(ad.into());
        Ok(())
    }
    fn birim_etkin(&self, ad: &str) -> bool {
        self.etkin.lock().unwrap().contains(ad)
    }
}

struct Saat(AtomicI64);
impl Clock for Saat {
    fn now_ms(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
    fn sleep(&self, d: Duration) {
        self.0.fetch_add(i64::try_from(d.as_millis()).unwrap(), Ordering::SeqCst);
    }
}

struct Duzen {
    d: PathBuf,
    kok: PathBuf,
    veri: PathBuf,
    tar: PathBuf,
    trust: PackageTrust,
    docker: Arc<Docker>,
    konak: SahteKonak,
    yazilan: Mutex<Vec<String>>,
}

static SIRA: AtomicU64 = AtomicU64::new(0);

fn anahtar() -> SigningKey {
    SigningKey::from_bytes(&[7; 32])
}

impl Duzen {
    fn new(etiket: &str, kurulu: Kurulu) -> Duzen {
        let d = std::env::temp_dir().join(format!("tekserp-gecis-{etiket}-{}-{}", std::process::id(), SIRA.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&d);
        let kok = d.join("ders");
        let veri = d.join("veri");
        std::fs::create_dir_all(&kok).unwrap();
        let key = anahtar();
        let tar = d.join(oci_package_name(NEW));
        std::fs::write(&tar, ustar_of(&oci_files(NEW, &oci_default_updater(), &key, "paket-2026", None, &|_| {}))).unwrap();
        let trust = PackageTrust::embedded(vec![("paket-2026".into(), x_of(&key))]);
        Duzen {
            d,
            kok,
            veri,
            tar,
            trust,
            docker: Docker::new(kurulu),
            konak: SahteKonak { root: true, ..Default::default() },
            yazilan: Mutex::new(vec![]),
        }
    }
    /// Elle kurulum (`LINUX-DOCKER-KURULUM.md` §2 + §10 kenar override'ı).
    fn elle(etiket: &str) -> Duzen {
        let z = Duzen::new(etiket, Kurulu::Eski);
        std::fs::write(z.kok.join("docker-compose.yml"), "services: {}\n").unwrap();
        std::fs::write(
            z.kok.join(".env"),
            format!("TEKSERP_PROJE={PROJE}\nTEKSERP_IMAJ=tekserp-korumali:{NEW}\nPOSTGRES_PASSWORD=gizli-parola\n"),
        )
        .unwrap();
        std::fs::write(z.kok.join("docker-compose.override.yml"), "services:\n  kenar:\n    pull_policy: never\n").unwrap();
        z
    }
    fn layout(&self) -> Layout {
        Layout::new(&self.kok, &self.veri)
    }
    fn secenek(&self, uygula: bool, onay: Option<usize>, damga: &str) -> Secenek {
        Secenek {
            kok: self.kok.clone(),
            veri: self.veri.clone(),
            ad: "tekserp-guncelleyici".into(),
            sunucu: kurulum::VARSAYILAN_SUNUCU.into(),
            tar: Some(self.tar.clone()),
            proje: Some(PROJE.into()),
            uygula,
            onay,
            damga: damga.into(),
            yedek_alan: 4096,
        }
    }
    fn env(&self) -> Env {
        use tekserp_guncelleyici::platform::linux;
        Env {
            fs: Arc::new(tekserp_guncelleyici::env::RealFs),
            svc: Arc::new(linux::NoServices),
            procs: Arc::clone(&self.docker) as Arc<dyn Procs>,
            net: Arc::new(tekserp_guncelleyici::env::RealNet::new(None).unwrap()),
            clock: Arc::new(Saat(AtomicI64::new(1_790_000_000_000))),
            events: Arc::new(linux::olay::StderrEvents { journald: false }),
            protect: Arc::new(linux::koruma::DirectoryProtect),
            arka: linux::arka_ucu(),
        }
    }
    fn kos(&self, f: fn(&Baglam, &Secenek) -> u32, s: &Secenek) -> u32 {
        let env = self.env();
        let yaz = |m: &str| self.yazilan.lock().unwrap().push(m.to_string());
        let b = Baglam { env: &env, konak: &self.konak, trust: &self.trust, yaz: &yaz };
        f(&b, s)
    }
    fn cikti(&self) -> String {
        self.yazilan.lock().unwrap().join("\n")
    }
    /// Kök + veri ağacının ölçüsü: yol → (tür, kip, içerik özeti).
    fn agac(&self) -> BTreeMap<String, String> {
        fn yuru(p: &Path, out: &mut BTreeMap<String, String>) {
            let Ok(m) = std::fs::symlink_metadata(p) else { return };
            let k = m.permissions().mode() & 0o7777;
            let v = if m.file_type().is_symlink() {
                format!("bag {:?}", std::fs::read_link(p).ok())
            } else if m.is_dir() {
                for e in std::fs::read_dir(p).unwrap().flatten() {
                    yuru(&e.path(), out);
                }
                format!("dizin {k:o}")
            } else {
                format!("dosya {k:o} {}", sha_hex(&std::fs::read(p).unwrap()))
            };
            out.insert(p.to_string_lossy().into_owned(), v);
        }
        let mut out = BTreeMap::new();
        yuru(&self.kok, &mut out);
        yuru(&self.veri, &mut out);
        out
    }
    fn gunluk(&self, damga: &str) -> Vec<Value> {
        std::fs::read_to_string(self.kok.join("gecis").join(damga).join("gunluk.jsonl"))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }
}

impl Drop for Duzen {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.d);
    }
}

fn sonuc(g: &[Value]) -> Option<String> {
    g.iter().rev().find(|v| v["tur"] == "SONUC").and_then(|v| v["sonuc"].as_str().map(str::to_string))
}

const D1: &str = "20261010-120000";
const N: usize = kurulum::GECIS_KALEMLERI.len();

#[test]
fn gecis_kuru_hicbir_sey_yazmaz() {
    let z = Duzen::elle("kuru");
    let once = z.agac();
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(false, None, D1)), cikis::TAMAM, "{}", z.cikti());
    assert_eq!(z.agac(), once, "KURU koşum dosya sistemine yazdı");
    assert!(z.docker.yazanlar().is_empty(), "KURU koşum Docker'a yazdı: {:?}", z.docker.yazanlar());
    assert!(z.konak.olaylar.lock().unwrap().is_empty());
    let c = z.cikti();
    assert!(c.contains(&format!("--onay {N}")) && c.contains("ENVANTER") && c.contains(&format!("proje {PROJE}")), "{c}");
    assert!(!c.contains("gizli-parola"), "sır ekrana basıldı");
    // Onay uyuşmazsa da hiçbir şey yazılmaz.
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N - 1), D1)), cikis::DUR);
    assert_eq!(z.agac(), once);
    assert!(z.docker.yazanlar().is_empty());
}

#[test]
fn gecis_mutlu_yol_ve_geri_al() {
    let z = Duzen::elle("mutlu");
    let eski_env = std::fs::read(z.kok.join(".env")).unwrap();
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), D1)), cikis::TAMAM, "{}", z.cikti());
    let l = z.layout();
    assert_eq!(std::fs::read_link(l.current()).unwrap(), l.version_dir(NEW));
    assert_eq!(std::fs::read(l.backend_env()).unwrap(), eski_env, ".env kopyası birebir");
    assert_eq!(std::fs::metadata(l.backend_env()).unwrap().permissions().mode() & 0o777, 0o600);
    assert!(duzen::yerel_compose(&l).is_file(), "override yerel compose oldu");
    assert_eq!(std::fs::read_to_string(duzen::pg_env(&l)).unwrap(), "TEKSERP_PG_IMAJ=postgres:16-bookworm\n");
    let ayar: Value = serde_json::from_slice(&std::fs::read(l.settings_file()).unwrap()).unwrap();
    assert_eq!(ayar, json!({ "guncellemeSunucusu": kurulum::VARSAYILAN_SUNUCU, "composeProje": PROJE }));
    for f in ["docker-compose.yml", ".env", "docker-compose.override.yml"] {
        assert!(!z.kok.join(f).exists(), "{f} kökte kaldı");
        assert!(z.kok.join("gecis").join(D1).join("geri").join(f).is_file(), "{f} geri/'de yok");
    }
    let asil = l.updater_dir().join("tekserp-guncelleyici");
    assert_eq!(std::fs::read(&asil).unwrap(), oci_default_updater());
    assert_eq!(std::fs::metadata(&asil).unwrap().permissions().mode() & 0o777, 0o755);
    assert_eq!(z.docker.loads.load(Ordering::SeqCst), 0, "yüklü imaj yeniden yüklenmez");
    assert!(imaj::kayit_oku(&tekserp_guncelleyici::env::RealFs, &l, NEW).is_some(), "etiket kaydı yazılmalı (R17)");
    let ups = z.docker.uplar();
    assert_eq!(ups.len(), 1, "{ups:?}");
    let (files, _) = duzen::compose_basi_coz(&ups[0]).unwrap();
    assert_eq!(files, vec![l.current().join("docker-compose.yml").to_str().unwrap(), duzen::yerel_compose(&l).to_str().unwrap()]);
    assert!(z.konak.birim_etkin("tekserp-guncelleyici"));
    assert!(
        z.konak.olaylar.lock().unwrap().iter().any(|o| o.starts_with("chown 10001") && o.ends_with("niyet")),
        "niyet dizini backend'in"
    );
    assert_eq!(sonuc(&z.gunluk(D1)).as_deref(), Some("BASARILI"));
    assert!(!z.docker.calls.lock().unwrap().iter().flatten().any(|a| a.contains("gizli-parola")), "sır argümana girdi");

    // İkinci geçiş: kök zaten güncelleyici düzeninde ⇒ DUR, hiçbir şey yazılmaz.
    let once = z.agac();
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), "20261010-130000")), cikis::DUR);
    assert_eq!(z.agac(), once);

    // Geri al: KURU planı + onay, sonra eski düzen geri gelir.
    let n = z.gunluk(D1).iter().filter(|v| v["tur"] == "GERI").count();
    z.yazilan.lock().unwrap().clear();
    assert_eq!(z.kos(kurulum::gecis_geri_al, &z.secenek(false, None, D1)), cikis::TAMAM);
    assert!(z.cikti().contains(&format!("--onay {n}")), "{}", z.cikti());
    assert_eq!(z.agac(), once, "geri-al KURU yazdı");
    assert_eq!(z.kos(kurulum::gecis_geri_al, &z.secenek(true, Some(n), D1)), cikis::TAMAM, "{}", z.cikti());
    for f in ["docker-compose.yml", ".env", "docker-compose.override.yml"] {
        assert!(z.kok.join(f).is_file(), "{f} yerine dönmedi");
    }
    assert_eq!(std::fs::read(z.kok.join(".env")).unwrap(), eski_env);
    for p in [l.current(), l.backend_env(), duzen::yerel_compose(&l), l.version_dir(NEW), asil, l.settings_file()] {
        assert!(std::fs::symlink_metadata(&p).is_err(), "{} kaldı", p.display());
    }
    assert!(!z.konak.birim_var("tekserp-guncelleyici"));
    assert_eq!(z.docker.kurulu(), Kurulu::Eski, "eski compose ile yeniden kalkmalı");
    let son = z.docker.uplar().last().cloned().unwrap();
    assert_eq!(duzen::compose_basi_coz(&son).unwrap().0[0], z.kok.join("docker-compose.yml").to_str().unwrap());
    assert_eq!(sonuc(&z.gunluk(D1)).as_deref(), Some("GERI_ALINDI"));
    // Geri alınan dosyalar silinmedi, geri-alinan/'e taşındı.
    assert!(std::fs::read_dir(z.kok.join("gecis").join(D1).join("geri-alinan")).unwrap().count() >= 5);
    // Hiçbir yol birim/imaj silmedi.
    assert!(z.docker.calls.lock().unwrap().iter().all(|a| !(a.contains(&"rm".to_string()) && a.contains(&"volume".to_string()))));
}

#[test]
fn gecis_saglik_duserse_kendiliginden_geri() {
    let z = Duzen::elle("saglik");
    let once = z.agac();
    z.docker.yeni_bozuk.store(true, Ordering::SeqCst);
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), D1)), cikis::GERI_ALINDI, "{}", z.cikti());
    let l = z.layout();
    for f in ["docker-compose.yml", ".env", "docker-compose.override.yml"] {
        assert!(z.kok.join(f).is_file(), "{f} yerinde değil");
    }
    for p in [l.current(), l.backend_env(), l.version_dir(NEW), l.settings_file()] {
        assert!(std::fs::symlink_metadata(&p).is_err(), "{} kaldı", p.display());
    }
    assert_eq!(z.docker.kurulu(), Kurulu::Eski, "eski compose ile up");
    assert!(!z.konak.birim_var("tekserp-guncelleyici"), "birim kurulmamalıydı");
    assert_eq!(sonuc(&z.gunluk(D1)).as_deref(), Some("GERI_ALINDI"));
    // Kökte yalnız geçiş günlüğü dizini eklendi; veri kökünde yaratılan dizinler boşsa kaldırıldı.
    let sonra: BTreeMap<String, String> =
        z.agac().into_iter().filter(|(k, _)| !k.starts_with(z.kok.join("gecis").to_str().unwrap())).collect();
    assert_eq!(sonra, once.into_iter().filter(|(k, _)| !k.starts_with(z.kok.join("gecis").to_str().unwrap())).collect());
    // Yeni geçiş engellenmez (son geçiş GERİ ALINDI, yarım değil).
    z.docker.yeni_bozuk.store(false, Ordering::SeqCst);
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), "20261010-140000")), cikis::TAMAM, "{}", z.cikti());
}

#[test]
fn gecis_guncelleyici_baslamazsa_geri() {
    let z = Duzen::elle("birim");
    z.konak.baslatma_duser.store(true, Ordering::SeqCst);
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), D1)), cikis::GERI_ALINDI, "{}", z.cikti());
    assert!(!z.konak.birim_var("tekserp-guncelleyici"), "kurulan birim kaldırılmalı");
    assert!(z.kok.join(".env").is_file() && z.kok.join("docker-compose.yml").is_file());
    assert_eq!(z.docker.kurulu(), Kurulu::Eski);
}

#[test]
fn gecis_geri_al_guncelleyici_islem_yaptiysa_dur() {
    let z = Duzen::elle("islem");
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), D1)), cikis::TAMAM, "{}", z.cikti());
    let l = z.layout();
    std::fs::write(l.journal_file(), "{\"t\":\"ISLEM\"}\n").unwrap();
    let once = z.agac();
    assert_eq!(z.kos(kurulum::gecis_geri_al, &z.secenek(true, Some(99), D1)), cikis::DUR);
    assert!(z.cikti().contains("güncelleyici işlem yaptı"), "{}", z.cikti());
    assert_eq!(z.agac(), once);
}

#[test]
fn gecis_on_kosullar_dur() {
    // Birim yok (proje adı/kurulum beklenen değil).
    let z = Duzen::elle("birimyok");
    z.docker.birimler.lock().unwrap().remove(&format!("{PROJE}_lisans"));
    let once = z.agac();
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), D1)), cikis::DUR);
    assert!(z.cikti().contains("prova_lisans"), "{}", z.cikti());
    assert_eq!(z.agac(), once);
    // Elle kurulumun imajı başka sürüm.
    let z = Duzen::elle("surum");
    std::fs::write(z.kok.join(".env"), format!("TEKSERP_PROJE={PROJE}\nTEKSERP_IMAJ=tekserp-korumali:{OLD}\nPOSTGRES_PASSWORD=x\n"))
        .unwrap();
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), D1)), cikis::DUR);
    assert!(z.cikti().contains("aynı sürümün paketi"), "{}", z.cikti());
    // Kök root değilken uygulanmaz.
    let mut z = Duzen::elle("root");
    z.konak.root = false;
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), D1)), cikis::DUR);
    assert!(z.docker.yazanlar().is_empty());
}

#[test]
fn gecis_yabanci_imaj_geri_alinir_etikete_dokunulmaz() {
    let z = Duzen::elle("yabanci");
    z.docker
        .imajlar
        .lock()
        .unwrap()
        .insert(format!("tekserp-korumali:{NEW}"), ("sha256:yabanci".into(), vec![format!("sha256:{}", "a".repeat(64))]));
    let once = z.docker.imajlar.lock().unwrap().clone();
    assert_eq!(z.kos(kurulum::gecis, &z.secenek(true, Some(N), D1)), cikis::GERI_ALINDI, "{}", z.cikti());
    assert!(z.cikti().contains("IMAJ_KIMLIGI"), "{}", z.cikti());
    assert_eq!(*z.docker.imajlar.lock().unwrap(), once);
    assert_eq!(z.docker.loads.load(Ordering::SeqCst), 0);
    assert!(z.docker.uplar().is_empty(), "imaj tutmadan hiçbir şey kaldırılmaz");
}

#[test]
fn kur_tekrarlanabilir() {
    let z = Duzen::new("kur", Kurulu::Yok);
    let l = z.layout();
    // Önkoşul yok ⇒ DUR.
    assert_eq!(z.kos(kurulum::kur, &z.secenek(true, None, D1)), cikis::DUR);
    std::fs::create_dir_all(z.kok.join("yapilandirma")).unwrap();
    std::fs::write(l.backend_env(), "POSTGRES_PASSWORD=gizli\n").unwrap();
    let once = z.agac();
    assert_eq!(z.kos(kurulum::kur, &z.secenek(false, None, D1)), cikis::TAMAM, "{}", z.cikti());
    assert_eq!(z.agac(), once, "KURU yazdı");
    assert!(z.docker.yazanlar().is_empty());
    assert_eq!(z.kos(kurulum::kur, &z.secenek(true, None, D1)), cikis::TAMAM, "{}", z.cikti());
    assert_eq!(z.docker.loads.load(Ordering::SeqCst), 1, "etiket yoktu: güncelleyicinin işleviyle yüklenir");
    assert!(imaj::kayit_oku(&tekserp_guncelleyici::env::RealFs, &l, NEW).is_some());
    assert_eq!(std::fs::read_link(l.current()).unwrap(), l.version_dir(NEW));
    assert!(z.konak.birim_etkin("tekserp-guncelleyici"));
    let goc = z.docker.calls.lock().unwrap().iter().any(|a| alt(a).first().is_some_and(|s| s == "run") && a.contains(&"goc".to_string()));
    assert!(goc, "ilk göç koşmadı");
    // İkinci koşum: yapılacak bir şey yok.
    let yazan = z.docker.yazanlar().len();
    let olay = z.konak.olaylar.lock().unwrap().len();
    let agac = z.agac();
    z.yazilan.lock().unwrap().clear();
    assert_eq!(z.kos(kurulum::kur, &z.secenek(true, None, D1)), cikis::TAMAM);
    assert!(z.cikti().contains("yapılacak bir şey yok"), "{}", z.cikti());
    assert_eq!(z.docker.yazanlar().len(), yazan);
    assert_eq!(z.konak.olaylar.lock().unwrap().len(), olay);
    assert_eq!(z.agac(), agac);
}

#[test]
fn pg_imaji_sabiti_sablonla_ayni() {
    let sablon =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docker/korumali/docker-compose.guncelleyici.yml"))
            .unwrap();
    assert!(
        sablon.contains(&format!("${{TEKSERP_PG_IMAJ:-{}}}", kurulum::VARSAYILAN_PG_IMAJI)),
        "şablonun PG varsayılanı sabitle aynı değil"
    );
}
