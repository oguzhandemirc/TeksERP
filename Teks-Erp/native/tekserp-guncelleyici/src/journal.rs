//! İşlem günlüğü (`is\islem.jsonl`, §7): her adımın BAŞLADI satırı adım ÇALIŞMADAN önce, BİTTİ
//! satırı bittikten sonra diske iner (satır başına `FlushFileBuffers`). Yeniden başlayan süreç
//! kararları (önceki `current` hedefi, göç sayısı…) buradan okur, yeniden HESAPLAMAZ. Yarım yazılmış
//! son satır (elektrik kesintisi) açılışta atılır; ekleme hiçbir zaman yarım satırın üstüne yapılmaz.
//! Biçim DONMUŞTUR (`docs/design/GUNCELLEYICI.md` §15): yeni ikili her eski ikilinin yarım günlüğünü sürdürür
//! (vektörler `test-vektorleri/guncelleyici-gunluk/`), eski ikili yeni alanları atar.
use crate::env::Fs;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Kind {
    #[serde(rename = "ISLEM")]
    Begin,
    #[serde(rename = "BASLADI")]
    StepBegin,
    #[serde(rename = "BITTI")]
    StepEnd,
    #[serde(rename = "HATA")]
    Error,
    #[serde(rename = "TELAFI_BASLADI")]
    CompBegin,
    #[serde(rename = "TELAFI_BITTI")]
    CompEnd,
    #[serde(rename = "SONUC")]
    Result,
}

/// ISLEM satırının `v`si: günlük biçimi. Yoksa 1 sayılır (0.1.3 ve öncesi yazmazdı).
pub const FORMAT: u32 = 1;
/// ISLEM satırının `platform`u: işlemi yürüten arka uç (bildirimin platform sözlüğüyle aynı ad). Bugün tek arka uç
/// Windows hizmetidir; yoksa da bu sayılır (alansız günlüğü yalnız Windows ikilisi yazdı).
pub const PLATFORM: &str = "win32-x64";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Record {
    #[serde(rename = "sira")]
    pub seq: u64,
    #[serde(rename = "islemId")]
    pub op: String,
    #[serde(rename = "olay")]
    pub kind: Kind,
    #[serde(rename = "adim", default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(rename = "zaman")]
    pub at: String,
    /// Yalnız ISLEM satırında (`FORMAT`).
    #[serde(rename = "v", default, skip_serializing_if = "Option::is_none")]
    pub format: Option<u32>,
    /// Yalnız ISLEM satırında (`PLATFORM`).
    #[serde(rename = "platform", default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(rename = "veri", default)]
    pub data: Value,
}

/// Bir işlemin kayıtları (sırayla) — kurtarma kararları bunun üzerinden.
#[derive(Debug, Clone)]
pub struct OpView {
    pub op: String,
    pub records: Vec<Record>,
}

impl OpView {
    fn has(&self, kind: Kind, step: &str) -> bool {
        self.records.iter().any(|r| r.kind == kind && r.step.as_deref() == Some(step))
    }
    pub fn plan(&self) -> Option<&Value> {
        self.records.iter().find(|r| r.kind == Kind::Begin).map(|r| &r.data)
    }
    fn begin(&self) -> Option<&Record> {
        self.records.iter().find(|r| r.kind == Kind::Begin)
    }
    /// Günlük biçimi (`v` yoksa 1).
    pub fn format(&self) -> u32 {
        self.begin().and_then(|r| r.format).unwrap_or(1)
    }
    /// İşlemi başlatan arka uç (`platform` yoksa `win32-x64`).
    pub fn platform(&self) -> &str {
        self.begin().and_then(|r| r.platform.as_deref()).unwrap_or(PLATFORM)
    }
    /// Bu ikilinin adım listesinde olmayan ilk adım adı — daha yeni bir ikilinin günlüğü (§15: güvenli yön geri almadır).
    pub fn unknown_step<'a>(&'a self, known: &[&str]) -> Option<&'a str> {
        self.records.iter().filter_map(|r| r.step.as_deref()).find(|s| !known.contains(s))
    }
    pub fn began(&self, step: &str) -> bool {
        self.has(Kind::StepBegin, step)
    }
    pub fn ended(&self, step: &str) -> bool {
        self.has(Kind::StepEnd, step)
    }
    pub fn comp_began(&self, step: &str) -> bool {
        self.has(Kind::CompBegin, step)
    }
    pub fn comp_ended(&self, step: &str) -> bool {
        self.has(Kind::CompEnd, step)
    }
    /// Adımın BİTTİ verisi (en sonuncusu).
    pub fn step_data(&self, step: &str) -> Option<&Value> {
        self.records.iter().rev().find(|r| r.kind == Kind::StepEnd && r.step.as_deref() == Some(step)).map(|r| &r.data)
    }
    /// İlk HATA kaydı: (adım, hata kodu, ileti). Geri alma bunun kodunu taşır.
    pub fn error(&self) -> Option<(String, String, String)> {
        self.records.iter().find(|r| r.kind == Kind::Error).map(|r| {
            (
                r.step.clone().unwrap_or_default(),
                r.data.get("hataKodu").and_then(Value::as_str).unwrap_or(crate::codes::IC_HATA).to_string(),
                r.data.get("mesaj").and_then(Value::as_str).unwrap_or_default().to_string(),
            )
        })
    }
    pub fn result(&self) -> Option<&Value> {
        self.records.iter().find(|r| r.kind == Kind::Result).map(|r| &r.data)
    }
    pub fn rolling_back(&self) -> bool {
        self.records.iter().any(|r| matches!(r.kind, Kind::Error | Kind::CompBegin | Kind::CompEnd))
    }
}

pub struct Journal {
    path: PathBuf,
    seq: u64,
    records: Vec<Record>,
}

/// Bu boyu aşan günlük, yeni işlem başlarken yalnız son işlemle yeniden yazılır.
const COMPACT_BYTES: usize = 256 * 1024;

impl Journal {
    /// Okur; yarım son satırı (sonunda `\n` yok ya da JSON değil) dosyadan da atar.
    pub fn open(fs: &dyn Fs, path: &Path) -> std::io::Result<Journal> {
        let bytes = match fs.read(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e),
            Ok(b) => b,
        };
        let mut records = Vec::new();
        let mut good_len = 0usize;
        let mut offset = 0usize;
        for line in bytes.split_inclusive(|b| *b == b'\n') {
            offset += line.len();
            if !line.ends_with(b"\n") {
                break;
            }
            match serde_json::from_slice::<Record>(&line[..line.len() - 1]) {
                Ok(r) => {
                    records.push(r);
                    good_len = offset;
                }
                Err(_) => break,
            }
        }
        if good_len != bytes.len() {
            fs.write_atomic(path, &bytes[..good_len])?;
        }
        let seq = records.iter().map(|r| r.seq).max().unwrap_or(0);
        Ok(Journal { path: path.to_path_buf(), seq, records })
    }

    pub fn last_op(&self) -> Option<OpView> {
        let begin = self.records.iter().rposition(|r| r.kind == Kind::Begin)?;
        let op = self.records[begin].op.clone();
        Some(OpView { op: op.clone(), records: self.records[begin..].iter().filter(|r| r.op == op).cloned().collect() })
    }

    /// Yarım (SONUÇ'suz) son işlem.
    pub fn unfinished(&self) -> Option<OpView> {
        self.last_op().filter(|v| v.result().is_none())
    }

    pub fn append(&mut self, fs: &dyn Fs, op: &str, kind: Kind, step: Option<&str>, data: Value, at: String) -> std::io::Result<()> {
        if kind == Kind::Begin {
            self.compact(fs)?;
        }
        let begin = kind == Kind::Begin;
        let rec = Record {
            seq: self.seq + 1,
            op: op.to_string(),
            kind,
            step: step.map(str::to_string),
            at,
            format: begin.then_some(FORMAT),
            platform: begin.then(|| PLATFORM.to_string()),
            data,
        };
        let mut line = serde_json::to_vec(&rec).map_err(std::io::Error::other)?;
        line.push(b'\n');
        fs.append_sync(&self.path, &line)?;
        self.seq += 1;
        self.records.push(rec);
        Ok(())
    }

    fn compact(&mut self, fs: &dyn Fs) -> std::io::Result<()> {
        let size = self.records.iter().map(|r| serde_json::to_vec(r).map_or(0, |v| v.len() + 1)).sum::<usize>();
        if size < COMPACT_BYTES {
            return Ok(());
        }
        let keep: Vec<Record> = self.last_op().map(|v| v.records).unwrap_or_default();
        let mut out = Vec::new();
        for r in &keep {
            out.extend(serde_json::to_vec(r).map_err(std::io::Error::other)?);
            out.push(b'\n');
        }
        fs.write_atomic(&self.path, &out)?;
        self.records = keep;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::RealFs;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("tekserp-gunlukdefter-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.join("islem.jsonl")
    }

    #[test]
    fn torn_tail_is_dropped_and_ops_are_viewed() {
        let p = tmp("yirtik");
        let fs = RealFs;
        let mut j = Journal::open(&fs, &p).unwrap();
        j.append(&fs, "op1", Kind::Begin, None, json!({"surum":"2.0.0"}), "t".into()).unwrap();
        j.append(&fs, "op1", Kind::StepBegin, Some("YEDEK"), json!(null), "t".into()).unwrap();
        j.append(&fs, "op1", Kind::StepEnd, Some("YEDEK"), json!({"x":1}), "t".into()).unwrap();
        let mut bytes = std::fs::read(&p).unwrap();
        bytes.extend_from_slice(br#"{"sira":4,"islemId":"op1","olay":"BASL"#);
        std::fs::write(&p, &bytes).unwrap();
        let mut j = Journal::open(&fs, &p).unwrap();
        assert!(std::fs::read(&p).unwrap().ends_with(b"\n"), "yarım satır dosyadan da atıldı");
        let v = j.unfinished().expect("yarım işlem");
        assert!(v.began("YEDEK") && v.ended("YEDEK") && !v.began("GECIS"));
        assert_eq!(v.step_data("YEDEK"), Some(&json!({"x":1})));
        j.append(&fs, "op1", Kind::Result, None, json!({"sonuc":"BASARILI"}), "t".into()).unwrap();
        let j = Journal::open(&fs, &p).unwrap();
        assert!(j.unfinished().is_none());
        assert_eq!(j.last_op().unwrap().records.len(), 4);
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }

    /// 0.1.3'ün (`backend-v2.14.0`) satır yapısı, olduğu gibi: tanınmayan alanı atar, `deny_unknown_fields` YOK.
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct Record013 {
        sira: u64,
        #[serde(rename = "islemId")]
        islem_id: String,
        olay: Kind,
        #[serde(default)]
        adim: Option<String>,
        zaman: String,
        #[serde(default)]
        veri: Value,
    }

    #[test]
    fn begin_line_carries_format_and_platform_and_old_reader_ignores_them() {
        let p = tmp("bicim");
        let fs = RealFs;
        let mut j = Journal::open(&fs, &p).unwrap();
        j.append(&fs, "op1", Kind::Begin, None, json!({"tur":"BACKEND"}), "t".into()).unwrap();
        j.append(&fs, "op1", Kind::StepBegin, Some("YEDEK"), json!(null), "t".into()).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        let lines: Vec<Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!((lines[0]["v"].as_u64(), lines[0]["platform"].as_str()), (Some(u64::from(FORMAT)), Some(PLATFORM)));
        assert!(lines[1].get("v").is_none() && lines[1].get("platform").is_none(), "yalnız ISLEM satırında");
        for l in text.lines() {
            serde_json::from_str::<Record013>(l).expect("0.1.3 okuyucusu yeni satırı okur");
        }
        let v = Journal::open(&fs, &p).unwrap().unfinished().unwrap();
        assert_eq!((v.format(), v.platform()), (FORMAT, PLATFORM));
        assert_eq!(v.unknown_step(&["YEDEK"]), None);
        assert_eq!(v.unknown_step(&["GECIS"]), Some("YEDEK"));
        // 0.1.3 satırı (alansız): v 1, platform win32-x64.
        std::fs::write(&p, "{\"sira\":1,\"islemId\":\"op2\",\"olay\":\"ISLEM\",\"zaman\":\"t\",\"veri\":{}}\n").unwrap();
        let v = Journal::open(&fs, &p).unwrap().unfinished().unwrap();
        assert_eq!((v.format(), v.platform()), (1, "win32-x64"));
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }
}
