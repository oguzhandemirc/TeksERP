//! Tek güncelleyici süreci (§7): `is\kilit` paylaşımsız açık tutulur; ikinci süreç (elle koşulan CLI
//! dahil) `KILIT_DOLU` ile çıkar. Windows'ta paylaşım kipi 0; Unix'te (geliştirme) `flock` yerine
//! dosya içeriğindeki süreç kimliği — yalnız geliştirme içindir.
use std::fs::File;
use std::path::Path;

pub struct Lock(#[allow(dead_code)] File);

pub fn acquire(p: &Path) -> Result<Lock, String> {
    crate::platform::open_lock_file(p).map(Lock)
}
