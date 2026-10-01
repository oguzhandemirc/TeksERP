//! Kendini güncelleme (§10): paket `runtime\tekserp-guncelleyici.exe` taşır; backend işlemi BAŞARILI
//! olunca kurulu sürüm dizini imzalı listeyle doğrulanır, ikili yan dosyaya (`.yeni.exe`) kopyalanır ve
//! KOPYANIN özeti imzalı listedekiyle tutmadan HİÇBİR ikili çalıştırılmaz (DAGK-3); künye kopyadan
//! alınır, daha yeni değilse kopya silinir. Çalışan ikili
//! `.eski.exe`ye ve yeni ikili asıl ada yeniden adlandırılır (çalışan exe yeniden adlandırılabilir),
//! hizmet `EXIT_SELF_UPDATE` ile çıkar, SCM kurtarması yeni ikiliyle başlatır. Yeni ikili İLK iş
//! olarak açılış sayacını artırır: doğrulanmadan 3. açılışı aşarsa `.eski.exe`yi geri koyar (A/B).
use crate::env::Env;
use crate::layout::Layout;
use crate::package;
use crate::tools;
use crate::trust;
use crate::version;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tekserp_hizmet::contract;
use tekserp_hizmet::timefmt;

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
}

pub const MAX_UNVERIFIED_BOOTS: u32 = 3;

fn sibling(exe: &Path, tag: &str) -> PathBuf {
    let stem = exe.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = exe.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    exe.with_file_name(format!("{stem}.{tag}{ext}"))
}

fn read(env: &Env, layout: &Layout) -> Option<SelfState> {
    env.fs.read(&layout.self_update_file()).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn write(env: &Env, layout: &Layout, s: &SelfState) -> std::io::Result<()> {
    env.fs.write_atomic(&layout.self_update_file(), &serde_json::to_vec_pretty(s).map_err(std::io::Error::other)?)
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
    let old = sibling(own_exe, "eski");
    if s.boots > MAX_UNVERIFIED_BOOTS && env.fs.exists(&old) {
        let broken = sibling(own_exe, "bozuk");
        let _ = env.fs.remove_file(&broken);
        if env.fs.rename(own_exe, &broken).is_ok() && env.fs.rename(&old, own_exe).is_ok() {
            s.durum = "GERI_ALINDI".into();
            let _ = write(env, layout, &s);
            return Startup::RevertedRestart;
        }
    }
    Startup::Continue
}

/// İlk sağlıklı turdan sonra: yeni ikili doğrulandı, `.eski.exe` silinir.
pub fn mark_healthy(env: &Env, layout: &Layout, own_exe: &Path, own_version: &str) {
    if let Some(mut s) = read(env, layout) {
        if s.durum == "YER_DEGISTIRILDI" && s.new_version == own_version {
            let _ = env.fs.remove_file(&sibling(own_exe, "eski"));
            s.durum = "DOGRULANDI".into();
            s.zaman = timefmt::iso_millis(env.clock.now_ms());
            let _ = write(env, layout, &s);
        }
    }
}

/// Paketteki ikili daha yeniyse yerleştirir; `true` = hizmet yeniden başlamalı. `keys` = kurulumun
/// PAKET anahtar kümesi (backend paketini doğrulayanla aynı).
pub fn stage(env: &Env, layout: &Layout, own_exe: &Path, current_dir: &Path, keys: &[(String, String)]) -> Result<bool, String> {
    stage_with_version(env, layout, own_exe, current_dir, env!("CARGO_PKG_VERSION"), keys)
}

pub fn stage_with_version(
    env: &Env,
    layout: &Layout,
    own_exe: &Path,
    current_dir: &Path,
    own_version: &str,
    keys: &[(String, String)],
) -> Result<bool, String> {
    let candidate = current_dir.join(contract::path::RUNTIME).join(contract::path::UPDATER_EXE);
    if !env.fs.exists(&candidate) {
        return Ok(false);
    }
    let rel = format!("{}/{}", contract::path::RUNTIME, contract::path::UPDATER_EXE);
    let want = package::signed_file_digest(current_dir, env.fs.as_ref(), keys, &rel)
        .map_err(|e| format!("paketteki ikili imzalı listeyle doğrulanamadı ({}): {}", e.code, e.message))?;
    if package::file_digest(env.fs.as_ref(), own_exe).is_ok_and(|own| own == want) {
        return Ok(false);
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
    let discard = |why: &str| -> Result<bool, String> {
        let _ = env.fs.remove_file(&fresh);
        Err(why.to_string())
    };
    if id.get("ad").and_then(|v| v.as_str()) != Some("tekserp-guncelleyici") {
        return discard("paketteki ikili güncelleyici değil");
    }
    let Some(new_version) = new_version else { return discard("künyede sürüm yok") };
    if version::compare(&new_version, own_version) != Some(std::cmp::Ordering::Greater) {
        let _ = env.fs.remove_file(&fresh);
        return Ok(false);
    }
    // Güven çapası kurulumun kimliğidir: paket yanlış kipte güncelleyici taşısa da SYSTEM ikilisi kipi değiştirmez.
    let mode = id.get("capaKipi").and_then(|v| v.as_str());
    if mode != Some(trust::ANCHOR_MODE) {
        return discard(&format!(
            "paketteki güncelleyici {} çapalı, kurulu olan {} — kendini güncelleme çapa kipini DEĞİŞTİRMEZ",
            mode.unwrap_or("kipsiz"),
            trust::ANCHOR_MODE
        ));
    }
    let mut s = SelfState {
        durum: "HAZIRLANDI".into(),
        old_version: own_version.into(),
        new_version,
        boots: 0,
        zaman: timefmt::iso_millis(env.clock.now_ms()),
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
    Ok(true)
}
