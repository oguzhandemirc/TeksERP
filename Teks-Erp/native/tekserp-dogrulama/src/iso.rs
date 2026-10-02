//! Zaman: Zod `z.iso.datetime()` biçim denetimi ve V8 `Date.parse` aynası.
//!
//! Şemadan geçmiş her damga Zod regex'inin dar alt kümesindedir ve orada eşlik TAMDIR.
//! `Date.parse` ayrıca şemadan ÖNCE, imzası henüz doğrulanmamış yükteki `verilis` için de
//! çağrılır (gömülü sertifikanın imza anı); orada ES tarih-saat biçimi birebir, V8'in eski
//! ayrıştırıcısına düşen biçimler (küçük harf `t`/`z`, boşluk ayırıcı, `+0100`, saat dilimsiz
//! yerel saat) BİLEREK NaN'dır — belge iki tarafta da reddedilir, yalnız kod farklı olabilir.
use regex::Regex;
use std::sync::OnceLock;

const ZOD_DATETIME: &str = concat!(
    r"^(?:(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29",
    r"|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|(?:02)-(?:0[1-9]|1[0-9]|2[0-8])))",
    r"T(?:(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]+)?)?(?:Z))$"
);

fn zod_datetime() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(ZOD_DATETIME).expect("zod datetime regex"))
}

/// `z.iso.datetime()` (yalnız `Z`, isteğe bağlı saniye, sınırsız kesir).
pub fn is_zod_datetime(text: &str) -> bool {
    zod_datetime().is_match(text)
}

const MS_PER_DAY: f64 = 86_400_000.0;
const MAX_TIME: f64 = 8.64e15;

/// Proleptik Gregoryen takvimde 1970-01-01'den gün sayısı (Howard Hinnant, days_from_civil).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }
    fn eat(&mut self, b: u8) -> bool {
        if self.peek() == Some(b) {
            self.pos += 1;
            true
        } else {
            false
        }
    }
    fn digits(&mut self, n: usize) -> Option<i64> {
        let end = self.pos + n;
        if end > self.bytes.len() {
            return None;
        }
        let mut v: i64 = 0;
        for &b in &self.bytes[self.pos..end] {
            if !b.is_ascii_digit() {
                return None;
            }
            v = v * 10 + i64::from(b - b'0');
        }
        self.pos = end;
        Some(v)
    }
    fn done(&self) -> bool {
        self.pos == self.bytes.len()
    }
}

/// V8 `Date.parse` — ES tarih-saat biçimi (UTC ya da ofsetli); ayrıştırılamazsa NaN.
pub fn date_parse_ms(text: &str) -> f64 {
    parse_es(text).unwrap_or(f64::NAN)
}

fn parse_es(text: &str) -> Option<f64> {
    let mut c = Cursor { bytes: text.as_bytes(), pos: 0 };
    let year = match c.peek()? {
        b'+' | b'-' => {
            let negative = c.peek() == Some(b'-');
            c.pos += 1;
            let y = c.digits(6)?;
            if negative && y == 0 {
                return None;
            }
            if negative {
                -y
            } else {
                y
            }
        }
        _ => c.digits(4)?,
    };
    let mut month = 1;
    let mut day = 1;
    if c.eat(b'-') {
        month = c.digits(2)?;
        if c.eat(b'-') {
            day = c.digits(2)?;
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let mut ms_of_day: f64 = 0.0;
    let mut offset_ms: f64 = 0.0;
    if c.eat(b'T') {
        let hour = c.digits(2)?;
        if !c.eat(b':') {
            return None;
        }
        let minute = c.digits(2)?;
        let mut second = 0;
        let mut millis = 0;
        if c.eat(b':') {
            second = c.digits(2)?;
            if c.eat(b'.') {
                let start = c.pos;
                while c.peek().is_some_and(|b| b.is_ascii_digit()) {
                    c.pos += 1;
                }
                let frac = &c.bytes[start..c.pos];
                if frac.is_empty() {
                    return None;
                }
                // V8 ilk üç haneyi alır (kesme, yuvarlama değil).
                for i in 0..3 {
                    millis = millis * 10 + frac.get(i).map_or(0, |b| i64::from(b - b'0'));
                }
            }
        }
        if hour > 24 || minute > 59 || second > 59 {
            return None;
        }
        if hour == 24 && (minute != 0 || second != 0 || millis != 0) {
            return None;
        }
        ms_of_day = ((hour * 60 + minute) * 60 + second) as f64 * 1000.0 + millis as f64;
        match c.peek() {
            Some(b'Z') => c.pos += 1,
            Some(sign @ (b'+' | b'-')) => {
                c.pos += 1;
                let oh = c.digits(2)?;
                if !c.eat(b':') {
                    return None;
                }
                let om = c.digits(2)?;
                if oh > 23 || om > 59 {
                    return None;
                }
                let off = ((oh * 60 + om) * 60_000) as f64;
                offset_ms = if sign == b'+' { off } else { -off };
            }
            // Saat dilimsiz tarih-saat ES'te YEREL saattir: makineye bağlı sonuç üretmeyiz.
            _ => return None,
        }
    }
    if !c.done() {
        return None;
    }
    let days = days_from_civil(year, month, 1) + (day - 1);
    let time = days as f64 * MS_PER_DAY + ms_of_day - offset_ms;
    if time.abs() > MAX_TIME {
        return None;
    }
    Some(time)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v8_calibration() {
        // Değerler Node 26.8.1 `Date.parse` ile ölçüldü (bkz. test-vektorleri/protokol.json `tarih`).
        let cases: &[(&str, f64)] = &[
            ("2026-01-01T00:00Z", 1767225600000.0),
            ("2026-01-01T00:00:00.1239Z", 1767225600123.0),
            ("2026-01-01T00:00:00.9999Z", 1767225600999.0),
            ("0000-02-29T00:00Z", -62162121600000.0),
            ("2026-02-30T00:00:00Z", 1772409600000.0),
            ("2026-01-01T24:00Z", 1767312000000.0),
            ("2026", 1767225600000.0),
            ("-000001-01-01T00:00:00Z", -62198755200000.0),
            ("+275760-09-13T00:00:00Z", 8640000000000000.0),
            ("2026-01-01T00:00:00.123+01:00", 1767222000123.0),
            ("2026-01-01T00:00:00+23:59", 1767139260000.0),
        ];
        for (s, want) in cases {
            assert_eq!(date_parse_ms(s), *want, "{s}");
        }
        for s in [
            "2026-13-01T00:00:00Z",
            "2026-01-01T24:00:01Z",
            "-000000-01-01T00:00:00Z",
            "+275760-09-13T00:00:00.001Z",
            "2026-01-01T00:00:00.Z",
            "garbage",
            "",
        ] {
            assert!(date_parse_ms(s).is_nan(), "{s}");
        }
        assert!(is_zod_datetime("2026-01-01T00:00Z"));
        assert!(!is_zod_datetime("2026-02-30T00:00:00Z"));
        assert!(!is_zod_datetime("2026-01-01T00:00:00+01:00"));
    }
}
