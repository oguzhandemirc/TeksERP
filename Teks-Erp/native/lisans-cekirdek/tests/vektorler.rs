//! Aynı test vektörleri iki uygulamada: TS kâhininin ürettiği `test-vektorleri/protokol.json` ve lisans v2
//! aileleri `test-vektorleri/protokol-v2.json` (Teks-Erp `scripts/test_lisans_native_kahin.ts --vektor-yaz`)
//! burada native API'den geçer ve her sonuç TS'in beklenen sonucuna EŞİT olmalıdır. İstek biçimi
//! `src/lib/license/native-adapter.ts`in kurduğuyla aynıdır — ölçülen yüzey, Node'un gördüğü yüzey.
//!
//! Koşum: `cargo test --no-default-features --features test-anchor` (vektörler test çapası ister) ve aynı komut
//! `hazirlik-capasi` ile — gömülü çapa vektörleri (`kip`) yalnız kendi kipiyle derlenmiş çekirdekte koşar.
#![cfg(feature = "test-anchor")]

use lisans_cekirdek::{anchor, api, b64, iso, jsonx, jws};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

const VEKTOR_BICIMI: u64 = 2;
/// Bir kipin gömülü çapa vektörü bundan azsa kip koşumu kanıt sayılmaz (boş küme yeşil vermesin).
const MIN_MODE_VECTORS: usize = 8;
/// `protokol-v2.json` biçimi (TS `VEKTOR_V2_BICIMI`).
const VEKTOR_V2_BICIMI: u64 = 1;
/// v2'de native'in koştuğu türler — HER biri bu derlemede en az bir kayıtla koşmalı (sessiz boş küme yok).
const V2_NATIVE_TYPES: [&str; 10] =
    ["hak2", "kira2", "bag2", "iptal", "iptalSec", "iptalGuncel", "parmakIziKarar", "tanima", "ogrenme", "ufukTavani"];
/// Native'in koşmadığı tek v2 türü: İSTEK doğrulaması satıcı/patron kâhinindedir (fabrika istek doğrulamaz).
const V2_NOT_NATIVE: [&str; 1] = ["istek"];
const MIN_V2_MODE_VECTORS: usize = 2;

/// Gömülü çapa vektörü öteki kipin çapasıyla beklenmiştir; bu derlemede koşmaz.
fn applies_to_this_build(v: &Value) -> bool {
    v.get("kip").and_then(Value::as_str).is_none_or(|k| k == anchor::MODE)
}

fn vector_file_named(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test-vektorleri").join(name);
    let text = std::fs::read_to_string(&path).expect("vektör dosyası okunamadı (TS kâhiniyle üret)");
    serde_json::from_str(&text).expect("vektör dosyası JSON değil")
}

fn vector_file() -> Value {
    vector_file_named("protokol.json")
}

/// JS `JSON.stringify` anlamı: sonlu olmayan sayı `null` olur (TS beklenenleri böyle yazdı).
fn js_json(v: &Value) -> Value {
    match v {
        Value::Number(_) => match jsonx::js_number(v) {
            Some(n) if n.is_finite() => v.clone(),
            _ => Value::Null,
        },
        Value::Array(a) => Value::Array(a.iter().map(js_json).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), js_json(x))).collect()),
        other => other.clone(),
    }
}

/// TS `sonuc()`: `{ok, value}` ya da `{ok:false, code}` — mesaj karşılaştırılmaz.
fn result_shape(r: &Value) -> Value {
    if r["ok"] == Value::Bool(true) {
        json!({ "ok": true, "value": js_json(&r["value"]) })
    } else {
        json!({ "ok": false, "code": r["code"] })
    }
}

fn with_anchor(mut req: Map<String, Value>, v: &Value, field: &str) -> Value {
    if !v[field].is_null() {
        req.insert(field.to_string(), v[field].clone());
    }
    Value::Object(req)
}

fn obj(pairs: &[(&str, &Value)]) -> Map<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).clone())).collect()
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn temp_dir() -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("lisans-vektor-rs-{}-{nanos}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("geçici dizin");
    dir
}

fn materialize(files: &Value) -> PathBuf {
    let dir = temp_dir();
    for f in files.as_array().expect("dosyalar dizi") {
        let target = f["yol"].as_str().unwrap().split('/').fold(dir.clone(), |acc, s| acc.join(s));
        match f["icerik"].as_str() {
            None => std::fs::create_dir_all(&target).expect("dizin"),
            Some(content) => {
                std::fs::create_dir_all(target.parent().unwrap()).expect("üst dizin");
                std::fs::write(&target, b64::decode_strict(content).expect("içerik base64url")).expect("dosya");
            }
        }
    }
    dir
}

fn evaluate(v: &Value) -> Value {
    let tur = v["tur"].as_str().expect("tur");
    match tur {
        "jws" => result_shape(&api::verify_jws(&Value::Object(obj(&[("token", &v["token"]), ("typ", &v["typ"]), ("keys", &v["keys"])])))),
        "sertifika" => {
            let req = obj(&[("token", &v["token"]), ("usage", &v["usage"]), ("atMs", &v["atMs"])]);
            result_shape(&api::verify_certificate(&with_anchor(req, v, "roots")))
        }
        "hak" => result_shape(&api::verify_entitlement(&with_anchor(obj(&[("token", &v["token"])]), v, "roots"))),
        "kira" => result_shape(&api::verify_lease(&with_anchor(obj(&[("token", &v["token"])]), v, "roots"))),
        "bag" => {
            let req = obj(&[("lease", &v["lease"]), ("entitlement", &v["entitlement"])]);
            result_shape(&api::check_lease_binding(&with_anchor(req, v, "roots")))
        }
        "normalize" => {
            let r = api::normalize_factor(&Value::Object(obj(&[("factor", &v["factor"]), ("raw", &v["raw"])])));
            json!({ "deger": r["value"] })
        }
        "ozet" => match api::digest_fingerprint(&Value::Object(obj(&[("raw", &v["raw"]), ("salt", &v["salt"])]))) {
            Ok(fp) => json!({ "ozet": fp }),
            Err(_) => json!({ "hata": true }),
        },
        "butunluk" => {
            let dir = materialize(&v["dosyalar"]);
            let root = if v["kok"] == "yok" { dir.join("olmayan-kok") } else { dir.clone() };
            let root_text = Value::String(root.to_string_lossy().into_owned());
            let req = obj(&[("manifest", &v["manifest"]), ("root", &root_text)]);
            let r = api::verify_integrity(&with_anchor(req, v, "keys"));
            let _ = std::fs::remove_dir_all(&dir);
            result_shape(&r)
        }
        "modul" => {
            let req = obj(&[("wrap", &v["wrap"]), ("privateKey", &v["privateKey"]), ("modul", &v["modul"])]);
            result_shape(&api::unwrap_module_key(&Value::Object(req)))
        }
        "kiraModul" => {
            let req = obj(&[
                ("lease", &v["lease"]),
                ("entitlement", &v["entitlement"]),
                ("privateKey", &v["privateKey"]),
                ("modul", &v["modul"]),
                ("kid", &v["kid"]),
            ]);
            result_shape(&api::unwrap_lease_module_key(&with_anchor(req, v, "roots")))
        }
        "tarih" => {
            let ms = iso::date_parse_ms(v["metin"].as_str().expect("metin"));
            json!({ "ms": if ms.is_nan() { Value::Null } else { json!(ms as i64) } })
        }
        other => panic!("bilinmeyen vektör türü: {other}"),
    }
}

#[test]
fn every_vector_matches_ts_oracle() {
    let file = vector_file();
    assert_eq!(file["bicim"].as_u64(), Some(VEKTOR_BICIMI), "vektör biçimi değişti — bu testi güncelle");
    let records = file["kayitlar"].as_array().expect("kayitlar");
    assert!(records.len() >= 200, "vektör sayısı beklenenden az: {}", records.len());
    let mut mismatches = Vec::new();
    let mut mode_vectors = 0usize;
    for r in records {
        if !applies_to_this_build(&r["vektor"]) {
            continue;
        }
        if r["vektor"].get("kip").is_some() {
            mode_vectors += 1;
        }
        let got = evaluate(&r["vektor"]);
        if !jsonx::deep_equal(&got, &r["beklenen"]) {
            mismatches.push(format!(
                "{} · {}: beklenen {} · gelen {}",
                r["vektor"]["tur"].as_str().unwrap_or("?"),
                r["vektor"]["ad"].as_str().unwrap_or("?"),
                r["beklenen"],
                got
            ));
        }
    }
    assert!(mismatches.is_empty(), "{} vektör TS kâhininden ayrıştı:\n{}", mismatches.len(), mismatches.join("\n"));
    assert!(mode_vectors >= MIN_MODE_VECTORS, "{} kipinin gömülü çapa vektörü {mode_vectors} (en az {MIN_MODE_VECTORS})", anchor::MODE);
}

/// JSON'da sayı olmayan "şimdi" dizgeyle yazılır: NaN → `null` (adaptör `JSON.stringify` böyle gönderir), +∞ →
/// `1e400` (sonsuz sayı — sonluluk denetimi ayrıca ölçülsün).
fn now_arg(v: &Value) -> Option<Value> {
    match v.get("nowMs")? {
        Value::String(s) if s == "NaN" => Some(Value::Null),
        Value::String(s) if s == "Infinity" => Some(serde_json::from_str("1e400").expect("sonsuz sayı")),
        other => Some(other.clone()),
    }
}

fn with_optional(mut req: Map<String, Value>, field: &str, value: Option<&Value>) -> Map<String, Value> {
    if let Some(x) = value.filter(|x| !x.is_null()) {
        req.insert(field.to_string(), x.clone());
    }
    req
}

/// TS `degerlendirV2` aynası; `None` = native'in koşmadığı tür.
fn evaluate_v2(v: &Value) -> Option<Value> {
    let tur = v["tur"].as_str().expect("tur");
    let fingerprints = |fields: &[(&str, &str)]| -> Value {
        let mut req: Map<String, Value> = fields.iter().map(|(to, from)| ((*to).to_string(), v[*from].clone())).collect();
        req.insert("excludeF5".into(), v["excludeF5"].clone());
        req = with_optional(req, "rule", v.get("rule"));
        Value::Object(req)
    };
    let out = match tur {
        "hak2" => {
            let mut req = with_optional(obj(&[("token", &v["token"])]), "iptal", v.get("iptal"));
            if let Some(now) = now_arg(v) {
                req.insert("nowMs".into(), now);
            }
            let mut r = api::verify_entitlement(&with_anchor(req, v, "roots"));
            // TS görünümü özeti de taşır; native onu görünüme koymaz (köprü doğrulanan metinden kurar) — aynı işlevle.
            if r["ok"] == Value::Bool(true) {
                r["value"]["digest"] = Value::String(jws::digest(v["token"].as_str().expect("HAK metni")));
            }
            result_shape(&r)
        }
        "kira2" => {
            let req = with_optional(obj(&[("token", &v["token"])]), "iptal", v.get("iptal"));
            result_shape(&api::verify_lease(&with_anchor(req, v, "roots")))
        }
        "bag2" => {
            let req = obj(&[("lease", &v["lease"]), ("entitlement", &v["entitlement"])]);
            result_shape(&api::check_lease_binding(&with_anchor(req, v, "roots")))
        }
        "iptal" => result_shape(&api::verify_revocation(&with_anchor(obj(&[("token", &v["token"])]), v, "roots"))),
        "iptalSec" => {
            let req = with_optional(with_optional(obj(&[]), "current", v.get("mevcut")), "incoming", v.get("gelen"));
            let r = api::pick_newer_revocation(&with_anchor(req, v, "roots"));
            if r["ok"] != Value::Bool(true) {
                return Some(json!({ "hata": r["code"] }));
            }
            let doc = &r["value"]["document"];
            json!({ "sira": doc.get("sira").cloned().unwrap_or(Value::Null), "iptalId": doc.get("iptalId").cloned().unwrap_or(Value::Null) })
        }
        "iptalGuncel" => {
            let req = with_optional(obj(&[("lease", &v["lease"])]), "iptal", v.get("iptal"));
            let r = api::is_revocation_current(&with_anchor(req, v, "roots"));
            if r["ok"] != Value::Bool(true) {
                return Some(json!({ "hata": r["code"] }));
            }
            json!({ "guncel": r["value"] })
        }
        "parmakIziKarar" => api::compare_fingerprints(&fingerprints(&[("accepted", "accepted"), ("measured", "measured")])).expect("karar"),
        "tanima" => api::assess_identification(&fingerprints(&[("fingerprint", "fingerprint")])).expect("tanıma"),
        "ogrenme" => {
            let r = api::can_auto_learn_fingerprint(&fingerprints(&[("accepted", "accepted"), ("measured", "measured")])).expect("öğrenme");
            json!({ "ogrenir": r["value"] })
        }
        "ufukTavani" => {
            let r =
                api::offline_horizon_ceiling_days(&Value::Object(obj(&[("sinif", &v["sinif"]), ("signer", &v["signer"])]))).expect("ufuk");
            json!({ "gun": r["value"] })
        }
        other if V2_NOT_NATIVE.contains(&other) => return None,
        other => panic!("bilinmeyen v2 vektör türü: {other}"),
    };
    Some(out)
}

#[test]
fn every_v2_vector_matches_ts_oracle() {
    let file = vector_file_named("protokol-v2.json");
    assert_eq!(file["bicim"].as_u64(), Some(VEKTOR_V2_BICIMI), "v2 vektör biçimi değişti — bu testi güncelle");
    let records = file["kayitlar"].as_array().expect("kayitlar");
    assert!(records.len() >= 120, "v2 vektör sayısı beklenenden az: {}", records.len());
    let mut mismatches = Vec::new();
    let mut ran: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let (mut mode_vectors, mut skipped) = (0usize, 0usize);
    for r in records {
        let v = &r["vektor"];
        if !applies_to_this_build(v) {
            continue;
        }
        let Some(got) = evaluate_v2(v) else {
            skipped += 1;
            continue;
        };
        if v.get("kip").is_some() {
            mode_vectors += 1;
        }
        *ran.entry(v["tur"].as_str().unwrap_or("?").to_string()).or_default() += 1;
        if !jsonx::deep_equal(&got, &r["beklenen"]) {
            mismatches.push(format!(
                "{} · {}: beklenen {} · gelen {}",
                v["tur"].as_str().unwrap_or("?"),
                v["ad"].as_str().unwrap_or("?"),
                r["beklenen"],
                got
            ));
        }
    }
    assert!(mismatches.is_empty(), "{} v2 vektör TS kâhininden ayrıştı:\n{}", mismatches.len(), mismatches.join("\n"));
    let missing: Vec<&str> = V2_NATIVE_TYPES.iter().copied().filter(|t| !ran.contains_key(*t)).collect();
    assert!(missing.is_empty(), "native v2 türü bu derlemede hiç koşmadı: {missing:?} (koşan: {ran:?})");
    assert!(skipped > 0 && skipped < records.len() / 4, "native dışı (istek) kayıt sayısı şüpheli: {skipped}");
    assert!(
        mode_vectors >= MIN_V2_MODE_VECTORS,
        "{} kipinin v2 gömülü çapa vektörü {mode_vectors} (en az {MIN_V2_MODE_VECTORS})",
        anchor::MODE
    );
}

#[test]
fn builtin_anchor_is_the_ts_constant_shape() {
    let a = api::builtin_anchor();
    assert_eq!(a["kip"].as_str(), Some(anchor::MODE));
    assert!(a["roots"].as_array().is_some_and(|r| !r.is_empty()), "gömülü kök çapası boş olamaz");
    assert!(a["packageKeys"].as_array().is_some_and(|k| !k.is_empty()), "gömülü PAKET çapası boş olamaz");
}
