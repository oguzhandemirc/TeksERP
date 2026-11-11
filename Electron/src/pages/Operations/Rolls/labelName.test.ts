// "Etiketteki ad" sütunu: etiket ad/renk birleşimi + Excel değeri.
import { describe, expect, it } from "vitest";
import { labelNameOf, makeRollColumns } from "./columns";

describe("etiketteki ad", () => {
  it("ad · renk; biri boşsa diğeri; ikisi boşsa null", () => {
    expect(labelNameOf({ labelItemName: "PANOS", labelColorName: "MAVİ" })).toBe("PANOS · MAVİ");
    expect(labelNameOf({ labelItemName: "PANOS", labelColorName: " " })).toBe("PANOS");
    expect(labelNameOf({ labelItemName: null, labelColorName: "MAVİ" })).toBe("MAVİ");
    expect(labelNameOf({})).toBeNull();
  });
  it("sütun Renk'in hemen ardında, Excel değeri taşır", () => {
    const cols = makeRollColumns([]);
    const ids = cols.map((c) => ("id" in c ? c.id : undefined) ?? ("accessorKey" in c ? String(c.accessorKey) : ""));
    expect(ids[ids.indexOf("color") + 1]).toBe("labelName");
    const meta = cols[ids.indexOf("labelName")]?.meta as { exportValue: (r: unknown) => string };
    expect(meta.exportValue({ labelItemName: "PANOS", labelColorName: "MAVİ" })).toBe("PANOS · MAVİ");
  });
});
