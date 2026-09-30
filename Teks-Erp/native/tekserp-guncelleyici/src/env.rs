//! Ortam soyutlaması — çekirdek dünyaya YALNIZ bunlardan dokunur: dosya sistemi, hizmet denetimi,
//! çocuk süreç, ağ, saat, olay günlüğü, yerel koruma (DPAPI). Gerçek uygulamalar burada (dosya,
//! süreç, ağ, saat — her platform) ve `windows` modülünde (SCM, olay günlüğü, DPAPI); testler
//! aynı arayüzleri sahte hizmet/süreç/ağ/saat ve "öldür-yeniden başlat" enjeksiyonuyla sarar.
use std::ffi::OsString;
use std::io::{self, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tekserp_hizmet::logfile::Level;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvError(pub String);

impl std::fmt::Display for EnvError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<io::Error> for EnvError {
    fn from(e: io::Error) -> Self {
        EnvError(e.to_string())
    }
}

pub type EnvResult<T> = Result<T, EnvError>;

pub trait ReadSeek: Read + Seek + Send {}
impl<T: Read + Seek + Send> ReadSeek for T {}

pub trait SyncWrite: Write + Send {
    fn sync(&mut self) -> io::Result<()>;
}

impl SyncWrite for std::fs::File {
    fn sync(&mut self) -> io::Result<()> {
        self.sync_all()
    }
}

/// Dosya sistemi. Değiştiren her çağrı enjeksiyon noktasıdır (testte "süreç burada öldü").
pub trait Fs: Send + Sync {
    fn read(&self, p: &Path) -> io::Result<Vec<u8>>;
    /// GÜVENİLMEZ dizinden okuma (backend'in yazabildiği `lisans\` · `guncelleme\niyet\` ·
    /// `yapilandirma\` · PG veri dizini — D3 kuralı): dosya da üst dizini de bağlantı (junction/sembolik
    /// bağ) OLAMAZ, düz dosya olmalı, `max` baytı aşamaz. Hata metni içerikten beslenmez.
    fn read_untrusted(&self, p: &Path, max: u64) -> io::Result<Vec<u8>>;
    /// Yol bir bağlantı (junction/sembolik bağ) mı — SYSTEM'in yazacağı yolun ölçümü.
    fn is_link(&self, p: &Path) -> bool;
    /// Geçici dosyaya yaz → diske boşalt → hedefin üstüne yeniden adlandır (okuyan yarım dosya görmez).
    fn write_atomic(&self, p: &Path, data: &[u8]) -> io::Result<()>;
    /// Sona ekle + diske boşalt (işlem günlüğü).
    fn append_sync(&self, p: &Path, line: &[u8]) -> io::Result<()>;
    fn exists(&self, p: &Path) -> bool;
    fn is_dir(&self, p: &Path) -> bool;
    fn create_dir_all(&self, p: &Path) -> io::Result<()>;
    /// Yoksa sessizce geçer.
    fn remove_file(&self, p: &Path) -> io::Result<()>;
    /// Yoksa sessizce geçer. Bağlantıyı (junction) İZLEMEZ.
    fn remove_dir_all(&self, p: &Path) -> io::Result<()>;
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn list(&self, p: &Path) -> io::Result<Vec<String>>;
    /// Dizin bağlantısının (Windows junction, Unix sembolik bağ) hedefi; bağlantı yoksa `None`.
    fn link_target(&self, link: &Path) -> io::Result<Option<PathBuf>>;
    /// Bağlantıyı `target`a kurar ya da değiştirir (yarım kalan değişim sonraki çağrıda toparlanır).
    fn set_link(&self, link: &Path, target: &Path) -> io::Result<()>;
    fn free_space(&self, p: &Path) -> io::Result<u64>;
    fn file_len(&self, p: &Path) -> io::Result<u64>;
    fn open_read(&self, p: &Path) -> io::Result<Box<dyn ReadSeek>>;
    fn open_append(&self, p: &Path) -> io::Result<Box<dyn SyncWrite>>;
    fn copy(&self, from: &Path, to: &Path) -> io::Result<()>;
    /// Zip'i `dest`e açar (TEK işlem: yarım açılış hazırlık dizininde kalır, sonraki tur siler).
    fn extract_zip(
        &self,
        archive: &Path,
        dest: &Path,
        limits: &crate::package::ExtractLimits,
    ) -> Result<crate::package::ExtractStats, String>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SvcState {
    Missing,
    Stopped,
    Starting,
    Running,
    Stopping,
    Other,
}

pub trait Services: Send + Sync {
    fn state(&self, name: &str) -> EnvResult<SvcState>;
    /// Başlatma İSTEĞİ (bekleme çağıranın); zaten çalışıyorsa hata değil.
    fn start(&self, name: &str, args: &[&str]) -> EnvResult<()>;
    /// Durdurma İSTEĞİ (bekleme çağıranın); zaten durmuşsa hata değil.
    fn stop(&self, name: &str) -> EnvResult<()>;
    /// Hizmetin tam komut satırı (ImagePath) — PG küçük sürümünde sürüm dizini değişir (D4 U6).
    fn image_path(&self, name: &str) -> EnvResult<String>;
    fn set_image_path(&self, name: &str, command_line: &str) -> EnvResult<()>;
}

#[derive(Debug, Clone, Default)]
pub struct Cmd {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: Option<PathBuf>,
    /// Ek ortam (sırlar — PGPASSWORD, DATABASE_URL — YALNIZ buradan, argümandan asla).
    pub env: Vec<(String, String)>,
    pub timeout: Duration,
}

impl Cmd {
    pub fn new(program: &Path) -> Cmd {
        Cmd { program: program.to_path_buf(), timeout: Duration::from_secs(600), ..Cmd::default() }
    }
    pub fn arg(mut self, a: impl Into<OsString>) -> Cmd {
        self.args.push(a.into());
        self
    }
    pub fn args<I: IntoIterator<Item = S>, S: Into<OsString>>(mut self, it: I) -> Cmd {
        self.args.extend(it.into_iter().map(Into::into));
        self
    }
    pub fn cwd(mut self, d: &Path) -> Cmd {
        self.cwd = Some(d.to_path_buf());
        self
    }
    pub fn env(mut self, k: &str, v: &str) -> Cmd {
        self.env.push((k.to_string(), v.to_string()));
        self
    }
    pub fn envs(mut self, pairs: &[(String, String)]) -> Cmd {
        self.env.extend(pairs.iter().cloned());
        self
    }
    pub fn timeout(mut self, d: Duration) -> Cmd {
        self.timeout = d;
        self
    }
    /// Program adı (uzantısız, küçük harf) — sahte süreç yöneticisi ve günlük için.
    pub fn program_name(&self) -> String {
        self.program.file_stem().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
    }
}

#[derive(Debug, Clone, Default)]
pub struct CmdOut {
    pub code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub timed_out: bool,
}

impl CmdOut {
    pub fn ok(&self) -> bool {
        self.code == Some(0) && !self.timed_out
    }
}

pub trait Procs: Send + Sync {
    fn run(&self, c: &Cmd) -> EnvResult<CmdOut>;
}

pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Box<dyn Read + Send>,
}

impl HttpResponse {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

pub trait Net: Send + Sync {
    fn get(&self, url: &str, headers: &[(String, String)], timeout: Duration) -> EnvResult<HttpResponse>;
}

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
    fn sleep(&self, d: Duration);
}

pub trait Events: Send + Sync {
    fn event(&self, level: Level, message: &str);
}

/// Yerel koruma (Windows DPAPI, SYSTEM kapsamı) — geçici yedek anahtarının özel yarısı için.
pub trait Protect: Send + Sync {
    fn protect(&self, data: &[u8]) -> EnvResult<Vec<u8>>;
    fn unprotect(&self, data: &[u8]) -> EnvResult<Vec<u8>>;
}

#[derive(Clone)]
pub struct Env {
    pub fs: Arc<dyn Fs>,
    pub svc: Arc<dyn Services>,
    pub procs: Arc<dyn Procs>,
    pub net: Arc<dyn Net>,
    pub clock: Arc<dyn Clock>,
    pub events: Arc<dyn Events>,
    pub protect: Arc<dyn Protect>,
}

// ── Gerçek uygulamalar ────────────────────────────────────────────────────────────────────────────

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
        std::fs::File::open(&tmp)?.sync_all()?;
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
    crate::windows::move_file_durable(from, to)
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
    crate::windows::free_space(p)
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
        let tree = crate::windows::ChildTree::attach(&child);
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

/// Windows dışı: olay günlüğü yok (dosya günlüğü yeter).
pub struct NoEvents;
impl Events for NoEvents {
    fn event(&self, _level: Level, _message: &str) {}
}

/// Windows dışı: hizmet denetimi yok — her çağrı hata (güncelleyici yalnız Windows'ta uygular).
pub struct NoServices;
impl Services for NoServices {
    fn state(&self, _name: &str) -> EnvResult<SvcState> {
        Err(EnvError("hizmet denetimi bu platformda yok (yalnız Windows)".into()))
    }
    fn start(&self, name: &str, _args: &[&str]) -> EnvResult<()> {
        Err(EnvError(format!("{name}: hizmet denetimi bu platformda yok")))
    }
    fn stop(&self, name: &str) -> EnvResult<()> {
        Err(EnvError(format!("{name}: hizmet denetimi bu platformda yok")))
    }
    fn image_path(&self, name: &str) -> EnvResult<String> {
        Err(EnvError(format!("{name}: hizmet denetimi bu platformda yok")))
    }
    fn set_image_path(&self, name: &str, _command_line: &str) -> EnvResult<()> {
        Err(EnvError(format!("{name}: hizmet denetimi bu platformda yok")))
    }
}

/// Windows dışı: yerel koruma yok.
pub struct NoProtect;
impl Protect for NoProtect {
    fn protect(&self, _data: &[u8]) -> EnvResult<Vec<u8>> {
        Err(EnvError("yerel koruma (DPAPI) bu platformda yok".into()))
    }
    fn unprotect(&self, _data: &[u8]) -> EnvResult<Vec<u8>> {
        Err(EnvError("yerel koruma (DPAPI) bu platformda yok".into()))
    }
}

/// Üretim ortamı: gerçek dosya/süreç/ağ/saat + platformun hizmet/olay/koruma bağları.
pub fn real(proxy: Option<&str>) -> Result<Env, String> {
    let net: Arc<dyn Net> = Arc::new(RealNet::new(proxy)?);
    #[cfg(windows)]
    let (svc, events, protect): (Arc<dyn Services>, Arc<dyn Events>, Arc<dyn Protect>) =
        (Arc::new(crate::windows::WinServices), Arc::new(crate::windows::WinEvents), Arc::new(crate::windows::Dpapi));
    #[cfg(not(windows))]
    let (svc, events, protect): (Arc<dyn Services>, Arc<dyn Events>, Arc<dyn Protect>) =
        (Arc::new(NoServices), Arc::new(NoEvents), Arc::new(NoProtect));
    Ok(Env { fs: Arc::new(RealFs), svc, procs: Arc::new(RealProcs), net, clock: Arc::new(SystemClock), events, protect })
}
