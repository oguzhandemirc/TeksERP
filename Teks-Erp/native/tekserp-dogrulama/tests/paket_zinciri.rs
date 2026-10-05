//! PAKET anahtarı kökün altında: `test-vektorleri/paket-zinciri.json` (üreten TS kâhini
//! `scripts/test_paket_zinciri.ts --vektor-yaz`; elle düzenlenmez) — her kaydın Rust sonucu TS'in beklenenine
//! eşit. Hata metni değil yalnız kod karşılaştırılır.
use serde_json::{json, Value};
use std::path::PathBuf;
use tekserp_dogrulama::chain::{self, RootKey};
use tekserp_dogrulama::jsonx::js_number;
use tekserp_dogrulama::paket_zinciri::{
    pick_newer_package_revocation, verify_package_revocation, verify_package_signed, PackageMode, PackageTrust,
};

fn records() -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri").join("paket-zinciri.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let file: Value = serde_json::from_str(&text).expect("vektör dosyası JSON");
    assert_eq!(file["bicim"], json!(1), "vektör biçimi");
    file["kayitlar"].as_array().expect("kayitlar").clone()
}

fn roots(v: &Value) -> Vec<RootKey> {
    v.as_array()
        .expect("roots")
        .iter()
        .map(|r| RootKey {
            kid: r["kid"].as_str().expect("kid").to_string(),
            x: r["x"].as_str().expect("x").to_string(),
            classes: r["classes"].as_array().expect("classes").iter().map(|c| c.as_str().expect("sınıf").to_string()).collect(),
        })
        .collect()
}

fn fail(code: &str) -> Value {
    json!({ "ok": false, "code": code })
}

fn evaluate(v: &Value) -> Value {
    match v["tur"].as_str().expect("tur") {
        "paket-imza" => {
            let g = &v["guven"];
            let roots = roots(&g["roots"]);
            let revocation = match &g["iptal"] {
                Value::Null => None,
                token => match verify_package_revocation(token, &roots) {
                    Ok(r) => Some(r),
                    Err(f) => return json!({ "iptalHatasi": f.code }),
                },
            };
            let keys = g["keys"]
                .as_array()
                .expect("keys")
                .iter()
                .map(|k| (k["kid"].as_str().expect("kid").to_string(), k["x"].as_str().expect("x").to_string()))
                .collect();
            let mode = if g["mode"] == json!("KABUL") { PackageMode::Kabul } else { PackageMode::Yerlesik };
            let install_class = g.get("sinif").map(|s| s.as_str().map(str::to_string));
            let trust = PackageTrust { keys, roots, mode, now_ms: g.get("nowMs").and_then(js_number), revocation, install_class };
            match verify_package_signed(&v["token"], v["typ"].as_str().expect("typ"), &trust) {
                Ok(s) => s.view(),
                Err(f) => fail(f.code),
            }
        }
        "paket-iptal" => match verify_package_revocation(&v["token"], &roots(&v["roots"])) {
            Ok(r) => {
                let ids: Vec<Value> =
                    r.document["iptaller"].as_array().expect("iptaller").iter().map(|e| e["sertifikaId"].clone()).collect();
                json!({ "ok": true, "sira": r.document["sira"], "rootKid": r.root_kid, "sertifikaIdler": ids })
            }
            Err(f) => fail(f.code),
        },
        "iptal" => match chain::verify_revocation(&v["token"], &roots(&v["roots"])) {
            Ok(r) => json!({ "ok": true, "sira": r.document["sira"] }),
            Err(f) => fail(f.code),
        },
        other => panic!("tanınmayan vektör türü {other}"),
    }
}

#[test]
fn package_chain_matches_ts() {
    let all = records();
    for r in &all {
        let v = &r["vektor"];
        assert_eq!(evaluate(v), r["beklenen"], "{} · {}", v["tur"], v["ad"]);
    }
    assert!(all.len() >= 40, "vektör kapsamı beklenenden az: {}", all.len());
}

#[test]
fn newer_package_revocation_wins() {
    let all = records();
    let pick = |name: &str| {
        let r = all.iter().find(|r| r["vektor"]["ad"] == json!(name)).expect(name);
        let g = &r["vektor"]["guven"];
        verify_package_revocation(&g["iptal"], &roots(&g["roots"])).expect("iptal")
    };
    let low = pick("iptalli KABUL");
    let high = pick("iptalli KABUL (yalnız kid eşleşir)");
    let kept = pick_newer_package_revocation(Some(high.clone()), Some(low.clone())).expect("biri");
    assert_eq!(kept.document["sira"], high.document["sira"], "düşük sıra yok sayılır");
    let taken = pick_newer_package_revocation(Some(low.clone()), Some(high.clone())).expect("biri");
    assert_eq!(taken.document["sira"], high.document["sira"], "yüksek sıra kazanır");
    let same = pick_newer_package_revocation(Some(low.clone()), Some(low.clone())).expect("biri");
    assert_eq!(same.document["iptalId"], low.document["iptalId"], "eşit sıra: mevcut kalır");
}
