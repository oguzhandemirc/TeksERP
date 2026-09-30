//! `tekserp-hizmet` — TeksERP backend hizmet konağı (`TeksERP-Backend`).
//!
//!   hizmet --kok <KOK> [--ad <ad>]      SCM'in başlattığı kip (ImagePath argümanları)
//!   on-planda --kok <KOK> [--ad <ad>] [--dogrulama]   ön planda koş; stdin'de satır/EOF = durdur (tanı)
//!   hizmet-kur --kok <KOK> [--ad <ad>] [--pg-hizmeti <ad> | --pg-yok]   kaydet/güncelle (yönetici)
//!   hizmet-kaldir [--ad <ad>]           durdur + sil (yönetici)
//!
//! `--ad` yoksa `TeksERP-Backend`; aynı makinedeki ikinci kanal kanal kaydının `backend.hizmetAdi`ni
//! verir (`kanal-kapisi.mjs backend-paketle` → `TEKSERP_HIZMET_ADI`).
//!   kunye                               {ad, surum, hedef} JSON
//!
//! Sözleşme: docs/design/GUNCELLEYICI.md §4.2–§4.3.
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::{mpsc, Arc};
use tekserp_hizmet::contract::{self, path};
use tekserp_hizmet::host::{self, BackendLogs, HostConfig, NoHooks, SHUTDOWN_GRACE};
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

fn identity() -> String {
    serde_json::json!({ "ad": "tekserp-hizmet", "surum": env!("CARGO_PKG_VERSION"), "hedef": std::env::consts::OS }).to_string()
}

fn foreground(args: &[String]) -> Result<u32, String> {
    let root = root_arg(args)?;
    let service_name = contract::service_name_arg(args, contract::BACKEND_SERVICE)?;
    let verify_mode = args.iter().any(|a| a == contract::VERIFY_ARG);
    let (tx, rx) = mpsc::channel::<()>();
    std::thread::spawn(move || {
        let mut line = String::new();
        let _ = std::io::stdin().read_line(&mut line);
        let _ = tx.send(());
    });
    let log_dir = root.join(path::LOGS);
    let log = RotatingLog::open(&log_dir, path::LOG_HOST, LogSpec::SERVICE);
    let logs = BackendLogs {
        out: Arc::new(RotatingLog::open(&log_dir, path::LOG_OUT, LogSpec::BACKEND_OUTPUT)),
        err: Arc::new(RotatingLog::open(&log_dir, path::LOG_ERR, LogSpec::BACKEND_OUTPUT)),
    };
    let cfg = HostConfig { root, service_name, verify_mode, shutdown_grace: SHUTDOWN_GRACE };
    let outcome = host::run(&cfg, &rx, &log, &logs, &NoHooks);
    eprintln!("konak bitti: {outcome:?}");
    Ok(outcome.exit_code())
}

#[cfg(windows)]
fn windows_command(command: &str, args: &[String]) -> Result<u32, String> {
    use tekserp_hizmet::windows::{host_service, scm};
    match command {
        "hizmet" => host_service::run(root_arg(args)?, contract::service_name_arg(args, contract::BACKEND_SERVICE)?).map(|()| 0),
        "hizmet-kur" => {
            let root = root_arg(args)?;
            let name = contract::service_name_arg(args, contract::BACKEND_SERVICE)?;
            let dependencies = if args.iter().any(|a| a == "--pg-yok") {
                vec![]
            } else if let Some(name) = flag_value(args, "--pg-hizmeti") {
                vec![name]
            } else if scm::exists(contract::PG_SERVICE) {
                vec![contract::PG_SERVICE.to_string()]
            } else {
                eprintln!(
                    "uyarı: {} hizmeti yok — backend PG bağımlılığı olmadan kaydedildi (harici PG: --pg-hizmeti <ad>)",
                    contract::PG_SERVICE
                );
                vec![]
            };
            let display_name = if name == contract::BACKEND_SERVICE {
                contract::BACKEND_DISPLAY_NAME.to_string()
            } else {
                format!("{} ({name})", contract::BACKEND_DISPLAY_NAME)
            };
            scm::install(&scm::ServiceSpec {
                name: name.clone(),
                display_name,
                description: contract::BACKEND_DESCRIPTION.into(),
                executable: root.join(path::CURRENT).join(path::RUNTIME).join(path::HOST_EXE),
                arguments: vec![
                    "hizmet".into(),
                    "--kok".into(),
                    root.clone().into_os_string(),
                    contract::ARG_SERVICE_NAME.into(),
                    name.clone().into(),
                ],
                account: Some(contract::service_account(&name)),
                dependencies,
                // D3 (`backend-hizmeti.ps1`) ile aynı: 5 sn · 5 sn · 30 sn, sayaç 1 günde sıfırlanır.
                restart_delays: [5, 5, 30].map(std::time::Duration::from_secs).to_vec(),
                required_privileges: contract::BACKEND_PRIVILEGES.iter().map(|p| p.to_string()).collect(),
            })?;
            println!("{name} kaydedildi (kök {}; hesap {})", root.display(), contract::service_account(&name));
            Ok(0)
        }
        "hizmet-kaldir" => {
            let name = contract::service_name_arg(args, contract::BACKEND_SERVICE)?;
            scm::uninstall(&name).map(|()| {
                println!("{name} kaldırıldı");
                0
            })
        }
        _ => Err(format!("bilinmeyen komut: {command}")),
    }
}

#[cfg(not(windows))]
fn windows_command(command: &str, _args: &[String]) -> Result<u32, String> {
    Err(format!("`{command}` yalnız Windows'ta (bu platformda ön plan için `on-planda`)"))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().cloned().unwrap_or_default();
    let result = match command.as_str() {
        "kunye" => {
            println!("{}", identity());
            Ok(0)
        }
        "on-planda" => foreground(&args),
        "hizmet" | "hizmet-kur" | "hizmet-kaldir" => windows_command(&command, &args),
        _ => Err("kullanım: tekserp-hizmet <hizmet|on-planda|hizmet-kur|hizmet-kaldir|kunye> [--kok <dizin>] [--ad <hizmet adı>]".into()),
    };
    match result {
        Ok(code) => ExitCode::from(u8::try_from(code).unwrap_or(1)),
        Err(e) => {
            eprintln!("tekserp-hizmet: {e}");
            ExitCode::from(2)
        }
    }
}
