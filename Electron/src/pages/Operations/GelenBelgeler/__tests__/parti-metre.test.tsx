// Gülkesim P2: belge başına tek kayıt (PER_DOCUMENT) gözden geçirme yüzeyi — parti no seçici, kurşun metresi kartı,
// bilgi satırları (INFO), onay özeti. Kip ayardan (`entryMode`), değerler sunucudan; panel öncelik kuralı kurmaz.
// Negatif sonda: `showsPerDocument` PER_LINE'da da true dönerse "PER_LINE'da kart yok" kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentDetailPage } from "../GelenBelgeDetailPage";
import { ApproveDialog } from "../ApproveDialog";
import { perDocumentPrecheck, perDocumentSummary } from "../partiMetre";
import type { DeliveryNoteDetail, DeliveryNoteLine } from "../types";

const getSettings = vi.fn();
const approveNote = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getIncomingDocumentSettings: () => getSettings(),
  getSuggestions: () => Promise.resolve({ noteId: "n1", lines: [] }),
  approveNote: (...a: unknown[]) => approveNote(...a),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, isAdmin: true }) }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <div><h1>{title}</h1>{actions}</div> }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/pages/Finance/CariHold/CariHoldStrip", () => ({ CariHoldStrip: () => null }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => <button type="button">Renk seç</button> }));
vi.mock("../ScanViewer", () => ({ ScanViewer: () => null }));
vi.mock("../NoteHeaderForm", () => ({ NoteHeaderForm: () => null }));
vi.mock("../TotalsStrip", () => ({ TotalsStrip: () => null }));
vi.mock("../AddLineForm", () => ({ AddLineForm: () => null }));
vi.mock("../LineImportButton", () => ({ LineImportButton: () => null }));
vi.mock("../CellReviewDialog", () => ({ CellReviewDialog: () => null }));
vi.mock("../ScanReadBanner", () => ({ ScanReadBanner: () => null }));
vi.mock("../AddPagesAction", () => ({ AddPagesAction: () => null }));
vi.mock("../ProcessGramajPanel", () => ({ ProcessGramajPanel: () => null }));
vi.mock("../CellCrop", () => ({ CellCrop: ({ rect }: { rect: unknown }) => <div data-testid="crop" data-has={rect ? "1" : "0"} /> }));

const line = (id: string, lineNo: number, o: Partial<DeliveryNoteLine> = {}): DeliveryNoteLine =>
  ({
    id, noteId: "n1", lineNo, blockNo: 1, lineKind: "TOP", senderRollNo: null, meters: "200", weightKg: null, widthCm: null, itemText: "FULAR", itemId: null,
    colorText: null, colorId: null, processText: null, confidence: null, needsReview: false, sourceRects: null, status: "PENDING", failReason: null, rollId: null,
    item: null, color: null, problems: [], ...o,
  }) as DeliveryNoteLine;

const GULECSOY: Partial<DeliveryNoteDetail> = {
  ourBatchNo: "214279", ourBatchNoKey: "fisNo", kursunMeters: "4521", kursunMetersSource: "OUTPUT", kursunMetersReview: false,
  batchNoCandidates: [
    { key: "fisNo", kind: "DOC", label: "FİŞ NO", value: "214279" },
    { key: "hamPartiNo", kind: "BATCH", label: "Ham PartiNo", value: "P2618733", remembered: true },
    { key: "isEmriNo", kind: "WORK_ORDER", label: "İş Emri No", value: "26K-24749" },
  ],
  kursunMeterCandidates: { output: { value: "4521", key: "$tableTotal" }, total: null, input: null, lineSum: 4521 },
};

let current: DeliveryNoteDetail;
const header = { mutate: vi.fn(), mutateAsync: vi.fn(() => Promise.resolve()) };
const idle = { mutate: vi.fn(), mutateAsync: vi.fn() };
vi.mock("../useNoteDetail", () => ({
  useNoteDetail: () => ({ note: { data: current, isError: false }, suggestions: { data: undefined }, header, line: idle, removeLine: idle, invalidate: vi.fn() }),
}));

const noteOf = (o: Partial<DeliveryNoteDetail> = {}): DeliveryNoteDetail =>
  ({
    id: "n1", noteNo: "GB-0001", status: "DRAFT", sourceKind: "OCR", ownerCustomerId: "c1", processText: null, varianceReason: null, scans: [],
    updatedAt: "2026-11-02T08:00:00Z", lines: [line("a", 1, { status: "INFO" }), line("b", 2)], ...o,
  }) as DeliveryNoteDetail;
const settings = (o: object = {}) => ({ defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", ...o });

beforeEach(() => {
  header.mutate.mockReset();
  header.mutateAsync.mockReset().mockResolvedValue(undefined);
  getSettings.mockReset().mockResolvedValue(settings({ entryMode: "PER_DOCUMENT" }));
});

describe("PER_DOCUMENT detay", () => {
  it("§1 parti no kartı: adaylar radyo + hatırlanan rozeti; aday seçimi {ourBatchNo, ourBatchNoKey} PATCH'ler", async () => {
    current = noteOf(GULECSOY);
    renderWithProviders(<IncomingDocumentDetailPage />);
    const card = await screen.findByTestId("batch-no-card");
    expect(within(card).getAllByTestId("batch-candidate")).toHaveLength(3);
    expect(within(card).getByRole("radio", { name: "FİŞ NO: 214279" })).toBeChecked();
    expect(within(card).getByTestId("batch-remembered").closest("[data-key]")?.getAttribute("data-key")).toBe("hamPartiNo");
    await userEvent.click(within(card).getByRole("radio", { name: "Ham PartiNo: P2618733" }));
    expect(header.mutate).toHaveBeenCalledWith({ ourBatchNo: "P2618733", ourBatchNoKey: "hamPartiNo" });
  });

  it("§2 elle yaz → MANUAL; boşaltınca ikisi de null; seçim yoksa 'seriden doğar' uyarısı", async () => {
    current = noteOf({ ...GULECSOY, ourBatchNo: null, ourBatchNoKey: null });
    renderWithProviders(<IncomingDocumentDetailPage />);
    await screen.findByTestId("batch-no-empty");
    const input = screen.getByLabelText("Parti no (elle)");
    expect(input).toHaveAttribute("maxLength", "64");
    fireEvent.blur(input, { target: { value: " ELLE-1 " } });
    expect(header.mutate).toHaveBeenLastCalledWith({ ourBatchNo: "ELLE-1", ourBatchNoKey: "MANUAL" });
  });

  it("§3 kurşun metresi kartı: değer + kaynak + diğer kaynaklar", async () => {
    current = noteOf(GULECSOY);
    renderWithProviders(<IncomingDocumentDetailPage />);
    const card = await screen.findByTestId("kursun-meters-card");
    expect(within(card).getByTestId("kursun-meters-value")).toHaveTextContent("4521 m");
    expect(within(card).getByTestId("kursun-meters-source")).toHaveTextContent("Çıkış metresi");
    expect(within(card).getByTestId("kursun-sources")).toHaveTextContent("Satır toplamı: 4521 m");
    expect(card.dataset.review).toBe("0");
  });

  it("§4 review açık (Takva): kılavuzlu giriş — aynı değer reviewed, farklı değer kursunMeters", async () => {
    current = noteOf({ ...GULECSOY, kursunMeters: "1775", kursunMetersReview: true, kursunMeterCandidates: { output: { value: "1775", key: "cikisMt", rect: { x: 1, y: 2, width: 30, height: 10 }, scanId: "s1" }, input: { value: "1375" }, lineSum: "1775" } });
    renderWithProviders(<IncomingDocumentDetailPage />);
    const card = await screen.findByTestId("kursun-meters-card");
    expect(card.dataset.review).toBe("1");
    expect(within(card).getByTestId("kursun-sources")).toHaveTextContent("Giriş metresi (yalnız bilgi): 1375 m");
    await userEvent.click(within(card).getByTestId("kursun-meters-edit"));
    expect(screen.getByTestId("crop").dataset.has).toBe("1");
    await userEvent.click(screen.getByRole("button", { name: "Onayla ve sonraki" }));
    await waitFor(() => expect(header.mutateAsync).toHaveBeenCalledWith({ kursunMetersReviewed: true }));
    await userEvent.click(within(card).getByTestId("kursun-meters-edit"));
    const input = screen.getByRole("textbox", { name: "Kurşun metresi" });
    await userEvent.clear(input);
    await userEvent.type(input, "1780,5{Enter}");
    await waitFor(() => expect(header.mutateAsync).toHaveBeenLastCalledWith({ kursunMeters: 1780.5 }));
  });

  it("§5 satırlar bilgi: başlık 'Belgedeki satırlar (bilgi)', ürün/renk sütunu ve sorunlu süzgeci yok, INFO 'Bilgi'", async () => {
    current = noteOf(GULECSOY);
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(await screen.findByTestId("info-lines-title")).toHaveTextContent("Belgedeki satırlar (bilgi)");
    expect(screen.queryByTestId("problem-filter")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Kumaş" })).toBeNull();
    expect(screen.queryByText("Renk seç")).toBeNull();
    expect(within(screen.getAllByTestId("line-row")[0]!).getByText("Bilgi")).toBeInTheDocument();
  });
});

describe("PER_LINE / eski backend — bugünkü görünüm", () => {
  it("§6 PER_LINE'da kart yok; sütunlar ve süzgeç yerinde", async () => {
    getSettings.mockResolvedValue(settings({ entryMode: "PER_LINE" }));
    current = noteOf(GULECSOY);
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(await screen.findByTestId("problem-filter")).toBeInTheDocument();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByTestId("batch-no-card")).toBeNull();
    expect(screen.queryByTestId("kursun-meters-card")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Kumaş" })).toBeInTheDocument();
  });

  it("§7 ayar PER_DOCUMENT ama sunucu alanları göndermiyor (eski backend) → kart yok", async () => {
    current = noteOf({});
    renderWithProviders(<IncomingDocumentDetailPage />);
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await screen.findByTestId("problem-filter");
    expect(screen.queryByTestId("batch-no-card")).toBeNull();
  });
});

describe("onay diyaloğu PER_DOCUMENT", () => {
  it("§8 özet '1 kayıt · 4521 m · parti 214279'; satır kapısı sayılmaz", async () => {
    getSettings.mockResolvedValue(settings({ unreviewedApproval: "BLOCK", entryMode: "PER_DOCUMENT" }));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[line("a", 1, { needsReview: true })]} perDocument={{ kursunMeters: "4521", kursunMetersReview: false, ourBatchNo: "214279" }} open onOpenChange={() => {}} onDone={() => {}} />);
    expect(await screen.findByTestId("approve-per-document")).toHaveTextContent("1 kayıt · 4521 m · parti 214279");
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByTestId("approve-precheck")).toBeNull();
    expect(screen.getByRole("button", { name: "Onayla" })).toBeEnabled();
  });

  it("§9 ön kontrol aynası: metre yok → engel; review + BLOCK → engel, WARN → uyarı; parti boş → seri bilgisi", () => {
    expect(perDocumentPrecheck({ kursunMeters: null, kursunMetersReview: false, ourBatchNo: "X" }, undefined).blocked).toBe(true);
    const s = (m: string) => settings({ unreviewedApproval: m }) as never;
    expect(perDocumentPrecheck({ kursunMeters: "1775", kursunMetersReview: true, ourBatchNo: "X" }, s("BLOCK")).blocked).toBe(true);
    const warn = perDocumentPrecheck({ kursunMeters: "1775", kursunMetersReview: true, ourBatchNo: null }, s("WARN"));
    expect(warn.blocked).toBe(false);
    expect(warn.messages.map((m) => m.tone)).toEqual(["warn", "info"]);
    expect(perDocumentSummary({ kursunMeters: "2157", ourBatchNo: null })).toBe("1 kayıt · 2157 m · parti numarası seriden doğacak");
  });
});
