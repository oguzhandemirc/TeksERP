//! IPC (§5): `niyet\niyet.json` (backend yazar, burada yalnız OKUNUR ve doğrulanır — yetki DEĞİL:
//! onay + indirme belirteci), `durum\durum.json` + `durum\gecmis.jsonl` (güncelleyici yazar; backend
//! yoklama raporunu (sözleşme §3.1) ve panel ekranını buradan kurar). Anahtarlar Türkçe (tel sözleşmesi).
use crate::decision::{self, Timing};
use crate::env::Fs;
use crate::layout::Layout;
use crate::version;
use serde::{Deserialize, Serialize};
use tekserp_dogrulama::iso;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DownloadToken {
    #[serde(rename = "belirtec")]
    pub token: String,
    #[serde(rename = "bitis")]
    pub expires: String,
}

/// Panel onayı (izinli kullanıcı + backend'in denetim satırı): YALNIZ zamanlamayı tetikler, tek sürüme
/// bağlıdır; DONDUR'u ve K1'i açamaz. `onayId` her yeni insan kararında yenidir — geri dönen bir sürüm
/// ancak YENİ bir onayla yeniden denenir.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Approval {
    #[serde(rename = "onayId")]
    pub id: String,
    #[serde(rename = "surum")]
    pub version: String,
    #[serde(rename = "zamanlama")]
    pub timing: Timing,
    #[serde(rename = "kullaniciId")]
    pub user_id: String,
    #[serde(rename = "ad")]
    pub name: String,
    #[serde(rename = "zaman")]
    pub at: String,
}

impl Approval {
    pub fn for_decision(&self) -> decision::Approval {
        decision::Approval { surum: self.version.clone(), zamanlama: self.timing }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Intent {
    pub v: u32,
    #[serde(rename = "yazildi")]
    pub written: String,
    #[serde(rename = "indirme", default)]
    pub download: Option<DownloadToken>,
    #[serde(rename = "onay", default)]
    pub approval: Option<Approval>,
}

fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

impl Intent {
    pub fn validate(&self) -> Result<(), String> {
        if self.v != 1 {
            return Err(format!("desteklenmeyen niyet sürümü {}", self.v));
        }
        if let Some(d) = &self.download {
            if d.token.is_empty()
                || d.token.len() > 32 * 1024
                || !d.token.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
            {
                return Err("indirme belirteci biçimsiz".into());
            }
            if !iso::date_parse_ms(&d.expires).is_finite() {
                return Err("indirme.bitis biçimsiz".into());
            }
        }
        if let Some(a) = &self.approval {
            if !safe_id(&a.id) || !safe_id(&a.user_id) {
                return Err("onay kimliği biçimsiz".into());
            }
            if !version::is_release(&a.version) {
                return Err("onay.surum biçimsiz".into());
            }
            if a.name.chars().count() > 200 || !iso::date_parse_ms(&a.at).is_finite() {
                return Err("onay ad/zaman biçimsiz".into());
            }
        }
        Ok(())
    }

    /// Belirteç şu an kullanılabilir mi (süresi geçmemiş).
    pub fn token_at(&self, now_ms: i64) -> Option<&str> {
        let d = self.download.as_ref()?;
        ((now_ms as f64) < iso::date_parse_ms(&d.expires)).then_some(d.token.as_str())
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

/// Geçerli kiranın politikası (gösterim; karar ayrıca `karar`/`bekleyen`de). `null` = geçerli kira yok.
/// `izin`/`neden` backend okuyucusunun (D1 `updater-ipc.ts`, sözleşme sürümü 3) beklediği alanlardır:
/// karar DONDURULDU ya da UYGUN_DEGIL ise `izin: false` ve `neden` onun sözlüğünden (`legacy_reason`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyView {
    #[serde(rename = "kip")]
    pub mode: String,
    #[serde(rename = "izin")]
    pub allowed: bool,
    #[serde(rename = "neden")]
    pub reason: Option<String>,
    #[serde(rename = "kaynak")]
    pub source: String,
    #[serde(rename = "hedefSurum")]
    pub target: Option<String>,
    #[serde(rename = "donuk")]
    pub frozen: bool,
}

/// Karar → backend okuyucusunun red sözlüğü (D1 `update-status.service.ts` `BLOCK_REASONS`): DONDURULDU
/// nedenleri eski kodlarıyla, UYGUN_DEGIL nedenleri kendi adlarıyla (okuyucu tanımadığı kodu
/// `UYGUN_DEGIL/<kod>` sayar — karar birebir korunur).
pub fn legacy_reason(d: &decision::Decision) -> Option<String> {
    let reason = d.neden.as_deref()?;
    match d.karar {
        decision::Kind::Frozen => Some(
            match reason {
                "POLITIKA" => "POLITIKA_DONDUR",
                "YAPTIRIM" => "YAPTIRIM_DONUK",
                other => other,
            }
            .to_string(),
        ),
        decision::Kind::NotEligible => Some(reason.to_string()),
        _ => None,
    }
}

/// En yeni adayın son kararı — backend yoklama raporunun `bekleyen`i `{surum, karar, neden}` buradan;
/// kalanlar panel içindir.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Pending {
    pub surum: String,
    pub karar: String,
    pub neden: Option<String>,
    pub aralik: Option<decision::Interval>,
    #[serde(rename = "pgGuncellemesi")]
    pub pg_update: bool,
    pub zorunlu: bool,
    #[serde(rename = "ozet")]
    pub summary: String,
}

/// Son TAMAMLANAN deneme — sözleşme §3.1 `UpdateResultSchema` ile BİREBİR (KATI; backend olduğu gibi
/// yoklamaya taşır). `kod` belgeli kümeden (`codes::report_code`); ayrıntı `sonAyrinti`da.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UpdateResult {
    #[serde(rename = "kayitId")]
    pub record_id: String,
    #[serde(rename = "hedefSurum")]
    pub target: String,
    #[serde(rename = "kaynakSurum")]
    pub source: Option<String>,
    #[serde(rename = "sonuc")]
    pub result: String,
    pub kod: Option<String>,
    pub baslangic: String,
    pub bitis: String,
    #[serde(rename = "veriGeriYuklendi")]
    pub data_restored: bool,
}

/// `son`un yerel ayrıntısı (panel/destek): hangi işlem, iç hata kodu ve ileti (sır içermez).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LastDetail {
    #[serde(rename = "urun")]
    pub product: String,
    #[serde(rename = "hataKodu")]
    pub error_code: Option<String>,
    #[serde(rename = "mesaj")]
    pub message: Option<String>,
}

/// `durum\durum.json` (§5.2). Üst alanlar backend okuyucusunun (D1 `UpdaterStatusDocSchema`, sözleşme
/// sürümü 3) okuduğu biçimle geriye uyumludur; kesin karar ve sonuç `karar` · `bekleyen` · `son`da.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatusDoc {
    pub v: u32,
    /// Son yazım anı — her turda tazelenir (canlılık: `turSn`in birkaç katından eskiyse güncelleyici
    /// ölçülemiyor sayılabilir).
    #[serde(rename = "zaman")]
    pub at: String,
    #[serde(rename = "turSn")]
    pub tick_s: u64,
    #[serde(rename = "guncelleyiciSurum")]
    pub updater_version: String,
    #[serde(rename = "kuruluSurum")]
    pub installed_version: Option<String>,
    #[serde(rename = "durum")]
    pub state: State,
    /// Aday (ya da süren işlemin hedefi) — backend `bekleyen`i bunun üstüne kurar.
    #[serde(rename = "surum")]
    pub version: Option<String>,
    #[serde(rename = "kaynakSurum")]
    pub source_version: Option<String>,
    /// Süren işlem: ürün (`backend` · `pg`), kimlik, adım (`GERI_DON:<adım>` geri almada).
    #[serde(rename = "urun")]
    pub product: Option<String>,
    #[serde(rename = "islemId")]
    pub op_id: Option<String>,
    #[serde(rename = "adim")]
    pub step: Option<String>,
    #[serde(rename = "hataKodu")]
    pub error_code: Option<String>,
    /// En çok `MESSAGE_MAX` karakter (okuyucunun tavanı 500).
    #[serde(rename = "mesaj")]
    pub message: Option<String>,
    #[serde(rename = "ilerleme")]
    pub progress: Option<Progress>,
    #[serde(rename = "planlanan")]
    pub planned: Option<String>,
    #[serde(rename = "politika")]
    pub policy: Option<PolicyView>,
    /// Son karar (aday olsun olmasın; TS `UpdateDecision` birebir).
    #[serde(rename = "karar")]
    pub decision: Option<decision::Decision>,
    #[serde(rename = "bekleyen")]
    pub pending: Option<Pending>,
    #[serde(rename = "son")]
    pub last: Option<UpdateResult>,
    #[serde(rename = "sonAyrinti")]
    pub last_detail: Option<LastDetail>,
}

/// `mesaj` tavanı (karakter): backend okuyucusu 500'den uzununu dosyayla birlikte reddeder.
pub const MESSAGE_MAX: usize = 400;

pub fn clip(message: &str) -> String {
    if message.chars().count() <= MESSAGE_MAX {
        return message.to_string();
    }
    let mut out: String = message.chars().take(MESSAGE_MAX - 1).collect();
    out.push('…');
    out
}

impl StatusDoc {
    pub fn new(state: State) -> StatusDoc {
        StatusDoc {
            v: 1,
            at: String::new(),
            tick_s: 0,
            updater_version: env!("CARGO_PKG_VERSION").into(),
            installed_version: None,
            state,
            version: None,
            source_version: None,
            product: None,
            op_id: None,
            step: None,
            error_code: None,
            message: None,
            progress: None,
            planned: None,
            policy: None,
            decision: None,
            pending: None,
            last: None,
            last_detail: None,
        }
    }
}

pub fn read_status(fs: &dyn Fs, layout: &Layout) -> Option<StatusDoc> {
    fs.read(&layout.status_file()).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub fn write_status(fs: &dyn Fs, layout: &Layout, doc: &StatusDoc) -> std::io::Result<()> {
    let mut doc = doc.clone();
    doc.message = doc.message.as_deref().map(clip);
    let text = serde_json::to_vec_pretty(&doc).map_err(std::io::Error::other)?;
    fs.write_atomic(&layout.status_file(), &text)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationCounts {
    #[serde(rename = "once")]
    pub before: Option<u64>,
    #[serde(rename = "sonra")]
    pub after: Option<u64>,
}

/// `durum\gecmis.jsonl` satırı (§5.3): sonuç alanları raporun sözlüğüyle (`hataKodu` = belgeli kod,
/// `ayrintiKodu` = güncelleyicinin iç kodu); backend okuyucusu (D1) `urun = backend` satırlarını okur.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryLine {
    pub v: u32,
    #[serde(rename = "islemId")]
    pub op_id: String,
    #[serde(rename = "onayId")]
    pub approval_id: Option<String>,
    #[serde(rename = "urun")]
    pub product: String,
    /// PG satırında: bu adımın ön koşul olduğu backend sürümü.
    #[serde(rename = "hedefBackend", default, skip_serializing_if = "Option::is_none")]
    pub backend_target: Option<String>,
    #[serde(rename = "kaynakSurum")]
    pub source_version: String,
    #[serde(rename = "surum")]
    pub version: String,
    #[serde(rename = "sonuc")]
    pub result: State,
    #[serde(rename = "hataKodu")]
    pub error_code: Option<String>,
    #[serde(rename = "ayrintiKodu")]
    pub detail_code: Option<String>,
    #[serde(rename = "veriGeriYuklendi")]
    pub data_restored: bool,
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
    fn intent_roundtrip_and_validation() {
        let j = r#"{"v":1,"yazildi":"2026-09-30T20:00:00Z","indirme":{"belirtec":"a.b.c","bitis":"2026-09-30T21:00:00Z"},
            "onay":{"onayId":"6f0c-1","surum":"2.13.0","zamanlama":"PENCERE","kullaniciId":"u-1","ad":"Ayşe","zaman":"2026-09-30T20:00:00Z"},
            "ek":"yok sayılır"}"#;
        let i: Intent = serde_json::from_str(j).expect("niyet");
        assert!(i.validate().is_ok());
        assert_eq!(i.token_at(1_790_798_400_000), Some("a.b.c"));
        assert_eq!(i.token_at(1_790_805_600_000), None, "süresi geçen belirteç kullanılmaz");
        let mut bad = i.clone();
        bad.approval.as_mut().unwrap().version = "2.13".into();
        assert!(bad.validate().is_err());
        let mut bad = i.clone();
        bad.approval.as_mut().unwrap().version = "2.13.0+yapi".into();
        assert!(bad.validate().is_err(), "yayın sürümü +yapı taşımaz");
        assert!(serde_json::from_str::<Intent>(&j.replace("PENCERE", "YARIN")).is_err(), "tanınmayan zamanlama");
    }

    /// Backend okuyucusunun (D1 `updater-ipc.ts` `UpdaterStatusDocSchema` · `UpdaterHistoryLineSchema`)
    /// istediği alanlar, tipler ve tavanlar — biri tutmazsa backend dosyanın TAMAMINI "ölçülemedi" sayar.
    #[test]
    fn files_match_the_backend_reader() {
        let code = |v: &serde_json::Value| {
            v.as_str().is_some_and(|s| {
                (2..=40).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            })
        };
        let short = |v: &serde_json::Value, max: usize| v.is_null() || v.as_str().is_some_and(|s| s.encode_utf16().count() <= max);
        let mut d = StatusDoc::new(State::Ready);
        d.at = "2026-10-01T00:00:00.000Z".into();
        d.version = Some("2.13.0".into());
        d.message = Some("ş".repeat(900));
        d.step = Some("GERI_DON:BACKEND_DURDUR".into());
        d.progress = Some(Progress { done: 5, total: 10 });
        d.policy = Some(PolicyView {
            mode: "ONAYLI".into(),
            allowed: false,
            reason: Some("KAYNAK_SURUM_ESKI".into()),
            source: "KIRA".into(),
            target: None,
            frozen: false,
        });
        let dir = std::env::temp_dir().join(format!("tekserp-ipc-{}", std::process::id()));
        let layout = Layout::new(&dir, &dir);
        std::fs::create_dir_all(layout.status_dir()).unwrap();
        write_status(&crate::env::RealFs, &layout, &d).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(layout.status_file()).unwrap()).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(v["v"], 1);
        assert!(code(&v["durum"]));
        for (k, max) in [
            ("surum", 40),
            ("kaynakSurum", 40),
            ("kuruluSurum", 40),
            ("adim", 60),
            ("hataKodu", 60),
            ("mesaj", 500),
            ("planlanan", 40),
            ("guncelleyiciSurum", 40),
            ("zaman", 40),
        ] {
            assert!(short(&v[k], max), "{k}: {}", v[k]);
        }
        assert!(v["ilerleme"]["indirilen"].is_u64() && v["ilerleme"]["toplam"].is_u64());
        assert!(v["politika"]["izin"].is_boolean() && short(&v["politika"]["kip"], 20) && short(&v["politika"]["neden"], 60));
        let line = HistoryLine {
            v: 1,
            op_id: "3a6e9c5d-2f4b-4c0d-9e3f-8a9b0c1d2e3f".into(),
            approval_id: None,
            product: "backend".into(),
            backend_target: None,
            source_version: "2.12.0".into(),
            version: "2.13.0".into(),
            result: State::RolledBack,
            error_code: Some("SAGLIK_HATASI".into()),
            detail_code: Some("SAGLIK_ZAMAN_ASIMI".into()),
            data_restored: true,
            started: "2026-10-01T00:00:00.000Z".into(),
            finished: "2026-10-01T00:05:00.000Z".into(),
            migrations: MigrationCounts { before: Some(2), after: Some(4) },
            backup: None,
            approval: None,
        };
        let h = serde_json::to_value(&line).unwrap();
        assert!(h["islemId"].as_str().unwrap().len() <= 64 && short(&h["urun"], 20) && short(&h["surum"], 40) && !h["surum"].is_null());
        assert!(code(&h["sonuc"]) && h["veriGeriYuklendi"] == true && short(&h["basladi"], 40) && short(&h["bitti"], 40));
    }

    #[test]
    fn update_result_is_strict() {
        let ok = r#"{"kayitId":"3a6e9c5d-2f4b-4c0d-9e3f-8a9b0c1d2e3f","hedefSurum":"2.10.4","kaynakSurum":"2.10.3","sonuc":"GERI_DONDU",
            "kod":"SAGLIK_HATASI","baslangic":"2026-10-02T23:05:00.000Z","bitis":"2026-10-02T23:41:00.000Z","veriGeriYuklendi":true}"#;
        assert!(serde_json::from_str::<UpdateResult>(ok).is_ok());
        assert!(serde_json::from_str::<UpdateResult>(&ok.replace("}", r#","ek":1}"#)).is_err());
    }
}
