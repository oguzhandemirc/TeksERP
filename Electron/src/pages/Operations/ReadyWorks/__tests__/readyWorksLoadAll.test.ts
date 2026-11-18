import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAGED_PICKER_MAX_PAGES, PAGED_PICKER_PAGE_SIZE } from "@/lib/picker-loader";

// "Tümünü çek" okumaları tavanda SESSİZ KESMEZ: ya sonuna kadar gelir ya açık hata fırlatır.
const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (url: string) => get(url) } }));

import { getAllReadyWorks, getReadyWorkRolls } from "../service";

const rowsPage = (n: number, next: string | null) => ({
  data: {
    success: true,
    data: {
      items: Array.from({ length: n }, (_, i) => ({ id: `w${i}` })),
      nextCursor: next,
      summary: {},
      policy: {},
    },
  },
});

beforeEach(() => get.mockReset());

describe("getAllReadyWorks — tek yükleyici", () => {
  it("imleç bitene kadar bütün sayfaları toplar (eski 10 sayfa tavanını aşar)", async () => {
    let call = 0;
    get.mockImplementation(async () => {
      call += 1;
      return rowsPage(PAGED_PICKER_PAGE_SIZE, call < 12 ? `c${call}` : null);
    });
    const out = await getAllReadyWorks("customer");
    expect(get).toHaveBeenCalledTimes(12);
    expect(out).toHaveLength(12 * PAGED_PICKER_PAGE_SIZE);
    expect(get.mock.calls[1]?.[0]).toContain("cursor=c1");
    expect(get.mock.calls[0]?.[0]).toContain(`limit=${PAGED_PICKER_PAGE_SIZE}`);
  });

  it("tavanda imleç bitmiyorsa sessizce kesmez, açık hata fırlatır", async () => {
    get.mockImplementation(async () => rowsPage(PAGED_PICKER_PAGE_SIZE, "devam"));
    await expect(getAllReadyWorks("customer")).rejects.toThrow(/çok büyük/);
    expect(get).toHaveBeenCalledTimes(PAGED_PICKER_MAX_PAGES);
  });
});

describe("getReadyWorkRolls — tavanda açık hata", () => {
  it("son sayfada imleç null ise tümünü döndürür", async () => {
    get.mockResolvedValueOnce(rowsPage(3, "c1")).mockResolvedValueOnce(rowsPage(2, null));
    expect(await getReadyWorkRolls("workOrder", "wo1")).toHaveLength(5);
  });

  it("maxPages dolup imleç sürüyorsa eksik liste döndürmez", async () => {
    get.mockImplementation(async () => rowsPage(1, "devam"));
    await expect(getReadyWorkRolls("workOrder", "wo1", [], 3)).rejects.toThrow(/eksik gösterilmez/);
    expect(get).toHaveBeenCalledTimes(3);
  });
});
