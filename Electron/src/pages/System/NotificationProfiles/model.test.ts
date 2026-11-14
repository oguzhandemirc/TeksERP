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
  factoryBulk,
  factoryChanges,
  factoryDraftFrom,
  filterKinds,
  matrixBulk,
  membersAfterLockChoice,
  needsLockPreview,
  parseTrNumber,
  stateSummary,
  SUMMARY_LABEL,
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

describe("grup araçları (arama · özet · toplu aç/kapa)", () => {
  const kinds = [
    kind("siparis.iptal", { ad: "Sipariş iptal edildi", grup: "Sipariş" }),
    kind("finans.vade-yaklasti", { ad: "Vade yaklaştı", grup: "Finans" }),
    kind("sistem.yedek", { ad: "Yedek alınamadı", grup: "Sistem", kilit: "HER_ZAMAN" }),
  ];

  it("⭐ arama ad · tür kodu · grup adında, Türkçe katlamalı ve kelime kelime (AND)", () => {
    expect(filterKinds(kinds, "").map((k) => k.tur)).toHaveLength(3);
    expect(filterKinds(kinds, "SİPARİŞ").map((k) => k.tur)).toEqual(["siparis.iptal"]);
    expect(filterKinds(kinds, "vade-yak").map((k) => k.tur)).toEqual(["finans.vade-yaklasti"]);
    expect(filterKinds(kinds, "sistem yedek").map((k) => k.tur)).toEqual(["sistem.yedek"]);
    expect(filterKinds(kinds, "sistem vade")).toEqual([]);
  });

  it("özet yalnız sıfır olmayan durumları sabit sırada yazar", () => {
    expect(stateSummary(["MIRAS", "ACIK", "ACIK", "KILITLI"], ["ACIK", "KAPALI", "KILITLI", "MIRAS"], SUMMARY_LABEL)).toBe("2 açık · 1 kilitli · 1 miras");
    expect(stateSummary([], ["ACIK"], SUMMARY_LABEL)).toBe("");
  });

  it("⭐ toplu kapat her zaman kilitli türe dokunmaz; yalnız verilen türler değişir", () => {
    const base = factoryDraftFrom(kinds);
    const off = factoryBulk(base, kinds.slice(1), "KAPALI");
    expect(off["siparis.iptal"]!.durum).toBe("MIRAS");
    expect(off["finans.vade-yaklasti"]!.durum).toBe("KAPALI");
    expect(off["sistem.yedek"]!.durum).toBe("MIRAS");
    expect(factoryBulk(base, kinds, "ACIK")["sistem.yedek"]!.durum).toBe("ACIK");
    expect(matrixBulk({}, kinds, "KAPALI")).toEqual({ "siparis.iptal": "KAPALI", "finans.vade-yaklasti": "KAPALI" });
    expect(matrixBulk({ x: "KILITLI" }, kinds.slice(2), "ACIK")).toEqual({ x: "KILITLI", "sistem.yedek": "ACIK" });
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
