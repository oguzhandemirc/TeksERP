import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { PanoErisim } from "./usePanoErisim";
import type { PanoHareket, PanoSummary } from "./types";

vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ navigateActive: vi.fn() }) }));
vi.mock("@/components/insight/EChart", () => ({
  EChart: ({ label }: { label: string }) => <div data-testid="grafik">{label}</div>,
  withAlpha: (r: string) => r,
}));

const { PanoMovementList, HAREKET_ROZETI } = await import("./PanoMovementList");
const { tamGunEkseni } = await import("./PanoGrafikKutulari");
const { TrendAreaChart } = await import("@/components/insight/TrendAreaChart");

const erisim = { canGo: () => false } as unknown as PanoErisim;
const hareket = (tur: PanoHareket["tur"], id: string): PanoHareket => ({
  tur, belgeNo: `B-${id}`, cari: "Müşteri", miktar: 4295, birim: "m", zaman: new Date().toISOString(), hedef: { tur: "order", id },
});

describe("Son hareketler — tür rozeti", () => {
  it("her satırda pastel rozet; dar ve geniş ad, tam ad title'da", () => {
    const turler = Object.keys(HAREKET_ROZETI) as PanoHareket["tur"][];
    const { container } = render(
      <PanoMovementList hareketler={turler.map((t, i) => hareket(t, String(i)))} yukleniyor={false} hata={false} onYenile={() => {}} erisim={erisim} />,
    );
    const rozetler = [...container.querySelectorAll<HTMLElement>("[data-hareket-rozet]")];
    expect(rozetler).toHaveLength(turler.length);
    for (const r of rozetler) {
      const def = HAREKET_ROZETI[r.dataset.hareketRozet as PanoHareket["tur"]];
      expect(r.className).toContain(`tile-${def.ton}`);
      expect(r.getAttribute("title")).toBe(def.etiket);
      expect(r.textContent).toBe(def.kisa + def.etiket);
      expect(def.kisa.length).toBeLessThanOrEqual(9);
    }
    expect(container.textContent).toContain("4295 m");
  });
});

describe("Üretim ve sevk — eğilim ekseni", () => {
  const saatlik: PanoSummary["egilim"] = {
    kova: "saat",
    noktalar: [
      { anahtar: "00", uretimMetre: 4295, sevkMetre: 2452 },
      { anahtar: "1", uretimMetre: 0, sevkMetre: 0 },
    ],
  };

  it("saatlik kova 00–23 tam gün; gelmeyen saat null", () => {
    const e = tamGunEkseni(saatlik);
    expect(e.noktalar).toHaveLength(24);
    expect(e.noktalar[0]!.uretimMetre).toBe(4295);
    expect(e.noktalar[1]!.uretimMetre).toBe(0);
    expect(e.noktalar[23]).toEqual({ anahtar: "23", uretimMetre: null, sevkMetre: null });
  });

  it("günlük kova olduğu gibi kalır", () => {
    const gunluk: PanoSummary["egilim"] = { kova: "gun", noktalar: [{ anahtar: "2026-11-11", uretimMetre: 1, sevkMetre: 1 }] };
    expect(tamGunEkseni(gunluk)).toBe(gunluk);
  });

  it("veri tek kovadaysa çubuk, çok kovadaysa alan", () => {
    const fmt = (v: number) => String(v);
    const tek = render(<TrendAreaChart labels={["00", "01", "02"]} series={[{ key: "u", name: "Ü", values: [5, 0, null] }]} formatValue={fmt} label="g" />);
    expect(tek.container.querySelector("[data-chart-kind]")!.getAttribute("data-chart-kind")).toBe("bar");
    tek.unmount();
    const cok = render(<TrendAreaChart labels={["00", "01"]} series={[{ key: "u", name: "Ü", values: [5, 3] }]} formatValue={fmt} label="g" />);
    expect(cok.container.querySelector("[data-chart-kind]")!.getAttribute("data-chart-kind")).toBe("area");
  });
});
