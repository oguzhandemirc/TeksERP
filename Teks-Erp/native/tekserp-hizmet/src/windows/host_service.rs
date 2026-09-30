//! `TeksERP-Backend` hizmet yapıştırıcısı: SCM'e durum bildirir, durdurma denetimini konağa iletir,
//! konağı iş nesnesine koyar ve sonucu hizmete özgü çıkış koduyla SCM'e verir (§4.3). Asıl iş
//! `host::run`dadır (platformdan bağımsız, Mac'te test edilir).
use super::{eventlog, job};
use crate::contract::{self, exit, path};
use crate::host::{self, BackendLogs, HostConfig, HostHooks, HostOutcome, SHUTDOWN_GRACE};
use crate::logfile::{Level, LogSpec, RotatingLog};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::Duration;
use windows_service::service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult, ServiceStatusHandle};
use windows_service::{define_windows_service, service_dispatcher};

static ROOT: OnceLock<PathBuf> = OnceLock::new();

define_windows_service!(ffi_service_main, service_main);

/// Süreç `hizmet --kok <KOK>` ile SCM tarafından başlatıldığında çağrılır; hizmet durana dek bloklar.
pub fn run(root: PathBuf) -> Result<(), String> {
    let _ = ROOT.set(root);
    service_dispatcher::start(contract::BACKEND_SERVICE, ffi_service_main)
        .map_err(|e| format!("hizmet dağıtıcısı başlatılamadı (SCM dışından mı koşuldu? ön plan için `on-planda`): {e}"))
}

struct Reporter {
    handle: ServiceStatusHandle,
    checkpoint: AtomicU32,
}

impl Reporter {
    fn report(&self, state: ServiceState, accept: ServiceControlAccept, exit_code: u32, wait_hint: Duration) {
        let pending = matches!(state, ServiceState::StartPending | ServiceState::StopPending);
        let _ = self.handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: accept,
            exit_code: if exit_code == 0 { ServiceExitCode::NO_ERROR } else { ServiceExitCode::ServiceSpecific(exit_code) },
            checkpoint: if pending { self.checkpoint.fetch_add(1, Ordering::SeqCst) + 1 } else { 0 },
            wait_hint,
            process_id: None,
        });
    }
}

impl HostHooks for Reporter {
    fn started(&self, _pid: u32) {
        self.report(ServiceState::Running, ServiceControlAccept::STOP | ServiceControlAccept::PRESHUTDOWN, 0, Duration::ZERO);
    }
    fn stopping(&self) {
        self.report(ServiceState::StopPending, ServiceControlAccept::empty(), 0, SHUTDOWN_GRACE);
    }
    fn waiting(&self) {
        self.report(ServiceState::StopPending, ServiceControlAccept::empty(), 0, Duration::from_secs(10));
    }
}

fn service_main(arguments: Vec<OsString>) {
    // arguments[0] hizmetin adıdır; ardından `StartService` argümanları (güncelleyicinin `--dogrulama`sı).
    let verify_mode = arguments.iter().skip(1).any(|a| a == contract::VERIFY_ARG);
    let root = ROOT.get().cloned().unwrap_or_default();
    let log = RotatingLog::open(&root.join(path::LOGS), path::LOG_HOST, LogSpec::SERVICE);
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| body(&root, verify_mode, &log)));
    if outcome.is_err() {
        log.error("konak paniğe düştü — hizmet hata koduyla duruyor");
        eventlog::write(contract::BACKEND_SERVICE, Level::Error, "Konak iç hatası (panik); SCM kurtarması yeniden başlatacak.");
    }
}

fn body(root: &Path, verify_mode: bool, log: &RotatingLog) {
    let (tx, rx) = mpsc::channel::<()>();
    let handler = move |control: ServiceControl| -> ServiceControlHandlerResult {
        match control {
            ServiceControl::Stop | ServiceControl::Shutdown | ServiceControl::Preshutdown => {
                let _ = tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };
    let handle = match service_control_handler::register(contract::BACKEND_SERVICE, handler) {
        Ok(h) => h,
        Err(e) => {
            log.error(&format!("denetim işleyicisi kaydedilemedi: {e}"));
            return;
        }
    };
    let reporter = Reporter { handle, checkpoint: AtomicU32::new(0) };
    reporter.report(ServiceState::StartPending, ServiceControlAccept::empty(), 0, Duration::from_secs(30));
    log.info(&format!("konak başlıyor (sürüm {}; kip {})", env!("CARGO_PKG_VERSION"), if verify_mode { "DOĞRULAMA" } else { "normal" }));
    let _job = match job::enter_self() {
        Ok(j) => j,
        Err(e) => {
            log.error(&e);
            eventlog::write(contract::BACKEND_SERVICE, Level::Error, &format!("İş nesnesi kurulamadı: {e}"));
            reporter.report(ServiceState::Stopped, ServiceControlAccept::empty(), exit::JOB_OBJECT, Duration::ZERO);
            return;
        }
    };
    let logs = BackendLogs {
        out: Arc::new(RotatingLog::open(&root.join(path::LOGS), path::LOG_OUT, LogSpec::BACKEND_OUTPUT)),
        err: Arc::new(RotatingLog::open(&root.join(path::LOGS), path::LOG_ERR, LogSpec::BACKEND_OUTPUT)),
    };
    let cfg = HostConfig { root: root.to_path_buf(), verify_mode, shutdown_grace: SHUTDOWN_GRACE };
    let outcome = host::run(&cfg, &rx, log, &logs, &reporter);
    let code = outcome.exit_code();
    match &outcome {
        HostOutcome::Stopped { forced } => {
            let message = if *forced { "Backend durduruldu (süre doldu, zorla)." } else { "Backend düzgün durduruldu." };
            eventlog::write(contract::BACKEND_SERVICE, if *forced { Level::Warn } else { Level::Info }, message);
        }
        HostOutcome::NodeExited { code: node } => eventlog::write(
            contract::BACKEND_SERVICE,
            Level::Error,
            &format!("Backend (node) beklenmedik çıktı (kod {node:?}); hizmet {code} koduyla duruyor, SCM yeniden başlatacak."),
        ),
        HostOutcome::NodeNotStarted(e) | HostOutcome::EnvFile(e) | HostOutcome::CurrentLink(e) => {
            eventlog::write(contract::BACKEND_SERVICE, Level::Error, &format!("Backend başlatılamadı (kod {code}): {e}"));
        }
    }
    log.info(&format!("konak duruyor (çıkış kodu {code})"));
    reporter.report(ServiceState::Stopped, ServiceControlAccept::empty(), code, Duration::ZERO);
}
