//! Derlemeye GÖMÜLÜ güven çapası — TEK kip (üretim): `kok-*` kökleri + `paket-<yıl>` PAKET anahtarları.
//! Üretim çağıranı çapayı native'e VERMEZ: yamalı bir JS kendi kökünü geçiremesin diye çapa ikilinin
//! içindedir. Kaynak TS'tir — kâhin bekçisi (`test_lisans_native_kahin`) iki listeyi
//! `protocol/kok-anahtarlar.ts` ve `lib/license/integrity.ts` ile birebir karşılaştırır (hem bu kaynak metinden
//! hem çalışan ikilinin `builtinAnchor()`ından).
use crate::chain::RootKey;

/// Derlemenin çapa kipi (künyede `capaKipi`); TS yükleyicisi kendi kipinden farklı native'i açmaz.
pub const MODE: &str = "uretim";

/// `PRODUCTION_ROOT_PUBLIC_KEYS` aynası (kid, açık anahtar, sınıflar) — `scripts/guven-capasi-ekle.ts` yazar, elle düzenlenmez.
pub const PRODUCTION_ROOTS: &[(&str, &str, &[&str])] =
    &[("kok-2026-1", "sPveT3g3QhV8F_-xN2ZF0MVXFX1HHSiYzZ1GHYbPhEY", &["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"])];

/// `PRODUCTION_PACKAGE_PUBLIC_KEYS` aynası (kid, açık anahtar; sınıf kararı TS'te) — aynı betik yazar.
pub const PRODUCTION_PACKAGE_KEYS: &[(&str, &str)] = &[("paket-2026", "j7xjeBy3BGQu38IZrvaaJJFcQ0OJCp22z8fUNiYwaCM")];

pub fn builtin_roots() -> Vec<RootKey> {
    PRODUCTION_ROOTS
        .iter()
        .map(|(kid, x, classes)| RootKey {
            kid: (*kid).to_string(),
            x: (*x).to_string(),
            classes: classes.iter().map(|c| (*c).to_string()).collect(),
        })
        .collect()
}

pub fn builtin_package_keys() -> Vec<(String, String)> {
    PRODUCTION_PACKAGE_KEYS.iter().map(|(k, x)| ((*k).to_string(), (*x).to_string())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tek kip: gömülü çapa yalnız `kok-*` kökü ve `paket-*` PAKET anahtarı taşır (eski `hazirlik-*` ailesi yok).
    #[test]
    fn builtin_anchor_holds_only_production_family() {
        let roots = builtin_roots();
        let packages = builtin_package_keys();
        assert!(!roots.is_empty() && !packages.is_empty(), "{MODE} çapası boş");
        assert_eq!(MODE, "uretim");
        for r in &roots {
            assert!(r.kid.starts_with("kok-"), "çapada yabancı aile kökü: {}", r.kid);
        }
        for (kid, _) in &packages {
            assert!(kid.starts_with("paket-") && !kid.starts_with("paket-hazirlik"), "çapada yabancı aile PAKET anahtarı: {kid}");
        }
    }
}
