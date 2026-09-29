//! Parmak izi TOPLAMA (işletim sistemi) — TS `lib/license/fingerprint-os.ts` aynası. Aynı
//! makinede iki yol AYNI ham değeri okumalıdır: Faz 1 kiralarının kabul edilen kümesi TS
//! toplayıcısıyla ölçüldü; native farklı okursa yükseltme sonrası parmak izi "uyuşmaz" olur.
//! Windows'ta bu yüzden AYNI PowerShell sondası koşulur (metin birebir, bekçi ölçer).
//! F5 (PostgreSQL `system_identifier`) DB bağlantısı ister: çağıran ham değeri verir.
// Linux dosya okur, süreç başlatmaz: süreç çalıştırıcısı orada kullanılmıyor.
#![cfg_attr(target_os = "linux", allow(dead_code))]
use crate::fingerprint::normalize_factor;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// OS sorgusu tek süreçte; asılırsa öldürülür ve etkenler "ölçülemedi" olur.
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(20_000);
/// TS `runProcess` gibi stdout 64 KB'ta kesilir.
const STDOUT_CAP: usize = 64 * 1024;

/// TS `WINDOWS_PROBE` satırları (`"; "` ile birleşir). Get-PhysicalDisk ve
/// Get-NetAdapter -IncludeHidden bilerek YOK (asılma ölçüldü).
pub const WINDOWS_PROBE_LINES: [&str; 8] = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$o=[ordered]@{}",
    "try { $o.f1=(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid } catch {}",
    "try { $o.f2=(Get-CimInstance -ClassName Win32_ComputerSystemProduct -OperationTimeoutSec 10).UUID } catch {}",
    "try { $d=Get-Partition -DriveLetter ($env:SystemDrive.Substring(0,1)) | Get-Disk; $o.f3=[string]$d.UniqueId; $o.f3b=[string]$d.SerialNumber } catch {}",
    "try { $o.f4=(Get-CimInstance -ClassName Win32_BIOS -OperationTimeoutSec 10).SerialNumber } catch {}",
    "try { $o.f4b=(Get-CimInstance -ClassName Win32_BaseBoard -OperationTimeoutSec 10).SerialNumber } catch {}",
    "$o | ConvertTo-Json -Compress",
];

/// f1..f4 ham adaylar (f5 çağırandan).
pub type RawOs = [Option<String>; 4];

/// İlk normalleşebilen aday kazanır; HAM hâli döner (özet normalleştirmeyi kendisi yapar).
fn first_usable(factor: &str, candidates: &[Option<String>]) -> Option<String> {
    candidates.iter().flatten().find(|c| normalize_factor(factor, Some(c)).is_some()).cloned()
}

struct ProcessOutput {
    #[cfg_attr(not(windows), allow(dead_code))]
    code: Option<i32>,
    stdout: String,
}

/// Zaman aşımlı süreç; stdout UTF-8 (geçersiz bayt U+FFFD, Node `toString()` gibi).
fn run_process(program: &str, args: &[&str]) -> ProcessOutput {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(mut child) = command.spawn() else {
        return ProcessOutput { code: None, stdout: String::new() };
    };
    let mut pipe = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = pipe.as_mut() {
            let _ = p.take(STDOUT_CAP as u64).read_to_end(&mut buf);
        }
        buf
    });
    let started = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) if started.elapsed() >= PROBE_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => break None,
        }
    };
    let bytes = reader.join().unwrap_or_default();
    ProcessOutput { code, stdout: String::from_utf8_lossy(&bytes).into_owned() }
}

/// JS `String.prototype.trim` beyaz boşluk kümesi (Rust `char::is_whitespace` ile AYNI DEĞİL:
/// JS U+FEFF'i kırpar, U+0085'i kırpmaz).
fn js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(js_whitespace)
}

#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn read_small(file: &str) -> Option<String> {
    let bytes = std::fs::read(file).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let trimmed = js_trim(&text);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[cfg(windows)]
fn windows_factors() -> RawOs {
    let script = WINDOWS_PROBE_LINES.join("; ");
    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
    let out = run_process("powershell.exe", &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]);
    if out.code != Some(0) || out.stdout.is_empty() {
        return Default::default();
    }
    let Ok(serde_json::Value::Object(o)) = serde_json::from_str::<serde_json::Value>(js_trim(&out.stdout)) else {
        return Default::default();
    };
    let s = |k: &str| o.get(k).and_then(|v| v.as_str()).map(str::to_string);
    [
        first_usable("f1", &[s("f1")]),
        first_usable("f2", &[s("f2")]),
        first_usable("f3", &[s("f3"), s("f3b")]),
        first_usable("f4", &[s("f4"), s("f4b")]),
    ]
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{first_usable, read_small, RawOs};
    use std::path::{Path, PathBuf};

    fn readdir_first_sorted(dir: &Path) -> Option<String> {
        // Node `readdirSync` libuv scandir'i bayt sırasıyla sıralar; OS sırasına güvenilmez.
        let mut names: Vec<String> = std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect();
        names.sort();
        names.into_iter().next()
    }

    /// Kök dosya sisteminin fiziksel diski: mountinfo → /sys/dev/block → (bölümse) üst disk.
    fn root_disk() -> Option<(String, String)> {
        let mountinfo = read_small("/proc/self/mountinfo")?;
        let line = mountinfo.split('\n').find(|l| l.split(' ').nth(4) == Some("/"))?;
        let dev_no = line.split(' ').nth(2)?;
        let valid = dev_no.split_once(':').is_some_and(|(a, b)| {
            !a.is_empty() && !b.is_empty() && a.bytes().all(|c| c.is_ascii_digit()) && b.bytes().all(|c| c.is_ascii_digit())
        });
        if !valid {
            return None;
        }
        let mut sys_path: PathBuf = std::fs::canonicalize(format!("/sys/dev/block/{dev_no}")).ok()?;
        let slaves = sys_path.join("slaves");
        if slaves.exists() {
            let first = readdir_first_sorted(&slaves)?;
            sys_path = std::fs::canonicalize(slaves.join(first)).ok()?;
        }
        if sys_path.join("partition").exists() {
            sys_path = sys_path.parent()?.to_path_buf();
        }
        let disk_dev_no = read_small(sys_path.join("dev").to_str()?)?;
        let name = sys_path.file_name()?.to_str()?.to_string();
        Some((name, disk_dev_no))
    }

    /// JS `/^E:ID_SERIAL_SHORT=(.+)$/` — `.` satır sonlandırıcılarını (\r, U+2028, U+2029) içermez.
    fn udev_value(line: &str, prefix: &str) -> Option<String> {
        let rest = line.strip_prefix(prefix)?;
        let bad = |c: char| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}');
        (!rest.is_empty() && !rest.chars().any(bad)).then(|| rest.to_string())
    }

    fn disk_serial() -> Option<String> {
        let (name, dev_no) = root_disk()?;
        let udev = read_small(&format!("/run/udev/data/b{dev_no}"));
        let from_udev = udev
            .as_deref()
            .and_then(|u| u.split('\n').find_map(|l| udev_value(l, "E:ID_SERIAL_SHORT=").or_else(|| udev_value(l, "E:ID_SERIAL="))));
        first_usable(
            "f3",
            &[
                from_udev,
                read_small(&format!("/sys/block/{name}/device/serial")),
                read_small(&format!("/sys/block/{name}/serial")),
                read_small(&format!("/sys/block/{name}/device/wwid")),
            ],
        )
    }

    pub fn factors() -> RawOs {
        [
            first_usable("f1", &[read_small("/etc/machine-id"), read_small("/var/lib/dbus/machine-id")]),
            // DMI dosyaları çoğu dağıtımda yalnız root'a açık: servis kullanıcısında ölçülemedi.
            first_usable("f2", &[read_small("/sys/class/dmi/id/product_uuid")]),
            disk_serial(),
            first_usable("f4", &[read_small("/sys/class/dmi/id/product_serial"), read_small("/sys/class/dmi/id/board_serial")]),
        ]
    }
}

#[cfg(target_os = "macos")]
fn darwin_factors() -> RawOs {
    let out = run_process("/usr/sbin/ioreg", &["-rd1", "-c", "IOPlatformExpertDevice"]);
    // TS `/"<ad>" = "([^"]+)"/.exec` — soldan ilk EŞLEŞEN konum (boş değerli geçiş atlanır).
    let pick = |name: &str| -> Option<String> {
        let needle = format!("\"{name}\" = \"");
        out.stdout.match_indices(&needle).find_map(|(at, _)| {
            let rest = &out.stdout[at + needle.len()..];
            let end = rest.find('"')?;
            (end > 0).then(|| rest[..end].to_string())
        })
    };
    [first_usable("f1", &[pick("IOPlatformUUID")]), None, None, first_usable("f4", &[pick("IOPlatformSerialNumber")])]
}

/// f1..f4 ham adayları — platform desteklenmiyorsa ya da sağlayıcı düşerse hepsi `None`.
pub fn os_factors() -> RawOs {
    #[cfg(windows)]
    {
        windows_factors()
    }
    #[cfg(target_os = "linux")]
    {
        linux::factors()
    }
    #[cfg(target_os = "macos")]
    {
        darwin_factors()
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_trim_matches_js() {
        assert_eq!(js_trim("\u{feff} abc \n"), "abc");
        assert_eq!(js_trim("\u{85}abc"), "\u{85}abc", "JS NEL'i kırpmaz");
    }

    #[test]
    fn read_small_trims_like_node() {
        let path = std::env::temp_dir().join(format!("lisans-read-small-{}", std::process::id()));
        std::fs::write(&path, "\u{feff}  abc123\n").unwrap();
        assert_eq!(read_small(path.to_str().unwrap()).as_deref(), Some("abc123"));
        std::fs::write(&path, " \n\t").unwrap();
        assert_eq!(read_small(path.to_str().unwrap()), None, "yalnız boşluk → ölçülemedi");
        let _ = std::fs::remove_file(&path);
        assert_eq!(read_small("/olmayan/dosya"), None);
    }

    #[test]
    fn first_usable_returns_raw() {
        let got = first_usable("f3", &[Some("Volume0".into()), Some("S4EV-NX0N".into())]);
        assert_eq!(got.as_deref(), Some("S4EV-NX0N"));
    }
}
