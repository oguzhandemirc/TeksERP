// BEKÇİ — mal kabul listesi servisi: `filter` nesnesi sunucuya `filter[k]=v` olarak iner (fatura fiş seçicisi buna yaslanır)
import { describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
import { listGoodsReceipts } from "./service";

describe("listGoodsReceipts", () => {
  it("⭐ filter → filter[k]; filtresiz istek eski gövdeyle aynı", async () => {
    get.mockResolvedValue({ data: { data: [], pagination: { total: 0, totalPages: 0 } } });
    await listGoodsReceipts({ page: 1, pageSize: 50, filter: { invoiced: "false", supplierId: "c1", status: "ACTIVE" } });
    expect(get).toHaveBeenLastCalledWith("/api/goods-receipts", { params: { page: 1, pageSize: 50, "filter[invoiced]": "false", "filter[supplierId]": "c1", "filter[status]": "ACTIVE" } });
    await listGoodsReceipts({ page: 2, pageSize: 20, search: "MK" });
    expect(get).toHaveBeenLastCalledWith("/api/goods-receipts", { params: { page: 2, pageSize: 20, search: "MK" } });
  });
});
