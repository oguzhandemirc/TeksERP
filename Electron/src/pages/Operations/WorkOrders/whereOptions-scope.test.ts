// workOrderService.whereOptions: listenin kapsamı (süzgeç + arama + tarih) uca AYNEN gider
// (sunucu faceted sayar → seçenek sayısı = seçilince liste toplamı). Bulgu 1, 2026-11-04.
import { describe, it, expect, vi } from "vitest";

const { get } = vi.hoisted(() => ({
  get: vi.fn(async (_url: string) => ({ data: { success: true, data: { firms: [], stages: [] } } })),
}));
vi.mock("@/services/apiClient", () => ({ default: { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

import { workOrderService } from "./service";

describe("whereOptions isteği", () => {
  it("kapsamın tüm süzgeçleri sorgu dizgisinde", async () => {
    await workOrderService.whereOptions({
      filters: { status: "IN_PROGRESS,PLANNED", asama: "s1", hideCancelled: "true" },
      search: "Tül",
      dateField: "createdAt",
      dateFrom: "2026-10-05T00:00:00.000Z",
    });
    const url = get.mock.calls.at(-1)![0];
    expect(url.startsWith("/api/work-orders/where-options?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("filter[status]")).toBe("IN_PROGRESS,PLANNED");
    expect(qs.get("filter[asama]")).toBe("s1");
    expect(qs.get("filter[hideCancelled]")).toBe("true");
    expect(qs.get("search")).toBe("Tül");
    expect(qs.get("dateField")).toBe("createdAt");
    expect(qs.get("dateFrom")).toBe("2026-10-05T00:00:00.000Z");
    expect(qs.has("limit") || qs.has("mode") || qs.has("cursor")).toBe(false);
  });

  it("kapsamsız çağrı düz uç", async () => {
    await workOrderService.whereOptions();
    expect(get.mock.calls.at(-1)![0]).toBe("/api/work-orders/where-options");
  });
});
