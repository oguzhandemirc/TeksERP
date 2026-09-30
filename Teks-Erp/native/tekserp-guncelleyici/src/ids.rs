//! Kimlikler: işlem kimliği ve kurulum kaydının `kayitId`si (RFC 9562 v4 UUID; Zod `z.uuid()` geçer).
pub fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    // İşletim sistemi rastgelesi yoksa (olağandışı) saat + süreç kimliğinden türetilir: kimlik tekillik
    // içindir, gizlilik değil.
    if getrandom::fill(&mut b).is_err() {
        let seed = u128::from(std::process::id()) << 64 | u128::try_from(tekserp_hizmet::timefmt::now_ms()).unwrap_or(0);
        b = seed.to_le_bytes();
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// Tohumdan türetilmiş v4 biçimli UUID — yeniden koşulan adım aynı kimliği üretsin (kurulum kaydı
/// `kayitId` ile tekilleşir: aynı işlemin ikinci yazımı çift kayıt doğurmaz).
pub fn derived_uuid(seed: &str) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(seed.as_bytes());
    let mut b = [0u8; 16];
    b.copy_from_slice(&d[..16]);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

#[cfg(test)]
mod tests {
    #[test]
    fn v4_format() {
        let u = super::uuid_v4();
        assert_eq!(u.len(), 36);
        assert_eq!(&u[14..15], "4");
        assert!(matches!(&u[19..20], "8" | "9" | "a" | "b"), "{u}");
        assert_ne!(u, super::uuid_v4());
    }
}
