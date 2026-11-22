import { describe, expect, it } from "vitest";
import { constructionSlots, sharedYarnSlots, slotOf, warpRowKeys } from "./shared-palette";

describe("sharedYarnSlots", () => {
  it("tek kartta satır i → yuva i (bugünkü sonuç)", () => {
    expect(sharedYarnSlots([["pes", "simli", "pamuk"]])).toEqual([[1, 2, 3]]);
  });

  it("aynı iplik ikinci kartta aynı yuvayı alır; yeni iplik sıradaki yuvayı", () => {
    // zemin: A=PES B=Simli · döner: Simli, Naylon → döner Simli = B, Naylon = C
    expect(sharedYarnSlots([["pes", "simli"], ["simli", "naylon"]])).toEqual([[1, 2], [2, 3]]);
  });

  it("bir kartta aynı iplik iki satırdaysa satırlar ayrı yuvada kalır (bant ayırt edilir)", () => {
    expect(sharedYarnSlots([["pes", "pes"]])).toEqual([[1, 2]]);
    // ikinci kart iki PES satırını aynı iki yuvaya eşler
    expect(sharedYarnSlots([["pes", "pes"], ["pes", "x", "pes"]])).toEqual([[1, 2], [1, 3, 2]]);
  });

  it("anahtarsız satır kimseyle birleşmez", () => {
    expect(sharedYarnSlots([[null, "a"], [null, "a"]])).toEqual([[1, 2], [3, 2]]);
  });

  it("boş grup listesi", () => {
    expect(sharedYarnSlots([])).toEqual([]);
    expect(sharedYarnSlots([[]])).toEqual([[]]);
  });
});

describe("slotOf", () => {
  it("eşleme yoksa satır no'nun kendisi", () => {
    expect(slotOf(undefined, 3)).toBe(3);
    expect(slotOf([4, 2], 2)).toBe(2);
    expect(slotOf([4, 2], 1)).toBe(4);
  });
});

describe("warpRowKeys / constructionSlots", () => {
  it("satırlar sortOrder sırasıyla; satırsız eski yanıtta ana iplik", () => {
    expect(warpRowKeys({ yarns: [{ yarnItemId: "b", sortOrder: 1 }, { yarnItemId: "a", sortOrder: 0 }] })).toEqual(["a", "b"]);
    expect(warpRowKeys({ yarnItem: { id: "z" } })).toEqual(["z"]);
    expect(warpRowKeys({})).toEqual([null]);
  });

  it("zemin + döner + atkı: aynı iplik çözgüde ve atkıda aynı yuva", () => {
    const ground = { yarns: [{ yarnItemId: "pes", sortOrder: 0 }, { yarnItemId: "simli", sortOrder: 1 }] };
    const leno = { yarns: [{ yarnItemId: "simli", sortOrder: 0 }] };
    const p = constructionSlots([ground, leno], ["pamuk", "pes"]);
    expect(p.warp).toEqual([[1, 2], [2]]);
    expect(p.weft).toEqual([3, 1]);
  });

  it("atkısız ekranda weft boş", () => {
    expect(constructionSlots([{ yarnItem: { id: "a" } }]).weft).toEqual([]);
  });
});
