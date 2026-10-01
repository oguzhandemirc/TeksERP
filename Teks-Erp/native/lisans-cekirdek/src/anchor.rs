//! Derlemeye GÖMÜLÜ güven çapaları — derleme kipine göre İKİ liste, aynı ikilide birleşmez: özelliksiz
//! derleme ÜRETİM çapasını, `hazirlik-capasi` özelliği HAZIRLIK çapasını taşır (öteki listenin baytı
//! ikiliye girmez). Üretim çağıranı çapayı native'e VERMEZ: yamalı bir JS kendi kökünü geçiremesin diye çapa
//! ikilinin içindedir. Kaynak TS'tir — kâhin bekçisi (`test_lisans_native_kahin`) dört listeyi
//! `protocol/kok-anahtarlar.ts` ve `lib/license/integrity.ts` ile birebir karşılaştırır (hem bu kaynak metinden
//! hem çalışan ikilinin `builtinAnchor()`ından).
use crate::chain::RootKey;

/// Derlemenin çapa kipi (künyede `capaKipi`); TS yükleyicisi kendi kipinden farklı native'i açmaz.
#[cfg(not(feature = "hazirlik-capasi"))]
pub const MODE: &str = "uretim";
#[cfg(feature = "hazirlik-capasi")]
pub const MODE: &str = "hazirlik";

/// `PRODUCTION_ROOT_PUBLIC_KEYS` aynası (kid, açık anahtar, sınıflar) — `scripts/guven-capasi-ekle.ts` yazar, elle düzenlenmez.
#[cfg(not(feature = "hazirlik-capasi"))]
pub const PRODUCTION_ROOTS: &[(&str, &str, &[&str])] =
    &[("kok-2026-1", "sPveT3g3QhV8F_-xN2ZF0MVXFX1HHSiYzZ1GHYbPhEY", &["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"])];

/// `PRODUCTION_PACKAGE_PUBLIC_KEYS` aynası (kid, açık anahtar; sınıf kararı TS'te) — aynı betik yazar.
#[cfg(not(feature = "hazirlik-capasi"))]
pub const PRODUCTION_PACKAGE_KEYS: &[(&str, &str)] = &[("paket-2026", "j7xjeBy3BGQu38IZrvaaJJFcQ0OJCp22z8fUNiYwaCM")];

/// `STAGING_ROOT_PUBLIC_KEYS` aynası (yalnız TEST/DEMO) — aynı betik yazar.
#[cfg(feature = "hazirlik-capasi")]
pub const STAGING_ROOTS: &[(&str, &str, &[&str])] =
    &[("hazirlik-2026-1", "705hChzAL045Gp-XoG6SaUKAW8muK1SFcW0Vpwhf-mo", &["TEST", "DEMO"])];

/// `STAGING_PACKAGE_PUBLIC_KEYS` aynası — aynı betik yazar.
#[cfg(feature = "hazirlik-capasi")]
pub const STAGING_PACKAGE_KEYS: &[(&str, &str)] = &[("paket-hazirlik", "auFAoNnXZDIWdyLJ5EVsakwMquIa_GHqCyKxZHz16Z8")];

#[cfg(not(feature = "hazirlik-capasi"))]
const ROOTS: &[(&str, &str, &[&str])] = PRODUCTION_ROOTS;
#[cfg(not(feature = "hazirlik-capasi"))]
const PACKAGE_KEYS: &[(&str, &str)] = PRODUCTION_PACKAGE_KEYS;
#[cfg(feature = "hazirlik-capasi")]
const ROOTS: &[(&str, &str, &[&str])] = STAGING_ROOTS;
#[cfg(feature = "hazirlik-capasi")]
const PACKAGE_KEYS: &[(&str, &str)] = STAGING_PACKAGE_KEYS;

pub fn builtin_roots() -> Vec<RootKey> {
    ROOTS
        .iter()
        .map(|(kid, x, classes)| RootKey {
            kid: (*kid).to_string(),
            x: (*x).to_string(),
            classes: classes.iter().map(|c| (*c).to_string()).collect(),
        })
        .collect()
}

pub fn builtin_package_keys() -> Vec<(String, String)> {
    PACKAGE_KEYS.iter().map(|(k, x)| ((*k).to_string(), (*x).to_string())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kip ailesi: üretim derlemesinde hazırlık kökü/PAKET anahtarı, hazırlık derlemesinde üretim olanı YOK.
    #[test]
    fn builtin_anchor_holds_only_its_mode_family() {
        let staging = MODE == "hazirlik";
        let roots = builtin_roots();
        let packages = builtin_package_keys();
        assert!(!roots.is_empty() && !packages.is_empty(), "{MODE} çapası boş");
        for r in &roots {
            assert_eq!(r.kid.starts_with("hazirlik-"), staging, "{MODE} çapasında yabancı aile kökü: {}", r.kid);
        }
        for (kid, _) in &packages {
            assert_eq!(kid.starts_with("paket-hazirlik"), staging, "{MODE} çapasında yabancı aile PAKET anahtarı: {kid}");
        }
    }
}
