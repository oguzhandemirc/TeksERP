//! Sürdürülebilir indirme (§6.4, sözleşme §1.5 madde 1): `.part` dosyasına `Range: bytes=<n>-` ile devam
//! eder; İNDİRME belirteci `X-TKL-Indirme` başlığıyla (Worker doğrular). Bitince sha256 (küçük harf hex)
//! ve boy imzalı bildirimdekine EŞİT olmadan dosya asıl adını almaz — imzasız veri zip ayrıştırıcısına
//! hiç girmez; tutmazsa parça silinir (`PAKET_OZETI`).
use crate::codes;
use crate::env::Env;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const TOKEN_HEADER: &str = "X-TKL-Indirme";
const CODE_HEADER: &str = "X-TKL-Kod";
const CHUNK: usize = 256 * 1024;

#[derive(Debug, Clone)]
pub struct Spec {
    pub url: String,
    pub token: Option<String>,
    pub part: PathBuf,
    pub dest: PathBuf,
    pub size: u64,
    /// İmzalı bildirimdeki sha256 (küçük harf hex).
    pub sha256_hex: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DlError {
    pub code: &'static str,
    pub message: String,
}

fn dl_err(code: &'static str, message: impl Into<String>) -> DlError {
    DlError { code, message: message.into() }
}

/// Dosyanın sha256'sı (küçük harf hex) — akışla, bellekte tutmadan.
pub fn sha256_file(env: &Env, p: &Path) -> std::io::Result<String> {
    let mut f = env.fs.open_read(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|x| format!("{x:02x}")).collect()
}

fn headers(spec: &Spec, from: u64) -> Vec<(String, String)> {
    let mut h = Vec::new();
    if let Some(t) = &spec.token {
        h.push((TOKEN_HEADER.to_string(), t.clone()));
    }
    if from > 0 {
        h.push(("Range".to_string(), format!("bytes={from}-")));
    }
    h
}

/// Küçük bir belgeyi (işaretçi: `son.json` · `surum.json` · `pg.json`) indirir; 64 KB tavanlı.
pub fn fetch_small(env: &Env, url: &str, token: Option<&str>) -> Result<Vec<u8>, DlError> {
    let mut h = Vec::new();
    if let Some(t) = token {
        h.push((TOKEN_HEADER.to_string(), t.to_string()));
    }
    let r = env.net.get(url, &h, Duration::from_secs(60)).map_err(|e| dl_err(codes::MANIFEST_INDIRILEMEDI, e.0))?;
    match r.status {
        200 => {}
        401 | 403 => return Err(rejected(&r)),
        s => return Err(dl_err(codes::MANIFEST_INDIRILEMEDI, format!("HTTP {s}"))),
    }
    let mut out = Vec::new();
    r.body.take(64 * 1024 + 1).read_to_end(&mut out).map_err(|e| dl_err(codes::MANIFEST_INDIRILEMEDI, e.to_string()))?;
    if out.len() > 64 * 1024 {
        return Err(dl_err(codes::MANIFEST_GECERSIZ, "işaretçi 64 KB'ı aşıyor"));
    }
    Ok(out)
}

fn rejected(r: &crate::env::HttpResponse) -> DlError {
    match r.header(CODE_HEADER) {
        Some("BELGE_SURESI_DOLDU") => dl_err(codes::BELIRTEC_SURESI_DOLDU, "indirme belirtecinin süresi doldu"),
        Some(k) => dl_err(codes::INDIRME_REDDEDILDI, format!("indirme kapısı reddetti ({k})")),
        None => dl_err(codes::INDIRME_REDDEDILDI, format!("indirme kapısı reddetti (HTTP {})", r.status)),
    }
}

/// İndirir (devam ederek) ve doğrular. `progress(indirilen, toplam)`; `stop()` doğruysa parça korunarak durur.
pub fn download(env: &Env, spec: &Spec, progress: &mut dyn FnMut(u64, u64), stop: &dyn Fn() -> bool) -> Result<(), DlError> {
    if env.fs.exists(&spec.dest) {
        let ok = env.fs.file_len(&spec.dest).ok() == Some(spec.size)
            && sha256_file(env, &spec.dest).ok().as_deref() == Some(spec.sha256_hex.as_str());
        if ok {
            return Ok(());
        }
        env.fs.remove_file(&spec.dest).map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))?;
    }
    let mut have = env.fs.file_len(&spec.part).unwrap_or(0);
    if have > spec.size {
        env.fs.remove_file(&spec.part).map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))?;
        have = 0;
    }
    let mut restarted = false;
    while have < spec.size {
        if stop() {
            return Err(dl_err(codes::INDIRME_HATASI, "durdurma istendi (parça korundu)"));
        }
        let r =
            env.net.get(&spec.url, &headers(spec, have), Duration::from_secs(6 * 3600)).map_err(|e| dl_err(codes::INDIRME_HATASI, e.0))?;
        match r.status {
            206 => {
                let start = r
                    .header("Content-Range")
                    .and_then(|c| c.strip_prefix("bytes "))
                    .and_then(|c| c.split('-').next())
                    .and_then(|n| n.parse::<u64>().ok());
                if start != Some(have) {
                    return Err(dl_err(codes::INDIRME_HATASI, "sunucu istenen yerden devam etmedi (Content-Range)"));
                }
            }
            200 => {
                if have > 0 {
                    env.fs.remove_file(&spec.part).map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))?;
                    have = 0;
                }
            }
            416 if !restarted => {
                env.fs.remove_file(&spec.part).map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))?;
                have = 0;
                restarted = true;
                continue;
            }
            401 | 403 => return Err(rejected(&r)),
            s => return Err(dl_err(codes::INDIRME_HATASI, format!("HTTP {s}"))),
        }
        let mut out = env.fs.open_append(&spec.part).map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))?;
        let mut body = r.body;
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = body.read(&mut buf).map_err(|e| dl_err(codes::INDIRME_HATASI, format!("akış kesildi: {e}")))?;
            if n == 0 {
                break;
            }
            if have + n as u64 > spec.size {
                drop(out);
                let _ = env.fs.remove_file(&spec.part);
                return Err(dl_err(codes::PAKET_OZETI, "sunucu imzalı boydan fazla veri gönderdi"));
            }
            std::io::Write::write_all(&mut out, &buf[..n]).map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))?;
            have += n as u64;
            progress(have, spec.size);
            if stop() {
                let _ = out.sync();
                return Err(dl_err(codes::INDIRME_HATASI, "durdurma istendi (parça korundu)"));
            }
        }
        out.sync().map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))?;
        if have < spec.size {
            return Err(dl_err(codes::INDIRME_HATASI, format!("bağlantı erken kapandı ({have}/{} bayt; sonraki turda devam)", spec.size)));
        }
    }
    let got = sha256_file(env, &spec.part).map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))?;
    if got != spec.sha256_hex {
        let _ = env.fs.remove_file(&spec.part);
        return Err(dl_err(codes::PAKET_OZETI, "paketin sha256'sı imzalı bildirimdekiyle aynı değil"));
    }
    env.fs.rename(&spec.part, &spec.dest).map_err(|e| dl_err(codes::INDIRME_HATASI, e.to_string()))
}
