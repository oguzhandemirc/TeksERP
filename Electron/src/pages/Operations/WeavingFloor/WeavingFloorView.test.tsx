// Salon görünümü: TV kipinde çıkış görünür (köşe düğmesi), ipucu yok; uygulama kipinde çıkış
// düğmesi yok, simgeler ipucu taşır.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Sayfa başlığı tercih sağlayıcısı ister; burada yalnız eylem düğmeleri gerekir.
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }));

import { WeavingFloorView } from "./WeavingFloorView";
import type { FloorState, LiveLoom } from "./types";

const NOW = Date.parse("2026-10-10T08:30:00.000Z");

const loom: LiveLoom = {
  id: "m1", code: "MAK1010260002", hall: "Hol A", monitored: true, stateSource: "elle", loomType: null, targetRpm: null, rpm: null,
  picksPerCm: null, shift: null, today: { runSec: 2700, plannedSec: 3600 }, stops: [], dayBreakdown: [], events: [], job: null, beams: [],
  source: "OPERATOR",
  openStop: {
    reasonCode: "MEKANIK_ARIZA", label: "Mekanik arıza", lossClass: "UNPLANNED", startedAt: NOW - 30 * 60_000, targetMin: 10, graceMin: 0,
    attendant: null, notifiedAt: null, respondedAt: null, escalatedAt: null,
  },
};
const floor: FloorState = { shift: null, halls: ["Hol A"], looms: [loom], updatedAt: NOW, rng: 1 };

const cardButton = () => screen.getAllByRole("button").find((b) => b.getAttribute("aria-label")?.startsWith("Tezgah MAK1010260002, duruyor"))!;

function view(tv: boolean, onExit = () => undefined) {
  return render(
    <MemoryRouter>
      <WeavingFloorView floor={floor} now={NOW} sampleData={false} tv={tv} tvExit={tv ? { onExit, label: "TV kipinden çık" } : undefined} />
    </MemoryRouter>,
  );
}

describe("WeavingFloorView — TV çıkışı ve ipuçları", () => {
  it("⭐ TV kipi: köşede 'TV kipinden çık' görünür, Esc çıkar; ipucu açılmaz", async () => {
    const onExit = vi.fn();
    view(true, onExit);
    expect(screen.getByTestId("tv-exit").textContent).toContain("TV kipinden çık");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.focus(cardButton()));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("uygulama kipi: çıkış düğmesi yok, kart klavye odağında ipucu açar", async () => {
    view(false);
    expect(screen.queryByTestId("tv-exit")).toBeNull();
    await act(async () => fireEvent.focus(cardButton()));
    expect(screen.getByRole("tooltip").textContent).toContain("Mekanik arıza");
  });
});
