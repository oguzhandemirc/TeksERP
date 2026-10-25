// Düzelt / iptal / kâğıttan giriş: gerekçe < 3 gönderilmez; iptal önce önizleme ister; belirsiz hatada aynı token;
// null metre "—".
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const svc = vi.hoisted(() => ({ get: vi.fn(), preview: vi.fn(), create: vi.fn(), revise: vi.fn(), voidPreview: vi.fn(), void: vi.fn(), list: vi.fn() }));
vi.mock("./service", () => ({ inspectionService: svc }));
const presetSvc = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/pages/ReasonPresets/service", () => ({ reasonPresetService: presetSvc }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({ EntityPickerModal: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span> }));
vi.mock("@/components/operations/roll-picker/RollPickerDialog", () => ({
  RollPickerDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (r: unknown[]) => void }) =>
    open ? <button type="button" onClick={() => onConfirm([{ id: "r1", barcode: "TP-1", itemName: "Poplin", colorName: null, qty: 50, warehouseId: null }])}>topu seç</button> : null,
}));

import { InspectionReviseDialog } from "./InspectionReviseDialog";
import { InspectionVoidDialog } from "./InspectionVoidDialog";
import { PaperInspectionDialog } from "./PaperInspectionDialog";
import { InspectionDetailSheet } from "./InspectionDetailSheet";
import type { InspectionDetail } from "./service";

const detail = {
  id: "i1", rollId: "r1", phase: "FINAL", revision: 1, totalPoints: 5, defectCount: 2, unplacedDefectCount: 1, pointsPer100M2: "6.25", gradeScore: "6.25",
  suggestedGradeCode: "A", gradeMismatch: false, widthCm: "160", widthSource: "ITEM_CARD", inspectedLengthM: "50", inspectedAt: "2026-10-25T08:00:00Z",
  supersededAt: null, voidedAt: null, createdAt: "2026-10-25T08:00:00Z", roll: { id: "r1", barcode: "TP-1", qualityGrade: "A", item: { id: "it", code: "K1", name: "Poplin" } },
  station: null, inspectedBy: { id: "u", fullName: "Ayşe" }, stationId: null, deviceId: null, ruleSetId: null, ruleSnapshot: { ruleSetId: null, unit: "M2", runningCap: "METER", bands: [] },
  note: null, reviseReason: null, supersedesId: null, voidReason: null, suggestedQualityGradeId: null, supersededBy: null, supersededByUser: null, voidedBy: null, ruleSet: null,
  rollErrors: [
    { id: "e1", startMeter: null, sizeClass: "UP_TO_3IN", points: 1, errorType: "Leke", defectTypeId: "t1", detectedAt: "2026-10-25T08:00:00Z", detectedBy: null },
    { id: "e2", startMeter: "12.5", sizeClass: "OVER_9IN", points: 4, errorType: "Atkı kaçığı", defectTypeId: "t2", detectedAt: "2026-10-25T08:00:00Z", detectedBy: null },
  ],
  breakdown: { rawPoints: 5, cappedPoints: 5, areaM2: "80", formula: "puan × 10 000 / (en_cm × boy_m)" },
  history: [{ id: "i1", revision: 1, supersedesId: null, supersededAt: null, voidedAt: null, reviseReason: null, voidReason: null, totalPoints: 5, pointsPer100M2: "6.25", createdAt: "2026-10-25T08:00:00Z" }],
} as unknown as InspectionDetail;
const pv = { totalPoints: 5, cappedPoints: 5, unplaced: 1, widthCm: "160", widthSource: "ITEM_CARD", pointsPer100M2: "6.25", ruleSet: null, gradeScore: "6.25", suggested: { qualityGradeId: null, code: "A", label: "A", accepted: true } };
const axiosErr = (status: number | null, code?: string) =>
  Object.assign(new Error("x"), { isAxiosError: true, response: status == null ? undefined : { status, data: { message: "olmadı", details: code ? { code } : undefined } } });

describe("Muayene diyalogları", () => {
  beforeEach(() => { Object.values(svc).forEach((f) => f.mockReset()); svc.preview.mockResolvedValue(pv); presetSvc.list.mockReset(); presetSvc.list.mockResolvedValue([]); });

  it("detay: konumsuz hatanın metresi '—'", async () => {
    svc.get.mockResolvedValue(detail);
    renderWithProviders(<InspectionDetailSheet id="i1" onClose={() => {}} onOpen={() => {}} />);
    const t = await screen.findByTestId("inspection-defects");
    const cells = t.querySelectorAll("tbody tr")[0]!.querySelectorAll("td");
    expect(cells[3]!.textContent).toBe("—");
  });

  it("düzelt: gerekçe < 3 → gönderilmez; 409 INSPECTION_NOT_ACTIVE → yenileyin", async () => {
    svc.revise.mockRejectedValue(axiosErr(409, "INSPECTION_NOT_ACTIVE"));
    renderWithProviders(<InspectionReviseDialog detail={detail} onOpenChange={() => {}} onDone={() => {}} />);
    const btn = screen.getByRole("button", { name: "Düzeltmeyi kaydet" });
    fireEvent.change(screen.getByLabelText("Düzeltme gerekçesi"), { target: { value: "ab" } });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(svc.revise).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Düzeltme gerekçesi"), { target: { value: "metre yanlış" } });
    fireEvent.click(btn);
    await waitFor(() => expect(svc.revise).toHaveBeenCalledTimes(1));
    const body = svc.revise.mock.calls[0]![1];
    expect(body.defects[0].startMeter).toBeNull();
    expect(body.reviseReason).toBe("metre yanlış");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("yenileyin"));
  });

  it("iptal: önce önizleme; önizleme gelmeden düğme kapalı, sonra iptal", async () => {
    let resolve!: (v: unknown) => void;
    svc.voidPreview.mockReturnValue(new Promise((r) => { resolve = r; }));
    svc.void.mockResolvedValue({ id: "i1", voidedAt: "x" });
    renderWithProviders(<InspectionVoidDialog id="i1" onOpenChange={() => {}} onDone={() => {}} />);
    expect(svc.voidPreview).toHaveBeenCalledWith("i1");
    fireEvent.change(screen.getByLabelText("Gerekçe"), { target: { value: "yanlış top" } });
    const btn = screen.getByRole("button", { name: "İptal et" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    resolve({ inspection: { ...detail, roll: { id: "r1", barcode: "TP-1" } }, defectCount: 2, printedDocuments: [], active: true });
    await screen.findByTestId("void-preview");
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(svc.void).toHaveBeenCalledWith("i1", "yanlış top"));
    expect(svc.voidPreview.mock.invocationCallOrder[0]!).toBeLessThan(svc.void.mock.invocationCallOrder[0]!);
  });

  it("kâğıttan giriş: belirsiz hatada aynı token, kesin 4xx sonrası yeni token", async () => {
    svc.create.mockRejectedValueOnce(axiosErr(null)).mockRejectedValueOnce(axiosErr(400)).mockResolvedValue({ id: "n1", rollId: "r1", revision: 1 });
    const onCreated = vi.fn();
    renderWithProviders(<PaperInspectionDialog onOpenChange={() => {}} onCreated={onCreated} />);
    fireEvent.click(screen.getByText("topu seç"));
    fireEvent.click(screen.getByRole("button", { name: "Mamul" }));
    const save = screen.getByRole("button", { name: "Kaydet" });
    fireEvent.click(save);
    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");
    fireEvent.click(save);
    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(svc.create).toHaveBeenCalledTimes(3));
    const t = svc.create.mock.calls.map((c) => c[0].clientToken);
    expect(t[1]).toBe(t[0]);
    expect(t[2]).not.toBe(t[1]);
    expect(svc.create.mock.calls[0]![0]).toMatchObject({ rollId: "r1", phase: "FINAL", defects: [] });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("n1"));
  });
});

describe("Muayene iptali — hazır sebep (INSPECTION_VOID)", () => {
  beforeEach(() => { Object.values(svc).forEach((f) => f.mockReset()); presetSvc.list.mockReset(); presetSvc.list.mockResolvedValue([]); });

  it("iptal: hazır sebep İSTEĞE BAĞLI — modalden seçilen metin kutuya dolar, düzenlenebilir; başka kind listelenmez", async () => {
    const row = (id: string, kind: string, label: string, extra: Record<string, unknown> = {}) =>
      ({ id, kind, code: id, label, fullText: null, requiresText: false, sortOrder: Number(id.slice(1)), isActive: true, isSystem: true, ...extra });
    presetSvc.list.mockResolvedValue([
      row("p2", "INSPECTION_VOID", "Hata / puan yanlış girildi"),
      row("p1", "INSPECTION_VOID", "Yanlış top muayene edildi", { fullText: "Yanlış top muayene edildi (barkod karıştı)" }),
      row("p3", "ORDER_CANCEL", "Müşteri vazgeçti"),
      row("p4", "INSPECTION_VOID", "Diğer", { requiresText: true }),
    ]);
    svc.voidPreview.mockResolvedValue({ inspection: { ...detail, roll: { id: "r1", barcode: "TP-1" } }, defectCount: 2, printedDocuments: [], active: true });
    svc.void.mockResolvedValue({ id: "i1", voidedAt: "x" });
    renderWithProviders(<InspectionVoidDialog id="i1" onOpenChange={() => {}} onDone={() => {}} />);
    await screen.findByTestId("void-preview");
    fireEvent.click(await screen.findByRole("button", { name: "Hazır sebepten seç…" }));
    const list = await screen.findByTestId("void-reason-presets");
    expect(Array.from(list.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Yanlış top muayene edildi", "Hata / puan yanlış girildi", "Diğer"]);
    fireEvent.click(screen.getByRole("button", { name: "Yanlış top muayene edildi" }));
    const box = screen.getByLabelText("Gerekçe") as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("Yanlış top muayene edildi (barkod karıştı)"));
    fireEvent.change(box, { target: { value: "Yanlış top — TP-1 değil" } });
    fireEvent.click(screen.getByRole("button", { name: "İptal et" }));
    await waitFor(() => expect(svc.void).toHaveBeenCalledWith("i1", "Yanlış top — TP-1 değil"));
  });

  it("iptal: katalog boşsa seçici görünmez, serbest metin yeter", async () => {
    svc.voidPreview.mockResolvedValue({ inspection: { ...detail, roll: { id: "r1", barcode: "TP-1" } }, defectCount: 2, printedDocuments: [], active: true });
    renderWithProviders(<InspectionVoidDialog id="i1" onOpenChange={() => {}} onDone={() => {}} />);
    await screen.findByTestId("void-preview");
    await waitFor(() => expect(presetSvc.list).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Hazır sebepten seç…" })).toBeNull();
  });
});
