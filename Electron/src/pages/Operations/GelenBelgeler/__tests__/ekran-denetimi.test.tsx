// 2026-11-06 gelen belge ekran denetimi (demo GB0611260005/06/07): parti kaydı (özet satırı, enum ARABA) topların arasından
// ayrılır ve sayıya karışmaz · elle açılmış taslakta "okunamadı"/fotoğraf küçültme yanlış mesajları susar · çok partide tek
// parti no alanı ve blok kartları Partiler kartına devreder · "İE aç" açılacak parti kalmayınca pasif + gerekçe.
// Negatif sondalar (elle, kaydı PR'da): `isSummaryRow` hep false → §1 kırmızı · `retentionModeFor` scans'ı yok sayınca §2b
// kırmızı · `allPartiesHaveWorkOrder` ölü İE'yi canlı sayınca §5 kırmızı · TotalsStrip `partiesShown` yok sayılınca §3 kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { blockChipLabel, isSummaryRow, noteCountText, splitNoteLines } from "../noteLines";
import { kursunMissingHint } from "../partiMetre";
import { retentionDocNoWarning, retentionModeFor } from "../photoRetention";
import { allPartiesHaveWorkOrder, isMultiParty } from "../useNoteParties";
import { TotalsStrip } from "../TotalsStrip";
import type { NotePartiesView, NoteParty } from "../partiesTypes";
import type { TotalsCheck } from "../reviewTypes";

const getNoteParties = vi.fn();
vi.mock("../service", () => ({ INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge", getNoteParties: (id: string) => getNoteParties(id) }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../WorkOrderFromNoteDialog", () => ({ WorkOrderFromNoteDialog: () => null }));
const { OpenWorkOrderAction } = await import("../OpenWorkOrderAction");
const { BatchNoPicker } = await import("../BatchNoPicker");

const doc = (o: { summary?: boolean; lineKind?: "TOP" | "ARABA" } = {}) => ({ lineKind: "TOP" as const, ...o });
const party = (blockNo: number, wos: Array<{ status: string }> = []): NoteParty => ({
  blockNo, batchNo: `P${blockNo}`, orderNo: null, declaredTopCount: null, declaredMeters: null, lineCount: 4, meters: 480, weightKg: null, warnings: [],
  workOrders: wos.map((w, i) => ({ id: `w${blockNo}${i}`, workOrderNumber: `IE${blockNo}${i}`, status: w.status })),
});
const view = (parties: NoteParty[]): NotePartiesView => ({ parties, warnings: [], multi: parties.length > 1, defaultMode: "PER_PARTY" });

beforeEach(() => getNoteParties.mockReset());

describe("§1 parti kaydı topların arasından ayrılır", () => {
  it("⭐ sunucu `summary` hükmü kazanır; eski sunucuda yalnız ARABA türü özet", () => {
    expect(isSummaryRow(doc({ summary: true }))).toBe(true);
    expect(isSummaryRow(doc({ summary: false, lineKind: "ARABA" }))).toBe(false);
    expect(isSummaryRow(doc({ lineKind: "ARABA" }))).toBe(true);
    expect(isSummaryRow(doc())).toBe(false);
  });

  it("⭐ 12 top + 3 parti kaydı → '12 top · 3 parti kaydı' (15 satır değil)", () => {
    const lines = [...Array.from({ length: 12 }, () => doc({ summary: false })), ...Array.from({ length: 3 }, () => doc({ summary: true, lineKind: "ARABA" }))];
    expect(splitNoteLines(lines).docLines).toHaveLength(12);
    expect(noteCountText(lines)).toBe("12 top · 3 parti kaydı");
    expect(noteCountText([doc(), doc()])).toBe("2 top");
    expect(noteCountText([])).toBe("satır yok");
  });
});

describe("§2 elle açılmış taslağın mesajları", () => {
  it("⭐ kurşun metresi: fotoğrafsız belgede 'okunamadı' denmez; satır toplamı önerilir", () => {
    const manual = kursunMissingHint({ scans: [], kursunMeterCandidates: { output: null, total: null, input: null, lineSum: "833" } });
    expect(manual.text).not.toMatch(/okunamadı/);
    expect(manual.text).toMatch(/^Kurşun metresi girilmedi/);
    expect(manual.lineSum).toBe(833);
    expect(kursunMissingHint({ scans: [{}], kursunMeterCandidates: null })).toEqual({ text: "Metre belgeden okunamadı — onaydan önce girin.", lineSum: null });
    expect(kursunMissingHint({ scans: [], kursunMeterCandidates: { output: null, total: null, input: null, lineSum: "0" } }).lineSum).toBeNull();
  });

  it("⭐ fotoğraf küçültme uyarısı yalnız fotoğrafı olan belgede", () => {
    expect(retentionDocNoWarning(retentionModeFor({ scans: [], photoRetention: "SHRINK_ON_APPROVAL" }))).toBeNull();
    expect(retentionDocNoWarning(retentionModeFor({ scans: [{}], photoRetention: "SHRINK_ON_APPROVAL" }))).toMatch(/küçültülecek/);
  });

  it("⭐ çok partili belgede tek parti no alanı yerine Partiler kartına yönlendirme", async () => {
    getNoteParties.mockResolvedValue(view([party(1), party(2)]));
    const note = { id: "n1", ourBatchNo: null, ourBatchNoKey: null, batchNoCandidates: [], updatedAt: "x" } as never;
    renderWithProviders(<BatchNoPicker note={note} editable onPatch={() => undefined} />);
    expect(await screen.findByTestId("batch-no-multi")).toHaveTextContent("Partiler kartında");
    expect(screen.queryByLabelText("Parti no (elle)")).toBeNull();
  });

  it("tek partili belgede bugünkü seçici", async () => {
    getNoteParties.mockResolvedValue(view([party(1)]));
    const note = { id: "n1", ourBatchNo: null, ourBatchNoKey: null, batchNoCandidates: [], updatedAt: "x" } as never;
    renderWithProviders(<BatchNoPicker note={note} editable onPatch={() => undefined} />);
    await waitFor(() => expect(getNoteParties).toHaveBeenCalled());
    expect(screen.getByLabelText("Parti no (elle)")).toBeInTheDocument();
    expect(screen.queryByTestId("batch-no-multi")).toBeNull();
  });
});

describe("§3 blok / parti tek yerde", () => {
  const check: TotalsCheck = {
    ok: true, warnings: [],
    blocks: [1, 2].map((blockNo) => ({ blockNo, ok: true, lines: { count: 4, m: 480, kg: 0 }, declared: { count: 4, m: 480, kg: null }, diffs: [] })),
  } as unknown as TotalsCheck;

  it("⭐ Partiler kartı çiziliyken şerit blok kartı çizmez; hüküm kalır", () => {
    renderWithProviders(<TotalsStrip check={check} partiesShown />);
    expect(screen.getByTestId("totals-verdict")).toHaveTextContent("Toplamlar tutuyor");
    expect(screen.queryByTestId("block-1")).toBeNull();
  });

  it("kart yokken bloklar şeritte; tek blokta 'Belge satırları'", () => {
    renderWithProviders(<TotalsStrip check={check} />);
    expect(within(screen.getByTestId("block-2")).getByText("Blok 2")).toBeInTheDocument();
    expect(blockChipLabel(1, 1)).toBe("Belge satırları");
    expect(isMultiParty(view([party(1)]))).toBe(false);
    expect(isMultiParty(view([party(1), party(2)]))).toBe(true);
  });
});

describe("§5 İE aç kapısı", () => {
  it("⭐ her partinin canlı İE'si varsa kapalı; iptal/devredilen İE canlı sayılmaz; bağ bilgisi yoksa açık", () => {
    expect(allPartiesHaveWorkOrder(view([party(1, [{ status: "PLANNED" }]), party(2, [{ status: "IN_PROGRESS" }])]))).toBe(true);
    expect(allPartiesHaveWorkOrder(view([party(1, [{ status: "PLANNED" }]), party(2)]))).toBe(false);
    expect(allPartiesHaveWorkOrder(view([party(1, [{ status: "CANCELLED" }]), party(2, [{ status: "PLANNED" }])]))).toBe(false);
    expect(allPartiesHaveWorkOrder(view([party(1, [{ status: "SUPERSEDED" }])]))).toBe(false);
    expect(allPartiesHaveWorkOrder(view([]))).toBe(false);
    expect(allPartiesHaveWorkOrder(undefined)).toBe(false);
  });

  it("⭐ düğme pasif ve gerekçe görünür", async () => {
    getNoteParties.mockResolvedValue(view([party(1, [{ status: "PLANNED" }]), party(2, [{ status: "PLANNED" }])]));
    renderWithProviders(<OpenWorkOrderAction noteId="n1" />);
    expect(await screen.findByTestId("note-work-order-done")).toHaveTextContent("Açılacak parti yok");
    expect(screen.getByTestId("note-open-work-order")).toBeDisabled();
  });

  it("açılacak parti varken düğme açık", async () => {
    getNoteParties.mockResolvedValue(view([party(1, [{ status: "PLANNED" }]), party(2)]));
    renderWithProviders(<OpenWorkOrderAction noteId="n1" />);
    await waitFor(() => expect(getNoteParties).toHaveBeenCalled());
    expect(screen.getByTestId("note-open-work-order")).toBeEnabled();
    expect(screen.queryByTestId("note-work-order-done")).toBeNull();
  });
});
