//! Komut satırı argümanları (ikili ve platformun hizmet komutları aynı ayrıştırmayı kullanır).
use std::path::{Path, PathBuf};

pub fn flag_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

pub fn root_arg(args: &[String]) -> Result<PathBuf, String> {
    let r = PathBuf::from(flag_value(args, "--kok").ok_or("--kok <dizin> gerekli")?);
    if !r.is_absolute() {
        return Err(format!("--kok mutlak yol olmalı: {}", r.display()));
    }
    Ok(r)
}

/// `--veri`; verilmezse platformun varsayılanı (`%ProgramData%\TeksERP` — Windows).
pub fn data_arg(args: &[String], root: &Path) -> PathBuf {
    if let Some(d) = flag_value(args, "--veri") {
        return PathBuf::from(d);
    }
    crate::platform::default_data_dir(root)
}
