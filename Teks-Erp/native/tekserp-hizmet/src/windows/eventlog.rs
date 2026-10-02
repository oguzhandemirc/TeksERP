//! Windows Olay Günlüğü (Uygulama): kaynak kaydı `hizmet-kur`da, yazım hizmet çalışırken. İleti
//! dosyası .NET'in `EventLogMessages.dll`idir (her olay kimliği için `%1`) — kendi ileti tablomuzu
//! derlemeden Olay Görüntüleyicisi metni düz gösterir; dosya yoksa olay yine yazılır.
use super::wide;
use crate::logfile::Level;
use windows_sys::Win32::System::EventLog::{
    DeregisterEventSource, RegisterEventSourceW, ReportEventW, EVENTLOG_ERROR_TYPE, EVENTLOG_INFORMATION_TYPE, EVENTLOG_WARNING_TYPE,
};
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_WRITE, REG_DWORD, REG_EXPAND_SZ,
    REG_OPTION_NON_VOLATILE,
};

const REGISTRY_PATH: &str = "SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application\\";
const MESSAGE_FILE: &str = "%SystemRoot%\\Microsoft.NET\\Framework64\\v4.0.30319\\EventLogMessages.dll";

pub fn register_source(source: &str) -> Result<(), String> {
    let key_name = wide(&format!("{REGISTRY_PATH}{source}"));
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: parametreler bu çağrı boyunca yaşayan NUL sonlu geniş dizgeleri ve yerel çıktıyı gösterir.
    let r = unsafe {
        RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            key_name.as_ptr(),
            0,
            std::ptr::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            std::ptr::null(),
            &mut key,
            std::ptr::null_mut(),
        )
    };
    if r != 0 {
        return Err(format!("olay kaynağı anahtarı açılamadı (Win32 {r})"));
    }
    let file = wide(MESSAGE_FILE);
    let types: u32 = 7;
    let (message_name, types_name) = (wide("EventMessageFile"), wide("TypesSupported"));
    // SAFETY: anahtar yukarıda açıldı; veri işaretçileri ve bayt boyları yerel tamponlarındır.
    let (r1, r2) = unsafe {
        let r1 = RegSetValueExW(key, message_name.as_ptr(), 0, REG_EXPAND_SZ, file.as_ptr().cast(), (file.len() * 2) as u32);
        let r2 = RegSetValueExW(key, types_name.as_ptr(), 0, REG_DWORD, (&raw const types).cast(), 4);
        RegCloseKey(key);
        (r1, r2)
    };
    if r1 != 0 || r2 != 0 {
        return Err(format!("olay kaynağı değerleri yazılamadı (Win32 {r1}/{r2})"));
    }
    Ok(())
}

pub fn remove_source(source: &str) {
    let key_name = wide(&format!("{REGISTRY_PATH}{source}"));
    // SAFETY: NUL sonlu geniş dizge; sonuç (yoksa hata) bilerek yok sayılır.
    unsafe {
        RegDeleteTreeW(HKEY_LOCAL_MACHINE, key_name.as_ptr());
    }
}

/// Olayı yazar; kaynak kayıtlı değilse ya da günlük doluysa sessizce vazgeçer (dosya günlüğü ayrıca var).
pub fn write(source: &str, level: Level, message: &str) {
    let name = wide(source);
    // SAFETY: NUL sonlu geniş dizge; tutamaç aşağıda bırakılır.
    let h = unsafe { RegisterEventSourceW(std::ptr::null(), name.as_ptr()) };
    if h.is_null() {
        return;
    }
    let (kind, id) = match level {
        Level::Info => (EVENTLOG_INFORMATION_TYPE, 1000),
        Level::Warn => (EVENTLOG_WARNING_TYPE, 2000),
        Level::Error => (EVENTLOG_ERROR_TYPE, 3000),
    };
    let text = wide(message);
    let strings = [text.as_ptr()];
    // SAFETY: tutamaç geçerli; tek dizge dizisi bu çağrı boyunca yaşar.
    unsafe {
        ReportEventW(h, kind, 0, id, std::ptr::null_mut(), 1, 0, strings.as_ptr(), std::ptr::null());
        DeregisterEventSource(h);
    }
}
