// Gramaj önerisi (H9): işlem metni grupları, seçim → onay gövdesi, panel öneri çipi, onay diyaloğu seçimi iletir.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { buildProcessGroups, toProcessChoices } from "../processChoices";
import { ProcessGramajPanel } from "../ProcessGramajPanel";
import { ApproveDialog } from "../ApproveDialog";
import type { NoteMatchSuggestions } from "../types";

const OPTIONS = [{ id: "v25", name: "25 gr" }, { id: "v50", name: "50 gr" }];
const approveNote = vi.fn();
vi.mock("../service", () => ({
  approveNote: (...a: unknown[]) => approveNote(...a),
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  getSuggestions: () => Promise.resolve({ noteId: "n1", lines: [] }),
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getIncomingDocumentSettings: () => Promise.resolve({ defaultItem: null, unreviewedApproval: "WARN" }),
}));

const ln = (id: string, processText: string | null, extra: Partial<{ rollId: string | null; status: "PENDING" | "SKIPPED" | "ENTERED" }> = {}) => ({ id, processText, rollId: null, status: "PENDING" as const, ...extra });
const empty = { rawText: null, suggested: null, source: "NONE" as const, list: [] };
const sugg: NoteMatchSuggestions = {
  noteId: "n1", sender: empty, owner: empty,
  process: { rawText: "KURŞUN 25 GR", suggested: { id: "v25", name: "25 gr" }, source: "PATTERN" },
  lines: [
    { lineId: "a", lineNo: 1, item: empty, color: empty, process: { rawText: "KURŞUN 25 GR", suggested: { id: "v25", name: "25 gr" }, source: "PATTERN" } },
    { lineId: "b", lineNo: 2, item: empty, color: empty, process: { rawText: "ÖZEL", suggested: null, source: "NONE" } },
    { lineId: "c", lineNo: 3, item: empty, color: empty, process: { rawText: "ÖZEL", suggested: null, source: "NONE" } },
  ],
};

describe("buildProcessGroups / toProcessChoices", () => {
  it("başlık bir grup (metinsiz satırlar ona sayılır), satır metni tekilleşir; topu doğmuş/atlanmış satır sayılmaz", () => {
    const g = buildProcessGroups({ processText: "KURŞUN 25 GR", lines: [ln("a", null), ln("b", "ÖZEL"), ln("c", "ÖZEL"), ln("d", "ÖZEL", { rollId: "r" }), ln("e", null, { status: "SKIPPED" })] }, sugg);
    expect(g.map((x) => [x.key, x.lineId, x.rawText, x.lineCount, x.suggestion?.suggested?.id ?? null])).toEqual([
      ["header", null, "KURŞUN 25 GR", 1, "v25"],
      ["b", "b", "ÖZEL", 2, null],
    ]);
  });
  it("işlem metni yoksa grup yok; eski backend (process alanı yok) öneri boş", () => {
    expect(buildProcessGroups({ processText: null, lines: [ln("a", null)] }, sugg)).toEqual([]);
    const g = buildProcessGroups({ processText: "X", lines: [] }, { ...sugg, process: undefined });
    expect(g[0]?.suggestion).toBeNull();
  });
  it("yalnız seçilen gruplar gövdeye girer; öneri kendiliğinden seçilmez", () => {
    const g = buildProcessGroups({ processText: "KURŞUN 25 GR", lines: [ln("b", "ÖZEL")] }, sugg);
    expect(toProcessChoices(g, {})).toEqual([]);
    expect(toProcessChoices(g, { header: "v25", b: null })).toEqual([{ lineId: null, valueId: "v25" }]);
    expect(toProcessChoices(g, { header: "v25", b: "v50" })).toEqual([{ lineId: null, valueId: "v25" }, { lineId: "b", valueId: "v50" }]);
  });
});

describe("ProcessGramajPanel", () => {
  it("öneri çipi etiketli, seçili değil; tık seçimi bildirir", async () => {
    const onPick = vi.fn();
    const g = buildProcessGroups({ processText: "KURŞUN 25 GR", lines: [ln("b", "ÖZEL")] }, sugg);
    renderWithProviders(<ProcessGramajPanel groups={g} options={OPTIONS} picks={{}} onPick={onPick} />);
    const [head, line] = screen.getAllByTestId("process-group");
    expect(head!.dataset.suggested).toBe("v25");
    const chip = within(head!).getByRole("radio", { name: "25 gr (öneri)" });
    expect(chip).toHaveAttribute("aria-checked", "false");
    expect(within(line!).getByText(/öneri yok/)).toBeInTheDocument();
    await userEvent.click(chip);
    expect(onPick).toHaveBeenCalledWith("header", "v25");
  });
  it("grup yoksa hiç çizilmez", () => {
    renderWithProviders(<ProcessGramajPanel groups={[]} options={OPTIONS} picks={{}} onPick={() => {}} />);
    expect(screen.queryByTestId("process-gramaj")).toBeNull();
  });
  it("seçenek yoksa (eski backend processOptions göndermez) hiç çizilmez", () => {
    const g = buildProcessGroups({ processText: "KURŞUN 25 GR", lines: [] }, sugg);
    renderWithProviders(<ProcessGramajPanel groups={g} options={[]} picks={{}} onPick={() => {}} />);
    expect(screen.queryByTestId("process-gramaj")).toBeNull();
  });
});

describe("ProcessGramajPanel — özellik gruplu (D4-D1)", () => {
  const brode = { propertyId: "pB", propertyCode: "BRODE-DESEN", propertyName: "Brode deseni", options: [{ id: "d12", code: "D12", name: "Desen D12" }, { id: "d15", code: "D15", name: "Desen D15" }] };
  const grouped: NoteMatchSuggestions = {
    ...sugg,
    process: { rawText: "BRODE D12", suggested: null, source: "NONE", variants: [{ propertyId: "pB", suggested: { id: "d12", name: "Desen D12" }, source: "ALIAS" }] },
    processGroups: [brode],
  };
  it("kurşun ve brode ayrı satırlarda; brode önerisi etiketli; tık metnin TEK seçimini bildirir", async () => {
    const onPick = vi.fn();
    const g = buildProcessGroups({ processText: "BRODE D12", lines: [] }, grouped);
    renderWithProviders(<ProcessGramajPanel groups={g} options={OPTIONS} choiceGroups={[brode]} picks={{}} onPick={onPick} />);
    expect(screen.getByText("İşlem çeşidi (işlem metninden)")).toBeInTheDocument();
    const head = screen.getByTestId("process-group");
    expect(within(head).queryByText(/öneri yok/)).toBeNull();
    const v = within(head).getByTestId("process-variant");
    expect(v.dataset.suggested).toBe("d12");
    expect(within(v).getByText("Brode deseni")).toBeInTheDocument();
    await userEvent.click(within(v).getByRole("radio", { name: "Desen D12 (öğrenilmiş öneri)" }));
    expect(onPick).toHaveBeenCalledWith("header", "d12");
  });
  it("kurşun seçiliyken brode satırı işaretsiz; brode satırının 'Seçme'si kurşun seçimini silmez", async () => {
    const onPick = vi.fn();
    const g = buildProcessGroups({ processText: "BRODE D12", lines: [] }, grouped);
    renderWithProviders(<ProcessGramajPanel groups={g} options={OPTIONS} choiceGroups={[brode]} picks={{ header: "v25" }} onPick={onPick} />);
    const [kursunRow, brodeRow] = screen.getAllByTestId("process-row");
    expect(within(kursunRow!).getByRole("radio", { name: "25 gr" })).toHaveAttribute("aria-checked", "true");
    expect(within(brodeRow!).getByRole("radio", { name: "Seçme" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(brodeRow!).getByRole("radio", { name: "Seçme" }));
    expect(onPick).not.toHaveBeenCalled();
  });
  it("büyük desen kataloğunda yalnız önerilen değer gösterilir", () => {
    const big = { ...brode, options: Array.from({ length: 20 }, (_, i) => ({ id: i === 7 ? "d12" : `x${i}`, code: `X${i}`, name: i === 7 ? "Desen D12" : `Desen X${i}` })) };
    const g = buildProcessGroups({ processText: "BRODE D12", lines: [] }, grouped);
    renderWithProviders(<ProcessGramajPanel groups={g} options={[]} choiceGroups={[big]} picks={{}} onPick={() => {}} />);
    const v = screen.getByTestId("process-variant");
    expect(within(v).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Seçme", "Desen D12 (öğrenilmiş öneri)"]);
    expect(within(v).getByText(/yalnız öneri gösteriliyor/)).toBeInTheDocument();
  });
  it("çeşit kataloğu yoksa H9 görünümü (başlık 'Kurşun gramajı', satır etiketi yok)", () => {
    const g = buildProcessGroups({ processText: "KURŞUN 25 GR", lines: [] }, sugg);
    renderWithProviders(<ProcessGramajPanel groups={g} options={OPTIONS} picks={{}} onPick={() => {}} />);
    expect(screen.getByText("Kurşun gramajı (işlem metninden)")).toBeInTheDocument();
    expect(screen.queryByTestId("process-row")).toBeNull();
  });
});

describe("ApproveDialog gramaj seçimi", () => {
  beforeEach(() => approveNote.mockReset());
  it("seçimler onay çağrısına iletilir ve diyalogda sayılır", async () => {
    approveNote.mockResolvedValueOnce({ warnings: [], result: { note: { status: "APPROVED", lines: [] }, summary: { entered: 1, failed: 0, skipped: 0, replayed: 0, rollIds: [] } } });
    const choices = [{ lineId: null, valueId: "v25" }];
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} processChoices={choices} open onOpenChange={() => {}} onDone={() => {}} />);
    expect(screen.getByTestId("approve-process-choices")).toHaveTextContent("1 kurşun gramajı");
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await screen.findByTestId("approve-result");
    expect(approveNote).toHaveBeenLastCalledWith("n1", null, choices);
  });
  it("çeşit grupları varsa sayaç 'işlem seçimi' der (D4-D1)", () => {
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} processChoices={[{ lineId: null, valueId: "d12" }]} choiceNoun="işlem seçimi" open onOpenChange={() => {}} onDone={() => {}} />);
    expect(screen.getByTestId("approve-process-choices")).toHaveTextContent("1 işlem seçimi");
  });
});
