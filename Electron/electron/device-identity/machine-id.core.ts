// =============================================================================
// Makine kimliği — SAF çekirdek (cihaz eşleme v2, D3; plan §5.1).
// Ham donanım kimliği ana süreçten ÇIKMAZ: renderer'a ve sunucuya yalnız kuruluma
// özgü HMAC özeti gider. Ayrıştırıcılar saf → üç işletim sistemi sahte çıktıyla sınanır.
// Özet sunucudaki `computeHwDigest` (D1) ile bayt-eşittir.
// =============================================================================
import { createHmac } from "node:crypto";
import type { HwClaim, HwSource } from "../../shared/ipc-contract.js";

const DOMAIN = "tekserp/cihaz-donanim/v1";

/** Sıfır/boş kalıplar klon ya da sanal makinede görülür — kimlik sayılmaz. */
function plausible(raw: string): boolean {
  const hex = raw.replace(/[^0-9a-f]/gi, "");
  return hex.length >= 16 && !/^0+$/.test(hex) && !/^f+$/i.test(hex);
}

/** `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid` çıktısı. */
export function parseWindowsMachineGuid(stdout: string): string | null {
  const m = /^\s*MachineGuid\s+REG_SZ\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/im.exec(stdout);
  const v = m?.[1]?.toLowerCase() ?? null;
  return v && plausible(v) ? v : null;
}

/** `ioreg -rd1 -c IOPlatformExpertDevice` çıktısı. */
export function parseMacPlatformUuid(stdout: string): string | null {
  const m = /"IOPlatformUUID"\s*=\s*"([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})"/i.exec(stdout);
  const v = m?.[1]?.toUpperCase() ?? null;
  return v && plausible(v) ? v : null;
}

/** `/etc/machine-id` içeriği (32 küçük hex). */
export function parseLinuxMachineId(content: string): string | null {
  const v = content.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(v) && plausible(v) ? v : null;
}

export function computeHwDigest(installationId: string, kaynak: HwSource, ham: string): string {
  return createHmac("sha256", installationId).update(`${DOMAIN}\n${kaynak}\n${ham}`, "utf8").digest("hex");
}

/** Ham + kurulum anahtarı → sunucuya gidecek iddia. Anahtar ya da ham yoksa `null` (hw gönderilmez). */
export function buildHwClaim(installationId: string | null, read: { kaynak: HwSource; ham: string } | null): HwClaim | null {
  if (!installationId || !read) return null;
  return { v: 1, kaynak: read.kaynak, ozet: computeHwDigest(installationId, read.kaynak, read.ham) };
}

/** İşletim sistemi → okunacak kaynak (desteklenmeyen platformda `null`). */
export function sourceForPlatform(platform: NodeJS.Platform): HwSource | null {
  if (platform === "win32") return "WIN_MACHINE_GUID";
  if (platform === "darwin") return "MAC_PLATFORM_UUID";
  if (platform === "linux") return "LINUX_MACHINE_ID";
  return null;
}
