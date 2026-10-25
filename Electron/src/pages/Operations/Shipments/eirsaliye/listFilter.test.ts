// Sevkiyatlar listesi e-İrsaliye süzgeci: değerler backend kümesinin aynası; sorgu
// parametresi `filter[eIrsaliye]` (CSV) — süzme sunucuda.
import { describe, expect, it } from "vitest";
import { buildCursorQueryString } from "@/lib/query-builder";
import { EIRSALIYE_LIST_FILTER, EIRSALIYE_LIST_FILTER_VALUES } from "./listFilter";

describe("e-İrsaliye liste süzgeci", () => {
  it("backend EIRSALIYE_LIST_FILTER_VALUES ile aynı küme", () => {
    expect([...EIRSALIYE_LIST_FILTER_VALUES]).toEqual([
      "EKSIK", "TASLAK", "OLUSTURULDU", "GONDERILDI", "KABUL", "KISMI_KABUL", "REDDEDILDI", "HATA", "SIMULASYON",
    ]);
    expect(EIRSALIYE_LIST_FILTER).toMatchObject({ kind: "multi-select", key: "eIrsaliye" });
  });

  it("⭐ seçim sunucuya filter[eIrsaliye] olarak gider", () => {
    const qs = buildCursorQueryString({ limit: 50, filters: { eIrsaliye: ["EKSIK", "HATA"] } });
    const sp = new URLSearchParams(qs.slice(1));
    expect(sp.get("filter[eIrsaliye]")).toBe("EKSIK,HATA");
  });
});
