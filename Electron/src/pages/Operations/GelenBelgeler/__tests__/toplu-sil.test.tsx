// Gelen belge listesinden toplu taslak silme + sağ tık menüsü: seçim yalnız DRAFT'ta (onaylıda kutu pasif + neden),
// "Tümünü seç" yalnız silinebilir satırları seçer, önizleme diyaloğu her kaydı listeler ve kayıt başına kaldırılır,
// uygula yalnız kalan kimlikleri yollar, sonra liste tazelenir; sağ tık "Sil" aynı önizleme akışını tek kayıtla açar.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentsPage } from "../GelenBelgelerPage";
import type { BulkDeletePreviewItem, DeliveryNoteHeader } from "../types";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <div><h1>{title}</h1>{actions}</div>,
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ placeholder }: { placeholder?: string }) => <button type="button">{placeholder}</button>,
}));
const perms = { write: true };
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => p === "gelen-belge:read" || (perms.write && p === "gelen-belge:write"), isAdmin: false }),
}));

const listDeliveryNotes = vi.fn();
const previewBulkDeleteNotes = vi.fn();
const applyBulkDeleteNotes = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  listDeliveryNotes: (...a: unknown[]) => listDeliveryNotes(...a),
  previewBulkDeleteNotes: (...a: unknown[]) => previewBulkDeleteNotes(...a),
  applyBulkDeleteNotes: (...a: unknown[]) => applyBulkDeleteNotes(...a),
  createManualNote: vi.fn(),
  createUploadNote: vi.fn(),
  uploadScan: vi.fn(),
  getReaderStatus: vi.fn(() => new Promise(() => {})),
}));

const header = (o: Partial<DeliveryNoteHeader>): DeliveryNoteHeader => ({
  id: "n1", noteNo: "GB-0001", status: "DRAFT", sourceKind: "OCR", ownerCustomerId: null, senderCustomerId: null,
  senderText: "Akın Tekstil", senderDocNo: "A-77", senderDocDate: null, customerBatchNo: null, processText: null,
  templateId: null, templateScore: null, pageCount: 1, declaredTopCount: null, totalsDeclared: null, varianceReason: null,
  warnings: null, approvedAt: null, cancelledAt: null, createdAt: "2026-10-29T08:00:00Z", updatedAt: "2026-10-29T08:00:00Z",
  ownerCustomer: { id: "c1", code: "C1", name: "Gül Örme" }, senderCustomer: null, _count: { lines: 3, scans: 1 }, ...o,
});
const ROWS = [
  header({ id: "d1", noteNo: "GB-0001" }),
  header({ id: "a1", noteNo: "GB-0002", status: "APPROVED" }),
  header({ id: "d2", noteNo: "GB-0003" }),
];
const summary = { DRAFT: 2, APPROVING: 0, APPROVED: 1, PARTIAL: 0, CANCELLED: 0, total: 3 };
const pItem = (o: Partial<BulkDeletePreviewItem>): BulkDeletePreviewItem => ({
  id: "d1", noteNo: "GB-0001", status: "DRAFT", deletable: true, code: null, reason: null, lineCount: 3, scanCount: 1,
  ownerName: "Gül Örme", senderName: "Akın Tekstil", senderDocNo: "A-77", ...o,
});

const rowOf = (noteNo: string) => screen.getByText(noteNo).closest("tr") as HTMLElement;

beforeEach(() => {
  perms.write = true;
  listDeliveryNotes.mockReset().mockResolvedValue({ items: ROWS, nextCursor: null, summary });
  previewBulkDeleteNotes.mockReset();
  applyBulkDeleteNotes.mockReset();
});

describe("toplu taslak silme", () => {
  it("§1 taslakta kutu etkin; onaylı belgede kutu PASİF + neden ipucu", async () => {
    renderWithProviders(<IncomingDocumentsPage />);
    await screen.findByText("GB-0002");
    expect(within(rowOf("GB-0001")).getByRole("checkbox", { name: "Seç" })).toBeEnabled();
    const blocked = within(rowOf("GB-0002")).getByRole("checkbox");
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleName(/Onaylanmış belge silinemez/);
    expect(blocked.parentElement).toHaveAttribute("title", expect.stringMatching(/Onaylanmış belge silinemez/));
  });

  it("§2 'Tümünü seç' yalnız silinebilir görünür satırları seçer", async () => {
    renderWithProviders(<IncomingDocumentsPage />);
    await screen.findByText("GB-0002");
    await userEvent.click(screen.getByRole("checkbox", { name: "Tümünü seç" }));
    expect(screen.getByText("2 seçili")).toBeInTheDocument();
    expect(within(rowOf("GB-0002")).getByRole("checkbox")).not.toBeChecked();
  });

  it("§3 önizleme her kaydı listeler, kayıt kaldırılır, uygula yalnız kalanları yollar, liste tazelenir", async () => {
    previewBulkDeleteNotes.mockResolvedValue({
      items: [pItem({}), pItem({ id: "d2", noteNo: "GB-0003", lineCount: 2, scanCount: 0 }), pItem({ id: "a1", noteNo: "GB-0002", status: "APPROVED", deletable: false, code: "DELIVERY_NOTE_NOT_DRAFT", reason: "Onaylanmış belge silinemez." })],
      summary: { requested: 3, deletable: 2, blocked: 1, lines: 5, scans: 1 },
    });
    applyBulkDeleteNotes.mockResolvedValue({ results: [{ id: "d1", noteNo: "GB-0001", ok: true, status: 200, code: null, message: null }], summary: { deleted: 1, failed: 0 } });
    renderWithProviders(<IncomingDocumentsPage />);
    await screen.findByText("GB-0002");
    await userEvent.click(within(rowOf("GB-0001")).getByRole("checkbox", { name: "Seç" }));
    await userEvent.click(within(rowOf("GB-0003")).getByRole("checkbox", { name: "Seç" }));
    await userEvent.click(screen.getByTestId("notes-bulk-delete"));
    expect(previewBulkDeleteNotes).toHaveBeenCalledWith(["d1", "d2"]);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findAllByTestId("bulk-delete-row")).toHaveLength(2);
    expect(within(dialog).getByTestId("bulk-delete-blocked")).toHaveTextContent("Onaylanmış belge silinemez.");
    expect(within(dialog).getByTestId("bulk-delete-summary")).toHaveTextContent("2 taslak silinecek — 5 satır, 1 sayfa");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "GB-0003 silinsin" }));
    expect(within(dialog).getByTestId("bulk-delete-summary")).toHaveTextContent("1 taslak silinecek — 3 satır, 1 sayfa");
    const listCalls = listDeliveryNotes.mock.calls.length;
    await userEvent.click(within(dialog).getByRole("button", { name: "1 taslağı sil" }));
    await waitFor(() => expect(applyBulkDeleteNotes).toHaveBeenCalledWith(["d1"]));
    await waitFor(() => expect(listDeliveryNotes.mock.calls.length).toBeGreaterThan(listCalls));
  });

  it("§4 kısmi başarı: düşen kayıt numarası ve nedeniyle uyarı olur", async () => {
    const warn = vi.spyOn(toast, "warning");
    previewBulkDeleteNotes.mockResolvedValue({ items: [pItem({}), pItem({ id: "d2", noteNo: "GB-0003" })], summary: { requested: 2, deletable: 2, blocked: 0, lines: 6, scans: 2 } });
    applyBulkDeleteNotes.mockResolvedValue({
      results: [
        { id: "d1", noteNo: "GB-0001", ok: true, status: 200, code: null, message: null },
        { id: "d2", noteNo: null, ok: false, status: 409, code: "DELIVERY_NOTE_NOT_DRAFT", message: "GB-0003 taslak değil (APPROVED)" },
      ],
      summary: { deleted: 1, failed: 1 },
    });
    renderWithProviders(<IncomingDocumentsPage />);
    await screen.findByText("GB-0002");
    await userEvent.click(screen.getByRole("checkbox", { name: "Tümünü seç" }));
    await userEvent.click(screen.getByTestId("notes-bulk-delete"));
    await userEvent.click(await screen.findByRole("button", { name: "2 taslağı sil" }));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls[0]?.[0]).toMatch(/1 taslak silindi, 1 belge silinemedi/);
    expect(String((warn.mock.calls[0]?.[1] as { description?: string })?.description)).toMatch(/GB-0003: GB-0003 taslak değil/);
  });

  it("§5 yazma izni yoksa seçim kutusu ve 'Seçilenleri sil' yok", async () => {
    perms.write = false;
    renderWithProviders(<IncomingDocumentsPage />);
    await screen.findByText("GB-0002");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByTestId("notes-bulk-delete")).toBeNull();
  });
  it("§5b uzun adlı satır diyaloğu taşırmaz: önizleme gövdesi ızgaranın min-w-0 hücresinde çizilir", async () => {
    // jsdom düzen hesaplamaz; ızgara hücresinin min-width:auto ile büyümesini sınıf düzeyinde bekleriz.
    const long = "Çok Uzun Adlı Tekstil Boya Apre Sanayi ve Ticaret Anonim Şirketi Merkez Şubesi";
    previewBulkDeleteNotes.mockResolvedValue({ items: [pItem({ ownerName: long, senderName: long })], summary: { requested: 1, deletable: 1, blocked: 0, lines: 3, scans: 1 } });
    renderWithProviders(<IncomingDocumentsPage />);
    await screen.findByText("GB-0002");
    await userEvent.click(within(rowOf("GB-0001")).getByRole("checkbox", { name: "Seç" }));
    await userEvent.click(screen.getByTestId("notes-bulk-delete"));
    const dialog = await screen.findByRole("dialog");
    let cell: HTMLElement = await within(dialog).findByTestId("bulk-delete-row");
    while (cell.parentElement && cell.parentElement !== dialog) cell = cell.parentElement;
    expect(cell.parentElement).toBe(dialog);
    expect(cell).toHaveClass("min-w-0");
  });
});

describe("sağ tık menüsü", () => {
  it("§6 onaylı belgede 'Sil' pasif + neden; taslakta 'Sil' aynı önizlemeyi tek kayıtla açar", async () => {
    previewBulkDeleteNotes.mockResolvedValue({ items: [pItem({ id: "d2", noteNo: "GB-0003" })], summary: { requested: 1, deletable: 1, blocked: 0, lines: 3, scans: 1 } });
    renderWithProviders(<IncomingDocumentsPage />);
    await screen.findByText("GB-0002");
    fireEvent.contextMenu(rowOf("GB-0002"));
    expect(await screen.findByRole("menuitem", { name: /^Aç$/ })).toBeInTheDocument();
    const off = screen.getByTestId("note-menu-delete");
    expect(off).toHaveAttribute("data-disabled");
    expect(off).toHaveTextContent(/Onaylanmış belge silinemez/);
    fireEvent.keyDown(off, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("note-menu-delete")).toBeNull());
    fireEvent.contextMenu(rowOf("GB-0003"));
    const on = await screen.findByTestId("note-menu-delete");
    expect(on).not.toHaveAttribute("data-disabled");
    await userEvent.click(on);
    await waitFor(() => expect(previewBulkDeleteNotes).toHaveBeenCalledWith(["d2"]));
    expect(await screen.findByRole("button", { name: "1 taslağı sil" })).toBeInTheDocument();
  });
});
