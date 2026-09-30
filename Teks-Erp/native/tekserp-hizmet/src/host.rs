//! Hizmet konağının çekirdeği (platformdan bağımsız) — D3 ile kesinleşen sözleşme (§4.3):
//! açılışta `<KOK>\current` ÇÖZÜLÜR → `<sürüm>\runtime\node.exe <sürüm>\dist\server.js`, çalışma dizini
//! sürüm dizini; ortam = hizmet ortamı + `TEKSERP_KOK` · `TEKSERP_HIZMET_ADI` · `TEKSERP_KAPANIS=stdin`
//! · `NODE_ENV=production` · `NODE_USE_SYSTEM_CA=1`, `NODE_OPTIONS` SİLİNİR (backend `.env`ini
//! `<KOK>\yapilandirma\.env`den kendisi okur — konak sır taşımaz). Çıktı `logs\backend-out.log` +
//! `backend-err.log`; durdurmada stdin'e `kapat` + EOF, 15 sn'de çıkmazsa sonlandırılır; node
//! kendiliğinden çıkarsa hata sonucu (SCM kurtarması yeniden başlatır, konak döngü kurmaz).
use crate::contract::{self, exit, path};
use crate::logfile::RotatingLog;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Düzgün kapanış için node'a tanınan süre (D3: backend ≤ 5,3 sn'de çıkar; SCM'e bekleme ipucu).
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(15);
/// Tek günlük satırının tavanı — node'un satır sonu olmayan dev çıktısı belleği şişirmesin.
const LINE_CAP: usize = 256 * 1024;

#[derive(Debug, Clone)]
pub struct HostConfig {
    pub root: PathBuf,
    /// Hizmetin adı (`--ad`; node'a `TEKSERP_HIZMET_ADI` olarak geçer — aynı makinede iki kanal).
    pub service_name: String,
    /// `--dogrulama` başlatma argümanı: yalnız 127.0.0.1, arka plan işi yok (§4.3).
    pub verify_mode: bool,
    pub shutdown_grace: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostOutcome {
    /// İstenen durdurma; `forced` = süre doldu, süreç sonlandırıldı.
    Stopped {
        forced: bool,
    },
    /// Node istenmeden çıktı (çökme ya da korumalı yükleyicinin 78'i gibi erken çıkış).
    NodeExited {
        code: Option<i32>,
    },
    NodeNotStarted(String),
    EnvFile(String),
    CurrentLink(String),
}

impl HostOutcome {
    pub fn exit_code(&self) -> u32 {
        match self {
            HostOutcome::Stopped { .. } => exit::OK,
            HostOutcome::NodeExited { .. } => exit::NODE_UNEXPECTED,
            HostOutcome::NodeNotStarted(_) => exit::NODE_NOT_STARTED,
            HostOutcome::EnvFile(_) => exit::ENV_FILE,
            HostOutcome::CurrentLink(_) => exit::CURRENT_LINK,
        }
    }
}

/// Konak yolları: `current` ÇÖZÜLMÜŞ sürüm dizini üzerinden (çalışma dizini = sürüm dizini).
#[derive(Debug, Clone)]
pub struct HostPaths {
    pub version_dir: PathBuf,
    pub node: PathBuf,
    pub script: PathBuf,
    pub env_file: PathBuf,
    pub log_dir: PathBuf,
}

/// `<KOK>\current` → sürüm dizini. Bağlantı `<KOK>\surumler\<ad>` DIŞINI gösteriyorsa RED (kurcalanmış).
pub fn resolve_current(root: &Path) -> Result<PathBuf, String> {
    let link = root.join(path::CURRENT);
    let target = std::fs::read_link(&link).map_err(|e| format!("{} okunamadı (bağlantı değil ya da yok): {e}", link.display()))?;
    let text = target.to_string_lossy().into_owned();
    let target = PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text));
    let target = if target.is_absolute() { target } else { root.join(target) };
    let versions = root.join(path::VERSIONS);
    let under = target.parent().is_some_and(|p| {
        if cfg!(windows) {
            p.to_string_lossy().trim_end_matches('\\').eq_ignore_ascii_case(versions.to_string_lossy().trim_end_matches('\\'))
        } else {
            p == versions
        }
    });
    if !under || !target.is_dir() {
        return Err(format!("current {} gösteriyor — {} altında bir sürüm dizini değil", target.display(), versions.display()));
    }
    Ok(target)
}

pub fn host_paths(root: &Path, version_dir: &Path) -> HostPaths {
    HostPaths {
        version_dir: version_dir.to_path_buf(),
        node: version_dir.join(path::RUNTIME).join(contract::node_file_name()),
        script: path::SERVER_SCRIPT.iter().fold(version_dir.to_path_buf(), |acc, p| acc.join(p)),
        env_file: root.join(path::CONFIG).join(path::ENV_FILE),
        log_dir: root.join(path::LOGS),
    }
}

/// Node'a verilecek EK ortam (hizmet ortamının üstüne; `ENV_REMOVED` ayrıca silinir).
pub fn child_env(cfg: &HostConfig) -> Vec<(String, String)> {
    let mut out = vec![
        (contract::ENV_ROOT.to_string(), cfg.root.to_string_lossy().trim_end_matches(['\\', '/']).to_string()),
        (contract::ENV_SERVICE_NAME.to_string(), cfg.service_name.clone()),
        (contract::ENV_SHUTDOWN_CHANNEL.to_string(), contract::SHUTDOWN_CHANNEL_STDIN.to_string()),
        ("NODE_ENV".to_string(), "production".to_string()),
        (contract::ENV_SYSTEM_CA.to_string(), "1".to_string()),
    ];
    if cfg.verify_mode {
        out.push(("HOST".to_string(), "127.0.0.1".to_string()));
        out.push((contract::ENV_VERIFY_MODE.to_string(), "1".to_string()));
    }
    out
}

/// Servis yapıştırıcısının (SCM bildirimi) ya da ön plan çalıştırıcısının kancaları.
pub trait HostHooks {
    fn started(&self, _pid: u32) {}
    /// Durdurma istendi (SCM'e `STOP_PENDING`).
    fn stopping(&self) {}
    /// Durdurma beklerken periyodik (SCM denetim noktası).
    fn waiting(&self) {}
}

pub struct NoHooks;
impl HostHooks for NoHooks {}

/// Backend çıktısının iki günlüğü (D3: stdout/stderr ayrı dosya).
pub struct BackendLogs {
    pub out: Arc<RotatingLog>,
    pub err: Arc<RotatingLog>,
}

fn pump(source: impl Read + Send + 'static, sink: Arc<RotatingLog>) {
    std::thread::spawn(move || {
        let mut r = BufReader::new(source);
        let mut buf = Vec::with_capacity(4096);
        loop {
            buf.clear();
            match r.by_ref().take(LINE_CAP as u64).read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    while buf.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
                        buf.pop();
                    }
                    let mut line = format!("{} ", sink.stamp()).into_bytes();
                    line.extend_from_slice(&buf);
                    line.push(b'\n');
                    sink.raw(&line);
                }
            }
        }
    });
}

fn spawn(p: &HostPaths, env: &[(String, String)]) -> std::io::Result<Child> {
    let mut cmd = Command::new(&p.node);
    cmd.arg(&p.script).current_dir(&p.version_dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for k in contract::ENV_REMOVED {
        cmd.env_remove(k);
    }
    for (k, v) in env {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

/// Konağın ana döngüsü. `stop` kanalına bir değer gelmesi (ya da gönderenin düşmesi) durdurma isteğidir.
pub fn run(cfg: &HostConfig, stop: &Receiver<()>, log: &RotatingLog, logs: &BackendLogs, hooks: &dyn HostHooks) -> HostOutcome {
    let version_dir = match resolve_current(&cfg.root) {
        Ok(v) => v,
        Err(e) => {
            log.error(&format!("current çözülemedi — node BAŞLATILMADI: {e}"));
            return HostOutcome::CurrentLink(e);
        }
    };
    let p = host_paths(&cfg.root, &version_dir);
    if !p.env_file.is_file() {
        let why = format!("{} yok — backend ortamsız başlatılmaz", p.env_file.display());
        log.error(&why);
        return HostOutcome::EnvFile(why);
    }
    if !p.node.is_file() || !p.script.is_file() {
        let why = format!("node ya da sunucu betiği yok: {} · {}", p.node.display(), p.script.display());
        log.error(&why);
        return HostOutcome::NodeNotStarted(why);
    }
    let env = child_env(cfg);
    let keys: Vec<&str> = env.iter().map(|(k, _)| k.as_str()).collect();
    log.info(&format!(
        "node başlatılıyor: {} {} (dizin {}; kip {}; ortam: {}; silinen: {})",
        p.node.display(),
        p.script.display(),
        p.version_dir.display(),
        if cfg.verify_mode { "DOĞRULAMA" } else { "normal" },
        keys.join(","),
        contract::ENV_REMOVED.join(",")
    ));
    let mut child = match spawn(&p, &env) {
        Ok(c) => c,
        Err(e) => {
            log.error(&format!("node başlatılamadı: {e}"));
            return HostOutcome::NodeNotStarted(e.to_string());
        }
    };
    if let Some(o) = child.stdout.take() {
        pump(o, Arc::clone(&logs.out));
    }
    if let Some(e) = child.stderr.take() {
        pump(e, Arc::clone(&logs.err));
    }
    hooks.started(child.id());
    log.info(&format!("node çalışıyor (pid {})", child.id()));
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                log.error(&format!(
                    "node BEKLENMEDİK çıktı (kod {:?}) — hizmet hata koduyla duruyor, SCM yeniden başlatacak",
                    status.code()
                ));
                return HostOutcome::NodeExited { code: status.code() };
            }
            Ok(None) => {}
            Err(e) => {
                log.error(&format!("node durumu okunamadı: {e}"));
                return shutdown(&mut child, cfg.shutdown_grace, log, hooks);
            }
        }
        match stop.recv_timeout(Duration::from_millis(200)) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => return shutdown(&mut child, cfg.shutdown_grace, log, hooks),
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

/// Düzgün kapanış: stdin'e `kapat` + EOF → süre içinde çıkmazsa sonlandır.
fn shutdown(child: &mut Child, grace: Duration, log: &RotatingLog, hooks: &dyn HostHooks) -> HostOutcome {
    hooks.stopping();
    log.info("durdurma istendi — node'a kapanış satırı gönderiliyor");
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(contract::SHUTDOWN_LINE.as_bytes());
        let _ = stdin.flush();
    }
    let started = Instant::now();
    let mut last_hint = Instant::now();
    while started.elapsed() < grace {
        if let Ok(Some(s)) = child.try_wait() {
            log.info(&format!("node düzgün kapandı (kod {:?}, {} ms)", s.code(), started.elapsed().as_millis()));
            return HostOutcome::Stopped { forced: false };
        }
        if last_hint.elapsed() >= Duration::from_secs(1) {
            hooks.waiting();
            last_hint = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    log.warn(&format!("node {} sn içinde kapanmadı — sonlandırılıyor", grace.as_secs()));
    let _ = child.kill();
    let _ = child.wait();
    HostOutcome::Stopped { forced: true }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::logfile::LogSpec;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc;

    /// Sahte `node`: ortamı ve çalışma dizinini köke döker, sonra davranışa göre bekler/çıkar.
    fn setup_root(name: &str, behaviour: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("tekserp-konak-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let version = root.join("surumler").join("9.9.9");
        std::fs::create_dir_all(version.join("runtime")).unwrap();
        std::fs::create_dir_all(version.join("dist")).unwrap();
        std::fs::write(version.join("dist").join("server.js"), "// sahte").unwrap();
        std::os::unix::fs::symlink(&version, root.join("current")).unwrap();
        std::fs::create_dir_all(root.join("yapilandirma")).unwrap();
        std::fs::write(root.join("yapilandirma").join(".env"), "PORT=4999\n").unwrap();
        let script = format!(
            "#!/bin/sh\nenv | grep -E '^(HOST|TEKSERP_|NODE_ENV|NODE_USE_SYSTEM_CA|NODE_OPTIONS)' | sort > \"{r}/ortam.txt\"\npwd > \"{r}/pwd.txt\"\necho \"$1\" > \"{r}/arg.txt\"\necho merhaba-stdout\necho merhaba-stderr >&2\n{behaviour}\n",
            r = root.display()
        );
        let node = version.join("runtime").join("node");
        std::fs::write(&node, script).unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
        root
    }

    fn cfg(root: &Path, verify_mode: bool, grace_ms: u64) -> HostConfig {
        HostConfig {
            root: root.to_path_buf(),
            service_name: "TeksERP-Backend-sinama".into(),
            verify_mode,
            shutdown_grace: Duration::from_millis(grace_ms),
        }
    }

    fn logs(root: &Path) -> BackendLogs {
        BackendLogs {
            out: Arc::new(RotatingLog::open(&root.join("logs"), "backend-out", LogSpec::BACKEND_OUTPUT)),
            err: Arc::new(RotatingLog::open(&root.join("logs"), "backend-err", LogSpec::BACKEND_OUTPUT)),
        }
    }

    fn quiet() -> BackendLogs {
        BackendLogs { out: Arc::new(RotatingLog::disabled()), err: Arc::new(RotatingLog::disabled()) }
    }

    fn wait_for(p: &Path) {
        let started = Instant::now();
        while !p.exists() && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn graceful_stop_env_cwd_and_logs() {
        let root = setup_root("duzgun", "read satir; echo \"$satir\" > \"$(dirname $(dirname $PWD))/kapanis.txt\"; exit 0");
        std::env::set_var("NODE_OPTIONS", "--require /kotu.js");
        let (tx, rx) = mpsc::channel();
        let r = root.clone();
        let t = std::thread::spawn(move || {
            wait_for(&r.join("ortam.txt"));
            tx.send(()).unwrap();
        });
        let out = run(&cfg(&root, true, 5000), &rx, &RotatingLog::disabled(), &logs(&root), &NoHooks);
        t.join().unwrap();
        assert_eq!(out, HostOutcome::Stopped { forced: false });
        assert_eq!(out.exit_code(), 0);
        assert_eq!(std::fs::read_to_string(root.join("kapanis.txt")).unwrap().trim(), "kapat");
        let env = std::fs::read_to_string(root.join("ortam.txt")).unwrap();
        for want in [
            "HOST=127.0.0.1",
            "TEKSERP_DOGRULAMA_KIPI=1",
            "TEKSERP_KAPANIS=stdin",
            "TEKSERP_HIZMET_ADI=TeksERP-Backend-sinama",
            "NODE_ENV=production",
            "NODE_USE_SYSTEM_CA=1",
        ] {
            assert!(env.lines().any(|l| l == want), "{want} satırı yok (hizmet adı parametreden gelmeli): {env}");
        }
        assert!(env.contains(&format!("TEKSERP_KOK={}", root.display())));
        assert!(!env.contains("NODE_OPTIONS"), "NODE_OPTIONS silinmeli: {env}");
        let pwd = std::fs::read_to_string(root.join("pwd.txt")).unwrap();
        assert!(pwd.trim().ends_with("surumler/9.9.9"), "çalışma dizini çözülmüş sürüm dizini olmalı: {pwd}");
        let arg = std::fs::read_to_string(root.join("arg.txt")).unwrap();
        assert!(arg.trim().ends_with("surumler/9.9.9/dist/server.js"), "betik mutlak sürüm yolundan: {arg}");
        std::thread::sleep(Duration::from_millis(150));
        let o = std::fs::read_to_string(root.join("logs").join("backend-out.log")).unwrap();
        let e = std::fs::read_to_string(root.join("logs").join("backend-err.log")).unwrap();
        assert!(o.contains(" merhaba-stdout") && !o.contains("merhaba-stderr"), "{o}");
        assert!(e.contains(" merhaba-stderr"), "{e}");
        assert!(matches!(o.as_bytes().get(23), Some(b'+' | b'-')), "yerel saat + ofset damgası: {o}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unexpected_exit_maps_to_error_code() {
        let root = setup_root("coktu", "exit 3");
        let (_tx, rx) = mpsc::channel::<()>();
        let out = run(&cfg(&root, false, 1000), &rx, &RotatingLog::disabled(), &quiet(), &NoHooks);
        assert_eq!(out, HostOutcome::NodeExited { code: Some(3) });
        assert_eq!(out.exit_code(), exit::NODE_UNEXPECTED);
        let env = std::fs::read_to_string(root.join("ortam.txt")).unwrap();
        assert!(!env.contains("HOST=127.0.0.1") && !env.contains("TEKSERP_DOGRULAMA_KIPI"), "normal kipte doğrulama yok");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stubborn_node_is_killed_after_grace() {
        let root = setup_root("inatci", "trap '' INT TERM; while true; do sleep 1; done");
        let (tx, rx) = mpsc::channel();
        let r = root.clone();
        let t = std::thread::spawn(move || {
            wait_for(&r.join("ortam.txt"));
            tx.send(()).unwrap();
        });
        let started = Instant::now();
        let out = run(&cfg(&root, false, 400), &rx, &RotatingLog::disabled(), &quiet(), &NoHooks);
        t.join().unwrap();
        assert_eq!(out, HostOutcome::Stopped { forced: true });
        assert!(started.elapsed() < Duration::from_secs(5));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_bad_current_env_file_or_script() {
        let root = setup_root("ret", "exit 0");
        let (_tx, rx) = mpsc::channel::<()>();
        std::fs::remove_file(root.join("yapilandirma").join(".env")).unwrap();
        let out = run(&cfg(&root, false, 100), &rx, &RotatingLog::disabled(), &quiet(), &NoHooks);
        assert!(matches!(out, HostOutcome::EnvFile(_)));
        assert_eq!(out.exit_code(), exit::ENV_FILE);
        std::fs::write(root.join("yapilandirma").join(".env"), "PORT=1\n").unwrap();
        std::fs::remove_file(root.join("current").join("dist").join("server.js")).unwrap();
        let out = run(&cfg(&root, false, 100), &rx, &RotatingLog::disabled(), &quiet(), &NoHooks);
        assert!(matches!(out, HostOutcome::NodeNotStarted(_)));
        // current sürümler DIŞINI gösteriyorsa (kurcalanmış bağlantı) node başlamaz.
        std::fs::remove_file(root.join("current")).unwrap();
        std::fs::create_dir_all(root.join("baska")).unwrap();
        std::os::unix::fs::symlink(root.join("baska"), root.join("current")).unwrap();
        let out = run(&cfg(&root, false, 100), &rx, &RotatingLog::disabled(), &quiet(), &NoHooks);
        assert!(matches!(out, HostOutcome::CurrentLink(_)), "{out:?}");
        assert_eq!(out.exit_code(), exit::CURRENT_LINK);
        assert!(!root.join("ortam.txt").exists(), "node hiç başlatılmamalı");
        let _ = std::fs::remove_dir_all(&root);
    }
}
