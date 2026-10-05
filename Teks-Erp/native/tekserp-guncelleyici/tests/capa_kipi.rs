//! G3 — güncelleyicinin GÖMÜLÜ çapası tek kiptir ve lisans çekirdeğininkiyle AYNI kaynaktır (ortak
//! `tekserp_dogrulama::anchor`, özellik `hazirlik-capasi`): üretim derlemesi hazırlık PAKET/kök imzalı belgeyi
//! REDDEDER, hazırlık derlemesi üretim imzalı olanı. Test çapası değil, derlemenin gerçek gömülü çapası koşar;
//! gerçek özel yarı gerekmez: öteki kipin kid'i çapada YOKTUR → `JWS_KID` / `KOK_BILINMIYOR`; kendi kipinin kid'i
//! yabancı anahtarla imzalanınca kid TANINIR ve yalnız imza düşer — testin ayırt ettiği budur.
//! İki kipte koşar: `cargo test` (üretim) ve `cargo test --features hazirlik-capasi` (`native/scripts/kapi.mjs test`).
mod common;

use common::*;
use ed25519_dalek::SigningKey;
use serde_json::Value;
use tekserp_dogrulama::outcome::code;
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_dogrulama::{anchor, b64, chain};
use tekserp_guncelleyici::codes;
use tekserp_guncelleyici::kurulum;
use tekserp_guncelleyici::policy;
use tekserp_guncelleyici::release;
use tekserp_guncelleyici::trust::{self, TrustAnchor, ANCHOR_MODE};

const STAGING: bool = cfg!(feature = "hazirlik-capasi");

/// Yabancı imzalayan: hiçbir çapada olmayan anahtar.
fn stranger() -> SigningKey {
    SigningKey::from_bytes(&[0x5a; 32])
}

/// Öteki kip ailesinin temsilci kid'leri (bu derlemenin çapasında OLMAMALI).
fn foreign_package_kid() -> &'static str {
    if STAGING {
        "paket-2026"
    } else {
        "paket-hazirlik"
    }
}

fn foreign_root_kid() -> &'static str {
    if STAGING {
        "kok-2026-1"
    } else {
        "hazirlik-2026-1"
    }
}

fn own_package_kid() -> String {
    TrustAnchor::builtin().package_keys.first().expect("gömülü PAKET anahtarı").0.clone()
}

fn payload_of(token: &str) -> Value {
    let mid = token.split('.').nth(1).expect("JWS");
    serde_json::from_slice(&b64::decode_strict(mid).expect("base64url")).expect("JSON")
}

#[test]
fn builtin_anchor_is_the_shared_single_mode_anchor() {
    assert_eq!(ANCHOR_MODE, anchor::MODE);
    assert_eq!(ANCHOR_MODE, if STAGING { "hazirlik" } else { "uretim" });
    let a = TrustAnchor::builtin();
    let roots: Vec<_> = a.roots.iter().map(|r| (r.kid.clone(), r.x.clone(), r.classes.clone())).collect();
    let shared: Vec<_> = anchor::builtin_roots().into_iter().map(|r| (r.kid, r.x, r.classes)).collect();
    assert_eq!(roots, shared, "güncelleyicinin kökleri ortak crate'inkiler değil");
    assert_eq!(a.package_keys, anchor::builtin_package_keys(), "güncelleyicinin PAKET anahtarları ortak crate'inkiler değil");
    assert!(!a.roots.is_empty() && !a.package_keys.is_empty(), "{ANCHOR_MODE} çapası boş");
    for r in &a.roots {
        assert_eq!(r.kid.starts_with("hazirlik-"), STAGING, "{ANCHOR_MODE} çapasında öteki kipin kökü: {}", r.kid);
    }
    for (kid, _) in &a.package_keys {
        assert_eq!(trust::is_staging_package_kid(kid), STAGING, "{ANCHOR_MODE} çapasında öteki kipin PAKET anahtarı: {kid}");
    }
    assert!(!a.package_keys.iter().any(|(k, _)| k == foreign_package_kid()));
    assert!(!a.roots.iter().any(|r| r.kid == foreign_root_kid()));
}

/// Sürüm bildirimi (`surum.json`, PAKET imzalı): öteki kipin PAKET kid'i → `JWS_KID`. Sınıf TEST verilir — politika
/// hazırlık anahtarını bu sınıfta kümeye ALIR; red yalnız çapadan gelmeli.
#[test]
fn foreign_mode_package_signed_manifest_is_rejected() {
    let keys = PackageTrust::embedded(policy::package_keys(&TrustAnchor::builtin(), Some("TEST")));
    let zip = b"paket".to_vec();
    let verify = |kid: &str| {
        let token = sign_manifest(&stranger(), kid, &manifest_payload(kid, NEW, &zip, None));
        release::verify_release_manifest(&Value::String(token), &keys, CHANNEL).map(|_| ()).map_err(|f| f.code)
    };
    assert_eq!(verify(foreign_package_kid()), Err(code::JWS_KID), "{ANCHOR_MODE} güncelleyicisi öteki kipin PAKET imzasını tanımamalı");
    assert_eq!(verify(&own_package_kid()), Err(code::JWS_IMZA), "kendi kipinin kid'i tanınır, yalnız imza düşer");
}

/// İlk kurulum doğrulayıcısı (`kurulum-paket`, gömülü çapanın BÜTÜN PAKET anahtarları): öteki kipin PAKET imzalı
/// paketi açılmaz, hedef dizin kalmaz. Kod `BUTUNLUK_GECERSIZ`, iç neden iletide (`(JWS_KID)` / `(JWS_IMZA)`).
#[test]
fn foreign_mode_package_integrity_is_rejected_by_installer() {
    let keys = PackageTrust::embedded(TrustAnchor::builtin().package_keys);
    let run = |tag: &str, kid: &str| {
        let dir = std::env::temp_dir().join(format!("tekserp-capa-kipi-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut files = version_files(NEW);
        files.extend(integrity_files(&files, NEW, &stranger(), kid, Some(CHANNEL)));
        let zip = dir.join("paket.zip");
        std::fs::write(&zip, zip_of(&files)).unwrap();
        let target = dir.join("hedef");
        let r = kurulum::backend_paketi(&zip, &target, &keys).map(|_| ()).map_err(|e| (e.kod, e.mesaj));
        assert!(!target.exists(), "{tag}: reddedilen paketin hedefi kalmamalı");
        let _ = std::fs::remove_dir_all(&dir);
        r
    };
    let reason = |r: Result<(), (&str, String)>| match r {
        Err((codes::BUTUNLUK_GECERSIZ, m)) => [code::JWS_KID, code::JWS_IMZA].into_iter().find(|c| m.contains(&format!("({c})"))),
        _ => None,
    };
    assert_eq!(
        reason(run("oteki", foreign_package_kid())),
        Some(code::JWS_KID),
        "{ANCHOR_MODE} kurulum doğrulayıcısı öteki kipin paketini açmamalı"
    );
    assert_eq!(reason(run("kendi", &own_package_kid())), Some(code::JWS_IMZA), "kendi kipinin kid'i tanınır, yalnız imza düşer");
}

/// Kira zincirinin kökü (HAK kökle imzalı): öteki kipin kök kid'i → `KOK_BILINMIYOR`.
#[test]
fn foreign_mode_root_signed_entitlement_is_rejected() {
    let keys = Keys {
        root: stranger(),
        alt: SigningKey::from_bytes(&[2; 32]),
        package: SigningKey::from_bytes(&[3; 32]),
        staging: SigningKey::from_bytes(&[4; 32]),
    };
    let (_, hak) = lease_and_entitlement(&keys, &LeaseOpts::default(), T0);
    let doc = payload_of(&hak.expect("HAK"));
    let roots = TrustAnchor::builtin().roots;
    let verify = |kid: &str| {
        chain::verify_entitlement(&Value::String(sign(&stranger(), "tekserp-hak", kid, &doc)), &roots, None, None)
            .map(|_| ())
            .map_err(|f| f.code)
    };
    assert_eq!(verify(foreign_root_kid()), Err(code::KOK_BILINMIYOR), "{ANCHOR_MODE} güncelleyicisi öteki kipin kökünü tanımamalı");
    let own = roots.first().expect("gömülü kök").kid.clone();
    assert_ne!(verify(&own), Err(code::KOK_BILINMIYOR), "kendi kipinin kökü tanınır (imza düşer)");
    assert!(verify(&own).is_err());
}
