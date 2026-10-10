//! T1 Linux gerçek dumanının (`scripts/duman-linux.sh`, plan GUNCELLEYICI-SAGLAMLIK §9.1 K2) FİKSTÜRÜ. Elle koşulmaz:
//! betik çağırır (`#[ignore]`; ortam `TEKSERP_DUMAN_LINUX=<dizin>`, girdi `<dizin>/girdi.json`).
//!
//! Sahte dünyanın anahtarlarıyla (test kökü + `paket-2026`) imzalı, GERÇEK yapıtlı teslim paketleri üretir: betiğin
//! derlediği imaj arşivleri, teslim paketine giren güncelleyicili compose şablonu (`@@SURUM@@` doldurulur) ve dumanın
//! koşturduğu test çapalı ikili + onun `kunye` çıktısı. Yanında yerel CDN ağacı (`<kanal>/backend-oci/<v>/`), kiralar
//! (her biri bir öncekinden geç verilmiş — kira yenilenince güncelleyici işaretçiyi yeniden sorar), HAK, niyet ve
//! `TEKSERP_TEST_CAPASI` dosyası. Saatler GERÇEK saatten (duman gerçek saatle koşar).
mod common;

use common::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tekserp_guncelleyici::env::RealFs;
use tekserp_guncelleyici::layout::Layout;

fn oku(p: &Path) -> Vec<u8> {
    std::fs::read(p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

fn yaz(p: &Path, b: &[u8]) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, b).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
}

#[test]
#[ignore = "duman-linux.sh çağırır"]
fn duman_linux_hazirla() {
    let dir = PathBuf::from(std::env::var_os("TEKSERP_DUMAN_LINUX").expect("TEKSERP_DUMAN_LINUX (fikstür dizini) gerekli"));
    let girdi: Value = serde_json::from_slice(&oku(&dir.join("girdi.json"))).expect("girdi.json");
    let s = |k: &str| PathBuf::from(girdi[k].as_str().unwrap_or_else(|| panic!("girdi.{k}")));
    let sablon = String::from_utf8(oku(&s("sablon"))).unwrap();
    assert!(sablon.contains("@@SURUM@@"), "compose şablonunda @@SURUM@@ yok");
    let ikili = oku(&s("guncelleyici"));
    let kunye = oku(&s("kunye"));
    let kunye_v: Value = serde_json::from_slice(&kunye).expect("kunye JSON değil");
    assert_eq!(kunye_v["testCapasi"], json!(true), "duman test çapalı ikiliyle koşar");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    let keys = test_keys();
    let (signer, kid) = (&keys.package, "paket-2026");

    let anchor = test_anchor(&keys);
    let capa = json!({
        "roots": anchor.roots.iter().map(|r| json!({ "kid": r.kid, "x": r.x, "classes": r.classes })).collect::<Vec<_>>(),
        "packageKeys": anchor.package_keys.iter().map(|(k, x)| json!({ "kid": k, "x": x })).collect::<Vec<_>>(),
    });
    yaz(&dir.join("capa.json"), capa.to_string().as_bytes());

    let kanal = dir.join("cdn").join(CHANNEL).join("backend-oci");
    let mut son = String::new();
    for sv in girdi["surumler"].as_array().expect("girdi.surumler") {
        let v = sv["surum"].as_str().expect("surum");
        let goc = sv["gocSayisi"].as_u64().expect("gocSayisi");
        let arsiv = PathBuf::from(sv["arsiv"].as_str().expect("arsiv"));
        let olcum = tekserp_guncelleyici::imaj::olc(&RealFs, &arsiv).unwrap_or_else(|e| panic!("{v} imaj arşivi: {e}"));
        assert_eq!(olcum.etiketler, vec![format!("tekserp-korumali:{v}")], "{v}: arşivin etiketi");
        let edit = |k: &mut Value| {
            k["gocSayisi"] = json!(goc);
            k["imaj"]["kimlik"] = json!(olcum.kimlik);
            k["guncelleyici"]["surum"] = kunye_v["surum"].clone();
        };
        let compose = sablon.replace("@@SURUM@@", v).into_bytes();
        let files = oci_files_raw(v, &ikili, kunye.clone(), signer, kid, Some(CHANNEL), &edit, oku(&arsiv), compose);
        let tar = ustar_of(&files);
        let extra = json!({ "gocSayisi": goc, "imaj": { "kimlik": olcum.kimlik, "etiket": format!("tekserp-korumali:{v}") } });
        let payload = manifest_payload_oci(kid, v, &tar, Some(&extra));
        let paket = dir.join("paket").join(oci_package_name(v));
        yaz(&paket, &tar);
        drop(tar);
        let sdir = kanal.join(v);
        std::fs::create_dir_all(&sdir).unwrap();
        std::fs::hard_link(&paket, sdir.join(oci_package_name(v))).unwrap();
        yaz(&sdir.join("surum.json"), &pointer(&sign_manifest(signer, kid, &payload)));
        son = v.to_string();
    }

    // Kiralar: n'inci kira (n−1) dk sonra verilmiş sayılır; pencere şimdiden 7 gün açık, OTOMATİK.
    let kira_sayisi = girdi["kiraSayisi"].as_u64().unwrap_or(8) as i64;
    let son: &'static str = Box::leak(son.into_boxed_str());
    for n in 1..=kira_sayisi {
        let t = now + (n - 1) * 60_000;
        let opts = LeaseOpts {
            update: Some(policy("OTOMATIK", &[(now - HOUR, now + 7 * DAY)], None)),
            maintenance_end: Some(now + 365 * DAY),
            channel_backend: Some(son),
            ..LeaseOpts::default()
        };
        let (kira, hak) = lease_and_entitlement_in(&keys, &opts, t, CHANNEL);
        yaz(&dir.join("lisans").join(format!("kira-{n}.jws")), kira.as_bytes());
        if n == 1 {
            yaz(&dir.join("lisans").join("hak.jws"), hak.expect("HAK").as_bytes());
        }
    }
    let niyet = json!({ "v": 1, "yazildi": iso(now), "indirme": { "belirtec": TOKEN, "bitis": iso(now + 30 * DAY) }, "onay": null });
    yaz(&dir.join("niyet.json"), niyet.to_string().as_bytes());

    // Betiğin okuduğu yollar (güncelleyicinin düzeninden — betik elle kurmaz).
    let l = Layout::new(Path::new(&girdi["kok"].as_str().expect("girdi.kok")), Path::new(&girdi["veri"].as_str().expect("girdi.veri")));
    let yollar = [
        ("NIYET", l.intent_file()),
        ("DURUM", l.status_file()),
        ("LISANS", l.default_license_dir()),
        ("IS", l.work()),
        ("KANAL", kanal.clone()),
    ];
    let metin: String = yollar.iter().map(|(k, p)| format!("{k}={}\n", p.display())).collect();
    yaz(&dir.join("yollar.env"), metin.as_bytes());
}
