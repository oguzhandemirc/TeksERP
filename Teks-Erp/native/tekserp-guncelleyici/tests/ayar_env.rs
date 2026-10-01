//! Güncelleyicinin `.env` girdisi (Dağıtım v2 D2b): okuyucu biçimsiz satırı backend gibi sessizce
//! atlar, ama ZORUNLU anahtar (`settings::REQUIRED_BACKEND_KEYS`) backend'in okuyucusunda yok ya da
//! boşsa güncelleyici `AYAR_EKSIK` ile durur — ortak vektörlerin (`env-dosyasi.json`, üreten gerçek
//! dotenv) HER kaydında, iki yönlü. Kaydın `guncelleyici` alanı tam kodu sabitler.
use serde_json::Value;
use std::path::{Path, PathBuf};
use tekserp_guncelleyici::codes;
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::settings::{self, REQUIRED_BACKEND_KEYS};

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

/// `TAMAM` ya da `durum.json` `hataKodu` + ileti.
fn outcome(bytes: &[u8]) -> (String, Option<String>) {
    let layout = Layout::new(Path::new("/kok"), Path::new("/veri"));
    match settings::backend_env_from_bytes(bytes, &layout) {
        Ok(_) => ("TAMAM".into(), None),
        Err((code, message)) => (code.to_string(), Some(message)),
    }
}

#[test]
fn required_list_matches_vector_header() {
    let file = vector_file();
    let header: Vec<&str> = file["zorunlu"].as_array().expect("zorunlu").iter().map(|v| v.as_str().expect("ad")).collect();
    assert_eq!(header, REQUIRED_BACKEND_KEYS.to_vec(), "TS listesi (test_env_okuyucu) = Rust listesi");
}

#[test]
fn silent_skip_never_hides_a_required_key() {
    let file = vector_file();
    let records = file["kayitlar"].as_array().expect("kayitlar");
    let (mut pinned, mut skipped_by_reader) = (0, 0);
    for r in records {
        let name = r["vektor"]["ad"].as_str().expect("ad");
        let bytes = input_bytes(&r["vektor"]);
        let backend_missing = REQUIRED_BACKEND_KEYS.iter().any(|k| r["beklenen"][*k].as_str().is_none_or(str::is_empty));
        let (code, message) = outcome(&bytes);
        assert_eq!(
            code == codes::AYAR_EKSIK,
            backend_missing,
            "{name}: backend zorunlu anahtarı görmüyor={backend_missing}, güncelleyici {code}"
        );
        if let Some(want) = r["guncelleyici"].as_str() {
            assert_eq!(code, want, "{name}");
            pinned += 1;
            let text = String::from_utf8_lossy(&bytes);
            if code == codes::AYAR_EKSIK && REQUIRED_BACKEND_KEYS.iter().any(|k| text.contains(k)) {
                skipped_by_reader += 1;
            }
        }
        // Sır: ileti beklenen haritanın hiçbir değerini taşımaz.
        if let Some(m) = message {
            for v in r["beklenen"].as_object().expect("beklenen").values().filter_map(Value::as_str).filter(|v| v.len() >= 6) {
                assert!(!m.contains(v), "{name}: ileti değer sızdırıyor");
            }
        }
    }
    assert!(pinned >= 10, "kodu sabitlenmiş kayıt azaldı: {pinned}");
    assert!(skipped_by_reader >= 2, "anahtar adı metinde olup okuyucunun ATLADIĞI kayıt azaldı: {skipped_by_reader}");
}
