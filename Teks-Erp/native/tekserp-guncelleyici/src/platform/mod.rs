//! Platform sınırı (`docs/design/GUNCELLEYICI-SAGLAMLIK.md` §1.1): çekirdek iki arka ucu (Windows hizmeti ·
//! Linux/Docker) tanımaz; dünyaya `env::Env` üzerinden dokunur. İki katman burada durur:
//!
//! - **Arka uç** (`Arka`: `Saglik` · `Araclar` · `PgArkaUcu` + günlüğün `platform`u): işlemin NASIL yürüdüğü.
//!   Ortamla birlikte seçilir (`Env::arka`) — üretimde derleme hedefinden (`yerel`), sahte dünyada profilden;
//!   bu yüzden `windows` ve `linux` arka uçları HER hedefte derlenir ve yalnız `Env` arayüzleriyle konuşur.
//! - **Konak** (`gercek` + aşağıdaki küçük işlevler): derleme hedefinin işletim sistemi bağları — `#[cfg]`
//!   yalnız bu ağaçta ve `windows::sys`/`windows::service`te (Win32) durur (bekçi `tests/platform_siniri.rs`).
pub mod gercek;
pub mod linux;
pub mod windows;

use crate::env::{CmdOut, Env, EnvResult, Fs, HttpResponse};
use crate::settings::BackendEnv;
use crate::tools::MigrationCount;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Backend'in yerel sağlık ucuna tek yoklama (sözleşme 4; yorum `health`te, çekirdekte).
pub trait Saglik: Send + Sync {
    /// `path`e (`health::LOCAL_PATH` ya da eski backend için `PUBLIC_PATH`) tek GET; durum kodu + gövde.
    fn probe(&self, env: &Env, port: u16, path: &str) -> EnvResult<HttpResponse>;
    /// İletilerde görünen sonda adresi.
    fn address(&self, port: u16, path: &str) -> String;
    /// Backend'in sıfır-dışı çıkış kodunun anlamı (açılışta düşen sürüm iletisi).
    fn exit_meaning(&self, code: u32) -> &'static str;
}

/// PG ve backend araçları (plan adlarıyla: göç = `migrate_deploy` · göç sayısı = `migration_count` · bitmiş göç
/// adları = `finished_migrations` · yedek = `pg_dump` + `backup_*` · geri yükleme = `restore_db`). Hata metni
/// sır taşımaz; adım kodunu çağıran koyar.
pub trait Araclar: Send + Sync {
    fn migration_count(&self, env: &Env, be: &BackendEnv) -> Result<MigrationCount, String>;
    fn finished_migrations(&self, env: &Env, be: &BackendEnv) -> Result<Vec<String>, String>;
    fn pg_dump(&self, env: &Env, be: &BackendEnv, out_file: &Path, timeout: Duration) -> Result<(), String>;
    fn pg_restore_list(&self, env: &Env, be: &BackendEnv, dump: &Path) -> Result<(), String>;
    fn restore_db(&self, env: &Env, be: &BackendEnv, dump: &Path, timeout: Duration) -> Result<(), String>;
    /// `SHOW server_version`ın sürüm kısmı (`bin`: PG ikili dizini).
    fn server_version(&self, env: &Env, be: &BackendEnv, bin: &Path) -> Result<String, String>;
    fn usable_for_backup(&self, env: &Env, tools_dir: &Path) -> bool;
    fn backup_keygen(&self, env: &Env, tools_dir: &Path, dir: &Path, private_out: &Path) -> Result<(), String>;
    fn backup_encrypt(
        &self,
        env: &Env,
        tools_dir: &Path,
        input: &Path,
        output: &Path,
        recipients: &[PathBuf],
        timeout: Duration,
    ) -> Result<(), String>;
    fn backup_decrypt(&self, env: &Env, tools_dir: &Path, input: &Path, output: &Path, key: &Path, timeout: Duration)
        -> Result<(), String>;
    /// Göç aracının ham çıktısı (zaman aşımı/çıkış kodu kararı çağıranın).
    fn migrate_deploy(&self, env: &Env, version_dir: &Path, be: &BackendEnv, timeout: Duration) -> Result<CmdOut, String>;
    /// İmajların ayrı dosya sisteminde durduğu dizin (Docker kökü) — disk ön kontrolü onu da ölçer. Windows: yok.
    fn imaj_deposu(&self, _env: &Env) -> Option<PathBuf> {
        None
    }
    /// ONAY budaması: `keep` dışındaki sürüm imajları (en iyi çaba). Windows: imaj yok.
    fn imaj_buda(&self, _env: &Env, _keep: &[String]) {}
}

/// Kendi PostgreSQL'in küçük sürümü (D4 U5–U9): hizmet komut satırı, ICU sürümü, SQL koşumu.
pub trait PgArkaUcu: Send + Sync {
    fn image_path(&self, env: &Env, service: &str) -> EnvResult<String>;
    fn set_image_path(&self, env: &Env, service: &str, command_line: &str) -> EnvResult<()>;
    /// Komut satırındaki eski sürüm dizinini yenisiyle değiştirir; eski dizin geçmiyorsa `None`.
    fn replace_dir(&self, command_line: &str, old_dir: &Path, new_dir: &Path) -> Option<String>;
    fn icu_version(&self, env: &Env, dir: &Path) -> Option<String>;
    /// `sql`i `pg_dir` sürümünün istemcisiyle koşar (ICU yeniden dizinleme).
    fn reindex_icu(&self, env: &Env, be: &BackendEnv, pg_dir: &Path, sql: &str) -> Result<(), String>;
}

/// İşlemi yürüten arka uç.
#[derive(Clone)]
pub struct Arka {
    /// İşlem günlüğünün ISLEM satırına yazılan ad (bildirimin platform sözlüğüyle aynı). Başka adlı günlük
    /// sürdürülmez de geri alınmaz da (`operation::drive`).
    pub platform: &'static str,
    /// Backend `.env`inin okunuşu (hizmet kipi `DATABASE_URL` · compose kipi `POSTGRES_*`).
    pub ortam: crate::settings::OrtamKipi,
    /// Paketteki güncelleyici ikilisinin sürüm dizinine göre yolu (`/` ayraçlı, imzalı listedeki ad) — kendini
    /// güncellemenin kaynağı: Windows `runtime/tekserp-guncelleyici.exe`, Linux paket kökünde `tekserp-guncelleyici`.
    pub guncelleyici_paket_yolu: &'static str,
    pub saglik: Arc<dyn Saglik>,
    pub araclar: Arc<dyn Araclar>,
    pub pg: Arc<dyn PgArkaUcu>,
}

/// Derleme hedefinin arka ucu (üretim ortamı, `gercek::real`).
#[cfg(target_os = "windows")]
pub fn yerel() -> Arka {
    windows::arka_ucu()
}

/// Linux (ve geliştirme konağı macOS — Docker CLI orada da vardır): Linux/Docker arka ucu.
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub fn yerel() -> Arka {
    linux::arka_ucu()
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
compile_error!("tekserp-guncelleyici: tanınmayan hedef işletim sistemi (arka uç yok)");

/// Ortamı kuruluma bağlar: Linux'ta hizmet denetimi ve arka uç `ayar.json`daki compose projesine (`composeProje`)
/// bağlı Docker uygulamalarıdır; Windows'ta ortam değişmez. Proje adı geçersizse iskelet kalır (fail-closed).
pub fn baglam(env: Env, layout: &crate::layout::Layout, s: &crate::settings::UpdaterSettings) -> Result<Env, String> {
    #[cfg(windows)]
    {
        let _ = (layout, s);
        Ok(env)
    }
    #[cfg(not(windows))]
    {
        let komut = Arc::new(linux::docker::DockerKomut::new(layout, s.compose_project())?);
        let svc = Arc::new(linux::docker::DockerServices::new(Arc::clone(&komut), Arc::clone(&env.procs), s.stop_timeout_s));
        Ok(Env { svc, arka: linux::docker::arka_ucu(komut), ..env })
    }
}

// ── Konak olguları (derleme hedefinin işletim sistemi) ─────────────────────────────────────────

/// Çalıştırılabilir dosya adı (`psql` → Windows'ta `psql.exe`).
pub fn executable(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Dosya yolları büyük/küçük harf duyarsız mı (Windows).
pub fn case_insensitive_paths() -> bool {
    cfg!(windows)
}

/// İki yol aynı mı (Windows'ta büyük/küçük harf ve sondaki `\` farkı yok sayılır).
pub fn same_path(a: &Path, b: &Path) -> bool {
    if case_insensitive_paths() {
        a.to_string_lossy().trim_end_matches('\\').eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches('\\'))
    } else {
        a == b
    }
}

/// Windows paylaşım/kilit ihlali (32/33) — dosya başka süreçte açık.
pub fn is_sharing_violation(e: &std::io::Error) -> bool {
    cfg!(windows) && matches!(e.raw_os_error(), Some(32 | 33))
}

/// Güncelleyicinin özel alanını kurar: Windows'ta korumalı DACL (SYSTEM + Administrators), Unix'te sahibi
/// güncelleyici + 0700 (`linux::sys`).
pub fn harden_private_dir(fs: &dyn Fs, p: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = fs;
        windows::sys::harden_private_dir(p).map_err(|e| format!("özel alan kurulamadı: {e}"))
    }
    #[cfg(not(windows))]
    {
        fs.create_dir_all(p).map_err(|e| e.to_string())?;
        linux::sys::harden_private_dir(p).map_err(|e| format!("özel alan kurulamadı: {e}"))
    }
}

/// `--veri` verilmezse veri kökü: Windows'ta `%ProgramData%\TeksERP`, Linux'ta `/var/lib/tekserp` (§1.2), başka
/// yerde (geliştirme) `<kök>/programdata`.
pub fn default_data_dir(root: &Path) -> PathBuf {
    if cfg!(target_os = "linux") {
        return PathBuf::from(linux::duzen::VARSAYILAN_VERI);
    }
    match std::env::var_os("ProgramData") {
        Some(pd) if cfg!(windows) => PathBuf::from(pd).join("TeksERP"),
        _ => root.join("programdata"),
    }
}

/// Tek güncelleyici süreci kilidi (`lock::acquire`): Windows'ta paylaşım kipi 0, Unix'te `flock` (`linux::sys`).
#[cfg(windows)]
pub fn open_lock_file(p: &Path) -> Result<std::fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .share_mode(0)
        .open(p)
        .map_err(|_| "başka bir güncelleyici süreci çalışıyor (kilit dolu)".to_string())
}

#[cfg(not(windows))]
pub fn open_lock_file(p: &Path) -> Result<std::fs::File, String> {
    linux::sys::open_lock_file(p)
}

/// Hizmet kaydı komutları (`hizmet` · `hizmet-kur` · `hizmet-kaldir`) — platformun hizmet yöneticisine.
#[cfg(windows)]
pub fn service_command(command: &str, args: &[String]) -> Result<u32, String> {
    windows::service::command(command, args)
}

#[cfg(not(windows))]
pub fn service_command(command: &str, args: &[String]) -> Result<u32, String> {
    linux::service_command(command, args)
}

/// Tanı paketinin platform ölçümleri (W4; fail-soft): Windows'ta SCM hizmetleri, başka yerde Docker + systemd + `df`.
#[cfg(windows)]
pub fn tani_olcumleri(h: &crate::tani::TaniHedefi) -> Vec<crate::tani::Olcum> {
    windows::tani::olcumler(h)
}

#[cfg(not(windows))]
pub fn tani_olcumleri(h: &crate::tani::TaniHedefi) -> Vec<crate::tani::Olcum> {
    linux::tani::olcumler(h)
}

#[cfg(test)]
mod tests {
    #[test]
    fn guncelleyici_paket_yollari() {
        use tekserp_hizmet::contract::path;
        assert_eq!(super::windows::GUNCELLEYICI_PAKET_YOLU, format!("{}/{}", path::RUNTIME, path::UPDATER_EXE), "Windows yolu değişmez");
        assert_eq!(
            super::linux::arka_ucu().guncelleyici_paket_yolu,
            "tekserp-guncelleyici",
            "Linux: paket kökünde, .exe'siz (oci-paket.ts)"
        );
    }

    #[test]
    fn windows_platform_is_legacy_journal_default() {
        assert_eq!(super::windows::PLATFORM, crate::journal::LEGACY_PLATFORM, "alansız günlüğü yalnız Windows ikilisi yazdı (§15 madde 2)");
        assert_ne!(super::linux::PLATFORM, super::windows::PLATFORM);
    }
}
