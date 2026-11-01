// SY-N4: sürüm uçlarının tel biçimi — recipeId yoksa istek BUGÜNKÜYLE bayt-aynı (parametre/alan yok).
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/services/apiClient", () => ({ default: api }));
import { costItemService } from "./service";

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: { data: [] } });
  api.post.mockReset().mockResolvedValue({ data: { success: true } });
});

describe("costItemService sürüm uçları — varyant", () => {
  it("geçmiş: recipeId yoksa sorgu parametresi yok; varsa ?recipeId=", async () => {
    await costItemService.versions("i1");
    expect(api.get).toHaveBeenLastCalledWith("/api/cost/items/i1/versions", undefined);
    await costItemService.versions("i1", "r1");
    expect(api.get).toHaveBeenLastCalledWith("/api/cost/items/i1/versions", { params: { recipeId: "r1" } });
  });
  it("kayıt: recipeId null/yoksa gövdede anahtar yok; varsa gider", async () => {
    await costItemService.saveVersion("i1", { reason: "x", recipeId: null });
    expect(Object.keys(api.post.mock.calls[0]?.[1]).sort()).toEqual(["fxRates", "reason"]);
    await costItemService.saveVersion("i1", { reason: "x", recipeId: "r1" });
    expect(api.post.mock.calls[1]?.[1]).toEqual({ reason: "x", fxRates: undefined, recipeId: "r1" });
  });
});
