//! Güven çapası: kök anahtarları (kira zinciri) + PAKET anahtarları (manifest, bütünlük listesi).
//! Üretim ikilisi YALNIZ derlemeye gömülü çapayı kullanır (`tekserp_dogrulama::anchor`, lisans
//! çekirdeğiyle aynı liste). Testler çapayı parametre olarak verir; `test-anchor` özellikli derleme
//! (CI dumanı) `TEKSERP_TEST_CAPASI` JSON dosyasından okur — üretim derlemesinde bu yol YOKTUR.
use tekserp_dogrulama::anchor;
use tekserp_dogrulama::chain::RootKey;

#[derive(Debug, Clone)]
pub struct TrustAnchor {
    pub roots: Vec<RootKey>,
    /// (kid, açık anahtar base64url)
    pub package_keys: Vec<(String, String)>,
}

impl TrustAnchor {
    pub fn builtin() -> TrustAnchor {
        TrustAnchor { roots: anchor::builtin_roots(), package_keys: anchor::builtin_package_keys() }
    }

    pub fn package_key(&self, kid: &str) -> Option<[u8; 32]> {
        self.package_keys.iter().find(|(k, _)| k == kid).and_then(|(_, x)| tekserp_dogrulama::b64::decode_exact::<32>(x))
    }

    /// Çalışan ikilinin çapası: test derlemesinde ortamdaki dosya (varsa), aksi hâlde gömülü.
    pub fn for_process() -> Result<TrustAnchor, String> {
        #[cfg(feature = "test-anchor")]
        if let Some(p) = std::env::var_os("TEKSERP_TEST_CAPASI") {
            return from_json_file(std::path::Path::new(&p));
        }
        Ok(TrustAnchor::builtin())
    }
}

pub const TEST_ANCHOR: bool = cfg!(feature = "test-anchor");

/// Gömülü çapanın kipi (tek kip, `uretim`): künyede `capaKipi`; paketleme paketin kipiyle kıyaslar.
pub const ANCHOR_MODE: &str = anchor::MODE;

/// `{roots:[{kid,x,classes}], packageKeys:[{kid,x}]}` — lisans çekirdeğinin `builtinAnchor` biçimi.
#[cfg(feature = "test-anchor")]
fn from_json_file(p: &std::path::Path) -> Result<TrustAnchor, String> {
    let text = std::fs::read_to_string(p).map_err(|e| format!("test çapası okunamadı: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("test çapası JSON değil: {e}"))?;
    let s = |x: &serde_json::Value, k: &str| x.get(k).and_then(|y| y.as_str()).map(str::to_string);
    let roots = v["roots"]
        .as_array()
        .ok_or("roots yok")?
        .iter()
        .map(|r| {
            Some(RootKey {
                kid: s(r, "kid")?,
                x: s(r, "x")?,
                classes: r.get("classes")?.as_array()?.iter().map(|c| c.as_str().map(str::to_string)).collect::<Option<_>>()?,
            })
        })
        .collect::<Option<Vec<_>>>()
        .ok_or("roots biçimsiz")?;
    let package_keys = v["packageKeys"]
        .as_array()
        .ok_or("packageKeys yok")?
        .iter()
        .map(|k| Some((s(k, "kid")?, s(k, "x")?)))
        .collect::<Option<Vec<_>>>()
        .ok_or("packageKeys biçimsiz")?;
    Ok(TrustAnchor { roots, package_keys })
}
