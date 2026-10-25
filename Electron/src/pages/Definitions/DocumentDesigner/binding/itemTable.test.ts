import { describe, expect, it } from "vitest";
import { collectTableBindings, defaultColumns, itemTableHtml, moveColumn, tableBindingsFromHtml, toggleColumn } from "./itemTable";
import { loadFixture } from "./testContract";

const { contract } = loadFixture();
const cuval = contract.tablolar.find((t) => t.anahtar === "cuval")!;

describe("kalem tablosu", () => {
  it("data-each tr üzerinde; hücreler data-kolon + data-alan + türden filtre", () => {
    const html = itemTableHtml(cuval, ["kod", "metre"]);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const tr = doc.querySelector("tbody tr")!;
    expect(tr.getAttribute("data-each")).toBe("satir in tablolar.cuval");
    const metre = tr.querySelector('[data-kolon="metre"]')!;
    expect(metre.getAttribute("data-alan")).toBe("satir.metre");
    expect(metre.getAttribute("data-filtre")).toMatch(/^(metre|sayi: \d)$/);
    expect(doc.querySelector('tfoot [data-alan^="toplamlar."]')).not.toBeNull();
  });
  it("varsayılan kolonlar iç kolonu dışarıda bırakır", () => {
    expect(defaultColumns(cuval, [])).not.toContain("parti_kodu");
    expect(defaultColumns(cuval, cuval.kolonlar.map((k) => k.icKod ?? "").filter(Boolean)).length).toBeLessThanOrEqual(6);
  });
  it("kolon ekle/çıkar/sırala → tableBindings", () => {
    let cols = ["kod", "metre"];
    cols = toggleColumn(cuval, cols, "sira");
    expect(cols).toEqual(["kod", "sira", "metre"]);
    cols = moveColumn(cols, "metre", -1);
    expect(cols).toEqual(["kod", "metre", "sira"]);
    cols = toggleColumn(cuval, cols, "kod");
    expect(tableBindingsFromHtml(itemTableHtml(cuval, cols))).toEqual({
      cuval: { kaynak: "tablolar.cuval", degisken: "satir", kolonlar: ["metre", "sira"] },
    });
  });
  it("döngüsüz tablo bağlamaya girmez", () => {
    const div = document.createElement("div");
    div.innerHTML = '<table data-tablo="x"><tr><td>1</td></tr></table>';
    expect(collectTableBindings(div)).toEqual({});
  });
});
