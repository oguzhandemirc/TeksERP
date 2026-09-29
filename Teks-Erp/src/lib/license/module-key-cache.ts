// Modül anahtarı ÖNBELLEĞİ (Faz 2d) — yalnız HIZ katmanı, yetki kaynağı DEĞİL: girdi o anki kiranın
// kimliğine (`kiraId`) bağlıdır; kira değişince (yenileme, K2 dondurma) girdi kullanılmaz ve anahtar
// yeniden kiradan açılır. Windows'ta native DPAPI ile sarılı (başka makine/hesapta açılmaz), Linux'ta
// 0600 dosya; başka platformda (geliştirme) önbellek YOK — her açılışta kiradan.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { b64uDecode, b64uEncode, moduleKeyId } from "./protocol";
import { getLicenseCore } from "./native";
import { writeFileAtomicSync } from "./store-files";

export const MODULE_KEY_CACHE_FILE = "modul-onbellek.json";

type Protection = "dpapi" | "dosya";

const EntrySchema = z.object({
  modul: z.string().max(64),
  kid: z.string().max(40),
  kiraId: z.uuid(),
  koruma: z.enum(["dpapi", "dosya"]),
  veri: z.string().max(4096),
});
const CacheSchema = z.object({ v: z.literal(1), girdiler: z.array(EntrySchema).max(64) });
type Entry = z.infer<typeof EntrySchema>;

/** Bu platformun koruma biçimi; null = önbellek tutulmaz. */
export function cacheProtection(platform: NodeJS.Platform = process.platform): Protection | null {
  if (platform === "win32") return "dpapi";
  if (platform === "linux") return "dosya";
  return null;
}

function readEntries(dir: string): Entry[] {
  try {
    const parsed = CacheSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, MODULE_KEY_CACHE_FILE), "utf8")));
    return parsed.success ? parsed.data.girdiler : [];
  } catch {
    return [];
  }
}

function writeEntries(dir: string, entries: readonly Entry[]): void {
  const file = path.join(dir, MODULE_KEY_CACHE_FILE);
  if (entries.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  writeFileAtomicSync(file, JSON.stringify({ v: 1, girdiler: entries }));
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows'ta chmod anlamsız; koruma DPAPI'dedir.
  }
}

/** Önbellekten anahtar: modül + kid + GÜNCEL kira kimliği eşleşmeli, açılan anahtarın özeti kid olmalı. */
export function readCachedModuleKey(dir: string, g: { modul: string; kid: string; kiraId: string }): Buffer | null {
  const protection = cacheProtection();
  const entry = readEntries(dir).find((e) => e.modul === g.modul && e.kid === g.kid && e.kiraId === g.kiraId && e.koruma === protection);
  if (!entry || !protection) return null;
  let raw: Buffer | null = null;
  if (protection === "dpapi") {
    const opened = getLicenseCore().unprotectLocal(entry.veri);
    raw = opened.ok ? b64uDecode(opened.value.veri) : null;
  } else {
    raw = b64uDecode(entry.veri);
  }
  return raw && raw.length === 32 && moduleKeyId(raw) === g.kid ? raw : null;
}

/** Anahtarı önbelleğe yazar (aynı modülün eski girdileri düşer). Koruma yoksa/başarısızsa yazmaz. */
export function writeCachedModuleKey(dir: string, g: { modul: string; kid: string; kiraId: string; key: Buffer }): boolean {
  const protection = cacheProtection();
  if (!protection) return false;
  let veri = b64uEncode(g.key);
  if (protection === "dpapi") {
    const sealed = getLicenseCore().protectLocal(veri);
    if (!sealed.ok) return false;
    veri = sealed.value.veri;
  }
  try {
    const rest = readEntries(dir).filter((e) => e.modul !== g.modul);
    writeEntries(dir, [...rest, { modul: g.modul, kid: g.kid, kiraId: g.kiraId, koruma: protection, veri }]);
    return true;
  } catch {
    return false;
  }
}

/** Kira modülü artık vermiyorsa (K2, HAK'tan çıktı) girdisi silinir. */
export function dropCachedModuleKey(dir: string, modul: string): void {
  try {
    const entries = readEntries(dir);
    const rest = entries.filter((e) => e.modul !== modul);
    if (rest.length !== entries.length) writeEntries(dir, rest);
  } catch {
    // Silinemeyen girdi zararsızdır: kira kimliği değiştiği için bir daha eşleşmez.
  }
}
