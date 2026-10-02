//! `TeksERP-Guncelleyici` hizmet yapıştırıcısı: SCM'e durum bildirir, durdurmayı döngüye iletir,
//! kendini (ve bütün araç çocuklarını) kill-on-close işine koyar, motoru turlarla sürer. Açılışta İLK
//! iş kendini güncelleme sayacıdır (§10). Çıkış kodu `EXIT_SELF_UPDATE` = SCM kurtarması yeniden başlatsın.
use crate::codes;
use crate::engine::{Engine, TickResult};
use crate::layout::Layout;
use crate::selfupdate::{self, Startup};
use crate::trust::TrustAnchor;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tekserp_hizmet::contract;
use tekserp_hizmet::logfile::{Level, LogSpec, RotatingLog};
use tekserp_hizmet::windows::{eventlog, job, scm};
use windows_service::service::{ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::{define_windows_service, service_dispatcher};

static PATHS: OnceLock<(PathBuf, PathBuf)> = OnceLock::new();
static NAME: OnceLock<String> = OnceLock::new();

fn name() -> &'static str {
    NAME.get().map_or(contract::UPDATER_SERVICE, String::as_str)
}

define_windows_service!(ffi_service_main, service_main);

pub fn run(root: PathBuf, data: PathBuf, service_name: String) -> Result<(), String> {
    let _ = PATHS.set((root, data));
    let _ = NAME.set(service_name);
    service_dispatcher::start(name(), ffi_service_main)
        .map_err(|e| format!("hizmet dağıtıcısı başlatılamadı (SCM dışından mı koşuldu? tanı için `tur`): {e}"))
}

fn service_main(_arguments: Vec<OsString>) {
    let (root, data) = PATHS.get().cloned().unwrap_or_default();
    let layout = Layout::new(&root, &data);
    let log = Arc::new(RotatingLog::open(&layout.log_dir(), "guncelleyici", LogSpec::SERVICE));
    let stop = Arc::new(AtomicBool::new(false));
    let s2 = Arc::clone(&stop);
    let handler = move |c: ServiceControl| -> ServiceControlHandlerResult {
        match c {
            ServiceControl::Stop | ServiceControl::Shutdown | ServiceControl::Preshutdown => {
                s2.store(true, Ordering::SeqCst);
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };
    let Ok(handle) = service_control_handler::register(name(), handler) else {
        log.error("denetim işleyicisi kaydedilemedi");
        return;
    };
    let report = |state: ServiceState, code: u32| {
        let _ = handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: state,
            controls_accepted: if state == ServiceState::Running {
                ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
            } else {
                ServiceControlAccept::empty()
            },
            exit_code: if code == 0 { ServiceExitCode::NO_ERROR } else { ServiceExitCode::ServiceSpecific(code) },
            checkpoint: 0,
            wait_hint: Duration::from_secs(if state == ServiceState::Running { 0 } else { 30 }),
            process_id: None,
        });
    };
    report(ServiceState::StartPending, 0);
    // İş tutamacı Stopped bildiriminden SONRA kapanır: kapanış işteki her süreci (bu süreç dahil) sonlandırır;
    // önce kapansaydı SCM durmayı bildirimsiz sonlanma (1067) görür, kurtarma da yanlış dalı seçerdi.
    let mut job: Option<job::KillOnCloseJob> = None;
    let code = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        body(&layout, &log, &stop, &|| report(ServiceState::Running, 0), &mut job)
    }))
    .unwrap_or_else(|_| {
        log.error("güncelleyici paniğe düştü — hata koduyla çıkılıyor (SCM yeniden başlatır; yarım işlem açılışta sürdürülür)");
        eventlog::write(name(), Level::Error, "Güncelleyici iç hatası (panik); SCM kurtarması yeniden başlatacak.");
        1
    });
    report(ServiceState::Stopped, code);
    drop(job);
}

/// Kendi SCM kurtarmasını `hizmet-kur` ile AYNI diziye getirir; yalnız farklıysa yazar (sayaç boşuna sıfırlanmasın).
/// Kendini güncelleyen ikili eski kaydın kurtarmasını da düzeltir — onarım gerekmez.
fn ensure_own_recovery(log: &RotatingLog) {
    let r = match scm::recovery(name()) {
        Ok(r) => r,
        Err(e) => {
            log.warn(&format!("SCM kurtarması okunamadı (değiştirilmedi): {e}"));
            return;
        }
    };
    let Some(diff) = selfupdate::recovery_drift(&r.actions, r.reset_s, r.non_crash) else { return };
    let delays: Vec<Duration> = selfupdate::RESTART_DELAYS_S.map(Duration::from_secs).to_vec();
    match scm::set_restart_recovery(name(), &delays) {
        Ok(()) => log.info(&format!("SCM kurtarması {:?} sn'ye yazıldı (önce: {diff})", selfupdate::RESTART_DELAYS_S)),
        Err(e) => log.warn(&format!("SCM kurtarması yazılamadı ({diff}): {e}")),
    }
}

fn body(layout: &Layout, log: &Arc<RotatingLog>, stop: &AtomicBool, running: &dyn Fn(), job_slot: &mut Option<job::KillOnCloseJob>) -> u32 {
    let own = std::env::current_exe().ok();
    let settings = crate::settings::read_settings(&crate::env::RealFs, layout).unwrap_or_default();
    let env = match crate::env::real(settings.proxy.as_deref(), name()) {
        Ok(e) => e,
        Err(e) => {
            log.error(&format!("ortam kurulamadı: {e}"));
            return 2;
        }
    };
    if let Some(own) = &own {
        if selfupdate::on_startup(&env, layout, own, env!("CARGO_PKG_VERSION")) == Startup::RevertedRestart {
            log.error("yeni güncelleyici ikilisi 3 açılışta doğrulanamadı — eski ikili geri kondu");
            eventlog::write(name(), Level::Error, "Güncelleyicinin yeni ikilisi doğrulanamadı; eski ikiliye dönüldü.");
            return codes::EXIT_SELF_UPDATE;
        }
    }
    match job::enter_self() {
        Ok(j) => *job_slot = Some(j),
        Err(e) => log.warn(&format!("iş nesnesi kurulamadı ({e}) — araç çocukları güncelleyiciyle birlikte sonlanmayabilir")),
    }
    let anchor = match TrustAnchor::for_process() {
        Ok(a) => a,
        Err(e) => {
            log.error(&format!("güven çapası: {e}"));
            return 2;
        }
    };
    let _lock = match crate::lock::acquire(&layout.lock_file()) {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("{}: {e}", codes::KILIT_DOLU));
            return 3;
        }
    };
    running();
    log.info(&format!("güncelleyici başladı (sürüm {}; test çapası {})", env!("CARGO_PKG_VERSION"), crate::trust::TEST_ANCHOR));
    ensure_own_recovery(log);
    let engine = Engine::new(env.clone(), layout.clone(), anchor, Arc::clone(log), own.clone());
    let should_stop = || stop.load(Ordering::SeqCst);
    let mut healthy_marked = false;
    while !should_stop() {
        let r = engine.tick(&should_stop);
        if !healthy_marked {
            if let Some(own) = &own {
                selfupdate::mark_healthy(&env, layout, own, env!("CARGO_PKG_VERSION"));
            }
            healthy_marked = true;
        }
        match r {
            TickResult::RestartForSelfUpdate => return codes::EXIT_SELF_UPDATE,
            TickResult::Idle(d) => crate::wait::until_change_or(&env, layout, d, &should_stop),
        }
    }
    log.info("güncelleyici duruyor (istenen durdurma)");
    0
}
