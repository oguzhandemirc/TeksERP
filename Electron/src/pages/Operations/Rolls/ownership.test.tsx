// Envanter mülkiyet çipi + şerit emanet payı (genel fason P1).
//  §1 "Mülkiyet" çipi yalnız emanet açıkken; satırda (+ Filtre'de değil); seçenekler Bizim/Emanet, "Tümü" = anahtar yok
//  §2 şerit: emanet varsa "bunun X m'si emanet"; tamamı emanetse "tamamı emanet"; consigned yoksa/0 ise hiç çizilmez
// Negatif sonda (2026-11-08): `ConsignedShare`te `c.count === 0` dönüşü kaldırılınca §2c kırmızı.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildRollFilterDefs } from "./roll-filter-defs";
import { rollPersistConfig } from "./RollsFilterRow";
import { RollsStats } from "./RollsStats";
import type { RollStats } from "./service";

const keys = (on: boolean) => buildRollFilterDefs("RAW_STOCK", [], false, on).flatMap((f) => ("key" in f ? [f.key] : []));
const stats = (over: Partial<RollStats> = {}): RollStats => ({ totalCount: 10, totalQty: 1000, totalWeight: 0, byStatus: {}, byQuality: {}, ...over });

describe("mülkiyet çipi", () => {
  it("§1 yalnız emanet açıkken; seçenekler Bizim/Emanet; kayıt allowlist'inde", () => {
    expect(keys(false)).not.toContain("mulkiyet");
    expect(keys(true)).toContain("mulkiyet");
    const def = buildRollFilterDefs("FINISHED_STOCK", [], false, true).find((f) => "key" in f && f.key === "mulkiyet");
    expect(def && def.kind === "select" ? def.options : null).toEqual([
      { value: "OWN", label: "Bizim" },
      { value: "CONSIGNED", label: "Emanet" },
    ]);
    expect(JSON.stringify(rollPersistConfig("RAW_STOCK"))).toContain("filter[mulkiyet]");
  });
});

describe("şerit emanet payı", () => {
  it("§2a kısmi emanet: 'bunun X m'si emanet'", () => {
    render(<RollsStats data={stats({ consigned: { count: 3, qty: 250.5, weight: 0 } })} isLoading={false} scopeLabel="Ham Stok" />);
    expect(screen.getByTestId("rolls-stats-consigned").textContent).toMatch(/bunun 250,5 m'si emanet \(3 top\)/);
  });
  it("§2b tamamı emanet", () => {
    render(<RollsStats data={stats({ consigned: { count: 10, qty: 1000, weight: 0 } })} isLoading={false} scopeLabel="Ham Stok" />);
    expect(screen.getByTestId("rolls-stats-consigned").textContent).toMatch(/tamamı emanet/);
  });
  it("§2c emanet kapalı (alan yok) ya da sıfır: çizilmez", () => {
    const { rerender } = render(<RollsStats data={stats()} isLoading={false} scopeLabel="Ham Stok" />);
    expect(screen.queryByTestId("rolls-stats-consigned")).toBeNull();
    rerender(<RollsStats data={stats({ consigned: { count: 0, qty: 0, weight: 0 } })} isLoading={false} scopeLabel="Ham Stok" />);
    expect(screen.queryByTestId("rolls-stats-consigned")).toBeNull();
  });
});
