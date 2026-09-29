//! JSON sınırı: napi yapıştırıcısı (`napi_api.rs`) ve `tests/vektorler.rs` AYNI fonksiyonları
//! çağırır — test edilen yüzey, Node'un gördüğü yüzeydir. İstek/yanıt biçimi TS
//! `lib/license/native.ts` ile sözleşmedir; yanıt `{ok, value}` | `{ok:false, code, message}`.
use crate::anchor;
use crate::b64;
use crate::chain::{self, RootKey};
use crate::collect;
use crate::fingerprint::{self, FACTORS, PLACEHOLDER_VALUES};
use crate::integrity;
use crate::jsonx::js_number;
use crate::jws;
use crate::module_key;
use crate::outcome::{code, Fail, Outcome};
use serde_json::{json, Value};

/// Arayüz sürümü: istek/yanıt biçimi kırılınca artar; yükleyici eşit değilse native'i KULLANMAZ.
pub const ABI: u32 = 2;
pub const TEST_ANCHOR: bool = cfg!(feature = "test-anchor");

fn ok(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

fn err(f: Fail) -> Value {
    json!({ "ok": false, "code": f.code, "message": f.message })
}

fn outcome(o: Outcome<Value>) -> Value {
    o.map_or_else(err, ok)
}

fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

fn node_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        other => other,
    }
}

/// Yükleyicinin uyum denetimi ve kâhin bekçisinin ayna ölçümü buradan okur.
pub fn identity() -> Value {
    json!({
        "ad": "lisans-cekirdek",
        "surum": env!("CARGO_PKG_VERSION"),
        "abi": ABI,
        "platform": node_platform(),
        "arch": node_arch(),
        "hedef": env!("LISANS_CEKIRDEK_HEDEF"),
        "profil": if cfg!(debug_assertions) { "debug" } else { "release" },
        "testCapasi": TEST_ANCHOR,
        "protokolKodlari": code::PROTOCOL,
        "cekirdekKodlari": code::CORE,
        "yerTutucular": PLACEHOLDER_VALUES,
        "windowsSondasi": collect::WINDOWS_PROBE_LINES,
        "modulHkdfOneki": module_key::HKDF_INFO_PREFIX,
    })
}

pub fn builtin_anchor() -> Value {
    let roots: Vec<Value> = anchor::builtin_roots().iter().map(|r| json!({ "kid": r.kid, "x": r.x, "classes": r.classes })).collect();
    let package: Vec<Value> = anchor::builtin_package_keys().iter().map(|(kid, x)| json!({ "kid": kid, "x": x })).collect();
    json!({ "roots": roots, "packageKeys": package })
}

/// İstekteki çapa: yoksa GÖMÜLÜ çapa; varsa yalnız test derlemesi kabul eder.
fn roots_from(req: &Value) -> Outcome<Vec<RootKey>> {
    let Some(given) = req.get("roots") else {
        return Ok(anchor::builtin_roots());
    };
    if !TEST_ANCHOR {
        return Err(Fail {
            code: code::CAPA_ENJEKSIYONU_KAPALI,
            message: "Bu derleme dışarıdan güven çapası kabul etmez (yalnız gömülü çapa)".into(),
        });
    }
    let parsed = given.as_array().map(|list| {
        list.iter()
            .map(|r| {
                Some(RootKey {
                    kid: r.get("kid")?.as_str()?.to_string(),
                    x: r.get("x")?.as_str()?.to_string(),
                    classes: r.get("classes")?.as_array()?.iter().map(|c| c.as_str().map(str::to_string)).collect::<Option<_>>()?,
                })
            })
            .collect::<Option<Vec<_>>>()
    });
    match parsed.flatten() {
        Some(roots) => Ok(roots),
        None => Err(Fail { code: code::GUVEN_CAPASI_BICIM, message: "Güven çapası biçimsiz".into() }),
    }
}

fn token(req: &Value, field: &str) -> Value {
    req.get(field).cloned().unwrap_or(Value::Null)
}

pub fn verify_jws(req: &Value) -> Value {
    let typ = req.get("typ").and_then(Value::as_str).unwrap_or_default();
    let keys: Vec<(String, Option<[u8; 32]>)> = req
        .get("keys")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|k| {
                    let kid = k.get("kid")?.as_str()?.to_string();
                    Some((kid, k.get("x").and_then(Value::as_str).and_then(b64::decode_exact::<32>)))
                })
                .collect()
        })
        .unwrap_or_default();
    let find = |kid: &str| keys.iter().find(|(k, _)| k == kid).and_then(|(_, key)| *key);
    outcome(jws::verify(&token(req, "token"), typ, find).map(|p| p.view()))
}

pub fn verify_certificate(req: &Value) -> Value {
    let run = || -> Outcome<Value> {
        let roots = roots_from(req)?;
        let usage = req.get("usage").and_then(Value::as_str).unwrap_or_default();
        let at_ms = req.get("atMs").and_then(js_number).unwrap_or(f64::NAN);
        Ok(chain::verify_certificate(&token(req, "token"), &roots, usage, at_ms)?.view())
    };
    outcome(run())
}

pub fn verify_entitlement(req: &Value) -> Value {
    outcome(roots_from(req).and_then(|roots| Ok(chain::verify_entitlement(&token(req, "token"), &roots)?.view())))
}

pub fn verify_lease(req: &Value) -> Value {
    outcome(roots_from(req).and_then(|roots| Ok(chain::verify_lease(&token(req, "token"), &roots)?.view())))
}

/// İki belgeyi doğrular ve bağlar — JS'ten gelen "doğrulanmış" görünüme güvenilmez.
pub fn check_lease_binding(req: &Value) -> Value {
    let run = || -> Outcome<Value> {
        let roots = roots_from(req)?;
        let lease = chain::verify_lease(&token(req, "lease"), &roots)?;
        let entitlement = chain::verify_entitlement(&token(req, "entitlement"), &roots)?;
        chain::check_lease_binding(&lease, &entitlement)?;
        Ok(Value::Bool(true))
    };
    outcome(run())
}

pub fn normalize_factor(req: &Value) -> Value {
    let factor = req.get("factor").and_then(Value::as_str).unwrap_or_default();
    let raw = req.get("raw").and_then(Value::as_str);
    json!({ "value": fingerprint::normalize_factor(factor, raw) })
}

fn raw_factors(req: &Value) -> [Option<String>; 5] {
    let raw = req.get("raw");
    FACTORS.map(|f| raw.and_then(|r| r.get(f)).and_then(Value::as_str).map(str::to_string))
}

fn salt_from(req: &Value) -> Result<Vec<u8>, String> {
    req.get("salt").and_then(Value::as_str).and_then(b64::decode_strict).ok_or_else(|| "tuz base64url değil".to_string())
}

fn fingerprint_value(digest: &[Option<String>; 5]) -> Value {
    let mut out = serde_json::Map::new();
    for (i, f) in FACTORS.iter().enumerate() {
        out.insert((*f).to_string(), digest[i].clone().map_or(Value::Null, Value::String));
    }
    Value::Object(out)
}

/// Programcı hatası (kısa tuz, biçimsiz istek) `Err` döner → JS'te istisna (TS de fırlatır).
pub fn digest_fingerprint(req: &Value) -> Result<Value, String> {
    let salt = salt_from(req)?;
    let digest = fingerprint::digest_fingerprint(&raw_factors(req), &salt).map_err(|f| f.message)?;
    Ok(fingerprint_value(&digest))
}

/// OS etkenlerini toplar (f5 çağırandan) ve YALNIZ özeti döndürür — ham değer çıkmaz.
pub fn collect_fingerprint(req: &Value) -> Result<Value, String> {
    let salt = salt_from(req)?;
    let [f1, f2, f3, f4] = collect::os_factors();
    let f5 = req.get("f5").and_then(Value::as_str).map(str::to_string);
    let digest = fingerprint::digest_fingerprint(&[f1, f2, f3, f4, f5], &salt).map_err(|f| f.message)?;
    let measured: serde_json::Map<String, Value> =
        FACTORS.iter().enumerate().map(|(i, f)| ((*f).to_string(), Value::Bool(digest[i].is_some()))).collect();
    Ok(json!({ "digest": fingerprint_value(&digest), "measured": measured }))
}

pub fn verify_integrity(req: &Value) -> Value {
    let root = req.get("root").and_then(Value::as_str).unwrap_or_default();
    let keys: Vec<(String, String)> = match req.get("keys") {
        None => anchor::builtin_package_keys(),
        Some(_) if !TEST_ANCHOR => {
            return err(Fail { code: code::CAPA_ENJEKSIYONU_KAPALI, message: "Bu derleme dışarıdan paket anahtarı kabul etmez".into() })
        }
        Some(given) => given
            .as_array()
            .map(|l| {
                l.iter()
                    .map(|k| {
                        (
                            k.get("kid").and_then(Value::as_str).unwrap_or_default().to_string(),
                            k.get("x").and_then(Value::as_str).unwrap_or_default().to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default(),
    };
    ok(integrity::verify(&token(req, "manifest"), root, &keys))
}

pub fn unwrap_module_key(req: &Value) -> Value {
    let private = req.get("privateKey").and_then(Value::as_str).unwrap_or_default();
    let module = req.get("modul").and_then(Value::as_str).unwrap_or_default();
    outcome(module_key::unwrap(&token(req, "wrap"), private, module).map(|k| json!({ "anahtar": b64::encode(k.as_slice()) })))
}
