// D3 "Devereci elinde" sekmesi: devereci başına grup + sunucunun sayısı · gövdenin geliş yolu (sipariş/sevk no ya da elle)
// · boş durum metni. Sayılar ve gruplama sunucudan; sekme hesap yapmaz.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { BodiesAtWarpers } from "./at-warpers";
import { AtWarpersTab } from "./AtWarpersTab";

const get = vi.fn<(p: { search?: string }) => Promise<BodiesAtWarpers>>();
vi.mock("./at-warpers", async (orig) => ({
  ...(await orig<typeof import("./at-warpers")>()),
  getBodiesAtWarpers: (p: { search?: string }) => get(p),
}));

const ours = { kind: "OURS" as const, label: "Bizim", customer: null };

describe("AtWarpersTab", () => {
  beforeEach(() => get.mockReset());
  it("devereci grubu, sunucu sayısı ve geliş yolu", async () => {
    get.mockResolvedValue({
      data: [{
        subcontractor: { id: "s1", name: "Yıldız Devere" }, count: 2,
        bodies: [
          { id: "b1", bodyNo: "LG-1", owner: ours, sentWith: { dispatchId: "d1", dispatchNo: "SD-2611-000001", warpingOrderId: "o1", orderNo: "DV-2611-0001", at: "2026-11-20T08:00:00.000Z" }, statusSince: "2026-11-20T08:00:00.000Z", statusAgeDays: 8 },
          { id: "b9", bodyNo: "LG-9", owner: ours, sentWith: null, statusSince: "2026-11-01T08:00:00.000Z", statusAgeDays: 27 },
        ],
      }],
      summary: { bodyCount: 2, warperCount: 1 },
      truncated: false,
    });
    renderWithProviders(<AtWarpersTab />);
    expect(await screen.findByText("Yıldız Devere")).toBeTruthy();
    expect(screen.getByText("2 gövde · 1 devereci")).toBeTruthy();
    expect(screen.getByText("DV-2611-0001 siparişiyle gönderildi (SD-2611-000001)")).toBeTruthy();
    expect(screen.getByText("Elle gönderildi ya da deverecide kaydedildi")).toBeTruthy();
    expect(screen.getByText("27 gün")).toBeTruthy();
  });
  it("boşken açık 'gövde yok' metni", async () => {
    get.mockResolvedValue({ data: [], summary: { bodyCount: 0, warperCount: 0 }, truncated: false });
    renderWithProviders(<AtWarpersTab />);
    expect(await screen.findByText("Şu an hiçbir deverecide boş gövdemiz yok.")).toBeTruthy();
  });
});
