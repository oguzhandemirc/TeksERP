//! Linux/Docker arka ucu (`GUNCELLEYICI-SAGLAMLIK.md` §1.2). L4a: konak bağları (`sys` — güvenilmez okuma,
//! `statvfs`, yabancı yazar, özel alan, `flock`, süreç grubu + `PDEATHSIG`) · olay günlüğü (`olay`, stderr →
//! journald) · yerel koruma (`koruma`, dizin izni) · dizin düzeni (`duzen`). L4b: Docker hizmet denetimi · sağlık ·
//! araçlar (`docker`, kuruluma `platform::baglam` ile bağlanır). L6: systemd birimi (`birim` — taban birim + ek dosya
//! izin listesi, saf) ve hizmet yapıştırıcısı (`hizmet` — `sd_notify`, gözcü, `hizmet-kur`/`hizmet-kaldir`).
//! Bağlanmamış ortam ve PG (L8) İSKELETTİR: her çağrı `PLATFORM_DESTEKSIZ` önekli açık bir hatadır (fail-closed;
//! süreç düşmez, adım kendi koduyla düşer).
pub mod birim;
pub mod docker;
pub mod duzen;
#[cfg(unix)]
pub mod hizmet;
pub mod kendi;
pub mod koruma;
pub mod olay;
#[cfg(unix)]
pub mod sys;
pub mod tani;

use crate::env::{CmdOut, Env, EnvError, EnvResult, HttpResponse, Services, SvcState};
use crate::settings::BackendEnv;
use crate::tools::MigrationCount;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Bildirim/işaretçi/paket biçiminin platformu (sözleşme 5: `backend-oci` yolu, ustar dış tar) ve işlem günlüğünün
/// `platform`u.
pub const SURUM_PLATFORMU: crate::release::UpdatePlatform = crate::release::UpdatePlatform::LinuxX64Oci;
pub const PLATFORM: &str = SURUM_PLATFORMU.as_str();
/// İskeletin her hatasının öneki.
pub const DESTEKSIZ: &str = "PLATFORM_DESTEKSIZ";

pub(crate) fn unsupported(what: &str) -> String {
    format!("{DESTEKSIZ}: {what} Linux arka ucunda henüz yok")
}

pub fn arka_ucu() -> crate::platform::Arka {
    crate::platform::Arka {
        platform: SURUM_PLATFORMU,
        ortam: crate::settings::OrtamKipi::Compose,
        guncelleyici_paket_yolu: birim::IKILI,
        saglik: Arc::new(IskeletSaglik),
        araclar: Arc::new(IskeletAraclar),
        pg: Arc::new(IskeletPg),
        kendi: Arc::new(kendi::AtomikAdlandirma),
        cit: crate::platform::CitKipi::YenidenBaslatmaPolitikasi,
    }
}

pub struct IskeletSaglik;

impl crate::platform::Saglik for IskeletSaglik {
    fn probe(&self, _env: &Env, _port: u16, path: &str) -> EnvResult<HttpResponse> {
        Err(EnvError(unsupported(&format!("sağlık sondası ({path})"))))
    }
    fn address(&self, _port: u16, path: &str) -> String {
        format!("backend konteyneri {path}")
    }
    fn exit_meaning(&self, _code: u32) -> &'static str {
        "konteyner çıkışı"
    }
}

pub struct IskeletAraclar;

impl crate::platform::Araclar for IskeletAraclar {
    fn migration_count(&self, _env: &Env, _be: &BackendEnv) -> Result<MigrationCount, String> {
        Err(unsupported("göç sayısı"))
    }
    fn finished_migrations(&self, _env: &Env, _be: &BackendEnv) -> Result<Vec<String>, String> {
        Err(unsupported("bitmiş göç adları"))
    }
    fn pg_dump(&self, _env: &Env, _be: &BackendEnv, _out_file: &Path, _timeout: Duration) -> Result<(), String> {
        Err(unsupported("pg_dump"))
    }
    fn pg_restore_list(&self, _env: &Env, _be: &BackendEnv, _dump: &Path) -> Result<(), String> {
        Err(unsupported("pg_restore --list"))
    }
    fn restore_db(&self, _env: &Env, _be: &BackendEnv, _dump: &Path, _timeout: Duration) -> Result<(), String> {
        Err(unsupported("geri yükleme"))
    }
    fn server_version(&self, _env: &Env, _be: &BackendEnv, _bin: &Path) -> Result<String, String> {
        Err(unsupported("SHOW server_version"))
    }
    fn usable_for_backup(&self, _env: &Env, _tools_dir: &Path) -> bool {
        false
    }
    fn backup_keygen(&self, _env: &Env, _tools_dir: &Path, _dir: &Path, _private_out: &Path) -> Result<(), String> {
        Err(unsupported("yedek anahtarı"))
    }
    fn backup_encrypt(
        &self,
        _env: &Env,
        _tools_dir: &Path,
        _input: &Path,
        _output: &Path,
        _recipients: &[PathBuf],
        _timeout: Duration,
    ) -> Result<(), String> {
        Err(unsupported("yedek şifreleme"))
    }
    fn backup_decrypt(
        &self,
        _env: &Env,
        _tools_dir: &Path,
        _input: &Path,
        _output: &Path,
        _key: &Path,
        _timeout: Duration,
    ) -> Result<(), String> {
        Err(unsupported("yedek çözme"))
    }
    fn migrate_deploy(&self, _env: &Env, _version_dir: &Path, _be: &BackendEnv, _timeout: Duration) -> Result<CmdOut, String> {
        Err(unsupported("göç"))
    }
}

/// Linux'ta PG küçük sürümü ilk sürümde KAPALI (§1.1 madde 3; KONTEYNER kipi L8).
pub struct IskeletPg;

impl crate::platform::PgArkaUcu for IskeletPg {
    fn image_path(&self, _env: &Env, service: &str) -> EnvResult<String> {
        Err(EnvError(unsupported(&format!("{service} komut satırı"))))
    }
    fn set_image_path(&self, _env: &Env, service: &str, _command_line: &str) -> EnvResult<()> {
        Err(EnvError(unsupported(&format!("{service} komut satırı"))))
    }
    fn replace_dir(&self, _command_line: &str, _old_dir: &Path, _new_dir: &Path) -> Option<String> {
        None
    }
    fn icu_version(&self, _env: &Env, _dir: &Path) -> Option<String> {
        None
    }
    fn reindex_icu(&self, _env: &Env, _be: &BackendEnv, _pg_dir: &Path, _sql: &str) -> Result<(), String> {
        Err(unsupported("ICU yeniden dizinleme"))
    }
}

/// Kuruluma bağlanmamış ortamın hizmet denetimi (`platform::baglam` öncesi) — her çağrı hata.
pub struct NoServices;
impl Services for NoServices {
    fn state(&self, _name: &str) -> EnvResult<SvcState> {
        Err(EnvError(unsupported("hizmet denetimi")))
    }
    fn start(&self, name: &str, _args: &[&str]) -> EnvResult<()> {
        Err(EnvError(unsupported(&format!("{name}: hizmet denetimi"))))
    }
    fn stop(&self, name: &str) -> EnvResult<()> {
        Err(EnvError(unsupported(&format!("{name}: hizmet denetimi"))))
    }
    fn crash_exit_code(&self, name: &str) -> EnvResult<Option<u32>> {
        Err(EnvError(unsupported(&format!("{name}: hizmet denetimi"))))
    }
    fn image_path(&self, name: &str) -> EnvResult<String> {
        Err(EnvError(unsupported(&format!("{name}: hizmet denetimi"))))
    }
    fn set_image_path(&self, name: &str, _command_line: &str) -> EnvResult<()> {
        Err(EnvError(unsupported(&format!("{name}: hizmet denetimi"))))
    }
}

/// `hizmet` · `hizmet-kur` · `hizmet-kaldir` · `onar --yalniz-asil-ad` (L6: systemd birimi).
#[cfg(unix)]
pub fn service_command(command: &str, args: &[String]) -> Result<u32, String> {
    hizmet::komut(command, args)
}

#[cfg(not(unix))]
pub fn service_command(command: &str, _args: &[String]) -> Result<u32, String> {
    Err(format!("{}: `{command}` — tanı için `tur`", unsupported("hizmet kaydı")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{Araclar, PgArkaUcu, Saglik};

    /// İskelet fail-closed: hiçbir yöntem başarı dönmez ve her hata açık önekle başlar.
    #[test]
    fn iskelet_her_cagrida_acik_hata() {
        let p = Path::new("/yok");
        let layout = crate::layout::Layout::new(p, p);
        let be = crate::settings::backend_env_from_bytes(b"DATABASE_URL=postgresql://u:p@h:5432/d\n", &layout).unwrap();
        let env = Env {
            fs: Arc::new(crate::env::RealFs),
            svc: Arc::new(NoServices),
            procs: Arc::new(crate::env::RealProcs),
            net: Arc::new(crate::env::RealNet::new(None).unwrap()),
            clock: Arc::new(crate::env::SystemClock),
            events: Arc::new(olay::StderrEvents { journald: false }),
            protect: Arc::new(koruma::DirectoryProtect),
            arka: arka_ucu(),
        };
        let a = IskeletAraclar;
        let t = Duration::from_secs(1);
        let errors = [
            a.migration_count(&env, &be).err(),
            a.finished_migrations(&env, &be).err(),
            a.pg_dump(&env, &be, p, t).err(),
            a.pg_restore_list(&env, &be, p).err(),
            a.restore_db(&env, &be, p, t).err(),
            a.server_version(&env, &be, p).err(),
            a.backup_keygen(&env, p, p, p).err(),
            a.backup_encrypt(&env, p, p, p, &[], t).err(),
            a.backup_decrypt(&env, p, p, p, p, t).err(),
            a.migrate_deploy(&env, p, &be, t).err(),
            IskeletSaglik.probe(&env, 4000, "/health/yerel").err().map(|e| e.0),
            IskeletPg.image_path(&env, "pg").err().map(|e| e.0),
            IskeletPg.set_image_path(&env, "pg", "x").err().map(|e| e.0),
            IskeletPg.reindex_icu(&env, &be, p, "SELECT 1").err(),
            NoServices.state("b").err().map(|e| e.0),
            NoServices.start("b", &[]).err().map(|e| e.0),
            NoServices.stop("b").err().map(|e| e.0),
        ];
        for (i, e) in errors.iter().enumerate() {
            assert!(e.as_deref().is_some_and(|m| m.starts_with(DESTEKSIZ)), "{i}: {e:?}");
        }
        assert!(!a.usable_for_backup(&env, p));
        assert_eq!(IskeletPg.replace_dir("x", p, p), None);
        assert_eq!(IskeletPg.icu_version(&env, p), None);
    }
}
