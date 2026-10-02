//! `.env` okuyucusunun backend eşliği (Dağıtım v2 D2b): `native/test-vektorleri/env-dosyasi.json`
//! (üreten GERÇEK dotenv — `Teks-Erp/scripts/test_env_okuyucu.ts --vektor-yaz`; elle düzenlenmez).
//! Her kaydın girdisi `envfile::parse_bytes`ten geçer; anahtar/değer haritası backend'in okuyucusunun
//! haritasına EŞİT olmalı (sıra sözleşme dışı). Bekçi tarafı `test_env_okuyucu` §2 dosyanın bayat
//! olmadığını ölçer.
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tekserp_hizmet::envfile;

fn vector_file() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri").join("env-dosyasi.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).expect("vektör dosyası JSON")
}

fn input_bytes(v: &Value) -> Vec<u8> {
    match (v["metin"].as_str(), v["baytHex"].as_str()) {
        (Some(t), None) => t.as_bytes().to_vec(),
        (None, Some(h)) => (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).expect("onaltılık")).collect(),
        _ => panic!("kayıt `metin` YA DA `baytHex` taşır: {v}"),
    }
}

#[test]
fn same_map_as_backend_reader() {
    let file = vector_file();
    assert_eq!(file["bicim"], 1, "vektör biçimi");
    assert!(file["okuyucu"].as_str().is_some_and(|s| s.starts_with("dotenv@")), "okuyucu: {}", file["okuyucu"]);
    let records = file["kayitlar"].as_array().expect("kayitlar");
    assert!(records.len() >= 40, "kayıt sayısı düştü: {}", records.len());
    let mut diverged = Vec::new();
    for r in records {
        let name = r["vektor"]["ad"].as_str().expect("ad");
        let expected: BTreeMap<String, String> = r["beklenen"]
            .as_object()
            .expect("beklenen")
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().expect("değer dize").to_string()))
            .collect();
        let got: BTreeMap<String, String> = envfile::parse_bytes(&input_bytes(&r["vektor"])).pairs.into_iter().collect();
        if got != expected {
            diverged.push(format!("{name}: backend {expected:?} ≠ rust {got:?}"));
        }
    }
    assert!(diverged.is_empty(), "{} / {} kayıt ayrıştı:\n{}", diverged.len(), records.len(), diverged.join("\n"));
}
