//! JSON sınırı: napi yapıştırıcısı (`napi_api.rs`) ve `tests/vektorler.rs` AYNI fonksiyonları
//! çağırır — test edilen yüzey, Node'un gördüğü yüzeydir. İstek/yanıt biçimi TS
//! `lib/license/native.ts` ile sözleşmedir; yanıt `{ok, value}` | `{ok:false, code, message}`.
use crate::anchor;
use crate::b64;
use crate::chain::{self, RootKey, VerifiedRevocation};
use crate::collect;
use crate::fingerprint::{self, Fingerprint, Rule, FACTORS, PLACEHOLDER_VALUES};
use crate::integrity;
use crate::jsonx::js_number;
use crate::jws;
use crate::local_protect;
use crate::module_key;
use crate::outcome::{code, Fail, Outcome};
use crate::paths;
use crate::schema::LICENSE_CLASSES;
use serde_json::{json, Value};
use tekserp_dogrulama::paket_zinciri::{PackageMode, PackageTrust};

/// Arayüz sürümü: istek/yanıt biçimi kırılınca artar; yükleyici eşit değilse native'i KULLANMAZ (3: künyede çapa
/// kipi). Lisans v2 (G4 + parmak izi v2) G3 yayınlanmadan indiği için AYNI numarada: yeni uçları taşımayan eski
/// ABI-3 derlemesini yükleyici işlev listesinden tanır ve açmaz.
pub const ABI: u32 = 3;
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
        "capaKipi": anchor::MODE,
        "protokolKodlari": code::PROTOCOL,
        "cekirdekKodlari": code::CORE,
        "yerTutucular": PLACEHOLDER_VALUES,
        "windowsSondasi": collect::WINDOWS_PROBE_LINES,
        "parmakIziYollari": paths::PATHS,
        "modulHkdfOneki": module_key::HKDF_INFO_PREFIX,
        "modulKidOneki": module_key::KID_PREFIX,
        "korumaEntropisi": local_protect::ENTROPY,
    })
}

pub fn builtin_anchor() -> Value {
    let roots: Vec<Value> = anchor::builtin_roots().iter().map(|r| json!({ "kid": r.kid, "x": r.x, "classes": r.classes })).collect();
    let package: Vec<Value> = anchor::builtin_package_keys().iter().map(|(kid, x)| json!({ "kid": kid, "x": x })).collect();
    json!({ "kip": anchor::MODE, "roots": roots, "packageKeys": package })
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

/// İstekteki iptal belgesi (JWS metni): yok ya da `null` → iptalsiz. Varsa AYNI çapayla yeniden doğrulanır (JS'ten
/// gelen "doğrulanmış" iptale güvenilmez); doğrulanamayan belge çağıranın hatasıdır, istek onun koduyla düşer.
fn revocation_from(req: &Value, field: &str, roots: &[RootKey]) -> Outcome<Option<VerifiedRevocation>> {
    match req.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(given) => chain::verify_revocation(given, roots).map(Some),
    }
}

/// Doğrulayanın "şimdi"si: alan yoksa veriliş sınırı işlemez; varsa sayı olmayan değer (JSON'da NaN/±∞ `null`
/// olur) NaN sayılır ve sınır onu reddeder (fail-closed).
fn now_from(req: &Value) -> Option<f64> {
    req.get("nowMs").map(|v| js_number(v).unwrap_or(f64::NAN))
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
        let revocation = revocation_from(req, "iptal", &roots)?;
        let usage = req.get("usage").and_then(Value::as_str).unwrap_or_default();
        let at_ms = req.get("atMs").and_then(js_number).unwrap_or(f64::NAN);
        Ok(chain::verify_certificate(&token(req, "token"), &roots, usage, at_ms, revocation.as_ref())?.view())
    };
    outcome(run())
}

/// HAK (+ isteğe bağlı `nowMs` veriliş sınırı ve `iptal` belgesi).
pub fn verify_entitlement(req: &Value) -> Value {
    let run = || -> Outcome<Value> {
        let roots = roots_from(req)?;
        let revocation = revocation_from(req, "iptal", &roots)?;
        Ok(chain::verify_entitlement(&token(req, "token"), &roots, now_from(req), revocation.as_ref())?.view())
    };
    outcome(run())
}

pub fn verify_lease(req: &Value) -> Value {
    let run = || -> Outcome<Value> {
        let roots = roots_from(req)?;
        let revocation = revocation_from(req, "iptal", &roots)?;
        Ok(chain::verify_lease(&token(req, "token"), &roots, revocation.as_ref())?.view())
    };
    outcome(run())
}

/// İPTAL belgesi (G4 §2.3): yalnız çapadaki bir kök imzalar.
pub fn verify_revocation(req: &Value) -> Value {
    outcome(roots_from(req).and_then(|roots| Ok(chain::verify_revocation(&token(req, "token"), &roots)?.view())))
}

/// Mevcut ile gelen iptal belgesinden yüksek sıralısı (ikisi de doğrulanır); ikisi de yoksa `null`.
pub fn pick_newer_revocation(req: &Value) -> Value {
    let run = || -> Outcome<Value> {
        let roots = roots_from(req)?;
        let current = revocation_from(req, "current", &roots)?;
        let incoming = revocation_from(req, "incoming", &roots)?;
        Ok(chain::pick_newer_revocation(current, incoming).map_or(Value::Null, |r| r.view()))
    };
    outcome(run())
}

/// Kiranın beyan ettiği iptal sırasına eldeki belge yetişiyor mu (kira, sonra iptal doğrulanır).
pub fn is_revocation_current(req: &Value) -> Value {
    let run = || -> Outcome<Value> {
        let roots = roots_from(req)?;
        let lease = chain::verify_lease(&token(req, "lease"), &roots, None)?;
        let revocation = revocation_from(req, "iptal", &roots)?;
        Ok(Value::Bool(chain::is_revocation_current(&lease.document, revocation.as_ref())))
    };
    outcome(run())
}

/// İki belgeyi doğrular ve bağlar — JS'ten gelen "doğrulanmış" görünüme güvenilmez.
pub fn check_lease_binding(req: &Value) -> Value {
    let run = || -> Outcome<Value> {
        let roots = roots_from(req)?;
        let lease = chain::verify_lease(&token(req, "lease"), &roots, None)?;
        let entitlement = chain::verify_entitlement(&token(req, "entitlement"), &roots, None, None)?;
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
    let f5 = req.get("f5").and_then(Value::as_str).map(str::to_string);
    let (platform, outcomes) = collect::os_outcomes();
    collected_value(platform, &outcomes, &salt, f5)
}

/// Yol sonuçlarından çekirdek çıktısına (TS `collectedFrom`): seçim + çağıranın F5'i + tuzlu özet; platform yoksa
/// dört etken OKUNAMADI. `tests/toplama.rs` TS vektörlerini buradan geçirir.
pub fn collected_value(platform: Option<&str>, outcomes: &paths::Outcomes, salt: &[u8], f5: Option<String>) -> Result<Value, String> {
    let ([f1, f2, f3, f4], readings) = match platform {
        Some(p) => paths::select_os(p, outcomes),
        None => {
            (Default::default(), [paths::Reading::unread(), paths::Reading::unread(), paths::Reading::unread(), paths::Reading::unread()])
        }
    };
    let digest = fingerprint::digest_fingerprint(&[f1, f2, f3, f4, f5], salt).map_err(|f| f.message)?;
    let measured: serde_json::Map<String, Value> =
        FACTORS.iter().enumerate().map(|(i, f)| ((*f).to_string(), Value::Bool(digest[i].is_some()))).collect();
    let okuma: serde_json::Map<String, Value> =
        paths::OS_FACTORS.iter().zip(readings.iter()).map(|(f, r)| ((*f).to_string(), r.to_json())).collect();
    Ok(json!({ "digest": fingerprint_value(&digest), "measured": measured, "okuma": okuma }))
}

/// Özet nesnesi (`{f1..f5: özet | null}`); eksik ya da metin/null olmayan etken programcı hatasıdır (`Err`).
fn fingerprint_arg(req: &Value, field: &str) -> Result<Fingerprint, String> {
    let Some(Value::Object(given)) = req.get(field) else {
        return Err(format!("{field}: parmak izi nesnesi değil"));
    };
    let mut out: Fingerprint = Default::default();
    for (i, factor) in FACTORS.iter().enumerate() {
        out[i] = match given.get(*factor) {
            Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            _ => return Err(format!("{field}.{factor}: özet ya da null olmalı")),
        };
    }
    Ok(out)
}

fn exclude_f5(req: &Value) -> bool {
    req.get("excludeF5").and_then(Value::as_bool).unwrap_or(false)
}

/// Parmak izi kararı (v1 · `standart` · `zayif`); kural yoksa v1.
pub fn compare_fingerprints(req: &Value) -> Result<Value, String> {
    let rule = match req.get("rule") {
        None | Some(Value::Null) => Rule::from_lease(None),
        Some(Value::String(name)) => Rule::from_lease(Some(name)),
        Some(_) => Err("parmak izi kuralı metin değil".to_string()),
    }?;
    let decision = fingerprint::compare(&fingerprint_arg(req, "accepted")?, &fingerprint_arg(req, "measured")?, exclude_f5(req), rule);
    Ok(decision.view())
}

pub fn assess_identification(req: &Value) -> Result<Value, String> {
    Ok(fingerprint::assess_identification(&fingerprint_arg(req, "fingerprint")?, exclude_f5(req)))
}

pub fn can_auto_learn_fingerprint(req: &Value) -> Result<Value, String> {
    let learns = fingerprint::can_auto_learn(&fingerprint_arg(req, "accepted")?, &fingerprint_arg(req, "measured")?, exclude_f5(req));
    Ok(json!({ "value": learns }))
}

/// Sınıf ve imzacı türüne göre çevrimdışı ufuk tavanı (gün; `null` = tavansız).
pub fn offline_horizon_ceiling_days(req: &Value) -> Result<Value, String> {
    let class = req.get("sinif").and_then(Value::as_str).filter(|c| LICENSE_CLASSES.contains(c)).ok_or("sınıf tanınmıyor")?;
    let signer = req.get("signer").and_then(Value::as_str).filter(|s| chain::SIGNER_KINDS.contains(s)).ok_or("imzacı türü tanınmıyor")?;
    Ok(json!({ "value": chain::offline_horizon_ceiling_days(class, signer) }))
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
    // `pkt-*` imzalı liste kurulu paketin kendisidir: YERLEŞİK kip (zaman/iptal kararı ikinci katmanda); `paket-*` bugünkü yol.
    let roots = match roots_from(req) {
        Ok(r) => r,
        Err(f) => return err(f),
    };
    let trust = PackageTrust { keys, roots, mode: PackageMode::Yerlesik, now_ms: None, revocation: None, install_class: None };
    ok(integrity::verify_trusted(&token(req, "manifest"), root, &trust))
}

pub fn unwrap_module_key(req: &Value) -> Value {
    let private = req.get("privateKey").and_then(Value::as_str).unwrap_or_default();
    let module = req.get("modul").and_then(Value::as_str).unwrap_or_default();
    outcome(module_key::unwrap(&token(req, "wrap"), private, module).map(|k| json!({ "anahtar": b64::encode(k.as_slice()) })))
}

fn in_list(v: Option<&Value>, module: &str) -> bool {
    v.and_then(Value::as_array).is_some_and(|l| l.iter().any(|m| m.as_str() == Some(module)))
}

/// Faz 2d: modül anahtarı YALNIZ doğrulanmış kiradan açılır (güvenlik-kritik sonuç ANAHTARDIR).
/// Sıra TS `unwrapLeaseModuleKey` ile aynı: kira → HAK → bağ → HAK'ta mı → donmuş mu → kirada hak
/// → sarma → açılan anahtarın kimliği.
pub fn unwrap_lease_module_key(req: &Value) -> Value {
    let run = || -> Outcome<Value> {
        let roots = roots_from(req)?;
        let lease = chain::verify_lease(&token(req, "lease"), &roots, None)?;
        let entitlement = chain::verify_entitlement(&token(req, "entitlement"), &roots, None, None)?;
        chain::check_lease_binding(&lease, &entitlement)?;
        let module = req.get("modul").and_then(Value::as_str).unwrap_or_default();
        let kid = req.get("kid").and_then(Value::as_str).unwrap_or_default();
        if !in_list(entitlement.document.get("moduller"), module) {
            return Err(Fail { code: code::MODUL_HAK_YOK, message: format!("{module} modülü HAK'ta yok") });
        }
        if !in_list(lease.document.get("yaptirim").and_then(|y| y.get("donmusModuller")), module) {
            let Some(grant) = module_key::find_grant(&lease.document, module, kid) else {
                return Err(Fail {
                    code: code::MODUL_ANAHTARI_YOK,
                    message: format!("Kira {module} modülünün {kid} anahtarını taşımıyor"),
                });
            };
            let private = req.get("privateKey").and_then(Value::as_str).unwrap_or_default();
            let key = module_key::unwrap(grant.get("sarma").unwrap_or(&Value::Null), private, module)?;
            if module_key::key_id(&key) != kid {
                return Err(Fail { code: code::MODUL_KID_UYUSMAZ, message: "Açılan anahtarın kimliği istenen kimlik değil".into() });
            }
            return Ok(json!({ "anahtar": b64::encode(key.as_slice()), "surum": grant.get("surum").cloned().unwrap_or(Value::Null) }));
        }
        Err(Fail { code: code::MODUL_DONMUS, message: format!("{module} modülü lisans sunucusunca dondurulmuş") })
    };
    outcome(run())
}

fn protect_call(req: &Value, unprotect: bool) -> Value {
    let Some(data) = req.get("veri").and_then(Value::as_str).and_then(b64::decode_strict) else {
        return err(Fail { code: code::KORUMA_HATASI, message: "Korunacak veri base64url değil".into() });
    };
    outcome(local_protect::run(&data, unprotect).map(|v| json!({ "veri": b64::encode(&v) })))
}

/// Windows DPAPI ile yerel sarma (modül anahtarı önbelleği); başka platformda `KORUMA_YOK`.
pub fn protect_local(req: &Value) -> Value {
    protect_call(req, false)
}

pub fn unprotect_local(req: &Value) -> Value {
    protect_call(req, true)
}
