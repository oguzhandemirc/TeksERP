// =============================================================================
// BEKÇİ — MODÜL AYNASI ↔ BACKEND SABİTİ BİREBİR
// =============================================================================
// Electron backend'i import edemez, bu yüzden `lib/module-flags.ts` bir AYNADIR.
// Ayna sessizce bayatlarsa arıza görünmez olur: Sistem Profili ekranı olmayan
// bir modülü listeler ya da yeni doğan bir modülü hiç göstermez; bağımlılık
// oku kaybolduğunda kullanıcı "önce Ticaret" uyarısını görmeden İplik'i açar ve
// 400 yer. Bu dosya backend sabitini METİN olarak okuyup üç tabloyu da satır
// satır karşılaştırır.
//
// ⚠️ KÖRLÜK ZEMİNİ ŞART: dosya taşınır ya da yazım değişirse ayrıştırıcı boşa
// düşer ve "fark yok" ile "hiçbir şeye bakmadım" AYNI YEŞİLE çıkardı.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODULE_DEPENDENCIES,
  MODULE_FIELD_BY_SETTING_KEY,
  MODULE_FLAG_KEYS,
  MODULE_LABELS,
  MODULE_PLACEHOLDERS,
} from "./module-flags";

const BACKEND = readFileSync(
  resolve(__dirname, "../../../Teks-Erp/src/constants/module-flags.ts"),
  "utf8",
);
const PROFILES = readFileSync(
  resolve(__dirname, "../../../Teks-Erp/src/constants/module-profiles.ts"),
  "utf8",
);

/** `export const NAME: ... = new Set([ … ])` içindeki string'ler. */
function setLiteral(name: string, src: string): string[] {
  const idx = src.indexOf(`export const ${name}`);
  if (idx < 0) return [];
  const block = src.slice(idx, src.indexOf("]);", idx));
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** `export const NAME: ... = { "a": "b", … }` içindeki çiftler. */
function recordLiteral(name: string, src: string): Record<string, string> {
  const idx = src.indexOf(`export const ${name}`);
  if (idx < 0) return {};
  const block = src.slice(idx, src.indexOf("\n};", idx));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*"?([A-Za-z0-9_.]+)"?:\s*"([^"]*)",?$/gm)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

describe("körlük zemini", () => {
  it("backend sabitleri okundu ve ayrıştırıldı", () => {
    expect(BACKEND.length).toBeGreaterThan(1000);
    expect(PROFILES.length).toBeGreaterThan(1000);
    expect(setLiteral("MODULE_FLAG_KEYS", BACKEND).length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(recordLiteral("MODULE_LABELS", BACKEND)).length).toBeGreaterThanOrEqual(5);
    expect(
      Object.keys(recordLiteral("MODULE_FIELD_BY_SETTING_KEY", PROFILES)).length,
    ).toBeGreaterThanOrEqual(5);
  });
});

describe("ayna ↔ backend", () => {
  it("⭐ MODULE_FLAG_KEYS birebir (sıra dahil)", () => {
    expect([...MODULE_FLAG_KEYS]).toEqual(setLiteral("MODULE_FLAG_KEYS", BACKEND));
  });

  it("⭐ MODULE_LABELS birebir", () => {
    expect({ ...MODULE_LABELS }).toEqual(recordLiteral("MODULE_LABELS", BACKEND));
  });

  it("⭐ MODULE_DEPENDENCIES birebir", () => {
    expect({ ...MODULE_DEPENDENCIES }).toEqual(recordLiteral("MODULE_DEPENDENCIES", BACKEND));
  });

  it("⭐ MODULE_FIELD_BY_SETTING_KEY birebir (module-profiles.ts)", () => {
    expect({ ...MODULE_FIELD_BY_SETTING_KEY }).toEqual(
      recordLiteral("MODULE_FIELD_BY_SETTING_KEY", PROFILES),
    );
  });
});

describe("aynanın kendi tutarlılığı", () => {
  it("her anahtarın Türkçe adı var", () => {
    for (const k of MODULE_FLAG_KEYS) expect(MODULE_LABELS[k], k).toBeTruthy();
  });

  it("bağımlılıkların iki ucu da tanınan anahtar", () => {
    for (const [dep, req] of Object.entries(MODULE_DEPENDENCIES)) {
      expect(MODULE_FLAG_KEYS).toContain(dep);
      expect(MODULE_FLAG_KEYS).toContain(req);
    }
  });

  it("DB anahtarı haritası yedi alanı da kapsıyor (iki yönlü)", () => {
    expect(Object.values(MODULE_FIELD_BY_SETTING_KEY).sort()).toEqual([...MODULE_FLAG_KEYS].sort());
  });

  it("yer tutucular gerçek anahtar ve Genel Ayarlar'da YOK", () => {
    for (const k of MODULE_PLACEHOLDERS) expect(MODULE_FLAG_KEYS).toContain(k);
    // Backend sözleşme bekçisinin `PANEL_EXEMPT` listesiyle aynı iki anahtar.
    expect([...MODULE_PLACEHOLDERS]).toEqual([
      "kumasTeknikEnabled",
      "tezgahEnabled",
      "devereEnabled",
    ]);
  });
});
