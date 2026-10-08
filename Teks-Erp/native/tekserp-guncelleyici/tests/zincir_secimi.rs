//! Zincirli işaretçi seçimi (D8): `test-vektorleri/zincir-secimi.json` (üreten TS kâhini
//! `scripts/test_zincir_secimi.ts --vektor-yaz`; elle düzenlenmez) — her kaydın Rust sonucu TS'in beklenenine eşit.
//! Hata metni değil kod, kazanan ad ve elenenlerin (ad, kod) listesi karşılaştırılır.
use serde_json::{json, Value};
use std::path::PathBuf;
use tekserp_dogrulama::chain::RootKey;
use tekserp_dogrulama::jsonx::js_number;
use tekserp_dogrulama::paket_zinciri::{verify_package_revocation, PackageMode, PackageTrust};
use tekserp_guncelleyici::release::{self, ChainedFamily};

fn records() -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri").join("zincir-secimi.json");
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

fn view<T>(r: Option<Result<release::ChainedChoice<T>, tekserp_dogrulama::outcome::Fail>>) -> Value {
    match r {
        None => json!({ "secim": null }),
        Some(Err(f)) => json!({ "ok": false, "code": f.code }),
        Some(Ok(c)) => {
            let elenen: Vec<Value> = c.rejected.iter().map(|(ad, code, _)| json!({ "ad": ad, "code": code })).collect();
            json!({ "ok": true, "ad": c.name, "kid": c.checked.signer_kid, "elenen": elenen })
        }
    }
}

fn evaluate(v: &Value) -> Value {
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
    let trust = PackageTrust { keys, roots, mode, now_ms: g.get("nowMs").and_then(js_number), revocation, install_class: None };
    let family = ChainedFamily::parse(v["aile"].as_str().expect("aile")).expect("aile tanınmalı");
    let kanal = v["kanal"].as_str().expect("kanal");
    let adaylar = v["adaylar"].as_array().expect("adaylar");
    let pair = |a: &Value| (a["ad"].as_str().expect("ad").to_string(), a["metin"].as_str().expect("metin").to_string());
    if family == ChainedFamily::Pg {
        let c = adaylar.iter().map(pair).map(|(n, t)| release::chained_pg_candidate(&n, &t, &trust)).collect();
        view(release::select_chained(family, c))
    } else {
        let c = adaylar.iter().map(pair).map(|(n, t)| release::chained_release_candidate(&n, &t, &trust, kanal)).collect();
        view(release::select_chained(family, c))
    }
}

#[test]
fn chained_selection_matches_ts() {
    let all = records();
    assert!(all.len() >= 20, "vektör sayısı düştü: {}", all.len());
    let mut wrong = Vec::new();
    for k in &all {
        let got = evaluate(&k["vektor"]);
        if got != k["beklenen"] {
            wrong.push(format!("{}: beklenen {} · gelen {got}", k["vektor"]["ad"], k["beklenen"]));
        }
    }
    assert!(wrong.is_empty(), "TS ile ayrışan {} kayıt:\n{}", wrong.len(), wrong.join("\n"));
}

#[test]
fn chained_file_names() {
    assert_eq!(release::chained_file_name(ChainedFamily::Surum, None).as_deref(), Some("surum-zincir.json"));
    assert_eq!(release::chained_file_name(ChainedFamily::Pg, Some("pkt-2027-1")).as_deref(), Some("pg-zincir-pkt-2027-1.json"));
    assert_eq!(release::chained_file_name(ChainedFamily::Son, Some("pkt-2027-1")), None);
    assert_eq!(release::chained_file_name(ChainedFamily::Surum, Some("paket-2026")), None);
    assert_eq!(release::parse_chained_file_name("surum-zincir-pkt-2027-1.json"), Some((ChainedFamily::Surum, Some("pkt-2027-1".into()))));
    for bad in ["son-zincir-pkt-2027-1.json", "surum-zincir-paket-2026.json", "surum.json", "x/surum-zincir.json", "surum-zincir-pkt-.json"]
    {
        assert_eq!(release::parse_chained_file_name(bad), None, "{bad}");
    }
}
