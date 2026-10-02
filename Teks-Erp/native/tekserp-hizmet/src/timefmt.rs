//! UTC zaman biçimi — günlük satırları ve IPC damgaları (`2026-09-30T20:07:12.345Z`). Takvim
//! dönüşümü Howard Hinnant'ın `civil_from_days`ı; saat dilimi YOK (fabrika dilimi güncelleyicinin işi).
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// 1970-01-01'den gün sayısı → (yıl, ay, gün).
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` (milisaniyeli; Zod `z.iso.datetime()` ile uyumlu).
pub fn iso_millis(ms: i64) -> String {
    let day = ms.div_euclid(86_400_000);
    let in_day = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(day);
    let (s, milli) = (in_day / 1000, in_day % 1000);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{milli:03}Z", s / 3600, (s / 60) % 60, s % 60)
}

/// Makinenin yerel saati + ofset, milisaniyeli (RFC 3339: `2026-10-01T02:30:00.123+03:00`) —
/// backend çıktı satırlarının damgası (D3; pm2 `time: true` eşdeğeri). Dilim belirlenemezse UTC.
pub fn local_rfc3339_millis(ms: i64) -> String {
    let Ok(ts) = jiff::Timestamp::from_millisecond(ms) else { return iso_millis(ms) };
    let z = ts.to_zoned(jiff::tz::TimeZone::system());
    let off = z.offset().seconds();
    let (sign, off) = if off < 0 { ('-', -off) } else { ('+', off) };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}{sign}{:02}:{:02}",
        z.year(),
        z.month(),
        z.day(),
        z.hour(),
        z.minute(),
        z.second(),
        z.millisecond(),
        off / 3600,
        (off / 60) % 60
    )
}

/// Saniyeli (milisaniyesiz) biçim — kurulum kaydı (`kur.ps1` ile aynı: `yyyy-MM-ddTHH:mm:ssZ`).
pub fn iso_seconds(ms: i64) -> String {
    let t = iso_millis(ms);
    format!("{}Z", &t[..19])
}

/// Dosya adı damgası `yyyyMMdd_HHmmss` (UTC) — kurulum kaydının `geriDonus.damga` biçimi.
pub fn stamp(ms: i64) -> String {
    let t = iso_millis(ms);
    format!("{}{}{}_{}{}{}", &t[0..4], &t[5..7], &t[8..10], &t[11..13], &t[14..16], &t[17..19])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats() {
        assert_eq!(iso_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_millis(1_767_225_600_123), "2026-01-01T00:00:00.123Z");
        assert_eq!(iso_millis(951_782_400_000), "2000-02-29T00:00:00.000Z", "artık gün");
        assert_eq!(iso_seconds(1_790_799_742_999), "2026-09-30T20:22:22Z");
        assert_eq!(stamp(1_790_799_742_999), "20260930_202222");
        assert_eq!(iso_millis(-1), "1969-12-31T23:59:59.999Z");
        let l = local_rfc3339_millis(1_767_225_600_123);
        assert!(l.len() == 29 && &l[19..23] == ".123" && matches!(&l[23..24], "+" | "-"), "{l}");
    }
}
