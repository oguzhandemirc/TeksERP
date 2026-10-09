//! Kendini güncelleme (§10, plan `GUNCELLEYICI-SAGLAMLIK.md` §4.2): paket güncelleyici ikilisini taşır (yeri arka ucun
//! `guncelleyici_paket_yolu`; Linux'ta `.exe`siz, yan adlar `.yeni`/`.eski`/`.lkg`);
//! kaynak sürüm dizini (önce-güncelleyicide hazırlanmış ADAY dizini, backend BASARILI sonrası kurulu dizin) imzalı
//! listeyle doğrulanır, ikili yan dosyaya (`.yeni.exe`) kopyalanır ve KOPYANIN özeti imzalı listedekiyle tutmadan
//! HİÇBİR ikili çalıştırılmaz (DAGK-3); künye kopyadan alınır (ad · platform · sürüm · çapa kipi). Çalışan ikili
//! `.eski.exe`ye ve yeni ikili asıl ada yeniden adlandırılır, hizmet `EXIT_SELF_UPDATE` ile çıkar, hizmet yöneticisi
//! yeni ikiliyle başlatır. Yeni ikili İLK iş olarak açılış sayacını artırır: doğrulanmadan 3. açılışı aşarsa geri döner.
//! Son bilinen iyi (`.lkg.exe`): ilk sağlıklı turda `.eski.exe` silinmez, son bilinen iyi yoksa o olur; bir backend
//! denemesini BASARILI/GERI_DONDU bitiren ikili kendini `.lkg.exe`ye kopyalar; HATA ile biten İLK denemede
//! (henüz kanıtlanmamış yeni ikili) son bilinen iyiye dönülür. Geri alınan sürüm (ve eskisi) yeniden yerleşmez.
//! Hizmet her açılışta kendi SCM kurtarmasını `RESTART_DELAYS_S`e getirir (yalnız farklıysa yazar): kurtarma
//! ayarı kendini güncellemeyle sahaya gider, onarım beklemez.
use crate::env::Env;
use crate::layout::Layout;
use crate::package;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelfState {
    /// `HAZIRLANDI` · `YER_DEGISTIRILDI` · `DOGRULANDI` · `GERI_ALINDI`
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

fn digest(env: &Env, p: &Path) -> Option<String> {
    package::file_digest(env.fs.as_ref(), p).ok()
}

/// Çalışanı `.bozuk`a, yerineyi asıl ada koyar; ikincisi düşerse çalışan geri konur (asıl ad boş kalmaz).
fn swap_in(env: &Env, own_exe: &Path, replacement: &Path) -> bool {
    let broken = sibling(own_exe, "bozuk");
    let _ = env.fs.remove_file(&broken);
    if env.fs.rename(own_exe, &broken).is_err() {
        return false;
    }
    if env.fs.rename(replacement, own_exe).is_err() {
        let _ = env.fs.rename(&broken, own_exe);
        return false;
    }
    true
}

/// Geri dönüş: yer değiştirmeden beri duran `.eski`, yoksa özeti tutan `.lkg`ın KOPYASI (son bilinen iyi yerinde kalır).
/// Dönülen sürüm, `None` = dönülecek doğrulanmış ikili yok (çalışan yerinde kalır).
fn revert(env: &Env, layout: &Layout, own_exe: &Path, s: &mut SelfState) -> Option<String> {
    let old = sibling(own_exe, "eski");
    let (replacement, version) = if env.fs.exists(&old) {
        (old, s.old_version.clone())
    } else {
        let lkg = sibling(own_exe, "lkg");
        let (want, version) = (s.lkg_digest.clone()?, s.lkg_version.clone()?);
        if version == s.new_version || digest(env, &lkg).as_deref() != Some(want.as_str()) {
            return None;
        }
        let copy = sibling(own_exe, "geri");
        if env.fs.copy(&lkg, &copy).is_err() || digest(env, &copy).as_deref() != Some(want.as_str()) {
            let _ = env.fs.remove_file(&copy);
            return None;
        }
        (copy, version)
    };
    if !swap_in(env, own_exe, &replacement) {
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

/// Açılışta İLK iş (başka hiçbir şeyden önce): yeni ikili mi çalışıyor, açılış sayacı aşıldı mı.
pub fn on_startup(env: &Env, layout: &Layout, own_exe: &Path, own_version: &str) -> Startup {
    let Some(mut s) = read(env, layout) else { return Startup::Continue };
    if !matches!(s.durum.as_str(), "HAZIRLANDI" | "YER_DEGISTIRILDI") {
        return Startup::Continue;
    }
    let fresh = sibling(own_exe, "yeni");
    if own_version != s.new_version {
        // Eski ikili çalışıyor: değişim hiç olmadı (yeniden adlandırmadan önce kesildi) — artık temizlenir.
        let _ = env.fs.remove_file(&fresh);
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
/// `.eski` silinmez — son bilinen iyi yoksa o olur; varsa (kanıtlanmış daha eski ikili) `.eski` silinir.
pub fn mark_healthy(env: &Env, layout: &Layout, own_exe: &Path, own_version: &str) {
    let Some(mut s) = read(env, layout) else { return };
    if s.durum != "YER_DEGISTIRILDI" || s.new_version != own_version {
        return;
    }
    let old = sibling(own_exe, "eski");
    let lkg = sibling(own_exe, "lkg");
    let has_lkg = s.lkg_version.is_some() && env.fs.exists(&lkg);
    if !has_lkg && env.fs.exists(&old) && env.fs.rename(&old, &lkg).is_ok() {
        s.lkg_version = Some(s.old_version.clone());
        s.lkg_digest = digest(env, &lkg);
    } else {
        let _ = env.fs.remove_file(&old);
    }
    s.durum = "DOGRULANDI".into();
    s.zaman = timefmt::iso_millis(env.clock.now_ms());
    let _ = write(env, layout, &s);
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AfterAttempt {
    Nothing,
    /// Kanıtlanmamış yeni ikili HATA ile bitirdi, son bilinen iyi (sürümü) asıl ada kondu — hizmet çıkmalı.
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
        boots: 0,
        zaman: now.clone(),
        proven: false,
        lkg_version: None,
        lkg_digest: None,
        refused: None,
    });
    if !proven {
        let unproven_new =
            !fresh_install && s.new_version == own_version && !s.proven && matches!(s.durum.as_str(), "YER_DEGISTIRILDI" | "DOGRULANDI");
        return match unproven_new.then(|| revert(env, layout, own_exe, &mut s)).flatten() {
            Some(v) => AfterAttempt::Reverted(v),
            None => AfterAttempt::Nothing,
        };
    }
    let lkg = sibling(own_exe, "lkg");
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
/// hizmet yeniden başlamalı. `announced` = imzalı bildirimin `guncelleyici.surum`u: verilmişse künye ondan sapamaz.
pub fn stage_from(
    env: &Env,
    layout: &Layout,
    own_exe: &Path,
    own_version: &str,
    source_dir: &Path,
    trust: &PackageTrust,
    announced: Option<&str>,
) -> Result<Option<String>, String> {
    // Paketteki yer arka ucun beyanıdır (Windows `runtime/…exe`, Linux paket kökünde `.exe`siz).
    let rel = env.arka.guncelleyici_paket_yolu;
    let candidate = rel.split('/').fold(source_dir.to_path_buf(), |p, c| p.join(c));
    if !env.fs.exists(&candidate) {
        return Ok(None);
    }
    // Çalışanla bayt bayt aynı: yapılacak iş yok (hiçbir şey çalıştırılmaz, listeyi doğrulamak gerekmez).
    if digest(env, &candidate).is_some_and(|c| digest(env, own_exe).as_deref() == Some(c.as_str())) {
        return Ok(None);
    }
    let want = package::signed_file_digest(source_dir, env.fs.as_ref(), trust, rel)
        .map_err(|e| format!("paketteki ikili imzalı listeyle doğrulanamadı ({}): {}", e.code, e.message))?;
    if package::file_digest(env.fs.as_ref(), own_exe).is_ok_and(|own| own == want) {
        return Ok(None);
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
    if id.get("ad").and_then(|v| v.as_str()) != Some("tekserp-guncelleyici") {
        return discard("paketteki ikili güncelleyici değil".into());
    }
    let target = id.get("hedef").and_then(|v| v.as_str());
    if target != Some(OWN_TARGET) {
        return discard(format!(
            "paketteki güncelleyici {} hedefli, çalışan {OWN_TARGET} — kendini güncelleme platform DEĞİŞTİRMEZ",
            target.unwrap_or("hedefsiz")
        ));
    }
    let Some(new_version) = new_version else { return discard("künyede sürüm yok".into()) };
    if announced.is_some_and(|a| a != new_version) {
        return discard(format!("künye sürümü {new_version}, imzalı bildirim {} ilan ediyor", announced.unwrap_or_default()));
    }
    let prev = read(env, layout);
    let refused = prev.as_ref().and_then(|p| p.refused.clone());
    let not_newer = version::compare(&new_version, own_version) != Some(std::cmp::Ordering::Greater);
    let refused_again = refused.as_deref().is_some_and(|r| version::compare(&new_version, r) != Some(std::cmp::Ordering::Greater));
    if not_newer || refused_again {
        let _ = env.fs.remove_file(&fresh);
        return Ok(None);
    }
    // Güven çapası kurulumun kimliğidir: paket yanlış kipte güncelleyici taşısa da SYSTEM ikilisi kipi değiştirmez.
    let mode = id.get("capaKipi").and_then(|v| v.as_str());
    if mode != Some(trust::ANCHOR_MODE) {
        return discard(format!(
            "paketteki güncelleyici {} çapalı, kurulu olan {} — kendini güncelleme çapa kipini DEĞİŞTİRMEZ",
            mode.unwrap_or("kipsiz"),
            trust::ANCHOR_MODE
        ));
    }
    let mut s = SelfState {
        durum: "HAZIRLANDI".into(),
        old_version: own_version.into(),
        new_version: new_version.clone(),
        boots: 0,
        zaman: timefmt::iso_millis(env.clock.now_ms()),
        proven: false,
        lkg_version: prev.as_ref().and_then(|p| p.lkg_version.clone()),
        lkg_digest: prev.as_ref().and_then(|p| p.lkg_digest.clone()),
        refused,
    };
    write(env, layout, &s).map_err(|e| e.to_string())?;
    let old = sibling(own_exe, "eski");
    let _ = env.fs.remove_file(&old);
    env.fs.rename(own_exe, &old).map_err(|e| format!("çalışan ikili yeniden adlandırılamadı: {e}"))?;
    if let Err(e) = env.fs.rename(&fresh, own_exe) {
        // Asıl ad boş kalmasın: eskisi hemen geri konur.
        let _ = env.fs.rename(&old, own_exe);
        return Err(format!("yeni ikili yerine konamadı: {e}"));
    }
    s.durum = "YER_DEGISTIRILDI".into();
    write(env, layout, &s).map_err(|e| e.to_string())?;
    Ok(Some(new_version))
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
