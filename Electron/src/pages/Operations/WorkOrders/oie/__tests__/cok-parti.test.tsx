// Çok partili belge (S1, fabrika cevabı 16/17): parti özeti → "Bu belgede N parti var" listesi + kip seçimi; kayıt gövdesine
// parties[] + mode + toplam metre girer; tek partide bugünkü form (null); SEPARATE'te parti gövdesi gitmez.
// Negatif sonda: `initialMultiParty` tek partide de taslak döndürürse "tek parti → null" vakası kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { initialDocDraft } from "../docDraft";
import { initialMultiParty, multiPartyBody, multiPartyReasons, type MultiPartyDraft, type NotePartiesView } from "../partyDraft";
import { PartyList } from "../PartyList";
import { saveDoc } from "../saveDoc";

const createWO = vi.fn();
vi.mock("../service", async (orig) => ({ ...(await orig<typeof import("../service")>()), createWorkOrderFromNote: (...a: unknown[]) => createWO(...a) }));
const patchHeader = vi.fn();
vi.mock("@/pages/Operations/GelenBelgeler/service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  updateNoteHeader: (...a: unknown[]) => patchHeader(...a),
  getDeliveryNote: vi.fn(),
}));

const party = (blockNo: number, over: Record<string, unknown> = {}) => ({
  blockNo, batchNo: `P99187${32 + blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 5, meters: 586, weightKg: null, warnings: [], ...over,
});
const view = (over: Partial<NotePartiesView> = {}): NotePartiesView => ({
  parties: [party(1, { declaredTopCount: 4, warnings: ["Belgede 4 TOP yazıyor, 5 satır okundu."] }), party(2, { lineCount: 16, meters: 3935 })],
  warnings: ["Belge 2 sayfa; 1. sayfa okundu."], multi: true, defaultMode: "SINGLE", ...over,
});
const note = {
  id: "n1", noteNo: "GB-1", status: "DRAFT", ownerCustomerId: null, ourBatchNo: "P9918733", ourBatchNoKey: null,
  kursunMeters: "586", kursunMetersSource: "OUTPUT", kursunMetersReview: false, ownerSuggestion: null,
  scans: [{ id: "s1", pageNo: 1, regionNo: null, status: "READ", mimeType: "image/jpeg", attempts: 1 }], lines: [],
};
type N = Parameters<typeof saveDoc>[0]["note"];
const base = () => ({ note: note as unknown as N, draft: { ...initialDocDraft(note as never), ownerCustomerId: "c-gul" }, routeTemplateId: "rt-k", gramajPropertyId: null, clientToken: "t1" });

beforeEach(() => { createWO.mockReset(); patchHeader.mockReset(); });

describe("parti taslağı", () => {
  it("⭐ tek parti / bölümsüz belge → null (bugünkü form aynen)", () => {
    expect(initialMultiParty(null)).toBeNull();
    expect(initialMultiParty(view({ multi: false }))).toBeNull();
    expect(initialMultiParty(view({ parties: [party(1)] }))).toBeNull();
  });
  it("⭐ iki parti → satırlar + fabrika varsayılan kipi", () => {
    const m = initialMultiParty(view({ defaultMode: "PER_PARTY" }));
    expect(m).toEqual({ mode: "PER_PARTY", rows: [{ blockNo: 1, batchNo: "P9918733", meters: 586 }, { blockNo: 2, batchNo: "P9918734", meters: 3935 }] });
    expect(initialMultiParty(view())?.mode).toBe("SINGLE");
  });
  it("⭐ 214279: sunucunun önerdiği parti metresi (beyan ara toplamı) Σ satırın önüne geçer; öneri yoksa (eski sunucu) Σ satır", () => {
    const v = view({ parties: [party(1, { meters: 266.9, suggestedMeters: 586 }), party(2, { meters: 2345.5, suggestedMeters: 3935 })] });
    expect(initialMultiParty(v)!.rows.map((r) => r.meters)).toEqual([586, 3935]);
    expect(initialMultiParty(view({ parties: [party(1, { meters: 266.9 }), party(2, { meters: 0, suggestedMeters: null })] }))!.rows.map((r) => r.meters)).toEqual([266.9, null]);
  });
  it("eksik parti metresi kaydı keser; boş parti no gövdede null", () => {
    const m: MultiPartyDraft = { mode: "SINGLE", rows: [{ blockNo: 1, batchNo: " ", meters: 586 }, { blockNo: 2, batchNo: "P2", meters: null }] };
    expect(multiPartyReasons(m)).toEqual(["Parti metresi eksik: 2. parti."]);
    expect(multiPartyBody({ ...m, rows: [m.rows[0]!] }).parties).toEqual([{ blockNo: 1, batchNo: null, meters: 586 }]);
  });
});

describe("saveDoc çok parti", () => {
  const multi = (): MultiPartyDraft => initialMultiParty(view({ defaultMode: "PER_PARTY" }))!;
  it("⭐ WITH_WORK_ORDER → gövdede parties[] + mode + toplam metre", async () => {
    createWO.mockResolvedValue({ workOrderId: "w1", workOrderNo: "IE-1", batchNumber: "P9918733", rollId: "r1", workOrders: [] });
    await saveDoc({ ...base(), formApproval: "WITH_WORK_ORDER", multi: multi() });
    expect(createWO).toHaveBeenCalledWith("n1", expect.objectContaining({
      mode: "PER_PARTY", kursunMeters: "4521",
      parties: [{ blockNo: 1, batchNo: "P9918733", meters: 586 }, { blockNo: 2, batchNo: "P9918734", meters: 3935 }],
    }));
  });
  it("⭐ SEPARATE → parti gövdesi gitmez, taslağa yazılır", async () => {
    await saveDoc({ ...base(), formApproval: "SEPARATE", multi: multi() });
    expect(createWO).not.toHaveBeenCalled();
    expect(patchHeader).toHaveBeenCalled();
  });
  it("eksik parti metresi → uç çağrılmaz", async () => {
    const m = multi();
    m.rows[1]!.meters = null;
    await expect(saveDoc({ ...base(), formApproval: "WITH_WORK_ORDER", multi: m })).rejects.toThrow(/Parti metresi eksik/);
    expect(createWO).not.toHaveBeenCalled();
  });
});

describe("PartyList", () => {
  function Harness({ onMode }: { onMode: (m: MultiPartyDraft) => void }) {
    const [v, setV] = useState<MultiPartyDraft>(initialMultiParty(view())!);
    return <PartyList view={view()} value={v} onChange={(n) => { setV(n); onMode(n); }} />;
  }
  it("⭐ 'Bu belgede 2 parti var' + parti/belge uyarıları + kip seçimi gövdeye", async () => {
    const seen = vi.fn();
    renderWithProviders(<Harness onMode={seen} />);
    expect(screen.getByText("Bu belgede 2 parti var")).toBeInTheDocument();
    expect(screen.getByText("Belgede 4 TOP yazıyor, 5 satır okundu.")).toBeInTheDocument();
    expect(screen.getByText("Belge 2 sayfa; 1. sayfa okundu.")).toBeInTheDocument();
    expect(screen.getByText("5 / 4 TOP")).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    await userEvent.click(radios.find((r) => (r as HTMLInputElement).value === "PER_PARTY")!);
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "PER_PARTY" }));
    const no = screen.getByLabelText("2. parti no");
    await userEvent.clear(no);
    await userEvent.type(no, "P77");
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ rows: expect.arrayContaining([expect.objectContaining({ blockNo: 2, batchNo: "P77" })]) }));
  });
});
