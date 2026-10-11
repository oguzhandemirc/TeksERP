//! Sistem hesabı mührü (G1) — kurulum anahtarıyla (Ed25519) imzalı hesap satırı. Özel yarıyı JS'ten
//! ALMAZ: anahtar dosyasını (`LICENSE_DIR/kurulum-anahtari.json`) kendisi okur; kurulum kimliği (`kid`)
//! de anahtardan burada türer. TS aynası `Teks-Erp/src/lib/license/system-seal.ts`
//! (mesaj biçimi, belge kuralları ve durum adları bayt bayt aynıdır).
use crate::b64;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use zeroize::Zeroizing;

pub const KEY_FILE: &str = "kurulum-anahtari.json";
pub const MESSAGE_HEADER: &str = "TEKSERP-SISTEM-HESABI-MUHRU/v1";
pub const SEAL_PREFIX: &str = "sm1";
/// Anahtar dosyası birkaç yüz bayttır (TS `MAX_KEY_BYTES` ile aynı tavan).
const MAX_KEY_BYTES: u64 = 8 * 1024;
/// Node'un Ed25519 PKCS#8 (v1, açık anahtarsız) dışa aktarımının sabit öneki; ardından 32 bayt tohum.
const PKCS8_PREFIX: [u8; 16] = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
const MAX_NAME_BYTES: usize = 200;

pub const DURUM_MUHURLENDI: &str = "MUHURLENDI";
pub const DURUM_GECERLI: &str = "GECERLI";
pub const DURUM_BOZUK: &str = "BOZUK";
pub const DURUM_BASKA_KURULUM: &str = "BASKA_KURULUM";
pub const DURUM_BICIMSIZ: &str = "BICIMSIZ";
pub const DURUM_BELGE_BICIMSIZ: &str = "BELGE_BICIMSIZ";
pub const DURUM_ANAHTAR_YOK: &str = "ANAHTAR_YOK";
pub const DURUM_ANAHTAR_BOZUK: &str = "ANAHTAR_BOZUK";

/// Mühürlenen alanlar (TS `SistemHesabiBelgesi`).
pub struct SealDoc {
    pub id: String,
    pub name: String,
    pub credential: String,
}

struct InstallationKey {
    signing: SigningKey,
    kid: String,
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_digit() || (b'a'..=b'f').contains(&b),
        })
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_NAME_BYTES && !s.chars().any(|c| c.is_control())
}

/// İstekteki `belge` → doğrulanmış alanlar; biçimsizse `None` (çağıran `BELGE_BICIMSIZ` döner).
pub fn parse_doc(v: &Value) -> Option<SealDoc> {
    let id = v.get("id")?.as_str()?;
    let name = v.get("ad")?.as_str()?;
    let credential = v.get("kimlik")?.as_str()?;
    (is_uuid(id) && is_name(name) && is_sha256_hex(credential)).then(|| SealDoc {
        id: id.into(),
        name: name.into(),
        credential: credential.into(),
    })
}

/// İmzalanan bayt dizisi — TS `sistemHesabiMesaji` ile aynı.
pub fn message(kid: &str, doc: &SealDoc) -> String {
    format!("{MESSAGE_HEADER}\nkid:{kid}\nid:{}\nad:{}\nsistem:1\nkimlik:{}", doc.id, doc.name, doc.credential)
}

/// `kur-` + base64url(sha256(açık anahtar)) — TS `installationKeyId` ile aynı.
pub fn installation_kid(public_key: &[u8; 32]) -> String {
    format!("kur-{}", b64::encode(&Sha256::digest(public_key)))
}

fn read_key(dir: &str) -> Result<InstallationKey, &'static str> {
    let path = Path::new(dir).join(KEY_FILE);
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(DURUM_ANAHTAR_YOK),
        Err(_) => return Err(DURUM_ANAHTAR_BOZUK),
    };
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_KEY_BYTES {
        return Err(DURUM_ANAHTAR_BOZUK);
    }
    let text = Zeroizing::new(std::fs::read_to_string(&path).map_err(|_| DURUM_ANAHTAR_BOZUK)?);
    let file: Value = serde_json::from_str(&text).map_err(|_| DURUM_ANAHTAR_BOZUK)?;
    if file.get("v").and_then(Value::as_u64) != Some(1) {
        return Err(DURUM_ANAHTAR_BOZUK);
    }
    let ed = file.get("ed25519").ok_or(DURUM_ANAHTAR_BOZUK)?;
    let pkcs8 = Zeroizing::new(ed.get("pkcs8").and_then(Value::as_str).and_then(b64::decode_strict).ok_or(DURUM_ANAHTAR_BOZUK)?);
    let x = ed.get("x").and_then(Value::as_str).ok_or(DURUM_ANAHTAR_BOZUK)?;
    if pkcs8.len() != PKCS8_PREFIX.len() + 32 || pkcs8[..PKCS8_PREFIX.len()] != PKCS8_PREFIX {
        return Err(DURUM_ANAHTAR_BOZUK);
    }
    let mut seed = Zeroizing::new([0u8; 32]);
    seed.copy_from_slice(&pkcs8[PKCS8_PREFIX.len()..]);
    let signing = SigningKey::from_bytes(&seed);
    let public = signing.verifying_key().to_bytes();
    // Dosyadaki açık yarı özel yarıdan türeyenle aynı olmalı (TS `keyFromFile` ile aynı tutarlılık şartı).
    if b64::encode(&public) != x {
        return Err(DURUM_ANAHTAR_BOZUK);
    }
    Ok(InstallationKey { signing, kid: installation_kid(&public) })
}

/// Mühür metni: `sm1.<kid>.<imza>`.
pub fn seal_text(kid: &str, signature: &[u8; 64]) -> String {
    format!("{SEAL_PREFIX}.{kid}.{}", b64::encode(signature))
}

/// `{dizin, belge}` → `{durum: MUHURLENDI, muhur, kid}` ya da `{durum: <neden>}`.
pub fn seal(req: &Value) -> Value {
    let Some(doc) = req.get("belge").and_then(parse_doc) else {
        return json!({ "durum": DURUM_BELGE_BICIMSIZ });
    };
    let Some(dir) = req.get("dizin").and_then(Value::as_str) else {
        return json!({ "durum": DURUM_ANAHTAR_YOK });
    };
    match read_key(dir) {
        Err(d) => json!({ "durum": d }),
        Ok(key) => {
            let signature = key.signing.sign(message(&key.kid, &doc).as_bytes()).to_bytes();
            json!({ "durum": DURUM_MUHURLENDI, "muhur": seal_text(&key.kid, &signature), "kid": key.kid })
        }
    }
}

/// `sm1.<kid>.<imza>` → (kid, imza); biçimsizse `None`.
pub fn parse_seal(text: &str) -> Option<(String, [u8; 64])> {
    let mut parts = text.split('.');
    let (prefix, kid, sig) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || prefix != SEAL_PREFIX || !kid.starts_with("kur-") || b64::decode_exact::<32>(&kid[4..]).is_none() {
        return None;
    }
    Some((kid.to_string(), b64::decode_exact::<64>(sig)?))
}

/// `{dizin, belge, muhur}` → `{durum: GECERLI | BOZUK | BASKA_KURULUM | BICIMSIZ | BELGE_BICIMSIZ | ANAHTAR_*}`.
pub fn verify(req: &Value) -> Value {
    let Some(doc) = req.get("belge").and_then(parse_doc) else {
        return json!({ "durum": DURUM_BELGE_BICIMSIZ });
    };
    let Some(dir) = req.get("dizin").and_then(Value::as_str) else {
        return json!({ "durum": DURUM_ANAHTAR_YOK });
    };
    let key = match read_key(dir) {
        Err(d) => return json!({ "durum": d }),
        Ok(k) => k,
    };
    let Some((kid, signature)) = req.get("muhur").and_then(Value::as_str).and_then(parse_seal) else {
        return json!({ "durum": DURUM_BICIMSIZ, "kid": key.kid });
    };
    if kid != key.kid {
        return json!({ "durum": DURUM_BASKA_KURULUM, "kid": key.kid });
    }
    let ok = key.signing.verifying_key().verify(message(&key.kid, &doc).as_bytes(), &Signature::from_bytes(&signature)).is_ok();
    json!({ "durum": if ok { DURUM_GECERLI } else { DURUM_BOZUK }, "kid": key.kid })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0b9a4c1e-5f3d-4e2a-9c7b-1d2e3f4a5b6c";
    const CRED: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    fn key_dir(seed: u8) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("muhur-test-{}-{seed}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        let signing = SigningKey::from_bytes(&[seed; 32]);
        let mut der = PKCS8_PREFIX.to_vec();
        der.extend_from_slice(&[seed; 32]);
        let body = json!({ "v": 1, "ed25519": { "pkcs8": b64::encode(&der), "x": b64::encode(&signing.verifying_key().to_bytes()) } });
        std::fs::write(dir.join(KEY_FILE), body.to_string()).unwrap();
        dir
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    fn doc(name: &str, cred: &str) -> Value {
        json!({ "id": ID, "ad": name, "kimlik": cred })
    }

    fn seal_in(dir: &Path, d: Value) -> String {
        let out = seal(&json!({ "dizin": dir.to_str().unwrap(), "belge": d }));
        assert_eq!(out["durum"], DURUM_MUHURLENDI, "{out}");
        out["muhur"].as_str().unwrap().to_string()
    }

    fn verify_in(dir: &Path, d: Value, muhur: &str) -> String {
        verify(&json!({ "dizin": dir.to_str().unwrap(), "belge": d, "muhur": muhur }))["durum"].as_str().unwrap().to_string()
    }

    #[test]
    fn seal_roundtrip_and_tamper() {
        let dir = key_dir(7);
        let m = seal_in(&dir, doc("bakim", CRED));
        assert_eq!(verify_in(&dir, doc("bakim", CRED), &m), DURUM_GECERLI);
        assert_eq!(verify_in(&dir, doc("bakim2", CRED), &m), DURUM_BOZUK, "ad değişti");
        let other_cred = CRED.replace('9', "8");
        assert_eq!(verify_in(&dir, doc("bakim", &other_cred), &m), DURUM_BOZUK, "kimlik özeti değişti");
        let mut flipped = m.clone().into_bytes();
        let last = flipped.len() - 2;
        flipped[last] = if flipped[last] == b'A' { b'B' } else { b'A' };
        let flipped = String::from_utf8(flipped).unwrap();
        assert!(matches!(verify_in(&dir, doc("bakim", CRED), &flipped).as_str(), DURUM_BOZUK | DURUM_BICIMSIZ));
        assert_eq!(verify_in(&dir, doc("bakim", CRED), "sm1.x.y"), DURUM_BICIMSIZ);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn other_installation_rejected() {
        let (a, b) = (key_dir(1), key_dir(2));
        let m = seal_in(&a, doc("bakim", CRED));
        assert_eq!(verify_in(&b, doc("bakim", CRED), &m), DURUM_BASKA_KURULUM);
        std::fs::remove_dir_all(a).ok();
        std::fs::remove_dir_all(b).ok();
    }

    #[test]
    fn missing_or_broken_key() {
        let empty = std::env::temp_dir().join(format!("muhur-bos-{}", rand_suffix()));
        std::fs::create_dir_all(&empty).unwrap();
        let out = seal(&json!({ "dizin": empty.to_str().unwrap(), "belge": doc("bakim", CRED) }));
        assert_eq!(out["durum"], DURUM_ANAHTAR_YOK);
        std::fs::write(empty.join(KEY_FILE), "{\"v\":1}").unwrap();
        let out = seal(&json!({ "dizin": empty.to_str().unwrap(), "belge": doc("bakim", CRED) }));
        assert_eq!(out["durum"], DURUM_ANAHTAR_BOZUK);
        std::fs::remove_dir_all(empty).ok();
    }

    #[test]
    fn malformed_doc_rejected() {
        let dir = key_dir(3);
        for bad in [
            json!({ "id": "nope", "ad": "bakim", "kimlik": CRED }),
            json!({ "id": ID, "ad": "", "kimlik": CRED }),
            json!({ "id": ID, "ad": "a\nb", "kimlik": CRED }),
            json!({ "id": ID, "ad": "bakim", "kimlik": "ABC" }),
            json!({ "id": ID.to_uppercase(), "ad": "bakim", "kimlik": CRED }),
        ] {
            let out = seal(&json!({ "dizin": dir.to_str().unwrap(), "belge": bad }));
            assert_eq!(out["durum"], DURUM_BELGE_BICIMSIZ);
        }
        std::fs::remove_dir_all(dir).ok();
    }

    /// TS protokolüyle aynı bayt: sabit tohum (7×32) + sabit belge → sabit mühür (Ed25519 belirlenimli).
    /// Değer `scripts/test_lisans_native_kahin.ts` §11'in TS tarafıyla üretildi; kâhin aynı kaydı canlı da ölçer.
    #[test]
    fn known_vector() {
        let dir = key_dir(7);
        let m = seal_in(&dir, doc("bakim", CRED));
        assert_eq!(m, include_str!("../test-vektorleri/sistem-hesabi-muhru.txt").trim());
        std::fs::remove_dir_all(dir).ok();
    }
}
