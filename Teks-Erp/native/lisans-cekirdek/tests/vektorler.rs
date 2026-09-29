//! Aynı test vektörleri iki uygulamada: TS kâhininin ürettiği `test-vektorleri/protokol.json`
//! (Teks-Erp `scripts/test_lisans_native_kahin.ts --vektor-yaz`) burada native API'den geçer ve
//! her sonuç TS'in beklenen sonucuna EŞİT olmalıdır. İstek biçimi `src/lib/license/native.ts`
//! adaptörünün kurduğuyla aynıdır — ölçülen yüzey, Node'un gördüğü yüzey.
//!
//! Koşum: `cargo test --no-default-features --features test-anchor` (vektörler test çapası ister).
#![cfg(feature = "test-anchor")]

use lisans_cekirdek::{api, b64, iso, jsonx};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

const VEKTOR_BICIMI: u64 = 1;

fn vector_file() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test-vektorleri").join("protokol.json");
    let text = std::fs::read_to_string(&path).expect("vektör dosyası okunamadı (TS kâhiniyle üret)");
    serde_json::from_str(&text).expect("vektör dosyası JSON değil")
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
    for r in records {
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
}

#[test]
fn builtin_anchor_is_the_ts_constant_shape() {
    let a = api::builtin_anchor();
    assert!(a["roots"].as_array().is_some_and(|r| !r.is_empty()), "gömülü kök çapası boş olamaz (hazırlık kökü)");
    assert!(a["packageKeys"].is_array());
}
