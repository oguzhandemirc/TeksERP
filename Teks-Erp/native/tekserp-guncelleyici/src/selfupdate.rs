//! Kendini güncelleme (§10, plan `GUNCELLEYICI-SAGLAMLIK.md` §4.2 + §4.7): paket güncelleyici ikilisini taşır (yeri
//! arka ucun `guncelleyici_paket_yolu`; Linux'ta `.exe`siz); kaynak sürüm dizini imzalı listeyle doğrulanır, ikili yan
//! dosyaya (`.yeni`) kopyalanır ve KOPYANIN özeti imzalı listedekiyle (ve imzalı bildirim ilan ediyorsa onun
//! `guncelleyici.sha256`ıyla) tutmadan HİÇBİR ikili çalıştırılmaz (DAGK-3); künye kopyadan alınır (ad · platform ·
//! sürüm · çapa kipi). Yerleşim platformun (W1b): Windows'ta yeni ikili `guncelleyici\s\<sürüm>\`e konur ve hizmet
//! komut satırı TEK kayıt yazımıyla ona çevrilir (W-A); Linux'ta `.eski` önce KOPYA alınır, yeni ikili asıl adın
//! üzerine tek `rename(2)` ile iner (L-A) — hizmetin çalıştıracağı yol HİÇBİR an boş kalmaz. Yeni ikili İLK iş olarak
//! açılış sayacını artırır: doğrulanmadan 3. açılışı aşarsa geri döner. Son bilinen iyi (`.lkg`) asıl adın yanındadır;
//! backend denemesini BASARILI/GERI_DONDU bitiren ikili kendini ona kopyalar, kanıtsız yeni ikili ilk HATA'da ona
//! döner. `calisanOzet` + `.lkg` `onar`ın ölçüsüdür. Hizmet her açılışta kendi SCM kurtarmasını `RESTART_DELAYS_S`e
//! getirir (yalnız farklıysa yazar).
use crate::env::Env;
use crate::layout::Layout;
use crate::package;
use crate::platform::KendiYerlesim;
use crate::release::ReleaseUpdater;
use crate::tools;
use crate::trust;
use crate::version;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_hizmet::contract;
use tekserp_hizmet::timefmt;

/// Bu ikilinin platformu (`kunye.hedef`): kendini güncelleme platform GEÇMEZ (§4.6) — başka hedefin ikilisi yerleşmez.
pub const OWN_TARGET: &str = std::env::consts::OS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelfState {
    /// `HAZIRLANDI` · `YER_DEGISTIRILDI` · `DOGRULANDI` · `GERI_ALINDI` · `KURULUM` (W1b: yalnız ölçü; eski okuyucu
    /// hiçbir dalında iş yapmaz)
    pub durum: String,
    #[serde(rename = "eskiSurum")]
    pub old_version: String,
    #[serde(rename = "yeniSurum")]
    pub new_version: String,
    #[serde(rename = "acilis")]
    pub boots: u32,
    pub zaman: String,
    /// `yeniSurum` bir backend denemesini BASARILI/GERI_DONDU ile bitirdi (uygulama yolu uçtan uca koştu).
    #[serde(default, rename = "kanitlandi")]
    pub proven: bool,
    /// `.lkg` ikilisinin sürümü ve özeti (son bilinen iyi); özet tutmazsa ona dönülmez.
    #[serde(default, rename = "lkgSurum", skip_serializing_if = "Option::is_none")]
    pub lkg_version: Option<String>,
    #[serde(default, rename = "lkgOzet", skip_serializing_if = "Option::is_none")]
    pub lkg_digest: Option<String>,
    /// Geri alınmış sürüm: bu sürüm ve eskisi yeniden yerleşmez (geri dön → yeniden yerleş döngüsü olmaz).
    #[serde(default, rename = "reddedilenSurum", skip_serializing_if = "Option::is_none")]
    pub refused: Option<String>,
    /// W1b: yer değiştirmenin iki ucu (yol + özet) — geri dönüş ve `onar` yalnız özeti tutan ikiliyi kullanır.
    #[serde(default, rename = "eskiYol", skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    #[serde(default, rename = "eskiOzet", skip_serializing_if = "Option::is_none")]
    pub old_digest: Option<String>,
    #[serde(default, rename = "yeniYol", skip_serializing_if = "Option::is_none")]
    pub new_path: Option<String>,
    #[serde(default, rename = "yeniOzet", skip_serializing_if = "Option::is_none")]
    pub new_digest: Option<String>,
    /// Hizmetin son sağlıklı turu koşturan ikilisinin özeti (`onar`: bu özetteki dosya geçerlidir).
    #[serde(default, rename = "calisanOzet", skip_serializing_if = "Option::is_none")]
    pub running_digest: Option<String>,
    /// Windows onarım görevinin gösterdiği ikilinin (imzalı listeyle doğrulanmış) özeti — `onar`ın ucuz kendi ölçümü.
    #[serde(default, rename = "onariciOzet", skip_serializing_if = "Option::is_none")]
    pub repairer_digest: Option<String>,
}

pub const MAX_UNVERIFIED_BOOTS: u32 = 3;

/// Güncelleyici hizmetinin SCM kurtarma gecikmeleri (sn) — `hizmet-kur` kaydı ve açılıştaki uyum AYNI diziden;
/// `guncelleyici-hizmeti.ps1` ölçümü 1/10000,1/10000,1/30000 bekler. Düşen güncelleyici ikinci denemede de 10 sn'de döner.
pub const RESTART_DELAYS_S: [u64; 3] = [10, 10, 30];

/// SCM'in `SC_ACTION_RESTART` türü.
const SC_ACTION_RESTART: i32 = 1;

/// Kayıtlı kurtarma (`actions`: SC_ACTION türü + gecikme ms; `reset_s`: `None` = hiç sıfırlanmaz) istenenden
/// farklıysa farkın metni, uyumluysa `None`.
pub fn recovery_drift(actions: &[(i32, u64)], reset_s: Option<u64>, non_crash: bool) -> Option<String> {
    let want: Vec<(i32, u64)> = RESTART_DELAYS_S.iter().map(|s| (SC_ACTION_RESTART, s * 1000)).collect();
    let mut diff = Vec::new();
    if actions != want.as_slice() {
        let seen: Vec<String> = actions.iter().map(|(t, ms)| format!("{t}/{ms}")).collect();
        diff.push(format!("eylemler '{}'", seen.join(",")));
    }
    if reset_s != Some(contract::RECOVERY_RESET_S) {
        diff.push(format!("sıfırlama {}", reset_s.map_or_else(|| "yok".to_string(), |s| format!("{s} sn"))));
    }
    if !non_crash {
        diff.push("çökmesiz hata kurtarması kapalı".to_string());
    }
    (!diff.is_empty()).then(|| diff.join(", "))
}

pub fn sibling(exe: &Path, tag: &str) -> PathBuf {
    let stem = exe.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = exe.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    exe.with_file_name(format!("{stem}.{tag}{ext}"))
}

pub fn read(env: &Env, layout: &Layout) -> Option<SelfState> {
    env.fs.read(&layout.self_update_file()).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn write(env: &Env, layout: &Layout, s: &SelfState) -> std::io::Result<()> {
    env.fs.write_atomic(&layout.self_update_file(), &serde_json::to_vec_pretty(s).map_err(std::io::Error::other)?)
}

pub(crate) fn digest(env: &Env, p: &Path) -> Option<String> {
    package::file_digest(env.fs.as_ref(), p).ok()
}

fn surumlu(env: &Env) -> bool {
    env.arka.kendi.yerlesim() == KendiYerlesim::SurumluYol
}

fn path_text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Asıl ad: `<Kök>/guncelleyici/<platformun ikili adı>` (L-A'da hizmetin çalıştırdığı yol, W-A'da kurulumun yolu).
pub fn asil_ad_path(env: &Env, layout: &Layout) -> PathBuf {
    layout.updater_dir().join(env.arka.kendi.asil_ad())
}

/// Hizmetin ÇALIŞTIRACAĞI ikili: W-A'da ImagePath'in ikilisi, L-A'da asıl ad.
pub fn service_exe(env: &Env, layout: &Layout) -> Result<PathBuf, String> {
    if !surumlu(env) {
        return Ok(asil_ad_path(env, layout));
    }
    let command = env.svc.image_path(&layout.updater_service).map_err(|e| format!("hizmet komut satırı okunamadı: {e}"))?;
    env.arka.kendi.komut_ikilisi(&command).ok_or_else(|| format!("hizmet komut satırı çözülemedi: {command}"))
}

/// Son bilinen iyinin yeri: asıl adın yanı. W-A'da çalışan ikili `s\<sürüm>\` altındadır, `.lkg` yine asıl adın yanında.
pub fn lkg_path(env: &Env, layout: &Layout, own_exe: &Path) -> PathBuf {
    let anchor = if surumlu(env) { layout.updater_dir().join(own_exe.file_name().unwrap_or_default()) } else { own_exe.to_path_buf() };
    sibling(&anchor, "lkg")
}

/// W-A: sürümün ikili yolu `guncelleyici\s\<sürüm>\<ad>`.
fn versioned_exe(layout: &Layout, version: &str, own_exe: &Path) -> PathBuf {
    layout.updater_versions().join(version).join(own_exe.file_name().unwrap_or_default())
}

/// W-A: hizmetin ImagePath'ini `exe`ye çevirir (TEK kayıt yazımı; argümanlar aynen). `expect_current` verilmişse kayıt
/// önce onu göstermeli — başka bir ikiliyi gösteren kayda (başka kurulum, elle değiştirilmiş) dokunulmaz.
pub(crate) fn point_service(env: &Env, layout: &Layout, exe: &Path, expect_current: Option<&Path>) -> Result<(), String> {
    let name = &layout.updater_service;
    let command = env.svc.image_path(name).map_err(|e| format!("{name} komut satırı okunamadı: {e}"))?;
    if let Some(cur) = expect_current {
        let shown = env.arka.kendi.komut_ikilisi(&command);
        if !shown.as_deref().is_some_and(|s| crate::platform::same_path(s, cur)) {
            return Err(format!("{name} kaydı çalışan ikiliyi göstermiyor ({command}) — kayda dokunulmadı"));
        }
    }
    let new = env.arka.kendi.ikiliyi_degistir(&command, exe).ok_or_else(|| format!("{name} komut satırı kurulamadı ({command})"))?;
    env.svc.set_image_path(name, &new).map_err(|e| format!("{name} komut satırı yazılamadı: {e}"))
}

/// Hizmeti doğrulanmış `replacement`a çevirir. L-A: çalışan önce `.bozuk`a KOPYALANIR (tanı), `replacement` asıl adın
/// üzerine tek yeniden adlandırmayla iner — asıl ad hiçbir an boş kalmaz. W-A: ImagePath `replacement`ı gösterir.
fn swap_in(env: &Env, layout: &Layout, own_exe: &Path, replacement: &Path) -> bool {
    if surumlu(env) {
        return point_service(env, layout, replacement, None).is_ok();
    }
    let broken = sibling(own_exe, "bozuk");
    let _ = env.fs.remove_file(&broken);
    let _ = env.fs.copy(own_exe, &broken);
    env.fs.rename(replacement, own_exe).is_ok()
}

/// Yer değiştirmeden beri duran eski ikili (W-A: kayıtlı eski yol; L-A: `.eski`).
fn old_binary(env: &Env, own_exe: &Path, s: &SelfState) -> PathBuf {
    match (&s.old_path, surumlu(env)) {
        (Some(p), true) => PathBuf::from(p),
        _ => sibling(own_exe, "eski"),
    }
}

/// `want` biliniyorsa (W1b sonrası durum) dosyanın özeti tutmalı; W1 öncesi durumda özet yoktu (eski davranış).
fn digest_ok(env: &Env, p: &Path, want: Option<&str>) -> bool {
    env.fs.exists(p) && want.is_none_or(|w| digest(env, p).as_deref() == Some(w))
}

/// Geri dönüş: yer değiştirmeden beri duran eski ikili (özeti tutarsa), yoksa özeti tutan `.lkg`ın KOPYASI (son bilinen
/// iyi yerinde kalır). Dönülen sürüm, `None` = dönülecek doğrulanmış ikili yok (çalışan yerinde kalır).
fn revert(env: &Env, layout: &Layout, own_exe: &Path, s: &mut SelfState) -> Option<String> {
    let old = old_binary(env, own_exe, s);
    let (replacement, version) = if digest_ok(env, &old, s.old_digest.as_deref()) && old != own_exe {
        (old, s.old_version.clone())
    } else {
        let lkg = lkg_path(env, layout, own_exe);
        let (want, version) = (s.lkg_digest.clone()?, s.lkg_version.clone()?);
        if version == s.new_version || digest(env, &lkg).as_deref() != Some(want.as_str()) {
            return None;
        }
        let copy = if surumlu(env) { versioned_exe(layout, &version, own_exe) } else { sibling(own_exe, "geri") };
        if digest(env, &copy).as_deref() != Some(want.as_str()) {
            if let Some(d) = copy.parent() {
                let _ = env.fs.create_dir_all(d);
            }
            if env.fs.copy(&lkg, &copy).is_err() || digest(env, &copy).as_deref() != Some(want.as_str()) {
                let _ = env.fs.remove_file(&copy);
                return None;
            }
        }
        (copy, version)
    };
    if !swap_in(env, layout, own_exe, &replacement) {
        return None;
    }
    s.refused = Some(s.new_version.clone());
    s.durum = "GERI_ALINDI".into();
    s.proven = false;
    s.zaman = timefmt::iso_millis(env.clock.now_ms());
    let _ = write(env, layout, s);
    Some(version)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Startup {
    Continue,
    /// Yeni ikili doğrulanamadı, eskisi geri kondu — hizmet çıkmalı ki SCM eskisini başlatsın.
    RevertedRestart,
}

/// W-A: `s\` altında `keep` dışındaki sürüm dizinlerini budar (çalışan ve eski ikili dışında hiçbir şey kalmaz).
fn prune_versions(env: &Env, layout: &Layout, keep: &[&Path]) {
    let root = layout.updater_versions();
    let Ok(names) = env.fs.list(&root) else { return };
    for n in names {
        let d = root.join(&n);
        if keep.iter().any(|k| k.parent().is_some_and(|p| crate::platform::same_path(p, &d))) {
            continue;
        }
        let _ = env.fs.remove_dir_all(&d);
    }
}

/// Açılışta İLK iş (başka hiçbir şeyden önce): yeni ikili mi çalışıyor, açılış sayacı aşıldı mı.
pub fn on_startup(env: &Env, layout: &Layout, own_exe: &Path, own_version: &str) -> Startup {
    let Some(mut s) = read(env, layout) else { return Startup::Continue };
    if !matches!(s.durum.as_str(), "HAZIRLANDI" | "YER_DEGISTIRILDI") {
        return Startup::Continue;
    }
    if own_version != s.new_version {
        // Eski ikili çalışıyor: değişim hiç olmadı (yer değiştirmeden önce kesildi) — artık temizlenir.
        let _ = env.fs.remove_file(&sibling(own_exe, "yeni"));
        if surumlu(env) {
            prune_versions(env, layout, &[own_exe]);
        }
        s.durum = "GERI_ALINDI".into();
        s.zaman = timefmt::iso_millis(env.clock.now_ms());
        let _ = write(env, layout, &s);
        return Startup::Continue;
    }
    s.durum = "YER_DEGISTIRILDI".into();
    s.boots += 1;
    s.zaman = timefmt::iso_millis(env.clock.now_ms());
    let _ = write(env, layout, &s);
    if s.boots > MAX_UNVERIFIED_BOOTS && revert(env, layout, own_exe, &mut s).is_some() {
        return Startup::RevertedRestart;
    }
    Startup::Continue
}

/// İlk SAĞLIKLI turdan sonra (ölçüt motorda: kilit · günlük · kira/HAK · karar · `durum.json`): yeni ikili doğrulandı.
/// Eski ikili silinmez — son bilinen iyi yoksa o olur; varsa (kanıtlanmış daha eski ikili) eski silinir/budanır.
pub fn mark_healthy(env: &Env, layout: &Layout, own_exe: &Path, own_version: &str) {
    let Some(mut s) = read(env, layout) else { return };
    if s.durum != "YER_DEGISTIRILDI" || s.new_version != own_version {
        return;
    }
    let old = old_binary(env, own_exe, &s);
    let lkg = lkg_path(env, layout, own_exe);
    let has_lkg = s.lkg_version.is_some() && env.fs.exists(&lkg);
    let old_ok = digest_ok(env, &old, s.old_digest.as_deref()) && old != own_exe;
    if !has_lkg && old_ok {
        // W-A'da eski ikili kurulumun dosyası olabilir (asıl ad): taşınmaz, kopyalanır.
        let placed = if surumlu(env) { env.fs.copy(&old, &lkg) } else { env.fs.rename(&old, &lkg) };
        if placed.is_ok() {
            s.lkg_version = Some(s.old_version.clone());
            s.lkg_digest = digest(env, &lkg);
        }
    } else if !surumlu(env) {
        let _ = env.fs.remove_file(&old);
    }
    if surumlu(env) {
        prune_versions(env, layout, &[own_exe]);
    }
    s.durum = "DOGRULANDI".into();
    s.zaman = timefmt::iso_millis(env.clock.now_ms());
    let _ = write(env, layout, &s);
}

/// Her süreçte İLK sağlıklı turda (motor): yeni ikilinin doğrulanması (`mark_healthy`) + `onar`ın ölçüsü — hizmetin
/// çalıştırdığı ikilinin özeti `calisanOzet`e iner; hiç son bilinen iyi yoksa (kurulum ikilisi, ya da `.lkg` silinmiş/
/// bozulmuş) çalışan ikili onun KOPYASI olur. Onarım tavanı kanıtlı turla kalkar (`onarim::kanitli_tur`).
pub fn on_healthy(env: &Env, layout: &Layout, own_exe: &Path, own_version: &str) {
    mark_healthy(env, layout, own_exe, own_version);
    crate::onarim::kanitli_tur(env, layout);
    let Some(own) = digest(env, own_exe) else { return };
    let now = timefmt::iso_millis(env.clock.now_ms());
    let mut s = read(env, layout).unwrap_or_else(|| SelfState {
        durum: "KURULUM".into(),
        old_version: own_version.into(),
        new_version: own_version.into(),
        zaman: now.clone(),
        ..SelfState::default()
    });
    let lkg = lkg_path(env, layout, own_exe);
    let lkg_ok = s.lkg_digest.is_some() && digest(env, &lkg) == s.lkg_digest;
    let mut changed = s.running_digest.as_deref() != Some(own.as_str());
    s.running_digest = Some(own.clone());
    if !lkg_ok {
        if env.fs.copy(own_exe, &lkg).is_ok() && digest(env, &lkg).as_deref() == Some(own.as_str()) {
            s.lkg_version = Some(own_version.into());
            s.lkg_digest = Some(own);
        } else {
            let _ = env.fs.remove_file(&lkg);
            s.lkg_version = None;
            s.lkg_digest = None;
        }
        changed = true;
    }
    if changed {
        s.zaman = now;
        let _ = write(env, layout, &s);
    }
}

/// Onarım görevinin onarıcısının özeti (`onariciOzet`; yalnız farklıysa yazar).
pub fn remember_repairer(env: &Env, layout: &Layout, digest: &str) {
    let Some(mut s) = read(env, layout) else { return };
    if s.repairer_digest.as_deref() != Some(digest) {
        s.repairer_digest = Some(digest.to_string());
        let _ = write(env, layout, &s);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AfterAttempt {
    Nothing,
    /// Kanıtlanmamış yeni ikili HATA ile bitirdi, son bilinen iyi (sürümü) hizmete kondu — hizmet çıkmalı.
    Reverted(String),
}

/// Bir backend denemesi bitti (`proven` = BASARILI ya da GERI_DONDU; `false` = HATA). Kanıt: çalışan ikili `.lkg`ye
/// kopyalanır (özeti kendi.json'a). HATA: çalışan ikili kendini güncellemeyle gelmiş ve henüz kanıtlanmamışsa son bilinen
/// iyiye döner (işlemi o sürdürür; günlük biçimi ortak).
pub fn after_attempt(env: &Env, layout: &Layout, own_exe: &Path, own_version: &str, proven: bool) -> AfterAttempt {
    let now = timefmt::iso_millis(env.clock.now_ms());
    let read_state = read(env, layout);
    let fresh_install = read_state.is_none();
    let mut s = read_state.unwrap_or_else(|| SelfState {
        durum: "DOGRULANDI".into(),
        old_version: own_version.into(),
        new_version: own_version.into(),
        zaman: now.clone(),
        ..SelfState::default()
    });
    if !proven {
        let unproven_new =
            !fresh_install && s.new_version == own_version && !s.proven && matches!(s.durum.as_str(), "YER_DEGISTIRILDI" | "DOGRULANDI");
        return match unproven_new.then(|| revert(env, layout, own_exe, &mut s)).flatten() {
            Some(v) => AfterAttempt::Reverted(v),
            None => AfterAttempt::Nothing,
        };
    }
    let lkg = lkg_path(env, layout, own_exe);
    let Some(own) = digest(env, own_exe) else { return AfterAttempt::Nothing };
    let current = s.lkg_version.as_deref() == Some(own_version) && digest(env, &lkg).as_deref() == Some(own.as_str());
    if !current {
        // Kopya geçici dosya + yeniden adlandırmayla iner: yarıda ölüm eski `.lkg`yi bozmaz.
        if env.fs.copy(own_exe, &lkg).is_err() {
            return AfterAttempt::Nothing;
        }
        if digest(env, &lkg).as_deref() == Some(own.as_str()) {
            s.lkg_version = Some(own_version.into());
            s.lkg_digest = Some(own);
        } else {
            let _ = env.fs.remove_file(&lkg);
            s.lkg_version = None;
            s.lkg_digest = None;
        }
    }
    if s.new_version == own_version {
        s.proven = true;
    }
    s.zaman = now;
    let _ = write(env, layout, &s);
    AfterAttempt::Nothing
}

/// Paketteki ikili daha yeniyse yerleştirir; `true` = hizmet yeniden başlamalı. `trust` = kurulumun PAKET güveni,
/// YERLEŞİK kip (kurulu dizin; backend paketini doğrulayan kümeyle aynı).
pub fn stage(env: &Env, layout: &Layout, own_exe: &Path, current_dir: &Path, trust: &PackageTrust) -> Result<bool, String> {
    stage_with_version(env, layout, own_exe, current_dir, env!("CARGO_PKG_VERSION"), trust)
}

pub fn stage_with_version(
    env: &Env,
    layout: &Layout,
    own_exe: &Path,
    current_dir: &Path,
    own_version: &str,
    trust: &PackageTrust,
) -> Result<bool, String> {
    stage_from(env, layout, own_exe, own_version, current_dir, trust, None).map(|v| v.is_some())
}

/// `source_dir`in (imzalı listesi doğrulanan sürüm dizini) güncelleyicisi daha yeniyse yerleştirir; `Some(yeni sürüm)` =
/// hizmet yeniden başlamalı. `announced` = imzalı bildirimin `guncelleyici` bloğu: verilmişse künye sürümü ve ikilinin
/// özeti ondan sapamaz (yayıncı bloğu ikiliden ölçer — iki imzalı kaynak aynı baytı göstermeli).
pub fn stage_from(
    env: &Env,
    layout: &Layout,
    own_exe: &Path,
    own_version: &str,
    source_dir: &Path,
    trust: &PackageTrust,
    announced: Option<&ReleaseUpdater>,
) -> Result<Option<String>, String> {
    // Paketteki yer arka ucun beyanıdır (Windows `runtime/…exe`, Linux paket kökünde `.exe`siz).
    let rel = env.arka.guncelleyici_paket_yolu;
    let candidate = rel.split('/').fold(source_dir.to_path_buf(), |p, c| p.join(c));
    if !env.fs.exists(&candidate) {
        return Ok(None);
    }
    // Çalışanla bayt bayt aynı: yapılacak iş yok (hiçbir şey çalıştırılmaz, listeyi doğrulamak gerekmez).
    let own_digest = digest(env, own_exe);
    if digest(env, &candidate).is_some_and(|c| own_digest.as_deref() == Some(c.as_str())) {
        return Ok(None);
    }
    let want = package::signed_file_digest(source_dir, env.fs.as_ref(), trust, rel)
        .map_err(|e| format!("paketteki ikili imzalı listeyle doğrulanamadı ({}): {}", e.code, e.message))?;
    if own_digest.as_deref() == Some(want.as_str()) {
        return Ok(None);
    }
    if let Some(a) = announced {
        if !same_sha256(&want, &a.sha256) {
            return Err(format!("paketteki ikilinin özeti imzalı bildirimin guncelleyici.sha256'sıyla uyuşmuyor ({})", a.sha256));
        }
    }
    let fresh = sibling(own_exe, "yeni");
    env.fs.copy(&candidate, &fresh).map_err(|e| format!("yeni ikili kopyalanamadı: {e}"))?;
    // Çalıştırılacak olan KOPYA: özeti imzalı listeyle tutmadan künyesi bile alınmaz.
    if package::file_digest(env.fs.as_ref(), &fresh).map_err(|e| e.to_string())? != want {
        let _ = env.fs.remove_file(&fresh);
        return Err("kopyalanan ikili imzalı listeyle uyuşmuyor".into());
    }
    let id = tools::identity_of(env, &fresh)?;
    let new_version = id.get("surum").and_then(|v| v.as_str()).map(str::to_string);
    let discard = |why: String| -> Result<Option<String>, String> {
        let _ = env.fs.remove_file(&fresh);
        Err(why)
    };
    if let Err(why) = check_identity(&id) {
        return discard(why);
    }
    let Some(new_version) = new_version else { return discard("künyede sürüm yok".into()) };
    if let Some(a) = announced.filter(|a| a.surum != new_version) {
        return discard(format!("künye sürümü {new_version}, imzalı bildirim {} ilan ediyor", a.surum));
    }
    let prev = read(env, layout);
    let refused = prev.as_ref().and_then(|p| p.refused.clone());
    let not_newer = version::compare(&new_version, own_version) != Some(std::cmp::Ordering::Greater);
    let refused_again = refused.as_deref().is_some_and(|r| version::compare(&new_version, r) != Some(std::cmp::Ordering::Greater));
    if not_newer || refused_again {
        let _ = env.fs.remove_file(&fresh);
        return Ok(None);
    }
    let mut s = SelfState {
        durum: "HAZIRLANDI".into(),
        old_version: own_version.into(),
        new_version: new_version.clone(),
        zaman: timefmt::iso_millis(env.clock.now_ms()),
        lkg_version: prev.as_ref().and_then(|p| p.lkg_version.clone()),
        lkg_digest: prev.as_ref().and_then(|p| p.lkg_digest.clone()),
        refused,
        old_digest: own_digest.clone(),
        new_digest: Some(want.clone()),
        running_digest: prev.as_ref().and_then(|p| p.running_digest.clone()),
        ..SelfState::default()
    };
    if surumlu(env) {
        place_versioned(env, layout, own_exe, &fresh, &want, &mut s)?;
    } else {
        place_atomic(env, layout, own_exe, &fresh, own_digest.as_deref(), &mut s)?;
    }
    s.durum = "YER_DEGISTIRILDI".into();
    write(env, layout, &s).map_err(|e| e.to_string())?;
    Ok(Some(new_version))
}

/// Bütünlük listesinin özeti (base64url) ile bildirimin onaltılık `sha256`ı aynı baytları mı gösteriyor.
fn same_sha256(b64u: &str, hex: &str) -> bool {
    tekserp_dogrulama::b64::decode_strict(b64u)
        .is_some_and(|d| d.iter().map(|x| format!("{x:02x}")).collect::<String>().eq_ignore_ascii_case(hex))
}

/// Künyenin kimlik denetimi (ad · platform · çapa kipi) — kendini güncelleme ve `onar` adayları aynı kuralla.
pub(crate) fn check_identity(id: &serde_json::Value) -> Result<(), String> {
    if id.get("ad").and_then(|v| v.as_str()) != Some("tekserp-guncelleyici") {
        return Err("paketteki ikili güncelleyici değil".into());
    }
    let target = id.get("hedef").and_then(|v| v.as_str());
    if target != Some(OWN_TARGET) {
        return Err(format!(
            "paketteki güncelleyici {} hedefli, çalışan {OWN_TARGET} — kendini güncelleme platform DEĞİŞTİRMEZ",
            target.unwrap_or("hedefsiz")
        ));
    }
    // Güven çapası kurulumun kimliğidir: paket yanlış kipte güncelleyici taşısa da SYSTEM ikilisi kipi değiştirmez.
    let mode = id.get("capaKipi").and_then(|v| v.as_str());
    if mode != Some(trust::ANCHOR_MODE) {
        return Err(format!(
            "paketteki güncelleyici {} çapalı, kurulu olan {} — kendini güncelleme çapa kipini DEĞİŞTİRMEZ",
            mode.unwrap_or("kipsiz"),
            trust::ANCHOR_MODE
        ));
    }
    Ok(())
}

/// L-A: çalışan önce `.eski`ye KOPYALANIR (özeti tutmalı), sonra doğrulanmış kopya asıl adın ÜZERİNE tek
/// yeniden adlandırmayla iner. Hangi adımda ölünürse ölünsün asıl ad ya eski ya yeni doğrulanmış ikilidir.
fn place_atomic(
    env: &Env,
    layout: &Layout,
    own_exe: &Path,
    fresh: &Path,
    own_digest: Option<&str>,
    s: &mut SelfState,
) -> Result<(), String> {
    let old = sibling(own_exe, "eski");
    let fail = |why: String| -> Result<(), String> {
        let _ = env.fs.remove_file(fresh);
        Err(why)
    };
    let _ = env.fs.remove_file(&old);
    if let Err(e) = env.fs.copy(own_exe, &old) {
        let _ = env.fs.remove_file(&old);
        return fail(format!("çalışan ikili .eski'ye kopyalanamadı: {e}"));
    }
    if own_digest.is_none() || digest(env, &old).as_deref() != own_digest {
        let _ = env.fs.remove_file(&old);
        return fail("çalışan ikilinin .eski kopyası doğrulanamadı".into());
    }
    s.old_path = Some(path_text(&old));
    s.new_path = Some(path_text(own_exe));
    write(env, layout, s).map_err(|e| e.to_string())?;
    if let Err(e) = env.fs.rename(fresh, own_exe) {
        return fail(format!("yeni ikili yerine konamadı: {e}"));
    }
    Ok(())
}

/// W-A: doğrulanmış kopya `s\<sürüm>\`e taşınır, ImagePath TEK kayıt yazımıyla ona çevrilir; hiçbir ikili yer
/// değiştirmez. Önce `yeniYol` yazılır: kayıt yazımından hemen sonra ölünse de açılış yeni ikiliyi tanır.
fn place_versioned(env: &Env, layout: &Layout, own_exe: &Path, fresh: &Path, want: &str, s: &mut SelfState) -> Result<(), String> {
    let target = versioned_exe(layout, &s.new_version, own_exe);
    let fail = |why: String| -> Result<(), String> {
        let _ = env.fs.remove_file(fresh);
        Err(why)
    };
    if let Some(d) = target.parent() {
        if let Err(e) = env.fs.create_dir_all(d) {
            return fail(format!("{} açılamadı: {e}", d.display()));
        }
    }
    let _ = env.fs.remove_file(&target);
    if let Err(e) = env.fs.rename(fresh, &target) {
        return fail(format!("yeni ikili {} yerine konamadı: {e}", target.display()));
    }
    if digest(env, &target).as_deref() != Some(want) {
        let _ = env.fs.remove_file(&target);
        return Err("yerleşen ikili imzalı listeyle uyuşmuyor".into());
    }
    s.old_path = Some(path_text(own_exe));
    s.new_path = Some(path_text(&target));
    write(env, layout, s).map_err(|e| e.to_string())?;
    point_service(env, layout, &target, Some(own_exe))
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: i32 = SC_ACTION_RESTART;

    #[test]
    fn recovery_matching_hizmet_kur_is_left_alone() {
        assert_eq!(recovery_drift(&[(R, 10_000), (R, 10_000), (R, 30_000)], Some(86_400), true), None);
    }

    #[test]
    fn old_10_30_60_recovery_is_drift() {
        // 0.1.0'ın kaydı (sahada onarımsız kalan): kendini güncelleyen ikili bunu düzeltmeli.
        let d = recovery_drift(&[(R, 10_000), (R, 30_000), (R, 60_000)], Some(86_400), true).expect("fark");
        assert!(d.contains("1/10000,1/30000,1/60000"), "{d}");
    }

    #[test]
    fn missing_reset_non_crash_or_action_type_is_drift() {
        assert!(recovery_drift(&[(R, 10_000), (R, 10_000), (R, 30_000)], None, true).is_some_and(|d| d.contains("sıfırlama yok")));
        assert!(recovery_drift(&[(R, 10_000), (R, 10_000), (R, 30_000)], Some(86_400), false).is_some_and(|d| d.contains("çökmesiz")));
        assert!(recovery_drift(&[(R, 10_000), (R, 10_000), (0, 30_000)], Some(86_400), true).is_some());
        assert!(recovery_drift(&[], Some(86_400), true).is_some());
    }
}
