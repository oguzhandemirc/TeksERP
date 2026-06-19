import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

import { packingService } from "./service";

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { success: true, data: {} } });
  post.mockReset().mockResolvedValue({ data: { success: true, data: {} } });
});

describe("packingService — uç sözleşmesi", () => {
  it("createShipment → POST /shipments {orderIds}", async () => {
    await packingService.createShipment(["o1", "o2"]);
    expect(post).toHaveBeenCalledWith("/api/shipping/shipments", { orderIds: ["o1", "o2"] });
  });

  it("createShipment destination verilince ekler", async () => {
    await packingService.createShipment(["o1"], "EXPORT");
    expect(post).toHaveBeenCalledWith("/api/shipping/shipments", {
      orderIds: ["o1"],
      destination: "EXPORT",
    });
  });

  it("scan → POST /shipments/:id/scan barcode+sackId", async () => {
    await packingService.scan("sh1", "TEKS-1", "sk1");
    expect(post).toHaveBeenCalledWith("/api/shipping/shipments/sh1/scan", {
      barcode: "TEKS-1",
      sackId: "sk1",
    });
  });

  it("scan sackId yoksa body'den çıkarır (loose)", async () => {
    await packingService.scan("sh1", "TEKS-1");
    expect(post).toHaveBeenCalledWith("/api/shipping/shipments/sh1/scan", { barcode: "TEKS-1" });
  });

  it("removeRoll → POST /shipments/:id/remove-roll {rollId}", async () => {
    await packingService.removeRoll("sh1", "r1");
    expect(post).toHaveBeenCalledWith("/api/shipping/shipments/sh1/remove-roll", { rollId: "r1" });
  });

  it("moveRollToSack → POST /rolls/:id/move-sack {sackId}", async () => {
    await packingService.moveRollToSack("r1", "sk2");
    expect(post).toHaveBeenCalledWith("/api/shipping/rolls/r1/move-sack", { sackId: "sk2" });
  });

  it("swapRollSacks → POST /rolls/swap-sacks {rollAId,rollBId}", async () => {
    await packingService.swapRollSacks("a", "b");
    expect(post).toHaveBeenCalledWith("/api/shipping/rolls/swap-sacks", { rollAId: "a", rollBId: "b" });
  });

  it("addSack weightKg yoksa boş body", async () => {
    await packingService.addSack("sh1");
    expect(post).toHaveBeenCalledWith("/api/shipping/shipments/sh1/sacks", {});
  });

  it("weighSack body'yi aynen geçer", async () => {
    await packingService.weighSack("sk1", { weightKg: 24.5, manualCode: "A1" });
    expect(post).toHaveBeenCalledWith("/api/shipping/sacks/sk1/weigh", {
      weightKg: 24.5,
      manualCode: "A1",
    });
  });

  it("removeSack düz vs withContents", async () => {
    await packingService.removeSack("sk1");
    expect(post).toHaveBeenCalledWith("/api/shipping/sacks/sk1/remove", {});
    await packingService.removeSack("sk1", true);
    expect(post).toHaveBeenCalledWith("/api/shipping/sacks/sk1/remove", { withContents: true });
  });

  it("markReady → POST /shipments/:id/ready", async () => {
    await packingService.markReady("sh1");
    expect(post).toHaveBeenCalledWith("/api/shipping/shipments/sh1/ready", {});
  });

  it("findShipmentIdBySackCode tek distinkt sevkiyat → id döner", async () => {
    get.mockResolvedValue({
      data: { data: [{ shipment: { id: "sh1" } }, { shipment: { id: "sh1" } }] },
    });
    await expect(packingService.findShipmentIdBySackCode("CV-260619-001")).resolves.toBe("sh1");
  });

  it("findShipmentIdBySackCode birden çok distinkt → null (belirsiz)", async () => {
    get.mockResolvedValue({
      data: { data: [{ shipment: { id: "sh1" } }, { shipment: { id: "sh2" } }] },
    });
    await expect(packingService.findShipmentIdBySackCode("X")).resolves.toBeNull();
  });

  it("findShipmentIdBySackCode eşleşme yok → null", async () => {
    get.mockResolvedValue({ data: { data: [] } });
    await expect(packingService.findShipmentIdBySackCode("X")).resolves.toBeNull();
  });
});
