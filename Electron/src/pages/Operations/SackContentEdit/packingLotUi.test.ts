// =============================================================================
// SEVK PARTİSİ panel kuralları (2026-09-21) — saf yüklemler + kaynak metni kapıları
//   §1 `isLotMode`: grup bayrağı kapalıyken mod ne olursa olsun FALSE (fail-closed)
//   §2 `packageNoField`: otomatik → alan yok; elle → zorunlu; ezilebilir → opsiyonel
//   §3 `lotDeletable`: yalnız hiç çuvalı olmamış parti
//   §4 `newSackLotTarget`: seçili parti hedef; `lotRequired` + parti yok → engel metni
//   §5 `parsePackageNoInput`: boş → null; kesirli/negatif → hata; tam sayı → sayı
//   §6 kaynak metni: `SacksListView` şeridi MODA göre seçer; `NewSackDialog` numarayı
//      `packageNoField`ten okur (elle karar yok); `openSack` gövdesi `packingGroupId`yi
//      yalnız doluyken gönderir (grup modunda bayt bayt eski istek)
//   §7 kaynak metni: parti çipi menüsünde kapat / yeniden aç / sil üçlüsü var ve sil
//      `lotDeletable` kapısından geçer
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-21): `isLotMode` `groupsEnabled` kapısı silinince §1 ❌;
//    `lotDeletable` `shippedSackCount` şartı silinince §3 ❌; `service.ts`te packingGroupId
//    koşulsuz gönderilince §6c ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLotMode, lotChipSummary, lotDeletable, newSackLotTarget, packageNoField, parsePackageNoInput } from "./packingLotUi";

const src = (f: string) => readFileSync(join(__dirname, f), "utf-8");

describe("sevk partisi — saf yüklemler", () => {
  it("§1 isLotMode: grup bayrağı kapalıyken hep false", () => {
    expect(isLotMode(false, "sevk-partisi")).toBe(false);
    expect(isLotMode(true, "grup")).toBe(false);
    expect(isLotMode(true, "sevk-partisi")).toBe(true);
  });

  it("§2 packageNoField moda göre", () => {
    expect(packageNoField("otomatik").shown).toBe(false);
    expect(packageNoField("elle")).toMatchObject({ shown: true, required: true });
    expect(packageNoField("otomatik-ezilebilir")).toMatchObject({ shown: true, required: false });
  });

  it("§3 lotDeletable yalnız hiç çuvalı olmamış partide", () => {
    expect(lotDeletable({ sackCount: 0, shippedSackCount: 0 })).toBe(true);
    expect(lotDeletable({ sackCount: 1, shippedSackCount: 0 })).toBe(false);
    expect(lotDeletable({ sackCount: 0, shippedSackCount: 3 })).toBe(false);
    expect(lotChipSummary({ sackCount: 2, shippedSackCount: 0, totalQty: 100 })).toBe("2 açık · 100 m");
    expect(lotChipSummary({ sackCount: 2, shippedSackCount: 3, totalQty: 1234.5 })).toContain("3 sevk");
  });

  it("§4 newSackLotTarget", () => {
    expect(newSackLotTarget({ lotMode: false, selectedLotId: "x", lotRequired: true })).toEqual({ packingGroupId: null, blocked: null });
    expect(newSackLotTarget({ lotMode: true, selectedLotId: "x", lotRequired: true }).packingGroupId).toBe("x");
    expect(newSackLotTarget({ lotMode: true, selectedLotId: null, lotRequired: true }).blocked).toMatch(/parti/);
    expect(newSackLotTarget({ lotMode: true, selectedLotId: null, lotRequired: false }).blocked).toBeNull();
  });

  it("§5 parsePackageNoInput", () => {
    expect(parsePackageNoInput("")).toEqual({ value: null, error: null });
    expect(parsePackageNoInput(" 12 ")).toEqual({ value: 12, error: null });
    expect(parsePackageNoInput("0")).toEqual({ value: 0, error: null });
    expect(parsePackageNoInput("-1").error).toBeTruthy();
    expect(parsePackageNoInput("1.5").error).toBeTruthy();
  });
});

describe("sevk partisi — kaynak metni kapıları", () => {
  it("§6a SacksListView şeridi moda göre seçer", () => {
    const s = src("SacksListView.tsx");
    expect(s).toMatch(/lotMode \? <PackingLotBar/);
    expect(s).toMatch(/: <PackingGroupBar/);
  });
  it("§6b NewSackDialog numara alanını packageNoField'tan okur", () => {
    const s = src("NewSackDialog.tsx");
    expect(s).toContain("packageNoField(");
    expect(s).not.toMatch(/mode === "elle" \? true/);
  });
  it("§6c service.openSack packingGroupId'yi yalnız doluyken gönderir", () => {
    const s = src("service.ts");
    expect(s).toMatch(/\.\.\.\(body\.packingGroupId \? \{ packingGroupId: body\.packingGroupId \} : \{\}\)/);
    expect(s).not.toMatch(/packingGroupId: body\.packingGroupId,/);
  });
  it("§7 parti çipi menüsü: kapat / yeniden aç / sil ve sil kapısı", () => {
    const s = src("PackingLotBar.tsx");
    expect(s).toContain("closePackingGroup");
    expect(s).toContain("reopenPackingGroup");
    expect(s).toContain("deletePackingGroup");
    expect(s).toMatch(/lotDeletable\(/);
  });
});
