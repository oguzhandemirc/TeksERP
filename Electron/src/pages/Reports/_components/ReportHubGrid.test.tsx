// =============================================================================
// BEKÇİ — RAPOR HUB'I İSKELETİ (tek kaydırıcı)
// =============================================================================
// `TabHost` her sayfayı `absolute inset-0 overflow-auto` ile sarar. Sayfa kendi
// yüksekliğini kısıtlamazsa (`min-h-0` yoksa) kap içeriğe göre büyür ve
// kaydırma DIŞARIYA taşar: başlık yukarı kayar, alttaki chrome görünümden
// çıkar. Sekiz rapor hub'ı 2026-09-05'e kadar elle yazılmış
// `flex h-full flex-col` kabını kullanıyordu ve bu yüzden iskeletsizdi
// (ELECTRON.md [EL-08]).
//
// Kilitlenen davranış: kabuk `min-h-0` taşır ve kaydırma TEK yerdedir —
// gövdede ([EL-07]).
// =============================================================================
import { describe, expect, it, vi } from "vitest";
import { FileBarChart } from "lucide-react";
import { renderWithProviders } from "@/test/render";
import { ReportHubGrid } from "./ReportHubGrid";

// Karo süzmesi (K5) gerçek bir katalog anahtarı ister; iskelet testi kapıyı AÇIK sabitler —
// süzmenin kendisi `ReportsHub.gate.test.tsx`te ölçülür.
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({ reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
}));

const TILES = [
  {
    key: "stok",
    title: "Stok Raporu",
    description: "Depodaki toplar",
    icon: FileBarChart,
    to: "/reports/inventory/scorecard",
  },
];

function ciz() {
  const { container } = renderWithProviders(
    <ReportHubGrid title="Envanter Raporları" tiles={TILES} />,
  );
  return container.firstElementChild as HTMLElement;
}

describe("ReportHubGrid iskeleti", () => {
  it("zemin: hub çizildi ve karo göründü", () => {
    const kabuk = ciz();
    expect(kabuk).not.toBeNull();
    expect(kabuk.textContent).toContain("Stok Raporu");
  });

  it("kabuk PageShell kalıbındadır (h-full + min-h-0 + flex-col)", () => {
    const kabuk = ciz();
    for (const c of ["flex", "h-full", "min-h-0", "flex-col"]) {
      expect(kabuk.className, `kabukta '${c}' yok`).toContain(c);
    }
  });

  it("kaydırıcı TEK ve gövdededir", () => {
    const kabuk = ciz();
    const kaydiranlar = kabuk.querySelectorAll(".overflow-auto");
    expect(kaydiranlar.length, "birden çok kaydırıcı iç içe kaydırma üretir").toBe(1);
    const govde = kaydiranlar[0] as HTMLElement;
    // PageBody: flex-1 + min-h-0 olmadan gövde içeriğe göre büyür ve kaydırma
    // yine dışarı taşar.
    expect(govde.className).toContain("flex-1");
    expect(govde.className).toContain("min-h-0");
    // Başlık gövdenin DIŞINDA kalmalı — aksi halde kaydırınca yukarı gider.
    expect(govde.textContent).not.toContain("Envanter Raporları");
  });
});
