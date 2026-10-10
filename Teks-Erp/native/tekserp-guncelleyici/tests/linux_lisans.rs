//! Linux'ta lisansın yeri: backend kira/HAK/iptali compose biriminde (`<proje>_lisans`) tutar, konakta `<KOK>/lisans` YOK.
//! Güncelleyicinin turu, `onar`ı ve tanısı birimin konak dizinini `docker volume inspect` ile okur
//! (`settings::backend_env` · `settings::license_dir`). Deneme sunucusunda (P1a, 2026-10-10) iki ürün hatası buydu:
//! ① tur kalıcı `DONDURULDU/KIRA_YOK` · ② `current/… onar` HAK'ı (sınıfı) okuyamadığı için zincirli (`pkt-*`) kurulu sürümü
//! imzalı kaynak saymadı → `KendiDogrulanmadi`.
mod common;

use common::*;
use ed25519_dalek::SigningKey;
use serde_json::{json, Value};
use tekserp_dogrulama::paket_zinciri;
use tekserp_guncelleyici::ipc::State;
use tekserp_guncelleyici::onarim::{self, Options, Outcome};
use tekserp_guncelleyici::selfupdate::OWN_TARGET;
use tekserp_guncelleyici::trust::ANCHOR_MODE;

const PKT_KID: &str = "pkt-2026-1";

fn linux(tag: &str) -> World {
    World::new_in(Profil::Linux, tag, Setup::default())
}

/// ① Kira yalnız birimde: tur onu okur, karar `KIRA_YOK` değil, güncelleme biter.
#[test]
fn linux_kira_backend_biriminden_okunur() {
    let w = linux("lisans-birim");
    assert!(!w.layout.root.join("lisans").exists(), "fikstür: konakta <KOK>/lisans olmamalı");
    assert!(w.license_dir().join("kira.jws").is_file());
    w.run_to_rest(0);
    let s = w.status().expect("durum");
    assert_eq!(s.state, State::Succeeded, "{:?} {:?}", s.error_code, s.message);
    assert_eq!(w.current().as_deref(), Some(NEW));
}

/// Birim çözülemezse sessizce `<KOK>/lisans`e düşülmez: `KIRA_YOK` + birimin adı, hiçbir şey kurulmaz.
#[test]
fn linux_lisans_birimi_yoksa_kira_yok_ve_birim_adi() {
    let w = linux("lisans-birim-yok");
    let birim = w.license_dir();
    std::fs::remove_dir_all(birim.parent().unwrap()).unwrap();
    // Eski yanlış yer dolu olsa bile okunmaz.
    let tuzak = w.layout.root.join("lisans");
    std::fs::create_dir_all(&tuzak).unwrap();
    std::fs::write(tuzak.join("kira.jws"), "bozuk").unwrap();
    w.engine().tick(&|| false);
    let s = w.status().expect("durum");
    assert_eq!(s.error_code.as_deref(), Some("KIRA_YOK"), "{:?}", s.message);
    assert!(s.message.as_deref().unwrap_or_default().contains("tekserp_lisans"), "{:?}", s.message);
    assert_eq!(w.current().as_deref(), Some(OLD));
}

/// Sahte ikili = künyesi (onarım kaynağı künyesini sorar; `"onarim":1` taşıyan W1b ikilisi).
fn binary(version: &str) -> Vec<u8> {
    json!({ "ad": "tekserp-guncelleyici", "surum": version, "testCapasi": false, "hedef": OWN_TARGET, "capaKipi": ANCHOR_MODE, "onarim": 1 })
        .to_string()
        .into_bytes()
}

fn pkt_key() -> SigningKey {
    SigningKey::from_bytes(&[9; 32])
}

/// Zincirli OCI sürüm dizini (`PAKET-DOCKER.json.jws` `pkt-*` ile, PAKET sertifikası `siniflar` = `classes`) → `current`.
fn install_chained(w: &World, updater: &[u8], classes: &[&str]) {
    let cert = json!({
        "v": 1, "sertifikaId": "1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c", "kullanim": "PAKET", "kid": PKT_KID, "x": x_of(&pkt_key()),
        "siniflar": classes, "baslangic": iso(T0 - 10 * DAY), "bitis": iso(T0 + 170 * DAY), "bayi": null,
    });
    let cert = sign(&w.keys.root, "tekserp-sertifika", "kok-test-1", &cert);
    let dir = w.layout.version_dir(NEW);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let files = oci_files(NEW, updater, &pkt_key(), PKT_KID, None, &|_| {});
    let kunye: Value = serde_json::from_slice(&files.iter().find(|(n, _)| n == "PAKET-DOCKER.json").unwrap().1).unwrap();
    for (name, body) in files {
        let body = if name == "PAKET-DOCKER.json.jws" {
            let mut p = kunye.clone();
            p[paket_zinciri::PACKAGE_CERT_FIELD] = json!(cert);
            p[paket_zinciri::PACKAGE_SIGNED_AT_FIELD] = json!(iso(T0));
            format!("{}\n", sign(&pkt_key(), "tekserp-butunluk", PKT_KID, &p)).into_bytes()
        } else {
            body
        };
        std::fs::write(dir.join(name), body).unwrap();
    }
    tekserp_guncelleyici::env::Fs::set_link(&tekserp_guncelleyici::env::RealFs, &w.layout.current(), &dir).unwrap();
}

/// ② İlk açılış (`kendi.json` yok): `current/` ikilisi zincirli kurulu sürümün imzalı listesinde — HAK sınıfı birimden
/// okunduğu için kaynak sayılır; eksik asıl ad oradan konur.
#[test]
fn linux_onar_zincirli_kurulu_surumu_hak_biriminden_dogrular() {
    let w = linux("lisans-onar");
    let updater = binary("0.2.4");
    install_chained(&w, &updater, &["URETIM"]);
    assert!(!w.layout.self_update_file().exists(), "fikstür: ilk açılış, kendi.json yok");
    let env = w.env();
    let own = w.layout.current().join("tekserp-guncelleyici");
    let trust = onarim::installed_trust(&env, &w.layout, &w.anchor);
    let out = onarim::onar(&env, &w.layout, &own, Some(&trust), &Options { yalniz_asil_ad: true });
    assert!(
        matches!(&out, Outcome::Onarildi { kaynak, .. } if kaynak.contains("kurulu sürüm")),
        "{out:?} {:?}",
        w.status().and_then(|s| s.message)
    );
    assert_eq!(std::fs::read(onarim_target(&w)).unwrap(), updater);
}

/// Sınıf süzgeci yerinde kalır: sertifika bu kurulumun sınıfına (HAK `URETIM`) yetkili değilse zincirli dizin kaynak
/// DEĞİLDİR — düzeltme süzgeci gevşetmedi, yalnız HAK'ı doğru yerden okudu.
#[test]
fn linux_onar_sinifa_yetkisiz_zincirli_kaynak_olmaz() {
    let w = linux("lisans-onar-sinif");
    install_chained(&w, &binary("0.2.4"), &["TEST"]);
    let env = w.env();
    let own = w.layout.current().join("tekserp-guncelleyici");
    let trust = onarim::installed_trust(&env, &w.layout, &w.anchor);
    let out = onarim::onar(&env, &w.layout, &own, Some(&trust), &Options { yalniz_asil_ad: true });
    assert!(matches!(out, Outcome::KendiDogrulanmadi(_)), "{out:?}");
}

fn onarim_target(w: &World) -> std::path::PathBuf {
    tekserp_guncelleyici::selfupdate::asil_ad_path(&w.env(), &w.layout)
}
