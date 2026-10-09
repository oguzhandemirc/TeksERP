//! Linux kendi yerleşimi (L-A, plan §4.7): yeni ikili çalışanın ÜZERİNE tek `rename(2)` ile iner (çalışan süreç eski
//! inode'da sürer). Taban birimin `ExecStart`ı donmuştur (§4.3), komut satırı hiç değişmez.
use crate::platform::{KendiArkaUcu, KendiYerlesim};
use std::path::{Path, PathBuf};

pub struct AtomikAdlandirma;

impl KendiArkaUcu for AtomikAdlandirma {
    fn yerlesim(&self) -> KendiYerlesim {
        KendiYerlesim::AtomikAdlandirma
    }

    fn asil_ad(&self) -> &'static str {
        "tekserp-guncelleyici"
    }

    fn komut_ikilisi(&self, _komut: &str) -> Option<PathBuf> {
        None
    }

    fn ikiliyi_degistir(&self, _komut: &str, _yeni: &Path) -> Option<String> {
        None
    }
}
