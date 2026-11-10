// İE detay başlığı eylem yerleşimi: her eylem tam bir grupta; görünmeyen öğe/boş grup çizilmez; tek öğeli grup düz düğme.
import { describe, expect, it } from "vitest";
import {
  HEADER_ACTION_GROUPS,
  SHEET_ACTION_GROUPS,
  sheetActionVisibility,
  headerActionVisibility,
  layoutHeaderActions,
  type HeaderActionId,
  type HeaderActionVisibility,
} from "./header-actions";
import type { WorkOrder } from "./types";

const ALL: HeaderActionId[] = [
  "addBatch", "fasonReceive", "linkOrder", "unlinkOrder", "changeColor",
  "changeWidth", "documents", "events", "complete", "cancel",
];
const vis = (on: HeaderActionId[]): HeaderActionVisibility =>
  Object.fromEntries(ALL.map((a) => [a, on.includes(a)])) as HeaderActionVisibility;
const wo = (status: string, links = 0) =>
  ({ status, type: "STOCK_PRODUCTION", targetItemId: null, targetColorId: null, orderLinks: Array.from({ length: links }, (_, i) => ({ orderLineId: `l${i}` })) }) as unknown as WorkOrder;

describe("İE başlık eylem grupları", () => {
  it("§1 her eylem TAM BİR grupta", () => {
    const seen = HEADER_ACTION_GROUPS.flatMap((g) => g.actions);
    expect([...seen].sort()).toEqual([...ALL].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("§2 hepsi görünür → dört menü; Durum'da Kapat üstte, ayırıcı, İptal Et en altta (yıkıcı)", () => {
    const slots = layoutHeaderActions(vis(ALL));
    expect(slots.map((s) => [s.kind, s.group])).toEqual([
      ["menu", "uretim"], ["menu", "degistir"], ["menu", "kayitlar"], ["menu", "durum"],
    ]);
    const durum = slots[3];
    expect(durum?.kind === "menu" && durum.items).toEqual([
      { kind: "item", action: "complete", destructive: false },
      { kind: "separator" },
      { kind: "item", action: "cancel", destructive: true },
    ]);
  });

  it("§3 görünmeyen öğe çizilmez, boş grup çizilmez, tek öğeli grup düz düğme", () => {
    const slots = layoutHeaderActions(vis(["documents", "events", "cancel", "linkOrder", "fasonReceive"]));
    expect(slots.find((s) => s.group === "degistir")).toBeUndefined();
    const durum = slots.find((s) => s.group === "durum");
    expect(durum).toEqual({ kind: "button", group: "durum", action: "cancel" });
    const uretim = slots.find((s) => s.group === "uretim");
    expect(uretim?.kind === "menu" && uretim.items.map((i) => (i.kind === "item" ? i.action : "-"))).toEqual(["fasonReceive", "linkOrder"]);
    expect(layoutHeaderActions(vis([]))).toEqual([]);
  });

  it("§4 görünürlük eski düğmelerle aynı: izinsiz yalnız Belgeler + Hareketler", () => {
    const v = headerActionVisibility(wo("IN_PROGRESS", 1), []);
    expect(ALL.filter((a) => v[a])).toEqual(["documents", "events"]);
  });

  it("§5 durum kapıları: PLANNED'da Kapat yok; COMPLETED'ta plan değişikliği/İptal/Parti Ekle/Bağ Kopar yok", () => {
    const p = headerActionVisibility(wo("PLANNED", 1), ["workorder:write"]);
    expect(p.complete).toBe(false);
    expect(p.cancel && p.addBatch && p.changeColor && p.unlinkOrder).toBe(true);
    const c = headerActionVisibility(wo("COMPLETED", 1), ["workorder:write"]);
    expect(ALL.filter((a) => c[a])).toEqual(["fasonReceive", "linkOrder", "documents", "events"]);
    const i = headerActionVisibility(wo("IN_PROGRESS"), ["workorder:write"]);
    expect(i.complete).toBe(true);
    expect(i.unlinkOrder).toBe(false);
  });
});

describe("İE yan panel eylem grupları (aynı görünürlük kaynağı)", () => {
  it("§S1 başlığın her eylemi + edit + printHistory TAM BİR panel grubunda", () => {
    const seen = SHEET_ACTION_GROUPS.flatMap((g) => g.actions);
    expect([...seen].sort()).toEqual([...ALL, "edit", "printHistory"].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("§S2 panel görünürlüğü başlığınkini birebir taşır; edit düzenleme yolu ister, printHistory baskı izni", () => {
    const w = wo("IN_PROGRESS");
    const perms = ["workorder:write"];
    const s = sheetActionVisibility(w, perms, true);
    for (const a of ALL) expect(s[a]).toBe(headerActionVisibility(w, perms)[a]);
    expect(s.edit).toBe(true);
    expect(s.printHistory).toBe(false);
    expect(sheetActionVisibility(w, perms, false).edit).toBe(false);
    expect(sheetActionVisibility(w, ["system:print-history"], true)).toMatchObject({ printHistory: true, edit: false });
  });
});
