//! SCM kaydı ve denetimi — iki hizmetin kaydı TEK yerden (`hizmet-kur`/`hizmet-kaldir` alt komutları,
//! §4.2): hesap, bağımlılık, gecikmeli otomatik başlatma, kurtarma eylemleri (çökmesiz hata çıkışında
//! da), hizmet SID türü, açıklama, olay kaynağı. Güncelleyici backend'i bu modülle durdurur/başlatır.
use super::eventlog;
use std::ffi::{OsStr, OsString};
use std::path::PathBuf;
use std::time::Duration;
use windows_service::service::{
    ServiceAccess, ServiceAction, ServiceActionType, ServiceDependency, ServiceErrorControl, ServiceExitCode, ServiceFailureActions,
    ServiceFailureResetPeriod, ServiceInfo, ServiceSidType, ServiceStartType, ServiceState, ServiceType,
};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use windows_sys::Win32::System::Services::{
    ChangeServiceConfig2W, ChangeServiceConfigW, SERVICE_CONFIG_REQUIRED_PRIVILEGES_INFO, SERVICE_NO_CHANGE,
    SERVICE_REQUIRED_PRIVILEGES_INFOW,
};

#[derive(Debug, Clone)]
pub struct ServiceSpec {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub executable: PathBuf,
    pub arguments: Vec<OsString>,
    /// `None` = LocalSystem; sanal hesap `NT SERVICE\<ad>` parolasızdır.
    pub account: Option<String>,
    pub dependencies: Vec<String>,
    /// Art arda hatalarda yeniden başlatma gecikmeleri (sayaç 1 günde sıfırlanır).
    pub restart_delays: Vec<Duration>,
    /// Hesabın jetonunda KALACAK ayrıcalıklar (boş = değiştirme); diğerleri hizmet başlarken düşer.
    pub required_privileges: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Missing,
    Stopped,
    Starting,
    Running,
    Stopping,
    Other,
}

fn manager(access: ServiceManagerAccess) -> Result<ServiceManager, String> {
    ServiceManager::local_computer(None::<&str>, access).map_err(|e| format!("hizmet yöneticisine bağlanılamadı: {e}"))
}

fn info_of(s: &ServiceSpec) -> ServiceInfo {
    ServiceInfo {
        name: OsString::from(&s.name),
        display_name: OsString::from(&s.display_name),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: s.executable.clone(),
        launch_arguments: s.arguments.clone(),
        dependencies: s.dependencies.iter().map(|d| ServiceDependency::Service(OsString::from(d))).collect(),
        account_name: s.account.as_ref().map(OsString::from),
        account_password: None,
    }
}

/// Yoksa kurar, varsa yapılandırmayı günceller (yeniden koşulabilir); kurtarma + SID + açıklama + olay kaynağı.
pub fn install(s: &ServiceSpec) -> Result<(), String> {
    let m = manager(ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE)?;
    let access = ServiceAccess::QUERY_STATUS | ServiceAccess::CHANGE_CONFIG | ServiceAccess::START | ServiceAccess::STOP;
    let info = info_of(s);
    let service = match m.open_service(&s.name, access) {
        Ok(h) => {
            h.change_config(&info).map_err(|e| format!("{}: yapılandırma güncellenemedi: {e}", s.name))?;
            h
        }
        Err(_) => m.create_service(&info, access).map_err(|e| format!("{}: hizmet oluşturulamadı: {e}", s.name))?,
    };
    service.set_description(&s.description).map_err(|e| format!("{}: açıklama: {e}", s.name))?;
    service.set_delayed_auto_start(true).map_err(|e| format!("{}: gecikmeli başlatma: {e}", s.name))?;
    if s.account.is_some() {
        service.set_config_service_sid_info(ServiceSidType::Unrestricted).map_err(|e| format!("{}: hizmet SID türü: {e}", s.name))?;
    }
    let actions = s.restart_delays.iter().map(|d| ServiceAction { action_type: ServiceActionType::Restart, delay: *d }).collect();
    service
        .update_failure_actions(ServiceFailureActions {
            reset_period: ServiceFailureResetPeriod::After(Duration::from_secs(86_400)),
            reboot_msg: None,
            command: None,
            actions: Some(actions),
        })
        .map_err(|e| format!("{}: kurtarma eylemleri: {e}", s.name))?;
    service.set_failure_actions_on_non_crash_failures(true).map_err(|e| format!("{}: çökmesiz hata kurtarması: {e}", s.name))?;
    if !s.required_privileges.is_empty() {
        // Çoklu dizge: her ad NUL ile biter, liste çift NUL ile.
        let mut multi: Vec<u16> = s.required_privileges.iter().flat_map(|p| p.encode_utf16().chain(std::iter::once(0))).collect();
        multi.push(0);
        let info = SERVICE_REQUIRED_PRIVILEGES_INFOW { pmszRequiredPrivileges: multi.as_mut_ptr() };
        // SAFETY: tutamaç açık hizmetindir; yapı ve çoklu dizge çağrı boyunca yaşar.
        let ok = unsafe { ChangeServiceConfig2W(service.raw_handle(), SERVICE_CONFIG_REQUIRED_PRIVILEGES_INFO, (&raw const info).cast()) };
        if ok == 0 {
            return Err(format!("{}: gerekli ayrıcalıklar yazılamadı: {}", s.name, std::io::Error::last_os_error()));
        }
    }
    eventlog::register_source(&s.name)?;
    Ok(())
}

/// Çalışıyorsa durdurur (≤ 60 sn bekler), siler, olay kaynağını kaldırır. Yoksa sessizce geçer.
pub fn uninstall(name: &str) -> Result<(), String> {
    let m = manager(ServiceManagerAccess::CONNECT)?;
    let Ok(h) = m.open_service(name, ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::DELETE) else {
        eventlog::remove_source(name);
        return Ok(());
    };
    if h.query_status().is_ok_and(|s| s.current_state != ServiceState::Stopped) {
        let _ = h.stop();
        let started = std::time::Instant::now();
        while started.elapsed() < Duration::from_secs(60) {
            if h.query_status().is_ok_and(|s| s.current_state == ServiceState::Stopped) {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    h.delete().map_err(|e| format!("{name}: silinemedi: {e}"))?;
    eventlog::remove_source(name);
    Ok(())
}

pub fn exists(name: &str) -> bool {
    manager(ServiceManagerAccess::CONNECT).is_ok_and(|m| m.open_service(name, ServiceAccess::QUERY_STATUS).is_ok())
}

pub fn status(name: &str) -> Result<Status, String> {
    let m = manager(ServiceManagerAccess::CONNECT)?;
    let Ok(h) = m.open_service(name, ServiceAccess::QUERY_STATUS) else {
        return Ok(Status::Missing);
    };
    let s = h.query_status().map_err(|e| format!("{name}: durum okunamadı: {e}"))?;
    Ok(match s.current_state {
        ServiceState::Stopped => Status::Stopped,
        ServiceState::StartPending => Status::Starting,
        ServiceState::Running => Status::Running,
        ServiceState::StopPending => Status::Stopping,
        _ => Status::Other,
    })
}

/// DURMUŞ hizmetin hizmete özgü sıfır-dışı çıkış kodu (konak sözleşmesi `exit`: 10 node beklenmedik çıktı …) —
/// SCM kurtarması onu yeniden başlatacak demektir. Çalışıyorsa, yoksa ya da temiz durduysa `None`.
pub fn crash_exit_code(name: &str) -> Result<Option<u32>, String> {
    let m = manager(ServiceManagerAccess::CONNECT)?;
    let Ok(h) = m.open_service(name, ServiceAccess::QUERY_STATUS) else {
        return Ok(None);
    };
    let s = h.query_status().map_err(|e| format!("{name}: durum okunamadı: {e}"))?;
    Ok(match (s.current_state, s.exit_code) {
        (ServiceState::Stopped, ServiceExitCode::ServiceSpecific(c)) if c != 0 => Some(c),
        _ => None,
    })
}

/// Başlatma isteği (bekleme çağıranın işi). Zaten çalışıyorsa hata değildir.
pub fn start(name: &str, arguments: &[&str]) -> Result<(), String> {
    let m = manager(ServiceManagerAccess::CONNECT)?;
    let h = m.open_service(name, ServiceAccess::QUERY_STATUS | ServiceAccess::START).map_err(|e| format!("{name}: açılamadı: {e}"))?;
    if h.query_status().is_ok_and(|s| matches!(s.current_state, ServiceState::Running | ServiceState::StartPending)) {
        return Ok(());
    }
    let args: Vec<&OsStr> = arguments.iter().map(OsStr::new).collect();
    h.start(&args).map_err(|e| format!("{name}: başlatılamadı: {e}"))
}

/// Durdurma isteği (bekleme çağıranın işi). Zaten durmuşsa hata değildir.
pub fn stop(name: &str) -> Result<(), String> {
    let m = manager(ServiceManagerAccess::CONNECT)?;
    let h = m.open_service(name, ServiceAccess::QUERY_STATUS | ServiceAccess::STOP).map_err(|e| format!("{name}: açılamadı: {e}"))?;
    if h.query_status().is_ok_and(|s| matches!(s.current_state, ServiceState::Stopped | ServiceState::StopPending)) {
        return Ok(());
    }
    h.stop().map(|_| ()).map_err(|e| format!("{name}: durdurulamadı: {e}"))
}

/// Hizmetin tam komut satırı (ImagePath; ikili + argümanlar).
pub fn image_path(name: &str) -> Result<String, String> {
    let m = manager(ServiceManagerAccess::CONNECT)?;
    let h = m.open_service(name, ServiceAccess::QUERY_CONFIG).map_err(|e| format!("{name}: açılamadı: {e}"))?;
    let c = h.query_config().map_err(|e| format!("{name}: yapılandırma okunamadı: {e}"))?;
    Ok(c.executable_path.to_string_lossy().into_owned())
}

/// YALNIZ ImagePath'i değiştirir (hesap, başlatma türü, bağımlılık dokunulmaz — `SERVICE_NO_CHANGE`).
pub fn set_image_path(name: &str, command_line: &str) -> Result<(), String> {
    let m = manager(ServiceManagerAccess::CONNECT)?;
    let h =
        m.open_service(name, ServiceAccess::QUERY_CONFIG | ServiceAccess::CHANGE_CONFIG).map_err(|e| format!("{name}: açılamadı: {e}"))?;
    let path = super::wide(command_line);
    // SAFETY: tutamaç açık hizmetindir; yalnız ikili yolu verilir, diğer bütün alanlar değişmez (null/NO_CHANGE).
    let ok = unsafe {
        ChangeServiceConfigW(
            h.raw_handle(),
            SERVICE_NO_CHANGE,
            SERVICE_NO_CHANGE,
            SERVICE_NO_CHANGE,
            path.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if ok == 0 {
        return Err(format!("{name}: ImagePath değiştirilemedi: {}", std::io::Error::last_os_error()));
    }
    Ok(())
}
