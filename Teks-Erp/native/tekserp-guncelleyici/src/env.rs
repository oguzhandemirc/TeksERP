//! Ortam soyutlaması — çekirdek dünyaya YALNIZ bunlardan dokunur: dosya sistemi, hizmet denetimi,
//! çocuk süreç, ağ, saat, olay günlüğü, yerel koruma (DPAPI) ve platform arka ucu (sağlık sondası,
//! araçlar, PG — `platform::Arka`). Gerçek uygulamalar `platform` altında; testler aynı arayüzleri sahte
//! hizmet/süreç/ağ/saat ve "öldür-yeniden başlat" enjeksiyonuyla sarar.
use std::ffi::OsString;
use std::io::{self, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tekserp_hizmet::logfile::Level;

pub use crate::platform::gercek::{real, RealFs, RealNet, RealProcs, SystemClock};

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
    /// Yolun dosya sisteminin kimliği (Unix `st_dev`, Windows birim yolu): disk ön kontrolü aynı dosya sistemine
    /// düşen yazımları toplar.
    fn volume_id(&self, p: &Path) -> io::Result<String>;
    /// Yola (dizin ya da dosya) SYSTEM · Administrators · TrustedInstaller · güncelleyicinin kendi hesabı
    /// DIŞINDA yazma/silme/izin değiştirme hakkı olan ilkeler (sahip dahil); boş = güvenilir. SYSTEM'in
    /// çalıştıracağı ya da güveneceği dizinler uygulamadan ÖNCE ölçülür (fail-closed).
    fn foreign_writers(&self, p: &Path) -> io::Result<Vec<String>>;
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
    /// Ustar dış paketi `dest`e açar: önce BÜTÜN başlıklar ölçülür ve düz dosya üyeleri `members`e TAM eşit olmalıdır,
    /// ancak sonra yazılır (`tar::extract_real`). Yarım açılış hazırlık dizininde kalır, sonraki tur siler.
    fn extract_tar(
        &self,
        archive: &Path,
        dest: &Path,
        members: &[String],
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
    /// Hizmet DURMUŞ ve konak hizmete özgü sıfır-dışı bir kodla (`tekserp_hizmet::contract::exit`) çıkmışsa o kod:
    /// açılışta düşen sürüm (sağlık zaman aşımını beklemez) ve SCM kurtarmasının bekleyen yeniden başlatması.
    fn crash_exit_code(&self, name: &str) -> EnvResult<Option<u32>>;
    /// Hizmetin tam komut satırı (ImagePath) — PG küçük sürümünde sürüm dizini değişir (D4 U6).
    fn image_path(&self, name: &str) -> EnvResult<String>;
    fn set_image_path(&self, name: &str, command_line: &str) -> EnvResult<()>;
    /// Hizmet yönetici kararıyla devre dışı mı (Windows başlangıç türü `Disabled`); ölçemeyen arka uç `false` der.
    fn disabled(&self, _name: &str) -> EnvResult<bool> {
        Ok(false)
    }
    /// Açılış davranışı (bakım çiti, W2): Windows başlangıç türü (`start_mode::*`), Linux konteynerin yeniden başlatma
    /// politikası (`unless-stopped` …); hizmet/konteyner yoksa `start_mode::MISSING`.
    fn start_mode(&self, name: &str) -> EnvResult<String> {
        Err(EnvError(format!("{name}: açılış davranışı bu arka uçta ölçülmez")))
    }
    /// Yalnız Windows başlangıç türünü yazar (`start_mode::*`); Linux'ta çit yazılmaz (politika ölçülür).
    fn set_start_mode(&self, name: &str, _mode: &str) -> EnvResult<()> {
        Err(EnvError(format!("{name}: açılış davranışı bu arka uçta yazılmaz")))
    }
}

/// Açılış davranışının günlük/işaret değerleri (Windows başlangıç türleri; Linux'ta politika adı olduğu gibi).
pub mod start_mode {
    pub const AUTO_DELAYED: &str = "OTOMATIK_GECIKMELI";
    pub const AUTO: &str = "OTOMATIK";
    pub const DEMAND: &str = "ELLE";
    pub const DISABLED: &str = "DEVRE_DISI";
    pub const MISSING: &str = "YOK";
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
    /// İşlemi yürüten arka uç (Windows hizmeti · Linux/Docker): sağlık sondası, araçlar, PG, günlük `platform`u.
    pub arka: crate::platform::Arka,
}

#[cfg(test)]
mod tests {
    /// Windows'ta `sync_all` (FlushFileBuffers) salt-okunur tutamaçta "Access is denied" verir; Mac/Linux'ta
    /// geçer — sınıf yalnız Windows CI'da görünürdü. İki hizmet crate'inde salt-okunur açılıp eşitlenen
    /// tutamaç kalmasın (aynı deyimde `File::open` + `sync_all`).
    #[test]
    fn no_sync_on_read_only_handle() {
        let open = ["File", "::open("].concat();
        let sync = [".sync", "_all()"].concat();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let mut seen = 0;
        let mut bad = Vec::new();
        for dir in [root.join("src"), root.join("../tekserp-hizmet/src")] {
            let mut stack = vec![dir];
            while let Some(d) = stack.pop() {
                for e in std::fs::read_dir(&d).expect("src dizini").flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        stack.push(p);
                    } else if p.extension().is_some_and(|x| x == "rs") {
                        seen += 1;
                        let text = std::fs::read_to_string(&p).expect("kaynak");
                        bad.extend(
                            text.split(';')
                                .filter(|st| st.contains(&open) && st.contains(&sync))
                                .map(|st| format!("{}: {}", p.display(), st.trim())),
                        );
                    }
                }
            }
        }
        assert!(seen >= 20, "kaynak taranmadı: {seen}");
        assert!(bad.is_empty(), "salt-okunur tutamaçta sync_all:\n{}", bad.join("\n"));
    }
}
