//! Modül anahtarı açma — Faz 2d için arayüz. Biçim `.tkenc` alıcı sarmasının kalıbıdır
//! (`lib/backup-crypto/stream.ts` `wrapFor`): geçici X25519 → ortak sır → HKDF-SHA256
//! (tuz = geçici açık ‖ alıcı açık) → AES-256-GCM (sıfır nonce: anahtar her sarmada tektir).
//! Fark: HKDF bilgisine MODÜL ADI girer — `finance` için sarılmış anahtar başka modülün yerine
//! geçemez. TS başvuru uygulaması `lib/license/module-key.ts` (sarma satıcı tarafındadır).
use crate::b64;
use crate::jsonx::{js_number, utf16_len};
use crate::outcome::{code, fail, Outcome};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use hkdf::Hkdf;
use regex::Regex;
use serde_json::Value;
use sha2::Sha256;
use std::sync::OnceLock;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

pub const HKDF_INFO_PREFIX: &str = "tekserp/modul-anahtari/v1";

fn module_key_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-z][A-Za-z0-9]*([.-][A-Za-z0-9]+)*$").expect("modul"))
}

pub fn hkdf_info(module: &str) -> String {
    format!("{HKDF_INFO_PREFIX}\u{1f}{module}")
}

/// Sarmayı açar; başarıda 32 baytlık modül anahtarı (bellekte sıfırlanır).
pub fn unwrap(wrap: &Value, private_key_b64: &str, expected_module: &str) -> Outcome<Zeroizing<[u8; 32]>> {
    let Value::Object(w) = wrap else {
        return fail(code::MODUL_SARMA_BICIM, "Modül sarması bir JSON nesnesi değil");
    };
    if w.get("v").and_then(js_number) != Some(1.0) {
        return fail(code::MODUL_SARMA_BICIM, "Desteklenmeyen modül sarması sürümü");
    }
    let module = match w.get("modul") {
        Some(Value::String(m)) if utf16_len(m) <= 64 && module_key_re().is_match(m) => m.as_str(),
        _ => return fail(code::MODUL_SARMA_BICIM, "Modül sarmasında modül adı geçersiz"),
    };
    let epk = w.get("epk").and_then(Value::as_str).and_then(b64::decode_exact::<32>);
    let wrapped = w.get("sarili").and_then(Value::as_str).and_then(b64::decode_exact::<48>);
    let (Some(epk), Some(wrapped)) = (epk, wrapped) else {
        return fail(code::MODUL_SARMA_BICIM, "Modül sarması biçimsiz (epk 32 · sarili 48 bayt)");
    };
    if module != expected_module {
        return fail(code::MODUL_UYUSMAZ, format!("Sarma {module} modülüne ait, istenen {expected_module}"));
    }
    let Some(private) = b64::decode_exact::<32>(private_key_b64).map(Zeroizing::new) else {
        return fail(code::MODUL_ANAHTAR_GECERSIZ, "Kurulumun X25519 özel anahtarı biçimsiz");
    };
    let secret = StaticSecret::from(*private);
    let own_public = PublicKey::from(&secret);
    let shared = Zeroizing::new(secret.diffie_hellman(&PublicKey::from(epk)).to_bytes());
    if shared.iter().all(|b| *b == 0) {
        return fail(code::MODUL_ANAHTAR_GECERSIZ, "Geçici anahtar düşük mertebeli (ortak sır sıfır)");
    }
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(&epk);
    salt[32..].copy_from_slice(own_public.as_bytes());
    let mut wrap_key = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(&salt), shared.as_slice())
        .expand(hkdf_info(module).as_bytes(), wrap_key.as_mut_slice())
        .expect("32 bayt HKDF çıktısı her zaman geçerli");
    let cipher = Aes256Gcm::new_from_slice(wrap_key.as_slice()).expect("32 bayt AES anahtarı");
    let Ok(plain) = cipher.decrypt(Nonce::from_slice(&[0u8; 12]), wrapped.as_slice()).map(Zeroizing::new) else {
        return fail(code::MODUL_SARMA_ACILAMADI, "Modül anahtarı açılamadı (başka kuruluma ait ya da kurcalanmış)");
    };
    let mut key = Zeroizing::new([0u8; 32]);
    if plain.len() != 32 {
        return fail(code::MODUL_SARMA_ACILAMADI, "Açılan modül anahtarı 32 bayt değil");
    }
    key.copy_from_slice(&plain);
    Ok(key)
}
