//! Yerel koruma — Windows DPAPI (`CryptProtectData`, süreç hesabının kapsamı; backend servis hesabıyla
//! koşar). Modül anahtarı önbelleği bununla sarılır: dosya başka makineye/hesaba taşınınca açılmaz.
//! Diğer platformlarda `KORUMA_YOK` — çağıran önbelleği dosya izniyle (0600) tutar ya da hiç tutmaz.
use crate::outcome::{code, fail, Outcome};

/// Önbelleği bu amaca bağlayan ek entropi (başka bir DPAPI kullanıcısının sarması buraya geçmez).
pub const ENTROPY: &str = "tekserp/modul-onbellek/v1";

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            input: *const DataBlob,
            descr: *const u16,
            entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *const DataBlob,
            descr: *mut *mut u16,
            entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(mem: *mut c_void) -> *mut c_void;
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    fn blob(data: &[u8]) -> DataBlob {
        DataBlob { cb_data: data.len() as u32, pb_data: data.as_ptr().cast_mut() }
    }

    pub fn run(data: &[u8], entropy: &[u8], unprotect: bool) -> Option<Vec<u8>> {
        let input = blob(data);
        let ent = blob(entropy);
        let mut out = DataBlob { cb_data: 0, pb_data: null_mut() };
        // SAFETY: girdi blob'ları bu çağrı boyunca yaşayan dilimleri gösterir; çıktı DPAPI'nin ayırdığı
        // bellektir, kopyalanır ve LocalFree ile bırakılır.
        let ok = unsafe {
            if unprotect {
                CryptUnprotectData(&input, null_mut(), &ent, null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptProtectData(&input, null(), &ent, null_mut(), null_mut(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            }
        };
        if ok == 0 || out.pb_data.is_null() {
            return None;
        }
        // SAFETY: DPAPI başarıda `cb_data` baytlık geçerli bir tampon döndürür.
        let copy = unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec() };
        // SAFETY: tampon DPAPI'nin LocalAlloc'udur; bir kez bırakılır.
        unsafe { LocalFree(out.pb_data.cast()) };
        Some(copy)
    }
}

/// Veriyi yerel olarak sarar (`unprotect` = aç). Windows dışında `KORUMA_YOK`.
pub fn run(data: &[u8], unprotect: bool) -> Outcome<Vec<u8>> {
    #[cfg(windows)]
    {
        match win::run(data, ENTROPY.as_bytes(), unprotect) {
            Some(v) => Ok(v),
            None => fail(code::KORUMA_HATASI, "Yerel koruma (DPAPI) veriyi işleyemedi"),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (data, unprotect);
        fail(code::KORUMA_YOK, "Yerel koruma bu platformda yok (yalnız Windows DPAPI)")
    }
}
