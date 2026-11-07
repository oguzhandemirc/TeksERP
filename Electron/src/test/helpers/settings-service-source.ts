import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Backend ayar servisinin birleşik metni — `Teks-Erp/scripts/lib/ayar-servis-kaynak.ts`in küçük ikizi.
 * Servis 2026-11-08'de cephe + `services/system-setting/*.ts` modüllerine bölündü; ayna testleri AİLEYİ okur
 * (dizin canlı taranır, yeni alan dosyası kapsamı kendiliğinden genişletir).
 */
const SERVICES = resolve(__dirname, "../../../../Teks-Erp/src/services");

export function settingsServiceText(): string {
  const dir = join(SERVICES, "system-setting");
  const modules = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".ts")).sort().map((f) => join(dir, f))
    : [];
  return [join(SERVICES, "system-setting.service.ts"), ...modules].map((f) => readFileSync(f, "utf8")).join("\n");
}
