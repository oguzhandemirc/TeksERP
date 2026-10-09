//! W-C onarım görevi (plan §4.7): Görev Zamanlayıcı'da `\TeksERP\<hizmet adı>-Onarim` — SYSTEM, açılışta (2 dk sonra)
//! ve 15 dakikada bir `<onarıcı> onar --kok … --veri … --ad …`. Onarıcı, künyesinde `"onarim":1` taşıyan ilk doğrulanmış
//! aday: `.lkg` → kurulu sürümün imzalı `runtime` ikilisi → çalışan ikili. W1 ikilisine ASLA `onar` verilmez (orada
//! `onar` = `tur`). Görevi `hizmet-kur` kurar, `hizmet-kaldir` siler, hizmet her açılışta (ve ilk sağlıklı turdan
//! sonra) hizalar — yalnız farklıysa yazar. XML üretimi ve aday seçimi her hedefte derlenir (sahte dünyada ölçülür).
use crate::env::Env;
use crate::layout::Layout;
use crate::selfupdate;
use std::path::{Path, PathBuf};
use tekserp_dogrulama::paket_zinciri::PackageTrust;

/// Onarım görevi aralığı (dakika) — W-C'nin "≤15 dk içinde" sözü.
pub const ARALIK_DK: u32 = 15;

pub fn task_name(service: &str) -> String {
    format!("\\TeksERP\\{service}-Onarim")
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Görevin argümanları (`hizmet-kur`un kaydıyla aynı kök/veri/ad).
pub fn arguments(root: &Path, data: &Path, service: &str) -> String {
    format!("onar --kok \"{}\" --veri \"{}\" --ad {service}", root.display(), data.display())
}

/// Görev tanımı (Görev Zamanlayıcı 1.2 şeması). Komut ve argümanlar XML kaçışlı.
pub fn task_xml(exe: &Path, root: &Path, data: &Path, service: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>TeksERP güncelleyici karşılıklı onarımı: {svc} hizmetinin ikilisi eksik ya da bozuksa doğrulanmış kaynaktan geri koyar.</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT2M</Delay>
    </BootTrigger>
    <TimeTrigger>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT{dk}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{cmd}</Command>
      <Arguments>{args}</Arguments>
    </Exec>
  </Actions>
</Task>
"#,
        svc = xml_escape(service),
        dk = ARALIK_DK,
        cmd = xml_escape(&command(exe)),
        args = xml_escape(&arguments(root, data, service)),
    )
}

fn xml_unescape(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">").replace("&apos;", "'").replace("&amp;", "&")
}

/// Komut alanı: yol her zaman tırnaklı (boşluklu `Program Files` yolu).
fn command(exe: &Path) -> String {
    format!("\"{}\"", exe.display())
}

/// Kayıtlı görevin XML'i istenenle aynı eylemi mi taşıyor (komut + argümanlar + aralık). Karşılaştırma kaçışsız
/// metinde: `schtasks /Query /XML` tırnakları kaçışlı ya da çıplak yazabilir.
pub fn same_action(registered: &str, exe: &Path, root: &Path, data: &Path, service: &str) -> bool {
    let r = xml_unescape(registered);
    r.contains(&format!("<Command>{}</Command>", command(exe)))
        && r.contains(&format!("<Arguments>{}</Arguments>", arguments(root, data, service)))
        && r.contains(&format!("PT{ARALIK_DK}M"))
}

fn onar_capable(env: &Env, exe: &Path) -> bool {
    crate::tools::identity_of(env, exe).is_ok_and(|id| {
        selfupdate::check_identity(&id).is_ok() && id.get("onarim").and_then(serde_json::Value::as_u64).is_some_and(|v| v >= 1)
    })
}

/// Görevin çalıştıracağı onarıcı ve özeti: künyesi `"onarim":1` taşıyan ilk DOĞRULANMIŞ aday (künyesi yalnız özeti
/// doğrulandıktan sonra alınır). Çalışan ikili bu kodu taşıdığı için son çaredir (künyesi alınmaz).
pub fn pick_target(env: &Env, layout: &Layout, own_exe: &Path, trust: Option<&PackageTrust>) -> Option<(PathBuf, String)> {
    let state = selfupdate::read(env, layout);
    let lkg = selfupdate::lkg_path(env, layout, own_exe);
    if let Some(want) = state.as_ref().and_then(|s| s.lkg_digest.clone()) {
        if selfupdate::digest(env, &lkg).as_deref() == Some(want.as_str()) && onar_capable(env, &lkg) {
            return Some((lkg, want));
        }
    }
    if let Some(t) = trust {
        if let Some((exe, want)) = crate::onarim::signed_sources(env, layout, t).into_iter().next() {
            if selfupdate::digest(env, &exe).as_deref() == Some(want.as_str()) && onar_capable(env, &exe) {
                return Some((exe, want));
            }
        }
    }
    selfupdate::digest(env, own_exe).map(|d| (own_exe.to_path_buf(), d))
}

/// Seçilen onarıcının özetini `kendi.json` `onariciOzet`e yazar (onarıcının ucuz kendi ölçümü onu tanısın).
pub fn remember(env: &Env, layout: &Layout, digest: &str) {
    selfupdate::remember_repairer(env, layout, digest);
}

#[cfg(windows)]
mod sys {
    use std::path::Path;
    use std::process::Command;

    fn decode(out: &[u8]) -> String {
        // schtasks /Query /XML çıktısı UTF-16 olabilir (BOM ya da çok sayıda NUL).
        let utf16 = out.starts_with(&[0xFF, 0xFE]) || out.iter().filter(|b| **b == 0).count() > out.len() / 4;
        if utf16 {
            let units: Vec<u16> = out.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            String::from_utf16_lossy(&units).trim_start_matches('\u{feff}').to_string()
        } else {
            String::from_utf8_lossy(out).into_owned()
        }
    }

    pub fn query(name: &str) -> Option<String> {
        let out = Command::new("schtasks").args(["/Query", "/TN", name, "/XML"]).output().ok()?;
        out.status.success().then(|| decode(&out.stdout))
    }

    pub fn create(name: &str, xml: &str, scratch: &Path) -> Result<(), String> {
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend(xml.encode_utf16().flat_map(u16::to_le_bytes));
        if let Some(d) = scratch.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        std::fs::write(scratch, bytes).map_err(|e| format!("görev tanımı yazılamadı: {e}"))?;
        let out = Command::new("schtasks").args(["/Create", "/TN", name, "/XML"]).arg(scratch).arg("/F").output();
        let _ = std::fs::remove_file(scratch);
        let out = out.map_err(|e| format!("schtasks çalıştırılamadı: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!("schtasks /Create {}: {}", out.status, decode(&out.stderr).trim()))
        }
    }

    pub fn delete(name: &str) -> Result<(), String> {
        let out = Command::new("schtasks").args(["/Delete", "/TN", name, "/F"]).output().map_err(|e| e.to_string())?;
        // Görev zaten yoksa da başarı sayılır (kaldırma tekrarlanabilir).
        if out.status.success() || query(name).is_none() {
            Ok(())
        } else {
            Err(format!("schtasks /Delete {}: {}", out.status, decode(&out.stderr).trim()))
        }
    }
}

/// Görevi `exe`yi çağıracak biçime getirir; yalnız farklıysa yazar. Dönüş: yazıldı mı.
#[cfg(windows)]
pub fn ensure(layout: &Layout, exe: &Path) -> Result<bool, String> {
    let name = task_name(&layout.updater_service);
    if sys::query(&name).is_some_and(|x| same_action(&x, exe, &layout.root, &layout.data, &layout.updater_service)) {
        return Ok(false);
    }
    let xml = task_xml(exe, &layout.root, &layout.data, &layout.updater_service);
    sys::create(&name, &xml, &layout.work().join("onarim-gorevi.xml")).map(|()| true)
}

#[cfg(windows)]
pub fn remove(service: &str) -> Result<(), String> {
    sys::delete(&task_name(service))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xml_carries_system_boot_and_interval_with_escaped_paths() {
        let exe = Path::new(r"C:\Program Files\TeksERP & Co\guncelleyici\tekserp-guncelleyici.lkg.exe");
        let root = Path::new(r"C:\Program Files\TeksERP & Co");
        let data = Path::new(r"C:\ProgramData\TeksERP");
        let x = task_xml(exe, root, data, "TeksERP-Guncelleyici");
        assert!(x.contains("<UserId>S-1-5-18</UserId>"), "SYSTEM");
        assert!(x.contains("<BootTrigger>") && x.contains("<Interval>PT15M</Interval>"));
        assert!(x.contains("TeksERP &amp; Co") && !x.contains("TeksERP & Co"), "XML kaçışı");
        assert!(x.contains("onar --kok &quot;C:\\Program Files\\TeksERP &amp; Co&quot;"));
        assert!(x.contains("--ad TeksERP-Guncelleyici</Arguments>"));
        assert!(
            x.contains("<Command>&quot;C:\\Program Files\\TeksERP &amp; Co\\guncelleyici\\tekserp-guncelleyici.lkg.exe&quot;</Command>")
        );
        assert!(same_action(&x, exe, root, data, "TeksERP-Guncelleyici"));
        assert!(
            same_action(&xml_unescape(&x).replace("TeksERP & Co", "TeksERP &amp; Co"), exe, root, data, "TeksERP-Guncelleyici"),
            "çıplak tırnaklı sorgu çıktısı"
        );
        assert!(!same_action(&x, Path::new(r"C:\x.exe"), root, data, "TeksERP-Guncelleyici"), "başka onarıcı = fark");
        assert!(!same_action(&x, exe, root, data, "TeksERP-Guncelleyici-2"), "başka hizmet = fark");
        assert_eq!(task_name("TeksERP-Guncelleyici"), "\\TeksERP\\TeksERP-Guncelleyici-Onarim");
    }
}
