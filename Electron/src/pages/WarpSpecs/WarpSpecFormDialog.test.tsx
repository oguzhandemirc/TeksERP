import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WarpPlanBody, WarpPlanResult } from "@/pages/Operations/WarpPlan/types";
import { WarpSpecFormDialog } from "./WarpSpecFormDialog";
import { buildDefaults, copyDraft } from "./payload";
import type { WarpSpec } from "./types";

const suggest = vi.fn();
const lastBody: { v: WarpPlanBody | null } = { v: null };
const planResult: WarpPlanResult = {
  mode: "FROM_BEAMS", warpSpec: null, fixedWasteM: 0, stock: { known: false, emanetAcik: false, subcontractorId: null },
  yarns: [
    { yarnItemId: "y1", code: "PES-150", name: "PES 150", denier: 150, sortOrder: 0, emanetKg: null },
    { yarnItemId: "y2", code: "PES-75", name: "PES 75", denier: 75, sortOrder: 1, emanetKg: null },
  ],
  forward: {
    lengthM: 1000, grossLengthM: 1000, hasWaste: false, wasteSources: [],
    lines: [
      { yarnItemId: "y1", endsCount: 3000, wastePct: 0, netKg: 50, grossKg: 50, depoKg: null, fasondaKg: null, sendKg: 50, depoShortKg: null },
      { yarnItemId: "y2", endsCount: 4000, wastePct: 0, netKg: 33.333, grossKg: 33.333, depoKg: null, fasondaKg: null, sendKg: 33.333, depoShortKg: null },
    ],
    totals: { netKg: 83.333, grossKg: 83.333, sendKg: 83.333 },
  },
  reverse: null,
};
vi.mock("@/pages/Operations/WarpPlan/service", () => ({
  suggestWarpEnds: (b: unknown) => suggest(b),
  useWarpPlan: (body: WarpPlanBody | null) => {
    lastBody.v = body;
    return { data: body ? { success: true, data: planResult } : undefined, isError: false };
  },
}));
vi.mock("@/pages/Items/service", () => ({
  itemService: { getById: vi.fn(async (id: string) => ({ success: true, data: { id, code: id.toUpperCase(), name: `İplik ${id}` } })), listCursor: vi.fn(), list: vi.fn() },
}));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));

const spec: WarpSpec = {
  id: "s1", code: "UA-Ç", name: "UA çözgüsü", yarnItemId: "y1", endsCount: 7000, selvedgeEnds: null, reedNo: 20, endsPerDent: 1,
  reedWidthCm: 350, takeUpPct: null, wastePct: null, notes: null, isActive: true, createdAt: "", updatedAt: "",
  yarns: [
    { yarnItemId: "y1", endsCount: 3000, sortOrder: 0 },
    { yarnItemId: "y2", endsCount: 4000, sortOrder: 1 },
  ],
  sequenceNote: "3A 4B",
};

function renderDialog(props: Partial<Parameters<typeof WarpSpecFormDialog>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WarpSpecFormDialog open onOpenChange={() => {}} onSubmit={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  suggest.mockReset();
  lastBody.v = null;
});

describe("WarpSpecFormDialog — D3 satır editörü", () => {
  it("çok iplikli kart: harfli satırlar, toplam tel, dizilim ve 1000 m şeridi", async () => {
    renderDialog({ initial: spec });
    expect(screen.getByText("Çözgü Kartını Düzenle")).toBeTruthy();
    expect(screen.getByLabelText("A tel adedi")).toHaveProperty("value", "3000");
    expect(screen.getByLabelText("B tel adedi")).toHaveProperty("value", "4000");
    expect(screen.getByTestId("warp-total-ends").textContent).toMatch(/7\.?000/);
    expect(screen.getByLabelText("Dizilim (talimat)", { exact: false })).toHaveProperty("value", "3A 4B");
    const strip = screen.getByTestId("warp-preview-strip");
    expect(strip.textContent).toContain("A PES-150 50,000 kg · B PES-75 33,333 kg");
    // Fire yok → fireli satır gösterilmez.
    expect(strip.textContent).not.toContain("Fireli");
    expect(lastBody.v).toMatchObject({ beamCount: 1, beamLengthM: 1000, fixedWasteM: 0, lines: [{ yarnItemId: "y1", endsCount: 3000 }, { yarnItemId: "y2", endsCount: 4000 }] });
  });

  it("İplik ekle yeni harfli satır açar; satır silinince toplam düşer", async () => {
    const user = userEvent.setup();
    renderDialog({ initial: spec });
    await user.click(screen.getByRole("button", { name: /İplik ekle/ }));
    expect(screen.getByLabelText("C tel adedi")).toBeTruthy();
    await user.click(screen.getByLabelText("B satırını sil"));
    expect(screen.getByTestId("warp-total-ends").textContent).toMatch(/3\.?000$/);
  });

  it("1000 m'ye kg'dan: önerilen tel satıra yazılır", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ endsCount: 3000, diffKg: 0, denier: 150 });
    renderDialog({ initial: { ...spec, yarns: [spec.yarns![0]!] } });
    await user.click(screen.getByRole("button", { name: /1000 m'ye kg'dan/ }));
    await user.type(screen.getByLabelText("1000 metrede kg"), "50");
    await user.click(screen.getByRole("button", { name: "Tele çevir" }));
    await waitFor(() => expect(suggest).toHaveBeenCalledWith({ kind: "KG_PER_1000M", yarnItemId: "y1", kgPer1000m: 50 }));
    await waitFor(() => expect(screen.getByLabelText("A tel adedi")).toHaveProperty("value", "3000"));
  });

  it("Taraktan: tek satırda uygular, çok satırda yalnız gösterir", async () => {
    const user = userEvent.setup();
    suggest.mockResolvedValue({ endsCount: 7000, diffKg: null, denier: null });
    renderDialog({ initial: spec });
    await user.click(screen.getByRole("button", { name: /Taraktan/ }));
    await waitFor(() => expect(suggest).toHaveBeenCalledWith({ kind: "REED", reedPerCm: 20, widthCm: 350, endsPerDent: 1 }));
    expect((await screen.findByTestId("reed-helper-note")).textContent).toContain("paylaştırın");
    expect(screen.getByLabelText("A tel adedi")).toHaveProperty("value", "3000");
  });

  it("Kopyala taslağı: başlık kopya, kod boş, satırlar dolu", () => {
    renderDialog({ draft: copyDraft(spec) });
    expect(screen.getByText("Çözgü Kartını Kopyala")).toBeTruthy();
    expect(screen.getByLabelText("Kod", { exact: false })).toHaveProperty("value", "");
    expect(screen.getByLabelText("B tel adedi")).toHaveProperty("value", "4000");
    expect(buildDefaults(null).yarns).toHaveLength(1);
  });
});
