//! Windows kendi yerleşimi (W-A, plan §4.7): çalışan imajın üzerine yeniden adlandırılamaz, bu yüzden asıl ad hiç
//! değişmez — yeni ikili `guncelleyici\s\<sürüm>\`e konur ve hizmetin komut satırı (ImagePath) TEK kayıt yazımıyla
//! ona çevrilir. Komut satırı `windows-service`in kurduğu biçimdedir: ikili boşluk taşıyorsa tırnaklı, sonra argümanlar.
use crate::platform::{KendiArkaUcu, KendiYerlesim};
use std::path::{Path, PathBuf};

pub struct SurumluImagePath;

/// Komut satırını (ikili, kalan) diye böler; kalan baştaki boşluğuyla aynen döner.
fn split(komut: &str) -> Option<(&str, &str)> {
    let t = komut.trim_start();
    if let Some(rest) = t.strip_prefix('"') {
        let end = rest.find('"')?;
        Some((&rest[..end], &rest[end + 1..]))
    } else {
        let end = t.find([' ', '\t']).unwrap_or(t.len());
        Some((&t[..end], &t[end..]))
    }
    .filter(|(exe, _)| !exe.is_empty())
}

impl KendiArkaUcu for SurumluImagePath {
    fn yerlesim(&self) -> KendiYerlesim {
        KendiYerlesim::SurumluYol
    }

    fn asil_ad(&self) -> &'static str {
        tekserp_hizmet::contract::path::UPDATER_EXE
    }

    fn komut_ikilisi(&self, komut: &str) -> Option<PathBuf> {
        split(komut).map(|(exe, _)| PathBuf::from(exe))
    }

    fn ikiliyi_degistir(&self, komut: &str, yeni: &Path) -> Option<String> {
        let (_, rest) = split(komut)?;
        let exe = yeni.to_str()?;
        if exe.is_empty() || exe.contains('"') {
            return None;
        }
        let exe = if exe.contains([' ', '\t']) { format!("\"{exe}\"") } else { exe.to_string() };
        Some(format!("{exe}{rest}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoted_and_plain_image_paths_round_trip() {
        let k = SurumluImagePath;
        let q = r#""C:\Program Files\TeksERP\guncelleyici\tekserp-guncelleyici.exe" hizmet --kok "C:\Program Files\TeksERP" --ad TeksERP-Guncelleyici"#;
        assert_eq!(k.komut_ikilisi(q), Some(PathBuf::from(r"C:\Program Files\TeksERP\guncelleyici\tekserp-guncelleyici.exe")));
        let n = k.ikiliyi_degistir(q, Path::new(r"C:\Program Files\TeksERP\guncelleyici\s\9.9.9\tekserp-guncelleyici.exe")).unwrap();
        assert_eq!(
            n,
            r#""C:\Program Files\TeksERP\guncelleyici\s\9.9.9\tekserp-guncelleyici.exe" hizmet --kok "C:\Program Files\TeksERP" --ad TeksERP-Guncelleyici"#
        );
        let p = r"C:\TeksERP\guncelleyici\tekserp-guncelleyici.exe hizmet --kok C:\TeksERP";
        assert_eq!(k.komut_ikilisi(p), Some(PathBuf::from(r"C:\TeksERP\guncelleyici\tekserp-guncelleyici.exe")));
        assert_eq!(
            k.ikiliyi_degistir(p, Path::new(r"C:\TeksERP\guncelleyici\s\1.2.3\tekserp-guncelleyici.exe")).unwrap(),
            r"C:\TeksERP\guncelleyici\s\1.2.3\tekserp-guncelleyici.exe hizmet --kok C:\TeksERP"
        );
        // Argümansız komut satırı ve boş/bozuk satır.
        assert_eq!(k.ikiliyi_degistir(r"C:\a.exe", Path::new(r"C:\b.exe")).as_deref(), Some(r"C:\b.exe"));
        assert_eq!(k.komut_ikilisi(""), None);
        assert_eq!(k.komut_ikilisi("\"C:\\yarim"), None);
        assert_eq!(k.ikiliyi_degistir(p, Path::new("C:\\x\"y.exe")), None);
    }
}
