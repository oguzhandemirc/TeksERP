import { describe, expect, it } from "vitest";
import { ItemType } from "@/types/enums";
import { cardExtraFormValues, cardExtraPayload } from "./cardExtra.payload";
import { buildItemPayload } from "./itemPayload.helper";
import { itemFormDefaults } from "./schema";
import type { Item } from "./types";

const item = (o: Partial<Item>): Item => ({ id: "i1", code: "K1", name: "A", itemType: ItemType.FABRIC, unit: "MT", isActive: true, linearDensityDen: null, createdAt: "", updatedAt: "", ...o });
const blank = { ...itemFormDefaults };

describe("cardExtraPayload (D4b)", () => {
  it("boş form + boş kayıt → anahtar gitmez (eski gövdeyle aynı)", () => {
    expect(cardExtraPayload({ ...blank, itemType: ItemType.FABRIC }, null)).toEqual({});
    expect(cardExtraPayload({ ...blank, itemType: ItemType.YARN }, null)).toEqual({});
  });

  it("kumaş: virgüllü sayı noktalı metin, bakım talimatı kırpılır; iplik/stok alanı gitmez", () => {
    const v = { ...blank, itemType: ItemType.FABRIC, standardRollLengthM: "50,5", minOrderQty: "1000", careInstructions: "  30 °C  ", yarnPly: "2", minStockQty: "9" };
    expect(cardExtraPayload(v, null)).toEqual({ standardRollLengthM: "50.5", minOrderQty: "1000", careInstructions: "30 °C" });
  });

  it("iplik: teknik alanlar + asgari stok; kumaş alanı gitmez", () => {
    const v = { ...blank, itemType: ItemType.YARN, yarnFilamentCount: "24", yarnPly: "2", yarnTwistTpm: "0", yarnTwistDirection: "Z" as const, yarnLuster: "FULL_DULL" as const, minStockQty: "250,5", standardRollLengthM: "50" };
    expect(cardExtraPayload(v, null)).toEqual({ yarnFilamentCount: "24", yarnPly: "2", yarnTwistTpm: "0", yarnTwistDirection: "Z", yarnLuster: "FULL_DULL", minStockQty: "250.5" });
  });

  it("boşaltılan alan kayıtta değer varsa null gider", () => {
    const saved = item({ itemType: ItemType.CONSUMABLE, unit: "KG", minStockQty: "20.000" });
    expect(cardExtraPayload({ ...blank, itemType: ItemType.CONSUMABLE }, saved)).toEqual({ minStockQty: null });
  });

  it("kayıt → form: Decimal metni virgüllü, sayı alanı metin, enum aynen", () => {
    const v = cardExtraFormValues(item({ standardRollLengthM: "50.25", yarnPly: 2, yarnTwistDirection: "S", careInstructions: null }));
    expect(v).toMatchObject({ standardRollLengthM: "50,25", yarnPly: "2", yarnTwistDirection: "S", careInstructions: "", yarnLuster: "" });
  });

  it("sarf birimi formdan gider (K9); kumaş/iplik birimi tipten türer", () => {
    expect(buildItemPayload({ ...blank, name: "Boya", itemType: ItemType.CONSUMABLE, unit: "KG" }, false).unit).toBe("KG");
    expect(buildItemPayload({ ...blank, name: "İplik", itemType: ItemType.YARN, unit: "MT" }, false).unit).toBe("KG");
  });
});
