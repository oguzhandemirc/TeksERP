//! Güncelleyicinin Windows bağları: dayanıklı yeniden adlandırma, boş alan, çocuk süreç ağacı (iş
//! nesnesi), SCM (`tekserp_hizmet::windows::scm`), olay günlüğü, DPAPI ve hizmet yapıştırıcısı.
pub mod service;

use crate::env::{EnvError, EnvResult, Events, Protect, Services, SvcState};
use std::io;
use std::path::Path;
use tekserp_hizmet::logfile::Level;
use tekserp_hizmet::windows::{eventlog, scm, wide};
use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

fn wide_path(p: &Path) -> Vec<u16> {
    wide(&p.to_string_lossy())
}

/// Yeniden adlandırma diske yazılmadan dönmez (`MOVEFILE_WRITE_THROUGH`); hedef varsa değiştirilir.
pub fn move_file_durable(from: &Path, to: &Path) -> io::Result<()> {
    let (a, b) = (wide_path(from), wide_path(to));
    // SAFETY: NUL sonlu geniş dizgeler çağrı boyunca yaşar.
    let ok = unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub fn free_space(p: &Path) -> io::Result<u64> {
    let w = wide_path(p);
    let mut free: u64 = 0;
    // SAFETY: çıktı yerel değişkene; diğer çıktılar istenmez (null).
    let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut free, std::ptr::null_mut(), std::ptr::null_mut()) };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(free)
}

/// Özel dizin (güncelleyicinin `is\` alanı, güncelleme öncesi yedekler): yalnız SYSTEM + Administrators,
/// miras KESİK (korumalı DACL). Kurulumun ACL'ine bağlı kalmadan güncelleyici kendisi uygular (D3:
/// güncelleme öncesi yedek backend'in ERİŞEMEDİĞİ dizinde). Dizin bir bağlantıysa RED.
pub fn harden_private_dir(p: &Path) -> io::Result<()> {
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorDacl, ACL, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    };
    std::fs::create_dir_all(p)?;
    let m = std::fs::symlink_metadata(p)?;
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("{} bir bağlantı — özel alan olarak kullanılmaz", p.display()),
            ));
        }
    }
    let sddl = wide("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)");
    let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: NUL sonlu SDDL; çıktı LocalAlloc'lu tanımlayıcı, aşağıda bırakılır.
    if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut sd, std::ptr::null_mut()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let (mut present, mut defaulted) = (0, 0);
    let mut dacl: *mut ACL = std::ptr::null_mut();
    // SAFETY: tanımlayıcı geçerli; DACL işaretçisi tanımlayıcının içini gösterir.
    let got = unsafe { GetSecurityDescriptorDacl(sd, &mut present, &mut dacl, &mut defaulted) };
    let path = wide_path(p);
    // SAFETY: yol NUL sonlu; DACL tanımlayıcı yaşarken kullanılır.
    let r = if got != 0 && present != 0 {
        unsafe {
            SetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                dacl,
                std::ptr::null(),
            )
        }
    } else {
        1
    };
    // SAFETY: tanımlayıcı ConvertString… ile ayrıldı, bir kez bırakılır.
    unsafe {
        LocalFree(sd.cast());
    }
    if r != 0 {
        return Err(io::Error::other(format!("{} izinleri yazılamadı (Win32 {r})", p.display())));
    }
    Ok(())
}

/// Çocuk sürecin ağacı: kendi iş nesnesinde (zaman aşımında bütün ağaç sonlanır — ör. prisma'nın şema
/// motoru yetim kalıp DB kilidi tutmasın). Güncelleyicinin kendi işinin içinde iç içe iştir (Win8+).
pub struct ChildTree(HANDLE);

// SAFETY: tutamaç yalnız sonlandırma/kapatma için tutulur.
unsafe impl Send for ChildTree {}

impl ChildTree {
    pub fn attach(child: &std::process::Child) -> ChildTree {
        use std::os::windows::io::AsRawHandle;
        // SAFETY: adsız iş; hata null (o zaman ağaç öldürme yalnız çocuğa iner).
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if !job.is_null() {
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            // SAFETY: tutamaçlar geçerli; yapı tam boyuyla verilir.
            unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&raw const info).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE);
            }
        }
        ChildTree(job)
    }

    pub fn kill(&self) {
        if !self.0.is_null() {
            // SAFETY: iş tutamacı geçerli.
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }
}

impl Drop for ChildTree {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: bir kez kapatılır; KILL_ON_JOB_CLOSE artakalan torunları da sonlandırır.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

pub struct WinServices;

impl Services for WinServices {
    fn state(&self, name: &str) -> EnvResult<SvcState> {
        scm::status(name)
            .map(|s| match s {
                scm::Status::Missing => SvcState::Missing,
                scm::Status::Stopped => SvcState::Stopped,
                scm::Status::Starting => SvcState::Starting,
                scm::Status::Running => SvcState::Running,
                scm::Status::Stopping => SvcState::Stopping,
                scm::Status::Other => SvcState::Other,
            })
            .map_err(EnvError)
    }
    fn start(&self, name: &str, args: &[&str]) -> EnvResult<()> {
        scm::start(name, args).map_err(EnvError)
    }
    fn stop(&self, name: &str) -> EnvResult<()> {
        scm::stop(name).map_err(EnvError)
    }
    fn image_path(&self, name: &str) -> EnvResult<String> {
        scm::image_path(name).map_err(EnvError)
    }
    fn set_image_path(&self, name: &str, command_line: &str) -> EnvResult<()> {
        scm::set_image_path(name, command_line).map_err(EnvError)
    }
}

/// Olay günlüğü kaynağı = güncelleyici hizmetinin adı (`hizmet-kur` o adla kaydeder).
pub struct WinEvents {
    pub source: String,
}

impl Events for WinEvents {
    fn event(&self, level: Level, message: &str) {
        eventlog::write(&self.source, level, message);
    }
}

/// DPAPI, SÜREÇ HESABI (SYSTEM) kapsamı + amaca bağlı ek entropi: dosya başka makineye/hesaba
/// taşınınca açılmaz.
pub struct Dpapi;

const ENTROPY: &[u8] = b"tekserp/guncelleyici/yedek-anahtari/v1";

fn blob(d: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: d.len() as u32, pbData: d.as_ptr().cast_mut() }
}

fn dpapi(data: &[u8], unprotect: bool) -> EnvResult<Vec<u8>> {
    let input = blob(data);
    let entropy = blob(ENTROPY);
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: girdi blob'ları çağrı boyunca yaşar; çıktı DPAPI'nin ayırdığı bellektir, kopyalanıp bırakılır.
    let ok = unsafe {
        if unprotect {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                &entropy,
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        } else {
            CryptProtectData(&input, std::ptr::null(), &entropy, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        }
    };
    if ok == 0 || out.pbData.is_null() {
        return Err(EnvError(format!("DPAPI: {}", io::Error::last_os_error())));
    }
    // SAFETY: başarıda `cbData` baytlık geçerli tampon; bir kez LocalFree ile bırakılır.
    let copy = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe {
        LocalFree(out.pbData.cast());
    }
    Ok(copy)
}

impl Protect for Dpapi {
    fn protect(&self, data: &[u8]) -> EnvResult<Vec<u8>> {
        dpapi(data, false)
    }
    fn unprotect(&self, data: &[u8]) -> EnvResult<Vec<u8>> {
        dpapi(data, true)
    }
}
