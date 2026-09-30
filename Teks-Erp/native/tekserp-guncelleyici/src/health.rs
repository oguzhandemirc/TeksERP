//! Sağlık (§8.7): `GET http://127.0.0.1:<PORT>/health` — HTTP 200 · `status=UP` · `db=UP` ·
//! `version` = beklenen. Lisans (D3: yalnız döngü adresine `lisans{kip,butunluk,cekirdek}`) işlem
//! öncesi görüntüden KÖTÜ olamaz; yeni sürümde alan yoksa ölçülemedi sayılır (fail-closed).
use crate::codes;
use crate::env::Env;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct LicenseHealth {
    pub kip: Option<String>,
    pub butunluk: Option<String>,
    pub cekirdek: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Health {
    pub up: bool,
    pub db_up: bool,
    pub version: Option<String>,
    pub license: Option<LicenseHealth>,
}

pub fn url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/health")
}

pub fn probe(env: &Env, port: u16) -> Option<Health> {
    let r = env.net.get(&url(port), &[], Duration::from_secs(5)).ok()?;
    if r.status != 200 {
        return None;
    }
    let mut body = Vec::new();
    r.body.take(256 * 1024).read_to_end(&mut body).ok()?;
    let v: Value = serde_json::from_slice(&body).ok()?;
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    let license = v.get("lisans").and_then(|l| serde_json::from_value::<LicenseHealth>(l.clone()).ok());
    Some(Health { up: s("status").as_deref() == Some("UP"), db_up: s("db").as_deref() == Some("UP"), version: s("version"), license })
}

#[derive(Debug, Clone)]
pub struct Criteria {
    pub version: String,
    pub require_license: bool,
    pub baseline: Option<LicenseHealth>,
}

const BAD_MODES: [&str; 2] = ["KISITLI", "DURDURULMUS"];

/// Lisansın işlem öncesine göre kötüleşip kötüleşmediği (bilinmeyen değer "kötü" sayılmaz; yalnız
/// açık kötüleşme: GEÇERLİ → değil · native → değil · normal → KISITLI/DURDURULMUŞ).
pub fn license_regressed(now: &LicenseHealth, before: Option<&LicenseHealth>) -> Option<String> {
    if now.butunluk.as_deref() == Some("GECERSIZ") {
        return Some("bütünlük GEÇERSİZ".into());
    }
    let b = before?;
    if b.butunluk.as_deref() == Some("GECERLI") && now.butunluk.as_deref() != Some("GECERLI") {
        return Some(format!("bütünlük {:?} (önce GECERLI)", now.butunluk));
    }
    if b.cekirdek.as_deref() == Some("native") && now.cekirdek.as_deref() != Some("native") {
        return Some(format!("lisans çekirdeği {:?} (önce native)", now.cekirdek));
    }
    let was_bad = b.kip.as_deref().is_some_and(|k| BAD_MODES.contains(&k));
    if !was_bad && now.kip.as_deref().is_some_and(|k| BAD_MODES.contains(&k)) {
        return Some(format!("lisans kipi {:?} (önce {:?})", now.kip, b.kip));
    }
    None
}

/// Tek gözlem: `Ok` = sağlıklı; `Err(Some(kod))` = kesin hata; `Err(None)` = henüz değil (beklemeye devam).
fn judge(h: &Health, c: &Criteria) -> Result<(), Option<(&'static str, String)>> {
    if !h.up {
        return Err(None);
    }
    if h.version.as_deref() != Some(c.version.as_str()) {
        return Err(Some((codes::SAGLIK_SURUM, format!("çalışan sürüm {:?}, beklenen {}", h.version, c.version))));
    }
    if !h.db_up {
        return Err(None);
    }
    if c.require_license {
        match &h.license {
            None => return Err(None),
            Some(l) => {
                if let Some(why) = license_regressed(l, c.baseline.as_ref()) {
                    return Err(Some((codes::SAGLIK_LISANS, why)));
                }
            }
        }
    }
    Ok(())
}

/// Zaman aşımına dek dener; son gözlemden hata kodu türetir.
pub fn wait_healthy(env: &Env, port: u16, c: &Criteria, timeout: Duration) -> Result<Health, (&'static str, String)> {
    let deadline = env.clock.now_ms() + i64::try_from(timeout.as_millis()).unwrap_or(i64::MAX);
    let mut last: Option<Health> = None;
    loop {
        if let Some(h) = probe(env, port) {
            match judge(&h, c) {
                Ok(()) => return Ok(h),
                Err(Some(fatal)) => return Err(fatal),
                Err(None) => last = Some(h),
            }
        }
        if env.clock.now_ms() >= deadline {
            return Err(match last {
                None => (codes::SAGLIK_ZAMAN_ASIMI, format!("{} {} sn içinde cevap vermedi", url(port), timeout.as_secs())),
                Some(h) if !h.up => (codes::SAGLIK_ZAMAN_ASIMI, "status UP olmadı".into()),
                Some(h) if !h.db_up => (codes::SAGLIK_DB, "db UP olmadı".into()),
                Some(_) => (
                    codes::SAGLIK_LISANS_OLCULEMEDI,
                    "sağlık yanıtı lisans alanını taşımıyor (D3: döngü adresine lisans{kip,butunluk,cekirdek})".into(),
                ),
            });
        }
        env.clock.sleep(Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(kip: &str, b: &str, c: &str) -> LicenseHealth {
        LicenseHealth { kip: Some(kip.into()), butunluk: Some(b.into()), cekirdek: Some(c.into()) }
    }

    #[test]
    fn regression_rules() {
        let once = l("NORMAL", "GECERLI", "native");
        assert_eq!(license_regressed(&l("NORMAL", "GECERLI", "native"), Some(&once)), None);
        assert!(license_regressed(&l("NORMAL", "OLCULEMEDI", "native"), Some(&once)).is_some());
        assert!(license_regressed(&l("NORMAL", "GECERLI", "ts"), Some(&once)).is_some());
        assert!(license_regressed(&l("KISITLI", "GECERLI", "native"), Some(&once)).is_some());
        assert_eq!(
            license_regressed(&l("KISITLI", "GECERLI", "native"), Some(&l("KISITLI", "GECERLI", "native"))),
            None,
            "zaten kısıtlıydı"
        );
        assert!(license_regressed(&l("NORMAL", "GECERSIZ", "native"), None).is_some(), "mutlak: GEÇERSİZ");
        assert_eq!(license_regressed(&l("NORMAL", "OLCULEMEDI", "ts"), None), None, "karşılaştırma yoksa yalnız mutlak kural");
    }
}
