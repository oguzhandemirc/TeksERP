// Teknik özet şeridi — sayılar sunucudan (istemci bölmez), bilinmeyen "—", kumaş yoksa çizilmez.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const computedGsm = vi.fn();
vi.mock("@/pages/Items/service", async (orig) => {
  const m = await orig<typeof import("@/pages/Items/service")>();
  return { ...m, itemService: { ...m.itemService, computedGsm: (...a: unknown[]) => computedGsm(...a) } };
});
import { TechSummaryStrip } from "./TechSummaryStrip";

const FABRIC = { id: "it-1", code: "TUL-01", name: "Tül 01", weftSpecId: null, weaveDesignId: "wd-1" };

beforeEach(() => { computedGsm.mockReset(); });

describe("TechSummaryStrip", () => {
  it("⭐ değerler sunucu yanıtından basılır (istemci bölme yapmaz); null alan '—'", async () => {
    // Bilerek tutarsız: endsPerCm 99 (6800÷300 değil) → ekranda 99 görünmeli
    computedGsm.mockResolvedValue({
      rawWidthCm: 300, warpGPerM: 50, weftGPerM: 40.5, totalGPerM: 90.5, gsm: 30.17, enteredRawGsm: null, diffPct: null,
      endsCount: 6800, endsPerCm: 99, picksPerCm: 28, picksInRepeat: 12, repeatCm: null, repeatsPerM: null,
    });
    renderWithProviders(<TechSummaryStrip fabric={FABRIC} />);
    await waitFor(() => expect(screen.getByTestId("tech-endsPerCm")).toHaveTextContent("99"));
    expect(computedGsm).toHaveBeenCalledWith("it-1");
    expect(screen.getByTestId("tech-endsCount")).toHaveTextContent(/6\.?800/);
    expect(screen.getByTestId("tech-repeatCm")).toHaveTextContent("—");
    expect(screen.getByTestId("tech-repeatsPerM")).toHaveTextContent("—");
    expect(screen.getByTestId("tech-gsm")).toHaveTextContent(/30,17/);
  });

  it("eski sunucu (özet alanı yok) → '—', hata yok", async () => {
    computedGsm.mockResolvedValue({ rawWidthCm: 300, warpGPerM: 50, weftGPerM: 40, totalGPerM: 90, gsm: 30, enteredRawGsm: null, diffPct: null });
    renderWithProviders(<TechSummaryStrip fabric={FABRIC} />);
    await waitFor(() => expect(screen.getByTestId("tech-gsm")).toHaveTextContent("30"));
    expect(screen.getByTestId("tech-endsCount")).toHaveTextContent("—");
  });

  it("kumaş yokken şerit çizilmez, sorgu atılmaz", () => {
    renderWithProviders(<TechSummaryStrip fabric={null} />);
    expect(screen.queryByTestId("tech-summary")).toBeNull();
    expect(computedGsm).not.toHaveBeenCalled();
  });
});
