//! Kiranın `guncelleme` alanı (Dağıtım v2) TS ile aynı mı: `test-vektorleri/guncelleme-kira.json`
//! (üreten D1'in TS kâhini, `--vektor-yaz`; elle düzenlenmez) —
//! `politika` (LeaseUpdatePolicySchema) ve `kira-yuku` (LeaseSchema içinde) kayıtları. Hata metni
//! değil yalnız kod ve atılmış çıktı karşılaştırılır. `etkin-politika` kayıtları güncelleyicinin
//! testinde (`tekserp-guncelleyici/tests/sozlesme_vektorleri.rs`).
use serde_json::{json, Value};
use std::path::PathBuf;
use tekserp_dogrulama::outcome::code;
use tekserp_dogrulama::schema;

fn records() -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri").join("guncelleme-kira.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let file: Value = serde_json::from_str(&text).expect("vektör dosyası JSON");
    assert_eq!(file["bicim"], json!(1), "vektör biçimi");
    file["kayitlar"].as_array().expect("kayitlar").clone()
}

fn decode(schema_fn: fn(&Value) -> Result<serde_json::Map<String, Value>, String>, input: &Value) -> Result<Value, &'static str> {
    match input {
        Value::Object(m) => schema::decode(schema_fn, m).map(Value::Object).map_err(|f| f.code),
        // TS `decodeDocument`: düz nesne değilse `v` denetimi atlanır, şema reddeder.
        _ => Err(code::BELGE_SEMA),
    }
}

#[test]
fn update_policy_and_lease_payload_match_ts() {
    let mut seen = (0, 0);
    for r in records() {
        let v = &r["vektor"];
        let name = v["ad"].as_str().unwrap_or("?");
        let got = match v["tur"].as_str() {
            Some("politika") => {
                seen.0 += 1;
                match decode(schema::update_policy, &v["girdi"]) {
                    Ok(value) => json!({ "ok": true, "value": value }),
                    Err(c) => json!({ "ok": false, "code": c }),
                }
            }
            Some("kira-yuku") => {
                seen.1 += 1;
                match decode(schema::lease, &v["girdi"]) {
                    Ok(value) => json!({ "ok": true, "guncelleme": value.get("guncelleme").cloned().unwrap_or(Value::Null) }),
                    Err(c) => json!({ "ok": false, "code": c }),
                }
            }
            _ => continue,
        };
        assert_eq!(got, r["beklenen"], "{} · {name}", v["tur"]);
    }
    assert!(seen.0 >= 15 && seen.1 >= 4, "vektör kapsamı beklenenden az: politika {} · kira-yuku {}", seen.0, seen.1);
}
