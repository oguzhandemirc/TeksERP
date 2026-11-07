// "Depoda (tümü)" kaynağı: mevcut top listesi ucu, bitmiş statü kümesi, çuval/sevk süzgeci YOK, fire dahil.
import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

import { FINISHED_ROLL_STATUSES, finishedCells, loadAllFinishedStock } from "./sources";

beforeEach(() => get.mockReset());

describe("loadAllFinishedStock", () => {
  it("izin yoksa uç çağrılmaz, gerekçe döner", async () => {
    const r = await loadAllFinishedStock(false);
    expect(r.value).toBeNull();
    expect(r.notes[0]).toContain("roll:read");
    expect(get).not.toHaveBeenCalled();
  });

  it("bitmiş statüler + fire dahil ister; çuval/sevk kapsamı göndermez; sayfaları birleştirir", async () => {
    get
      .mockResolvedValueOnce({
        data: { data: [{ itemId: "i1", colorId: "c1", width: "150.000", currentQty: "70.5", sackId: "s1" }], pagination: { nextCursor: "n1" } },
      })
      .mockResolvedValueOnce({
        data: { data: [{ itemId: "i1", colorId: null, width: null, currentQty: 30, shipmentId: "sh1" }], pagination: { nextCursor: null } },
      });
    const r = await loadAllFinishedStock(true);
    const url = decodeURIComponent(String(get.mock.calls[0]?.[0]));
    expect(url.startsWith("/api/rolls")).toBe(true);
    expect(url).toContain(`filter[statusIn]=${FINISHED_ROLL_STATUSES.join(",")}`);
    expect(url).toContain("filter[includeFire]=true");
    expect(url).not.toContain("shipmentScope");
    expect(r.value).toEqual([
      { itemId: "i1", colorId: "c1", width: 150, qty: 70.5 },
      { itemId: "i1", colorId: null, width: null, qty: 30 },
    ]);
    expect(r.notes).toEqual([]);
  });

  it("uç hatasında sayı uydurmaz", async () => {
    get.mockRejectedValueOnce(new Error("500"));
    const r = await loadAllFinishedStock(true);
    expect(r.value).toBeNull();
    expect(r.notes[0]).toContain("Depoda (tümü) ölçülemedi");
  });
});

describe("finishedCells", () => {
  it("boş en null kalır, bozuk miktar 0", () => {
    expect(finishedCells([{ itemId: "i", colorId: null, width: "", currentQty: "x" }])).toEqual([
      { itemId: "i", colorId: null, width: null, qty: 0 },
    ]);
  });
});
