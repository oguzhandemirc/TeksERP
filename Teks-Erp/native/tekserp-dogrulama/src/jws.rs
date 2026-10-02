//! JWS compact (RFC 7515) + EdDSA/Ed25519 (RFC 8037) — TS `protocol/jws.ts` aynası.
//! Denetim SIRASI da aynıdır (kod eşliği): başlık JSON → `alg` (başka hiçbir alana
//! bakılmadan) → allowlist dışı alan → `typ` → `kid` → yük nesnesi → imza uzunluğu;
//! doğrulamada beklenen `typ` → `kid` ile anahtar → imza.
use crate::b64;
use crate::jsonx;
use crate::outcome::{code, fail, Outcome};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use regex::Regex;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

pub const ALG: &str = "EdDSA";
/// UTF-16 kod birimi (JS `string.length`).
pub const MAX_LENGTH: usize = 32 * 1024;
const SIGNATURE_LENGTH: usize = 64;
const ALLOWED_HEADER_FIELDS: [&str; 3] = ["alg", "typ", "kid"];

fn kid_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-z]+-[A-Za-z0-9_-]{1,64}$").expect("kid regex"))
}

fn typ_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^tekserp-[a-z]+$").expect("typ regex"))
}

#[derive(Debug, Clone)]
pub struct Header {
    pub typ: String,
    pub kid: String,
}

#[derive(Debug, Clone)]
pub struct Parsed {
    pub header: Header,
    pub payload: Map<String, Value>,
    pub signing_input: Vec<u8>,
    pub signature: [u8; SIGNATURE_LENGTH],
}

impl Parsed {
    /// Dışa dönen görünüm: `{header: {alg, typ, kid}, payload}` (imza baytları dışarı çıkmaz).
    pub fn view(&self) -> Value {
        serde_json::json!({
            "header": { "alg": ALG, "typ": self.header.typ, "kid": self.header.kid },
            "payload": Value::Object(self.payload.clone()),
        })
    }
}

fn decode_json_part(part: &str) -> Option<Value> {
    let raw = b64::decode_strict(part)?;
    jsonx::parse_lossy(&raw)
}

fn check_header(raw: Option<Value>) -> Outcome<Header> {
    let Some(Value::Object(h)) = raw else {
        return fail(code::JWS_BICIM, "JWS başlığı bir JSON nesnesi değil");
    };
    if h.get("alg") != Some(&Value::String(ALG.to_string())) {
        return fail(code::JWS_ALG, format!("Desteklenmeyen imza algoritması: {}", jsonx::js_string(h.get("alg"))));
    }
    if let Some(extra) = h.keys().find(|k| !ALLOWED_HEADER_FIELDS.contains(&k.as_str())) {
        return fail(code::JWS_BASLIK, format!("İzin verilmeyen başlık alanı: {extra}"));
    }
    let typ = match h.get("typ") {
        Some(Value::String(t)) if typ_re().is_match(t) => t.clone(),
        _ => return fail(code::JWS_TYP, "Belge türü (typ) eksik ya da geçersiz"),
    };
    let kid = match h.get("kid") {
        Some(Value::String(k)) if kid_re().is_match(k) => k.clone(),
        _ => return fail(code::JWS_KID, "Anahtar kimliği (kid) eksik ya da geçersiz"),
    };
    Ok(Header { typ, kid })
}

/// İmzayı DOĞRULAMADAN ayrıştırır — yalnız anahtar bulmak ya da gömülü sertifikayı çıkarmak için.
pub fn parse(token: &Value) -> Outcome<Parsed> {
    let text = match token {
        Value::String(s) if !s.is_empty() && jsonx::utf16_len(s) <= MAX_LENGTH => s.as_str(),
        _ => return fail(code::JWS_BICIM, "JWS metni boş, metin değil ya da çok uzun"),
    };
    let parts: Vec<&str> = text.split('.').collect();
    if parts.len() != 3 {
        return fail(code::JWS_BICIM, "JWS üç parçalı olmalı");
    }
    let header = check_header(decode_json_part(parts[0]))?;
    let Some(Value::Object(payload)) = decode_json_part(parts[1]) else {
        return fail(code::JWS_BICIM, "JWS yükü bir JSON nesnesi değil");
    };
    let Some(signature) = b64::decode_exact::<SIGNATURE_LENGTH>(parts[2]) else {
        return fail(code::JWS_BICIM, "İmza parçası geçersiz");
    };
    Ok(Parsed { header, payload, signing_input: format!("{}.{}", parts[0], parts[1]).into_bytes(), signature })
}

/// Belgenin bayt özeti (TS `jwsDigest`): compact metnin sha256'sı, base64url (43). Kiranın `hakOzeti` bağı buna bakar.
pub fn digest(token: &str) -> String {
    b64::encode(&Sha256::digest(token.as_bytes()))
}

/// Ed25519 doğrulaması (cofactor'suz, kanonik olmayan S RED — OpenSSL `EVP_DigestVerify` ile aynı).
/// Nokta olmayan açık anahtar imzasız sayılır (TS'te anahtar içe aktarılır, doğrulama düşer).
pub fn ed25519_verify(public_key: &[u8; 32], message: &[u8], signature: &[u8; SIGNATURE_LENGTH]) -> bool {
    let Ok(key) = VerifyingKey::from_bytes(public_key) else {
        return false;
    };
    key.verify(message, &Signature::from_bytes(signature)).is_ok()
}

/// `kid` → ham 32 baytlık Ed25519 açık anahtarı; bilinmeyen kid için `None`.
pub fn verify(token: &Value, typ: &str, find_key: impl Fn(&str) -> Option<[u8; 32]>) -> Outcome<Parsed> {
    let parsed = parse(token)?;
    if parsed.header.typ != typ {
        return fail(code::JWS_TYP, format!("Beklenen belge türü {typ}, gelen {}", parsed.header.typ));
    }
    let Some(key) = find_key(&parsed.header.kid) else {
        return fail(code::JWS_KID, format!("Bilinmeyen anahtar kimliği: {}", parsed.header.kid));
    };
    if !ed25519_verify(&key, &parsed.signing_input, &parsed.signature) {
        return fail(code::JWS_IMZA, "İmza doğrulanamadı");
    }
    Ok(parsed)
}
