import { describe, it, expect, vi } from "vitest";
import { loadAllForPicker, PICKER_MAX_PAGE_SIZE } from "./picker-loader";
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
