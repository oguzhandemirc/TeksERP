// Tercih taslağı (N4-PANEL): kilitli satır kapatılamaz · grup toplu işlem kilitlileri atlar · arama tr-katlamalı
// · tam gövde kilitli türde UYGULAMA'yı açık ve kapsamsız yollar · taslak YALNIZ sunucu hücrelerinden kurulur.
import { describe, expect, it } from "vitest";
import { draftFromCells, draftToBody, matchesKind, setGroupMode, setMode, setScope, lockReason } from "./tercih-taslak";
import type { NotificationPreferenceCell } from "./types";

const cell = (kind: string, o: { app?: "ACIK" | "KAPALI" | "GIZLI"; ozet?: "ACIK" | "KAPALI"; kilit?: boolean; kaynak?: string; masaustu?: boolean; tablet?: boolean; kapsam?: unknown } = {}): NotificationPreferenceCell => ({
  kind,
  kanallar: [
    { kanal: "UYGULAMA", durum: o.app ?? "ACIK", kilit: !!o.kilit, kaynak: o.kaynak ?? "katalog", kapsam: o.kapsam ?? null },
    ...(o.ozet ? [{ kanal: "OZET" as const, durum: o.ozet, kilit: false, kaynak: "katalog", kapsam: null }] : []),
    ...(o.masaustu !== undefined ? [{ kanal: "MASAUSTU" as const, durum: o.masaustu ? ("ACIK" as const) : ("KAPALI" as const), kilit: false, kaynak: "katalog", kapsam: null }] : []),
    ...(o.tablet !== undefined ? [{ kanal: "TABLET_SES" as const, durum: o.tablet ? ("ACIK" as const) : ("KAPALI" as const), kilit: false, kaynak: "katalog", kapsam: null }] : []),
  ],
});

describe("tercih taslağı", () => {
  const d = draftFromCells([
    cell("a.acik", { ozet: "KAPALI", masaustu: false }),
    cell("b.kilitli", { kilit: true, kaynak: "profil:Vardiya amiri", ozet: "KAPALI" }),
    cell("c.ozet", { app: "KAPALI", ozet: "ACIK" }),
    cell("d.gizli", { app: "GIZLI" }),
  ]);

  it("üç durum sunucu hücresinden okunur; GIZLI tür taslağa girmez", () => {
    expect(Object.keys(d).sort()).toEqual(["a.acik", "b.kilitli", "c.ozet"]);
    expect(d["a.acik"]?.mod).toBe("ANLIK");
    expect(d["c.ozet"]?.mod).toBe("OZET");
    expect(d["a.acik"]?.kanal.MASAUSTU).toBe(false);
    expect(d["a.acik"]?.kanal.TABLET_SES).toBeUndefined();
  });

  it("kilitli satır kapatılamaz, özete alınamaz, kapsam alamaz", () => {
    expect(setMode(d, "b.kilitli", "KAPALI")).toBe(d);
    expect(setMode(d, "b.kilitli", "OZET")).toBe(d);
    expect(setScope(d, "b.kilitli", { yalnizTakip: true })).toBe(d);
    expect(lockReason(d["b.kilitli"]!)).toContain("Vardiya amiri");
  });

  it("grup toplu kapa kilitlileri atlar ve değişen satırı sayar", () => {
    const r = setGroupMode(d, ["a.acik", "b.kilitli", "c.ozet"], false);
    expect(r.degisen).toBe(2);
    expect(r.taslak["b.kilitli"]?.mod).toBe("ANLIK");
    expect(r.taslak["a.acik"]?.mod).toBe("KAPALI");
    expect(setGroupMode(r.taslak, ["a.acik"], false).degisen).toBe(0);
  });

  it("tam gövde: her kanal bir satır; kilitli türde UYGULAMA açık ve kapsamsız", () => {
    const body = draftToBody(setScope(setMode(d, "a.acik", "OZET"), "a.acik", { yalnizTakip: true }));
    expect(body.filter((b) => b.tur === "a.acik")).toEqual([
      { tur: "a.acik", kanal: "UYGULAMA", acik: false, kapsam: { yalnizTakip: true } },
      { tur: "a.acik", kanal: "OZET", acik: true },
      { tur: "a.acik", kanal: "MASAUSTU", acik: false },
    ]);
    expect(body.filter((b) => b.tur === "b.kilitli")).toEqual([
      { tur: "b.kilitli", kanal: "UYGULAMA", acik: true },
      { tur: "b.kilitli", kanal: "OZET", acik: false },
    ]);
  });

  it("arama tr-katlamalı: 'ışık' ↔ 'ISIK', 'İplik' ↔ 'iplik'", () => {
    const k = { kod: "x.y", ad: "Işık sensörü arızası", grup: "Sistem" as const };
    expect(matchesKind(k, "ISIK")).toBe(true);
    expect(matchesKind(k, "ışık")).toBe(true);
    expect(matchesKind({ kod: "x", ad: "İplik bitti", grup: "Stok" as const }, "iplik")).toBe(true);
    expect(matchesKind(k, "levent")).toBe(false);
  });
});
