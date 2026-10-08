//! Yerel koruma (Linux, §1.2): sarma YOK — geçici yedek anahtarının gizliliği dizin iznidir: `is/` root 0700
//! (`sys::harden_private_dir`, her turun başında uygulanır ve ölçülür; root = Windows'taki SYSTEM). Burada
//! yalnız biçim imi konur: başka platformun sarılmış verisi (DPAPI) ya da imsiz dosya açılmaz (fail-closed).
use crate::env::{EnvError, EnvResult, Protect};

/// Korunmuş verinin öneki.
pub const IM: &[u8] = b"TEKSERP-YEREL-1\n";

pub struct DirectoryProtect;

impl Protect for DirectoryProtect {
    fn protect(&self, data: &[u8]) -> EnvResult<Vec<u8>> {
        let mut out = Vec::with_capacity(IM.len() + data.len());
        out.extend_from_slice(IM);
        out.extend_from_slice(data);
        Ok(out)
    }

    fn unprotect(&self, data: &[u8]) -> EnvResult<Vec<u8>> {
        data.strip_prefix(IM)
            .map(<[u8]>::to_vec)
            .ok_or_else(|| EnvError("korunmuş veri bu platformun biçiminde değil (Linux dizin koruması imi yok)".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn koruma_gidis_donus_ve_yabanci_bicim_red() {
        let p = DirectoryProtect;
        let w = p.protect(b"gizli").unwrap();
        assert_eq!(p.unprotect(&w).unwrap(), b"gizli");
        assert!(p.unprotect(b"gizli").is_err(), "imsiz veri açıldı");
        assert!(p.unprotect(&[1, 0, 0, 0, 0xd0, 0x8c]).is_err(), "DPAPI biçimi açıldı");
    }
}
