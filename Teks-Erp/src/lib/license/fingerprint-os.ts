// Parmak izi TOPLAMA — işletim sistemi etkenleri (f1..f4), ÇOK YOLLU (K8). DB'ye dokunmaz (F5 `fingerprint.ts`te):
// her yolun ham sonucu toplanır, seçim `fingerprint-paths.ts`te. Native lisans çekirdeği
// (`native/lisans-cekirdek/src/collect.rs`) bu dosyanın AYNASIDIR: Windows sondasının metni birebir aynı (kâhin
// §0d), aynı makinede iki toplayıcı aynı raporu ve özeti verir (§6a). Ham değer bu dosyadan dışarı yalnız
// `digestFingerprint`e gider.
import fs from "node:fs";
import path from "node:path";
import { runProcess } from "../../services/helpers/pg-tool.helper";
import { parseWindowsProbeOutput, type PathOutcomes, type ProbePlatform } from "./fingerprint-paths";

/**
 * Sonda tek süreçtir; asılırsa öldürülür — o ana dek basılan yollar sayılır, gelmeyenler OKUNAMADI. Ölçülen en uzun
 * koşum 5,0 sn (thinkpad-1, NT SERVICE sanal hesabın ilk profili; yönetici 2,3 sn): tavan bunun ~6 katı.
 */
export const PROBE_TIMEOUT_MS = 30_000;

/**
 * Satır başına bir yol (`{"y","v"}` ya da hata `{"y","h":1}`); ucuz kayıt defteri yolları ÖNCE koşar, zaman aşımı
 * parametresi olmayan Get-Disk EN SON. Get-PhysicalDisk ve Get-NetAdapter -IncludeHidden bilerek YOK (asılma
 * ölçüldü). Native aynası satır satır aynı.
 */
export const WINDOWS_PROBE_LINES: readonly string[] = Object.freeze([
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
]);
const WINDOWS_PROBE = WINDOWS_PROBE_LINES.join("; ");

async function windowsOutcomes(): Promise<Record<string, string | null>> {
  const encoded = Buffer.from(WINDOWS_PROBE, "utf16le").toString("base64");
  const res = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { timeoutMs: PROBE_TIMEOUT_MS, captureStdout: true },
  );
  // Çıkış kodu bakılmaz: zaman aşımında öldürülen süreç de o ana dek okunan yolları bildirmiş olabilir.
  return parseWindowsProbeOutput(res.stdout ?? "");
}

/** Yalnız ENOENT/ENOTDIR "yok"tur (boş metin = okundu, değer yok); başka hata OKUNAMADI (`null`). */
function readOutcome(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR" ? "" : null;
  }
}

function readBytesOutcome(file: string): Buffer | null | "" {
  try {
    return fs.readFileSync(file);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR" ? "" : null;
  }
}

/** SMBIOS yapısının metin bölümü (biçimli alanın ardından `\0` ayrılmış, `\0\0` ile biten). */
export function smbiosStrings(entry: Uint8Array): string[] {
  const len = entry.length >= 2 ? entry[1] : 0;
  if (len < 4 || len > entry.length) return [];
  let end = len;
  while (end + 1 < entry.length && !(entry[end] === 0 && entry[end + 1] === 0)) end++;
  if (end <= len) return [];
  return Buffer.from(entry.subarray(len, end)).toString("utf8").split("\0");
}

/** Linux `/sys/firmware/dmi/entries/<tip>-0/raw`: tip 1/2 seri metni (yapı yok ya da indeks boşsa boş). */
export function smbiosSerial(entry: Uint8Array): string {
  if (entry.length < 8 || entry[1] < 8) return "";
  const index = entry[7];
  const strings = smbiosStrings(entry);
  return index >= 1 && index <= strings.length ? strings[index - 1] : "";
}

/** Tip 1 UUID'si, SMBIOS 2.6+ bayt sırasıyla (çekirdeğin `product_uuid` biçimi); yapı kısaysa boş. */
export function smbiosUuid(entry: Uint8Array): string {
  if (entry.length < 25 || entry[1] < 25) return "";
  const b = [...entry.subarray(8, 24)].map((x) => x.toString(16).padStart(2, "0"));
  const order = [3, 2, 1, 0, -1, 5, 4, -1, 7, 6, -1, 8, 9, -1, 10, 11, 12, 13, 14, 15];
  return order.map((i) => (i < 0 ? "-" : b[i])).join("");
}

function smbiosOutcome(type: 1 | 2, pick: (entry: Uint8Array) => string): string | null {
  const bytes = readBytesOutcome(`/sys/firmware/dmi/entries/${type}-0/raw`);
  return bytes === null || bytes === "" ? bytes : pick(bytes);
}

/** Kök dosya sisteminin fiziksel diski: mountinfo → /sys/dev/block → (bölümse) üst disk. Görünmüyorsa `null`. */
function linuxRootDisk(): { name: string; devNo: string } | null {
  const mountinfo = readOutcome("/proc/self/mountinfo");
  if (!mountinfo) return null;
  const line = mountinfo.split("\n").find((l) => l.split(" ")[4] === "/");
  const devNo = line?.split(" ")[2];
  if (!devNo || !/^[0-9]+:[0-9]+$/.test(devNo)) return null;
  try {
    let sysPath = fs.realpathSync(`/sys/dev/block/${devNo}`);
    const slaves = path.join(sysPath, "slaves");
    if (fs.existsSync(slaves)) {
      const first = fs.readdirSync(slaves)[0];
      if (!first) return null;
      sysPath = fs.realpathSync(path.join(slaves, first));
    }
    if (fs.existsSync(path.join(sysPath, "partition"))) sysPath = path.dirname(sysPath);
    const diskDevNo = readOutcome(path.join(sysPath, "dev"));
    return diskDevNo ? { name: path.basename(sysPath), devNo: diskDevNo } : null;
  } catch {
    return null;
  }
}

/** udev veritabanında ilk `ID_SERIAL_SHORT` / `ID_SERIAL` satırı (satır içinde kısa olan önce). */
function udevSerial(devNo: string): string | null {
  const udev = readOutcome(`/run/udev/data/b${devNo}`);
  if (udev === null) return null;
  return (
    udev
      .split("\n")
      .map((l) => /^E:ID_SERIAL_SHORT=(.+)$/.exec(l)?.[1] ?? /^E:ID_SERIAL=(.+)$/.exec(l)?.[1])
      .find((v): v is string => typeof v === "string") ?? ""
  );
}

function linuxOutcomes(): Record<string, string | null> {
  const disk = linuxRootDisk();
  // Kök fiziksel bir diskte değilse (konteyner overlay'i) f3'ün hiçbir yolu yoktur: okundu, değer yok.
  const diskFile = (rel: string): string | null => (disk ? readOutcome(`/sys/block/${disk.name}/${rel}`) : "");
  return {
    "f1.machine-id": readOutcome("/etc/machine-id"),
    "f1.dbus-machine-id": readOutcome("/var/lib/dbus/machine-id"),
    // DMI dosyaları çoğu dağıtımda yalnız root'a açık: servis kullanıcısında OKUNAMADI (önbellek köprüler).
    "f2.dmi-uuid": readOutcome("/sys/class/dmi/id/product_uuid"),
    "f2.smbios-uuid": smbiosOutcome(1, smbiosUuid),
    "f3.udev-seri": disk ? udevSerial(disk.devNo) : "",
    "f3.sysfs-aygit-seri": diskFile("device/serial"),
    "f3.sysfs-seri": diskFile("serial"),
    "f3.sysfs-wwid": diskFile("device/wwid"),
    "f4.dmi-sistem": readOutcome("/sys/class/dmi/id/product_serial"),
    "f4.smbios-sistem": smbiosOutcome(1, smbiosSerial),
    "f4.dmi-anakart": readOutcome("/sys/class/dmi/id/board_serial"),
    "f4.smbios-anakart": smbiosOutcome(2, smbiosSerial),
  };
}

async function darwinOutcomes(): Promise<Record<string, string | null>> {
  const res = await runProcess("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
    timeoutMs: PROBE_TIMEOUT_MS,
    captureStdout: true,
  });
  if (res.code !== 0 || res.spawnError) return { "f1.ioreg-uuid": null, "f4.ioreg-seri": null };
  const out = res.stdout ?? "";
  const pick = (name: string): string => new RegExp(`"${name}" = "([^"]+)"`).exec(out)?.[1] ?? "";
  return { "f1.ioreg-uuid": pick("IOPlatformUUID"), "f4.ioreg-seri": pick("IOPlatformSerialNumber") };
}

/** Bu sürecin platform adı toplayıcı tablosunda yoksa `null` (etkenler OKUNAMADI). */
export function probePlatform(platform: string = process.platform): ProbePlatform | null {
  return platform === "win32" || platform === "linux" || platform === "darwin" ? platform : null;
}

async function outcomesFor(platform: ProbePlatform): Promise<Record<string, string | null>> {
  if (platform === "win32") return windowsOutcomes();
  if (platform === "linux") return linuxOutcomes();
  return darwinOutcomes();
}

/** Bu makinede her yolun ham sonucu (seçim `collectedFrom`da); sağlayıcı düşerse gelmeyen her yol OKUNAMADI. */
export async function collectOsOutcomes(): Promise<{ readonly platform: ProbePlatform | null; readonly outcomes: PathOutcomes }> {
  const platform = probePlatform();
  if (!platform) return { platform, outcomes: {} };
  try {
    return { platform, outcomes: await outcomesFor(platform) };
  } catch {
    return { platform, outcomes: {} };
  }
}
