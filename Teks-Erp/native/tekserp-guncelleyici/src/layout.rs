//! Dizin düzeni (§4.1) — `<KOK>` ve `%ProgramData%\TeksERP` altındaki bütün yollar tek yerden.
use std::path::{Path, PathBuf};
use tekserp_hizmet::contract::path as p;

#[derive(Debug, Clone)]
pub struct Layout {
    pub root: PathBuf,
    /// `%ProgramData%\TeksERP` (IPC + güncelleyicinin özel alanı).
    pub data: PathBuf,
    /// Güncelleyicinin KENDİ hizmet adı (`--ad`; ikinci kanalda farklı): W-A ImagePath'i ve `onar` onu işaret eder.
    pub updater_service: String,
}

impl Layout {
    pub fn new(root: &Path, data: &Path) -> Layout {
        Layout { root: root.to_path_buf(), data: data.to_path_buf(), updater_service: tekserp_hizmet::contract::UPDATER_SERVICE.into() }
    }

    pub fn with_service(mut self, name: &str) -> Layout {
        self.updater_service = name.to_string();
        self
    }

    pub fn versions(&self) -> PathBuf {
        self.root.join(p::VERSIONS)
    }
    pub fn version_dir(&self, v: &str) -> PathBuf {
        self.versions().join(v)
    }
    pub fn staging_dir(&self, v: &str) -> PathBuf {
        self.versions().join(format!(".hazirlik-{v}"))
    }
    pub fn current(&self) -> PathBuf {
        self.root.join(p::CURRENT)
    }
    /// Backend ortamı (D3: `<KOK>\yapilandirma\.env`; backend kendisi okur, güncelleyici DATABASE_URL vb. için).
    pub fn backend_env(&self) -> PathBuf {
        self.root.join(p::CONFIG).join(p::ENV_FILE)
    }
    pub fn updater_dir(&self) -> PathBuf {
        self.root.join(p::UPDATER)
    }
    pub fn settings_file(&self) -> PathBuf {
        self.updater_dir().join("ayar.json")
    }
    pub fn default_license_dir(&self) -> PathBuf {
        self.root.join(p::LICENSE)
    }
    /// Güncelleyicinin günlüğü KENDİ dizininde (SYSTEM/Administrators): backend'in yazabildiği `logs\`
    /// altında olsaydı, önceden konan bir bağlantı SYSTEM'in yazısını başka yere yönlendirebilirdi.
    pub fn log_dir(&self) -> PathBuf {
        self.updater_dir().join("gunluk")
    }
    /// Güncelleme öncesi yedekler backend'in ERİŞEMEDİĞİ özel alanda (D3 güvenlik kuralı).
    pub fn update_backups(&self) -> PathBuf {
        self.work().join("yedek")
    }
    pub fn update_backup_dir(&self, op: &str) -> PathBuf {
        self.update_backups().join(op)
    }
    pub fn default_backup_keys(&self) -> PathBuf {
        self.root.join(p::BACKUP_KEYS)
    }
    pub fn pgsql(&self) -> PathBuf {
        self.root.join(p::PGSQL)
    }
    /// `pgsql\bin` junction'ı → etkin sürümün `bin`'i (D4: `PG_BIN_DIR`, yedek/bakım betikleri okur).
    pub fn pg_bin_link(&self) -> PathBuf {
        self.pgsql().join("bin")
    }
    /// Sürüm dizini `pgsql\<surum>-<derleme>` (D4 §0).
    pub fn pg_version_dir(&self, tag: &str) -> PathBuf {
        self.pgsql().join(tag)
    }
    pub fn pg_staging_dir(&self, tag: &str) -> PathBuf {
        self.pgsql().join(format!(".hazirlik-{tag}"))
    }
    /// Örnek kaydı (D4 §6).
    pub fn pg_instance_file(&self) -> PathBuf {
        self.pgsql().join("ornek.json")
    }
    pub fn install_history(&self) -> PathBuf {
        self.root.join(p::INSTALL_HISTORY)
    }

    fn ipc(&self) -> PathBuf {
        self.data.join("guncelleme")
    }
    pub fn intent_file(&self) -> PathBuf {
        self.ipc().join("niyet").join("niyet.json")
    }
    pub fn status_dir(&self) -> PathBuf {
        self.ipc().join("durum")
    }
    pub fn status_file(&self) -> PathBuf {
        self.status_dir().join("durum.json")
    }
    pub fn history_file(&self) -> PathBuf {
        self.status_dir().join("gecmis.jsonl")
    }
    pub fn work(&self) -> PathBuf {
        self.ipc().join("is")
    }
    pub fn journal_file(&self) -> PathBuf {
        self.work().join("islem.jsonl")
    }
    pub fn lock_file(&self) -> PathBuf {
        self.work().join("kilit")
    }
    pub fn downloads(&self) -> PathBuf {
        self.work().join("indirme")
    }
    pub fn manifests(&self) -> PathBuf {
        self.work().join("manifest")
    }
    pub fn ready_markers(&self) -> PathBuf {
        self.work().join("hazir")
    }
    pub fn op_keys(&self, op: &str) -> PathBuf {
        self.work().join("anahtar").join(op)
    }
    pub fn keys_root(&self) -> PathBuf {
        self.work().join("anahtar")
    }
    pub fn self_update_file(&self) -> PathBuf {
        self.work().join("kendi.json")
    }
    /// Karşılıklı onarımın sayacı ve son onarımları (§4.7 madde 4–5).
    pub fn repair_file(&self) -> PathBuf {
        self.work().join("onarim.json")
    }
    /// W2 çitinin işareti: çitin KENDİ koyduğu "Devre dışı" — `onar` bunu yönetici kararı saymaz (§4.7 madde 7).
    pub fn fence_marker(&self) -> PathBuf {
        self.work().join("cit.json")
    }
    /// W-A: sürümlü ikili dizinleri (`guncelleyici\s\<sürüm>\`).
    pub fn updater_versions(&self) -> PathBuf {
        self.updater_dir().join("s")
    }
}
