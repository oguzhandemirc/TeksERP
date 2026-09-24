// =============================================================================
// BEKÇİ — AYAR KATEGORİSİ ↔ BACKEND KAPSAM TABLOSU AYNASI
// =============================================================================
// Kategori `permissionAny` ile görünür/yazılabilir olur; backend ise aynı dar
// iznin HANGİ anahtarları yazabildiğini `constants/settings-scopes.ts`ten okur.
// Ayrışırsa kullanıcı sekmeyi görür, Kaydet'e basar ve 403 alır — ya da tersine
// dar izin başka bir ekranın anahtarını yazar. İki yön de ölçülür.
// Backend dosyası METİN olarak okunur (Electron backend'i import edemez).
// NEGATİF SONDA (2026-09-24): tablodan bir sevkiyat anahtarı silinince "Kaydet
// 403 almaz" KIRMIZI; kartela iznine sipariş anahtarı eklenince "ters yön" KIRMIZI.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES, categorySurface } from "./settings-config";

const SRC = readFileSync(resolve(__dirname, "../../../../Teks-Erp/src/constants/settings-scopes.ts"), "utf8");

function listAfter(block: string, field: string): string[] {
  const m = new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`).exec(block);
  return m ? [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : [];
}

/** izin → { flag anahtarları, ham anahtarlar } — tablo, `permission:` satırlarından bölünür. */
const TABLE = SRC.slice(SRC.indexOf("SETTINGS_SCOPES"), SRC.indexOf("function buildKeyMap"));
const SCOPES = new Map(
  TABLE.split(/permission:\s*/)
    .slice(1)
    .map((seg) => {
      const perm = /^"([^"]+)"/.exec(seg)![1]!;
      return [
        perm,
        { flagKeys: listAfter(seg, "flagKeys"), settingKeys: listAfter(seg, "settingKeys") },
      ] as const;
    }),
);

function categoryKeys(c: (typeof SETTINGS_CATEGORIES)[number]): { flags: string[]; settings: string[] } {
  const flags = [
    ...(c.flags ?? []).flatMap((f) => [
      f.key as string,
      ...(f.numberField ? [f.numberField.numberKey as string] : []),
    ]),
    ...(c.numberFlags ?? []).map((f) => f.key as string),
    ...(c.enumFlags ?? []).map((f) => f.enumKey as string),
    ...(c.textFlags ?? []).map((f) => f.textKey as string),
  ];
  return { flags, settings: (c.settingFields ?? []).map((f) => f.key as string) };
}

const narrow = SETTINGS_CATEGORIES.filter((c) => categorySurface(c) !== "vendor").map((c) => ({
  cat: c,
  perm: (c.permissionAny ?? [])[1],
}));

describe("ayar kategorisi ↔ backend kapsam tablosu", () => {
  it("körlük zemini: backend tablosu okundu", () => {
    expect(SCOPES.size).toBeGreaterThanOrEqual(15);
    expect(SCOPES.get("settings:shipping")?.flagKeys.length).toBeGreaterThan(20);
  });

  it("⭐ her kategorinin dar izni backend tablosunda (ya da yerel `settings:workstation`)", () => {
    const missing = narrow
      .filter(({ perm }) => perm !== "settings:workstation" && !SCOPES.has(perm ?? ""))
      .map(({ cat, perm }) => `${cat.id} → ${perm}`);
    expect(missing).toEqual([]);
  });

  it("⭐ kategorinin her satırı KENDİ izninin anahtarı (Kaydet 403 almaz)", () => {
    const wrong: string[] = [];
    for (const { cat, perm } of narrow) {
      const scope = SCOPES.get(perm ?? "");
      if (!scope) continue;
      const { flags, settings } = categoryKeys(cat);
      for (const k of flags) if (!scope.flagKeys.includes(k)) wrong.push(`${cat.id}: ${k}`);
      for (const k of settings) if (!scope.settingKeys.includes(k)) wrong.push(`${cat.id}: ${k} (ham)`);
    }
    expect(wrong).toEqual([]);
  });

  it("⭐ tablodaki anahtar, kategorinin satırı değilse özel bölümün anahtarıdır (ters yön)", () => {
    // Satır listesi olan (flags) kategorilerde tablo FAZLA anahtar taşımamalı —
    // taşırsa dar izin ekranda görünmeyen bir ayarı yazabilir.
    const extra: string[] = [];
    for (const { cat, perm } of narrow) {
      if (cat.kind !== "flags") continue;
      const scope = SCOPES.get(perm ?? "");
      if (!scope) continue;
      const { flags, settings } = categoryKeys(cat);
      for (const k of scope.flagKeys) if (!flags.includes(k)) extra.push(`${perm}: ${k}`);
      for (const k of scope.settingKeys) if (!settings.includes(k)) extra.push(`${perm}: ${k} (ham)`);
    }
    expect(extra).toEqual([]);
  });
});
