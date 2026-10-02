//! İş nesnesi: konak KENDİNİ `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` işine koyar; başlattığı node işe
//! kendiliğinden girer. Konak ölürse (çökme, SCM sonlandırması) son tutamaç kapanır ve node da ölür
//! — SCM yeniden başlattığında yetim node portu tutmaz ("tek backend süreci"). Güncelleyici de
//! çocuk süreçlerini (pg_dump, göç) aynı yolla bağlar: güncelleyici ölürse yarım araç yaşamaz.
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

/// Süreç boyunca yaşar; düşürülünce tutamaç kapanır (işteki süreçler sonlandırılır).
pub struct KillOnCloseJob(HANDLE);

// SAFETY: tutamaç yalnız kapatılmak için tutulur; iş parçacıkları arasında paylaşımı güvenlidir.
unsafe impl Send for KillOnCloseJob {}
unsafe impl Sync for KillOnCloseJob {}

impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        // SAFETY: tutamaç CreateJobObjectW'den geldi ve bir kez kapatılır.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub fn enter_self() -> Result<KillOnCloseJob, String> {
    // SAFETY: adsız iş nesnesi; hata null tutamaçla döner.
    let h = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if h.is_null() {
        return Err(format!("iş nesnesi oluşturulamadı: {}", std::io::Error::last_os_error()));
    }
    let job = KillOnCloseJob(h);
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: yapı yerel ve tam boyuyla verilir; tutamaç geçerli.
    let ok = unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&raw const info).cast(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if ok == 0 {
        return Err(format!("iş nesnesi sınırı konamadı: {}", std::io::Error::last_os_error()));
    }
    // SAFETY: sözde tutamaç (GetCurrentProcess) kapatılmaz; iş tutamacı geçerli.
    let ok = unsafe { AssignProcessToJobObject(job.0, GetCurrentProcess()) };
    if ok == 0 {
        return Err(format!("süreç işe konamadı: {}", std::io::Error::last_os_error()));
    }
    Ok(job)
}
