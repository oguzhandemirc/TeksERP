//! Karşılıklı onarım (W1b, plan `GUNCELLEYICI-SAGLAMLIK.md` §4.7): `onar` alt komutu. Onarıcı, onarılan ikiliden
//! BAĞIMSIZ bir dosyadır (Windows: zamanlanmış görevin gösterdiği `.lkg`; Linux: taban birimin `ExecStartPre`i).
//!
//! Sıra: kendi ölçümü (ucuz: `kendi.json`daki özetler) → işlem kilidi (doluysa güncelleyici çalışıyor: hiçbir şey) →
//! pahalı kendi ölçümü (kurulu sürümlerin imzalı listesi) — tutmazsa hiçbir şey YAZMADAN çıkar. Ardından hizmetin
//! çalıştıracağı ikili (Windows'ta ImagePath'in ikilisi, Linux'ta asıl ad) ölçülür: yoksa ya da özeti doğrulanmış
//! kümede değilse kaynak sırasıyla (`.lkg` → eski → kurulu sürüm → `surumler/<v>`) doğrulanmış bir KOPYA konur.
//! Yönetici kararı (hizmet silinmiş/Devre dışı) ONARILMAZ, görünür kılınır; W2 çitinin işareti istisnadır.
//! 24 saatte en çok `MAX_REPAIRS` onarım; tavan, tavandan sonraki ilk SAĞLIKLI turla kalkar.
use crate::codes;
use crate::env::{Env, SvcState};
use crate::ipc::{self, Notice, State, StatusDoc};
use crate::layout::Layout;
use crate::package;
use crate::platform::KendiYerlesim;
use crate::selfupdate::{self, SelfState};
use crate::tools;
use crate::version;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_hizmet::logfile::Level;
use tekserp_hizmet::timefmt;

/// 24 saatlik pencerede en çok bu kadar onarım (döngü yok, §4.7 madde 5).
pub const MAX_REPAIRS: usize = 3;
pub const WINDOW_MS: i64 = 24 * 3_600_000;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct RepairLog {
    pub v: u32,
    #[serde(default, rename = "onarimlar")]
    pub repairs: Vec<Repair>,
    /// Tavana ulaşıldı: yalnız bir sonraki SAĞLIKLI tur (insan müdahalesinden sonra) sayacı sıfırlar.
    #[serde(default, rename = "tavanda")]
    pub at_ceiling: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Repair {
    #[serde(rename = "zamanMs")]
    pub at_ms: i64,
    pub zaman: String,
    /// `EKSIK` · `BOZUK` · `HIZMET_DURMUS`
    pub neden: String,
    pub kaynak: String,
}

pub fn read_log(env: &Env, layout: &Layout) -> RepairLog {
    env.fs.read(&layout.repair_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_log(env: &Env, layout: &Layout, l: &RepairLog) -> std::io::Result<()> {
    let mut l = l.clone();
    l.v = 1;
    env.fs.write_atomic(&layout.repair_file(), &serde_json::to_vec_pretty(&l).map_err(std::io::Error::other)?)
}

fn recent(l: &RepairLog, now: i64) -> Vec<&Repair> {
    l.repairs.iter().filter(|r| now - r.at_ms < WINDOW_MS).collect()
}

/// Motor: son 24 saatteki onarım `durum.bilgi = ONARILDI` olarak görünür kalır (başka bilgi yoksa).
pub fn recent_notice(env: &Env, layout: &Layout) -> Option<Notice> {
    if !env.fs.exists(&layout.repair_file()) {
        return None;
    }
    let l = read_log(env, layout);
    let now = env.clock.now_ms();
    let last = recent(&l, now).into_iter().max_by_key(|r| r.at_ms)?;
    Some(Notice {
        code: codes::ONARILDI.into(),
        message: format!(
            "güncelleyici {} onarıldı ({}; kaynak {}) — son 24 saatte {} onarım",
            last.zaman,
            reason_text(&last.neden),
            last.kaynak,
            recent(&l, now).len()
        ),
    })
}

/// Motorun SAĞLIKLI turu (`selfupdate::on_healthy`): tavandaysa sayaç sıfırlanır. Tavan altında sıfırlanmaz — her onarımı
/// zaten sağlıklı bir tur izler; sıfırlasaydı sürekli bozulan ikili tavana hiç ulaşmaz, döngü sessiz kalırdı.
pub fn kanitli_tur(env: &Env, layout: &Layout) {
    if !env.fs.exists(&layout.repair_file()) {
        return;
    }
    let l = read_log(env, layout);
    if l.at_ceiling {
        let _ = write_log(env, layout, &RepairLog::default());
    }
}

fn reason_text(r: &str) -> &'static str {
    match r {
        "EKSIK" => "ikili yoktu",
        "BOZUK" => "ikilinin özeti doğrulanmadı",
        "HIZMET_DURMUS" => "hizmet durmuştu",
        _ => "bilinmeyen neden",
    }
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Linux taban birimi (`ExecStartPre`): yalnız asıl adı onarır, hizmete dokunmaz (systemd başlatır).
    pub yalniz_asil_ad: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Hizmetin ikilisi doğrulanmış, hizmet çalışıyor ya da kalp atışı taze — yapılacak iş yok.
    Saglam,
    /// İşlem kilidi dolu: güncelleyici çalışıyor, onunla yarışılmaz.
    KilitDolu,
    /// Onarıcının kendi dosyası doğrulanmadı — hiçbir şey yazılmadı.
    KendiDogrulanmadi(String),
    Onarildi {
        neden: String,
        kaynak: String,
    },
    /// İkili sağlam, durmuş hizmet başlatıldı.
    Baslatildi,
    /// Hizmet silinmiş ya da yönetici "Devre dışı" yapmış — onarılmaz, görünür (`GUNCELLEYICI_KAPALI`).
    Kapali(String),
    /// "Devre dışı"yı W2 çiti koymuş (`is/cit.json`) — sahibi kaldırır; uyarı da yok.
    Cit,
    Tavan,
    KaynakYok,
    DiskDolu(String),
    Hata(String),
}

impl Outcome {
    /// Süreç çıkış kodu: 0 = iş yok/onarıldı/başlatıldı/kilit dolu/çit; görünür arızalar ayrı kodla.
    pub fn exit_code(&self) -> u32 {
        match self {
            Outcome::Saglam | Outcome::KilitDolu | Outcome::Onarildi { .. } | Outcome::Baslatildi | Outcome::Cit => 0,
            Outcome::KendiDogrulanmadi(_) => 10,
            Outcome::Tavan => 11,
            Outcome::KaynakYok => 12,
            Outcome::DiskDolu(_) => 13,
            Outcome::Kapali(_) => 14,
            Outcome::Hata(_) => 2,
        }
    }
}

fn digest(env: &Env, p: &Path) -> Option<String> {
    selfupdate::digest(env, p)
}

/// `kendi.json`un bildiği doğrulanmış özetler (ucuz küme).
fn known_digests(s: Option<&SelfState>) -> Vec<String> {
    let Some(s) = s else { return vec![] };
    [&s.lkg_digest, &s.old_digest, &s.new_digest, &s.running_digest, &s.repairer_digest].into_iter().flatten().cloned().collect()
}

/// Kurulu sürümlerin imzalı listesindeki güncelleyici ikilileri: önce `current`, sonra `surumler/<v>` yeniden eskiye.
/// Liste doğrulanamayan dizin atlanır (pahalı: bütün dizini ölçer — yalnız ucuz küme yetmediğinde).
pub fn signed_sources(env: &Env, layout: &Layout, trust: &PackageTrust) -> Vec<(PathBuf, String)> {
    let fs = env.fs.as_ref();
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(Some(cur)) = fs.link_target(&layout.current()) {
        dirs.push(cur);
    }
    let mut versions: Vec<String> =
        fs.list(&layout.versions()).unwrap_or_default().into_iter().filter(|n| version::parse(n).is_some()).collect();
    versions.sort_by(|a, b| version::compare(b, a).unwrap_or(std::cmp::Ordering::Equal));
    for v in versions {
        let d = layout.version_dir(&v);
        if !dirs.iter().any(|x| crate::platform::same_path(x, &d)) {
            dirs.push(d);
        }
    }
    let rel = env.arka.guncelleyici_paket_yolu;
    dirs.into_iter()
        .filter_map(|d| {
            let exe = rel.split('/').fold(d.clone(), |p, c| p.join(c));
            if !fs.exists(&exe) {
                return None;
            }
            package::signed_file_digest(&d, fs, trust, rel).ok().map(|w| (exe, w))
        })
        .collect()
}

/// Görünür arıza: `durum.json` `HATA` + kod (kalp atışı AYNEN — güncelleyici çalışmıyor) + olay günlüğü.
fn visible(env: &Env, layout: &Layout, code: &str, message: &str) {
    env.events.event(Level::Error, &format!("{code}: {message}"));
    let mut d = ipc::read_status(env.fs.as_ref(), layout).unwrap_or_else(|| StatusDoc::new(State::Failed));
    d.state = State::Failed;
    d.error_code = Some(code.to_string());
    d.message = Some(message.to_string());
    d.at = timefmt::iso_millis(env.clock.now_ms());
    let _ = ipc::write_status(env.fs.as_ref(), layout, &d);
}

/// Kalp atışı eşiği aşıldı mı (`şimdi − sonCanlilik > canlilikEsigiSn`); durum dosyası yoksa ya da okunamıyorsa aşılmış.
fn heartbeat_stale(env: &Env, layout: &Layout) -> bool {
    let Some(d) = ipc::read_status(env.fs.as_ref(), layout) else { return true };
    let beat = tekserp_dogrulama::iso::date_parse_ms(&d.heartbeat);
    if !beat.is_finite() {
        return true;
    }
    let threshold_ms = d.liveness_threshold_s.max(30).saturating_mul(1000) as f64;
    env.clock.now_ms() as f64 - beat > threshold_ms
}

enum Place {
    Done,
    DiskFull(String),
    Skip(String),
}

/// Kurulumun PAKET güveni (yerleşik kip — kurulu dizin; backend paketini doğrulayan kümeyle aynı).
pub fn installed_trust(env: &Env, layout: &Layout, anchor: &crate::trust::TrustAnchor) -> PackageTrust {
    let license_dir =
        crate::settings::read_backend_env(env.fs.as_ref(), layout).map_or_else(|_| layout.default_license_dir(), |b| b.license_dir);
    let lic = crate::policy::load(env.fs.as_ref(), &license_dir, anchor);
    crate::policy::package_trust(anchor, &lic, tekserp_dogrulama::paket_zinciri::PackageMode::Yerlesik, env.clock.now_ms() as f64)
}

/// `onar`: bkz. modül başlığı. `own_exe` = onarıcının kendi dosyası; `trust` = kurulumun PAKET güveni (yerleşik kip;
/// kurulamazsa `None` — yalnız `kendi.json` özetleri kullanılır).
pub fn onar(env: &Env, layout: &Layout, own_exe: &Path, trust: Option<&PackageTrust>, opts: &Options) -> Outcome {
    let state = selfupdate::read(env, layout);
    let known = known_digests(state.as_ref());
    let Some(own) = digest(env, own_exe) else {
        return own_unverified(env, format!("{} okunamadı", own_exe.display()));
    };
    let Ok(_lock) = crate::lock::acquire(&layout.lock_file()) else { return Outcome::KilitDolu };
    let mut signed: Option<Vec<(PathBuf, String)>> = None;
    let mut signed_set = |env: &Env| -> Vec<(PathBuf, String)> {
        signed.get_or_insert_with(|| trust.map(|t| signed_sources(env, layout, t)).unwrap_or_default()).clone()
    };
    if !known.contains(&own) && !signed_set(env).iter().any(|(_, d)| *d == own) {
        return own_unverified(env, format!("{} özeti doğrulanmış kümede değil", own_exe.display()));
    }
    let wa = env.arka.kendi.yerlesim() == KendiYerlesim::SurumluYol;
    let full = wa && !opts.yalniz_asil_ad;
    let name = layout.updater_service.clone();
    if full {
        let st = env.svc.state(&name);
        let disabled = env.svc.disabled(&name);
        let off = match (&st, &disabled) {
            (Ok(SvcState::Missing), _) => Some(format!("{name} hizmet kaydı yok")),
            (_, Ok(true)) => Some(format!("{name} \"Devre dışı\" yapılmış")),
            _ => None,
        };
        if let Some(why) = off {
            if disabled.as_ref().is_ok_and(|d| *d) && env.fs.exists(&layout.fence_marker()) {
                return Outcome::Cit;
            }
            let message = format!("{why} — yönetici kararı onarılmaz; çare: panelden \"Onar\" ya da kurulumun onarımı");
            visible(env, layout, codes::GUNCELLEYICI_KAPALI, &message);
            return Outcome::Kapali(message);
        }
        if let Err(e) = st {
            return Outcome::Hata(format!("{name} durumu okunamadı: {e}"));
        }
    }
    let target = if full {
        match selfupdate::service_exe(env, layout) {
            Ok(p) => p,
            Err(e) => return Outcome::Hata(e),
        }
    } else {
        selfupdate::asil_ad_path(env, layout)
    };
    let running_known = state.as_ref().is_some_and(|s| s.running_digest.is_some());
    let reason = match digest(env, &target) {
        None => Some("EKSIK"),
        Some(d) if known.contains(&d) => None,
        Some(d) if signed_set(env).iter().any(|(_, w)| *w == d) => None,
        // Ölçüsü hiç alınmamış kurulumda bilinmeyen bayta dokunulmaz (geliştirme ikilisi, ilk tur öncesi).
        Some(_) if !running_known => None,
        Some(_) => Some("BOZUK"),
    };
    let now = env.clock.now_ms();
    let mut log = read_log(env, layout);
    if let Some(reason) = reason {
        if recent(&log, now).len() >= MAX_REPAIRS {
            return ceiling(env, layout, &mut log, &target);
        }
        let mut candidates: Vec<(PathBuf, String, &'static str)> = Vec::new();
        if let Some(s) = state.as_ref() {
            if let Some(w) = &s.lkg_digest {
                candidates.push((selfupdate::lkg_path(env, layout, &target), w.clone(), "son bilinen iyi"));
            }
            if let (Some(p), Some(w)) = (s.old_path.as_ref().map(PathBuf::from), &s.old_digest) {
                candidates.push((p, w.clone(), "eski ikili"));
            }
        }
        candidates.extend(signed_set(env).into_iter().map(|(p, w)| (p, w, "kurulu sürüm")));
        let mut skipped = Vec::new();
        for (src, want, label) in candidates {
            if crate::platform::same_path(&src, &target) || digest(env, &src).as_deref() != Some(want.as_str()) {
                continue;
            }
            match place(env, layout, &src, &want, &target, wa) {
                Place::Done => {
                    let kaynak = format!("{label} ({})", src.display());
                    log.repairs.push(Repair { at_ms: now, zaman: timefmt::iso_millis(now), neden: reason.into(), kaynak: kaynak.clone() });
                    log.repairs.retain(|r| now - r.at_ms < WINDOW_MS);
                    let _ = write_log(env, layout, &log);
                    env.events.event(Level::Warn, &format!("{}: {} — {kaynak}", codes::ONARILDI, reason_text(reason)));
                    drop(_lock);
                    if full {
                        let _ = env.svc.start(&name, &[]);
                    }
                    return Outcome::Onarildi { neden: reason.into(), kaynak };
                }
                Place::DiskFull(e) => {
                    let message = format!("güncelleyici ikilisi onarılamadı: disk dolu ({e}) — hiçbir şey silinmedi");
                    visible(env, layout, codes::DISK_DOLU, &message);
                    return Outcome::DiskDolu(message);
                }
                Place::Skip(why) => skipped.push(format!("{}: {why}", src.display())),
            }
        }
        let message = format!(
            "güncelleyici ikilisi {} ({}) ve doğrulanmış onarım kaynağı yok{}",
            target.display(),
            reason_text(reason),
            if skipped.is_empty() { String::new() } else { format!(" [{}]", skipped.join(" · ")) }
        );
        visible(env, layout, codes::ONARIM_KAYNAK_YOK, &message);
        return Outcome::KaynakYok;
    }
    if !full {
        return Outcome::Saglam;
    }
    // İkili sağlam: hizmet durmuş ve kalp atışı bayatsa başlatılır (bu da onarım sayılır — tavan döngüyü keser).
    if !matches!(env.svc.state(&name), Ok(SvcState::Stopped)) || !heartbeat_stale(env, layout) {
        return Outcome::Saglam;
    }
    if recent(&log, now).len() >= MAX_REPAIRS {
        return ceiling(env, layout, &mut log, &target);
    }
    log.repairs.push(Repair {
        at_ms: now,
        zaman: timefmt::iso_millis(now),
        neden: "HIZMET_DURMUS".into(),
        kaynak: target.display().to_string(),
    });
    log.repairs.retain(|r| now - r.at_ms < WINDOW_MS);
    let _ = write_log(env, layout, &log);
    drop(_lock);
    match env.svc.start(&name, &[]) {
        Ok(()) => {
            env.events.event(Level::Warn, &format!("{}: durmuş {name} başlatıldı", codes::ONARILDI));
            Outcome::Baslatildi
        }
        Err(e) => Outcome::Hata(format!("{name} başlatılamadı: {e}")),
    }
}

fn own_unverified(env: &Env, why: String) -> Outcome {
    env.events.event(Level::Error, &format!("onar: kendi dosyası doğrulanmadı ({why}) — hiçbir şey yapılmadı"));
    Outcome::KendiDogrulanmadi(why)
}

fn ceiling(env: &Env, layout: &Layout, log: &mut RepairLog, target: &Path) -> Outcome {
    if !log.at_ceiling {
        log.at_ceiling = true;
        let _ = write_log(env, layout, log);
    }
    let message = format!(
        "güncelleyici ikilisi ({}) son 24 saatte {MAX_REPAIRS} kez onarıldı ve yine bozuk/durmuş — döngü kesildi, onarılmadı; \
         virüs tarayıcı karantinası ya da disk arızası olabilir (insan gerekir)",
        target.display()
    );
    visible(env, layout, codes::ONARIM_TAVANI, &message);
    Outcome::Tavan
}

/// Doğrulanmış `src`in KOPYASI hizmetin çalıştıracağı yere konur. Kopyanın özeti `want` ve künyesi (ad · platform ·
/// çapa kipi) tutmadan hiçbir yere konmaz; yarım kopya kalmaz.
fn place(env: &Env, layout: &Layout, src: &Path, want: &str, target: &Path, wa: bool) -> Place {
    let fs = env.fs.as_ref();
    let file_name = target.file_name().map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env.arka.kendi.asil_ad()));
    let tmp = if wa { layout.updater_versions().join(".onarim").join(&file_name) } else { selfupdate::sibling(target, "onarim") };
    if let Some(d) = tmp.parent() {
        if let Err(e) = fs.create_dir_all(d) {
            return if crate::platform::is_disk_full(&e) { Place::DiskFull(e.to_string()) } else { Place::Skip(e.to_string()) };
        }
    }
    let _ = fs.remove_file(&tmp);
    if let Err(e) = fs.copy(src, &tmp) {
        let _ = fs.remove_file(&tmp);
        return if crate::platform::is_disk_full(&e) {
            Place::DiskFull(e.to_string())
        } else {
            Place::Skip(format!("kopyalanamadı: {e}"))
        };
    }
    let discard = |why: String| {
        let _ = fs.remove_file(&tmp);
        Place::Skip(why)
    };
    if digest(env, &tmp).as_deref() != Some(want) {
        return discard("kopyanın özeti tutmadı".into());
    }
    let id = match tools::identity_of(env, &tmp) {
        Ok(id) => id,
        Err(e) => return discard(format!("künye alınamadı: {e}")),
    };
    if let Err(e) = selfupdate::check_identity(&id) {
        return discard(e);
    }
    if !wa {
        // L-A: asıl adın ÜZERİNE tek yeniden adlandırma — asıl ad hiçbir an boş kalmaz.
        return match fs.rename(&tmp, target) {
            Ok(()) => Place::Done,
            Err(e) => discard(format!("asıl ada konamadı: {e}")),
        };
    }
    let Some(v) = id.get("surum").and_then(|v| v.as_str()).filter(|v| version::parse(v).is_some()) else {
        return discard("künyede sürüm yok".into());
    };
    let dest = layout.updater_versions().join(v).join(&file_name);
    if digest(env, &dest).as_deref() != Some(want) {
        if let Some(d) = dest.parent() {
            let _ = fs.create_dir_all(d);
        }
        let _ = fs.remove_file(&dest);
        if let Err(e) = fs.rename(&tmp, &dest) {
            return discard(format!("{} yerine konamadı: {e}", dest.display()));
        }
        if digest(env, &dest).as_deref() != Some(want) {
            let _ = fs.remove_file(&dest);
            return Place::Skip("yerleşen kopyanın özeti tutmadı".into());
        }
    } else {
        let _ = fs.remove_file(&tmp);
    }
    match selfupdate::point_service(env, layout, &dest, None) {
        Ok(()) => Place::Done,
        Err(e) => Place::Skip(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_are_distinct_for_visible_failures() {
        let codes: Vec<u32> = [
            Outcome::KendiDogrulanmadi(String::new()),
            Outcome::Tavan,
            Outcome::KaynakYok,
            Outcome::DiskDolu(String::new()),
            Outcome::Kapali(String::new()),
        ]
        .iter()
        .map(Outcome::exit_code)
        .collect();
        assert!(codes.iter().all(|c| *c != 0));
        let mut d = codes.clone();
        d.dedup();
        assert_eq!(d.len(), codes.len());
    }
}
