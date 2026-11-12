// BEKÇİ — sevkiyat kurma GÖVDESİ (2026-09-23, panel turu SY2 bulgusu): `sackHubService.createShipment`
// gövdeyi elle kurar ⇒ sessiz bir allowlist'tir. `destinationChosen` düşerse ilk sevk seçimi karta
// YAZILMAZ (sunucu eski istemci sayar) — bileşen ve saf testler bunu GÖRMEZ, yalnız giden gövde görür.
// Negatif sonda: servisteki `destinationChosen` satırı silindi → ⭐ ×; `deliveryCustomerId` satırı silindi → K18 vakası × (2026-11-03).
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
  it("teslim yeri (K18) gövdeye girer", async () => {
    await sackHubService.createShipment({ sackIds: ["k1"], customerId: "c1", deliveryCustomerId: "b1", deliveryAddress: "Boyahane yolu" });
    expect(govde().deliveryCustomerId).toBe("b1");
    expect(govde().deliveryAddress).toBe("Boyahane yolu");
  });
  it("teslim yeri boşken anahtarlar hiç gitmez (eski gövde aynı; adres carisiz gitmez)", async () => {
    await sackHubService.createShipment({ sackIds: ["k1"], customerId: "c1", deliveryAddress: "yalnız adres" });
    expect("deliveryCustomerId" in govde()).toBe(false);
    expect("deliveryAddress" in govde()).toBe(false);
  });
  it("planlanan sevk günü gövdeye girer; boşken anahtar gitmez (eski gövde aynı)", async () => {
    await sackHubService.createShipment({ sackIds: ["k1"], customerId: "c1", plannedDate: "2026-11-20" });
    expect(govde().plannedDate).toBe("2026-11-20");
    await sackHubService.createShipment({ sackIds: ["k1"], customerId: "c1" });
    expect("plannedDate" in govde()).toBe(false);
  });
});
