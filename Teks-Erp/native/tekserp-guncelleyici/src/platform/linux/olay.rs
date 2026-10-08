//! Olay günlüğü (Linux): stderr — systemd günlüğü yakalar (§1.2; `logger` yok). Günlüğe bağlıyken
//! (`JOURNAL_STREAM`) satır başı `sd-daemon` önceliği (`<3>` hata · `<4>` uyarı · `<6>` bilgi) taşır; her olay
//! TEK satırdır — iletideki satır sonları ve denetim karakterleri boşluğa iner (ileti sahte bir öncelik ya da
//! ikinci kayıt uyduramaz).
use crate::env::Events;
use std::io::Write;
use tekserp_hizmet::logfile::Level;

/// Bir olayın en uzun ileti kısmı (bayt; UTF-8 sınırında kesilir).
pub const MAX_ILETI: usize = 4096;

pub struct StderrEvents {
    /// systemd günlüğüne bağlı mı (öncelik öneki yalnız orada anlamlı; elle `tur`da düz satır).
    pub journald: bool,
}

impl StderrEvents {
    pub fn from_env() -> StderrEvents {
        StderrEvents { journald: std::env::var_os("JOURNAL_STREAM").is_some() }
    }
}

fn priority(level: Level) -> u8 {
    match level {
        Level::Error => 3,
        Level::Warn => 4,
        Level::Info => 6,
    }
}

/// Olayın stderr satırı (sonda `\n`).
pub fn line(journald: bool, level: Level, message: &str) -> String {
    let mut clean: String = message.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    if clean.len() > MAX_ILETI {
        let mut cut = MAX_ILETI;
        while !clean.is_char_boundary(cut) {
            cut -= 1;
        }
        clean.truncate(cut);
        clean.push('…');
    }
    if journald {
        format!("<{}>{}: {clean}\n", priority(level), level.label())
    } else {
        format!("{}: {clean}\n", level.label())
    }
}

impl Events for StderrEvents {
    fn event(&self, level: Level, message: &str) {
        let _ = std::io::stderr().lock().write_all(line(self.journald, level, message).as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn olay_tek_satir_ve_oncelikli() {
        assert_eq!(line(true, Level::Error, "a\nb"), "<3>HATA: a b\n");
        assert_eq!(line(true, Level::Info, "x"), "<6>BILGI: x\n");
        assert_eq!(line(false, Level::Warn, "x\r\n<3>sahte"), "UYARI: x  <3>sahte\n");
        let long = line(false, Level::Info, &"ş".repeat(MAX_ILETI));
        assert!(long.len() <= MAX_ILETI + 32 && long.ends_with("…\n"), "{}", long.len());
        assert_eq!(long.matches('\n').count(), 1);
    }
}
