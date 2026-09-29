// Parmak izi TOPLAMA — işletim sistemi etkenleri (f1..f4). DB'ye dokunmaz (F5 `fingerprint.ts`te):
// native lisans çekirdeği (`native/lisans-cekirdek/src/collect.rs`) bu dosyanın AYNASIDIR ve kâhin
// bekçisi aynı makinede iki toplayıcının aynı özeti verdiğini, Windows sondasının metninin birebir
// aynı olduğunu ölçer. Ham değer bu dosyadan dışarı yalnız `digestFingerprint`e gider.
import fs from "node:fs";
import path from "node:path";
import { runProcess } from "../../services/helpers/pg-tool.helper";
import { normalizeFactor, type FingerprintFactor, type RawFingerprint } from "./protocol";

/** OS sorgusu tek süreçte; asılırsa öldürülür ve etkenler "ölçülemedi" olur. */
export const PROBE_TIMEOUT_MS = 20_000;

/** İlk normalleşebilen aday kazanır (RAID birimi seri → ölçülemedi; BIOS yer tutucu → anakart). */
function firstUsable(factor: FingerprintFactor, candidates: ReadonlyArray<unknown>): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && normalizeFactor(factor, c) !== null) return c;
  }
  return null;
}

/** Get-PhysicalDisk ve Get-NetAdapter -IncludeHidden bilerek YOK (asılma ölçüldü). Native aynası satır satır aynı. */
export const WINDOWS_PROBE_LINES: readonly string[] = Object.freeze([
  "$ErrorActionPreference='SilentlyContinue'",
  "$o=[ordered]@{}",
  "try { $o.f1=(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid } catch {}",
  "try { $o.f2=(Get-CimInstance -ClassName Win32_ComputerSystemProduct -OperationTimeoutSec 10).UUID } catch {}",
  "try { $d=Get-Partition -DriveLetter ($env:SystemDrive.Substring(0,1)) | Get-Disk; $o.f3=[string]$d.UniqueId; $o.f3b=[string]$d.SerialNumber } catch {}",
  "try { $o.f4=(Get-CimInstance -ClassName Win32_BIOS -OperationTimeoutSec 10).SerialNumber } catch {}",
  "try { $o.f4b=(Get-CimInstance -ClassName Win32_BaseBoard -OperationTimeoutSec 10).SerialNumber } catch {}",
  "$o | ConvertTo-Json -Compress",
]);
const WINDOWS_PROBE = WINDOWS_PROBE_LINES.join("; ");

async function windowsFactors(): Promise<RawFingerprint> {
  const encoded = Buffer.from(WINDOWS_PROBE, "utf16le").toString("base64");
  const res = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { timeoutMs: PROBE_TIMEOUT_MS, captureStdout: true },
  );
  if (res.code !== 0 || !res.stdout) return {};
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(res.stdout.trim()) as Record<string, unknown>;
  } catch {
    return {};
  }
  return {
    f1: firstUsable("f1", [o.f1]),
    f2: firstUsable("f2", [o.f2]),
    f3: firstUsable("f3", [o.f3, o.f3b]),
    f4: firstUsable("f4", [o.f4, o.f4b]),
  };
}

function readSmall(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Kök dosya sisteminin fiziksel diski: mountinfo → /sys/dev/block → (bölümse) üst disk. */
function linuxRootDisk(): { name: string; devNo: string } | null {
  const mountinfo = readSmall("/proc/self/mountinfo");
  if (!mountinfo) return null;
  const line = mountinfo.split("\n").find((l) => l.split(" ")[4] === "/");
  const devNo = line?.split(" ")[2];
  if (!devNo || !/^\d+:\d+$/.test(devNo)) return null;
  try {
    let sysPath = fs.realpathSync(`/sys/dev/block/${devNo}`);
    const slaves = path.join(sysPath, "slaves");
    if (fs.existsSync(slaves)) {
      const first = fs.readdirSync(slaves)[0];
      if (!first) return null;
      sysPath = fs.realpathSync(path.join(slaves, first));
    }
    if (fs.existsSync(path.join(sysPath, "partition"))) sysPath = path.dirname(sysPath);
    const diskDevNo = readSmall(path.join(sysPath, "dev"));
    return diskDevNo ? { name: path.basename(sysPath), devNo: diskDevNo } : null;
  } catch {
    return null;
  }
}

function linuxDiskSerial(): string | null {
  const disk = linuxRootDisk();
  if (!disk) return null;
  const udev = readSmall(`/run/udev/data/b${disk.devNo}`);
  const fromUdev = udev
    ?.split("\n")
    .map((l) => /^E:ID_SERIAL_SHORT=(.+)$/.exec(l)?.[1] ?? /^E:ID_SERIAL=(.+)$/.exec(l)?.[1])
    .find((v): v is string => typeof v === "string");
  return firstUsable("f3", [
    fromUdev,
    readSmall(`/sys/block/${disk.name}/device/serial`),
    readSmall(`/sys/block/${disk.name}/serial`),
    readSmall(`/sys/block/${disk.name}/device/wwid`),
  ]);
}

function linuxFactors(): RawFingerprint {
  return {
    f1: firstUsable("f1", [readSmall("/etc/machine-id"), readSmall("/var/lib/dbus/machine-id")]),
    // DMI dosyaları çoğu dağıtımda yalnız root'a açık: servis kullanıcısında ölçülemedi.
    f2: firstUsable("f2", [readSmall("/sys/class/dmi/id/product_uuid")]),
    f3: linuxDiskSerial(),
    f4: firstUsable("f4", [readSmall("/sys/class/dmi/id/product_serial"), readSmall("/sys/class/dmi/id/board_serial")]),
  };
}

async function darwinFactors(): Promise<RawFingerprint> {
  const res = await runProcess("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
    timeoutMs: PROBE_TIMEOUT_MS,
    captureStdout: true,
  });
  const out = res.stdout ?? "";
  const pick = (name: string): string | null => new RegExp(`"${name}" = "([^"]+)"`).exec(out)?.[1] ?? null;
  return { f1: firstUsable("f1", [pick("IOPlatformUUID")]), f4: firstUsable("f4", [pick("IOPlatformSerialNumber")]) };
}

/** f1..f4 ham adayları; platform desteklenmiyorsa ya da sağlayıcı düşerse boş (ölçülemedi). */
export async function collectOsFactors(): Promise<RawFingerprint> {
  try {
    if (process.platform === "win32") return await windowsFactors();
    if (process.platform === "linux") return linuxFactors();
    if (process.platform === "darwin") return await darwinFactors();
  } catch {
    /* sağlayıcı arızası: etkenler ölçülemedi */
  }
  return {};
}
