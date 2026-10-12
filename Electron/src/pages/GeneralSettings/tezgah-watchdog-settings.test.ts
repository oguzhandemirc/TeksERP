// Genel Ayarlar › Tezgah izleme: makine kartı watchdog'unun (D4) iki eşiği panelde — sınırlar ve varsayılan
// backend'in Zod şeması ve okuyucusuyla AYNI (ayrışırsa panel 400 alır ya da yanlış varsayılan gösterir).
// Satır silinirse ayrıca test_feature_flag_contract "yönetilemez SAYISAL anahtar" kırmızı verir.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "./settings-config";
import { FLAG_MODULE } from "./flag-modules";

const ROUTES = readFileSync(resolve(__dirname, "../../../../Teks-Erp/src/routes/feature-flag.routes.ts"), "utf8");
const SERVICE = readFileSync(resolve(__dirname, "../../../../Teks-Erp/src/services/system-setting.service.ts"), "utf8");

const tezgah = SETTINGS_CATEGORIES.find((c) => c.id === "tezgah")!;
const numbers = ("numberFlags" in tezgah && tezgah.numberFlags) || [];

function zodBounds(key: string): { min: number; max: number } {
  const m = new RegExp(`${key}: z\\.number\\(\\)\\.int\\(\\)\\.min\\((\\d+)\\)\\.max\\((\\d+)\\)`).exec(ROUTES);
  if (!m) throw new Error(`Zod satırı bulunamadı: ${key}`);
  return { min: Number(m[1]), max: Number(m[2]) };
}
function backendDefault(constName: string): number {
  const m = new RegExp(`const ${constName}\\s*=\\s*(\\d+)`).exec(SERVICE);
  if (!m) throw new Error(`varsayılan bulunamadı: ${constName}`);
  return Number(m[1]);
}

describe("tezgah izleme — makine kartı watchdog eşikleri (D4)", () => {
  it.each([
    ["tezgahCollectorSilenceMinutes", "DEFAULT_TEZGAH_COLLECTOR_SILENCE_MINUTES", "dk"],
    ["tezgahMaxOpenStopHours", "DEFAULT_TEZGAH_MAX_OPEN_STOP_HOURS", "saat"],
  ])("⭐ %s: satır var, sınırlar Zod'la, varsayılan okuyucuyla aynı, kilit tezgah modülü", (key, def, unit) => {
    const row = numbers.find((r) => r.key === key);
    expect(row).toBeDefined();
    expect({ min: row!.min, max: row!.max }).toEqual(zodBounds(key));
    expect(row!.fallback).toBe(backendDefault(def));
    expect(row!.unit).toBe(unit);
    expect(row!.desc).toMatch(new RegExp(`varsayılan ${row!.fallback} ${unit === "saat" ? "sa" : "dk"}`));
    expect(FLAG_MODULE[key as keyof typeof FLAG_MODULE]).toBe("tezgahEnabled");
  });

  it("sessizlik metni duruş AÇMADIĞINI, geçici kapanış metni elle duruşa dokunmadığını söyler", () => {
    expect(numbers.find((r) => r.key === "tezgahCollectorSilenceMinutes")!.desc).toMatch(/duruş AÇMAZ/);
    expect(numbers.find((r) => r.key === "tezgahMaxOpenStopHours")!.desc).toMatch(/Elle açılan duruşlara dokunulmaz/);
  });
});
