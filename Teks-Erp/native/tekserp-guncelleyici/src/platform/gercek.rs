//! Gerçek ortam (`env::Env`in üretim uygulamaları): dosya sistemi, çocuk süreç, ağ, saat — derleme hedefinin
//! işletim sistemi bağlarıyla (`#[cfg]` yalnız burada ve `platform/` altında). Unix dalları geliştirme/test
//! içindir (sembolik bağ, `rename(2)`); Windows dalları `windows::sys`e (Win32) iner.
use crate::env::{Clock, Env, EnvError, EnvResult, Events, Fs, HttpResponse, Net, Procs, Protect, ReadSeek, Services, SyncWrite};
use crate::env::{Cmd, CmdOut};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

pub struct RealFs;

fn not_found_ok(r: io::Result<()>) -> io::Result<()> {
    match r {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

fn tmp_sibling(p: &Path, tag: &str) -> PathBuf {
    let mut name = p.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(format!(".{tag}"));
    p.with_file_name(name)
}

impl Fs for RealFs {
    fn read(&self, p: &Path) -> io::Result<Vec<u8>> {
        std::fs::read(p)
    }

    fn read_untrusted(&self, p: &Path, max: u64) -> io::Result<Vec<u8>> {
        let deny = |why: &str| io::Error::new(io::ErrorKind::PermissionDenied, format!("{}: {why}", p.display()));
        if let Some(parent) = p.parent() {
            let m = std::fs::symlink_metadata(parent)?;
            if m.file_type().is_symlink() || is_reparse_point(&m) {
                return Err(deny("üst dizin bir bağlantı — izlenmez"));
            }
        }
        let m = std::fs::symlink_metadata(p)?;
        if m.file_type().is_symlink() || is_reparse_point(&m) || !m.is_file() {
            return Err(deny("düz dosya değil (bağlantı izlenmez)"));
        }
        if m.len() > max {
            return Err(deny(&format!("{max} bayttan büyük")));
        }
        let f = open_no_follow(p)?;
        let opened = f.metadata()?;
        if is_reparse_point(&opened) || !opened.is_file() {
            return Err(deny("açılan tutamaç düz dosya değil"));
        }
        let mut out = Vec::with_capacity(opened.len().min(max) as usize);
        f.take(max + 1).read_to_end(&mut out)?;
        if out.len() as u64 > max {
            return Err(deny(&format!("{max} bayttan büyük")));
        }
        Ok(out)
    }

    fn is_link(&self, p: &Path) -> bool {
        std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink() || is_reparse_point(&m))
    }

    fn write_atomic(&self, p: &Path, data: &[u8]) -> io::Result<()> {
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = tmp_sibling(p, "tmp");
        {
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(data)?;
            f.sync_all()?;
        }
        durable_rename(&tmp, p)
    }

    fn append_sync(&self, p: &Path, line: &[u8]) -> io::Result<()> {
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p)?;
        f.write_all(line)?;
        f.sync_all()
    }

    fn exists(&self, p: &Path) -> bool {
        std::fs::symlink_metadata(p).is_ok()
    }

    fn is_dir(&self, p: &Path) -> bool {
        p.is_dir()
    }

    fn create_dir_all(&self, p: &Path) -> io::Result<()> {
        std::fs::create_dir_all(p)
    }

    fn remove_file(&self, p: &Path) -> io::Result<()> {
        not_found_ok(std::fs::remove_file(p))
    }

    fn remove_dir_all(&self, p: &Path) -> io::Result<()> {
        match std::fs::symlink_metadata(p) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
            // Bağlantının kendisi silinir, hedefi DEĞİL.
            Ok(m) if m.file_type().is_symlink() || is_reparse_point(&m) => remove_link(p),
            Ok(_) => not_found_ok(std::fs::remove_dir_all(p)),
        }
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        durable_rename(from, to)
    }

    fn list(&self, p: &Path) -> io::Result<Vec<String>> {
        let mut out: Vec<String> =
            std::fs::read_dir(p)?.filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned())).collect();
        out.sort();
        Ok(out)
    }

    fn link_target(&self, link: &Path) -> io::Result<Option<PathBuf>> {
        match std::fs::symlink_metadata(link) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
            Ok(m) if m.file_type().is_symlink() || is_reparse_point(&m) => read_link_target(link).map(Some),
            Ok(_) => Err(io::Error::other(format!("{} bir bağlantı değil (gerçek dizin/dosya)", link.display()))),
        }
    }

    fn set_link(&self, link: &Path, target: &Path) -> io::Result<()> {
        let fresh = tmp_sibling(link, "yeni");
        let old = tmp_sibling(link, "eski");
        // Önceki yarım değişimin artıkları (yalnız bağlantılar) temizlenir.
        for stray in [&fresh, &old] {
            if let Ok(m) = std::fs::symlink_metadata(stray) {
                if m.file_type().is_symlink() || is_reparse_point(&m) {
                    remove_link(stray)?;
                } else {
                    return Err(io::Error::other(format!("{} bağlantı değil — elle incelenmeli", stray.display())));
                }
            }
        }
        create_link(&fresh, target)?;
        match std::fs::symlink_metadata(link) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
            Ok(m) if m.file_type().is_symlink() || is_reparse_point(&m) => replace_prepare(link, &old)?,
            Ok(_) => {
                return Err(io::Error::other(format!("{} gerçek bir dizin — bağlantıya çevrilmez (geçiş D6'nın işi)", link.display())))
            }
        }
        durable_rename(&fresh, link)?;
        if std::fs::symlink_metadata(&old).is_ok() {
            remove_link(&old)?;
        }
        Ok(())
    }

    fn free_space(&self, p: &Path) -> io::Result<u64> {
        free_space_of(p)
    }

    fn foreign_writers(&self, p: &Path) -> io::Result<Vec<String>> {
        foreign_writers_of(p)
    }

    fn file_len(&self, p: &Path) -> io::Result<u64> {
        std::fs::metadata(p).map(|m| m.len())
    }

    fn open_read(&self, p: &Path) -> io::Result<Box<dyn ReadSeek>> {
        Ok(Box::new(std::fs::File::open(p)?))
    }

    fn open_append(&self, p: &Path) -> io::Result<Box<dyn SyncWrite>> {
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Ok(Box::new(std::fs::OpenOptions::new().create(true).append(true).open(p)?))
    }

    fn copy(&self, from: &Path, to: &Path) -> io::Result<()> {
        let tmp = tmp_sibling(to, "tmp");
        std::fs::copy(from, &tmp)?;
        // Windows: FlushFileBuffers yazma hakkı ister — salt-okunur tutamaçta "Access is denied" (os error 5).
        std::fs::OpenOptions::new().write(true).open(&tmp)?.sync_all()?;
        durable_rename(&tmp, to)
    }

    fn extract_zip(
        &self,
        archive: &Path,
        dest: &Path,
        limits: &crate::package::ExtractLimits,
    ) -> Result<crate::package::ExtractStats, String> {
        crate::package::extract_real(archive, dest, limits)
    }
}

/// Unix: bağlantı değişimi `rename(2)` ile atomiktir — eskisini ayrıca taşımaya gerek yok.
#[cfg(unix)]
fn replace_prepare(_link: &Path, _old: &Path) -> io::Result<()> {
    Ok(())
}

/// Windows: dizin bağlantısının üstüne yeniden adlandırılamaz — önce eskisi `.eski`ye taşınır.
#[cfg(windows)]
fn replace_prepare(link: &Path, old: &Path) -> io::Result<()> {
    durable_rename(link, old)
}

#[cfg(unix)]
fn create_link(link: &Path, target: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn create_link(link: &Path, target: &Path) -> io::Result<()> {
    junction::create(target, link)
}

#[cfg(unix)]
fn remove_link(link: &Path) -> io::Result<()> {
    std::fs::remove_file(link)
}

#[cfg(windows)]
fn remove_link(link: &Path) -> io::Result<()> {
    // Junction bir dizin yeniden ayrıştırma noktasıdır: RemoveDirectory bağlantıyı siler, hedefi değil.
    std::fs::remove_dir(link).or_else(|_| std::fs::remove_file(link))
}

#[cfg(unix)]
fn read_link_target(link: &Path) -> io::Result<PathBuf> {
    std::fs::read_link(link)
}

#[cfg(windows)]
fn read_link_target(link: &Path) -> io::Result<PathBuf> {
    let t = junction::get_target(link).or_else(|_| std::fs::read_link(link))?;
    let s = t.to_string_lossy();
    Ok(PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()))
}

#[cfg(unix)]
fn is_reparse_point(_m: &std::fs::Metadata) -> bool {
    false
}

#[cfg(windows)]
fn is_reparse_point(m: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(unix)]
fn durable_rename(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::rename(from, to)
}

#[cfg(windows)]
fn durable_rename(from: &Path, to: &Path) -> io::Result<()> {
    super::windows::sys::move_file_durable(from, to)
}

#[cfg(unix)]
fn open_no_follow(p: &Path) -> io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    const O_NOFOLLOW: i32 = if cfg!(target_os = "macos") { 0x0100 } else { 0o400000 };
    std::fs::OpenOptions::new().read(true).custom_flags(O_NOFOLLOW).open(p)
}

/// Windows: `FILE_FLAG_OPEN_REPARSE_POINT` — son bileşen bağlantıysa HEDEF değil bağlantının kendisi açılır.
#[cfg(windows)]
fn open_no_follow(p: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    std::fs::OpenOptions::new().read(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(p)
}

#[cfg(unix)]
fn free_space_of(_p: &Path) -> io::Result<u64> {
    // Geliştirme/test platformu: ölçmeyiz (üretim yalnız Windows).
    Ok(u64::MAX)
}

#[cfg(windows)]
fn free_space_of(p: &Path) -> io::Result<u64> {
    super::windows::sys::free_space(p)
}

/// Geliştirme/test platformu: grup ya da herkes yazabiliyorsa yabancı (üretim ölçümü Windows DACL'i).
#[cfg(unix)]
fn foreign_writers_of(p: &Path) -> io::Result<Vec<String>> {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(p)?.permissions().mode();
    let mut out = Vec::new();
    if mode & 0o020 != 0 {
        out.push("grup yazabilir".to_string());
    }
    if mode & 0o002 != 0 {
        out.push("herkes yazabilir".to_string());
    }
    Ok(out)
}

#[cfg(windows)]
fn foreign_writers_of(p: &Path) -> io::Result<Vec<String>> {
    super::windows::sys::foreign_writers(p)
}

/// Çocuk süreç: stdout/stderr ayrı iş parçacıklarında (1 MB tavanlı) toplanır; süre dolunca süreç
/// (Windows'ta kendi iş nesnesiyle bütün ağacı) sonlandırılır.
pub struct RealProcs;

const OUTPUT_CAP: u64 = 1024 * 1024;

fn collect(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = pipe {
            let _ = p.take(OUTPUT_CAP).read_to_end(&mut buf);
        }
        buf
    })
}

impl Procs for RealProcs {
    fn run(&self, c: &Cmd) -> EnvResult<CmdOut> {
        let mut cmd = std::process::Command::new(&c.program);
        cmd.args(&c.args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        if let Some(d) = &c.cwd {
            cmd.current_dir(d);
        }
        // Bütünlük: çocuk node'a yükleyici enjeksiyonu (`--require/--import`) ortamdan gelemesin.
        cmd.env_remove("NODE_OPTIONS");
        for (k, v) in &c.env {
            cmd.env(k, v);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| EnvError(format!("{} başlatılamadı: {e}", c.program.display())))?;
        #[cfg(windows)]
        let tree = super::windows::sys::ChildTree::attach(&child);
        let out = collect(child.stdout.take());
        let err = collect(child.stderr.take());
        let started = std::time::Instant::now();
        let (code, timed_out) = loop {
            match child.try_wait() {
                Ok(Some(s)) => break (s.code(), false),
                Ok(None) if started.elapsed() >= c.timeout => {
                    #[cfg(windows)]
                    tree.kill();
                    let _ = child.kill();
                    let _ = child.wait();
                    break (None, true);
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(e) => return Err(EnvError(format!("{} beklenemedi: {e}", c.program.display()))),
            }
        };
        Ok(CmdOut { code, stdout: out.join().unwrap_or_default(), stderr: err.join().unwrap_or_default(), timed_out })
    }
}

/// HTTP(S): Windows'ta TLS işletim sisteminden (SChannel + sertifika deposu); vekil `ayar.json`dan.
pub struct RealNet {
    agent: ureq::Agent,
}

impl RealNet {
    pub fn new(proxy: Option<&str>) -> Result<RealNet, String> {
        let proxy = match proxy {
            Some(p) => Some(ureq::Proxy::new(p).map_err(|e| format!("vekil adresi geçersiz: {e}"))?),
            None => None,
        };
        let builder = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .proxy(proxy)
            .timeout_connect(Some(Duration::from_secs(20)))
            .timeout_recv_response(Some(Duration::from_secs(60)))
            .timeout_recv_body(Some(Duration::from_secs(120)))
            .user_agent(format!("tekserp-guncelleyici/{}", env!("CARGO_PKG_VERSION")));
        #[cfg(windows)]
        let builder = builder.tls_config(ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build());
        Ok(RealNet { agent: builder.build().into() })
    }
}

impl Net for RealNet {
    fn get(&self, url: &str, headers: &[(String, String)], timeout: Duration) -> EnvResult<HttpResponse> {
        let mut req = self.agent.get(url).config().timeout_global(Some(timeout)).build();
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = req.call().map_err(|e| EnvError(format!("istek başarısız: {e}")))?;
        let status = resp.status().as_u16();
        let headers = resp.headers().iter().map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or_default().to_string())).collect();
        Ok(HttpResponse { status, headers, body: Box::new(resp.into_body().into_reader()) })
    }
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        tekserp_hizmet::timefmt::now_ms()
    }
    fn sleep(&self, d: Duration) {
        std::thread::sleep(d);
    }
}

/// Üretim ortamı: gerçek dosya/süreç/ağ/saat + derleme hedefinin hizmet/olay/koruma bağları ve arka ucu
/// (`super::yerel`). `event_source`: olay günlüğü kaynağı (güncelleyici hizmetinin adı).
pub fn real(proxy: Option<&str>, event_source: &str) -> Result<Env, String> {
    let net: Arc<dyn Net> = Arc::new(RealNet::new(proxy)?);
    #[cfg(windows)]
    let (svc, events, protect): (Arc<dyn Services>, Arc<dyn Events>, Arc<dyn Protect>) = (
        Arc::new(super::windows::sys::WinServices),
        Arc::new(super::windows::sys::WinEvents { source: event_source.to_string() }),
        Arc::new(super::windows::sys::Dpapi),
    );
    #[cfg(not(windows))]
    let (svc, events, protect): (Arc<dyn Services>, Arc<dyn Events>, Arc<dyn Protect>) = {
        let _ = event_source;
        (Arc::new(super::linux::NoServices), Arc::new(super::linux::NoEvents), Arc::new(super::linux::NoProtect))
    };
    Ok(Env {
        fs: Arc::new(RealFs),
        svc,
        procs: Arc::new(RealProcs),
        net,
        clock: Arc::new(SystemClock),
        events,
        protect,
        arka: super::yerel(),
    })
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn foreign_writers_reads_group_and_world_write_bits() {
        use super::RealFs;
        use crate::env::Fs;
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("yabanci-yazar-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let set = |m: u32| std::fs::set_permissions(&d, std::fs::Permissions::from_mode(m)).unwrap();
        set(0o755);
        assert!(RealFs.foreign_writers(&d).unwrap().is_empty());
        set(0o777);
        assert_eq!(RealFs.foreign_writers(&d).unwrap().len(), 2);
        set(0o775);
        assert_eq!(RealFs.foreign_writers(&d).unwrap(), vec!["grup yazabilir".to_string()]);
        set(0o755);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
