import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextGateSort } from "./customerGateSort";

describe("cari kapısı sıralaması", () => {
  it("§1 tık döngüsü: sayı desc → asc → sunucu varsayılanı; ad asc → desc → varsayılan", () => {
    let s = nextGateSort(null, "sackCount");
    expect(s).toEqual({ key: "sackCount", dir: "desc" });
    s = nextGateSort(s, "sackCount");
    expect(s).toEqual({ key: "sackCount", dir: "asc" });
    expect(nextGateSort(s, "sackCount")).toBeNull();
    expect(nextGateSort(s, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextGateSort({ key: "name", dir: "desc" }, "name")).toBeNull();
  });
  it("§2 ⭐ sıralama SUNUCUDA: kapı sort'u sorgu anahtarına ve isteğe geçirir, istemcide .sort() yok", () => {
    const gate = readFileSync(join(__dirname, "SackEntryGate.tsx"), "utf-8");
    expect(gate).toMatch(/queryKey: \["sack-search", "customers", terim, withSacksOnly, sort\]/);
    expect(gate).toMatch(/sortBy: sort\?\.key,\s*sortOrder: sort\?\.dir,/);
    expect(gate).not.toMatch(/sortGateRows|\.sort\(/);
    const svc = readFileSync(join(__dirname, "service.ts"), "utf-8");
    expect(svc).toMatch(/q\.set\("sortBy", params\.sortBy\)/);
  });
});
