// BEKÇİ — lot listesi servisi: `qualityStatus` düz CSV query olarak iner (filter[] öneksiz, `/stocks` sözleşmesi); kalite ucu PATCH gövdesi
import { describe, expect, it, vi } from "vitest";

const get = vi.fn();
const patch = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a) } }));
import { listYarnLots, setYarnLotQuality } from "./service";

describe("listYarnLots / setYarnLotQuality", () => {
  it("⭐ qualityStatus CSV param olarak gider; verilmezse anahtar yok", async () => {
    get.mockResolvedValue({ data: { success: true, data: [], pagination: { nextCursor: null, hasMore: false, limit: 50 } } });
    await listYarnLots({ limit: 50, isActive: true, qualityStatus: "RELEASED,ON_HOLD" });
    expect(get).toHaveBeenLastCalledWith("/api/yarn/lots", { params: { limit: 50, isActive: "true", qualityStatus: "RELEASED,ON_HOLD" } });
    await listYarnLots({ limit: 50 });
    expect(get).toHaveBeenLastCalledWith("/api/yarn/lots", { params: { limit: 50 } });
  });
  it("kalite geçişi PATCH /api/yarn/lots/:id/quality {status, note}", async () => {
    patch.mockResolvedValue({ data: { success: true, data: {} } });
    await setYarnLotQuality("lot-1", { status: "BLOCKED", note: "rapor" });
    expect(patch).toHaveBeenLastCalledWith("/api/yarn/lots/lot-1/quality", { status: "BLOCKED", note: "rapor" });
  });
});
