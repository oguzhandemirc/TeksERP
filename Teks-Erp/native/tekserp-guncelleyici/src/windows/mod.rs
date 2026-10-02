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
    apply_sddl(p, "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
}

/// Yolun DACL'ini SDDL'den yazar (korumalı: miras kesilir).
pub fn apply_sddl(p: &Path, sddl: &str) -> io::Result<()> {
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW, SDDL_REVISION_1, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorDacl, ACL, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    };
    let sddl = wide(sddl);
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

/// Yazma sayılan haklar: veri yaz/ekle (dizinde dosya/alt dizin yarat) · alt öğe sil · sil · DACL/sahip
/// değiştir · genel yazma/tam.
const WRITE_RIGHTS: u32 = 0x2 | 0x4 | 0x40 | 0x1_0000 | 0x4_0000 | 0x8_0000 | 0x4000_0000 | 0x1000_0000;
/// SYSTEM · Administrators · TrustedInstaller.
const TRUSTED_SIDS: [&str; 3] = ["S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"];
/// Nesnenin kendisine hak vermeyen yer tutucular: CREATOR OWNER · CREATOR GROUP · OWNER RIGHTS (sahip ayrıca ölçülür).
const PLACEHOLDER_SIDS: [&str; 3] = ["S-1-3-0", "S-1-3-1", "S-1-3-4"];

fn sid_string(sid: windows_sys::Win32::Security::PSID) -> Option<String> {
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    if sid.is_null() {
        return None;
    }
    let mut out: windows_sys::core::PWSTR = std::ptr::null_mut();
    // SAFETY: SID geçerli bir tanımlayıcının içinde; çıktı LocalAlloc'lu, kopyalanıp bırakılır.
    if unsafe { ConvertSidToStringSidW(sid, &mut out) } == 0 || out.is_null() {
        return None;
    }
    // SAFETY: NUL sonlu geniş dizge; uzunluk NUL'a kadar sayılır.
    let s = unsafe {
        let mut n = 0;
        while *out.add(n) != 0 {
            n += 1;
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(out, n))
    };
    unsafe {
        LocalFree(out.cast());
    }
    Some(s)
}

/// Güncelleyicinin kendi hesabı (üretimde SYSTEM; tanı/test kipinde koşturan hesap).
fn own_user_sid() -> io::Result<String> {
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    static OWN: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    let got = OWN.get_or_init(|| {
        let mut token: HANDLE = std::ptr::null_mut();
        // SAFETY: sözde tutamaç; çıktı tutamacı aşağıda kapatılır.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return None;
        }
        let mut len = 0u32;
        // SAFETY: boy sorusu (tampon yok); ardından 8 bayt hizalı tampona okunur.
        unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut len) };
        let mut buf = vec![0u64; (len as usize).div_ceil(8).max(1)];
        let ok = unsafe { GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), len, &mut len) };
        let sid = if ok != 0 { sid_string(unsafe { (*buf.as_ptr().cast::<TOKEN_USER>()).User.Sid }) } else { None };
        // SAFETY: OpenProcessToken'ın tutamacı bir kez kapatılır.
        unsafe { CloseHandle(token) };
        sid
    });
    got.clone().ok_or_else(|| io::Error::other("süreç hesabının SID'i okunamadı"))
}

/// Yolun sahibi ve DACL'i (`Fs::foreign_writers`): güvenilir hesaplar DIŞINDA yazma hakkı olan her SID.
/// Yalnız İZİN VEREN ACE'ler sayılır (red ACE'si hak vermez), salt kalıtım ACE'si nesneye uygulanmaz.
pub fn foreign_writers(p: &Path) -> io::Result<Vec<String>> {
    use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows_sys::Win32::Security::{
        AclSizeInformation, GetAce, GetAclInformation, ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION,
        DACL_SECURITY_INFORMATION, INHERIT_ONLY_ACE, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    };
    let me = own_user_sid()?;
    let trusted = |s: &str| TRUSTED_SIDS.contains(&s) || s == me;
    let path = wide_path(p);
    let (mut owner, mut dacl, mut sd): (PSID, *mut ACL, PSECURITY_DESCRIPTOR) =
        (std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
    // SAFETY: yol NUL sonlu; çıktılar tanımlayıcının içini gösterir, tanımlayıcı aşağıda bırakılır.
    let r = unsafe {
        GetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut sd,
        )
    };
    if r != 0 {
        return Err(io::Error::from_raw_os_error(r as i32));
    }
    let mut out = Vec::new();
    let mut scan = || -> io::Result<()> {
        match sid_string(owner) {
            Some(s) if trusted(&s) => {}
            Some(s) => out.push(format!("sahip {s}")),
            None => out.push("sahip okunamadı".into()),
        }
        if dacl.is_null() {
            out.push("DACL yok (herkes tam erişim)".into());
            return Ok(());
        }
        let mut info = ACL_SIZE_INFORMATION::default();
        // SAFETY: DACL tanımlayıcı yaşarken geçerli; çıktı yapısı tam boyuyla verilir.
        if unsafe {
            GetAclInformation(dacl, (&raw mut info).cast(), std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32, AclSizeInformation)
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        for i in 0..info.AceCount {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            // SAFETY: dizin AceCount içinde; ACE DACL'in içini gösterir.
            if unsafe { GetAce(dacl, i, &mut ace) } == 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: her ACE bir ACE_HEADER ile başlar.
            let h = unsafe { *ace.cast::<ACE_HEADER>() };
            if u32::from(h.AceFlags) & INHERIT_ONLY_ACE != 0 {
                continue;
            }
            match h.AceType {
                // ACCESS_ALLOWED · ACCESS_ALLOWED_CALLBACK: aynı yerleşim (başlık · maske · SID).
                0 | 9 => {
                    // SAFETY: tür izin ACE'si; SID `SidStart`tan başlar.
                    let a = unsafe { &*ace.cast::<ACCESS_ALLOWED_ACE>() };
                    if a.Mask & WRITE_RIGHTS == 0 {
                        continue;
                    }
                    let sid: PSID = (&raw const a.SidStart).cast_mut().cast();
                    match sid_string(sid) {
                        Some(s) if trusted(&s) || PLACEHOLDER_SIDS.contains(&s.as_str()) => {}
                        Some(s) => out.push(format!("{s} yazabilir (0x{:x})", a.Mask)),
                        None => out.push("okunamayan SID yazabilir".into()),
                    }
                }
                // Nesne izin ACE'leri dosya sisteminde beklenmez — ölçülemeyen hak güvenilmez sayılır.
                5 | 11 => out.push(format!("tanınmayan izin ACE türü {}", h.AceType)),
                _ => {}
            }
        }
        Ok(())
    };
    let res = scan();
    // SAFETY: GetNamedSecurityInfoW'nun ayırdığı tanımlayıcı bir kez bırakılır.
    unsafe {
        LocalFree(sd.cast());
    }
    res.map(|()| out)
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
    fn crash_exit_code(&self, name: &str) -> EnvResult<Option<u32>> {
        scm::crash_exit_code(name).map_err(EnvError)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Gerçek DACL ölçümü (yalnız Windows): korumalı SYSTEM+Administrators dizini temiz; Everyone'a
    /// yazma ACE'si eklenince yabancı yazar olarak görünür; salt kalıtım ACE'si nesneye sayılmaz.
    #[test]
    fn foreign_writers_on_real_acl() {
        let d = std::env::temp_dir().join(format!("yabanci-acl-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        harden_private_dir(&d).unwrap();
        assert_eq!(foreign_writers(&d).unwrap(), Vec::<String>::new());
        apply_sddl(&d, "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICIIO;FA;;;WD)").unwrap();
        assert_eq!(foreign_writers(&d).unwrap(), Vec::<String>::new(), "salt kalıtım ACE'si dizinin kendisine uygulanmaz");
        apply_sddl(&d, "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1301bf;;;WD)").unwrap();
        let w = foreign_writers(&d).unwrap();
        assert!(w.iter().any(|x| x.starts_with("S-1-1-0 ")), "{w:?}");
        apply_sddl(&d, "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)").unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }
}
