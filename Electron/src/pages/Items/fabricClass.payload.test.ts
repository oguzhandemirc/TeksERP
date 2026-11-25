// K7/K8 gövde kuralları: boş alan yalnız kayıtta değer varsa null gider; lif bileşimi doğuşta gövdede, düzenlemede PUT.
import { describe, expect, it } from "vitest";
import { ItemType } from "@/types/enums";
import { fabricClassPayload, fibersChanged, fibersCreatePayload, fabricClassFormValues } from "./fabricClass.payload";
import { fabricClassFields, fiberTotal } from "./fabricClass.schema";
import type { Item } from "./types";

const base = { composition: "", fabricTypeId: "", flameRetardancy: "" as const, fibers: [] as Array<{ fiberTypeId: string; pct: string }> };
const item = (over: Partial<Item>): Item => ({ id: "i1", code: "K1", name: "K", itemType: "FABRIC", unit: "MT", isActive: true, createdAt: "", updatedAt: "", ...over }) as Item;

describe("fabricClassPayload", () => {
  it("yeni kumaş: dolu alanlar gider, boşlar hiç gitmez", () => {
    expect(fabricClassPayload({ ...base, itemType: ItemType.FABRIC, fabricTypeId: "t1", flameRetardancy: "TREVIRA_CS" }, null)).toEqual({ fabricTypeId: "t1", flameRetardancy: "TREVIRA_CS" });
  });
  it("⭐ düzenleme: kayıtta değer varken boşaltılan alan null (temizle) gider — 'hesaplanana dön'", () => {
    const saved = item({ fabricTypeId: "t1", flameRetardancy: "NONE", composition: "%100 PES" });
    expect(fabricClassPayload({ ...base, itemType: ItemType.FABRIC }, saved)).toEqual({ fabricTypeId: null, flameRetardancy: null, composition: null });
  });
  it("iplikte kumaş alanları hiç gitmez", () => {
    expect(fabricClassPayload({ ...base, itemType: ItemType.YARN, fabricTypeId: "t1" }, null)).toEqual({});
  });
});

describe("lif bileşimi", () => {
  const fibers = [{ fiberTypeId: "pes", pct: "65" }, { fiberTypeId: "co", pct: "35" }];
  it("⭐ yeni iplik: doğuş gövdesinde (pay noktalı); düzenlemede gövdeye GİRMEZ", () => {
    expect(fibersCreatePayload({ ...base, itemType: ItemType.YARN, fibers: [{ fiberTypeId: "pes", pct: "62,5" }, { fiberTypeId: "co", pct: "37,5" }] }, false))
      .toEqual({ fibers: [{ fiberTypeId: "pes", pct: "62.5" }, { fiberTypeId: "co", pct: "37.5" }] });
    expect(fibersCreatePayload({ ...base, itemType: ItemType.YARN, fibers }, true)).toEqual({});
  });
  it("değişiklik algısı sıradan bağımsız, pay sayısal", () => {
    const saved = item({ itemType: "YARN", fibers: [{ fiberTypeId: "co", pct: "35.00" }, { fiberTypeId: "pes", pct: "65.00" }] });
    expect(fibersChanged({ ...base, itemType: ItemType.YARN, fibers }, saved)).toBe(false);
    expect(fibersChanged({ ...base, itemType: ItemType.YARN, fibers: [{ fiberTypeId: "pes", pct: "100" }] }, saved)).toBe(true);
    expect(fabricClassFormValues(saved).fibers).toEqual([{ fiberTypeId: "co", pct: "35" }, { fiberTypeId: "pes", pct: "65" }]);
  });
  it("⭐ şema: toplam 100 değilse ya da aynı lif iki kezse geçmez; boş liste geçer", () => {
    expect(fiberTotal([{ pct: "33,33" }, { pct: "66,67" }])).toBe(100);
    expect(fabricClassFields.fibers.safeParse(fibers).success).toBe(true);
    expect(fabricClassFields.fibers.safeParse([{ fiberTypeId: "pes", pct: "60" }]).success).toBe(false);
    expect(fabricClassFields.fibers.safeParse([{ fiberTypeId: "pes", pct: "50" }, { fiberTypeId: "pes", pct: "50" }]).success).toBe(false);
    expect(fabricClassFields.fibers.safeParse([]).success).toBe(true);
  });
});
