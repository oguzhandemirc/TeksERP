// Parti listesi süzme/sıralama (saf) — `packingLotList.ts`
//   §1 durum süzgeci + ad/not araması (Türkçe katlama, tek kaynak `foldedIncludes`)
//   §2 ad sıralaması SAYI-DUYARLI (SP-2 < SP-10); tartısız (null kg) her yönde sona
//   §3 başlık tıklama: aynı anahtar yön çevirir; yeni anahtar sayısalda DESC, adda ASC
import { describe, expect, it } from "vitest";
import { DEFAULT_LOT_SORT, filterLots, nextLotSort, sortLots } from "./packingLotList";
import type { PackingGroup } from "./types";

const lot = (o: Partial<PackingGroup>): PackingGroup => ({
  id: o.name ?? "x", name: "SP-1", seq: 1, note: null, sackCount: 0, rollCount: 0, swatchCount: 0, totalQty: 0, weightKg: null,
  createdAt: "2026-09-01T00:00:00Z", status: "OPEN", closedAt: null, shippedSackCount: 0, nextPackageNo: 1, ...o,
});

describe("parti listesi", () => {
  const rows = [
    lot({ name: "SP-10", totalQty: 50, weightKg: 5, createdAt: "2026-09-03T00:00:00Z" }),
    lot({ name: "SP-2", totalQty: 300, weightKg: null, createdAt: "2026-09-02T00:00:00Z", note: "Cuma tırı" }),
    lot({ name: "SP-1", totalQty: 100, weightKg: 20, status: "CLOSED", createdAt: "2026-09-01T00:00:00Z" }),
  ];
  it("§1 süzme", () => {
    expect(filterLots(rows, { query: "", status: "OPEN" }).map((r) => r.name)).toEqual(["SP-10", "SP-2"]);
    expect(filterLots(rows, { query: "", status: "CLOSED" }).map((r) => r.name)).toEqual(["SP-1"]);
    expect(filterLots(rows, { query: "CUMA", status: "ALL" }).map((r) => r.name)).toEqual(["SP-2"]);
    expect(filterLots(rows, { query: "sp-1", status: "ALL" }).map((r) => r.name)).toEqual(["SP-10", "SP-1"]);
  });
  it("§2 sıralama", () => {
    expect(sortLots(rows, DEFAULT_LOT_SORT).map((r) => r.name)).toEqual(["SP-10", "SP-2", "SP-1"]);
    expect(sortLots(rows, { key: "name", dir: "asc" }).map((r) => r.name)).toEqual(["SP-1", "SP-2", "SP-10"]);
    expect(sortLots(rows, { key: "weightKg", dir: "asc" }).map((r) => r.name)).toEqual(["SP-10", "SP-1", "SP-2"]);
    expect(sortLots(rows, { key: "weightKg", dir: "desc" }).map((r) => r.name)).toEqual(["SP-1", "SP-10", "SP-2"]);
    expect(sortLots(rows, { key: "totalQty", dir: "desc" }).map((r) => r.name)).toEqual(["SP-2", "SP-1", "SP-10"]);
  });
  it("§3 başlık tıklama", () => {
    expect(nextLotSort(DEFAULT_LOT_SORT, "createdAt")).toEqual({ key: "createdAt", dir: "asc" });
    expect(nextLotSort(DEFAULT_LOT_SORT, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextLotSort(DEFAULT_LOT_SORT, "totalQty")).toEqual({ key: "totalQty", dir: "desc" });
  });
});

describe("parti kodu", () => {
  it("§9 arama koda da vurur (tam ve kısmi); kod sıralanır", () => {
    const rows = [lot({ name: "P-1", code: "PRT-2609-0002" }), lot({ name: "P-2", code: "PRT-2609-0010" })];
    expect(filterLots(rows, { query: "0010", status: "ALL" }).map((r) => r.name)).toEqual(["P-2"]);
    expect(filterLots(rows, { query: "prt-2609-0002", status: "ALL" }).map((r) => r.name)).toEqual(["P-1"]);
    expect(sortLots(rows, { key: "code", dir: "desc" }).map((r) => r.code)).toEqual(["PRT-2609-0010", "PRT-2609-0002"]);
  });
});
