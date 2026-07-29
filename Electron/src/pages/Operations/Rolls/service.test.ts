import { describe, it, expect, vi, beforeEach } from "vitest";
import apiClient from "@/services/apiClient";
import { rollService } from "./service";

// apiClient'i mock'la — fason özet ucunun URL sözleşmesini doğrula.
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;

describe("rollService — fasonda özet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      data: {
        success: true,
        data: { total: { rollCount: 0, totalQty: 0 }, byCategory: [], bySubcontractor: [] },
      },
    });
  });

  it("getSubcontractorSummary → GET /api/rolls/subcontractor-summary", async () => {
    await rollService.getSubcontractorSummary();
    expect(mockGet).toHaveBeenCalledWith("/api/rolls/subcontractor-summary");
  });

  it("getSubcontractorSummary ApiResponse.data'yı döndürür", async () => {
    const payload = {
      total: { rollCount: 3, totalQty: 250 },
      byCategory: [{ categoryId: "c1", name: "Boyahane", rollCount: 3, totalQty: 250 }],
      bySubcontractor: [
        {
          subcontractorId: "s1",
          name: "ABC Boya",
          code: "ABC",
          rollCount: 3,
          totalQty: 250,
          oldestDispatchedAt: "2026-07-01T09:00:00.000Z",
          oldestDays: 28,
        },
      ],
    };
    mockGet.mockResolvedValue({ data: { success: true, data: payload } });
    const res = await rollService.getSubcontractorSummary();
    expect(res.data).toEqual(payload);
  });

  it("null grupları (Bilinmiyor) sözleşmeye uyar — subcontractorId/categoryId null", async () => {
    const payload = {
      total: { rollCount: 1, totalQty: 42 },
      byCategory: [{ categoryId: null, name: "Bilinmiyor", rollCount: 1, totalQty: 42 }],
      bySubcontractor: [
        {
          subcontractorId: null,
          name: "Bilinmiyor",
          code: null,
          rollCount: 1,
          totalQty: 42,
          oldestDispatchedAt: null,
          oldestDays: null,
        },
      ],
    };
    mockGet.mockResolvedValue({ data: { success: true, data: payload } });
    const res = await rollService.getSubcontractorSummary();
    const firm = res.data.bySubcontractor[0];
    const cat = res.data.byCategory[0];
    expect(firm?.subcontractorId).toBeNull();
    expect(firm?.oldestDays).toBeNull();
    expect(cat?.categoryId).toBeNull();
  });
});
