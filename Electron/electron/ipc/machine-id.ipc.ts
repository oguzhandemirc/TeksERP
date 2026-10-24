// Cihaz kimliği köprüsü (`device-identity:*`): makine özeti + yerel kimliğin üç durumlu okunuşu.
// Ham donanım kimliği yalnız bu süreçte, bellekte yaşar; log'a yazılmaz.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import log from "electron-log/main.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import type { DeviceIdentityDescription, HwSource, LocalIdRead } from "../../shared/ipc-contract.js";
import {
  buildHwClaim,
  parseLinuxMachineId,
  parseMacPlatformUuid,
  parseWindowsMachineGuid,
  sourceForPlatform,
} from "../device-identity/machine-id.core.js";
import { inspectSecureValue, writeSecureValue } from "./secure-store.ipc.js";
import { readPinnedInstallationId } from "./discovery.ipc.js";

/** Renderer'ın `deviceId.ts`i ile AYNI anahtar (secure-store). */
export const LOCAL_DEVICE_ID_KEY = "config.deviceId";

function run(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Kabuk YOK, sabit argümanlar; çıktı küçük.
    execFile(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

async function readRaw(kaynak: HwSource): Promise<string | null> {
  if (kaynak === "WIN_MACHINE_GUID") {
    const root = process.env.SystemRoot ?? "C:\\Windows";
    const out = await run(`${root}\\System32\\reg.exe`, ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid", "/reg:64"]);
    return parseWindowsMachineGuid(out);
  }
  if (kaynak === "MAC_PLATFORM_UUID") {
    return parseMacPlatformUuid(await run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]));
  }
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const v = parseLinuxMachineId(await readFile(p, "utf8"));
      if (v) return v;
    } catch {
      /* sıradaki yol */
    }
  }
  return null;
}

let rawCache: Promise<{ kaynak: HwSource; ham: string } | null> | null = null;

function readMachineId(): Promise<{ kaynak: HwSource; ham: string } | null> {
  rawCache ??= (async () => {
    const kaynak = sourceForPlatform(process.platform);
    if (!kaynak) return null;
    try {
      const ham = await readRaw(kaynak);
      return ham ? { kaynak, ham } : null;
    } catch (e) {
      // Ham değer değil yalnız hata türü günlüğe (sır hijyeni).
      log.warn("[cihaz] makine kimliği okunamadı", { kaynak, hata: (e as NodeJS.ErrnoException)?.code ?? "?" });
      return null;
    }
  })();
  return rawCache;
}

/** Kısa model: işletim sistemi + makine adı (sunucu kolonu 120). */
function describeModel(): string {
  const osName = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  return `${osName} · ${os.hostname()}`.slice(0, 120);
}

export function registerMachineIdIpc(): void {
  handleTrusted("device-identity:describe", async (): Promise<DeviceIdentityDescription> => {
    const hw = buildHwClaim(readPinnedInstallationId(), await readMachineId());
    return { hw, model: describeModel() };
  });
  // "Yok" ile "okunamadı" ayrımı: okunamayan kimlik renderer'da ÜSTÜNE YAZILMAZ (§5.5 md. 5).
  handleTrusted("device-identity:read-local-id", (): LocalIdRead => {
    try {
      return inspectSecureValue(LOCAL_DEVICE_ID_KEY);
    } catch {
      return { status: "UNREADABLE" };
    }
  });
  // Yalnız gerçekten YOKSA yazılır: arada okunamaz hâle geldiyse yazma reddedilir.
  handleTrusted("device-identity:create-local-id", (_e, value: unknown): boolean => {
    if (typeof value !== "string" || value.length < 8 || value.length > 64) throw new Error("Geçersiz cihaz kimliği");
    if (inspectSecureValue(LOCAL_DEVICE_ID_KEY).status !== "ABSENT") return false;
    writeSecureValue(LOCAL_DEVICE_ID_KEY, value);
    return true;
  });
}
