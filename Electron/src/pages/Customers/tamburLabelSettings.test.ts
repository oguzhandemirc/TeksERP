import { describe, expect, it } from "vitest";
import { toForm, toPayload } from "./tamburLabelSettings";

describe("müşteri tambur/etiket ayarları", () => {
  it("boş kart = bugünkü davranış", () => {
    const f = toForm({});
    expect(f).toEqual({ widthSource: "", weighRequired: false, splitLength: "", labelBatchEnabled: false });
    expect(toPayload(f)).toEqual({ ok: true, body: { labelWidthSource: null, tamburWeighRequired: false, tamburSplitLengthM: null, tamburLabelBatchEnabled: false } });
  });
  it("gelen en + tartım + 50 m bölme", () => {
    const r = toPayload({ widthSource: "INCOMING", weighRequired: true, splitLength: "50", labelBatchEnabled: false });
    expect(r).toEqual({ ok: true, body: { labelWidthSource: "INCOMING", tamburWeighRequired: true, tamburSplitLengthM: 50, tamburLabelBatchEnabled: false } });
  });
  it("Decimal metni virgüllü görünür, virgüllü giriş sayıya döner", () => {
    expect(toForm({ tamburSplitLengthM: "50.50" }).splitLength).toBe("50,5");
    const r = toPayload({ widthSource: "", weighRequired: false, splitLength: "50,25", labelBatchEnabled: false });
    expect(r.ok && r.body.tamburSplitLengthM).toBe(50.25);
  });
  it("bozuk bölme ölçüsü reddedilir", () => {
    expect(toPayload({ widthSource: "", weighRequired: false, splitLength: "0", labelBatchEnabled: false }).ok).toBe(false);
    expect(toPayload({ widthSource: "", weighRequired: false, splitLength: "abc", labelBatchEnabled: false }).ok).toBe(false);
  });
  it("müşteri parti no anahtarı karttan forma, formdan gövdeye taşınır", () => {
    expect(toForm({ tamburLabelBatchEnabled: true }).labelBatchEnabled).toBe(true);
    const r = toPayload({ ...toForm({}), labelBatchEnabled: true });
    expect(r.ok && r.body.tamburLabelBatchEnabled).toBe(true);
  });
});
