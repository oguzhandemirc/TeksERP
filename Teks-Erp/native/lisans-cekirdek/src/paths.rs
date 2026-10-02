//! Parmak izi ÇOK YOLLU okuma (K8) — TS `lib/license/fingerprint-paths.ts` aynası: etken başına sabit öncelikli
//! yol tablosu + saf seçim + Windows sonda çıktısının çözümü. G/Ç yok (o `collect.rs`te); bu yüzden her platformda
//! derlenir ve `tests/toplama.rs` TS'in ürettiği vektörlerle (`test-vektorleri/toplama.json`) burada sınar.
use crate::collect::js_trim;
use crate::fingerprint::normalize_factor;
use serde_json::{json, Value};
use std::collections::HashMap;

/// TS `FINGERPRINT_PATH_LINES` (`platform|etken|tür|kimlik`) — satır satır aynı (kâhin §0d', künye §3b).
pub const PATHS: [&str; 30] = [
    "win32|f1|1|f1.kayit",
    "win32|f1|1|f1.kayit-net64",
    "win32|f2|1|f2.cim",
    "win32|f2|1|f2.wmi",
    "win32|f2|1|f2.donanim-kaydi",
    "win32|f3|1|f3.disk-seri",
    "win32|f3|1|f3.msft-disk-seri",
    "win32|f3|1|f3.win32-disk-seri",
    "win32|f3|2|f3.disk-kimlik",
    "win32|f3|2|f3.msft-disk-kimlik",
    "win32|f4|1|f4.cim-bios",
    "win32|f4|1|f4.wmi-bios",
    "win32|f4|1|f4.smbios-sistem",
    "win32|f4|2|f4.cim-anakart",
    "win32|f4|2|f4.wmi-anakart",
    "win32|f4|2|f4.smbios-anakart",
    "linux|f1|1|f1.machine-id",
    "linux|f1|1|f1.dbus-machine-id",
    "linux|f2|1|f2.dmi-uuid",
    "linux|f2|1|f2.smbios-uuid",
    "linux|f3|1|f3.udev-seri",
    "linux|f3|2|f3.sysfs-aygit-seri",
    "linux|f3|3|f3.sysfs-seri",
    "linux|f3|4|f3.sysfs-wwid",
    "linux|f4|1|f4.dmi-sistem",
    "linux|f4|1|f4.smbios-sistem",
    "linux|f4|2|f4.dmi-anakart",
    "linux|f4|2|f4.smbios-anakart",
    "darwin|f1|1|f1.ioreg-uuid",
    "darwin|f4|1|f4.ioreg-seri",
];

pub const OS_FACTORS: [&str; 4] = ["f1", "f2", "f3", "f4"];

/// Yolun ham sonucu: `Some(metin)` (boş = okundu ama değer yok) ya da `None` = OKUNAMADI.
pub type Outcomes = HashMap<String, Option<String>>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reading {
    pub durum: &'static str,
    pub yol: Option<String>,
    pub celiski: Vec<String>,
    pub hatali: Vec<String>,
}

impl Reading {
    pub fn unread() -> Self {
        Reading { durum: "OKUNAMADI", yol: None, celiski: Vec::new(), hatali: Vec::new() }
    }

    pub fn to_json(&self) -> Value {
        json!({ "durum": self.durum, "yol": self.yol, "celiski": self.celiski, "hatali": self.hatali })
    }
}

/// `(tür, kimlik)` — bir platformun bir etkene ait yolları, tablo sırasıyla.
pub fn paths_for(platform: &str, factor: &str) -> Vec<(u32, &'static str)> {
    PATHS
        .iter()
        .filter_map(|line| {
            let mut parts = line.split('|');
            let (p, f, tur, id) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
            (p == platform && f == factor).then(|| tur.parse::<u32>().ok().map(|t| (t, id))).flatten()
        })
        .collect()
}

fn outcome_of(outcomes: &Outcomes, id: &str) -> Option<String> {
    outcomes.get(id).cloned().flatten()
}

/// Tek etkenin seçimi (TS `selectFactor`): türler sırayla; tür içinde ilk kullanılabilir değer kazanır, önceki tür
/// yalnız hata verdiyse etken OKUNAMADI kalır (geçici arıza başka türde bir değere geçip sahte uyuşmazlık doğurmasın).
pub fn select_factor(factor: &str, paths: &[(u32, &str)], outcomes: &Outcomes) -> (Option<String>, Reading) {
    let hatali: Vec<String> = paths.iter().filter(|(_, id)| outcome_of(outcomes, id).is_none()).map(|(_, id)| (*id).to_string()).collect();
    let mut turler: Vec<u32> = paths.iter().map(|(t, _)| *t).collect();
    turler.sort_unstable();
    turler.dedup();
    for tur in turler {
        let group: Vec<&str> = paths.iter().filter(|(t, _)| *t == tur).map(|(_, id)| *id).collect();
        let usable: Vec<(&str, String, String)> = group
            .iter()
            .filter_map(|id| {
                let raw = outcome_of(outcomes, id)?;
                let norm = normalize_factor(factor, Some(&raw))?;
                Some((*id, raw, norm))
            })
            .collect();
        if let Some((winner_id, winner_raw, winner_norm)) = usable.first() {
            let celiski = usable.iter().skip(1).filter(|(_, _, n)| n != winner_norm).map(|(id, _, _)| (*id).to_string()).collect();
            let reading = Reading { durum: "OKUNDU", yol: Some((*winner_id).to_string()), celiski, hatali };
            return (Some(winner_raw.clone()), reading);
        }
        if group.iter().all(|id| outcome_of(outcomes, id).is_none()) {
            return (None, Reading { durum: "OKUNAMADI", yol: None, celiski: Vec::new(), hatali });
        }
    }
    (None, Reading { durum: "DEGER_YOK", yol: None, celiski: Vec::new(), hatali })
}

/// Platformun f1..f4 seçimi (TS `selectOsFactors`).
pub fn select_os(platform: &str, outcomes: &Outcomes) -> ([Option<String>; 4], [Reading; 4]) {
    let mut raw: [Option<String>; 4] = Default::default();
    let mut readings: [Reading; 4] = [Reading::unread(), Reading::unread(), Reading::unread(), Reading::unread()];
    for (i, factor) in OS_FACTORS.iter().enumerate() {
        let (r, reading) = select_factor(factor, &paths_for(platform, factor), outcomes);
        raw[i] = r;
        readings[i] = reading;
    }
    (raw, readings)
}

/// Windows sonda çıktısı (TS `parseWindowsProbeOutput`): satır başına `{"y","v"}` ya da `{"y","h"}`; çözülemeyen satır
/// (tek başına vekil dahil — serde reddeder, TS de) yok sayılır, aynı yolun ilk satırı kazanır.
pub fn parse_windows_output(stdout: &str) -> Outcomes {
    let mut out = Outcomes::new();
    for line in stdout.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if js_trim(line).is_empty() {
            continue;
        }
        let Ok(Value::Object(o)) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(Value::String(y)) = o.get("y") else {
            continue;
        };
        if out.contains_key(y) {
            continue;
        }
        let v = match o.get("v") {
            Some(Value::String(s)) => Some(s.clone()),
            _ => None,
        };
        out.insert(y.clone(), v);
    }
    out
}

/// SMBIOS yapısının metin bölümü (TS `smbiosStrings`).
pub fn smbios_strings(entry: &[u8]) -> Vec<String> {
    let len = if entry.len() >= 2 { entry[1] as usize } else { 0 };
    if len < 4 || len > entry.len() {
        return Vec::new();
    }
    let mut end = len;
    while end + 1 < entry.len() && !(entry[end] == 0 && entry[end + 1] == 0) {
        end += 1;
    }
    if end <= len {
        return Vec::new();
    }
    String::from_utf8_lossy(&entry[len..end]).split('\0').map(str::to_string).collect()
}

/// Tip 1/2 seri metni (TS `smbiosSerial`).
pub fn smbios_serial(entry: &[u8]) -> String {
    if entry.len() < 8 || entry[1] < 8 {
        return String::new();
    }
    let index = entry[7] as usize;
    let strings = smbios_strings(entry);
    if index >= 1 && index <= strings.len() {
        strings[index - 1].clone()
    } else {
        String::new()
    }
}

/// Tip 1 UUID'si, SMBIOS 2.6+ bayt sırasıyla (TS `smbiosUuid`).
pub fn smbios_uuid(entry: &[u8]) -> String {
    if entry.len() < 25 || entry[1] < 25 {
        return String::new();
    }
    let b: Vec<String> = entry[8..24].iter().map(|x| format!("{x:02x}")).collect();
    let order: [i32; 20] = [3, 2, 1, 0, -1, 5, 4, -1, 7, 6, -1, 8, 9, -1, 10, 11, 12, 13, 14, 15];
    order.iter().map(|&i| if i < 0 { "-".to_string() } else { b[i as usize].clone() }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcomes(pairs: &[(&str, Option<&str>)]) -> Outcomes {
        pairs.iter().map(|(k, v)| ((*k).to_string(), v.map(str::to_string))).collect()
    }

    #[test]
    fn table_is_well_formed() {
        for line in PATHS {
            let parts: Vec<&str> = line.split('|').collect();
            assert_eq!(parts.len(), 4, "{line}");
            assert!(["win32", "linux", "darwin"].contains(&parts[0]), "{line}");
            assert!(OS_FACTORS.contains(&parts[1]) && parts[3].starts_with(parts[1]), "{line}");
            assert!(parts[2].parse::<u32>().is_ok(), "{line}");
        }
    }

    #[test]
    fn earlier_kind_error_keeps_factor_unread() {
        // f3: seri türü yalnız hata verdi → kimlik türüne geçilmez (geçici arıza başka değere kaymasın).
        let o = outcomes(&[("f3.disk-kimlik", Some("eui.0025388191b45c67"))]);
        let (raw, r) = select_factor("f3", &paths_for("win32", "f3"), &o);
        assert_eq!((raw, r.durum), (None, "OKUNAMADI"));
        // RAID: seri genel desende (kesin cevap) → UniqueId devreye girer.
        let o = outcomes(&[("f3.disk-seri", Some("Volume0")), ("f3.disk-kimlik", Some("{abc-1234-def}"))]);
        let (raw, r) = select_factor("f3", &paths_for("win32", "f3"), &o);
        assert_eq!((raw.as_deref(), r.yol.as_deref()), (Some("{abc-1234-def}"), Some("f3.disk-kimlik")));
    }

    #[test]
    fn lone_surrogate_line_is_skipped() {
        let out = parse_windows_output("{\"y\":\"f1.kayit\",\"v\":\"\\ud800\"}\r\n{\"y\":\"f1.kayit\",\"v\":\"abc\"}\n");
        assert_eq!(out.get("f1.kayit"), Some(&Some("abc".to_string())));
    }
}
