//! Lisans görüntüsü — YETKİ KAYNAĞI imzalı kiradır (§6.2, sözleşme §2): `lisans\kira.jws` gömülü kök
//! zinciriyle (`tekserp_dogrulama::chain`, lisans çekirdeğiyle aynı kod) doğrulanır; şeması `guncelleme`
//! politikasını da ölçer (TS `LeaseSchema` aynası). HAK doğrulanıp kiraya bağlanırsa bakım bitişi ve
//! sınıf (hazırlık PAKET anahtarı süzgeci) ondan gelir. Fabrikanın etkin iptal belgesi (`lisans\iptal.jws`,
//! lisans v2 G4) kökle doğrulanırsa zincire verilir: iptal edilmiş anahtarın imzası yetki vermez. `lisans\`
//! backend'in yazabildiği dizindir: okuma bağlantı izlemez ve boy sınırlıdır; içerik yalnız imzası tuttuğu için geçerlidir.
use crate::codes;
use crate::env::Fs;
use crate::trust::{self, TrustAnchor};
use serde_json::{Map, Value};
use std::path::Path;
use tekserp_dogrulama::{chain, iso};

const DOC_MAX: u64 = 64 * 1024;
/// TS `revocation-store` sınırıyla aynı.
const REVOCATION_MAX: u64 = 128 * 1024;

#[derive(Debug, Clone, Default)]
pub struct LicenseView {
    /// Doğrulanmış kira belgesi (şemadan geçmiş); yoksa `problem` nedenini söyler.
    pub lease: Option<Map<String, Value>>,
    pub problem: Option<(&'static str, String)>,
    pub channel: Option<String>,
    /// `yaptirim.guncellemeDonuk` (K1) — her kipi ve her onayı ezer.
    pub frozen: bool,
    /// Doğrulanmış ve kiraya bağlı HAK'ın `bakimBitis`i (ms); HAK yoksa `None` (karar `HAK_YOK`).
    pub maintenance_end_ms: Option<f64>,
    /// HAK sınıfı (hazırlık PAKET anahtarı yalnız TEST/DEMO'da geçer); bilinmiyorsa `None` = süzülür.
    pub class: Option<String>,
}

fn read_token(fs: &dyn Fs, p: &Path, max: u64) -> Result<Value, (&'static str, String)> {
    match fs.read_untrusted(p, max) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err((codes::KIRA_YOK, format!("{} yok", p.display()))),
        Err(e) => Err((codes::KIRA_GECERSIZ, format!("{} okunamadı: {e}", p.display()))),
        Ok(b) => String::from_utf8(b)
            .map(|t| Value::String(t.trim().to_string()))
            .map_err(|_| (codes::KIRA_GECERSIZ, format!("{} UTF-8 değil", p.display()))),
    }
}

/// Etkin iptal belgesi: yok, okunamaz ya da kökle doğrulanamazsa yok sayılır (TS deposu gibi — doğrulanamayan kopya
/// iptal saymaz); doğrulanırsa kira ve HAK zinciri onu uygular.
fn load_revocation(fs: &dyn Fs, license_dir: &Path, anchor: &TrustAnchor) -> Option<chain::VerifiedRevocation> {
    let token = read_token(fs, &license_dir.join("iptal.jws"), REVOCATION_MAX).ok()?;
    chain::verify_revocation(&token, &anchor.roots).ok()
}

/// Kirayı (+ varsa HAK'ı) doğrular. Hiçbir hata fırlatmaz: yetki yoksa `lease: None` (karar `KIRA_YOK`).
pub fn load(fs: &dyn Fs, license_dir: &Path, anchor: &TrustAnchor) -> LicenseView {
    let token = match read_token(fs, &license_dir.join("kira.jws"), DOC_MAX) {
        Ok(t) => t,
        Err(p) => return LicenseView { problem: Some(p), ..LicenseView::default() },
    };
    let revocation = load_revocation(fs, license_dir, anchor);
    let lease = match chain::verify_lease(&token, &anchor.roots, revocation.as_ref()) {
        Ok(l) => l,
        Err(f) => {
            return LicenseView {
                problem: Some((codes::KIRA_GECERSIZ, format!("kira doğrulanamadı: {} ({})", f.message, f.code))),
                ..LicenseView::default()
            }
        }
    };
    let doc = lease.document.clone();
    let channel = doc.get("kanal").and_then(|k| k.get("kod")).and_then(Value::as_str).map(str::to_string);
    let frozen = doc.get("yaptirim").and_then(|y| y.get("guncellemeDonuk")).and_then(Value::as_bool) == Some(true);
    let hak = read_token(fs, &license_dir.join("hak.jws"), DOC_MAX)
        .ok()
        .and_then(|t| chain::verify_entitlement(&t, &anchor.roots, None, revocation.as_ref()).ok())
        .filter(|h| chain::check_lease_binding(&lease, h).is_ok());
    let maintenance_end_ms =
        hak.as_ref().and_then(|h| h.document.get("bakimBitis").and_then(Value::as_str).map(iso::date_parse_ms)).filter(|ms| ms.is_finite());
    let class = hak.as_ref().and_then(|h| h.document.get("sinif").and_then(Value::as_str).map(str::to_string));
    LicenseView { lease: Some(doc), problem: None, channel, frozen, maintenance_end_ms, class }
}

/// Bu kurulumun kabul ettiği PAKET anahtarları (TS `integrity-scope` süzgeci): hazırlık anahtarı
/// (`paket-hazirlik*`) yalnız TEST/DEMO sınıfında kümeye girer; sınıf bilinmiyorsa DIŞARIDA.
pub fn package_keys(anchor: &TrustAnchor, class: Option<&str>) -> Vec<(String, String)> {
    let staging_ok = class.is_some_and(|c| trust::STAGING_PACKAGE_CLASSES.contains(&c));
    anchor.package_keys.iter().filter(|(kid, _)| staging_ok || !trust::is_staging_package_kid(kid)).cloned().collect()
}
