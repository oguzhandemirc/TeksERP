import { describe, it, expect, vi } from "vitest";
import { loadAllForPicker, loadAllPagesForPicker, PAGED_PICKER_MAX_PAGES, PAGED_PICKER_PAGE_SIZE, PICKER_MAX_PAGE_SIZE } from "./picker-loader";
import type { CrudService } from "@/services/crudService";

// Minimal sahte CrudService — yalnız getAll'ı kullanır.
function fakeService(total: number): CrudService<{ id: string }> {
  return {
    getAll: vi.fn(async (params) => ({
      success: true,
      data: [],
      pagination: { total, page: params.page, pageSize: params.pageSize, totalPages: 1 },
    })),
  } as unknown as CrudService<{ id: string }>;
}

describe("loadAllForPicker", () => {
  it("pageSize = PICKER_MAX_PAGE_SIZE ve varsayılan sort/filter ile çağırır", async () => {
    const svc = fakeService(10);
    await loadAllForPicker(svc);
    expect(svc.getAll).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: PICKER_MAX_PAGE_SIZE,
        sortBy: "name",
        sortOrder: "asc",
      }),
    );
  });

  it("toplam sınırı aşarsa sessiz kesmek yerine HATA fırlatır", async () => {
    const svc = fakeService(PICKER_MAX_PAGE_SIZE + 1);
    await expect(loadAllForPicker(svc)).rejects.toThrow(/çok büyük/);
  });

  it("sınır içinde sonucu döndürür", async () => {
    const svc = fakeService(PICKER_MAX_PAGE_SIZE);
    const res = await loadAllForPicker(svc);
    expect(res.success).toBe(true);
  });

  it("özel filtre/sort geçirilir", async () => {
    const svc = fakeService(5);
    await loadAllForPicker(svc, { filters: { isActive: "true", itemType: "FABRIC" }, sortBy: "code" });
    expect(svc.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "code", filters: { isActive: "true", itemType: "FABRIC" } }),
    );
  });
});

// Sayfalı uç (CrudService değil, ör. `/api/yarn/stocks` — tavan 200): sayfa sayfa sonuna kadar.
function pagedSource(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `r${i}` }));
  return vi.fn(async (page: number, pageSize: number) => ({
    data: rows.slice((page - 1) * pageSize, page * pageSize),
    pagination: { total },
  }));
}

describe("loadAllPagesForPicker", () => {
  it("sayfa boyu helper'ın sabitidir ve uç tavanının (200) altında kalır", () => {
    expect(PAGED_PICKER_PAGE_SIZE).toBeLessThanOrEqual(200);
  });

  it("tavanı aşan kümeyi KESMEDEN getirir (250 satır → 3 sayfa)", async () => {
    const fetch = pagedSource(250);
    const rows = await loadAllPagesForPicker(fetch);
    expect(rows).toHaveLength(250);
    expect(rows[249]).toEqual({ id: "r249" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(1, 1, PAGED_PICKER_PAGE_SIZE);
    expect(fetch).toHaveBeenNthCalledWith(3, 3, PAGED_PICKER_PAGE_SIZE);
  });

  it("tam sayfa katında fazladan istek atmaz (toplam = sayfa boyu)", async () => {
    const fetch = pagedSource(PAGED_PICKER_PAGE_SIZE);
    expect(await loadAllPagesForPicker(fetch)).toHaveLength(PAGED_PICKER_PAGE_SIZE);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("boş küme tek istekle boş döner", async () => {
    const fetch = pagedSource(0);
    expect(await loadAllPagesForPicker(fetch)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("kaçak döngüde sessiz kesmek yerine HATA fırlatır", async () => {
    const fetch = pagedSource(PAGED_PICKER_PAGE_SIZE * PAGED_PICKER_MAX_PAGES + 1);
    await expect(loadAllPagesForPicker(fetch)).rejects.toThrow(/çok büyük/);
  });
});
