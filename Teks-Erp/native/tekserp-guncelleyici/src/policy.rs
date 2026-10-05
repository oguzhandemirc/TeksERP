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
use tekserp_dogrulama::paket_zinciri::{self, PackageMode, PackageTrust, VerifiedPackageRevocation};
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
    /// Doğrulanmış kiranın `verilis`i (ms): KABUL kipinin "şimdi"si sistem saatinin gerisinde kalamaz.
    pub lease_issued_ms: Option<f64>,
    /// `lisans\paket-iptal.jws` kökle doğrulanırsa (yoksa/bozuksa yok sayılır, iptal deposu gibi).
    pub package_revocation: Option<VerifiedPackageRevocation>,
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

/// PAKET iptal belgesi (`lisans\paket-iptal.jws` ya da paketin kökündeki): kökle doğrulanamazsa yok sayılır.
pub fn read_package_revocation(fs: &dyn Fs, path: &Path, anchor: &TrustAnchor) -> Option<VerifiedPackageRevocation> {
    let token = read_token(fs, path, REVOCATION_MAX).ok()?;
    paket_zinciri::verify_package_revocation(&token, &anchor.roots).ok()
}

/// Kirayı (+ varsa HAK'ı) doğrular. Hiçbir hata fırlatmaz: yetki yoksa `lease: None` (karar `KIRA_YOK`).
pub fn load(fs: &dyn Fs, license_dir: &Path, anchor: &TrustAnchor) -> LicenseView {
    let package_revocation = read_package_revocation(fs, &license_dir.join(paket_zinciri::PACKAGE_REVOCATION_FILE), anchor);
    let token = match read_token(fs, &license_dir.join("kira.jws"), DOC_MAX) {
        Ok(t) => t,
        Err(p) => return LicenseView { problem: Some(p), package_revocation, ..LicenseView::default() },
    };
    let revocation = load_revocation(fs, license_dir, anchor);
    let lease = match chain::verify_lease(&token, &anchor.roots, revocation.as_ref()) {
        Ok(l) => l,
        Err(f) => {
            return LicenseView {
                problem: Some((codes::KIRA_GECERSIZ, format!("kira doğrulanamadı: {} ({})", f.message, f.code))),
                package_revocation,
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
    let lease_issued_ms = doc.get("verilis").and_then(Value::as_str).map(iso::date_parse_ms).filter(|ms| ms.is_finite());
    LicenseView { lease: Some(doc), problem: None, channel, frozen, maintenance_end_ms, class, lease_issued_ms, package_revocation }
}

/// Bu kurulumun kabul ettiği PAKET anahtarları (TS `integrity-scope` süzgeci): hazırlık anahtarı
/// (`paket-hazirlik*`) yalnız TEST/DEMO sınıfında kümeye girer; sınıf bilinmiyorsa DIŞARIDA.
pub fn package_keys(anchor: &TrustAnchor, class: Option<&str>) -> Vec<(String, String)> {
    let staging_ok = class.is_some_and(|c| trust::STAGING_PACKAGE_CLASSES.contains(&c));
    anchor.package_keys.iter().filter(|(kid, _)| staging_ok || !trust::is_staging_package_kid(kid)).cloned().collect()
}

/// Paket belgelerinin güveni (sözleşme `PAKET-ANAHTARI-KOK-ALTINDA.md` §2.3): KABUL (dışarıdan gelen aday · paket ·
/// PG künyesi) "şimdi"yi max(sistem saati, kira verilişi) alır; YERLEŞİK (kurulu dizin) zamana ve iptale sert bakmaz.
/// Sınıf HAK'tan: bilinmiyorsa zincirli belge RED (gömülü kümedeki hazırlık süzgeciyle aynı ölçü).
pub fn package_trust(anchor: &TrustAnchor, lic: &LicenseView, mode: PackageMode, system_now_ms: f64) -> PackageTrust {
    let now_ms = match mode {
        PackageMode::Kabul => Some(lic.lease_issued_ms.map_or(system_now_ms, |issued| issued.max(system_now_ms))),
        PackageMode::Yerlesik => None,
    };
    PackageTrust {
        keys: package_keys(anchor, lic.class.as_deref()),
        roots: anchor.roots.clone(),
        mode,
        now_ms,
        revocation: lic.package_revocation.clone(),
        install_class: Some(lic.class.clone()),
    }
}

/// Paketin getirdiği PAKET iptali elindekinden YÜKSEK sıralıysa güvene alınır ve `lisans\paket-iptal.jws`e yazılır
/// (yazım hatası güncellemeyi durdurmaz: iptal bu turun güveninde yine uygulanır). Dönen: bu turda yazıldı mı.
pub fn adopt_package_revocation(
    fs: &dyn Fs,
    license_dir: &Path,
    anchor: &TrustAnchor,
    package_dir: &Path,
    trust: &mut PackageTrust,
) -> bool {
    let Ok(bytes) = fs.read_untrusted(&package_dir.join(paket_zinciri::PACKAGE_REVOCATION_FILE), REVOCATION_MAX) else {
        return false;
    };
    let Ok(text) = std::str::from_utf8(&bytes) else { return false };
    let Ok(incoming) = paket_zinciri::verify_package_revocation(&Value::String(text.trim().to_string()), &anchor.roots) else {
        return false;
    };
    if trust.revocation.as_ref().is_some_and(|c| c.sequence() >= incoming.sequence()) {
        return false;
    }
    trust.revocation = Some(incoming);
    fs.write_atomic(&license_dir.join(paket_zinciri::PACKAGE_REVOCATION_FILE), &bytes).is_ok()
}
