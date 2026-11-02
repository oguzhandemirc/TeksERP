// Gülkesim P2: belge başına tek kayıt (PER_DOCUMENT) gözden geçirme yüzeyi — parti no seçici, kurşun metresi kartı,
// bilgi satırları (INFO), onay özeti. Kip ve kapı hükmü sunucunun `perDocument` alanından (yalnız PER_DOCUMENT'ta doğar),
// değerler sunucudan; panel öncelik kuralı kurmaz. Negatif sonda: `showsPerDocument` hep true → §6 kırmızı.
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

const line = (id: string, lineNo: number, o: Partial<DeliveryNoteLine> = {}): DeliveryNoteLine =>
  ({
    id, noteId: "n1", lineNo, blockNo: 1, lineKind: "TOP", senderRollNo: null, meters: "200", weightKg: null, widthCm: null, itemText: "FULAR", itemId: null,
    colorText: null, colorId: null, processText: null, confidence: null, needsReview: false, sourceRects: null, status: "PENDING", failReason: null, rollId: null,
    item: null, color: null, problems: [], ...o,
  }) as DeliveryNoteLine;

const GULECSOY: Partial<DeliveryNoteDetail> = {
  perDocument: { code: null, warnings: [], totalsBlocking: false },
  ourBatchNo: "214279", ourBatchNoKey: "fisNo", kursunMeters: "4521", kursunMetersSource: "OUTPUT", kursunMetersReview: false,
  batchNoCandidates: [
    { key: "fisNo", kind: "DOC", label: "FİŞ NO", value: "214279" },
    { key: "hamPartiNo", kind: "BATCH", label: "Ham PartiNo", value: "P2618733" },
    { key: "isEmriNo", kind: "WORK_ORDER", label: "İş Emri No", value: "26K-24749" },
  ],
  kursunMeterCandidates: { output: "4521", total: null, input: null, lineSum: "4521" },
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
  getSettings.mockReset().mockResolvedValue(settings());
});

describe("PER_DOCUMENT detay", () => {
  it("§1 parti no kartı: adaylar radyo + tür; aday seçimi {ourBatchNo, ourBatchNoKey} PATCH'ler", async () => {
    current = noteOf(GULECSOY);
    renderWithProviders(<IncomingDocumentDetailPage />);
    const card = await screen.findByTestId("batch-no-card");
    expect(within(card).getAllByTestId("batch-candidate")).toHaveLength(3);
    expect(within(card).getByRole("radio", { name: "FİŞ NO: 214279" })).toBeChecked();
    expect(within(card).getAllByTestId("batch-candidate")[2]).toHaveTextContent("Gönderenin emir no");
    await userEvent.click(within(card).getByRole("radio", { name: "Ham PartiNo: P2618733" }));
    expect(header.mutate).toHaveBeenCalledWith({ ourBatchNo: "P2618733", ourBatchNoKey: "hamPartiNo" });
  });

  it("§2 elle yaz → anahtarsız PATCH (sunucu MANUAL yazar), boşaltma null; seçim yoksa 'seriden doğar' uyarısı", async () => {
    current = noteOf({ ...GULECSOY, ourBatchNo: null, ourBatchNoKey: null });
    renderWithProviders(<IncomingDocumentDetailPage />);
    await screen.findByTestId("batch-no-empty");
    const input = screen.getByLabelText("Parti no (elle)");
    expect(input).toHaveAttribute("maxLength", "64");
    fireEvent.blur(input, { target: { value: " ELLE-1 " } });
    expect(header.mutate).toHaveBeenLastCalledWith({ ourBatchNo: "ELLE-1" });
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
    current = noteOf({ ...GULECSOY, kursunMeters: "1775", kursunMetersReview: true, kursunMeterCandidates: { output: "1775", total: null, input: "1375", lineSum: "1775" } });
    renderWithProviders(<IncomingDocumentDetailPage />);
    const card = await screen.findByTestId("kursun-meters-card");
    expect(card.dataset.review).toBe("1");
    expect(within(card).getByTestId("kursun-sources")).toHaveTextContent("Giriş metresi (yalnız bilgi): 1375 m");
    await userEvent.click(within(card).getByTestId("kursun-meters-edit"));
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
  it("§6 PER_LINE (sunucu `perDocument` göndermez) — kolonlar dolu olsa da kart yok; sütunlar ve süzgeç yerinde", async () => {
    current = noteOf({ ...GULECSOY, perDocument: undefined });
    renderWithProviders(<IncomingDocumentDetailPage />);
    expect(await screen.findByTestId("problem-filter")).toBeInTheDocument();
    expect(screen.queryByTestId("batch-no-card")).toBeNull();
    expect(screen.queryByTestId("kursun-meters-card")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Kumaş" })).toBeInTheDocument();
  });

  it("§7 eski backend (hiçbir yeni alan yok) → kart yok", async () => {
    current = noteOf({});
    renderWithProviders(<IncomingDocumentDetailPage />);
    await screen.findByTestId("problem-filter");
    expect(screen.queryByTestId("batch-no-card")).toBeNull();
  });
});

describe("onay diyaloğu PER_DOCUMENT", () => {
  it("§8 özet '1 kayıt · 4521 m · parti 214279'; satır kapısı sayılmaz (BLOCK ayarında needsReview satır olsa da)", async () => {
    getSettings.mockResolvedValue(settings({ unreviewedApproval: "BLOCK" }));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[line("a", 1, { needsReview: true })]} perDocument={{ note: { kursunMeters: "4521", ourBatchNo: "214279" }, gate: { code: null, warnings: [], totalsBlocking: false } }} open onOpenChange={() => {}} onDone={() => {}} />);
    expect(await screen.findByTestId("approve-per-document")).toHaveTextContent("1 kayıt · 4521 m · parti 214279");
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(screen.queryByTestId("approve-precheck")).toBeNull();
    expect(screen.getByRole("button", { name: "Onayla" })).toBeEnabled();
  });

  it("§9 ön kontrol sunucu kapısından: code → engel, warnings → uyarı, parti boş → seri bilgisi", async () => {
    const gate = { code: "KURSUN_METERS_REVIEW_PENDING" as const, warnings: [], totalsBlocking: false };
    expect(perDocumentPrecheck({ kursunMeters: "1775", ourBatchNo: "X" }, gate).blocked).toBe(true);
    const warn = perDocumentPrecheck({ kursunMeters: "1775", ourBatchNo: null }, { code: null, warnings: ["Kurşun metresi (1775 m) gözden geçirilmeden onaylandı."], totalsBlocking: false });
    expect(warn.blocked).toBe(false);
    expect(warn.messages.map((m) => m.tone)).toEqual(["warn", "info"]);
    expect(perDocumentSummary({ kursunMeters: "2157", ourBatchNo: null })).toBe("1 kayıt · 2157 m · parti numarası seriden doğacak");
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} perDocument={{ note: { kursunMeters: null, ourBatchNo: "X" }, gate: { code: "KURSUN_METERS_REQUIRED", warnings: [], totalsBlocking: false } }} open onOpenChange={() => {}} onDone={() => {}} />);
    expect((await screen.findByTestId("approve-precheck")).dataset.blocked).toBe("1");
    expect(screen.getByRole("button", { name: "Onayla" })).toBeDisabled();
  });
});
