import { describe, it, expect } from "vitest";
import { generalAliasDeleteText, groupColorAliases, itemAcceptsAlias, itemAliasDeleteText } from "./colorAliasChain";
import type { CustomerColorAlias, CustomerItemColorAlias } from "./aliasService";

type C = { id: string; code: string; name: string; hex: string | null; isActive: boolean };
const EKRU: C = { id: "ekru", code: "R01", name: "Ekru", hex: "#eee", isActive: true };
const MAVI: C = { id: "mavi", code: "R02", name: "Mavi", hex: null, isActive: true };
const gen = (color: C, alias: string | null): CustomerColorAlias => ({ id: `g-${color.id}`, customerId: "c1", colorId: color.id, alias, assigned: false, color });
const itm = (color: C, itemName: string, alias: string): CustomerItemColorAlias => ({
  id: `i-${color.id}-${itemName}`,
  customerId: "c1",
  itemId: `it-${itemName}`,
  colorId: color.id,
  alias,
  createdAt: "",
  updatedAt: "",
  item: { id: `it-${itemName}`, code: itemName, name: itemName, lifecycleStatus: "ACTIVE" },
  color,
});

describe("groupColorAliases", () => {
  it("kumaşa özel adlar rengin genel adının altına, kumaş adına göre sıralı gelir", () => {
    const groups = groupColorAliases([gen(EKRU, "KREM")], [itm(EKRU, "Y", "CBA"), itm(EKRU, "X", "ABC")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.general?.alias).toBe("KREM");
    expect(groups[0]!.items.map((r) => r.alias)).toEqual(["ABC", "CBA"]);
  });

  it("genel adı olmayan renk yalnız kumaşa özel satırla da görünür; adsız atama satırı gösterilmez", () => {
    const groups = groupColorAliases([gen(MAVI, null)], [itm(EKRU, "X", "ABC")]);
    expect(groups.map((g) => g.colorId)).toEqual(["ekru"]);
    expect(groups[0]!.general).toBeNull();
  });
});

describe("silme onayı zinciri anlatır", () => {
  it("kumaşa özel ad silinince genel ad varsa o, yoksa bizdeki ad basılır", () => {
    const row = { itemName: "X", colorName: "Ekru", alias: "ABC" };
    expect(itemAliasDeleteText(row, "KREM")).toContain('müşterinin genel renk adı "KREM"');
    expect(itemAliasDeleteText(row, null)).toContain('bizdeki ad "Ekru"');
    expect(itemAliasDeleteText(row, undefined)).toContain("(varsa)");
  });

  it("irsaliyenin 3. kademesi anlatılır: aynı sevkte bu renkte BAŞKA kumaşın satır adı genel addan önce gelir", () => {
    const t = itemAliasDeleteText({ itemName: "X", colorName: "Ekru", alias: "P" }, "KREM");
    expect(t).toContain("irsaliyede aynı sevkte bu renkte bir sipariş satırına ad yazılmışsa (başka kumaşta olsa bile) o da önce gelir");
    expect(generalAliasDeleteText("Ekru", "KREM", [])).toContain("(başka kumaşta olsa bile)");
  });

  it("genel ad silinince kumaşa özel adların kaldığı söylenir", () => {
    const t = generalAliasDeleteText("Ekru", "KREM", ["X", "Y"]);
    expect(t).toContain('bizdeki ad "Ekru"');
    expect(t).toContain("Kumaşa özel 2 ad (X, Y) olduğu gibi kalır.");
    expect(generalAliasDeleteText("Ekru", "KREM", [])).not.toContain("olduğu gibi kalır");
  });
});

it("yalnız Aktif kumaş yeni/değişen ad kabul eder (sunucu kapısının aynası)", () => {
  expect(itemAcceptsAlias("ACTIVE")).toBe(true);
  expect(itemAcceptsAlias(undefined)).toBe(true);
  expect(itemAcceptsAlias("PHASE_OUT")).toBe(false);
  expect(itemAcceptsAlias("ARCHIVED")).toBe(false);
});
