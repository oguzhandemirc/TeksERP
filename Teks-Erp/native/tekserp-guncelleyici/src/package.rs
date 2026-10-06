//! Paket açma ve bütünlük (§6.4). Açma YALNIZ imzalı sha256'sı tutmuş zip'e uygulanır; göreli olmayan
//! yol, `..`, sürücü harfi ve sembolik bağ girdisi RED; toplam boy ve girdi sayısı sınırlı. Açılmış
//! dizin `butunluk.jws` + `butunluk-liste.txt`e karşı `tekserp_dogrulama::integrity` ile (lisans
//! çekirdeğiyle AYNI kod) doğrulanır; `GECERLI` değilse sürüm dizini kullanılmaz.
use crate::codes;
use crate::release::PackageIdentity;
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
    let pkg = &report["paket"];
    let s = |k: &str| pkg.get(k).and_then(Value::as_str).map(str::to_string);
    // Rapor imzalayanı taşımaz: GEÇERLİ listede sertifikayı (zaten doğrulanmış) yükten okuruz.
    let certificate_id = paket_zinciri::is_chain_package_kid(&kid)
        .then(|| paket_zinciri::verify_package_signed(&token, integrity::TYP_BUTUNLUK, trust).ok())
        .flatten()
        .and_then(|s| s.chain)
        .and_then(|c| c.certificate.get("sertifikaId").and_then(Value::as_str).map(str::to_string));
    Ok(PackageIdentity {
        kid,
        certificate_id,
        package_id: s("paketId").unwrap_or_default(),
        urun: s("urun").unwrap_or_default(),
        surum: s("surum").unwrap_or_default(),
        built_at: s("derlemeTarihi").unwrap_or_default(),
        musteri: s("musteri"),
    })
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
pub fn signed_file_digest(dir: &Path, fs: &dyn crate::env::Fs, trust: &PackageTrust, rel: &str) -> Result<String, PkgError> {
    use tekserp_dogrulama::integrity_list as list;
    verify_dir(dir, fs, trust, None)?;
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
