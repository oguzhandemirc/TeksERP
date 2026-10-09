//! Paket açma ve bütünlük (§6.4). Açma YALNIZ imzalı sha256'sı tutmuş pakete uygulanır; biçimi okuyan arka ucun
//! platformu seçer (Windows zip · Linux ustar dış tar, `tar`/`oci`). Göreli olmayan yol, `..`, sürücü harfi ve
//! sembolik bağ girdisi RED; toplam boy ve girdi sayısı sınırlı. Açılmış dizin imzalı listeye karşı
//! `tekserp_dogrulama::integrity` ile (lisans çekirdeğiyle AYNI kod) doğrulanır; `GECERLI` değilse kullanılmaz.
use crate::codes;
use crate::release::{self, PackageIdentity, ReleaseManifest, UpdatePlatform};
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use tekserp_dogrulama::paket_zinciri::{self, PackageTrust};
use tekserp_dogrulama::{integrity, jws};

#[derive(Debug, Clone, Copy)]
pub struct ExtractLimits {
    pub max_entries: usize,
    pub max_total_bytes: u64,
}

impl Default for ExtractLimits {
    fn default() -> Self {
        ExtractLimits { max_entries: 250_000, max_total_bytes: 8 * 1024 * 1024 * 1024 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ExtractStats {
    pub files: usize,
    pub bytes: u64,
}

/// Gerçek açma (dosya sistemine doğrudan) — `Fs::extract_zip`in gerçek uygulaması. Hata iletisi
/// `PAKET_YOL:` önekiyle yol ihlalini ayırır.
pub fn extract_real(archive: &Path, dest: &Path, limits: &ExtractLimits) -> Result<ExtractStats, String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("paket açılamadı: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("zip okunamadı: {e}"))?;
    if zip.len() > limits.max_entries {
        return Err(format!("zip {} girdi taşıyor (tavan {})", zip.len(), limits.max_entries));
    }
    std::fs::create_dir_all(dest).map_err(|e| format!("hedef dizin açılamadı: {e}"))?;
    let mut stats = ExtractStats::default();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("zip girdisi okunamadı: {e}"))?;
        let raw_name = entry.name().to_string();
        if raw_name.contains('\\') || raw_name.contains(':') || raw_name.starts_with('/') {
            return Err(format!("PAKET_YOL: güvensiz yol: {raw_name}"));
        }
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("PAKET_YOL: güvensiz yol: {raw_name}"));
        };
        if entry.is_symlink() {
            return Err(format!("PAKET_YOL: sembolik bağ girdisi: {raw_name}"));
        }
        let out = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("{raw_name}: {e}"))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{raw_name}: {e}"))?;
        }
        let remaining = limits.max_total_bytes.saturating_sub(stats.bytes);
        let mut f = std::fs::File::create(&out).map_err(|e| format!("{raw_name}: {e}"))?;
        let n = std::io::copy(&mut (&mut entry).take(remaining + 1), &mut f).map_err(|e| format!("{raw_name}: {e}"))?;
        if n > remaining {
            return Err("açılan toplam boy tavanı aştı (zip bombası?)".into());
        }
        f.sync_all().map_err(|e| format!("{raw_name}: {e}"))?;
        stats.files += 1;
        stats.bytes += n;
    }
    Ok(stats)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PkgError {
    pub code: &'static str,
    pub message: String,
}

fn perr(code: &'static str, message: impl Into<String>) -> PkgError {
    PkgError { code, message: message.into() }
}

/// Dizinin doğrulanacak imzalı listesi: imzalayan biliniyorsa (bildirimin `paketImzaKid`i) ONUN ailesinin dosyası;
/// bilinmiyorsa (kurulu dizin · setup) zincirli dosya varsa o, yoksa (geçiş) eskisi.
fn integrity_file_for(dir: &Path, fs: &dyn crate::env::Fs, signer: Option<&str>) -> &'static str {
    let chained = match signer {
        Some(kid) => paket_zinciri::is_chain_package_kid(kid),
        None => fs.exists(&dir.join(paket_zinciri::CHAINED_INTEGRITY_FILE)),
    };
    if chained {
        paket_zinciri::CHAINED_INTEGRITY_FILE
    } else {
        integrity_file()
    }
}

/// Açılmış dizini doğrular (sözleşme §1.5 madde 2): imzalı liste bu kurulumun güveniyle (gömülü `paket-*` kümesi —
/// hazırlık anahtarı yalnız TEST/DEMO'da, çağıran süzer — ya da `pkt-*` ise kök imzalı PAKET sertifikası) ve dosya
/// listesi GEÇERLİ; dönen künye bildirimle `release::check_package_binding`e girer (madde 3).
pub fn verify_dir(dir: &Path, fs: &dyn crate::env::Fs, trust: &PackageTrust, signer: Option<&str>) -> Result<PackageIdentity, PkgError> {
    let file = integrity_file_for(dir, fs, signer);
    verify_signed_list(dir, file, fs, trust).map(|(id, _)| id)
}

/// `file` (imzalı `tekserp-butunluk` belgesi) ile dizin GEÇERLİ mi; künye + imzalı yük (zincir alanları ayıklanmış).
/// İki paket biçiminin ortak boğazı: zip'te `butunluk.jws`/zincirli ikizi, OCI'de `PAKET-DOCKER.json.jws`.
pub(crate) fn verify_signed_list(
    dir: &Path,
    file: &str,
    fs: &dyn crate::env::Fs,
    trust: &PackageTrust,
) -> Result<(PackageIdentity, serde_json::Map<String, Value>), PkgError> {
    let jws_text = fs
        .read(&dir.join(file))
        .map_err(|e| perr(codes::BUTUNLUK_GECERSIZ, format!("{file} okunamadı: {e}")))
        .and_then(|b| String::from_utf8(b).map_err(|_| perr(codes::BUTUNLUK_GECERSIZ, format!("{file} UTF-8 değil"))))?;
    let token = Value::String(jws_text.trim().to_string());
    let kid = jws::parse(&token).map(|p| p.header.kid).map_err(|f| perr(codes::BUTUNLUK_GECERSIZ, f.message))?;
    let report = integrity::verify_trusted(&token, &dir.to_string_lossy(), trust);
    if report.get("durum").and_then(Value::as_str) != Some("GECERLI") {
        let kod = report.get("kod").and_then(Value::as_str).unwrap_or("?");
        let ornek = ["eksik", "degisik", "fazla", "okunamayan"]
            .iter()
            .filter_map(|k| {
                report.get(*k).and_then(Value::as_array).and_then(|a| a.first()).and_then(Value::as_str).map(|f| format!("{k}: {f}"))
            })
            .collect::<Vec<_>>()
            .join(" · ");
        return Err(perr(
            codes::BUTUNLUK_GECERSIZ,
            format!("bütünlük {} ({kod}) {ornek}", report.get("durum").and_then(Value::as_str).unwrap_or("?")),
        ));
    }
    // GEÇERLİ listenin imzası zaten doğrulandı: yük ve (zincirde) sertifika aynı doğrulamadan okunur.
    let signed = paket_zinciri::verify_package_signed(&token, integrity::TYP_BUTUNLUK, trust)
        .map_err(|f| perr(codes::BUTUNLUK_GECERSIZ, f.message))?;
    let certificate_id = signed.chain.as_ref().and_then(|c| c.certificate.get("sertifikaId").and_then(Value::as_str).map(str::to_string));
    let pkg = &report["paket"];
    let s = |k: &str| pkg.get(k).and_then(Value::as_str).map(str::to_string);
    let id = PackageIdentity {
        kid,
        certificate_id,
        package_id: s("paketId").unwrap_or_default(),
        urun: s("urun").unwrap_or_default(),
        surum: s("surum").unwrap_or_default(),
        built_at: s("derlemeTarihi").unwrap_or_default(),
        musteri: s("musteri"),
    };
    Ok((id, signed.payload))
}

pub fn integrity_file() -> &'static str {
    "butunluk.jws"
}

/// Dosyanın sha256'sı, bütünlük listesinin yazımıyla (base64url, dolgusuz).
pub fn file_digest(fs: &dyn crate::env::Fs, p: &Path) -> std::io::Result<String> {
    use sha2::{Digest, Sha256};
    let mut f = fs.open_read(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(tekserp_dogrulama::b64::encode(&h.finalize()))
}

/// İmzalı listedeki bir dosyanın beklenen özeti (`rel` POSIX göreli yol). Dizin ÖNCE bütünüyle
/// doğrulanır (imza + liste özeti + her dosya); listede olmayan dosya RED.
pub fn signed_file_digest(
    platform: UpdatePlatform,
    dir: &Path,
    fs: &dyn crate::env::Fs,
    trust: &PackageTrust,
    rel: &str,
) -> Result<String, PkgError> {
    use tekserp_dogrulama::integrity_list as list;
    match platform {
        UpdatePlatform::Win32X64 => verify_dir(dir, fs, trust, None).map(drop)?,
        UpdatePlatform::LinuxX64Oci => crate::oci::verify_dir(dir, fs, trust).map(drop)?,
    }
    let bytes =
        fs.read(&dir.join(list::LIST_FILE)).map_err(|e| perr(codes::BUTUNLUK_GECERSIZ, format!("{} okunamadı: {e}", list::LIST_FILE)))?;
    let count = bytes.iter().filter(|b| **b == b'\n').count();
    let entries = list::parse(&bytes, count).ok_or_else(|| perr(codes::BUTUNLUK_GECERSIZ, format!("{} biçimsiz", list::LIST_FILE)))?;
    entries
        .into_iter()
        .find(|e| e.path == rel)
        .map(|e| e.sha256)
        .ok_or_else(|| perr(codes::BUTUNLUK_GECERSIZ, format!("{rel} imzalı listede yok")))
}

/// İndirilen paketi platformun biçiminde `dest`e açar (Linux: üye kümesi `oci::members` ile TAM, açmadan önce ölçülür).
pub fn extract_on(
    platform: UpdatePlatform,
    fs: &dyn crate::env::Fs,
    archive: &Path,
    dest: &Path,
    surum: &str,
    limits: &ExtractLimits,
) -> Result<ExtractStats, String> {
    match platform {
        UpdatePlatform::Win32X64 => fs.extract_zip(archive, dest, limits),
        UpdatePlatform::LinuxX64Oci => fs.extract_tar(archive, dest, &crate::oci::members(surum), limits),
    }
}

/// Sürüm dizini bildirimin paketi mi (sözleşme §1.5 madde 2–3): platformun imzalı listesi GEÇERLİ ve künye bildirime
/// bağlı. Windows: `butunluk.jws` ailesi + `check_package_binding`; Linux: `PAKET-DOCKER.json.jws` + `oci::check_binding`.
pub fn verify_bound(
    platform: UpdatePlatform,
    dir: &Path,
    fs: &dyn crate::env::Fs,
    trust: &PackageTrust,
    m: &ReleaseManifest,
) -> Result<(), (&'static str, String)> {
    match platform {
        UpdatePlatform::Win32X64 => verify_dir(dir, fs, trust, Some(&m.signer_kid))
            .map_err(|e| (e.code, e.message))
            .and_then(|id| release::check_package_binding(m, &id).map_err(|e| (e.code, e.message))),
        UpdatePlatform::LinuxX64Oci => crate::oci::verify_dir(dir, fs, trust)
            .map_err(|e| (e.code, e.message))
            .and_then(|k| crate::oci::check_binding(m, &k).map_err(|e| (e.code, e.message))),
    }
}

/// Disk ön kontrolünün bir satırı: `path`in dosya sisteminde en az `bytes` boş alan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiskNeed {
    pub path: std::path::PathBuf,
    pub bytes: u64,
}

const GB: u64 = 1024 * 1024 * 1024;
/// DB boyu ölçülemezse varsayılan (§5 madde 4).
pub const DB_SIZE_UNKNOWN: u64 = 2 * GB;

/// Disk formülü (§5 madde 4, indirmeden ÖNCE). Windows: kök ≥ paket × 3 + 2 GB. Linux iki dosya sistemi: veri kökü
/// (`/var/lib/tekserp`: dış tar + açılmış kopya + güncelleme öncesi yedek) ≥ paket × 2 + DB × 1,2 + 2 GB ve Docker
/// kökü ≥ açılmış imaj (bildirimde boy yok: paket × 3) + 1 GB. Docker kökü ölçülemezse o satır yok.
pub fn disk_needs(
    platform: UpdatePlatform,
    layout: &crate::layout::Layout,
    package_bytes: u64,
    db_bytes: Option<u64>,
    image_store: Option<std::path::PathBuf>,
) -> Vec<DiskNeed> {
    match platform {
        UpdatePlatform::Win32X64 => {
            vec![DiskNeed { path: layout.root.clone(), bytes: package_bytes.saturating_mul(3).saturating_add(2 * GB) }]
        }
        UpdatePlatform::LinuxX64Oci => {
            let db = db_bytes.unwrap_or(DB_SIZE_UNKNOWN);
            let data = package_bytes.saturating_mul(2).saturating_add(db.saturating_mul(6) / 5).saturating_add(2 * GB);
            let mut out = vec![DiskNeed { path: layout.data.clone(), bytes: data }];
            out.extend(image_store.map(|p| DiskNeed { path: p, bytes: package_bytes.saturating_mul(3).saturating_add(GB) }));
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::Layout;

    #[test]
    fn disk_formula_per_platform() {
        let l = Layout::new(Path::new("/opt/tekserp"), Path::new("/var/lib/tekserp"));
        let p = 100 * 1024 * 1024;
        assert_eq!(
            disk_needs(UpdatePlatform::Win32X64, &l, p, Some(5 * GB), Some("/d".into())),
            vec![DiskNeed { path: l.root.clone(), bytes: 3 * p + 2 * GB }]
        );
        let linux = disk_needs(UpdatePlatform::LinuxX64Oci, &l, p, Some(10 * GB), Some("/var/lib/docker".into()));
        assert_eq!(
            linux,
            vec![
                DiskNeed { path: l.data.clone(), bytes: 2 * p + 12 * GB + 2 * GB },
                DiskNeed { path: "/var/lib/docker".into(), bytes: 3 * p + GB },
            ]
        );
        let unknown = disk_needs(UpdatePlatform::LinuxX64Oci, &l, p, None, None);
        assert_eq!(
            unknown,
            vec![DiskNeed { path: l.data.clone(), bytes: 2 * p + DB_SIZE_UNKNOWN * 6 / 5 + 2 * GB }],
            "DB ölçülemedi: 2 GB"
        );
    }
}
