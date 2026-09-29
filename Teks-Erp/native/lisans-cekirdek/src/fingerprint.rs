//! Parmak izi normalleştirme + tuzlu özet — TS `protocol/parmak-izi.ts` aynası. Ham değer bu
//! çekirdekten dışarı ÇIKMAZ: toplayıcı (`collect.rs`) yalnız özeti döndürür.
use crate::b64;
use crate::outcome::{fail, Outcome};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use unicode_normalization::UnicodeNormalization;

pub const FACTORS: [&str; 5] = ["f1", "f2", "f3", "f4", "f5"];
const SALT_MIN_BYTES: usize = 16;

/// Üreticilerin doldurmadığı yer tutucular — TS `PLACEHOLDER_VALUES` ile birebir (bekçi ölçer).
pub const PLACEHOLDER_VALUES: [&str; 12] = [
    "none",
    "null",
    "unknown",
    "defaultstring",
    "tobefilledbyoem",
    "notapplicable",
    "notspecified",
    "systemserialnumber",
    "0123456789",
    "systemproductname",
    "chassisserialnumber",
    "baseboardserialnumber",
];

fn is_uniform(text: &str) -> bool {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => chars.all(|c| c == first),
        None => false,
    }
}

/// RAID/sanal birimlerin genel serisi (`volume`, `volume0`…).
fn is_generic_disk_serial(text: &str) -> bool {
    text.strip_prefix("volume").is_some_and(|rest| rest.bytes().all(|b| b.is_ascii_digit()))
}

fn is_hex_len(text: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Etken değerini kararlı biçime getirir; anlamsız/boş değer `None` (ölçülemedi).
pub fn normalize_factor(factor: &str, raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    let alnum: String = raw.nfkc().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect();
    if alnum.is_empty() || PLACEHOLDER_VALUES.contains(&alnum.as_str()) || is_uniform(&alnum) {
        return None;
    }
    let ok = match factor {
        "f1" | "f2" => is_hex_len(&alnum, 16, 64),
        "f3" => alnum.len() >= 4 && !is_generic_disk_serial(&alnum),
        "f4" => alnum.len() >= 4,
        "f5" => (1..=20).contains(&alnum.len()) && alnum.bytes().all(|b| b.is_ascii_digit()),
        _ => false,
    };
    ok.then_some(alnum)
}

/// Her etken kendi alan önekiyle özetlenir: aynı değer iki etkende çakışmasın.
pub fn digest_fingerprint(raw: &[Option<String>; 5], salt: &[u8]) -> Outcome<[Option<String>; 5]> {
    if salt.len() < SALT_MIN_BYTES {
        return fail("TUZ_KISA", "digestFingerprint: tuz en az 16 bayt olmalı");
    }
    let mut out: [Option<String>; 5] = Default::default();
    for (i, factor) in FACTORS.iter().enumerate() {
        out[i] = normalize_factor(factor, raw[i].as_deref()).map(|value| {
            let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(salt).expect("HMAC her anahtar boyunu kabul eder");
            mac.update(format!("{factor}\u{1f}{value}").as_bytes());
            b64::encode(&mac.finalize().into_bytes())
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_rules() {
        assert_eq!(
            normalize_factor("f1", Some("{6F1C2B9A-0D3E-4B57-9A11-3C5E7D9F0B24}")).as_deref(),
            Some("6f1c2b9a0d3e4b579a113c5e7d9f0b24")
        );
        assert_eq!(normalize_factor("f3", Some("Volume1")), None);
        assert_eq!(normalize_factor("f4", Some("To Be Filled By O.E.M.")), None);
        assert_eq!(normalize_factor("f4", Some("００１２ＡＢ")).as_deref(), Some("0012ab"), "NFKC tam genişlik");
        assert_eq!(normalize_factor("f5", Some("0000")), None, "tek düze");
        assert_eq!(normalize_factor("f2", None), None);
    }
}
