//! İşlem günlüğü (`is\islem.jsonl`, §7): her adımın BAŞLADI satırı adım ÇALIŞMADAN önce, BİTTİ
//! satırı bittikten sonra diske iner (satır başına `FlushFileBuffers`). Yeniden başlayan süreç
//! kararları (önceki `current` hedefi, göç sayısı…) buradan okur, yeniden HESAPLAMAZ. Yarım yazılmış
//! son satır (elektrik kesintisi) açılışta atılır; ekleme hiçbir zaman yarım satırın üstüne yapılmaz.
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
        let rec = Record { seq: self.seq + 1, op: op.to_string(), kind, step: step.map(str::to_string), at, data };
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
}
