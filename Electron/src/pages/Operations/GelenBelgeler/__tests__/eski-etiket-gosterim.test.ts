// Eski şablonda saklı "Hedef kumaş (desen)" / "Hedef renk" etiketi görüntüde katalog adına döner; diğer alanlar şablon etiketinde kalır.
// Negatif sonda: templateFieldRows'taki desen/renk dalı kaldırılınca kırmızı.
import { describe, expect, it } from "vitest";
import { templateFieldRows } from "../tanit/templateRules";

describe("şablon alan satırı etiketi", () => {
  it("⭐ desen/renk katalogdan; diğeri saklı etiketten", () => {
    const rows = templateFieldRows({ fields: [{ key: "desen", label: "Hedef kumaş (desen)" }, { key: "renk", label: "Hedef renk" }, { key: "partiNo", label: "Parti" }] });
    const by = Object.fromEntries(rows.map((r) => [r.key, r.label]));
    expect(by).toEqual({ desen: "Gelen kumaş", renk: "Gelen renk", partiNo: "Parti" });
  });
});
