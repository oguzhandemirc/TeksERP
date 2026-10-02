//! Parmak izi TOPLAMA (işletim sistemi, çok yollu — K8) — TS `lib/license/fingerprint-os.ts` aynası. Her yolun ham
//! sonucu toplanır, seçim `paths.rs`te. Aynı makinede iki toplayıcı AYNI raporu ve özeti vermelidir: kabul edilen
//! küme TS toplayıcısıyla ölçüldü; native farklı okursa yükseltme sonrası parmak izi "uyuşmaz" olur. Windows'ta
//! bu yüzden AYNI PowerShell sondası koşulur (metin birebir, bekçi ölçer).
//! F5 (PostgreSQL `system_identifier`) DB bağlantısı ister: çağıran ham değeri verir.
// Linux dosya okur, süreç başlatmaz: süreç çalıştırıcısı orada kullanılmıyor.
#![cfg_attr(target_os = "linux", allow(dead_code))]
use crate::paths::Outcomes;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Sonda tek süreçtir; asılırsa öldürülür — o ana dek basılan yollar sayılır (TS `PROBE_TIMEOUT_MS`).
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(30_000);
/// TS `runProcess` gibi stdout 64 KB'ta kesilir.
const STDOUT_CAP: usize = 64 * 1024;

/// TS `WINDOWS_PROBE_LINES` (`"; "` ile birleşir). Get-PhysicalDisk ve Get-NetAdapter -IncludeHidden bilerek YOK
/// (asılma ölçüldü); ucuz kayıt defteri yolları önce, zaman aşımsız Get-Disk en son.
pub const WINDOWS_PROBE_LINES: [&str; 18] = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "function TkVal($y,$v){ @{y=$y;v=[string]$v} | ConvertTo-Json -Compress }",
    "function TkErr($y){ @{y=$y;h=1} | ConvertTo-Json -Compress }",
    "function TkWmi($q,$a){ $s=[wmisearcher]$q; $s.Options.Timeout=[TimeSpan]::FromSeconds(5); foreach($o in $s.Get()){ return $o[$a] }; return $null }",
    "try { TkVal 'f1.kayit' (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid } catch { TkErr 'f1.kayit' }",
    "try { TkVal 'f1.kayit-net64' ([Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine','Registry64').OpenSubKey('SOFTWARE\\Microsoft\\Cryptography').GetValue('MachineGuid')) } catch { TkErr 'f1.kayit-net64' }",
    "try { TkVal 'f2.donanim-kaydi' (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\HardwareConfig' -Name LastConfig).LastConfig } catch { TkErr 'f2.donanim-kaydi' }",
    "try { $b=[byte[]](Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\mssmbios\\Data' -Name SMBiosData).SMBiosData; $r=@{}; $i=8; while ($i+4 -le $b.Length) { $t=[int]$b[$i]; $l=[int]$b[$i+1]; if ($l -lt 4) { break }; $j=$i+$l; $k=$j; while ($k+1 -lt $b.Length -and -not ($b[$k] -eq 0 -and $b[$k+1] -eq 0)) { $k++ }; $z=@(); if ($k -gt $j) { $z=@([Text.Encoding]::UTF8.GetString($b,$j,$k-$j) -split [char]0) }; if (($t -eq 1 -or $t -eq 2) -and -not $r.ContainsKey($t) -and $l -ge 8) { $n=[int]$b[$i+7]; $r[$t]=$(if ($n -ge 1 -and $n -le $z.Count) { $z[$n-1] } else { '' }) }; if ($t -eq 127) { break }; $i=$k+2 }; TkVal 'f4.smbios-sistem' $r[1]; TkVal 'f4.smbios-anakart' $r[2] } catch { TkErr 'f4.smbios-sistem'; TkErr 'f4.smbios-anakart' }",
    "try { TkVal 'f2.cim' (Get-CimInstance -ClassName Win32_ComputerSystemProduct -OperationTimeoutSec 5 | Select-Object -First 1).UUID } catch { TkErr 'f2.cim' }",
    "try { TkVal 'f4.cim-bios' (Get-CimInstance -ClassName Win32_BIOS -OperationTimeoutSec 5 | Select-Object -First 1).SerialNumber } catch { TkErr 'f4.cim-bios' }",
    "try { TkVal 'f4.cim-anakart' (Get-CimInstance -ClassName Win32_BaseBoard -OperationTimeoutSec 5 | Select-Object -First 1).SerialNumber } catch { TkErr 'f4.cim-anakart' }",
    "try { TkVal 'f2.wmi' (TkWmi 'SELECT UUID FROM Win32_ComputerSystemProduct' 'UUID') } catch { TkErr 'f2.wmi' }",
    "try { TkVal 'f4.wmi-bios' (TkWmi 'SELECT SerialNumber FROM Win32_BIOS' 'SerialNumber') } catch { TkErr 'f4.wmi-bios' }",
    "try { TkVal 'f4.wmi-anakart' (TkWmi 'SELECT SerialNumber FROM Win32_BaseBoard' 'SerialNumber') } catch { TkErr 'f4.wmi-anakart' }",
    "try { $d=Get-CimInstance -Namespace root/Microsoft/Windows/Storage -ClassName MSFT_Disk -Filter 'IsBoot=TRUE' -OperationTimeoutSec 5 | Select-Object -First 1; TkVal 'f3.msft-disk-seri' $d.SerialNumber; TkVal 'f3.msft-disk-kimlik' $d.UniqueId } catch { TkErr 'f3.msft-disk-seri'; TkErr 'f3.msft-disk-kimlik' }",
    "try { $l=Get-CimInstance -ClassName Win32_LogicalDisk -Filter \"DeviceID='$($env:SystemDrive)'\" -OperationTimeoutSec 5; $p=Get-CimAssociatedInstance -InputObject $l -ResultClassName Win32_DiskPartition -OperationTimeoutSec 5 | Select-Object -First 1; TkVal 'f3.win32-disk-seri' (Get-CimAssociatedInstance -InputObject $p -ResultClassName Win32_DiskDrive -OperationTimeoutSec 5 | Select-Object -First 1).SerialNumber } catch { TkErr 'f3.win32-disk-seri' }",
    "try { $d=Get-Partition -DriveLetter ($env:SystemDrive.Substring(0,1)) | Get-Disk | Select-Object -First 1; TkVal 'f3.disk-seri' $d.SerialNumber; TkVal 'f3.disk-kimlik' $d.UniqueId } catch { TkErr 'f3.disk-seri'; TkErr 'f3.disk-kimlik' }",
];

struct ProcessOutput {
    code: Option<i32>,
    stdout: String,
}

/// Zaman aşımlı süreç; stdout UTF-8 (geçersiz bayt U+FFFD, Node `toString()` gibi). Öldürülen sürecin o ana dek
/// yazdığı da döner.
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

pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(js_whitespace)
}

/// TS `readOutcome`: yalnız ENOENT/ENOTDIR "yok"tur (`Some("")`); başka hata OKUNAMADI (`None`).
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn read_outcome(file: &str) -> Option<String> {
    match std::fs::read(file) {
        Ok(bytes) => Some(js_trim(&String::from_utf8_lossy(&bytes)).to_string()),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => Some(String::new()),
        Err(_) => None,
    }
}

#[cfg(windows)]
fn windows_outcomes() -> Outcomes {
    let script = WINDOWS_PROBE_LINES.join("; ");
    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
    let out = run_process("powershell.exe", &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded]);
    // Çıkış kodu bakılmaz: zaman aşımında öldürülen süreç de o ana dek okunan yolları bildirmiş olabilir.
    let _ = out.code;
    crate::paths::parse_windows_output(&out.stdout)
}

#[cfg(target_os = "linux")]
mod linux {
    use super::read_outcome;
    use crate::paths::{smbios_serial, smbios_uuid, Outcomes};
    use std::path::{Path, PathBuf};

    fn readdir_first_sorted(dir: &Path) -> Option<String> {
        // Node `readdirSync` libuv scandir'i bayt sırasıyla sıralar; OS sırasına güvenilmez.
        let mut names: Vec<String> = std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect();
        names.sort();
        names.into_iter().next()
    }

    /// Kök dosya sisteminin fiziksel diski: mountinfo → /sys/dev/block → (bölümse) üst disk. Görünmüyorsa `None`.
    fn root_disk() -> Option<(String, String)> {
        let mountinfo = read_outcome("/proc/self/mountinfo").filter(|m| !m.is_empty())?;
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
        let disk_dev_no = read_outcome(sys_path.join("dev").to_str()?).filter(|d| !d.is_empty())?;
        let name = sys_path.file_name()?.to_str()?.to_string();
        Some((name, disk_dev_no))
    }

    /// JS `/^E:ID_SERIAL_SHORT=(.+)$/` — `.` satır sonlandırıcılarını (\r, U+2028, U+2029) içermez.
    fn udev_value(line: &str, prefix: &str) -> Option<String> {
        let rest = line.strip_prefix(prefix)?;
        let bad = |c: char| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}');
        (!rest.is_empty() && !rest.chars().any(bad)).then(|| rest.to_string())
    }

    fn udev_serial(dev_no: &str) -> Option<String> {
        let udev = read_outcome(&format!("/run/udev/data/b{dev_no}"))?;
        Some(
            udev.split('\n')
                .find_map(|l| udev_value(l, "E:ID_SERIAL_SHORT=").or_else(|| udev_value(l, "E:ID_SERIAL=")))
                .unwrap_or_default(),
        )
    }

    /// TS `smbiosOutcome`: yapı dosyası yoksa boş, okunamıyorsa OKUNAMADI.
    fn smbios_outcome(kind: u8, pick: fn(&[u8]) -> String) -> Option<String> {
        match std::fs::read(format!("/sys/firmware/dmi/entries/{kind}-0/raw")) {
            Ok(bytes) => Some(pick(&bytes)),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => Some(String::new()),
            Err(_) => None,
        }
    }

    pub fn outcomes() -> Outcomes {
        let disk = root_disk();
        // Kök fiziksel bir diskte değilse (konteyner overlay'i) f3'ün hiçbir yolu yoktur: okundu, değer yok.
        let disk_file = |rel: &str| -> Option<String> {
            disk.as_ref().map_or(Some(String::new()), |(name, _)| read_outcome(&format!("/sys/block/{name}/{rel}")))
        };
        let pairs: [(&str, Option<String>); 12] = [
            ("f1.machine-id", read_outcome("/etc/machine-id")),
            ("f1.dbus-machine-id", read_outcome("/var/lib/dbus/machine-id")),
            // DMI dosyaları çoğu dağıtımda yalnız root'a açık: servis kullanıcısında OKUNAMADI (önbellek köprüler).
            ("f2.dmi-uuid", read_outcome("/sys/class/dmi/id/product_uuid")),
            ("f2.smbios-uuid", smbios_outcome(1, smbios_uuid)),
            ("f3.udev-seri", disk.as_ref().map_or(Some(String::new()), |(_, dev_no)| udev_serial(dev_no))),
            ("f3.sysfs-aygit-seri", disk_file("device/serial")),
            ("f3.sysfs-seri", disk_file("serial")),
            ("f3.sysfs-wwid", disk_file("device/wwid")),
            ("f4.dmi-sistem", read_outcome("/sys/class/dmi/id/product_serial")),
            ("f4.smbios-sistem", smbios_outcome(1, smbios_serial)),
            ("f4.dmi-anakart", read_outcome("/sys/class/dmi/id/board_serial")),
            ("f4.smbios-anakart", smbios_outcome(2, smbios_serial)),
        ];
        pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
    }
}

#[cfg(target_os = "macos")]
fn darwin_outcomes() -> Outcomes {
    let out = run_process("/usr/sbin/ioreg", &["-rd1", "-c", "IOPlatformExpertDevice"]);
    let mut o = Outcomes::new();
    if out.code != Some(0) {
        o.insert("f1.ioreg-uuid".into(), None);
        o.insert("f4.ioreg-seri".into(), None);
        return o;
    }
    // TS `/"<ad>" = "([^"]+)"/.exec` — soldan ilk EŞLEŞEN konum (boş değerli geçiş atlanır).
    let pick = |name: &str| -> String {
        let needle = format!("\"{name}\" = \"");
        out.stdout
            .match_indices(&needle)
            .find_map(|(at, _)| {
                let rest = &out.stdout[at + needle.len()..];
                let end = rest.find('"')?;
                (end > 0).then(|| rest[..end].to_string())
            })
            .unwrap_or_default()
    };
    o.insert("f1.ioreg-uuid".into(), Some(pick("IOPlatformUUID")));
    o.insert("f4.ioreg-seri".into(), Some(pick("IOPlatformSerialNumber")));
    o
}

/// Bu makinede her yolun ham sonucu (TS `collectOsOutcomes`; seçim `api::collected_value`); platform tabloda yoksa `None`.
pub fn os_outcomes() -> (Option<&'static str>, Outcomes) {
    #[cfg(windows)]
    {
        (Some("win32"), windows_outcomes())
    }
    #[cfg(target_os = "linux")]
    {
        (Some("linux"), linux::outcomes())
    }
    #[cfg(target_os = "macos")]
    {
        (Some("darwin"), darwin_outcomes())
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        (None, Outcomes::new())
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
    fn read_outcome_separates_missing_from_unreadable() {
        let path = std::env::temp_dir().join(format!("lisans-read-outcome-{}", std::process::id()));
        std::fs::write(&path, "\u{feff}  abc123\n").unwrap();
        assert_eq!(read_outcome(path.to_str().unwrap()).as_deref(), Some("abc123"));
        std::fs::write(&path, " \n\t").unwrap();
        assert_eq!(read_outcome(path.to_str().unwrap()).as_deref(), Some(""), "yalnız boşluk → okundu, değer yok");
        let _ = std::fs::remove_file(&path);
        assert_eq!(read_outcome("/olmayan/dosya").as_deref(), Some(""), "ENOENT → yok (kesin cevap)");
    }

    // Dizini dosya gibi okumak POSIX'te EISDIR'dir; Windows'ta "yok" sınıfına düşer, okunamazlık benzetimi olamaz.
    #[cfg(unix)]
    #[test]
    fn read_outcome_unreadable_is_okunamadi() {
        let dir = std::env::temp_dir();
        assert_eq!(read_outcome(dir.to_str().unwrap()), None, "dizin okunamaz (EISDIR) → OKUNAMADI");
    }

    #[cfg(windows)]
    #[test]
    fn read_outcome_unreadable_is_okunamadi() {
        use std::os::windows::fs::OpenOptionsExt;
        let path = std::env::temp_dir().join(format!("lisans-read-outcome-kilit-{}", std::process::id()));
        std::fs::write(&path, "abc123").unwrap();
        // Paylaşımsız açık tutamak: başka açış ERROR_SHARING_VIOLATION alır — dosya VAR ama okunamaz.
        let lock = std::fs::OpenOptions::new().read(true).share_mode(0).open(&path).unwrap();
        let got = read_outcome(path.to_str().unwrap());
        drop(lock);
        let _ = std::fs::remove_file(&path);
        assert_eq!(got, None, "paylaşım ihlali → OKUNAMADI");
    }
}
