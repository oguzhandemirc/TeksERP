// BEKÇİ — sevkiyat kurma GÖVDESİ (2026-09-23, panel turu SY2 bulgusu): `sackHubService.createShipment`
// gövdeyi elle kurar ⇒ sessiz bir allowlist'tir. `destinationChosen` düşerse ilk sevk seçimi karta
// YAZILMAZ (sunucu eski istemci sayar) — bileşen ve saf testler bunu GÖRMEZ, yalnız giden gövde görür.
// Negatif sonda: servisteki `destinationChosen` satırı silindi → ⭐ ×.
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn(async () => ({ data: { success: true, data: { id: "s1", shipmentNo: "S1", dispatched: true } } }));
vi.mock("@/services/apiClient", () => ({ default: { post: (...a: unknown[]) => post(...(a as [])), get: vi.fn(), patch: vi.fn() } }));
import { sackHubService } from "./service";

const govde = () => (post.mock.calls.at(-1) as unknown as [string, Record<string, unknown>])[1];

beforeEach(() => post.mockClear());

describe("sackHubService.createShipment gövdesi", () => {
  it("⭐ açık niyet gövdeye girer (ilk sevk seçimi karta yazılsın)", async () => {
    await sackHubService.createShipment({ sackIds: ["k1"], customerId: "c1", destination: "EXPORT", destinationChosen: true });
    expect(govde().destinationChosen).toBe(true);
    expect(govde().destination).toBe("EXPORT");
  });
  it("niyet yoksa anahtar hiç gitmez (kilitli ya da örtük değer karta yazılmaz)", async () => {
    await sackHubService.createShipment({ sackIds: ["k1"], customerId: "c1", destination: "DOMESTIC" });
    expect("destinationChosen" in govde()).toBe(false);
  });
});
