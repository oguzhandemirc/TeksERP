// B18/6: tarifenin fiyat dışı düzenleme gövdesi — backend `.strict()` şeması fiyat alanını 400 ile reddeder;
// panel yalnız ad/not/hizmet kartı gönderir ve üçü de her zaman gider (formda görünen değer yazılır).
import { describe, expect, it } from "vitest";
import { buildFinishingRateDetailsBody } from "./service";

describe("buildFinishingRateDetailsBody", () => {
  it("yalnız üç fiyat dışı alanı taşır", () => {
    const extra = { name: "Apre", note: null, serviceItemId: "x", pricePerM: "9", basis: "KG", currency: "USD" };
    expect(Object.keys(buildFinishingRateDetailsBody(extra)).sort()).toEqual(["name", "note", "serviceItemId"]);
  });
  it("null köprü açıkça gider (köprüyü kaldır)", () => {
    expect(buildFinishingRateDetailsBody({ name: "A", note: "n", serviceItemId: null })).toEqual({ name: "A", note: "n", serviceItemId: null });
  });
});
