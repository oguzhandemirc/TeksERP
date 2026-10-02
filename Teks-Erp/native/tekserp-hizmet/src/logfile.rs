//! Döner dosya günlüğü: `<ad>.log` azami boya ulaşınca `<ad>.1.log[.gz]` … `<ad>.<adet>.log[.gz]`
//! kaydırılır, en eskisi silinir; `gzip` açıksa döndürülen dosya sıkıştırılır (D3: backend çıktısı
//! 10 MB × 14, pm2-logrotate eşdeğeri). Yazım hatası yazanı BLOKLAMAZ: satır düşer, sayılır, sonraki
//! başarılı yazımda "N satır düştü" notu bırakılır. Sır YAZILMAZ: çağıran yalnız anahtar adı verir.
use crate::timefmt;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn label(self) -> &'static str {
        match self {
            Level::Info => "BILGI",
            Level::Warn => "UYARI",
            Level::Error => "HATA",
        }
    }
}

/// Satır damgası: UTC (`…Z`) ya da makinenin yerel saati + ofset (D3: backend çıktısı, pm2 `time`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stamp {
    Utc,
    Local,
}

impl Stamp {
    pub fn now(self) -> String {
        match self {
            Stamp::Utc => timefmt::iso_millis(timefmt::now_ms()),
            Stamp::Local => timefmt::local_rfc3339_millis(timefmt::now_ms()),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LogSpec {
    pub max_bytes: u64,
    pub keep: u32,
    pub gzip: bool,
    pub stamp: Stamp,
}

impl LogSpec {
    /// Hizmetlerin kendi günlükleri (konak, güncelleyici): 10 MB × 10, düz, UTC.
    pub const SERVICE: LogSpec = LogSpec { max_bytes: 10 * 1024 * 1024, keep: 10, gzip: false, stamp: Stamp::Utc };
    /// Backend çıktısı (D3): 10 MB × 14, gzip, yerel saat + ofset.
    pub const BACKEND_OUTPUT: LogSpec = LogSpec { max_bytes: 10 * 1024 * 1024, keep: 14, gzip: true, stamp: Stamp::Local };
}

struct State {
    file: Option<File>,
    size: u64,
    dropped: u64,
}

pub struct RotatingLog {
    dir: PathBuf,
    name: String,
    spec: LogSpec,
    state: Mutex<State>,
}

impl RotatingLog {
    /// Dizin yoksa açılır; açılamazsa günlük sessizce devre dışı kalır (hizmet düşmez).
    pub fn open(dir: &Path, name: &str, spec: LogSpec) -> RotatingLog {
        let _ = std::fs::create_dir_all(dir);
        let log = RotatingLog {
            dir: dir.to_path_buf(),
            name: name.to_string(),
            spec,
            state: Mutex::new(State { file: None, size: 0, dropped: 0 }),
        };
        if let Ok(mut s) = log.state.lock() {
            log.reopen(&mut s);
        }
        log
    }

    /// Dosyasız günlük (testler, dizin açılamadığında).
    pub fn disabled() -> RotatingLog {
        RotatingLog {
            dir: PathBuf::new(),
            name: String::new(),
            spec: LogSpec::SERVICE,
            state: Mutex::new(State { file: None, size: 0, dropped: 0 }),
        }
    }

    pub fn path(&self) -> PathBuf {
        self.dir.join(format!("{}.log", self.name))
    }

    pub fn stamp(&self) -> String {
        self.spec.stamp.now()
    }

    fn rotated(&self, i: u32) -> PathBuf {
        self.dir.join(format!("{}.{i}.log{}", self.name, if self.spec.gzip { ".gz" } else { "" }))
    }

    fn reopen(&self, s: &mut State) {
        if self.name.is_empty() {
            return;
        }
        let path = self.path();
        s.file = OpenOptions::new().create(true).append(true).open(&path).ok();
        s.size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    }

    fn rotate(&self, s: &mut State) {
        s.file = None;
        let _ = std::fs::remove_file(self.rotated(self.spec.keep.max(1)));
        for i in (1..self.spec.keep).rev() {
            let _ = std::fs::rename(self.rotated(i), self.rotated(i + 1));
        }
        if self.spec.keep == 0 {
            let _ = std::fs::remove_file(self.path());
        } else if self.spec.gzip {
            let tmp = self.dir.join(format!("{}.1.log.gz.tmp", self.name));
            let ok = (|| -> std::io::Result<()> {
                let mut src = File::open(self.path())?;
                let mut enc = flate2::write::GzEncoder::new(File::create(&tmp)?, flate2::Compression::default());
                std::io::copy(&mut src, &mut enc)?;
                enc.finish()?.sync_all()
            })();
            if ok.is_ok() && std::fs::rename(&tmp, self.rotated(1)).is_ok() {
                let _ = std::fs::remove_file(self.path());
            } else {
                // Sıkıştırılamadıysa düz kaydırılır: veri kaybolmaz.
                let _ = std::fs::remove_file(&tmp);
                let _ = std::fs::rename(self.path(), self.dir.join(format!("{}.1.log", self.name)));
            }
        } else {
            let _ = std::fs::rename(self.path(), self.rotated(1));
        }
        self.reopen(s);
    }

    /// Hazır biçimlenmiş satırı (sonunda `\n` yoksa eklenir) yazar.
    pub fn raw(&self, line: &[u8]) {
        let Ok(mut s) = self.state.lock() else { return };
        if self.name.is_empty() {
            return;
        }
        if s.file.is_none() {
            self.reopen(&mut s);
        }
        let added = line.len() as u64 + u64::from(!line.ends_with(b"\n"));
        if s.size > 0 && s.size + added > self.spec.max_bytes {
            self.rotate(&mut s);
        }
        let dropped = s.dropped;
        let Some(f) = s.file.as_mut() else {
            s.dropped += 1;
            return;
        };
        let mut ok = true;
        if dropped > 0 {
            ok &= f.write_all(format!("{} UYARI günlük {dropped} satır düşürdü (yazım hatası)\n", self.stamp()).as_bytes()).is_ok();
        }
        ok &= f.write_all(line).is_ok();
        if !line.ends_with(b"\n") {
            ok &= f.write_all(b"\n").is_ok();
        }
        if ok {
            s.size += added;
            s.dropped = 0;
        } else {
            s.dropped += 1;
            s.file = None;
        }
    }

    pub fn write(&self, level: Level, message: &str) {
        let line = format!("{} {} {}\n", self.stamp(), level.label(), message.replace('\n', " | "));
        self.raw(line.as_bytes());
    }

    pub fn info(&self, message: &str) {
        self.write(Level::Info, message);
    }

    pub fn warn(&self, message: &str) {
        self.write(Level::Warn, message);
    }

    pub fn error(&self, message: &str) {
        self.write(Level::Error, message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("tekserp-gunluk-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn rotates_and_drops_oldest() {
        let d = dir("duz");
        let log = RotatingLog::open(&d, "deneme", LogSpec { max_bytes: 100, keep: 2, gzip: false, stamp: Stamp::Utc });
        for i in 0..20 {
            log.raw(format!("satir-{i:02}-0123456789012345678901234567890").as_bytes());
        }
        let main = std::fs::read_to_string(d.join("deneme.log")).expect("ana");
        assert!(d.join("deneme.1.log").exists() && d.join("deneme.2.log").exists());
        assert!(!d.join("deneme.3.log").exists(), "adet 2: üçüncü yok");
        assert!(main.contains("satir-19") && main.len() <= 100, "{main}");
        log.info("iki\nsatır");
        let main = std::fs::read_to_string(d.join("deneme.log")).expect("ana");
        assert!(main.contains("BILGI iki | satır"), "{main}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn gzip_rotation_keeps_content() {
        let d = dir("gz");
        let log = RotatingLog::open(&d, "backend-out", LogSpec { max_bytes: 200, keep: 3, gzip: true, stamp: Stamp::Local });
        for i in 0..30 {
            log.raw(format!("cikti-{i:02}-abcdefghijklmnopqrstuvwxyz").as_bytes());
        }
        let mut text = String::new();
        flate2::read::GzDecoder::new(File::open(d.join("backend-out.1.log.gz")).expect("gz")).read_to_string(&mut text).expect("açılır");
        assert!(text.contains("cikti-"), "{text}");
        assert!(!d.join("backend-out.4.log.gz").exists());
        let _ = std::fs::remove_dir_all(&d);
    }
}
