import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "@/services/apiClient";
import { swatchService } from "./swatchService";

// apiClient'i mock'la — kartela stok uçlarının URL/body sözleşmesini doğrula.
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

describe("swatchService — kartela ADET stok", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { success: true, data: [] } });
    mockPost.mockResolvedValue({ data: { success: true, data: { reduced: 0 } } });
  });

  it("getStock() aramasız → /api/kartela/stock (querysiz)", async () => {
    await swatchService.getStock();
    expect(mockGet).toHaveBeenCalledWith("/api/kartela/stock");
  });

  it("getStock({ search }) → arama encode'lu query", async () => {
    await swatchService.getStock({ search: "patos mavi" });
    expect(mockGet).toHaveBeenCalledWith("/api/kartela/stock?search=patos+mavi");
  });

  it("getStock({ itemId, colorId }) → ikisi de query'de", async () => {
    await swatchService.getStock({ itemId: "i1", colorId: "c1" });
    expect(mockGet).toHaveBeenCalledWith("/api/kartela/stock?itemId=i1&colorId=c1");
  });

  it("getStock ApiResponse.data'yı döndürür (.then(r => r.data))", async () => {
    mockGet.mockResolvedValue({
      data: { success: true, data: [{ itemId: "i1", count: 5 }] },
    });
    const res = await swatchService.getStock();
    expect(res.data).toEqual([{ itemId: "i1", count: 5 }]);
  });

  it("reduceStock gövdesi clientToken TAŞIR (replay ikinci düşüm doğurmasın)", async () => {
    const body = { itemId: "i1", colorId: "c1", count: 2, reason: "kayıp", clientToken: "tok-1" };
    await swatchService.reduceStock(body);
    expect(mockPost).toHaveBeenCalledWith("/api/kartela/stock/reduce", body);
  });

  it("reduceStock → POST /api/kartela/stock/reduce, body aynen geçer", async () => {
    const body = { itemId: "i1", colorId: "c1", count: 3, reason: "kayıp" };
    await swatchService.reduceStock(body);
    expect(mockPost).toHaveBeenCalledWith("/api/kartela/stock/reduce", body);
  });

  it("listStockReductions filtreleri query'ye koyar", async () => {
    await swatchService.listStockReductions({ itemId: "i1", colorId: "c1", cursor: "k1", limit: 30 });
    expect(mockGet).toHaveBeenCalledWith(
      "/api/kartela/stock/reductions?itemId=i1&colorId=c1&cursor=k1&limit=30",
    );
  });

  it("reverseStockReduction → POST /reductions/:id/reverse, gövdede yalnız gerekçe", async () => {
    await swatchService.reverseStockReduction("r1", "yanlış düşüm");
    expect(mockPost).toHaveBeenCalledWith("/api/kartela/stock/reductions/r1/reverse", {
      reason: "yanlış düşüm",
    });
  });

  it("reduceStock renksiz grup (colorId null) gönderebilir", async () => {
    const body = { itemId: "i1", colorId: null, count: 1, reason: "hasar" };
    await swatchService.reduceStock(body);
    expect(mockPost).toHaveBeenCalledWith("/api/kartela/stock/reduce", body);
  });
});
