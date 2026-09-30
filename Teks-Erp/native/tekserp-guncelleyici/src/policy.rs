//! Politika — YETKİ KAYNAĞI imzalı kiradır (§6.2): `LICENSE_DIR\kira.jws` gömülü kök zinciriyle
//! (`tekserp_dogrulama::chain`, lisans çekirdeğiyle aynı kod) doğrulanır; kira yok/geçersiz/süresi
//! dolmuş ⇒ güncelleme YOK. Kip/pencere/hedef/dondur kiranın `guncelleme` alanından (§1–§3, D1 —
//! GEÇİCİ biçim, D1 dondurunca hizalanır); `yaptirim.guncellemeDonuk` ya da K1 ⇒ DONDUR. Pencere
//! fabrika saatiyle: dilim niyetten (backend'in tek kaynağı), yoksa Europe/Istanbul.
use crate::codes;
use crate::env::Fs;
use crate::ipc::Intent;
use crate::trust::TrustAnchor;
use crate::version;
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::path::Path;
use tekserp_dogrulama::{chain, iso, jws};

pub const DEFAULT_TIME_ZONE: &str = "Europe/Istanbul";
const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Automatic,
    Approval,
    Frozen,
}

impl Mode {
    pub fn label(self) -> &'static str {
        match self {
            Mode::Automatic => "OTOMATIK",
            Mode::Approval => "ONAYLI",
            Mode::Frozen => "DONDUR",
        }
    }
}

/// Günün dakikası [başlangıç, bitiş); bitiş < başlangıç gece yarısını geçer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub start_min: u16,
    pub end_min: u16,
}

#[derive(Debug, Clone)]
pub struct Policy {
    pub mode: Mode,
    pub window: Option<Window>,
    pub target_cap: Option<String>,
    /// DONDUR'un sebebi (`POLITIKA_DONDUR` · `YAPTIRIM_DONUK`).
    pub frozen_reason: Option<&'static str>,
    pub channel: String,
    /// Kanalın onaylı backend sürümü (`kanal.guncelSurumler.backend`) — kurulabilirin üst sınırı.
    pub channel_backend: Option<String>,
    /// HAK'ın sınıfı (hazırlık PAKET anahtarı yalnız TEST/DEMO'da geçer); HAK okunamazsa `None`.
    pub license_class: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyError {
    pub code: &'static str,
    pub message: String,
}

fn perr(code: &'static str, message: impl Into<String>) -> PolicyError {
    PolicyError { code, message: message.into() }
}

fn hhmm(v: Option<&Value>) -> Option<u16> {
    let s = v?.as_str()?;
    let (h, m) = s.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let (h, m): (u16, u16) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Kiranın `guncelleme` alanı (GEÇİCİ biçim): `{kip, pencere?: {baslangic, bitis}|null, hedefSurum?, dondur?}`.
/// Biçimsiz alan fail-closed: DONDUR (`POLITIKA_DONDUR`) — tanınmayan kip kendiliğinden kurulum açmaz.
fn update_field(v: Option<&Value>) -> (Mode, Option<Window>, Option<String>, Option<&'static str>) {
    let Some(v) = v else {
        return (Mode::Approval, None, None, None);
    };
    let Some(o) = v.as_object() else {
        return (Mode::Frozen, None, None, Some(codes::POLITIKA_DONDUR));
    };
    let mode = match o.get("kip").and_then(Value::as_str) {
        Some("OTOMATIK") => Mode::Automatic,
        Some("ONAYLI") => Mode::Approval,
        Some("DONDUR") => Mode::Frozen,
        _ => return (Mode::Frozen, None, None, Some(codes::POLITIKA_DONDUR)),
    };
    let window = match o.get("pencere") {
        None | Some(Value::Null) => None,
        Some(Value::Object(w)) => match (hhmm(w.get("baslangic")), hhmm(w.get("bitis"))) {
            (Some(s), Some(e)) if s != e => Some(Window { start_min: s, end_min: e }),
            _ => return (Mode::Frozen, None, None, Some(codes::POLITIKA_DONDUR)),
        },
        Some(_) => return (Mode::Frozen, None, None, Some(codes::POLITIKA_DONDUR)),
    };
    let target = match o.get("hedefSurum") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if version::parse(s).is_some() => Some(s.clone()),
        Some(_) => return (Mode::Frozen, None, None, Some(codes::POLITIKA_DONDUR)),
    };
    if o.get("dondur").and_then(Value::as_bool) == Some(true) || mode == Mode::Frozen {
        return (Mode::Frozen, window, target, Some(codes::POLITIKA_DONDUR));
    }
    (mode, window, target, None)
}

fn str_of<'a>(m: &'a Map<String, Value>, k: &str) -> &'a str {
    m.get(k).and_then(Value::as_str).unwrap_or_default()
}

/// Kirayı (+ varsa HAK'ı) doğrular ve politikayı çıkarır.
pub fn load(fs: &dyn Fs, license_dir: &Path, anchor: &TrustAnchor, now_ms: i64) -> Result<Policy, PolicyError> {
    let lease_text = match fs.read_untrusted(&license_dir.join("kira.jws"), 64 * 1024) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(perr(codes::KIRA_YOK, "LICENSE_DIR'de kira yok")),
        Err(e) => return Err(perr(codes::KIRA_GECERSIZ, format!("kira okunamadı: {e}"))),
        Ok(b) => String::from_utf8(b).map_err(|_| perr(codes::KIRA_GECERSIZ, "kira UTF-8 değil"))?,
    };
    let token = Value::String(lease_text.trim().to_string());
    let lease = chain::verify_lease(&token, &anchor.roots)
        .map_err(|f| perr(codes::KIRA_GECERSIZ, format!("kira doğrulanamadı: {} ({})", f.message, f.code)))?;
    let doc = &lease.document;
    let issued = iso::date_parse_ms(str_of(doc, "verilis"));
    let ends = iso::date_parse_ms(str_of(doc, "bitis"));
    let grace_days = doc.get("ekSureGun").and_then(Value::as_f64).unwrap_or(0.0);
    let skew = chain::CLOCK_SKEW_MS;
    let now = now_ms as f64;
    if !(now + skew >= issued && now <= ends + grace_days * DAY_MS as f64 + skew) {
        return Err(perr(codes::KIRA_SURESI_DOLDU, "kira bu an için geçerli değil (süre + ek süre dışında)"));
    }
    // Doğrulanmış belgenin HAM yükü: şema `guncelleme`yi (D1 dondurana dek) tanımıyor ve atıyor.
    let raw = jws::parse(&token).map_err(|f| perr(codes::KIRA_GECERSIZ, f.message))?.payload;
    let channel = doc.get("kanal").and_then(|k| k.get("kod")).and_then(Value::as_str).unwrap_or_default().to_string();
    let channel_backend =
        doc.get("kanal").and_then(|k| k.get("guncelSurumler")).and_then(|g| g.get("backend")).and_then(Value::as_str).map(str::to_string);
    let sanction = doc.get("yaptirim");
    let frozen_by_sanction = sanction.and_then(|y| y.get("guncellemeDonuk")).and_then(Value::as_bool) == Some(true)
        || sanction.and_then(|y| y.get("kademe")).and_then(Value::as_str) == Some("K1");
    let (mut mode, window, target_cap, mut frozen_reason) = update_field(raw.get("guncelleme"));
    if frozen_by_sanction {
        mode = Mode::Frozen;
        frozen_reason = Some(codes::YAPTIRIM_DONUK);
    }
    let license_class = fs
        .read_untrusted(&license_dir.join("hak.jws"), 64 * 1024)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .and_then(|t| chain::verify_entitlement(&Value::String(t.trim().to_string()), &anchor.roots).ok())
        .filter(|h| chain::check_lease_binding(&lease, h).is_ok())
        .and_then(|h| h.document.get("sinif").and_then(Value::as_str).map(str::to_string));
    Ok(Policy { mode, window, target_cap, frozen_reason, channel, channel_backend, license_class })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VersionVerdict {
    /// Kurulu sürüm hedeften yeni ya da aynı — yapılacak iş yok.
    UpToDate,
    Allowed,
    NotAllowed(String),
}

/// §6.2 sınırları: kurulu < hedef ≤ min(kanal onaylısı, hedefSurum?).
pub fn version_verdict(p: &Policy, installed: &str, wanted: &str) -> VersionVerdict {
    match version::compare(wanted, installed) {
        None => return VersionVerdict::NotAllowed("sürüm biçimsiz".into()),
        Some(Ordering::Less | Ordering::Equal) => return VersionVerdict::UpToDate,
        Some(Ordering::Greater) => {}
    }
    let Some(cap) = &p.channel_backend else {
        return VersionVerdict::NotAllowed("kira kanalın onaylı backend sürümünü taşımıyor".into());
    };
    if version::compare(wanted, cap) != Some(Ordering::Less) && version::compare(wanted, cap) != Some(Ordering::Equal) {
        return VersionVerdict::NotAllowed(format!("{wanted} kanalın onaylı sürümünden ({cap}) yeni"));
    }
    if let Some(t) = &p.target_cap {
        if version::compare(wanted, t) == Some(Ordering::Greater) {
            return VersionVerdict::NotAllowed(format!("{wanted} hedef sürümden ({t}) yeni"));
        }
    }
    VersionVerdict::Allowed
}

fn zone(tz: Option<&str>) -> Result<jiff::tz::TimeZone, String> {
    let name = tz.unwrap_or(DEFAULT_TIME_ZONE);
    jiff::tz::TimeZone::get(name).map_err(|e| format!("saat dilimi bilinmiyor ({name}): {e}"))
}

fn minute_of_day(now_ms: i64, tz: &jiff::tz::TimeZone) -> Result<u16, String> {
    let z = jiff::Timestamp::from_millisecond(now_ms).map_err(|e| e.to_string())?.to_zoned(tz.clone());
    Ok(u16::try_from(i32::from(z.hour()) * 60 + i32::from(z.minute())).unwrap_or(0))
}

pub fn in_window(w: Window, now_ms: i64, tz: Option<&str>) -> Result<bool, String> {
    let m = minute_of_day(now_ms, &zone(tz)?)?;
    Ok(if w.start_min < w.end_min { m >= w.start_min && m < w.end_min } else { m >= w.start_min || m < w.end_min })
}

/// Pencerenin bir sonraki başlangıcı (UTC ms) — `durum.planlanan` için.
pub fn next_window_start(w: Window, now_ms: i64, tz: Option<&str>) -> Result<i64, String> {
    let tz = zone(tz)?;
    let now = jiff::Timestamp::from_millisecond(now_ms).map_err(|e| e.to_string())?.to_zoned(tz);
    let start = jiff::civil::time(i8::try_from(w.start_min / 60).unwrap_or(0), i8::try_from(w.start_min % 60).unwrap_or(0), 0, 0);
    let today = now.date().to_datetime(start).to_zoned(now.time_zone().clone()).map_err(|e| e.to_string())?;
    let next = if today.timestamp() > now.timestamp() { today } else { today.tomorrow().map_err(|e| e.to_string())? };
    Ok(next.timestamp().as_millisecond())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Apply,
    /// Bekle; `Some` ise en erken an (UTC ms).
    Wait(Option<i64>, String),
    Blocked(&'static str, String),
}

/// Paket HAZIR iken: şimdi uygulanır mı?
pub fn decide(p: &Policy, intent: &Intent, now_ms: i64) -> Decision {
    match p.mode {
        Mode::Frozen => Decision::Blocked(p.frozen_reason.unwrap_or(codes::POLITIKA_DONDUR), "güncelleme dondurulmuş".into()),
        Mode::Automatic => match p.window {
            None => Decision::Apply,
            Some(w) => match in_window(w, now_ms, intent.time_zone.as_deref()) {
                Ok(true) => Decision::Apply,
                Ok(false) => Decision::Wait(next_window_start(w, now_ms, intent.time_zone.as_deref()).ok(), "pencere bekleniyor".into()),
                Err(e) => Decision::Blocked(codes::POLITIKA_DONDUR, e),
            },
        },
        Mode::Approval => match &intent.approval {
            None => Decision::Wait(None, "panelden onay bekleniyor".into()),
            Some(a) => match a.planned.as_deref().map(iso::date_parse_ms) {
                None => Decision::Apply,
                Some(t) if t.is_nan() => Decision::Blocked(codes::NIYET_BICIMSIZ, "onay.planlanan biçimsiz".into()),
                Some(t) if (now_ms as f64) >= t => Decision::Apply,
                Some(t) => Decision::Wait(Some(t as i64), "onaylı kurulum zamanı bekleniyor".into()),
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn policy(mode: Mode, window: Option<Window>) -> Policy {
        Policy {
            mode,
            window,
            target_cap: None,
            frozen_reason: None,
            channel: "k".into(),
            channel_backend: Some("2.13.0".into()),
            license_class: None,
        }
    }

    #[test]
    fn update_field_is_fail_closed() {
        assert_eq!(update_field(None).0, Mode::Approval, "alan yok ⇒ bugünkü davranış: onaysız kurulum yok");
        assert_eq!(
            update_field(Some(&json!({"kip":"OTOMATIK","pencere":{"baslangic":"02:00","bitis":"05:00"}}))).1,
            Some(Window { start_min: 120, end_min: 300 })
        );
        assert_eq!(update_field(Some(&json!({"kip":"ZAMANLI"}))).0, Mode::Frozen, "tanınmayan kip");
        assert_eq!(update_field(Some(&json!({"kip":"OTOMATIK","pencere":{"baslangic":"25:00","bitis":"05:00"}}))).0, Mode::Frozen);
        assert_eq!(update_field(Some(&json!({"kip":"OTOMATIK","dondur":true}))).0, Mode::Frozen);
        assert_eq!(update_field(Some(&json!({"kip":"OTOMATIK","hedefSurum":"2.x"}))).0, Mode::Frozen);
    }

    #[test]
    fn version_bounds() {
        let mut p = policy(Mode::Automatic, None);
        assert_eq!(version_verdict(&p, "2.12.0", "2.13.0"), VersionVerdict::Allowed);
        assert_eq!(version_verdict(&p, "2.13.0", "2.13.0"), VersionVerdict::UpToDate);
        assert_eq!(version_verdict(&p, "2.14.0", "2.13.0"), VersionVerdict::UpToDate, "geri götürülmez");
        assert!(matches!(version_verdict(&p, "2.12.0", "2.14.0"), VersionVerdict::NotAllowed(_)), "kanal onayının üstü");
        p.target_cap = Some("2.12.5".into());
        assert!(matches!(version_verdict(&p, "2.12.0", "2.13.0"), VersionVerdict::NotAllowed(_)), "hedef sürümün üstü");
        p.channel_backend = None;
        assert!(matches!(version_verdict(&p, "2.12.0", "2.12.5"), VersionVerdict::NotAllowed(_)), "kanal onayı yok ⇒ kurulum yok");
    }

    #[test]
    fn window_in_factory_time() {
        // 2026-09-30T23:30Z = 02:30 İstanbul (UTC+3)
        let t = 1_790_811_000_000;
        let w = Window { start_min: 120, end_min: 300 };
        assert_eq!(in_window(w, t, None), Ok(true));
        assert_eq!(in_window(w, t, Some("UTC")), Ok(false));
        let gece = Window { start_min: 23 * 60, end_min: 60 };
        assert_eq!(in_window(gece, t, Some("UTC")), Ok(true), "gece yarısını geçen pencere");
        // 02:30 İstanbul'da pencere başladı ⇒ bir sonraki başlangıç yarın 02:00 İstanbul = 23:00Z bugün+1
        assert_eq!(next_window_start(w, t, None), Ok(1_790_895_600_000));
        assert!(in_window(w, t, Some("Mars/Olympus")).is_err());
    }

    #[test]
    fn decide_modes() {
        let intent: Intent = serde_json::from_value(
            json!({"v":1,"niyetId":"n1","yazildi":"2026-09-30T20:00:00Z","surum":"2.13.0","manifestYolu":"/k/backend/m"}),
        )
        .unwrap();
        let t = 1_790_811_000_000;
        assert_eq!(decide(&policy(Mode::Automatic, None), &intent, t), Decision::Apply);
        assert!(matches!(
            decide(&policy(Mode::Automatic, Some(Window { start_min: 600, end_min: 660 })), &intent, t),
            Decision::Wait(Some(_), _)
        ));
        assert!(matches!(decide(&policy(Mode::Approval, None), &intent, t), Decision::Wait(None, _)));
        let mut onayli = intent.clone();
        onayli.approval =
            Some(crate::ipc::Approval { user_id: "u".into(), name: "A".into(), at: "2026-09-30T20:00:00Z".into(), planned: None });
        assert_eq!(decide(&policy(Mode::Approval, None), &onayli, t), Decision::Apply);
        onayli.approval.as_mut().unwrap().planned = Some("2026-10-01T02:00:00Z".into());
        assert!(matches!(decide(&policy(Mode::Approval, None), &onayli, t), Decision::Wait(Some(_), _)));
        let mut p = policy(Mode::Frozen, None);
        p.frozen_reason = Some(codes::YAPTIRIM_DONUK);
        assert_eq!(decide(&p, &onayli, t), Decision::Blocked(codes::YAPTIRIM_DONUK, "güncelleme dondurulmuş".into()));
    }
}
