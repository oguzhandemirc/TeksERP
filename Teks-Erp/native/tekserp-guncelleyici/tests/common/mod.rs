//! Sahte dünya: gerçek dosya sistemi (geçici dizin) + sahte hizmet/süreç/ağ/saat/DB + "süreç burada
//! öldü" enjeksiyonu. Enjeksiyon PANİKLE yapılır (`Killed`): hata yakalama kodundan geçemez, tıpkı
//! elektrik kesintisi gibi o anda her şeyi keser. Yeniden başlatma = aynı dünyada YENİ bir motor.
#![allow(dead_code)]

use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tekserp_dogrulama::b64;
use tekserp_dogrulama::chain::RootKey;
use tekserp_guncelleyici::engine::{Engine, TickResult};
use tekserp_guncelleyici::env::{
    Clock, Cmd, CmdOut, Env, EnvError, EnvResult, Events, Fs, HttpResponse, Net, Procs, Protect, ReadSeek, RealFs, Services, SvcState,
    SyncWrite,
};
use tekserp_guncelleyici::ipc::{self, State, StatusDoc};
use tekserp_guncelleyici::journal::Journal;
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::package::{ExtractLimits, ExtractStats};
use tekserp_guncelleyici::trust::TrustAnchor;
use tekserp_hizmet::logfile::{Level, RotatingLog};

pub const CHANNEL: &str = "testkanal";
pub const OLD: &str = "2.12.0";
pub const NEW: &str = "2.13.0";
pub const BACKEND: &str = "TeksERP-Backend";
pub const PG: &str = "TeksERP-PostgreSQL";
/// Sabit test saati: 2026-09-30T23:30:00Z (İstanbul 02:30).
pub const T0: i64 = 1_790_811_000_000;

/// Enjekte edilen ölüm (panik yükü).
#[derive(Debug)]
pub struct Killed;

#[derive(Default)]
pub struct Crash {
    pub count: AtomicU64,
    pub at: AtomicU64,
    pub torn: AtomicBool,
    pub log: Mutex<Vec<String>>,
}

impl Crash {
    /// Değiştiren her çağrıdan ÖNCE: sayaç enjeksiyon noktasına gelince süreç "ölür".
    pub fn point(&self, what: &str) {
        let n = self.count.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut l) = self.log.lock() {
            l.push(format!("{n}:{what}"));
        }
        if self.at.load(Ordering::SeqCst) == n {
            std::panic::panic_any(Killed);
        }
    }
    pub fn arm(&self, at: u64, torn: bool) {
        self.count.store(0, Ordering::SeqCst);
        self.at.store(at, Ordering::SeqCst);
        self.torn.store(torn, Ordering::SeqCst);
        self.log.lock().unwrap().clear();
    }
    pub fn disarm(&self) {
        self.arm(0, false);
    }
    pub fn hit(&self) -> bool {
        let at = self.at.load(Ordering::SeqCst);
        at != 0 && self.count.load(Ordering::SeqCst) >= at
    }
}

/// Gerçek dosya sistemi + enjeksiyon.
pub struct CrashFs {
    pub inner: RealFs,
    pub crash: Arc<Crash>,
    pub free: AtomicU64,
}

impl Fs for CrashFs {
    fn read(&self, p: &Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(p)
    }
    fn read_untrusted(&self, p: &Path, max: u64) -> std::io::Result<Vec<u8>> {
        self.inner.read_untrusted(p, max)
    }
    fn is_link(&self, p: &Path) -> bool {
        self.inner.is_link(p)
    }
    fn write_atomic(&self, p: &Path, data: &[u8]) -> std::io::Result<()> {
        self.crash.point(&format!("yaz {}", name(p)));
        self.inner.write_atomic(p, data)
    }
    fn append_sync(&self, p: &Path, line: &[u8]) -> std::io::Result<()> {
        let n = self.crash.count.load(Ordering::SeqCst) + 1;
        if self.crash.torn.load(Ordering::SeqCst) && self.crash.at.load(Ordering::SeqCst) == n {
            // Yırtık yazım: satırın yarısı diske iner, sonra süreç ölür.
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p)?;
            f.write_all(&line[..line.len() / 2])?;
        }
        self.crash.point(&format!("ekle {}", name(p)));
        self.inner.append_sync(p, line)
    }
    fn exists(&self, p: &Path) -> bool {
        self.inner.exists(p)
    }
    fn is_dir(&self, p: &Path) -> bool {
        self.inner.is_dir(p)
    }
    fn create_dir_all(&self, p: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("dizin {}", name(p)));
        self.inner.create_dir_all(p)
    }
    fn remove_file(&self, p: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("sil {}", name(p)));
        self.inner.remove_file(p)
    }
    fn remove_dir_all(&self, p: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("dizinsil {}", name(p)));
        self.inner.remove_dir_all(p)
    }
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("adlandir {}→{}", name(from), name(to)));
        self.inner.rename(from, to)
    }
    fn list(&self, p: &Path) -> std::io::Result<Vec<String>> {
        self.inner.list(p)
    }
    fn link_target(&self, link: &Path) -> std::io::Result<Option<PathBuf>> {
        self.inner.link_target(link)
    }
    fn set_link(&self, link: &Path, target: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("baglanti {}→{}", name(link), name(target)));
        self.inner.set_link(link, target)
    }
    fn free_space(&self, _p: &Path) -> std::io::Result<u64> {
        Ok(self.free.load(Ordering::SeqCst))
    }
    fn file_len(&self, p: &Path) -> std::io::Result<u64> {
        self.inner.file_len(p)
    }
    fn open_read(&self, p: &Path) -> std::io::Result<Box<dyn ReadSeek>> {
        self.inner.open_read(p)
    }
    fn open_append(&self, p: &Path) -> std::io::Result<Box<dyn SyncWrite>> {
        self.crash.point(&format!("acekle {}", name(p)));
        self.inner.open_append(p)
    }
    fn copy(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("kopyala {}", name(from)));
        self.inner.copy(from, to)
    }
    fn extract_zip(&self, archive: &Path, dest: &Path, limits: &ExtractLimits) -> Result<ExtractStats, String> {
        self.crash.point(&format!("ac {}", name(archive)));
        self.inner.extract_zip(archive, dest, limits)
    }
}

pub fn name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// DB modeli: bitmiş/toplam göç satırı + "veri" (istemci yazısı sayacı).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Db {
    pub finished: u64,
    pub total: u64,
    pub data: u64,
}

#[derive(Default)]
pub struct Faults {
    /// Bu sürüm çalışırken /health `status: DOWN`.
    pub unhealthy_version: Mutex<Option<String>>,
    /// Bu sürüm çalışırken lisans bütünlüğü GEÇERSİZ.
    pub license_broken_version: Mutex<Option<String>>,
    /// `migrate deploy` yarıda düşer (bir göç başlar, biter değil).
    pub migrate_fails: AtomicBool,
    /// ImagePath bu parçayı taşırken (ör. yeni PG dizini) sunucu yanlış sürüm bildirir.
    pub pg_wrong_for: Mutex<Option<String>>,
    /// ImagePath bu parçayı taşırken ICU yeniden dizinlemesi düşer.
    pub reindex_fail_for: Mutex<Option<String>>,
    /// Ağ yanıtı bu kadar bayttan sonra kesilir (0 = kesilmez).
    pub cut_after: AtomicU64,
    /// Paket yerine bozuk bayt sunulur.
    pub serve_tampered: AtomicBool,
}

#[derive(Debug, Clone)]
pub struct Svc {
    pub state: SvcState,
    pub args: Vec<String>,
    pub version: Option<String>,
    pub image: String,
    pub starts: u64,
}

pub struct World {
    pub dir: PathBuf,
    pub layout: Layout,
    pub crash: Arc<Crash>,
    pub fs: Arc<CrashFs>,
    pub db: Arc<Mutex<Db>>,
    pub svcs: Arc<Mutex<HashMap<String, Svc>>>,
    pub faults: Arc<Faults>,
    pub files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub clock: Arc<AtomicI64>,
    pub events: Arc<Mutex<Vec<String>>>,
    pub keys: Keys,
    pub anchor: TrustAnchor,
}

pub struct Keys {
    pub root: SigningKey,
    pub alt: SigningKey,
    pub package: SigningKey,
    pub staging: SigningKey,
}

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

pub fn x_of(k: &SigningKey) -> String {
    b64::encode(k.verifying_key().as_bytes())
}

pub fn sign(k: &SigningKey, typ: &str, kid: &str, payload: &Value) -> String {
    let h = b64::encode(json!({ "alg": "EdDSA", "typ": typ, "kid": kid }).to_string().as_bytes());
    let p = b64::encode(payload.to_string().as_bytes());
    let s = k.sign(format!("{h}.{p}").as_bytes());
    format!("{h}.{p}.{}", b64::encode(&s.to_bytes()))
}

pub fn sha_b64u(b: &[u8]) -> String {
    b64::encode(&Sha256::digest(b))
}

fn iso(ms: i64) -> String {
    tekserp_hizmet::timefmt::iso_seconds(ms)
}

pub fn migrations_of(v: &str) -> u64 {
    match v {
        OLD => 2,
        NEW => 4,
        _ => 5,
    }
}

// ── Sahte hizmet/süreç/ağ/saat ────────────────────────────────────────────────────────────────

pub struct FakeServices {
    pub w: WorldRefs,
}

#[derive(Clone)]
pub struct WorldRefs {
    pub root: PathBuf,
    pub crash: Arc<Crash>,
    pub db: Arc<Mutex<Db>>,
    pub svcs: Arc<Mutex<HashMap<String, Svc>>>,
    pub faults: Arc<Faults>,
    pub files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub clock: Arc<AtomicI64>,
    pub events: Arc<Mutex<Vec<String>>>,
}

fn current_version(root: &Path) -> Option<String> {
    RealFs.link_target(&root.join("current")).ok().flatten().and_then(|t| t.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/// ImagePath → `pgsql<ayraç><surum>-<derleme>` → sunucu sürümü (`16.15`).
fn pg_version_of_image(image: &str) -> Option<String> {
    let norm = image.replace('\\', "/");
    let i = norm.find("pgsql/")? + 6;
    let tag = norm[i..].split('/').next()?;
    Some(tag.split('-').next()?.to_string())
}

impl Services for FakeServices {
    fn state(&self, name: &str) -> EnvResult<SvcState> {
        Ok(self.w.svcs.lock().unwrap().get(name).map_or(SvcState::Missing, |s| s.state))
    }
    fn start(&self, name: &str, args: &[&str]) -> EnvResult<()> {
        self.w.crash.point(&format!("baslat {name}"));
        let mut svcs = self.w.svcs.lock().unwrap();
        let Some(s) = svcs.get_mut(name) else { return Err(EnvError(format!("{name} yok"))) };
        if s.state == SvcState::Running {
            return Ok(());
        }
        s.state = SvcState::Running;
        s.args = args.iter().map(|a| a.to_string()).collect();
        s.starts += 1;
        s.version = if name == BACKEND { current_version(&self.w.root) } else { pg_version_of_image(&s.image) };
        Ok(())
    }
    fn stop(&self, name: &str) -> EnvResult<()> {
        self.w.crash.point(&format!("durdur {name}"));
        let mut svcs = self.w.svcs.lock().unwrap();
        let Some(s) = svcs.get_mut(name) else { return Err(EnvError(format!("{name} yok"))) };
        s.state = SvcState::Stopped;
        s.args.clear();
        Ok(())
    }
    fn image_path(&self, name: &str) -> EnvResult<String> {
        self.w.svcs.lock().unwrap().get(name).map(|s| s.image.clone()).ok_or_else(|| EnvError(format!("{name} yok")))
    }
    fn set_image_path(&self, name: &str, cl: &str) -> EnvResult<()> {
        self.w.crash.point(&format!("yol {name}"));
        let mut svcs = self.w.svcs.lock().unwrap();
        let s = svcs.get_mut(name).ok_or_else(|| EnvError(format!("{name} yok")))?;
        s.image = cl.to_string();
        Ok(())
    }
}

pub struct FakeProcs {
    pub w: WorldRefs,
}

fn arg_after(c: &Cmd, flag: &str) -> Option<PathBuf> {
    c.args.iter().position(|a| a == flag).and_then(|i| c.args.get(i + 1)).map(PathBuf::from)
}

fn ok_out(stdout: &str) -> CmdOut {
    CmdOut { code: Some(0), stdout: stdout.as_bytes().to_vec(), stderr: vec![], timed_out: false }
}

fn fail_out(code: i32, stderr: &str) -> CmdOut {
    CmdOut { code: Some(code), stdout: vec![], stderr: stderr.as_bytes().to_vec(), timed_out: false }
}

impl Procs for FakeProcs {
    fn run(&self, c: &Cmd) -> EnvResult<CmdOut> {
        let prog = c.program_name();
        let args: Vec<String> = c.args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        self.w.crash.point(&format!("surec {prog} {}", args.first().cloned().unwrap_or_default()));
        let pw_ok = c.env.iter().any(|(k, v)| k == "PGPASSWORD" && v == "gizli-parola");
        match prog.as_str() {
            "psql" => {
                if !pw_ok {
                    return Ok(fail_out(2, "psql: error: password authentication failed"));
                }
                let pg_running = self.w.svcs.lock().unwrap().get(PG).is_some_and(|s| s.state == SvcState::Running);
                if !pg_running {
                    return Ok(fail_out(2, "psql: error: connection refused"));
                }
                let sql = args.last().cloned().unwrap_or_default();
                if sql.contains("_prisma_migrations") {
                    let d = self.w.db.lock().unwrap();
                    return Ok(ok_out(&format!("{} {}\n", d.finished, d.total)));
                }
                if sql.contains("SHOW server_version") {
                    let svcs = self.w.svcs.lock().unwrap();
                    let pg = svcs.get(PG).cloned();
                    let v = pg.as_ref().and_then(|s| s.version.clone()).unwrap_or_default();
                    let wrong = self.w.faults.pg_wrong_for.lock().unwrap().clone();
                    let v = if wrong.is_some_and(|t| pg.is_some_and(|p| p.image.contains(&t))) { "99.9".to_string() } else { v };
                    return Ok(ok_out(&format!("{v} (fake)\n")));
                }
                if sql.contains("DROP SCHEMA") {
                    *self.w.db.lock().unwrap() = Db { finished: 0, total: 0, data: 0 };
                    return Ok(ok_out("CREATE SCHEMA\n"));
                }
                if sql.contains("REINDEX") {
                    let image = self.w.svcs.lock().unwrap().get(PG).map(|p| p.image.clone()).unwrap_or_default();
                    if self.w.faults.reindex_fail_for.lock().unwrap().as_ref().is_some_and(|t| image.contains(t.as_str())) {
                        return Ok(fail_out(1, "psql: ERROR: could not create unique index"));
                    }
                    self.w.events.lock().unwrap().push("reindex".into());
                    return Ok(ok_out("DO\n"));
                }
                Ok(fail_out(1, "bilinmeyen sql"))
            }
            "pg_dump" => {
                if !pw_ok {
                    return Ok(fail_out(1, "auth"));
                }
                let out = arg_after(c, "-f").expect("-f");
                let d = self.w.db.lock().unwrap().clone();
                std::fs::write(&out, serde_json::to_vec(&d).unwrap()).unwrap();
                Ok(ok_out(""))
            }
            "pg_restore" => {
                let file = PathBuf::from(args.last().cloned().unwrap_or_default());
                let Ok(bytes) = std::fs::read(&file) else { return Ok(fail_out(1, "pg_restore: error: dosya yok")) };
                let Ok(d) = serde_json::from_slice::<Db>(&bytes) else { return Ok(fail_out(1, "pg_restore: error: arşiv değil")) };
                if args.iter().any(|a| a == "--list") {
                    return Ok(ok_out(";\n; Archive created\n"));
                }
                *self.w.db.lock().unwrap() = d;
                Ok(ok_out(""))
            }
            "postgres" => {
                let marker = c.program.parent().unwrap().join("SURUM");
                let v = std::fs::read_to_string(marker).unwrap_or_default();
                Ok(ok_out(&format!("postgres (PostgreSQL) {}\n", v.trim())))
            }
            "node" => {
                let script = args.first().cloned().unwrap_or_default();
                if script.ends_with("yedek-sifrele.cjs") {
                    return Ok(match args.get(1).map(String::as_str) {
                        Some("anahtar-uret") => {
                            let dir = arg_after(c, "--dizin").expect("--dizin");
                            let private = arg_after(c, "--ozel-cikti").expect("--ozel-cikti");
                            std::fs::write(dir.join("guncelleme.tkpub"), "tkpub1:PUB\n").unwrap();
                            std::fs::write(private, "tksec1:SECRET\n").unwrap();
                            ok_out("")
                        }
                        Some("sifrele") => {
                            let input = std::fs::read(arg_after(c, "--girdi").unwrap()).unwrap();
                            let recipients = args.iter().filter(|a| *a == "--alici").count();
                            let mut enc = format!("ENC{recipients}:").into_bytes();
                            enc.extend(input);
                            std::fs::write(arg_after(c, "--cikti").unwrap(), enc).unwrap();
                            ok_out("")
                        }
                        Some("coz") => {
                            let k = std::fs::read_to_string(arg_after(c, "--anahtar").unwrap()).unwrap_or_default();
                            if !k.starts_with("tksec1:SECRET") {
                                return Ok(fail_out(2, "yanlis anahtar"));
                            }
                            let enc = std::fs::read(arg_after(c, "--girdi").unwrap()).unwrap();
                            let at = enc.iter().position(|b| *b == b':').unwrap() + 1;
                            std::fs::write(arg_after(c, "--cikti").unwrap(), &enc[at..]).unwrap();
                            ok_out("")
                        }
                        _ => fail_out(1, "kullanim"),
                    });
                }
                if script.ends_with("index.js") && args.get(1).map(String::as_str) == Some("migrate") {
                    let cwd = c.cwd.clone().expect("cwd");
                    let n = std::fs::read_dir(cwd.join("prisma").join("migrations")).map(|r| r.count() as u64).unwrap_or(0);
                    let mut d = self.w.db.lock().unwrap();
                    if self.w.faults.migrate_fails.load(Ordering::SeqCst) {
                        d.finished += 1;
                        d.total = d.finished + 1;
                        return Ok(fail_out(1, "Error: P3018 migration failed postgresql://tekserp:gizli-parola@127.0.0.1:5432/db"));
                    }
                    d.finished = n;
                    d.total = n;
                    return Ok(ok_out("All migrations have been successfully applied."));
                }
                Ok(fail_out(1, "bilinmeyen betik"))
            }
            "tekserp-guncelleyici" | "tekserp-guncelleyici.yeni" => {
                let text = std::fs::read_to_string(&c.program).unwrap_or_default();
                Ok(ok_out(&text))
            }
            other => Ok(fail_out(127, &format!("bilinmeyen program {other}"))),
        }
    }
}

pub struct FakeNet {
    pub w: WorldRefs,
}

fn resp(status: u16, headers: Vec<(String, String)>, body: Vec<u8>) -> HttpResponse {
    HttpResponse { status, headers, body: Box::new(Cursor::new(body)) }
}

/// Belirli bayttan sonra kesilen akış (bağlantı koptu).
struct CutReader {
    inner: Cursor<Vec<u8>>,
    left: u64,
}

impl Read for CutReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.left == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::ConnectionReset, "bağlantı koptu"));
        }
        let n = buf.len().min(self.left as usize);
        let got = self.inner.read(&mut buf[..n])?;
        self.left -= got as u64;
        Ok(got)
    }
}

impl Net for FakeNet {
    fn get(&self, url: &str, headers: &[(String, String)], _timeout: Duration) -> EnvResult<HttpResponse> {
        if let Some(port) = url.strip_prefix("http://127.0.0.1:").and_then(|r| r.strip_suffix("/health")) {
            assert_eq!(port, "4999");
            let svcs = self.w.svcs.lock().unwrap();
            let Some(b) = svcs.get(BACKEND).filter(|s| s.state == SvcState::Running) else {
                return Err(EnvError("bağlantı reddedildi".into()));
            };
            let v = b.version.clone().unwrap_or_default();
            let down = self.w.faults.unhealthy_version.lock().unwrap().as_deref() == Some(v.as_str());
            let broken = self.w.faults.license_broken_version.lock().unwrap().as_deref() == Some(v.as_str());
            let body = json!({
                "status": if down { "DOWN" } else { "UP" },
                "db": "UP",
                "version": v,
                "lisans": { "kip": "NORMAL", "butunluk": if broken { "GECERSIZ" } else { "GECERLI" }, "cekirdek": "native" },
            });
            return Ok(resp(200, vec![], body.to_string().into_bytes()));
        }
        self.w.crash.point(&format!("ag {url}"));
        let path = url.strip_prefix("https://guncelleme.test").ok_or_else(|| EnvError(format!("bilinmeyen sunucu {url}")))?;
        let token = headers.iter().find(|(k, _)| k == "X-TKL-Indirme").map(|(_, v)| v.clone());
        if token.as_deref() != Some("belirtec.test.imza") {
            return Ok(resp(403, vec![("X-TKL-Kod".into(), "INDIRME_BELIRTEC_YOK".into())], vec![]));
        }
        let Some(mut body) = self.w.files.lock().unwrap().get(path).cloned() else {
            return Ok(resp(404, vec![], vec![]));
        };
        if self.w.faults.serve_tampered.load(Ordering::SeqCst) && path.ends_with(".zip") {
            let n = body.len();
            body[n / 2] ^= 0xff;
        }
        let total = body.len() as u64;
        let from = headers
            .iter()
            .find(|(k, _)| k == "Range")
            .and_then(|(_, v)| v.strip_prefix("bytes="))
            .and_then(|r| r.trim_end_matches('-').parse::<u64>().ok())
            .unwrap_or(0);
        let (status, part, mut hs) = if from > 0 {
            (206, body[from as usize..].to_vec(), vec![("Content-Range".to_string(), format!("bytes {from}-{}/{total}", total - 1))])
        } else {
            (200, body, vec![])
        };
        hs.push(("Content-Length".into(), part.len().to_string()));
        let cut = if path.ends_with(".zip") { self.w.faults.cut_after.swap(0, Ordering::SeqCst) } else { 0 };
        if cut > 0 {
            return Ok(HttpResponse { status, headers: hs, body: Box::new(CutReader { inner: Cursor::new(part), left: cut }) });
        }
        Ok(resp(status, hs, part))
    }
}

pub struct FakeClock(pub Arc<AtomicI64>);
impl Clock for FakeClock {
    fn now_ms(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
    fn sleep(&self, d: Duration) {
        self.0.fetch_add(i64::try_from(d.as_millis()).unwrap(), Ordering::SeqCst);
    }
}

pub struct FakeEvents(pub Arc<Mutex<Vec<String>>>);
impl Events for FakeEvents {
    fn event(&self, level: Level, message: &str) {
        self.0.lock().unwrap().push(format!("{}: {message}", level.label()));
    }
}

pub struct FakeProtect;
impl Protect for FakeProtect {
    fn protect(&self, data: &[u8]) -> EnvResult<Vec<u8>> {
        let mut v = b"DPAPI:".to_vec();
        v.extend_from_slice(data);
        Ok(v)
    }
    fn unprotect(&self, data: &[u8]) -> EnvResult<Vec<u8>> {
        data.strip_prefix(b"DPAPI:").map(<[u8]>::to_vec).ok_or_else(|| EnvError("DPAPI: bozuk".into()))
    }
}

// ── Paket ve belgeler ─────────────────────────────────────────────────────────────────────────

/// Sürüm dizininin dosyaları (göreli yol → içerik).
pub fn version_files(v: &str) -> Vec<(String, Vec<u8>)> {
    let mut out: Vec<(String, Vec<u8>)> = vec![
        ("package.json".into(), json!({ "name": "tekserp", "version": v }).to_string().into_bytes()),
        ("PAKET.json".into(), json!({ "commit": "abcdef1234" }).to_string().into_bytes()),
        ("dist/server.js".into(), format!("// sunucu {v}").into_bytes()),
        // Sıkışmayan 96 KB: indirme parçalı gelsin (kesilme/devam ölçümü).
        ("dist/buyuk.bin".into(), (0..96 * 1024u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8).collect()),
        ("dist/tools/yedek-sifrele.cjs".into(), b"// yedek araci".to_vec()),
        ("runtime/node".into(), b"#!fake node".to_vec()),
        ("node_modules/prisma/build/index.js".into(), b"// prisma".to_vec()),
    ];
    for i in 1..=migrations_of(v) {
        out.push((format!("prisma/migrations/{i:04}_goc/migration.sql"), format!("-- {i}").into_bytes()));
    }
    out
}

/// Bütünlük listesi + PAKET imzalı `butunluk.jws` (kapsam: dist · runtime · node_modules · prisma/migrations · package.json).
pub fn integrity_files(
    files: &[(String, Vec<u8>)],
    v: &str,
    signer: &SigningKey,
    kid: &str,
    customer: Option<&str>,
) -> Vec<(String, Vec<u8>)> {
    let mut scoped: Vec<&(String, Vec<u8>)> = files
        .iter()
        .filter(|(p, _)| {
            ["dist/", "runtime/", "node_modules/", "prisma/migrations/"].iter().any(|d| p.starts_with(d)) || p == "package.json"
        })
        .collect();
    scoped.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut list = String::new();
    for (p, c) in &scoped {
        list.push_str(&format!("{}\t{}\t{}\n", sha_b64u(c), c.len(), p));
    }
    let payload = json!({
        "v": 1,
        "paketId": "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
        "urun": "backend",
        "surum": v,
        "derlemeTarihi": "2026-09-30T00:00:00Z",
        "musteri": customer,
        "liste": { "sha256": sha_b64u(list.as_bytes()), "boyut": list.len(), "dosyaSayisi": scoped.len() },
        "kapsam": { "dizinler": ["dist", "node_modules", "prisma/migrations", "runtime"], "dosyalar": ["package.json"] },
    });
    vec![
        ("butunluk-liste.txt".into(), list.into_bytes()),
        ("butunluk.jws".into(), sign(signer, "tekserp-butunluk", kid, &payload).into_bytes()),
    ]
}

pub fn zip_of(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (p, c) in files {
            z.start_file(p.as_str(), opts).unwrap();
            z.write_all(c).unwrap();
        }
        z.finish().unwrap();
    }
    buf.into_inner()
}

pub struct LeaseOpts {
    pub update: Option<Value>,
    pub frozen_by_sanction: bool,
    pub channel_backend: Option<&'static str>,
    pub class: &'static str,
    pub expired: bool,
}

impl Default for LeaseOpts {
    fn default() -> Self {
        LeaseOpts {
            update: Some(json!({ "kip": "OTOMATIK" })),
            frozen_by_sanction: false,
            channel_backend: Some(NEW),
            class: "URETIM",
            expired: false,
        }
    }
}

const HAK_ID: &str = "11111111-1111-4111-8111-111111111111";
const KURULUM_ID: &str = "22222222-2222-4222-8222-222222222222";

pub fn lease_and_entitlement(k: &Keys, o: &LeaseOpts, now: i64) -> (String, String) {
    let day = 86_400_000;
    let cert = sign(
        &k.root,
        "tekserp-sertifika",
        "kok-test-1",
        &json!({
            "v": 1, "sertifikaId": "33333333-3333-4333-8333-333333333333", "kullanim": "ALT", "kid": "alt-test-1",
            "x": x_of(&k.alt), "siniflar": ["URETIM", "TEST"], "baslangic": iso(now - 400 * day), "bitis": iso(now + 400 * day), "bayi": null,
        }),
    );
    let issued = if o.expired { now - 44 * day } else { now - day };
    let mut lease = json!({
        "v": 1, "kiraId": "44444444-4444-4444-8444-444444444444", "hakId": HAK_ID, "hakSurum": 1, "kurulumId": KURULUM_ID,
        "kurulumAnahtarKimligi": format!("kur-{}", "A".repeat(43)),
        "parmakIzi": { "f1": null, "f2": null, "f3": null, "f4": null, "f5": null },
        "verilis": iso(issued), "bitis": iso(issued + 30 * day), "sunucuSaati": iso(issued), "ekSureGun": if o.expired { 0 } else { 30 },
        "zorlama": false, "gecerlilikBitis": null,
        "yaptirim": { "kademe": null, "mesaj": null, "kisitlamaTarihi": null, "donmusModuller": [], "guncellemeDonuk": o.frozen_by_sanction },
        "yoklamaAraligiDk": 60, "esitlemeAraligiDk": null, "patronBulutBitis": null, "devredildi": false,
        "kanal": { "kod": CHANNEL, "guncelSurumler": match o.channel_backend { Some(v) => json!({ "backend": v }), None => json!({}) } },
        "altSertifika": cert,
    });
    if let Some(u) = &o.update {
        lease["guncelleme"] = u.clone();
    }
    let hak = json!({
        "v": 1, "hakId": HAK_ID, "surum": 1, "lisansNo": "TKS-2026-0001",
        "musteri": { "id": "55555555-5555-4555-8555-555555555555", "ad": "Test" },
        "tesis": { "id": "66666666-6666-4666-8666-666666666666", "ad": "Test tesis" },
        "kurulumId": KURULUM_ID, "sinif": o.class, "moduller": [], "kalici": true,
        "bakimBitis": iso(now + 365 * day), "verilis": iso(now - 10 * day),
    });
    (sign(&k.alt, "tekserp-kira", "alt-test-1", &lease), sign(&k.root, "tekserp-hak", "kok-test-1", &hak))
}

pub fn manifest_for(k: &SigningKey, kid: &str, v: &str, zip: &[u8], extra: Option<Value>) -> String {
    let mut p = json!({
        "v": 1, "urun": "backend", "kanal": CHANNEL, "surum": v,
        "paket": { "yol": format!("/{CHANNEL}/backend/{v}/paket.zip"), "sha256": sha_b64u(zip), "boyut": zip.len() },
        "enAzKaynakSurum": null, "gocSayisi": migrations_of(v),
    });
    if let Some(Value::Object(e)) = extra {
        for (a, b) in e {
            p[a] = b;
        }
    }
    sign(k, "tekserp-guncelleme", kid, &p)
}

pub fn intent(v: &str, id: &str, approval: Option<Value>) -> Value {
    json!({
        "v": 1, "niyetId": id, "yazildi": iso(T0), "urun": "backend", "surum": v,
        "manifestYolu": format!("/{CHANNEL}/backend/{v}/manifest.jws"),
        "indirme": { "belirtec": "belirtec.test.imza", "bitis": iso(T0 + 3_600_000 * 24 * 30) },
        "saatDilimi": "Europe/Istanbul",
        "onay": approval,
    })
}

// ── Dünya ─────────────────────────────────────────────────────────────────────────────────────

pub struct Setup {
    pub lease: LeaseOpts,
    pub package_signer_staging: bool,
    pub customer: Option<&'static str>,
    pub extra_file_in_scope: bool,
    pub manifest_extra: Option<Value>,
    pub intent: Option<Value>,
}

impl Default for Setup {
    fn default() -> Self {
        Setup {
            lease: LeaseOpts::default(),
            package_signer_staging: false,
            customer: Some(CHANNEL),
            extra_file_in_scope: false,
            manifest_extra: None,
            intent: Some(intent(NEW, "niyet-1", None)),
        }
    }
}

static SEQ: AtomicU64 = AtomicU64::new(0);
static QUIET: std::sync::Once = std::sync::Once::new();

/// Enjekte ölümler (`Killed`) panik çıktısını boğmasın; diğer panikler olduğu gibi basılır.
fn quiet_injected_panics() {
    QUIET.call_once(|| {
        let default = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if !info.payload().is::<Killed>() {
                default(info);
            }
        }));
    });
}

impl World {
    pub fn new(tag: &str, s: Setup) -> World {
        quiet_injected_panics();
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("tekserp-gy-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("kok");
        let data = dir.join("programdata");
        std::fs::create_dir_all(&root).unwrap();
        let layout = Layout::new(&root, &data);
        let keys = Keys { root: key(1), alt: key(2), package: key(3), staging: key(4) };
        let anchor = TrustAnchor {
            roots: vec![RootKey { kid: "kok-test-1".into(), x: x_of(&keys.root), classes: vec!["URETIM".into(), "TEST".into()] }],
            package_keys: vec![("paket-2026".into(), x_of(&keys.package)), ("paket-hazirlik".into(), x_of(&keys.staging))],
        };
        // Kurulu sürüm + current
        for (p, c) in version_files(OLD) {
            let f = layout.version_dir(OLD).join(&p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, c).unwrap();
        }
        RealFs.set_link(&layout.current(), &layout.version_dir(OLD)).unwrap();
        std::fs::create_dir_all(root.join("yapilandirma")).unwrap();
        std::fs::write(
            layout.backend_env(),
            "PORT=4999\nDATABASE_URL=\"postgresql://tekserp:gizli-parola@127.0.0.1:5432/tekserp?schema=public\"\nPG_BIN_DIR=/fake/pgbin\n",
        )
        .unwrap();
        std::fs::create_dir_all(root.join("yedek-anahtar")).unwrap();
        std::fs::write(root.join("yedek-anahtar").join("musteri.tkpub"), "tkpub1:MUSTERI\n").unwrap();
        std::fs::create_dir_all(layout.updater_dir()).unwrap();
        std::fs::write(layout.settings_file(), json!({ "v": 1, "guncellemeSunucusu": "https://guncelleme.test" }).to_string()).unwrap();
        // Kira + HAK
        let (lease, hak) = lease_and_entitlement(&keys, &s.lease, T0);
        std::fs::create_dir_all(root.join("lisans")).unwrap();
        std::fs::write(root.join("lisans").join("kira.jws"), lease).unwrap();
        std::fs::write(root.join("lisans").join("hak.jws"), hak).unwrap();
        // Yeni paket + manifest (sunucuda)
        let mut files = version_files(NEW);
        let (signer, kid) = if s.package_signer_staging { (&keys.staging, "paket-hazirlik") } else { (&keys.package, "paket-2026") };
        let mut all = files.clone();
        all.extend(integrity_files(&files, NEW, signer, kid, s.customer));
        if s.extra_file_in_scope {
            files.push(("dist/arka-kapi.js".into(), b"// imzasiz".to_vec()));
            all.push(("dist/arka-kapi.js".into(), b"// imzasiz".to_vec()));
        }
        let zip = zip_of(&all);
        let manifest = manifest_for(signer, kid, NEW, &zip, s.manifest_extra.clone());
        let mut served = HashMap::new();
        served.insert(format!("/{CHANNEL}/backend/{NEW}/paket.zip"), zip);
        served.insert(format!("/{CHANNEL}/backend/{NEW}/manifest.jws"), manifest.into_bytes());
        if let Some(i) = &s.intent {
            std::fs::create_dir_all(layout.intent_file().parent().unwrap()).unwrap();
            std::fs::write(layout.intent_file(), i.to_string()).unwrap();
        }
        let mut svcs = HashMap::new();
        svcs.insert(
            BACKEND.to_string(),
            Svc { state: SvcState::Running, args: vec![], version: Some(OLD.into()), image: "konak".into(), starts: 0 },
        );
        svcs.insert(
            PG.to_string(),
            Svc { state: SvcState::Running, args: vec![], version: Some("16.9".into()), image: String::new(), starts: 0 },
        );
        let crash = Arc::new(Crash::default());
        World {
            fs: Arc::new(CrashFs { inner: RealFs, crash: Arc::clone(&crash), free: AtomicU64::new(u64::MAX) }),
            dir,
            layout,
            crash,
            db: Arc::new(Mutex::new(Db { finished: migrations_of(OLD), total: migrations_of(OLD), data: 42 })),
            svcs: Arc::new(Mutex::new(svcs)),
            faults: Arc::new(Faults::default()),
            files: Arc::new(Mutex::new(served)),
            clock: Arc::new(AtomicI64::new(T0)),
            events: Arc::new(Mutex::new(vec![])),
            keys,
            anchor,
        }
    }

    pub fn refs(&self) -> WorldRefs {
        WorldRefs {
            root: self.layout.root.clone(),
            crash: Arc::clone(&self.crash),
            db: Arc::clone(&self.db),
            svcs: Arc::clone(&self.svcs),
            faults: Arc::clone(&self.faults),
            files: Arc::clone(&self.files),
            clock: Arc::clone(&self.clock),
            events: Arc::clone(&self.events),
        }
    }

    pub fn env(&self) -> Env {
        let r = self.refs();
        Env {
            fs: Arc::clone(&self.fs) as Arc<dyn Fs>,
            svc: Arc::new(FakeServices { w: r.clone() }),
            procs: Arc::new(FakeProcs { w: r.clone() }),
            net: Arc::new(FakeNet { w: r.clone() }),
            clock: Arc::new(FakeClock(Arc::clone(&self.clock))),
            events: Arc::new(FakeEvents(Arc::clone(&self.events))),
            protect: Arc::new(FakeProtect),
        }
    }

    /// "Süreç başlangıcı": yeni motor (bellekteki hiçbir durum taşınmaz).
    pub fn engine(&self) -> Engine {
        Engine::new(self.env(), self.layout.clone(), self.anchor.clone(), Arc::new(RotatingLog::disabled()), None)
    }

    pub fn status(&self) -> Option<StatusDoc> {
        ipc::read_status(&RealFs, &self.layout)
    }

    pub fn state(&self) -> Option<State> {
        self.status().map(|s| s.state)
    }

    pub fn unfinished(&self) -> bool {
        Journal::open(&RealFs, &self.layout.journal_file()).map(|j| j.unfinished().is_some()).unwrap_or(false)
    }

    pub fn current(&self) -> Option<String> {
        current_version(&self.layout.root)
    }

    pub fn backend(&self) -> Svc {
        self.svcs.lock().unwrap().get(BACKEND).cloned().unwrap()
    }

    pub fn db(&self) -> Db {
        self.db.lock().unwrap().clone()
    }

    pub fn write_intent(&self, v: &Value) {
        std::fs::create_dir_all(self.layout.intent_file().parent().unwrap()).unwrap();
        std::fs::write(self.layout.intent_file(), v.to_string()).unwrap();
    }

    /// Bir süreç ömrü: `ticks` tura kadar; enjekte ölüm `Err(Killed)`.
    pub fn run(&self, ticks: usize) -> Result<Vec<TickResult>, Killed> {
        let engine = self.engine();
        let mut out = vec![];
        for _ in 0..ticks {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine.tick(&|| false))) {
                Ok(r) => out.push(r),
                Err(p) if p.is::<Killed>() => return Err(Killed),
                Err(p) => std::panic::resume_unwind(p),
            }
        }
        Ok(out)
    }

    /// Terminal duruma (BAŞARILI/GERİ DÖNDÜ/HATA, yarım işlem yok) varana dek yeniden başlatarak koşar.
    pub fn run_to_rest(&self, max_restarts: usize) -> usize {
        for restarts in 0..=max_restarts {
            match self.run(3) {
                Ok(_) => {
                    if !self.unfinished() && matches!(self.state(), Some(State::Succeeded | State::RolledBack | State::Failed)) {
                        return restarts;
                    }
                }
                Err(Killed) => {
                    self.crash.disarm();
                }
            }
        }
        let st = self.status();
        panic!(
            "dünya dinlenmeye varmadı: durum {:?} {:?} {:?}, yarım {}",
            st.as_ref().map(|s| s.state),
            st.as_ref().and_then(|s| s.error_code.clone()),
            st.as_ref().and_then(|s| s.message.clone()),
            self.unfinished()
        );
    }

    /// Sayaçlı "ölümsüz" koşum: kaç enjeksiyon noktası var.
    pub fn count_points(&self) -> u64 {
        self.crash.disarm();
        let _ = self.run(3);
        self.crash.count.load(Ordering::SeqCst)
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Her son durumda geçerli olması gereken değişmezler (§7).
pub fn assert_invariants(w: &World, ctx: &str) {
    let st = w.status().unwrap_or_else(|| panic!("{ctx}: durum.json yok"));
    let b = w.backend();
    assert_eq!(b.state, SvcState::Running, "{ctx}: backend çalışmıyor");
    assert!(b.args.is_empty(), "{ctx}: backend doğrulama kipinde kalmış: {:?}", b.args);
    let cur = w.current().unwrap_or_else(|| panic!("{ctx}: current yok"));
    assert_eq!(b.version.as_deref(), Some(cur.as_str()), "{ctx}: backend current'ın sürümünü koşmuyor");
    let db = w.db();
    match st.state {
        State::Succeeded => {
            assert_eq!(cur, NEW, "{ctx}: BAŞARILI ama current {cur}");
            assert_eq!((db.finished, db.total), (migrations_of(NEW), migrations_of(NEW)), "{ctx}: yeni sürümün göçleri tam değil");
            assert_eq!(db.data, 42, "{ctx}: veri kayboldu");
        }
        State::RolledBack => {
            assert_eq!(cur, OLD, "{ctx}: GERİ DÖNDÜ ama current {cur}");
            assert_eq!(
                db,
                Db { finished: migrations_of(OLD), total: migrations_of(OLD), data: 42 },
                "{ctx}: DB işlem öncesi hâlinde değil"
            );
        }
        other => panic!("{ctx}: beklenmeyen son durum {other:?} ({:?}: {:?})", st.error_code, st.message),
    }
    for stray in ["current.yeni", "current.eski"] {
        assert!(std::fs::symlink_metadata(w.layout.root.join(stray)).is_err(), "{ctx}: artık bağlantı {stray}");
    }
    let mut leftovers = vec![];
    walk(&w.dir, &mut |p| {
        let n = name(p);
        if n == "db.dump"
            || n == "db.dump.geri"
            || n.ends_with(".tksec")
            || n.ends_with(".tksec.gecici")
            || n.ends_with(".part") && n.contains(".dump")
        {
            leftovers.push(p.display().to_string());
        }
    });
    assert!(leftovers.is_empty(), "{ctx}: düz yedek/anahtar artığı: {leftovers:?}");
}

pub fn walk(dir: &Path, f: &mut dyn FnMut(&Path)) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        let meta = std::fs::symlink_metadata(&p).unwrap();
        if meta.is_dir() {
            walk(&p, f);
        } else {
            f(&p);
        }
    }
}

/// Kurulum geçmişindeki satırlar (kayitId tekil sayılır — okuyucu gibi).
pub fn install_records(w: &World) -> Vec<Value> {
    let text = std::fs::read_to_string(w.layout.install_history()).unwrap_or_default();
    let mut by_id: Vec<(String, Value)> = vec![];
    for l in text.lines().filter(|l| !l.trim().is_empty()) {
        // Okuyucu (`install-history.ts`) gibi: biçimsiz (yırtık) satır atlanır, geçerli kayıt KAYBOLMAMALI.
        let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
        let id = v["kayitId"].as_str().unwrap().to_string();
        by_id.retain(|(k, _)| *k != id);
        by_id.push((id, v));
    }
    by_id.into_iter().map(|(_, v)| v).collect()
}
