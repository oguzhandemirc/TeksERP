import { describe, expect, it } from "vitest";
import { manualFieldState, numberSourceOf, type NumberSourceInfo } from "./number-source";

// =============================================================================
// BEKÇİ — ELLE NUMARA ALANININ ÜÇ HÂLİ (2026-09-23)
// =============================================================================
// ⭐ NEDEN VAR: "gizli" ile "zorunlu değil" AYNI ŞEY DEĞİL. İkisini tek bayrağa
//    indirgeyen bir ekran, SYSTEM modunda kullanıcıya doldurulabilir ama sunucu
//    tarafından REDDEDİLECEK bir kutu gösterirdi — kullanıcı hatayı ancak
//    kaydet'e bastıktan sonra görürdü.
// ⭐ NEGATİF SONDA (ölçüldü): `SYSTEM → "hidden"` satırı silinip `optional`a
//    düşürülünce ilk iddia KIRMIZI; geri alınca yeşil.
// =============================================================================

const LISTE: NumberSourceInfo[] = [
  { key: "sack", label: "Çuval no", mode: "SYSTEM", scanned: true },
  { key: "packingLotName", label: "Sevk partisi adı", mode: "MANUAL", scanned: false },
];

describe("elle numara alanı — üç hâl", () => {
  it("⭐ SYSTEM alanı GİZLER (reddedilecek kutu gösterilmez)", () => {
    expect(manualFieldState("SYSTEM")).toBe("hidden");
  });

  it("⭐ MANUAL alanı ZORUNLU kılar", () => {
    expect(manualFieldState("MANUAL")).toBe("required");
  });

  it("FREE bugünkü davranış: alan var, zorunlu değil", () => {
    expect(manualFieldState("FREE")).toBe("optional");
  });

  it("⭐ mod BİLİNMİYORSA bugünkü davranış sürer (eski sunucu yükü sessizce alan gizlemez)", () => {
    expect(manualFieldState(undefined)).toBe("optional");
  });

  it("listeden mod okunur; olmayan seri undefined döner", () => {
    expect(numberSourceOf(LISTE, "sack")).toBe("SYSTEM");
    expect(numberSourceOf(LISTE, "order")).toBeUndefined();
    expect(numberSourceOf(undefined, "sack")).toBeUndefined();
  });
});
