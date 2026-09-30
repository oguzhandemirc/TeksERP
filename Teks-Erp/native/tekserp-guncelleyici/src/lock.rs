//! Tek güncelleyici süreci (§7): `is\kilit` paylaşımsız açık tutulur; ikinci süreç (elle koşulan CLI
//! dahil) `KILIT_DOLU` ile çıkar. Windows'ta paylaşım kipi 0; Unix'te (geliştirme) `flock` yerine
//! dosya içeriğindeki süreç kimliği — yalnız geliştirme içindir.
use std::fs::File;
use std::path::Path;

pub struct Lock(#[allow(dead_code)] File);

#[cfg(windows)]
pub fn acquire(p: &Path) -> Result<Lock, String> {
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
        .map(Lock)
        .map_err(|_| "başka bir güncelleyici süreci çalışıyor (kilit dolu)".to_string())
}

#[cfg(not(windows))]
pub fn acquire(p: &Path) -> Result<Lock, String> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(p).map(Lock).map_err(|e| e.to_string())
}
