import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WarpPlanBody, WarpPlanResult } from "@/pages/Operations/WarpPlan/types";
import { WarpSpecFormDialog } from "./WarpSpecFormDialog";
import { buildDefaults, copyDraft } from "./payload";
import type { WarpSpec } from "./types";

const suggest = vi.fn();
const bodies: Array<WarpPlanBody | null> = [];
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
    bodies.push(body);
    return { data: body ? { success: true, data: planResult } : undefined, isError: false };
  },
}));
vi.mock("@/pages/Items/service", () => ({
  itemService: { getById: vi.fn(async (id: string) => ({ success: true, data: { id, code: id.toUpperCase(), name: `İplik ${id}` } })), listCursor: vi.fn(), list: vi.fn() },
}));
const getById = vi.fn();
vi.mock("./service", () => ({ warpSpecService: { getById: (id: string) => getById(id) } }));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/production/SpecOpenOrdersNotice", () => ({ SpecOpenOrdersNotice: () => null }));

const spec: WarpSpec = {
  id: "s1", code: "UA-Ç", name: "UA çözgüsü", yarnItemId: "y1", endsCount: 7000, selvedgeEnds: null, reedNo: 200, endsPerDent: 1,
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
  getById.mockReset();
  getById.mockResolvedValue({ success: true, data: { ...spec, endsSequence: { repeat: [1, 1, 1, 2, 2, 2, 2], repeatCount: 1000, remainder: 0, totalEnds: 7000, matchesYarnEnds: true } } });
  bodies.length = 0;
});

describe("WarpSpecFormDialog — D3 satır editörü", () => {
  it("çok iplikli kart: harfli satırlar, toplam tel, dizilim ve 1000 m şeridi", async () => {
    renderDialog({ initial: spec });
    expect(screen.getByText("Çözgü Kartını Düzenle")).toBeTruthy();
    expect(screen.getByLabelText("A tel adedi")).toHaveProperty("value", "3000");
    expect(screen.getByLabelText("B tel adedi")).toHaveProperty("value", "4000");
    expect(screen.getByTestId("warp-total-ends").textContent).toMatch(/7\.?000/);
    expect(screen.getByRole("textbox", { name: /^Çözgü dizimi/ })).toHaveProperty("value", "3A 4B");
    // Hesap paneli: iplik başına tel · denye · 1000 m kg · pay; ad + küçük kod; formül ve denye uyarısı.
    const rowA = screen.getByTestId("warp-calc-row-A").textContent ?? "";
    expect(rowA).toContain("PES 150");
    expect(rowA).toContain("PES-150");
    expect(rowA).toContain("50,000");
    expect(rowA).toContain("%60");
    expect(screen.getByTestId("warp-calc-row-B").textContent).toContain("33,333");
    expect(screen.getByTestId("warp-calc-total-kg").textContent).toBe("83,333");
    expect(screen.getByTestId("warp-calc-total-ends").textContent).toBe("7000");
    expect(screen.getByTestId("warp-calc-formula").textContent).toBe("kg = tel × denye × metre ÷ 9.000.000");
    expect(screen.getByTestId("warp-calc-panel").textContent).toContain("paylı denye buraya yazılmaz");
    // Fire yok → fireli kg gösterilmez; levent girilmedi → levent sütunu yok.
    expect(screen.getByTestId("warp-calc-panel").textContent).not.toContain("Fireli");
    expect(screen.queryByText("Levent kg")).toBeNull();
    // Satır editöründe iplik kodu + denye küçük satırda.
    expect(screen.getByTestId("warp-yarn-code-A").textContent).toBe("PES-150 · 150 den");
    expect(bodies).toContainEqual(expect.objectContaining({ beamCount: 1, beamLengthM: 1000, fixedWasteM: 0, lines: [{ yarnItemId: "y1", endsCount: 3000 }, { yarnItemId: "y2", endsCount: 4000 }] }));
  });

  it("⭐ B6: kendi firesi olan iplikte satırda ve Hesap kartında 'iplik kartındaki %X kullanılıyor (çözgü %Y uygulanmaz)'", () => {
    const saved = planResult.forward;
    planResult.forward = {
      ...saved!, hasWaste: true, wasteSources: [{ kind: "KART_PCT", value: 2 }, { kind: "IPLIK_PCT", yarnItemId: "y1", value: 4 }],
      lines: [
        { ...saved!.lines[0]!, wastePct: 4, wasteSource: "IPLIK", grossKg: 52.083 },
        { ...saved!.lines[1]!, wastePct: 2, wasteSource: "KART", grossKg: 34.014 },
      ],
    };
    try {
      renderDialog({ initial: { ...spec, wastePct: "2" } as unknown as WarpSpec });
      expect(screen.getByTestId("warp-yarn-waste-note-A").textContent).toBe("Bu iplik için iplik kartındaki %4 kullanılıyor (çözgü firesi %2 uygulanmaz).");
      expect(screen.queryByTestId("warp-yarn-waste-note-B")).toBeNull();
      expect(screen.getByTestId("warp-calc-waste-A").textContent).toContain("iplik kartındaki %4");
      expect(screen.getByTestId("warp-calc-waste-B").textContent).toBe("Fire %2 · çözgü kartı");
    } finally {
      planResult.forward = saved;
    }
  });

  it("levent boyu × adet girilince ikinci hesap istenir, levent sütunu ve toplamı çıkar", async () => {
    const user = userEvent.setup();
    renderDialog({ initial: spec });
    await user.type(screen.getByLabelText("Levent boyu (m)"), "3000");
    await user.clear(screen.getByLabelText("Levent adedi"));
    await user.type(screen.getByLabelText("Levent adedi"), "2");
    expect(bodies).toContainEqual(expect.objectContaining({ beamCount: 2, beamLengthM: 3000 }));
    expect(screen.getByText("Levent kg")).toBeTruthy();
    expect(screen.getByTestId("warp-calc-beam-total").textContent).toBe("83,333 kg");
  });

  it("eksik satırda hesap istenmez, yönlendirme metni çıkar", () => {
    renderDialog();
    expect(bodies.every((b) => b === null)).toBe(true);
    expect(screen.getByTestId("warp-calc-panel").textContent).toContain("her satırda iplik ve tel adedi girin");
    expect(screen.getByTestId("warp-calc-total-kg").textContent).toBe("—");
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
    // Saklama diş/10 cm (K9): tarak no 200 → öneri ucuna 20 diş/cm.
    await waitFor(() => expect(suggest).toHaveBeenCalledWith({ kind: "REED", reedPerCm: 20, widthCm: 350, endsPerDent: 1 }));
    expect((await screen.findByTestId("reed-helper-note")).textContent).toContain("paylaştırın");
    expect(screen.getByLabelText("A tel adedi")).toHaveProperty("value", "3000");
  });

  it("Örnek al taslağı: başlık örnekten, kod boş, satırlar dolu", () => {
    renderDialog({ draft: copyDraft(spec) });
    expect(screen.getByText("Yeni Çözgü Kartı (örnekten)")).toBeTruthy();
    expect(screen.getByLabelText("Kod", { exact: false })).toHaveProperty("value", "");
    expect(screen.getByLabelText("B tel adedi")).toHaveProperty("value", "4000");
    expect(buildDefaults(null).yarns).toHaveLength(1);
  });
});

describe("WarpSpecFormDialog — Görünüm (tel düzeni + tarak)", () => {
  it("Görünüm: kayıtlı kartta sunucu açılımı; dizilim değişince oransal blok + 'kaydedince'", async () => {
    const user = userEvent.setup();
    renderDialog({ initial: spec });
    const summary = await screen.findByTestId("warp-ends-summary");
    expect(getById).toHaveBeenCalledWith("s1");
    expect(summary.textContent).toMatch(/Rapor 7 tel × 1\.?000 tekrar = 7\.?000 tel/);
    expect(screen.getByTestId("reed-plan-summary").textContent).toContain("Dişe 1 tel");
    const note = screen.getByRole("textbox", { name: /^Çözgü dizimi/ });
    await user.clear(note);
    await user.type(note, "1A 1B");
    expect(screen.queryByTestId("warp-ends-summary")).toBeNull();
    expect(screen.getByTestId("warp-ends-proportional")).toBeTruthy();
    expect(screen.getByTestId("warp-ends-fallback").textContent).toContain("Kaydedince");
  });

  it("Görünüm: yeni kartta sunucuya gidilmez", () => {
    renderDialog();
    expect(getById).not.toHaveBeenCalled();
    expect(screen.getByTestId("warp-ends-empty")).toBeTruthy();
    expect(screen.getByTestId("reed-plan-empty")).toBeTruthy();
  });
});
