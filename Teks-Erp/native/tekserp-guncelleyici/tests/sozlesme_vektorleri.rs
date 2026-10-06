//! Güncelleme sözleşmesinin (D1, `docs/design/GUNCELLEYICI.md` §1–§3) Rust aynası TS ile AYNI mı:
//! `Teks-Erp/native/test-vektorleri/guncelleme-{surum,kira,karar,rapor}.json` (üreten D1'in TS
//! kâhini, `--vektor-yaz`; elle düzenlenmez). Kayıt başına TS'in
//! beklenen sonucu: hata metni değil yalnız kod ve (başarıda) şemanın atılmış çıktısı karşılaştırılır.
//! Kiranın `guncelleme` şeması (`politika` · `kira-yuku`) ortak crate'te ölçülür
//! (`tekserp-dogrulama/tests/guncelleme_kira.rs`).
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_dogrulama::schema;
use tekserp_guncelleyici::decision::{self, InstalledPg, UpdatePolicy};
use tekserp_guncelleyici::ipc::UpdateResult;
use tekserp_guncelleyici::release::{self, PackageIdentity, PgPackageManifest, PgRequirement, ReleaseManifest};
use tekserp_guncelleyici::version;

fn records(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri").join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let v: Value = serde_json::from_str(&text).expect("vektör dosyası JSON");
    assert_eq!(v["bicim"], json!(1), "{file}: vektör biçimi");
    v["kayitlar"].as_array().expect("kayitlar").clone()
}

fn keys_of(v: &Value) -> Vec<(String, String)> {
    v.as_array()
        .map(|a| {
            a.iter().map(|k| (k["kid"].as_str().unwrap_or_default().to_string(), k["x"].as_str().unwrap_or_default().to_string())).collect()
        })
        .unwrap_or_default()
}

fn outcome<T>(r: Result<T, tekserp_dogrulama::outcome::Fail>, value: impl FnOnce(T) -> Value) -> Value {
    match r {
        Ok(x) => json!({ "ok": true, "value": value(x) }),
        Err(f) => json!({ "ok": false, "code": f.code }),
    }
}

fn typed<T: serde::de::DeserializeOwned>(v: &Value, what: &str) -> T {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{what} tipe dönüşmedi: {e}\n{v}"))
}

/// Bir kaydın BUGÜNKÜ Rust sonucu (TS `guncellemeDegerlendir` karşılığı); tanınmayan tür `None`.
fn evaluate(v: &Value) -> Option<Value> {
    Some(match v["tur"].as_str()? {
        "bildirim" => outcome(
            release::verify_release_manifest(
                &v["token"],
                &PackageTrust::embedded(keys_of(&v["keys"])),
                v["kanal"].as_str().unwrap_or_default(),
            ),
            |c| Value::Object(c.shaped),
        ),
        "isaretci" => outcome(release::read_release_pointer(v["metin"].as_str().unwrap_or_default()), Value::String),
        "pg-kunye" => outcome(release::verify_pg_package_manifest(&v["token"], &PackageTrust::embedded(keys_of(&v["keys"]))), |c| {
            Value::Object(c.shaped)
        }),
        "pg-bagi" => {
            let req: PgRequirement = typed(&v["gereksinim"], "gereksinim");
            let k: PgPackageManifest = typed(&v["kunye"], "künye");
            outcome(release::check_pg_binding(&req, &k), |()| Value::Bool(true))
        }
        "paket-bagi" => {
            let m: ReleaseManifest = typed(&v["bildirim"], "bildirim");
            let p: PackageIdentity = typed(&v["paket"], "paket künyesi");
            outcome(release::check_package_binding(&m, &p), |()| Value::Bool(true))
        }
        "surum-karsilastir" => match version::compare(v["a"].as_str()?, v["b"].as_str()?) {
            None => Value::Null,
            Some(o) => json!(o as i8),
        },
        "karar" => {
            let g = &v["girdi"];
            let politika: Option<UpdatePolicy> = typed(&g["politika"], "politika");
            let pg: Option<InstalledPg> = typed(&g["pg"], "pg");
            let aday: Option<ReleaseManifest> = typed(&g["aday"], "aday");
            let onay: Option<decision::Approval> = typed(&g["onay"], "onay");
            let d = decision::decide(&decision::Input {
                politika: politika.as_ref(),
                guncelleme_donuk: g["guncellemeDonuk"].as_bool().expect("guncellemeDonuk"),
                bakim_bitis_ms: g["bakimBitisMs"].as_f64(),
                kurulu_surum: g["kuruluSurum"].as_str().expect("kuruluSurum"),
                pg: pg.as_ref(),
                aday: aday.as_ref(),
                onay: onay.as_ref(),
                now_ms: g["nowMs"].as_f64().expect("nowMs"),
            });
            serde_json::to_value(&d).expect("karar JSON")
        }
        "etkin-politika" => {
            let lease = match &v["kira"] {
                Value::Null => None,
                Value::Object(m) => match schema::decode(schema::lease, m) {
                    Ok(doc) => Some(doc),
                    Err(f) => return Some(json!({ "gecersizKira": f.code })),
                },
                _ => return Some(json!({ "gecersizKira": "BELGE_SEMA" })),
            };
            match decision::effective_update_policy(lease.as_ref(), v["nowMs"].as_f64().expect("nowMs")) {
                None => Value::Null,
                Some((p, src)) => json!({ "politika": p, "kaynak": src }),
            }
        }
        "rapor" => {
            // Raporu backend kurar; Rust tarafı yalnız `son` biçiminin (UpdateResultSchema, KATI) birebir
            // aynı olduğunu ölçer: geçerli rapordaki `son` tipe girer ve AYNEN geri çıkar.
            let son = &v["girdi"]["son"];
            if son.is_object() {
                if let Ok(r) = serde_json::from_value::<UpdateResult>(son.clone()) {
                    return Some(json!({ "sonAynen": serde_json::to_value(&r).expect("son") == *son }));
                }
                return Some(json!({ "sonAynen": false }));
            }
            return None;
        }
        _ => return None,
    })
}

#[test]
fn contract_vectors_match_ts() {
    let mut seen: BTreeMap<String, usize> = BTreeMap::new();
    let mut diffs = vec![];
    for file in ["guncelleme-surum.json", "guncelleme-kira.json", "guncelleme-karar.json", "guncelleme-rapor.json"] {
        for r in records(file) {
            let v = &r["vektor"];
            let tur = v["tur"].as_str().unwrap_or("?").to_string();
            let Some(got) = evaluate(v) else { continue };
            *seen.entry(tur.clone()).or_default() += 1;
            let want = if tur == "rapor" {
                // Geçerli rapordaki `son` birebir; geçersiz rapor Rust'ta ölçülmez (backend doğrular).
                if r["beklenen"]["ok"] != json!(true) {
                    continue;
                }
                json!({ "sonAynen": true })
            } else {
                r["beklenen"].clone()
            };
            if got != want {
                diffs.push(format!("{file} · {tur} · {}\n  beklenen {want}\n  gelen    {got}", v["ad"]));
            }
        }
    }
    assert!(diffs.is_empty(), "{} kayıt TS'ten ayrışıyor:\n{}", diffs.len(), diffs.join("\n"));
    for (tur, min) in [
        ("bildirim", 15),
        ("isaretci", 4),
        ("pg-kunye", 6),
        ("pg-bagi", 5),
        ("paket-bagi", 6),
        ("karar", 30),
        ("surum-karsilastir", 8),
        ("etkin-politika", 4),
        ("rapor", 1),
    ] {
        assert!(
            seen.get(tur).copied().unwrap_or(0) >= min,
            "{tur}: {} kayıt (en az {min} beklenir) — {seen:?}",
            seen.get(tur).unwrap_or(&0)
        );
    }
}

/// Karar kapsamı: TS'in her karar türü ve nedeni en az bir kayıtta Rust'tan da çıkar (kör aynalık yok).
#[test]
fn every_decision_reason_is_exercised() {
    let mut reasons = std::collections::BTreeSet::new();
    for r in records("guncelleme-karar.json").iter().filter(|r| r["vektor"]["tur"] == "karar") {
        let got = evaluate(&r["vektor"]).expect("karar");
        reasons.insert(format!("{}/{}", got["karar"].as_str().unwrap_or("?"), got["neden"].as_str().unwrap_or("-")));
    }
    for want in [
        "DONDURULDU/KIRA_YOK",
        "DONDURULDU/YAPTIRIM",
        "DONDURULDU/POLITIKA",
        "GUNCEL/HEDEF_ULASILDI",
        "GUNCEL/ADAY_YOK",
        "GUNCEL/SURUM_GUNCEL",
        "UYGUN_DEGIL/HEDEF_DISI",
        "UYGUN_DEGIL/KAYNAK_SURUM_ESKI",
        "UYGUN_DEGIL/HAK_YOK",
        "UYGUN_DEGIL/BAKIM_DISI",
        "UYGUN_DEGIL/PG_OLCULEMEDI",
        "UYGUN_DEGIL/PG_ANA_SURUM",
        "UYGUN_DEGIL/PG_SURUMU_ESKI",
        "ONAY_BEKLIYOR/-",
        "PENCERE_BEKLIYOR/-",
        "PENCERE_BEKLIYOR/PENCERE_YOK",
        "KUR/ONAY_HEMEN",
        "KUR/PENCERE",
    ] {
        assert!(reasons.contains(want), "{want} hiçbir vektörde çıkmadı: {reasons:?}");
    }
}
