//! Windows'a özgü parçalar: SCM kaydı/denetimi, olay günlüğü, iş nesnesi, konağın hizmet yapıştırıcısı.
//! Mac'te derlenmez; `cargo clippy --target x86_64-pc-windows-msvc` (kapı) ve CI Windows job'ı ölçer.
pub mod eventlog;
pub mod host_service;
pub mod job;
pub mod scm;

/// Win32 geniş dizgesi (NUL sonlu UTF-16).
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
