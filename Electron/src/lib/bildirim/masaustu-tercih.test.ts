import { describe, expect, it } from "vitest";
import { desktopKinds, desktopPreferenceBody } from "./masaustu-tercih";
import type { NotificationPreferenceCell } from "./types";

const hucre = (kind: string, masaustu: "ACIK" | "KAPALI" | null): NotificationPreferenceCell => ({
  kind,
  kanallar: [
    { kanal: "UYGULAMA", durum: "ACIK", kilit: false, kaynak: "katalog", kapsam: null },
    ...(masaustu ? [{ kanal: "MASAUSTU" as const, durum: masaustu, kilit: false, kaynak: "katalog", kapsam: null }] : []),
  ],
});

describe("desktopKinds", () => {
  it("sunucu MASAUSTU ACIK ∪ eski anahtar; sıralı ve tekil", () => {
    expect(desktopKinds([hucre("b", "ACIK"), hucre("a", "KAPALI")], ["c", "b"])).toEqual(["b", "c"]);
  });
  it("eski sunucu (hücre yok) → yalnız eski anahtar; ikisi de yoksa boş", () => {
    expect(desktopKinds(undefined, ["x"])).toEqual(["x"]);
    expect(desktopKinds(undefined, undefined)).toEqual([]);
  });
});

describe("desktopPreferenceBody", () => {
  const hucreler = [hucre("a", "KAPALI"), hucre("b", "ACIK"), hucre("u", null)];
  it("diğer kanal satırlarını korur, seçicideki türlerin MASAUSTU'sunu yeni kümeye yazar", () => {
    const body = desktopPreferenceBody(
      [
        { id: "1", tur: "a", kanal: "UYGULAMA", acik: false, kapsam: null },
        { id: "2", tur: "b", kanal: "MASAUSTU", acik: true, kapsam: null },
        { id: "3", tur: "gizli", kanal: "UYGULAMA", acik: false, kapsam: null },
        { id: "4", tur: "u", kanal: "UYGULAMA", acik: true, kapsam: { schemaVersion: 1, yalnizTakip: true } },
      ],
      hucreler,
      ["a", "b", "u"],
      new Set(["a"]),
    );
    expect(body).toEqual([
      { tur: "a", kanal: "UYGULAMA", acik: false },
      { tur: "u", kanal: "UYGULAMA", acik: true, kapsam: { schemaVersion: 1, yalnizTakip: true } },
      { tur: "a", kanal: "MASAUSTU", acik: true },
      { tur: "b", kanal: "MASAUSTU", acik: false },
    ]);
  });
});
