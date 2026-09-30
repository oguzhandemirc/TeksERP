//! `tekserp-guncelleyici` — TeksERP güncelleyici hizmeti (`TeksERP-Guncelleyici`, LocalSystem).
//!
//!   hizmet --kok <KOK>              SCM'in başlattığı kip (ImagePath argümanları)
//!   tur --kok <KOK> [--veri <D>]    tek tur ön planda (tanı; yarım işlemi de sonuçlandırır — "onar")
//!   durum --kok <KOK> [--veri <D>]  durum.json + son işlemin özeti
//!   hizmet-kur --kok <KOK>          kaydet/güncelle (yönetici)
//!   hizmet-kaldir                   durdur + sil (yönetici)
//!   kunye                           {ad, surum, hedef, testCapasi} JSON (kendini güncellemede sınanır)
//!
//! Sözleşme: docs/design/GUNCELLEYICI.md §4–§13.
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use tekserp_guncelleyici::engine::{Engine, TickResult};
use tekserp_guncelleyici::journal::Journal;
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::trust::{TrustAnchor, TEST_ANCHOR};
use tekserp_guncelleyici::{env, lock, settings};
use tekserp_hizmet::logfile::{LogSpec, RotatingLog};

fn flag_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn root_arg(args: &[String]) -> Result<PathBuf, String> {
    let r = PathBuf::from(flag_value(args, "--kok").ok_or("--kok <dizin> gerekli")?);
    if !r.is_absolute() {
        return Err(format!("--kok mutlak yol olmalı: {}", r.display()));
    }
    Ok(r)
}

/// `%ProgramData%\TeksERP` (Windows) — `--veri` ile değiştirilebilir (tanı/test).
fn data_arg(args: &[String], root: &std::path::Path) -> PathBuf {
    if let Some(d) = flag_value(args, "--veri") {
        return PathBuf::from(d);
    }
    match std::env::var_os("ProgramData") {
        Some(pd) if cfg!(windows) => PathBuf::from(pd).join("TeksERP"),
        _ => root.join("programdata"),
    }
}

fn identity() -> String {
    serde_json::json!({ "ad": "tekserp-guncelleyici", "surum": env!("CARGO_PKG_VERSION"), "hedef": std::env::consts::OS, "testCapasi": TEST_ANCHOR }).to_string()
}

fn one_tick(args: &[String]) -> Result<u32, String> {
    let root = root_arg(args)?;
    let layout = Layout::new(&root, &data_arg(args, &root));
    let _lock = lock::acquire(&layout.lock_file()).map_err(|e| format!("KILIT_DOLU: {e}"))?;
    let s = settings::read_settings(&env::RealFs, &layout).unwrap_or_default();
    let e = env::real(s.proxy.as_deref())?;
    let log = Arc::new(RotatingLog::open(&layout.log_dir(), "guncelleyici", LogSpec::SERVICE));
    let engine = Engine::new(e, layout.clone(), TrustAnchor::for_process()?, log, None);
    let r = engine.tick(&|| false);
    println!("{}", String::from_utf8_lossy(&std::fs::read(layout.status_file()).unwrap_or_default()));
    Ok(u32::from(r == TickResult::RestartForSelfUpdate))
}

fn show_status(args: &[String]) -> Result<u32, String> {
    let root = root_arg(args)?;
    let layout = Layout::new(&root, &data_arg(args, &root));
    println!("{}", String::from_utf8_lossy(&std::fs::read(layout.status_file()).unwrap_or_else(|_| b"{}".to_vec())));
    if let Ok(j) = Journal::open(&env::RealFs, &layout.journal_file()) {
        if let Some(v) = j.last_op() {
            println!(
                "son işlem {} — {} kayıt, sonuç: {}",
                v.op,
                v.records.len(),
                v.result().map_or("YARIM".to_string(), |r| r.to_string())
            );
        }
    }
    Ok(0)
}

#[cfg(windows)]
fn windows_command(command: &str, args: &[String]) -> Result<u32, String> {
    use tekserp_hizmet::contract::{self, path};
    use tekserp_hizmet::windows::scm;
    match command {
        "hizmet" => {
            let root = root_arg(args)?;
            let data = data_arg(args, &root);
            tekserp_guncelleyici::windows::service::run(root, data).map(|()| 0)
        }
        "hizmet-kur" => {
            let root = root_arg(args)?;
            scm::install(&scm::ServiceSpec {
                name: contract::UPDATER_SERVICE.into(),
                display_name: contract::UPDATER_DISPLAY_NAME.into(),
                description: contract::UPDATER_DESCRIPTION.into(),
                executable: root.join(path::UPDATER).join(path::UPDATER_EXE),
                arguments: vec!["hizmet".into(), "--kok".into(), root.clone().into_os_string()],
                account: None,
                dependencies: vec![],
                restart_delays: [10, 30, 60].map(std::time::Duration::from_secs).to_vec(),
                required_privileges: vec![],
            })?;
            println!("{} kaydedildi (kök {})", contract::UPDATER_SERVICE, root.display());
            Ok(0)
        }
        "hizmet-kaldir" => scm::uninstall(contract::UPDATER_SERVICE).map(|()| {
            println!("{} kaldırıldı", contract::UPDATER_SERVICE);
            0
        }),
        _ => Err(format!("bilinmeyen komut: {command}")),
    }
}

#[cfg(not(windows))]
fn windows_command(command: &str, _args: &[String]) -> Result<u32, String> {
    Err(format!("`{command}` yalnız Windows'ta (tanı için `tur`)"))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().cloned().unwrap_or_default();
    let result = match command.as_str() {
        "kunye" => {
            println!("{}", identity());
            Ok(0)
        }
        "tur" | "onar" => one_tick(&args),
        "durum" => show_status(&args),
        "hizmet" | "hizmet-kur" | "hizmet-kaldir" => windows_command(&command, &args),
        _ => {
            Err("kullanım: tekserp-guncelleyici <hizmet|tur|onar|durum|hizmet-kur|hizmet-kaldir|kunye> [--kok <dizin>] [--veri <dizin>]"
                .into())
        }
    };
    match result {
        Ok(code) => ExitCode::from(u8::try_from(code).unwrap_or(1)),
        Err(e) => {
            eprintln!("tekserp-guncelleyici: {e}");
            ExitCode::from(2)
        }
    }
}
