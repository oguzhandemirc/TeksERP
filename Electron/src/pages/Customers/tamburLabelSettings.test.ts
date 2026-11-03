import { describe, expect, it } from "vitest";
import { toForm, toPayload } from "./tamburLabelSettings";

describe("müşteri tambur/etiket ayarları", () => {
  it("boş kart = bugünkü davranış", () => {
    const f = toForm({});
    expect(f).toEqual({ widthSource: "", weighRequired: false, splitLength: "" });
    expect(toPayload(f)).toEqual({ ok: true, body: { labelWidthSource: null, tamburWeighRequired: false, tamburSplitLengthM: null } });
  });
  it("gelen en + tartım + 50 m bölme", () => {
    const r = toPayload({ widthSource: "INCOMING", weighRequired: true, splitLength: "50" });
    expect(r).toEqual({ ok: true, body: { labelWidthSource: "INCOMING", tamburWeighRequired: true, tamburSplitLengthM: 50 } });
  });
  it("Decimal metni virgüllü görünür, virgüllü giriş sayıya döner", () => {
    expect(toForm({ tamburSplitLengthM: "50.50" }).splitLength).toBe("50,5");
    const r = toPayload({ widthSource: "", weighRequired: false, splitLength: "50,25" });
    expect(r.ok && r.body.tamburSplitLengthM).toBe(50.25);
  });
  it("bozuk bölme ölçüsü reddedilir", () => {
    expect(toPayload({ widthSource: "", weighRequired: false, splitLength: "0" }).ok).toBe(false);
    expect(toPayload({ widthSource: "", weighRequired: false, splitLength: "abc" }).ok).toBe(false);
  });
});
