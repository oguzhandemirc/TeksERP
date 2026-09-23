// BEKÇİ — planlı sevkiyatta yön hizalama GÖVDESİ (2026-09-23, gövde taraması): ilk seçim
// `chosen` ile gelir ve gövdeye `destinationChosen: true` girmezse karta YAZILMAZ.
// Negatif sonda: servisteki `destinationChosen` satırı silindi → ⭐ ×.
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn(async () => ({ data: { success: true } }));
vi.mock("@/services/apiClient", () => ({ default: { post: (...a: unknown[]) => post(...(a as [])), get: vi.fn(), patch: vi.fn() } }));
import { sackStoreService } from "./service";

const govde = () => (post.mock.calls.at(-1) as unknown as [string, Record<string, unknown>])[1];
beforeEach(() => post.mockClear());

describe("sackStoreService.setDestination gövdesi", () => {
  it("⭐ açık ilk seçim gövdeye girer", async () => {
    await sackStoreService.setDestination("sh1", "EXPORT", true);
    expect(govde()).toEqual({ destination: "EXPORT", destinationChosen: true });
  });
  it("niyet yoksa anahtar gitmez", async () => {
    await sackStoreService.setDestination("sh1", "DOMESTIC");
    expect(govde()).toEqual({ destination: "DOMESTIC" });
  });
});
