//! Katı base64url — TS `b64uDecode` (`protocol/ortak.ts`) aynası: dolgu, yabancı karakter ve
//! kanonik olmayan kuyruk biti RED; aynı imzanın iki yazımı olamaz.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

pub fn encode(data: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(data)
}

pub fn decode_strict(text: &str) -> Option<Vec<u8>> {
    let alphabet_ok = text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if !alphabet_ok || text.len() % 4 == 1 {
        return None;
    }
    let data = URL_SAFE_NO_PAD.decode(text).ok()?;
    if encode(&data) != text {
        return None;
    }
    Some(data)
}

/// Tam `n` baytlık katı çözüm (anahtar, imza, özet).
pub fn decode_exact<const N: usize>(text: &str) -> Option<[u8; N]> {
    let data = decode_strict(text)?;
    data.try_into().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_rules() {
        assert_eq!(decode_strict(""), Some(vec![]));
        assert_eq!(decode_strict("QQ"), Some(b"A".to_vec()));
        assert_eq!(decode_strict("QR"), None, "kanonik olmayan kuyruk biti");
        assert_eq!(decode_strict("QQ=="), None, "dolgu");
        assert_eq!(decode_strict("Q"), None, "uzunluk % 4 == 1");
        assert_eq!(decode_strict("a+b/"), None, "standart alfabe");
    }
}
