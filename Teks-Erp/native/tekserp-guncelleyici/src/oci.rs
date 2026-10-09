//! Linux/OCI teslim paketi (`backend-oci`, sözleşme 5; `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §1.3 · §5 madde 5) —
//! `Teks-Erp/scripts/lib/oci-paket.ts` AYNASI (eşlik `tests/linux_paket.rs` ölçer): dış tar'ın TAM üye kümesi, imzalı
//! teslim künyesi (`PAKET-DOCKER.json.jws`, `tekserp-butunluk` yükü; kapsam tar'ın üyeleri) ve künyenin bildirime bağı.
//! İmajın kendisi (arşivdeki config özeti, `docker load`, etiket) bu modülde DEĞİL — L4c-2.
use crate::codes;
use crate::package::{verify_signed_list, PkgError};
use crate::release::{self, PackageIdentity, ReleaseManifest, UpdatePlatform};
use serde_json::{Map, Value};
use std::path::Path;
use tekserp_dogrulama::integrity_list::LIST_FILE;
use tekserp_dogrulama::jsonx::deep_equal;
use tekserp_dogrulama::outcome::{Fail, Outcome};
use tekserp_dogrulama::paket_zinciri::PackageTrust;

pub const KUNYE: &str = "PAKET-DOCKER.json";
pub const KUNYE_JWS: &str = "PAKET-DOCKER.json.jws";
pub const KUNYE_URUN: &str = "backend-docker";
pub const IMAJ_ADI: &str = "tekserp-korumali";
pub const GUNCELLEYICI: &str = "tekserp-guncelleyici";
pub const GUNCELLEYICI_KUNYE: &str = "guncelleyici-kunye.json";
pub const OZETLER: &str = "SHA256SUMS";

/// `ociImajArsivi`: imzalı imajın `docker save | gzip -n` çıktısı.
pub fn image_archive(surum: &str) -> String {
    format!("{IMAJ_ADI}_{surum}_linux-amd64.tar.gz")
}

/// `tekserp-korumali:<sürüm>` — compose'un istediği tek etiket.
pub fn image_tag(surum: &str) -> String {
    format!("{IMAJ_ADI}:{surum}")
}

/// `ociKapsam`: künyenin imzalı kapsamındaki üyeler (sıra künyedekiyle aynı).
pub fn scope(surum: &str) -> Vec<String> {
    vec![image_archive(surum), "docker-compose.yml".into(), ".env.ornek".into(), GUNCELLEYICI.into(), GUNCELLEYICI_KUNYE.into()]
}

/// `ociUyeler`: dış tar'ın TAM üye kümesi — fazlası da eksiği de RED.
pub fn members(surum: &str) -> Vec<String> {
    let mut m = scope(surum);
    m.extend([KUNYE, KUNYE_JWS, LIST_FILE, OZETLER].map(str::to_string));
    m
}

/// Açılmış OCI paketinin doğrulanmış künyesi: ortak kimlik (bağ için) + imaj ve güncelleyici alanları.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OciKunye {
    pub identity: PackageIdentity,
    pub platform: String,
    pub image_id: String,
    pub image_tag: String,
    /// Paketteki güncelleyici ikilisinin sha256'sı (hex).
    pub updater_sha256: String,
}

fn bad(message: impl Into<String>) -> PkgError {
    PkgError { code: codes::BUTUNLUK_GECERSIZ, message: message.into() }
}

fn str_at<'a>(v: &'a Map<String, Value>, path: &[&str]) -> Option<&'a str> {
    let (last, head) = path.split_last()?;
    head.iter().try_fold(v, |m, k| m.get(*k)?.as_object())?.get(*last)?.as_str()
}

/// Açılmış dizin (sözleşme §1.5 madde 2'nin OCI kolu): imzalı künye + bütünlük listesi + her kapsam üyesinin özeti;
/// düz `PAKET-DOCKER.json` imzalı yükle AYNI; kapsam, imaj arşivi adı, etiket ve platform biçimin kendisi.
pub fn verify_dir(dir: &Path, fs: &dyn crate::env::Fs, trust: &PackageTrust) -> Result<OciKunye, PkgError> {
    let (identity, payload) = verify_signed_list(dir, KUNYE_JWS, fs, trust)?;
    let plain: Value = fs
        .read(&dir.join(KUNYE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| bad(format!("{KUNYE} okunamadı ya da JSON değil")))?;
    if !deep_equal(&plain, &Value::Object(payload.clone())) {
        return Err(bad(format!("{KUNYE} imzalı yükle ({KUNYE_JWS}) aynı değil")));
    }
    if identity.urun != KUNYE_URUN {
        return Err(bad(format!("künye ürünü {} ({KUNYE_URUN} bekleniyor)", identity.urun)));
    }
    let surum = identity.surum.clone();
    let kapsam: Option<Vec<&str>> =
        payload.get("kapsam").and_then(|k| k.get("dosyalar")).and_then(Value::as_array).and_then(|a| a.iter().map(Value::as_str).collect());
    let dirs_empty = payload.get("kapsam").and_then(|k| k.get("dizinler")).and_then(Value::as_array).is_some_and(Vec::is_empty);
    if kapsam != Some(scope(&surum).iter().map(String::as_str).collect()) || !dirs_empty {
        return Err(bad(format!("künye kapsamı OCI biçiminde değil: {:?}", payload.get("kapsam"))));
    }
    let platform = str_at(&payload, &["platform"]).unwrap_or_default().to_string();
    if platform != UpdatePlatform::LinuxX64Oci.as_str() {
        return Err(bad(format!("künye platformu {platform:?}")));
    }
    if str_at(&payload, &["imaj", "arsiv"]) != Some(image_archive(&surum).as_str()) {
        return Err(bad("künyenin imaj arşivi adı biçimde değil"));
    }
    let image_tag = str_at(&payload, &["imaj", "etiket"]).unwrap_or_default().to_string();
    if image_tag != self::image_tag(&surum) {
        return Err(bad(format!("künyenin imaj etiketi {image_tag:?} ({} bekleniyor)", self::image_tag(&surum))));
    }
    let image_id = str_at(&payload, &["imaj", "kimlik"]).unwrap_or_default().to_string();
    let updater_sha256 = str_at(&payload, &["guncelleyici", "sha256"]).unwrap_or_default().to_string();
    if image_id.is_empty() || updater_sha256.is_empty() {
        return Err(bad("künye imaj kimliği ya da güncelleyici özeti taşımıyor"));
    }
    Ok(OciKunye { identity, platform, image_id, image_tag, updater_sha256 })
}

/// Paket bildirimin paketi mi: ortak bağ (`check_package_binding`) + OCI alanları — imaj kimliği/etiketi ve (bildirim
/// ilan ediyorsa) güncelleyici özeti künyedekiyle aynı.
pub fn check_binding(m: &ReleaseManifest, k: &OciKunye) -> Outcome<()> {
    release::check_package_binding(m, &k.identity)?;
    let mut off = vec![];
    if k.platform != m.platform {
        off.push("platform");
    }
    match &m.imaj {
        Some(i) if i.kimlik == k.image_id && i.etiket == k.image_tag => {}
        _ => off.push("imaj"),
    }
    if m.updater.as_ref().is_some_and(|u| u.sha256 != k.updater_sha256) {
        off.push("guncelleyici");
    }
    if off.is_empty() {
        Ok(())
    } else {
        Err(Fail { code: release::code::PAKET_BAGI, message: format!("Paket künyesi bildirimle bağlanmıyor: {}", off.join(", ")) })
    }
}
