//! IPC (§5): `niyet\niyet.json` (backend yazar, burada yalnız OKUNUR ve doğrulanır — yetki DEĞİL),
//! `durum\durum.json` + `durum\gecmis.jsonl` (güncelleyici yazar). Anahtarlar Türkçe (tel sözleşmesi).
use crate::env::Fs;
use crate::layout::Layout;
use crate::version;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DownloadToken {
    #[serde(rename = "belirtec")]
    pub token: String,
    #[serde(rename = "bitis")]
    pub expires: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Approval {
    #[serde(rename = "kullaniciId")]
    pub user_id: String,
    #[serde(rename = "ad")]
    pub name: String,
    #[serde(rename = "zaman")]
    pub at: String,
    /// `null` = hazır olunca hemen; ISO zaman = o andan önce değil.
    #[serde(rename = "planlanan", default)]
    pub planned: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Intent {
    pub v: u32,
    #[serde(rename = "niyetId")]
    pub id: String,
    #[serde(rename = "yazildi")]
    pub written: String,
    #[serde(rename = "urun", default = "backend_product")]
    pub product: String,
    #[serde(rename = "surum")]
    pub version: String,
    #[serde(rename = "manifestYolu")]
    pub manifest_path: String,
    #[serde(rename = "indirme", default)]
    pub download: Option<DownloadToken>,
    #[serde(rename = "saatDilimi", default)]
    pub time_zone: Option<String>,
    #[serde(rename = "onay", default)]
    pub approval: Option<Approval>,
}

fn backend_product() -> String {
    "backend".into()
}

fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Güncelleme sunucusundaki YOL (adres değil): `/<kanal>/backend/…`, güvenli karakterler, kaçış yok.
pub fn valid_manifest_path(p: &str, channel: &str) -> bool {
    let prefix = format!("/{channel}/backend/");
    p.len() <= 200
        && p.starts_with(&prefix)
        && p.len() > prefix.len()
        && p.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/'))
        && !p.contains("..")
        && !p.contains("//")
}

impl Intent {
    /// Yapısal doğrulama (kanal bağımsız); kanal öneki politika kararında ölçülür.
    pub fn validate(&self) -> Result<(), String> {
        if self.v != 1 {
            return Err(format!("desteklenmeyen niyet sürümü {}", self.v));
        }
        if !safe_id(&self.id) {
            return Err("niyetId biçimsiz".into());
        }
        if self.product != "backend" {
            return Err(format!("bilinmeyen ürün: {}", self.product));
        }
        if version::parse(&self.version).is_none() {
            return Err("surum biçimsiz".into());
        }
        if let Some(d) = &self.download {
            if d.token.is_empty()
                || d.token.len() > 32 * 1024
                || !d.token.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
            {
                return Err("indirme belirteci biçimsiz".into());
            }
        }
        if let Some(tz) = &self.time_zone {
            if tz.len() > 64 || !tz.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'_' | b'-' | b'+')) {
                return Err("saatDilimi biçimsiz".into());
            }
        }
        Ok(())
    }
}

pub enum IntentRead {
    Missing,
    Invalid(String),
    Ok(Box<Intent>),
}

pub fn read_intent(fs: &dyn Fs, layout: &Layout) -> IntentRead {
    let bytes = match fs.read_untrusted(&layout.intent_file(), 64 * 1024) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return IntentRead::Missing,
        Err(e) => return IntentRead::Invalid(format!("niyet okunamadı: {e}")),
        Ok(b) => b,
    };
    let bytes = bytes.strip_prefix("\u{feff}".as_bytes()).unwrap_or(&bytes);
    match serde_json::from_slice::<Intent>(bytes) {
        Err(e) => IntentRead::Invalid(format!("niyet JSON'u biçimsiz: {e}")),
        Ok(i) => match i.validate() {
            Ok(()) => IntentRead::Ok(Box::new(i)),
            Err(e) => IntentRead::Invalid(e),
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum State {
    #[serde(rename = "BEKLIYOR")]
    Waiting,
    #[serde(rename = "INDIRILIYOR")]
    Downloading,
    #[serde(rename = "HAZIR")]
    Ready,
    #[serde(rename = "UYGULANIYOR")]
    Applying,
    #[serde(rename = "BASARILI")]
    Succeeded,
    #[serde(rename = "GERI_DONDU")]
    RolledBack,
    #[serde(rename = "HATA")]
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Progress {
    #[serde(rename = "indirilen")]
    pub done: u64,
    #[serde(rename = "toplam")]
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyView {
    #[serde(rename = "kip")]
    pub mode: String,
    #[serde(rename = "izin")]
    pub allowed: bool,
    #[serde(rename = "neden")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatusDoc {
    pub v: u32,
    #[serde(rename = "durum")]
    pub state: State,
    #[serde(rename = "urun")]
    pub product: String,
    #[serde(rename = "surum")]
    pub version: Option<String>,
    #[serde(rename = "kaynakSurum")]
    pub source_version: Option<String>,
    #[serde(rename = "kuruluSurum")]
    pub installed_version: Option<String>,
    #[serde(rename = "adim")]
    pub step: Option<String>,
    #[serde(rename = "hataKodu")]
    pub error_code: Option<String>,
    #[serde(rename = "mesaj")]
    pub message: Option<String>,
    #[serde(rename = "niyetId")]
    pub intent_id: Option<String>,
    #[serde(rename = "islemId")]
    pub op_id: Option<String>,
    #[serde(rename = "ilerleme")]
    pub progress: Option<Progress>,
    #[serde(rename = "planlanan")]
    pub planned: Option<String>,
    #[serde(rename = "politika")]
    pub policy: Option<PolicyView>,
    #[serde(rename = "guncelleyiciSurum")]
    pub updater_version: String,
    #[serde(rename = "zaman")]
    pub at: String,
}

impl StatusDoc {
    pub fn new(state: State, at: String) -> StatusDoc {
        StatusDoc {
            v: 1,
            state,
            product: "backend".into(),
            version: None,
            source_version: None,
            installed_version: None,
            step: None,
            error_code: None,
            message: None,
            intent_id: None,
            op_id: None,
            progress: None,
            planned: None,
            policy: None,
            updater_version: env!("CARGO_PKG_VERSION").into(),
            at,
        }
    }

    /// Zaman damgası ve ilerleme dışında aynı mı (gereksiz disk yazımı olmasın).
    pub fn same_as(&self, other: &StatusDoc) -> bool {
        let strip = |s: &StatusDoc| StatusDoc { at: String::new(), progress: None, ..s.clone() };
        strip(self) == strip(other)
    }
}

pub fn read_status(fs: &dyn Fs, layout: &Layout) -> Option<StatusDoc> {
    fs.read(&layout.status_file()).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub fn write_status(fs: &dyn Fs, layout: &Layout, doc: &StatusDoc) -> std::io::Result<()> {
    let text = serde_json::to_vec_pretty(doc).map_err(std::io::Error::other)?;
    fs.write_atomic(&layout.status_file(), &text)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationCounts {
    #[serde(rename = "once")]
    pub before: Option<u64>,
    #[serde(rename = "sonra")]
    pub after: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryLine {
    pub v: u32,
    #[serde(rename = "islemId")]
    pub op_id: String,
    #[serde(rename = "niyetId")]
    pub intent_id: Option<String>,
    #[serde(rename = "urun")]
    pub product: String,
    #[serde(rename = "kaynakSurum")]
    pub source_version: String,
    #[serde(rename = "surum")]
    pub version: String,
    #[serde(rename = "sonuc")]
    pub result: State,
    #[serde(rename = "hataKodu")]
    pub error_code: Option<String>,
    #[serde(rename = "basladi")]
    pub started: String,
    #[serde(rename = "bitti")]
    pub finished: String,
    #[serde(rename = "gocSayisi")]
    pub migrations: MigrationCounts,
    #[serde(rename = "yedek")]
    pub backup: Option<String>,
    #[serde(rename = "onay")]
    pub approval: Option<Approval>,
}

const HISTORY_MAX: usize = 1000;

/// JSONL'e satır ekler; dosya yırtık bir yazımla (son satır `\n`siz) bittiyse yeni satır önce bir
/// satır sonuyla ayrılır — yoksa yeni kayıt yarım satıra yapışır ve okuyucu İKİSİNİ birden atar.
pub fn append_jsonl(fs: &dyn Fs, path: &std::path::Path, line: &[u8]) -> std::io::Result<()> {
    use std::io::{Read, Seek, SeekFrom};
    if fs.is_link(path) {
        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, format!("{} bir bağlantı — SYSTEM yazmaz", path.display())));
    }
    let mut out = Vec::with_capacity(line.len() + 2);
    if let Ok(mut f) = fs.open_read(path) {
        let len = f.seek(SeekFrom::End(0))?;
        if len > 0 {
            f.seek(SeekFrom::End(-1))?;
            let mut last = [0u8; 1];
            f.read_exact(&mut last)?;
            if last[0] != b'\n' {
                out.push(b'\n');
            }
        }
    }
    out.extend_from_slice(line);
    if !line.ends_with(b"\n") {
        out.push(b'\n');
    }
    fs.append_sync(path, &out)
}

/// Satır ekler; 1000 satırı aşınca en eskiler atılır (kopya + yeniden adlandırma).
pub fn append_history(fs: &dyn Fs, layout: &Layout, line: &HistoryLine) -> std::io::Result<()> {
    let text = serde_json::to_vec(line).map_err(std::io::Error::other)?;
    let path = layout.history_file();
    let existing = fs.read(&path).unwrap_or_default();
    let count = existing.iter().filter(|b| **b == b'\n').count();
    if count + 1 > HISTORY_MAX {
        let keep: Vec<&[u8]> = existing.split(|b| *b == b'\n').filter(|l| !l.is_empty()).collect();
        let mut out = keep[keep.len().saturating_sub(HISTORY_MAX - 1)..].join(&b'\n');
        out.push(b'\n');
        out.extend_from_slice(&text);
        out.push(b'\n');
        return fs.write_atomic(&path, &out);
    }
    append_jsonl(fs, &path, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_path_rules() {
        assert!(valid_manifest_path("/adnansahin/backend/2.13.0/manifest.jws", "adnansahin"));
        assert!(!valid_manifest_path("/testfabrika/backend/x.jws", "adnansahin"), "başka kanal");
        assert!(!valid_manifest_path("/adnansahin/backend/../electron/x", "adnansahin"));
        assert!(!valid_manifest_path("/adnansahin/backend/%2e%2e/x", "adnansahin"));
        assert!(!valid_manifest_path("/adnansahin/backend/", "adnansahin"));
        assert!(!valid_manifest_path("https://evil/adnansahin/backend/x", "adnansahin"));
    }

    #[test]
    fn intent_roundtrip_and_validation() {
        let j = r#"{"v":1,"niyetId":"6f0c-1","yazildi":"2026-09-30T20:00:00Z","surum":"2.13.0","manifestYolu":"/k/backend/m.jws",
            "indirme":{"belirtec":"a.b.c","bitis":"2026-09-30T21:00:00Z"},"saatDilimi":"Europe/Istanbul","ek":"yok sayılır"}"#;
        let i: Intent = serde_json::from_str(j).expect("niyet");
        assert_eq!(i.product, "backend");
        assert!(i.validate().is_ok());
        let bad = Intent { version: "2.13".into(), ..i.clone() };
        assert!(bad.validate().is_err());
        let bad = Intent { time_zone: Some("../etc".into()), ..i };
        assert!(bad.validate().is_err());
    }
}
