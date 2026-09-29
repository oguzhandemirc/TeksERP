//! Derlemeye GÖMÜLÜ güven çapaları. Üretim çağıranı çapayı native'e VERMEZ: yamalı bir JS
//! kendi kökünü geçiremesin diye çapa ikilinin içindedir. Kaynak TS'tir — kâhin bekçisi
//! (`test_lisans_native_kahin`) bu listeyi `protocol/kok-anahtarlar.ts` `ROOT_PUBLIC_KEYS` ve
//! `lib/license/integrity.ts` `PACKAGE_PUBLIC_KEYS` ile birebir karşılaştırır (hem çalışan
//! ikiliden hem bu kaynak metinden).
use crate::chain::RootKey;

/// `ROOT_PUBLIC_KEYS` aynası — bugün yalnız hazırlık kökü (TEST/DEMO).
pub const BUILTIN_ROOTS: &[(&str, &str, &[&str])] =
    &[("hazirlik-2026-1", "705hChzAL045Gp-XoG6SaUKAW8muK1SFcW0Vpwhf-mo", &["TEST", "DEMO"])];

/// `PACKAGE_PUBLIC_KEYS` aynası — bugün yalnız hazırlık PAKET anahtarı (TEST/DEMO; sınıf kararı TS'te).
pub const BUILTIN_PACKAGE_KEYS: &[(&str, &str)] = &[("paket-hazirlik", "auFAoNnXZDIWdyLJ5EVsakwMquIa_GHqCyKxZHz16Z8")];

pub fn builtin_roots() -> Vec<RootKey> {
    BUILTIN_ROOTS
        .iter()
        .map(|(kid, x, classes)| RootKey {
            kid: (*kid).to_string(),
            x: (*x).to_string(),
            classes: classes.iter().map(|c| (*c).to_string()).collect(),
        })
        .collect()
}

pub fn builtin_package_keys() -> Vec<(String, String)> {
    BUILTIN_PACKAGE_KEYS.iter().map(|(k, x)| ((*k).to_string(), (*x).to_string())).collect()
}
