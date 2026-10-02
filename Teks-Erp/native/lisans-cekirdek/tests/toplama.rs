//! Parmak izi TOPLAMA vektörleri (K8 çok yollu okuma, L2-10): TS kâhininin ürettiği `test-vektorleri/toplama.json`
//! (Teks-Erp `scripts/test_lisans_native_kahin.ts --vektor-yaz --yalniz-toplama`) burada native seçimden, Windows
//! sonda çözücüsünden ve SMBIOS okuyucusundan geçer; her sonuç TS'in beklenen sonucuna EŞİT olmalıdır. G/Ç yok —
//! her platformda koşar (Windows ve Linux mantığı Mac'te de sınanır).

use lisans_cekirdek::{api, b64, paths};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

const VEKTOR_TOPLAMA_BICIMI: u64 = 1;
/// Aile başına alt sınır: boş ya da budanmış dosya yeşil vermesin.
const MIN_PER_FAMILY: [(&str, usize); 3] = [("toplama", 25), ("windowsCikti", 8), ("smbios", 10)];

fn vector_file() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test-vektorleri").join("toplama.json");
    let text = std::fs::read_to_string(&path).expect("toplama.json okunamadı (TS kâhiniyle üret)");
    serde_json::from_str(&text).expect("toplama.json JSON değil")
}

fn outcomes_from(v: &Value) -> paths::Outcomes {
    v.as_object().expect("sonuclar nesne değil").iter().map(|(k, x)| (k.clone(), x.as_str().map(str::to_string))).collect()
}

fn outcomes_json(o: &paths::Outcomes) -> Value {
    Value::Object(o.iter().map(|(k, v)| (k.clone(), v.clone().map_or(Value::Null, Value::String))).collect::<Map<String, Value>>())
}

fn hex_bytes(text: &str) -> Vec<u8> {
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex")).collect()
}

fn evaluate(v: &Value, salt: &[u8]) -> Value {
    match v["tur"].as_str() {
        Some("toplama") => {
            let platform = v["platform"].as_str();
            let f5 = v["f5"].as_str().map(str::to_string);
            api::collected_value(platform, &outcomes_from(&v["sonuclar"]), salt, f5).expect("toplama")
        }
        Some("windowsCikti") => {
            let outcomes = paths::parse_windows_output(v["stdout"].as_str().expect("stdout"));
            let toplama = api::collected_value(Some("win32"), &outcomes, salt, None).expect("toplama");
            json!({ "sonuclar": outcomes_json(&outcomes), "toplama": toplama })
        }
        Some("smbios") => {
            let bytes = hex_bytes(v["hex"].as_str().expect("hex"));
            json!({ "dizgeler": paths::smbios_strings(&bytes), "seri": paths::smbios_serial(&bytes), "uuid": paths::smbios_uuid(&bytes) })
        }
        other => panic!("bilinmeyen toplama vektörü türü: {other:?}"),
    }
}

#[test]
fn toplama_vectors_match_ts() {
    let file = vector_file();
    assert_eq!(file["bicim"].as_u64(), Some(VEKTOR_TOPLAMA_BICIMI), "toplama.json biçimi");
    let salt = b64::decode_strict(file["tuz"].as_str().expect("tuz")).expect("tuz base64url");
    let records = file["kayitlar"].as_array().expect("kayitlar");
    let mut differences = Vec::new();
    for r in records {
        let got = evaluate(&r["vektor"], &salt);
        if got != r["beklenen"] {
            differences.push(format!("{} · {}\n  beklenen {}\n  gelen    {}", r["vektor"]["tur"], r["vektor"]["ad"], r["beklenen"], got));
        }
    }
    assert!(differences.is_empty(), "{} fark:\n{}", differences.len(), differences.join("\n"));
    for (family, min) in MIN_PER_FAMILY {
        let n = records.iter().filter(|r| r["vektor"]["tur"] == family).count();
        assert!(n >= min, "{family}: {n} kayıt (en az {min})");
    }
}

#[test]
fn raid_vector_pins_uniqueid_fallback() {
    // SAHINSRV'deki RST RAID-1: üç seri yolu genel desende → kimlik (UniqueId) türü devreye girer.
    let file = vector_file();
    let raid = file["kayitlar"]
        .as_array()
        .expect("kayitlar")
        .iter()
        .find(|r| r["vektor"]["ad"].as_str().is_some_and(|a| a.contains("RAID (SAHINSRV")))
        .expect("RAID vektörü dosyada yok");
    assert_eq!(raid["beklenen"]["okuma"]["f3"]["yol"], "f3.disk-kimlik");
}
