// P3 "Belge okut" (iş emri ekranı): okuma sürerken bekler; okununca tek kart; review'lı kurşun metresi onayı DAİMA bekletir;
// onay gövdesi SEÇİLEN rotayı taşır; onay izni yoksa "Taslak olarak kaydet" — onay ucu hiç çağrılmaz.
// Negatif sonda: `belgeOkutGate`ten review şartını kaldır → "review'lı metre" vakaları kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { belgeOkutGate, belgeOkutStage, openedWorkOrderId } from "../belgeOkut";
import { BelgeOkutDialog } from "../BelgeOkutDialog";
import { BelgeOkutButton, BELGE_OKUT_NO_ROUTE } from "@/pages/Operations/WorkOrders/BelgeOkutButton";

const getNote = vi.fn();
const approveNote = vi.fn();
const patchHeader = vi.fn();
const settings = { entryMode: "PER_DOCUMENT", unreviewedApproval: "WARN" };
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getDeliveryNote: () => getNote(),
  getSuggestions: () => Promise.resolve({ noteId: "n1", owner: { rawText: null, suggested: null, source: "NONE", list: [] }, sender: { rawText: null, suggested: null, source: "NONE", list: [] }, lines: [] }),
  getIncomingDocumentSettings: () => Promise.resolve(settings),
  approveNote: (...a: unknown[]) => approveNote(...a),
  updateNoteHeader: (...a: unknown[]) => patchHeader(...a),
  requeueScan: vi.fn(),
  addLines: vi.fn(),
  updateLine: vi.fn(),
  deleteLine: vi.fn(),
  createUploadNote: vi.fn(),
  uploadScan: vi.fn(),
}));
const perms = { list: ["gelen-belge:write", "gelen-belge:approve"] };
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms.list.includes(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms.list.includes(p)) }),
}));
const flags = { gelenBelge: true };
vi.mock("@/hooks/usePricingEnabled", () => ({ useGelenBelgeEnabled: () => flags.gelenBelge }));
vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: ({ value }: { value: string | null }) => <span data-testid="owner-value">{value ?? "yok"}</span> }));
vi.mock("@/pages/Routes/service", () => ({ routeService: { getById: () => Promise.resolve({ data: { id: "rt1", name: "Kurşun → Tambur" } }) } }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));

const scan = (status: string, mimeType = "image/jpeg") => ({ id: `s-${status}`, pageNo: 1, regionNo: null, status, mimeType, attempts: 1 });
const note = (over: Record<string, unknown> = {}) => ({
  id: "n1", noteNo: "GB-0001", status: "DRAFT", sourceKind: "MANUAL", ownerCustomerId: "c1",
  kursunMeters: "4521", kursunMetersSource: "OUTPUT", kursunMetersReview: false, ourBatchNo: "214279",
  scans: [scan("READ")], lines: [], ...over,
});

beforeEach(() => {
  getNote.mockReset();
  approveNote.mockReset();
  patchHeader.mockReset();
  perms.list = ["gelen-belge:write", "gelen-belge:approve"];
  flags.gelenBelge = true;
  settings.entryMode = "PER_DOCUMENT";
});

describe("belgeOkutStage / belgeOkutGate / openedWorkOrderId (saf)", () => {
  it("okunurken READING, hepsi düştüyse READ_FAILED, PDF okuma beklemez, taslak değilse CLOSED", () => {
    expect(belgeOkutStage(note({ scans: [scan("READ"), scan("READING")] }))).toBe("READING");
    expect(belgeOkutStage(note({ scans: [scan("READ_FAILED")] }))).toBe("READ_FAILED");
    expect(belgeOkutStage(note({ scans: [scan("PENDING", "application/pdf")] }))).toBe("READY");
    expect(belgeOkutStage(note({ status: "APPROVED" }))).toBe("CLOSED");
  });
  it("⭐ review'lı metre WARN ayarında bile onayı bekletir; müşteri ve metre şart", () => {
    expect(belgeOkutGate(note({ kursunMetersReview: true }), { canApprove: true, entryMode: "PER_DOCUMENT" }).blocked).toBe(true);
    expect(belgeOkutGate(note({ ownerCustomerId: null }), { canApprove: true, entryMode: "PER_DOCUMENT" }).reasons).toContain("Müşteriyi seçin.");
    expect(belgeOkutGate(note({ kursunMeters: null }), { canApprove: true, entryMode: "PER_DOCUMENT" }).blocked).toBe(true);
    expect(belgeOkutGate(note(), { canApprove: true, entryMode: "PER_DOCUMENT" })).toEqual({ action: "APPROVE", blocked: false, reasons: [] });
  });
  it("izinsiz → SAVE_DRAFT; PER_LINE → OPEN_IN_LIST", () => {
    expect(belgeOkutGate(note(), { canApprove: false, entryMode: "PER_DOCUMENT" }).action).toBe("SAVE_DRAFT");
    expect(belgeOkutGate(note(), { canApprove: true, entryMode: "PER_LINE" }).action).toBe("OPEN_IN_LIST");
  });
  it("iş emrine geçiş yalnız TEK açılan varsa", () => {
    const g = (id: string, outcome: "OPENED" | "SKIPPED") => ({ key: id, itemName: "x", targets: [], rollCount: 1, outcome, workOrderId: id });
    expect(openedWorkOrderId({ opened: 1, manual: 0, reason: null, groups: [g("w1", "OPENED")] })).toBe("w1");
    expect(openedWorkOrderId({ opened: 2, manual: 0, reason: null, groups: [g("w1", "OPENED"), g("w2", "OPENED")] })).toBeNull();
    expect(openedWorkOrderId(undefined)).toBeNull();
  });
});

const renderDialog = () => renderWithProviders(<BelgeOkutDialog open noteId="n1" routeTemplateId="rt1" routeName="Kurşun → Tambur" onOpenChange={() => {}} />);

describe("BelgeOkutDialog", () => {
  it("okuma sürerken 'okunuyor', onay düğmesi pasif", async () => {
    getNote.mockResolvedValue(note({ scans: [scan("READING")] }));
    renderDialog();
    expect(await screen.findByTestId("belge-okut-reading")).toBeInTheDocument();
    expect(screen.getByTestId("belge-okut-approve")).toBeDisabled();
  });
  it("⭐ review'lı kurşun metresi → Onayla pasif + neden", async () => {
    getNote.mockResolvedValue(note({ kursunMetersReview: true }));
    renderDialog();
    expect(await screen.findByText("Kurşun metresini doğrulayın (kılavuzlu giriş).")).toBeInTheDocument();
    expect(screen.getByTestId("belge-okut-approve")).toBeDisabled();
  });
  it("⭐ Onayla → gövde SEÇİLEN rotayı taşır; tek iş emri açıldıysa 'İş Emrine git'", async () => {
    getNote.mockResolvedValue(note());
    approveNote.mockResolvedValue({
      result: { note: { ...note(), status: "APPROVED" }, summary: { entered: 1, failed: 0, skipped: 0, replayed: 0, rollIds: ["r1"] },
        autoWorkOrders: { opened: 1, manual: 0, reason: null, groups: [{ key: "g", itemName: "Tül", targets: [], rollCount: 1, outcome: "OPENED", workOrderId: "w1", workOrderNumber: "IE-1", attached: 1 }] } },
      warnings: [],
    });
    renderDialog();
    const btn = await screen.findByTestId("belge-okut-approve");
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    await waitFor(() => expect(approveNote).toHaveBeenCalledWith("n1", null, [], { routeTemplateId: "rt1" }));
    expect(await screen.findByTestId("belge-okut-go-wo")).toHaveTextContent("Terbiye İş Emrine git");
  });
  it("⭐ onay izni yok → 'Taslak olarak kaydet', onay ucu çağrılmaz", async () => {
    perms.list = ["gelen-belge:write"];
    getNote.mockResolvedValue(note());
    renderDialog();
    await userEvent.click(await screen.findByTestId("belge-okut-save-draft"));
    expect(screen.queryByTestId("belge-okut-approve")).toBeNull();
    expect(approveNote).not.toHaveBeenCalled();
  });
  it("PER_LINE kipinde onay yok, Gelen Belgeler'e yönlendirir", async () => {
    settings.entryMode = "PER_LINE";
    getNote.mockResolvedValue(note());
    renderDialog();
    expect(await screen.findByTestId("belge-okut-open-list")).toBeInTheDocument();
    expect(screen.queryByTestId("belge-okut-approve")).toBeNull();
  });
});

describe("BelgeOkutButton (iş emri formu)", () => {
  it("rota seçilmeden pasif + neden", () => {
    renderWithProviders(<BelgeOkutButton routeTemplateId={null} />);
    const b = screen.getByTestId("wo-belge-okut");
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", BELGE_OKUT_NO_ROUTE);
  });
  it("rota seçiliyse etkin", () => {
    renderWithProviders(<BelgeOkutButton routeTemplateId="rt1" />);
    expect(screen.getByTestId("wo-belge-okut")).toBeEnabled();
  });
  it("gelen belge modülü kapalı ya da yazma izni yoksa çizilmez", () => {
    flags.gelenBelge = false;
    const { unmount } = renderWithProviders(<BelgeOkutButton routeTemplateId="rt1" />);
    expect(screen.queryByTestId("wo-belge-okut")).toBeNull();
    unmount();
    flags.gelenBelge = true;
    perms.list = [];
    renderWithProviders(<BelgeOkutButton routeTemplateId="rt1" />);
    expect(screen.queryByTestId("wo-belge-okut")).toBeNull();
  });
});
