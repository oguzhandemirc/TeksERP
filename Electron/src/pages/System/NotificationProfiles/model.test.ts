import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactoryDefaultKind } from "@/services/bildirimProfilService";
import {
  allowsOff,
  cellsFromDraft,
  draftEquals,
  draftFromCells,
  esikEtiketi,
  factoryChanges,
  factoryDraftFrom,
  membersAfterLockChoice,
  needsLockPreview,
  parseTrNumber,
} from "./model";

const kind = (tur: string, extra: Partial<FactoryDefaultKind> = {}): FactoryDefaultKind => ({
  tur, ad: tur, grup: "Fason", kilit: "YOK", durum: "MIRAS", esikler: {}, esikVar: false, ekAlicilar: [], ...extra,
});

describe("bildirim profilleri modeli", () => {
  it("taslak ↔ hücre: belirlenimli sıra, eşitlik anahtar+değer", () => {
    const d = draftFromCells([{ tur: "b", durum: "ACIK" }, { tur: "a", durum: "KILITLI" }]);
    expect(cellsFromDraft(d)).toEqual([{ tur: "a", durum: "KILITLI" }, { tur: "b", durum: "ACIK" }]);
    expect(draftEquals(d, { a: "KILITLI", b: "ACIK" })).toBe(true);
    expect(draftEquals(d, { a: "KILITLI" })).toBe(false);
    expect(draftEquals(d, { a: "ACIK", b: "ACIK" })).toBe(false);
  });

  it("kilit önizlemesi yalnız kilit + üye varken gerekir", () => {
    expect(needsLockPreview({ a: "KILITLI" }, 2)).toBe(true);
    expect(needsLockPreview({ a: "KILITLI" }, 0)).toBe(false);
    expect(needsLockPreview({ a: "ACIK" }, 3)).toBe(false);
  });

  it("⭐ kilit önizlemesi seçimi: seçilmeyen etkilenen profilden çıkar, etkilenmeyen üyeye dokunulmaz", () => {
    const out = membersAfterLockChoice(["u1", "u2", "u3"], ["u1", "u2"], new Set(["u2"]));
    expect(out).toEqual(["u2", "u3"]);
  });

  it("her zaman kilitli türde KAPALI seçeneği yok", () => {
    expect(allowsOff("HER_ZAMAN")).toBe(false);
    expect(allowsOff("NOBETTE")).toBe(true);
  });

  it("tr-TR sayı girişi", () => {
    expect(parseTrNumber("1.250,5")).toBe(1250.5);
    expect(parseTrNumber(" 3 ")).toBe(3);
    expect(parseTrNumber("")).toBeNull();
    expect(parseTrNumber("çok")).toBeNull();
  });

  it("fabrika varsayılanı: yalnız DEĞİŞEN tür gönderilir; bozuk eşik hata verir, gönderilmez", () => {
    const kinds = [kind("a"), kind("b", { esikVar: true, esikler: { gun: 3 } })];
    const base = factoryDraftFrom(kinds);
    expect(factoryChanges(kinds, base, base).turler).toEqual([]);
    const d1 = { ...base, b: { ...base.b!, esikMetin: { gun: "5" } } };
    expect(factoryChanges(kinds, base, d1)).toEqual({ turler: [{ tur: "b", durum: "MIRAS", ekAlicilar: [], esikler: { gun: 5 } }], errors: [] });
    const d2 = { ...base, b: { ...base.b!, esikMetin: { gun: "x" } } };
    expect(factoryChanges(kinds, base, d2).errors).toHaveLength(1);
    const d3 = { ...base, a: { ...base.a!, durum: "KILITLI" as const } };
    expect(factoryChanges(kinds, base, d3).turler.map((t) => t.tur)).toEqual(["a"]);
  });
});

describe("fabrika varsayılanı eşik etiketleri", () => {
  it("katalogdaki her paramSemasi alanının Türkçe etiketi var (ham anahtar görünmez)", () => {
    const dir = resolve(__dirname, "../../../../../Teks-Erp/src/constants");
    const alanlar = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => /^notification-catalog.*\.ts$/.test(n))) {
      const src = readFileSync(resolve(dir, f), "utf8");
      for (const m of src.matchAll(/paramSemasi:\s*z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/g)) {
        for (const a of m[1]!.matchAll(/(\w+):\s*z\./g)) alanlar.add(a[1]!);
      }
    }
    expect(alanlar.size).toBeGreaterThan(3);
    for (const a of alanlar) expect(esikEtiketi("x.y", a), a).not.toBe(a);
  });

  it("yaklaşıyor türlerinde gün öne-bakış penceresidir", () => {
    expect(esikEtiketi("finans.vade-yaklasti", "gun")).toBe("Kaç gün kala");
    expect(esikEtiketi("stok.yaslanan", "gun")).toBe("Eşik (gün)");
    expect(esikEtiketi("finans.vade-gecti", "tolerans")).toBe("Gecikme payı (gün)");
    expect(esikEtiketi("x.y", "bilinmeyen")).toBe("bilinmeyen");
  });
});
